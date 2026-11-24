const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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
    await sharp(srcPath)
      .resize(item.size, item.size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(dest);
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

    await sharp({
      create: {
        width: item.size,
        height: item.size,
        channels: 4,
        background: '#003528',
      }
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(dest);
    console.log(`Generated maskable: ${item.name}`);
  }

  console.log('All icons generated successfully!');
}

generateIcons().catch(err => {
  console.error(err);
  process.exit(1);
});

