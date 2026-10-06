import type { StorageAdapter } from 'grammy';
import type { Db } from './budget';

/** grammY session storage on D1. Skips no-op writes (rule R5). One instance per request. */
export class D1SessionStorage<T> implements StorageAdapter<T> {
  private lastRaw = new Map<string, string | undefined>();
  constructor(private db: Db) {}

  async read(key: string): Promise<T | undefined> {
    const row = await this.db.prepare('SELECT value FROM sessions WHERE key = ?').bind(key).first<{ value: string }>();
    this.lastRaw.set(key, row?.value);
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  async write(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value);
    const prev = this.lastRaw.get(key);
    if (raw === prev) return;
    if (raw === '{}' && prev === undefined) return;
    this.lastRaw.set(key, raw);
    await this.db
      .prepare(
        'INSERT INTO sessions (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .bind(key, raw, new Date().toISOString())
      .run();
  }

  async delete(key: string): Promise<void> {
    this.lastRaw.set(key, undefined);
    await this.db.prepare('DELETE FROM sessions WHERE key = ?').bind(key).run();
  }
}
