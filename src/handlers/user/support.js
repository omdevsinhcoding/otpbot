import { Composer } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_SUPPORT } from '../../utils/constants.js';
import { escapeHtml } from '../../utils/formatters.js';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';

const composer = new Composer();

composer.hears(new RegExp(`^${escRe(BTN_SUPPORT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  let supportUsername = '';
  try {
    supportUsername = await settingsRepo.getSetting(ctx.dbPool, 'support_username');
  } catch { /* ignore */ }

  const text = supportUsername
    ? `🛡 <b>Support</b>\n\nContact our support: @${escapeHtml(supportUsername)}`
    : '🛡 <b>Support</b>\n\nPlease contact the bot administrator for support.';

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

export default composer;
