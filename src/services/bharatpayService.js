import logger from '../utils/logger.js';

/**
 * Verify UTR via BharatPe merchant API
 * @param {string} merchantId - BharatPe merchant ID
 * @param {string} token - BharatPe API token
 * @param {string} utrNumber - Bank reference / UTR number
 * @returns {Promise<{ found: boolean, amount: number|null, payerName: string|null, payerHandle: string|null }>}
 */
export async function verifyUTR(merchantId, token, utrNumber) {
  try {
    const url = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?module=PAYMENT_QR&merchantId=${merchantId}`;
    const response = await fetch(url, {
      headers: { 'token': token },
    });
    const result = await response.json();
    const transactions = result?.data?.transactions || [];

    for (const txn of transactions) {
      if (txn.bankReferenceNo === utrNumber) {
        return {
          found: true,
          amount: parseFloat(txn.amount),
          payerName: txn.payerName || null,
          payerHandle: txn.payerHandle || null,
        };
      }
    }
    return { found: false, amount: null, payerName: null, payerHandle: null };
  } catch (err) {
    logger.error(`BharatPe verify failed: ${err.message}`);
    return { found: false, amount: null, payerName: null, payerHandle: null };
  }
}
