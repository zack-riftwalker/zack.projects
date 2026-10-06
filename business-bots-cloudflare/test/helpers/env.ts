import type { Budget } from '../../src/lib/budget';
import { FakeD1 } from './fakeD1';
import { makeFakeTelegram, type FakeTelegram } from './fakeTelegram';
import { makeWorker } from '../../src/index';
import { clearBotInfoCache } from '../../src/lib/botinfo';
import { createApps, type Apps, type Deps } from '../../src/apps';
import { runCron } from '../../src/cron';
import type { Env } from '../../src/env';

export const budgets: Budget[] = [];

export const SECRET = 'test-secret';
export const STORE_TOKEN = 'store-token';
export const MONSHI_TOKEN = 'monshi-token';
export const ADMIN = { id: 1001, first_name: 'Admin' };
export const ADMIN2 = { id: 1002, first_name: 'Admin2' };
export const OWNER = { id: 5001, first_name: 'Owner' };

export interface TestEnv {
  env: Env;
  storeDb: FakeD1;
  monshiDb: FakeD1;
  tg: FakeTelegram;
  deps: Deps;
  worker: ReturnType<typeof makeWorker>;
  /** Sends an update to a bot through the real Worker entry (new bot instance per update). */
  send(which: 'store' | 'monshi', update: any): Promise<Response>;
  cron(now?: Date): Promise<void>;
  apps(): Apps;
  /** highest budget.used seen over any invocation */
  maxBudget: number;
}

const ctxStub: any = { waitUntil() {}, passThroughOnException() {} };

export function makeTestEnv(opts: {
  store?: boolean; monshi?: boolean; adminIds?: string; notify?: string; gemini?: boolean; fetch?: typeof fetch;
} = {}): TestEnv {
  clearBotInfoCache();
  const storeDb = new FakeD1().migrate('store');
  const monshiDb = new FakeD1().migrate('monshi');
  const tg = makeFakeTelegram();
  tg.setBotName(STORE_TOKEN, 'store');
  tg.setBotName(MONSHI_TOKEN, 'monshi');
  const env: Env = {
    STORE_DB: storeDb.asD1(),
    MONSHI_DB: monshiDb.asD1(),
    WEBHOOK_SECRET: SECRET,
    STORE_ADMIN_IDS: opts.adminIds ?? '1001,1002',
    MONSHI_ADMIN_USER_ID: String(OWNER.id),
    MONSHI_NOTIFY_USER_IDS: opts.notify ?? '',
  };
  if (opts.store !== false) env.STORE_BOT_TOKEN = STORE_TOKEN;
  if (opts.monshi !== false) env.MONSHI_BOT_TOKEN = MONSHI_TOKEN;
  if (opts.gemini) env.GEMINI_API_KEY = 'gem-key';
  const t: TestEnv = {
    env, storeDb, monshiDb, tg,
    deps: {
      makeApi: tg.makeApi,
      fetch: opts.fetch ?? (async () => { throw new Error('unexpected network fetch'); }),
      onBudget: (b) => { budgets.push(b); },
    },
    worker: undefined as any,
    maxBudget: 0,
    async send(which, update) {
      // wrap createApps via deps to observe budget: use a spying makeApi
      const res = await t.worker.fetch(
        new Request('https://example.test/tg/' + which, {
          method: 'POST', body: JSON.stringify(update),
          headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET, 'content-type': 'application/json' },
        }),
        env, ctxStub,
      );
      return res;
    },
    async cron(now = new Date()) {
      await runCron(env, now, t.deps);
    },
    apps() {
      return createApps(env, t.deps);
    },
  };
  t.worker = makeWorker(t.deps);
  return t;
}
