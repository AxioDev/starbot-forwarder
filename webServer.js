const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const { PassThrough } = require('stream');

/**
 * Démarre le serveur web permettant d'envoyer de l'audio au bot.
 * @param {Forwarder} forwarder
 * @param {number} port
 * @param {import('winston').Logger} logger
 */
function startWebServer(forwarder, port, logger) {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  const server = app.listen(port, () => logger.info(`Serveur web sur le port ${port}`));
  const wss = new WebSocketServer({ server });

  const statusClients = new Set();
  const activeSpeakers = new Map();

  if (forwarder && typeof forwarder.on === 'function') {
    forwarder.on('speakingStart', speaker => {
      if (!speaker || typeof speaker.id !== 'string') {
        return;
      }
      activeSpeakers.set(speaker.id, {
        id: speaker.id,
        displayName: speaker.displayName,
        avatarUrl: speaker.avatarUrl,
        startedAt: typeof speaker.startedAt === 'number' ? speaker.startedAt : Date.now()
      });
      broadcastSpeakers();
    });

    forwarder.on('speakingStop', payload => {
      const speakerId = payload && typeof payload.id === 'string' ? payload.id : payload && typeof payload.userId === 'string' ? payload.userId : undefined;
      if (!speakerId) {
        return;
      }
      if (activeSpeakers.delete(speakerId)) {
        broadcastSpeakers();
      }
    });
  }

  function broadcastSpeakers() {
    if (statusClients.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      type: 'speakers',
      speakers: Array.from(activeSpeakers.values())
    });

    for (const client of statusClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          logger.warn(`Impossible d'envoyer la liste des orateurs : ${error.message}`);
          statusClients.delete(client);
          try { client.close(); } catch (closeError) {
            logger.debug(`Fermeture d'un client statut échouée : ${closeError.message}`);
          }
        }
      } else if (client.readyState === WebSocket.CLOSING || client.readyState === WebSocket.CLOSED) {
        statusClients.delete(client);
      }
    }
  }

  function registerStatusClient(ws) {
    statusClients.add(ws);
    ws.on('close', () => statusClients.delete(ws));
    ws.on('error', () => statusClients.delete(ws));

    try {
      ws.send(JSON.stringify({
        type: 'speakers',
        speakers: Array.from(activeSpeakers.values())
      }));
    } catch (error) {
      logger.warn(`Impossible d'envoyer l'état initial des orateurs : ${error.message}`);
    }
  }

  wss.on('connection', (ws, request) => {
    const mode = extractMode(request);
    if (mode === 'status') {
      registerStatusClient(ws);
      return;
    }

    if (!forwarder || typeof forwarder.playStream !== 'function') {
      logger.warn('Client WebSocket rejeté : forwarder indisponible');
      ws.close(1013, 'Forwarder not ready');
      return;
    }

    logger.info('Client WebSocket connecté');
    const stream = new PassThrough();
    forwarder.playStream(stream);

    ws.on('message', data => {
      if (Buffer.isBuffer(data)) stream.write(data);
    });
    ws.on('close', () => stream.end());
    ws.on('error', () => stream.end());
  });

  function extractMode(request) {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      return url.searchParams.get('mode') || 'upload';
    } catch (error) {
      logger.warn(`Impossible d'interpréter l'URL WebSocket : ${error.message}`);
      return 'upload';
    }
  }
}

module.exports = startWebServer;
