import pg from 'pg';
import settings from '../config/settings.js';
import logger from '../utils/logger.js';

const { Pool } = pg;
let pool = null;

export async function createPool() {
  pool = new Pool({
    connectionString: settings.DATABASE_URL,
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
