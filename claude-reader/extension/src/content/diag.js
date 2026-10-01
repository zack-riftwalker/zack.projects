/* Diagnostic report: describes the page's structure (tags, class names,
 * a few attributes, colors) around the conversation so problems on pages the
 * developer can't see can be fixed. It never includes message text. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;

  const SHOW_VALUE = /^(data-testid|role|aria-label|data-mode|data-theme|data-color-version|data-is-streaming|data-message-author-role|dir|contenteditable|lang)$/;
  const cut = (s, n = 50) => String(s || '').slice(0, n);

  function desc(el) {
    if (!el || el.nodeType !== 1) return null;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 10).map((c) => cut(c, 40)) : [];
    const attrs = Array.from(el.attributes)
      .filter((a) => a.name !== 'class' && a.name !== 'style' && !a.name.startsWith('data-csr'))
      .slice(0, 10)
      .map((a) => a.name + (SHOW_VALUE.test(a.name) ? '=' + cut(a.value) : ''));
    const cs = getComputedStyle(el);
    return [
      el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''),
      attrs.length ? '[' + attrs.join(' ') + ']' : '',
      `bg:${cs.backgroundColor}`,
      cs.position !== 'static' ? `pos:${cs.position}` : '',
      cs.display !== 'block' ? `display:${cs.display}` : '',
      /auto|scroll/.test(cs.overflowY) ? `scroll:${cs.overflowY}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function chain(el, n = 22) {
    const out = [];
    for (let e = el; e && out.length < n; e = e.parentElement) out.push(desc(e));
    return out;
  }

  CSR.diag = function () {
    const msgs = dom.getMessages();
    const first = msgs.find((m) => dom.roleOf(m) === 'assistant') || msgs[0];
    const user = msgs.find((m) => dom.roleOf(m) === 'user');
    // containers holding the most paragraphs: where the text probably is
    const holders = new Map();
    for (const p of document.querySelectorAll('p, li')) {
      if (p.closest('[data-csr-ui]')) continue;
      const par = p.parentElement;
      holders.set(par, (holders.get(par) || 0) + 1);
    }
    const top = [...holders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const editor = Array.from(document.querySelectorAll(CSR.SEL.editor)).find((e) => !e.closest('[data-csr-ui]'));
    const q = (sel) => document.querySelectorAll(sel).length;
    const report = {
      extension: chrome.runtime.getManifest().version,
      path: location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<uuid>').replace(/session_[\w-]+/g, 'session_<id>'),
      conversation: !!dom.getConversationId(),
      mode: dom.mode,
      counts: {
        messages: msgs.length,
        assistantKnown: q(CSR.SEL.assistant),
        userKnown: q(CSR.SEL.user),
        genericCandidates: q(CSR.SEL.generic),
        streaming: q(CSR.SEL.streaming),
        nav: q('nav'),
        aside: q('aside'),
        header: q('header'),
      },
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      html: desc(document.documentElement),
      body: desc(document.body),
      settings: { theme: CSR.settings.theme, rtl: CSR.settings.rtlMode, font: CSR.settings.persianFont + '/' + CSR.settings.latinFont },
      theme: CSR.themeFix.report(),
      painted: q('[data-csr-paint]'),
      focusHidden: q('[data-csr-focus-hide]'),
      column: { width: CSR.settings.contentWidth, marked: [...document.querySelectorAll('[data-csr-column]')].slice(0, 12).map((e) => e.tagName.toLowerCase() + ':' + e.getAttribute('data-csr-column')) },
      assistantChain: chain(first),
      userChain: chain(user, 6),
      paragraphHolders: top.map(([el, n]) => ({ paragraphs: n, chain: chain(el, 8) })),
      editorChain: chain(editor, 8),
    };
    return JSON.stringify(report, null, 1);
  };
})();
