/* Storage helpers. Settings live in chrome.storage.sync (small, follows the
 * user's Chrome profile); annotations live in chrome.storage.local, one key
 * per conversation ("conv:<uuid>"). */
(function (root) {
  const CSR = (root.CSR = root.CSR || {});
  const CONV_PREFIX = 'conv:';

  const dead = () => CSR.alive && !CSR.alive(); // see CSR.alive

  async function syncGet(key) {
    if (dead()) return undefined;
    try {
      return (await chrome.storage.sync.get(key))[key];
    } catch (e) {
      return (await chrome.storage.local.get('fallback:' + key))['fallback:' + key];
    }
  }

  async function syncSet(key, value) {
    if (dead()) return;
    try {
      await chrome.storage.sync.set({ [key]: value });
    } catch (e) {
      // sync quota exceeded or unavailable: keep a local copy instead
      await chrome.storage.local.set({ ['fallback:' + key]: value });
    }
  }

  CSR.store = {
    CONV_PREFIX,

    async getSettings() {
      return CSR.deepMerge(CSR.DEFAULT_SETTINGS, (await syncGet('settings')) || {});
    },

    async saveSettings(settings) {
      await syncSet('settings', settings);
    },

    async patchSettings(patch) {
      const s = CSR.deepMerge(await CSR.store.getSettings(), patch);
      await CSR.store.saveSettings(s);
      return s;
    },

    onSettingsChanged(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        const c = changes.settings || changes['fallback:settings'];
        if (!c) return;
        if (area === 'sync' || area === 'local') cb(CSR.deepMerge(CSR.DEFAULT_SETTINGS, c.newValue || {}));
      });
    },

    emptyConv(id) {
      return { id, title: '', url: '', created: Date.now(), updated: 0, annotations: [], notebook: '' };
    },

    async getConv(id) {
      if (dead()) return CSR.store.emptyConv(id);
      const key = CONV_PREFIX + id;
      const r = await chrome.storage.local.get(key);
      return r[key] ? { ...CSR.store.emptyConv(id), ...r[key] } : CSR.store.emptyConv(id);
    },

    async saveConv(conv) {
      if (dead()) return;
      const key = CONV_PREFIX + conv.id;
      const p = conv.progress || {};
      const hasProgress = (p.read && Object.keys(p.read).length) || p.lastPos;
      if (!conv.annotations.length && !String(conv.notebook || '').trim() && !hasProgress && !(conv.tags && conv.tags.length)) {
        await chrome.storage.local.remove(key);
        return;
      }
      conv.updated = Date.now();
      await chrome.storage.local.set({ [key]: conv });
    },

    async deleteConv(id) {
      await chrome.storage.local.remove(CONV_PREFIX + id);
    },

    async listConvs() {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all)
        .filter(([k]) => k.startsWith(CONV_PREFIX))
        .map(([, v]) => v)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
