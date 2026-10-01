/* Focus mode: hides the page chrome around the conversation — sidebar,
 * header, the message box and the buttons under messages. Only elements that
 * don't contain any message are hidden (via an attribute + CSS; nothing is
 * removed), the reading position is kept, and if the conversation would not
 * be visible afterwards the mode undoes itself. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const F = (CSR.focus = { on: false });

  const CHROME =
    'nav, aside, header, footer, [role="navigation"], [role="banner"], [role="complementary"], [data-testid*="sidebar" i], [role="group"][aria-label="Message actions"], [data-testid^="action-bar"]';

  function clear() {
    document.querySelectorAll('[data-csr-focus-hide]').forEach((e) => e.removeAttribute('data-csr-focus-hide'));
  }

  function containsMessage(el, msgs) {
    return msgs.some((m) => el === m || el.contains(m) || m.contains(el));
  }

  /** The block holding the message box: climb from the editor while the
   * parent still doesn't contain any message. */
  function composerBlock(msgs) {
    const editors = Array.from(document.querySelectorAll(CSR.SEL.editor)).filter((e) => !e.closest('[data-csr-ui]') && !dom.messageOf(e));
    const out = [];
    for (const ed of editors) {
      let e = ed;
      while (e.parentElement && e.parentElement !== document.body && !containsMessage(e.parentElement, msgs)) e = e.parentElement;
      if (!containsMessage(e, msgs)) out.push(e);
    }
    return out;
  }

  function targets(msgs) {
    const list = new Set();
    for (const el of document.querySelectorAll(CHROME)) {
      if (el.closest('[data-csr-ui]') || containsMessage(el, msgs)) continue;
      list.add(el);
    }
    for (const el of composerBlock(msgs)) list.add(el);
    if (CSR.settings.focusHideUser) {
      for (const m of msgs) if (dom.roleOf(m) === 'user') list.add(m);
    }
    return list;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** The block at the middle of the screen, to keep it in place. */
  function anchor(msgs) {
    const y = window.innerHeight / 2;
    for (const m of msgs) {
      const r = m.getBoundingClientRect();
      if (r.top <= y && r.bottom >= y) {
        for (const b of m.querySelectorAll('p, li, h1, h2, h3, pre, blockquote')) {
          const br = b.getBoundingClientRect();
          if (br.bottom >= y) return { el: b, top: br.top };
        }
        return { el: m, top: r.top };
      }
    }
    return null;
  }

  function apply(keepPosition) {
    const html = document.documentElement;
    const msgs = dom.getMessages();
    const a = keepPosition ? anchor(msgs) : null;
    clear();
    if (!F.on) {
      html.removeAttribute('data-csr-focus');
      if (a) restore(a);
      return true;
    }
    for (const el of targets(msgs)) el.setAttribute('data-csr-focus-hide', '');
    html.setAttribute('data-csr-focus', '');
    // safety net: the conversation must still be on screen
    const shown = msgs.filter((m) => !m.hasAttribute('data-csr-focus-hide'));
    if (shown.length && !shown.some(visible)) {
      clear();
      html.removeAttribute('data-csr-focus');
      return false;
    }
    if (a) restore(a);
    return true;
  }

  function restore(a) {
    if (!a.el.isConnected) return;
    const now = a.el.getBoundingClientRect().top;
    const sc = dom.scrollParent(a.el);
    sc.scrollBy({ top: now - a.top });
  }

  F.toggle = function (on) {
    const next = on === undefined ? !F.on : !!on;
    if (next && !dom.getMessages().length) {
      CSR.ui.toast('اول یک گفتگو باز کن');
      return;
    }
    F.on = next;
    const ok = apply(true);
    if (!ok) {
      F.on = false;
      CSR.ui.setDockState('focus', false);
      CSR.ui.toast('حالت تمرکز روی این صفحه جواب نداد؛ از منوی افزونه «گزارش عیب‌یابی» را برایم بفرست', 5000);
      return;
    }
    CSR.ui.setDockState('focus', F.on);
    CSR.ui.toast(F.on ? 'حالت تمرکز — برای خروج Esc یا Alt+Z' : 'حالت تمرکز خاموش شد');
    // the whole browser window goes fullscreen too (like F11); turning focus
    // off only undoes a fullscreen that focus mode started
    if (!F.on || CSR.settings.focusFullscreen) {
      chrome.runtime.sendMessage({ csr: 'fullscreen', on: F.on }).catch(() => {});
    }
  };

  /** After the page changed: re-apply to newly rendered chrome. */
  F.refresh = function (changed) {
    if (!F.on || !changed) return;
    apply(false);
  };
})();
