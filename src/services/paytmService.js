/**
 * Paytm UPI Payment Service
 * Mirrors PHP get.php EXACTLY — this is what works with Google Pay.
 *
 * PHP format:
 *   $rnd = mt_rand(10000000, 9999999999999999);
 *   upi://pay?pa={vpa}&pn=Paytm%20Merchant&paytmqr={qr}&tr={$rnd}&am={amount}&cu=INR
 *   NO &tn= parameter
 */

/**
 * Generate UPI payment link + txn ref.
 * Matches PHP get.php exactly.
 */
export function generatePaymentQR(upiId, amount, orderId, payeeName = 'Paytm Merchant', paytmQr = '', existingTxnRef = null) {
  let txnRef;
  if (existingTxnRef) {
    txnRef = existingTxnRef;
  } else {
    // Mirrors PHP: mt_rand(10000000, 9999999999999999) — NUMERIC ONLY
    txnRef = String(Math.floor(10000000 + Math.random() * 9999989999999999));
  }

  // Mirrors PHP EXACTLY:
  //   upi://pay?pa={vpa}&pn=Paytm%20Merchant&paytmqr={qr}&tr={$rnd}&am={amount}&cu=INR
  //   - pn is URL-encoded (spaces → %20)
  //   - NO &tn= parameter
  //   - tr is numeric only
  const encodedPayee = encodeURIComponent(payeeName);
  let upiLink = `upi://pay?pa=${upiId}&pn=${encodedPayee}`;
  if (paytmQr) upiLink += `&paytmqr=${paytmQr}`;
  upiLink += `&tr=${txnRef}&am=${amount.toFixed(2)}&cu=INR`;

  return { upiLink, txnRef };
}

/**
 * Check payment status via Paytm GET API.
 * GET /order/status?JsonData={"MID":"...","ORDERID":"..."}
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
