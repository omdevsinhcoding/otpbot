import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as trackingRepo from '../database/repositories/trackingRepo.js';
import { formatNumber, formatTimestamp } from '../utils/formatters.js';

const composer = new Composer();

composer.callbackQuery('admin:analytics', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text('📈 User Growth', 'analytics:growth').text('📊 Activity Stats', 'analytics:activity').row()
    .text('📅 Daily Report', 'analytics:daily').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText('📊 <b>Analytics Dashboard</b>\n\nChoose a report:', { parse_mode: 'HTML', reply_markup: kb });
});

// ── User Growth ─────────────────────────────────────────────────
composer.callbackQuery('analytics:growth', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await trackingRepo.getDailyUserGrowth(ctx.dbPool, 14);

  let text = '📈 <b>User Growth (Last 14 Days)</b>\n\n';
  if (!data.length) {
    text += 'No data available.';
  } else {
    const maxCount = Math.max(...data.map(d => d.count), 1);
    for (const row of data) {
      const barLen = Math.round((row.count / maxCount) * 15);
      const bar = '█'.repeat(barLen) + '░'.repeat(15 - barLen);
      const dateStr = new Date(row.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      text += `<code>${dateStr}</code> ${bar} <b>${row.count}</b>\n`;
    }
  }

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:analytics') });
});

// ── Activity Stats ──────────────────────────────────────────────
composer.callbackQuery('analytics:activity', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const stats = await trackingRepo.getActivityStats(ctx.dbPool, 7);

  let text = '📊 <b>Activity Stats (Last 7 Days)</b>\n\n';
  const icons = {
    user_start: '🚀', user_restart: '🔄', button_click: '🔘',
    command_used: '⌨️', message_sent: '💬', broadcast_sent: '📢',
    error_occurred: '⚠️',
  };

  if (Object.keys(stats).length === 0) {
    text += 'No activity recorded.';
  } else {
    for (const [action, count] of Object.entries(stats)) {
      const icon = icons[action] || '📌';
      text += `${icon} <b>${action}:</b> ${formatNumber(count)}\n`;
    }
  }

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:analytics') });
});

// ── Daily Report ────────────────────────────────────────────────
composer.callbackQuery('analytics:daily', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const [activitiesToday, stats] = await Promise.all([
    trackingRepo.countActivitiesToday(pool),
    trackingRepo.getActivityStats(pool, 1),
  ]);

  let text =
    `📅 <b>Daily Report</b>\n` +
    `<i>${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</i>\n\n` +
    `📊 Total Activities: <b>${formatNumber(activitiesToday)}</b>\n\n`;

  for (const [action, count] of Object.entries(stats)) {
    text += `┃ ${action}: <b>${count}</b>\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔄 Refresh', 'analytics:daily').row().text('‹ Back', 'admin:analytics')
  });
});

export default composer;
