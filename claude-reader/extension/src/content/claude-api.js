/* Claude's own (internal, undocumented) API on claude.ai, called with the
 * page's login: the organization, usage limits and the messages of a
 * conversation. Everything stays on claude.ai. */
(function () {
  const CSR = globalThis.CSR;
  if (CSR.site.id !== 'claude') return;

  const api = (CSR.claudeApi = {});
  let org = null;

  api.getJson = async function (path) {
    const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r.json();
  };

  async function orgFromList() {
    const list = await api.getJson('/api/organizations');
    const arr = Array.isArray(list) ? list : [];
    const pick = arr.find((o) => (o.capabilities || []).includes('chat')) || arr[0];
    if (!pick || !pick.uuid) throw Object.assign(new Error('no organization'), { status: 404 });
    return pick.uuid;
  }

  const cookieOrg = () => (document.cookie.match(/(?:^|;\s*)lastActiveOrg=([0-9a-f-]{36})/i) || [])[1] || null;

  /** GET `/api/organizations/<org>/<rest>`, finding the organization first. */
  api.orgGet = async function (rest) {
    const fromCookie = !org && cookieOrg();
    org = org || fromCookie || (await orgFromList());
    try {
      return await api.getJson(`/api/organizations/${org}/${rest}`);
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        // the cookie (or an earlier answer) pointed at another organization
        const again = await orgFromList();
        if (again !== org) {
          org = again;
          return api.getJson(`/api/organizations/${org}/${rest}`);
        }
      }
      throw e;
    }
  };

  function textOf(m) {
    if (Array.isArray(m.content) && m.content.length) {
      const t = m.content
        .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n\n');
      if (t) return t;
    }
    return typeof m.text === 'string' ? m.text : '';
  }

  /** The messages of the branch you're looking at, oldest first:
   * [{ role: 'user' | 'assistant', text }] (assistant text is Markdown). */
  api.conversation = async function (id) {
    const d = await api.orgGet(`chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`);
    const list = Array.isArray(d && d.chat_messages) ? d.chat_messages : [];
    const byId = new Map(list.map((m) => [m.uuid, m]));
    const branch = [];
    const seen = new Set();
    let cur = d.current_leaf_message_uuid && byId.get(d.current_leaf_message_uuid);
    while (cur && !seen.has(cur.uuid)) {
      seen.add(cur.uuid);
      branch.push(cur);
      cur = byId.get(cur.parent_message_uuid);
    }
    branch.reverse();
    const msgs = branch.length ? branch : list.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    return msgs.map((m) => ({ role: m.sender === 'human' ? 'user' : 'assistant', text: textOf(m) }));
  };
})();
