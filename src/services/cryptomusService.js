import crypto from 'crypto';
import logger from '../utils/logger.js';

const CRYPTOMUS_API = 'https://api.cryptomus.com/v1';

function makeSign(apiKey, data) {
  const jsonStr = JSON.stringify(data);
  const base64 = Buffer.from(jsonStr).toString('base64');
  return crypto.createHash('md5').update(base64 + apiKey).digest('hex');
}

/**
 * Create a Cryptomus invoice
 * @param {string} apiKey - Cryptomus API key
 * @param {string} merchantId - Cryptomus merchant ID
 * @param {{ amount: number, currency?: string, orderId: string, callbackUrl?: string }} params
 * @returns {Promise<{ success: boolean, paymentUrl?: string, uuid?: string, error?: string }>}
 */
export async function createInvoice(apiKey, merchantId, { amount, currency = 'USD', orderId, callbackUrl }) {
  try {
    const data = {
      amount: String(amount),
      currency,
      order_id: orderId,
      lifetime: 3600,
    };
    if (callbackUrl) data.url_callback = callbackUrl;

    const sign = makeSign(apiKey, data);
    const response = await fetch(`${CRYPTOMUS_API}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'merchant': merchantId,
        'sign': sign,
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (result.result) {
      return { success: true, paymentUrl: result.result.url, uuid: result.result.uuid };
    }
    return { success: false, error: result.message || 'Unknown error' };
  } catch (err) {
    logger.error(`Cryptomus create invoice failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Check Cryptomus payment status
 * @param {string} apiKey - Cryptomus API key
 * @param {string} merchantId - Cryptomus merchant ID
 * @param {string} uuid - Payment UUID from createInvoice
 * @returns {Promise<{ success: boolean, status: string, amount: number|null }>}
 */
export async function checkPayment(apiKey, merchantId, uuid) {
  try {
    const data = { uuid };
    const sign = makeSign(apiKey, data);
    const response = await fetch(`${CRYPTOMUS_API}/payment/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'merchant': merchantId,
        'sign': sign,
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    const status = result?.result?.payment_status;
    const isPaid = ['paid', 'paid_over'].includes(status);
    return {
      success: isPaid,
      status: status || 'unknown',
      amount: result?.result?.amount ? parseFloat(result.result.amount) : null,
    };
  } catch (err) {
    logger.error(`Cryptomus check failed: ${err.message}`);
    return { success: false, status: 'error', amount: null };
  }
}
