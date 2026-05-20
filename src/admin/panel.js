import { Composer } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import { ADMIN_PANEL_KEYBOARD } from '../utils/keyboard.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const PANEL_TEXT = '🔧 <b>Admin Panel</b>\n\nSelect an option:';

composer.command('admin', adminRequired, async (ctx) => {
  await ctx.reply(PANEL_TEXT, { parse_mode: 'HTML', reply_markup: ADMIN_PANEL_KEYBOARD });
});

composer.callbackQuery('admin:back', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(PANEL_TEXT, { parse_mode: 'HTML', reply_markup: ADMIN_PANEL_KEYBOARD });
});

composer.callbackQuery('admin:close', async (ctx) => {
  await ctx.answerCallbackQuery('Panel closed');
  try { await ctx.deleteMessage(); } catch { /* may already be deleted */ }
});

export default composer;
