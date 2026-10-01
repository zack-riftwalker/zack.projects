/* DOM helpers: finding Claude's messages, mapping selections to stable text
 * offsets and back, and wrapping text ranges without touching the text itself. */
(function () {
  const CSR = globalThis.CSR;

  // Selectors for claude.ai. Kept in one place so they are easy to update
  // when Claude's markup changes.
  const SEL = (CSR.SEL = {
    assistant: '.font-claude-response, .font-claude-message',
    user: '[data-testid="user-message"]',
    streaming: '[data-is-streaming="true"]',
    markdown: '.standard-markdown, .progressive-markdown',
    editor: 'div.ProseMirror, [contenteditable="true"], textarea',
    ui: '[data-csr-ui]',
    // Fallback when Claude's own classes aren't found (e.g. claude.ai/code,
    // or after a redesign): rendered-markdown containers and message roles.
    generic:
      '[data-message-author-role], [data-role="user"], [data-role="assistant"], [data-testid*="message" i], div[class*="user-message" i], div[class*="human-message" i], div[class*="markdown" i], div[class*="prose" i], article[class*="prose" i], section[class*="markdown" i]',
    notMessage: 'nav, aside, header, footer, [role="navigation"], [contenteditable="true"], [contenteditable=""], form, pre, code, [data-csr-ui]',
  });
  SEL.message = SEL.assistant + ', ' + SEL.user;

  // Elements whose text never counts as "message text".
  const SKIP_TEXT = '[data-csr-ui], button, svg, style, script, textarea, input, select, [aria-hidden="true"]';

  // Block-level elements used for quote blocks, dividers and RTL.
  const BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol, hr';
  CSR.BLOCK_SEL = BLOCK_SEL;

  const dom = (CSR.dom = { mode: 'none' });

  /** Conversation key from the URL: /chat/<uuid> or /code/session_<id>. */
  dom.getConversationId = function () {
    const m = location.pathname.match(/\/(chat|code)\/(?:session_)?([0-9a-zA-Z_-]{8,})/);
    if (!m) return null;
    return m[1] === 'code' ? 'code-' + m[2] : m[2];
  };

  function outermost(list, sel) {
    return list.filter((el) => !el.parentElement || !el.parentElement.closest(sel));
  }

  const meaningful = (el) =>
    el.hasAttribute('data-message-author-role') ||
    el.hasAttribute('data-role') ||
    /user-message|human-message/i.test(typeof el.className === 'string' ? el.className : '') ||
    !!el.querySelector('p, li, h1, h2, h3, h4, pre, blockquote, table') ||
    ((el.textContent || '').trim().length >= 40 && !el.querySelector('button, input'));

  function genericMessages() {
    const cands = Array.from(document.querySelectorAll(SEL.generic)).filter(
      (el) => !el.closest(SEL.notMessage) && /\S/.test(el.textContent || '') && meaningful(el)
    );
    const set = new Set(cands);
    // the innermost ones are the actual message bodies
    return cands.filter((el) => !Array.from(el.querySelectorAll(SEL.generic)).some((d) => set.has(d)));
  }

  function roleGuess(el) {
    if (el.matches(SEL.user)) return 'user';
    if (el.closest('[data-message-author-role="user"], [data-role="user"], [data-testid*="user-message" i], [data-testid*="human" i], [class*="user-message" i], [class*="human-message" i]')) return 'user';
    return 'assistant';
  }

  /** All message roots (user + assistant) in document order. Also tags them
   * with data-csr-msg so CSS and messageOf() can find them. */
  dom.getMessages = function () {
    let list = outermost(Array.from(document.querySelectorAll(SEL.message)), SEL.message);
    dom.mode = list.length ? 'known' : 'none';
    if (!document.querySelector(SEL.assistant)) {
      // Claude's answer class isn't on this page: find answers generically and
      // keep any user messages we do recognise
      const users = list;
      const generic = genericMessages().filter((g) => !users.some((u) => u.contains(g) || g.contains(u)));
      list = users.concat(generic).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      if (generic.length) dom.mode = 'generic';
    }
    for (const el of list) {
      const role = dom.mode === 'known' ? (el.matches(SEL.user) ? 'user' : 'assistant') : roleGuess(el);
      if (el.getAttribute('data-csr-msg') !== role) el.setAttribute('data-csr-msg', role);
    }
    return list;
  };

  /** The message containing `node`. With `refresh`, re-scans the page first
   * if the node isn't in a known message yet (e.g. a brand-new answer). */
  dom.messageOf = function (node, refresh) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return null;
    const m = el.closest('[data-csr-msg]');
    if (m || !refresh) return m;
    dom.getMessages();
    return el.closest('[data-csr-msg]');
  };

  dom.roleOf = function (msg) {
    return msg.getAttribute('data-csr-msg') || (msg.matches(SEL.user) ? 'user' : 'assistant');
  };

  dom.isStreaming = function (msg) {
    return !!(msg.closest(SEL.streaming) || msg.querySelector(SEL.streaming));
  };

  dom.isEditable = function (node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && (el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')));
  };

  // ---------------------------------------------------------------------------
  // Text index: a flat string of a message's text plus the text nodes it came from.

  function acceptText(node) {
    const p = node.parentElement;
    if (!p) return NodeFilter.FILTER_REJECT;
    if (p.closest(SKIP_TEXT)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }

  dom.buildIndex = function (root) {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: acceptText });
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { root, nodes, text };
  };

  /** Converts a DOM boundary point into an offset in the index text. */
  dom.pointToOffset = function (index, container, offset) {
    if (container.nodeType === 3) {
      const hit = index.nodes.find((e) => e.node === container);
      if (hit) return hit.start + Math.min(offset, container.nodeValue.length);
    }
    const point = document.createRange();
    try {
      point.setStart(container, offset);
    } catch (e) {
      return -1;
    }
    point.collapse(true);
    for (const e of index.nodes) {
      // first text node that starts at/after the point
      if (point.comparePoint(e.node, 0) >= 0) return e.start;
      // point falls inside this text node (container was an ancestor)
      if (point.comparePoint(e.node, e.node.nodeValue.length) > 0) {
        return e.start; // conservative
      }
    }
    return index.text.length;
  };

  dom.rangeToOffsets = function (index, range) {
    let start = dom.pointToOffset(index, range.startContainer, range.startOffset);
    let end = dom.pointToOffset(index, range.endContainer, range.endOffset);
    if (start < 0 || end < 0 || end <= start) return null;
    // trim whitespace
    while (start < end && /\s/.test(index.text[start])) start++;
    while (end > start && /\s/.test(index.text[end - 1])) end--;
    if (end <= start) return null;
    return { start, end };
  };

  dom.offsetsToRange = function (index, start, end) {
    let sNode = null;
    let sOff = 0;
    let eNode = null;
    let eOff = 0;
    for (const e of index.nodes) {
      const len = e.node.nodeValue.length;
      if (!sNode && start >= e.start && start < e.start + len) {
        sNode = e.node;
        sOff = start - e.start;
      }
      if (end > e.start && end <= e.start + len) {
        eNode = e.node;
        eOff = end - e.start;
        break;
      }
    }
    if (!sNode || !eNode) return null;
    const r = document.createRange();
    r.setStart(sNode, sOff);
    r.setEnd(eNode, eOff);
    return r;
  };

  const CONTEXT = 40;

  /** Text-quote anchor for [start, end) in a message. */
  dom.makeTextAnchor = function (index, start, end) {
    return {
      start,
      end,
      exact: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: index.text.slice(end, end + CONTEXT),
    };
  };

  function commonSuffixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }
  function commonPrefixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  /** Finds a text anchor inside an index. Returns {start, end, score} or null. */
  dom.locateText = function (index, a) {
    const text = index.text;
    if (!a.exact) return null;
    if (text.slice(a.start, a.end) === a.exact) return { start: a.start, end: a.end, score: 1000 };
    let best = null;
    let from = 0;
    let guard = 0;
    while (guard++ < 500) {
      const i = text.indexOf(a.exact, from);
      if (i < 0) break;
      const pre = commonSuffixLen(text.slice(Math.max(0, i - CONTEXT), i), a.prefix || '');
      const suf = commonPrefixLen(text.slice(i + a.exact.length, i + a.exact.length + CONTEXT), a.suffix || '');
      const dist = Math.abs(i - (a.start || 0));
      const score = pre + suf - Math.min(dist / 500, 20);
      if (!best || score > best.score) best = { start: i, end: i + a.exact.length, score };
      from = i + 1;
    }
    return best;
  };

  // ---------------------------------------------------------------------------
  // Wrapping

  /** Wraps [start, end) of an index in elements made by `make()`; returns them. */
  dom.wrapOffsets = function (index, start, end, make) {
    const out = [];
    const targets = [];
    for (const e of index.nodes) {
      const len = e.node.nodeValue.length;
      const s = Math.max(start, e.start) - e.start;
      const t = Math.min(end, e.start + len) - e.start;
      if (s >= t) continue;
      const piece = e.node.nodeValue.slice(s, t);
      if (!piece.trim()) continue; // never wrap whitespace between blocks
      targets.push({ node: e.node, s, t, len });
    }
    for (const { node, s, t, len } of targets) {
      let target = node;
      if (t < len) target.splitText(t);
      if (s > 0) target = target.splitText(s);
      const w = make();
      w.setAttribute('data-csr-wrap', '');
      target.parentNode.insertBefore(w, target);
      w.appendChild(target);
      out.push(w);
    }
    return out;
  };

  /** Removes wrapper elements, merging the text back together. */
  dom.unwrap = function (wrappers) {
    for (const w of wrappers) {
      const parent = w.parentNode;
      if (!parent) continue;
      const first = w.firstChild;
      const last = w.lastChild;
      while (w.firstChild) parent.insertBefore(w.firstChild, w);
      parent.removeChild(w);
      mergeText(first);
      if (last !== first) mergeText(last);
    }
  };

  function mergeText(node) {
    if (!node || node.nodeType !== 3 || !node.parentNode) return;
    // merge into previous text sibling (keeps the earlier node, which is the
    // one React originally created), then pull in the following one
    let n = node;
    const prev = n.previousSibling;
    if (prev && prev.nodeType === 3) {
      prev.appendData(n.data);
      n.parentNode.removeChild(n);
      n = prev;
    }
    const next = n.nextSibling;
    if (next && next.nodeType === 3) {
      n.appendData(next.data);
      next.parentNode.removeChild(next);
    }
  }

  // ---------------------------------------------------------------------------
  // Blocks

  /** All block elements of a message in document order (skipping our UI). */
  dom.getBlocks = function (msg) {
    return Array.from(msg.querySelectorAll(BLOCK_SEL)).filter((el) => !el.closest(SEL.ui));
  };

  dom.blockText = function (el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  };

  dom.makeBlockAnchor = function (msg, el) {
    const blocks = dom.getBlocks(msg);
    return { block: blocks.indexOf(el), tag: el.tagName.toLowerCase(), snippet: dom.blockText(el) };
  };

  dom.locateBlock = function (msg, a) {
    const blocks = dom.getBlocks(msg);
    const at = blocks[a.block];
    if (at && at.tagName.toLowerCase() === a.tag && dom.blockText(at) === a.snippet) return at;
    let best = null;
    let bestDist = Infinity;
    blocks.forEach((el, i) => {
      if (el.tagName.toLowerCase() !== a.tag || dom.blockText(el) !== a.snippet) return;
      const d = Math.abs(i - a.block);
      if (d < bestDist) {
        best = el;
        bestDist = d;
      }
    });
    return best;
  };

  /** Nearest block for a node, used for quote/divider targets. */
  dom.blockFor = function (node, msg) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return null;
    let b = el.closest('p, li, h1, h2, h3, h4, h5, h6, pre, table, blockquote, hr');
    if (!b || !msg.contains(b)) return null;
    // a paragraph inside a list item or table: use the item / table
    const li = b.parentElement && b.parentElement.closest('li, table');
    if (b.tagName === 'P' && li && msg.contains(li)) b = li;
    return b;
  };

  // ---------------------------------------------------------------------------
  // Scrolling (Claude's chat is a virtual list: rows are re-rendered and
  // re-measured while scrolling, which cancels smooth scrolls)

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  dom.wait = wait;

  /** Stable position of a message in the whole conversation: the row index of
   * Claude's virtual list when there is one. */
  dom.rowIndex = function (msg) {
    const row = msg && msg.closest('[data-index]');
    const n = row ? parseInt(row.getAttribute('data-index'), 10) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  function renderedRows() {
    const out = [];
    for (const m of document.querySelectorAll('[data-csr-msg]')) {
      const n = dom.rowIndex(m);
      if (n != null) out.push(n);
    }
    return out;
  }

  /** Jumps so `el` is at the top (or center) of the screen. Instant jumps with
   * re-checks, so layout shifts from the virtual list can't undo it. */
  dom.scrollToEl = async function (el, block = 'start') {
    if (!el || !el.isConnected) return false;
    const prevTop = el.style.scrollMarginTop;
    const prevBottom = el.style.scrollMarginBottom;
    el.style.scrollMarginTop = '84px';
    el.style.scrollMarginBottom = '120px';
    const sc = dom.scrollParent(el);
    const inPlace = () => {
      const r = el.getBoundingClientRect();
      // near the end of the conversation it can't go higher: visible is enough
      const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
      if (atEnd && r.top >= 0 && r.top < window.innerHeight - 40) return true;
      return block === 'center'
        ? r.top < window.innerHeight * 0.7 && r.bottom > window.innerHeight * 0.2
        : r.top >= 0 && r.top < Math.min(260, window.innerHeight * 0.45);
    };
    try {
      el.scrollIntoView({ block, behavior: 'instant' });
      // keep correcting until it stays put (rows above may be re-measured)
      let steady = 0;
      for (let i = 0; i < 16 && el.isConnected; i++) {
        await wait(i < 3 ? 70 : 140);
        if (!el.isConnected) return false;
        if (inPlace()) {
          if (++steady >= 3) break;
        } else {
          steady = 0;
          el.scrollIntoView({ block, behavior: 'instant' });
        }
      }
    } finally {
      el.style.scrollMarginTop = prevTop;
      el.style.scrollMarginBottom = prevBottom;
    }
    return true;
  };

  /** Finds something that may not be rendered yet: calls `find()`, and if it
   * returns nothing, scrolls toward virtual-list row `row` until it appears. */
  dom.seek = async function (find, row) {
    let el = find();
    if (el || row == null) return el;
    const first = document.querySelector('[data-csr-msg]');
    if (!first) return null;
    const sc = dom.scrollParent(first);
    for (let i = 0; i < 60; i++) {
      const rows = renderedRows();
      if (!rows.length) return null;
      const min = Math.min(...rows);
      const max = Math.max(...rows);
      if (row >= min && row <= max) {
        const target = Array.from(document.querySelectorAll('[data-index]')).find((r) => +r.getAttribute('data-index') === row);
        if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
        for (let k = 0; k < 14 && !el; k++) {
          await wait(150);
          el = find();
        }
        return el;
      }
      const before = sc.scrollTop;
      sc.scrollBy({ top: (row < min ? -1 : 1) * sc.clientHeight * 0.85, behavior: 'instant' });
      await wait(110);
      el = find();
      if (el) return el;
      if (sc.scrollTop === before) return null; // reached the end
    }
    return null;
  };

  /** Scrollable ancestor of an element (Claude scrolls an inner container). */
  dom.scrollParent = function (el) {
    let cur = el && el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight + 4) return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };
})();
