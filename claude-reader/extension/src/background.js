/* Background service worker: the pomodoro clock (so it keeps running when
 * tabs are closed or asleep), system notifications, and dictionary lookups
 * (the sites' CSP doesn't let the page itself call other sites). */
importScripts('shared/defaults.js', 'shared/storage.js');

const CSR = globalThis.CSR;
const KEY = 'pomo';
const IDLE = { phase: 'idle', running: false, endsAt: 0, left: 0, total: 0, cycle: 0, event: null };

// ---------------------------------------------------------------------------
// pomodoro

async function getState() {
  return { ...IDLE, ...((await chrome.storage.local.get(KEY))[KEY] || {}) };
}

async function setState(st) {
  await chrome.storage.local.set({ [KEY]: st });
  if (st.running) await chrome.alarms.create('pomo', { when: Math.max(Date.now() + 500, st.endsAt) });
  else await chrome.alarms.clear('pomo');
  return st;
}

function durationOf(s, phase) {
  const min = { focus: s.pomoFocus, short: s.pomoShort, long: s.pomoLong }[phase] || 25;
  return Math.max(1, min) * 60000;
}

const TEXT = {
  focus: (s) => ({
    title: `${CSR.faDuration(s.pomoFocus * 60)} مطالعه تمام شد 🌿`,
    message: `وقت استراحت است؛ ${CSR.faDuration(s.pomoShort * 60)} از صفحه دور شو.`,
  }),
  short: () => ({ title: 'استراحت تمام شد 📚', message: 'برگرد سر درس!' }),
  long: () => ({ title: 'استراحت طولانی تمام شد 📚', message: 'یک دور تازه‌ی مطالعه را شروع کن.' }),
};

async function finishPhase(st, { skipped } = {}) {
  const s = await CSR.store.getSettings();
  const now = Date.now();
  let next;
  let auto;
  let cycle = st.cycle;
  if (st.phase === 'focus') {
    cycle += 1;
    next = cycle % Math.max(1, s.pomoCycles) === 0 ? 'long' : 'short';
    auto = s.pomoAutoBreak;
  } else {
    next = 'focus';
    auto = s.pomoAutoFocus;
  }
  const total = durationOf(s, next);
  const nst = {
    phase: next,
    running: !!auto,
    endsAt: auto ? now + total : 0,
    left: auto ? 0 : total,
    total,
    cycle,
    event: skipped ? null : { id: CSR.uid('e'), ended: st.phase, next, at: now, auto: !!auto },
  };
  await setState(nst);
  if (!skipped && s.pomoNotify) {
    const t = TEXT[st.phase](s);
    chrome.notifications.create('pomo-' + now, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t.title,
      message: t.message,
      priority: 2,
    });
  }
  return nst;
}

async function command(cmd, arg) {
  const s = await CSR.store.getSettings();
  const st = await getState();
  const now = Date.now();
  switch (cmd) {
    case 'start': {
      if (st.running) return st;
      const phase = st.phase === 'idle' ? 'focus' : st.phase;
      const total = st.phase === 'idle' || !st.left ? durationOf(s, phase) : st.total || durationOf(s, phase);
      const left = st.phase === 'idle' || !st.left ? total : st.left;
      return setState({ ...st, phase, running: true, endsAt: now + left, left: 0, total, event: null });
    }
    case 'pause':
      if (!st.running) return st;
      return setState({ ...st, running: false, left: Math.max(0, st.endsAt - now), endsAt: 0 });
    case 'stop':
      return setState({ ...IDLE });
    case 'skip':
      if (st.phase === 'idle') return st;
      return finishPhase(st, { skipped: true });
    case 'extend': {
      // "5 more minutes" of the phase that just ended
      const phase = arg && arg.phase ? arg.phase : st.phase;
      const total = Math.max(1, (arg && arg.minutes) || 5) * 60000;
      const cycle = phase === 'focus' && st.event && st.event.ended === 'focus' ? Math.max(0, st.cycle - 1) : st.cycle;
      return setState({ ...st, phase, cycle, running: true, endsAt: now + total, left: 0, total, event: null });
    }
    case 'state':
      return st;
  }
  return st;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'pomo') return;
  const st = await getState();
  if (st.running && Date.now() >= st.endsAt - 1500) await finishPhase(st);
  else if (st.running) await setState(st); // woke up early: re-arm
});

