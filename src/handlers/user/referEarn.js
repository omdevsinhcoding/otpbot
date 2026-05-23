/**
 * 🎁 REFER & EARN — User-facing referral handler.
 *
 * Layout matching swift_otp style.
 * Buttons: Condition (Telegraph URL), Enter Referral Code, My Referrals, Back
 */
import { Composer, InlineKeyboard } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_REFER_EARN } from '../../utils/constants.js';
import { formatNumber, escapeHtml } from '../../utils/formatters.js';
import * as userRepo from '../../database/repositories/userRepo.js';
import * as referralRepo from '../../database/repositories/referralRepo.js';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import logger from '../../utils/logger.js';

const composer = new Composer();
const _states = new Map();

// ═══════════════════════════════════════════════════════════════════
//  TELEGRAPH T&C PAGE — Lazy creation + caching
// ═══════════════════════════════════════════════════════════════════

/** Build the T&C content as Telegraph Node array */
function buildTCContent(commPct) {
  return [
    { tag: 'h3', children: ['🎁 Refer & Earn — Kaise Kaam Karta Hai?'] },
    { tag: 'p', children: ['Bahut simple hai! Bas 3 steps follow karo:'] },
    { tag: 'br' },
    { tag: 'h4', children: ['Step 1: 📤 Apna Link Share Karo'] },
    { tag: 'p', children: ['Bot me "🎁 Refer & Earn" open karo aur apna unique referral link copy karo. Friends, family ya social media pe share karo!'] },
    { tag: 'br' },
    { tag: 'h4', children: ['Step 2: 👥 Friend Bot Join Kare'] },
    { tag: 'p', children: ['Jab koi apka link use karke bot start kare, wo apka referral ban jaata hai. Apko turant notification milega! 🔔'] },
    { tag: 'br' },
    { tag: 'h4', children: [
      'Step 3: 💰 Har Deposit Pe Kamao (',
      { tag: 'strong', children: [`${commPct}% Commission`] },
      ')'
    ]},
    { tag: 'p', children: ['Jab apka referred friend successful deposit kare, apko commission milta hai! Bonus seedha apke wallet me aata hai.'] },
    { tag: 'br' },
    { tag: 'h4', children: ['💡 Example Samjho'] },
    { tag: 'p', children: [
      `• Friend ₹500 deposit kare → Apko ₹${(500 * commPct / 100).toFixed(0)} milega 🎉`,
    ]},
    { tag: 'p', children: [
      `• Friend ₹1000 deposit kare → Apko ₹${(1000 * commPct / 100).toFixed(0)} milega 💰`,
    ]},
    { tag: 'p', children: [
      `• Friend ₹2000 deposit kare → Apko ₹${(2000 * commPct / 100).toFixed(0)} milega 🤑`,
    ]},
    { tag: 'p', children: [
      { tag: 'strong', children: ['Koi limit nahi! Jitna share karo utna kamao! 🔥'] }
    ]},
    { tag: 'br' },
    { tag: 'hr' },
    { tag: 'h3', children: ['💰 Earnings Kaha Jaata Hai?'] },
    { tag: 'p', children: ['• Commission seedha apke wallet balance me add hota hai'] },
    { tag: 'p', children: ['• Wallet balance se coupons, OTPs ya kuch bhi kharid sakte ho!'] },
    { tag: 'p', children: ['• Koi extra step nahi — fully automatic! ✅'] },
    { tag: 'br' },
    { tag: 'hr' },
    { tag: 'h3', children: ['🚫 Rules — Zaroor Follow Karo'] },
    { tag: 'p', children: ['❌ Self-referral bilkul allowed NAHI hai'] },
    { tag: 'p', children: ['❌ Fake ya duplicate accounts → Bonus cancel hoga'] },
    { tag: 'p', children: ['❌ Suspicious activity → Account block hoga'] },
    { tag: 'p', children: ['✅ Sirf SUCCESSFUL deposits count honge'] },
    { tag: 'p', children: ['✅ Ek user ka ek hi referral code hota hai'] },
    { tag: 'br' },
    { tag: 'hr' },
    { tag: 'h3', children: ['🔥 Abhi Start Karo!'] },
    { tag: 'p', children: [
      'Bot open karo → ',
      { tag: 'strong', children: ['"🎁 Refer & Earn"'] },
      ' tap karo → Link share karo → Earning shuru! 💰'
    ]},
    { tag: 'p', children: [
      { tag: 'em', children: ['Jyada refer = Jyada earning. Simple! 😎'] }
    ]},
  ];
}

