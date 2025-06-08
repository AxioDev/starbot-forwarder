const prism = require('prism-media');

class AudioReceiver {
  /**
   * @param {FFMPEG} ffmpegInstance
   * @param {number} inputSampleRate
   * @param {import('winston').Logger} logger
   */
  constructor(ffmpegInstance, inputSampleRate, logger) {
    this.ffmpeg = ffmpegInstance;
    this.logger = logger;

    // Transform stream pour passer de Opus → PCM s16le@48kHz stéréo
    this.decoder = new prism.opus.Decoder({ channels: 2, rate: inputSampleRate, frameSize: 960 });

    // À chaque data PCM, on forward à ffmpeg
    this.decoder.on('data', chunk => {
      this.ffmpeg.giveAudio(chunk);
    });

    // Handler d’erreur sur le décodeur
    this.decoder.on('error', err => {
      this.logger.error('Opus decoder error:', err);
    });
  }

  /**
   * Branche un flux Opus du receiver Discord sur le décodeur.
   * @param {ReadableStream<Buffer>} opusStream
   */
  handleOpusStream(opusStream) {
    // Aussi catcher les erreurs sur le stream Opus
    opusStream.on('error', err => {
      this.logger.error('Opus stream error:', err);
    });

    opusStream.pipe(this.decoder, { end: false });
  }
}

module.exports = AudioReceiver;
