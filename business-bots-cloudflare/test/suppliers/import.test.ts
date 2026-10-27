import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN, type TestEnv } from '../helpers/env';
import { makeFakeAriobox, type FakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { validateDiscountCode } from '../../src/store/handlers/discountCodes';
import { itemRef } from '../../src/store/suppliers/store';
import { codeFloorViolation } from '../../src/store/suppliers/floor';
import { finalPrice, costToman } from '../../src/store/suppliers/pricing';
import { press, say, addSupplierOk, setDefaults, lastSent } from './helpers';
import { callbackUpdate, textUpdate } from '../helpers/updates';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };

function catalog(fake: FakeAriobox) {
  fake.state.usdToman = 150000;
  fake.state.items = [
    fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-month', warranty: '7-days' }),
    fake.item('1300', '3m', 'ChatGPT', 14, { 'subscription-duration': '3-months', warranty: '7-days', region: 'EU' }),
  ];
}

async function setup(withDefaults = true) {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  catalog(fake);
  if (withDefaults) await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  return { t, fake, sid };
}

const products = (t: TestEnv) => q(t.storeDb, 'SELECT id, name, price, pricing_mode, stock_mode, cost_toman FROM customer_products WHERE group_id IS NOT NULL ORDER BY id');

describe('import preview and create (§5.1)', () => {
  it('creates the group, one product per option with its source and computed price', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    expect(lastSent(t).text).toContain('📥 <b>وارد کردن از «ArioBox Main»</b>');
    await press(t, 'sup_impok');

    expect(one(t.storeDb, 'SELECT name FROM product_groups').name).toBe('ChatGPT');
    const rows = products(t);
    expect(rows.map((r) => r.name)).toEqual(['ChatGPT — ۱ ماهه', 'ChatGPT — ۳ ماهه']);
    expect(rows[0].price).toBe(finalPrice(costToman(5.28, 150000), { percent: 15, fixed: 0 }));
    expect(rows[1].price).toBe(finalPrice(costToman(14, 150000), { percent: 15, fixed: 0 }));
    expect(rows.every((r) => r.pricing_mode === 'auto' && r.stock_mode === 'auto')).toBe(true);
    expect(q(t.storeDb, 'SELECT remote_variation_id, priority, listed, is_enabled FROM product_sources ORDER BY id')).toEqual([
      { remote_variation_id: '', priority: 1, listed: 1, is_enabled: 1 },
      { remote_variation_id: '3m', priority: 1, listed: 1, is_enabled: 1 },
    ]);
  });

  it('without any markup the create step is refused and nothing is written', async () => {
    const { t, sid } = await setup(false);
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('اول سود را تعیین کنید');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n).toBe(0);
  });

  it('a variation already imported is marked, starts unselected, and unknown attributes are listed', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    await press(t, 'sup_imp_' + sid + '_1300');
    const text = lastSent(t).text;
    expect(text).toContain('🔗 قبلاً وارد شده («ChatGPT — ۳ ماهه»)');
    expect(text).toContain('⬜️ ۱ ماهه');
    expect(text).toContain('ℹ️ ویژگی‌های ناشناخته: region=EU');
  });

  it('toggles, the group name and a single option label are edited in the draft before creating', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impv_1');
    await press(t, 'sup_impn');
    await say(t, 'GPT Plus');
    await press(t, 'sup_impo');
    await press(t, 'sup_impo_0');
    await press(t, 'sup_impf_0_l');
    await say(t, 'یک ماهه');
    await press(t, 'sup_impok');
    expect(one(t.storeDb, 'SELECT name FROM product_groups').name).toBe('GPT Plus');
    expect(products(t).map((r) => r.name)).toEqual(['GPT Plus — یک ماهه']);
  });
});

