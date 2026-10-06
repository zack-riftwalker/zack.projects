import { type Env, parseIdList } from '../env';

export interface StoreConfig { token: string; adminIds: number[] }

/** Returns null (bot disabled) unless a token and at least one valid admin id are configured. */
export function storeConfig(env: Env): StoreConfig | null {
  const adminIds = parseIdList(env.STORE_ADMIN_IDS);
  if (!env.STORE_BOT_TOKEN || adminIds.length === 0) return null;
  return { token: env.STORE_BOT_TOKEN, adminIds };
}

export function isAdminId(cfg: StoreConfig, id: number | undefined): boolean {
  return id !== undefined && cfg.adminIds.includes(id);
}
