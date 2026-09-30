(async function () {
  const CSR = globalThis.CSR;
  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n).toLocaleString('fa-IR');

  let s = await CSR.store.getSettings();
  let saveTimer = 0;
  const save = (now) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => CSR.store.saveSettings(s), now ? 0 : 150);
  };

  // ---------- tabs ----------
  const showTab = (id) => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
    document.querySelectorAll('section[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== id));
    try {
      localStorage.setItem('csr-tab', id);
    } catch (e) {}
  };
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  try {
    showTab(localStorage.getItem('csr-tab') || 'type');
  } catch (e) {
    showTab('type');
  }

  // ---------- on/off ----------
  $('enabled').checked = s.enabled;
  $('enabled').addEventListener('change', (e) => {
    s.enabled = e.target.checked;
    document.body.style.opacity = s.enabled ? '' : '0.6';
    save(true);
  });
  document.body.style.opacity = s.enabled ? '' : '0.6';

  // ---------- fonts ----------
  function fillSelect(sel, list, value) {
    for (const f of list) sel.append(new Option(f.label, f.id, false, f.id === value));
  }
  fillSelect($('persianFont'), CSR.PERSIAN_FONTS, s.persianFont);
  fillSelect($('latinFont'), CSR.LATIN_FONTS, s.latinFont);

  const syncCustomInputs = () => {
    $('customPersianFont').hidden = s.persianFont !== 'custom';
    $('customLatinFont').hidden = s.latinFont !== 'custom';
  };
  $('customPersianFont').value = s.customPersianFont;
  $('customLatinFont').value = s.customLatinFont;
  syncCustomInputs();

  for (const key of ['persianFont', 'latinFont']) {
    $(key).addEventListener('change', (e) => {
      s[key] = e.target.value;
      syncCustomInputs();
      updatePreview();
      save(true);
    });
  }
  for (const key of ['customPersianFont', 'customLatinFont']) {
    $(key).addEventListener('input', (e) => {
      s[key] = e.target.value;
      updatePreview();
      save();
    });
  }

  const RANGES = [
    { key: 'fontSize', label: 'اندازه‌ی متن', min: 12, max: 28, step: 1, def: 16, fmt: (v) => fa(v) + 'px' },
    { key: 'lineHeight', label: 'فاصله‌ی خطوط', min: 1.3, max: 2.6, step: 0.05, def: 1.7, fmt: (v) => fa(v.toFixed(2)) },
    { key: 'fontWeight', label: 'ضخامت فونت', min: 300, max: 600, step: 10, def: 400, fmt: (v) => fa(v) },
    { key: 'wordSpacing', label: 'فاصله‌ی کلمات', min: 1, max: 40, step: 1, def: 8, fmt: (v) => fa(v) + '٪' },
    { key: 'paragraphSpacing', label: 'فاصله‌ی پاراگراف', min: 0.3, max: 2.5, step: 0.05, def: 0.75, fmt: (v) => fa(v.toFixed(2)) + 'em' },
    { key: 'contentWidth', label: 'عرض ستون متن', min: 560, max: 1600, step: 20, def: 768, fmt: (v) => fa(v) + 'px' },
  ];
  for (const r of RANGES) {
    const input = Object.assign(document.createElement('input'), { type: 'range', min: r.min, max: r.max, step: r.step, id: r.key });
    const out = document.createElement('output');
    const row = document.createElement('div');
    row.className = 'range';
    const label = document.createElement('label');
    label.htmlFor = r.key;
    label.textContent = r.label;
    const reset = Object.assign(document.createElement('button'), { className: 'reset', textContent: '↺', title: 'برگشت به پیش‌فرض Claude' });
    const paint = () => {
      const v = s[r.key];
      row.classList.toggle('is-default', !v);
      input.value = v || r.def;
      out.textContent = v ? r.fmt(+v) : 'پیش‌فرض';
    };
    input.addEventListener('input', () => {
      s[r.key] = +input.value;
      paint();
      updatePreview();
      save();
    });
    reset.addEventListener('click', () => {
      s[r.key] = 0;
      paint();
      updatePreview();
      save(true);
    });
    row.append(label, input, out, reset);
    $('ranges').append(row);
    paint();
  }

  $('applyToUser').checked = s.applyToUser;
  $('applyToUser').addEventListener('change', (e) => {
    s.applyToUser = e.target.checked;
    save(true);
  });

  // ---------- preview ----------
  function updatePreview() {
    const p = $('preview');
    p.style.fontFamily = CSR.pageFontStack(s);
    p.style.fontSize = (s.fontSize || 15) + 'px';
    p.style.lineHeight = s.lineHeight || '';
    p.style.fontWeight = s.fontWeight || '';
    p.style.wordSpacing = s.wordSpacing ? s.wordSpacing / 100 + 'em' : '';
    const t = CSR.resolveTheme(s);
    p.style.background = t ? t.bg : '';
    p.style.color = t ? t.text : '';
  }
  updatePreview();

  // ---------- themes ----------
  function renderThemes() {
    const box = $('themes');
    box.textContent = '';
    for (const t of CSR.THEMES) {
      const colors = t.id === 'custom' ? s.custom : t;
      const b = document.createElement('button');
      b.className = 'theme' + (s.theme === t.id ? ' on' : '');
      const sample = document.createElement('span');
      sample.className = 'sample';
      sample.textContent = 'آ Aa';
      if (t.id === 'claude') {
        sample.style.background = 'linear-gradient(135deg, #faf9f5 50%, #262624 50%)';
        sample.style.color = '#d97757';
      } else {
        sample.style.background = colors.bg;
        sample.style.color = colors.heading || colors.text;
        sample.style.borderBottom = `3px solid ${colors.accent || colors.link}`;
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.label;
      b.append(sample, name);
      b.addEventListener('click', () => {
        s.theme = t.id;
        renderThemes();
        updatePreview();
        save(true);
      });
      box.append(b);
    }
    $('custom').hidden = s.theme !== 'custom';
  }
  document.querySelectorAll('[data-c]').forEach((inp) => {
    inp.value = s.custom[inp.dataset.c];
    inp.addEventListener('input', () => {
      s.custom = { ...s.custom, [inp.dataset.c]: inp.value };
      s.custom.dark = CSR.color.isDark(s.custom.bg);
      renderThemes();
      updatePreview();
      save();
    });
  });
  renderThemes();

  // ---------- direction ----------
  const RTL_NOTES = {
    off: 'متن‌ها همان‌طور که Claude نشان می‌دهد می‌مانند.',
    auto: 'هر پاراگراف، لیست و جدول جداگانه بررسی می‌شود: فارسی راست‌چین، انگلیسی چپ‌چین. کدها همیشه چپ‌چین می‌مانند.',
    force: 'همه‌ی متن‌ها راست‌چین می‌شوند (به‌جز کد و فرمول).',
  };
  function segmented(id, key, after) {
    const box = $(id);
    const paint = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s[key]));
    box.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        s[key] = b.dataset.v;
        paint();
        after && after();
        save(true);
      })
    );
    paint();
    after && after();
  }
  segmented('rtlMode', 'rtlMode', () => ($('rtlNote').textContent = RTL_NOTES[s.rtlMode]));
  segmented('dockSide', 'dockSide');

  for (const key of ['rtlInput', 'persianListNumbers', 'showDock', 'selectionToolbar', 'highlighterMode']) {
    $(key).checked = !!s[key];
    $(key).addEventListener('change', (e) => {
      s[key] = e.target.checked;
      save(true);
    });
  }

  // ---------- highlighter color ----------
  const sw = $('activeHighlight');
  const paintSw = () => sw.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.id === s.activeHighlight));
  for (const c of CSR.HIGHLIGHTS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.id = c.id;
    b.title = c.label;
    b.style.setProperty('--c', c.swatch);
    b.addEventListener('click', () => {
      s.activeHighlight = c.id;
      paintSw();
      save(true);
    });
    sw.append(b);
  }
  paintSw();

  // ---------- actions ----------
  $('openLibrary').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('openPanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { csr: 'openPanel' });
      window.close();
    } catch (e) {
      $('openPanel').textContent = 'اول یک گفتگو در claude.ai باز کن';
    }
  });

  // keep in sync if settings change elsewhere (e.g. the dock's A+/A- buttons)
  CSR.store.onSettingsChanged((ns) => {
    if (JSON.stringify(ns) === JSON.stringify(s)) return;
    s = ns;
  });
})();
