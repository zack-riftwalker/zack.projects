import { describe, expect, it } from 'vitest';
import { budgets, makeTestEnv, type TestEnv } from '../helpers/env';
import { makeFakeAriobox, type FakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { press, addSupplierOk, setDefaults, lastSent, callbackDataOf } from './helpers';

async function setup(variations: { attrs?: Record<string, string>; price: number | null }[]) {
  const fake: FakeAriobox = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = variations.map((v, i) => fake.item('1300', 'v' + i, 'Big Product', v.price, v.attrs ?? { 'subscription-duration': (i + 1) + '-months' }));
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  return { t, fake, sid };
}
const count = (t: TestEnv, table: string) => one(t.storeDb, `SELECT COUNT(*) n FROM ${table}`).n as number;

describe('import batch is bounded and atomic (review should-fix 5)', () => {
  it('25 variations: each press stays within the budget target, the group is made once, all 25 end up created', async () => {
    const { t, sid } = await setup(Array.from({ length: 25 }, (_, i) => ({ price: 1 + i })));
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    expect(budgets.at(-1)!.used).toBeLessThanOrEqual(35);
    expect(count(t, 'product_groups')).toBe(1);
    expect(count(t, 'customer_products')).toBe(10);
    expect(callbackDataOf(lastSent(t))).toContain('sup_impok');
    expect(lastSent(t).text).toContain('۱۵ گزینه‌ی دیگر');

    await press(t, 'sup_impok');
    expect(budgets.at(-1)!.used).toBeLessThanOrEqual(35);
    expect(count(t, 'customer_products')).toBe(20);
    await press(t, 'sup_impok');
    expect(budgets.at(-1)!.used).toBeLessThanOrEqual(35);
    expect(count(t, 'customer_products')).toBe(25);
    expect(count(t, 'product_groups')).toBe(1);
    expect(count(t, 'product_sources')).toBe(25);
    expect(one(t.storeDb, 'SELECT COUNT(DISTINCT group_id) n FROM customer_products').n).toBe(1);
    expect(lastSent(t).text).toContain('با ۲۵ گزینه ساخته شد');
    // sort order follows the catalog order and a repeated press creates nothing more
    expect(q(t.storeDb, 'SELECT sort_order FROM customer_products ORDER BY id').map((r) => r.sort_order)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    await press(t, 'sup_impok');
    expect(count(t, 'customer_products')).toBe(25);
  });

  it('a failure in the batch rolls everything back, group included, and the draft stays for a retry', async () => {
    const { t, sid } = await setup([{ price: 1 }, { price: 2 }, { price: 3 }]);
    t.storeDb.sqlite.exec(`CREATE TRIGGER boom BEFORE INSERT ON product_sources WHEN NEW.remote_variation_id = 'v2'
      BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    expect(count(t, 'product_groups')).toBe(0);
    expect(count(t, 'customer_products')).toBe(0);
    expect(count(t, 'product_sources')).toBe(0);
    expect(t.tg.texts(1001).at(-1)).toContain('هیچ چیزی ذخیره نشد');
    t.storeDb.sqlite.exec('DROP TRIGGER boom');
    await press(t, 'sup_impok');
    expect(count(t, 'product_groups')).toBe(1);
    expect(count(t, 'customer_products')).toBe(3);
  });

  it('a variation with no price is not importable: not selected, flagged, never created with price 0', async () => {
    const { t, sid } = await setup([{ price: 5 }, { price: null }]);
    await press(t, 'sup_imp_' + sid + '_1300');
    expect(lastSent(t).text).toContain('در تأمین‌کننده قیمت ندارد؛ وارد نمی‌شود');
    await press(t, 'sup_impv_1');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قیمت ندارد');
    await press(t, 'sup_impok');
    expect(count(t, 'customer_products')).toBe(1);
    // $5 × 150,000 = 750,000; +15% = 862,500 → 870,000
    expect(one(t.storeDb, 'SELECT price FROM customer_products').price).toBe(870000);
  });
});
