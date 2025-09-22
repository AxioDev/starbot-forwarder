const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const { PassThrough } = require('stream');

/** @typedef {import('./forwarder')} Forwarder */

/**
 * Démarre le serveur web permettant d'envoyer de l'audio au bot.
 * @param {Forwarder} forwarder
 * @param {number} port
 * @param {import('winston').Logger} logger
 * @param {{ enableWebClient?: boolean }} [options]
 */
function startWebServer(forwarder, port, logger, options = {}) {
  const { enableWebClient = false } = options;
  let currentForwarder = forwarder;

  const app = express();

  if (enableWebClient) {
    app.use(express.static(path.join(__dirname, 'public')));
  }

  const server = app.listen(port, () => logger.info(`Serveur web sur le port ${port}`));
  let wss = null;

  if (enableWebClient) {
    wss = new WebSocketServer({ server });

    wss.on('connection', ws => {
      logger.info('Client WebSocket connecté');
      const stream = new PassThrough();
      if (currentForwarder && typeof currentForwarder.playStream === 'function') {
        currentForwarder.playStream(stream);
      } else {
        logger.warn('⚠️ Aucun forwarder actif pour relayer le flux WebSocket.');
      }

      ws.on('message', data => {
        if (Buffer.isBuffer(data)) stream.write(data);
      });
      ws.on('close', () => stream.end());
      ws.on('error', err => logger.error(`❌ [WebSocket] Erreur client: ${err.message}`));
    });
  }

  return {
    updateForwarder(nextForwarder) {
      currentForwarder = nextForwarder;
    },
    async close() {
      if (wss) {
        for (const client of wss.clients) {
          try { client.terminate(); } catch (_) {}
        }
        await new Promise(resolve => wss.close(resolve));
      }
      await new Promise(resolve => server.close(resolve));
    }
  };
}

module.exports = startWebServer;
