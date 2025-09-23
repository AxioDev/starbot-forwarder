const { spawn } = require('child_process');
const EventEmitter = require('events');

class FFMPEG extends EventEmitter {
  /**
   * @param {object} args
   * @param {number} args.sampleRate
  * @param {number} args.compressionLevel
  * @param {number} args.volume
  * @param {number|null} [args.minBitrate]
  * @param {boolean} args.redirectFfmpegOutput
   * @param {{ icecastUrl: string|null, path: string|null }} args.outputGroup
   * @param {import('winston').Logger} logger
   */
  constructor(args, logger) {
    super();
    this.logger = logger;
    this.args = args;
    this.keepRunning = true;
    this.process = null;
    this.restartTimer = null;

    this.spawnProcess();
  }

  spawnProcess() {
    if (!this.keepRunning) {
      return;
    }

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const args = this.args;

    const cmd = [
      'ffmpeg', '-hide_banner',
      '-f', 's16le', '-ac', '2', '-ar', '48000', '-i', 'pipe:0',
      '-filter:a', `volume=${args.volume}`,
      '-ar', String(args.sampleRate),
      '-ac', '2',
      '-c:a', 'libmp3lame',
      '-f', 'mp3'
    ];

    if (args.minBitrate) {
      cmd.push('-minrate', `${args.minBitrate}k`);
    }

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
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: [
        'pipe',
        args.redirectFfmpegOutput ? 'inherit' : 'ignore',
        'inherit'
      ]
    });

    this.process = child;

    // 1) Éviter le crash sur EPIPE
    child.stdin.on('error', err => {
      if (err.code === 'EPIPE') {
        this.logger.warn('ffmpeg stdin: broken pipe (EPIPE), on ignore.');
      } else {
        this.logger.error('ffmpeg stdin error:', err);
      }
    });

    // 2) Log quand ffmpeg se ferme et redémarrer si nécessaire
    child.on('close', (code, signal) => {
      this.logger.warn(`ffmpeg process closed (code=${code}, signal=${signal})`);
      this.process = null;
      if (this.keepRunning) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.spawnProcess();
        }, 1000);
      }
    });

    // 3) Rethrow sur échec de spawn
    child.on('error', err => {
      this.logger.error('Erreur lors du démarrage de ffmpeg:', err);
      throw err;
    });
  }

  /**
   * Envoie des données PCM à ffmpeg
   * @param {Buffer} buffer
   */
  giveAudio(buffer) {
    if (!this.process || !this.process.stdin || this.process.killed) {
      this.logger.debug('ffmpeg non disponible, paquet audio ignoré');
      return;
    }

    const stdin = this.process.stdin;
    if (stdin.destroyed || stdin.writableEnded || stdin.writableFinished) {
      this.logger.debug('ffmpeg stdin fermé, paquet audio ignoré');
      return;
    }

    try {
      const ok = stdin.write(buffer);
      if (!ok) {
        this.logger.debug('ffmpeg stdin buffer plein (backpressure)');
      }
    } catch (err) {
      if (err.code === 'ERR_STREAM_WRITE_AFTER_END' || err.code === 'ERR_STREAM_DESTROYED') {
        this.logger.warn(`Impossible d\'écrire sur ffmpeg stdin (${err.code}), paquet audio perdu.`);
      } else {
        this.logger.error('Erreur inattendue lors de l\'écriture dans ffmpeg stdin:', err);
      }
    }
  }

  /** Ferme proprement ffmpeg et stoppe le redémarrage auto */
  close() {
    this.keepRunning = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.process) {
      this.process.removeAllListeners('close');
      this.process.stdin.end();
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}

module.exports = FFMPEG;
