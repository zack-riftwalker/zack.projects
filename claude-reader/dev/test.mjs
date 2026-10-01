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

// dictionary APIs: fixed answers so the test doesn't depend on the network
await context.route('https://api.mymemory.translated.net/**', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      responseData: { translatedText: 'همگام‌سازی کردن' },
      matches: [{ translation: 'هماهنگ کردن', match: 0.9 }, { translation: 'همزمان کردن', match: 0.8 }],
    }),
  })
);
await context.route('https://api.dictionaryapi.dev/**', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      {
        word: 'synchronize',
        phonetic: '/ˈsɪŋkrənaɪz/',
        phonetics: [],
        meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'Cause to occur or operate at the same time or rate.', example: 'soldiers synchronizing their steps' }] }],
      },
    ]),
  })
);

// update check: pretend GitHub announces a newer version
await context.route('https://raw.githubusercontent.com/**', (route) =>
  route.request().url().includes('/main/')
    ? route.fulfill({ status: 404, body: 'Not Found' })
    : route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: '9.9.9', zip: 'https://example.com/khana.zip', notes: ['یک قابلیت تازه'] }),
      })
);

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
      const w = document.createTreeWalker(document.querySelector('.column') || document.querySelector('.transcript'), NodeFilter.SHOW_TEXT);
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
const prose = await page.evaluate(() => {
  const c = document.querySelector('.code-wrap code');
  return { dir: getComputedStyle(c).direction, font: getComputedStyle(c).fontFamily };
});
ok(prose.dir === 'rtl', 'Persian prose inside a code block reads right to left');
ok(prose.font.startsWith('"CSR Fa vazirmatn"') && prose.font.includes('monospace'), 'its Persian letters use the Persian font, the rest stays monospace: ' + prose.font);
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
const glyphs = await page.evaluate(() => [...document.querySelectorAll('.glyph')].map((g) => getComputedStyle(g).fontFamily));
ok(glyphs.length === 3 && glyphs.every((f) => f.startsWith('"Anthropic Glyphs"')), "Claude's icon-font glyphs keep their font (no empty boxes): " + glyphs.join(' | '));
ok(
  await page.evaluate(() => ['.artifact-title', '.artifact-meta', '.tool-row'].every((s) => getComputedStyle(document.querySelector(s)).fontFamily.includes('CSR Fa vazirmatn'))),
  'text next to the icons still uses the chosen font'
);
ok(await page.evaluate(() => document.querySelector('.emo').hasAttribute('data-csr-keepfont')), 'an emoji on its own keeps its font');
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
console.log('Bookmarks, tags, focus, ruler, TOC, resume, TTS, dictionary, study timer');
await page.keyboard.press('Alt+G');
const pbox = await page.locator('.standard-markdown p').nth(2).boundingBox();
await page.locator('#csr-host .tools input').fill('تا اینجا خواندم');
await page.mouse.click(pbox.x + 120, pbox.y + pbox.height - 3);
ok((await page.locator('.csr-bookmark').count()) === 1, 'bookmark ribbon inserted');
ok((await page.locator('.csr-bookmark svg pattern').count()) === 1, 'bookmark uses an inline SVG pattern (no data: image)');
ok((await page.locator('.csr-bookmark .csr-bm-label').textContent()) === 'تا اینجا خواندم', 'bookmark label');
await page.keyboard.press('Escape');
await page.locator('.csr-bookmark').scrollIntoViewIfNeeded();
await shot('11-bookmark');

// tags on a highlight
await page.locator('.csr-hl-blue').first().click();
await page.locator('#csr-host .popover .tag-input').fill('امتحان');
await page.locator('#csr-host .popover .tag-input').press('Enter');
ok((await page.locator('#csr-host .popover .tag').count()) === 1, 'tag added to highlight');
await page.locator('#csr-host .popover .sel-btn.primary').click();
await page.keyboard.press('Alt+M');
ok((await page.locator('#csr-host .panel .chip.tagchip').count()) === 1, 'panel offers a tag filter');
await page.locator('#csr-host .panel .chip.tagchip').click();
ok((await page.locator('#csr-host .panel .item').count()) === 1, 'tag filter shows only tagged items');
await page.keyboard.press('Alt+M');