/**
 * Get or create the Telegraph T&C page URL.
 * Creates a new Telegraph account + page on first call, caches URL in settings.
 */
async function getTelegraphUrl(pool) {
  // Check cache first
  let url = await settingsRepo.getSetting(pool, 'referral_terms_url');
  if (url) return url;

  try {
    const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;

    // 1. Create Telegraph account
    const accRes = await fetch('https://api.telegra.ph/createAccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        short_name: 'ReferBot',
        author_name: 'Refer & Earn'
      })
    });
    const accData = await accRes.json();
    if (!accData.ok) throw new Error('Telegraph account creation failed');
    const token = accData.result.access_token;

    // Save token for future page updates
    await settingsRepo.setSetting(pool, 'telegraph_token', token);

    // 2. Create the T&C page
    const content = buildTCContent(commPct);
    const pageRes = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        title: '🎁 Refer & Earn — Terms & Conditions',
        content,
        author_name: 'Refer & Earn Bot',
        return_content: false,
      })
    });
    const pageData = await pageRes.json();
    if (!pageData.ok) throw new Error('Telegraph page creation failed');

    url = pageData.result.url;
    await settingsRepo.setSetting(pool, 'referral_terms_url', url);
    return url;
  } catch (err) {
    logger.debug(`Telegraph page creation failed: ${err.message}`);
    return null; // Fallback: no URL available
  }
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN CARD — 🎁 Refer & Earn button
// ═══════════════════════════════════════════════════════════════════
composer.hears(new RegExp(`^${escRe(BTN_REFER_EARN)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  _states.delete(ctx.chat.id);
  await showReferralCard(ctx);
});

composer.callbackQuery('ref:home', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  _states.delete(ctx.chat.id);
  await showReferralCard(ctx, true);
});

async function showReferralCard(ctx, edit = false) {
  const pool = ctx.dbPool;
  const userId = ctx.from.id;

  // Check if referral system is enabled
  const enabled = await settingsRepo.getSetting(pool, 'referral_enabled');
  if (!enabled) {
    const text = `🏆 <b>REFER & EARN</b>\n\n<i>Referral system is currently disabled. Check back later!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:back');
    if (edit) {
      try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    }
    return;
  }

  const user = await userRepo.getUser(pool, userId);
  const refCode = user?.referral_code || 'N/A';
  const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;

  // Stats
  const totalRefs = await referralRepo.getTotalReferralCount(pool, userId);
  const wallet = await referralRepo.getReferralWallet(pool, userId);
  const totalEarned = wallet ? parseFloat(wallet.total_earned) : 0;

  const botInfo = await ctx.api.getMe();
  const refLink = `https://t.me/${botInfo.username}?start=${refCode}`;

  // Get Telegraph URL for Condition button
  const tcUrl = await getTelegraphUrl(pool);

  const text =
    `🎁 <b>REFER & EARN</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔑 <b>Your Referral Code:</b> <code>${refCode}</code>\n` +
    `🔗 <b>Your Referral Link:</b>\n` +
    `<code>${refLink}</code>\n\n` +
    `💰 <b>Referral Balance (${commPct}% On Deposits):</b> ₹${formatNumber(totalEarned)}\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(totalRefs)}`;

  const kb = new InlineKeyboard();
  // Condition button — URL button to Telegraph page
  if (tcUrl) {
    kb.url('📜 Condition', tcUrl).row();
  }
  kb.text('🔗 Enter Referral Code', 'ref:enter_code').row();
  kb.text('👥 My Referrals', 'ref:history:1').row();
  kb.text('◀ Back', 'ref:back');

  if (edit) {
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ENTER REFERRAL CODE
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:enter_code', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);

  if (user?.referred_by) {
    const text = `⚠️ You already have a referrer! You can't change your referral code.`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  _states.set(ctx.chat.id, { step: 'enter_referral_code' });
  const text =
    `🔗 <b>Enter Referral Code</b>\n\n` +
    `Type the referral code you received from a friend:`;
  const kb = new InlineKeyboard().text('❌ Cancel', 'ref:home');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  MY REFERRALS — Paginated
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^ref:history:(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  _states.delete(ctx.chat.id);
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
      `<i>No referrals yet. Share your link to start earning!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
    return;
  }

  let text = `👥 <b>My Referrals</b>  (${formatNumber(totalRefs)} total)\n\n`;

  for (let i = 0; i < referrals.length; i++) {
    const r = referrals[i];
    const num = offset + i + 1;
    const name = escapeHtml(r.full_name || r.username || 'Unknown');
    const date = new Date(r.first_seen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const status = parseInt(r.deposits) > 0 ? '✅ Active' : '⏳ Pending';
    const earned = parseFloat(r.earned) > 0 ? ` — ₹${formatNumber(r.earned)}` : '';
    text += `#${num} ${name} — ${status}${earned}\n`;
    text += `     <i>${date}</i>\n\n`;
  }

  text += `📄 Page ${page}/${totalPages}`;

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀ Prev', `ref:history:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶', `ref:history:${page + 1}`);
  kb.row().text('◀ Back', 'ref:home');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  BACK — Return to main menu
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:back', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  _states.delete(ctx.chat.id);
  try { await ctx.deleteMessage(); } catch {}
  await ctx.reply('Select an option below:', { reply_markup: await menuFor(ctx) });
});

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT — Enter Referral Code
// ═══════════════════════════════════════════════════════════════════
composer.on('message:text', async (ctx, next) => {
  const state = _states.get(ctx.chat?.id);
  if (!state || state.step !== 'enter_referral_code') return next();

  const pool = ctx.dbPool;
  const input = ctx.message.text.trim();
  const kb = new InlineKeyboard().text('◀ Back', 'ref:home');

  try {
    const { rows } = await pool.query(
      'SELECT user_id, full_name FROM users WHERE referral_code = $1', [input]
    );

    if (rows.length === 0) {
      await ctx.reply('⚠️ Invalid referral code. Please check and try again.', { reply_markup: kb });
      return;
    }

    const referrer = rows[0];

    if (referrer.user_id === ctx.from.id) {
      await ctx.reply("⚠️ You can't use your own referral code!", { reply_markup: kb });
      return;
    }

    const user = await userRepo.getUser(pool, ctx.from.id);
    if (user?.referred_by) {
      _states.delete(ctx.chat.id);
      await ctx.reply('⚠️ You already have a referrer!', { reply_markup: kb });
      return;
    }

    // Set referrer
    await pool.query('UPDATE users SET referred_by = $1 WHERE user_id = $2', [referrer.user_id, ctx.from.id]);
    _states.delete(ctx.chat.id);

    const refName = escapeHtml(referrer.full_name || 'a user');
    await ctx.reply(
      `✅ <b>Success!</b>\n\nYou've been referred by <b>${refName}</b>! 🎉`,
      { parse_mode: 'HTML', reply_markup: kb }
    );

    // Notify the referrer
    try {
      const refEnabled = await settingsRepo.getSetting(pool, 'referral_enabled');
      if (refEnabled) {
        const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;
        const joinerName = escapeHtml([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Someone');
        const notifText =
          `🎉 <b>New Referral!</b>\n\n` +
          `👤 <b>${joinerName}</b> joined using your code!\n` +
          `🤑 You'll earn <b>${commPct}%</b> on their deposits!\n\n` +
          `🔥 <i>Keep sharing to earn more!</i>`;
        await ctx.api.sendMessage(referrer.user_id, notifText, { parse_mode: 'HTML' });
      }
    } catch { /* notification failure is non-critical */ }

  } catch {
    await ctx.reply('⚠️ Something went wrong. Please try again.', { reply_markup: kb });
  }
});

export default composer;
