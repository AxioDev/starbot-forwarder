# Starbot Forwarder


Si ces valeurs ne sont pas passées sur la ligne de commande, le programme
essaiera de les lire depuis un fichier `.env` placé à la racine :

```
TOKEN=VOTRE_TOKEN
CHANNEL_ID=ID_DU_VOCAL
ICECAST_URL=icecast+http://source:motdepasse@example.com/stream
```

Ce bot Discord permet de recevoir l'audio d'un salon vocal et de le transmettre vers un serveur Icecast. Plusieurs utilisateurs peuvent parler en même temps : l'audio est mixé automatiquement.


## Utilisation

```bash
node index.js -t <token> -c <id_du_vocal> <url_icecast>
```

L'URL Icecast doit utiliser le protocole `icecast+http` ou `icecast+https` afin que ffmpeg établisse correctement la connexion. Exemple :

```
node index.js -t TOKEN -c CHANNEL_ID icecast+https://source:motdepasse@example.com/stream
```

Si l'URL commence uniquement par `http://` ou `https://`, le programme ajoutera automatiquement le préfixe `icecast+`.


Par défaut, l'encodage MP3 se fait en 44.1 kHz. Si votre serveur Icecast ou votre lecteur nécessite un autre taux d'échantillonnage, utilisez l'option `--sample-rate` :

```bash
node index.js -t TOKEN -c CHANNEL_ID --sample-rate 44100 icecast+http://source:motdepasse@example.com/stream
```