// focus mode
await page.keyboard.press('Alt+Z');
const hidden = await page.evaluate(() => ({
  nav: getComputedStyle(document.querySelector('nav')).display,
  composer: getComputedStyle(document.querySelector('.composer')).display,
  actions: getComputedStyle(document.querySelector('.actions')).display,
  msg: getComputedStyle(document.querySelector('.font-claude-response')).display,
}));
ok(hidden.nav === 'none' && hidden.composer === 'none' && hidden.actions === 'none' && hidden.msg !== 'none', 'focus mode hides sidebar, composer, buttons; keeps messages');
await shot('12-focus');
await page.keyboard.press('Escape');
ok(await page.evaluate(() => getComputedStyle(document.querySelector('nav')).display !== 'none'), 'Esc leaves focus mode');

// reading ruler
await page.keyboard.press('Alt+K');
await page.mouse.move(640, 300);
await page.waitForTimeout(100);
const edges = await page.locator('#csr-host .ruler-edge').count();
ok(edges === 2 && (await page.locator('#csr-host .ruler-edge pattern').count()) === 2, 'ruler with two patterned edges');
const top1 = await page.locator('#csr-host .ruler-edge').first().evaluate((e) => e.style.top);
await page.mouse.move(640, 420);
await page.waitForTimeout(100);
const top2 = await page.locator('#csr-host .ruler-edge').first().evaluate((e) => e.style.top);
ok(top1 !== top2, 'ruler follows the mouse');
await shot('13-ruler');
await page.keyboard.press('Alt+K');

// table of contents + progress
await page.keyboard.press('Alt+T');
const tocItems = await page.locator('#csr-host .toc .toc-item').count();
ok(tocItems >= 5, 'TOC lists questions and sections (' + tocItems + ')');
ok((await page.locator('#csr-host .toc .toc-bm').count()) === 1, 'TOC lists the bookmark');
await page.locator('#csr-host .toc .toc-check').first().check();
await page.waitForTimeout(300);
const stat = await page.locator('#csr-host .toc .toc-stat').textContent();
ok(/٪/.test(stat) && !stat.startsWith('۰٪'), 'progress updates after ticking a section: ' + stat);
await shot('14-toc');

// reading position: scroll to the end, wait for it to be saved, go to top, reload
await page.evaluate(() => document.querySelector('.scroller').scrollTo(0, 99999));
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('.scroller').scrollTo(0, 0));
await page.waitForTimeout(400);
await page.reload();
await page.waitForSelector('#csr-host', { state: 'attached' });
await page.waitForTimeout(2600);
ok(await page.locator('#csr-host .resume').isVisible(), '"continue where you left off" button after reload');
await shot('15-resume');
await page.locator('#csr-host .resume-go').click();
await page.waitForTimeout(900);
ok(await page.evaluate(() => document.querySelector('.scroller').scrollTop > 100), 'resume scrolls down to the last position');
ok((await counts()).divider === 1 && (await page.locator('.csr-bookmark').count()) === 1, 'bookmark restored after reload');
await page.keyboard.press('Alt+T');
ok(await page.locator('#csr-host .toc .toc-check').first().isChecked(), 'read state restored after reload');
await page.keyboard.press('Alt+T');

// text to speech (headless Chromium may have no voices: accept a player or a clear message)
await page.locator('.standard-markdown p', { hasText: 'In English' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await select('useEffect lets you synchronize');
await page.locator('#csr-host .sel-toolbar .sel-btn[title="خواندن با صدا"]').click();
await page.waitForTimeout(300);
const ttsState = await page.evaluate(() => ({
  player: !!document.getElementById('csr-host').shadowRoot.querySelector('.tts-player'),
  hl: CSS.highlights.has('csr-tts'),
  toast: document.getElementById('csr-host').shadowRoot.querySelector('.toast').textContent,
}));
ok(ttsState.player || /نتوانست|خواندن/.test(ttsState.toast), 'text to speech starts (player=' + ttsState.player + ', highlight=' + ttsState.hl + ')');
if (ttsState.player) await shot('16-tts');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// dictionary
await page.evaluate(() => {
  const p = [...document.querySelectorAll('.standard-markdown p')].find((x) => x.textContent.startsWith('In English'));
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf('synchronize');
    if (i >= 0) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 'synchronize'.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      p.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return;
    }
  }
});
await page.locator('#csr-host .dict-card').waitFor();
await page.locator('#csr-host .dict-card .dict-chip, #csr-host .dict-card .dict-empty').first().waitFor({ timeout: 20000 }).catch(() => {});
const faChips = await page.locator('#csr-host .dict-card .dict-chip').count();
ok(faChips > 0, 'dictionary shows Persian meanings (' + faChips + ')');
await shot('17-dictionary');
if (faChips) {
  await page.locator('#csr-host .dict-card .btn-text').first().click();
  await page.waitForTimeout(300);
}
await page.keyboard.press('Escape');

