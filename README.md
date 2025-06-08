# Starbot Forwarder

Ce bot Discord permet de recevoir l'audio d'un salon vocal et de le transmettre vers un serveur Icecast.

## Utilisation

```bash
node index.js -t <token> -c <id_du_vocal> <url_icecast>
```

L'URL Icecast doit utiliser le protocole `icecast+http` ou `icecast+https` afin que ffmpeg établisse correctement la connexion. Exemple :

```
node index.js -t TOKEN -c CHANNEL_ID icecast+https://source:motdepasse@example.com/stream
```

Si l'URL commence uniquement par `http://` ou `https://`, le programme ajoutera automatiquement le préfixe `icecast+`.
