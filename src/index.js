/**
 * OTP Bot — Entry Point
 * Wires everything together and starts the bot.
 */

import { createPool, closePool } from './database/connection.js';
import { initDb } from './database/models.js';
import { createBot } from './bot/bot.js';
import { Tracker } from './tracking/tracker.js';
import { setupErrorHandler } from './handlers/error.js';


import settings from './config/settings.js';
import logger from './utils/logger.js';
import { startExpiryService, stopExpiryService } from './services/expiryService.js';
import { boldSansTransformer } from './middleware/smallCapsTransformer.js';

// ── Handlers & Admin ────────────────────────────────────────────
import startHandler from './handlers/start.js';
import userMenuHandler from './handlers/userMenu.js';
import idCommandHandler from './handlers/idCommand.js';
import adminPanel from './admin/panel.js';
import broadcastAdmin from './admin/broadcast.js';
import userManagement from './admin/userManagement.js';
import adminManagement from './admin/adminManagement.js';
import forceJoinAdmin from './admin/forceJoin.js';
import welcomeMessageAdmin from './admin/welcomeMessage.js';
import analyticsAdmin from './admin/analytics.js';  // Admin action logs
import settingsPanel from './admin/settingsPanel.js';
import botStats from './admin/botStats.js';
import paymentsAdmin from './admin/payments.js';
import depositHandler from './handlers/deposit.js';

async function main() {
  // 1. Database
  logger.info('Starting OTP Bot…');
  const pool = await createPool();
  await initDb(pool);

  // 2. Auto-seed first admin (super_admin) on every start
  const adminId = settings.FIRST_ADMIN_ID;
  await pool.query(
    `INSERT INTO users (user_id, full_name, referral_code)
     VALUES ($1, 'Super Admin', $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [adminId, `admin_${adminId}`]
  );
  await pool.query(
    `INSERT INTO admins (admin_id, role)
     VALUES ($1, 'super_admin')
     ON CONFLICT (admin_id) DO UPDATE SET role = 'super_admin', is_active = TRUE`,
    [adminId]
  );
  logger.info(`Super admin seeded: ${adminId}`);

  // 2. Tracker
  const tracker = new Tracker(pool);

  // 3. Bot instance
  const bot = createBot(pool, tracker);

  // 4. Global error handler
  setupErrorHandler(bot);

  // 4b. Bold Sans-Serif font transformer — all text looks bold & premium
  bot.api.config.use(boldSansTransformer);


  // 5. Middleware (admin tracking is built into admin handlers)

  // 6. Register handlers (admin FIRST so they take priority over text handlers)
  bot.use(adminPanel);
  bot.use(broadcastAdmin);
  bot.use(userManagement);
  bot.use(adminManagement);
  bot.use(forceJoinAdmin);
  bot.use(welcomeMessageAdmin);
  bot.use(analyticsAdmin);   // Admin action logs
  bot.use(settingsPanel);
  bot.use(botStats);
  bot.use(paymentsAdmin);

  // User handlers
  bot.use(startHandler);
  bot.use(depositHandler);
  bot.use(idCommandHandler);
  bot.use(userMenuHandler); // Must be LAST — it has broad text matchers

  // Handle noop callback (pagination "current page" button)
  bot.callbackQuery('noop', async (ctx) => { try { await ctx.answerCallbackQuery(); } catch {} });

  // 7. Start
  logger.info('Bot is starting polling…');
  bot.start({
    onStart: (botInfo) => {
      logger.info(`🤖 Bot @${botInfo.username} is running!`);
    },
  });

  // 8. Start payment expiry background service
  startExpiryService(bot, pool);

  // 8. Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down…`);
    stopExpiryService();
    await bot.stop();
    await closePool();
    logger.info('Bot stopped. Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  logger.error(`Fatal error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
