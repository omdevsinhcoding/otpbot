/**
 * OTP Bot — Entry Point
 * Wires everything together and starts the bot.
 */

import { createPool, closePool } from './database/connection.js';
import { initDb } from './database/models.js';
import { createBot } from './bot/bot.js';
import { Tracker } from './tracking/tracker.js';
import { setupErrorHandler } from './handlers/error.js';
import { activityTracker } from './middleware/activityTracker.js';
import { ActionType } from './utils/constants.js';
import logger from './utils/logger.js';

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
import analyticsAdmin from './admin/analytics.js';
import logsViewer from './admin/logsViewer.js';
import settingsPanel from './admin/settingsPanel.js';
import botStats from './admin/botStats.js';

async function main() {
  // 1. Database
  logger.info('Starting OTP Bot…');
  const pool = await createPool();
  await initDb(pool);

  // 2. Tracker
  const tracker = new Tracker(pool);

  // 3. Bot instance
  const bot = createBot(pool, tracker);

  // 4. Global error handler
  setupErrorHandler(bot);

  // 5. Middleware
  bot.use(activityTracker);

  // 6. Register handlers (admin FIRST so they take priority over text handlers)
  bot.use(adminPanel);
  bot.use(broadcastAdmin);
  bot.use(userManagement);
  bot.use(adminManagement);
  bot.use(forceJoinAdmin);
  bot.use(welcomeMessageAdmin);
  bot.use(analyticsAdmin);
  bot.use(logsViewer);
  bot.use(settingsPanel);
  bot.use(botStats);

  // User handlers
  bot.use(startHandler);
  bot.use(idCommandHandler);
  bot.use(userMenuHandler); // Must be LAST — it has broad text matchers

  // Handle noop callback (pagination "current page" button)
  bot.callbackQuery('noop', async (ctx) => { await ctx.answerCallbackQuery(); });

  // 7. Start
  tracker.trackFireAndForget(0, ActionType.BOT_STARTED, { timestamp: new Date().toISOString() });
  logger.info('Bot is starting polling…');
  bot.start({
    onStart: (botInfo) => {
      logger.info(`🤖 Bot @${botInfo.username} is running!`);
    },
  });

  // 8. Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down…`);
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
