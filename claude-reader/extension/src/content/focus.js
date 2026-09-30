/* Focus mode: hides everything on the page except the conversation itself
 * (sidebar, header, composer, action buttons…). Nothing is removed from the
 * DOM — elements only get an attribute that CSS turns into display:none. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const F = (CSR.focus = { on: false });
  let lastCount = -1;

  function clear() {
    document.querySelectorAll('[data-csr-focus-hide]').forEach((e) => e.removeAttribute('data-csr-focus-hide'));
  }

  function apply() {
    const html = document.documentElement;
    if (!F.on) {
      html.removeAttribute('data-csr-focus');
      clear();
      lastCount = -1;
      return;
    }
    const msgs = dom.getMessages();
    lastCount = msgs.length;
    const shown = msgs.filter((m) => !(CSR.settings.focusHideUser && dom.roleOf(m) === 'user'));
    // every ancestor of a visible message stays; their other children are hidden
    const keep = new Set();
    for (const m of shown) {
      for (let e = m; e && e !== html; e = e.parentElement) keep.add(e);
    }
    const msgSet = new Set(msgs);
    clear();
    for (const a of keep) {
      if (msgSet.has(a)) continue; // never touch the inside of a message
      for (const c of a.children) {
        if (keep.has(c) || c.matches('[data-csr-ui], script, style, link, template')) continue;
        c.setAttribute('data-csr-focus-hide', '');
      }
    }
    html.setAttribute('data-csr-focus', '');
  }

  F.toggle = function (on) {
    const next = on === undefined ? !F.on : !!on;
    if (next && !dom.getMessages().length) {
      CSR.ui.toast('اول یک گفتگو باز کن');
      return;
    }
    F.on = next;
    apply();
    CSR.ui.setDockState('focus', F.on);
    CSR.ui.toast(F.on ? 'حالت تمرکز — برای خروج Esc یا Alt+Z' : 'حالت تمرکز خاموش شد');
  };

  /** Called after each sync; re-applies when messages were added or re-rendered. */
  F.refresh = function (force) {
    if (!F.on) return;
    if (force || dom.getMessages().length !== lastCount) apply();
  };
})();
