
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

