import type { Api } from 'grammy';

export class BudgetExceededError extends Error {
  constructor() {
    super('Subrequest budget exceeded');
    this.name = 'BudgetExceededError';
  }
}

/** Counts every Telegram / Gemini / D1 call of one Worker invocation (free plan: 50). */
export class Budget {
  exceeded = false;
  constructor(public limit = 50, public used = 0) {}
  take(n = 1): void {
    if (this.used + n > this.limit) {
      this.exceeded = true;
      throw new BudgetExceededError();
    }
    this.used += n;
  }
  remaining(): number {
    return this.limit - this.used;
  }
}

export interface DbMeta { changes: number; last_row_id: number }
export interface DbResult<T = any> { results: T[]; meta: DbMeta }

export interface Stmt {
  bind(...args: unknown[]): Stmt;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<DbResult<T>>;
  run(): Promise<DbResult>;
}

export interface Db {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<DbResult[]>;
}

const clean = (args: unknown[]) => args.map((a) => (a === undefined ? null : a));

class CountedStmt implements Stmt {
  constructor(public readonly inner: D1PreparedStatement, private budget: Budget) {}
  bind(...args: unknown[]): Stmt {
    return new CountedStmt(this.inner.bind(...clean(args)), this.budget);
  }
  async first<T = any>(): Promise<T | null> {
    this.budget.take();
    return (await this.inner.first<T>()) ?? null;
  }
  async all<T = any>(): Promise<DbResult<T>> {
    this.budget.take();
    const r = await this.inner.all<T>();
    return { results: r.results ?? [], meta: r.meta as unknown as DbMeta };
  }
  async run(): Promise<DbResult> {
    this.budget.take();
    const r = await this.inner.run();
    return { results: (r.results as any[]) ?? [], meta: r.meta as unknown as DbMeta };
  }
}

/** Wraps a D1 database so every query (each statement of a batch) is counted. */
export function countedD1(db: D1Database, budget: Budget): Db {
  return {
    prepare: (sql: string) => new CountedStmt(db.prepare(sql), budget),
    async batch(stmts: Stmt[]): Promise<DbResult[]> {
      budget.take(stmts.length);
      const rs = await db.batch((stmts as CountedStmt[]).map((s) => s.inner));
      return rs.map((r) => ({ results: (r.results as any[]) ?? [], meta: r.meta as unknown as DbMeta }));
    },
  };
}

/** grammY transformer: every Telegram API call spends one unit of budget. */
export function installBudget(api: Api, budget: Budget): void {
  api.config.use((prev, method, payload, signal) => {
    budget.take();
    return prev(method, payload, signal);
  });
}
