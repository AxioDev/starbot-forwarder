#!/usr/bin/env node
const { program } = require('commander');
require('dotenv').config();
const winston = require('winston');
const http = require('http');
const https = require('https');
const Forwarder = require('./forwarder');
const getVersion = require('./version');
const startWebServer = require('./webServer');
const { createTranscriptionStore } = require('./transcriptionStore');

const envFlag = value => typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

program
    .name('node index.js')
    .description('Starbot Forwarder - un bot Discord pour forwarder l’audio d’un canal vocal.')
    .version(getVersion(), '-V, --version', 'affiche la version')
    .requiredOption('-t, --token <token>', 'Le token du bot Discord', process.env.TOKEN)
    .requiredOption('-c, --channel-id <id>', 'L’ID du canal vocal à rejoindre', process.env.CHANNEL_ID)
    .option('-r, --sample-rate <rate>', 'Sample rate de sortie (défaut 44100)', '44100')
    .option('-x, --compression-level <level>', 'Niveau de compression (défaut 0)', '0')
    .option('--min-bitrate <kbit>', 'Bitrate minimal pour l\'encodage MP3 en kb/s (défaut 1)')
    .option('-d, --redirect-ffmpeg-output', 'Afficher la sortie de ffmpeg dans la console')
    .option('-l, --listening-to <text>', 'Activité “Listening to” (défaut “you.”)', 'you.')
    .option('-v, --volume <multiplier>', 'Multiplicateur de volume (défaut 3)', process.env.VOLUME || '3')
    .option('--railway-token <token>', 'Token API Railway', process.env.RAILWAY_TOKEN)
    .option('--railway-project <id>', 'ID du projet Railway', process.env.RAILWAY_PROJECT_ID)
    .option('--railway-environment <id>', 'ID de l\'environnement Railway', process.env.RAILWAY_ENVIRONMENT_ID)
    .option('--railway-service <id>', 'ID du service Railway', process.env.RAILWAY_SERVICE_ID)
    .option('--web', 'Expose une page web pour parler', process.env.WEB === 'true')
    .option('--web-port <port>', 'Port du serveur web (défaut 3000)', process.env.WEB_PORT || '3000')
    .option('--kaldi-ws <url>', 'URL du serveur Kaldi WebSocket (défaut ws://kaldiws.internal:2700/client/ws/speech)')
    .option('--kaldi-sample-rate <hz>', 'Sample rate à envoyer à Kaldi (défaut 16000)')
    .option('--kaldi-language <lang>', 'Langue à annoncer au serveur Kaldi (défaut fr-FR)')
    .option('--kaldi-disable', 'Désactive la retranscription Kaldi')
    .option('--pg-url <url>', 'URL de connexion Postgres', process.env.POSTGRES_URL || process.env.DATABASE_URL)
    .option('--pg-ssl', 'Active SSL pour la connexion Postgres')
    .option('--no-api', 'Désactive l\'API HTTP')
    .argument('[icecastUrl]', 'URL Icecast de destination')
    .argument('[fileOutput]', 'Chemin de fichier local en alternative')
    .parse(process.argv);

const opts = program.opts();
const kaldiDisabled = opts.kaldiDisable || process.env.KALDI_DISABLE === 'true';
const kaldiWsUrl = kaldiDisabled ? null : (opts.kaldiWs || process.env.KALDI_WS_URL || 'ws://kaldiws.internal:2700/client/ws/speech');
let kaldiSampleRate = parseInt(opts.kaldiSampleRate || process.env.KALDI_SAMPLE_RATE || '16000', 10);
if (!Number.isFinite(kaldiSampleRate) || kaldiSampleRate <= 0) {
    kaldiSampleRate = 16000;
}
const kaldiLanguage = opts.kaldiLanguage || process.env.KALDI_LANGUAGE || 'fr-FR';
const pgUrl = opts.pgUrl || process.env.POSTGRES_URL || process.env.DATABASE_URL;
const pgSsl = Boolean(opts.pgSsl || envFlag(process.env.POSTGRES_SSL) || envFlag(process.env.PGSSL) || envFlag(process.env.PG_SSL));
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
    minBitrate: opts.minBitrate ? parseInt(opts.minBitrate, 10) : 1,
    volume: parseFloat(opts.volume),
    redirectFfmpegOutput: !!opts.redirectFfmpegOutput,
    listeningTo: opts.listeningTo,
    web: opts.web,
    webPort: parseInt(opts.webPort, 10),
    api: opts.api !== false,
    kaldi: kaldiWsUrl ? {
        wsUrl: kaldiWsUrl,
        sampleRate: kaldiSampleRate,
        language: kaldiLanguage
    } : null,
    transcriptionStore: null,
    outputGroup: {
        icecastUrl,
        path: fileOutput || null
    },
    railway: {
        token: opts.railwayToken,
        project: opts.railwayProject,
        environment: opts.railwayEnvironment,
        service: opts.railwayService
    }
};