// study timer + pomodoro (the background worker runs the clock)
ok(await page.locator('#csr-host .study-pill').isVisible(), 'study time pill visible');
await page.locator('#csr-host .study-pill').click();
ok(await page.locator('#csr-host .study-card').isVisible(), 'study card opens');
await page.locator('#csr-host .study-card .btn-main').click();
await page.waitForTimeout(800);
const pillText = await page.locator('#csr-host .study-pill').textContent();
ok(/[۰-۹]{2}:[۰-۹]{2}/.test(pillText) && pillText.includes('مطالعه'), 'pomodoro running: ' + pillText);
await shot('18-study-card');

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
/** WCAG contrast of an element's text against what is really behind it. */
const contrastOf = (sel) =>
  page.evaluate((sel) => {
    const parse = (c) => {
      const m = c.match(/[\d.]+/g).map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] };
    };
    const L = ({ r, g, b }) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.querySelector(sel);
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) };
    const a = L(parse(getComputedStyle(el).color));
    const b = L(bg);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10;
  }, sel);
ok((await contrastOf('.code-wrap code')) >= 4.5, 'dark theme: code block text readable (' + (await contrastOf('.code-wrap code')) + ':1)');
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
await page.waitForTimeout(400);
for (const name of ['کاغذی', 'سپیا']) {
  if (name !== 'کاغذی') {
    await popup.locator('.theme', { hasText: name }).click();
    await page.waitForTimeout(900);
  }
  const code = await contrastOf('.code-wrap code');
  const faint = await contrastOf('.faint');
  ok(code >= 4.5, `${name}: code block with fixed light-gray text is readable (${code}:1)`);
  ok(faint >= 4.5, `${name}: text with a fixed light color is readable (${faint}:1)`);
  ok((await contrastOf('.standard-markdown p')) >= 7, `${name}: normal text untouched and dark`);
  ok((await page.locator('[data-csr-paint^="code"]').count()) === 1, `${name}: only the unreadable code block was repainted`);
}
await page.locator('.code-wrap').scrollIntoViewIfNeeded();
await shot('10-sepia-code-block');
await popup.locator('.theme', { hasText: 'کاغذی' }).click();
await page.waitForTimeout(500);

// pomodoro pop-up: simulate the moment the worker ends a focus phase
await popup.evaluate(async () => {
  const { pomo } = await chrome.storage.local.get('pomo');
  await chrome.storage.local.set({
    pomo: { ...pomo, phase: 'short', running: true, endsAt: Date.now() + 300000, total: 300000, cycle: 1, event: { id: 'test-1', ended: 'focus', next: 'short', at: Date.now(), auto: true } },
  });
});
await page.bringToFront();
await page.waitForTimeout(700);
ok(await page.locator('#csr-host .pomo-overlay').isVisible(), 'Termeh pop-up appears when a focus phase ends');
ok((await page.locator('#csr-host .pomo-overlay h2').textContent()).includes('مطالعه کردی'), 'pop-up says to take a break');
await page.waitForTimeout(400);
await shot('19-pomodoro-popup');
await page.locator('#csr-host .pomo-overlay .pomo-primary').click();
ok(!(await page.locator('#csr-host .pomo-overlay').count()), 'pop-up closes');
const bg = await popup.evaluate(() => chrome.runtime.sendMessage({ csr: 'pomo', cmd: 'stop' }));
ok(bg && bg.phase === 'idle', 'background worker handles pomodoro commands');

