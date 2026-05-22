import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml, truncateText } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const states = new Map(); // chatId → { step }

// ── T&C panel ───────────────────────────────────────────────────
async function showTcPanel(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'tc_enabled');
  const url = await settingsRepo.getSetting(pool, 'tc_url');
  const message = await settingsRepo.getSetting(pool, 'tc_message');

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';

  let text = `📜 <b>TERMS & CONDITIONS</b>\n\n`;
  text += `<blockquote>`;
  text += `${statusEmoji} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `🔗 <b>URL:</b> ${url ? truncateText(url, 40) : '❌ Not set'}\n`;
  text += `💬 <b>Message:</b> ${message ? '✅ Set' : '✅ Default'}`;
  text += `</blockquote>`;

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'tc:toggle').row()
    .text('🔗 Set URL', 'tc:set_url').text('💬 Set Message', 'tc:set_msg').row()
    .text('👁 Preview', 'tc:preview').row()
    .text('◀ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('admin:tc', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showTcPanel(ctx);
});

// ── Toggle ──────────────────────────────────────────────────────
composer.callbackQuery('tc:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'tc_enabled');
  const newState = !current;
  await settingsRepo.setSetting(pool, 'tc_enabled', newState, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'toggle_tc', new_state: newState });
  await showTcPanel(ctx);
});

// ── Set URL ─────────────────────────────────────────────────────
composer.callbackQuery('tc:set_url', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'set_url' });
  await ctx.editMessageText(
    '🔗 <b>Set T&C URL</b>\n\n' +
    '<blockquote>' +
    'Send the Terms & Conditions link.\n\n' +
    '• Telegraph: <code>https://telegra.ph/your-article</code>\n' +
    '• Any web URL: <code>https://example.com/terms</code>\n\n' +
    '⚠️ This URL will open as a <b>Mini App</b> (WebView) inside Telegram.' +
    '</blockquote>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'tc:cancel') }
  );
});

// ── Set Message ─────────────────────────────────────────────────
composer.callbackQuery('tc:set_msg', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'set_msg' });
  await ctx.editMessageText(
    '💬 <b>Set T&C Message</b>\n\n' +
    'Send the message text that users will see before the Accept/Decline buttons.\n' +
    'You can use HTML formatting.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'tc:cancel') }
  );
});

// ── Preview ─────────────────────────────────────────────────────
composer.callbackQuery('tc:preview', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const url = await settingsRepo.getSetting(pool, 'tc_url');
  const message = await settingsRepo.getSetting(pool, 'tc_message') ||
    "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...";

  const kb = new InlineKeyboard();
  if (url) {
    kb.webApp('📖 Read Full Terms And Conditions', url).row();
  }
  kb.text('✅ Accept', 'tc:preview_noop').style('success');
  kb.text('❌ Decline', 'tc:preview_noop').style('danger');

  await ctx.reply(message, { parse_mode: 'HTML', reply_markup: kb });
});

// Preview noop (just acknowledge)
composer.callbackQuery('tc:preview_noop', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery('This is a preview — buttons are inactive.'); } catch {}
});

// ── Text handler for T&C states ─────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  const state = states.get(ctx.chat.id);
  if (!state) return next();

  if (ctx.message.text === '/cancel') {
    states.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc') });
    return;
  }

  if (state.step === 'set_url') {
    states.delete(ctx.chat.id);
    const url = ctx.message.text.trim();

    // Basic URL validation
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      await ctx.reply('⚠️ Invalid URL. Must start with <code>http://</code> or <code>https://</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🔗 Try Again', 'tc:set_url').text('◀ Back', 'admin:tc')
      });
      return;
    }

    await settingsRepo.setSetting(ctx.dbPool, 'tc_url', url, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'set_tc_url' });
    await ctx.reply(`✅ T&C URL set to:\n<code>${escapeHtml(url)}</code>`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  if (state.step === 'set_msg') {
    states.delete(ctx.chat.id);
    await settingsRepo.setSetting(ctx.dbPool, 'tc_message', ctx.message.text, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'set_tc_message' });
    await ctx.reply('✅ T&C message updated!', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  return next();
});

// ── Cancel ──────────────────────────────────────────────────────
composer.callbackQuery('tc:cancel', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  await showTcPanel(ctx);
});

export default composer;
