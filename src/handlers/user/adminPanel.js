import { Composer } from 'grammy';
import { escRe } from './index.js';
import { BTN_ADMIN_PANEL } from '../../utils/constants.js';
import { getMainMenu, getAdminPanelKeyboard } from '../../utils/keyboard.js';
import * as adminRepo from '../../database/repositories/adminRepo.js';
import { formatNumber } from '../../utils/formatters.js';
import settings from '../../config/settings.js';

const composer = new Composer();

composer.hears(new RegExp(`^${escRe(BTN_ADMIN_PANEL)}$`), async (ctx) => {
  const pool = ctx.dbPool;
  const isAdmin = await adminRepo.isAdmin(pool, ctx.from.id);
  if (!isAdmin) {
    await ctx.reply('⛔ You are not authorized.', { reply_markup: getMainMenu(false) });
    return;
  }

  const [usersRes, ordersRes, revenueRes, paidRes, pendingRes, expiredRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM users'),
    pool.query('SELECT COUNT(*)::int AS c FROM transactions'),
    pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM transactions WHERE status = 'success'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM transactions WHERE status = 'success'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM transactions WHERE status = 'pending'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM transactions WHERE status = 'expired'`),
  ]);

  const text =
    `╔══════════════════════╗\n` +
    `   👑 <b>Admin Panel</b>\n` +
    `╚══════════════════════╝\n\n` +
    `👥 <b>Total Users:</b> ${usersRes.rows[0].c}\n` +
    `🛒 <b>Total Orders:</b> ${ordersRes.rows[0].c}\n` +
    `💵 <b>Revenue:</b> ₹${formatNumber(parseFloat(revenueRes.rows[0].s))}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🟢 Paid: ${paidRes.rows[0].c}  |  🟡 Pending: ${pendingRes.rows[0].c}  |  🔴 Expired: ${expiredRes.rows[0].c}`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: getAdminPanelKeyboard(settings.WEBAPP_URL),
  });
});

export default composer;