await popup.locator('.tab[data-tab="tools"]').click();
await popup.locator('#checkUpdate').click();
await popup.waitForTimeout(800);
ok(await popup.locator('#updateBanner').isVisible(), 'update banner shows when a newer version exists');
ok((await popup.locator('#ubTitle').textContent()).includes('۹.۹.۹'), 'banner names the new version');
await popup.screenshot({ path: path.join(outDir, '29-popup-update.png') });

await popup.locator('.tab[data-tab="study"]').click();
await popup.screenshot({ path: path.join(outDir, '20-popup-study.png') });
await popup.locator('.tab[data-tab="read"]').click();
await popup.screenshot({ path: path.join(outDir, '21-popup-read.png') });

// library
const lib = await context.newPage();
await lib.goto(`chrome-extension://${extId}/src/library/library.html`);
await lib.waitForTimeout(500);
ok((await lib.locator('.conv').count()) === 2, 'library lists both conversations');
await lib.locator('#q').fill('امتحان');
ok((await lib.locator('.conv').count()) === 1, 'library search works');
await lib.locator('#q').fill('');
await lib.screenshot({ path: path.join(outDir, '10-library.png'), fullPage: true });
await lib.locator('.tab[data-tab="vocab"]').click();
ok((await lib.locator('.vocab').count()) >= 1 || faChips === 0, 'saved word appears in the vocabulary list');
await lib.screenshot({ path: path.join(outDir, '22-library-vocab.png') });
await lib.locator('.tab[data-tab="stats"]').click();
ok((await lib.locator('.bar-col').count()) === 14, 'study stats chart has 14 days');
await lib.screenshot({ path: path.join(outDir, '23-library-stats.png') });

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

// ---------------------------------------------------------------------------
console.log('Claude Code page (/code): generic messages, robust theme, focus, collapsed dock, diagnostics');
const CODE = '/code/session_01TestSessionAbcdef';
await page.goto('https://claude.ai' + CODE);
await page.waitForSelector('.markdown');
await page.waitForSelector('#csr-host', { state: 'attached' });
await page.waitForTimeout(1500);
ok((await page.locator('[data-csr-msg]').count()) === 2, 'messages found without Claude chat classes');
ok((await page.locator('[data-csr-msg="user"]').count()) === 1, 'user message recognised');
ok((await page.locator('.markdown p').first().getAttribute('dir')) === 'rtl', 'RTL works on the code page');
await select('ماژول استاندارد csv');
await page.locator('#csr-host .sel-toolbar .swatch').first().click();
ok((await page.locator('.csr-hl-yellow').count()) === 1, 'highlight works on the code page');

const setTheme = (id) => popup.evaluate(async (id) => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, theme: id } });
}, id);
const bgOf = (sel) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, sel);
const lumOf = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
await setTheme('paper');
await page.waitForTimeout(900);
ok((await bgOf('.scroll-area')) === 'rgb(250, 249, 246)', 'light theme paints the reading area (hard-coded dark background): ' + (await bgOf('.scroll-area')));
ok(lumOf(await bgOf('.side-rail')) > 0.6, 'light theme reaches the sidebar through discovered variables: ' + (await bgOf('.side-rail')));
ok(lumOf(await page.evaluate(() => getComputedStyle(document.querySelector('.markdown p')).color)) < 0.3, 'text is dark on the light theme');
ok(lumOf(await bgOf('.turn-user .bubble')) > 0.6, 'user bubble is light too');
await shot('24-code-light');
await setTheme('night');
await page.waitForTimeout(900);
ok((await bgOf('.scroll-area')) === 'rgb(30, 31, 36)', 'dark theme on the code page: ' + (await bgOf('.scroll-area')));
ok(lumOf(await page.evaluate(() => getComputedStyle(document.querySelector('.markdown p')).color)) > 0.6, 'text is light on the dark theme');
await shot('25-code-dark');
await setTheme('paper');
await page.waitForTimeout(700);

await page.keyboard.press('Alt+Z');
await page.waitForTimeout(300);
const focusState = await page.evaluate(() => ({
  composer: getComputedStyle(document.querySelector('.composer-wrap')).display,
  msgVisible: [...document.querySelectorAll('[data-csr-msg]')].some((m) => {
    const r = m.getBoundingClientRect();
    return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }),
}));
ok(focusState.composer === 'none' && focusState.msgVisible, 'focus mode on the code page keeps the conversation visible');
await shot('26-code-focus');
await page.keyboard.press('Escape');

