const prism = require('prism-media');
const AudioMixer = require('audio-mixer');
const KaldiStream = require('./kaldiClient');

class AudioReceiver {
  /**
   * @param {FFMPEG} ffmpegInstance
   * @param {number} inputSampleRate
   * @param {import('winston').Logger} logger
   * @param {{ wsUrl: string, sampleRate: number, language?: string }|null} kaldiConfig
   * @param {import('./transcriptionStore').TranscriptionStore|null} transcriptionStore
   * @param {{ guildId?: string|null, channelId?: string|null }} [metadata]
   */
  constructor(ffmpegInstance, inputSampleRate, logger, kaldiConfig, transcriptionStore, metadata = {}) {
    this.ffmpeg = ffmpegInstance;
    this.logger = logger;
    this.inputSampleRate = inputSampleRate;
    this.kaldiConfig = kaldiConfig && kaldiConfig.wsUrl ? kaldiConfig : null;
    this.transcriptionStore = transcriptionStore || null;
    this.metadata = {
      guildId: metadata?.guildId ?? null,
      channelId: metadata?.channelId ?? null
    };

    // Mixer pour combiner les flux de plusieurs utilisateurs
    this.mixer = new AudioMixer.Mixer({
      channels: 2,
      bitDepth: 16,
      sampleRate: this.inputSampleRate,
      clearInterval: 250
    });
    this.mixer.on('data', chunk => {
      this.ffmpeg.giveAudio(chunk);
    });

    this.inputs = new Map();
    this.kaldiStreams = new Map();

    // Input de bruit blanc léger pour garder le flux actif
    this.noiseInput = this.mixer.input({ channels: 2, clearInterval: 250 });
    const frameDurationMs = 20;
    const samples = this.inputSampleRate * frameDurationMs / 1000;
    this.noiseInterval = setInterval(() => {
      const buf = Buffer.alloc(samples * 2 * 2);
      for (let i = 0; i < samples * 2; i++) {
        // White noise amplitude kept low so that it is barely audible.
        // Lowered by a factor of 4 compared to the previous value.
        const val = Math.floor((Math.random() * 2 - 1) * 25);
        buf.writeInt16LE(val, i * 2);
      }
      this.noiseInput.write(buf);
    }, frameDurationMs);

  }

  /**
   * Branche un flux Opus du receiver Discord sur le décodeur.
   * @param {ReadableStream<Buffer>} opusStream
   */
  handleOpusStream(opusStream, userId) {
    if (this.inputs.has(userId)) {
      return;
    }

    const decoder = new prism.opus.Decoder({ channels: 2, rate: this.inputSampleRate, frameSize: 960 });
    const input = this.mixer.input({ channels: 2 });
    let kaldiStream = null;
    if (this.kaldiConfig) {
      try {
        kaldiStream = new KaldiStream(userId, this.kaldiConfig, this.logger, this.transcriptionStore, this.getMetadata());
        this.kaldiStreams.set(userId, kaldiStream);
      } catch (err) {
        this.logger.error(`Kaldi stream creation failed for ${userId}: ${err.message}`);
      }
    }

    decoder.on('data', chunk => {
      input.write(chunk);
      if (kaldiStream) {
        kaldiStream.sendAudio(chunk, this.inputSampleRate);
      }
    });
    decoder.on('error', err => this.logger.error('Opus decoder error:', err));
    opusStream.pipe(decoder);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.mixer.removeInput(input);
      input.destroy();
      decoder.destroy();
      this.inputs.delete(userId);
      if (kaldiStream) {
        kaldiStream.finish();
        this.kaldiStreams.delete(userId);
      }
    };

    opusStream.once('end', cleanup);
    opusStream.once('close', cleanup);
    opusStream.once('error', err => {
      this.logger.error(`Opus stream error for ${userId}: ${err.message || err}`);
      cleanup();
    });

    this.inputs.set(userId, { decoder, input });

  }

  getMetadata() {
    return { ...this.metadata };
  }

  updateContext(guildId, channelId) {
    this.metadata.guildId = guildId ?? null;
    this.metadata.channelId = channelId ?? null;
  }

  /** Stoppe le générateur de bruit et nettoie le mixer */
  close() {
    clearInterval(this.noiseInterval);
    this.mixer.removeInput(this.noiseInput);
    this.noiseInput.destroy();
    for (const stream of this.kaldiStreams.values()) {
      stream.close();
    }
    this.kaldiStreams.clear();
  }
}

module.exports = AudioReceiver;
