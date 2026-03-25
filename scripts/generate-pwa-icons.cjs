const sharp = require('sharp');
const path = require('path');

async function generateIcons() {
  const src = path.join(__dirname, '..', 'public', 'logo.png');
  const outDir = path.join(__dirname, '..', 'public', 'icons');

  // Source is already 512x512 square
  const squareBuf = await sharp(src).resize(512, 512).png().toBuffer();

  // Standard icons (any purpose)
  await sharp(squareBuf).resize(192, 192).toFile(path.join(outDir, 'icon-192x192.png'));
  await sharp(squareBuf).resize(512, 512).toFile(path.join(outDir, 'icon-512x512.png'));

  // Apple touch icon
  await sharp(squareBuf).resize(180, 180).toFile(path.join(outDir, 'apple-touch-icon.png'));

  // Maskable icons: shrink logo to 80% of canvas, rest is white safe-zone
  const maskable512 = await sharp(squareBuf)
    .resize(410, 410, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .extend({ top: 51, bottom: 51, left: 51, right: 51, background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  await sharp(maskable512).resize(512, 512).toFile(path.join(outDir, 'icon-maskable-512x512.png'));
  await sharp(maskable512).resize(192, 192).toFile(path.join(outDir, 'icon-maskable-192x192.png'));

  console.log('All icons generated in public/icons/');
}

generateIcons().catch(e => { console.error(e); process.exit(1); });
