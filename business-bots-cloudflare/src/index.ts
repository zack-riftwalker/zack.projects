import type { Env } from './env';

async function webhook(which: 'store' | 'monshi', req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  if (!env.WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    await req.json();
  } catch (err) {
    console.error('Bad webhook body for ' + which, err);
  }
  return new Response('ok');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/tg/store') return webhook('store', req, env, ctx);
    if (req.method === 'POST' && url.pathname === '/tg/monshi') return webhook('monshi', req, env, ctx);
    if (url.pathname === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {},
} satisfies ExportedHandler<Env>;
