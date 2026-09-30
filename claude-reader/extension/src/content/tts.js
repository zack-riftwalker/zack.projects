/* Read aloud with the browser's built-in, free speech engine (Web Speech API).
 * Text is read sentence by sentence; the current sentence is highlighted
 * with the CSS Custom Highlight API, so the page's DOM is never touched. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const T = (CSR.tts = { active: false, playing: false });
  const synth = window.speechSynthesis;

  const READ_SEL = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd';
  const SKIP = 'pre, .katex, [data-csr-ui], button, svg, style, script, [aria-hidden="true"]';

  let voices = [];
  let queue = [];
  let idx = 0;
  let utter = null;
  let watchdog = 0;
  let keepAlive = 0;
  let errors = 0;
  let warnedFa = false;
  let player = null;

  function loadVoices() {
    voices = synth ? synth.getVoices() : [];
  }
  if (synth) {
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
  }

  T.voices = () => voices;

  function pickVoice(lang) {
    const s = CSR.settings;
    const pref = lang === 'fa' ? s.ttsFaVoice : s.ttsEnVoice;
    let v = pref && voices.find((x) => x.voiceURI === pref);
    if (!v) v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(lang) && /natural|online|google/i.test(x.name));
    if (!v) v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(lang));
    return v || null;
  }

  // ---------------------------------------------------------------------------
  // building the queue

  function leafText(block) {
    // text nodes whose nearest readable block is `block`
    const nodes = [];
    let text = '';
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return p.closest(READ_SEL) === block ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = w.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { root: block, nodes, text };
  }

  function sentencesOf(block) {
    const index = leafText(block);
    const out = [];
    const re = /[^.!?؟…\n]+(?:[.!?؟…]+["»”)]*|\n|$)/g;
    let m;
    while ((m = re.exec(index.text))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      let start = m.index;
      let end = m.index + m[0].length;
      // split very long sentences at commas so voices don't cut out
      const chunks = [];
      let s0 = start;
      while (end - s0 > 240) {
        const slice = index.text.slice(s0, s0 + 240);
        const cut = Math.max(slice.lastIndexOf('،'), slice.lastIndexOf(','), slice.lastIndexOf('؛'), slice.lastIndexOf(' '));
        const at = cut > 60 ? s0 + cut + 1 : s0 + 240;
        chunks.push([s0, at]);
        s0 = at;
      }
      chunks.push([s0, end]);
      for (let [a, b] of chunks) {
        while (a < b && /\s/.test(index.text[a])) a++;
        while (b > a && /\s/.test(index.text[b - 1])) b--;
        const t = index.text.slice(a, b);
        if (!/[\p{L}\p{N}]/u.test(t)) continue;
        out.push({ index, block, start: a, end: b, text: t, lang: CSR.appearance.detectDir(t) === 'rtl' ? 'fa' : 'en' });
      }
    }
    return out;
  }

  function readableBlocks(msg) {
    return Array.from(msg.querySelectorAll(READ_SEL)).filter((b) => !b.closest(SKIP));
  }

  /** Sentences from `startBlock` to the end of the conversation (Claude's answers only). */
  function queueFrom(startBlock) {
    const out = [];
    let started = false;
    for (const m of dom.getMessages()) {
      const startsHere = m.contains(startBlock);
      if (!started && !startsHere) continue;
      if (!startsHere && dom.roleOf(m) === 'user') continue;
      const blocks = readableBlocks(m);
      for (const b of blocks) {
        if (!started) {
          if (b !== startBlock && !b.contains(startBlock) && !(startBlock.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
          started = true;
        }
        out.push(...sentencesOf(b));
      }
      started = true;
    }
    return out;
  }

  function firstVisibleBlock() {
    for (const m of dom.getMessages()) {
      if (dom.roleOf(m) === 'user') continue;
      for (const b of readableBlocks(m)) {
        const r = b.getBoundingClientRect();
        if (r.bottom > 70 && r.height > 0) return b;
      }
    }
    return null;
  }

  function rangeOf(item) {
    return dom.offsetsToRange(item.index, item.start, item.end);
  }

  // ---------------------------------------------------------------------------
  // playback

  function highlight(item) {
    document.querySelectorAll('[data-csr-tts-block]').forEach((e) => e.removeAttribute('data-csr-tts-block'));
    if (!item) {
      if (window.CSS && CSS.highlights) CSS.highlights.delete('csr-tts');
      return;
    }
    item.block.setAttribute('data-csr-tts-block', '');
    const r = rangeOf(item);
    if (r && window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set('csr-tts', new Highlight(r));
    const rect = (r || item.block).getBoundingClientRect();
    if (rect.top < 90 || rect.bottom > window.innerHeight - 140) {
      item.block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        const rr = (rangeOf(item) || item.block).getBoundingClientRect();
        CSR.ruler.moveTo(rr.top + rr.height / 2);
      }, 450);
    } else {
      CSR.ruler.moveTo(rect.top + rect.height / 2);
    }
  }

  function speakCurrent() {
    clearTimeout(watchdog);
    if (!T.active) return;
    if (!pickVoice('fa')) {
      let skipped = false;
      while (idx < queue.length && queue[idx].lang === 'fa') {
        idx++;
        skipped = true;
      }
      if (skipped && !warnedFa) {
        warnedFa = true;
        CSR.ui.toast('روی این مرورگر صدای فارسی نصب نیست؛ فقط بخش‌های انگلیسی خوانده می‌شود', 4500);
      }
    }
    if (idx >= queue.length) {
      T.stop();
      CSR.ui.toast(warnedFa ? 'بخش انگلیسی تمام شد؛ برای فارسی صدای فارسی لازم است' : 'خواندن تمام شد', 4000);
      return;
    }
    const item = queue[idx];
    const voice = pickVoice(item.lang);
    highlight(item);
    renderPlayer();
    utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = item.lang === 'fa' ? 'fa-IR' : 'en-US';
    if (voice) utter.voice = voice;
    utter.rate = CSR.settings.ttsRate || 1;
    const me = utter;
    utter.onend = () => {
      if (me !== utter || !T.playing) return;
      errors = 0;
      idx++;
      speakCurrent();
    };
    utter.onerror = (e) => {
      if (me !== utter || e.error === 'interrupted' || e.error === 'canceled') return;
      if (++errors >= 3) {
        T.stop();
        CSR.ui.toast('مرورگر نتوانست متن را بخواند', 3500);
        return;
      }
      idx++;
      speakCurrent();
    };
    synth.speak(utter);
    // some voices never fire "end"; don't get stuck
    const expect = (item.text.length / (13 * (CSR.settings.ttsRate || 1))) * 1000 + 6000;
    watchdog = setTimeout(() => {
      if (me === utter && T.playing) {
        synth.cancel();
        idx++;
        speakCurrent();
      }
    }, expect);
  }

  function start(items) {
    if (!synth) {
      CSR.ui.toast('این مرورگر از خواندن متن پشتیبانی نمی‌کند');
      return;
    }
    if (!items.length) {
      CSR.ui.toast('متنی برای خواندن پیدا نشد');
      return;
    }
    synth.cancel();
    queue = items;
    idx = 0;
    errors = 0;
    T.active = true;
    T.playing = true;
    CSR.ui.setDockState('tts', true);
    clearInterval(keepAlive);
    // Chrome stops long speech after ~15s unless nudged
    keepAlive = setInterval(() => {
      if (T.playing && synth.speaking) {
        synth.pause();
        synth.resume();
      }
    }, 10000);
    speakCurrent();
  }

  T.readFrom = function (block) {
    start(queueFrom(block));
  };

  T.speakRange = function (range) {
    const msg = dom.messageOf(range.startContainer);
    if (!msg) return;
    const items = [];
    for (const b of readableBlocks(msg)) {
      if (!range.intersectsNode(b)) continue;
      for (const it of sentencesOf(b)) {
        const r = rangeOf(it);
        if (!r) continue;
        const before = r.compareBoundaryPoints(Range.END_TO_START, range) >= 0; // sentence starts after selection end
        const after = r.compareBoundaryPoints(Range.START_TO_END, range) <= 0; // sentence ends before selection start
        if (!before && !after) items.push(it);
      }
    }
    window.getSelection().removeAllRanges();
    start(items);
  };

  T.toggle = function () {
    if (T.active) return T.stop();
    const sel = CSR.ann.selectionInMessage();
    if (sel) return T.speakRange(sel.range);
    const b = firstVisibleBlock();
    if (!b) return CSR.ui.toast('اول یک پاسخ از Claude روی صفحه بیاور');
    T.readFrom(b);
  };

  T.pause = function () {
    if (!T.active) return;
    T.playing = false;
    clearTimeout(watchdog);
    utter = null;
    synth.cancel(); // cancel + restart the sentence works with every voice, pause() doesn't
    renderPlayer();
  };

  T.resume = function () {
    if (!T.active) return;
    T.playing = true;
    speakCurrent();
  };

  T.step = function (d) {
    if (!T.active) return;
    utter = null;
    synth.cancel();
    idx = Math.max(0, Math.min(queue.length - 1, idx + d));
    T.playing = true;
    speakCurrent();
  };

  T.stop = function () {
    T.active = false;
    T.playing = false;
    utter = null;
    clearTimeout(watchdog);
    clearInterval(keepAlive);
    if (synth) synth.cancel();
    highlight(null);
    queue = [];
    if (player) player.remove();
    player = null;
    CSR.ui.setDockState('tts', false);
  };

  // ---------------------------------------------------------------------------
  // player bar

  function renderPlayer() {
    const h = CSR.ui.h;
    if (!player) {
      player = h('div', { class: 'tts-player', onmousedown: (e) => e.target.closest('select') || e.preventDefault() });
      CSR.ui.layer().append(player);
    }
    player.textContent = '';
    const rate = h(
      'select',
      {
        class: 'tts-rate',
        title: 'سرعت',
        onchange: (e) => {
          CSR.store.patchSettings({ ttsRate: +e.target.value });
          CSR.settings.ttsRate = +e.target.value;
          if (T.playing) T.step(0);
        },
      },
      [0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => {
        const o = h('option', { value: r }, '×' + r.toLocaleString('fa-IR'));
        if (r === (CSR.settings.ttsRate || 1)) o.selected = true;
        return o;
      })
    );
    const hasFa = !!pickVoice('fa');
    player.append(
      h('button', { class: 'tool-btn', icon: 'next', title: 'جمله‌ی قبل', onclick: () => T.step(-1) }),
      h('button', {
        class: 'tool-btn primary',
        icon: T.playing ? 'pause' : 'play',
        title: T.playing ? 'مکث' : 'ادامه',
        onclick: () => (T.playing ? T.pause() : T.resume()),
      }),
      h('button', { class: 'tool-btn', icon: 'prev', title: 'جمله‌ی بعد', onclick: () => T.step(1) }),
      h('button', { class: 'tool-btn', icon: 'stop', title: 'توقف (Esc)', onclick: () => T.stop() }),
      rate,
      h('span', { class: 'tts-pos' }, `${(Math.min(idx + 1, queue.length)).toLocaleString('fa-IR')} / ${queue.length.toLocaleString('fa-IR')}`),
      hasFa ? null : h('span', { class: 'tts-warn', title: 'در مرورگر Microsoft Edge صداهای فارسی رایگان (فرید و دلارا) هست' }, 'صدای فارسی ندارد')
    );
  }
})();