let forwarder;
let webServerController = null;

function ensureWebServer() {
    if (!webServerController && (args.api || args.web || args.transcriptionStore)) {
        webServerController = startWebServer(forwarder, args.webPort, logger, {
            enableWebClient: args.web,
            transcriptionStore: args.transcriptionStore || null,
            enableVoiceApi: args.api
        });
    } else if (webServerController) {
        webServerController.updateForwarder(forwarder);
    }
}

function startForwarder() {
    forwarder = new Forwarder(args, logger);
    logger.info('Forwarder démarré. CTRL-C pour quitter.');
    ensureWebServer();
}

function restartForwarder() {
    logger.warn('Redémarrage du forwarder…');
    if (forwarder) forwarder.close();
    startForwarder();
}

async function triggerRailwayRestart(cfg) {
    if (!cfg.token || !cfg.project || !cfg.environment || !cfg.service) return;
    try {
        const query = {
            query: `query deployments($input: DeploymentsInput!) { deployments(first: 1, input: $input) { edges { node { id } } } }`,
            variables: { input: { projectId: cfg.project, environmentId: cfg.environment, serviceId: cfg.service } }
        };
        let res = await fetch('https://backboard.railway.com/graphql/v2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.token}`
            },
            body: JSON.stringify(query)
        });
        const data = await res.json();
        const deploymentId = data?.data?.deployments?.edges?.[0]?.node?.id;
        if (!deploymentId) {
            logger.error('Railway: aucun déploiement actif trouvé');
            return;
        }
        const mutation = { query: `mutation { deploymentRestart(id: "${deploymentId}") }` };
        res = await fetch('https://backboard.railway.com/graphql/v2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.token}`
            },
            body: JSON.stringify(mutation)
        });
        logger.info(`Railway restart status ${res.status}`);
    } catch (err) {
        logger.error(`Railway API error: ${err.message}`);
    }
}

function checkStream(url) {
    return new Promise(resolve => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request({ method: 'HEAD', hostname: u.hostname, path: u.pathname, port: u.port }, res => {
            resolve(res.statusCode);
            res.resume();
        });
        req.on('error', () => resolve(-1));
        req.end();
    });
}

async function main() {
    if (pgUrl) {
        try {
            const storeOptions = { connectionString: pgUrl };
            if (pgSsl) {
                storeOptions.ssl = { rejectUnauthorized: false };
            }
            args.transcriptionStore = await createTranscriptionStore(storeOptions, logger);
        } catch (err) {
            logger.error(`❌ Impossible d'initialiser Postgres: ${err.message}`);
        }
    } else {
        logger.warn('⚠️ Aucune base Postgres configurée : les transcriptions ne seront pas stockées.');
    }
    startForwarder();
}

main().catch(err => {
    logger.error(`❌ Erreur fatale lors du démarrage: ${err.message}`);
    process.exit(1);
});

process.on('SIGINT', () => {
    logger.info('Arrêt en cours…');
    if (forwarder) forwarder.close();
    const tasks = [];
    if (webServerController) {
        tasks.push(webServerController.close().catch(err => {
            logger.error(`❌ Erreur lors de l'arrêt du serveur web: ${err.message}`);
        }));
    }
    if (args.transcriptionStore) {
        tasks.push(args.transcriptionStore.close().catch(err => {
            logger.error(`❌ Erreur lors de la fermeture de Postgres: ${err.message}`);
        }));
    }
    Promise.all(tasks).finally(() => process.exit(0));
});

setInterval(async () => {
    if (!args.outputGroup.icecastUrl) return;
    const url = args.outputGroup.icecastUrl.replace(/^icecast\+/, '');
    const status = await checkStream(url);
    if (status === 404) {
        logger.warn('Stream inaccessible (404). Redémarrage.');
        restartForwarder();
        triggerRailwayRestart(args.railway);
    }
}, 60000);
