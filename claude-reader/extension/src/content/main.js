/* Entry point: loads settings, follows Claude's SPA navigation, watches the
 * DOM for new/re-rendered messages and keeps everything applied. */
(async function () {
  const CSR = globalThis.CSR;
  const { dom, appearance: A, ann: AN, ui: UI, SEL } = CSR;

  CSR.settings = await CSR.store.getSettings();
  A.apply(CSR.settings); // as early as possible, to avoid a flash of the old font

  if (document.readyState === 'loading') {
    await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }
  await UI.init();
  UI.applySettings(CSR.settings);
  CSR.study.init();
  AN.onChange(() => UI.refreshPanel());

  // ---------------------------------------------------------------------------
  // sync loop

  const lastMutation = new WeakMap();
  const seen = new WeakSet();
  const dirty = new Set();
  let forceAll = true;
  let timer = 0;

  const isStable = (m) => !dom.isStreaming(m) && Date.now() - (lastMutation.get(m) || 0) > 700;

  function scheduleSync(force, delay = 200) {
    if (force) forceAll = true;
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  function sync() {
    timer = 0;
    if (CSR.dead) return;
    const s = CSR.settings;
    if (!A.styleConnected()) A.apply(s); // the page dropped our <style>: put it back
    const messages = dom.getMessages();
    const todo = forceAll ? messages : messages.filter((m) => dirty.has(m) || !seen.has(m));
    for (const m of todo) {
      A.processRtl(m, s);
      seen.add(m);
    }
    A.markColumn(messages, s);
    let waiting = false;
    if (s.enabled) waiting = AN.sync(messages, isStable, forceAll);
    if (A.markGlyphs(messages, todo, isStable)) waiting = true;
    if (CSR.themeFix.sync(messages, todo, isStable)) waiting = true;
    CSR.focus.refresh(forceAll || todo.length > 0);
    if (forceAll || todo.length) CSR.toc.refresh();
    dirty.clear();
    forceAll = false;
    observer.takeRecords(); // drop the mutations we just made ourselves
    if (waiting) scheduleSync(false, 900);
  }

  function isOurs(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !el || !!el.closest('[data-csr-ui]');
  }

  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const r of records) {
      if (isOurs(r.target)) continue;
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el && el.closest(SEL.editor) && !(CSR.site.id === 'notion' && dom.messageOf(el))) continue; // typing in the composer (or a Notion page)
      const m = dom.messageOf(r.target);
      if (m) {
        dirty.add(m);
        lastMutation.set(m, Date.now());
        relevant = true;
      } else if (r.addedNodes.length || r.removedNodes.length) {
        relevant = true;
      }
    }
    if (relevant) scheduleSync();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Claude switching light/dark, or dropping our attributes on <html>
  const modeObserver = new MutationObserver(() => {
    const s = CSR.settings;
    if (s.enabled && !document.documentElement.hasAttribute('data-csr-on')) A.apply(s);
    A.syncMode(s);
    UI.applySettings(s);
  });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-csr-on', 'class', 'data-theme', 'data-color-scheme'] });

  // ---------------------------------------------------------------------------
  // settings

  CSR.store.onSettingsChanged((s) => {
    const prev = CSR.settings;
    CSR.settings = s;
    A.apply(s);
    UI.applySettings(s);
    CSR.ruler.applySettings(s);
    CSR.study.applySettings(s);
    if (prev.focusHideUser !== s.focusHideUser) CSR.focus.refresh(true);
    if (prev.autoProgress !== s.autoProgress) CSR.toc.refresh();
    if (prev.enabled !== s.enabled) {
      if (!s.enabled) {
        AN.unplaceAll();
        A.clearRtl();
        UI.closePopover();
        UI.hideSelectionToolbar();
        CSR.tts.stop();
        if (CSR.ruler.on) CSR.ruler.toggle(false);
        if (CSR.focus.on) CSR.focus.toggle(false);
        if (CSR.toc.open) CSR.toc.toggle(false);
        observer.takeRecords(); // our own unwrapping shouldn't mark messages as "changing"
      }
      scheduleSync(true, 0);
    } else if (prev.rtlMode !== s.rtlMode || prev.contentWidth !== s.contentWidth) {
      scheduleSync(true, 0);
    } else {
      scheduleSync(false, 60); // e.g. another theme: text contrast is measured again
    }
  });

  // ---------------------------------------------------------------------------
  // conversation tracking (Claude is a single-page app)

  let convId;
  let loading = null;

  async function checkUrl() {
    const id = dom.getConversationId();
    if (id === convId || loading) return;
    loading = (async () => {
      await AN.flush();
      convId = id;
      UI.setMode('none');
      UI.closePopover();
      UI.hideSelectionToolbar();
      CSR.tts.stop();
      CSR.dict.close();
      CSR.translate.close();
      AN.setConv(null);
      if (id) {
        const c = await CSR.store.getConv(id);
        if (dom.getConversationId() === id) {
          AN.setConv(c);
          CSR.toc.onConvLoaded();
        }
      }
      scheduleSync(true, 50);
    })();
    await loading;
    loading = null;
  }
  checkUrl();
  const urlTimer = setInterval(() => {
    if (!CSR.alive()) return shutdown();
    checkUrl();
  }, 600);

  /** The extension was reloaded or updated while this page stayed open: this
   * old copy steps aside (the page gets the new one when it's reloaded). */
  function shutdown() {
    if (CSR.dead) return;
    CSR.dead = true;
    clearInterval(urlTimer);
    clearTimeout(timer);
    observer.disconnect();
    modeObserver.disconnect();
    const host = document.getElementById('csr-host');
    if (host) host.remove();
  }

  // changes made from another tab or the library page
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !convId) return;
    const c = changes[CSR.store.CONV_PREFIX + convId];
    if (!c || Date.now() - AN.lastSavedAt < 1500) return;
    AN.setConv(c.newValue ? { ...CSR.store.emptyConv(convId), ...c.newValue } : CSR.store.emptyConv(convId));
    scheduleSync(true, 0);
  });

  window.addEventListener('pagehide', () => AN.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') AN.flush();
  });

  // ---------------------------------------------------------------------------
  // keyboard shortcuts (e.code, so they work with a Persian keyboard layout too)

  document.addEventListener(
    'keydown',
    (e) => {
      const s = CSR.settings;
      if (!s.enabled || CSR.dead) return;
      if (e.key === 'Escape') {
        const busy = UI.mode !== 'none';
        if (busy) UI.setMode('none');
        UI.closePopover();
        UI.hideSelectionToolbar();
        CSR.dict.close();
        CSR.translate.close();
        // Esc in Claude's message box (or one of our own fields) isn't meant for focus mode / reading
        if (busy || dom.isEditable(e.composedPath()[0])) return;
        if (CSR.tts.active) CSR.tts.stop();
        else if (CSR.focus.on) CSR.focus.toggle(false);
        return;
      }
      if (UI.mode === 'draw' && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        CSR.draw.undo();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (dom.isEditable(e.target)) return;
      if (CSR.site.id === 'notion' && !CSR.notion.chat) return; // Notion without its AI chat open: not ours
      // typing in one of our own fields (inside the shadow root)
      if (e.composedPath().some((n) => n.nodeType === 1 && /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName))) return;

      const hasSel = !!AN.selectionInMessage();
      const code = e.code;
      let done = true;
      const digit = /^Digit([0-9])$/.exec(code);
      if (hasSel && digit && +digit[1] >= 1 && +digit[1] <= CSR.HIGHLIGHTS.length) {
        const c = CSR.HIGHLIGHTS[+digit[1] - 1].id;
        UI.act(() => AN.applyStyleToSelection('hl', c), c);
      } else if (hasSel && (code === 'Digit0' || code === 'KeyX')) UI.act(() => AN.removeMarksInSelection());
      else if (hasSel && code === 'KeyB') UI.act(() => AN.applyStyleToSelection('bold'));
      else if (hasSel && code === 'KeyI') UI.act(() => AN.applyStyleToSelection('italic'));
      else if (hasSel && code === 'KeyU') UI.act(() => AN.applyStyleToSelection('underline'));
      else if (hasSel && code === 'KeyS') UI.act(() => AN.applyStyleToSelection('strike'));
      else if (hasSel && code === 'KeyQ') UI.act(() => AN.toggleBlockOnSelection('quote'));
      else if (hasSel && code === 'KeyN') UI.noteOnSelection();
      else if (code === 'KeyY' && CSR.translate.fromSelection()) {
        /* translated the selection */
      }
      else if (code === 'KeyP') UI.setMode(UI.mode === 'draw' ? 'none' : 'draw');
      else if (code === 'KeyG') UI.setMode(UI.mode === 'bookmark' ? 'none' : 'bookmark');
      else if (code === 'KeyT') CSR.toc.toggle();
      else if (code === 'KeyV') CSR.tts.toggle();
      else if (code === 'KeyK') CSR.ruler.toggle();
      else if (code === 'KeyZ') CSR.focus.toggle();
      else if (code === 'KeyL') UI.setMode(UI.mode === 'divider' ? 'none' : 'divider');
      else if (code === 'KeyM') UI.togglePanel();
      else if (code === 'KeyR') UI.cycleRtl();
      else if (code === 'KeyH') UI.toggleHighlighter();
      else done = false;
      if (done) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // popup → page commands
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || !msg.csr) return;
    if (msg.csr === 'openPanel') UI.togglePanel(true);
    else if (msg.csr === 'mode') UI.setMode(msg.mode);
    else if (msg.csr === 'diag') reply({ report: CSR.diag() });
    else if (msg.csr === 'stats') {
      const conv = AN.conv();
      reply({ convId, count: conv ? conv.annotations.length : 0, title: conv ? conv.title : '' });
    }
  });

  /** Full placement pass soon (e.g. after scrolling rows of the virtual list in). */
  CSR.resync = () => scheduleSync(true, 0);
  CSR.debug = { sync: CSR.resync };
})();
