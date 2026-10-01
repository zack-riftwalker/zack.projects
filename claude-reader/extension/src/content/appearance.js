/* Appearance: fonts, typography, reading themes and proper RTL. */
(function () {
  const CSR = globalThis.CSR;
  const { SEL } = CSR;
  const A = (CSR.appearance = {});

  const MSG = ':is(.font-claude-response, .font-claude-message, [data-csr-msg="assistant"])';
  const USER = ':is([data-testid="user-message"], [data-csr-msg="user"])';

  let styleEl = null;
  const faceRules = new Map(); // family -> css text
  const loadedFaces = new Set();

  A.styleConnected = () => !!(styleEl && styleEl.isConnected);

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.createElement('style');
    styleEl.id = 'csr-dynamic-style';
    styleEl.setAttribute('data-csr-ui', '');
    (document.head || document.documentElement).appendChild(styleEl);
    return styleEl;
  }

  // ---------------------------------------------------------------------------
  // Fonts

  const q = (name) => '"' + String(name).replace(/["\\]/g, '') + '"';

  /** Registers a bundled font under `family`. Uses both an @font-face rule and
   * the FontFace API with an ArrayBuffer, so it works even if the page's CSP
   * would block loading fonts from the extension's URL. */
  function registerBundled(id, family, unicodeRange) {
    if (faceRules.has(family)) return;
    const files = CSR.FONT_FILES[id] || [];
    const rules = files.map((f) => {
      const url = chrome.runtime.getURL('fonts/' + f.file);
      return (
        `@font-face{font-family:${q(family)};src:url("${url}") format("woff2");` +
        `font-weight:${f.weight};font-style:${f.style || 'normal'};font-display:swap;` +
        (unicodeRange ? `unicode-range:${unicodeRange};` : '') +
        '}'
      );
    });
    faceRules.set(family, rules.join('\n'));
    for (const f of files) {
      const key = family + '|' + f.file;
      if (loadedFaces.has(key)) continue;
      loadedFaces.add(key);
      fetch(chrome.runtime.getURL('fonts/' + f.file))
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const desc = { weight: f.weight, style: f.style || 'normal', display: 'swap' };
          if (unicodeRange) desc.unicodeRange = unicodeRange;
          const face = new FontFace(family, buf, desc);
          document.fonts.add(face);
          return face.load();
        })
        .catch(() => {});
    }
  }

  function registerLocal(name, family, unicodeRange) {
    const rule =
      `@font-face{font-family:${q(family)};src:local(${q(name)});font-display:swap;` +
      (unicodeRange ? `unicode-range:${unicodeRange};` : '') +
      '}';
    faceRules.set(family, rule);
  }

  /** Returns {first, after}: families to put before and after the Latin font. */
  function persianStack(s) {
    const f = CSR.PERSIAN_FONTS.find((x) => x.id === s.persianFont) || CSR.PERSIAN_FONTS[0];
    if (f.kind === 'none') return { first: '', after: '' };
    if (f.kind === 'bundled') {
      const fam = 'CSR Fa ' + f.id;
      registerBundled(f.id, fam, CSR.ARABIC_RANGE);
      return { first: q(fam), after: '' };
    }
    const name = f.kind === 'local' ? f.local : (s.customPersianFont || '').trim();
    if (!name) return { first: '', after: '' };
    const fam = 'CSR Fa local ' + name;
    registerLocal(name, fam, CSR.ARABIC_RANGE);
    return { first: q(fam), after: q(name) };
  }

  function latinStack(s) {
    const f = CSR.LATIN_FONTS.find((x) => x.id === s.latinFont) || CSR.LATIN_FONTS[0];
    if (f.kind === 'none') return '';
    if (f.kind === 'bundled') {
      const fam = 'CSR La ' + f.id;
      registerBundled(f.id, fam, null);
      return q(fam);
    }
    if (f.kind === 'stack') return f.stack;
    const name = (s.customLatinFont || '').trim();
    return name ? q(name) : '';
  }

  function fontStack(s, claudeVar, generic) {
    const fa = persianStack(s);
    const la = latinStack(s);
    // Vazirmatn as a last resort for Persian glyphs, before any OS fallback
    // (e.g. Times New Roman) gets a chance to render them.
    const safety = s.persianFont === 'default' ? '' : q('CSR Fa vazirmatn');
    if (safety) registerBundled('vazirmatn', 'CSR Fa vazirmatn', CSR.ARABIC_RANGE);
    return [fa.first, la, fa.after, safety, `var(${claudeVar}, ${generic})`].filter(Boolean).join(', ');
  }

  // ---------------------------------------------------------------------------
  // Theme

  function claudeVars(t) {
    const mix = CSR.color.mix;
    const ch = CSR.color.hslChannels;
    const dark = !!t.dark;
    const bg = t.bg;
    const text = t.text;
    const v = {};
    if (dark) {
      v['bg-000'] = mix(bg, text, 0.07);
      v['bg-100'] = bg;
      v['bg-200'] = mix(bg, '#000000', 0.15);
      v['bg-300'] = mix(bg, '#000000', 0.3);
      v['bg-400'] = mix(bg, '#000000', 0.45);
      v['bg-500'] = mix(bg, '#000000', 0.6);
      for (const k of ['100', '200', '300', '400']) v['border-' + k] = mix(bg, text, 0.16);
    } else {
      v['bg-000'] = mix(bg, '#ffffff', 0.6);
      v['bg-100'] = bg;
      v['bg-200'] = mix(bg, text, 0.035);
      v['bg-300'] = mix(bg, text, 0.07);
      v['bg-400'] = mix(bg, text, 0.11);
      v['bg-500'] = mix(bg, text, 0.15);
      for (const k of ['100', '200', '300', '400']) v['border-' + k] = mix(bg, text, 0.2);
    }
    v['text-000'] = t.heading || text;
    v['text-100'] = text;
    v['text-200'] = mix(text, bg, 0.15);
    v['text-300'] = mix(text, bg, 0.25);
    v['text-400'] = mix(text, bg, 0.4);
    v['text-500'] = mix(text, bg, 0.5);
    return Object.entries(v)
      .map(([k, c]) => `--${k}: ${ch(c)} !important;`)
      .join('');
  }

  function themeCss(t) {
    const target = 'html[data-csr-theme], html[data-csr-theme] [data-theme], html[data-csr-theme] [data-mode]';
    return `
${target} { ${claudeVars(t)}
  --csr-t-bg: ${t.bg}; --csr-t-text: ${t.text}; --csr-t-heading: ${t.heading || t.text};
  --csr-t-link: ${t.link || t.text}; --csr-t-accent: ${t.accent || t.link || t.text}; ${CSR.themeFix.baseVars(t)} }
${CSR.themeFix.varCss(t)}
html[data-csr-theme], html[data-csr-theme] body { background-color: ${t.bg} !important; color-scheme: ${t.dark ? 'dark' : 'light'}; }
html[data-csr-theme] :is(${MSG}, ${USER}) { color: var(--csr-t-text) !important; }
html[data-csr-theme] :is(${MSG}, ${USER}) :is(h1, h2, h3, h4, h5, h6, strong, b) { color: var(--csr-t-heading) !important; }
html[data-csr-theme] :is(${MSG}, ${USER}) a { color: var(--csr-t-link) !important; }
html[data-csr-theme] :is(${MSG}, ${USER}) blockquote { border-color: var(--csr-t-accent) !important; }
`;
  }

  /** Makes Claude's own light/dark mode follow the chosen theme (see theme.js). */
  A.syncMode = function (settings) {
    CSR.themeFix.syncMode(settings);
  };

  // ---------------------------------------------------------------------------
  // Apply everything

  function setAttr(el, name, on) {
    if (on) el.setAttribute(name, '');
    else el.removeAttribute(name);
  }

  A.apply = function (s) {
    const html = document.documentElement;
    ensureStyle();
    const on = !!s.enabled;
    const css = [];
    setAttr(html, 'data-csr-on', on);

    const fontOn = on && !(s.persianFont === 'default' && s.latinFont === 'default');
    setAttr(html, 'data-csr-font', fontOn);
    setAttr(html, 'data-csr-user', on && s.applyToUser);
    if (fontOn) {
      css.push(`:root { --csr-font-assistant: ${fontStack(s, '--font-claude-response', 'serif')};
        --csr-font-user: ${fontStack(s, '--font-user-message', 'sans-serif')}; }`);
    }

    setAttr(html, 'data-csr-size', on && s.fontSize > 0);
    setAttr(html, 'data-csr-lh', on && s.lineHeight > 0);
    setAttr(html, 'data-csr-weight', on && s.fontWeight > 0);
    setAttr(html, 'data-csr-wspace', on && s.wordSpacing > 0);
    setAttr(html, 'data-csr-pspace', on && s.paragraphSpacing > 0);
    setAttr(html, 'data-csr-width', on && s.contentWidth > 0);
    css.push(`:root {
      --csr-size: ${s.fontSize || 16}px; --csr-lh: ${s.lineHeight || 1.7};
      --csr-weight: ${s.fontWeight || 400}; --csr-wspace: ${(s.wordSpacing || 0) / 100}em;
      --csr-pspace: ${s.paragraphSpacing || 0.75}em; --csr-width: ${s.contentWidth || 768}px; }`);

    setAttr(html, 'data-csr-rtl', on && s.rtlMode !== 'off');
    setAttr(html, 'data-csr-rtl-input', on && s.rtlInput);
    setAttr(html, 'data-csr-fa-num', on && s.persianListNumbers);

    const theme = on ? CSR.resolveTheme(s) : null;
    setAttr(html, 'data-csr-theme', !!theme);
    if (theme) css.push(themeCss(theme));

    // highlight colors (light/dark)
    const hl = (mode) =>
      CSR.HIGHLIGHTS.map((h) => `--csr-hl-${h.id}: ${h[mode]};`).join('') +
      CSR.TEXT_COLORS.map((c) => `--csr-tc-${c.id}: ${c[mode]};`).join('');
    if (theme) {
      css.push(`:root { ${hl(theme.dark ? 'dark' : 'light')} }`);
    } else {
      css.push(`:root { ${hl('light')} } html[data-mode="dark"] { ${hl('dark')} }
        @media (prefers-color-scheme: dark) { html:not([data-mode="light"]) { ${hl('dark')} } }`);
    }

    styleEl.textContent = Array.from(faceRules.values()).join('\n') + '\n' + css.join('\n');
    A.syncMode(s);
  };

  // ---------------------------------------------------------------------------
  // Reading column width

  A.markColumn = function (messages, s) {
    if (!(s.enabled && s.contentWidth > 0) || !messages.length) return;
    const first = messages[0];
    if (first.closest('[data-csr-column]')) return;
    let cur = first.parentElement;
    for (let i = 0; cur && i < 10; i++, cur = cur.parentElement) {
      const mw = getComputedStyle(cur).maxWidth;
      if (mw && mw !== 'none' && cur.clientWidth < window.innerWidth - 40) {
        cur.setAttribute('data-csr-column', '');
        return;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // RTL

  const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

  /** Word-based direction guess: a Persian paragraph that contains several
   * English terms is still RTL; an English paragraph with one Persian word is LTR. */
  A.detectDir = function (text) {
    let rtl = 0;
    let ltr = 0;
    const words = text.slice(0, 3000).split(/\s+/);
    for (const w of words) {
      if (RTL_CHAR.test(w)) rtl++;
      else if (LTR_CHAR.test(w)) ltr++;
    }
    if (!rtl && !ltr) return null;
    if (!rtl) return 'ltr';
    if (!ltr) return 'rtl';
    return rtl / (rtl + ltr) >= 0.3 ? 'rtl' : 'ltr';
  };

  const NO_DIR_TEXT = 'pre, code, kbd, samp, .katex, math, [data-csr-ui], button, svg';

  function proseText(el) {
    let out = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && n.parentElement.closest(NO_DIR_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = w.nextNode()) && out.length < 3000) out += n.nodeValue + ' ';
    return out;
  }

  function readBox(el) {
    const cs = getComputedStyle(el);
    return {
      pl: cs.paddingLeft,
      pr: cs.paddingRight,
      bl: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
      br: `${cs.borderRightWidth} ${cs.borderRightStyle} ${cs.borderRightColor}`,
    };
  }

  /** Mirrors physical left/right padding and borders (Claude's markup uses
   * pl-/pr-/border-l utilities, which do not flip with `dir`). */
  function mirror(el, before) {
    const after = readBox(el);
    const props = [];
    if (before.pl !== before.pr && after.pl === before.pl) {
      el.style.setProperty('padding-left', before.pr, 'important');
      el.style.setProperty('padding-right', before.pl, 'important');
      props.push('padding-left', 'padding-right');
    }
    if (before.bl !== before.br && after.bl === before.bl) {
      el.style.setProperty('border-left', before.br, 'important');
      el.style.setProperty('border-right', before.bl, 'important');
      props.push('border-left', 'border-right');
    }
    if (props.length) el.setAttribute('data-csr-mirrored', props.join(','));
  }

  function unmirror(el) {
    const m = el.getAttribute('data-csr-mirrored');
    if (!m) return;
    for (const p of m.split(',')) el.style.removeProperty(p);
    el.removeAttribute('data-csr-mirrored');
  }

  function setDir(el, dir) {
    if (el.getAttribute('data-csr-dir') === dir) return;
    unmirror(el);
    if (!el.hasAttribute('data-csr-dir')) el.setAttribute('data-csr-orig-dir', el.getAttribute('dir') || '');
    const before = dir === 'rtl' ? readBox(el) : null;
    el.setAttribute('dir', dir);
    el.setAttribute('data-csr-dir', dir);
    if (before) mirror(el, before);
  }

  function clearDir(el) {
    unmirror(el);
    const orig = el.getAttribute('data-csr-orig-dir');
    if (orig) el.setAttribute('dir', orig);
    else el.removeAttribute('dir');
    el.removeAttribute('data-csr-dir');
    el.removeAttribute('data-csr-orig-dir');
  }

  const DIR_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, table, dl';

  A.processRtl = function (msg, s) {
    const mode = s.enabled ? s.rtlMode : 'off';
    if (mode === 'off') {
      A.clearRtl(msg);
      return;
    }
    let blocks = Array.from(msg.querySelectorAll(DIR_BLOCKS)).filter((el) => {
      if (el.closest(SEL.ui)) return false;
      if (el.closest('pre')) return false;
      // paragraphs/headings in list items and tables follow their list/table
      if (/^(P|H\d)$/.test(el.tagName)) {
        const holder = el.parentElement && el.parentElement.closest('li, td, th, dd, dt');
        if (holder && msg.contains(holder)) return false;
      }
      return true;
    });
    // plain user messages without any block element
    if (!blocks.length) blocks = [msg];
    for (const el of blocks) {
      const dir = mode === 'force' ? 'rtl' : A.detectDir(proseText(el));
      if (dir) setDir(el, dir);
    }
  };

  A.clearRtl = function (root) {
    const scope = root || document;
    if (root && root.hasAttribute('data-csr-dir')) clearDir(root);
    scope.querySelectorAll('[data-csr-dir]').forEach(clearDir);
  };
})();
