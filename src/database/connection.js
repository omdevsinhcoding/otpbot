import pg from 'pg';
import settings from '../config/settings.js';
import logger from '../utils/logger.js';

const { Pool } = pg;
let pool = null;

export async function createPool() {
  pool = new Pool({
    connectionString: settings.DATABASE_URL,
    min: settings.DB_MIN_CONNECTIONS,
    max: settings.DB_MAX_CONNECTIONS,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  const client = await pool.connect();
  client.release();
  logger.info('Database pool created successfully');
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database pool not initialized. Call createPool() first.');
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}
