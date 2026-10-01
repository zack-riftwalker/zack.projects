/* Translate a selected line or paragraph (English → Persian, or Persian →
 * English). Shows a quick free machine translation next to the text, with
 * one click to a better translation by Claude (in a new chat, so the study
 * conversation stays clean), Google Translate, copy, or saving the
 * translation as a note on that text. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const TR = (CSR.translate = {});
  const cache = new Map();
  let card = null;
  let anchorRange = null;
  let seq = 0;

  const direction = (text) => (CSR.appearance.detectDir(text) === 'rtl' ? { from: 'fa', to: 'en' } : { from: 'en', to: 'fa' });

  function close() {
    if (card) card.remove();
    card = null;
    anchorRange = null;
  }
  TR.close = close;

  function place(rect) {
    const r = rect || { top: 120, bottom: 120, left: window.innerWidth / 2, width: 0 };
    const cr = card.getBoundingClientRect();
    let top = r.bottom + 12;
    if (top + cr.height > window.innerHeight - 10) top = Math.max(10, r.top - cr.height - 12);
    let left = r.left + r.width / 2 - cr.width / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - cr.width - 10));
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  function claudePrompt(text, dir) {
    return dir.to === 'fa'
      ? 'این متن را روان، دقیق و طبیعی به فارسی ترجمه کن. اصطلاحات تخصصی را با معادل رایج فارسی بنویس و اگر لازم بود اصل انگلیسی را داخل پرانتز بیاور. فقط ترجمه را بنویس:\n\n' + text
      : 'Translate the following Persian text into clear, natural English. Keep technical terms accurate. Output only the translation:\n\n' + text;
  }

  async function askClaude(text, dir) {
    const prompt = claudePrompt(text, dir);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (e) {
      /* clipboard not allowed: the link still carries the text */
    }
    window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt.slice(0, 6000)), '_blank', 'noopener');
    CSR.ui.toast('یک گفتگوی تازه با Claude باز شد؛ اگر متن خودش نیامد، Ctrl+V بزن', 4500);
  }

  function saveAsNote(translation) {
    if (!anchorRange || !anchorRange.startContainer.isConnected) return CSR.ui.toast('متن اصلی دیگر در صفحه نیست');
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(anchorRange);
    const a = CSR.ann.createMark({}, '🌐 ' + translation);
    CSR.ui.toast(a ? 'ترجمه به‌عنوان یادداشت روی همین متن ذخیره شد' : 'این‌جا نمی‌شود یادداشت گذاشت');
    if (a) close();
  }

  function render(text, dir, res, rect) {
    const h = CSR.ui.h;
    const replacing = !!card;
    if (card) card.remove();
    card = h('div', { class: 'tr-card' + (replacing ? ' still' : ''), onmousedown: (e) => e.target.closest('textarea, input') || e.preventDefault() });
    const label = dir.to === 'fa' ? 'انگلیسی ← فارسی' : 'فارسی ← انگلیسی';
    card.append(
      h(
        'div',
        { class: 'dict-head' },
        h('div', { class: 'tr-title' }, 'ترجمه', h('span', { class: 'tr-dir' }, label)),
        h('button', { class: 'tool-btn', icon: 'close', title: 'بستن', onclick: close })
      )
    );
    const body = h('div', { class: 'tr-body', dir: dir.to === 'fa' ? 'rtl' : 'ltr' });
    if (!res) body.append(h('div', { class: 'dict-loading' }, 'در حال ترجمه…'));
    else if (res.ok) body.append(res.text);
    else
      body.append(
        h(
          'div',
          { class: 'dict-empty' },
          res.error === 'quota'
            ? 'سهمیه‌ی رایگان ترجمه‌ی امروز تمام شده. از «ترجمه با Claude» یا Google استفاده کن؛ یا در تنظیمات (خواندن ← ترجمه) ایمیلت را بگذار تا سهمیه ده برابر شود.'
            : 'ترجمه‌ی سریع در دسترس نیست (اینترنت؟). «ترجمه با Claude» یا Google را امتحان کن.'
        )
      );
    card.append(body);
    if (res && res.ok) card.append(h('div', { class: 'tr-engine' }, 'ترجمه‌ی ماشینی سریع (MyMemory)؛ برای ترجمه‌ی دقیق‌تر از Claude کمک بگیر.'));
    const foot = h(
      'div',
      { class: 'tr-actions' },
      h('button', { class: 'btn-main small', onclick: () => askClaude(text, dir) }, 'ترجمه‌ی بهتر با Claude ↗'),
      h(
        'a',
        {
          class: 'btn-text',
          href: `https://translate.google.com/?sl=${dir.from}&tl=${dir.to}&op=translate&text=${encodeURIComponent(text.slice(0, 4500))}`,
          target: '_blank',
          rel: 'noopener',
        },
        'Google ↗'
      ),
      res && res.ok
        ? h('button', { class: 'btn-text', onclick: () => navigator.clipboard.writeText(res.text).then(() => CSR.ui.toast('ترجمه کپی شد')) }, 'کپی')
        : null,
      res && res.ok && anchorRange ? h('button', { class: 'btn-text', onclick: () => saveAsNote(res.text) }, 'ذخیره به‌عنوان یادداشت') : null
    );
    card.append(foot);
    CSR.ui.layer().append(card);
    place(rect);
  }

  /** Translate `text` (usually the current selection). */
  TR.open = async function (text, rect) {
    const clean = String(text || '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 4000);
    if (!clean) return;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    const dir = direction(clean);
    const me = ++seq;
    const key = dir.from + '|' + clean;
    let res = cache.get(key) || null;
    anchorRange = range;
    render(clean, dir, res, rect);
    if (res) return;
    try {
      res = await chrome.runtime.sendMessage({ csr: 'translate', text: clean, from: dir.from, to: dir.to });
    } catch (e) {
      res = { ok: false, error: 'failed' };
    }
    if (res && res.ok) cache.set(key, res);
    if (me !== seq || !card) return; // closed, or a newer translation took over
    anchorRange = range;
    const r = range && range.startContainer.isConnected ? range.getBoundingClientRect() : rect;
    render(clean, dir, res || { ok: false }, r);
  };

  /** Selection toolbar / Alt+Y: one word → dictionary, more → translation. */
  TR.fromSelection = function () {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const text = sel.toString().trim();
    if (!text) return false;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    CSR.ui.hideSelectionToolbar();
    if (/^[A-Za-z][A-Za-z'’-]{0,40}$/.test(text)) CSR.dict.lookup(text, rect);
    else TR.open(text, rect);
    return true;
  };

  document.addEventListener(
    'mousedown',
    (e) => {
      if (card && !e.composedPath().includes(card)) close();
    },
    true
  );
  document.addEventListener(
    'scroll',
    () => {
      if (!card) return;
      if (!anchorRange) return;
      const r = anchorRange.getBoundingClientRect();
      if ((!r.width && !r.height) || r.bottom < 0 || r.top > window.innerHeight) return close();
      place(r);
    },
    true
  );
})();
