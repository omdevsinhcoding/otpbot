import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml, truncateText } from '../utils/formatters.js';
import logger from '../utils/logger.js';
import { registerAdminState } from '../utils/adminStates.js';

const composer = new Composer();
const states = new Map(); // chatId → { step, data }
registerAdminState(states);

// ── T&C panel ───────────────────────────────────────────────────
async function showTcPanel(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'tc_enabled');
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  const message = await settingsRepo.getSetting(pool, 'tc_message');

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';

  let text = `📜 <b>TERMS & CONDITIONS</b>\n\n`;
  text += `<blockquote>`;
  text += `${statusEmoji} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `🔗 <b>Buttons:</b> ${buttons.length} configured\n`;
  text += `💬 <b>Message:</b> ${message ? '✅ Set' : '✅ Default'}`;
  text += `</blockquote>`;

  if (buttons.length > 0) {
    text += `\n\n<blockquote>📋 <b>BUTTONS</b>\n\n`;
    buttons.forEach((btn, i) => {
      text += `${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 35)}\n`;
    });
    text += `</blockquote>`;
  }

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'tc:toggle').row()
    .text('➕ Add Button', 'tc:add_btn').text('💬 Set Message', 'tc:set_msg').row();
  if (buttons.length > 0) {
    kb.text('🗑 Remove Button', 'tc:remove_list').text('👁 Preview', 'tc:preview').row();
  }
  kb.text('◀ Back', 'admin:back');

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

// ── Add Button ──────────────────────────────────────────────────
composer.callbackQuery('tc:add_btn', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'add_btn' });
  await ctx.editMessageText(
    '➕ <b>Add T&C Button</b>\n\n' +
    'Send the button in format:\n' +
    '<code>Button Name | https://url</code>\n\n' +
    '<i>Examples:</i>\n' +
    '<code>📖 English Version | https://telegra.ph/Terms-EN</code>\n' +
    '<code>📖 हिंदी Version | https://telegra.ph/Terms-HI</code>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'tc:cancel') }
  );
});

// ── Remove Button List ──────────────────────────────────────────
composer.callbackQuery('tc:remove_list', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const buttons = await settingsRepo.getSetting(ctx.dbPool, 'tc_buttons') || [];

  if (buttons.length === 0) {
    await ctx.editMessageText('⚠️ No buttons to remove.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  let text = '🗑 <b>Remove T&C Button</b>\n\nSelect a button to remove:\n\n';
  const kb = new InlineKeyboard();
  buttons.forEach((btn, i) => {
    text += `${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 35)}\n`;
    kb.text(`🗑 #${i + 1} — ${truncateText(btn.text, 20)}`, `tc:remove:${i}`).row();
  });
  kb.text('◀ Back', 'admin:tc');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Remove Button Confirm ───────────────────────────────────────
composer.callbackQuery(/^tc:remove:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const idx = Number(ctx.callbackQuery.data.split(':')[2]);
  const pool = ctx.dbPool;
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];

  if (idx < 0 || idx >= buttons.length) {
    await ctx.editMessageText('⚠️ Button not found.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  const removed = buttons.splice(idx, 1)[0];
  await settingsRepo.setSetting(pool, 'tc_buttons', buttons, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'remove_tc_button' });

  await ctx.editMessageText(`✅ Button "${escapeHtml(removed.text)}" removed.`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
  });
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
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  const message = await settingsRepo.getSetting(pool, 'tc_message') ||
    "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...";

  const kb = new InlineKeyboard();
  for (const btn of buttons) {
    kb.url(btn.text, btn.url).row();
  }
  kb.text('✅ Accept', 'tc:preview_noop').style('success');
  kb.text('❌ Decline', 'tc:preview_noop').style('danger');

  await ctx.reply(message, { parse_mode: 'HTML', reply_markup: kb });
});

// Preview noop
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

  if (state.step === 'add_btn') {
    states.delete(ctx.chat.id);
    const parts = ctx.message.text.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      await ctx.reply('⚠️ Invalid format. Use: <code>Button Name | https://url</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('➕ Try Again', 'tc:add_btn').text('◀ Back', 'admin:tc')
      });
      return;
    }

    const [btnText, btnUrl] = parts;

    // Validate URL has proper domain (not just 'https://url')
    let validUrl = false;
    try {
      const u = new URL(btnUrl);
      validUrl = (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch {}

    if (!validUrl) {
      await ctx.reply('⚠️ Invalid URL! Must be a real link like:\n<code>https://telegra.ph/my-article</code>\n<code>https://example.com/terms</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('➕ Try Again', 'tc:add_btn').text('◀ Back', 'admin:tc')
      });
      return;
    }

    const pool = ctx.dbPool;
    const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
    buttons.push({ text: btnText, url: btnUrl });
    await settingsRepo.setSetting(pool, 'tc_buttons', buttons, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'add_tc_button' });

    await ctx.reply(`✅ Button "${escapeHtml(btnText)}" added!`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('➕ Add More', 'tc:add_btn').text('◀ Back', 'admin:tc')
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
