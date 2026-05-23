/**
 * 🎁 REFER & EARN — Premium user-facing referral handler.
 *
 * Sections:
 * - Main summary card with stats + inline buttons
 * - My Earnings (paginated reward history)
 * - My Referrals (list of referred users)
 * - Transfer to Wallet (referral → main wallet)
 * - Leaderboard (top referrers, anonymized)
 * - Terms & Rules
 */
import { Composer, InlineKeyboard } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_REFER_EARN } from '../../utils/constants.js';
import { formatNumber, escapeHtml, formatTimestamp } from '../../utils/formatters.js';
import * as userRepo from '../../database/repositories/userRepo.js';
import * as referralRepo from '../../database/repositories/referralRepo.js';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';

const composer = new Composer();

// ── Helpers ─────────────────────────────────────────────────────
function anonymize(name) {
  if (!name) return '***';
  const clean = name.replace(/[^a-zA-Z0-9\u0900-\u097F]/g, '');
  if (clean.length <= 2) return clean + '***';
  return clean.slice(0, 3) + '***';
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN CARD — 🎁 Refer & Earn button
// ═══════════════════════════════════════════════════════════════════
composer.hears(new RegExp(`^${escRe(BTN_REFER_EARN)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  await showReferralCard(ctx);
});

// Also handle callback to refresh/show card
composer.callbackQuery('ref:home', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showReferralCard(ctx, true);
});

async function showReferralCard(ctx, edit = false) {
  const pool = ctx.dbPool;
  const userId = ctx.from.id;

  // Check if referral system is enabled
  const enabled = await settingsRepo.getSetting(pool, 'referral_enabled');
  if (!enabled) {
    const text = `🎁 <b>REFER & EARN</b>\n\n<i>Referral system is currently disabled. Check back later!</i>`;
    if (edit) {
      try { await ctx.editMessageText(text, { parse_mode: 'HTML' }); } catch {}
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
    }
    return;
  }

  const user = await userRepo.getUser(pool, userId);
  const refCode = user?.referral_code || 'N/A';
  const commissionPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;

  // Get stats
  const totalRefs = await referralRepo.getTotalReferralCount(pool, userId);
  const successRefs = await referralRepo.getSuccessfulReferralCount(pool, userId);
  const wallet = await referralRepo.getReferralWallet(pool, userId);
  const balance = wallet ? parseFloat(wallet.balance) : 0;
  const totalEarned = wallet ? parseFloat(wallet.total_earned) : 0;

  const botInfo = await ctx.api.getMe();
  const refLink = `https://t.me/${botInfo.username}?start=${refCode}`;

  const text =
    `╔═══════════════════════════╗\n` +
    `    🎁  <b>REFER & EARN</b>\n` +
    `╚═══════════════════════════╝\n\n` +
    `<blockquote>` +
    `🔗 <b>Your Referral Link:</b>\n` +
    `<code>${refLink}</code>\n\n` +
    `🔑 <b>Code:</b> <code>${refCode}</code>` +
    `</blockquote>\n\n` +
    `━━━━━ 📊 <b>Your Stats</b> ━━━━━\n\n` +
    `  👥  <b>Total Referrals:</b>     ${formatNumber(totalRefs)}\n` +
    `  ✅  <b>Successful:</b>           ${formatNumber(successRefs)}\n` +
    `  💰  <b>Total Earned:</b>    ₹${formatNumber(totalEarned)}\n` +
    `  💳  <b>Referral Wallet:</b> ₹${formatNumber(balance)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔥 <i>Share & earn ${commissionPct}% on every deposit!</i>`;

  const kb = new InlineKeyboard()
    .text('🔗 Share Link', 'ref:share').text('💰 My Earnings', 'ref:earnings:1').row()
    .text('👥 My Referrals', 'ref:referrals:1').text('💳 Transfer to Wallet', 'ref:transfer').row()
    .text('🏆 Leaderboard', 'ref:leaderboard').text('📜 Terms & Rules', 'ref:terms');

  if (edit) {
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SHARE LINK — Show copyable link
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:share', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  const refCode = user?.referral_code || 'N/A';
  const botInfo = await ctx.api.getMe();
  const refLink = `https://t.me/${botInfo.username}?start=${refCode}`;
  const commissionPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;

  const text =
    `🔗 <b>Your Referral Link</b>\n\n` +
    `<blockquote>` +
    `<code>${refLink}</code>` +
    `</blockquote>\n\n` +
    `📋 <i>Tap the link above to copy it!</i>\n\n` +
    `✨ <b>How it works:</b>\n` +
    `1️⃣ Share your link with friends\n` +
    `2️⃣ They join using your link\n` +
    `3️⃣ When they deposit, you earn <b>${commissionPct}%</b>\n\n` +
    `💡 <i>More friends = more earnings!</i>`;

  const kb = new InlineKeyboard()
    .text('◀ Back', 'ref:home');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  MY EARNINGS — Paginated reward history
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^ref:earnings:(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const page = parseInt(ctx.match[1]) || 1;
  const perPage = 8;
  const offset = (page - 1) * perPage;

  const { rewards, total } = await referralRepo.getRewardsByReferrer(pool, ctx.from.id, perPage, offset);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (total === 0) {
    const text =
      `💰 <b>My Earnings</b>\n\n` +
      `<i>No earnings yet. Share your referral link to start earning!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
    return;
  }

  let text = `💰 <b>My Earnings</b>  (${formatNumber(total)} total)\n\n`;

  for (const r of rewards) {
    const status = r.status === 'credited' ? '✅' : r.status === 'reversed' ? '❌' : '⏸';
    const name = anonymize(r.referred_name);
    const date = formatTimestamp(r.created_at);
    text += `${status} ₹${formatNumber(r.reward_amount)} — ${escapeHtml(name)} — ${date}\n`;
    text += `   <i>${r.tag}</i>\n\n`;
  }

  text += `📄 Page ${page}/${totalPages}`;

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀ Prev', `ref:earnings:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶', `ref:earnings:${page + 1}`);
  kb.row().text('◀ Back', 'ref:home');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  MY REFERRALS — List of referred users
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^ref:referrals:(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const page = parseInt(ctx.match[1]) || 1;
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const totalRefs = await referralRepo.getTotalReferralCount(pool, ctx.from.id);
  const referrals = await referralRepo.getReferralsByUser(pool, ctx.from.id, perPage, offset);
  const totalPages = Math.max(1, Math.ceil(totalRefs / perPage));

  if (totalRefs === 0) {
    const text =
      `👥 <b>My Referrals</b>\n\n` +
      `<i>No referrals yet. Share your link to invite friends!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
    return;
  }

  let text = `👥 <b>My Referrals</b>  (${formatNumber(totalRefs)} total)\n\n`;

  for (const r of referrals) {
    const name = anonymize(r.full_name);
    const status = r.deposits > 0 ? '✅ Active' : '⏳ Pending';
    const earned = parseFloat(r.earned) > 0 ? ` — ₹${formatNumber(r.earned)}` : '';
    text += `👤 ${escapeHtml(name)} — ${status}${earned}\n`;
    text += `   <i>Joined ${formatTimestamp(r.first_seen)}</i>\n\n`;
  }

  text += `📄 Page ${page}/${totalPages}`;

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀ Prev', `ref:referrals:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶', `ref:referrals:${page + 1}`);
  kb.row().text('◀ Back', 'ref:home');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  TRANSFER TO WALLET — Referral wallet → Main wallet
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:transfer', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const transferEnabled = await settingsRepo.getSetting(pool, 'referral_transfer_enabled');
  if (!transferEnabled) {
    const text = `💳 <b>Transfer</b>\n\n<i>Transfers are currently disabled by admin.</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  const wallet = await referralRepo.getReferralWallet(pool, ctx.from.id);
  const balance = wallet ? parseFloat(wallet.balance) : 0;
  const minTransfer = parseFloat(await settingsRepo.getSetting(pool, 'referral_min_transfer')) || 50;

  if (wallet?.is_frozen) {
    const text = `💳 <b>Transfer</b>\n\n⚠️ <i>Your referral wallet is frozen. Contact support.</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  if (balance < minTransfer) {
    const text =
      `💳 <b>Transfer to Main Wallet</b>\n\n` +
      `<blockquote>` +
      `💰 <b>Referral Wallet:</b> ₹${formatNumber(balance)}\n` +
      `📌 <b>Minimum Transfer:</b> ₹${formatNumber(minTransfer)}` +
      `</blockquote>\n\n` +
      `⚠️ <i>You need at least ₹${formatNumber(minTransfer)} to transfer.</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  const text =
    `💳 <b>Transfer to Main Wallet</b>\n\n` +
    `<blockquote>` +
    `💰 <b>Referral Wallet:</b> ₹${formatNumber(balance)}\n` +
    `📌 <b>Minimum Transfer:</b> ₹${formatNumber(minTransfer)}` +
    `</blockquote>\n\n` +
    `👇 <b>Select amount to transfer:</b>`;

  // Build preset amounts (25%, 50%, 75%, 100% of balance)
  const presets = [
    Math.floor(balance * 0.25),
    Math.floor(balance * 0.5),
    Math.floor(balance * 0.75),
    Math.floor(balance),
  ].filter(a => a >= minTransfer);

  // Remove duplicates
  const uniquePresets = [...new Set(presets)];

  const kb = new InlineKeyboard();
  for (let i = 0; i < uniquePresets.length; i += 2) {
    kb.text(`₹${formatNumber(uniquePresets[i])}`, `ref:transfer_amt:${uniquePresets[i]}`);
    if (uniquePresets[i + 1]) kb.text(`₹${formatNumber(uniquePresets[i + 1])}`, `ref:transfer_amt:${uniquePresets[i + 1]}`);
    kb.row();
  }
  // Always show "Transfer All" if balance >= minTransfer
  if (!uniquePresets.includes(Math.floor(balance))) {
    kb.text(`💯 Transfer All (₹${formatNumber(Math.floor(balance))})`, `ref:transfer_amt:${Math.floor(balance)}`).row();
  }
  kb.text('◀ Back', 'ref:home');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Transfer: Amount selected → Confirm ─────────────────────────
composer.callbackQuery(/^ref:transfer_amt:(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const amount = parseInt(ctx.match[1]);
  const pool = ctx.dbPool;

  const wallet = await referralRepo.getReferralWallet(pool, ctx.from.id);
  const balance = wallet ? parseFloat(wallet.balance) : 0;
  const minTransfer = parseFloat(await settingsRepo.getSetting(pool, 'referral_min_transfer')) || 50;

  if (amount < minTransfer || amount > balance) {
    try { await ctx.answerCallbackQuery({ text: '⚠️ Invalid amount', show_alert: true }); } catch {}
    return;
  }

  const text =
    `💳 <b>Confirm Transfer</b>\n\n` +
    `<blockquote>` +
    `💸 <b>Transfer Amount:</b> ₹${formatNumber(amount)}\n` +
    `💰 <b>Current Referral Wallet:</b> ₹${formatNumber(balance)}\n` +
    `💳 <b>After Transfer:</b> ₹${formatNumber(balance - amount)}` +
    `</blockquote>\n\n` +
    `<i>This will transfer ₹${formatNumber(amount)} from your referral wallet to your main wallet.</i>`;

  const kb = new InlineKeyboard()
    .text('✅ Confirm Transfer', `ref:transfer_confirm:${amount}`).row()
    .text('◀ Back', 'ref:transfer');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Transfer: Confirmed → Execute ────────────────────────────────
composer.callbackQuery(/^ref:transfer_confirm:(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const amount = parseInt(ctx.match[1]);
  const pool = ctx.dbPool;

  try {
    // Check daily/monthly limits
    const dailyLimit = parseFloat(await settingsRepo.getSetting(pool, 'referral_daily_transfer_limit')) || 5000;
    const monthlyLimit = parseFloat(await settingsRepo.getSetting(pool, 'referral_monthly_transfer_limit')) || 50000;
    const dailyTotal = await referralRepo.getDailyTransferTotal(pool, ctx.from.id);
    const monthlyTotal = await referralRepo.getMonthlyTransferTotal(pool, ctx.from.id);

    if (dailyTotal + amount > dailyLimit) {
      const text = `⚠️ <b>Daily limit reached</b>\n\nDaily limit: ₹${formatNumber(dailyLimit)}\nUsed today: ₹${formatNumber(dailyTotal)}\n\n<i>Try again tomorrow.</i>`;
      const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
      try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
      return;
    }

    if (monthlyTotal + amount > monthlyLimit) {
      const text = `⚠️ <b>Monthly limit reached</b>\n\nMonthly limit: ₹${formatNumber(monthlyLimit)}\nUsed this month: ₹${formatNumber(monthlyTotal)}\n\n<i>Try again next month.</i>`;
      const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
      try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
      return;
    }

    // Execute transfer
    await referralRepo.transferToMainWallet(pool, ctx.from.id, amount);

    const refBalance = await referralRepo.getReferralBalance(pool, ctx.from.id);
    const mainBalance = await walletRepo.getBalance(pool, ctx.from.id);

    const text =
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   ✅ <b>Transfer Successful</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `💸 <b>Transferred:</b> ₹${formatNumber(amount)}\n` +
      `💳 <b>Referral Wallet:</b> ₹${formatNumber(refBalance)}\n` +
      `💰 <b>Main Wallet:</b> ₹${formatNumber(mainBalance)}` +
      `</blockquote>\n\n` +
      `💗 <i>Keep earning through referrals!</i>`;

    const kb = new InlineKeyboard().text('🎁 Refer & Earn', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }

  } catch (err) {
    const errText = err.message.includes('Insufficient') || err.message.includes('frozen')
      ? `⚠️ ${err.message}`
      : '⚠️ Transfer failed. Please try again.';
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(errText, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
  }
});

// ═══════════════════════════════════════════════════════════════════
//  LEADERBOARD — Top referrers (anonymized)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:leaderboard', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const topRefs = await referralRepo.getTopReferrers(pool, 10);

  if (topRefs.length === 0) {
    const text = `🏆 <b>Leaderboard</b>\n\n<i>No referrers yet. Be the first!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  let text = `🏆 <b>Top Referrers</b>\n\n`;

  for (let i = 0; i < topRefs.length; i++) {
    const r = topRefs[i];
    const rank = i < 3 ? medals[i] : `#${i + 1}`;
    const name = anonymize(r.full_name);
    const isMe = r.user_id === ctx.from.id;
    text += `${rank}  ${escapeHtml(name)}${isMe ? ' (You)' : ''}\n`;
    text += `    👥 ${r.referral_count} referrals  •  ₹${formatNumber(r.total_earned)} earned\n\n`;
  }

  // Check if current user is in top 10
  const userInTop = topRefs.some(r => r.user_id === ctx.from.id);
  if (!userInTop) {
    const wallet = await referralRepo.getReferralWallet(pool, ctx.from.id);
    const totalRefs = await referralRepo.getTotalReferralCount(pool, ctx.from.id);
    const totalEarned = wallet ? parseFloat(wallet.total_earned) : 0;
    if (totalEarned > 0) {
      text += `━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `📍 <b>Your Position:</b> Not in top 10\n`;
      text += `    👥 ${totalRefs} referrals  •  ₹${formatNumber(totalEarned)} earned\n`;
    }
  }

  const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  TERMS & RULES
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:terms', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const terms = await settingsRepo.getSetting(pool, 'referral_terms') ||
    '📜 No referral terms set yet. Contact admin.';

  const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
  try { await ctx.editMessageText(terms, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(terms, { parse_mode: 'HTML', reply_markup: kb }); }
});

export default composer;
