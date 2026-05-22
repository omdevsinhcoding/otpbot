import QRCode from 'qrcode';
import sharp from 'sharp';

/**
 * Generate branded QR payment image.
 * Mirrors Python DreamX upi.py create_qr_buffer() EXACTLY:
 *
 *   qr = qrcode.QRCode(version=1, error_correction=ERROR_CORRECT_H, box_size=10, border=4)
 *   qr_img = qr.make_image(fill_color="#1a1a2e", back_color="#ffffff")
 *   canvas = Image.new("RGB", (canvas_w, canvas_h), "#0f0f23")
 *   canvas.paste(qr_img, ...)
 *   draw.text(... amount, ref, "Scan with any UPI app", developer ...)
 */
export async function generateBrandedQR({
  storeName = 'OTPBOT',
  amount,
  currency = '₹',
  refId,
  upiLink,
  developer = '@Erroroo',
  subtitle = 'Scan with any UPI app',
}) {
  // ── QR code — matches Python DreamX: ERROR_CORRECT_H, border=4 ──
  // Python uses fill_color="#1a1a2e" (dark blue) — we use black for better scan
  const qrSize = 600;
  const qrBuffer = await QRCode.toBuffer(upiLink, {
    width: qrSize,
    margin: 4,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });

  // ── Canvas layout — mirrors Python DreamX exactly ──
  // Python: padding=60, canvas_w = qr_w + padding*2, canvas_h = qr_h + padding*2 + 155
  const padding = 60;
  const canvasW = qrSize + padding * 2;           // 720
  const canvasH = qrSize + padding * 2 + 155;     // 875
  const cx = canvasW / 2;
  const qrX = padding;
  const qrY = padding + 40;

  // Footer positions — mirrors Python
  const yFooter = qrY + qrSize + 15;

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  // ── SVG background — mirrors Python: Image.new("RGB", ..., "#0f0f23") ──
  const svg = `
<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${canvasW}" height="${canvasH}" fill="#0f0f23"/>

  <text x="${cx}" y="30" text-anchor="middle"
        font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#e94560">
    ${esc(storeName)}
  </text>

  <rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" fill="#ffffff" rx="4"/>

  <text x="${cx}" y="${yFooter}"
        text-anchor="middle" font-family="Arial, sans-serif"
        font-size="18" font-weight="600" fill="#ffffff">
    Amount ${esc(currency)}${esc(String(amount))}
  </text>

  <text x="${cx}" y="${yFooter + 28}"
        text-anchor="middle" font-family="Arial, sans-serif"
        font-size="15" fill="#a0a0a0">
    Ref: ${esc(refId)}
  </text>

  <text x="${cx}" y="${yFooter + 55}"
        text-anchor="middle" font-family="Arial, sans-serif"
        font-size="16" font-weight="600" fill="#16c784">
    ${esc(subtitle)}
  </text>

  <text x="${cx}" y="${yFooter + 80}"
        text-anchor="middle" font-family="Arial, sans-serif"
        font-size="13" fill="#555566">
    Developer: ${esc(developer)}
  </text>
</svg>`;

  const bgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  // Composite QR onto background — same as Python: canvas.paste(qr_img, (padding, padding+40))
  const finalImage = await sharp(bgBuffer)
    .composite([{ input: qrBuffer, top: qrY, left: qrX }])
    .png({ quality: 100, compressionLevel: 0 })
    .toBuffer();

  return finalImage;
}
