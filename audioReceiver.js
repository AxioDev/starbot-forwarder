const prism = require('prism-media');
const AudioMixer = require('audio-mixer');

class AudioReceiver {
  /**
   * @param {FFMPEG} ffmpegInstance
   * @param {number} inputSampleRate
   * @param {import('winston').Logger} logger
   */
  constructor(ffmpegInstance, inputSampleRate, logger) {
    this.ffmpeg = ffmpegInstance;
    this.logger = logger;
    this.inputSampleRate = inputSampleRate;

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

    // Input de silence pour garder le flux actif
    this.silenceInput = this.mixer.input({ channels: 2, clearInterval: 250 });
    const frameDurationMs = 20;
    const samples = this.inputSampleRate * frameDurationMs / 1000;
    this.silenceChunk = Buffer.alloc(samples * 2 * 2); // 16-bit stereo
    this.silenceInterval = setInterval(() => {
      this.silenceInput.write(this.silenceChunk);
    }, frameDurationMs);

  }

  /**
   * Branche un flux Opus du receiver Discord sur le décodeur.
   * @param {ReadableStream<Buffer>} opusStream
   */
  handleOpusStream(opusStream, userId) {
    const decoder = new prism.opus.Decoder({ channels: 2, rate: this.inputSampleRate, frameSize: 960 });
    const input = this.mixer.input({ channels: 2 });

    decoder.on('data', chunk => input.write(chunk));
    decoder.on('error', err => this.logger.error('Opus decoder error:', err));
    opusStream.pipe(decoder);

    opusStream.once('end', () => {
      this.mixer.removeInput(input);
      input.destroy();
      decoder.destroy();
      this.inputs.delete(userId);
    });

    this.inputs.set(userId, { decoder, input });

  }

  /** Stoppe le générateur de silence et nettoie le mixer */
  close() {
    clearInterval(this.silenceInterval);
    this.mixer.removeInput(this.silenceInput);
    this.silenceInput.destroy();
  }
}

module.exports = AudioReceiver;
