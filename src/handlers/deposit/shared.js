/**
 * Deposit — Shared helpers used by all gateway handlers.
 *
 * Exports: userStates, checkCooldowns, activeChecks, COOLDOWN_MS,
 *          safeReply, buildSuccessMessage, applyBenefits,
 *          _coinEmoji, _networkLabel
 */
import { InlineKeyboard } from 'grammy';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import * as depositBenefitsService from '../../services/depositBenefitsService.js';
import { formatNumber } from '../../utils/formatters.js';

// ── Per-user state map ──────────────────────────────────────────
export const userStates = new Map(); // chatId → { step, gateway, msgId }

// ── Per-user rate limit for Check Payment ───────────────────────
export const checkCooldowns = new Map(); // chatId → timestamp
export const COOLDOWN_MS = 3_000;
export const activeChecks = new Set(); // prevent double-click

// ── Crypto display helpers ──────────────────────────────────────
export function _coinEmoji(coin) {
  const map = {
    'USDT': '🟢', 'BTC': '🟠', 'ETH': '🔵', 'TRX': '🔴',
    'DOGE': '🐶', 'LTC': '⚪', 'BNB': '🟡', 'SOL': '🟣',
    'XRP': '⚫', 'MATIC': '🟣', 'TON': '💎', 'USDC': '🔵',
    'ADA': '🔵', 'AVAX': '🔺', 'SHIB': '🐕', 'DAI': '🟡',
    'DOT': '🩷', 'DASH': '🔵', 'FDUSD': '🟢', 'BUSD': '🟡',
  };
  return map[coin] || '🪙';
}

export function _networkLabel(nw) {
  const map = {
    'tron': 'TRC20', 'bsc': 'BEP20', 'eth': 'ERC20', 'polygon': 'Polygon',
    'arbitrum': 'Arbitrum', 'optimism': 'Optimism', 'avalanche': 'AVAX-C',
    'btc': 'Bitcoin', 'ltc': 'Litecoin', 'doge': 'Dogecoin', 'dash': 'Dash',
    'sol': 'Solana', 'ton': 'TON', 'xrp': 'XRP', 'ada': 'Cardano',
  };
  return map[nw?.toLowerCase()] || nw?.toUpperCase() || nw;
}

// ── Safe reply helper ───────────────────────────────────────────
export async function safeReply(ctx, text, opts = {}) {
  try { await ctx.deleteMessage(); } catch { /* old or already deleted */ }
  return ctx.reply(text, opts);
}

/**
 * Premium deposit success message — unified across all gateways.
 */
export function buildSuccessMessage(amount, newBalance, orderId, benefits = null) {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const mon = String(now.getMonth() + 1).padStart(2, '0');
  const yr = now.getFullYear();
  let hr = now.getHours();
  const min = String(now.getMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  const dateStr = `${day}-${mon}-${yr}  ${hr}:${min} ${ampm}`;

  let msg =
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `     🔥 <b>Dᴇᴘᴏsɪᴛ Sᴜᴄᴄᴇssғᴜʟ</b> 🔥\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `⚡ <b>Aᴍᴏᴜɴᴛ :</b>  ₹${parseFloat(amount).toFixed(2)} INR\n` +
    `💎 <b>Bᴀʟᴀɴᴄᴇ :</b>  ₹${formatNumber(newBalance)} INR\n` +
    `🧾 <b>Oʀᴅᴇʀ  :</b>  <code>${orderId}</code>\n` +
    `📅 <b>Dᴀᴛᴇ   :</b>  ${dateStr}` +
    `</blockquote>\n\n`;

  if (benefits && benefits.active && (benefits.taxAmount > 0 || benefits.bonusAmount > 0)) {
    msg += benefits.userMessage + '\n\n';
  }

  msg += `💗 <i>Tʜᴀɴᴋs Fᴏʀ Yᴏᴜʀ Dᴇᴘᴏsɪᴛ!</i>`;
  return msg;
}

/**
 * Apply deposit benefits (tax/bonus) and return adjusted balance + message.
 * Call AFTER walletRepo.addBalance() for the base deposit.
 */
export async function applyBenefits(pool, userId, depositAmount, orderId) {
  try {
    const benefits = await depositBenefitsService.calculateBenefits(pool, userId, depositAmount, orderId);
    if (!benefits.active) return { benefits: null, newBalance: await walletRepo.getBalance(pool, userId) };

    // adjustBalance handles +bonus, -tax, and 0 in one call
    // Does NOT touch total_deposit (prevents loyalty tier inflation)
    await walletRepo.adjustBalance(pool, userId, benefits.netAdjustment);

    const newBalance = await walletRepo.getBalance(pool, userId);
    return { benefits, newBalance };
  } catch {
    return { benefits: null, newBalance: await walletRepo.getBalance(pool, userId) };
  }
}
