import { Composer } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as walletRepo from '../database/repositories/walletRepo.js';
import { getMainMenu, MORE_MENU_KEYBOARD, ADMIN_PANEL_KEYBOARD, ADMIN_MENU_KEYBOARD, PAYMENTS_MENU_KEYBOARD } from '../utils/keyboard.js';
import {
  BTN_GET_OTP, BTN_DEPOSIT, BTN_PROFILE, BTN_MORE,
  BTN_BUY_MAIL, BTN_SUPPORT, BTN_REFER_EARN, BTN_READYMADE,
  BTN_GET_EMAIL, BTN_FAVORITE, BTN_PROMO_CODE, BTN_RETURN,
  BTN_TOP_SERVICES, BTN_API, BTN_RESELLER, BTN_ADMIN_PANEL,
  BTN_ADM_BROADCAST, BTN_ADM_USERS, BTN_ADM_FORCEJOIN, BTN_ADM_ADMINS,
  BTN_ADM_WELCOME, BTN_ADM_SETTINGS, BTN_ADM_PAYMENTS, BTN_ADM_BOTSTATS,
  BTN_ADM_LOGS, BTN_ADM_BACK,
  BTN_PAY_PAYTM, BTN_PAY_BHARATPAY, BTN_PAY_CRYPTO, BTN_PAY_BACK,
} from '../utils/constants.js';
import { escapeHtml, formatTimestamp, formatNumber } from '../utils/formatters.js';
import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';
import * as tempMailService from '../services/tempMailService.js';

const composer = new Composer();

