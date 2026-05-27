import { Composer } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import { getAdminPanelKeyboard } from '../utils/keyboard.js';
import settings from '../config/settings.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const PANEL_TEXT = '╔══════════════════════╗\n   🔧 <b>Admin Panel</b>\n╚══════════════════════╝\n\nSelect an option below:';

function getPanelKeyboard() {
  return getAdminPanelKeyboard(settings.WEBAPP_URL);
}

composer.command('admin', adminRequired, async (ctx) => {
  await ctx.reply(PANEL_TEXT, { parse_mode: 'HTML', reply_markup: getPanelKeyboard() });
});

composer.callbackQuery('admin:back', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.editMessageText(PANEL_TEXT, { parse_mode: 'HTML', reply_markup: getPanelKeyboard() });
});

composer.callbackQuery('admin:close', async (ctx) => {
  try { await ctx.answerCallbackQuery('Panel closed'); } catch {}
  try { await ctx.deleteMessage(); } catch { /* may already be deleted */ }
});

export default composer;
