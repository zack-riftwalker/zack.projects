import type { Db } from './budget';

export async function getAppState(db: Db, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(key).first<{ value: string | null }>();
  return row?.value ?? null;
}

export async function setAppState(db: Db, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, new Date().toISOString())
    .run();
}
