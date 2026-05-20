import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as trackingRepo from '../database/repositories/trackingRepo.js';
import { formatTimestamp, truncateText, escapeHtml } from '../utils/formatters.js';

const composer = new Composer();

composer.callbackQuery('admin:logs', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text('📋 Activity Logs', 'logs:activity:1').text('👑 Admin Logs', 'logs:admin:1').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText('📋 <b>Log Viewer</b>\n\nChoose a log type:', { parse_mode: 'HTML', reply_markup: kb });
});

// ── Activity logs ───────────────────────────────────────────────
composer.callbackQuery(/^logs:activity:\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.callbackQuery.data.split(':')[2]);
  const limit = 10;
  const logs = await trackingRepo.getRecentActivities(ctx.dbPool, 200);
  const total = logs.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const items = logs.slice((page - 1) * limit, page * limit);

  let text = '📋 <b>Activity Logs</b>\n\n';
  if (!items.length) {
    text += 'No logs found.';
  } else {
    for (const log of items) {
      text += `🕐 ${formatTimestamp(log.created_at)}\n`;
      text += `👤 User: <code>${log.user_id || 'N/A'}</code>\n`;
      text += `📌 Action: <b>${escapeHtml(log.action_type)}</b>\n`;
      text += `📝 Data: ${truncateText(JSON.stringify(log.action_data), 60)}\n\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀️ Prev', `logs:activity:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶️', `logs:activity:${page + 1}`);
  kb.row().text('‹ Back', 'admin:logs');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Admin logs ──────────────────────────────────────────────────
composer.callbackQuery(/^logs:admin:\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.callbackQuery.data.split(':')[2]);
  const limit = 10;
  const logs = await trackingRepo.getRecentAdminLogs(ctx.dbPool, 200);
  const total = logs.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const items = logs.slice((page - 1) * limit, page * limit);

  let text = '👑 <b>Admin Logs</b>\n\n';
  if (!items.length) {
    text += 'No logs found.';
  } else {
    for (const log of items) {
      text += `🕐 ${formatTimestamp(log.created_at)}\n`;
      text += `👤 Admin: <code>${log.admin_id}</code>`;
      if (log.admin_username) text += ` (@${escapeHtml(log.admin_username)})`;
      text += `\n`;
      text += `📌 Action: <b>${escapeHtml(log.action_type)}</b>\n`;
      if (log.target_user_id) text += `🎯 Target: <code>${log.target_user_id}</code>\n`;
      text += `📝 Data: ${truncateText(JSON.stringify(log.action_data), 60)}\n\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀️ Prev', `logs:admin:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶️', `logs:admin:${page + 1}`);
  kb.row().text('‹ Back', 'admin:logs');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

export default composer;
