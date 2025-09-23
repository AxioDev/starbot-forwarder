const { spawn } = require('child_process');
const EventEmitter = require('events');
const { PassThrough } = require('stream');

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
    this.stderrBuffer = '';

    // Persistent audio stream so that we can reconnect ffmpeg without losing
    // the upstream writes from the mixer. A PassThrough handles backpressure
    // and buffers a little data while a new ffmpeg instance restarts.
    this.audioStream = new PassThrough({ highWaterMark: 1024 * 256 });

    this.spawnProcess();
  }

  spawnProcess() {
    const args = this.args;
    this.stderrBuffer = '';

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
        'pipe'
      ]
    });

    this.process = child;

    child.once('spawn', () => {
      this.logger.info('ffmpeg (re)démarré et connecté au pipeline audio.');
    });

    // Connect the persistent PassThrough to the fresh ffmpeg stdin.
    this.audioStream.pipe(child.stdin, { end: false });

    // 1) Éviter le crash sur EPIPE
    child.stdin.on('error', err => {
      if (err.code === 'EPIPE') {
        this.logger.warn('ffmpeg stdin: broken pipe (EPIPE), on ignore.');
      } else {
        this.logger.error('ffmpeg stdin error:', err);
      }
    });

    // 2) Intercepter la sortie erreur pour masquer les messages bruyants
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => this.handleStderr(chunk));
      child.stderr.on('close', () => {
        if (this.stderrBuffer) {
          this.handleStderr('\n');
        }
        this.stderrBuffer = '';
      });
    }

    // 3) Log quand ffmpeg se ferme et redémarrer si nécessaire
    child.on('close', (code, signal) => {
      if (this.process === child) {
        try { this.audioStream.unpipe(child.stdin); } catch {}
        this.process = null;
      }
      this.logger.warn(`ffmpeg process closed (code=${code}, signal=${signal})`);
      if (this.keepRunning) {
        setTimeout(() => this.spawnProcess(), 1000);
      }
    });

    // 4) Rethrow sur échec de spawn
    child.on('error', err => {
      this.logger.error('Erreur lors du démarrage de ffmpeg:', err);
      throw err;
    });
  }

  handleStderr(chunk) {
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/broken pipe/i.test(trimmed)) {
        this.logger.warn('ffmpeg a perdu la connexion avec Icecast (broken pipe). Reconnexion automatique…');
        continue;
      }

      if (/av_interleaved_write_frame/i.test(trimmed)) {
        this.logger.warn('ffmpeg ne parvient plus à écrire vers Icecast, tentative de reconnexion…');
        continue;
      }

      if (/Conversion failed/i.test(trimmed)) {
        this.logger.warn('ffmpeg signale une erreur de conversion. Un redémarrage automatique est en cours.');
        continue;
      }

      if (this.args.redirectFfmpegOutput) {
        process.stderr.write(`${line}\n`);
      } else {
        this.logger.debug(`[ffmpeg] ${trimmed}`);
      }
    }
  }

  /**
   * Envoie des données PCM à ffmpeg
   * @param {Buffer} buffer
   */
  giveAudio(buffer) {
    const ok = this.audioStream.write(buffer);
    if (!ok) {
      this.logger.debug('ffmpeg stdin buffer plein (backpressure)');
    }
  }

  /** Ferme proprement ffmpeg et stoppe le redémarrage auto */
  close() {
    this.keepRunning = false;
    if (this.process) {
      this.process.removeAllListeners('close');
      try { this.audioStream.unpipe(this.process.stdin); } catch {}
      try { this.process.stdin.end(); } catch {}
      try { this.process.kill('SIGTERM'); } catch {}
      this.process = null;
    }
    this.audioStream.end();
  }
}

module.exports = FFMPEG;
