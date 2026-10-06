import type { Bot } from 'grammy';
import { createApps, type Deps } from './apps';
import { runCron } from './cron';
import type { Env } from './env';
import { getBotInfo } from './lib/botinfo';
import { handleSetup } from './setup';
import { createStoreBot } from './store/bot';

const WEBHOOK_WAIT_MS = 25_000;

async function buildBot(which: 'store' | 'monshi', apps: ReturnType<typeof createApps>): Promise<Bot<any> | null> {
  if (which === 'store') {
    if (!apps.store) return null;
    const info = await getBotInfo('store', apps.store.raw, apps.store.api);
    return createStoreBot(apps.store, info);
  }
  return null; // monshi is wired in M7
}

async function webhook(which: 'store' | 'monshi', req: Request, env: Env, ctx: ExecutionContext, deps: Deps): Promise<Response> {
  if (!env.WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch (err) {
    console.error('Bad webhook body for ' + which, err);
    return new Response('ok');
  }

  const apps = createApps(env, deps);
  const work = (async () => {
    const bot = await buildBot(which, apps);
    if (!bot) {
      console.warn('⚠️ [Webhook] Bot "' + which + '" is disabled (missing token/admin config) — update ignored.');
      return;
    }
    await bot.handleUpdate(update);
  })().catch((err) => console.error('❌ [Webhook] ' + which + ' handler failed:', err?.message ?? err));

  ctx.waitUntil(work);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, WEBHOOK_WAIT_MS); })]);
  if (timer) clearTimeout(timer);
  // Always 200 for authenticated calls: a 5xx makes Telegram retry and block the bot.
  return new Response('ok');
}

export interface Worker {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
}

export function makeWorker(deps: Deps = {}): Worker {
  return {
    async fetch(req, env, ctx) {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/tg/store') return webhook('store', req, env, ctx, deps);
      if (req.method === 'POST' && url.pathname === '/tg/monshi') return webhook('monshi', req, env, ctx, deps);
      if (req.method === 'GET' && url.pathname === '/setup') return handleSetup(req, env, deps);
      if (url.pathname === '/health') return new Response('ok');
      return new Response('not found', { status: 404 });
    },
    async scheduled(controller, env, ctx) {
      ctx.waitUntil(runCron(env, new Date(controller.scheduledTime), deps));
    },
  };
}

export default makeWorker();