// collapse the dock into a draggable bubble
await page.locator('#csr-host .dock-btn[data-key="collapse"]').click();
await page.waitForTimeout(400);
ok(!(await page.locator('#csr-host .dock').isVisible()) && (await page.locator('#csr-host .bubble').isVisible()), 'dock collapses into a bubble');
let bb = await page.locator('#csr-host .bubble').boundingBox();
ok(bb.x > 1280 - 120 && bb.y < 150, 'bubble starts at the top right');
await page.mouse.move(bb.x + 23, bb.y + 23);
await page.mouse.down();
await page.mouse.move(400, 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
bb = await page.locator('#csr-host .bubble').boundingBox();
ok(Math.abs(bb.x + 23 - 400) < 3 && Math.abs(bb.y + 23 - 300) < 3, 'bubble can be dragged');
await shot('27-bubble');
await page.reload();
await page.waitForSelector('#csr-host', { state: 'attached' });
await page.waitForTimeout(1500);
bb = await page.locator('#csr-host .bubble').boundingBox();
ok(bb && Math.abs(bb.x + 23 - 400) < 4, 'bubble position remembered after reload');
ok((await page.locator('.csr-hl-yellow').count()) === 1, 'code-page highlight restored after reload');
await page.locator('#csr-host .bubble').click();
await page.waitForTimeout(400);
ok((await page.locator('#csr-host .dock').isVisible()) && !(await page.locator('#csr-host .bubble').isVisible()), 'clicking the bubble brings the dock back');

// diagnostic report
const diag = await popup.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  return (await chrome.tabs.sendMessage(tab.id, { csr: 'diag' })).report;
});
const d = JSON.parse(diag);
ok(d.mode === 'generic' && d.counts.messages === 2 && d.assistantChain.length > 3, 'diagnostic report describes the page');
ok(!/ماژول|پایتون|csv/i.test(diag), 'diagnostic report contains no message text');

// ---------------------------------------------------------------------------
console.log('Virtual list (like current claude.ai): table of contents navigation');
await page.goto('https://claude.ai/chat/22222222-3333-4444-5555-666666666666');
await page.waitForSelector('[data-testid="transcript-row"]');
await page.waitForSelector('#csr-host', { state: 'attached' });
await page.waitForTimeout(1500);
const rendered = async () => page.evaluate(() => [...document.querySelectorAll('[data-testid="transcript-row"]')].map((r) => +r.dataset.index));
ok((await rendered()).length < 24, 'only part of the conversation is rendered (' + (await rendered()).length + ' of 24 rows)');
await page.keyboard.press('Alt+T');
await page.waitForTimeout(400);
const headingTop = (text) =>
  page.evaluate((text) => {
    const h = [...document.querySelectorAll('h2, h3')].find((x) => x.textContent.trim() === text);
    return h ? Math.round(h.getBoundingClientRect().top) : null;
  }, text);
await page.locator('#csr-host .toc .toc-title', { hasText: 'مبحث 2: جمع‌بندی' }).click();
await page.waitForTimeout(900);
let ht = await headingTop('مبحث 2: جمع‌بندی');
ok(ht !== null && ht >= 0 && ht < 300, 'TOC click jumps to a rendered section despite scroll corrections (top=' + ht + ')');

// visit the whole conversation once so the TOC learns every section, then go back up
await page.evaluate(async () => {
  const sc = document.querySelector('.scroller');
  for (let i = 0; i < 40; i++) {
    sc.scrollBy({ top: 500, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 60));
  }
});
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('.scroller').scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(1200);
ok(!(await rendered()).includes(21), 'the target answer is no longer rendered');
const lastItem = page.locator('#csr-host .toc .toc-title', { hasText: 'مبحث 11: جمع‌بندی' });
ok((await lastItem.count()) === 1, 'TOC still lists sections that are not rendered');
await lastItem.click();
await page.waitForTimeout(2500);
ht = await headingTop('مبحث 11: جمع‌بندی');
ok(ht !== null && ht >= 0 && ht < 320, 'TOC click finds and jumps to a section that was not rendered (top=' + ht + ')');
await shot('28-virtual-toc');
await page.keyboard.press('Alt+T');

