import type { Db } from '../lib/budget';

/** Per-request cache of the store_kv table (rule R2): the first read loads every row in one query. */
export class StoreKv {
  private map?: Map<string, string>;
  constructor(private db: Db) {}

  private async load(): Promise<Map<string, string>> {
    if (!this.map) {
      const r = await this.db.prepare('SELECT key, value FROM store_kv').all<{ key: string; value: string }>();
      this.map = new Map(r.results.map((x) => [x.key, x.value]));
    }
    return this.map;
  }

  async get(key: string): Promise<string | null> {
    return (await this.load()).get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const map = await this.load();
    await this.db.prepare(
      "INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, datetime('now', '+03:30')) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).bind(key, value).run();
    map.set(key, value);
  }
}
