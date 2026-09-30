(async function () {
  const CSR = globalThis.CSR;
  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n).toLocaleString('fa-IR');

  let convs = [];
  let query = '';
  let filter = 'all';

  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  }

  /** Text with the search query wrapped in <mark>, built with DOM nodes only. */
  function highlighted(text) {
    if (!query) return [text];
    const out = [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let i = 0;
    let j;
    while ((j = lower.indexOf(q, i)) >= 0) {
      out.push(text.slice(i, j), h('mark', null, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    out.push(text.slice(i));
    return out;
  }

  const swatch = (id) => (CSR.HIGHLIGHTS.find((x) => x.id === id) || {}).swatch;

  function matches(a) {
    if (filter === 'notes' && !(a.note && a.note.trim())) return false;
    if (CSR.HIGHLIGHTS.some((c) => c.id === filter) && !(a.kind === 'mark' && a.style && a.style.hl === filter)) return false;
    if (!query) return true;
    const d = CSR.describeAnnotation(a);
    return (d.text + ' ' + (a.note || '')).toLowerCase().includes(query.toLowerCase());
  }

  function render() {
    const list = $('list');
    list.textContent = '';
    const total = convs.reduce((n, c) => n + c.annotations.length, 0);
    $('stats').textContent = `${fa(convs.length)} گفتگو · ${fa(total)} هایلایت، یادداشت و طراحی`;
    if (!convs.length) {
      list.append($('empty').content.cloneNode(true));
      return;
    }
    let shown = 0;
    for (const conv of convs) {
      const items = conv.annotations
        .filter((a) => a.kind !== 'drawing' || filter === 'all')
        .filter(matches)
        .sort((x, y) => (x.anchor.msg || 0) - (y.anchor.msg || 0) || (x.anchor.start ?? 0) - (y.anchor.start ?? 0));
      const nb = (conv.notebook || '').trim();
      const nbMatch = nb && (!query || nb.toLowerCase().includes(query.toLowerCase())) && filter === 'all';
      if (!items.length && !nbMatch) continue;
      shown++;
      const date = conv.updated ? new Date(conv.updated).toLocaleDateString('fa-IR', { dateStyle: 'medium' }) : '';
      list.append(
        h(
          'article',
          { class: 'conv' },
          h(
            'div',
            { class: 'conv-head' },
            h('a', { class: 'conv-title', href: conv.url || `https://claude.ai/chat/${conv.id}`, target: '_blank', rel: 'noopener', dir: 'auto' }, conv.title || 'گفتگوی بی‌نام'),
            h('span', { class: 'conv-meta' }, `${fa(conv.annotations.length)} مورد · ${date}`),
            h(
              'div',
              { class: 'conv-actions' },
              h('button', { class: 'btn ghost small', onclick: () => CSR.downloadText(CSR.safeFilename(conv.title) + '.md', CSR.exportMarkdown(conv)) }, 'Markdown'),
              h(
                'button',
                {
                  class: 'btn ghost small danger',
                  onclick: async () => {
                    if (!confirm(`همه‌ی یادداشت‌های «${conv.title || 'این گفتگو'}» پاک شود؟`)) return;
                    await CSR.store.deleteConv(conv.id);
                    await load();
                  },
                },
                'حذف'
              )
            )
          ),
          h(
            'div',
            { class: 'items' },
            items.map((a) => {
              const d = CSR.describeAnnotation(a);
              const color = a.kind === 'mark' && a.style && a.style.hl ? swatch(a.style.hl) : '';
              return h(
                'div',
                { class: 'item', style: color ? `--c:${color}` : '' },
                h('div', { class: 'item-text', dir: 'auto' }, d.icon + ' ', highlighted(d.text)),
                d.tags.length ? h('div', { class: 'item-tags' }, d.tags.join(' · ')) : null,
                a.note && a.note.trim() ? h('div', { class: 'item-note', dir: 'auto' }, '📝 ', highlighted(a.note.trim())) : null
              );
            })
          ),
          nbMatch ? h('div', { class: 'notebook', dir: 'auto' }, h('b', null, 'دفترچه'), highlighted(nb)) : null
        )
      );
    }
    if (!shown) list.append(h('div', { class: 'empty' }, 'چیزی پیدا نشد.'));
  }

  async function load() {
    convs = await CSR.store.listConvs();
    render();
  }

  // filters
  const filters = [['all', 'همه'], ['notes', 'یادداشت‌دار'], ...CSR.HIGHLIGHTS.map((c) => [c.id, c.label])];
  for (const [id, label] of filters) {
    const chip = h(
      'button',
      {
        class: 'chip' + (id === filter ? ' on' : ''),
        onclick: () => {
          filter = id;
          document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
          render();
        },
      },
      swatch(id) ? h('span', { class: 'dot', style: `--c:${swatch(id)}` }) : null,
      label
    );
    $('filters').append(chip);
  }

  $('q').addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });

  $('exportMd').addEventListener('click', () => {
    const md = convs.map((c) => CSR.exportMarkdown(c)).join('\n\n---\n\n');
    CSR.downloadText('claude-notes.md', md);
  });

  $('exportJson').addEventListener('click', async () => {
    const settings = await CSR.store.getSettings();
    const data = { app: 'khana-claude-reader', version: 1, exported: new Date().toISOString(), settings, conversations: convs };
    CSR.downloadText(`khana-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  });

  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.conversations)) throw new Error('bad file');
      let merged = 0;
      for (const c of data.conversations) {
        if (!c || !c.id || !Array.isArray(c.annotations)) continue;
        const cur = await CSR.store.getConv(c.id);
        const ids = new Set(cur.annotations.map((a) => a.id));
        cur.annotations.push(...c.annotations.filter((a) => a && a.id && !ids.has(a.id)));
        if (c.notebook && !cur.notebook.includes(c.notebook)) cur.notebook = [cur.notebook, c.notebook].filter(Boolean).join('\n\n');
        cur.title = cur.title || c.title || '';
        cur.url = cur.url || c.url || '';
        await CSR.store.saveConv(cur);
        merged++;
      }
      if (data.settings && confirm('تنظیمات ذخیره‌شده در فایل پشتیبان هم بازگردانی شود؟')) {
        await CSR.store.saveSettings(CSR.deepMerge(CSR.DEFAULT_SETTINGS, data.settings));
      }
      alert(`${fa(merged)} گفتگو بازگردانی شد.`);
      await load();
    } catch (err) {
      alert('این فایل پشتیبان معتبر نیست.');
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(CSR.store.CONV_PREFIX))) load();
  });

  load();
})();
