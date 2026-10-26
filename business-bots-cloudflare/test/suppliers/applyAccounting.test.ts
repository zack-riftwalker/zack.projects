import { describe, expect, it } from 'vitest';
import { makeTestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one } from '../helpers/seed';
import { applyCatalog, syncSupplier } from '../../src/store/suppliers/sync';
import { addSupplierOk, setDefaults } from './helpers';

describe('apply loop counts the statements an option really cost (review nit: budget accounting)', () => {
  it('options that change nothing cost 4 statements, so a tick (cap 20) covers 5 of them, not 4', async () => {
    const fake = makeFakeAriobox();
    const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
    fake.state.usdToman = 150000;
    fake.state.items = Array.from({ length: 12 }, (_, i) => fake.item('2' + String(i).padStart(3, '0'), '', 'G' + i, i + 1));
    await setDefaults(t);
    const sid = await addSupplierOk(t, fake);
    for (let i = 0; i < 12; i++) {
      const id = Number(t.storeDb.sqlite.prepare(
        "INSERT INTO customer_products (name, price, pricing_mode, stock_mode) VALUES (?, 1, 'auto', 'auto')").run('G' + i).lastInsertRowid);
      t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
        VALUES (?, ?, ?, '', ?, ?, 1, 1, 1)`).run(id, sid, '2' + String(i).padStart(3, '0'), 'G' + i, i + 1);
    }
    // bring every option up to date first
    fake.state.items.push(fake.item('9999', '', 'Unrelated', 1));
    let app = t.apps().store!;
    await syncSupplier(app, one(t.storeDb, 'SELECT * FROM suppliers'));
    for (let i = 0; i < 6; i++) await applyCatalog(t.apps().store!, sid);
    expect(one(t.storeDb, 'SELECT applied_hash = items_hash AS done FROM supplier_catalogs').done).toBe(1);

    // a catalog change that touches no source: every option is only re-read
    fake.state.items.push(fake.item('9998', '', 'Another unrelated', 1));
    await syncSupplier(t.apps().store!, one(t.storeDb, 'SELECT * FROM suppliers'));
    app = t.apps().store!;
    await applyCatalog(app, sid);
    expect(Number(one(t.storeDb, "SELECT value FROM app_state WHERE key = ?", 'sync_cursor_' + sid).value)).toBe(5);
  });
});
