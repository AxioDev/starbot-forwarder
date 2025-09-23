const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const ffmpegStatic = require('ffmpeg-static');
const IcecastClient = require('./icecastClient');

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
    this.encoderPath = ffmpegStatic || 'ffmpeg';
    this.icecastClient = null;
    this.fileStream = null;

    if (args.outputGroup.icecastUrl) {
      this.icecastClient = new IcecastClient(args.outputGroup.icecastUrl, this.logger, {
        headers: {
          'Ice-Name': 'Starbot Forwarder',
          'Ice-Description': 'Discord relay'
        }
      });
    }

    if (args.outputGroup.path) {
      this.fileStream = fs.createWriteStream(args.outputGroup.path);
      this.fileStream.on('error', err => {
        this.logger.error('Erreur lors de l\'écriture du fichier de sortie:', err);
        this.fileStream = null;
        this.logger.warn('Flux fichier désactivé après erreur.');
      });
    }

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
      this.encoderPath, '-hide_banner',
      '-f', 's16le', '-ac', '2', '-ar', '48000', '-i', 'pipe:0',
      '-filter:a', `volume=${args.volume}`,
      '-ar', String(args.sampleRate),
      '-ac', '2',
      '-c:a', 'libmp3lame',
      '-f', 'mp3',
      'pipe:1'
    ];

    if (args.minBitrate) {
      cmd.push('-minrate', `${args.minBitrate}k`);
    }

    if (args.compressionLevel > 0) {
      cmd.push('-b:a', `${args.compressionLevel}k`);
    }

    if (!this.icecastClient && !this.fileStream) {
      throw new Error('Aucun output spécifié.');
    }

    // Démarrage du process
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: [
        'pipe',
        'pipe',
        'pipe'
      ]
    });

    this.process = child;

    if (child.stdout) {
      child.stdout.on('data', chunk => {
        if (this.icecastClient) {
          this.icecastClient.write(chunk);
        }
        if (this.fileStream) {
          this.fileStream.write(chunk);
        }
      });
      child.stdout.on('error', err => {
        this.logger.error('Erreur sur stdout de ffmpeg:', err);
      });
    }

    if (child.stderr) {
      if (args.redirectFfmpegOutput) {
        child.stderr.pipe(process.stderr);
      } else {
        child.stderr.resume();
      }
    }

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
    if (this.icecastClient) {
      this.icecastClient.close();
      this.icecastClient = null;
    }
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
  }
}

module.exports = FFMPEG;
