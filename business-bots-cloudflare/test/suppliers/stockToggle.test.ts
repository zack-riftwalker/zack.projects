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
const row = (t: any, pid: number) => one(t.storeDb, 'SELECT is_available, stock_mode FROM customer_products WHERE id = ?', pid);

describe('the edit-card stock toggle on an auto option (B3, SUPPLIER_PLAN.md §5.3)', () => {
  it('⛔️ sets stock_mode manual, so a later rate change does not re-open it; 📦 موجودی خودکار switches back', async () => {
    const { t, fake, pid } = await setup();
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    expect(callbackDataOf(lastSent(t))).not.toContain('cprod_edit_stock_auto');

    await press(t, 'cprod_edit_toggle_stock');
    expect(row(t, pid)).toEqual({ is_available: 0, stock_mode: 'manual' });
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toContain('cprod_edit_stock_auto');

    // the rate changes: the recompute must leave the manual ⛔️ alone
    fake.state.usdToman = 160000;
    await at(t, DUE);
    await at(t, DUE_NEXT);
    expect(row(t, pid)).toEqual({ is_available: 0, stock_mode: 'manual' });

    await press(t, 'cprod_edit_stock_auto');
    expect(row(t, pid)).toEqual({ is_available: 1, stock_mode: 'auto' });
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).not.toContain('cprod_edit_stock_auto');
    expect(t.tg.texts(ADMIN.id).join('\n')).not.toContain('ابتدا یکی از دکمه‌ها');
  });

  it('a product without sources has no switch-back button', async () => {
    const t = makeTestEnv({ monshi: false });
    t.storeDb.sqlite.prepare("INSERT INTO customer_products (name, price, is_available) VALUES ('Plain', 1000, 0)").run();
    const pid = one(t.storeDb, 'SELECT id FROM customer_products').id;
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    expect(callbackDataOf(lastSent(t))).not.toContain('cprod_edit_stock_auto');
  });
});
