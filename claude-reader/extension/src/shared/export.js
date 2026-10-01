/* Markdown export of a conversation's annotations (used by the page and the library). */
(function (root) {
  const CSR = (root.CSR = root.CSR || {});

  const COLOR_EMOJI = { yellow: '🟨', green: '🟩', blue: '🟦', pink: '🩷', orange: '🟧', purple: '🟪' };
  const FORMAT_LABEL = { bold: 'بولد', italic: 'ایتالیک', underline: 'زیرخط', strike: 'خط‌خورده', code: 'کد', box: 'کادر' };

  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function sortAnn(list) {
    return list
      .slice()
      .sort(
        (x, y) =>
          (x.anchor.row ?? x.anchor.msg ?? 0) - (y.anchor.row ?? y.anchor.msg ?? 0) ||
          (x.anchor.start ?? x.anchor.block ?? 0) - (y.anchor.start ?? y.anchor.block ?? 0)
      );
  }

  CSR.describeAnnotation = function (a) {
    if (a.kind === 'mark') {
      const st = a.style || {};
      const tags = Object.keys(FORMAT_LABEL).filter((k) => st[k]).map((k) => FORMAT_LABEL[k]);
      return { icon: st.hl ? COLOR_EMOJI[st.hl] || '🖍' : a.note ? '📝' : '✦', text: oneLine(a.anchor.exact), tags: tags.concat((a.tags || []).map((t) => '#' + t)) };
    }
    if (a.kind === 'block') {
      return { icon: a.style === 'quote' ? '❝' : '★', text: oneLine(a.anchor.snippet), tags: [a.style === 'quote' ? 'نقل‌قول' : 'مهم'] };
    }
    if (a.kind === 'divider') return { icon: '―', text: a.label ? oneLine(a.label) : 'خط جداکننده', tags: [] };
    if (a.kind === 'bookmark') return { icon: '🔖', text: a.label ? oneLine(a.label) : 'نشانک', tags: [] };
    if (a.kind === 'drawing') return { icon: '✏️', text: `طراحی (${(a.strokes || []).length.toLocaleString('fa-IR')} خط)`, tags: [] };
    return { icon: '•', text: '', tags: [] };
  };

  CSR.exportMarkdown = function (conv) {
    const lines = [];
    lines.push(`# ${conv.title || 'گفتگو با Claude'}`, '');
    if (conv.url) lines.push(conv.url, '');
    lines.push(`_خروجی گرفته‌شده در ${new Date().toLocaleString('fa-IR')}_`, '');
    const list = sortAnn(conv.annotations || []).filter(
      (a) => a.kind === 'mark' || a.kind === 'block' || a.kind === 'bookmark' || (a.kind === 'divider' && a.label)
    );
    if (list.length) {
      lines.push('## هایلایت‌ها و یادداشت‌ها', '');
      for (const a of list) {
        const d = CSR.describeAnnotation(a);
        const tags = d.tags.length ? ` _(${d.tags.join('، ')})_` : '';
        if (a.kind === 'divider') {
          lines.push(`### ${d.text}`, '');
          continue;
        }
        if (a.kind === 'bookmark') {
          lines.push(`- 🔖 **${d.text}**`);
          continue;
        }
        lines.push(`- ${d.icon} «${d.text}»${tags}`);
        if (a.note && a.note.trim()) {
          for (const [i, l] of a.note.trim().split('\n').entries()) lines.push(`  ${i === 0 ? '- 📝 ' : '  '}${l}`);
        }
      }
      lines.push('');
    }
    if (conv.notebook && conv.notebook.trim()) {
      lines.push('## دفترچه', '', conv.notebook.trim(), '');
    }
    return lines.join('\n');
  };

  CSR.downloadText = function (filename, text, type = 'text/markdown') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  CSR.safeFilename = function (s) {
    return (oneLine(s) || 'claude-notes').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
