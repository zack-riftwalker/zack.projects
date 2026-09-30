// Renders every Iranian pattern (as band and as fabric) + the shamseh to out/patterns.png
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(here, 'out'), { recursive: true });
const src = readFileSync(path.join(here, '../extension/src/shared/patterns.js'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
await page.setContent('<body style="margin:16px;font:14px sans-serif;background:#faf9f5"></body>');
await page.addScriptTag({ content: src });
await page.evaluate(() => {
  for (const p of CSR.PATTERNS) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:12px';
    row.innerHTML = `<b style="width:90px">${p.label}</b>
      <div style="width:300px;height:14px;background:${CSR.patternUrl(p.id)} repeat-x;background-size:auto 100%"></div>
      <div style="width:220px;height:26px;background:${CSR.patternUrl(p.id)} repeat-x;background-size:auto 100%"></div>
      <div style="width:120px;height:80px;background:${CSR.patternUrl(p.id)};background-size:48px auto"></div>`;
    document.body.append(row);
  }
  const s = document.createElement('div');
  s.innerHTML = CSR.shamsehSvg('termeh', 120) + CSR.shamsehSvg('kashi', 120) + CSR.shamsehSvg('eslimi', 120);
  document.body.append(s);
});
await page.screenshot({ path: path.join(here, 'out/patterns.png') });
await browser.close();
