import pg from 'pg';
import settings from '../config/settings.js';
import logger from '../utils/logger.js';

const { Pool } = pg;
let pool = null;

export async function createPool() {
  pool = new Pool({
    connectionString: settings.DATABASE_URL,
    max: 20,                     // max 20 connections (enough for 40K DAU)
    idleTimeoutMillis: 30_000,   // close idle connections after 30s
    connectionTimeoutMillis: 10_000, // fail fast if DB is overloaded
    statement_timeout: 30_000,   // kill queries running > 30s
  });
  pool.on('error', (err) => {
    logger.error(`Database pool error: ${err.message}`);
  });
  const client = await pool.connect();
  client.release();
  logger.info('Database pool created (max 20 connections)');
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
