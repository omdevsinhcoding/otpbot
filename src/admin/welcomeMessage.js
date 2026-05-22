import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as welcomeRepo from '../database/repositories/welcomeRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { buildInlineButtons } from '../utils/keyboard.js';
import { truncateText, escapeHtml, replaceWelcomePlaceholders } from '../utils/formatters.js';
import logger from '../utils/logger.js';

// Available color options for buttons (Telegram Bot API 9.4 styles)
// Telegram supports: 'success' (green), 'primary' (blue), 'danger' (red), default (no style)
const BUTTON_COLORS = [
  { style: 'success', label: '🟢 Green',   cb: 'welcome:color:success' },
  { style: 'primary', label: '🔵 Blue',    cb: 'welcome:color:primary' },
  { style: 'danger',  label: '🔴 Red',     cb: 'welcome:color:danger' },
  { style: '',        label: '⬜ Default', cb: 'welcome:color:none' },
];

const composer = new Composer();
const states = new Map(); // chatId → { step, data }

// ── Welcome panel ───────────────────────────────────────────────
composer.callbackQuery('admin:welcome', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'set_text' });
  await ctx.editMessageText(
    '📝 <b>Set Welcome Message</b>\n\n' +
    'Send me the new welcome message text.\n' +
    'You can use HTML formatting.\n\n' +
    '<b>📌 Available Placeholders:</b>\n' +
    '<blockquote>' +
    '<code>{user}</code> — Clickable mention link\n' +
    '<code>{first_name}</code> — First name\n' +
    '<code>{last_name}</code> — Last name\n' +
    '<code>{full_name}</code> — Full name\n' +
    '<code>{username}</code> — @username\n' +
    '<code>{id}</code> — Telegram ID' +
    '</blockquote>\n\n' +
    '<i>Example:</i> <code>Hey {user}! Welcome to our bot, {first_name}!</code>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'welcome:cancel_edit') }
  );
});

// ── Preview ─────────────────────────────────────────────────────
composer.callbackQuery('welcome:preview', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const welcome = await welcomeRepo.getWelcomeMessage(ctx.dbPool);
  if (!welcome) {
    await ctx.editMessageText('⚠️ No welcome message set.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'admin:welcome')
    });
    return;
  }

  const kb = welcome.buttons?.length ? buildInlineButtons(welcome.buttons) : undefined;
  // Replace placeholders with admin's own data for preview
  const previewText = replaceWelcomePlaceholders(welcome.message_text, ctx.from);

  try {
    if (welcome.media_type === 'photo' && welcome.media_file_id) {
      await ctx.replyWithPhoto(welcome.media_file_id, { caption: previewText, parse_mode: welcome.parse_mode || 'HTML', reply_markup: kb });
    } else if (welcome.media_type === 'video' && welcome.media_file_id) {
      await ctx.replyWithVideo(welcome.media_file_id, { caption: previewText, parse_mode: welcome.parse_mode || 'HTML', reply_markup: kb });
    } else {
      await ctx.reply(previewText, { parse_mode: welcome.parse_mode || 'HTML', reply_markup: kb });
    }
  } catch (err) {
    await ctx.reply(`⚠️ Preview failed: ${err.message}`);
  }
});

// ── Toggle ──────────────────────────────────────────────────────
composer.callbackQuery('welcome:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
  try { await ctx.answerCallbackQuery(); } catch {}
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
        const colorLabel = btn.color === 'success' ? '🟢' : btn.color === 'primary' ? '🔵' : btn.color === 'danger' ? '🔴' : '';
        const colorTag = colorLabel ? `${colorLabel} ` : '';
        text += `┃ ${i + 1}. ${colorTag}${escapeHtml(btn.text)} → ${truncateText(btn.url, 40)}\n`;
        kb.text(`🗑 Remove #${i + 1}`, `welcome:remove_btn:${i}`).row();
      }
    });
  }

  kb.text('➕ Add Button', 'welcome:add_btn').row().text('‹ Back', 'admin:welcome');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Add button ──────────────────────────────────────────────────