console.log('Reading column width on the virtual list');
const setWidth = (w) =>
  popup.evaluate(async (w) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, contentWidth: w } });
  }, w);
const widths = () =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll('.row-inner')].map((r) => Math.round(r.getBoundingClientRect().width)),
    composer: Math.round(document.querySelector('.composer').getBoundingClientRect().width),
    bubble: Math.max(...[...document.querySelectorAll('[data-testid="user-message"]')].map((b) => b.getBoundingClientRect().width)),
  }));
const rowsBefore = (await widths()).rows;
await setWidth(920);
await page.waitForTimeout(700);
let cw = await widths();
ok(cw.rows.length > 1 && cw.rows.every((x) => x === 920), 'every rendered row takes the chosen width (' + rowsBefore[0] + ' → ' + cw.rows.join(',') + ')');
await page.evaluate(() => document.querySelector('.scroller').scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(1500);
cw = await widths();
ok(cw.rows.length > 1 && cw.rows.every((x) => x === 920), 'rows that appear while scrolling get it too: ' + cw.rows.join(','));
ok(cw.composer >= 920, 'the message box lines up with the text (' + cw.composer + ')');
ok(cw.bubble < 920 * 0.85, 'your own message bubbles are not stretched (' + Math.round(cw.bubble) + ')');
await shot('29-wide-column');

// the window shrinks to phone size, a side panel opens, the page loads narrow
const layout = () =>
  page.evaluate(() => {
    const sc = document.querySelector('.scroller');
    const rows = [...document.querySelectorAll('.row-inner')].map((r) => r.getBoundingClientRect());
    const texts = [...document.querySelectorAll('.row-inner p')].map((p) => p.getBoundingClientRect());
    return {
      rows: rows.map((r) => Math.round(r.width)),
      room: sc.clientWidth,
      overflow: sc.scrollWidth - sc.clientWidth + (document.documentElement.scrollWidth - innerWidth),
      outside: texts.filter((t) => t.right > sc.getBoundingClientRect().right + 1 || t.left < sc.getBoundingClientRect().left - 1).length,
    };
  });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(900);
let lay = await layout();
ok(lay.overflow <= 0 && lay.outside === 0 && lay.rows.every((x) => x <= lay.room), `phone-sized window: text fits, no sideways scrolling (room ${lay.room}, rows ${lay.rows.join(',')}, overflow ${lay.overflow})`);
await shot('29b-phone-width');
const dockShown = async () => [await page.locator('#csr-host .dock').isVisible(), await page.locator('#csr-host .bubble').isVisible()];
ok(JSON.stringify(await dockShown()) === '[false,true]', 'phone-sized window: the toolbar folds into the small circle so it does not cover the text');
const bub = await page.locator('#csr-host .bubble').boundingBox();
ok(bub.x > 390 - 46 - 30 && bub.y < 120, 'the circle sits in its corner on a narrow window (' + Math.round(bub.x) + ',' + Math.round(bub.y) + ')');
await page.locator('#csr-host .bubble').click();
await page.waitForTimeout(300);
ok(JSON.stringify(await dockShown()) === '[true,false]', 'clicking the circle still opens the toolbar');
await page.setViewportSize({ width: 1280, height: 860 });
await page.waitForTimeout(900);
cw = await widths();
ok(cw.rows.every((x) => x === 920), 'back to a wide window: the chosen width again (' + cw.rows.join(',') + ')');
ok(JSON.stringify(await dockShown()) === '[true,false]', 'wide window: the toolbar is back as before');
await page.evaluate(() => window.__panel(true));
await page.waitForTimeout(900);
lay = await layout();
ok(lay.overflow <= 0 && lay.outside === 0 && lay.rows.every((x) => x <= lay.room), `side panel open: text shrinks to fit next to it (room ${lay.room}, rows ${lay.rows.join(',')})`);
await shot('29c-side-panel');
await page.evaluate(() => window.__panel(false));
await page.waitForTimeout(900);
cw = await widths();
ok(cw.rows.every((x) => x === 920), 'side panel closed: the chosen width again (' + cw.rows.join(',') + ')');
// opened on a phone-sized window first (Claude's column has no fixed width there), then widened
await page.setViewportSize({ width: 390, height: 844 });
await page.goto('https://claude.ai/chat/22222222-3333-4444-5555-666666666666');
await page.waitForSelector('[data-testid="transcript-row"]');
await page.waitForTimeout(1500);
await page.setViewportSize({ width: 1280, height: 860 });
await page.waitForTimeout(1200);
cw = await widths();
ok(cw.rows.length && cw.rows.every((x) => x === 920), 'page opened narrow, then widened: the chosen width applies (' + cw.rows.join(',') + ')');
// opened with the side panel already open, then closed
await page.evaluate(() => window.__panel(true));
await page.reload();
await page.waitForSelector('[data-testid="transcript-row"]');
await page.waitForTimeout(1200);
await page.evaluate(() => window.__panel(true));
await page.waitForTimeout(1200);
await page.evaluate(() => window.__panel(false));
await page.waitForTimeout(1200);
cw = await widths();
ok(cw.rows.length && cw.rows.every((x) => x === 920), 'panel open first, then closed: the chosen width applies (' + cw.rows.join(',') + ')');
await setWidth(0);
await page.waitForTimeout(500);
cw = await widths();
ok(cw.rows.every((x) => x === rowsBefore[0]), "back to Claude's width when reset");

// ---------------------------------------------------------------------------
console.log('Regressions from the code review');
await open(CONV);
// notes panel must not be rebuilt by reading-position saves (a rebuild can eat clicks)
await page.keyboard.press('Alt+M');
await page.evaluate(() => (document.getElementById('csr-host').shadowRoot.querySelector('.panel').__probe = 1));
await page.evaluate(() => document.querySelector('.scroller').scrollBy({ top: 300, behavior: 'instant' }));
await page.waitForTimeout(2300);
ok(await page.evaluate(() => document.getElementById('csr-host').shadowRoot.querySelector('.panel').__probe === 1), 'notes panel is not rebuilt when only the reading position changes');
await page.keyboard.press('Alt+M');
// selection toolbar survives a small automatic scroll
await page.locator('.standard-markdown p', { hasText: 'In English' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await select('a browser API');
ok(await page.locator('#csr-host .sel-toolbar').isVisible(), 'toolbar shown');
await page.evaluate(() => document.querySelector('.scroller').scrollBy({ top: 2, behavior: 'instant' }));
await page.waitForTimeout(200);
ok(await page.locator('#csr-host .sel-toolbar').isVisible(), 'toolbar stays open through a small automatic scroll');
await page.evaluate(() => getSelection().removeAllRanges());
// Esc while typing in the message box doesn't leave focus mode
await page.keyboard.press('Alt+Z');
await page.evaluate(() => {
  const ed = document.querySelector('.ProseMirror');
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
await page.waitForTimeout(200);
ok(await page.evaluate(() => document.documentElement.hasAttribute('data-csr-focus')), 'Esc in the message box keeps focus mode');
await page.keyboard.press('Escape');
ok(!(await page.evaluate(() => document.documentElement.hasAttribute('data-csr-focus'))), 'Esc elsewhere leaves focus mode');

// ---------------------------------------------------------------------------
console.log("Toolbar vs Claude's Reply button; drawings follow the text when the font grows");
await page.locator('.standard-markdown p', { hasText: 'In English' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await select('external system');
await page.waitForTimeout(600);
const boxes = await page.evaluate(() => {
  const r = (e) => e && e.getBoundingClientRect();
  const tb = r(document.getElementById('csr-host').shadowRoot.querySelector('.sel-toolbar'));
  const rep = r(document.querySelector('.mock-reply'));
  const sel = getSelection().getRangeAt(0).getBoundingClientRect();
  return { tb: { t: tb.top, b: tb.bottom, l: tb.left, r: tb.right }, rep: { t: rep.top, b: rep.bottom, l: rep.left, r: rep.right }, selBottom: sel.bottom };
});
const hit = boxes.tb.l < boxes.rep.r && boxes.tb.r > boxes.rep.l && boxes.tb.t < boxes.rep.b && boxes.tb.b > boxes.rep.t;
ok(!hit, "selection toolbar doesn't cover Claude's Reply button");
ok(boxes.tb.t >= boxes.selBottom, 'toolbar sits under the selection');
await shot('30-toolbar-reply');
await page.evaluate(() => getSelection().removeAllRanges());

// the remaining pen stroke was drawn over the paragraph «این هوک دو ورودی…»
const strokeVsPara = () =>
  page.evaluate(() => {
    const path = document.querySelector('.csr-draw-layer path');
    const para = [...document.querySelectorAll('.standard-markdown p')].find((p) => p.textContent.startsWith('این هوک دو ورودی'));
    const a = path.getBoundingClientRect();
    const b = para.getBoundingClientRect();
    return { cy: a.top + a.height / 2, top: b.top, bottom: b.bottom, w: a.width };
  });
await page.evaluate(() => [...document.querySelectorAll('.standard-markdown p')].find((p) => p.textContent.startsWith('این هوک دو ورودی')).scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
const s0 = await strokeVsPara();
ok(s0.cy >= s0.top - 4 && s0.cy <= s0.bottom + 4, 'stroke starts on its paragraph');
await popup.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, fontSize: 26, lineHeight: 2.1 } });
});
await page.waitForTimeout(1200);
await page.evaluate(() => [...document.querySelectorAll('.standard-markdown p')].find((p) => p.textContent.startsWith('این هوک دو ورودی')).scrollIntoView({ block: 'center' }));
await page.waitForTimeout(500);
const s1 = await strokeVsPara();
ok(s1.cy >= s1.top - 4 && s1.cy <= s1.bottom + 4, `stroke still on its paragraph after the font grew (stroke ${Math.round(s1.cy)}, paragraph ${Math.round(s1.top)}–${Math.round(s1.bottom)})`);
ok(s1.w > s0.w * 1.2, 'stroke scaled with the text');
ok((await page.locator('.csr-hl-blue').textContent()) === 'کارهای جانبی', 'highlights still cover exactly the same words');
await shot('31-font-grown');
await popup.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, fontSize: 19, lineHeight: 2 } });
});
await page.waitForTimeout(500);

