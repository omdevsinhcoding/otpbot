import { Composer, InlineKeyboard } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe } from './index.js';
import { BTN_DEPOSIT } from '../../utils/constants.js';
import { formatNumber } from '../../utils/formatters.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';

const composer = new Composer();

composer.hears(new RegExp(`^${escRe(BTN_DEPOSIT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

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
    const depositBenefitsService = await import('../../services/depositBenefitsService.js');
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

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

export default composer;
