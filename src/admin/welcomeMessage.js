import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as welcomeRepo from '../database/repositories/welcomeRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { buildInlineButtons } from '../utils/keyboard.js';
import { truncateText, escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const states = new Map(); // chatId → { step, data }

// ── Welcome panel ───────────────────────────────────────────────
composer.callbackQuery('admin:welcome', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const welcomeEnabled = await settingsRepo.getSetting(pool, 'welcome_enabled');
  const welcome = await welcomeRepo.getWelcomeMessage(pool);

  const status = welcomeEnabled ? '✅ Enabled' : '❌ Disabled';
  const text =
    `💬 <b>Welcome Message</b>\n\n` +
    `Status: <b>${status}</b>\n` +
    `Message: ${welcome ? '✅ Set' : '❌ Not set'}`;

  const kb = new InlineKeyboard()
    .text('📝 Set Message', 'welcome:set').text('👁 Preview', 'welcome:preview').row()
    .text(welcomeEnabled ? '🔴 Disable' : '🟢 Enable', 'welcome:toggle').row()
    .text('🔘 Manage Buttons', 'welcome:buttons').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Set message ─────────────────────────────────────────────────
composer.callbackQuery('welcome:set', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  states.set(ctx.chat.id, { step: 'set_text' });
  await ctx.editMessageText(
    '📝 <b>Set Welcome Message</b>\n\nSend me the new welcome message text.\nYou can use HTML formatting.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'welcome:cancel_edit') }
  );
});

// ── Preview ─────────────────────────────────────────────────────
composer.callbackQuery('welcome:preview', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const welcome = await welcomeRepo.getWelcomeMessage(ctx.dbPool);
  if (!welcome) {
    await ctx.editMessageText('⚠️ No welcome message set.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'admin:welcome')
    });
    return;
  }

  const kb = welcome.buttons?.length ? buildInlineButtons(welcome.buttons) : undefined;

  try {
    if (welcome.media_type === 'photo' && welcome.media_file_id) {
      await ctx.replyWithPhoto(welcome.media_file_id, { caption: welcome.message_text, parse_mode: welcome.parse_mode || 'HTML', reply_markup: kb });
    } else if (welcome.media_type === 'video' && welcome.media_file_id) {
      await ctx.replyWithVideo(welcome.media_file_id, { caption: welcome.message_text, parse_mode: welcome.parse_mode || 'HTML', reply_markup: kb });
    } else {
      await ctx.reply(welcome.message_text, { parse_mode: welcome.parse_mode || 'HTML', reply_markup: kb });
    }
  } catch (err) {
    await ctx.reply(`⚠️ Preview failed: ${err.message}`);
  }
});

// ── Toggle ──────────────────────────────────────────────────────
composer.callbackQuery('welcome:toggle', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'welcome_enabled');
  const newState = !current;
  await settingsRepo.setSetting(pool, 'welcome_enabled', newState, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'toggle_welcome', new_state: newState });

  // Refresh panel
  const welcome = await welcomeRepo.getWelcomeMessage(pool);
  const status = newState ? '✅ Enabled' : '❌ Disabled';
  const text =
    `💬 <b>Welcome Message</b>\n\n` +
    `Status: <b>${status}</b>\n` +
    `Message: ${welcome ? '✅ Set' : '❌ Not set'}`;

  const kb = new InlineKeyboard()
    .text('📝 Set Message', 'welcome:set').text('👁 Preview', 'welcome:preview').row()
    .text(newState ? '🔴 Disable' : '🟢 Enable', 'welcome:toggle').row()
    .text('🔘 Manage Buttons', 'welcome:buttons').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Button management ───────────────────────────────────────────
