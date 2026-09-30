// Renders dev/icon.svg into the PNG sizes Chrome needs.
// Usage: node make-icons.mjs   (needs playwright-core and a Chromium)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(here, 'icon.svg'), 'utf8');
const out = path.join(here, '..', 'extension', 'icons');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
  );
  await page.screenshot({ path: path.join(out, `icon${size}.png`), omitBackground: true });
}
await browser.close();
console.log('icons written to', out);
