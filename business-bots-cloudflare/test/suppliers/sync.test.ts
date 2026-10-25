import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN, ADMIN2, type TestEnv } from '../helpers/env';
import { makeFakeAriobox, type FakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { formatPrice } from '../../src/store/utils';
import { finalPrice, costToman } from '../../src/store/suppliers/pricing';
import { at, addSupplierOk, setDefaults, press, say, DUE, DUE_NEXT, NOT_DUE, KEY } from './helpers';

const reports = (t: TestEnv, admin = ADMIN.id) => t.tg.texts(admin).filter((x) => x.includes('گزارش همگام‌سازی'));
const allTexts = (t: TestEnv, admin = ADMIN.id) => t.tg.texts(admin).join('\n');

/** The catalog of the tests: one product with two variations (1 month and 3 months). */
function catalog(fake: FakeAriobox) {
  fake.state.usdToman = 150000;
  fake.state.items = [
    fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-month', warranty: '7-days' }),
    fake.item('1300', '3m', 'ChatGPT', 14, { 'subscription-duration': '3-months', warranty: '7-days' }),
  ];
}

/** Imports the product through the panel; returns the two option ids (1 month, 3 months). */
async function importProduct(t: TestEnv, sid: number): Promise<[number, number]> {
  await press(t, 'sup_imp_' + sid + '_1300');
  await press(t, 'sup_impok');
  const rows = q(t.storeDb, 'SELECT id FROM customer_products WHERE group_id IS NOT NULL ORDER BY id');
  return [rows[0].id, rows[1].id];
}

const price = (t: TestEnv, id: number) => one(t.storeDb, 'SELECT price FROM customer_products WHERE id = ?', id).price as number;

describe('catalog sync: fetch (§6.1)', () => {
  it('the fetch stores the catalog only when it changed; the minute gate keeps other minutes free of fetches', async () => {
    const t = makeTestEnv({ monshi: false, fetch: undefined });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    catalog(fake);
    const sid = await addSupplierOk(t, fake);
    const fetchedBefore = one(t.storeDb, 'SELECT fetched_at FROM supplier_catalogs WHERE supplier_id = ?', sid).fetched_at;

    const calls = () => fake.calls.filter((c) => c.url.endsWith('/products')).length;
    const before = calls();
    await at(t, NOT_DUE);
    expect(calls()).toBe(before);

    await at(t, DUE);
    expect(calls()).toBe(before + 1);
    expect(one(t.storeDb, 'SELECT last_sync_ok_at FROM suppliers WHERE id = ?', sid).last_sync_ok_at).not.toBeNull();
    // unchanged catalog: fetched again, not rewritten
    const fetchedAfter = one(t.storeDb, 'SELECT fetched_at FROM supplier_catalogs WHERE supplier_id = ?', sid).fetched_at;
    expect(fetchedAfter).toBe(fetchedBefore);

    await at(t, DUE_NEXT);
    expect(calls()).toBe(before + 2);
  });

  it('«همگام‌سازی الان» fetches on the next tick, not only on the periodic minute', async () => {
    const t = makeTestEnv({ monshi: false });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    catalog(fake);
    const sid = await addSupplierOk(t, fake);
    await at(t, DUE);
    const fetches = () => fake.calls.filter((c) => c.url.endsWith('/products')).length;
    const before = fetches();
    await press(t, 'sup_sync_' + sid);
    await at(t, NOT_DUE);
    expect(fetches()).toBe(before + 1);
  });

  it('auth failure: one alert while it lasts, one recovery message when the key works again', async () => {
    const t = makeTestEnv({ monshi: false });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    catalog(fake);
    const sid = await addSupplierOk(t, fake);
    expect(sid).toBeGreaterThan(0);

    fake.state.validKey = 'SOMEONE-ELSE-KEY';
    await at(t, DUE);
    await at(t, DUE_NEXT);
    const alerts = (x: string) => x.includes('کلید API «ArioBox Main» نامعتبر است');
    expect(t.tg.texts(ADMIN.id).filter(alerts)).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT sync_alert_sent FROM suppliers').sync_alert_sent).toBe(1);

    fake.state.validKey = KEY;
    await at(t, '2026-10-25T10:22:00Z');
    expect(t.tg.texts(ADMIN.id).filter((x) => x.includes('اتصال «ArioBox Main» برقرار شد'))).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT sync_alert_sent FROM suppliers').sync_alert_sent).toBe(0);
  });
});

describe('catalog sync: apply and the report (§6.2)', () => {
  it('a price change follows the rate and is reported to every admin once', async () => {
    const t = makeTestEnv({ monshi: false });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    catalog(fake);
    await setDefaults(t);
    const sid = await addSupplierOk(t, fake);
    const [m1] = await importProduct(t, sid);
    expect(price(t, m1)).toBe(finalPrice(costToman(5.28, 150000), { percent: 15, fixed: 0 }));

    fake.state.usdToman = 160000;
    await at(t, DUE);
    const expected = finalPrice(costToman(5.28, 160000), { percent: 15, fixed: 0 });
    expect(price(t, m1)).toBe(expected);
    expect(one(t.storeDb, 'SELECT applied_hash = items_hash AS done FROM supplier_catalogs').done).toBe(1);
    expect(reports(t)).toHaveLength(1);
    expect(reports(t, ADMIN2.id)).toHaveLength(1);
    expect(reports(t)[0]).toContain('ChatGPT — ۱ ماهه: قیمت ' + formatPrice(920000) + ' ← ' + formatPrice(expected) + ' تومان');

    await at(t, NOT_DUE);
    expect(reports(t)).toHaveLength(1);
  });

  it('removing a variation reports the removal and availability; the rest of the report is per change type', async () => {
    const t = makeTestEnv({ monshi: false });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    catalog(fake);
    await setDefaults(t);
    const sid = await addSupplierOk(t, fake);
    const [m1, m3] = await importProduct(t, sid);

    fake.state.items = [
      fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-month', warranty: '14-days' }),
      fake.item('1300', '6m', 'ChatGPT', 25, { 'subscription-duration': '6-months', warranty: '7-days' }),
    ];
    await at(t, DUE);
    const text = allTexts(t);
    expect(text).toContain('ChatGPT — ۳ ماهه: از لیست «ArioBox Main» حذف شد');
    expect(text).toContain('ChatGPT — ۳ ماهه: ناموجود شد');
    expect(text).toContain('ChatGPT — ۱ ماهه: مشخصات در تأمین‌کننده عوض شد: warranty 7-days ← 14-days (روی محصول شما تغییری داده نشد)');
    expect(text).toContain('گزینه‌ی جدید دارد: subscription-duration: 6-months | warranty: 7-days');
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', m3).is_available).toBe(0);
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', m1).is_available).toBe(1);

    // the new variation is reported once; another round with the same catalog says nothing new
    fake.state.usdToman = 151000;
    await at(t, DUE_NEXT);
    expect(allTexts(t).split('گزینه‌ی جدید دارد').length - 1).toBe(1);
  });

  it('an option is unavailable only when all its sources are; a manual stock setting sticks', async () => {
    const t = makeTestEnv({ monshi: false });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    catalog(fake);
    await setDefaults(t);
    const sid = await addSupplierOk(t, fake);
    const [m1, m3] = await importProduct(t, sid);
    // a second source for the 1-month option: the 3-month variation
    t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
      VALUES (?, ?, '1300', '3m', 'ChatGPT', 14, 1, 2, 1)`).run(m1, sid);

    fake.state.items = [fake.item('1300', '3m', 'ChatGPT', 14, { 'subscription-duration': '3-months', warranty: '7-days' })];
    await at(t, DUE);
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', m1).is_available).toBe(1);
    expect(price(t, m1)).toBe(finalPrice(costToman(14, 150000), { percent: 15, fixed: 0 }));

    fake.state.items = [];
    t.storeDb.sqlite.prepare("UPDATE customer_products SET stock_mode = 'manual' WHERE id = ?").run(m3);
    await at(t, DUE_NEXT);
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', m1).is_available).toBe(0);
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', m3).is_available).toBe(1);
  });

  it('a big round is spread over several ticks and finishes with every price right', async () => {
    const t = makeTestEnv({ monshi: false });
    const fake = makeFakeAriobox();
    t.deps.fetch = fake.fetch;
    fake.state.usdToman = 150000;
    fake.state.items = Array.from({ length: 25 }, (_, i) => fake.item('2' + String(i).padStart(3, '0'), '', 'G' + i, i + 1, {}));
    await setDefaults(t);
    const sid = await addSupplierOk(t, fake);
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const id = Number(t.storeDb.sqlite.prepare(
        "INSERT INTO customer_products (name, price, pricing_mode, stock_mode) VALUES (?, 1, 'auto', 'auto')").run('G' + i).lastInsertRowid);
      t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
        VALUES (?, ?, ?, '', ?, ?, 1, 1, 1)`).run(id, sid, '2' + String(i).padStart(3, '0'), 'G' + i, i + 1);
      ids.push(id);
    }
    // the rate changes; the first tick is a due one (the supplier is fetched), then the apply runs over later ticks
    fake.state.usdToman = 160000;
    let ticks = 0;
    let minute = 2;
    while (one(t.storeDb, 'SELECT applied_hash = items_hash AS done FROM supplier_catalogs').done !== 1 && ticks < 30) {
      ticks++;
      await at(t, `2026-10-25T10:${String(minute).padStart(2, '0')}:00Z`);
      minute = minute === 9 ? 0 : minute + 1;
    }
    expect(ticks).toBeGreaterThan(1);
    ids.forEach((id, i) => expect(price(t, id)).toBe(finalPrice(costToman(i + 1, 160000), { percent: 15, fixed: 0 })));
  });
});
