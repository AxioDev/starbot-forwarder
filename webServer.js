const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const { PassThrough } = require('stream');

/** @typedef {import('./forwarder')} Forwarder */

/**
 * Démarre le serveur web (interface + API) permettant d'envoyer de l'audio au bot.
 * @param {Forwarder} forwarder
 * @param {number} port
 * @param {import('winston').Logger} logger
 * @param {{ enableWebClient?: boolean, transcriptionStore?: import('./transcriptionStore').TranscriptionStore|null }} [options]
 */
function startWebServer(forwarder, port, logger, options = {}) {
  const { enableWebClient = false, transcriptionStore = null } = options;
  let currentForwarder = forwarder;

  const app = express();

  const parseLimit = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(parsed, 200);
  };

  const formatRows = rows => rows.map(item => ({
    userId: item.userId,
    guildId: item.guildId,
    channelId: item.channelId,
    transcript: item.transcript,
    confidence: item.confidence,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : new Date(item.createdAt).toISOString()
  }));

  app.get('/api/voice-users', (req, res) => {
    if (!currentForwarder || typeof currentForwarder.getConnectedUsers !== 'function') {
      return res.status(503).json({ error: 'Le forwarder n\'est pas prêt.' });
    }
    try {
      const users = currentForwarder.getConnectedUsers();
      res.json(users);
    } catch (err) {
      logger.error(`❌ [API] Impossible de récupérer les utilisateurs vocaux: ${err.message}`);
      res.status(500).json({ error: 'Erreur interne lors de la récupération des utilisateurs vocaux.' });
    }
  });

  app.get('/api/transcriptions', async (req, res) => {
    if (!transcriptionStore) {
      return res.status(503).json({ error: 'Le stockage des transcriptions est désactivé.' });
    }
    try {
      const limit = parseLimit(req.query.limit);
      const items = await transcriptionStore.getLatest(limit);
      res.json(formatRows(items));
    } catch (err) {
      logger.error(`❌ [API] Impossible de récupérer les transcriptions: ${err.message}`);
      res.status(500).json({ error: 'Erreur interne lors de la récupération des transcriptions.' });
    }
  });

  app.get('/api/transcriptions/:userId', async (req, res) => {
    if (!transcriptionStore) {
      return res.status(503).json({ error: 'Le stockage des transcriptions est désactivé.' });
    }
    try {
      const limit = parseLimit(req.query.limit);
      const items = await transcriptionStore.getLatestForUser(req.params.userId, limit);
      res.json(formatRows(items));
    } catch (err) {
      logger.error(`❌ [API] Impossible de récupérer les transcriptions pour ${req.params.userId}: ${err.message}`);
      res.status(500).json({ error: 'Erreur interne lors de la récupération des transcriptions.' });
    }
  });

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
