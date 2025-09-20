const WebSocket = require('ws');

function clamp16(value) {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return value;
}

function downsampleStereo(buffer, inputRate, outputRate) {
  const channels = 2;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Buffer.alloc(0);
  }
  if (!outputRate || outputRate >= inputRate) {
    // Only convert to mono without resampling
    const frameCount = buffer.length / 2 / channels;
    const out = Buffer.alloc(frameCount * 2);
    let offset = 0;
    for (let i = 0; i < frameCount; i++) {
      const baseIndex = i * channels * 2;
      const left = buffer.readInt16LE(baseIndex);
      const right = buffer.readInt16LE(baseIndex + 2);
      const mono = clamp16(Math.round((left + right) / 2));
      out.writeInt16LE(mono, offset);
      offset += 2;
    }
    return out.slice(0, offset);
  }

  const ratio = inputRate / outputRate;
  const frameCount = buffer.length / 2 / channels;
  const outputFrameCount = Math.floor(frameCount / ratio);
  const out = Buffer.alloc(outputFrameCount * 2);
  let offset = 0;

  for (let i = 0; i < outputFrameCount; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), frameCount);
    if (start >= frameCount) break;
    let sum = 0;
    let samples = 0;
    for (let j = start; j < end; j++) {
      const baseIndex = j * channels * 2;
      const left = buffer.readInt16LE(baseIndex);
      const right = buffer.readInt16LE(baseIndex + 2);
      sum += (left + right) / 2;
      samples++;
    }
    if (samples === 0) continue;
    const mono = clamp16(Math.round(sum / samples));
    out.writeInt16LE(mono, offset);
    offset += 2;
  }

  return out.slice(0, offset);
}

class KaldiStream {
  constructor(userId, config, logger, transcriptionStore, metadata = {}) {
    this.userId = userId;
    this.logger = logger;
    this.config = {
      wsUrl: config.wsUrl,
      sampleRate: config.sampleRate || 16000,
      language: config.language
    };
    this.queue = [];
    this.closed = false;
    this.hasSentConfig = false;
    this.transcriptionStore = transcriptionStore || null;
    this.metadata = {
      guildId: metadata?.guildId ?? null,
      channelId: metadata?.channelId ?? null
    };

    this.ws = new WebSocket(this.config.wsUrl, {
      perMessageDeflate: false
    });

    this.ws.on('open', () => {
      this.logger.debug(`🔁 [Kaldi] Connexion ouverte pour ${this.userId}`);
      this.sendConfig();
      this.flushQueue();
    });

    this.ws.on('message', data => {
      this.handleMessage(data);
    });

    this.ws.on('error', err => {
      if (this.closed) return;
      this.logger.error(`❌ [Kaldi] Erreur pour ${this.userId}: ${err.message}`);
    });

    this.ws.on('close', code => {
      this.logger.debug(`🔁 [Kaldi] Connexion fermée pour ${this.userId} (code ${code})`);
    });
  }

  sendConfig() {
    if (this.hasSentConfig) return;
    const payload = { config: { sample_rate: this.config.sampleRate } };
    if (this.config.language) {
      payload.config.language = this.config.language;
    }
    const message = JSON.stringify(payload);
    this.hasSentConfig = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.queue.unshift({ type: 'text', payload: message });
    }
  }

  sendMessage(type, payload) {
    if (this.closed) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      if (type === 'binary') {
        this.ws.send(payload);
      } else {
        this.ws.send(payload);
      }
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.queue.push({ type, payload });
    }
  }

  flushQueue() {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    for (const item of this.queue) {
      if (item.type === 'binary') {
        this.ws.send(item.payload);
      } else {
        this.ws.send(item.payload);
      }
    }
    this.queue = [];
  }

  sendAudio(buffer, inputSampleRate) {
    if (this.closed) return;
    const pcm = downsampleStereo(buffer, inputSampleRate, this.config.sampleRate);
    if (pcm.length === 0) return;
    this.sendMessage('binary', pcm);
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.queue = this.queue.filter(item => item.type === 'text');
    const sendEofAndClose = () => {
      try {
        this.ws.send(JSON.stringify({ eof: 1 }));
      } catch (err) {
        this.logger.warn(`⚠️ [Kaldi] Impossible d'envoyer EOF pour ${this.userId}: ${err.message}`);
      }
      setTimeout(() => {
        try { this.ws.close(); } catch {}
      }, 250);
    };

    if (this.ws.readyState === WebSocket.OPEN) {
      sendEofAndClose();
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.once('open', sendEofAndClose);
      this.ws.once('error', () => {
        try { this.ws.close(); } catch {}
      });
    } else {
      try { this.ws.close(); } catch {}
    }
  }

  handleMessage(data) {
    if (this.closed) return;
    if (typeof data !== 'string') {
      return;
    }
    try {
      const msg = JSON.parse(data);
      let transcript = null;
      let isFinal = false;
      let confidence = null;

      if (typeof msg.text === 'string') {
        transcript = msg.text;
        isFinal = true;
      } else if (typeof msg.partial === 'string') {
        transcript = msg.partial;
      } else if (msg?.result?.hypotheses?.length) {
        const hypothesis = msg.result.hypotheses[0];
        transcript = hypothesis.transcript;
        confidence = typeof hypothesis.confidence === 'number' ? hypothesis.confidence : null;
        isFinal = Boolean(msg.result.final);
      } else {
        return;
      }

      if (typeof transcript !== 'string') {
        return;
      }

      const trimmed = transcript.trim();
      if (!trimmed) {
        return;
      }

      if (isFinal) {
        this.logger.info(`📝 [Kaldi][${this.userId}] ${trimmed}`);
        if (this.transcriptionStore) {
          this.transcriptionStore.saveTranscription(this.userId, trimmed, confidence, this.metadata).catch(err => {
            this.logger.error(`❌ [Kaldi] Échec d'enregistrement de la transcription pour ${this.userId}: ${err.message}`);
          });
        }
      } else {
        this.logger.debug(`🗒️ [Kaldi][${this.userId}] ${trimmed}`);
      }
    } catch (err) {
      this.logger.warn(`⚠️ [Kaldi] Message inattendu pour ${this.userId}: ${err.message}`);
    }
  }

  close() {
    if (this.closed) {
      try { this.ws.close(); } catch {}
      return;
    }
    this.finish();
  }
}

module.exports = KaldiStream;