describe('sources screen (§5.3)', () => {
  it('a second source takes over when the first is switched off, and back when it is on again', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    // a second source for the same option: the 3-month variation of the same supplier
    t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
      VALUES (?, ?, '1300', '3m', 'ChatGPT', 14, 1, 2, 1)`).run(m1, sid);
    const first = one(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ? ORDER BY priority, id LIMIT 1', m1).id;

    await press(t, 'sup_srctog_' + m1 + '_' + first);
    expect(one(t.storeDb, 'SELECT price, cost_toman FROM customer_products WHERE id = ?', m1))
      .toEqual({ price: finalPrice(costToman(14, 150000), { percent: 15, fixed: 0 }), cost_toman: costToman(14, 150000) });

    await press(t, 'sup_srctog_' + m1 + '_' + first);
    expect(one(t.storeDb, 'SELECT price FROM customer_products WHERE id = ?', m1).price).toBe(finalPrice(costToman(5.28, 150000), { percent: 15, fixed: 0 }));
  });

  it('moving a source reorders the priorities', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
      VALUES (?, ?, '1300', '3m', 'ChatGPT', 14, 1, 2, 1)`).run(m1, sid);
    const [a, b] = q(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ? ORDER BY priority, id', m1).map((r) => r.id);
    await press(t, 'sup_srcdn_' + m1 + '_' + a);
    expect(q(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ? ORDER BY priority, id', m1).map((r) => r.id)).toEqual([b, a]);
  });

  it('removing the last source asks first, then makes the option an ordinary manual product', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    const only = one(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ?', m1).id;
    await press(t, 'sup_srcdel_' + m1 + '_' + only);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('این آخرین منبع است');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM product_sources').n).toBe(2);
    await press(t, 'sup_srcdelok_' + m1 + '_' + only);
    expect(one(t.storeDb, 'SELECT pricing_mode, stock_mode, cost_toman FROM customer_products WHERE id = ?', m1))
      .toEqual({ pricing_mode: 'manual', stock_mode: 'manual', cost_toman: null });
  });

  it('adds a catalog item as a source; the same item again is reported, not duplicated', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impv_1');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    const ref = await itemRef('1300', '3m'); // the 3-month variation, by its remote ids
    await press(t, 'sup_srcn_' + m1 + '_' + sid + '_' + ref);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM product_sources WHERE customer_product_id = ?', m1).n).toBe(2);
    await press(t, 'sup_srcn_' + m1 + '_' + sid + '_' + ref);
    expect(t.tg.texts(ADMIN.id).some((x) => x.includes('از قبل منبع این محصول است'))).toBe(true);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM product_sources WHERE customer_product_id = ?', m1).n).toBe(2);
  });

  it('the default markup can be applied to automatic options without their own markup', async () => {
    const { t, sid, fake } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    fake.state.usdToman = 170000;
    await press(t, 'sup_defapply');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('محصول به‌روز شد');
  });
});

describe('cost floor (§5.4)', () => {
  it('a customer code that would sell below the cost is refused; a milder one works', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    const app = t.apps().store!;
    const cost = costToman(5.28, 150000);
    const price = one(t.storeDb, 'SELECT price FROM customer_products WHERE id = ?', m1).price;
    // a 30% discount is below the cost at this markup; a 5% one is not
    expect(price).toBeGreaterThan(cost);
    await app.db.createDiscountCode({ code: 'DEEP', customerProductId: m1, discountType: 'percent', discountValue: 50, maxUses: null, expiresAt: '2099-01-01 00:00:00' });
    await app.db.createDiscountCode({ code: 'SOFT', customerProductId: m1, discountType: 'percent', discountValue: 5, maxUses: null, expiresAt: '2099-01-01 00:00:00' });
    const product = (await app.db.getCustomerProductById(m1))!;
    expect(await validateDiscountCode(app, 'DEEP', product, CUSTOMER.id)).toEqual({ ok: false, reason: 'below_cost' });
    expect((await validateDiscountCode(app, 'SOFT', product, CUSTOMER.id)).ok).toBe(true);
  });

  it('the code wizard check covers a whole group: the lowest option decides', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    const group = one(t.storeDb, 'SELECT group_id FROM customer_products WHERE id = ?', m1).group_id;
    const v = await codeFloorViolation(t.apps().store!, { customerProductId: m1, productGroupId: group }, { discount_type: 'percent', discount_value: 60 });
    expect(v?.name).toBe('ChatGPT — ۱ ماهه');
    expect(await codeFloorViolation(t.apps().store!, { customerProductId: m1, productGroupId: group }, { discount_type: 'percent', discount_value: 1 })).toBeNull();
  });

  it('a customer cannot use a code whose price is under cost, and the storefront says so', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_imp_' + sid + '_1300');
    await press(t, 'sup_impok');
    const [m1] = products(t).map((r) => r.id);
    await t.apps().store!.db.createDiscountCode({ code: 'DEEP', customerProductId: m1, discountType: 'percent', discountValue: 50, maxUses: null, expiresAt: '2099-01-01 00:00:00' });
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + m1));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + m1));
    await t.send('store', textUpdate(CUSTOMER, 'DEEP'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('❌ این کد برای این محصول قابل استفاده نیست.');
  });
});

