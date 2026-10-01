/* Quick dictionary: double-click an English word (or use the selection
 * toolbar) to see its Persian meaning, pronunciation and definitions.
 * Words can be saved to a personal vocabulary list. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const DI = (CSR.dict = {});
  const cache = new Map();
  let card = null;
  let anchorRange = null; // the looked-up word, to keep the card next to it
  let lookups = 0; // only the newest lookup may fill the card

  const WORD = /^[A-Za-z][A-Za-z'’-]{0,40}$/;

  function close() {
    if (card) card.remove();
    card = null;
    anchorRange = null;
  }
  DI.close = close;

  function place(rect) {
    const r = rect || { top: window.innerHeight / 3, bottom: window.innerHeight / 3, left: window.innerWidth / 2, width: 0 };
    const cr = card.getBoundingClientRect();
    let top = r.bottom + 10;
    if (top + cr.height > window.innerHeight - 10) top = Math.max(10, r.top - cr.height - 10);
    let left = r.left + r.width / 2 - cr.width / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - cr.width - 10));
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  function speak(word) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    const v = synth.getVoices().find((x) => /^en(-|_)US/i.test(x.lang)) || synth.getVoices().find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    synth.speak(u);
  }

  function contextSentence() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return '';
    const block = sel.getRangeAt(0).startContainer.parentElement?.closest('p, li, td, h1, h2, h3, h4, blockquote');
    const t = (block ? block.textContent : '').replace(/\s+/g, ' ').trim();
    return t.length > 300 ? t.slice(0, 300) + '…' : t;
  }

  async function isSaved(word) {
    const { vocab = [] } = await chrome.storage.local.get('vocab');
    return vocab.some((v) => v.word === word);
  }

  async function save(entry, context) {
    const { vocab = [] } = await chrome.storage.local.get('vocab');
    if (vocab.some((v) => v.word === entry.word)) return;
    vocab.unshift({
      word: entry.word,
      fa: entry.fa.slice(0, 3),
      phonetic: entry.phonetic || '',
      def: entry.meanings[0] ? `(${entry.meanings[0].pos}) ${entry.meanings[0].defs[0] || ''}` : '',
      context,
      convId: dom.getConversationId() || '',
      added: Date.now(),
    });
    await chrome.storage.local.set({ vocab });
  }

  function render(word, data, rect, context) {
    const h = CSR.ui.h;
    close();
    card = h('div', { class: 'dict-card', onmousedown: (e) => e.preventDefault() });
    const head = h(
      'div',
      { class: 'dict-head' },
      h('div', { class: 'dict-word', dir: 'ltr' }, word, data && data.phonetic ? h('span', { class: 'dict-ph' }, data.phonetic) : null),
      h('button', { class: 'tool-btn', icon: 'speaker', title: 'تلفظ', onclick: () => speak(word) }),
      h('button', { class: 'tool-btn', icon: 'close', title: 'بستن', onclick: close })
    );
    card.append(head);
    if (!data) {
      card.append(h('div', { class: 'dict-loading' }, 'در حال جستجو…'));
    } else if (!data.ok) {
      card.append(h('div', { class: 'dict-empty' }, data.error ? 'اتصال به دیکشنری برقرار نشد.' : 'معنی‌ای پیدا نشد.'));
    } else {
      if (data.fa.length) {
        card.append(h('div', { class: 'dict-fa' }, data.fa.map((t) => h('span', { class: 'dict-chip' }, t))));
      }
      for (const m of data.meanings) {
        card.append(
          h(
            'div',
            { class: 'dict-meaning', dir: 'ltr' },
            h('span', { class: 'dict-pos' }, m.pos),
            m.defs.map((d) => h('div', { class: 'dict-def' }, d)),
            m.example ? h('div', { class: 'dict-ex' }, '“' + m.example + '”') : null
          )
        );
      }
    }
    const saveBtn = h('button', { class: 'btn-text', disabled: !data || !data.ok }, '★ افزودن به لغت‌نامه');
    saveBtn.addEventListener('click', async () => {
      await save(data, context);
      saveBtn.textContent = '✓ در لغت‌نامه ذخیره شد';
      saveBtn.disabled = true;
    });
    if (data && data.ok) {
      isSaved(data.word).then((yes) => {
        if (yes) {
          saveBtn.textContent = '✓ در لغت‌نامه هست';
          saveBtn.disabled = true;
        }
      });
    }
    card.append(
      h(
        'div',
        { class: 'dict-foot' },
        saveBtn,
        h(
          'a',
          { class: 'btn-text', href: `https://translate.google.com/?sl=en&tl=fa&text=${encodeURIComponent(word)}`, target: '_blank', rel: 'noopener' },
          'Google Translate ↗'
        )
      )
    );
    CSR.ui.layer().append(card);
    place(rect);
  }

  DI.lookup = async function (text, rect) {
    const word = text.trim().replace(/[.,;:!?()"“”«»]+$/g, '').replace(/^[("“«]+/, '');
    if (!word || word.length > 80) return;
    if (/[؀-ۿ]/.test(word)) {
      CSR.ui.toast('دیکشنری برای کلمه‌های انگلیسی است');
      return;
    }
    const context = contextSentence();
    const sel = window.getSelection();
    const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    const key = word.toLowerCase();
    const me = ++lookups;
    if (cache.has(key)) {
      render(word, cache.get(key), rect, context);
      anchorRange = range;
      return;
    }
    render(word, null, rect, context);
    anchorRange = range;
    let data;
    try {
      data = await chrome.runtime.sendMessage({ csr: 'dict', word: key });
    } catch (e) {
      data = { ok: false, error: String(e) };
    }
    if (data && data.ok) cache.set(key, data);
    if (card && me === lookups) {
      const r = anchorRange ? anchorRange.getBoundingClientRect() : rect;
      render(word, data || { ok: false }, r, context);
      anchorRange = range;
    }
  };

  document.addEventListener('dblclick', (e) => {
    if (!CSR.settings.enabled || !CSR.settings.dictDblclick || CSR.ui.mode !== 'none') return;
    if (e.composedPath().some((n) => n.id === 'csr-host')) return;
    if (!dom.messageOf(e.target, true) || dom.isEditable(e.target)) return;
    const sel = window.getSelection();
    const w = sel.toString().trim();
    if (!WORD.test(w)) return;
    CSR.ui.suppressToolbarUntil = Date.now() + 400;
    CSR.ui.hideSelectionToolbar();
    DI.lookup(w, sel.getRangeAt(0).getBoundingClientRect());
  });

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
      if (!anchorRange) return close();
      const r = anchorRange.getBoundingClientRect();
      if ((!r.width && !r.height) || r.bottom < 0 || r.top > window.innerHeight) return close();
      place(r);
    },
    true
  );
})();
