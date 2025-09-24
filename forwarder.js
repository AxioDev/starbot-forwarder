const { EventEmitter } = require('events');
const { Client, GatewayIntentBits } = require('discord.js');
const { createAudioPlayer, createAudioResource, joinVoiceChannel, VoiceConnectionStatus, entersState, demuxProbe } = require('@discordjs/voice');
const FFMPEG = require('./ffmpeg');
const AudioReceiver = require('./audioReceiver');

class Forwarder extends EventEmitter {
    /**
     * @param {object} args - même structure que dans index.js
     * @param {winston.Logger} logger
     */
    constructor(args, logger) {
        super();
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
        this.currentSpeakers = new Set();

        this.client = new Client({
            intents: [GatewayIntentBits.GuildVoiceStates]
        });

        this.client.once('ready', async () => {
            this.logger.info(`✅ Connecté en tant que ${this.client.user.tag}`);

            try {
                await this.connectToVoice();
                this.startAutoReconnect();
            } catch (err) {
                this.logger.error(`❌ Erreur lors de la connexion au canal : ${err.message}`);
            }
        });

        this.client.on('voiceStateUpdate', async (oldState, newState) => {
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

    async connectToVoice() {
        this.logger.info('Connexion au canal vocal…');
        const channel = await this.client.channels.fetch(this.args.channelId);
        this.channel = channel;

        if (this.currentSpeakers.size > 0) {
            for (const speakerId of this.currentSpeakers) {
                this.emit('speakingStop', { id: speakerId });
            }
            this.currentSpeakers.clear();
        }

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
            // créé un AudioReceiver qui enverra tout dans ffmpeg
            this.receiver = new AudioReceiver(this.ffmpeg, 48000, this.logger);
        }

        // à chaque fois qu’un user parle, on pipe son flux Opus vers notre décodeur
        this.connection.receiver.speaking.on('start', userId => {
            this.logger.debug(`User ${userId} a commencé à parler`);
            const opusStream = this.connection.receiver.subscribe(userId, { mode: 'opus', end: { behavior: 'manual' } });
            this.receiver.handleOpusStream(opusStream, userId);
            this.handleSpeakingStart(userId);
        });

        this.connection.receiver.speaking.on('end', userId => {
            this.logger.debug(`User ${userId} a arrêté de parler`);
            if (this.currentSpeakers.delete(userId)) {
                this.emit('speakingStop', { id: userId });
            }
        });

        this.logger.info('🔊 Canal vocal rejoint, forwarding actif.');
        this.startAutoReconnect();
    }

    startAutoReconnect() {
        if (this.reconnectInterval) clearInterval(this.reconnectInterval);
        this.reconnectInterval = setInterval(async () => {
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
        demuxProbe(readable)
            .then(({ stream, type }) => {
                const resource = createAudioResource(stream, { inputType: type });
                this.audioPlayer.play(resource);
            })
            .catch(err => this.logger.error('Error probing audio stream:', err));
    }

    handleSpeakingStart(userId) {
        if (this.currentSpeakers.has(userId)) {
            return;
        }

        this.currentSpeakers.add(userId);
        this.notifySpeakerStart(userId).catch(error => {
            this.logger.debug(`Impossible de récupérer les informations de l'utilisateur ${userId}: ${error.message}`);
            this.emit('speakingStart', {
                id: userId,
                displayName: `Intervenant ${userId.slice(-4)}`,
                avatarUrl: undefined,
                startedAt: Date.now()
            });
        });
    }

    async notifySpeakerStart(userId) {
        const payload = {
            id: userId,
            displayName: `Intervenant ${userId.slice(-4)}`,
            avatarUrl: undefined,
            startedAt: Date.now()
        };

        try {
            const member = await this.fetchGuildMember(userId);
            if (member) {
                payload.displayName = member.displayName || member.nickname || member.user?.username || payload.displayName;
                if (member.user && typeof member.user.displayAvatarURL === 'function') {
                    payload.avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });
                }
            } else {
                const user = await this.client.users.fetch(userId).catch(() => null);
                if (user) {
                    payload.displayName = user.username || payload.displayName;
                    if (typeof user.displayAvatarURL === 'function') {
                        payload.avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                    }
                }
            }
        } catch (error) {
            this.logger.debug(`Erreur lors de la récupération de l'utilisateur ${userId}: ${error.message}`);
        }

        this.emit('speakingStart', payload);
    }

    async fetchGuildMember(userId) {
        try {
            if (this.channel && this.channel.guild && this.channel.guild.members) {
                return await this.channel.guild.members.fetch(userId);
            }
        } catch (error) {
            this.logger.debug(`Impossible de récupérer le membre ${userId}: ${error.message}`);
        }
        return null;
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
