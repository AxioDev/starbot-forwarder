

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');


const { createAudioPlayer, createAudioResource, joinVoiceChannel, VoiceConnectionStatus, entersState, demuxProbe, EndBehaviorType } = require('@discordjs/voice');
const FFMPEG = require('./ffmpeg');
const AudioReceiver = require('./audioReceiver');

class Forwarder {
    /**
     * @param {object} args - même structure que dans index.js
     * @param {winston.Logger} logger
     */
    constructor(args, logger) {
        this.args = args;
        this.logger = logger;
        this.ffmpeg = null;
        this.receiver = null;
        this.connection = null;
        this.channel = null;
        this.reconnectInterval = null;
        this.reconnectBlockedUntil = 0;
        this.manualDisconnect = false;
        this.audioPlayer = createAudioPlayer();
        this.mode = typeof this.args.mode === 'string' ? this.args.mode.toLowerCase() : 'active';
        if (!['active', 'inactive'].includes(this.mode)) {
            this.mode = 'active';
        }

        this.client = new Client({
            intents: [GatewayIntentBits.GuildVoiceStates]
        });

        this.client.once('ready', async () => {
            this.logger.info(`✅ Connecté en tant que ${this.client.user.tag}`);
            this.updatePresence();

            if (this.isInactive()) {
                this.logger.info('🤖 Mode inactif activé : aucune connexion vocale, aucun message ni commande ne seront traités et le spawn de poubelles est désactivé.');
                return;
            }

            try {
                await this.connectToVoice();
                this.startAutoReconnect();
            } catch (err) {
                this.logger.error(`❌ Erreur lors de la connexion au canal : ${err.message}`);
            }
        });

        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            if (this.isInactive()) return;
            if (newState.id !== this.client.user.id) return;
            if (newState.channelId === this.args.channelId) return;
            if (this.manualDisconnect) { this.manualDisconnect = false; return; }

            if (oldState.channelId === this.args.channelId) {
                this.reconnectBlockedUntil = Date.now() + 30 * 60 * 1000;
                this.logger.warn('❌ Expulsé du vocal. Reconnexion prévue dans 30 minutes.');
                try {
                    if (this.connection) {
                        this.manualDisconnect = true;
                        this.connection.destroy();
                    }
                } catch {}
            }
        });

        this.client.login(this.args.token).catch(err => {
            this.logger.error(`❌ Échec de connexion Discord : ${err.message}`);
        });
    }

    isInactive() {
        return this.mode === 'inactive';
    }

    updatePresence() {
        if (!this.client?.user) return;
        const presenceOptions = this.isInactive()
            ? { status: 'idle', activities: [] }
            : {
                status: 'online',
                activities: this.args.listeningTo ? [{ type: ActivityType.Listening, name: this.args.listeningTo }] : []
            };
        this.client.user.setPresence(presenceOptions).catch(err => {
            this.logger.warn(`⚠️ Impossible de mettre à jour la présence Discord : ${err.message}`);
        });
    }

    async connectToVoice() {
        if (this.isInactive()) {
            this.logger.debug('Connexion vocale ignorée (mode inactif).');
            return;
        }
        this.logger.info('Connexion au canal vocal…');
        const channel = await this.client.channels.fetch(this.args.channelId);
        this.channel = channel;

        if (!this.ffmpeg) {
            this.ffmpeg = new FFMPEG(this.args, this.logger);
        }

        this.connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfMute: false,
            selfDeaf: false
        });
        this.connection.subscribe(this.audioPlayer);

        this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            if (this.reconnectBlockedUntil && Date.now() < this.reconnectBlockedUntil) {
                this.logger.warn('🔌 Déconnecté du vocal. Attente avant reconnexion…');
                return;
            }
            this.logger.warn('🔌 Déconnecté du vocal, reconnexion…');
            try {
                await Promise.race([
                    entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
            } catch {
                try { this.manualDisconnect = true; this.connection.destroy(); } catch {}
                await this.connectToVoice();
                return;
            }
        });

        if (!this.receiver) {
            // créé un AudioReceiver qui enverra tout dans ffmpeg et vers Kaldi
            this.receiver = new AudioReceiver(
                this.ffmpeg,
                48000,
                this.logger,
                this.args.kaldi,
                this.args.transcriptionStore || null,
                { guildId: channel.guild.id, channelId: channel.id }
            );
        } else {
            this.receiver.updateContext(channel.guild.id, channel.id);
        }

        // à chaque fois qu’un user parle, on pipe son flux Opus vers notre décodeur
        this.connection.receiver.speaking.on('start', userId => {
            this.logger.debug(`User ${userId} a commencé à parler`);
            const opusStream = this.connection.receiver.subscribe(userId, { mode: 'opus', end: { behavior: 'manual' } });
            this.receiver.handleOpusStream(opusStream, userId);
        });

        this.logger.info('🔊 Canal vocal rejoint, forwarding actif.');
        this.startAutoReconnect();
    }

    startAutoReconnect() {
        if (this.isInactive()) {
            if (this.reconnectInterval) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            }
            return;
        }
        if (this.reconnectInterval) clearInterval(this.reconnectInterval);
        this.reconnectInterval = setInterval(async () => {
            if (this.isInactive()) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
                return;
            }
            const now = Date.now();
            if (this.reconnectBlockedUntil && now < this.reconnectBlockedUntil) return;
            const needsReconnect = !this.connection ||
                this.connection.state.status === VoiceConnectionStatus.Destroyed ||
                (this.connection.joinConfig && this.connection.joinConfig.channelId !== this.args.channelId);
            if (needsReconnect) {
                this.logger.warn('🔄 Reconnexion automatique au salon vocal…');
                try {
                    if (this.connection) {
                        try { this.manualDisconnect = true; this.connection.destroy(); } catch {}
                    }
                    await this.connectToVoice();
                } catch (err) {
                    this.logger.error(`❌ Reconnexion automatique échouée : ${err.message}`);
                }
            }
        }, 3000);
    }
    playStream(readable) {
        if (this.isInactive()) {
            this.logger.warn('Flux audio ignoré : le bot est en mode inactif.');
            if (typeof readable?.destroy === 'function') {
                readable.destroy();
            }
            return;
        }
        demuxProbe(readable)
            .then(({ stream, type }) => {
                const resource = createAudioResource(stream, { inputType: type });
                this.audioPlayer.play(resource);
            })
            .catch(err => this.logger.error('Error probing audio stream:', err));
    }


    close() {
        if (this.receiver) this.receiver.close();
        if (this.ffmpeg) this.ffmpeg.close();
        if (this.connection) { this.manualDisconnect = true; this.connection.destroy(); }
        if (this.client) this.client.destroy();
        if (this.reconnectInterval) clearInterval(this.reconnectInterval);
    }
}

module.exports = Forwarder;
