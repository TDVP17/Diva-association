/**
 * One-off asset-generation script — NOT part of the build. Run manually via
 * `npx tsx scripts/generate-pwa-icons.ts` whenever the source logo changes.
 *
 * Crops the icon mark (the "D" + gold ring/arrow) out of the full DIVA
 * Associations lockup (icon + wordmark side by side), pads it to a square
 * canvas, and emits the full PWA/favicon icon set into public/icons/.
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const SOURCE = "C:/Users/Owner/AppData/Local/Temp/logo-extract/screen.png";
const OUT_DIR = path.resolve(__dirname, "../public/icons");
const BRAND_BG = "#003528"; // matches --color-primary in globals.css

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const source = sharp(SOURCE);
  const meta = await source.metadata();
  const width = meta.width!;
  const height = meta.height!;

  // The wordmark sits to the right of the icon mark — a generous left-half
  // crop safely contains the whole mark with none of the text, then
  // `.trim()` removes the surrounding whitespace precisely.
  const rawLeftHalf = await sharp(SOURCE)
    .extract({ left: 0, top: 0, width: Math.round(width * 0.5), height })
    .toBuffer();
  const leftHalf = await sharp(rawLeftHalf).trim().toBuffer();

  const trimmedMeta = await sharp(leftHalf).metadata();
  const markSize = Math.max(trimmedMeta.width!, trimmedMeta.height!);

  // sharp doesn't support chaining multiple `.resize()` calls in a single
  // pipeline (only the last one ends up applied) — each step below is
  // materialized via `.toBuffer()` into a fresh `sharp()` instance so the
  // square-then-pad-then-downscale sequence actually happens in order.
  async function squareIcon(sizePx: number, paddingRatio: number, background: string, fileName: string) {
    const canvas = Math.round(markSize * (1 + paddingRatio * 2));
    const pad = Math.round((canvas - markSize) / 2);

    const squared = await sharp(leftHalf)
      .resize({ width: markSize, height: markSize, fit: "contain", background })
      .toBuffer();
    const padded = await sharp(squared)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background })
      .toBuffer();
    await sharp(padded).resize(sizePx, sizePx, { fit: "cover", background }).png().toFile(path.join(OUT_DIR, fileName));
  }

  // Standard icons: white background, minimal padding.
  await squareIcon(192, 0.08, "#ffffff", "icon-192.png");
  await squareIcon(512, 0.08, "#ffffff", "icon-512.png");
  await squareIcon(180, 0.1, "#ffffff", "apple-touch-icon.png");
  await squareIcon(32, 0.08, "#ffffff", "favicon-32.png");
  await squareIcon(16, 0.08, "#ffffff", "favicon-16.png");

  // Maskable icons: brand-color background, larger safe-zone padding (~20%)
  // so the mark survives Android's circular/rounded-square masking.
  await squareIcon(192, 0.22, BRAND_BG, "icon-maskable-192.png");
  await squareIcon(512, 0.22, BRAND_BG, "icon-maskable-512.png");

  console.log(`Icons written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