composer.callbackQuery('welcome:add_btn', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'add_btn_text' });
  await ctx.editMessageText(
    '➕ <b>Add Button</b>\n\n' +
    'Send the button in format:\n' +
    '<code>Button Text | https://url</code>\n\n' +
    '<i>After sending, you will pick a color for the button.</i>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'welcome:cancel_edit') }
  );
});

// ── Remove button ───────────────────────────────────────────────
composer.callbackQuery(/^welcome:remove_btn:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
    const pool = ctx.dbPool;
    const existing = await welcomeRepo.getWelcomeMessage(pool);

    if (existing) {
      // Update text only — preserve existing buttons, media, etc.
      await pool.query(
        `UPDATE welcome_messages SET message_text = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`,
        [ctx.message.text, ctx.from.id, existing.id]
      );
    } else {
      // First time — create new record
      await welcomeRepo.setWelcomeMessage(pool, {
        messageText: ctx.message.text,
        buttons: [],
        updatedBy: ctx.from.id,
      });
    }

    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'set_welcome_message' });
    await ctx.reply('✅ Welcome message updated!', {
      reply_markup: new InlineKeyboard()
        .text('🔘 Manage Buttons', 'welcome:buttons').row()
        .text('👁 Preview', 'welcome:preview').text('◀ Back', 'admin:welcome')
    });
    return;
  }

  if (state.step === 'add_btn_text') {
    const parts = ctx.message.text.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      await ctx.reply('⚠️ Invalid format. Use: <code>Button Text | https://url</code>', { parse_mode: 'HTML' });
      return;
    }

    const pool = ctx.dbPool;
    const welcome = await welcomeRepo.getWelcomeMessage(pool);
    if (!welcome) { states.delete(ctx.chat.id); await ctx.reply('⚠️ Set a welcome message first.'); return; }

    // Save button data temporarily, move to color selection
    states.set(ctx.chat.id, { step: 'pick_color', data: { btnText: parts[0], btnUrl: parts[1], welcomeId: welcome.id } });

    // Show color picker inline keyboard
    const colorKb = new InlineKeyboard();
    for (const c of BUTTON_COLORS) {
      colorKb.text(c.label, c.cb);
      if (c.style) colorKb.style(c.style);
      colorKb.row();
    }
    colorKb.text('❌ Cancel', 'welcome:cancel_edit');

    await ctx.reply(
      `🎨 <b>Pick a color for:</b> "${escapeHtml(parts[0])}"\n\nSelect a color for the button:`,
      { parse_mode: 'HTML', reply_markup: colorKb }
    );
    return;
  }

  return next();
});

// ── Color picker callbacks ──────────────────────────────────────
composer.callbackQuery(/^welcome:color:(.+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state || state.step !== 'pick_color' || !state.data) {
    await ctx.editMessageText('⚠️ Session expired. Please try again.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'welcome:buttons')
    });
    return;
  }

  const colorRaw = ctx.callbackQuery.data.split(':')[2];
  const color = colorRaw === 'none' ? '' : colorRaw; // 'success', 'primary', 'danger', or ''
  const { btnText, btnUrl, welcomeId } = state.data;

  // Save the button with color
  const pool = ctx.dbPool;
  const welcome = await welcomeRepo.getWelcomeMessage(pool);
  if (!welcome) {
    states.delete(ctx.chat.id);
    await ctx.editMessageText('⚠️ Welcome message not found.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'admin:welcome')
    });
    return;
  }

  const buttons = welcome.buttons || [];
  buttons.push({ text: btnText, url: btnUrl, color: color || undefined });
  await welcomeRepo.updateWelcomeButtons(pool, welcome.id, buttons);
  states.delete(ctx.chat.id);

  const colorLabel = color === 'success' ? '🟢 ' : color === 'primary' ? '🔵 ' : color === 'danger' ? '🔴 ' : '';
  await ctx.editMessageText(
    `✅ Button ${colorLabel}"${escapeHtml(btnText)}" added!`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔘 View Buttons', 'welcome:buttons').text('‹ Back', 'admin:welcome') }
  );
});

// ── Cancel edit ────────────────────────────────────────────────
composer.callbackQuery('welcome:cancel_edit', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
