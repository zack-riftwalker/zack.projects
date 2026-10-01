/* Auto table of contents + reading progress.
 * Sections come from the questions you asked and the headings in Claude's
 * answers. A section counts as read when you tick it, or automatically after
 * you've spent enough time on it and scrolled to its end. The last reading
 * position is remembered so you can pick up where you left off. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const AN = CSR.ann;
  const TOC = (CSR.toc = { open: false });

  const WPM = 200;
  let panel = null;
  let sections = [];
  let dwell = new Map(); // key -> seconds seen
  let current = null;
  let resumeBtn = null;
  let posTimer = 0;
  let refreshTimer = 0;

  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function hash(s) {
    let x = 5381;
    for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  function words(el) {
    const t = oneLine(el.textContent);
    return t ? t.split(' ').length : 0;
  }

  function firstSentence(el) {
    const t = oneLine(el.textContent);
    const m = t.match(/^.{8,90}?[.!?؟:]/);
    return (m ? m[0] : t.slice(0, 80)) + (t.length > 80 && !m ? '…' : '');
  }

  function topBlocks(msg) {
    return dom.getBlocks(msg).filter((b) => {
      const up = b.parentElement && b.parentElement.closest(CSR.BLOCK_SEL);
      return !up || !msg.contains(up);
    });
  }

  // ---------------------------------------------------------------------------
  // model

  function progress() {
    const conv = AN.conv();
    if (!conv) return null;
    if (!conv.progress) conv.progress = { read: {}, lastPos: null };
    if (!conv.progress.read) conv.progress.read = {};
    return conv.progress;
  }

  // Sections seen so far. Claude's chat is a virtual list, so long
  // conversations only have part of their messages in the page at a time;
  // sections of rows that aren't rendered stay listed from this cache.
  let known = new Map();
  let builtFrom = []; // the message elements the last build saw
  let stale = true; // the page changed since the last build (see TOC.refresh)

  TOC.build = function (messages = dom.getMessages()) {
    const out = [];
    const rows = new Set();
    let virtual = false;
    builtFrom = messages;
    stale = false;
    messages.forEach((m, mi) => {
      const ri = dom.rowIndex(m);
      if (ri != null) virtual = true;
      const row = ri ?? mi;
      rows.add(row);
      let ord = 0;
      if (dom.roleOf(m) === 'user') {
        const title = oneLine(m.textContent).slice(0, 90);
        out.push({ key: `q:${row}:${hash(title)}`, row, ord, kind: 'q', level: 0, title, el: m, blocks: [m], words: 0 });
        return;
      }
      let cur = null;
      for (const b of topBlocks(m)) {
        const level = dom.headingLevel(b);
        if (level) {
          const title = oneLine(b.textContent).slice(0, 90);
          cur = { key: `h:${row}:${hash(title)}`, row, ord: ++ord, kind: 'h', level, title, el: b, blocks: [], words: 0 };
          out.push(cur);
        } else if (!cur) {
          const title = firstSentence(b);
          cur = { key: `a:${row}:${hash(title)}`, row, ord: ++ord, kind: 'a', level: 5, title, el: b, blocks: [], words: 0 };
          out.push(cur);
        }
        cur.blocks.push(b);
        cur.words += words(b);
      }
    });
    // forget cached sections of rows that are rendered now (they may have
    // changed); without a virtual list every message is rendered, so nothing
    // unrendered is worth keeping (and old positions would linger as ghosts)
    if (!virtual && messages.length) known.clear();
    for (const [k, sec] of known) if (rows.has(sec.row)) known.delete(k);
    for (const sec of out) known.set(sec.key, sec);
    sections = [...known.values()].sort((a, b) => a.row - b.row || a.ord - b.ord);
    return sections;
  };

  const live = (s) => s.blocks[0] && s.blocks[0].isConnected;

  const readable = (s) => s.kind !== 'q';

  TOC.stats = function () {
    const p = progress();
    const list = sections.filter(readable);
    const read = list.filter((s) => p && p.read[s.key]);
    const leftWords = list.filter((s) => !(p && p.read[s.key])).reduce((n, s) => n + s.words, 0);
    if (p && list.length) p.total = list.length; // lets the library show "x of y sections"

    return {
      total: list.length,
      read: read.length,
      pct: list.length ? Math.round((read.length / list.length) * 100) : 0,
      leftMin: Math.ceil(leftWords / WPM),
    };
  };

  function setRead(key, on) {
    const p = progress();
    if (!p) return;
    if (on) p.read[key] = Date.now();
    else delete p.read[key];
    AN.save({ quiet: true });
    TOC.refresh();
  }
  TOC.setRead = setRead;

  // ---------------------------------------------------------------------------
  // auto progress + reading position (called every second by study.js while active)

  function sectionRect(s) {
    const a = s.blocks[0].getBoundingClientRect();
    const b = s.blocks[s.blocks.length - 1].getBoundingClientRect();
    return { top: a.top, bottom: b.bottom };
  }

  TOC.tick = function () {
    if (!AN.conv()) return;
    // rebuild when the rendered messages changed (virtual list scrolled,
    // Claude re-rendered a row, a new message arrived) or their content did
    // (a streamed answer grew new headings)
    const msgs = dom.getMessages();
    if (stale || !sections.length || msgs.length !== builtFrom.length || msgs.some((m, i) => m !== builtFrom[i])) TOC.build(msgs);
    const p = progress();
    const vh = window.innerHeight;
    let changed = false;
    let cur = null;
    for (const s of sections) {
      if (!live(s)) continue;
      const r = sectionRect(s);
      if (r.bottom < 0 || r.top > vh) continue;
      if (!cur && r.bottom > vh * 0.3) cur = s;
      if (!readable(s) || p.read[s.key] || !CSR.settings.autoProgress) continue;
      const seen = (dwell.get(s.key) || 0) + 1;
      dwell.set(s.key, seen);
      const need = Math.min(90, Math.max(3, ((s.words / WPM) * 60) / 2));
      if (seen >= need && r.bottom <= vh) {
        p.read[s.key] = Date.now();
        changed = true;
      }
    }
    if (changed) {
      AN.save({ quiet: true });
      TOC.refresh();
    } else if (cur !== current) {
      current = cur;
      if (panel) markCurrent();
    }
  };

  function saveReadingPosition() {
    const conv = AN.conv();
    if (!conv) return;
    const msgs = dom.getMessages();
    for (const m of msgs) {
      if (dom.roleOf(m) === 'user') continue;
      for (const b of topBlocks(m)) {
        const r = b.getBoundingClientRect();
        if (r.bottom > 80) {
          if (r.top > window.innerHeight) return;
          const p = progress();
          p.lastPos = { msg: msgs.indexOf(m), row: dom.rowIndex(m), ...dom.makeBlockAnchor(m, b), at: Date.now() };
          AN.save({ quiet: true });
          return;
        }
      }
    }
  }

  document.addEventListener(
    'scroll',
    () => {
      clearTimeout(posTimer);
      posTimer = setTimeout(saveReadingPosition, 1500);
      if (panel) requestAnimationFrame(updateCurrentFromScroll);
    },
    true
  );

  function updateCurrentFromScroll() {
    const vh = window.innerHeight;
    let cur = null;
    for (const s of sections) {
      if (!live(s)) continue;
      const r = sectionRect(s);
      if (r.bottom > vh * 0.3 && r.top < vh) {
        cur = s;
        break;
      }
    }
    if (cur !== current) {
      current = cur;
      markCurrent();
    }
  }

  function findLastPos() {
    const p = progress();
    if (!p || !p.lastPos) return null;
    const msgs = dom.getMessages();
    const row = p.lastPos.row;
    // on a virtual list the saved row says exactly which message it was; the
    // rendered index only means something when every message is rendered
    const rowed = row != null && msgs.some((m) => dom.rowIndex(m) != null);
    const order = msgs
      .map((m, i) => ({ m, d: Math.abs(i - p.lastPos.msg) }))
      .filter((x) => !rowed || dom.rowIndex(x.m) === row)
      .sort((a, b) => a.d - b.d);
    for (const { m } of order) {
      const el = dom.locateBlock(m, p.lastPos);
      if (el) return el;
    }
    return null;
  }

  function flash(el) {
    el.classList.add('csr-toc-flash');
    setTimeout(() => el.classList.remove('csr-toc-flash'), 1500);
  }

  TOC.resume = async function () {
    if (resumeBtn) resumeBtn.remove();
    resumeBtn = null;
    const p = progress();
    const el = await dom.seek(findLastPos, p && p.lastPos ? p.lastPos.row : null);
    if (el === false) return; // a newer jump took over
    if (!el) return CSR.ui.toast('آخرین جای خواندن پیدا نشد');
    if (!(await dom.scrollToEl(el, 'center'))) return el.isConnected || CSR.ui.toast('آخرین جای خواندن پیدا نشد');
    flash(el);
  };

  /** After opening a conversation: offer to jump back to where you stopped. */
  TOC.onConvLoaded = function () {
    dwell = new Map();
    current = null;
    sections = [];
    known = new Map();
    builtFrom = [];
    lastSig = '';
    if (resumeBtn) resumeBtn.remove();
    resumeBtn = null;
    if (!CSR.settings.resumePrompt) return;
    setTimeout(() => {
      const el = findLastPos();
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top > 0 && r.bottom < window.innerHeight) return; // already there
      const h = CSR.ui.h;
      resumeBtn = h(
        'div',
        { class: 'resume' },
        h('button', { class: 'resume-go', onclick: TOC.resume }, '↓ ادامه‌ی مطالعه از آخرین جایی که خواندی'),
        h('button', { class: 'resume-x', icon: 'close', title: 'بستن', onclick: () => (resumeBtn.remove(), (resumeBtn = null)) })
      );
      CSR.ui.layer().append(resumeBtn);
      setTimeout(() => {
        if (resumeBtn) resumeBtn.classList.add('fade');
      }, 12000);
      setTimeout(() => {
        if (resumeBtn) resumeBtn.remove();
        resumeBtn = null;
      }, 13000);
    }, 1200);
  };

  // ---------------------------------------------------------------------------
  // panel

  let lastSig = '';

  TOC.toggle = function (open) {
    TOC.open = open === undefined ? !TOC.open : !!open;
    CSR.ui.setDockState('toc', TOC.open);
    if (!TOC.open) {
      if (panel) panel.remove();
      panel = null;
      lastSig = '';
      return;
    }
    TOC.build();
    render(true);
    panel.classList.add('enter');
  };

  /** Rebuild after the page changed (debounced; skipped when nothing visible
   * changed, so a click on the list is never lost to a re-render). */
  TOC.refresh = function () {
    stale = true; // so the next tick rebuilds even while the panel is closed
    if (!TOC.open) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      TOC.build();
      render();
    }, 150);
  };

  function markCurrent() {
    if (!panel) return;
    panel.querySelectorAll('.toc-item.current').forEach((e) => e.classList.remove('current'));
    if (!current) return;
    const it = panel.querySelector(`.toc-item[data-key="${current.key}"]`);
    if (it) {
      it.classList.add('current');
      const list = panel.querySelector('.toc-list');
      const ir = it.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      if (ir.top < lr.top || ir.bottom > lr.bottom) it.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Jump to a section: find it fresh (Claude may have re-rendered it, or it
   * may not be rendered at all yet), then scroll there. */
  async function go(sec) {
    const find = () => {
      TOC.build();
      const f = sections.find((x) => x.key === sec.key);
      return f && live(f) ? f.el : null;
    };
    const el = await dom.seek(find, sec.row);
    if (el === false) return; // a newer jump took over
    if (!el) return CSR.ui.toast('این بخش الان در صفحه پیدا نشد');
    if (!(await dom.scrollToEl(el, 'start'))) return el.isConnected || CSR.ui.toast('این بخش الان در صفحه پیدا نشد');
    flash(el);
    current = sections.find((x) => x.key === sec.key) || null;
    markCurrent();
  }
  TOC.go = go;

  function render(force) {
    const h = CSR.ui.h;
    const conv = AN.conv();
    const p = progress();
    const st = TOC.stats();
    const bookmarks = AN.sorted().filter((a) => a.kind === 'bookmark');
    const sig = [
      sections.map((x) => x.key + (p && p.read[x.key] ? '+' : '')).join('|'),
      bookmarks.map((a) => a.id + a.label).join('|'),
      st.pct,
      st.leftMin,
      p && p.lastPos ? 1 : 0,
      CSR.settings.autoProgress,
    ].join('#');
    if (!force && panel && sig === lastSig) return;
    lastSig = sig;
    const keep = panel ? panel.querySelector('.toc-list')?.scrollTop : 0;
    if (panel) panel.remove();

    const list = h('div', { class: 'toc-list' });
    if (!conv || !sections.length) {
      list.append(h('div', { class: 'empty' }, 'فهرستی برای این صفحه نیست.'));
    }
    if (bookmarks.length) {
      list.append(h('div', { class: 'toc-sub' }, 'نشانک‌ها'));
      for (const a of bookmarks) {
        list.append(
          h(
            'button',
            { class: 'toc-bm', onclick: () => AN.reveal(a.id).then((ok) => ok || CSR.ui.toast('این نشانک الان در صفحه نیست')) },
            h('span', { class: 'toc-bm-flag', style: `--c:${CSR.patternById(a.pattern).colors.bg};--f:${CSR.patternById(a.pattern).colors.fg}` }),
            h('span', { dir: 'auto' }, a.label || 'نشانک')
          )
        );
      }
      list.append(h('div', { class: 'toc-sub' }, 'بخش‌ها'));
    }
    for (const s of sections) {
      const isRead = !!(p && p.read[s.key]);
      const item = h(
        'div',
        { class: `toc-item k-${s.kind} l-${s.level}` + (isRead ? ' read' : ''), 'data-key': s.key },
        readable(s)
          ? h('input', {
              type: 'checkbox',
              class: 'toc-check',
              title: isRead ? 'خوانده شده' : 'علامت بزن که خواندی',
              checked: isRead,
              onchange: (e) => setRead(s.key, e.target.checked),
            })
          : h('span', { class: 'toc-q' }, '؟'),
        h('button', { class: 'toc-title', dir: 'auto', title: s.title, onclick: () => go(s) }, s.title || '…'),
        readable(s) && s.words ? h('span', { class: 'toc-min' }, fa(Math.max(1, Math.round(s.words / WPM))) + '′') : null
      );
      list.append(item);
    }

    panel = h(
      'aside',
      { class: 'toc' },
      h(
        'header',
        { class: 'panel-head' },
        h('div', { class: 'panel-title' }, 'فهرست و پیشرفت'),
        h('button', { class: 'tool-btn', icon: 'close', title: 'بستن', onclick: () => TOC.toggle(false) })
      ),
      h(
        'div',
        { class: 'toc-progress' },
        h('div', { class: 'bar' }, h('span', { style: `width:${st.pct}%` })),
        h(
          'div',
          { class: 'toc-stat' },
          st.total ? `${fa(st.pct)}٪ خوانده شده، ${fa(st.read)} از ${fa(st.total)} بخش` : 'هنوز بخشی نیست',
          st.total && st.leftMin ? h('span', null, `، حدود ${fa(st.leftMin)} دقیقه مانده`) : null
        ),
        p && p.lastPos ? h('button', { class: 'chip', onclick: TOC.resume }, '↓ ادامه از آخرین جا') : null
      ),
      list,
      h(
        'footer',
        { class: 'panel-foot' },
        h(
          'button',
          {
            class: 'chip',
            onclick: () => {
              for (const s of sections.filter(readable)) progress().read[s.key] = progress().read[s.key] || Date.now();
              AN.save({ quiet: true });
              render();
            },
          },
          'همه خوانده شد'
        ),
        h(
          'button',
          {
            class: 'chip',
            onclick: () => {
              if (!confirm('پیشرفت این گفتگو صفر شود؟')) return;
              progress().read = {};
              dwell = new Map();
              AN.save({ quiet: true });
              render();
            },
          },
          'شروع دوباره'
        ),
        h('span', { class: 'foot-hint' }, CSR.settings.autoProgress ? 'علامت خودکار: روشن' : 'علامت خودکار: خاموش')
      )
    );
    CSR.ui.layer().append(panel);
    const l = panel.querySelector('.toc-list');
    if (keep) l.scrollTop = keep;
    updateCurrentFromScroll();
  }
})();
