#!/usr/bin/env node
const { program } = require('commander');
require('dotenv').config();
const winston = require('winston');
const Forwarder = require('./forwarder');
const getVersion = require('./version');

program
    .name('node index.js')
    .description('Starbot Forwarder - un bot Discord pour forwarder l’audio d’un canal vocal.')
    .version(getVersion(), '-V, --version', 'affiche la version')
    .requiredOption('-t, --token <token>', 'Le token du bot Discord', process.env.TOKEN)
    .requiredOption('-c, --channel-id <id>', 'L’ID du canal vocal à rejoindre', process.env.CHANNEL_ID)
    .option('-r, --sample-rate <rate>', 'Sample rate de sortie (défaut 44100)', '44100')
    .option('-x, --compression-level <level>', 'Niveau de compression (défaut 0)', '0')
    .option('-d, --redirect-ffmpeg-output', 'Afficher stdout de ffmpeg')
    .option('-l, --listening-to <text>', 'Activité “Listening to” (défaut “you.”)', 'you.')
    .argument('[icecastUrl]', 'URL Icecast de destination')
    .argument('[fileOutput]', 'Chemin de fichier local en alternative')
    .parse(process.argv);

const opts = program.opts();
let [icecastUrl, fileOutput] = program.args;
if (!icecastUrl) {
    icecastUrl = process.env.ICECAST_URL;
}
if (!icecastUrl) {
    console.error("Aucune URL Icecast fournie via argument ou .env");
    process.exit(1);
}

// Logger Winston
const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console({ format: winston.format.simple() })]
});

const args = {
    token: opts.token,
    channelId: opts.channelId,
    sampleRate: parseInt(opts.sampleRate, 10),
    compressionLevel: parseInt(opts.compressionLevel, 10),
    redirectFfmpegOutput: !!opts.redirectFfmpegOutput,
    listeningTo: opts.listeningTo,
    outputGroup: {
        icecastUrl,
        path: fileOutput || null
    }
};

(async () => {
    try {
        const forwarder = new Forwarder(args, logger);
        logger.info('Forwarder démarré. CTRL-C pour quitter.');
        process.on('SIGINT', () => {
            logger.info('Arrêt en cours…');
            forwarder.close();
            process.exit(0);
        });
    } catch (e) {
        logger.error('Erreur au démarrage :', e);
        process.exit(1);
    }
})();
