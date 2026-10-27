import { describe, expect, it } from 'vitest';
import { makeTestEnv, type TestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one } from '../helpers/seed';
import { at, press, addSupplierOk, setDefaults} from './helpers';

/** `n` auto options, each fed by one source of the supplier. */
async function setup(n: number) {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = Array.from({ length: n }, (_, i) => fake.item('2' + String(i).padStart(3, '0'), '', 'G' + i, i + 1));
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = Number(t.storeDb.sqlite.prepare(
      "INSERT INTO customer_products (name, price, pricing_mode, stock_mode, is_available) VALUES (?, 1, 'auto', 'auto', 1)").run('G' + i).lastInsertRowid);
    t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
      VALUES (?, ?, ?, '', ?, ?, 1, 1, 1)`).run(id, sid, '2' + String(i).padStart(3, '0'), 'G' + i, i + 1);
    ids.push(id);
  }
  return { t, fake, sid, ids };
}
const available = (t: TestEnv) => one(t.storeDb, 'SELECT SUM(is_available) n FROM customer_products').n as number;

describe('turning a supplier off or on recomputes its options (review should-fix 4)', () => {
  it('off: its auto options become unavailable at once; on: available again with the cost back', async () => {
    const { t, sid, ids } = await setup(3);
    await press(t, 'sup_tog_' + sid);
    expect(available(t)).toBe(0);
    await press(t, 'sup_tog_' + sid);
    expect(available(t)).toBe(3);
    // 1 USD × 150,000 = 150,000 cost; +15% = 172,500 → 180,000
    expect(one(t.storeDb, 'SELECT price, cost_toman FROM customer_products WHERE id = ?', ids[0])).toEqual({ price: 180000, cost_toman: 150000 });
  });

  it('a manual stock setting is left alone', async () => {
    const { t, sid, ids } = await setup(2);
    t.storeDb.sqlite.prepare("UPDATE customer_products SET stock_mode = 'manual' WHERE id = ?").run(ids[0]);
    await press(t, 'sup_tog_' + sid);
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', ids[0]).is_available).toBe(1);
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', ids[1]).is_available).toBe(0);
  });

  it('more options than one request can afford: the rest finish through the cron, within the budget', async () => {
    const { t, sid } = await setup(30);
    await press(t, 'sup_tog_' + sid);
    const afterToggle = available(t);
    expect(afterToggle).toBeGreaterThan(0); // not everything fit
    expect(afterToggle).toBeLessThan(30); // but the request did a part
    for (let m = 3; m < 15 && available(t) > 0; m++) await at(t, '2026-10-25T10:' + String(m % 10 === 2 ? m + 1 : m).padStart(2, '0') + ':00Z');
    expect(available(t)).toBe(0);
  });
});