// the sites the extension works on (same as the manifest's content scripts)
const SITE_TABS = ['https://claude.ai/*', 'https://*.notion.so/*', 'https://*.notion.com/*'];

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const [tab] = await chrome.tabs.query({ url: SITE_TABS });
  if (tab) {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  }
});

// ---------------------------------------------------------------------------
// dictionary

const dictCache = new Map();

async function fetchJson(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function lookup(word) {
  const w = word.trim().toLowerCase();
  if (dictCache.has(w)) return dictCache.get(w);
  const [mm, dd] = await Promise.allSettled([
    fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(w)}&langpair=en|fa`),
    fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`),
  ]);
  const out = { word: w, fa: [], phonetic: '', audio: '', meanings: [], ok: false };
  if (mm.status === 'fulfilled' && mm.value) {
    const seen = new Set();
    const add = (t) => {
      const clean = String(t || '').replace(/[.。]+$/, '').trim();
      if (!clean || !/[؀-ۿ]/.test(clean) || clean.length > 60 || seen.has(clean)) return;
      seen.add(clean);
      out.fa.push(clean);
    };
    add(mm.value.responseData && mm.value.responseData.translatedText);
    for (const m of mm.value.matches || []) if ((+m.match || 0) >= 0.5) add(m.translation);
    out.fa = out.fa.slice(0, 5);
  }
  if (dd.status === 'fulfilled' && Array.isArray(dd.value) && dd.value[0]) {
    const e = dd.value[0];
    out.phonetic = e.phonetic || ((e.phonetics || []).find((p) => p.text) || {}).text || '';
    out.audio = ((e.phonetics || []).find((p) => p.audio) || {}).audio || '';
    for (const entry of dd.value) {
      for (const m of entry.meanings || []) {
        if (out.meanings.length >= 3) break;
        if (out.meanings.some((x) => x.pos === m.partOfSpeech)) continue;
        out.meanings.push({
          pos: m.partOfSpeech,
          defs: (m.definitions || []).slice(0, 2).map((d) => d.definition),
          example: ((m.definitions || []).find((d) => d.example) || {}).example || '',
        });
      }
    }
  }
  out.ok = out.fa.length > 0 || out.meanings.length > 0;
  if (!out.ok && mm.status === 'rejected' && dd.status === 'rejected') out.error = 'network';
  if (out.ok) dictCache.set(w, out);
  return out;
}

// ---------------------------------------------------------------------------
// translation of a line / paragraph (MyMemory, free; ~500 bytes per request)

const trCache = new Map();
const bytes = (s) => new TextEncoder().encode(s).length;

/** Splits text into pieces under `max` UTF-8 bytes, at sentence ends when possible. */
function chunks(text, max = 480) {
  const out = [];
  for (const para of text.split(/\n+/)) {
    const sentences = para.match(/[^.!?؟…;؛]+[.!?؟…;؛]*\s*/g) || [para];
    let cur = '';
    for (let s of sentences) {
      while (bytes(s) > max) {
        // one very long sentence: cut at a comma or space
        let cut = s.length;
        while (cut > 1 && bytes(s.slice(0, cut)) > max) cut = Math.floor(cut * 0.8);
        const sp = Math.max(s.lastIndexOf('،', cut), s.lastIndexOf(',', cut), s.lastIndexOf(' ', cut));
        if (sp > cut * 0.5) cut = sp + 1;
        if (cur) out.push(cur), (cur = '');
        out.push(s.slice(0, cut));
        s = s.slice(cut);
      }
      if (bytes(cur + s) > max) out.push(cur), (cur = '');
      cur += s;
    }
    if (cur.trim()) out.push(cur);
    out.push('\n');
  }
  out.pop();
  return out;
}

const unescape = (s) =>
  String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

