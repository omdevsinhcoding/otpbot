import logger from '../utils/logger.js';

/**
 * Binance P2P Rate Service
 * Fetches live INR→crypto rates from Binance P2P API (merchant rates).
 * This is the REAL rate — not Google/CoinGecko approximations.
 *
 * Based on the proven Python approach:
 *   POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search
 */

// ── Cache: asset → { price, fetchedAt } ──────────────────────────
const rateCache = new Map();
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Fetch the live INR price of a crypto asset from Binance P2P.
 * Returns the best merchant BUY price (what a buyer pays per 1 unit of asset).
 *
 * @param {string} asset  - e.g. 'USDT', 'BTC', 'TRX', 'DOGE', 'ETH'
 * @param {string} fiat   - default 'INR'
 * @returns {Promise<{ price: number|null, asset: string, fiat: string, error?: string }>}
 */
export async function getLiveRate(asset = 'USDT', fiat = 'INR') {
  const cacheKey = `${asset}_${fiat}`;
  const cached = rateCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return { price: cached.price, asset, fiat };
  }

  try {
    const data = {
      additionalKycVerifyFilters: 0,
      asset,
      classifies: ['mass', 'profession', 'fiat_trade'],
      countries: [],
      fiat,
      filterType: 'tradable',
      followed: false,
      page: 1,
      payTypes: [],
      periods: [],
      proMerchantAds: false,
      publisherType: 'merchant',
      rows: 5,
      tradeType: 'BUY',
      shieldMerchantAds: false,
      tradedWith: false,
    };

    const response = await fetch(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    );

    const result = await response.json();

    if (!result.data || result.data.length === 0) {
      // Fallback: try SELL side (some assets have no BUY ads)
      data.tradeType = 'SELL';
      const fallbackResponse = await fetch(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      const fallbackResult = await fallbackResponse.json();

      if (!fallbackResult.data || fallbackResult.data.length === 0) {
        logger.warn(`Binance P2P: No ads found for ${asset}/${fiat}`);
        return { price: null, asset, fiat, error: 'No P2P ads available' };
      }

      const price = parseFloat(fallbackResult.data[0].adv.price);
      rateCache.set(cacheKey, { price, fetchedAt: Date.now() });
      return { price, asset, fiat };
    }

    const price = parseFloat(result.data[0].adv.price);
    rateCache.set(cacheKey, { price, fetchedAt: Date.now() });
    return { price, asset, fiat };
  } catch (err) {
    logger.error(`Binance P2P rate fetch failed for ${asset}/${fiat}: ${err.message}`);
    // Return cached value even if stale (better than nothing)
    if (cached) {
      return { price: cached.price, asset, fiat, error: 'Using stale cache' };
    }
    return { price: null, asset, fiat, error: err.message };
  }
}

/**
 * Convert INR amount to crypto amount using live Binance P2P rate.
 * @param {number} inrAmount  - Amount in INR
 * @param {string} asset      - Crypto asset (e.g. 'USDT')
 * @returns {Promise<{ cryptoAmount: string|null, rate: number|null, asset: string, error?: string }>}
 */
export async function convertINRtoCrypto(inrAmount, asset = 'USDT') {
  const rateResult = await getLiveRate(asset, 'INR');
  if (!rateResult.price) {
    return { cryptoAmount: null, rate: null, asset, error: rateResult.error };
  }

  const cryptoAmount = inrAmount / rateResult.price;
  // Determine decimal places based on asset
  let decimals = 6;
  if (['BTC'].includes(asset)) decimals = 8;
  if (['USDT', 'BUSD', 'USDC', 'DAI', 'FDUSD'].includes(asset)) decimals = 2;
  if (['TRX', 'DOGE', 'XRP', 'ADA', 'MATIC', 'SOL'].includes(asset)) decimals = 4;
  if (['ETH', 'BNB', 'LTC'].includes(asset)) decimals = 6;

  return {
    cryptoAmount: cryptoAmount.toFixed(decimals),
    rate: rateResult.price,
    asset,
  };
}

/**
 * Clear the rate cache (useful if admin changes config).
 */
export function clearRateCache() {
  rateCache.clear();
}
