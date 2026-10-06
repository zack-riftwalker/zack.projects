import { type Env, parseIdList } from '../env';

export interface MonshiConfig {
  token: string;
  adminId: number;
  notifyIds: number[];
  allNotifyIds: number[];
  geminiKey: string | null;
}

/** Returns null (bot disabled) unless a token and a valid admin user id are configured. */
export function monshiConfig(env: Env): MonshiConfig | null {
  const adminId = Number(env.MONSHI_ADMIN_USER_ID);
  if (!env.MONSHI_BOT_TOKEN || !Number.isInteger(adminId) || adminId <= 0) return null;
  const notifyIds = parseIdList(env.MONSHI_NOTIFY_USER_IDS);
  return {
    token: env.MONSHI_BOT_TOKEN, adminId, notifyIds,
    allNotifyIds: [adminId, ...notifyIds.filter((i) => i !== adminId)],
    geminiKey: env.GEMINI_API_KEY || null,
  };
}