// Helper: escape button text for regex
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Helper: get menu for user (checks admin status)
async function menuFor(ctx) {
  const isAdmin = await adminRepo.isAdmin(ctx.dbPool, ctx.from.id);
  return getMainMenu(isAdmin);
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN MENU BUTTONS
// ═══════════════════════════════════════════════════════════════════

// ── 📠 GET OTP ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_OTP)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply(
    '🔑 <b>OTP Service</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ── 💰 DEPOSIT → opens deposit menu with payment options ────────
composer.hears(new RegExp(`^${escRe(BTN_DEPOSIT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;


  // Import dynamically to avoid circular deps
  const walletRepo = await import('../database/repositories/walletRepo.js');
  const settingsRepo = await import('../database/repositories/settingsRepo.js');
  const { InlineKeyboard } = await import('grammy');
  const { formatNumber } = await import('../utils/formatters.js');

  const pool = ctx.dbPool;
  const balance = await walletRepo.getBalance(pool, ctx.from.id);
  const [paytmOn, bharatpayOn, cryptomusOn, paytmName, bharatpayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
  ]);

  let text = `💰 <b>Deposit Funds</b>\n\n💳 <b>Your Balance:</b> ₹${formatNumber(balance)}\n\nChoose a payment method:`;

  const kb = new InlineKeyboard();
  if (paytmOn) kb.text(`💳 ${paytmName || 'Pay via Automatic Gateway'}`, 'deposit:paytm').row();
  if (bharatpayOn) kb.text(`🏦 ${bharatpayName || 'Pay via UTR / Transaction ID'}`, 'deposit:bharatpay').row();
  if (cryptomusOn) kb.text('₿ Cryptomus', 'deposit:cryptomus').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Close', 'deposit:close');

  // Send benefits as separate premium card FIRST
  try {
    const depositBenefitsService = await import('../services/depositBenefitsService.js');
    const result = await depositBenefitsService.getDepositInfoMessage(pool, ctx.from.id);
    if (result && result.text) {
      const benefitsKb = new InlineKeyboard();
      if (result.telegraphUrl) {
        benefitsKb.url('📖 Read All Rules', result.telegraphUrl);
      }
      await ctx.reply(result.text, {
        parse_mode: 'HTML',
        reply_markup: result.telegraphUrl ? benefitsKb : undefined,
      });
    }
  } catch {}

  // Then send deposit menu with buttons
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

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
  const walletMod = await import('../database/repositories/walletRepo.js');
  const wallet = await walletMod.getWallet(pool, ctx.from.id);
  const balance = wallet ? parseFloat(wallet.balance) : 0;
  const totalDeposit = wallet ? parseFloat(wallet.total_deposit) : 0;

  // Count deposits
  const { rows: depRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM transactions WHERE user_id = $1 AND status = 'success'`, [ctx.from.id]
  );
  const depositCount = depRows[0].count;

  // Count referrals
  const { rows: refRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [ctx.from.id]
  );
  const referralCount = refRows[0].count;

  // Count OTP/numbers bought (future-proof: 0 for now)
  const totalBought = 0;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const { InlineKeyboard } = await import('grammy');

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

// ── 🔥 MORE → shows sub-menu reply keyboard ────────────────────
composer.hears(new RegExp(`^${escRe(BTN_MORE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply('🔥 <b>More Options</b>', { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD });
});

// ── 📮 BUY MAIL (main menu — separate feature, NOT temp mail) ───
composer.hears(new RegExp(`^${escRe(BTN_BUY_MAIL)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  await ctx.reply(
    '📮 <b>Buy Mail</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ── 🛡 SUPPORT ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_SUPPORT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  let supportUsername = '';
  try {
    supportUsername = await settingsRepo.getSetting(ctx.dbPool, 'support_username');
  } catch { /* ignore */ }

  const text = supportUsername
    ? `🛡 <b>Support</b>\n\nContact our support: @${escapeHtml(supportUsername)}`
    : '🛡 <b>Support</b>\n\nPlease contact the bot administrator for support.';

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 🎁 REFER & EARN ────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_REFER_EARN)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  const refCode = user?.referral_code || 'N/A';

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [ctx.from.id]
  );
  const count = rows[0].count;

  const botInfo = await ctx.api.getMe();
  const text =
    `🎁 <b>REFER & EARN</b>\n\n` +
    `🔗 <b>Your Referral Link:</b>\n` +
    `https://t.me/${botInfo.username}?start=ref_${refCode}\n\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(count)}\n` +
    `💰 <b>Earnings:</b> Coming Soon\n\n` +
    `Share your link to earn rewards!`;

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 💎 READYMADE ACCOUNT ────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_READYMADE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply(
    '💎 <b>Readymade Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  MORE SUB-MENU BUTTONS
// ═══════════════════════════════════════════════════════════════════

// ── ◀️ RETURN → back to main menu ──────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_RETURN)}$`), async (ctx) => {

  await ctx.reply('🏠 <b>Main Menu</b>', { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 📧 TEMP MAIL (More section) ─────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_EMAIL)}$`), async (ctx) => {
  await handleCreateTempMail(ctx);
});

// ── 😊 Favorite ─────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_FAVORITE)}$`), async (ctx) => {

  await ctx.reply(
    '😊 <b>Favorites</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── Promo Code 👾 ───────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROMO_CODE)}$`), async (ctx) => {

  await ctx.reply(
    '👾 <b>Promo Code</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 📊 TOP SERVICES ────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_TOP_SERVICES)}$`), async (ctx) => {

  await ctx.reply(
    '📊 <b>Top Services</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── ⚙️ API ──────────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_API)}$`), async (ctx) => {

  await ctx.reply(
    '⚙️ <b>API</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 🔮 Reseller Account ────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_RESELLER)}$`), async (ctx) => {

  await ctx.reply(
    '🔮 <b>Reseller Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  🔧 ADMIN PANEL BUTTON — Inline buttons only
// ═══════════════════════════════════════════════════════════════════
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
    reply_markup: ADMIN_PANEL_KEYBOARD,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  📧 TEMP MAIL — DOMAIN PICKER → EMAIL CARD → INBOX LIST → MESSAGE
// ═══════════════════════════════════════════════════════════════════

/**
 * Step 1: Show domain picker (inline buttons).
 */
async function handleCreateTempMail(ctx) {
  try {
    const domains = await tempMailService.fetchDomains();
    if (!domains.length) {
      await ctx.reply('⚠️ <b>Error</b>\n\nNo domains available. Please try again later.', { parse_mode: 'HTML' });
      return;
    }

    const kb = new InlineKeyboard();
    for (let i = 0; i < domains.length; i += 2) {
      kb.text(`📧 @${domains[i]}`, `tm:dom:${domains[i]}`);
      if (domains[i + 1]) {
        kb.text(`📧 @${domains[i + 1]}`, `tm:dom:${domains[i + 1]}`);
      }
      kb.row();
    }
    kb.text('❌ Cancel', 'tm:cancel');

    await ctx.reply(
      '📧 <b>Temporary Email</b>\n\n' +
      'Select a domain to generate your email address:',
      { parse_mode: 'HTML', reply_markup: kb }
    );
  } catch (err) {
    logger.error('Temp mail domain list error:', err);
    await ctx.reply('⚠️ Something went wrong. Please try again.', { parse_mode: 'HTML' });
  }
}

// ── Step 2: Domain selected → create email card ─────────────────
composer.callbackQuery(/^tm:dom:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}

  try {
    const result = await tempMailService.createTempEmail(10, 10);
    if (!result.success) {
      try {
        await ctx.editMessageText('⚠️ <b>Error</b>\n\nCould not generate email. Please try again.', { parse_mode: 'HTML' });
      } catch { /* ignore */ }
      return;
    }

    const text = buildEmailCard(result.email);
    const kb = buildEmailCardKb(result.email);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch { /* ignore */ }
  } catch (err) {
    logger.error('Temp mail create error:', err);
    try { await ctx.editMessageText('⚠️ Something went wrong.', { parse_mode: 'HTML' }); } catch {}
  }
});

// ── Helpers ──────────────────────────────────────────────────────
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function parseFrom(raw) {
  if (!raw) return 'Unknown';
  const decoded = decodeHtmlEntities(raw);
  const match = decoded.match(/^"?([^"<]+)"?\s*<?([^>]+)>?$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    if (name && email && name !== email) return `${name}`;
    return email || name;
  }
  return decoded;
}

function extractOTP(bodyText) {
  if (!bodyText) return null;
  const patterns = [
    /(?:verification|confirm|security|otp|auth)\s*(?:code|pin|number)[\s:]*(\d{4,8})/i,
    /(?:code|pin|otp)[\s:]+(\d{4,8})/i,
    /\b(\d{6})\b/,
  ];
  for (const p of patterns) {
    const m = bodyText.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── Screen 1: Email card (static, short) ────────────────────────
function buildEmailCard(email) {
  return (
    '╔══════════════════════════╗\n' +
    '   📧 <b>Temporary Email</b>\n' +
    '╚══════════════════════════╝\n\n' +
    `✉️ <b>Email:</b>\n<code>${escapeHtml(email)}</code>\n\n` +
    '📭 <i>No messages yet.\nUse this email and tap Check Inbox.</i>'
  );
}

function buildEmailCardKb(email) {
  const token = tempMailService.getToken(email);
  const kb = new InlineKeyboard();
  if (token) {
    kb.url('🌐 Open In Browser', `https://temp-mail.io/en/email/${email}/token/${token}`)
      .row();
  }
  kb.text('📬 Check Inbox', `tm:chk:${email}`)
    .text('🗑 Delete Email', `tm:del:${email}`);
  return kb;
}

// ── Screen 2: Inbox list (compact subject buttons) ──────────────
function buildInboxList(email, messages) {
  let text = '╔══════════════════════════╗\n';
  text += '   📬 <b>Inbox</b>\n';
  text += '╚══════════════════════════╝\n\n';
  text += `✉️ <code>${escapeHtml(email)}</code>\n`;
  text += `📨 <b>${messages.length}</b> message${messages.length > 1 ? 's' : ''}\n\n`;
  text += '<i>Tap a message to read it:</i>';
  return text;
}

function buildInboxListKb(email, messages) {
  const token = tempMailService.getToken(email);
  const kb = new InlineKeyboard();

  // Browser link at top
  if (token) {
    kb.url('🌐 Open In Browser', `https://temp-mail.io/en/email/${email}/token/${token}`).row();
  }

  // Each message = 1 button row showing: "#N · From · Subject (truncated)"
  const show = messages.slice(0, 10); // max 10 buttons
  for (let i = 0; i < show.length; i++) {
    const msg = show[i];
    const from = parseFrom(msg.from);
    const subject = decodeHtmlEntities(msg.subject || '(No Subject)');
    const label = `#${i + 1} · ${from} · ${subject}`.substring(0, 45);
    kb.text(label, `tm:msg:${email}:${i}`).row();
  }

  if (messages.length > 10) {
    kb.text(`… +${messages.length - 10} more (open browser)`, `tm:noop`).row();
  }

  // Bottom actions
  kb.text('🔄 Refresh', `tm:chk:${email}`)
    .text('🗑 Delete', `tm:del:${email}`);
  return kb;
}

// ── Screen 3: Single message detail ─────────────────────────────
function buildMessageDetail(email, msg, index) {
  const from = parseFrom(msg.from);
  const fromEmail = (() => {
    const decoded = decodeHtmlEntities(msg.from || '');
    const m = decoded.match(/<([^>]+)>/);
    return m ? m[1] : '';
  })();
  const subject = decodeHtmlEntities(msg.subject || '(No Subject)');
  const bodyRaw = decodeHtmlEntities(msg.body_text || '');
  const body = bodyRaw.replace(/\n{3,}/g, '\n\n').split('\n').map(l => l.trim()).join('\n').trim();
  const otp = extractOTP(body);

  let text = '┌─────────────────────────┐\n';
  text += `  📩 <b>Message #${index + 1}</b>\n`;
  text += '├─────────────────────────┤\n';
  text += `  📤 <b>From:</b> ${escapeHtml(from)}\n`;
  if (fromEmail) {
    text += `  📧 <code>${escapeHtml(fromEmail)}</code>\n`;
  }
  text += `  📝 <b>Subject:</b>\n  ${escapeHtml(subject)}\n`;

  if (otp) {
    text += `\n  🔑 <b>Verification Code:</b>\n`;
    text += `  ┌──────────────┐\n`;
    text += `  │  <code> ${otp} </code>  │\n`;
    text += `  └──────────────┘\n`;
  }

  if (body) {
    text += `\n  📄 <b>Content:</b>\n`;
    // Show up to 500 chars / 10 lines (single message can be longer)
    const lines = body.split('\n').filter(l => l.trim());
    for (const line of lines.slice(0, 10)) {
      const trimmed = line.substring(0, 60);
      text += `  <i>${escapeHtml(trimmed)}${line.length > 60 ? '…' : ''}</i>\n`;
    }
    if (lines.length > 10) {
      text += '  <i>…</i>\n';
    }
  }

  text += '└─────────────────────────┘';
  return text;
}

function buildMessageDetailKb(email, index, totalMessages) {
  const kb = new InlineKeyboard();

  // Prev / Next navigation
  if (index > 0) {
    kb.text('◀️ Prev', `tm:msg:${email}:${index - 1}`);
  }
  kb.text('📋 Back to Inbox', `tm:chk:${email}`);
  if (index < totalMessages - 1) {
    kb.text('Next ▶️', `tm:msg:${email}:${index + 1}`);
  }
  kb.row();
  kb.text('🗑 Delete Email', `tm:del:${email}`);
  return kb;
}

// ═══════════════════════════════════════════════════════════════════
//  CALLBACK HANDLERS
// ═══════════════════════════════════════════════════════════════════

// ── 📬 Check Inbox → shows inbox list or popup if empty ─────────
composer.callbackQuery(/^tm:chk:/, async (ctx) => {
  const email = ctx.callbackQuery.data.replace('tm:chk:', '');

  const cooldown = tempMailService.isInboxRateLimited(ctx.from.id);
  if (cooldown) {
    try { await ctx.answerCallbackQuery({ text: `⏳ Please wait ${cooldown} second${cooldown > 1 ? 's' : ''}.` }); } catch {}
    return;
  }

  try {
    const result = await tempMailService.checkInbox(email);

    if (!result.success) {
      try { await ctx.answerCallbackQuery({ text: `⚠️ ${result.error}`, show_alert: true }); } catch {}
      return;
    }

    if (result.messages.length === 0) {
      try { await ctx.answerCallbackQuery({ text: '📭 No messages received yet.' }); } catch {}
      return;
    }

    // Cache messages for single-message view
    tempMailService.cacheMessages(email, result.messages);

    try { await ctx.answerCallbackQuery(); } catch {}

    const text = buildInboxList(email, result.messages);
    const kb = buildInboxListKb(email, result.messages);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) logger.error('Inbox list edit error:', e);
    }
  } catch (err) {
    logger.error('Temp mail inbox error:', err);
    try { await ctx.answerCallbackQuery({ text: '⚠️ Something went wrong.', show_alert: true }); } catch {}
  }
});

// ── 📩 View single message ──────────────────────────────────────
composer.callbackQuery(/^tm:msg:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}

  const parts = ctx.callbackQuery.data.replace('tm:msg:', '').split(':');
  const email = parts[0];
  const index = parseInt(parts[1], 10);

  const msg = tempMailService.getCachedMessage(email, index);
  if (!msg) {
    // Cache expired — re-fetch inbox
    try {
      const result = await tempMailService.checkInbox(email);
      if (result.success && result.messages.length > 0) {
        tempMailService.cacheMessages(email, result.messages);
        const freshMsg = result.messages[index];
        if (freshMsg) {
          const text = buildMessageDetail(email, freshMsg, index);
          const kb = buildMessageDetailKb(email, index, result.messages.length);
          try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
          return;
        }
      }
    } catch { /* ignore */ }
    // Fallback: go back to inbox
    try {
      await ctx.editMessageText('⚠️ Message not found. Refreshing inbox...', { parse_mode: 'HTML' });
    } catch {}
    return;
  }

  const cachedMsgs = tempMailService.getCachedMessages(email);
  const total = cachedMsgs ? cachedMsgs.length : index + 1;

  const text = buildMessageDetail(email, msg, index);
  const kb = buildMessageDetailKb(email, index, total);

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch (e) {
    if (!e.message?.includes('message is not modified')) logger.error('Msg detail edit error:', e);
  }
});

// ── Noop (for "more messages" placeholder button) ───────────────
composer.callbackQuery('tm:noop', async (ctx) => {
  try { await ctx.answerCallbackQuery({ text: 'Open in browser to see all messages.' }); } catch {}
});

// ── 🗑 Delete Email → edit message back to domain picker ────────
composer.callbackQuery(/^tm:del:/, async (ctx) => {
  const email = ctx.callbackQuery.data.replace('tm:del:', '');

  try { await tempMailService.deleteTempEmail(email); } catch {}
  try { await ctx.answerCallbackQuery({ text: '🗑 Email deleted.' }); } catch {}

  // Show domain picker again in the SAME message — flow continues
  try {
    const domains = await tempMailService.fetchDomains();
    if (domains.length) {
      const kb = new InlineKeyboard();
      for (let i = 0; i < domains.length; i += 2) {
        kb.text(`📧 @${domains[i]}`, `tm:dom:${domains[i]}`);
        if (domains[i + 1]) {
          kb.text(`📧 @${domains[i + 1]}`, `tm:dom:${domains[i + 1]}`);
        }
        kb.row();
      }
      kb.text('❌ Cancel', 'tm:cancel');

      await ctx.editMessageText(
        '🗑 <i>Previous email deleted.</i>\n\n' +
        '📧 <b>Temporary Email</b>\n\n' +
        'Select a domain to generate a new email:',
        { parse_mode: 'HTML', reply_markup: kb }
      );
      return;
    }
  } catch { /* ignore */ }

  // Fallback if domains fetch fails — just delete the message
  try { await ctx.deleteMessage(); } catch {}
});

// ── ❌ Cancel — just delete the message ──────────────────────────
composer.callbackQuery('tm:cancel', async (ctx) => {
  try { await ctx.deleteMessage(); } catch {}
  try { await ctx.answerCallbackQuery(); } catch {}
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
