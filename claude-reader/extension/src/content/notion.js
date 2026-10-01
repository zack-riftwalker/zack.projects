/* Notion AI chat (notion.so / notion.com). Notion's markup has no stable names
 * for its chat, so the chat is found by how it is built:
 *   - the AI chat box: an editable field outside the page body whose
 *     placeholder/label talks about AI or asking;
 *   - the conversation: the scrolling list next to (or around) that box;
 *   - in that list your own messages are the bubbles on the end side, and
 *     everything else is the answer.
 * Notion pages themselves (their editable text) are never treated as
 * messages, so nothing is ever written into them. */
(function () {
  const CSR = globalThis.CSR;
  if (CSR.site.id !== 'notion') return;
  const dom = CSR.dom;
  const N = (CSR.notion = { chat: null, firstUser: '' });

  const HINT = /\bAI\b|\bask\b|anything|\bchat\b|message|prompt|بپرس|سؤال|سوال|پیام/i;
  const PAGE = '.notion-page-content';
  const INPUTS = '[contenteditable="true"], textarea, [role="textbox"]';
  const EDITABLE = '[contenteditable="true"], [contenteditable=""]';

  const shown = (el) => el.getClientRects().length > 0;
  const textLen = (el) => (el.textContent || '').trim().length;
  const scrolls = (el) => {
    const o = getComputedStyle(el).overflowY;
    return o === 'auto' || o === 'scroll';
  };
  const ours = (el) => !!el.closest('[data-csr-ui]');

  function hintOf(el) {
    return ['placeholder', 'aria-placeholder', 'aria-label', 'data-placeholder', 'title'].map((a) => el.getAttribute(a) || '').join(' ');
  }

  /** The AI chat box. */
  function findInput() {
    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll(INPUTS)) {
      if (ours(el) || el.closest(PAGE) || !shown(el)) continue;
      let score = 0;
      if (HINT.test(hintOf(el))) score += 2;
      // a placeholder drawn by another element instead of an attribute
      const box = el.parentElement;
      if (box && textLen(box) < 80 && HINT.test(box.textContent)) score += 1;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  /** `el` or an element a few levels inside it that scrolls and holds text. */
  function scrollerIn(el, depth) {
    const queue = [[el, 0]];
    for (let seen = 0; queue.length && seen < 400; seen++) {
      const [e, d] = queue.shift();
      if (ours(e)) continue;
      if (scrolls(e) && textLen(e) > 0 && shown(e)) return e;
      if (d < depth) for (const c of e.children) queue.push([c, d + 1]);
    }
    return null;
  }

  const isPage = (el) => !!(el.closest(PAGE) || el.querySelector(PAGE));

  /** The block around the chat box that adds no text of its own (inside `top`). */
  function composerOf(input, top) {
    let e = input;
    while (e.parentElement && e.parentElement !== top && textLen(e.parentElement) === textLen(e)) e = e.parentElement;
    return e;
  }

  /** A conversation sits above its chat box and over the same columns. */
  function above(list, input) {
    const l = list.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    return i.top >= l.top + 20 && i.top >= l.bottom - 80 && i.left < l.right && i.right > l.left;
  }

  /** {root, list, composer, input}: the chat panel, its scrolling message
   * list and the block holding the chat box. */
  function findChat(input) {
    let prev = input;
    for (let a = input.parentElement, i = 0; a && a !== document.body && i < 14; prev = a, a = a.parentElement, i++) {
      if (isPage(a)) return null; // reached Notion's page: this box isn't a chat's
      // full-page chat: one scroller holds the messages and the (sticky) box
      if (scrolls(a) && shown(a)) {
        const composer = composerOf(input, a);
        if (textLen(a) - textLen(composer) > 0) return { root: a, list: a, composer, input };
      }
      // panel: the message list sits next to the box, above it
      for (const sib of a.children) {
        if (sib === prev) continue;
        const sc = scrollerIn(sib, 4);
        if (sc && !isPage(sc) && above(sc, input)) return { root: a, list: sc, composer: prev, input };
      }
    }
    return null;
  }

  let checkedAt = 0;
  function chat() {
    const c = N.chat;
    if (c && c.input.isConnected && c.list.isConnected && shown(c.input)) return c;
    if (!c && Date.now() - checkedAt < 800) return null;
    checkedAt = Date.now();
    const input = findInput();
    const next = input ? findChat(input) : null;
    if (N.chat && (!next || next.root !== N.chat.root)) N.chat.root.removeAttribute('data-csr-chatroot');
    if (next) next.root.setAttribute('data-csr-chatroot', '');
    const changed = !!N.chat !== !!next;
    N.chat = next;
    if (changed && CSR.ui && CSR.settings) CSR.ui.applySettings(CSR.settings); // the dock shows only with a chat
    return next;
  }
  N.find = chat;
  N.active = () => !!chat();

  const BUTTON = 'button, [role="button"]';

  /** Text that isn't on buttons (copy / retry / edit…). */
  function ownText(el) {
    let n = textLen(el);
    for (const b of el.querySelectorAll(BUTTON)) n -= textLen(b);
    return n;
  }

  /** Children worth looking at; wrappers without a box of their own
   * (display: contents) are looked through. */
  function kidsOf(box, c) {
    const out = [];
    for (const e of box.children) {
      if (e === c.composer || c.composer.contains(e) || ours(e) || !textLen(e)) continue;
      if (getComputedStyle(e).display === 'contents') out.push(...kidsOf(e, c));
      else if (shown(e)) out.push(e);
    }
    return out;
  }

  /** The message rows. Notion nests its layout deeply: go down through
   * single wrappers (and the one that also holds the chat box, in the
   * full-page chat), and past small labels such as a date, until the
   * conversation splits into its rows. */
  function rowsOf(c, L) {
    let box = c.list;
    let rows = [];
    for (let i = 0; i < 80; i++) {
      const kids = kidsOf(box, c);
      const holder = kids.find((e) => e.contains(c.composer));
      rows = kids.filter((e) => !e.contains(c.composer));
      if (holder && !rows.length) {
        box = holder;
        continue;
      }
      if (!holder && rows.length === 1 && rows[0].children.length) {
        box = rows[0];
        continue;
      }
      if (!holder && rows.length > 1 && rows.length <= 3) {
        const big = rows.reduce((a, b) => (textLen(b) > textLen(a) ? b : a));
        const rest = rows.filter((r) => r !== big);
        const total = rows.reduce((n, r) => n + textLen(r), 0);
        if (big.children.length && textLen(big) >= total * 0.9 && rest.every((r) => textLen(r) <= 40 && !bubbleIn(r, L))) {
          box = big;
          continue;
        }
      }
      return rows;
    }
    return rows;
  }

  function alphaOf(css) {
    const c = CSR.themeFix.toRgb(css);
    return c ? c.a : 0;
  }

  /** A question bubble: on a line of its own (its parent adds no text),
   * tinted or outlined, rounded, clearly narrower than the list and closer
   * to its end (right) side. Not a button, not a Notion block. */
  function isBubble(e, L, row) {
    if (e.closest(BUTTON)) return false;
    if (e.closest('[data-block-id]') || e.querySelector('[data-block-id]')) return false;
    const own = ownText(e);
    if (own <= 0) return false;
    if (e !== row && e.parentElement && ownText(e.parentElement) - own > 2) return false; // inline in a paragraph
    const r = e.getBoundingClientRect();
    if (r.width < 10 || r.width > L.width * 0.88) return false;
    if (L.right - r.right > r.left - L.left) return false;
    const cs = getComputedStyle(e);
    if (parseFloat(cs.borderTopLeftRadius) < 4 && parseFloat(cs.borderBottomLeftRadius) < 4) return false;
    return alphaOf(cs.backgroundColor) > 0.03 || parseFloat(cs.borderTopWidth) > 0;
  }

  function bubbleIn(row, L) {
    const queue = [[row, 0]];
    for (let seen = 0; queue.length && seen < 300; seen++) {
      const [e, d] = queue.shift();
      if (isBubble(e, L, row)) return e;
      if (d < 12) for (const c of e.children) if (textLen(c)) queue.push([c, d + 1]);
    }
    return null;
  }

  const roles = new WeakMap(); // row -> {sig, list: [{el, role}]}

  function split(row, L) {
    const sig = row.childElementCount + ':' + Array.from(row.children, (c) => c.childElementCount).join(',') + ':' + (textLen(row) > 0);
    const hit = roles.get(row);
    if (hit && hit.sig === sig && hit.list.every((m) => m.el.isConnected)) return hit.list;
    let list;
    const b = bubbleIn(row, L);
    if (!b) list = [{ el: row, role: 'assistant' }];
    else if (ownText(row) - ownText(b) < 2) list = [{ el: b, role: 'user' }];
    else {
      // a whole turn in one row: find where the question and the answer part
      // (buttons beside the bubble, like "Edit", don't count)
      let holder = b;
      while (holder !== row && holder.parentElement && ownText(holder.parentElement) - ownText(b) < 2) holder = holder.parentElement;
      const turn = holder === row ? row : holder.parentElement;
      list = [{ el: b, role: 'user' }];
      for (const c of turn.children) if (c !== holder && !c.contains(b) && ownText(c) > 0) list.push({ el: c, role: 'assistant' });
    }
    roles.set(row, { sig, list });
    return list;
  }

  dom.getMessages = function () {
    const c = chat();
    const out = [];
    if (c) {
      const L = c.list.getBoundingClientRect();
      for (const row of rowsOf(c, L)) {
        const parts = split(row, L);
        // a chat starts with a question: short rows before it are labels ("Today")
        if (!out.length && parts.every((m) => m.role === 'assistant') && ownText(row) <= 40) continue;
        for (const m of parts) out.push(m);
      }
    }
    // never anything editable (a message being edited, or a Notion page)
    const list = out.filter((m) => !m.el.closest(EDITABLE) && !m.el.querySelector(EDITABLE) && !m.el.closest(PAGE));
    list.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const keep = new Set(list.map((m) => m.el));
    for (const el of document.querySelectorAll('[data-csr-msg]')) if (!keep.has(el)) el.removeAttribute('data-csr-msg');
    for (const m of list) if (m.el.getAttribute('data-csr-msg') !== m.role) m.el.setAttribute('data-csr-msg', m.role);
    dom.mode = list.length ? 'notion' : 'none';
    const first = list.find((m) => m.role === 'user');
    N.firstUser = first ? first.el.textContent.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    return list.map((m) => m.el);
  };

  dom.composer = () => (N.chat ? N.chat.input : null);

  // 53-bit string hash (cyrb53)
  function hash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  /** A chat's key: its thread id when the address has one, otherwise the
   * first question asked in it (Notion's chat panel keeps the page address). */
  dom.getConversationId = function () {
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (/^(t|thread|thread_?id|chat|chat_?id|conversation)$/i.test(k) && /^[0-9a-f-]{16,}$/i.test(v)) return 'notion-' + v.replace(/-/g, '').toLowerCase();
    }
    return N.firstUser ? 'notion-' + hash(N.firstUser) : null;
  };

  N.title = () => (N.firstUser ? 'Notion AI: ' + N.firstUser.slice(0, 70) : 'Notion AI');

  /** For the diagnostic report: how the chat was found (structure only:
   * tags, a few class names, attribute names, sizes; never any text). */
  N.report = function () {
    const desc = (el) => {
      if (!el) return null;
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
      const r = el.getBoundingClientRect();
      const data = el.getAttributeNames().filter((a) => a.startsWith('data-') && !a.startsWith('data-csr')).slice(0, 4);
      const disp = getComputedStyle(el).display;
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${data.length ? ' [' + data.join(' ') + ']' : ''} ${Math.round(r.width)}x${Math.round(r.height)}${disp === 'block' ? '' : ' ' + disp} t${textLen(el)}`;
    };
    const inputs = Array.from(document.querySelectorAll(INPUTS))
      .filter((el) => !ours(el) && !el.closest(PAGE) && shown(el))
      .slice(0, 8)
      .map((el) => ({ el: desc(el), hint: hintOf(el).replace(/\s+/g, ' ').trim().slice(0, 60), matches: HINT.test(hintOf(el)) }));
    const c = N.chat || chat();
    if (!c) return { inputs, found: false };
    const L = c.list.getBoundingClientRect();
    // the way down from the list to the rows
    const path = [];
    let box = c.list;
    for (let i = 0; i < 40 && box; i++) {
      const kids = kidsOf(box, c);
      path.push(`${desc(box)} → ${kids.length} kids`);
      if (kids.length !== 1) break;
      box = kids[0];
    }
    const attrs = new Set();
    for (const el of c.list.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) if ((a.startsWith('data-') && !a.startsWith('data-csr')) || a === 'role' || a.startsWith('aria-')) attrs.add(a + (a === 'role' ? '=' + el.getAttribute('role') : ''));
      if (attrs.size > 60) break;
    }
    const rows = rowsOf(c, L);
    // what in the first rows looks a bit like a bubble (tinted / rounded)
    const looks = [];
    for (const row of rows.slice(0, 4)) {
      const queue = [[row, 0]];
      const found = [];
      for (let seen = 0; queue.length && seen < 200 && found.length < 4; seen++) {
        const [e, d] = queue.shift();
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        if (alphaOf(cs.backgroundColor) > 0.03 || parseFloat(cs.borderTopLeftRadius) >= 4) {
          found.push(`d${d} ${e.tagName.toLowerCase()} w${Math.round((r.width / L.width) * 100)}% gapL${Math.round(r.left - L.left)} gapR${Math.round(L.right - r.right)} r${parseFloat(cs.borderTopLeftRadius)} a${alphaOf(cs.backgroundColor).toFixed(2)} own${ownText(e)}/${e.parentElement ? ownText(e.parentElement) : 0}${e.closest('[data-block-id]') ? ' inBlock' : ''}${isBubble(e, L, row) ? ' BUBBLE' : ''}`);
        }
        if (d < 12) for (const k of e.children) if (textLen(k)) queue.push([k, d + 1]);
      }
      looks.push(found);
    }
    return {
      inputs,
      found: true,
      root: desc(c.root),
      list: desc(c.list),
      composer: desc(c.composer),
      path,
      attrs: [...attrs].slice(0, 60),
      blocks: c.list.querySelectorAll('[data-block-id]').length,
      rows: rows.slice(0, 12).map((r) => desc(r) + ' → ' + split(r, L).map((m) => m.role[0]).join('')),
      bubbles: looks,
    };
  };
})();
