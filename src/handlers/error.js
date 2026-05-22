import { GrammyError, HttpError } from 'grammy';

import logger from '../utils/logger.js';

export function setupErrorHandler(bot) {
  bot.catch(async (err) => {
    const ctx = err.ctx;
    const e = err.error;

    // ── Network / timeout errors → silent log ─────────────────────
    if (e instanceof HttpError) {
      logger.warn(`HTTP error: ${e.message}`);
      return;
    }

    if (e instanceof GrammyError) {
      // Harmless — user double-clicked or message didn't change
      if (e.description?.includes('message is not modified')) return;
      // Harmless — callback query expired before we could answer
      if (e.description?.includes('query is too old')) return;

      if (e.description?.includes('Forbidden') || e.description?.includes('blocked')) {
        logger.warn(`Forbidden (user blocked bot): ${e.description}`);
        return;
      }
      if (e.description?.includes('Too Many Requests')) {
        logger.warn(`Rate limited by Telegram API: ${e.description}`);
        return;
      }
    }

    // ── Full error logging ────────────────────────────────────────
    logger.error(`Unhandled error: ${e?.message || e}`, { stack: e?.stack });


    // ── Notify user ───────────────────────────────────────────────
    try {
      if (ctx) {
        if (ctx.callbackQuery) {
          try { await ctx.answerCallbackQuery({ text: '⚠️ An error occurred.', show_alert: true }); } catch {}
        } else {
          await ctx.reply('⚠️ An unexpected error occurred. Please try again later.');
        }
      }
    } catch { /* swallow */ }
  });
}