// ---------------------------------------------------------------------------
console.log('Focus mode fullscreen; paragraph translation');
const winState = () => popup.evaluate(async () => (await chrome.windows.getAll()).map((w) => w.state));
const winBefore = await winState();
await page.bringToFront();
await page.keyboard.press('Alt+Z');
await page.waitForTimeout(1200);
const during = await winState();
ok(during.includes('fullscreen'), 'focus mode puts the window in fullscreen (' + winBefore.join(',') + ' → ' + during.join(',') + ')');
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
const after = await winState();
ok(!after.includes('fullscreen'), 'leaving focus mode restores the window (' + after.join(',') + ')');

await page.locator('.standard-markdown p', { hasText: 'In English' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await select('lets you synchronize a component with an external system');
await page.locator('#csr-host .sel-toolbar .sel-btn[title^="معنی کلمه"]').click();
await page.locator('#csr-host .tr-card .tr-body').waitFor();
await page.waitForFunction(() => !document.getElementById('csr-host').shadowRoot.querySelector('.tr-card .dict-loading'), null, { timeout: 15000 });
const trText = await page.locator('#csr-host .tr-card .tr-body').textContent();
ok(trText.includes('همگام'), 'translation card shows the Persian translation: ' + trText.slice(0, 40));
ok((await page.locator('#csr-host .tr-card .tr-dir').textContent()).includes('انگلیسی ← فارسی'), 'direction detected');
await page.waitForTimeout(300);
await shot('32-translation');
const newTab = context.waitForEvent('page');
await page.locator('#csr-host .tr-card .btn-main').click();
const claudeTab = await newTab;
ok(claudeTab.url().startsWith('https://claude.ai/new?q='), 'better translation opens a new Claude chat with the text');
ok(decodeURIComponent(claudeTab.url()).includes('lets you synchronize'), 'the new chat carries the selected text');
await claudeTab.close();
await page.bringToFront();
await page.locator('#csr-host .tr-card .btn-text', { hasText: 'ذخیره' }).click();
await page.waitForTimeout(300);
ok((await page.locator('.csr-note[title^="🌐"]').count()) >= 1, 'translation saved as a note on that text');
// one word still goes to the dictionary
await select('synchronize');
await page.keyboard.press('Alt+Y');
await page.locator('#csr-host .dict-card').waitFor();
ok(true, 'Alt+Y on a single word opens the dictionary');
await page.keyboard.press('Escape');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await context.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
