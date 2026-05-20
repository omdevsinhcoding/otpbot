import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import * as forceJoinRepo from '../database/repositories/forceJoinRepo.js';
import * as trackingRepo from '../database/repositories/trackingRepo.js';
import { formatNumber } from '../utils/formatters.js';

const composer = new Composer();
const startTime = Date.now();

function formatUptime() {
  const diff = Math.floor((Date.now() - startTime) / 1000);
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

composer.callbackQuery(/^admin:botstats$|^botstats:refresh$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;

  const [totalUsers, activeUsers, bannedUsers, newToday, adminCount, channelCount, activitiesToday] = await Promise.all([
    userRepo.countUsers(pool),
    userRepo.countActiveUsers(pool),
    userRepo.countBannedUsers(pool),
    userRepo.countUsersToday(pool),
    adminRepo.countAdmins(pool),
    forceJoinRepo.countChannels(pool),
    trackingRepo.countActivitiesToday(pool),
  ]);

  const text =
    `🤖 <b>BOT STATISTICS</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👥 Total Users: <b>${formatNumber(totalUsers)}</b>\n` +
    `✅ Active Users: <b>${formatNumber(activeUsers)}</b>\n` +
    `🚫 Banned Users: <b>${formatNumber(bannedUsers)}</b>\n` +
    `📅 New Today: <b>${formatNumber(newToday)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👑 Total Admins: <b>${formatNumber(adminCount)}</b>\n` +
    `🔗 Force Join Channels: <b>${formatNumber(channelCount)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📊 Activities Today: <b>${formatNumber(activitiesToday)}</b>\n` +
    `🕐 Uptime: <b>${formatUptime()}</b>`;

  const kb = new InlineKeyboard()
    .text('🔄 Refresh', 'botstats:refresh').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

export default composer;
