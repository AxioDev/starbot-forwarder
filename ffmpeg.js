const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

class FFMPEG {
  /**
   * @param {object} args
   * @param {number} args.sampleRate
   * @param {number} args.compressionLevel
   * @param {boolean} args.redirectFfmpegOutput
   * @param {{ icecastUrl: string|null, path: string|null }} args.outputGroup
   * @param {import('winston').Logger} logger
   */
  constructor(args, logger) {
    this.logger = logger;

    if (!args.outputGroup.icecastUrl && !args.outputGroup.path) {
      throw new Error('❌ Aucun output spécifié (ni icecastUrl ni path).');
    }

    // Commande de base
    const cmd = [
      ffmpegPath,
      '-hide_banner',
      '-f', 's16le',
      '-ac', '2',
      '-ar', '48000',
      '-i', 'pipe:0',
      '-ar', String(args.sampleRate),
      '-ac', '2',
      '-c:a', 'libmp3lame',
      '-f', 'mp3'
    ];

    if (args.compressionLevel > 0) {
      cmd.push('-b:a', `${args.compressionLevel}k`);
    }

    if (args.outputGroup.icecastUrl) {
      let url = args.outputGroup.icecastUrl;
      if (/^https?:\/\//.test(url) && !url.startsWith('icecast+')) {
        url = 'icecast+' + url;
      }
      cmd.push(
        '-reconnect_at_eof', '1',
        '-reconnect_streamed',  '1',
        '-reconnect',          '1',
        '-reconnect_delay_max','1000',
        '-content_type',       'audio/mpeg',
        url
      );
    }

    // Sortie vers fichier local
    else if (args.outputGroup.path) {
      cmd.push(args.outputGroup.path);
    }

    this.logger.debug(`🎬 Commande FFMPEG: ${cmd.join(' ')}`);

    // Lancement du process
    this.process = spawn(cmd[0], cmd.slice(1), {
      stdio: [
        'pipe', // stdin
        args.redirectFfmpegOutput ? 'inherit' : 'ignore', // stdout
        'inherit' // stderr
      ]
    });

    // Gestion des erreurs stdin
    this.process.stdin.on('error', err => {
      if (err.code === 'EPIPE') {
        this.logger.warn('⚠️ ffmpeg stdin: broken pipe (EPIPE), ignoré.');
      } else {
        this.logger.error('❌ Erreur sur stdin ffmpeg :', err);
      }
    });

    // Log fermeture process
    this.process.on('close', (code, signal) => {
      this.logger.info(`✅ ffmpeg terminé (code=${code}, signal=${signal})`);
    });

    // Erreur au démarrage
    this.process.on('error', err => {
      this.logger.error('❌ Erreur de spawn ffmpeg :', err);
      throw err;
    });
  }

  /**
   * Envoie des données PCM à ffmpeg
   * @param {Buffer} buffer
   */
  giveAudio(buffer) {
    const ok = this.process.stdin.write(buffer);
    if (!ok) {
      this.logger.debug('📉 Buffer ffmpeg plein (backpressure)');
    }
  }

  /** Ferme proprement ffmpeg */
  close() {
    this.process.stdin.end();
  }
}

module.exports = FFMPEG;
