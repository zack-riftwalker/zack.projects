/* Iranian decorative patterns, generated as small SVG tiles.
 * Used by the reading ruler, bookmarks and the pomodoro pop-up. */
(function (root) {
  const CSR = (root.CSR = root.CSR || {});
  const r = (n) => Math.round(n * 100) / 100;

  function starPoints(cx, cy, R, points, innerRatio, rot = 0) {
    const out = [];
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 ? R * innerRatio : R;
      const a = rot + (Math.PI * i) / points;
      out.push(`${r(cx + rad * Math.sin(a))},${r(cy - rad * Math.cos(a))}`);
    }
    return out.join(' ');
  }

  // boteh jegheh (paisley) in a 20×20 box, tip at the top right
  const BOTEH =
    'M8 19C3.5 19 2 15 3 11.5C4.2 7.5 8 5.5 11.5 4.5C14 3.8 15.5 2.5 15.8 1C17.5 3.5 17 7 15.5 10C14 14 12 19 8 19Z';

  const P = {
    termeh: {
      label: 'ترمه',
      colors: { bg: '#7d1a2a', fg: '#e3b24f', soft: '#f6e7c1', ink: '#3b0d14' },
      w: 48,
      h: 24,
      svg: (c) => `
        <rect width="48" height="24" fill="${c.bg}"/>
        <g id="b">
          <path d="${BOTEH}" fill="${c.fg}"/>
          <path d="${BOTEH}" transform="translate(4.4 5.2) scale(.52)" fill="${c.bg}"/>
          <path d="${BOTEH}" transform="translate(6.1 7.8) scale(.3)" fill="${c.soft}"/>
          <circle cx="16.6" cy="1.2" r=".9" fill="${c.soft}"/>
        </g>
        <use href="#b" transform="translate(46 2.5) scale(-1 1)"/>
        <g fill="${c.soft}">
          <circle cx="23.5" cy="4" r="1"/><circle cx="23.5" cy="20" r="1"/>
          <circle cx="1" cy="12" r=".8"/><circle cx="47" cy="12" r=".8"/>
        </g>
        <g fill="${c.fg}" opacity=".85">
          <circle cx="21.6" cy="12" r=".7"/><circle cx="25.4" cy="12" r=".7"/>
          <circle cx="23.5" cy="10.1" r=".7"/><circle cx="23.5" cy="13.9" r=".7"/>
        </g>`,
    },
    kashi: {
      label: 'کاشی',
      colors: { bg: '#1d4e89', fg: '#35a7b8', soft: '#f4f1e6', ink: '#0f2b4d' },
      w: 24,
      h: 24,
      svg: (c) => `
        <rect width="24" height="24" fill="${c.bg}"/>
        <polygon points="${starPoints(12, 12, 9.2, 8, 0.77)}" fill="${c.fg}" stroke="${c.soft}" stroke-width=".8"/>
        <polygon points="${starPoints(12, 12, 4.4, 8, 0.72)}" fill="${c.soft}"/>
        <circle cx="12" cy="12" r="1.3" fill="${c.bg}"/>
        ${[
          [0, 0],
          [24, 0],
          [0, 24],
          [24, 24],
        ]
          .map(([x, y]) => `<polygon points="${starPoints(x, y, 4.2, 4, 0.35, Math.PI / 4)}" fill="#e7c15a"/>`)
          .join('')}`,
    },
    khatam: {
      label: 'خاتم',
      colors: { bg: '#f1e3c4', fg: '#6b3e1f', soft: '#3f6b3a', ink: '#3a220f' },
      w: 20,
      h: 17.32,
      svg: (c) => {
        const star = (x, y, s = 1) =>
          `<polygon points="${r(x)},${r(y - 5.2 * s)} ${r(x + 4.5 * s)},${r(y + 2.6 * s)} ${r(x - 4.5 * s)},${r(y + 2.6 * s)}" fill="${c.fg}"/>` +
          `<polygon points="${r(x)},${r(y + 5.2 * s)} ${r(x + 4.5 * s)},${r(y - 2.6 * s)} ${r(x - 4.5 * s)},${r(y - 2.6 * s)}" fill="${c.soft}"/>` +
          `<circle cx="${r(x)}" cy="${r(y)}" r="${r(1.4 * s)}" fill="${c.bg}"/>`;
        return `<rect width="20" height="17.32" fill="${c.bg}"/>${star(10, 8.66)}${star(0, 0)}${star(20, 0)}${star(0, 17.32)}${star(20, 17.32)}`;
      },
    },
    kilim: {
      label: 'گلیم',
      colors: { bg: '#a8232b', fg: '#1f2a44', soft: '#f3e2bf', ink: '#5c1016' },
      w: 32,
      h: 16,
      svg: (c) => `
        <rect width="32" height="16" fill="${c.bg}"/>
        <polygon points="16,1 19,4 22,4 22,6 25,8 22,10 22,12 19,12 16,15 13,12 10,12 10,10 7,8 10,6 10,4 13,4" fill="${c.fg}"/>
        <polygon points="16,4.5 19.5,8 16,11.5 12.5,8" fill="${c.soft}"/>
        <polygon points="16,6.5 17.5,8 16,9.5 14.5,8" fill="${c.bg}"/>
        <g fill="${c.soft}">
          <polygon points="0,6 2,8 0,10"/><polygon points="32,6 30,8 32,10"/>
          <rect x="3" y="1" width="2" height="2"/><rect x="27" y="1" width="2" height="2"/>
          <rect x="3" y="13" width="2" height="2"/><rect x="27" y="13" width="2" height="2"/>
        </g>`,
    },
    eslimi: {
      label: 'اسلیمی',
      colors: { bg: '#1b2a4a', fg: '#d9ad55', soft: '#7fb7a7', ink: '#0e1629' },
      w: 48,
      h: 24,
      svg: (c) => `
        <rect width="48" height="24" fill="${c.bg}"/>
        <path d="M0 12C8 3 16 3 24 12S40 21 48 12" fill="none" stroke="${c.fg}" stroke-width="1.4"/>
        <path d="M12 5.2c-3 0-4.5 3-2.6 4.8 1.4 1.3 3.6.3 3.2-1.4-.3-1.2-1.9-1.3-2.2-.3" fill="none" stroke="${c.fg}" stroke-width="1.1"/>
        <path d="M36 18.8c3 0 4.5-3 2.6-4.8-1.4-1.3-3.6-.3-3.2 1.4.3 1.2 1.9 1.3 2.2.3" fill="none" stroke="${c.fg}" stroke-width="1.1"/>
        <path d="M18 8.5c2.5-3.2 6-3.4 7.5-1.6-2.4.4-4.8 1.2-7.5 1.6Z" fill="${c.soft}"/>
        <path d="M30 15.5c-2.5 3.2-6 3.4-7.5 1.6 2.4-.4 4.8-1.2 7.5-1.6Z" fill="${c.soft}"/>
        <circle cx="4" cy="4" r="1.2" fill="${c.fg}"/><circle cx="44" cy="20" r="1.2" fill="${c.fg}"/>
        <circle cx="28" cy="4" r=".9" fill="${c.soft}"/><circle cx="20" cy="20" r=".9" fill="${c.soft}"/>`,
    },
    zarif: {
      label: 'ساده‌ی طلایی',
      colors: { bg: '#fbf4e2', fg: '#b8892f', soft: '#e9d8ad', ink: '#5a4214' },
      w: 24,
      h: 12,
      svg: (c) => `
        <rect width="24" height="12" fill="${c.bg}"/>
        <path d="M0 2.5H24M0 9.5H24" stroke="${c.fg}" stroke-width=".8"/>
        <polygon points="12,3.6 14.4,6 12,8.4 9.6,6" fill="${c.fg}"/>
        <circle cx="0" cy="6" r="1" fill="${c.soft}"/><circle cx="24" cy="6" r="1" fill="${c.soft}"/>`,
    },
  };

  CSR.PATTERNS = Object.entries(P).map(([id, p]) => ({ id, label: p.label, colors: p.colors }));

  CSR.patternById = (id) => P[id] || P.termeh;

  CSR.patternSvg = function (id) {
    const p = CSR.patternById(id);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}">${p
      .svg(p.colors)
      .replace(/\s*\n\s*/g, '')}</svg>`;
  };

  /** CSS `url(...)` of a pattern tile, ready for background-image. */
  CSR.patternUrl = function (id) {
    return `url('data:image/svg+xml,${encodeURIComponent(CSR.patternSvg(id)).replace(/'/g, '%27')}')`;
  };

  let seq = 0;

  /** Inline SVG that fills its container with the pattern, tiles scaled to
   * `tileH` px tall. Inline SVG needs no image request, so page CSPs that
   * block data: images can't break it. */
  CSR.patternFill = function (id, tileH = 16) {
    const p = CSR.patternById(id);
    const u = 'csrp' + ++seq + Math.random().toString(36).slice(2, 6);
    const k = r(tileH / p.h);
    const tile = p
      .svg(p.colors)
      .replace(/\s*\n\s*/g, '')
      .replace(/id="b"/g, `id="${u}b"`)
      .replace(/href="#b"/g, `href="#${u}b"`);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block" aria-hidden="true">` +
      `<defs><pattern id="${u}" width="${p.w}" height="${p.h}" patternUnits="userSpaceOnUse" patternTransform="scale(${k})">${tile}</pattern></defs>` +
      `<rect width="100%" height="100%" fill="url(#${u})"/></svg>`
    );
  };

  /** Shamseh (sun medallion) used at the top of the pomodoro pop-up. */
  CSR.shamsehSvg = function (id = 'termeh', size = 88) {
    const c = CSR.patternById(id).colors;
    const petals = [];
    for (let i = 0; i < 16; i++) {
      petals.push(
        `<path d="M50 6C55 16 55 22 50 30C45 22 45 16 50 6Z" transform="rotate(${i * 22.5} 50 50)" fill="${i % 2 ? c.soft : c.fg}"/>`
      );
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill="${c.bg}"/>
      ${petals.join('')}
      <circle cx="50" cy="50" r="20" fill="${c.bg}" stroke="${c.fg}" stroke-width="2"/>
      <polygon points="${starPoints(50, 50, 16, 8, 0.72)}" fill="${c.fg}"/>
      <polygon points="${starPoints(50, 50, 7, 8, 0.7)}" fill="${c.soft}"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="${c.fg}" stroke-width="2.5"/>
      <circle cx="50" cy="50" r="41" fill="none" stroke="${c.soft}" stroke-width=".8" stroke-dasharray="2 2.5"/>
    </svg>`;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
