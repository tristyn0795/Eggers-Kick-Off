/*
 * Renders every app/store icon from store/assets/icon-source.svg with headless Chromium.
 *   node store/tools/make-icons.js
 * Output: public/icons/* (used by the website/PWA) and store/assets/* (for the store listings).
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = path.join(__dirname, '..', '..');
const svg = fs.readFileSync(path.join(root, 'store/assets/icon-source.svg'), 'utf8');
const out = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/maskable-512.png', 512],
  ['public/icons/apple-touch-icon.png', 180],
  ['store/assets/play-icon-512.png', 512],
  ['store/assets/appstore-icon-1024.png', 1024],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, size] of out) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:#047dc3">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
    // JPEG-free, opaque PNG (App Store icons must not have an alpha channel).
    await page.screenshot({ path: path.join(root, file), omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', file);
  }
  await browser.close();
})();
