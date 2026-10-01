/* Study time + Pomodoro.
 * - Counts real reading time (tab visible, window focused, you did something
 *   in the last 90 s) per day, per conversation and per session.
 * - Pomodoro runs in the background worker (so it survives closed tabs); this
 *   file shows the timer and the Termeh-framed pop-up with a little santur-like
 *   chime when a phase ends. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const S = (CSR.study = {});

  const SESSION_GAP = 15 * 60 * 1000;
  let lastActive = Date.now();
  let pending = 0;
  let stats = { days: {}, convs: {}, session: null };
  let pomo = { phase: 'idle', running: false };
  let pill = null;
  let card = null;
  let overlay = null;
  let shownEvent = null;
  let audio = null;

  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const PHASE = { focus: 'مطالعه', short: 'استراحت کوتاه', long: 'استراحت طولانی', idle: 'آماده' };

  // ---------------------------------------------------------------------------
  // activity & stats

  for (const ev of ['mousemove', 'keydown', 'wheel', 'scroll', 'pointerdown', 'touchstart']) {
    document.addEventListener(ev, () => (lastActive = Date.now()), { passive: true, capture: true });
  }

  S.isActive = function () {
    return (
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      (Date.now() - lastActive < 90000 || (CSR.tts && CSR.tts.playing))
    );
  };

  async function loadStats() {
    if (!CSR.alive()) return;
    const r = await chrome.storage.local.get('stats');
    stats = { days: {}, convs: {}, session: null, ...(r.stats || {}) };
  }

  async function flush() {
    if (!pending || !CSR.alive()) return;
    const add = pending;
    pending = 0;
    const r = await chrome.storage.local.get('stats');
    const st = { days: {}, convs: {}, session: null, ...(r.stats || {}) };
    const now = Date.now();
    const day = CSR.dayKey();
    st.days[day] = (st.days[day] || 0) + add;
    const id = dom.getConversationId();
    if (id) st.convs[id] = (st.convs[id] || 0) + add;
    if (!st.session || now - st.session.last > SESSION_GAP) st.session = { start: now - add * 1000, last: now, secs: 0 };
    st.session.secs += add;
    st.session.last = now;
    stats = st;
    await chrome.storage.local.set({ stats: st });
  }

  function sessionSecs() {
    const s = stats.session;
    if (!s || Date.now() - s.last > SESSION_GAP + pending * 1000) return pending;
    return s.secs + pending;
  }
  const todaySecs = () => (stats.days[CSR.dayKey()] || 0) + pending;
  const convSecs = () => (stats.convs[dom.getConversationId()] || 0) + pending;

  setInterval(() => {
    if (!CSR.settings || !CSR.settings.enabled || CSR.dead) return;
    if (S.isActive() && dom.getConversationId()) {
      pending += 1;
      if (CSR.toc) CSR.toc.tick();
      if (pending >= 20) flush();
    }
    paint();
  }, 1000);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

  // ---------------------------------------------------------------------------
  // pomodoro state (owned by the background worker)

  const send = (cmd, arg) => (CSR.alive() ? chrome.runtime.sendMessage({ csr: 'pomo', cmd, arg }).catch(() => null) : Promise.resolve(null));
  S.cmd = send;

  async function loadPomo() {
    if (!CSR.alive()) return;
    const r = await chrome.storage.local.get('pomo');
    pomo = { phase: 'idle', running: false, ...(r.pomo || {}) };
    if (pomo.event) shownEvent = pomo.event.id; // don't re-show old pop-ups on page load
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.stats && changes.stats.newValue) stats = { days: {}, convs: {}, session: null, ...changes.stats.newValue };
    if (changes.pomo) {
      pomo = { phase: 'idle', running: false, ...(changes.pomo.newValue || {}) };
      const ev = pomo.event;
      if (ev && ev.id !== shownEvent && Date.now() - ev.at < 5 * 60 * 1000) {
        shownEvent = ev.id;
        if (document.visibilityState === 'visible') showOverlay(ev);
      }
      paint();
      if (card) renderCard();
    }
  });

  function remaining() {
    if (pomo.phase === 'idle') return 0;
    return pomo.running ? Math.max(0, pomo.endsAt - Date.now()) : pomo.left || 0;
  }

  // ---------------------------------------------------------------------------
  // pill + card

  function ring(pct, size, stroke, color) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  }

  const phaseColor = (ph) => (ph === 'focus' ? '#c2410c' : ph === 'idle' ? '#868e96' : '#2f9e44');

  function paint() {
    const s = CSR.settings;
    if (!CSR.ui.layer()) return;
    const show = s && s.enabled && s.showTimer && (dom.getConversationId() || pomo.phase !== 'idle');
    if (!show) {
      if (pill) pill.remove();
      pill = null;
      return;
    }
    const h = CSR.ui.h;
    if (!pill) {
      pill = h('button', { class: 'study-pill', title: 'زمان مطالعه و پومودورو', onclick: () => S.toggleCard() });
      CSR.ui.layer().append(pill);
    }
    pill.textContent = '';
    if (pomo.phase !== 'idle') {
      const left = remaining();
      const pct = pomo.total ? 1 - left / pomo.total : 0;
      const icon = h('span', { class: 'pill-ring' });
      icon.innerHTML = ring(pct, 18, 3, phaseColor(pomo.phase)); // generated SVG
      pill.append(icon, h('span', { class: 'pill-time' }, CSR.faClock(left)), h('span', { class: 'pill-phase' }, (pomo.running ? '' : '⏸ ') + PHASE[pomo.phase]));
    } else {
      pill.append(h('span', { class: 'pill-dot' }), h('span', null, CSR.faDuration(sessionSecs()).replace('کمتر از یک دقیقه', 'شروع مطالعه')));
    }
    if (card) paintCard();
  }

  S.toggleCard = function (open) {
    const want = open === undefined ? !card : !!open;
    CSR.ui.setDockState('timer', want);
    if (!want) {
      if (card) card.remove();
      card = null;
      return;
    }
    renderCard();
  };

  function num(key, label, min, max) {
    const h = CSR.ui.h;
    const input = h('input', {
      type: 'number',
      min,
      max,
      value: CSR.settings[key],
      onchange: (e) => {
        const v = Math.max(min, Math.min(max, Math.round(+e.target.value || CSR.DEFAULT_SETTINGS[key])));
        e.target.value = v;
        CSR.store.patchSettings({ [key]: v });
      },
      onkeydown: (e) => e.stopPropagation(),
    });
    return h('label', { class: 'num' }, h('span', null, label), input);
  }

  function renderCard() {
    const h = CSR.ui.h;
    if (card) card.remove();
    const running = pomo.running;
    const idle = pomo.phase === 'idle';
    card = h(
      'div',
      { class: 'study-card', onmousedown: (e) => e.target.closest('input') || e.preventDefault() },
      h(
        'header',
        { class: 'panel-head' },
        h('div', { class: 'panel-title' }, 'زمان مطالعه'),
        h('button', { class: 'tool-btn', icon: 'close', title: 'بستن', onclick: () => S.toggleCard(false) })
      ),
      h('div', { class: 'study-now' }),
      h('div', { class: 'study-sub' }),
      h('div', { class: 'pomo' }, h('div', { class: 'pomo-ring' }), h('div', { class: 'pomo-info' })),
      h(
        'div',
        { class: 'tool-row pomo-btns' },
        running
          ? h('button', { class: 'btn-main', onclick: () => send('pause') }, 'مکث')
          : h('button', { class: 'btn-main', onclick: () => send('start') }, idle ? 'شروع پومودورو' : 'ادامه'),
        idle ? null : h('button', { class: 'btn-text', title: 'رفتن به مرحله‌ی بعد', onclick: () => send('skip') }, 'رد کردن'),
        idle ? null : h('button', { class: 'btn-text', onclick: () => send('stop') }, 'پایان')
      ),
      h(
        'div',
        { class: 'nums' },
        num('pomoFocus', 'مطالعه', 1, 180),
        num('pomoShort', 'استراحت', 1, 60),
        num('pomoLong', 'استراحت بلند', 1, 90),
        num('pomoCycles', 'تعداد دور', 1, 12)
      ),
      h('div', { class: 'hint' }, 'زمان‌ها به دقیقه است. تنظیمات بیشتر (صدا، اعلان، طرح پنجره) در منوی افزونه ← مطالعه.')
    );
    CSR.ui.layer().append(card);
    paintCard();
  }

  function paintCard() {
    if (!card) return;
    const h = CSR.ui.h;
    const ss = sessionSecs();
    card.querySelector('.study-now').textContent =
      ss < 60 ? 'تازه شروع کرده‌ای؛ موفق باشی!' : `${CSR.faDuration(ss)} است که داری مطالعه می‌کنی`;
    card.querySelector('.study-sub').textContent = `امروز: ${CSR.faDuration(todaySecs())}، این گفتگو: ${CSR.faDuration(convSecs())}`;
    const left = remaining();
    const pct = pomo.total ? 1 - left / pomo.total : 0;
    const ringBox = card.querySelector('.pomo-ring');
    ringBox.innerHTML = ring(pomo.phase === 'idle' ? 0 : pct, 86, 7, phaseColor(pomo.phase)); // generated SVG
    ringBox.append(h('span', { class: 'pomo-clock' }, pomo.phase === 'idle' ? CSR.faClock(CSR.settings.pomoFocus * 60000) : CSR.faClock(left)));
    const info = card.querySelector('.pomo-info');
    info.textContent = '';
    const cycles = Math.max(1, CSR.settings.pomoCycles);
    const done = (pomo.cycle || 0) % cycles;
    info.append(
      h('div', { class: 'pomo-phase', style: `color:${phaseColor(pomo.phase)}` }, PHASE[pomo.phase] + (pomo.phase !== 'idle' && !pomo.running ? ' (مکث)' : '')),
      h(
        'div',
        { class: 'pomo-dots', title: 'دورهای کامل‌شده' },
        Array.from({ length: cycles }, (_, i) => h('span', { class: i < done ? 'on' : '' }))
      ),
      h('div', { class: 'hint' }, `${fa(CSR.settings.pomoFocus)} دقیقه مطالعه، ${fa(CSR.settings.pomoShort)} دقیقه استراحت`)
    );
  }

  // ---------------------------------------------------------------------------
  // the Termeh pop-up

  function chime(kind) {
    if (!CSR.settings.pomoSound || !document.hasFocus()) return;
    try {
      audio = audio || new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      // a short phrase in dastgah Shur on D (E is a quarter tone flat: "koron")
      const D = 293.66;
      const Ek = D * Math.pow(2, 1.5 / 12);
      const F = 349.23;
      const G = 392.0;
      const notes = kind === 'focus' ? [G, F, Ek, D, D * 2] : [D, Ek, F, G, D * 2];
      const t0 = audio.currentTime + 0.05;
      notes.forEach((f, i) => {
        const t = t0 + i * 0.17 + (i === notes.length - 1 ? 0.12 : 0);
        for (const [mult, vol] of [
          [1, 0.22],
          [2, 0.06],
          [3.01, 0.03],
        ]) {
          const o = audio.createOscillator();
          const g = audio.createGain();
          o.type = mult === 1 ? 'triangle' : 'sine';
          o.frequency.value = f * mult;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(vol, t + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
          o.connect(g).connect(audio.destination);
          o.start(t);
          o.stop(t + 1.7);
        }
      });
    } catch (e) {
      /* no audio: the pop-up is enough */
    }
  }

  function closeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function showOverlay(ev) {
    const h = CSR.ui.h;
    const s = CSR.settings;
    closeOverlay();
    const cycles = Math.max(1, s.pomoCycles);
    let title;
    let body;
    let primary;
    let secondary;
    if (ev.ended === 'focus') {
      const long = ev.next === 'long';
      title = long ? `آفرین! ${fa(cycles)} دور مطالعه کامل شد 🌟` : `${CSR.faDuration(s.pomoFocus * 60)} مطالعه کردی 🌿`;
      body = long
        ? `حالا ${CSR.faDuration(s.pomoLong * 60)} استراحت طولانی داری. از جایت بلند شو و کمی قدم بزن.`
        : `وقت استراحت است! ${CSR.faDuration(s.pomoShort * 60)} از صفحه دور شو؛ آب بخور، کش‌وقوس بیا و به دوردست نگاه کن.`;
      primary = ev.auto ? ['باشه، می‌روم استراحت', closeOverlay] : ['شروع استراحت', () => (send('start'), closeOverlay())];
      secondary = ['۵ دقیقه دیگر می‌خوانم', () => (send('extend', { phase: 'focus', minutes: 5 }), closeOverlay())];
    } else {
      title = 'استراحت تمام شد 📚';
      body = `برگرد سر درس — دور ${fa(((pomo.cycle || 0) % cycles) + 1)} از ${fa(cycles)}. ذهنت حالا تازه‌تر است.`;
      primary = ev.auto ? ['باشه، شروع کنیم', closeOverlay] : ['شروع مطالعه', () => (send('start'), closeOverlay())];
      secondary = ['۵ دقیقه دیگر استراحت', () => (send('extend', { phase: ev.ended, minutes: 5 }), closeOverlay())];
    }
    const frame = h('div', { class: 'pomo-frame' });
    frame.innerHTML = CSR.patternFill(s.pomoPattern, 30); // generated SVG
    const medal = h('div', { class: 'pomo-medal' });
    medal.innerHTML = CSR.shamsehSvg(s.pomoPattern, 92); // generated SVG
    const colors = CSR.patternById(s.pomoPattern).colors;
    overlay = h(
      'div',
      { class: 'pomo-overlay', role: 'dialog', 'aria-modal': 'true', style: `--pf:${colors.fg};--pb:${colors.bg};--ps:${colors.soft};--pi:${colors.ink}` },
      h(
        'div',
        { class: 'pomo-dialog' },
        frame,
        h(
          'div',
          { class: 'pomo-inner' },
          medal,
          h('h2', null, title),
          h('p', null, body),
          h(
            'div',
            { class: 'pomo-actions' },
            h('button', { class: 'pomo-primary', onclick: primary[1] }, primary[0]),
            h('button', { class: 'pomo-secondary', onclick: secondary[1] }, secondary[0])
          )
        )
      )
    );
    overlay.addEventListener('keydown', (e) => e.key === 'Escape' && closeOverlay());
    CSR.ui.layer().append(overlay);
    overlay.querySelector('.pomo-primary').focus();
    chime(ev.ended);
  }
  S.showOverlay = showOverlay; // for testing/preview

  S.applySettings = function () {
    paint();
    if (card) renderCard();
  };

  S.init = async function () {
    await Promise.all([loadStats(), loadPomo()]);
    paint();
  };
})();
