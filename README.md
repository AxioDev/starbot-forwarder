
This Discord bot captures audio from a voice channel and forwards it to an Icecast server. Multiple users can speak at the same time: the audio is automatically mixed.

## Usage

```bash
node index.js -t <token> -c <voice_channel_id> <icecast_url>
```

The Icecast URL must use the `icecast+http` or `icecast+https` protocol so that ffmpeg can properly establish the connection. Example:

```
node index.js --token YOUR_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```

If the URL only starts with `http://` or `https://`, the program will automatically add the `icecast+` prefix.

By default, MP3 encoding is done at 44.1 kHz. If your Icecast server or player requires a different sample rate, use the `--sample-rate` option:

```bash
node index.js --token YOUR_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@example.org:8000/stream
```
