/* In-page UI (inside a shadow root so Claude's CSS can't touch it):
 * dock, selection toolbar, mark/divider popovers, pen & divider toolbars,
 * notes panel and toasts. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const AN = CSR.ann;
  const D = CSR.draw;
  const UI = (CSR.ui = { mode: 'none', panelOpen: false });

  let host = null;
  let shadow = null;
  const el = {};

  // ---------------------------------------------------------------------------
  // tiny DOM builder

  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'icon') e.innerHTML = ICONS[v] || ''; // static, trusted markup only
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : String(c));
    }
    return e;
  }

  const svg = (body, extra = '') =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

  const ICONS = {
    pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    marker: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
    line: svg('<path d="M4 12h16"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="20" cy="12" r="1.5" fill="currentColor"/>'),
    eraser: svg('<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
    divider: svg('<path d="M3 12h18"/><path d="M7 6h10" opacity=".45"/><path d="M7 18h10" opacity=".45"/>'),
    notes: svg('<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"/><path d="M15 3v6h6"/><path d="M7 13h10M7 17h6"/>'),
    rtl: svg('<path d="M21 6H9"/><path d="M21 12H3"/><path d="M21 18H7"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>'),
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    note: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>'),
    copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
    download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
    quote: svg('<path d="M3 21c3 0 7-1 7-8V5c0-1.1-.9-2-2-2H4a2 2 0 0 0-2 2v6c0 1.1.9 2 2 2h3c0 3-2 5-4 5"/><path d="M15 21c3 0 7-1 7-8V5c0-1.1-.9-2-2-2h-4a2 2 0 0 0-2 2v6c0 1.1.9 2 2 2h3c0 3-2 5-4 5"/>', ''),
    star: svg('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>'),
    clear: svg('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><path d="m3 3 18 18" stroke="#e03131"/>'),
    chevron: svg('<path d="m9 18 6-6-6-6"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
    sizeUp: svg('<path d="M4 18 9 6l5 12"/><path d="M5.5 14h7"/><path d="M18 8v6M15 11h6"/>'),
    sizeDown: svg('<path d="M4 18 9 6l5 12"/><path d="M5.5 14h7"/><path d="M15 11h6"/>'),
    bookmark: svg('<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    toc: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor"/><circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="3.5" cy="18" r="1" fill="currentColor"/>'),
    speaker: svg('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
    ruler: svg('<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7v4M10 7v3M14 7v4M18 7v3"/>'),
    focus: svg('<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/>'),
    timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/>'),
    book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/>'),
    play: svg('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
    pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'),
    prev: svg('<path d="M19 5 9 12l10 7z" fill="currentColor"/><path d="M5 5v14"/>'),
    next: svg('<path d="m5 5 10 7-10 7z" fill="currentColor"/><path d="M19 5v14"/>'),
    skip: svg('<path d="m5 4 10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/>'),
    minimize: svg('<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>'),
    moreV: svg('<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>'),
  };

  // ---------------------------------------------------------------------------
  // host

  UI.init = async function () {
    if (host) return;
    host = h('div', { id: 'csr-host', 'data-csr-ui': '' });
    shadow = host.attachShadow({ mode: 'open' });
    const style = h('style');
    try {
      style.textContent = await (await fetch(chrome.runtime.getURL('src/content/ui.css'))).text();
    } catch (e) {
      /* UI still works, just unstyled */
    }
    shadow.append(style);
    el.layer = h('div', { class: 'layer', dir: 'rtl' });
    shadow.append(el.layer);
    buildDock();
    buildSelectionToolbar();
    el.popover = h('div', { class: 'popover', hidden: true, onmousedown: keepSelection });
    el.toast = h('div', { class: 'toast', role: 'status' });
    el.guide = h('div', { class: 'guide', hidden: true });
    el.layer.append(el.popover, el.toast, el.guide);
    document.documentElement.appendChild(host);
    bindPageEvents();
  };

  UI.shadow = () => shadow;
  UI.h = h;
  UI.ICONS = ICONS;
  UI.layer = () => el.layer;
  UI.el = el;
  UI.isDark = () => isDark(CSR.settings);
  UI.setDockState = (key, on) => el.dockBtn && el.dockBtn[key] && el.dockBtn[key].classList.toggle('on', !!on);

  function keepSelection(e) {
    // clicking our buttons must not clear the user's text selection
    if (!e.target.closest('textarea, input, select')) e.preventDefault();
  }

  UI.toast = function (msg, ms = 2200) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(() => el.toast.classList.remove('show'), ms);
  };

  UI.applySettings = function (s) {
    if (!host) return;
    const dark = isDark(s);
    host.toggleAttribute('data-dark', dark);
    el.layer.setAttribute('data-side', s.dockSide === 'left' ? 'left' : 'right');
    el.layer.setAttribute('data-site', CSR.site.id);
    // on a narrow window the dock would cover the start of Persian lines, and
    // on Notion it would sit on Notion's own chat panel: show the small circle
    // instead (until it's clicked), without changing the setting
    const collapsed = !!s.dockCollapsed || (autoFold() && !openedFolded);
    // on Notion, only while its AI chat is open
    const here = CSR.site.id !== 'notion' || !!(CSR.notion && CSR.notion.chat);
    el.dock.hidden = !(s.enabled && s.showDock && here) || collapsed;
    el.bubble.hidden = !(s.enabled && s.showDock && here && collapsed);
    el.dockBtn.highlighter.classList.toggle('on', !!s.highlighterMode);
    el.dockBtn.highlighter.style.setProperty('--sw', swatch(s.activeHighlight));
    el.dockBtn.rtl.setAttribute('data-state', s.rtlMode);
    el.dockBtn.rtl.title = 'راست‌چین: ' + { off: 'خاموش', auto: 'خودکار', force: 'همیشه راست‌چین' }[s.rtlMode] + ' (Alt+R)';
    D.color = s.penColor;
    D.width = s.penWidth;
    if (!s.enabled) UI.setMode('none');
  };

  function isDark(s) {
    const t = s.enabled ? CSR.resolveTheme(s) : null;
    if (t) return !!t.dark;
    const m = document.documentElement.getAttribute('data-mode');
    if (m) return m === 'dark';
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  const swatch = (id) => (CSR.HIGHLIGHTS.find((x) => x.id === id) || CSR.HIGHLIGHTS[0]).swatch;

  // ---------------------------------------------------------------------------
  // dock

  function buildDock() {
    const b = (key, icon, title, onclick, label) =>
      (el.dockBtn[key] = h('button', { class: 'dock-btn', title, onclick, 'data-key': key, icon }, label || null));
    el.dockBtn = {};
    el.dock = h(
      'div',
      { class: 'dock', onmousedown: keepSelection },
      b('collapse', 'minimize', 'جمع کردن نوار ابزار (به یک دایره‌ی کوچک که می‌شود جابه‌جایش کرد)', () => UI.setCollapsed(true)),
      h('div', { class: 'dock-sep' }),
      b('highlighter', 'marker', 'حالت ماژیک: هر متنی را انتخاب کنی هایلایت می‌شود (Alt+H)', () => toggleHighlighter()),
      b('pen', 'pen', 'مداد و طراحی (Alt+P)', () => UI.setMode(UI.mode === 'draw' ? 'none' : 'draw')),
      b('divider', 'divider', 'خط جداکننده بین بخش‌ها (Alt+L)', () => UI.setMode(UI.mode === 'divider' ? 'none' : 'divider')),
      b('bookmark', 'bookmark', 'نشانک (مثل روبان کتاب) (Alt+G)', () => UI.setMode(UI.mode === 'bookmark' ? 'none' : 'bookmark')),
      h('div', { class: 'dock-sep' }),
      b('notes', 'notes', 'یادداشت‌ها و هایلایت‌های این گفتگو (Alt+M)', () => UI.togglePanel()),
      b('toc', 'toc', 'فهرست و پیشرفت مطالعه (Alt+T)', () => CSR.toc.toggle()),
      h('div', { class: 'dock-sep' }),
      b('tts', 'speaker', 'خواندن با صدا (Alt+V)', () => CSR.tts.toggle()),
      b('ruler', 'ruler', 'خط‌کش خواندن (Alt+K)', () => CSR.ruler.toggle()),
      b('focus', 'focus', 'حالت تمرکز (Alt+Z)', () => CSR.focus.toggle()),
      b('timer', 'timer', 'زمان مطالعه و پومودورو', () => CSR.study.toggleCard()),
      h('div', { class: 'dock-sep' }),
      (el.dockExtra = h(
        'div',
        { class: 'dock-extra', hidden: true },
        b('rtl', 'rtl', 'راست‌چین', () => UI.cycleRtl()),
        b('bigger', 'sizeUp', 'بزرگ‌کردن متن', () => UI.bumpFont(1)),
        b('smaller', 'sizeDown', 'کوچک‌کردن متن', () => UI.bumpFont(-1)),
        b('hide', 'eye', 'پنهان/نمایش هایلایت‌ها و طراحی‌ها', () => UI.toggleHideAnnotations())
      )),
      b('more', 'moreV', 'ابزارهای بیشتر', () => {
        el.dockExtra.hidden = !el.dockExtra.hidden;
        el.dockBtn.more.classList.toggle('on', !el.dockExtra.hidden);
      })
    );
    el.tools = h('div', { class: 'tools', hidden: true, onmousedown: keepSelection });
    el.layer.append(el.dock, el.tools);
    buildBubble();
  }

  // ---------------------------------------------------------------------------
  // collapsed dock: a small draggable circle

  const LOGO =
    '<svg viewBox="0 0 128 128" width="26" height="26" aria-hidden="true"><path d="M64 38c-10-8-24-10-38-8v58c14-2 28 0 38 8 10-8 24-10 38-8V30c-14-2-28 0-38 8z" fill="#fffaf5"/><path d="M64 38v58" stroke="#c2573a" stroke-width="5" stroke-linecap="round"/><rect x="34" y="46" width="22" height="9" rx="3" fill="#ffd43b"/><rect x="72" y="70" width="22" height="9" rx="3" fill="#8ce99a"/></svg>';
  const BUBBLE = 46;
  let bubblePos = null; // {x, y} as fractions of the window
  const NARROW = 720;
  const isNarrow = () => window.innerWidth < NARROW;
  const autoFold = () => isNarrow() || CSR.site.foldDock;
  let openedFolded = false; // dock opened from the circle where it starts folded
  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    if (isNarrow() === wasNarrow) return;
    wasNarrow = isNarrow();
    openedFolded = false;
    if (CSR.settings) UI.applySettings(CSR.settings);
  });

  // a spot picked on a wide window means little on a narrow one: there the
  // circle starts in its corner, and moving it lasts only for this visit.
  // Notion keeps its own spot (its top right holds Notion's buttons).
  let narrowPos = null;
  let notionPos = null;
  const NOTION = CSR.site.id === 'notion';
  const posNow = () => (isNarrow() ? narrowPos : NOTION ? notionPos : bubblePos);

  function placeBubble() {
    const pos = posNow();
    const maxX = window.innerWidth - BUBBLE - 6;
    const maxY = window.innerHeight - BUBBLE - 6;
    const leftEdge = NOTION && !isNarrow();
    const x = pos ? pos.x * window.innerWidth : leftEdge ? 6 : maxX - 12;
    const y = pos ? pos.y * window.innerHeight : leftEdge ? Math.round(window.innerHeight * 0.55) : 72;
    el.bubble.style.left = Math.max(6, Math.min(maxX, x)) + 'px';
    el.bubble.style.top = Math.max(6, Math.min(maxY, y)) + 'px';
  }

  function buildBubble() {
    el.bubble = h('button', { class: 'bubble', title: 'خوانا — کلیک: باز کردن نوار ابزار، کشیدن: جابه‌جا کردن', hidden: true });
    el.bubble.innerHTML = LOGO; // static markup
    let drag = null;
    el.bubble.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.bubble.setPointerCapture(e.pointerId);
      const r = el.bubble.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    });
    el.bubble.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      el.bubble.classList.add('dragging');
      const p = { x: (drag.ox + dx) / window.innerWidth, y: (drag.oy + dy) / window.innerHeight };
      if (isNarrow()) narrowPos = p;
      else if (NOTION) notionPos = p;
      else bubblePos = p;
      placeBubble();
    });
    const end = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      el.bubble.classList.remove('dragging');
      if (moved) {
        if (!isNarrow()) chrome.storage.local.set(NOTION ? { bubblePosNotion: notionPos } : { bubblePos });
      } else if (CSR.settings.dockCollapsed) UI.setCollapsed(false);
      else {
        openedFolded = true; // only folded because of the window / the site
        UI.applySettings(CSR.settings);
      }
    };
    el.bubble.addEventListener('pointerup', end);
    el.bubble.addEventListener('pointercancel', end);
    el.layer.append(el.bubble);
    chrome.storage.local.get(['bubblePos', 'bubblePosNotion']).then((r) => {
      if (r.bubblePos) bubblePos = r.bubblePos;
      if (r.bubblePosNotion) notionPos = r.bubblePosNotion;
      placeBubble();
    });
    window.addEventListener('resize', placeBubble);
    placeBubble();
  }

  UI.setCollapsed = function (on) {
    if (on && autoFold() && !CSR.settings.dockCollapsed) {
      // where the dock starts folded anyway: just fold it back, save nothing
      openedFolded = false;
      UI.applySettings(CSR.settings);
      return;
    }
    CSR.store.patchSettings({ dockCollapsed: !!on });
    if (on) UI.toast('نوار ابزار جمع شد؛ روی دایره کلیک کن تا باز شود، یا بکشش هر جا خواستی');
  };

  async function toggleHighlighter() {
    const s = await CSR.store.patchSettings({ highlighterMode: !CSR.settings.highlighterMode });
    UI.toast(s.highlighterMode ? 'حالت ماژیک روشن شد — متن را انتخاب کن' : 'حالت ماژیک خاموش شد');
  }
  UI.toggleHighlighter = toggleHighlighter;

  UI.cycleRtl = async function () {
    const order = ['auto', 'force', 'off'];
    const next = order[(order.indexOf(CSR.settings.rtlMode) + 1) % order.length];
    await CSR.store.patchSettings({ rtlMode: next });
    UI.toast({ auto: 'راست‌چین خودکار (هر پاراگراف جدا)', force: 'همه‌ی متن راست‌چین', off: 'راست‌چین خاموش' }[next]);
  };

  UI.bumpFont = async function (dir) {
    const cur = CSR.settings.fontSize || 16;
    const next = Math.max(12, Math.min(30, cur + dir));
    await CSR.store.patchSettings({ fontSize: next });
    UI.toast('اندازه‌ی متن: ' + next.toLocaleString('fa-IR'));
  };

  UI.toggleHideAnnotations = function () {
    const on = !document.documentElement.hasAttribute('data-csr-hide-ann');
    document.documentElement.toggleAttribute('data-csr-hide-ann', on);
    el.dockBtn.hide.classList.toggle('on', on);
    UI.toast(on ? 'هایلایت‌ها و طراحی‌ها پنهان شدند' : 'هایلایت‌ها و طراحی‌ها نمایش داده می‌شوند');
  };

  // ---------------------------------------------------------------------------
  // modes: draw / divider

  UI.setMode = function (mode) {
    if (UI.mode === mode) return;
    if (UI.mode === 'draw') D.disable();
    if (UI.mode === 'divider' || UI.mode === 'bookmark') el.guide.hidden = true;
    UI.mode = mode;
    const html = document.documentElement;
    if (mode === 'none') html.removeAttribute('data-csr-mode');
    else html.setAttribute('data-csr-mode', mode);
    for (const k of ['pen', 'divider', 'bookmark']) el.dockBtn[k].classList.toggle('on', (k === 'pen' ? 'draw' : k) === mode);
    el.tools.textContent = '';
    el.tools.hidden = mode === 'none';
    hideSelectionToolbar();
    if (mode === 'draw') {
      buildPenTools();
      D.enable(el.layer);
      UI.toast('روی متن بکش. Esc برای خروج، Ctrl+Z برای برگشت');
    } else if (mode === 'divider') {
      buildDividerTools();
      UI.toast('بین پاراگراف‌ها کلیک کن تا خط جداکننده اضافه شود');
    } else if (mode === 'bookmark') {
      buildBookmarkTools();
      UI.toast('جایی که می‌خواهی نشانک بگذاری کلیک کن');
    }
  };

  const bookmarkOpts = { label: '' };

  function patternChips(current, onPick) {
    const box = h(
      'div',
      { class: 'patterns' },
      CSR.PATTERNS.map((p) => {
        const b = h(
          'button',
          {
            class: 'pattern' + (p.id === current ? ' on' : ''),
            title: p.label,
            onclick: (e) => {
              box.querySelectorAll('.pattern').forEach((x) => x.classList.remove('on'));
              e.currentTarget.classList.add('on');
              onPick(p.id);
            },
          },
          h('span', { class: 'pattern-fill' }),
          h('span', { class: 'pattern-name' }, p.label)
        );
        b.firstChild.innerHTML = CSR.patternFill(p.id, 14); // generated SVG
        return b;
      })
    );
    return box;
  }
  UI.patternChips = patternChips;

  function buildBookmarkTools() {
    const label = h('input', {
      class: 'input',
      dir: 'auto',
      placeholder: 'اسم نشانک (اختیاری)، مثلاً «تا اینجا خواندم»',
      value: bookmarkOpts.label,
      oninput: (e) => (bookmarkOpts.label = e.target.value),
      onkeydown: (e) => e.stopPropagation(),
    });
    el.tools.append(
      h('div', { class: 'tools-title' }, 'نشانک'),
      patternChips(CSR.settings.bookmarkPattern, (id) => CSR.store.patchSettings({ bookmarkPattern: id })),
      label,
      h('div', { class: 'hint' }, 'بالا یا پایین یک پاراگراف کلیک کن. نشانک‌ها در «فهرست» هم می‌آیند.'),
      h('div', { class: 'tool-row' }, h('button', { class: 'tool-btn primary', icon: 'check', title: 'تمام (Esc)', onclick: () => UI.setMode('none') }))
    );
  }

  function openBookmarkPopover(a, rect) {
    popoverFor = a.id;
    const p = el.popover;
    p.textContent = '';
    const label = h('input', {
      class: 'input',
      dir: 'auto',
      placeholder: 'اسم نشانک',
      oninput: (e) => AN.update(a.id, { label: e.target.value }),
      onkeydown: (e) => e.stopPropagation(),
    });
    label.value = a.label || '';
    p.append(
      h('div', { class: 'tools-title' }, 'نشانک'),
      patternChips(a.pattern, (id) => AN.update(a.id, { pattern: id })),
      label,
      h(
        'div',
        { class: 'pop-row end' },
        h('button', { class: 'sel-btn danger', icon: 'trash', title: 'حذف نشانک', onclick: () => (AN.remove(a.id), closePopover()) }),
        h('button', { class: 'sel-btn primary', icon: 'check', title: 'بستن', onclick: closePopover })
      )
    );
    placePopover(rect);
  }

  function toolButton(tool, icon, title) {
    return h('button', {
      class: 'tool-btn' + (D.tool === tool ? ' on' : ''),
      title,
      icon,
      onclick: (e) => {
        D.setTool(tool);
        el.tools.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
      },
    });
  }

  function buildPenTools() {
    const colors = h(
      'div',
      { class: 'swatches' },
      CSR.PEN_COLORS.map((c) =>
        h('button', {
          class: 'swatch' + (c === D.color ? ' on' : ''),
          style: `--c:${c}`,
          title: c,
          onclick: (e) => {
            D.color = c;
            CSR.store.patchSettings({ penColor: c });
            colors.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
            e.currentTarget.classList.add('on');
            if (D.tool === 'eraser') D.setTool('pen');
          },
        })
      )
    );
    const widths = h(
      'div',
      { class: 'widths' },
      [2, 3, 5, 8].map((w) =>
        h(
          'button',
          {
            class: 'width-btn' + (w === D.width ? ' on' : ''),
            title: 'ضخامت ' + w,
            onclick: (e) => {
              D.width = w;
              CSR.store.patchSettings({ penWidth: w });
              widths.querySelectorAll('.width-btn').forEach((x) => x.classList.remove('on'));
              e.currentTarget.classList.add('on');
            },
          },
          h('span', { style: `height:${w}px` })
        )
      )
    );
    el.tools.append(
      h('div', { class: 'tools-title' }, 'مداد'),
      h(
        'div',
        { class: 'tool-row' },
        toolButton('pen', 'pen', 'مداد'),
        toolButton('marker', 'marker', 'ماژیک شفاف'),
        toolButton('line', 'line', 'خط صاف (افقی می‌چسبد؛ Shift = کاملاً افقی)'),
        toolButton('eraser', 'eraser', 'پاک‌کن')
      ),
      colors,
      widths,
      h(
        'div',
        { class: 'tool-row' },
        h('button', { class: 'tool-btn', icon: 'undo', title: 'برگشت (Ctrl+Z)', onclick: () => D.undo() }),
        h('button', {
          class: 'tool-btn danger',
          icon: 'trash',
          title: 'پاک کردن همه‌ی طراحی‌های این گفتگو',
          onclick: () => {
            if (confirm('همه‌ی طراحی‌های این گفتگو پاک شود؟')) D.clearAll();
          },
        }),
        h('button', { class: 'tool-btn primary', icon: 'check', title: 'تمام (Esc)', onclick: () => UI.setMode('none') })
      )
    );
  }

  const dividerOpts = { color: '', label: '' };

  function buildDividerTools() {
    const s = CSR.settings;
    const styles = h(
      'div',
      { class: 'chips' },
      CSR.DIVIDER_STYLES.map((d) =>
        h(
          'button',
          {
            class: 'chip' + (d.id === s.dividerStyle ? ' on' : ''),
            onclick: (e) => {
              CSR.store.patchSettings({ dividerStyle: d.id });
              styles.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
              e.currentTarget.classList.add('on');
            },
          },
          h('span', { class: 'dv-sample', 'data-style': d.id }),
          d.label
        )
      )
    );
    const colors = h(
      'div',
      { class: 'swatches' },
      ['', '#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#868e96'].map((c) =>
        h('button', {
          class: 'swatch' + (c === dividerOpts.color ? ' on' : '') + (c ? '' : ' auto'),
          style: c ? `--c:${c}` : '',
          title: c ? c : 'رنگ تم',
          onclick: (e) => {
            dividerOpts.color = c;
            colors.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
            e.currentTarget.classList.add('on');
          },
        })
      )
    );
    const label = h('input', {
      class: 'input',
      placeholder: 'عنوان روی خط (اختیاری)',
      value: dividerOpts.label,
      oninput: (e) => (dividerOpts.label = e.target.value),
    });
    el.tools.append(
      h('div', { class: 'tools-title' }, 'خط جداکننده'),
      styles,
      colors,
      label,
      h('div', { class: 'hint' }, 'روی نیمه‌ی بالا یا پایین یک پاراگراف کلیک کن. روی خط کلیک کنی ویرایش می‌شود.'),
      h('div', { class: 'tool-row' }, h('button', { class: 'tool-btn primary', icon: 'check', title: 'تمام (Esc)', onclick: () => UI.setMode('none') }))
    );
  }

  /** Where a divider would go for a pointer position, or null. */
  function dividerTarget(e) {
    const target = e.target;
    const msg = dom.messageOf(target);
    if (!msg || target.closest('.csr-divider, .csr-bookmark')) return null;
    const block = dom.blockFor(target, msg);
    if (!block) return null;
    const r = block.getBoundingClientRect();
    const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    return { msg, block, pos, rect: r };
  }

  function showGuide(t) {
    if (!t) {
      el.guide.hidden = true;
      return;
    }
    const y = t.pos === 'before' ? t.rect.top - 4 : t.rect.bottom + 4;
    el.guide.hidden = false;
    el.guide.style.cssText = `top:${y}px;left:${t.rect.left}px;width:${t.rect.width}px`;
  }

  // ---------------------------------------------------------------------------
  // selection toolbar

  function buildSelectionToolbar() {
    const btn = (icon, title, onclick, text, cls) =>
      h('button', { class: 'sel-btn ' + (cls || ''), title, icon, onclick }, text || null);
    const swatches = CSR.HIGHLIGHTS.map((c, i) =>
      h('button', {
        class: 'swatch',
        style: `--c:${c.swatch}`,
        title: `هایلایت ${c.label} (Alt+${i + 1})`,
        onclick: () => act(() => AN.applyStyleToSelection('hl', c.id), c.id),
      })
    );
    el.more = h(
      'div',
      { class: 'sel-more', hidden: true },
      h('div', { class: 'more-label' }, 'رنگ متن'),
      h(
        'div',
        { class: 'swatches' },
        CSR.TEXT_COLORS.map((c) =>
          h('button', { class: 'swatch text', style: `--c:${c.light}`, title: 'متن ' + c.label, onclick: () => act(() => AN.applyStyleToSelection('color', c.id)) }, 'A')
        )
      ),
      h(
        'div',
        { class: 'more-row' },
        btn(null, 'قالب کد', () => act(() => AN.applyStyleToSelection('code')), '</>'),
        btn(null, 'کادر دور متن', () => act(() => AN.applyStyleToSelection('box')), '▭'),
        btn('star', 'کادر «مهم» دور پاراگراف', () => act(() => AN.toggleBlockOnSelection('important'))),
        btn('copy', 'کپی متن', () => {
          const s = window.getSelection().toString();
          navigator.clipboard.writeText(s).then(() => UI.toast('کپی شد'));
          hideSelectionToolbar();
        }),
        btn('clear', 'حذف همه‌ی قالب‌ها از این قسمت (Alt+0)', () => act(() => AN.removeMarksInSelection()))
      )
    );
    el.sel = h(
      'div',
      { class: 'sel-toolbar', hidden: true, onmousedown: keepSelection },
      h(
        'div',
        { class: 'sel-row' },
        h('div', { class: 'swatches' }, swatches),
        h('span', { class: 'sep' }),
        btn(null, 'بولد (Alt+B)', () => act(() => AN.applyStyleToSelection('bold')), 'B', 'fmt b'),
        btn(null, 'ایتالیک (Alt+I)', () => act(() => AN.applyStyleToSelection('italic')), 'I', 'fmt i'),
        btn(null, 'زیرخط (Alt+U)', () => act(() => AN.applyStyleToSelection('underline')), 'U', 'fmt u'),
        btn(null, 'خط‌خورده (Alt+S)', () => act(() => AN.applyStyleToSelection('strike')), 'S', 'fmt s'),
        h('span', { class: 'sep' }),
        btn('quote', 'نقل‌قول / کوت (Alt+Q)', () => act(() => AN.toggleBlockOnSelection('quote'))),
        btn('note', 'یادداشت (Alt+N)', () => UI.noteOnSelection()),
        btn('book', 'معنی کلمه / ترجمه‌ی جمله و پاراگراف (Alt+Y)', () => CSR.translate.fromSelection()),
        btn('speaker', 'خواندن با صدا', () => {
          const s = AN.selectionInMessage();
          hideSelectionToolbar();
          if (s) CSR.tts.speakRange(s.range);
        }),
        btn('more', 'بیشتر', () => {
          el.more.hidden = !el.more.hidden;
        })
      ),
      el.more
    );
    el.layer.append(el.sel);
  }

  function act(fn, hlColor) {
    const r = fn();
    if (hlColor) CSR.store.patchSettings({ activeHighlight: hlColor });
    hideSelectionToolbar();
    return r;
  }
  UI.act = act;

  UI.noteOnSelection = function () {
    const s = AN.selectionInMessage();
    if (!s) return;
    const rect = s.range.getBoundingClientRect();
    const hits = AN.marksInRange(s.range);
    const exact = hits.find((a) => a.anchor.exact.trim() === s.range.toString().trim());
    hideSelectionToolbar();
    const a = exact || AN.createMark({}, '');
    if (!a) return;
    window.getSelection().removeAllRanges();
    openMarkPopover(a, rect, true);
  };

  /** Claude's own buttons that float next to a selection (its «Reply»). */
  function claudeFloaters() {
    const out = [];
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      if (b.closest('[data-csr-ui]')) continue;
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
      if (!/^(reply|quote|ask claude|پاسخ)/i.test(label)) continue;
      const r = b.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < window.innerHeight) out.push(r);
    }
    return out;
  }

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  /** Under the selection (Claude shows «Reply» above it), moved out of the way
   * of any of Claude's floating buttons. */
  function positionToolbar(range) {
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const tb = el.sel.getBoundingClientRect();
    const fits = (t) => t >= 8 && t + tb.height <= window.innerHeight - 8;
    let top = r.bottom + 12;
    if (!fits(top)) top = r.top - tb.height - 12;
    let left = r.left + r.width / 2 - tb.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tb.width - 8));
    for (const f of claudeFloaters()) {
      const box = { left, right: left + tb.width, top, bottom: top + tb.height };
      if (!overlaps(box, { left: f.left - 6, right: f.right + 6, top: f.top - 6, bottom: f.bottom + 6 })) continue;
      const below = Math.max(r.bottom, f.bottom) + 10;
      top = fits(below) ? below : Math.min(r.top, f.top) - tb.height - 10;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - tb.height - 8));
    el.sel.style.top = top + 'px';
    el.sel.style.left = left + 'px';
  }

  function showSelectionToolbar(range, keepMore) {
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (!keepMore) el.more.hidden = true;
    el.sel.hidden = false;
    positionToolbar(range);
    if (!keepMore) {
      // Claude's «Reply» can appear a moment later: check again
      for (const ms of [120, 400]) {
        setTimeout(() => {
          if (!el.sel.hidden) positionToolbar(range);
        }, ms);
      }
    }
  }

  function hideSelectionToolbar() {
    if (el.sel) el.sel.hidden = true;
  }
  UI.hideSelectionToolbar = hideSelectionToolbar;

  // ---------------------------------------------------------------------------
  // popovers

  let popoverFor = null;

  function placePopover(rect) {
    const p = el.popover;
    p.hidden = false;
    const pr = p.getBoundingClientRect();
    let top = rect.bottom + 8;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, rect.top - pr.height - 8);
    let left = rect.left + rect.width / 2 - pr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    p.style.top = top + 'px';
    p.style.left = left + 'px';
  }

  function closePopover() {
    if (!el.popover || el.popover.hidden) return;
    if (el.popover.contains(shadow.activeElement)) shadow.activeElement.blur();
    el.popover.hidden = true;
    const id = popoverFor;
    popoverFor = null;
    const a = id && AN.get(id);
    if (a && a.kind === 'mark' && AN.isEmptyMark(a)) AN.remove(a.id);
  }
  UI.closePopover = closePopover;

  function openMarkPopover(a, rect, focusNote) {
    popoverFor = a.id;
    const p = el.popover;
    p.textContent = '';
    const st = () => AN.get(a.id)?.style || {};
    const refresh = () => {
      const cur = st();
      p.querySelectorAll('[data-hl]').forEach((b) => b.classList.toggle('on', cur.hl === b.dataset.hl || (!cur.hl && b.dataset.hl === '')));
      p.querySelectorAll('[data-fmt]').forEach((b) => b.classList.toggle('on', !!cur[b.dataset.fmt]));
      p.querySelectorAll('[data-tc]').forEach((b) => b.classList.toggle('on', cur.color === b.dataset.tc));
    };
    const swatches = h(
      'div',
      { class: 'swatches' },
      CSR.HIGHLIGHTS.map((c) =>
        h('button', { class: 'swatch', style: `--c:${c.swatch}`, title: c.label, 'data-hl': c.id, onclick: () => (AN.updateStyle(a.id, { hl: c.id }), refresh()) })
      ),
      h('button', { class: 'swatch none', title: 'بدون هایلایت', 'data-hl': '', onclick: () => (AN.updateStyle(a.id, { hl: null }), refresh()) })
    );
    const fmt = (key, label, cls) =>
      h('button', { class: 'sel-btn fmt ' + cls, 'data-fmt': key, onclick: () => (AN.updateStyle(a.id, { [key]: !st()[key] }), refresh()) }, label);
    const tcs = CSR.TEXT_COLORS.map((c) =>
      h('button', {
        class: 'swatch text',
        style: `--c:${c.light}`,
        title: 'متن ' + c.label,
        'data-tc': c.id,
        onclick: () => (AN.updateStyle(a.id, { color: st().color === c.id ? null : c.id }), refresh()),
      }, 'A')
    );
    const note = h('textarea', {
      class: 'note-input',
      dir: 'auto',
      rows: '3',
      placeholder: 'یادداشت خودت را اینجا بنویس…',
      oninput: (e) => AN.setNote(a.id, e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Escape') closePopover();
        e.stopPropagation();
      },
    });
    note.value = a.note || '';
    const tagBox = h('div', { class: 'tags' });
    const renderTags = () => {
      tagBox.textContent = '';
      const cur = AN.get(a.id)?.tags || [];
      for (const t of cur) {
        tagBox.append(
          h('span', { class: 'tag' }, '#' + t, h('button', { class: 'tag-x', title: 'حذف برچسب', onclick: () => (AN.setTags(a.id, cur.filter((x) => x !== t)), renderTags()) }, '×'))
        );
      }
      const input = h('input', {
        class: 'tag-input',
        dir: 'auto',
        placeholder: cur.length ? '+' : '+ برچسب (مثلاً امتحان)',
        onkeydown: (e) => {
          e.stopPropagation();
          if ((e.key === 'Enter' || e.key === ',' || e.key === '،') && e.target.value.trim()) {
            e.preventDefault();
            AN.setTags(a.id, [...cur, e.target.value.replace(/^#/, '')]);
            renderTags();
            tagBox.querySelector('.tag-input').focus();
          }
        },
      });
      const suggestions = [...new Set([...AN.allTags(), ...CSR.DEFAULT_TAGS])].filter((t) => !cur.includes(t)).slice(0, 6);
      tagBox.append(input);
      if (suggestions.length) {
        tagBox.append(
          h(
            'div',
            { class: 'tag-suggest' },
            suggestions.map((t) => h('button', { class: 'chip small', onclick: () => (AN.setTags(a.id, [...cur, t]), renderTags()) }, '#' + t))
          )
        );
      }
    };
    renderTags();
    p.append(
      h('div', { class: 'pop-row' }, swatches),
      h('div', { class: 'pop-row' }, fmt('bold', 'B', 'b'), fmt('italic', 'I', 'i'), fmt('underline', 'U', 'u'), fmt('strike', 'S', 's'), h('span', { class: 'sep' }), tcs),
      note,
      tagBox,
      h(
        'div',
        { class: 'pop-row end' },
        h('button', {
          class: 'sel-btn',
          icon: 'copy',
          title: 'کپی متن',
          onclick: () => navigator.clipboard.writeText(a.anchor.exact).then(() => UI.toast('کپی شد')),
        }),
        h('button', {
          class: 'sel-btn danger',
          icon: 'trash',
          title: 'حذف',
          onclick: () => {
            AN.remove(a.id);
            popoverFor = null;
            el.popover.hidden = true;
          },
        }),
        h('button', { class: 'sel-btn primary', icon: 'check', title: 'بستن', onclick: closePopover })
      )
    );
    refresh();
    placePopover(rect);
    if (focusNote) setTimeout(() => note.focus(), 0);
  }
  UI.openMarkPopover = openMarkPopover;

  function openDividerPopover(a, rect) {
    popoverFor = a.id;
    const p = el.popover;
    p.textContent = '';
    const styles = h(
      'div',
      { class: 'chips' },
      CSR.DIVIDER_STYLES.map((d) =>
        h(
          'button',
          {
            class: 'chip' + (a.style === d.id ? ' on' : ''),
            onclick: (e) => {
              AN.update(a.id, { style: d.id });
              styles.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
              e.currentTarget.classList.add('on');
            },
          },
          h('span', { class: 'dv-sample', 'data-style': d.id }),
          d.label
        )
      )
    );
    const colors = h(
      'div',
      { class: 'swatches' },
      ['', '#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#868e96'].map((c) =>
        h('button', {
          class: 'swatch' + ((a.color || '') === c ? ' on' : '') + (c ? '' : ' auto'),
          style: c ? `--c:${c}` : '',
          onclick: (e) => {
            AN.update(a.id, { color: c });
            colors.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
            e.currentTarget.classList.add('on');
          },
        })
      )
    );
    const label = h('input', {
      class: 'input',
      dir: 'auto',
      placeholder: 'عنوان روی خط (اختیاری)',
      oninput: (e) => AN.update(a.id, { label: e.target.value }),
      onkeydown: (e) => e.stopPropagation(),
    });
    label.value = a.label || '';
    p.append(
      styles,
      colors,
      label,
      h(
        'div',
        { class: 'pop-row end' },
        h('button', {
          class: 'sel-btn danger',
          icon: 'trash',
          title: 'حذف خط',
          onclick: () => {
            AN.remove(a.id);
            closePopover();
          },
        }),
        h('button', { class: 'sel-btn primary', icon: 'check', title: 'بستن', onclick: closePopover })
      )
    );
    placePopover(rect);
  }

  // ---------------------------------------------------------------------------
  // notes panel

  let panelTab = 'list';
  let panelFilter = 'all';

  UI.togglePanel = function (open) {
    UI.panelOpen = open === undefined ? !UI.panelOpen : open;
    el.dockBtn.notes.classList.toggle('on', UI.panelOpen);
    host.toggleAttribute('data-panel', UI.panelOpen);
    if (!UI.panelOpen) {
      if (el.panel) el.panel.remove();
      el.panel = null;
      return;
    }
    renderPanel(true);
    el.panel.classList.add('enter');
  };

  UI.refreshPanel = function () {
    if (UI.panelOpen) renderPanel();
  };

  let panelSig = '';
  let panelConv = null; // the conversation object the panel was built from

  function renderPanel(force) {
    const conv = AN.conv();
    const keepScroll = el.panel ? el.panel.querySelector('.panel-body')?.scrollTop : 0;
    const focused = el.panel && el.panel.contains(shadow.activeElement) && shadow.activeElement.tagName === 'TEXTAREA';
    if (focused) return; // don't disturb typing in the notebook
    // nothing the panel shows has changed: keep it (a re-render could eat a click)
    const sig = [conv ? conv.id : '', panelTab, panelFilter]
      .concat(conv ? conv.annotations.map((a) => `${a.id}:${a.updated || 0}:${AN.isOrphan(a) ? 1 : 0}`) : [])
      .join('|');
    // (a conversation reloaded from storage may differ in what the sig leaves out, e.g. the notebook)
    if (!force && el.panel && sig === panelSig && conv === panelConv) return;
    panelSig = sig;
    panelConv = conv;
    if (el.panel) el.panel.remove();
    const tabs = h(
      'div',
      { class: 'tabs' },
      [
        ['list', 'هایلایت‌ها و یادداشت‌ها'],
        ['book', 'دفترچه'],
      ].map(([id, label]) =>
        h('button', { class: 'tab' + (panelTab === id ? ' on' : ''), onclick: () => ((panelTab = id), renderPanel()) }, label)
      )
    );
    const body = h('div', { class: 'panel-body' });
    if (!conv) {
      body.append(h('div', { class: 'empty' }, 'اول یک گفتگو را باز کن.'));
    } else if (panelTab === 'list') {
      const filters = h(
        'div',
        { class: 'chips' },
        [['all', 'همه'], ['notes', 'یادداشت‌دار'], ...CSR.HIGHLIGHTS.map((c) => [c.id, c.label])].map(([id, label]) =>
          h(
            'button',
            { class: 'chip' + (panelFilter === id ? ' on' : ''), onclick: () => ((panelFilter = id), renderPanel()) },
            CSR.HIGHLIGHTS.find((c) => c.id === id) ? h('span', { class: 'dot', style: `--c:${swatch(id)}` }) : null,
            label
          )
        )
      );
      body.append(filters);
      const tags = AN.allTags();
      if (tags.length) {
        body.append(
          h(
            'div',
            { class: 'chips' },
            tags.map((t) =>
              h('button', { class: 'chip tagchip' + (panelFilter === '#' + t ? ' on' : ''), onclick: () => ((panelFilter = panelFilter === '#' + t ? 'all' : '#' + t), renderPanel()) }, '#' + t)
            )
          )
        );
      }
      const list = AN.sorted().filter((a) => {
        if (panelFilter === 'all') return true;
        if (panelFilter === 'notes') return !!(a.note && a.note.trim());
        if (panelFilter.startsWith('#')) return (a.tags || []).includes(panelFilter.slice(1));
        return a.kind === 'mark' && a.style && a.style.hl === panelFilter;
      });
      if (!list.length) {
        body.append(
          h(
            'div',
            { class: 'empty' },
            'هنوز چیزی نیست. متنی را در پاسخ Claude انتخاب کن و از نوار ابزار، رنگ یا یادداشت بزن.'
          )
        );
      }
      for (const a of list) body.append(renderItem(a));
    } else {
      const ta = h('textarea', {
        class: 'notebook',
        dir: 'auto',
        placeholder: 'یادداشت‌های آزاد برای این گفتگو… (خلاصه، سؤال‌ها، نکته‌ها)',
        oninput: (e) => {
          conv.notebook = e.target.value;
          AN.save();
        },
        onkeydown: (e) => e.stopPropagation(),
      });
      ta.value = conv.notebook || '';
      body.append(ta);
    }
    const count = conv ? conv.annotations.length : 0;
    el.panel = h(
      'aside',
      { class: 'panel' },
      h(
        'header',
        { class: 'panel-head' },
        h('div', { class: 'panel-title' }, 'یادداشت‌های این گفتگو', h('span', { class: 'badge' }, count.toLocaleString('fa-IR'))),
        h('button', { class: 'tool-btn', icon: 'close', title: 'بستن', onclick: () => UI.togglePanel(false) })
      ),
      tabs,
      body,
      h(
        'footer',
        { class: 'panel-foot' },
        h('button', { class: 'btn', icon: 'download', title: 'دانلود Markdown', onclick: exportMd }),
        h('button', { class: 'btn', icon: 'copy', title: 'کپی همه به صورت Markdown', onclick: copyMd }),
        h('button', {
          class: 'btn danger',
          icon: 'trash',
          title: 'پاک کردن همه‌ی هایلایت‌ها، یادداشت‌ها و طراحی‌های این گفتگو',
          onclick: () => {
            if (confirm('همه‌ی هایلایت‌ها، یادداشت‌ها، خط‌ها و طراحی‌های این گفتگو پاک شود؟')) AN.clearAll();
          },
        }),
        h('span', { class: 'foot-hint' }, 'کتابخانه‌ی همه‌ی گفتگوها: از منوی افزونه')
      )
    );
    el.layer.append(el.panel);
    const nb = el.panel.querySelector('.panel-body');
    if (nb && keepScroll) nb.scrollTop = keepScroll;
  }

  function renderItem(a) {
    const d = CSR.describeAnnotation(a);
    const orphan = AN.isOrphan(a);
    const color = a.kind === 'mark' && a.style && a.style.hl ? swatch(a.style.hl) : 'transparent';
    return h(
      'div',
      { class: 'item' + (orphan ? ' orphan' : ''), style: `--c:${color}` },
      h(
        'div',
        {
          class: 'item-main',
          role: 'button',
          tabindex: '0',
          onkeydown: (e) => e.key === 'Enter' && e.currentTarget.click(),
          title: orphan ? 'این قسمت در صفحه پیدا نشد (شاید پیام ویرایش یا دوباره تولید شده)' : 'رفتن به این قسمت',
          onclick: () => {
            AN.reveal(a.id).then((ok) => ok || UI.toast('این قسمت الان در صفحه پیدا نشد'));
          },
        },
        h('span', { class: 'item-icon' }, d.icon),
        h('span', { class: 'item-text', dir: 'auto' }, d.text.length > 220 ? d.text.slice(0, 220) + '…' : d.text),
        d.tags.length ? h('span', { class: 'item-tags' }, d.tags.join('، ')) : null,
        a.note && a.note.trim() ? h('span', { class: 'item-note', dir: 'auto' }, a.note) : null,
        orphan ? h('span', { class: 'item-tags warn' }, 'در صفحه پیدا نشد') : null
      ),
      h('button', { class: 'item-del', icon: 'trash', title: 'حذف', onclick: () => AN.remove(a.id) })
    );
  }

  function convMarkdown() {
    const conv = AN.conv();
    if (!conv) return '';
    conv.title = conv.title || (document.title || '').replace(/\s*[-–|]\s*Claude\s*$/i, '');
    conv.url = conv.url || location.href;
    return CSR.exportMarkdown(conv);
  }

  function exportMd() {
    const conv = AN.conv();
    if (!conv) return;
    CSR.downloadText(CSR.safeFilename(conv.title || 'claude-notes') + '.md', convMarkdown());
  }

  function copyMd() {
    navigator.clipboard.writeText(convMarkdown()).then(() => UI.toast('همه‌ی یادداشت‌ها کپی شد'));
  }

  // ---------------------------------------------------------------------------
  // page events

  function fromUs(e) {
    return e.composedPath().includes(host);
  }

  function onSelectionDone(e) {
    if (fromUs(e) || UI.mode !== 'none') return;
    setTimeout(() => {
      if (Date.now() < (UI.suppressToolbarUntil || 0)) return;
      const s = AN.selectionInMessage();
      if (!s || !CSR.settings.enabled) return hideSelectionToolbar();
      if (dom.isStreaming(s.msg)) return;
      if (CSR.settings.highlighterMode) {
        AN.applyStyleToSelection('hl', CSR.settings.activeHighlight || 'yellow');
        return;
      }
      if (CSR.settings.selectionToolbar) showSelectionToolbar(s.range);
    }, 10);
  }

  /** Opens the editor of a divider/bookmark under `t`; true if there was one. */
  function openExisting(t) {
    const dv = t.closest && t.closest('.csr-divider');
    if (dv) {
      const a = AN.get(dv.getAttribute('data-csr-divider-id'));
      if (a) openDividerPopover(a, dv.getBoundingClientRect());
      return true;
    }
    const bm = t.closest && t.closest('.csr-bookmark');
    if (bm) {
      const a = AN.get(bm.getAttribute('data-csr-bookmark-id'));
      if (a) openBookmarkPopover(a, bm.getBoundingClientRect());
      return true;
    }
    return false;
  }

  function bindPageEvents() {
    document.addEventListener('mouseup', onSelectionDone);
    document.addEventListener('keyup', (e) => {
      if (e.shiftKey && e.key.startsWith('Arrow')) onSelectionDone(e);
    });
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) hideSelectionToolbar();
    });
    document.addEventListener(
      'mousedown',
      (e) => {
        if (fromUs(e)) return;
        closePopover();
      },
      true
    );
    // Claude scrolls by itself too (auto-scroll, virtual-list corrections):
    // keep the toolbar next to the selection instead of closing it
    // (once per frame: scroll events come far more often than that)
    let follow = 0;
    const followSelection = () => {
      follow = 0;
      if (!el.sel || el.sel.hidden) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSelectionToolbar();
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return hideSelectionToolbar();
      showSelectionToolbar(sel.getRangeAt(0), true);
    };
    document.addEventListener(
      'scroll',
      () => {
        if (!follow && el.sel && !el.sel.hidden) follow = requestAnimationFrame(followSelection);
      },
      true
    );

    // clicks on our marks / dividers, and divider placement
    document.addEventListener(
      'click',
      (e) => {
        if (fromUs(e) || !CSR.settings.enabled) return;
        const t = e.target;
        const existing = openExisting(t);
        if (UI.mode === 'divider' || UI.mode === 'bookmark') {
          e.preventDefault();
          e.stopPropagation();
          if (existing) return;
          const target = dividerTarget(e);
          if (!target) return;
          if (dom.isStreaming(target.msg)) return UI.toast('صبر کن پاسخ کامل شود');
          if (UI.mode === 'divider') {
            AN.addDivider(target.msg, target.block, target.pos, {
              style: CSR.settings.dividerStyle,
              color: dividerOpts.color,
              label: dividerOpts.label,
            });
            dividerOpts.label = '';
          } else {
            AN.addBookmark(target.msg, target.block, target.pos, { pattern: CSR.settings.bookmarkPattern, label: bookmarkOpts.label });
            bookmarkOpts.label = '';
            UI.toast('نشانک گذاشته شد 🔖');
          }
          const inp = el.tools.querySelector('input');
          if (inp) inp.value = '';
          return;
        }
        if (UI.mode !== 'none') return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        if (existing) return;
        const m = t.closest && t.closest('.csr-m[data-csr-id]');
        if (m && !t.closest('a')) {
          const a = AN.get(m.getAttribute('data-csr-id'));
          if (a) openMarkPopover(a, m.getBoundingClientRect(), false);
        }
      },
      true
    );

    document.addEventListener('mousemove', (e) => {
      if (UI.mode !== 'divider' && UI.mode !== 'bookmark') return;
      showGuide(fromUs(e) ? null : dividerTarget(e));
    });
  }
})();
