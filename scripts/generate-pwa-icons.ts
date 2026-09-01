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

/**
 * The source lockup has a flat white background with no alpha channel —
 * turns every near-white pixel transparent so the icon mark (dark green +
 * gold, both far from white) sits on a real transparent background instead
 * of a white square. A hard 245/255 threshold is enough here since there's
 * no color anywhere near white in the actual mark, only in its background
 * and the negative space inside the "D"/ring.
 */
async function chromaKeyWhite(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const threshold = 245;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels as 4 } })
    .png()
    .toBuffer();
}

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
  //
  // Geometry always happens against a white backdrop (so contain/extend
  // math and edge anti-aliasing stay identical either way), and the white
  // is ALWAYS chroma-keyed away afterward — including the white filling the
  // mark's own negative space (inside the "D"/ring), not just the padding
  // sharp added. Skipping that step for "opaque" mode was the previous bug:
  // apple-touch-icon/maskable icons ended up with a visible white patch
  // baked in behind the logo instead of the brand-green backdrop. "opaque"
  // mode (apple-touch-icon, which iOS renders transparency as solid black
  // on, and the maskable icons, which need a solid fill for the OS mask)
  // now flattens the fully-transparent result onto the brand color as the
  // last step, so the mark sits directly on green with no white anywhere.
  async function squareIcon(
    sizePx: number,
    paddingRatio: number,
    background: string,
    fileName: string,
    mode: "opaque" | "transparent",
  ) {
    const canvas = Math.round(markSize * (1 + paddingRatio * 2));
    const pad = Math.round((canvas - markSize) / 2);

    const squared = await sharp(leftHalf)
      .resize({ width: markSize, height: markSize, fit: "contain", background: "#ffffff" })
      .toBuffer();
    const padded = await sharp(squared)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" })
      .toBuffer();
    const resized = await sharp(padded).resize(sizePx, sizePx, { fit: "cover", background: "#ffffff" }).png().toBuffer();
    const transparent = await chromaKeyWhite(resized);
    const final = mode === "transparent" ? transparent : await sharp(transparent).flatten({ background }).png().toBuffer();
    await sharp(final).toFile(path.join(OUT_DIR, fileName));
  }

  // Standard icons: transparent background, minimal padding.
  await squareIcon(192, 0.08, "#ffffff", "icon-192.png", "transparent");
  await squareIcon(512, 0.08, "#ffffff", "icon-512.png", "transparent");
  await squareIcon(32, 0.08, "#ffffff", "favicon-32.png", "transparent");
  await squareIcon(16, 0.08, "#ffffff", "favicon-16.png", "transparent");

  // Apple touch icon: iOS fills transparent regions with solid black, so
  // this one stays opaque on the brand color instead of transparent.
  await squareIcon(180, 0.1, BRAND_BG, "apple-touch-icon.png", "opaque");

  // Maskable icons: brand-color background, padded so the mark survives
  // Android's circular/squircle/rounded-square masking. Android's spec
  // requires all visible content to stay within a centered circle of 66%
  // of the icon's diameter (33% radius) — the mark here is a wide
  // rectangle (D + arrow, not a square glyph), so after being squared up
  // its CORNERS sit noticeably further from center than its edges do;
  // 0.22 (a flat ~20%) was verified (by compositing an actual circular
  // mask over the output and inspecting it) to still clip the arrow tip
  // and part of the "D". 0.45 keeps the full mark's bounding-box corners
  // inside the 33%-radius safe zone with a small margin — re-verify with
  // the same circular-mask composite check if the source logo changes.
  await squareIcon(192, 0.45, BRAND_BG, "icon-maskable-192.png", "opaque");
  await squareIcon(512, 0.45, BRAND_BG, "icon-maskable-512.png", "opaque");

  console.log(`Icons written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
