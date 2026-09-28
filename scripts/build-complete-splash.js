const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function lerpColor(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

function multiStopGradient(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].pos && t <= stops[i + 1].pos) {
      const localT = (t - stops[i].pos) / (stops[i + 1].pos - stops[i].pos);
      return lerpColor(stops[i].color, stops[i + 1].color, localT);
    }
  }
  return stops[stops.length - 1].color;
}

// Ultra-refined brushed gold gradient with brilliant metallic highlights and depth
const goldStops = [
  { pos: 0.00, color: [255, 246, 210] }, // Bright champagne reflection
  { pos: 0.16, color: [248, 214, 106] }, // Pure vibrant gold
  { pos: 0.33, color: [224, 175, 48] },  // Rich gold
  { pos: 0.50, color: [255, 248, 222] }, // Shimmering specular sheen
  { pos: 0.68, color: [214, 160, 30] },  // Warm burnished gold
  { pos: 0.86, color: [170, 122, 20] },  // Deep amber
  { pos: 1.00, color: [122, 86, 22] },   // Subtle shadow
];

// Rich graduated metallic emerald-to-dark-green gradient
const greenStops = [
  { pos: 0.00, color: [26, 120, 88] },   // Polished jade metallic sheen
  { pos: 0.22, color: [15, 90, 64] },    // Deep emerald
  { pos: 0.46, color: [30, 130, 96] },   // Highlights
  { pos: 0.70, color: [8, 62, 44] },     // Forest green
  { pos: 0.90, color: [4, 42, 30] },     // Dark deep emerald
  { pos: 1.00, color: [1, 28, 19] },     // Deep base
];

async function chromaKeyWhite(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const threshold = 240;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

async function main() {
  const source = path.resolve('ui-templates/stitch_diva_associations_financial_interface/diva_associations_logo/screen.png');
  const meta = await sharp(source).metadata();
  
  // Extract left half mark
  const rawLeftHalf = await sharp(source)
    .extract({ left: 0, top: 0, width: Math.round(meta.width * 0.5), height: meta.height })
    .toBuffer();
  
  const trimmed = await sharp(rawLeftHalf).trim().toBuffer();
  const transparentMark = await chromaKeyWhite(trimmed);

  const { data, info } = await sharp(transparentMark).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const outputData = Buffer.alloc(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha === 0) {
        outputData[idx] = 0;
        outputData[idx + 1] = 0;
        outputData[idx + 2] = 0;
        outputData[idx + 3] = 0;
        continue;
      }

      const r = data[idx];
      const g = data[idx + 1];
      const isGreen = g > r;

      if (isGreen) {
        const t = (x * 0.65 + y * 0.75) / (width * 0.65 + height * 0.75);
        const [gr, gg, gb] = multiStopGradient(greenStops, t);
        outputData[idx] = gr;
        outputData[idx + 1] = gg;
        outputData[idx + 2] = gb;
        outputData[idx + 3] = alpha;
      } else {
        const t = ((width - x) * 0.45 + y * 0.85) / (width * 0.45 + height * 0.85);
        const [goldR, goldG, goldB] = multiStopGradient(goldStops, t);
        outputData[idx] = goldR;
        outputData[idx + 1] = goldG;
        outputData[idx + 2] = goldB;
        outputData[idx + 3] = alpha;
      }
    }
  }

  // Refined mark PNG
  const refinedMarkBuffer = await sharp(outputData, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();

  const outDir = path.resolve('public/icons');
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'refined-mark.png'), refinedMarkBuffer);

  // SVG text with shimmering gold gradient and elegant letter-spacing
  const textSvg = `
    <svg width="480" height="60" viewBox="0 0 480 60" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#fff4c6" />
          <stop offset="18%" stop-color="#fed65b" />
          <stop offset="45%" stop-color="#fff8dc" />
          <stop offset="72%" stop-color="#e5b839" />
          <stop offset="100%" stop-color="#c99824" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#001810" flood-opacity="0.6"/>
        </filter>
      </defs>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif"
        font-size="34" font-weight="700" letter-spacing="2.5"
        fill="url(#goldGradient)" filter="url(#shadow)">Diva Association</text>
    </svg>
  `;

  const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();

  // Create Lockup: Mark + Text
  const lockupWidth = 480;
  const markScaled = await sharp(refinedMarkBuffer)
    .resize({ width: 280, height: 188, fit: 'contain' })
    .toBuffer();

  const markMeta = await sharp(markScaled).metadata();
  const textMeta = await sharp(textBuffer).metadata();
  const gap = 20;
  const lockupHeight = markMeta.height + gap + textMeta.height;

  const brandLockup = await sharp({
    create: {
      width: lockupWidth,
      height: lockupHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([
    {
      input: markScaled,
      left: Math.round((lockupWidth - markMeta.width) / 2),
      top: 0
    },
    {
      input: textBuffer,
      left: Math.round((lockupWidth - textMeta.width) / 2),
      top: markMeta.height + gap
    }
  ]).png().toBuffer();

  fs.writeFileSync(path.join(outDir, 'brand-lockup.png'), brandLockup);

  const BRAND_BG = { r: 0, g: 53, b: 40, alpha: 255 }; // #003528

  // 1. icon-maskable-512.png (PWA splash screen on Android uses this!)
  const maskable512 = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: BRAND_BG
    }
  }).composite([
    {
      input: await sharp(brandLockup).resize({ width: 330, fit: 'contain' }).toBuffer(),
      gravity: 'centre'
    }
  ]).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), maskable512);

  // 2. icon-maskable-192.png
  const maskable192 = await sharp({
    create: {
      width: 192,
      height: 192,
      channels: 4,
      background: BRAND_BG
    }
  }).composite([
    {
      input: await sharp(brandLockup).resize({ width: 124, fit: 'contain' }).toBuffer(),
      gravity: 'centre'
    }
  ]).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon-maskable-192.png'), maskable192);

  // 3. apple-touch-icon.png (180x180)
  const appleTouch = await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: BRAND_BG
    }
  }).composite([
    {
      input: await sharp(brandLockup).resize({ width: 130, fit: 'contain' }).toBuffer(),
      gravity: 'centre'
    }
  ]).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), appleTouch);

  // 4. icon-512.png (Transparent standard icon)
  const icon512 = await sharp(brandLockup)
    .resize({ width: 440, height: 440, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 36, bottom: 36, left: 36, right: 36,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon-512.png'), icon512);

  // 5. icon-192.png (Transparent standard icon)
  const icon192 = await sharp(brandLockup)
    .resize({ width: 164, height: 164, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 14, bottom: 14, left: 14, right: 14,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon-192.png'), icon192);

  // 6. favicon-32.png
  const favicon32 = await sharp(refinedMarkBuffer)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(outDir, 'favicon-32.png'), favicon32);

  // 7. favicon-16.png
  const favicon16 = await sharp(refinedMarkBuffer)
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(outDir, 'favicon-16.png'), favicon16);

  console.log('All icons generated successfully in public/icons!');
}

main().catch(console.error);
