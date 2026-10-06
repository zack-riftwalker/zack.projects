import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;

const isRead = (sql: string) => /^\s*(select|with|pragma|explain)\b/i.test(sql);

class FakeStmt {
  constructor(private db: DatabaseSync, readonly sql: string, readonly args: unknown[] = [], private log: string[] = []) {}
  bind(...args: unknown[]) {
    for (const a of args) if (a === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
    return new FakeStmt(this.db, this.sql, args, this.log);
  }
  private exec(): { results: Row[]; meta: { changes: number; last_row_id: number } } {
    this.log.push(this.sql);
    const st = this.db.prepare(this.sql);
    if (isRead(this.sql)) {
      return { results: st.all(...(this.args as any[])) as Row[], meta: { changes: 0, last_row_id: 0 } };
    }
    const r = st.run(...(this.args as any[]));
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first<T = any>(col?: string): Promise<T | null> {
    const { results } = this.exec();
    const row = results[0];
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async all<T = any>() {
    return this.exec() as { results: T[]; meta: { changes: number; last_row_id: number } };
  }
  async run() {
    return this.exec();
  }
  async raw() {
    return this.exec().results.map((r) => Object.values(r));
  }
  _run() {
    return this.exec();
  }
}

export class FakeD1 {
  readonly sqlite: DatabaseSync;
  /** every executed SQL string (for write-count assertions) */
  log: string[] = [];
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
  }
  prepare(sql: string) {
    return new FakeStmt(this.sqlite, sql, [], this.log);
  }
  async batch(stmts: FakeStmt[]) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => s._run());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }
  async exec(sql: string) {
    this.sqlite.exec(sql);
  }
  migrate(dir: 'store' | 'monshi') {
    const base = join(process.cwd(), 'migrations', dir);
    for (const f of readdirSync(base).filter((n) => n.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(join(base, f), 'utf8'));
    }
    return this;
  }
  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}
