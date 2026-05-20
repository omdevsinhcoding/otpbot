import QRCode from 'qrcode';
import sharp from 'sharp';
import logger from '../utils/logger.js';

/**
 * Generate branded QR payment image — exact replica of Python DreamX style.
 *
 * Layout (800 x 1040):
 *   ┌──────────────────────────────────────────┐
 *   │              🏪 Store Name               │  small green text
 *   │                                          │
 *   │  ┌──────────────────────────────────────┐│
 *   │  │                                      ││
 *   │  │         ▓▓▓▓ QR CODE ▓▓▓▓            ││  huge white card, edge-to-edge
 *   │  │         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓           ││
 *   │  │                                      ││
 *   │  └──────────────────────────────────────┘│
 *   │                                          │
 *   │           Amount ₹12.00                  │  small white
 *   │                                          │
 *   │        Ref: TXN_1779313892_xxx           │  small gray
 *   │        Scan with any UPI app             │  small green
 *   │                                          │
 *   │         Developer: @Erroroo              │  tiny gray
 *   │                                          │
 *   └──────────────────────────────────────────┘
 */
export async function generateBrandedQR({
  storeName = 'OTPBOT',
  amount,
  currency = '₹',
  refId,
  upiLink,
  developer = '@Erroroo',
}) {
  try {
    // ── QR code — huge, nearly full width ────────────────────
    const qrSize = 700;
    const qrBuffer = await QRCode.toBuffer(upiLink, {
      width: qrSize,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });

    // ── Canvas — clean, minimal ──────────────────────────────
    const canvasW = 800;
    const sidePad = 30;                          // small side padding for QR card
    const qrCardW = canvasW - sidePad * 2;       // 740px wide card
    const qrCardH = qrCardW;                     // square card
    const headerH = 70;                          // space for store name
    const qrCardY = headerH;
    const qrCardX = sidePad;
    const footerH = 200;
    const canvasH = headerH + qrCardH + footerH;
    const cx = canvasW / 2;

    // Center QR inside the white card
    const qrPadX = Math.floor((qrCardW - qrSize) / 2);
    const qrPadY = Math.floor((qrCardH - qrSize) / 2);
    const qrX = qrCardX + qrPadX;
    const qrY = qrCardY + qrPadY;

    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // Footer positions
    const f1 = qrCardY + qrCardH + 35;   // Amount
    const f2 = f1 + 35;                   // Ref
    const f3 = f2 + 30;                   // Scan instruction
    const f4 = f3 + 35;                   // Developer

    const svg = `
<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <!-- Dark flat background -->
  <rect width="${canvasW}" height="${canvasH}" fill="#0c0c1e"/>

  <!-- Store name (small, green) -->
  <text x="${cx}" y="45" text-anchor="middle"
        font-family="'Segoe UI', Arial, sans-serif"
        font-size="18" font-weight="600" fill="#2ecc71">
    ${esc(storeName)}
  </text>

  <!-- QR white card — large, nearly edge-to-edge -->
  <rect x="${qrCardX}" y="${qrCardY}"
        width="${qrCardW}" height="${qrCardH}"
        fill="#ffffff" rx="8"/>

  <!-- Thin separator line below QR card -->
  <line x1="${qrCardX + 40}" y1="${qrCardY + qrCardH + 14}"
        x2="${qrCardX + qrCardW - 40}" y2="${qrCardY + qrCardH + 14}"
        stroke="#1a1a3a" stroke-width="1"/>

  <!-- Amount (white, medium) -->
  <text x="${cx}" y="${f1}"
        text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
        font-size="20" font-weight="600" fill="#e0e0e0">
    Amount ${esc(currency)}${esc(String(amount))}
  </text>

  <!-- Ref (gray, small) -->
  <text x="${cx}" y="${f2}"
        text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
        font-size="15" fill="#5a5a7a">
    Ref: ${esc(refId)}
  </text>

  <!-- Scan instruction (green, small) -->
  <text x="${cx}" y="${f3}"
        text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
        font-size="16" font-weight="600" fill="#2ecc71">
    Scan with any UPI app
  </text>

  <!-- Developer (tiny, gray) -->
  <text x="${cx}" y="${f4}"
        text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif"
        font-size="14" fill="#3a3a5a">
    Developer: ${esc(developer)}
  </text>
</svg>`;

    const bgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    const finalImage = await sharp(bgBuffer)
      .composite([{
        input: qrBuffer,
        top: qrY,
        left: qrX,
      }])
      .png()
      .toBuffer();

    return finalImage;
  } catch (err) {
    logger.error(`QR image generation failed: ${err.message}`);
    throw err;
  }
}
