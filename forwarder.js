const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const FFMPEG = require('./ffmpeg');
const AudioReceiver = require('./audioReceiver');

class Forwarder {
  /**
   * @param {object} args  mêmes champs que dans index.js
   * @param {winston.Logger} logger
   */
  constructor(args, logger) {
    this.args = args;
    this.logger = logger;
    this.client = new Client({ intents: [GatewayIntentBits.GuildVoiceStates] });

    this.client.once('ready', async () => {
      this.logger.info(`Connecté en tant que ${this.client.user.tag}`);
      const channel = await this.client.channels.fetch(this.args.channelId);
      if (!channel || !channel.isVoiceBased()) {
        this.logger.error('L’ID spécifié n’est pas un voice channel !');
        return;
      }

      // lance ffmpeg _avant_ de brancher l’audio
      this.ffmpeg = new FFMPEG(this.args, this.logger);

      // rejoint le canal
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId:   channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfMute:  false,
        selfDeaf:  false
      });

      // indique l’activité “Listening to …”
      this.client.user.setActivity(this.args.listeningTo, { type: ActivityType.Listening });

      // créé un AudioReceiver qui enverra tout dans ffmpeg
      const receiver = new AudioReceiver(this.ffmpeg, 48000, this.logger);

      // à chaque fois qu’un user parle, on pipe son flux Opus vers notre décodeur
      connection.receiver.speaking.on('start', userId => {
        this.logger.debug(`User ${userId} a commencé à parler`);
        const opusStream = connection.receiver.subscribe(userId, { mode: 'opus', end: { behavior: 'manual' } });
        receiver.handleOpusStream(opusStream);
      });

      this.logger.info('Canal vocal rejoint et forwarding démarré.');
    });

    this.client.login(this.args.token);
  }

  close() {
    if (this.ffmpeg) this.ffmpeg.close();
    this.client.destroy();
  }
}

module.exports = Forwarder;
