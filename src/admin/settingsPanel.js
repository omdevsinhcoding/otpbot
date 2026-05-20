import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';

const composer = new Composer();
const editStates = new Map(); // chatId → { step, key }

// ── Settings panel ──────────────────────────────────────────────
composer.callbackQuery('admin:settings', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSettingsPanel(ctx);
});

async function showSettingsPanel(ctx) {
  const all = await settingsRepo.getAllSettings(ctx.dbPool);
  const text =
    `⚙️ <b>Bot Settings</b>\n\n` +
    `🔧 <b>Maintenance Mode:</b> ${all.maintenance_mode ? '🟢 On' : '🔴 Off'}\n` +
    `🤖 <b>Bot Name:</b> ${escapeHtml(all.bot_name || 'N/A')}\n` +
    `🛡 <b>Support Username:</b> ${all.support_username ? '@' + escapeHtml(all.support_username) : 'Not set'}`;

  const kb = new InlineKeyboard()
    .text(`${all.maintenance_mode ? '🔴 Disable' : '🟢 Enable'} Maintenance`, 'settings:maintenance').row()
    .text('📝 Edit Bot Name', 'settings:edit:bot_name').row()
    .text('📝 Edit Support Username', 'settings:edit:support_username').row()
    .text('‹ Back', 'admin:back');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ── Toggle maintenance ──────────────────────────────────────────
composer.callbackQuery('settings:maintenance', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'maintenance_mode');
  const newVal = !current;
  await settingsRepo.setSetting(pool, 'maintenance_mode', newVal, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'maintenance_mode', value: newVal });
  await showSettingsPanel(ctx);
});

// ── Edit setting ────────────────────────────────────────────────
composer.callbackQuery(/^settings:edit:.+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = ctx.callbackQuery.data.split(':').slice(2).join(':');
  editStates.set(ctx.chat.id, { step: 'waiting_value', key });
  await ctx.editMessageText(
    `📝 <b>Edit Setting</b>\n\nSend the new value for <b>${escapeHtml(key)}</b>.\n\nSend /cancel to abort.`,
    { parse_mode: 'HTML' }
  );
});

// ── Receive value ───────────────────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  const state = editStates.get(ctx.chat.id);
  if (!state || state.step !== 'waiting_value') return next();

  if (ctx.message.text === '/cancel') {
    editStates.delete(ctx.chat.id);
    await ctx.reply('❌ Edit cancelled.');
    return;
  }

  editStates.delete(ctx.chat.id);
  const value = ctx.message.text.trim();
  await settingsRepo.setSetting(ctx.dbPool, state.key, value, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: state.key, value });
  await ctx.reply(`✅ Setting <b>${escapeHtml(state.key)}</b> updated to: <b>${escapeHtml(value)}</b>`, { parse_mode: 'HTML' });
});

export default composer;
