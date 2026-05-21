import logger from '../utils/logger.js';

/**
 * Generate a UPI payment link + txn ref.
 *
 * Mirrors the WORKING Python script exactly:
 *   txn_ref = f"TXN_{timestamp}_{random_8_chars}"
 *   url = f"upi://pay?pa={vpa}&pn={payee}&am={amount}&cu={currency}&tn={note}&tr={txn_ref}"
 *
 * @param {string} upiId   - Merchant UPI VPA
 * @param {number} amount  - Amount in INR
 * @param {string} orderId - Internal order ID (not sent to Paytm)
 * @param {string} payeeName - Payee display name
 * @param {string} paytmQr - Optional paytmqr param (if you have one)
 * @param {string|null} existingTxnRef - Re-use existing ref (for QR rebuild after failed check)
 * @returns {{ upiLink: string, txnRef: string }}
 */
export function generatePaymentQR(upiId, amount, orderId, payeeName = 'Paytm Merchant', paytmQr = '', existingTxnRef = null) {
  let txnRef;
  if (existingTxnRef) {
    txnRef = existingTxnRef;
  } else {
    // Mirrors Python: f"TXN_{int(time.time())}_{random_8_chars}"
    const timestamp = Math.floor(Date.now() / 1000);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < 8; i++) randomStr += chars[Math.floor(Math.random() * chars.length)];
    txnRef = `TXN_${timestamp}_${randomStr}`;
  }

  // Mirrors Python: f"upi://pay?pa={vpa}&pn={payee}&am={amount}&cu={currency}&tn={note}&tr={txn_ref}"
  const encodedPayee = payeeName.replace(/ /g, '%20');
  let upiLink = `upi://pay?pa=${upiId}&pn=${encodedPayee}`;
  if (paytmQr) upiLink += `&paytmqr=${paytmQr}`;
  upiLink += `&am=${amount.toFixed(2)}&cu=INR&tn=Deposit&tr=${txnRef}`;

  logger.info(`[PAYTM] UPI link generated: tr=${txnRef}, amount=${amount.toFixed(2)}, pa=${upiId}`);

  return { upiLink, txnRef };
}

/**
 * Check payment status via Paytm GET API.
 *
 * Mirrors the WORKING Python script exactly:
 *   payload = {"MID": MERCHANT_MID, "ORDERID": txn_ref_id}
 *   json_data = json.dumps(payload)
 *   response = requests.get("https://securegw.paytm.in/order/status", params={"JsonData": json_data})
 *
 *   if status == "TXN_SUCCESS" and mid == MERCHANT_MID and orderid == txn_ref and amount matches:
 *       return True
 *
 * @param {string} mid     - Paytm Merchant ID
 * @param {string} orderId - The txnRef (same as tr= in UPI link)
 * @param {number} expectedAmount - Amount to verify against
 * @returns {Promise<{ success: boolean, amount: number|null, status: string, utr: string|null, txnId: string|null, failed: boolean }>}
 */
export async function checkPaymentStatus(mid, orderId, expectedAmount = 0) {
  try {
    // Mirrors Python: payload = {"MID": mid, "ORDERID": order_id}
    const payload = { MID: mid, ORDERID: orderId };
    const jsonData = JSON.stringify(payload);

    // Mirrors Python: requests.get(STATUS_API_URL, params={"JsonData": json_data})
    const url = `https://securegw.paytm.in/order/status?JsonData=${encodeURIComponent(jsonData)}`;

    logger.info(`[PAYTM] GET /order/status → MID=${mid}, ORDERID=${orderId}`);

    const response = await fetch(url, { method: 'GET', timeout: 10000 });
    const result = await response.json();

    logger.info(`[PAYTM] Response: ${JSON.stringify(result)}`);

    const status = result.STATUS || 'UNKNOWN';
    const responseAmount = parseFloat(result.TXNAMOUNT) || 0;
    const midFromResponse = result.MID || '';
    const orderIdFromResponse = result.ORDERID || '';
    const txnId = result.TXNID || null;
    const utr = result.BANKTXNID || null;

    // Mirrors Python exactly:
    // if status == "TXN_SUCCESS" and mid_from_response == MERCHANT_MID
    //    and orderid_from_response == txn_ref_id and response_amount == expected_amount
    if (
      status === 'TXN_SUCCESS' &&
      midFromResponse === mid &&
      orderIdFromResponse === orderId &&
      (expectedAmount <= 0 || Math.round(responseAmount * 100) === Math.round(expectedAmount * 100))
    ) {
      logger.info(`[PAYTM] ✅ VERIFIED: order=${orderId}, amount=₹${responseAmount}, UTR=${utr}, TXNID=${txnId}`);
      return { success: true, amount: responseAmount, status, utr, txnId, failed: false };
    }

    // Check if genuinely failed (not just "order not found")
    const failed = isPaymentFailed(result);

    return { success: false, amount: null, status, utr: null, txnId: null, failed };
  } catch (err) {
    logger.error(`[PAYTM] API error: ${err.message}`);
    return { success: false, amount: null, status: 'API_ERROR', utr: null, txnId: null, failed: false };
  }
}

/**
 * Check if Paytm payment definitively failed.
 *
 * IMPORTANT: Paytm returns TXN_FAILURE for orders it doesn't know about.
 * The Python script treats TXN_FAILURE as a hard stop, but that's wrong
 * for direct UPI QR — "order not found" is not a real failure.
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
      logger.debug(`[PAYTM] Order not found (not a real failure): ${respMsg}`);
      return false;
    }
  }

  // If there's a TXNID or BANKTXNID, user actually attempted and it failed
  if (response.TXNID || response.BANKTXNID) {
    logger.info(`[PAYTM] Payment genuinely failed: ${respMsg}`);
    return true;
  }

  // Conservative: no txn IDs → treat as pending
  logger.debug(`[PAYTM] TXN_FAILURE but no txn IDs, treating as pending: ${respMsg}`);
  return false;
}
