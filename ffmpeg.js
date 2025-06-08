const { spawn } = require('child_process');

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

    // Construction de la commande ffmpeg
    const cmd = [
      'ffmpeg', '-hide_banner',
      '-f', 's16le', '-ac', '2', '-ar', '48000', '-i', 'pipe:0',
      '-ar', String(args.sampleRate),
      '-ac', String(args.compressionLevel),
      '-c:a', 'libmp3lame',
      '-f', 'mp3'
    ];

    if (args.outputGroup.icecastUrl) {
      cmd.push(
        '-reconnect_at_eof', '1',
        '-reconnect_streamed',  '1',
        '-reconnect',          '1',
        '-reconnect_delay_max','1000',
        '-content_type',       'audio/mpeg',
        args.outputGroup.icecastUrl
      );
    } else if (args.outputGroup.path) {
      cmd.push(args.outputGroup.path);
    } else {
      throw new Error('Aucun output spécifié.');
    }

    // Démarrage du process
    this.process = spawn(cmd[0], cmd.slice(1), {
      stdio: [
        'pipe',
        args.redirectFfmpegOutput ? 'inherit' : 'ignore',
        'inherit'
      ]
    });

    // 1) Éviter le crash sur EPIPE
    this.process.stdin.on('error', err => {
      if (err.code === 'EPIPE') {
        this.logger.warn('ffmpeg stdin: broken pipe (EPIPE), on ignore.');
      } else {
        this.logger.error('ffmpeg stdin error:', err);
      }
    });

    // 2) Log quand ffmpeg se ferme
    this.process.on('close', (code, signal) => {
      this.logger.info(`ffmpeg process closed (code=${code}, signal=${signal})`);
    });

    // 3) Rethrow sur échec de spawn
    this.process.on('error', err => {
      this.logger.error('Erreur lors du démarrage de ffmpeg:', err);
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
      this.logger.debug('ffmpeg stdin buffer plein (backpressure)');
    }
  }

  /** Ferme proprement stdin de ffmpeg */
  close() {
    this.process.stdin.end();
  }
}

module.exports = FFMPEG;
