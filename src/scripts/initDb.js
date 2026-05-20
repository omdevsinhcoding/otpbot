/**
 * Standalone script: Initialize DB schema and seed first admin.
 * Usage: node src/scripts/initDb.js
 */
import 'dotenv/config';
import { createPool, closePool } from '../database/connection.js';
import { initDb } from '../database/models.js';
import logger from '../utils/logger.js';

const FIRST_ADMIN_ID = Number(process.env.FIRST_ADMIN_ID);
if (!FIRST_ADMIN_ID) {
  console.error('ERROR: FIRST_ADMIN_ID not set in .env');
  process.exit(1);
}

async function main() {
  logger.info('Initializing database…');
  const pool = await createPool();
  await initDb(pool);

  // Upsert the first admin as a user first
  await pool.query(
    `INSERT INTO users (user_id, full_name, referral_code)
     VALUES ($1, 'Super Admin', $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [FIRST_ADMIN_ID, `admin_${FIRST_ADMIN_ID}`]
  );

  // Upsert as super_admin
  await pool.query(
    `INSERT INTO admins (admin_id, role)
     VALUES ($1, 'super_admin')
     ON CONFLICT (admin_id) DO UPDATE SET role = 'super_admin', is_active = TRUE`,
    [FIRST_ADMIN_ID]
  );

  logger.info(`First admin (super_admin) seeded: ${FIRST_ADMIN_ID}`);
  logger.info('Database initialization complete!');
  await closePool();
  process.exit(0);
}

main().catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
