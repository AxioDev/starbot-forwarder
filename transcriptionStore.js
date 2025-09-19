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
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        transcript TEXT NOT NULL,
        confidence REAL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * @param {string} userId
   * @param {string} transcript
   * @param {number|undefined} confidence
   * @param {Date} [createdAt]
   */
  async saveTranscription(userId, transcript, confidence, createdAt = new Date()) {
    if (!userId || !transcript) return;
    await this.pool.query(
      'INSERT INTO voice_transcriptions (user_id, transcript, confidence, created_at) VALUES ($1, $2, $3, $4)',
      [userId, transcript, confidence ?? null, createdAt]
    );
  }

  /**
   * @param {number} limit
   */
  async getLatest(limit) {
    const { rows } = await this.pool.query(
      'SELECT user_id, transcript, confidence, created_at FROM voice_transcriptions ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return rows.map(row => ({
      userId: row.user_id,
      transcript: row.transcript,
      confidence: row.confidence,
      createdAt: row.created_at
    }));
  }

  /**
   * @param {string} userId
   * @param {number} limit
   */
  async getLatestForUser(userId, limit) {
    const { rows } = await this.pool.query(
      'SELECT user_id, transcript, confidence, created_at FROM voice_transcriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return rows.map(row => ({
      userId: row.user_id,
      transcript: row.transcript,
      confidence: row.confidence,
      createdAt: row.created_at
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

