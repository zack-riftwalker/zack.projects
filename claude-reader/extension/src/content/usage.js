/* Claude usage limits (claude.ai only).
 * Reads the same numbers as Claude's Settings → Usage page
 * (/api/organizations/<org>/usage, with the page's own login): the 5-hour
 * session window and the weekly windows. Refreshed right after each answer
 * finishes, when the tab comes back, and every few minutes. The last reading
 * is shared between tabs through chrome.storage.local; nothing leaves claude.ai. */
(function () {
  const CSR = globalThis.CSR;
  const U = (CSR.usage = { data: null, error: null });
  const noop = () => {};
  if (CSR.site.id !== 'claude') {
    Object.assign(U, { init: noop, applySettings: noop, toggleCard: noop, refresh: async () => null });
    return;
  }

  const KEY = 'usage';
  const STREAMING = CSR.SEL.streaming + ', button[aria-label="Stop response"]';
  const PERIOD = 5 * 60 * 1000;
  const F = CSR.usageFmt;
  const { label, rank, color } = F;
  const faPct = F.pct;

  let busy = null;
  let lastFetch = 0;
  let streaming = false;
  let baseline = null; // 5-hour reading when the current answer started
  let pill = null;
  let card = null;
  let flashUntil = 0;
  let ticks = 0;

  // readings keep going while the pill is hidden, so the popup's usage tab
  // (and "what the last answer cost") stays current
  const reading = () => !!(CSR.settings && CSR.settings.enabled && !CSR.dead && CSR.alive());
  const on = () => reading() && !!CSR.settings.showUsage;

  // ---------------------------------------------------------------------------
  // reading

  /** The windows Claude reports, in a fixed order. Utilization is a percentage. */
  function parse(json) {
    const out = [];
    for (const [key, v] of Object.entries(json || {})) {
      if (!v || typeof v !== 'object' || typeof v.utilization !== 'number') continue;
      const reset = v.resets_at ? Date.parse(v.resets_at) : NaN;
      const w = { key, pct: Math.max(0, Math.min(100, v.utilization)), resetsAt: Number.isFinite(reset) ? reset : null };
      // per-model weekly windows that were never touched only add clutter
      if (rank(key) === 2 && !w.pct && !w.resetsAt) continue;
      out.push(w);
    }
    return out.sort((a, b) => rank(a.key) - rank(b.key));
  }

  const main = F.main;

  /** Fetch a fresh reading. `why === 'answer'` also records what the last answer cost. */
  U.refresh = function (why) {
    if (!reading()) return Promise.resolve(null);
    if (busy) return busy;
    busy = (async () => {
      try {
        const windows = parse(await CSR.claudeApi.orgGet('usage'));
        if (!windows.length) throw Object.assign(new Error('no usage windows'), { status: 0 });
        const prev = U.data || {};
        const data = { at: Date.now(), windows, delta: prev.delta == null ? null : prev.delta, deltaAt: prev.deltaAt || 0 };
        const now = main(data);
        if (why === 'answer' && baseline && now && baseline.key === now.key && now.pct >= baseline.pct) {
          data.delta = now.pct - baseline.pct;
          data.deltaAt = Date.now();
          if (data.delta !== prev.delta || Date.now() - (prev.deltaAt || 0) > 60000) flashUntil = Date.now() + 8000;
        }
        U.data = data;
        U.error = null;
        if (CSR.alive()) await chrome.storage.local.set({ [KEY]: data, usageError: null });
      } catch (e) {
        U.error = e.status === 401 || e.status === 403 ? 'auth' : 'fail';
        if (CSR.alive()) chrome.storage.local.set({ usageError: { at: Date.now(), error: U.error } }).catch(() => {});
      } finally {
        lastFetch = Date.now();
        busy = null;
        paint();
      }
      return U.data;
    })();
    if (card) renderCard(); // "updating…"
    return busy;
  };

  // ---------------------------------------------------------------------------
  // when to read

  function tick() {
    if (!reading()) return;
    const now = !!document.querySelector(STREAMING);
    if (now && !streaming) baseline = main(U.data); // an answer started
    if (!now && streaming) {
      // the answer is done; Claude books it a moment later, so read twice
      setTimeout(() => U.refresh('answer'), 2000);
      setTimeout(() => U.refresh('answer'), 20000);
    }
    streaming = now;
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > PERIOD) U.refresh();
    if (++ticks % 20 === 0) paint(); // "updated x minutes ago", reset countdowns
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > 60000) U.refresh();
  });

  // the popup's usage tab asks for a fresh reading
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || msg.csr !== 'usageRefresh') return;
    U.refresh().then(() => reply({ data: U.data, error: U.error }));
    return true; // reply comes later
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY] || !changes[KEY].newValue) return;
    U.data = changes[KEY].newValue; // read by another tab
    paint();
  });

  // ---------------------------------------------------------------------------
  // pill + card

  function ring(pct, size, stroke, c) {
    const r = (size - stroke) / 2;
    const len = 2 * Math.PI * r;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${c}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - pct / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  }

  function summary(d) {
    return d.windows.map((w) => `${label(w.key)}: ${faPct(w.pct)}`).join(' · ');
  }

  function paint() {
    const layer = CSR.ui.layer();
    if (!layer) return;
    const d = U.data;
    if (!on() || !d || !main(d)) {
      if (pill) pill.remove();
      pill = null;
      if (card && !on()) U.toggleCard(false);
      else if (card) renderCard();
      return;
    }
    const h = CSR.ui.h;
    if (!pill) {
      pill = h('button', { class: 'usage-pill', onclick: () => U.toggleCard() });
      CSR.ui.pillBar().append(pill);
    }
    const m = main(d);
    const week = d.windows.find((w) => w.key === 'seven_day');
    pill.title = 'مصرف Claude — ' + summary(d) + (U.error ? '\n(آخرین به‌روزرسانی ناموفق بود)' : '');
    pill.textContent = '';
    const icon = h('span', { class: 'pill-ring' });
    icon.innerHTML = ring(m.pct, 18, 3, color(m.pct)); // generated SVG
    pill.append(icon, h('span', { class: 'pill-time' }, faPct(m.pct)));
    if (week && week !== m) pill.append(h('span', { class: 'pill-phase' }, 'هفته ' + faPct(week.pct)));
    const flash = Date.now() < flashUntil && d.delta != null;
    if (flash) pill.append(h('span', { class: 'usage-delta' }, '+' + (d.delta < 1 ? '<۱٪' : faPct(d.delta))));
    pill.classList.toggle('flash', flash);
    pill.classList.toggle('stale', !!U.error);
    if (flash) setTimeout(paint, flashUntil - Date.now() + 50);
    if (card) renderCard();
  }

  U.toggleCard = function (open) {
    const want = open === undefined ? !card : !!open;
    if (!want) {
      if (card) card.remove();
      card = null;
      return;
    }
    if (CSR.study) CSR.study.toggleCard(false);
    renderCard();
    if (Date.now() - lastFetch > 30000) U.refresh();
  };

  function renderCard() {
    const h = CSR.ui.h;
    const d = U.data;
    const body = [];
    if (d && d.windows) {
      for (const w of d.windows) {
        body.push(
          h(
            'div',
            { class: 'usage-row' },
            h('div', { class: 'usage-top' }, h('span', null, label(w.key)), h('b', { style: `color:${color(w.pct)}` }, faPct(w.pct))),
            h('div', { class: 'usage-bar' }, h('span', { style: `width:${w.pct}%;background:${color(w.pct)}` })),
            w.resetsAt ? h('div', { class: 'hint' }, F.resetText(w)) : null
          )
        );
      }
      if (d.delta != null && main(d)) {
        body.push(h('div', { class: 'usage-last' }, `آخرین پاسخ: ${F.delta(d.delta)} از ${label(main(d).key)}`));
      }
    }
    if (U.error && !(d && d.windows)) {
      body.push(h('div', { class: 'hint' }, F.errorText(U.error)));
    } else if (!d) {
      body.push(h('div', { class: 'hint' }, 'در حال خواندن…'));
    }
    const ago = F.ago(d && d.at);
    const next = h(
      'div',
      { class: 'usage-card', onmousedown: (e) => e.target.closest('a') || e.preventDefault() },
      h(
        'header',
        { class: 'panel-head' },
        h('div', { class: 'panel-title' }, 'مصرف Claude'),
        h('button', { class: 'tool-btn', icon: 'refresh', title: 'به‌روزرسانی', onclick: () => U.refresh() }),
        h('button', { class: 'tool-btn', icon: 'close', title: 'بستن', onclick: () => U.toggleCard(false) })
      ),
      ...body,
      h(
        'div',
        { class: 'usage-foot' },
        h('span', null, (busy ? 'در حال به‌روزرسانی…' : ago ? 'به‌روزرسانی: ' + ago : '') + (U.error && d ? ' (آخرین تلاش ناموفق)' : '')),
        h('a', { href: '/settings/usage', target: '_blank', rel: 'noopener' }, 'جزئیات در Claude')
      ),
      h('div', { class: 'hint' }, 'بعد از هر پاسخ خودش به‌روز می‌شود. همان عددهای صفحه‌ی Usage خود Claude است.')
    );
    if (card) {
      next.classList.add('still'); // a repaint, not a new card: no pop-in animation
      card.replaceWith(next);
    }
    else CSR.ui.layer().append(next);
    card = next;
  }

  U.applySettings = function () {
    paint();
    if (reading() && (!U.data || Date.now() - lastFetch > PERIOD)) U.refresh();
  };

  U.init = async function () {
    if (CSR.alive()) {
      const r = await chrome.storage.local.get(KEY);
      if (r[KEY] && r[KEY].windows) U.data = r[KEY];
    }
    paint();
    if (!U.data || Date.now() - U.data.at > 30000) U.refresh();
    else lastFetch = U.data.at;
    setInterval(tick, 1000);
  };
})();