async function translate(text, from, to) {
  const key = from + to + text;
  if (trCache.has(key)) return trCache.get(key);
  const s = await CSR.store.getSettings();
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.translateEmail || '') ? '&de=' + encodeURIComponent(s.translateEmail) : '';
  let out = '';
  for (const c of chunks(text)) {
    if (c === '\n') {
      out += '\n';
      continue;
    }
    const j = await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(c.trim())}&langpair=${from}|${to}${email}`, 12000);
    const t = unescape(j && j.responseData && j.responseData.translatedText);
    if (+j.responseStatus === 429 || /MYMEMORY WARNING|USED ALL AVAILABLE FREE/i.test(t)) return { ok: false, error: 'quota' };
    if (!t || +j.responseStatus >= 400) return { ok: false, error: 'failed' };
    out += (out && !out.endsWith('\n') ? ' ' : '') + t.trim();
  }
  const res = { ok: true, text: out.trim(), engine: 'MyMemory' };
  trCache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// updates: an unpacked extension can't replace its own files, but it can tell
// you when a new version is out and where to get it

async function checkUpdate() {
  const current = chrome.runtime.getManifest().version;
  let best = null;
  // a source that doesn't exist (yet) just comes back rejected
  const found = await Promise.allSettled(CSR.UPDATE_SOURCES.map((url) => fetchJson(url + '?t=' + Date.now(), 10000)));
  for (const r of found) {
    const info = r.status === 'fulfilled' ? r.value : null;
    if (info && info.version && (!best || CSR.compareVersions(info.version, best.version) > 0)) best = info;
  }
  const update = {
    checked: Date.now(),
    current,
    latest: best ? best.version : current,
    notes: best && Array.isArray(best.notes) ? best.notes.slice(0, 12) : [],
    zip: best && /^https:\/\//.test(String(best.zip || '')) ? best.zip : '',
    available: !!best && CSR.compareVersions(best.version, current) > 0,
    error: best ? '' : 'offline',
  };
  await chrome.storage.local.set({ update });
  await chrome.action.setBadgeText({ text: update.available ? 'NEW' : '' });
  if (update.available) await chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
  return update;
}

chrome.alarms.get('update-check').then((a) => {
  if (!a) chrome.alarms.create('update-check', { delayInMinutes: 1, periodInMinutes: 360 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'update-check') checkUpdate();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  checkUpdate();
  if (details.reason === 'update') {
    // pages still running the old version's scripts: reload them
    const tabs = await chrome.tabs.query({ url: SITE_TABS });
    for (const t of tabs) chrome.tabs.reload(t.id);
  }
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// focus mode: whole-window fullscreen, like F11 (no tabs, no address bar)

async function setFullscreen(windowId, on) {
  const key = 'fs:' + windowId;
  const win = await chrome.windows.get(windowId);
  if (on) {
    if (win.state === 'fullscreen') return { ok: true, already: true };
    await chrome.storage.session.set({ [key]: win.state });
    await chrome.windows.update(windowId, { state: 'fullscreen' });
    return { ok: true };
  }
  // only undo a fullscreen we started ourselves
  const prev = (await chrome.storage.session.get(key))[key];
  if (!prev) return { ok: true };
  await chrome.storage.session.remove(key);
  if (win.state === 'fullscreen') await chrome.windows.update(windowId, { state: prev === 'minimized' ? 'normal' : prev });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !msg.csr) return;
  if (msg.csr === 'fullscreen') {
    if (!sender.tab) return;
    setFullscreen(sender.tab.windowId, !!msg.on).then(reply, (e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.csr === 'pomo') {
    command(msg.cmd, msg.arg).then(reply, (e) => reply({ error: String(e) }));
    return true;
  }
  if (msg.csr === 'checkUpdate') {
    checkUpdate().then(reply, (e) => reply({ error: String(e) }));
    return true;
  }
  if (msg.csr === 'reloadExtension') {
    chrome.runtime.reload();
    return;
  }
  if (msg.csr === 'translate') {
    translate(String(msg.text || '').slice(0, 4000), msg.from === 'fa' ? 'fa' : 'en', msg.to === 'en' ? 'en' : 'fa').then(reply, () =>
      reply({ ok: false, error: 'failed' })
    );
    return true;
  }
  if (msg.csr === 'dict') {
    lookup(msg.word).then(reply, (e) => reply({ ok: false, error: String(e) }));
    return true;
  }
});
