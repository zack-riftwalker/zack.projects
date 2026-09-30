/* Annotations for one conversation: marks (highlight / bold / italic /
 * underline / strike / notes), block formats (quote, important), dividers and
 * drawings. Each one is stored with a text-based anchor and re-applied
 * whenever Claude re-renders the page. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const AN = (CSR.ann = {});

  let conv = null;
  const placed = new Map(); // id -> { els: Element[] } | { el: Element }
  const listeners = new Set();
  let saveTimer = 0;
  let lastOrphanTry = 0;
  let lastMsgCount = -1;
  AN.lastSavedAt = 0;

  AN.onChange = (fn) => listeners.add(fn);
  const emit = () => listeners.forEach((fn) => fn());

  AN.conv = () => conv;
  AN.all = () => (conv ? conv.annotations : []);
  AN.get = (id) => AN.all().find((a) => a.id === id) || null;
  AN.isPlaced = (id) => placed.has(id);

  AN.setConv = function (c) {
    AN.unplaceAll();
    conv = c;
    lastOrphanTry = 0;
    lastMsgCount = -1;
    emit();
  };

  AN.save = function () {
    if (!conv) return;
    clearTimeout(saveTimer);
    captureTitle();
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      write();
    }, 250);
    emit();
  };

  function captureTitle() {
    // only take the page title/URL while it still belongs to this conversation
    if (dom.getConversationId() !== conv.id) return;
    const t = (document.title || '').replace(/\s*[-–|]\s*Claude\s*$/i, '').trim();
    if (t && t !== 'Claude') conv.title = t;
    conv.url = location.origin + location.pathname;
  }

  function write() {
    captureTitle();
    AN.lastSavedAt = Date.now();
    return CSR.store.saveConv(conv);
  }

  AN.flush = async function () {
    if (!saveTimer || !conv) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    await write();
  };

  // ---------------------------------------------------------------------------
  // Message matching

  function msgKey(index) {
    return index.text.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function makeCtx(messages) {
    const idx = new Map();
    return {
      messages,
      index(msg) {
        let i = idx.get(msg);
        if (!i) {
          i = dom.buildIndex(msg);
          idx.set(msg, i);
        }
        return i;
      },
      invalidate(msg) {
        idx.delete(msg);
      },
    };
  }

  /** Messages ordered by how likely they hold the annotation. */
  function candidates(a, ctx) {
    const want = a.anchor || {};
    return ctx.messages
      .map((m, j) => ({
        m,
        keyOk: want.key && msgKey(ctx.index(m)) === want.key ? 0 : 1,
        roleOk: want.role && dom.roleOf(m) === want.role ? 0 : 1,
        d: Math.abs(j - (want.msg || 0)),
      }))
      .sort((x, y) => x.keyOk - y.keyOk || x.roleOk - y.roleOk || x.d - y.d)
      .map((x) => x.m);
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers

  function markClasses(a) {
    const st = a.style || {};
    const c = ['csr-m'];
    if (st.hl) c.push('csr-hl-' + st.hl);
    if (st.bold) c.push('csr-b');
    if (st.italic) c.push('csr-i');
    if (st.underline) c.push('csr-u');
    if (st.strike) c.push('csr-s');
    if (st.code) c.push('csr-code');
    if (st.box) c.push('csr-box');
    if (st.color) c.push('csr-tc-' + st.color);
    if (a.note && a.note.trim()) c.push('csr-note');
    return c.join(' ');
  }

  function decorateMark(a, els) {
    const cls = markClasses(a);
    els.forEach((el, i) => {
      el.className = cls + (i === els.length - 1 && a.note && a.note.trim() ? ' csr-note-end' : '');
      el.setAttribute('data-csr-id', a.id);
      if (a.note && a.note.trim()) el.title = a.note;
      else el.removeAttribute('title');
    });
  }

  function makeDivider(a, asListItem) {
    const el = document.createElement(asListItem ? 'li' : 'div');
    el.className = 'csr-divider';
    el.setAttribute('data-csr-ui', '');
    el.setAttribute('data-csr-divider-id', a.id);
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('role', 'separator');
    decorateDivider(a, el);
    return el;
  }

  function decorateDivider(a, el) {
    el.setAttribute('data-style', a.style || 'solid');
    if (a.color) el.style.setProperty('--csr-dv-color', a.color);
    else el.style.removeProperty('--csr-dv-color');
    el.textContent = '';
    if (a.label && a.label.trim()) {
      const s = document.createElement('span');
      s.className = 'csr-divider-label';
      s.textContent = a.label.trim();
      el.appendChild(s);
    }
  }

  function makeBookmark(a, asListItem, anchorEl) {
    const el = document.createElement(asListItem ? 'li' : 'div');
    el.className = 'csr-bookmark';
    el.setAttribute('data-csr-ui', '');
    el.setAttribute('data-csr-bookmark-id', a.id);
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('role', 'note');
    const rtl = anchorEl && getComputedStyle(anchorEl).direction === 'rtl';
    el.setAttribute('data-side', rtl ? 'right' : 'left');
    decorateBookmark(a, el);
    return el;
  }

  function decorateBookmark(a, el) {
    const p = CSR.patternById(a.pattern);
    el.setAttribute('data-pattern', a.pattern || 'termeh');
    el.style.setProperty('--csr-bm-fg', p.colors.fg);
    el.style.setProperty('--csr-bm-bg', p.colors.bg);
    el.style.setProperty('--csr-bm-soft', p.colors.soft);
    el.textContent = '';
    const ribbon = document.createElement('div');
    ribbon.className = 'csr-bm-ribbon';
    ribbon.innerHTML = CSR.patternFill(a.pattern, 26); // generated SVG, no user text
    const label = document.createElement('span');
    label.className = 'csr-bm-label';
    label.textContent = a.label && a.label.trim() ? a.label.trim() : 'نشانک';
    el.append(ribbon, label);
  }

  // ---------------------------------------------------------------------------
  // Placement

  function isPlacedOk(a) {
    const p = placed.get(a.id);
    if (!p) return false;
    if (p.els) return p.els.length > 0 && p.els.every((el) => el.isConnected);
    if (!p.el || !p.el.isConnected) return false;
    if (a.kind === 'block') return p.el.getAttribute('data-csr-block-id') === a.id;
    if (a.kind === 'divider' || a.kind === 'bookmark') return !!p.anchor && p.anchor.isConnected && p.anchor.contains(p.el) === false;
    return true;
  }

  function unplace(a) {
    const p = placed.get(a.id);
    placed.delete(a.id);
    if (!p) return;
    if (p.els) {
      dom.unwrap(p.els.filter((el) => el.isConnected));
    } else if (p.el) {
      if (a.kind === 'block') {
        if (p.el.getAttribute('data-csr-block-id') === a.id) {
          p.el.removeAttribute('data-csr-block');
          p.el.removeAttribute('data-csr-block-id');
        }
      } else if (a.kind === 'drawing') {
        const host = p.el.parentElement;
        p.el.remove();
        if (host && !host.querySelector(':scope > .csr-draw-layer')) host.removeAttribute('data-csr-has-drawing');
      } else {
        p.el.remove();
      }
    }
  }

  AN.unplaceAll = function () {
    for (const a of AN.all()) unplace(a);
    placed.clear();
  };

  /** Returns 'ok', 'wait' (target message still changing) or 'missing'. */
  function place(a, ctx, isStable) {
    const list = candidates(a, ctx);
    if (!list.length) return 'missing';
    if (!isStable(list[0])) return 'wait';

    if (a.kind === 'mark') {
      for (const msg of list) {
        if (!isStable(msg)) continue;
        const index = ctx.index(msg);
        const loc = dom.locateText(index, a.anchor);
        if (!loc || loc.score < -5) continue;
        const els = dom.wrapOffsets(index, loc.start, loc.end, () => document.createElement('span'));
        ctx.invalidate(msg);
        if (!els.length) continue;
        decorateMark(a, els);
        placed.set(a.id, { els });
        a.anchor.start = loc.start;
        a.anchor.end = loc.end;
        return 'ok';
      }
      return 'missing';
    }

    if (a.kind === 'block' || a.kind === 'divider' || a.kind === 'bookmark') {
      for (const msg of list) {
        if (!isStable(msg)) continue;
        const el = dom.locateBlock(msg, a.anchor);
        if (!el) continue;
        if (a.kind === 'block') {
          el.setAttribute('data-csr-block', a.style);
          el.setAttribute('data-csr-block-id', a.id);
          placed.set(a.id, { el });
        } else {
          const d = a.kind === 'bookmark' ? makeBookmark(a, el.tagName === 'LI', el) : makeDivider(a, el.tagName === 'LI');
          if (a.anchor.pos === 'before') el.before(d);
          else el.after(d);
          placed.set(a.id, { el: d, anchor: el });
        }
        return 'ok';
      }
      return 'missing';
    }

    if (a.kind === 'drawing') {
      const msg = list[0];
      const idx = ctx.index(msg);
      if (a.anchor.key && msgKey(idx) !== a.anchor.key) {
        // only trust index/role when the message text changed
        const byIndex = ctx.messages[a.anchor.msg];
        if (byIndex !== msg) return 'missing';
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'csr-draw-layer');
      svg.setAttribute('data-csr-ui', '');
      svg.setAttribute('data-csr-draw-id', a.id);
      msg.setAttribute('data-csr-has-drawing', '');
      msg.appendChild(svg);
      CSR.draw.render(svg, a.strokes || []);
      placed.set(a.id, { el: svg, msg });
      return 'ok';
    }
    return 'missing';
  }

  /** Makes sure every annotation is visible. Returns true if some are waiting
   * for a message that is still streaming. */
  AN.sync = function (messages, isStable, force) {
    if (!conv) return false;
    const ctx = makeCtx(messages);
    let waiting = false;
    const now = Date.now();
    const tryOrphans = force || messages.length !== lastMsgCount || now - lastOrphanTry > 4000;
    let anyOrphan = false;
    // blocks before dividers so that divider insertion doesn't shift nothing important;
    // marks last since wrapping changes text nodes.
    const order = { block: 0, divider: 1, bookmark: 1, drawing: 2, mark: 3 };
    const list = AN.all().slice().sort((x, y) => order[x.kind] - order[y.kind]);
    for (const a of list) {
      if (isPlacedOk(a)) continue;
      const wasPlaced = placed.has(a.id);
      if (wasPlaced) unplace(a);
      if (!wasPlaced && a._orphan && !tryOrphans) {
        anyOrphan = true;
        continue;
      }
      const r = place(a, ctx, isStable);
      if (r === 'wait') waiting = true;
      Object.defineProperty(a, '_orphan', { value: r === 'missing', enumerable: false, configurable: true, writable: true });
      if (r === 'missing') anyOrphan = true;
    }
    if (tryOrphans) {
      lastOrphanTry = now;
      lastMsgCount = messages.length;
    }
    if (anyOrphan || waiting) emit();
    return waiting;
  };

  // ---------------------------------------------------------------------------
  // Creating / editing

  function selectionInMessage() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const msg = dom.messageOf(range.startContainer);
    if (!msg || dom.isEditable(range.startContainer)) return null;
    const r = range.cloneRange();
    if (!msg.contains(range.endContainer)) r.setEnd(msg, msg.childNodes.length);
    return { sel, range: r, msg };
  }
  AN.selectionInMessage = selectionInMessage;

  function baseAnchor(msg, index) {
    const messages = dom.getMessages();
    return { msg: messages.indexOf(msg), role: dom.roleOf(msg), key: msgKey(index || dom.buildIndex(msg)) };
  }

  function push(a) {
    const now = Date.now();
    a.created = a.created || now;
    a.updated = now;
    conv.annotations.push(a);
  }

  /** Marks whose wrappers intersect the given range. */
  AN.marksInRange = function (range) {
    const out = [];
    for (const a of AN.all()) {
      if (a.kind !== 'mark') continue;
      const p = placed.get(a.id);
      if (p && p.els && p.els.some((el) => el.isConnected && range.intersectsNode(el))) out.push(a);
    }
    return out;
  };

  AN.createMark = function (style, note) {
    const s = selectionInMessage();
    if (!s || !conv) return null;
    const index = dom.buildIndex(s.msg);
    const off = dom.rangeToOffsets(index, s.range);
    if (!off) return null;
    const a = {
      id: CSR.uid('m'),
      kind: 'mark',
      anchor: { ...baseAnchor(s.msg, index), ...dom.makeTextAnchor(index, off.start, off.end) },
      style: { ...style },
      note: note || '',
    };
    const els = dom.wrapOffsets(index, off.start, off.end, () => document.createElement('span'));
    if (!els.length) return null;
    push(a);
    decorateMark(a, els);
    placed.set(a.id, { els });
    s.sel.removeAllRanges();
    AN.save();
    return a;
  };

  /** Applies a style key from the selection toolbar. Existing marks that match
   * the selection are toggled instead of stacking new ones. */
  AN.applyStyleToSelection = function (key, value) {
    const s = selectionInMessage();
    if (!s) return null;
    const selText = s.range.toString().trim();
    const hits = AN.marksInRange(s.range);
    const exact = hits.find((a) => a.anchor.exact.trim() === selText);
    if (key === 'hl') {
      // selection inside one highlight: recolor / toggle it
      const holder = exact || (hits.length === 1 && hits[0].style.hl && hits[0].anchor.exact.includes(selText) ? hits[0] : null);
      if (holder && holder.style.hl) {
        const next = holder.style.hl === value ? null : value;
        AN.updateStyle(holder.id, { hl: next });
        s.sel.removeAllRanges();
        return holder;
      }
      return AN.createMark({ hl: value });
    }
    if (exact) {
      const cur = exact.style[key];
      AN.updateStyle(exact.id, { [key]: value === undefined ? !cur : cur === value ? null : value });
      s.sel.removeAllRanges();
      return exact;
    }
    return AN.createMark({ [key]: value === undefined ? true : value });
  };

  function isEmptyMark(a) {
    const st = a.style || {};
    return !Object.values(st).some(Boolean) && !(a.note && a.note.trim()) && !(a.tags && a.tags.length);
  }
  AN.isEmptyMark = isEmptyMark;

  AN.updateStyle = function (id, patch) {
    const a = AN.get(id);
    if (!a) return;
    a.style = { ...a.style, ...patch };
    for (const k of Object.keys(a.style)) if (!a.style[k]) delete a.style[k];
    if (isEmptyMark(a)) return AN.remove(id);
    a.updated = Date.now();
    const p = placed.get(id);
    if (p && p.els) decorateMark(a, p.els);
    AN.save();
  };

  AN.setNote = function (id, note) {
    const a = AN.get(id);
    if (!a) return;
    a.note = note;
    a.updated = Date.now();
    const p = placed.get(id);
    if (a.kind === 'mark' && p && p.els) decorateMark(a, p.els);
    AN.save();
  };

  AN.update = function (id, patch) {
    const a = AN.get(id);
    if (!a) return;
    Object.assign(a, patch, { updated: Date.now() });
    const p = placed.get(id);
    if (a.kind === 'divider' && p && p.el) decorateDivider(a, p.el);
    if (a.kind === 'bookmark' && p && p.el) decorateBookmark(a, p.el);
    AN.save();
  };

  AN.remove = function (id) {
    const a = AN.get(id);
    if (!a) return;
    unplace(a);
    conv.annotations = conv.annotations.filter((x) => x.id !== id);
    AN.save();
  };

  AN.removeMarksInSelection = function () {
    const s = selectionInMessage();
    if (!s) return 0;
    const hits = AN.marksInRange(s.range);
    hits.forEach((a) => AN.remove(a.id));
    s.sel.removeAllRanges();
    return hits.length;
  };

  AN.clearAll = function () {
    AN.unplaceAll();
    if (conv) conv.annotations = [];
    AN.save();
  };

  /** Quote / "important" box for all blocks touched by the selection. */
  AN.toggleBlockOnSelection = function (style) {
    const s = selectionInMessage();
    if (!s) return false;
    const { msg, range } = s;
    const all = dom.getBlocks(msg).filter((b) => dom.blockFor(b, msg) === b);
    const first = dom.blockFor(range.startContainer, msg);
    const last = dom.blockFor(range.endContainer, msg) || first;
    if (!first) return false;
    let i0 = all.indexOf(first);
    let i1 = all.indexOf(last);
    if (i1 < i0) [i0, i1] = [i1, i0];
    let targets = all.slice(i0, i1 + 1);
    targets = targets.filter((t) => !targets.some((o) => o !== t && o.contains(t)));
    const existing = targets.map((el) => {
      const id = el.getAttribute('data-csr-block-id');
      return id ? AN.get(id) : null;
    });
    const allOn = existing.every((a) => a && a.style === style);
    targets.forEach((el, i) => {
      const cur = existing[i];
      if (cur) AN.remove(cur.id);
      if (!allOn) {
        const a = { id: CSR.uid('b'), kind: 'block', style, anchor: { ...baseAnchor(msg), ...dom.makeBlockAnchor(msg, el) } };
        push(a);
        el.setAttribute('data-csr-block', style);
        el.setAttribute('data-csr-block-id', a.id);
        placed.set(a.id, { el });
      }
    });
    s.sel.removeAllRanges();
    AN.save();
    return true;
  };

  AN.addDivider = function (msg, block, pos, opts) {
    if (!conv) return null;
    const a = {
      id: CSR.uid('d'),
      kind: 'divider',
      style: opts.style || 'solid',
      color: opts.color || '',
      label: opts.label || '',
      anchor: { ...baseAnchor(msg), ...dom.makeBlockAnchor(msg, block), pos },
    };
    push(a);
    const d = makeDivider(a, block.tagName === 'LI');
    if (pos === 'before') block.before(d);
    else block.after(d);
    placed.set(a.id, { el: d, anchor: block });
    AN.save();
    return a;
  };

  AN.addBookmark = function (msg, block, pos, opts) {
    if (!conv) return null;
    const a = {
      id: CSR.uid('k'),
      kind: 'bookmark',
      pattern: opts.pattern || 'termeh',
      label: opts.label || '',
      anchor: { ...baseAnchor(msg), ...dom.makeBlockAnchor(msg, block), pos },
    };
    push(a);
    const b = makeBookmark(a, block.tagName === 'LI', block);
    if (pos === 'before') block.before(b);
    else block.after(b);
    placed.set(a.id, { el: b, anchor: block });
    AN.save();
    return a;
  };

  AN.setTags = function (id, tags) {
    const a = AN.get(id);
    if (!a) return;
    a.tags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
    if (!a.tags.length) delete a.tags;
    a.updated = Date.now();
    AN.save();
  };

  /** All tags used in this conversation, most used first. */
  AN.allTags = function () {
    const n = new Map();
    for (const a of AN.all()) for (const t of a.tags || []) n.set(t, (n.get(t) || 0) + 1);
    return [...n.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t);
  };

  // ---------------------------------------------------------------------------
  // Drawings

  AN.drawingFor = function (msg, create) {
    for (const a of AN.all()) {
      if (a.kind !== 'drawing') continue;
      const p = placed.get(a.id);
      if (p && p.msg === msg && p.el.isConnected) return a;
    }
    if (!create || !conv) return null;
    const a = { id: CSR.uid('w'), kind: 'drawing', strokes: [], anchor: baseAnchor(msg) };
    push(a);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'csr-draw-layer');
    svg.setAttribute('data-csr-ui', '');
    svg.setAttribute('data-csr-draw-id', a.id);
    msg.setAttribute('data-csr-has-drawing', '');
    msg.appendChild(svg);
    placed.set(a.id, { el: svg, msg });
    return a;
  };

  AN.drawingLayers = function () {
    const out = [];
    for (const a of AN.all()) {
      if (a.kind !== 'drawing') continue;
      const p = placed.get(a.id);
      if (p && p.el.isConnected) out.push({ a, svg: p.el, msg: p.msg });
    }
    return out;
  };

  AN.rerenderDrawing = function (a) {
    const p = placed.get(a.id);
    if (p && p.el) CSR.draw.render(p.el, a.strokes);
    if (!a.strokes.length) {
      AN.remove(a.id);
      return;
    }
    a.updated = Date.now();
    AN.save();
  };

  // ---------------------------------------------------------------------------
  // Queries for the panel

  AN.elementFor = function (id) {
    const p = placed.get(id);
    if (!p) return null;
    return p.els ? p.els[0] : p.el;
  };

  AN.reveal = function (id) {
    const a = AN.get(id);
    const p = placed.get(id);
    if (!a || !p) return false;
    const el = p.els ? p.els[0] : a.kind === 'drawing' ? p.msg : p.el;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const flashEls = p.els || [p.el];
    flashEls.forEach((e) => e.classList && e.classList.add('csr-flash'));
    setTimeout(() => flashEls.forEach((e) => e.classList && e.classList.remove('csr-flash')), 1600);
    return true;
  };

  /** Annotations in reading order. */
  AN.sorted = function () {
    return AN.all()
      .slice()
      .sort((x, y) => (x.anchor.msg || 0) - (y.anchor.msg || 0) || (x.anchor.start ?? x.anchor.block ?? 0) - (y.anchor.start ?? y.anchor.block ?? 0));
  };

  AN.isOrphan = (a) => !!a._orphan && !placed.has(a.id);
})();
