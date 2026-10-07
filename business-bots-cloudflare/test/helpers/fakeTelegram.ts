import { Api } from 'grammy';

export interface Call { token: string; method: string; payload: any }

/**
 * Rough legacy-Markdown parse check, like Telegram's "can't parse entities": every unescaped
 * `_`, `*` and backtick must be balanced (backtick spans are literal inside).
 */
export function markdownError(text: string): string | null {
  const plain = String(text).replace(/\\[_*`\[]/g, '');
  const outsideCode = plain.replace(/`[^`]*`/g, '');
  if ((plain.match(/`/g) ?? []).length % 2) return 'unclosed `';
  for (const ch of ['_', '*']) {
    if ((outsideCode.split(ch).length - 1) % 2) return 'unclosed ' + ch;
  }
  return null;
}

type Rule = { method: string; when: (c: Call) => boolean; code: number; description: string; times: number };

export function makeFakeTelegram() {
  const calls: Call[] = [];
  const rules: Rule[] = [];
  let mid = 1000;
  const botName: Record<string, string> = {};

  const canned = (call: Call): any => {
    const { method, payload, token } = call;
    switch (method) {
      case 'getMe':
        return { id: 900 + (token.length % 50), is_bot: true, first_name: 'Bot', username: (botName[token] ?? token.replace(/\W/g, '')) + '_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
      case 'sendMessage':
      case 'sendChecklist':
      case 'editMessageChecklist':
        return { message_id: ++mid, date: 0, chat: { id: payload?.chat_id, type: 'private' }, text: payload?.text };
      case 'getBusinessConnection':
      {
        // connection ids starting with 'foreign' belong to some other Telegram Business account
        const uid = String(payload?.business_connection_id).startsWith('foreign') ? 9999 : 5001;
        return { id: payload?.business_connection_id, user: { id: uid, is_bot: false, first_name: 'Owner' }, user_chat_id: uid, date: 0, rights: { can_reply: true }, is_enabled: true };
      }
      case 'copyMessage':
        return { message_id: ++mid };
      case 'createForumTopic':
        return { message_thread_id: ++mid, name: payload?.name, icon_color: payload?.icon_color ?? 0x6FB9F0 };
      case 'sendPhoto':
      case 'sendDocument':
      case 'sendVideo':
      case 'sendVoice':
      case 'sendAudio':
      case 'sendAnimation':
      case 'sendSticker':
        return { message_id: ++mid, date: 0, chat: { id: payload?.chat_id, type: 'private' } };
      default:
        return true;
    }
  };

  const makeApi = (token: string): Api => {
    const api = new Api(token);
    api.config.use(async (_prev, method, payload) => {
      const call: Call = { token, method, payload };
      calls.push(call);
      const pm = (payload as any)?.parse_mode;
      const md = pm === 'Markdown' ? markdownError((payload as any).text ?? (payload as any).caption ?? '') : null;
      if (md) {
        return { ok: false, error_code: 400, description: "Bad Request: can't parse entities: " + md } as any;
      }
      const rule = rules.find((r) => r.times !== 0 && r.method === method && r.when(call));
      if (rule) {
        if (rule.times > 0) rule.times -= 1;
        return { ok: false, error_code: rule.code, description: rule.description } as any;
      }
      return { ok: true, result: canned(call) } as any;
    });
    return api;
  };

  return {
    calls,
    makeApi,
    setBotName(token: string, name: string) { botName[token] = name; },
    /** Make matching calls fail with a Telegram error. times<0 = always. */
    fail(method: string, when: (c: Call) => boolean, code = 403, description = 'Forbidden: bot was blocked by the user', times = -1) {
      rules.push({ method, when, code, description, times });
    },
    clearRules() { rules.length = 0; },
    of(method: string, chatId?: number) {
      return calls.filter((c) => c.method === method && (chatId === undefined || c.payload?.chat_id === chatId));
    },
    texts(chatId: number) {
      return calls.filter((c) => c.method === 'sendMessage' && c.payload?.chat_id === chatId).map((c) => c.payload.text as string);
    },
    reset() { calls.length = 0; },
  };
}

export type FakeTelegram = ReturnType<typeof makeFakeTelegram>;
