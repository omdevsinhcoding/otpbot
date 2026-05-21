/**
 * Quick test: calls Paytm /merchant-status/getTxnStatus
 * 
 * Usage:
 *   node src/scripts/test_paytm.mjs <MID> <ORDERID>
 * 
 * Example:
 *   node src/scripts/test_paytm.mjs MgjdFH15397320634096 4829105736281947
 * 
 * This mirrors your PHP check.php exactly:
 *   POST https://securegw.paytm.in/merchant-status/getTxnStatus
 *   Body: {"MID":"...","ORDERID":"...","CHECKSUMHASH":"hmac-sha256(...)"}
 */

import crypto from 'crypto';

const mid = process.argv[2];
const orderId = process.argv[3];

if (!mid || !orderId) {
  console.log('Usage: node src/scripts/test_paytm.mjs <MID> <ORDERID>');
  console.log('Example: node src/scripts/test_paytm.mjs MgjdFH15397320634096 4829105736281947');
  process.exit(1);
}

// Build payload — same as PHP
const payload = { MID: mid, ORDERID: orderId };

// Checksum — mirrors PHP: hash_hmac('sha256', json_encode($data), $paytm_merchant_key)
const checksumData = JSON.stringify(payload);
const checksum = crypto.createHmac('sha256', mid).update(checksumData).digest('hex');
payload.CHECKSUMHASH = checksum;

const jsonBody = JSON.stringify(payload);

console.log('=== REQUEST ===');
console.log('URL:  POST https://securegw.paytm.in/merchant-status/getTxnStatus');
console.log('Body:', jsonBody);
console.log('');

// Make the request
const response = await fetch('https://securegw.paytm.in/merchant-status/getTxnStatus', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: jsonBody,
});

const result = await response.json();

console.log('=== RESPONSE ===');
console.log('HTTP Status:', response.status);
console.log('Body:', JSON.stringify(result, null, 2));
console.log('');

if (result.STATUS === 'TXN_SUCCESS') {
  console.log('✅ PAYMENT FOUND!');
  console.log(`   Amount: ${result.TXNAMOUNT}`);
  console.log(`   UTR:    ${result.BANKTXNID}`);
  console.log(`   TxnID:  ${result.TXNID}`);
} else {
  console.log(`❌ Status: ${result.STATUS}`);
  console.log(`   Message: ${result.RESPMSG || 'N/A'}`);
}