composer.callbackQuery('welcome:buttons', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const welcome = await welcomeRepo.getWelcomeMessage(ctx.dbPool);
  const buttons = welcome?.buttons || [];

  let text = '🔘 <b>Welcome Buttons</b>\n\n';
  const kb = new InlineKeyboard();
  if (buttons.length === 0) {
    text += 'No buttons configured.';
  } else {
    buttons.forEach((row, i) => {
      const items = Array.isArray(row) ? row : [row];
      for (const btn of items) {
        text += `┃ ${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 40)}\n`;
        kb.text(`🗑 Remove #${i + 1}`, `welcome:remove_btn:${i}`).row();
      }
    });
  }

  kb.text('➕ Add Button', 'welcome:add_btn').row().text('‹ Back', 'admin:welcome');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Add button ──────────────────────────────────────────────────
composer.callbackQuery('welcome:add_btn', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  states.set(ctx.chat.id, { step: 'add_btn_text' });
  await ctx.editMessageText(
    '➕ <b>Add Button</b>\n\nSend the button in format:\n<code>Button Text | https://url</code>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'welcome:cancel_edit') }
  );
});

// ── Remove button ───────────────────────────────────────────────
composer.callbackQuery(/^welcome:remove_btn:\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const idx = Number(ctx.callbackQuery.data.split(':')[2]);
  const pool = ctx.dbPool;
  const welcome = await welcomeRepo.getWelcomeMessage(pool);
  if (!welcome) return;

  const buttons = welcome.buttons || [];
  buttons.splice(idx, 1);
  await welcomeRepo.updateWelcomeButtons(pool, welcome.id, buttons);
  await ctx.editMessageText(`✅ Button #${idx + 1} removed.`, { reply_markup: new InlineKeyboard().text('‹ Back', 'welcome:buttons') });
});

// ── Text handler for welcome states ─────────────────────────────
composer.on('message:text', async (ctx, next) => {
  const state = states.get(ctx.chat.id);
  if (!state) return next();

  if (ctx.message.text === '/cancel') {
    states.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('‹ Back', 'admin:welcome') });
    return;
  }

  if (state.step === 'set_text') {
    states.delete(ctx.chat.id);
    await welcomeRepo.setWelcomeMessage(ctx.dbPool, {
      messageText: ctx.message.text,
      buttons: [],
      updatedBy: ctx.from.id,
    });
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'set_welcome_message' });
    await ctx.reply('✅ Welcome message updated!');
    return;
  }

  if (state.step === 'add_btn_text') {
    states.delete(ctx.chat.id);
    const parts = ctx.message.text.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      await ctx.reply('⚠️ Invalid format. Use: <code>Button Text | https://url</code>', { parse_mode: 'HTML' });
      return;
    }

    const pool = ctx.dbPool;
    const welcome = await welcomeRepo.getWelcomeMessage(pool);
    if (!welcome) { await ctx.reply('⚠️ Set a welcome message first.'); return; }

    const buttons = welcome.buttons || [];
    buttons.push({ text: parts[0], url: parts[1] });
    await welcomeRepo.updateWelcomeButtons(pool, welcome.id, buttons);
    await ctx.reply(`✅ Button "${parts[0]}" added!`);
    return;
  }

  return next();
});

// ── Cancel edit ────────────────────────────────────────────────
composer.callbackQuery('welcome:cancel_edit', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  states.delete(ctx.chat.id);
  // Return to welcome panel
  const pool = ctx.dbPool;
  const welcomeEnabled = await settingsRepo.getSetting(pool, 'welcome_enabled');
  const welcome = await welcomeRepo.getWelcomeMessage(pool);
  const status = welcomeEnabled ? '✅ Enabled' : '❌ Disabled';
  const text =
    `💬 <b>Welcome Message</b>\n\n` +
    `Status: <b>${status}</b>\n` +
    `Message: ${welcome ? '✅ Set' : '❌ Not set'}`;
  const kb = new InlineKeyboard()
    .text('📝 Set Message', 'welcome:set').text('👁 Preview', 'welcome:preview').row()
    .text(welcomeEnabled ? '🔴 Disable' : '🟢 Enable', 'welcome:toggle').row()
    .text('🔘 Manage Buttons', 'welcome:buttons').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

export default composer;
