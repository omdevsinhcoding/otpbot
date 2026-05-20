import QRCode from 'qrcode';
import sharp from 'sharp';
import logger from '../utils/logger.js';

/**
 * Generate a branded QR payment image — matches Python upi.py create_qr_buffer() exactly.
 *
 * Layout:
 *   - Dark background #0f0f23
 *   - Store name in #e94560 (red/pink) at top
 *   - QR code (dark #1a1a2e on white) centered
 *   - Amount in white below QR
 *   - Ref in gray #a0a0a0
 *   - "Scan with any UPI app" in green #16c784
 *   - "Developer: @Erroroo" in dim #555566
 *
 * @param {Object} opts
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function generateBrandedQR({
  storeName = 'OTP Bot',
  amount,
  currency = '₹',
  refId,
  upiLink,
  developer = '@Erroroo',
}) {
  try {
    // 1. Generate QR code as PNG buffer — mirrors Python's fill_color="#1a1a2e", back_color="#ffffff"
    const qrSize = 380;
    const qrBuffer = await QRCode.toBuffer(upiLink, {
      width: qrSize,
      margin: 4,
      color: { dark: '#1a1a2e', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });

    // 2. Canvas dimensions — mirrors Python's padding=60, extra 155 for footer
    const padding = 60;
    const imgWidth = qrSize + padding * 2;
    const imgHeight = qrSize + padding * 2 + 155;
    const qrLeft = padding;
    const qrTop = padding + 40;

    // Escape XML entities for SVG
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Footer Y positions — mirrors Python's y_footer calculations
    const yFooter = qrTop + qrSize + 15;

    const svg = `
<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font-family: Arial, Helvetica, sans-serif; font-size: 22px; fill: #e94560; font-weight: bold; }
    .amount { font-family: Arial, Helvetica, sans-serif; font-size: 18px; fill: #ffffff; }
    .ref { font-family: Arial, Helvetica, sans-serif; font-size: 16px; fill: #a0a0a0; }
    .scan { font-family: Arial, Helvetica, sans-serif; font-size: 16px; fill: #16c784; }
    .dev { font-family: Arial, Helvetica, sans-serif; font-size: 13px; fill: #555566; }
  </style>

  <!-- Dark background — #0f0f23 matches Python -->
  <rect width="100%" height="100%" fill="#0f0f23" rx="0"/>

  <!-- Store name — #e94560 matches Python -->
  <text x="${imgWidth / 2}" y="35" text-anchor="middle" class="title">${esc(storeName)}</text>

  <!-- Amount — white #ffffff -->
  <text x="${imgWidth / 2}" y="${yFooter}" text-anchor="middle" class="amount">Amount: ${esc(currency)}${esc(String(amount))}</text>

  <!-- Ref — gray #a0a0a0 -->
  <text x="${imgWidth / 2}" y="${yFooter + 30}" text-anchor="middle" class="ref">Ref: ${esc(refId)}</text>

  <!-- Scan instruction — green #16c784 -->
  <text x="${imgWidth / 2}" y="${yFooter + 60}" text-anchor="middle" class="scan">Scan with any UPI app</text>

  <!-- Developer tag — dim #555566 -->
  <text x="${imgWidth / 2}" y="${yFooter + 87}" text-anchor="middle" class="dev">Developer: ${esc(developer)}</text>
</svg>`;

    // 3. Render SVG to PNG
    const bgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // 4. Composite QR onto branded background
    const finalImage = await sharp(bgBuffer)
      .composite([{ input: qrBuffer, top: qrTop, left: qrLeft }])
      .png()
      .toBuffer();

    return finalImage;
  } catch (err) {
    logger.error(`QR image generation failed: ${err.message}`);
    throw err;
  }
}
