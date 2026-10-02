// Usage: node notion-dump-to-mock.mjs notion-chat-structure.html out-body.html [rows]
// (the dump comes from the console snippet in README → Notion AI)
// Turns a "notion-chat-structure.html" dump into an anonymised test page:
// text replaced by same-script gibberish, ids randomised, every box placed
// where the real page had it (from data-cs), our own attributes removed.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const [, , input, output, keepRows = '4'] = process.argv;
const html = readFileSync(input, 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><body>' + html + '</body>');
const body = await page.evaluate((keepRows) => {
  const root = document.querySelector('[data-agent-chat-survey-shortcut-scope]');
  const cs = (el) => {
    const m = {};
    (el.getAttribute('data-cs') || '').split(';').forEach((kv) => {
      const i = kv.indexOf(':');
      if (i > 0) m[kv.slice(0, i)] = kv.slice(i + 1);
    });
    const b = (m.box || '0,0,0x0').match(/(-?\d+),(-?\d+),(\d+)x(\d+)/);
    m.l = +b[1]; m.t = +b[2]; m.w = +b[3]; m.h = +b[4];
    return m;
  };
  // keep the first rows of the conversation only
  const rowsBox = (() => {
    let e = root.firstElementChild; // the scroller
    for (let i = 0; i < 30 && e; i++) {
      const kids = [...e.children].filter((k) => k.textContent.trim());
      if (kids.length > 1) return e;
      e = kids[0];
    }
    return null;
  })();
  if (rowsBox) [...rowsBox.children].slice(+keepRows).forEach((k) => k.remove());
  // long answers: their first sections are enough
  if (rowsBox) for (const row of rowsBox.children) for (const e of row.querySelectorAll('*')) if (e.children.length > 10 && e.querySelectorAll('[data-block-id]').length > 20) [...e.children].slice(10).forEach((k) => k.remove());
  // anonymise text, keeping script and length
  const FA = 'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
  const EN = 'abcdefghijklmnopqrstuvwxyz';
  let seed = 0x2545f491;
  const rnd = (n) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    n.nodeValue = n.nodeValue.replace(/[؀-ۿ]/g, (ch) => (/[ً-ٰٟ۰-۹٠-٩،؛؟]/.test(ch) ? ch : FA[rnd(FA.length)])).replace(/[A-Za-z]/g, (ch) => (ch === ch.toUpperCase() ? EN[rnd(26)].toUpperCase() : EN[rnd(26)]));
  }
  const hex = () => [...Array(32)].map(() => '0123456789abcdef'[rnd(16)]).join('');
  const all = [root, ...root.querySelectorAll('*')];
  // geometry from the dump
  const box = new Map(all.map((e) => [e, cs(e)]));
  const realParent = (e) => {
    for (let p = e.parentElement; p; p = p.parentElement) if (box.get(p) && box.get(p).display !== 'contents') return p;
    return null;
  };
  for (const e of all) {
    const c = box.get(e);
    for (const a of e.getAttributeNames()) {
      if (a.startsWith('data-csr') || a === 'data-cs' || a === 'data-rtl-listener') e.removeAttribute(a);
      else if (/^(id|data-block-id|data-agent-chat-user-step-id|data-active-edit-reference-id)$/.test(a)) e.setAttribute(a, hex());
      else if (/^(aria-label|title|alt|href|src)$/.test(a)) e.setAttribute(a, 'x');
    }
    e.classList.remove('content-editable-leaf-rtl');
    const inline = c.display === 'inline' || c.display === 'contents' || e.tagName === 'SPAN' || /^(svg|path|g|circle|rect|line|polyline|use)$/i.test(e.tagName);
    const keep = (e.getAttribute('style') || '').match(/(font-weight|font-style|text-decoration[\w-]*|color)\s*:[^;]+/g) || [];
    if (inline) {
      if (c.display === 'contents') e.setAttribute('style', 'display:contents');
      continue;
    }
    const p = e === root ? null : realParent(e);
    const pc = p ? box.get(p) : { l: 0, t: 0 };
    let top = c.t - pc.t;
    if (p && /auto|scroll/.test(pc['overflow-y']) && top < 0) top = 0; // scrolled content starts at the top
    const st = [
      `position:${e === root ? 'relative' : 'absolute'}`,
      `left:${c.l - pc.l}px`,
      `top:${top}px`,
      `width:${c.w}px`,
      `height:${c.h}px`,
      'margin:0',
      'box-sizing:border-box',
      `display:${c.display === 'flex' || c.display === 'inline-flex' ? 'block' : c.display || 'block'}`,
      c['overflow-y'] && c['overflow-y'] !== 'visible' ? `overflow-y:${c['overflow-y']}` : '',
      c['overflow-y'] === 'hidden' ? 'overflow:hidden' : '',
      c['background-color'] && c['background-color'] !== 'rgba(0, 0, 0, 0)' ? `background-color:${c['background-color']}` : '',
      c['border-radius'] && c['border-radius'] !== '0px' ? `border-radius:${c['border-radius']}` : '',
      c['border-top-width'] && c['border-top-width'] !== '0px' ? `border:${c['border-top-width']} solid rgba(255,255,255,.12)` : '',
      c.direction ? `direction:${c.direction}` : '',
      c['text-align'] ? `text-align:${c['text-align']}` : '',
      c.color ? `color:${c.color}` : '',
      c['font-family'] ? `font-family:${c['font-family']}` : '',
      ...keep,
    ].filter(Boolean);
    e.setAttribute('style', st.join(';'));
  }
  return root.outerHTML;
}, keepRows);
writeFileSync(output, body);
console.log('wrote', output, body.length);
await browser.close();
