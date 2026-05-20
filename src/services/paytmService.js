import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Generate a UPI payment link
 * Mirrors Python upi.py: generate_upi_intent_url()
 *
 * @param {string} upiId - Paytm UPI address
 * @param {number} amount - Amount in INR
 * @param {string} orderId - Order reference (not used in UPI link)
 * @param {string} payeeName - Payee display name
 * @param {string} paytmQr - Paytm QR code ID (optional)
 * @returns {{ upiLink: string, txnRef: string }}
 */
export function generatePaymentQR(upiId, amount, orderId, payeeName = 'Paytm Merchant', paytmQr = '', existingTxnRef = null) {
  let txnRef;
  if (existingTxnRef) {
    // Re-use existing txnRef when rebuilding QR after failed check
    txnRef = existingTxnRef;
  } else {
    // Generate new: TXN_{timestamp}_{random_8_chars}
    const timestamp = Math.floor(Date.now() / 1000);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < 8; i++) randomStr += chars[Math.floor(Math.random() * chars.length)];
    txnRef = `TXN_${timestamp}_${randomStr}`;
  }

  // Build UPI URL — mirrors Python exactly
  let upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}`;
  if (paytmQr) upiLink += `&paytmqr=${encodeURIComponent(paytmQr)}`;
  upiLink += `&tr=${txnRef}&tn=${encodeURIComponent('Deposit')}&am=${amount.toFixed(2)}&cu=INR`;

  return { upiLink, txnRef };
}

/**
 * Check payment status via Paytm GET API
 * Mirrors Python verifier.py: check_paytm_status()
 *
 * IMPORTANT: Uses GET with JsonData query param — NOT POST with checksum!
 * URL: https://securegw.paytm.in/order/status?JsonData={"MID":"...","ORDERID":"..."}
 *
 * @param {string} mid - Paytm Merchant ID
 * @param {string} orderId - The txnRef (ORDERID for Paytm)
 * @returns {Promise<{ success: boolean, amount: number|null, status: string, utr: string|null, txnId: string|null, failed: boolean }>}
 */
export async function checkPaymentStatus(mid, orderId) {
  try {
    const payload = { MID: mid, ORDERID: orderId };
    const jsonData = JSON.stringify(payload);

    const url = `https://securegw.paytm.in/order/status?JsonData=${encodeURIComponent(jsonData)}`;

    const response = await fetch(url, {
      method: 'GET',
      timeout: 10000,
    });
    const result = await response.json();

    logger.info(`Paytm status for ${orderId}: STATUS=${result.STATUS}, TXNAMOUNT=${result.TXNAMOUNT}`);

    const status = result.STATUS || 'UNKNOWN';
    const responseAmount = parseFloat(result.TXNAMOUNT) || 0;
    const responseOrderId = result.ORDERID || '';
    const txnId = result.TXNID || null;
    const utr = result.BANKTXNID || null;

    // Verify: STATUS == TXN_SUCCESS, MID present, ORDERID matches
    if (
      status === 'TXN_SUCCESS' &&
      result.MID &&
      responseOrderId === orderId
    ) {
      logger.info(`Paytm VERIFIED: order=${orderId}, amount=${responseAmount}, UTR=${utr}, TXNID=${txnId}`);
      return { success: true, amount: responseAmount, status, utr, txnId, failed: false };
    }

    // Check if genuinely failed (mirrors is_payment_failed from Python)
    const failed = isPaymentFailed(result);

    return { success: false, amount: null, status, utr: null, txnId: null, failed };
  } catch (err) {
    logger.error(`Paytm check failed: ${err.message}`);
    return { success: false, amount: null, status: 'API_ERROR', utr: null, txnId: null, failed: false };
  }
}

/**
 * Check if Paytm payment definitively failed.
 * Mirrors Python verifier.py: is_payment_failed()
 *
 * IMPORTANT: Paytm returns TXN_FAILURE for orders it doesn't know about.
 * We must NOT treat "order not found" as a real payment failure.
 */
function isPaymentFailed(response) {
  if (response.STATUS !== 'TXN_FAILURE') return false;

  const respMsg = (response.RESPMSG || '').toLowerCase();
  const notFoundIndicators = [
    'order not found',
    'no record found',
    'invalid order',
    'order does not exist',
    'no transaction',
  ];

  for (const indicator of notFoundIndicators) {
    if (respMsg.includes(indicator)) {
      logger.debug(`Paytm order not found (not a real failure): ${respMsg}`);
      return false;
    }
  }

  // If there's a TXNID or BANKTXNID, user actually attempted payment and it failed
  if (response.TXNID || response.BANKTXNID) {
    logger.info(`Paytm payment genuinely failed: ${respMsg}`);
    return true;
  }

  // Conservative: don't mark as failed without transaction IDs
  logger.debug(`Paytm TXN_FAILURE but no txn IDs, treating as pending: ${respMsg}`);
  return false;
}
