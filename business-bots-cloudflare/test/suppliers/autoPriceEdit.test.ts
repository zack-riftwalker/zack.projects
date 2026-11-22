import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one } from '../helpers/seed';
import { callbackDataOf, lastSent, at, press, say, addSupplierOk, setDefaults, DUE, DUE_NEXT } from './helpers';

async function setup() {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = [fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-month' })];
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  await press(t, 'sup_imp_' + sid + '_1300');
  await press(t, 'sup_impok');
  const pid = one(t.storeDb, 'SELECT id FROM customer_products').id as number;
  return { t, fake, pid };
}
const row = (t: any, pid: number) => one(t.storeDb, 'SELECT price, pricing_mode FROM customer_products WHERE id = ?', pid);

describe('typing a price on an option with automatic pricing (review finding)', () => {
  it('asks «قیمت ثابت شود؟»; «بله» saves the price and makes it fixed, so a rate change no longer overwrites it', async () => {
    const { t, fake, pid } = await setup();
    expect(row(t, pid)).toEqual({ price: 920000, pricing_mode: 'auto' });
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    await press(t, 'cprod_edit_f_price');
    await say(t, '1000000');

    // nothing is saved yet: the question comes first
    expect(row(t, pid)).toEqual({ price: 920000, pricing_mode: 'auto' });
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('این گزینه قیمت خودکار دارد. قیمت ثابت شود؟');
    expect(callbackDataOf(lastSent(t))).toEqual(['cprod_edit_fixp_yes', 'cprod_edit_fixp_no']);
    const buttons = lastSent(t).reply_markup.inline_keyboard[0].map((b: any) => b.text);
    expect(buttons).toEqual(['✅ بله، قیمت ثابت', '❌ انصراف']);

    await press(t, 'cprod_edit_fixp_yes');
    expect(row(t, pid)).toEqual({ price: 1000000, pricing_mode: 'manual' });

    // the supplier's rate rises; the sync must leave the typed price alone
    fake.state.usdToman = 200000;
    await at(t, DUE);
    await at(t, DUE_NEXT);
    expect(row(t, pid)).toEqual({ price: 1000000, pricing_mode: 'manual' });
    expect(one(t.storeDb, 'SELECT cost_toman FROM customer_products WHERE id = ?', pid).cost_toman).toBe(1056000); // the cost still follows
  });

  it('«انصراف» keeps the old price and the automatic mode', async () => {
    const { t, fake, pid } = await setup();
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    await press(t, 'cprod_edit_f_price');
    await say(t, '1000000');
    await press(t, 'cprod_edit_fixp_no');
    expect(row(t, pid)).toEqual({ price: 920000, pricing_mode: 'auto' });
    // pressing «بله» afterwards (a stale button) saves nothing
    await press(t, 'cprod_edit_fixp_yes');
    expect(row(t, pid)).toEqual({ price: 920000, pricing_mode: 'auto' });

    // the automatic price still follows the rate
    fake.state.usdToman = 160000;
    await at(t, DUE);
    await at(t, DUE_NEXT);
    expect(row(t, pid).pricing_mode).toBe('auto');
    expect(row(t, pid).price).not.toBe(920000);
  });

  it('an option that is already fixed, and a plain product, take the price at once (no question)', async () => {
    const { t, pid } = await setup();
    await press(t, 'sup_pmode_' + pid); // خودکار → ثابت
    expect(row(t, pid).pricing_mode).toBe('manual');
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    await press(t, 'cprod_edit_f_price');
    await say(t, '1111000');
    expect(row(t, pid)).toEqual({ price: 1111000, pricing_mode: 'manual' });
    expect(t.tg.texts(ADMIN.id).join('\n')).not.toContain('قیمت ثابت شود؟');

    const plain = Number(t.storeDb.sqlite.prepare("INSERT INTO customer_products (name, price) VALUES ('Plain', 1000)").run().lastInsertRowid);
    await press(t, 'cprod_edit_menu');
    await say(t, '/panel');
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + plain);
    await press(t, 'cprod_edit_f_price');
    await say(t, '2222000');
    expect(one(t.storeDb, 'SELECT price, pricing_mode FROM customer_products WHERE id = ?', plain)).toEqual({ price: 2222000, pricing_mode: 'manual' });
  });
});
