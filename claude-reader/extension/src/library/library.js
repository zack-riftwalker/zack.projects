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

  const hasContent = (c) =>
    c.annotations.length || (c.notebook || '').trim() || (c.tags && c.tags.length) || (c.progress && c.progress.read && Object.keys(c.progress.read).length);

  function matches(a, conv) {
    if (filter.startsWith('#')) {
      const t = filter.slice(1);
      if (!((a.tags || []).includes(t) || (conv.tags || []).includes(t))) return false;
    }
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
    $('stats').textContent = `${fa(convs.length)} گفتگو، ${fa(total)} هایلایت، یادداشت و طراحی`;
    if (!convs.length) {
      list.append($('empty').content.cloneNode(true));
      return;
    }
    let shown = 0;
    for (const conv of convs) {
      const items = conv.annotations
        .filter((a) => a.kind !== 'drawing' || filter === 'all')
        .filter((a) => matches(a, conv))
        .sort(CSR.compareAnchors);
      const nb = (conv.notebook || '').trim();
      const nbMatch = nb && (!query || nb.toLowerCase().includes(query.toLowerCase())) && filter === 'all';
      if (!items.length && !nbMatch) continue;
      shown++;
      const date = conv.updated ? new Date(conv.updated).toLocaleDateString('fa-IR', { dateStyle: 'medium' }) : '';
      const pr = conv.progress || {};
      const readN = pr.read ? Object.keys(pr.read).length : 0;
      const pct = pr.total ? Math.min(100, Math.round((readN / pr.total) * 100)) : 0;
      list.append(
        h(
          'article',
          { class: 'conv' },
          h(
            'div',
            { class: 'conv-head' },
            h('a', { class: 'conv-title', href: conv.url || `https://claude.ai/chat/${conv.id}`, target: '_blank', rel: 'noopener', dir: 'auto' }, conv.title || 'گفتگوی بی‌نام'),
            h('span', { class: 'conv-meta' }, `${fa(conv.annotations.length)} مورد، ${date}`),
            pr.total
              ? h('span', { class: 'progress', title: `${fa(readN)} از ${fa(pr.total)} بخش خوانده شده` }, h('span', { class: 'bar' }, h('span', { style: `width:${pct}%` })), `${fa(pct)}٪`)
              : null,
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
          convTags(conv),
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
                d.tags.length ? h('div', { class: 'item-tags' }, d.tags.join('، ')) : null,
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

  function convTags(conv) {
    const box = h('div', { class: 'conv-tags' });
    for (const t of conv.tags || []) {
      box.append(
        h(
          'span',
          { class: 'ctag' },
          '#' + t,
          h(
            'button',
            {
              title: 'حذف برچسب',
              onclick: async () => {
                conv.tags = conv.tags.filter((x) => x !== t);
                await CSR.store.saveConv(conv);
              },
            },
            '×'
          )
        )
      );
    }
    box.append(
      h('input', {
        class: 'ctag-input',
        placeholder: '+ برچسب گفتگو',
        dir: 'auto',
        onkeydown: async (e) => {
          const v = e.target.value.replace(/^#/, '').trim();
          if (e.key !== 'Enter' || !v) return;
          conv.tags = Array.from(new Set([...(conv.tags || []), v]));
          await CSR.store.saveConv(conv);
        },
      })
    );
    return box;
  }

  function renderFilters() {
    const box = $('filters');
    box.textContent = '';
    const tags = new Map();
    for (const c of convs) {
      for (const t of c.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
      for (const a of c.annotations) for (const t of a.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    }
    const all = [['all', 'همه'], ['notes', 'یادداشت‌دار'], ...CSR.HIGHLIGHTS.map((c) => [c.id, c.label]), ...[...tags.keys()].map((t) => ['#' + t, '#' + t])];
    for (const [id, label] of all) {
      box.append(
        h(
          'button',
          {
            class: 'chip' + (id === filter ? ' on' : ''),
            onclick: () => {
              filter = filter === id && id !== 'all' ? 'all' : id;
              renderFilters();
              render();
            },
          },
          swatch(id) ? h('span', { class: 'dot', style: `--c:${swatch(id)}` }) : null,
          label
        )
      );
    }
  }

  async function load() {
    convs = (await CSR.store.listConvs()).filter(hasContent);
    renderFilters();
    render();
    renderVocab();
    renderStats();
  }

  // ---------------------------------------------------------------------------
  // tabs

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
      for (const id of ['convs', 'vocab', 'stats']) $('tab-' + id).hidden = id !== t.dataset.tab;
    })
  );

  // ---------------------------------------------------------------------------
  // vocabulary

  let vocab = [];
  let vq = '';

  async function renderVocab() {
    vocab = (await chrome.storage.local.get('vocab')).vocab || [];
    const box = $('vocabList');
    box.textContent = '';
    $('vocabCount').textContent = `${fa(vocab.length)} لغت`;
    const list = vocab.filter((v) => !vq || (v.word + ' ' + v.fa.join(' ') + ' ' + v.def).toLowerCase().includes(vq.toLowerCase()));
    if (!vocab.length) {
      box.append(h('div', { class: 'empty' }, 'روی هر کلمه‌ی انگلیسی در پاسخ‌های Claude دوبار کلیک کن و «افزودن به لغت‌نامه» را بزن.'));
      return;
    }
    for (const v of list) {
      box.append(
        h(
          'div',
          { class: 'vocab' },
          h('div', { class: 'vocab-word' }, highlighted(v.word), v.phonetic ? h('small', null, v.phonetic) : null),
          h(
            'div',
            { class: 'vocab-actions' },
            h(
              'button',
              {
                class: 'btn ghost small',
                title: 'تلفظ',
                onclick: () => {
                  const u = new SpeechSynthesisUtterance(v.word);
                  u.lang = 'en-US';
                  speechSynthesis.speak(u);
                },
              },
              '🔊'
            ),
            h(
              'button',
              {
                class: 'btn ghost small danger',
                onclick: async () => {
                  const cur = ((await chrome.storage.local.get('vocab')).vocab || []).filter((x) => x.word !== v.word);
                  await chrome.storage.local.set({ vocab: cur });
                  renderVocab();
                },
              },
              'حذف'
            )
          ),
          h('div', { class: 'vocab-fa' }, highlighted(v.fa.join('، '))),
          v.def ? h('div', { class: 'vocab-def' }, v.def) : null,
          v.context ? h('div', { class: 'vocab-ctx' }, '«' + v.context + '»') : null
        )
      );
    }
  }

  $('vq').addEventListener('input', (e) => {
    vq = e.target.value.trim();
    query = vq;
    renderVocab().then(() => (query = $('q').value.trim()));
  });

  $('vocabCsv').addEventListener('click', () => {
    const esc = (x) => '"' + String(x || '').replace(/"/g, '""') + '"';
    const rows = vocab.map((v) => [v.word, v.fa.join('، '), v.phonetic, v.def, v.context].map(esc).join(','));
    CSR.downloadText('khana-vocab.csv', '\ufeff' + ['word,persian,phonetic,definition,context', ...rows].join('\n'), 'text/csv');
  });

  // ---------------------------------------------------------------------------
  // stats

  async function renderStats() {
    const st = (await chrome.storage.local.get('stats')).stats || { days: {} };
    const days = st.days || {};
    const box = $('statsBox');
    box.textContent = '';
    const keyOf = (d) => CSR.dayKey(d);
    const today = new Date();
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      series.push({ d, secs: days[keyOf(d)] || 0 });
    }
    const week = series.slice(-7).reduce((n, x) => n + x.secs, 0);
    const total = Object.values(days).reduce((n, x) => n + x, 0);
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      if ((days[keyOf(d)] || 0) >= 60) streak++;
      else if (i > 0 || (days[keyOf(d)] || 0) > 0) break;
      if (i > 3650) break;
    }
    const tile = (value, label) => h('div', { class: 'tile' }, h('b', null, value), h('span', null, label));
    box.append(
      h(
        'div',
        { class: 'tiles' },
        tile(CSR.faDuration(series[13].secs), 'امروز'),
        tile(CSR.faDuration(week), '۷ روز اخیر'),
        tile(`${fa(streak)} روز`, 'روزهای پشت‌سرهم'),
        tile(CSR.faDuration(total), 'کل زمان مطالعه')
      )
    );
    const max = Math.max(60, ...series.map((x) => x.secs));
    const dayName = (d) => d.toLocaleDateString('fa-IR', { weekday: 'short' });
    const bars = h(
      'div',
      { class: 'bars', role: 'img', 'aria-label': 'نمودار دقیقه‌های مطالعه در ۱۴ روز اخیر' },
      series.map((x, i) => {
        const min = Math.round(x.secs / 60);
        return h(
          'div',
          { class: 'bar-col' + (i === 13 ? ' today' : '') },
          h('span', { class: 'tip' }, `${x.d.toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })}: ${CSR.faDuration(x.secs)}`),
          i === 13 && min ? h('span', { class: 'val' }, fa(min)) : null,
          h('i', { style: `height:${(x.secs / max) * 100}%` })
        );
      })
    );
    const table = h(
      'table',
      { class: 'sr-only' },
      h('tbody', null, series.map((x) => h('tr', null, h('td', null, keyOf(x.d)), h('td', null, CSR.faDuration(x.secs)))))
    );
    box.append(
      h(
        'div',
        { class: 'chart' },
        h('h2', null, 'دقیقه‌های مطالعه در ۱۴ روز اخیر'),
        bars,
        h('div', { class: 'labels' }, series.map((x) => h('span', null, dayName(x.d)))),
        table
      )
    );
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
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(CSR.store.CONV_PREFIX) || k === 'vocab' || k === 'stats')) load();
  });

  load();
})();
