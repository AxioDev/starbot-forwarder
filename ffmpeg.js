const { spawn } = require('child_process');
const EventEmitter = require('events');

class FFMPEG extends EventEmitter {
  /**
   * @param {object} args
   * @param {number} args.sampleRate
   * @param {number} args.compressionLevel
   * @param {boolean} args.redirectFfmpegOutput
   * @param {{ icecastUrl: string|null, path: string|null }} args.outputGroup
   * @param {import('winston').Logger} logger
   */
  constructor(args, logger) {
    super();
    this.logger = logger;
    this.args = args;
    this.keepRunning = true;

    this.spawnProcess();
  }

  spawnProcess() {
    const args = this.args;

    const cmd = [
      'ffmpeg', '-hide_banner',
      '-f', 's16le', '-ac', '2', '-ar', '48000', '-i', 'pipe:0',
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

    // 2) Log quand ffmpeg se ferme et redémarrer si nécessaire
    this.process.on('close', (code, signal) => {
      this.logger.warn(`ffmpeg process closed (code=${code}, signal=${signal})`);
      if (this.keepRunning) {
        setTimeout(() => this.spawnProcess(), 1000);
      }
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

  /** Ferme proprement ffmpeg et stoppe le redémarrage auto */
  close() {
    this.keepRunning = false;
    if (this.process) {
      this.process.removeAllListeners('close');
      this.process.stdin.end();
      this.process.kill('SIGTERM');
    }
  }
}

module.exports = FFMPEG;
