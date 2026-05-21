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
    // Generate numeric-only ref — mirrors PHP: mt_rand(10000000, 9999999999999999)
    // Paytm UPI requires numeric tr= value, letters/underscores get rejected
    // JS can't safely do Math.random on 16-digit ints, so build from parts
    const part1 = Math.floor(Math.random() * 90000000 + 10000000); // 8 digits
    const part2 = Math.floor(Math.random() * 90000000 + 10000000); // 8 digits
    txnRef = `${part1}${part2}`; // 16-digit numeric string
  }

  // Build UPI URL — mirrors PHP get.php exactly (no URL encoding for UPI params)
  // PHP: "upi://pay?pa=paytmqr...@paytm&pn=Paytm%20Merchant&paytmqr=1jr3q358rp&tr=$rnd..."
  const encodedPayee = payeeName.replace(/ /g, '%20');
  let upiLink = `upi://pay?pa=${upiId}&pn=${encodedPayee}`;
  if (paytmQr) upiLink += `&paytmqr=${paytmQr}`;
  upiLink += `&tr=${txnRef}&tn=Deposit&am=${amount.toFixed(2)}&cu=INR`;

  return { upiLink, txnRef };
}

/**
 * Check payment status via Paytm merchant-status API.
 * Mirrors PHP check.php exactly:
 *   POST https://securegw.paytm.in/merchant-status/getTxnStatus
 *   Body: {"MID":"...","ORDERID":"...","CHECKSUMHASH":"hmac-sha256(...)"}
 *
 * @param {string} mid - Paytm Merchant ID (also used as HMAC key)
 * @param {string} orderId - The txnRef (ORDERID for Paytm, same as tr= in UPI link)
 * @returns {Promise<{ success: boolean, amount: number|null, status: string, utr: string|null, txnId: string|null, failed: boolean }>}
 */
export async function checkPaymentStatus(mid, orderId) {
  try {
    const payload = { MID: mid, ORDERID: orderId };

    // Generate CHECKSUMHASH — mirrors PHP: hash_hmac('sha256', json_encode($data), $paytm_merchant_key)
    const checksumData = JSON.stringify(payload);
    const checksum = crypto.createHmac('sha256', mid).update(checksumData).digest('hex');
    payload.CHECKSUMHASH = checksum;

    const jsonBody = JSON.stringify(payload);

    // POST to /merchant-status/getTxnStatus — mirrors PHP check.php exactly
    const response = await fetch('https://securegw.paytm.in/merchant-status/getTxnStatus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonBody,
    });
    const result = await response.json();

    logger.debug(`Paytm status for ${orderId}: STATUS=${result.STATUS}, TXNAMOUNT=${result.TXNAMOUNT}`);

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
      logger.debug(`Paytm VERIFIED: order=${orderId}, amount=${responseAmount}, UTR=${utr}, TXNID=${txnId}`);
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
    logger.debug(`Paytm payment genuinely failed: ${respMsg}`);
    return true;
  }

  // Conservative: don't mark as failed without transaction IDs
  logger.debug(`Paytm TXN_FAILURE but no txn IDs, treating as pending: ${respMsg}`);
  return false;
}
