/* Makes reading themes work whatever Claude's CSS looks like.
 *
 * 1. Discovers the page's CSS color variables at runtime (any names:
 *    --bg-100, --surface-primary, --color-background…), works out from their
 *    current colors which ones are backgrounds / text / borders, and overrides
 *    them in the same format they use (hex, rgb(), "H S% L%" channels, oklch…).
 * 2. Fallback that needs no variables at all: repaints the reading area
 *    (the containers around the messages, user bubbles, cards inside answers).
 * 3. Switches Claude's own light/dark mode, whichever mechanism it uses. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const TF = (CSR.themeFix = {});
  const C = CSR.color;

  // ---------------------------------------------------------------------------
  // colors

  let ctx = null;
  /** Any CSS color → {r,g,b,a}, or null. */
  function toRgb(css) {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#010203';
    ctx.fillStyle = css;
    if (ctx.fillStyle === '#010203' && !/^#010203$/i.test(css.trim())) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  TF.toRgb = toRgb;

  const lum = (rgb) => C.luminance(C.rgbToHex(rgb));

  function toOklch({ r, g, b }) {
    const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const Cc = Math.sqrt(a * a + bb * bb);
    let H = (Math.atan2(bb, a) * 180) / Math.PI;
    if (H < 0) H += 360;
    return { L, C: Cc, H };
  }

  /** Detects how a variable stores its color. */
  function formatOf(v) {
    const s = v.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: 'hex', color: toRgb(s) };
    if (/^(rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\(/i.test(s)) return { kind: 'fn', color: toRgb(s) };
    let m = s.match(/^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*(\/\s*[\d.]+%?)?$/);
    if (m) return { kind: 'hsl-ch', alpha: m[4] || '', color: toRgb(`hsl(${m[1]} ${m[2]}% ${m[3]}%)`) };
    m = s.match(/^(\d{1,3})(\s*,\s*|\s+)(\d{1,3})\2(\d{1,3})$/);
    if (m) return { kind: 'rgb-ch', sep: m[2].includes(',') ? ', ' : ' ', color: toRgb(`rgb(${m[1]}, ${m[3]}, ${m[4]})`) };
    m = s.match(/^([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)$/);
    if (m) return { kind: 'oklch-ch', pct: m[2] === '%', color: toRgb(`oklch(${s})`) };
    return null;
  }

  function write(fmt, hex) {
    const rgb = C.hexToRgb(hex);
    switch (fmt.kind) {
      case 'hsl-ch':
        return C.hslChannels(hex) + (fmt.alpha ? ' ' + fmt.alpha : '');
      case 'rgb-ch':
        return [rgb.r, rgb.g, rgb.b].join(fmt.sep);
      case 'oklch-ch': {
        const o = toOklch(rgb);
        return `${fmt.pct ? (o.L * 100).toFixed(2) + '%' : o.L.toFixed(4)} ${o.C.toFixed(4)} ${o.H.toFixed(2)}`;
      }
      default:
        return hex;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. variable discovery

  const SKIP_NAME =
    /^--(csr|tw-|_)|font|radius|shadow|spacing|space|size|width|height|z-?index|duration|ease|delay|opacity|blur|leading|tracking|weight|gap|inset|offset|scale|rotate|translate|accent|brand|danger|error|warning|success|info|link|focus|selection|highlight|code|syntax|chart|shiki|hljs|prism|diff|on-?color|always|clay|kraft|cloth|manilla|primary-foreground|destructive|ring/i;
  const TEXT_NAME = /(^|[-_])(text|fg|foreground|ink|content|copy|heading|title|label|muted-foreground)([-_]|$)/i;
  const BORDER_NAME = /(border|divider|outline|stroke|separator|hairline|rule)/i;
  const BG_NAME = /(bg|background|surface|canvas|page|base|layer|elevat|sidebar|panel|card|popover|sheet|well|backdrop|fill|container|chrome|app|muted|secondary|input)/i;

  let vars = null; // [{name, fmt, role, rgb}]
  let pageLum = null;
  let hosts = [];

  function customProps(el) {
    const out = new Map();
    const cs = getComputedStyle(el);
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (p.startsWith('--')) out.set(p, cs.getPropertyValue(p));
    }
    return out;
  }

  function opaqueBg(el) {
    const c = toRgb(getComputedStyle(el).backgroundColor);
    return c && c.a > 0.5 ? c : null;
  }

  /** Reads Claude's original colors. Runs once, with our theme switched off. */
  function discover(messages) {
    const html = document.documentElement;
    const had = html.hasAttribute('data-csr-theme');
    html.removeAttribute('data-csr-theme');
    try {
      const probe = messages[0] || document.body;
      const props = customProps(probe);
      // page luminance: first opaque background around the conversation
      let el = probe;
      let bg = null;
      while (el && !bg) {
        bg = opaqueBg(el);
        el = el.parentElement;
      }
      pageLum = bg ? lum(bg) : 1;
      vars = [];
      for (const [name, value] of props) {
        if (SKIP_NAME.test(name)) continue;
        const role = BORDER_NAME.test(name) ? 'border' : TEXT_NAME.test(name) ? 'text' : BG_NAME.test(name) ? 'bg' : null;
        if (!role) continue;
        const fmt = formatOf(value);
        if (!fmt || !fmt.color || fmt.color.a < 0.05) continue;
        vars.push({ name, fmt, role, rgb: fmt.color });
      }
      // elements that (re)declare variables, so our overrides can target them
      hosts = [];
      let prev = null;
      for (let e = probe; e; e = e.parentElement) {
        if (prev) {
          const mine = getComputedStyle(prev);
          const up = getComputedStyle(e);
          if (vars.some((v) => mine.getPropertyValue(v.name) !== up.getPropertyValue(v.name))) hosts.push(prev);
        }
        prev = e;
      }
      hosts.forEach((h) => h.setAttribute('data-csr-varhost', ''));
    } finally {
      if (had) html.setAttribute('data-csr-theme', '');
    }
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /** CSS overriding the discovered variables for theme `t`. */
  TF.varCss = function (t) {
    if (!vars || !vars.length) return '';
    const lines = [];
    const textVars = vars.filter((v) => v.role === 'text');
    const cmax = Math.max(0.3, ...textVars.map((v) => Math.abs(lum(v.rgb) - pageLum)));
    for (const v of vars) {
      const L = lum(v.rgb);
      const d = L - pageLum;
      let hex = null;
      if (v.role === 'bg') {
        if (Math.abs(d) > 0.4) continue; // a contrasting surface (tooltip, button): leave it
        if (t.dark) hex = d >= 0 ? C.mix(t.bg, t.text, clamp(d * 1.5, 0, 0.2)) : C.mix(t.bg, '#000000', clamp(-d * 3, 0, 0.6));
        else hex = d >= 0 ? C.mix(t.bg, '#ffffff', clamp(d * 3, 0, 0.85)) : C.mix(t.bg, t.text, clamp(-d * 1.2, 0, 0.18));
      } else if (v.role === 'text') {
        const c = Math.abs(d);
        if (c < 0.25) continue; // text meant for colored buttons
        const strong = v.name.match(/heading|title|000/i) ? t.heading || t.text : t.text;
        hex = C.mix(strong, t.bg, clamp(1 - c / cmax, 0, 0.55));
      } else {
        hex = C.mix(t.bg, t.text, 0.18);
      }
      lines.push(`${v.name}: ${write(v.fmt, hex)} !important;`);
    }
    if (!lines.length) return '';
    return `html[data-csr-theme], html[data-csr-theme] :is(body, [data-theme], [data-mode], .dark, .light, [data-csr-varhost]) { ${lines.join(' ')} }`;
  };

  // ---------------------------------------------------------------------------
  // 2. repaint the reading area

  const SURFACE_SEL = 'div, section, aside, details, summary, figure, table, thead, tbody, tr, th, td, blockquote, header, footer';
  const scanned = new WeakSet();

  let checked = new WeakSet();

  /** Containers around the messages → page color; user-message bubbles → bubble color. */
  function paintChain(messages) {
    if (!messages.length) return;
    const owners = new Map(); // element -> set of messages inside it
    for (const m of messages) {
      for (let e = m; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        if (checked.has(e)) continue;
        if (!owners.has(e)) owners.set(e, []);
        owners.get(e).push(m);
      }
    }
    for (const [e, inside] of owners) {
      checked.add(e);
      if (e.hasAttribute('data-csr-paint') || e.closest('[data-csr-ui]')) continue;
      if (!opaqueBg(e)) continue;
      const one = inside.length === 1 ? inside[0] : null;
      let kind = 'page';
      if (one && dom.roleOf(one) === 'user') {
        const parent = e.parentElement;
        const narrow = parent && e.getBoundingClientRect().width < parent.getBoundingClientRect().width * 0.92;
        if (e === one || one.contains(e) || narrow) kind = 'bubble';
      }
      e.setAttribute('data-csr-paint', kind);
    }
  }

  function paintInside(msg) {
    for (const e of msg.querySelectorAll(SURFACE_SEL)) {
      if (e.hasAttribute('data-csr-paint') || e.closest('pre, code, .katex, [data-csr-ui]') || e.querySelector('pre')) continue;
      if (opaqueBg(e)) e.setAttribute('data-csr-paint', 'surface');
    }
  }

  /** Called from the sync loop while a theme is active. */
  TF.sync = function (messages, changed, isStable) {
    const t = CSR.settings.enabled ? CSR.resolveTheme(CSR.settings) : null;
    if (!t || !messages.length) return;
    if (!vars) {
      discover(messages);
      CSR.appearance.apply(CSR.settings); // now with the discovered variables
    }
    syncInner(t.dark ? 'dark' : 'light');
    paintChain(messages);
    for (const m of messages) {
      if ((changed.includes(m) || !scanned.has(m)) && isStable(m)) {
        scanned.add(m);
        paintInside(m);
      }
    }
  };

  TF.reset = function () {
    document.querySelectorAll('[data-csr-paint]').forEach((e) => e.removeAttribute('data-csr-paint'));
    checked = new WeakSet();
  };

  /** Extra --csr-t-* colors used by the repaint rules. */
  TF.baseVars = function (t) {
    const surface = t.dark ? C.mix(t.bg, t.text, 0.07) : C.mix(t.bg, t.text, 0.04);
    const bubble = t.dark ? C.mix(t.bg, t.text, 0.11) : C.mix(t.bg, t.text, 0.075);
    return `--csr-t-surface: ${surface}; --csr-t-bubble: ${bubble}; --csr-t-border: ${C.mix(t.bg, t.text, 0.18)};`;
  };

  // ---------------------------------------------------------------------------
  // 3. Claude's own light/dark mode

  let flips = 0;
  let flipWindow = 0;

  function mechanism() {
    const html = document.documentElement;
    const body = document.body;
    if (html.hasAttribute('data-mode')) return { el: html, kind: 'attr', name: 'data-mode' };
    if (html.classList.contains('dark') || html.classList.contains('light')) return { el: html, kind: 'class' };
    const th = html.getAttribute('data-theme');
    if (th === 'dark' || th === 'light') return { el: html, kind: 'attr', name: 'data-theme' };
    if (body && (body.classList.contains('dark') || body.classList.contains('light'))) return { el: body, kind: 'class' };
    const bth = body && body.getAttribute('data-theme');
    if (bth === 'dark' || bth === 'light') return { el: body, kind: 'attr', name: 'data-theme' };
    const cs = html.getAttribute('data-color-scheme');
    if (cs === 'dark' || cs === 'light') return { el: html, kind: 'attr', name: 'data-color-scheme' };
    return null;
  }

  function read(m) {
    if (m.kind === 'class') return m.el.classList.contains('dark') ? 'dark' : 'light';
    return m.el.getAttribute(m.name);
  }

  function set(m, v) {
    if (m.kind === 'class') {
      m.el.classList.toggle('dark', v === 'dark');
      m.el.classList.toggle('light', v === 'light');
    } else m.el.setAttribute(m.name, v);
  }

  let original = null; // { m, value }

  /** Claude's design system also sets data-mode on inner containers. */
  function syncInner(want) {
    if (!want) {
      // put back every container we flipped, however many there are
      for (const el of document.querySelectorAll('[data-csr-orig-mode]:not(html)')) {
        el.setAttribute('data-mode', el.getAttribute('data-csr-orig-mode'));
        el.removeAttribute('data-csr-orig-mode');
      }
      return;
    }
    let n = 0;
    for (const el of document.querySelectorAll('[data-mode]:not(html)')) {
      if (el.closest('[data-csr-ui]')) continue;
      const cur = el.getAttribute('data-mode');
      if (cur === want || (cur !== 'dark' && cur !== 'light')) continue;
      if (++n > 60) break; // at most this many flips per pass
      if (!el.hasAttribute('data-csr-orig-mode')) el.setAttribute('data-csr-orig-mode', cur);
      el.setAttribute('data-mode', want);
    }
  }

  TF.syncMode = function (settings) {
    const t = settings.enabled ? CSR.resolveTheme(settings) : null;
    if (document.body) syncInner(t ? (t.dark ? 'dark' : 'light') : null);
    if (!t) {
      if (original) {
        set(original.m, original.value);
        original = null;
      }
      return;
    }
    const m = original ? original.m : mechanism();
    if (!m) return;
    const want = t.dark ? 'dark' : 'light';
    const cur = read(m);
    if (cur === want) return;
    const now = Date.now();
    if (now - flipWindow > 10000) {
      flipWindow = now;
      flips = 0;
    }
    if (++flips > 6) return; // Claude keeps switching it back; the repaint still covers the reading area
    if (!original) original = { m, value: cur };
    set(m, want);
  };

  /** Info for the diagnostic report. */
  TF.report = function () {
    return {
      pageLum: pageLum,
      vars: (vars || []).slice(0, 60).map((v) => `${v.name}:${v.role}:${v.fmt.kind}`),
      hosts: hosts.map((h) => h.tagName.toLowerCase() + (h.className && typeof h.className === 'string' ? '.' + h.className.split(/\s+/).slice(0, 4).join('.') : '')),
      mode: (() => {
        const m = mechanism();
        return m ? `${m.kind}:${m.name || ''}=${read(m)}` : 'none';
      })(),
    };
  };
})();
