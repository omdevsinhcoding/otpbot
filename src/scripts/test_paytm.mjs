/**
 * Quick test — mirrors your WORKING Python script exactly.
 * 
 * Usage:
 *   node src/scripts/test_paytm.mjs <MID> <ORDERID>
 * 
 * Example:
 *   node src/scripts/test_paytm.mjs MgjdFH15397320634096 TXN_1716000000_abcd1234
 */

const mid = process.argv[2];
const orderId = process.argv[3];

if (!mid || !orderId) {
  console.log('Usage: node src/scripts/test_paytm.mjs <MID> <ORDERID>');
  process.exit(1);
}

// Mirrors Python exactly:
//   payload = {"MID": MERCHANT_MID, "ORDERID": txn_ref_id}
//   json_data = json.dumps(payload)
//   response = requests.get("https://securegw.paytm.in/order/status", params={"JsonData": json_data})
const payload = { MID: mid, ORDERID: orderId };
const jsonData = JSON.stringify(payload);
const url = `https://securegw.paytm.in/order/status?JsonData=${encodeURIComponent(jsonData)}`;

console.log('=== REQUEST (same as your working Python script) ===');
console.log(`GET ${url}`);
console.log('');

const resp = await fetch(url);
const result = await resp.json();

console.log('=== RESPONSE ===');
console.log(JSON.stringify(result, null, 2));
console.log('');

if (result.STATUS === 'TXN_SUCCESS') {
  console.log('✅ PAYMENT FOUND!');
  console.log(`   Amount: ₹${result.TXNAMOUNT}`);
  console.log(`   UTR:    ${result.BANKTXNID}`);
  console.log(`   TxnID:  ${result.TXNID}`);
} else {
  console.log(`Status: ${result.STATUS}`);
  console.log(`Message: ${result.RESPMSG || 'N/A'}`);
}
