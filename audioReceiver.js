const prism = require('prism-media');

class AudioReceiver {
  /**
   * @param {FFMPEG} ffmpegInstance
   * @param {number} inputSampleRate  le sample-rate des paquets Opus (toujours 48000)
   */
  constructor(ffmpegInstance, inputSampleRate, logger) {
    this.ffmpeg = ffmpegInstance;
    this.logger = logger;
    // Transform stream pour passer de Opus → PCM s16le@48kHz stéréo
    this.decoder = new prism.opus.Decoder({ channels: 2, rate: inputSampleRate, frameSize: 960 });
    this.decoder.on('data', chunk => {
      this.ffmpeg.giveAudio(chunk);
    });

    this.decoder.on('error', err => {
        this.logger.error('Opus decoder error:', err);
      });
  }

  /**
   * Branche un flux Opus du receiver Discord sur le décodeur.
   * @param {ReadableStream<Buffer>} opusStream
   */
  handleOpusStream(opusStream) {
    opusStream.pipe(this.decoder, { end: false });
  }

  
}

module.exports = AudioReceiver;
