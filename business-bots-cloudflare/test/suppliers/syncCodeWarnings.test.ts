import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN, type TestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { at, addSupplierOk, setDefaults, DUE } from './helpers';

const texts = (t: TestEnv) => t.tg.texts(ADMIN.id).join('\n');

/** `n` manual-priced options of one group, each fed by a source whose cost ends up above the price. */
async function setup(n: number) {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = Array.from({ length: n }, (_, i) => fake.item('3' + String(i).padStart(3, '0'), '', 'G' + i, 1));
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  const g = Number(t.storeDb.sqlite.prepare("INSERT INTO product_groups (name) VALUES ('Grp')").run().lastInsertRowid);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = Number(t.storeDb.sqlite.prepare(
      "INSERT INTO customer_products (name, price, pricing_mode, stock_mode, group_id, option_label) VALUES (?, 200000, 'manual', 'auto', ?, ?)").run('Grp — o' + i, g, 'o' + i).lastInsertRowid);
    t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
      VALUES (?, ?, ?, '', ?, 1, 1, 1, 1)`).run(id, sid, '3' + String(i).padStart(3, '0'), 'G' + i);
    ids.push(id);
  }
  // the cost goes 150,000 → 190,000 (price 200,000 is still above it, a code of 20,000 is not)
  fake.state.usdToman = 190000;
  return { t, fake, g, ids };
}

describe('sync report: discount-code warnings (review should-fix 7)', () => {
  it('a code of the whole group is found for each of its options', async () => {
    const { t, g, ids } = await setup(2);
    // anchored to the first option, valid for the group
    t.storeDb.sqlite.prepare(`INSERT INTO discount_codes (code, customer_product_id, product_group_id, discount_type, discount_value, expires_at)
      VALUES ('GRPCODE', ?, ?, 'fixed', 20000, '2999-01-01 00:00:00')`).run(ids[0], g);
    await at(t, DUE);
    const report = texts(t);
    expect(report).toContain('کد تخفیف GRPCODE روی «Grp — o0»');
    expect(report).toContain('کد تخفیف GRPCODE روی «Grp — o1»');
  });

  it('at most 5 code-warning lines; the rest are counted in one line', async () => {
    const { t, g, ids } = await setup(8);
    t.storeDb.sqlite.prepare(`INSERT INTO discount_codes (code, customer_product_id, product_group_id, discount_type, discount_value, expires_at)
      VALUES ('GRPCODE', ?, ?, 'fixed', 20000, '2999-01-01 00:00:00')`).run(ids[0], g);
    for (let m = 2; m < 20; m++) {
      await at(t, '2026-10-25T10:' + String(m % 10 === 2 && m !== 2 ? m + 1 : m).padStart(2, '0') + ':00Z');
    }
    const report = t.tg.texts(ADMIN.id).filter((x) => x.includes('گزارش همگام‌سازی')).join('\n');
    expect(report.split('کد تخفیف GRPCODE روی').length - 1).toBe(5);
    expect(report).toContain('و ۳ هشدار کد تخفیف دیگر');
  });
});
