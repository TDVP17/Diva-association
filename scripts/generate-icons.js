const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function safeWriteFile(dest, buf) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(dest, buf);
      return;
    } catch (e) {
      if (attempt === 4) {
        const tmp = dest + '.' + Date.now() + '.tmp';
        fs.writeFileSync(tmp, buf);
        try { fs.unlinkSync(dest); } catch (_) {}
        fs.renameSync(tmp, dest);
        return;
      }
      // wait 100ms
      const start = Date.now();
      while (Date.now() - start < 100) {}
    }
  }
}

async function generateIcons() {
  const srcPath = path.join(process.cwd(), 'public', 'new logo', 'new_logo.png');
  const iconsDir = path.join(process.cwd(), 'public', 'icons');

  if (!fs.existsSync(srcPath)) {
    console.error('Source logo not found at:', srcPath);
    process.exit(1);
  }

  const sizes = [
    { name: 'icon-512.png', size: 512 },
    { name: 'icon-192.png', size: 192 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'favicon-32.png', size: 32 },
    { name: 'favicon-16.png', size: 16 },
    { name: 'brand-lockup.png', size: 512 },
    { name: 'refined-mark.png', size: 512 },
  ];

  for (const item of sizes) {
    const dest = path.join(iconsDir, item.name);
    // Keep transparent padding, contain the logo nicely
    const buf = await sharp(srcPath)
      .resize(item.size, item.size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    safeWriteFile(dest, buf);
    console.log(`Generated: ${item.name} (${item.size}x${item.size})`);
  }

  // Maskable icons (with deep green background #003528 so Android doesn't put a white squircle)
  const maskableSizes = [
    { name: 'icon-maskable-512.png', size: 512, innerSize: 410 },
    { name: 'icon-maskable-192.png', size: 192, innerSize: 154 },
  ];

  for (const item of maskableSizes) {
    const dest = path.join(iconsDir, item.name);
    const resizedLogo = await sharp(srcPath)
      .resize(item.innerSize, item.innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .toBuffer();

    const maskableBuf = await sharp({
      create: {
        width: item.size,
        height: item.size,
        channels: 4,
        background: '#003528',
      }
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toBuffer();
    safeWriteFile(dest, maskableBuf);
    console.log(`Generated maskable: ${item.name}`);
  }

  // App router icon conventions: src/app/icon.png and src/app/apple-icon.png
  const appDir = path.join(process.cwd(), 'src', 'app');
  const icon32 = await sharp(srcPath)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  safeWriteFile(path.join(appDir, 'icon.png'), icon32);
  console.log('Generated: src/app/icon.png (32x32)');

  const appleIcon = await sharp(srcPath)
    .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  safeWriteFile(path.join(appDir, 'apple-icon.png'), appleIcon);
  console.log('Generated: src/app/apple-icon.png (180x180)');

  // Generate multi-size favicon.ico (16x16, 32x32, 48x48)
  const icoSizes = [16, 32, 48];
  const icoFrames = [];
  for (const s of icoSizes) {
    const buf = await sharp(srcPath)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    icoFrames.push({ width: s, height: s, buffer: buf });
  }

  const icoBuffer = createIco(icoFrames);
  safeWriteFile(path.join(appDir, 'favicon.ico'), icoBuffer);
  safeWriteFile(path.join(process.cwd(), 'public', 'favicon.ico'), icoBuffer);
  console.log('Generated: src/app/favicon.ico & public/favicon.ico (multi-frame ICO)');

  console.log('All icons generated successfully!');
}

function createIco(images) {
  const count = images.length;
  const headerSize = 6;
  const entrySize = 16;
  const dirSize = headerSize + count * entrySize;

  let totalSize = dirSize;
  for (const img of images) {
    totalSize += img.buffer.length;
  }

  const out = Buffer.alloc(totalSize);

  // Write ICO header
  out.writeUInt16LE(0, 0); // Reserved
  out.writeUInt16LE(1, 2); // Type 1 = ICO
  out.writeUInt16LE(count, 4); // Number of images

  let currentOffset = dirSize;

  for (let i = 0; i < count; i++) {
    const img = images[i];
    const entryOffset = headerSize + i * entrySize;

    out.writeUInt8(img.width >= 256 ? 0 : img.width, entryOffset + 0);
    out.writeUInt8(img.height >= 256 ? 0 : img.height, entryOffset + 1);
    out.writeUInt8(0, entryOffset + 2); // Color palette count (0 for 256+)
    out.writeUInt8(0, entryOffset + 3); // Reserved
    out.writeUInt16LE(1, entryOffset + 4); // Color planes
    out.writeUInt16LE(32, entryOffset + 6); // Bits per pixel (32-bit RGBA)
    out.writeUInt32LE(img.buffer.length, entryOffset + 8); // Size of image data
    out.writeUInt32LE(currentOffset, entryOffset + 12); // Offset to image data

    img.buffer.copy(out, currentOffset);
    currentOffset += img.buffer.length;
  }

  return out;
}

generateIcons().catch(err => {
  console.error(err);
  process.exit(1);
});

