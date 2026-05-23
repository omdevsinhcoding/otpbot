/**
 * Deposit — Menu entry point + common callbacks (cancel, close).
 */
import { Composer, InlineKeyboard } from 'grammy';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import * as transactionRepo from '../../database/repositories/transactionRepo.js';
import * as depositBenefitsService from '../../services/depositBenefitsService.js';
import { formatNumber, escapeHtml } from '../../utils/formatters.js';
import { safeReply, userStates } from './shared.js';
import { stopCryptoAutoCheck } from './crypto.js';

const composer = new Composer();

// ═══════════════════════════════════════════════════════════════════
//  DEPOSIT ENTRY — show payment method buttons
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:menu', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showDepositMenu(ctx);
});

async function showDepositMenu(ctx) {
  const pool = ctx.dbPool;
  const [paytmOn, bharatpayOn, cryptomusOn, minAmount, botName, paytmDisplayName, bharatDisplayName, cryptoDisplayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'paytm_min_amount'),
    settingsRepo.getSetting(pool, 'bot_name'),
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
    settingsRepo.getSetting(pool, 'cryptomus_display_name'),
  ]);
  const balance = await walletRepo.getBalance(pool, ctx.from.id);
  const name = ctx.from.first_name || 'User';

  let text =
    `👋 <b>Hey ${escapeHtml(name)}!</b>\n\n` +
    `💰 <b>Deposit Information</b>\n\n` +
    `💳 <b>Balance:</b> ₹${formatNumber(balance)}\n` +
    `📌 <b>Min Deposit:</b> ₹${minAmount || 1}\n\n` +
    `⚠️ <b>Note:</b> Once deposited, funds are non-refundable.\n` +
    `You can use your balance for all services.\n\n` +
    `👇 <b>Select Payment Method</b>`;

  const benefitsInfo = await depositBenefitsService.getDepositInfoMessage(pool, ctx.from.id);
  if (benefitsInfo && benefitsInfo.text) text += `\n${benefitsInfo.text}`;

  const kb = new InlineKeyboard();
  if (benefitsInfo && benefitsInfo.telegraphUrl) {
    kb.url('📖 Read All Rules', benefitsInfo.telegraphUrl).row();
  }
  if (paytmOn) kb.text(`💎 ${paytmDisplayName || 'UPI'}`, 'deposit:paytm');
  if (cryptomusOn) kb.text(`💎 ${cryptoDisplayName || 'CRYPTO'}`, 'deposit:cryptomus');
  kb.row();
  if (bharatpayOn) kb.text(`🏦 ${bharatDisplayName || 'UPI (Manual)'}`, 'deposit:bharatpay').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Cancel', 'deposit:close');

  await safeReply(ctx, text, { parse_mode: 'HTML', reply_markup: kb });
}

// ═══════════════════════════════════════════════════════════════════
//  COMMON CALLBACKS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:cancel_txn:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const orderId = ctx.callbackQuery.data.replace('deposit:cancel_txn:', '');
  const pool = ctx.dbPool;
  stopCryptoAutoCheck(orderId);

  const txn = await transactionRepo.getByOrderId(pool, orderId);

  await transactionRepo.updateStatus(pool, orderId, 'cancelled');
  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  await ctx.reply(
    `╬══════════════════════╗\n` +
    `   🚫 <b>Payment Cancelled</b>\n` +
    `╚══════════════════════╝\n\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `💰 <b>Amount:</b> ₹${txn ? parseFloat(txn.amount).toFixed(2) : '0.00'}\n\n` +
    `<i>You can create a new order anytime.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Deposit', 'deposit:menu') }
  );
});

composer.callbackQuery('deposit:cancel_state', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  userStates.delete(ctx.chat.id);
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
  await ctx.reply(
    `🚫 <b>Cancelled</b>\n\n<i>Deposit process cancelled. You can start again anytime.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Deposit', 'deposit:menu') }
  );
});

composer.callbackQuery('deposit:close', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
});

export default composer;
