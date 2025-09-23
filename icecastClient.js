const { EventEmitter } = require('events');
const http = require('http');
const https = require('https');

class IcecastClient extends EventEmitter {
  /**
   * @param {string} url Icecast URL
   * @param {import('winston').Logger} logger
   * @param {object} [options]
   * @param {number} [options.maxBufferBytes]
   * @param {number} [options.baseDelayMs]
   * @param {number} [options.maxDelayMs]
   * @param {Record<string, string>} [options.headers]
   */
  constructor(url, logger, options = {}) {
    super();
    this.logger = logger;
    this.options = options;
    this.maxBufferBytes = options.maxBufferBytes ?? 1024 * 1024;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.currentDelayMs = this.baseDelayMs;

    this.rawUrl = url;
    this.queue = [];
    this.queueSize = 0;
    this.waitingDrain = false;
    this.destroyed = false;
    this.request = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.safeUrl = null;

    this.httpOptions = this.parseUrl(url, options.headers);

    this.connect();
  }

  /**
   * @param {string} rawUrl
   * @param {Record<string,string>} [extraHeaders]
   */
  parseUrl(rawUrl, extraHeaders = {}) {
    if (!rawUrl) {
      throw new Error('Icecast URL manquante');
    }

    let normalized = rawUrl.trim();
    if (!normalized) {
      throw new Error('Icecast URL vide');
    }

    if (normalized.startsWith('icecast+')) {
      normalized = normalized.replace(/^icecast\+/, '');
    } else if (normalized.startsWith('icecast://')) {
      normalized = 'http://' + normalized.slice('icecast://'.length);
    }

    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'http://' + normalized;
    }

    const url = new URL(normalized);

    const protocol = url.protocol === 'https:' ? https : http;
    const isSecure = url.protocol === 'https:';

    const username = decodeURIComponent(url.username || 'source');
    const password = decodeURIComponent(url.password || '');
    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    this.safeUrl = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;

    url.username = '';
    url.password = '';

    const defaultHeaders = {
      Authorization: `Basic ${auth}`,
      'User-Agent': 'Starbot Forwarder',
      'Content-Type': 'audio/mpeg',
      'Ice-Public': '0',
      'Ice-Name': 'Starbot Forwarder',
      Connection: 'keep-alive'
    };

    const headers = { ...defaultHeaders, ...extraHeaders };

    return {
      httpModule: protocol,
      isSecure,
      options: {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (isSecure ? 443 : 80),
        path: `${url.pathname || '/'}${url.search || ''}`,
        method: 'SOURCE',
        headers
      }
    };
  }

  connect() {
    if (this.destroyed) {
      return;
    }

    if (this.request) {
      try { this.request.destroy(); } catch (err) { this.logger.debug('Erreur lors de la destruction de la requête Icecast existante:', err); }
      this.request = null;
    }

    const { httpModule, options } = this.httpOptions;

    this.logger.info(`🔗 Connexion à Icecast ${this.safeUrl}…`);

    const req = httpModule.request(options);
    req.setTimeout(30000);
    this.request = req;
    this.connected = false;
    this.waitingDrain = false;

    req.on('response', res => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        this.logger.info(`✅ Icecast connecté (statut ${res.statusCode}).`);
        this.onReady();
        res.on('data', () => {});
      } else {
        const status = res.statusCode ?? 'inconnu';
        this.logger.error(`❌ Icecast a refusé la connexion (statut ${status}).`);
        res.resume();
        req.destroy(new Error(`Statut Icecast ${status}`));
      }
    });

    req.on('error', err => {
      if (this.destroyed) return;
      this.logger.error(`❌ Erreur Icecast: ${err.message}`);
    });

    req.on('close', () => {
      if (this.destroyed) return;
      if (this.connected) {
        this.logger.warn('📴 Connexion Icecast fermée.');
      }
      this.connected = false;
      this.waitingDrain = false;
      this.scheduleReconnect();
    });

    req.on('timeout', () => {
      if (this.destroyed) return;
      this.logger.warn('⏱️ Timeout Icecast, reconnexion…');
      req.destroy(new Error('timeout'));
    });

    req.on('socket', socket => {
      socket.setKeepAlive(true);
      socket.setNoDelay(true);

      const flush = () => {
        if (this.destroyed) return;
        try {
          req.flushHeaders();
        } catch (err) {
          this.logger.debug('flushHeaders error:', err.message);
        }
      };

      if (this.httpOptions.isSecure && typeof socket.once === 'function') {
        socket.once('secureConnect', flush);
      } else if (socket.connecting && typeof socket.once === 'function') {
        socket.once('connect', flush);
      } else {
        flush();
      }
    });
  }

  onReady() {
    if (this.destroyed) return;
    this.connected = true;
    this.waitingDrain = false;
    this.currentDelayMs = this.baseDelayMs;
    this.flushQueue();
  }

  scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;

    const delay = this.currentDelayMs;
    this.logger.warn(`🔁 Nouvelle tentative Icecast dans ${Math.round(delay / 100) / 10}s…`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);

    this.currentDelayMs = Math.min(this.currentDelayMs * 2, this.maxDelayMs);
  }

  /**
   * @param {Buffer} chunk
   */
  write(chunk) {
    if (this.destroyed || !chunk || chunk.length === 0) {
      return false;
    }

    if (this.connected && this.request && !this.waitingDrain) {
      try {
        const ok = this.request.write(chunk);
        if (!ok) {
          this.waitingDrain = true;
          this.request.once('drain', () => {
            this.waitingDrain = false;
            this.flushQueue();
          });
        }
        return ok;
      } catch (err) {
        this.logger.warn(`⚠️ Écriture Icecast impossible: ${err.message}`);
        this.enqueue(chunk);
        if (this.request) {
          try { this.request.destroy(); } catch {}
        }
        return false;
      }
    }

    this.enqueue(chunk);
    return true;
  }

  enqueue(chunk) {
    if (!chunk || chunk.length === 0) return;
    this.queue.push(chunk);
    this.queueSize += chunk.length;

    if (this.queueSize > this.maxBufferBytes) {
      let removed = 0;
      while (this.queueSize > this.maxBufferBytes && this.queue.length > 0) {
        const dropped = this.queue.shift();
        removed += dropped.length;
        this.queueSize -= dropped.length;
      }
      if (removed > 0) {
        this.logger.warn(`⚠️ Tampon Icecast saturé, ${Math.round(removed / 1024)} kB abandonnés.`);
      }
    }
  }

  flushQueue() {
    if (!this.connected || !this.request || this.waitingDrain) {
      return;
    }

    while (this.queue.length > 0) {
      const chunk = this.queue.shift();
      this.queueSize -= chunk.length;
      try {
        const ok = this.request.write(chunk);
        if (!ok) {
          this.waitingDrain = true;
          this.request.once('drain', () => {
            this.waitingDrain = false;
            this.flushQueue();
          });
          break;
        }
      } catch (err) {
        this.logger.warn(`⚠️ Impossible d\'envoyer un chunk Icecast: ${err.message}`);
        this.enqueue(chunk);
        if (this.request) {
          try { this.request.destroy(); } catch {}
        }
        break;
      }
    }
  }

  close() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.request) {
      try { this.request.destroy(); } catch {}
      this.request = null;
    }
    this.queue = [];
    this.queueSize = 0;
  }
}

module.exports = IcecastClient;
