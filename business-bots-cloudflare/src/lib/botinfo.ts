import type { Api } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Db } from './budget';
import { getAppState, setAppState } from './appstate';

const cache = new Map<string, UserFromGetMe>();

export function clearBotInfoCache(): void {
  cache.clear();
}

/** module cache → app_state row → getMe() (then stored). */
export async function getBotInfo(which: string, db: Db, api: Api): Promise<UserFromGetMe> {
  const hit = cache.get(which);
  if (hit) return hit;
  const stored = await getAppState(db, 'bot_info');
  if (stored) {
    try {
      const info = JSON.parse(stored) as UserFromGetMe;
      cache.set(which, info);
      return info;
    } catch { /* fall through to getMe */ }
  }
  const info = await api.getMe();
  await setAppState(db, 'bot_info', JSON.stringify(info));
  cache.set(which, info);
  return info;
}
