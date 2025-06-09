# Starbot Forwarder


Ce bot Discord permet de recevoir l'audio d'un salon vocal et de le transmettre vers un serveur Icecast. Plusieurs utilisateurs peuvent parler en même temps : l'audio est mixé automatiquement.


## Utilisation

```bash
node index.js -t <token> -c <id_du_vocal> <url_icecast>
```

L'URL Icecast doit utiliser le protocole `icecast+http` ou `icecast+https` afin que ffmpeg établisse correctement la connexion. Exemple :

```
node index.js --token VOTRE_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@test.fr:8000/stream
```

Si l'URL commence uniquement par `http://` ou `https://`, le programme ajoutera automatiquement le préfixe `icecast+`.


Par défaut, l'encodage MP3 se fait en 44.1 kHz. Si votre serveur Icecast ou votre lecteur nécessite un autre taux d'échantillonnage, utilisez l'option `--sample-rate` :

```bash
node index.js --token VOTRE_TOKEN --channel-id VOICE_CHANNEL_ID icecast://source:password@test.fr:8000/stream
```
