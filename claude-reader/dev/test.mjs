// End-to-end test: loads the unpacked extension in Chromium, serves a mock
// claude.ai page (dev/mock/claude.html) and drives every feature.
// Usage: npm test   (set CHROMIUM_PATH if Chromium isn't found automatically)
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, '..', 'extension');
const outDir = path.join(here, 'out');
mkdirSync(outDir, { recursive: true });

const MOCK = readFileSync(path.join(here, 'mock', 'claude.html'), 'utf8');
const FILES = {
  '/__mock/react.js': path.join(here, 'node_modules/react/umd/react.production.min.js'),
  '/__mock/react-dom.js': path.join(here, 'node_modules/react-dom/umd/react-dom.production.min.js'),
};
const CONV = '/chat/11111111-2222-3333-4444-555555555555';
const OTHER = '/chat/99999999-8888-7777-6666-555555555555';
// strict CSP, like a real site: fonts from chrome-extension:// URLs are not allowed
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:";

let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}`);
  if (!cond) failures++;
};

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), 'csr-')), {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
await context.route('https://claude.ai/**', (route) => {
  const url = new URL(route.request().url());
  if (FILES[url.pathname]) return route.fulfill({ path: FILES[url.pathname], contentType: 'text/javascript' });
  return route.fulfill({ body: MOCK, contentType: 'text/html', headers: { 'content-security-policy': CSP } });
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Content Security Policy|Failed to load resource/.test(m.text()) && errors.push(m.text()));

async function open(p) {
  await page.goto('https://claude.ai' + p);
  await page.waitForSelector('.font-claude-response');
  await page.waitForSelector('#csr-host', { state: 'attached' });
  await page.waitForTimeout(1200);
}

/** Selects the n-th occurrence of `text` (may span several text nodes) and fires mouseup. */
async function select(text, n = 0) {
  await page.evaluate(
    ({ text, n }) => {
      const w = document.createTreeWalker(document.querySelector('.column'), NodeFilter.SHOW_TEXT);
      const nodes = [];
      let all = '';
      let node;
      while ((node = w.nextNode())) {
        nodes.push([node, all.length]);
        all += node.nodeValue;
      }
      let i = -1;
      for (let k = 0; k <= n; k++) i = all.indexOf(text, i + 1);
      if (i < 0) throw new Error('text not found: ' + text);
      const at = (off, end) => {
        for (const [nd, st] of nodes) {
          const len = nd.nodeValue.length;
          if (end ? off > st && off <= st + len : off >= st && off < st + len) return [nd, off - st];
        }
      };
      const r = document.createRange();
      r.setStart(...at(i, false));
      r.setEnd(...at(i + text.length, true));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { text, n }
  );
  await page.waitForTimeout(80);
}

const shot = (name) => page.screenshot({ path: path.join(outDir, name + '.png') });

// ---------------------------------------------------------------------------
console.log('Appearance');
await open(CONV);

const extId = await page.evaluate(() => (document.getElementById('csr-dynamic-style').textContent.match(/chrome-extension:\/\/([a-p]{32})/) || [])[1]);
ok(!!extId, 'extension injected its styles (id ' + extId + ')');

const dirs = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('.font-claude-response p, .font-claude-response ul, .font-claude-response ol, .font-claude-response table, .font-claude-response h2')];
  return ps.map((p) => [p.tagName, p.getAttribute('dir'), p.textContent.slice(0, 20)]);
});
ok(dirs.filter(([t, d, s]) => /[آ-ی]/.test(s) && d === 'rtl').length >= 6, 'Persian blocks are RTL');
ok(dirs.some(([t, d, s]) => s.startsWith('In English') && d === 'ltr'), 'English paragraph stays LTR');
ok(dirs.some(([t, d]) => t === 'UL' && d === 'rtl'), 'Persian list is RTL (bullets on the right)');
const preDir = await page.evaluate(() => getComputedStyle(document.querySelector('.font-claude-response pre')).direction);
ok(preDir === 'ltr', 'code block stays LTR');
const mirrored = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.standard-markdown > p')].find((x) => x.dir === 'rtl');
  const cs = getComputedStyle(p);
  return [cs.paddingLeft, cs.paddingRight];
});
ok(mirrored[0] === '32px' && mirrored[1] === '8px', 'padding mirrored for RTL paragraphs ' + mirrored.join('/'));

await page.waitForTimeout(800);
const fontOk = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('2d');
  c.font = '40px "CSR Fa vazirmatn", monospace';
  const a = c.measureText('سلام دنیا').width;
  c.font = '40px monospace';
  return a !== c.measureText('سلام دنیا').width;
});
ok(fontOk, 'Vazirmatn renders despite strict font-src CSP');
const family = await page.evaluate(() => getComputedStyle(document.querySelector('.standard-markdown p')).fontFamily);
ok(family.includes('CSR Fa vazirmatn'), 'message paragraphs use the Persian font stack');
await shot('01-rtl-font');

// ---------------------------------------------------------------------------
console.log('Selection toolbar, highlight, formats, notes, quote');
await select('کارهای جانبی');
ok(await page.locator('#csr-host .sel-toolbar').isVisible(), 'toolbar appears on selection');
await shot('02-selection-toolbar');
await page.locator('#csr-host .sel-toolbar .swatch').first().click();
ok((await page.locator('.csr-m.csr-hl-yellow').count()) === 1, 'yellow highlight added');
ok((await page.locator('.csr-m.csr-hl-yellow').textContent()) === 'کارهای جانبی', 'highlight wraps exactly the selected text');

await select('آرایه‌ی وابستگی');
await page.locator('#csr-host .sel-toolbar .swatch').nth(1).click();
await select('حلقه‌ی بی‌نهایت');
await page.locator('#csr-host .sel-toolbar .swatch').nth(3).click();
ok((await page.locator('.csr-hl-green').count()) >= 1 && (await page.locator('.csr-hl-pink').count()) >= 1, 'multiple colors');

// selection that spans an inline <code> element
await select('بعد از رندر شدن');
await page.locator('#csr-host .sel-toolbar .fmt.b').click();
ok((await page.locator('.csr-m.csr-b').count()) >= 1, 'bold format');
await select('تابع برگشتی');
await page.keyboard.press('Alt+U');
ok((await page.locator('.csr-m.csr-u').count()) >= 1, 'underline via Alt+U');
await select('یک بار بعد از mount');
await page.keyboard.press('Alt+I');
ok((await page.locator('.csr-m.csr-i').count()) >= 1, 'italic via Alt+I (with inline code inside)');

// recolor an existing highlight
await select('کارهای جانبی');
await page.locator('#csr-host .sel-toolbar .swatch').nth(2).click();
ok((await page.locator('.csr-hl-blue').count()) === 1 && (await page.locator('.csr-hl-yellow').count()) === 0, 'recolor instead of stacking');

// note
await select('گرفتن داده از API');
await page.keyboard.press('Alt+N');
await page.locator('#csr-host .popover textarea').fill('این رو برای امتحان حفظ کنم');
await page.waitForTimeout(300);
await shot('03-note-popover');
await page.locator('#csr-host .popover .sel-btn.primary').click();
ok((await page.locator('.csr-m.csr-note').count()) >= 1, 'note mark created');

// quote
await select('این هوک دو ورودی');
await page.locator('#csr-host .sel-toolbar .sel-btn[title^="نقل"]').click();
ok((await page.locator('[data-csr-block="quote"]').count()) === 1, 'quote block');

// ---------------------------------------------------------------------------
console.log('Divider + drawing');
await page.locator('#csr-host .dock-btn[data-key="divider"]').click();
await page.locator('#csr-host .tools input').fill('بخش دوم');
const h2box = await page.locator('.standard-markdown h2').first().boundingBox();
await page.mouse.move(h2box.x + 100, h2box.y + h2box.height - 3);
await shot('04-divider-guide');
await page.mouse.click(h2box.x + 100, h2box.y + h2box.height - 3);
ok((await page.locator('.csr-divider').count()) === 1, 'divider inserted after heading');
ok((await page.locator('.csr-divider .csr-divider-label').textContent()) === 'بخش دوم', 'divider label');
await page.keyboard.press('Escape');

await page.keyboard.press('Alt+P');
ok(await page.locator('#csr-host .draw-overlay').isVisible(), 'pen mode on');
const para = await page.locator('.standard-markdown p').nth(1).boundingBox();
await page.mouse.move(para.x + 40, para.y + 10);
await page.mouse.down();
for (let i = 0; i < 20; i++) await page.mouse.move(para.x + 40 + i * 12, para.y + 10 + Math.sin(i / 2) * 12);
await page.mouse.up();
await page.locator('#csr-host .tool-btn[title^="خط صاف"]').click();
await page.mouse.move(para.x + 20, para.y + para.height + 6);
await page.mouse.down();
await page.mouse.move(para.x + 400, para.y + para.height + 9, { steps: 8 });
await page.mouse.up();
ok((await page.locator('.csr-draw-layer path').count()) === 2, 'two strokes drawn');
const lineD = await page.locator('.csr-draw-layer path').nth(1).getAttribute('d');
const ys = lineD.match(/-?[\d.]+/g).filter((_, i) => i % 2 === 1);
ok(new Set(ys).size === 1, 'straight line snapped horizontal');
await shot('05-drawing');
await page.keyboard.press('Control+z');
ok((await page.locator('.csr-draw-layer path').count()) === 1, 'undo removes last stroke');
await page.keyboard.press('Escape');
ok(!(await page.locator('#csr-host .draw-overlay').count()), 'Esc leaves pen mode');

// ---------------------------------------------------------------------------
console.log('Panel');
await page.keyboard.press('Alt+M');
const items = await page.locator('#csr-host .panel .item').count();
ok(items >= 9, 'panel lists annotations (' + items + ')');
await page.locator('#csr-host .panel .tab').nth(1).click();
await page.locator('#csr-host .panel textarea').fill('خلاصه: useEffect برای side effect است.');
await page.locator('#csr-host .panel .tab').nth(0).click();
await page.waitForTimeout(2300);
await shot('06-panel');
await page.keyboard.press('Alt+M');
await page.waitForTimeout(600);
const counts = async () =>
  page.evaluate(() => ({
    marks: new Set([...document.querySelectorAll('.csr-m')].map((e) => e.dataset.csrId)).size,
    quote: document.querySelectorAll('[data-csr-block]').length,
    divider: document.querySelectorAll('.csr-divider').length,
    paths: document.querySelectorAll('.csr-draw-layer path').length,
  }));
const before = await counts();
console.log('   state:', JSON.stringify(before));

// ---------------------------------------------------------------------------
console.log('Persistence & React re-renders');
await page.evaluate(() => window.__rerender());
await page.waitForTimeout(900);
ok(JSON.stringify(await counts()) === JSON.stringify(before), 'survives a React re-render');

await page.evaluate(() => window.__remount());
await page.waitForTimeout(1500);
ok(JSON.stringify(await counts()) === JSON.stringify(before), 're-applied after React remounts the messages');

await page.evaluate((p) => window.__nav(p), OTHER);
await page.waitForTimeout(1200);
ok((await counts()).marks === 0, 'other conversation has no annotations');
await select('light into chemical energy');
await page.locator('#csr-host .sel-toolbar .swatch').first().click();
await page.evaluate((p) => window.__nav(p), CONV);
await page.waitForTimeout(1600);
ok(JSON.stringify(await counts()) === JSON.stringify(before), 'coming back via in-app navigation restores everything');

await page.reload();
await page.waitForSelector('#csr-host', { state: 'attached' });
await page.waitForTimeout(1800);
ok(JSON.stringify(await counts()) === JSON.stringify(before), 'full page reload restores everything');
const noteTitle = await page.locator('.csr-note').first().getAttribute('title');
ok(noteTitle === 'این رو برای امتحان حفظ کنم', 'note text restored');

// ---------------------------------------------------------------------------
console.log('Streaming');
await page.evaluate(() => window.__stream('در حال نوشتن پاسخ', false));
for (let i = 0; i < 5; i++) {
  await page.evaluate((i) => window.__stream('در حال نوشتن پاسخ ' + 'کلمه '.repeat(i * 3), false), i);
  await page.waitForTimeout(120);
}
await page.evaluate(() => window.__stream('پاسخ کامل شد و این متن فارسی است.', true));
await page.waitForTimeout(900);
const streamDir = await page.evaluate(() => [...document.querySelectorAll('.standard-markdown p')].pop().getAttribute('dir'));
ok(streamDir === 'rtl', 'streamed message gets RTL');
ok(JSON.stringify(await counts()) === JSON.stringify(before), 'annotations intact after streaming');

// ---------------------------------------------------------------------------
console.log('Theme & settings (via popup page)');
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
await popup.waitForTimeout(400);
await popup.screenshot({ path: path.join(outDir, '07-popup-fonts.png') });
await popup.locator('.tab[data-tab="theme"]').click();
await popup.locator('.theme', { hasText: 'کهربایی' }).click();
await popup.screenshot({ path: path.join(outDir, '08-popup-theme.png') });
await popup.locator('.tab[data-tab="type"]').click();
await popup.locator('#fontSize').fill('19');
await popup.locator('#lineHeight').fill('2');
await popup.waitForTimeout(600);
await page.bringToFront();
await page.waitForTimeout(500);
const themed = await page.evaluate(() => ({
  mode: document.documentElement.getAttribute('data-mode'),
  bg: getComputedStyle(document.body).backgroundColor,
  size: getComputedStyle(document.querySelector('.standard-markdown p')).fontSize,
}));
ok(themed.mode === 'dark', 'dark theme switches Claude to dark mode');
ok(themed.bg === 'rgb(31, 26, 20)', 'theme background applied (' + themed.bg + ')');
ok(themed.size === '19px', 'font size applied (' + themed.size + ')');
await page.locator('.standard-markdown h2').first().scrollIntoViewIfNeeded();
await shot('09-dark-theme');

await popup.locator('.tab[data-tab="dir"]').click();
await popup.locator('#rtlMode button[data-v="off"]').click();
await popup.waitForTimeout(500);
ok(await page.evaluate(() => !document.querySelector('.font-claude-response [data-csr-dir]')), 'RTL off removes dir attributes');
await popup.locator('#rtlMode button[data-v="auto"]').click();
await popup.locator('.tab[data-tab="theme"]').click();
await popup.locator('.theme', { hasText: 'کاغذی' }).click();
await popup.waitForTimeout(500);
ok(await page.evaluate(() => document.documentElement.getAttribute('data-mode') === 'light'), 'light theme restores light mode');

// library
const lib = await context.newPage();
await lib.goto(`chrome-extension://${extId}/src/library/library.html`);
await lib.waitForTimeout(500);
ok((await lib.locator('.conv').count()) === 2, 'library lists both conversations');
await lib.locator('#q').fill('امتحان');
ok((await lib.locator('.conv').count()) === 1, 'library search works');
await lib.locator('#q').fill('');
await lib.screenshot({ path: path.join(outDir, '10-library.png'), fullPage: true });

// disable everything
await popup.locator('#enabled').evaluate((el) => el.click());
await popup.waitForTimeout(600);
await page.bringToFront();
const off = await counts();
ok(off.marks === 0 && off.divider === 0 && off.paths === 0, 'turning off hides all annotations');
await popup.locator('#enabled').evaluate((el) => el.click());
await page.waitForTimeout(900);
const on = await counts();
ok(JSON.stringify(on) === JSON.stringify(before), 'turning back on restores them ' + JSON.stringify(on));

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await context.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
