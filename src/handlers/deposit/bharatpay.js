/**
 * Deposit — BharatPay (Manual UPI) gateway flow.
 *
 * Handles: QR display → UTR input → verification.
 */
import { Composer, InlineKeyboard } from 'grammy';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import * as transactionRepo from '../../database/repositories/transactionRepo.js';
import * as bharatpayService from '../../services/bharatpayService.js';
import { escapeHtml } from '../../utils/formatters.js';
import { userStates, safeReply, buildSuccessMessage, applyBenefits, processReferralOnDeposit } from './shared.js';

const composer = new Composer();

// ═══════════════════════════════════════════════════════════════════
//  BHARAT PAY FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:bharatpay', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const qrFileId = await settingsRepo.getSetting(pool, 'bharatpay_qr_file_id');
  const upiId = await settingsRepo.getSetting(pool, 'bharatpay_upi_id');
  const minAmount = await settingsRepo.getSetting(pool, 'bharatpay_min_amount') || 1;

  if (!qrFileId) {
    await safeReply(ctx, '⚠️ Bharat Pay is not configured yet. Contact admin.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'deposit:menu')
    });
    return;
  }

  const text =
    `🏦 <b>Bharat Pay UPI Deposit</b>\n\n` +
    `📱 Scan the QR code and pay using any UPI app.\n` +
    (upiId ? `\n💳 <b>UPI ID:</b> <code>${escapeHtml(upiId)}</code>\n` : '') +
    `\n<b>Minimum:</b> ₹${minAmount}\n\n` +
    `After payment, send your <b>UTR number</b> (12-digit bank reference).`;

  userStates.set(ctx.chat.id, { step: 'bharatpay_utr' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state');
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
  await ctx.replyWithPhoto(qrFileId, { caption: text, parse_mode: 'HTML', reply_markup: kb });
});

// ── Bharat Pay: receive UTR ─────────────────────────────────────
export async function handleBharatpayUTR(ctx) {
  const pool = ctx.dbPool;
  const utr = ctx.message.text.trim();

  if (!/^[a-zA-Z0-9]{1,12}$/.test(utr)) {
    await ctx.reply('⚠️ Invalid UTR. Should be alphanumeric, max 12 chars.', {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }
  if (utr.startsWith('0')) {
    await ctx.reply('⚠️ Invalid UTR. Cannot start with 0.', {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }

  userStates.delete(ctx.chat.id);
  await ctx.reply('🔍 Verifying your payment…');

  const existing = await transactionRepo.getByGatewayTxnId(pool, utr);
  if (existing) {
    await ctx.reply('⚠️ This UTR has already been used.', {
      reply_markup: new InlineKeyboard().text('🔄 Try Again', 'deposit:bharatpay').text('‹ Back', 'deposit:menu')
    });
    return;
  }

  const merchantId = await settingsRepo.getSetting(pool, 'bharatpay_merchant_id');
  const token = await settingsRepo.getSetting(pool, 'bharatpay_token');
  const minAmount = await settingsRepo.getSetting(pool, 'bharatpay_min_amount') || 1;

  if (!merchantId || !token) {
    await ctx.reply('⚠️ Bharat Pay verification not configured. Contact admin.');
    return;
  }

  const result = await bharatpayService.verifyUTR(merchantId, token, utr);

  if (result.found && result.amount >= minAmount) {
    const orderId = `BP_${ctx.from.id}_${Date.now()}`;
    await walletRepo.ensureWallet(pool, ctx.from.id);
    await transactionRepo.createTransaction(pool, {
      userId: ctx.from.id, gateway: 'bharatpay', orderId, amount: result.amount,
      gatewayData: { utr, payerName: result.payerName, payerHandle: result.payerHandle },
    });
    await transactionRepo.updateStatus(pool, orderId, 'success', utr, result);
    await walletRepo.addBalance(pool, ctx.from.id, result.amount);

    const { benefits, newBalance, netCreditAmount } = await applyBenefits(pool, ctx.from.id, result.amount, orderId);
    await processReferralOnDeposit(pool, ctx.api, ctx.from.id, netCreditAmount, orderId);
    await ctx.reply(buildSuccessMessage(result.amount, newBalance, orderId, benefits),
      { parse_mode: 'HTML' }
    );
  } else if (result.found && result.amount < minAmount) {
    await ctx.reply(`⚠️ Payment of ₹${result.amount} is below minimum ₹${minAmount}. Contact support.`);
  } else {
    await ctx.reply('❌ Payment not found. Please check your UTR and try again.', {
      reply_markup: new InlineKeyboard().text('🔄 Try Again', 'deposit:bharatpay').text('‹ Back', 'deposit:menu')
    });
  }
}

export default composer;
