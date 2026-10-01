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
    { key: 'contentWidth', label: 'عرض ستون متن', min: 560, max: 2000, step: 20, def: 768, fmt: (v) => fa(v) + 'px' },
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

  // ---------- study tab ----------
  for (const key of ['showTimer', 'pomoAutoBreak', 'pomoAutoFocus', 'pomoSound', 'pomoNotify', 'autoProgress', 'resumePrompt', 'focusHideUser', 'focusFullscreen', 'dictDblclick']) {
    $(key).checked = !!s[key];
    $(key).addEventListener('change', (e) => {
      s[key] = e.target.checked;
      save(true);
    });
  }
  for (const key of ['pomoFocus', 'pomoShort', 'pomoLong', 'pomoCycles']) {
    const inp = $(key);
    inp.value = s[key];
    inp.addEventListener('change', () => {
      const v = Math.max(+inp.min, Math.min(+inp.max, Math.round(+inp.value || CSR.DEFAULT_SETTINGS[key])));
      inp.value = v;
      s[key] = v;
      save(true);
    });
  }

  function patternPicker(id, key, after) {
    const box = $(id);
    const paint = () => box.querySelectorAll('.pattern').forEach((b) => b.classList.toggle('on', b.dataset.id === s[key]));
    for (const p of CSR.PATTERNS) {
      const b = document.createElement('button');
      b.className = 'pattern';
      b.dataset.id = p.id;
      const band = document.createElement('i');
      band.style.backgroundImage = CSR.patternUrl(p.id);
      const name = document.createElement('span');
      name.textContent = p.label;
      b.append(band, name);
      b.addEventListener('click', () => {
        s[key] = p.id;
        paint();
        after && after();
        save(true);
      });
      box.append(b);
    }
    paint();
    after && after();
  }

  function paintFrame() {
    const f = $('framePreview');
    const c = CSR.patternById(s.pomoPattern).colors;
    f.style.backgroundImage = CSR.patternUrl(s.pomoPattern);
    f.style.border = `2px solid ${c.fg}`;
    f.textContent = '';
    const inner = document.createElement('div');
    inner.className = 'inner';
    inner.style.cssText = `background:${c.soft};color:${c.ink};border:2px solid ${c.fg};box-shadow:0 0 0 3px ${c.bg}`;
    const medal = document.createElement('span');
    medal.innerHTML = CSR.shamsehSvg(s.pomoPattern, 44); // generated SVG
    const text = document.createElement('span');
    text.textContent = 'وقت استراحت است! ☕';
    inner.append(medal, text);
    f.append(inner);
  }
  patternPicker('pomoPattern', 'pomoPattern', paintFrame);
  patternPicker('rulerPattern', 'rulerPattern');
  patternPicker('bookmarkPattern', 'bookmarkPattern');

  function simpleRange(boxId, key, label, min, max, step, fmt) {
    const row = document.createElement('div');
    row.className = 'range';
    const l = document.createElement('label');
    l.textContent = label;
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: s[key] });
    const out = document.createElement('output');
    out.textContent = fmt(+s[key]);
    input.addEventListener('input', () => {
      s[key] = +input.value;
      out.textContent = fmt(+input.value);
      save();
    });
    row.append(l, input, out, document.createElement('span'));
    $(boxId).append(row);
  }
  simpleRange('rulerRanges', 'rulerLines', 'ارتفاع (خط)', 1, 5, 1, (v) => fa(v));
  simpleRange('rulerRanges', 'rulerDim', 'تیرگی اطراف', 0, 0.7, 0.05, (v) => fa(Math.round(v * 100)) + '٪');
  simpleRange('ttsRanges', 'ttsRate', 'سرعت خواندن', 0.5, 2, 0.05, (v) => '×' + fa(v.toFixed(2)));

  // ---------- voices ----------
  function fillVoices() {
    const voices = speechSynthesis.getVoices();
    for (const [id, lang, key] of [
      ['ttsFaVoice', 'fa', 'ttsFaVoice'],
      ['ttsEnVoice', 'en', 'ttsEnVoice'],
    ]) {
      const sel = $(id);
      sel.textContent = '';
      sel.append(new Option('خودکار', '', false, !s[key]));
      for (const v of voices.filter((x) => x.lang && x.lang.toLowerCase().startsWith(lang))) {
        sel.append(new Option(`${v.name} (${v.lang})`, v.voiceURI, false, v.voiceURI === s[key]));
      }
    }
    const hasFa = voices.some((v) => v.lang && v.lang.toLowerCase().startsWith('fa'));
    $('voiceNote').textContent = hasFa
      ? 'صدای فارسی پیدا شد. 🎉'
      : 'روی این مرورگر صدای فارسی نیست؛ فقط بخش‌های انگلیسی خوانده می‌شوند. در مرورگر Microsoft Edge صداهای فارسی رایگان «فرید» و «دلارا» هست و همین افزونه آنجا هم نصب می‌شود.';
  }
  for (const id of ['ttsFaVoice', 'ttsEnVoice']) {
    $(id).addEventListener('change', (e) => {
      s[id] = e.target.value;
      save(true);
    });
  }
  fillVoices();
  speechSynthesis.addEventListener('voiceschanged', fillVoices);
  function testVoice(lang, text) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'fa' ? 'fa-IR' : 'en-US';
    const pref = lang === 'fa' ? s.ttsFaVoice : s.ttsEnVoice;
    const v = speechSynthesis.getVoices().find((x) => (pref ? x.voiceURI === pref : x.lang.toLowerCase().startsWith(lang)));
    if (v) u.voice = v;
    u.rate = s.ttsRate;
    speechSynthesis.speak(u);
  }
  $('testFa').addEventListener('click', () => testVoice('fa', 'سلام! این صدای فارسی برای خواندن پاسخ‌های Claude است.'));
  $('testEn').addEventListener('click', () => testVoice('en', 'Hello! This is how Claude’s answers will sound.'));

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

  $('translateEmail').value = s.translateEmail || '';
  $('translateEmail').addEventListener('input', (e) => {
    s.translateEmail = e.target.value.trim();
    save();
  });

  // ---------- updates ----------
  const version = chrome.runtime.getManifest().version;
  const faV = (v) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  function paintUpdate(u) {
    const when = u && u.checked ? new Date(u.checked).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    $('versionNote').textContent =
      `نسخه‌ی نصب‌شده: ${faV(version)}` +
      (u && u.available ? ` — نسخه‌ی ${faV(u.latest)} آماده است` : u && !u.error ? ' — آخرین نسخه است' : '') +
      (when ? ` (بررسی: ${when})` : '');
    const show = !!(u && u.available && CSR.compareVersions(u.latest, version) > 0);
    $('updateBanner').hidden = !show;
    if (!show) return;
    $('ubTitle').textContent = `نسخه‌ی تازه‌ی خوانا (${faV(u.latest)}) آماده است`;
    const notes = $('ubNotes');
    notes.textContent = '';
    for (const n of u.notes || []) notes.append(Object.assign(document.createElement('li'), { textContent: n }));
  }
  chrome.storage.local.get('update').then((r) => paintUpdate(r.update));
  $('checkUpdate').addEventListener('click', async () => {
    $('checkUpdate').textContent = 'در حال بررسی…';
    const u = await chrome.runtime.sendMessage({ csr: 'checkUpdate' }).catch(() => null);
    $('checkUpdate').textContent = 'بررسی به‌روزرسانی';
    paintUpdate(u);
    if (!u || u.error) $('versionNote').textContent = 'اتصال به گیت‌هاب برقرار نشد؛ بعداً دوباره امتحان کن.';
  });
  $('ubDownload').addEventListener('click', async () => {
    const { update } = await chrome.storage.local.get('update');
    if (update && /^https:\/\//.test(String(update.zip || ''))) chrome.tabs.create({ url: update.zip });
  });
  $('ubHow').addEventListener('click', () => ($('ubSteps').hidden = !$('ubSteps').hidden));
  $('reloadExt').addEventListener('click', () => chrome.runtime.sendMessage({ csr: 'reloadExtension' }));

  $('diagBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let text;
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { csr: 'diag' });
      text = r && r.report;
    } catch (e) {
      text = null;
    }
    if (!text) {
      $('diagBtn').textContent = 'اول یک صفحه از claude.ai باز کن';
      return;
    }
    const out = $('diagOut');
    out.hidden = false;
    out.value = text;
    out.select();
    try {
      await navigator.clipboard.writeText(text);
      $('diagBtn').textContent = '✓ کپی شد — برای سازنده بفرست';
    } catch (e) {
      document.execCommand('copy');
      $('diagBtn').textContent = '✓ کپی شد';
    }
  });

  // keep in sync if settings change elsewhere (e.g. the dock's A+/A- buttons)
  CSR.store.onSettingsChanged((ns) => {
    if (JSON.stringify(ns) === JSON.stringify(s)) return;
    s = ns;
  });
})();
