import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { optionButtonLabel, priceLines } from '../../src/store/catalog';

const fa = (n: number) => n.toLocaleString('fa-IR');
const CUST = { id: 6501, first_name: 'C' };

describe('compare-at price: display rule', () => {
  it('shown only when greater than the price; percent in Persian digits', () => {
    expect(priceLines({ price: 800, compare_at_price: 1000 })).toBe(
      '💰 قیمت عادی: ' + fa(1000) + ' تومان\n🔥 قیمت ویژه: ' + fa(800) + ' تومان (' + fa(20) + '٪ تخفیف)');
    expect(priceLines({ price: 1000, compare_at_price: 1000 })).toBe('💰 قیمت: ' + fa(1000) + ' تومان');
    expect(priceLines({ price: 1200, compare_at_price: 1000 })).toBe('💰 قیمت: ' + fa(1200) + ' تومان');
    expect(priceLines({ price: 1000, compare_at_price: null })).toBe('💰 قیمت: ' + fa(1000) + ' تومان');
    expect(priceLines({ price: 1000 })).toBe('💰 قیمت: ' + fa(1000) + ' تومان');
    expect(priceLines({ price: 333, compare_at_price: 1000 })).toContain('(' + fa(67) + '٪ تخفیف)');
  });

  it('the option button gets 🔥 only while it applies', () => {
    const base: any = { id: 1, name: 'GPT — 1', option_label: '۱ ماهه', price: 800, is_available: 1 };
    expect(optionButtonLabel({ ...base, compare_at_price: 1000 })).toBe('۱ ماهه  |  ' + fa(800) + ' ت 🔥');
    expect(optionButtonLabel({ ...base, compare_at_price: 800 })).toBe('۱ ماهه  |  ' + fa(800) + ' ت');
    expect(optionButtonLabel({ ...base, compare_at_price: null })).toBe('۱ ماهه  |  ' + fa(800) + ' ت');
    expect(optionButtonLabel({ ...base, is_available: 0, compare_at_price: 1000 })).toBe('⛔️ ۱ ماهه (ناموجود)');
  });
});

describe('compare-at price: storefront', () => {
  it('the product message shows both prices; a plain product keeps the single line', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'GPT Plus', price: 800000 });
    seedProduct(t, { name: 'Plain', price: 500000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1000000 WHERE id = 1');
    await t.send('store', textUpdate(CUST, '/start'));
    await t.send('store', callbackUpdate(CUST, 'cust_prod_1'));
    const sale = t.tg.texts(CUST.id).at(-1)!;
    expect(sale).toContain('💰 قیمت عادی: ' + fa(1000000) + ' تومان');
    expect(sale).toContain('🔥 قیمت ویژه: ' + fa(800000) + ' تومان (' + fa(20) + '٪ تخفیف)');
    await t.send('store', callbackUpdate(CUST, 'cust_prod_2'));
    expect(t.tg.texts(CUST.id).at(-1)).toContain('💰 قیمت: ' + fa(500000) + ' تومان');
  });

  it('group options get 🔥 on the button', async () => {
    const t = makeTestEnv({ monshi: false });
    q(t.storeDb, "INSERT INTO product_groups (name) VALUES ('GPT')");
    q(t.storeDb, "INSERT INTO customer_products (name, price, duration_days, group_id, option_label, compare_at_price) VALUES ('GPT — ۱ ماهه', 800, 30, 1, '۱ ماهه', 1000), ('GPT — ۳ ماهه', 2000, 90, 1, '۳ ماهه', NULL)");
    await t.send('store', callbackUpdate(CUST, 'cust_grp_1'));
    const labels = t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(labels).toContain('۱ ماهه  |  ' + fa(800) + ' ت 🔥');
    expect(labels).toContain('۳ ماهه  |  ' + fa(2000) + ' ت');
  });
});

describe('compare-at price: admin edit', () => {
  async function openCard(t: TestEnv) {
    await t.send('store', textUpdate(ADMIN, '✏️ ویرایش محصول'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_select_1'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_compare'));
  }
  const cmp = (t: TestEnv) => one(t.storeDb, 'SELECT compare_at_price AS c FROM customer_products WHERE id = 1').c;

  it('sets, validates and clears', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 800000 });
    await openCard(t);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('قیمت قبل از تخفیف');
    for (const bad of ['500000', '800000', 'abc', '-5']) {
      await t.send('store', textUpdate(ADMIN, bad));
      expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ قیمت قبل از تخفیف باید بیشتر از قیمت فعلی باشد.');
    }
    expect(cmp(t)).toBeNull();

    await t.send('store', textUpdate(ADMIN, '۱٬۰۰۰٬۰۰۰'));
    expect(cmp(t)).toBe(1000000);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('🏷 قیمت قبل از تخفیف: ' + fa(1000000) + ' ت');

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_compare'));
    await t.send('store', textUpdate(ADMIN, 'حذف'));
    expect(cmp(t)).toBeNull();
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('🏷 قیمت قبل از تخفیف: —');
  });

  it('raising the price above it just stops the display', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 800000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1000000');
    q(t.storeDb, 'UPDATE customer_products SET price = 1200000');
    await t.send('store', textUpdate(CUST, '/start'));
    await t.send('store', callbackUpdate(CUST, 'cust_prod_1'));
    expect(t.tg.texts(CUST.id).at(-1)).toContain('💰 قیمت: ' + fa(1200000) + ' تومان');
    expect(cmp(t)).toBe(1000000); // not cleared automatically
  });
});
