/**
 * Paytm UPI Payment Service
 * Mirrors Python DreamX bot upi.py EXACTLY — zero logging.
 */

/**
 * Generate UPI payment link + txn ref.
 *
 * Python DreamX upi.py param order:
 *   upi://pay?pa={vpa}&pn={payee}[&paytmqr={qr}]&tr={txn_ref}&tn={note}&am={amount}&cu=INR
 */
export function generatePaymentQR(upiId, amount, orderId, payeeName = 'Paytm Merchant', paytmQr = '', existingTxnRef = null) {
  let txnRef;
  if (existingTxnRef) {
    txnRef = existingTxnRef;
  } else {
    const timestamp = Math.floor(Date.now() / 1000);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < 8; i++) randomStr += chars[Math.floor(Math.random() * chars.length)];
    txnRef = `TXN_${timestamp}_${randomStr}`;
  }

  // Mirrors Python DreamX upi.py EXACTLY — same param order
  // Python: f"upi://pay?pa={vpa}&pn={payee}&tr={txn_ref_id}&tn={note}&am={amount:.2f}&cu=INR"
  // tn= uses orderId so it shows in bank statement for manual verification
  let upiLink = `upi://pay?pa=${upiId}&pn=${payeeName}`;
  if (paytmQr) upiLink += `&paytmqr=${paytmQr}`;
  upiLink += `&tr=${txnRef}&tn=${orderId}&am=${amount.toFixed(2)}&cu=INR`;

  return { upiLink, txnRef };
}

/**
 * Check payment status via Paytm GET API.
 * Mirrors Python DreamX verifier.py: GET /order/status?JsonData={"MID":..,"ORDERID":..}
 */
export async function checkPaymentStatus(mid, orderId, expectedAmount = 0) {
  if (!mid || !/^[A-Za-z0-9]+$/.test(mid)) {
    return { success: false, amount: null, status: 'INVALID_MID', utr: null, txnId: null, failed: false };
  }

  try {
    const payload = { MID: mid, ORDERID: orderId };
    const jsonData = JSON.stringify(payload);
    const url = `https://securegw.paytm.in/order/status?JsonData=${encodeURIComponent(jsonData)}`;

    const response = await fetch(url, { method: 'GET' });
    const result = await response.json();

    const status = result.STATUS || 'UNKNOWN';
    const responseAmount = parseFloat(result.TXNAMOUNT) || 0;
    const midFromResponse = result.MID || '';
    const orderIdFromResponse = result.ORDERID || '';
    const txnId = result.TXNID || null;
    const utr = result.BANKTXNID || null;

    if (
      status === 'TXN_SUCCESS' &&
      midFromResponse === mid &&
      orderIdFromResponse === orderId &&
      (expectedAmount <= 0 || Math.round(responseAmount * 100) === Math.round(expectedAmount * 100))
    ) {
      return { success: true, amount: responseAmount, status, utr, txnId, failed: false };
    }

    const failed = isPaymentFailed(result);
    return { success: false, amount: null, status, utr: null, txnId: null, failed };
  } catch {
    return { success: false, amount: null, status: 'API_ERROR', utr: null, txnId: null, failed: false };
  }
}

function isPaymentFailed(response) {
  if (response.STATUS !== 'TXN_FAILURE') return false;
  const respMsg = (response.RESPMSG || '').toLowerCase();
  const notFound = ['order not found', 'no record found', 'invalid order', 'order does not exist', 'no transaction', 'system error'];
  for (const s of notFound) { if (respMsg.includes(s)) return false; }
  if (response.TXNID || response.BANKTXNID) return true;
  return false;
}
