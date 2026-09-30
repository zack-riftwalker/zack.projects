/* Pencil / marker / straight line / eraser drawing on top of messages.
 * Strokes are stored per message, in pixels relative to the message box, so
 * they scroll together with the text. */
(function () {
  const CSR = globalThis.CSR;
  const dom = CSR.dom;
  const D = (CSR.draw = { active: false, tool: 'pen', color: '#e03131', width: 3 });

  const round = (n) => Math.round(n * 10) / 10;

  function pathD(p) {
    const n = p.length / 2;
    if (n === 0) return '';
    if (n === 1) return `M${p[0]} ${p[1]} l0.01 0`;
    let d = `M${p[0]} ${p[1]}`;
    for (let i = 1; i < n - 1; i++) {
      const x = p[2 * i];
      const y = p[2 * i + 1];
      const nx = p[2 * i + 2];
      const ny = p[2 * i + 3];
      d += ` Q${x} ${y} ${round((x + nx) / 2)} ${round((y + ny) / 2)}`;
    }
    d += ` L${p[2 * n - 2]} ${p[2 * n - 1]}`;
    return d;
  }

  function strokeEl(s) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD(s.pts));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color);
    path.setAttribute('stroke-linecap', s.tool === 'marker' ? 'butt' : 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', s.tool === 'marker' ? s.width * 4 : s.width);
    if (s.tool === 'marker') path.setAttribute('stroke-opacity', '0.35');
    path.setAttribute('data-sid', s.id);
    return path;
  }

  D.render = function (svg, strokes) {
    while (svg.firstChild) svg.firstChild.remove();
    for (const s of strokes) svg.appendChild(strokeEl(s));
  };

  // ---------------------------------------------------------------------------
  // Drawing mode

  let overlay = null;
  let current = null; // { a, msg, stroke, path }
  const undoStack = []; // { annId, stroke }

  function messageAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest && el.closest('#csr-host')) continue;
      const m = dom.messageOf(el);
      if (m) return m;
    }
    // in a margin: nearest message vertically
    let best = null;
    let bestD = Infinity;
    for (const m of dom.getMessages()) {
      const r = m.getBoundingClientRect();
      if (r.height === 0) continue;
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return bestD < 400 ? best : null;
  }

  function localPoint(msg, e) {
    const r = msg.getBoundingClientRect();
    return [round(e.clientX - r.left), round(e.clientY - r.top)];
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    if (D.tool === 'eraser') {
      eraseAt(e.clientX, e.clientY);
      current = { erasing: true };
      return;
    }
    const msg = messageAt(e.clientX, e.clientY);
    if (!msg) {
      CSR.ui && CSR.ui.toast('برای کشیدن، روی یکی از پیام‌ها بکش');
      return;
    }
    const a = CSR.ann.drawingFor(msg, true);
    if (!a) return;
    const [x, y] = localPoint(msg, e);
    const stroke = { id: CSR.uid('s'), tool: D.tool, color: D.color, width: D.width, pts: [x, y] };
    const svg = msg.querySelector(`:scope > .csr-draw-layer[data-csr-draw-id="${a.id}"]`);
    const path = strokeEl(stroke);
    svg && svg.appendChild(path);
    current = { a, msg, stroke, path, x0: x, y0: y };
  }

  function onMove(e) {
    if (!current) return;
    if (current.erasing) {
      eraseAt(e.clientX, e.clientY);
      return;
    }
    const { stroke, msg, path } = current;
    let [x, y] = localPoint(msg, e);
    if (stroke.tool === 'line') {
      // straight line; snaps to horizontal (Shift forces it)
      const dy = Math.abs(y - current.y0);
      const dx = Math.abs(x - current.x0);
      if (e.shiftKey || dy < Math.max(14, dx * 0.12)) y = current.y0;
      stroke.pts = [current.x0, current.y0, x, y];
    } else {
      const p = stroke.pts;
      const lx = p[p.length - 2];
      const ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 1.5) return;
      p.push(x, y);
    }
    path.setAttribute('d', pathD(stroke.pts));
  }

  function onUp() {
    if (!current) return;
    const c = current;
    current = null;
    if (c.erasing) return;
    if (c.stroke.pts.length === 2) c.stroke.pts.push(c.stroke.pts[0] + 0.01, c.stroke.pts[1]);
    c.a.strokes.push(c.stroke);
    undoStack.push({ annId: c.a.id, stroke: c.stroke });
    CSR.ann.rerenderDrawing(c.a);
  }

  function onWheel(e) {
    // keep the page scrollable while drawing
    e.preventDefault();
    const first = dom.getMessages()[0];
    const sc = first ? dom.scrollParent(first) : document.scrollingElement;
    sc.scrollBy({ top: e.deltaY, left: e.deltaX });
  }

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function eraseAt(cx, cy) {
    for (const { a, msg } of CSR.ann.drawingLayers()) {
      const r = msg.getBoundingClientRect();
      const x = cx - r.left;
      const y = cy - r.top;
      const before = a.strokes.length;
      a.strokes = a.strokes.filter((s) => {
        const w = (s.tool === 'marker' ? s.width * 4 : s.width) / 2 + 8;
        const p = s.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          if (distToSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < w) return false;
        }
        return true;
      });
      if (a.strokes.length !== before) CSR.ann.rerenderDrawing(a);
    }
  }

  D.undo = function () {
    while (undoStack.length) {
      const { annId, stroke } = undoStack.pop();
      const a = CSR.ann.get(annId);
      if (!a) continue;
      const i = a.strokes.indexOf(stroke);
      if (i < 0) continue;
      a.strokes.splice(i, 1);
      CSR.ann.rerenderDrawing(a);
      return true;
    }
    return false;
  };

  D.clearAll = function () {
    for (const a of CSR.ann.all().filter((x) => x.kind === 'drawing')) CSR.ann.remove(a.id);
    undoStack.length = 0;
  };

  D.enable = function (root) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'draw-overlay';
      overlay.addEventListener('pointerdown', onDown);
      overlay.addEventListener('pointermove', onMove);
      overlay.addEventListener('pointerup', onUp);
      overlay.addEventListener('pointercancel', onUp);
      overlay.addEventListener('wheel', onWheel, { passive: false });
    }
    root.appendChild(overlay);
    overlay.setAttribute('data-tool', D.tool);
    D.active = true;
  };

  D.setTool = function (tool) {
    D.tool = tool;
    if (overlay) overlay.setAttribute('data-tool', tool);
  };

  D.disable = function () {
    onUp();
    if (overlay) overlay.remove();
    D.active = false;
  };
})();
