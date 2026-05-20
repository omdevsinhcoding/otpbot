/**
 * Bot instance factory.
 * Creates and configures the grammY Bot with middleware and handlers.
 */

import { Bot } from 'grammy';
import settings from '../config/settings.js';
import logger from '../utils/logger.js';

/**
 * Create a new Bot instance.
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {import('../tracking/tracker.js').Tracker} tracker - Tracker instance
 * @returns {Bot}
 */
export function createBot(pool, tracker) {
  const bot = new Bot(settings.BOT_TOKEN);

  // ── Inject pool & tracker into every context ──────────────────────
  bot.use((ctx, next) => {
    ctx.dbPool = pool;
    ctx.tracker = tracker;
    return next();
  });

  logger.info('Bot instance created');
  return bot;
}
