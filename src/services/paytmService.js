import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Generate a UPI payment link and QR code URL
 * @param {string} upiId - Paytm UPI address from admin settings
 * @param {number} amount - Amount in INR
 * @param {string} orderId - Unique order reference
 * @returns {{ upiLink: string, qrUrl: string, txnRef: string }}
 */
export function generatePaymentQR(upiId, amount, orderId) {
  const txnRef = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent('OTP Bot')}&tr=${txnRef}&tn=${encodeURIComponent('Deposit to OTP Bot')}&am=${amount}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiLink)}`;
  return { upiLink, qrUrl, txnRef };
}

/**
 * Check payment status via Paytm merchant API
 * @param {string} merchantKey - Paytm MID
 * @param {string} orderId - The txnRef used in UPI link
 * @returns {Promise<{ success: boolean, amount: number|null, status: string }>}
 */
export async function checkPaymentStatus(merchantKey, orderId) {
  try {
    const paytmUrl = 'https://securegw.paytm.in/merchant-status/getTxnStatus';
    const data = { MID: merchantKey, ORDERID: orderId };
    const checksum = crypto.createHmac('sha256', merchantKey).update(JSON.stringify(data)).digest('hex');
    data.CHECKSUMHASH = checksum;

    const response = await fetch(paytmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();

    if (result.STATUS === 'TXN_SUCCESS') {
      return { success: true, amount: parseFloat(result.TXNAMOUNT), status: result.STATUS };
    }
    return { success: false, amount: null, status: result.STATUS || 'UNKNOWN' };
  } catch (err) {
    logger.error(`Paytm check failed: ${err.message}`);
    return { success: false, amount: null, status: 'ERROR' };
  }
}
