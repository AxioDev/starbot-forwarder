

const { Client, GatewayIntentBits } = require('discord.js');


const { joinVoiceChannel } = require('@discordjs/voice');
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

        this.client = new Client({
            intents: [GatewayIntentBits.GuildVoiceStates]
        });

        this.client.once('ready', async () => {
            this.logger.info(`✅ Connecté en tant que ${this.client.user.tag}`);

            try {
                console.log(`Activité définie`, this.args.channelId);
                const channel = await this.client.channels.fetch(this.args.channelId);
                
                console.log(`Canal vocal récupéré`, channel.id);

                this.ffmpeg = new FFMPEG(this.args, this.logger);

                const connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    selfMute: false,
                    selfDeaf: false
                });

                // créé un AudioReceiver qui enverra tout dans ffmpeg
                this.receiver = new AudioReceiver(this.ffmpeg, 48000, this.logger);

                // à chaque fois qu’un user parle, on pipe son flux Opus vers notre décodeur
                connection.receiver.speaking.on('start', userId => {
                    this.logger.debug(`User ${userId} a commencé à parler`);
                    const opusStream = connection.receiver.subscribe(userId, { mode: 'opus', end: { behavior: 'manual' } });
                    this.receiver.handleOpusStream(opusStream, userId);
                });

                connection.receiver.speaking.on('start', (userId) => {
                    this.logger.debug(`🎙️ Utilisateur ${userId} a commencé à parler`);
                    const opusStream = connection.receiver.subscribe(userId, {
                        mode: 'opus',
                        end: { behavior: 'manual' }
                    });
                    this.receiver.handleOpusStream(opusStream, userId);
                });

                this.logger.info('🔊 Canal vocal rejoint, forwarding actif.');
            } catch (err) {
                this.logger.error(`❌ Erreur lors de la connexion au canal : ${err.message}`);
            }
        });

        this.client.login(this.args.token).catch(err => {
            this.logger.error(`❌ Échec de connexion Discord : ${err.message}`);
        });
    }

    close() {
        if (this.receiver) this.receiver.close();
        if (this.ffmpeg) this.ffmpeg.close();
        if (this.client) this.client.destroy();
    }
}

module.exports = Forwarder;
