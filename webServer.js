const express = require('express');
const { WebSocketServer } = require('ws');
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

  wss.on('connection', ws => {
    logger.info('Client WebSocket connecté');
    const stream = new PassThrough();
    forwarder.playStream(stream);

    ws.on('message', data => {
      if (Buffer.isBuffer(data)) stream.write(data);
    });
    ws.on('close', () => stream.end());
  });
}

module.exports = startWebServer;
