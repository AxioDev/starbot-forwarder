const { Pool } = require('pg');

class TranscriptionStore {
  /**
   * @param {import('pg').PoolConfig} config
   * @param {import('winston').Logger} logger
   */
  constructor(config, logger) {
    this.logger = logger;
    this.pool = new Pool(config);
  }

  /**
   * Initialise la table en base de données.
   */
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS voice_transcriptions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT,
        channel_id TEXT,
        content TEXT NOT NULL,
        "timestamp" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * @param {string} userId
   * @param {string} transcript
   * @param {number|undefined} confidence
   * @param {{ guildId?: string|null, channelId?: string|null }} [metadata]
   * @param {Date} [createdAt]
   */
  async saveTranscription(userId, transcript, confidence, metadata = {}, createdAt = new Date()) {
    if (!userId || !transcript) return;
    const guildId = metadata?.guildId ?? null;
    const channelId = metadata?.channelId ?? null;
    await this.pool.query(
      'INSERT INTO voice_transcriptions (user_id, guild_id, channel_id, content, "timestamp") VALUES ($1, $2, $3, $4, $5)',
      [userId, guildId, channelId, transcript, createdAt]
    );
    const parts = [
      `💾 [Transcription] user=${userId}`,
      guildId ? `guild=${guildId}` : null,
      channelId ? `channel=${channelId}` : null,
      `text="${transcript}"`
    ].filter(Boolean);
    this.logger.info(parts.join(' | '));
  }

  /**
   * @param {number} limit
   */
  async getLatest(limit) {
    const { rows } = await this.pool.query(
      'SELECT user_id, guild_id, channel_id, content, "timestamp" FROM voice_transcriptions ORDER BY "timestamp" DESC LIMIT $1',
      [limit]
    );
    return rows.map(row => ({
      userId: row.user_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      transcript: row.content,
      confidence: null,
      createdAt: row.timestamp
    }));
  }

  /**
   * @param {string} userId
   * @param {number} limit
   */
  async getLatestForUser(userId, limit) {
    const { rows } = await this.pool.query(
      'SELECT user_id, guild_id, channel_id, content, "timestamp" FROM voice_transcriptions WHERE user_id = $1 ORDER BY "timestamp" DESC LIMIT $2',
      [userId, limit]
    );
    return rows.map(row => ({
      userId: row.user_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      transcript: row.content,
      confidence: null,
      createdAt: row.timestamp
    }));
  }

  async close() {
    await this.pool.end();
  }
}

async function createTranscriptionStore(options, logger) {
  if (!options?.connectionString && !options?.config) {
    logger.warn('⚠️ Aucune URL Postgres fournie, stockage des transcriptions désactivé.');
    return null;
  }

  const config = options.config || { connectionString: options.connectionString, ssl: options.ssl }; // ssl peut être undefined
  const store = new TranscriptionStore(config, logger);
  await store.init();
  logger.info('✅ Connexion Postgres initialisée.');
  return store;
}

module.exports = {
  TranscriptionStore,
  createTranscriptionStore
};

