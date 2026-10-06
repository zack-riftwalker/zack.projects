import type { Api } from 'grammy';
import { createApps, type Deps } from './apps';
import type { Env } from './env';
import { setAppState } from './lib/appstate';
import { clearBotInfoCache } from './lib/botinfo';
import type { Db } from './lib/budget';

const STORE_ALLOWED_UPDATES = ['message', 'callback_query'];
const MONSHI_ALLOWED_UPDATES = ['message', 'callback_query', 'business_connection', 'business_message'];

interface BotReport {
  enabled: boolean;
  ok?: boolean;
  username?: string;
  webhook?: string;
  error?: string;
  problems: string[];
}

async function setupOne(
  which: 'store' | 'monshi', origin: string, secret: string, api: Api, db: Db, allowed: string[], maxConnections: number,
): Promise<Partial<BotReport>> {
  try {
    const me = await api.getMe();
    await setAppState(db, 'bot_info', JSON.stringify(me));
    const webhook = origin + '/tg/' + which;
    await api.setWebhook(webhook, {
      secret_token: secret,
      allowed_updates: allowed as any,
      max_connections: maxConnections,
      drop_pending_updates: false,
    });
    return { ok: true, username: me.username, webhook };
  } catch (err: any) {
    return { ok: false, error: err?.description ?? err?.message ?? String(err) };
  }
}

/** GET /setup?key=<WEBHOOK_SECRET> — registers both webhooks and reports config problems. */
export async function handleSetup(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(req.url);
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  clearBotInfoCache();
  const apps = createApps(env, deps);
  const origin = url.origin;

  const store: BotReport = { enabled: !!apps.store, problems: [] };
  if (!env.STORE_BOT_TOKEN) store.problems.push('STORE_BOT_TOKEN is not set');
  if (!env.STORE_ADMIN_IDS || !/\d/.test(env.STORE_ADMIN_IDS)) store.problems.push('STORE_ADMIN_IDS is empty or invalid');
  if (apps.store) Object.assign(store, await setupOne('store', origin, env.WEBHOOK_SECRET, apps.store.api, apps.store.raw, STORE_ALLOWED_UPDATES, 1));

  const monshi: BotReport & { gemini?: boolean } = { enabled: !!apps.monshi, problems: [] };
  if (!env.MONSHI_BOT_TOKEN) monshi.problems.push('MONSHI_BOT_TOKEN is not set');
  if (!(Number(env.MONSHI_ADMIN_USER_ID) > 0)) monshi.problems.push('MONSHI_ADMIN_USER_ID is empty or invalid');
  monshi.gemini = !!env.GEMINI_API_KEY;
  if (apps.monshi) Object.assign(monshi, await setupOne('monshi', origin, env.WEBHOOK_SECRET, apps.monshi.api, apps.monshi.raw, MONSHI_ALLOWED_UPDATES, 3));

  return new Response(JSON.stringify({ store, monshi }, null, 2), { headers: { 'content-type': 'application/json' } });
}
