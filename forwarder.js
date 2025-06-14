

const { Client, GatewayIntentBits } = require('discord.js');


const { createAudioPlayer, createAudioResource, joinVoiceChannel, VoiceConnectionStatus, entersState, demuxProbe } = require('@discordjs/voice');
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
        this.audioPlayer = createAudioPlayer();

        this.client = new Client({
            intents: [GatewayIntentBits.GuildVoiceStates]
        });

        this.client.once('ready', async () => {
            this.logger.info(`✅ Connecté en tant que ${this.client.user.tag}`);

            try {
                await this.connectToVoice();
            } catch (err) {
                this.logger.error(`❌ Erreur lors de la connexion au canal : ${err.message}`);
            }
        });

        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            if (newState.id !== this.client.user.id) return;
            if (newState.channelId === this.args.channelId) return;

            this.logger.warn('🔄 Changement de salon détecté, reconnexion au salon cible…');
            try {
                if (this.connection) {
                    this.connection.destroy();
                }
            } catch {}

            try {
                await this.connectToVoice();
            } catch (err) {
                this.logger.error(`❌ Erreur lors de la reconnexion : ${err.message}`);
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
            this.logger.warn('🔌 Déconnecté du vocal, reconnexion…');
            try {
                await Promise.race([
                    entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
            } catch {
                try { this.connection.destroy(); } catch {}
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
        });

        this.logger.info('🔊 Canal vocal rejoint, forwarding actif.');
    }
    playStream(readable) {
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
        if (this.connection) this.connection.destroy();
        if (this.client) this.client.destroy();
    }
}

module.exports = Forwarder;
