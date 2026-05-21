import logger from '../utils/logger.js';

/**
 * Generate a UPI payment link + txn ref.
 *
 * Mirrors the WORKING Python script exactly:
 *   txn_ref = f"TXN_{timestamp}_{random_8_chars}"
 *   url = f"upi://pay?pa={vpa}&pn={payee}&am={amount}&cu={currency}&tn={note}&tr={txn_ref}"
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

  // Mirrors Python EXACTLY: f"upi://pay?pa={vpa}&pn={payee}&am={amount}&cu={currency}&tn={note}&tr={txn_ref}"
  // Python does NOT encode spaces or any params — raw string
  let upiLink = `upi://pay?pa=${upiId}&pn=${payeeName}&am=${amount.toFixed(2)}&cu=INR&tn=Deposit&tr=${txnRef}`;
  if (paytmQr) upiLink = `upi://pay?pa=${upiId}&pn=${payeeName}&paytmqr=${paytmQr}&am=${amount.toFixed(2)}&cu=INR&tn=Deposit&tr=${txnRef}`;

  // Production-safe log — NO sensitive data
  logger.info(`[PAYTM] QR generated: tr=${txnRef}, amount=${amount.toFixed(2)}`);

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
 */
export async function checkPaymentStatus(mid, orderId, expectedAmount = 0) {
  // Validate MID before calling API
  if (!mid || !/^[A-Za-z0-9]+$/.test(mid)) {
    logger.error(`[PAYTM] Invalid MID detected: "${mid ? mid.substring(0, 10) : 'null'}..." — fix it in Admin → Payments → Set MID`);
    return { success: false, amount: null, status: 'INVALID_MID', utr: null, txnId: null, failed: false };
  }

  try {
    // Mirrors Python: payload = {"MID": mid, "ORDERID": order_id}
    const payload = { MID: mid, ORDERID: orderId };
    const jsonData = JSON.stringify(payload);

    // Mirrors Python: requests.get(STATUS_API_URL, params={"JsonData": json_data})
    const url = `https://securegw.paytm.in/order/status?JsonData=${encodeURIComponent(jsonData)}`;

    logger.debug(`[PAYTM] Checking: ORDERID=${orderId}`);

    const response = await fetch(url, { method: 'GET' });
    const result = await response.json();

    const status = result.STATUS || 'UNKNOWN';

    // Production-safe log — only status, no MID/keys
    logger.info(`[PAYTM] Status: ${status} for ${orderId}${status === 'TXN_SUCCESS' ? ` amount=${result.TXNAMOUNT}` : ''}`);

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
      logger.info(`[PAYTM] ✅ VERIFIED: order=${orderId}, UTR=${utr}`);
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
 * "order not found" is NOT a real failure — it just means Paytm hasn't
 * processed the UPI payment yet.
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
    'system error',
  ];

  for (const indicator of notFoundIndicators) {
    if (respMsg.includes(indicator)) {
      return false;
    }
  }

  // If there's a TXNID or BANKTXNID, user actually attempted and it failed
  if (response.TXNID || response.BANKTXNID) {
    logger.info(`[PAYTM] Payment genuinely failed: ${respMsg}`);
    return true;
  }

  // Conservative: no txn IDs → treat as pending
  return false;
}
