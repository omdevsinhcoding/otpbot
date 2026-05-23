/**
 * 👤 PROFILE handler — Premium card + all profile:* callbacks.
 */
import { Composer, InlineKeyboard } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_PROFILE } from '../../utils/constants.js';
import { escapeHtml, formatNumber } from '../../utils/formatters.js';
import * as userRepo from '../../database/repositories/userRepo.js';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';

const composer = new Composer();

// ── 👤 PROFILE — Premium card style ─────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROFILE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  if (!user) {
    await ctx.reply('⚠️ User not found. Please send /start first.', { reply_markup: await menuFor(ctx) });
    return;
  }

  // Fetch wallet data
  const walletMod = await import('../../database/repositories/walletRepo.js');
  const wallet = await walletMod.getWallet(pool, ctx.from.id);
  const balance = wallet ? parseFloat(wallet.balance) : 0;

  // Count deposits
  const { rows: depRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM transactions WHERE user_id = $1 AND status = 'success'`, [ctx.from.id]
  );
  const depositCount = depRows[0].count;

  // Count OTP/numbers bought (future-proof: 0 for now)
  const totalBought = 0;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const text =
    `👤 <b>Name :</b> ${escapeHtml(user.full_name || 'N/A')}\n` +
    `🆔 <b>User ID :</b> <code>${user.user_id}</code>\n\n` +
    `💰 <b>Balance :</b> ₹${formatNumber(balance)}\n` +
    `💵 <b>Total Deposit :</b> ${depositCount} Times\n\n` +
    `🕐 <b>Last Updated :</b> ${timeStr}\n` +
    `📅 <b>Date :</b> ${dateStr}\n\n` +
    `📦 <b>Total Number Buyed :</b> ${totalBought}`;

  const kb = new InlineKeyboard()
    .text('📠 OTP History', 'profile:otp_history').text('💵 Deposit History', 'profile:deposit_history').row()
    .text('📧 Email History', 'profile:email_history').text('💸 Transfer Balance', 'profile:transfer').row()
    .text('📜 Read Full Terms And Conditions', 'profile:terms');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ═══════════════════════════════════════════════════════════════════
//  PROFILE CALLBACK HANDLERS
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('profile:deposit_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const { rows } = await pool.query(
    `SELECT order_id, gateway, amount, status, gateway_data, created_at FROM transactions
     WHERE user_id = $1 AND status = 'success' ORDER BY created_at DESC LIMIT 10`, [ctx.from.id]
  );

  // Get total stats
  const { rows: statsRows } = await pool.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = $1 AND status = 'success'`, [ctx.from.id]
  );
  const totalCount = parseInt(statsRows[0]?.count || 0);
  const totalAmount = parseFloat(statsRows[0]?.total || 0);

  if (rows.length === 0) {
    await ctx.reply(
      `┌─────────────────────────┐\n` +
      `│   📭  <b>No Deposits Yet</b>       │\n` +
      `└─────────────────────────┘\n\n` +
      `You haven't made any deposits.\n` +
      `Tap 💰 <b>DEPOSIT</b> to get started!`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Fetch gateway display names
  const [paytmName, bharatpayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
  ]);

  const gwName = (g) => {
    if (g === 'paytm') return paytmName || 'Automatic Gateway';
    if (g === 'bharatpay') return bharatpayName || 'Manual Gateway';
    if (g === 'cryptomus') return 'Crypto';
    return g;
  };
  const gwIcon = (g) => g === 'paytm' ? '⚡' : g === 'bharatpay' ? '🏦' : g === 'cryptomus' ? '🪙' : '💳';

  const formatDate = (d) => {
    const dt = new Date(d);
    const day = String(dt.getDate()).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[dt.getMonth()];
    const yr = dt.getFullYear();
    let hr = dt.getHours();
    const min = String(dt.getMinutes()).padStart(2, '0');
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12 || 12;
    return `${day} ${mon} ${yr}, ${hr}:${min} ${ampm}`;
  };

  let text = '';
  text += `╔═══════════════════════╗\n`;
  text += `║  💎 <b>DEPOSIT HISTORY</b>         ║\n`;
  text += `╚═══════════════════════╝\n\n`;

  text += `┌─── 📊 <b>Summary</b> ─────────┐\n`;
  text += `│  💰 Total: <b>₹${totalAmount.toFixed(2)}</b>\n`;
  text += `│  📦 Transactions: <b>${totalCount}</b>\n`;
  text += `│  📄 Showing: <b>${rows.length}</b> latest\n`;
  text += `└───────────────────────┘\n`;

  rows.forEach((r, i) => {
    const ref = r.gateway_data?.txnRef || r.gateway_data?.paytm_utr || '—';
    const utr = r.gateway_data?.paytm_utr || r.gateway_data?.utr || '';

    text += `\n┌─ <b>#${i + 1}</b> ─────────────────┐\n`;
    text += `│  ✅ <b>₹${parseFloat(r.amount).toFixed(2)}</b>\n`;
    text += `│\n`;
    text += `│  ${gwIcon(r.gateway)} <b>Via:</b> ${gwName(r.gateway)}\n`;
    text += `│  📋 <b>ID:</b>  <code>${r.order_id}</code>\n`;
    text += `│  🔢 <b>Ref:</b> <code>${ref}</code>\n`;
    if (utr && utr !== ref) {
      text += `│  🏦 <b>UTR:</b> <code>${utr}</code>\n`;
    }
    text += `│  📅 ${formatDate(r.created_at)}\n`;
    text += `└───────────────────────┘`;
  });

  text += `\n\n<i>💡 Tap any code to copy it</i>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('✖ Close', 'profile:close_history')
  });
});

composer.callbackQuery('profile:otp_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply('📠 <b>OTP History</b>\n\nNo OTP orders yet.', { parse_mode: 'HTML' });
});

composer.callbackQuery('profile:close_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
});

composer.callbackQuery('profile:email_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply('📧 <b>Email History</b>\n\nNo email orders yet.', { parse_mode: 'HTML' });
});

composer.callbackQuery('profile:transfer', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply('💸 <b>Transfer Balance</b>\n\nThis feature is coming soon.', { parse_mode: 'HTML' });
});

composer.callbackQuery('profile:terms', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const tcButtons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  const tcMessage = await settingsRepo.getSetting(pool, 'tc_message') ||
    "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...";

  const kb = new InlineKeyboard();
  for (const btn of tcButtons) {
    if (btn.url) {
      kb.url(btn.text, btn.url).row();
    }
  }

  if (tcButtons.length === 0) {
    await ctx.reply(
      '📜 <b>Terms And Conditions</b>\n\n' +
      '<i>No terms & conditions page has been set up yet. Contact admin for details.</i>',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await ctx.reply(tcMessage, { parse_mode: 'HTML', reply_markup: kb });
});

export default composer;
