
This Discord bot captures audio from a voice channel and forwards it to an Icecast server. Multiple users can speak at the same time: the audio is automatically mixed. If the bot is kicked from the voice channel, it will reconnect automatically after **30&nbsp;minutes**.

## Usage 

```bash
node index.js -t <token> -c <voice_channel_id> <icecast_url>
```

The Icecast URL must use the `icecast+http` or `icecast+https` protocol so that ffmpeg can properly establish the connection. Example:

```
node index.js --token YOUR_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

### Restart via Railway API

If the stream becomes unreachable, the bot can restart the latest deployment of your Railway service using the public GraphQL API. Provide your API token and the identifiers of the project, environment and service using the corresponding options (or environment variables).

```bash
node index.js \
  --railway-token <token> \
  --railway-project <projectId> \
  --railway-environment <environmentId> \
  --railway-service <serviceId> \
  -t YOUR_TOKEN -c VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

If the URL only starts with `http://` or `https://`, the program will automatically add the `icecast+` prefix.

By default, MP3 encoding is done at 44.1 kHz. If your Icecast server or player requires a different sample rate, use the `--sample-rate` option:

```bash
node index.js --token YOUR_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

The audio volume is boosted to **300%** by default. Use `--volume` (or set
`VOLUME` in your `.env` file) to adjust this multiplier:

```bash
node index.js --volume 1.5 --token YOUR_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

To avoid Icecast closing the connection during silence, a small white-noise bed
is mixed in and a minimal bitrate of **1&nbsp;kbit/s** is enforced by default.
Use `--min-bitrate` to override this value if needed:

```bash
node index.js --min-bitrate 2 --token YOUR_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

## Transcription temps réel via Kaldi

Chaque participant est maintenant retranscrit en temps réel via WebSocket vers un
serveur Kaldi (par défaut `ws://kaldiws.internal:2700/client/ws/speech`). Utilisez les
options suivantes pour personnaliser ou désactiver cette fonctionnalité :

```bash
node index.js --kaldi-ws ws://kaldiws.internal:2700/client/ws/speech \
  --kaldi-sample-rate 16000 \
  --kaldi-language fr-FR \
  -t YOUR_TOKEN -c VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

Ajoutez `--kaldi-disable` (ou la variable d’environnement `KALDI_DISABLE=true`)
si vous ne souhaitez pas transmettre les flux audio vers Kaldi.

### Stockage PostgreSQL des transcriptions

Fournissez une URL de connexion PostgreSQL (`--pg-url` ou la variable d’environnement
`POSTGRES_URL`/`DATABASE_URL`) pour que chaque transcription finale soit enregistrée
avec l’identifiant Discord de l’utilisateur, le texte reconnu et un horodatage précis.
Activez l’option `--pg-ssl` (ou définissez `POSTGRES_SSL=true`) si votre fournisseur
demande une connexion chiffrée. La table `voice_transcriptions` est créée
automatiquement si elle n’existe pas.

Une API REST est exposée sur le même port que l’interface web (ou sur `--web-port` si
vous n’activez pas l’interface). Les endpoints suivants sont disponibles :

- `GET /api/voice-users` renvoie la liste actuelle des utilisateurs connectés au
  salon vocal ciblé, avec leur état micro/casque et l’indication s’ils parlent.
- `GET /api/transcriptions?limit=50` retourne les dernières transcriptions tous
  utilisateurs confondus (limite maximale : 200).
- `GET /api/transcriptions/:userId?limit=50` renvoie les dernières transcriptions
  associées à un utilisateur précis.

L’API est activée par défaut, mais vous pouvez la désactiver avec l’option
`--no-api` si vous ne souhaitez exposer aucune route HTTP.

The white-noise generator in `audioReceiver.js` writes very low-level samples
(amplitude around `±100`). Adjust this constant if you need the noise to be
more or less audible.

## Web voice relay

Use the `--web` option (or set `WEB=true` in your `.env` file) to expose a small web page that captures your microphone and relays it to Discord. The server listens on port 3000 by default. Override it with `--web-port` or the `WEB_PORT` environment variable.

```bash
node index.js --web --web-port 3000 -t YOUR_TOKEN -c VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

Open `http://localhost:3000` in your browser, allow microphone access and start speaking. The page uses [Tailwind CSS](https://tailwindcss.com/) so it should look good on both desktop and mobile.

The interface now has a darker gaming theme and includes an audio player that autoplays the radio stream available at `https://radio.libre-antenne.xyz/stream`. You can listen to this stream while speaking anonymously.
The start and stop buttons now reflect the current state so it is clear when your microphone is live.

