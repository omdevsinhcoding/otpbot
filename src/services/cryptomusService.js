import crypto from 'crypto';
import logger from '../utils/logger.js';

const CRYPTOMUS_API = 'https://api.cryptomus.com/v1';

function makeSign(apiKey, data) {
  const jsonStr = JSON.stringify(data);
  const base64 = Buffer.from(jsonStr).toString('base64');
  return crypto.createHash('md5').update(base64 + apiKey).digest('hex');
}

/**
 * List available payment services (currencies + networks)
 * @param {string} apiKey
 * @param {string} merchantId
 * @returns {Promise<Array<{ currency: string, network: string, is_available: boolean, commission: object, limit: object }>>}
 */
export async function listServices(apiKey, merchantId) {
  try {
    const data = {};
    const sign = makeSign(apiKey, data);
    const response = await fetch(`${CRYPTOMUS_API}/payment/services`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'merchant': merchantId,
        'sign': sign,
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (result.result && Array.isArray(result.result)) {
      // Return ALL coins — don't filter by is_available (dashboard shows 106, API may mark some unavailable temporarily)
      logger.info(`[Cryptomus] Fetched ${result.result.length} services (${result.result.filter(s => s.is_available).length} available)`);
      return result.result;
    }
    logger.error(`Cryptomus listServices error: ${result.message || 'Unknown'}`);
    return [];
  } catch (err) {
    logger.error(`Cryptomus listServices failed: ${err.message}`);
    return [];
  }
}

/**
 * Create a Cryptomus invoice with specific currency + network (gets direct address)
 * @param {string} apiKey
 * @param {string} merchantId
 * @param {{ amount: number, currency?: string, toCurrency: string, network: string, orderId: string, lifetime?: number }} params
 * @returns {Promise<{ success: boolean, paymentUrl?: string, uuid?: string, address?: string, payAmount?: string, payCurrency?: string, error?: string }>}
 */
export async function createInvoice(apiKey, merchantId, { amount, currency = 'INR', toCurrency, network, orderId, lifetime = 3600, urlCallback }) {
  try {
    const data = {
      amount: String(amount),
      currency,
      order_id: orderId,
      lifetime,
      is_payment_multiple: false,
    };
    if (toCurrency) data.to_currency = toCurrency;
    if (network) data.network = network;
    if (urlCallback) data.url_callback = urlCallback;

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
      const r = result.result;
      return {
        success: true,
        paymentUrl: r.url,
        uuid: r.uuid,
        address: r.address || null,
        payAmount: r.payer_amount || r.payment_amount || r.amount,
        payCurrency: r.payer_currency || r.currency,
        network: r.network || network,
      };
    }
    return { success: false, error: result.message || 'Unknown error' };
  } catch (err) {
    logger.error(`Cryptomus create invoice failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Check Cryptomus payment status
 * @param {string} apiKey
 * @param {string} merchantId
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


