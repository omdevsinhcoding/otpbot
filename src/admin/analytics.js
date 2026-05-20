import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as trackingRepo from '../database/repositories/trackingRepo.js';
import { formatTimestamp, truncateText, escapeHtml } from '../utils/formatters.js';

const composer = new Composer();

// ═══════════════════════════════════════════════════════════════════
//  ADMIN LOGS — only tracks admin actions (who did what)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('admin:logs', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showAdminLogs(ctx, 1);
});

composer.callbackQuery(/^logs:admin:\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.callbackQuery.data.split(':')[2]);
  await showAdminLogs(ctx, page);
});

async function showAdminLogs(ctx, page) {
  const limit = 8;
  const logs = await trackingRepo.getRecentAdminLogs(ctx.dbPool, 200);
  const total = logs.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const items = logs.slice((page - 1) * limit, page * limit);

  let text = '👑 <b>Admin Action Logs</b>\n\n';

  if (!items.length) {
    text += 'No admin actions recorded yet.';
  } else {
    for (const log of items) {
      text += `🕐 ${formatTimestamp(log.created_at)}\n`;
      text += `👤 Admin: <code>${log.admin_id}</code>`;
      if (log.admin_username) text += ` (@${escapeHtml(log.admin_username)})`;
      text += `\n`;
      text += `📌 Action: <b>${escapeHtml(log.action_type)}</b>\n`;
      if (log.target_user_id) text += `🎯 Target: <code>${log.target_user_id}</code>\n`;
      text += `📝 ${truncateText(JSON.stringify(log.action_data), 60)}\n\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀️ Prev', `logs:admin:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶️', `logs:admin:${page + 1}`);
  kb.row().text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

export default composer;
