/* Reading ruler: a clear reading window that follows the mouse, framed by
 * two bands of Iranian patterns, with the rest of the page softly dimmed. */
(function () {
  const CSR = globalThis.CSR;
  const R = (CSR.ruler = { on: false });
  const EDGE = 10;
  let box = null;
  let parts = null;
  let y = window.innerHeight / 2;
  let lineH = 28;
  let raf = 0;

  function measureLine() {
    const p = document.querySelector('[data-csr-msg] p');
    const lh = p ? parseFloat(getComputedStyle(p).lineHeight) : NaN;
    lineH = Number.isFinite(lh) && lh > 10 ? lh : 28;
  }

  function build() {
    const h = CSR.ui.h;
    const s = CSR.settings;
    if (box) box.remove();
    parts = {
      top: h('div', { class: 'ruler-mask' }),
      edgeTop: h('div', { class: 'ruler-edge' }),
      edgeBottom: h('div', { class: 'ruler-edge' }),
      bottom: h('div', { class: 'ruler-mask' }),
    };
    parts.edgeTop.innerHTML = CSR.patternFill(s.rulerPattern, EDGE); // generated SVG
    parts.edgeBottom.innerHTML = CSR.patternFill(s.rulerPattern, EDGE);
    box = h('div', { class: 'ruler', 'aria-hidden': 'true' }, parts.top, parts.edgeTop, parts.edgeBottom, parts.bottom);
    box.style.setProperty('--dim', String(s.rulerDim));
    CSR.ui.layer().append(box);
    measureLine();
    place();
  }

  function place() {
    raf = 0;
    if (!box) return;
    const win = Math.max(1, CSR.settings.rulerLines) * lineH + 8;
    const t = Math.round(y - win / 2);
    const b = t + win;
    parts.top.style.cssText = `top:0;height:${Math.max(0, t - EDGE)}px`;
    parts.edgeTop.style.cssText = `top:${t - EDGE}px;height:${EDGE}px`;
    parts.edgeBottom.style.cssText = `top:${b}px;height:${EDGE}px`;
    parts.bottom.style.cssText = `top:${b + EDGE}px;bottom:0`;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(place);
  }

  function onMove(e) {
    y = e.clientY;
    schedule();
  }

  function onKey(e) {
    if (!R.on || !e.altKey || (e.code !== 'ArrowDown' && e.code !== 'ArrowUp')) return;
    e.preventDefault();
    y += e.code === 'ArrowDown' ? lineH : -lineH;
    schedule();
  }

  /** Lets other features (text to speech) move the ruler to a line. */
  R.moveTo = function (clientY) {
    if (!R.on) return;
    y = clientY;
    schedule();
  };

  R.toggle = function (on) {
    R.on = on === undefined ? !R.on : !!on;
    CSR.ui.setDockState('ruler', R.on);
    if (R.on) {
      build();
      document.addEventListener('mousemove', onMove, { passive: true });
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', measureLine);
      CSR.ui.toast('خط‌کش خواندن روشن شد — Alt+↓ / Alt+↑ یک خط جابه‌جا می‌کند');
    } else {
      if (box) box.remove();
      box = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', measureLine);
    }
  };

  R.applySettings = function () {
    if (R.on) build();
  };
})();
