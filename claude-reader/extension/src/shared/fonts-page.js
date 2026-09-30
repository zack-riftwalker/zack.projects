/* Font registration for the extension's own pages (popup, library). */
(function (root) {
  const CSR = root.CSR;
  const q = (name) => '"' + String(name).replace(/["\\]/g, '') + '"';

  const rules = [];
  for (const f of CSR.PERSIAN_FONTS) {
    if (f.kind === 'bundled') {
      for (const file of CSR.FONT_FILES[f.id]) {
        rules.push(
          `@font-face{font-family:"CSR Fa ${f.id}";src:url("/fonts/${file.file}") format("woff2");` +
            `font-weight:${file.weight};font-style:${file.style || 'normal'};unicode-range:${CSR.ARABIC_RANGE};font-display:swap}`
        );
      }
    } else if (f.kind === 'local') {
      rules.push(`@font-face{font-family:"CSR Fa ${f.id}";src:local(${q(f.local)});unicode-range:${CSR.ARABIC_RANGE}}`);
    }
  }
  for (const f of CSR.LATIN_FONTS) {
    if (f.kind !== 'bundled') continue;
    for (const file of CSR.FONT_FILES[f.id]) {
      rules.push(
        `@font-face{font-family:"CSR La ${f.id}";src:url("/fonts/${file.file}") format("woff2");` +
          `font-weight:${file.weight};font-style:${file.style || 'normal'};font-display:swap}`
      );
    }
  }
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.head.appendChild(style);

  /** Same stack logic as the content script, for previews. */
  CSR.pageFontStack = function (s) {
    const parts = [];
    const fa = CSR.PERSIAN_FONTS.find((x) => x.id === s.persianFont);
    const la = CSR.LATIN_FONTS.find((x) => x.id === s.latinFont);
    if (fa && (fa.kind === 'bundled' || fa.kind === 'local')) parts.push(q('CSR Fa ' + fa.id));
    if (fa && fa.kind === 'custom' && s.customPersianFont) parts.push(q(s.customPersianFont));
    if (la && la.kind === 'bundled') parts.push(q('CSR La ' + la.id));
    if (la && la.kind === 'stack') parts.push(la.stack);
    if (la && la.kind === 'custom' && s.customLatinFont) parts.push(q(s.customLatinFont));
    if (!la || la.kind === 'none') parts.push('Georgia', '"Times New Roman"');
    parts.push('"CSR Fa vazirmatn"', 'serif');
    return parts.join(', ');
  };
})(globalThis);
