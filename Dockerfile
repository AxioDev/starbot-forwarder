# Étape 1 : Base officielle avec Node.js 20
FROM node:20-slim

# Étape 2 : Installation des dépendances système
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Étape 3 : Création du dossier de l'application
WORKDIR /app

# Étape 4 : Copie des fichiers
COPY package*.json ./

# Étape 5 : Installation des dépendances Node.js (modules natifs inclus)
RUN npm install

# Étape 6 : Copie du code source
COPY . .

# Étape 7 : Commande de lancement
CMD ["node", "index.js"]
