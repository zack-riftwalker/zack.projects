import { Api } from 'grammy';
import type { Env } from './env';
import { Budget, countedD1, installBudget, type Db } from './lib/budget';
import { storeConfig, type StoreConfig } from './store/config';
import { StoreDb } from './store/db';
import { monshiConfig, type MonshiConfig } from './monshi/config';
import { MonshiDb } from './monshi/db';
import { MonshiContext } from './monshi/context';

export interface Deps {
  makeApi?: (token: string) => Api;
  fetch?: typeof fetch;
  now?: () => Date;
  /** test hook: observe each invocation's budget */
  onBudget?: (b: Budget) => void;
}

export interface StoreApp {
  kind: 'store';
  cfg: StoreConfig;
  db: StoreDb;
  raw: Db;
  api: Api;
  apps: Apps;
}

export interface MonshiApp {
  kind: 'monshi';
  cfg: MonshiConfig;
  db: MonshiDb;
  raw: Db;
  api: Api;
  ctx: MonshiContext;
  apps: Apps;
}

export interface Apps {
  env: Env;
  budget: Budget;
  deps: Deps;
  fetch: typeof fetch;
  now(): Date;
  makeApi(token: string): Api;
  store: StoreApp | null;
  monshi: MonshiApp | null;
}

/** One invocation = one shared 50-call budget across both bots (the bridge runs in-process). */
export function createApps(env: Env, deps: Deps = {}): Apps {
  const budget = new Budget(50);
  deps.onBudget?.(budget);
  const makeApi = (token: string): Api => {
    const api = deps.makeApi ? deps.makeApi(token) : new Api(token);
    installBudget(api, budget);
    return api;
  };
  const apps: Apps = {
    env, budget, deps,
    fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
    now: deps.now ?? (() => new Date()),
    makeApi,
    store: null,
    monshi: null,
  };

  const sc = storeConfig(env);
  if (sc) {
    const raw = countedD1(env.STORE_DB, budget);
    apps.store = { kind: 'store', cfg: sc, db: new StoreDb(raw), raw, api: makeApi(sc.token), apps };
  }
  const mc = monshiConfig(env);
  if (mc) {
    const raw = countedD1(env.MONSHI_DB, budget);
    const db = new MonshiDb(raw);
    apps.monshi = { kind: 'monshi', cfg: mc, db, raw, api: makeApi(mc.token), ctx: new MonshiContext(db, mc.adminId), apps };
  }
  return apps;
}
