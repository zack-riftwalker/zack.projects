import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN, type TestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { getSupplierDefaults } from '../../src/store/supplierDefaults';
import { finalPrice, costToman } from '../../src/store/suppliers/pricing';
import { press, say, addSupplierOk, setDefaults, KEY } from './helpers';

async function setup() {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = [fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-month', warranty: '7-days' })];
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  await press(t, 'sup_imp_' + sid + '_1300');
  await press(t, 'sup_impok');
  const pid = one(t.storeDb, 'SELECT id FROM customer_products').id as number;
  return { t, fake, sid, pid };
}

const productRow = (t: TestEnv, id: number) => one(t.storeDb, 'SELECT name, price, markup_percent, markup_fixed FROM customer_products WHERE id = ?', id);
const openEditWizard = async (t: TestEnv, pid: number) => {
  await say(t, '✏️ ویرایش محصول');
  await press(t, 'cprod_edit_select_' + pid);
};

describe('supplier text prompts are never taken by an active wizard (B1)', () => {
  it('a per-product markup typed after 🔌 from the edit card is saved as markup, not as the price', async () => {
    const { t, pid } = await setup();
    const before = productRow(t, pid).price;
    await openEditWizard(t, pid);
    await press(t, 'cprod_edit_f_price');
    await press(t, 'sup_src_' + pid);
    await press(t, 'sup_pmk_' + pid);
    await press(t, 'sup_pmkp_' + pid);
    await say(t, '15');
    const row = productRow(t, pid);
    expect(row.markup_percent).toBe(15);
    expect(row.price).toBe(finalPrice(costToman(5.28, 150000), { percent: 15, fixed: 0 }));
    expect(row.price).toBe(before);
  });

  it('works also when no field button was pressed first', async () => {
    const { t, pid } = await setup();
    await openEditWizard(t, pid);
    await press(t, 'sup_src_' + pid);
    await press(t, 'sup_pmk_' + pid);
    await press(t, 'sup_pmkf_' + pid);
    await say(t, '50000');
    expect(productRow(t, pid).markup_fixed).toBe(50000);
    expect(t.tg.texts(ADMIN.id).join('\n')).not.toContain('ابتدا یکی از دکمه‌های ویرایش را بزنید');
  });

  it('the default-markup prompt reached while the add-product wizard waits for a name', async () => {
    const { t } = await setup();
    const products = () => one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n;
    const n = products();
    await say(t, '➕ افزودن محصول');
    await press(t, 'sup_def_pct');
    await say(t, '22');
    expect((await getSupplierDefaults(t.apps().store!)).markupPercent).toBe(22);
    expect(products()).toBe(n);
  });

  it('the add-supplier steps are not taken by the add-product wizard either', async () => {
    const { t } = await setup();
    const products = () => one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n;
    const n = products();
    await say(t, '➕ افزودن محصول');
    await press(t, 'sup_add');
    await say(t, 'Second');
    expect(products()).toBe(n);
    await say(t, 'https://second.test');
    await say(t, KEY);
    await say(t, '7');
    expect(q(t.storeDb, 'SELECT name FROM suppliers ORDER BY id').map((r) => r.name)).toEqual(['ArioBox Main', 'Second']);
    expect(products()).toBe(n);
  });

  it('a panel button abandons a pending supplier prompt instead of feeding it', async () => {
    const { t } = await setup();
    await press(t, 'sup_def_pct');
    await say(t, '➕ افزودن محصول');
    await say(t, '33');
    expect((await getSupplierDefaults(t.apps().store!)).markupPercent).toBe(15);
    expect(t.tg.texts(ADMIN.id).at(-1)).not.toContain('ذخیره شد');
  });
});

describe('the API key message is always deleted and never reaches another handler (B2)', () => {
  it('changing a key while the add-product wizard is open: deleted, saved, no product created', async () => {
    const { t, fake, sid } = await setup();
    const products = one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n;
    fake.state.validKey = 'NEW-KEY-123456';
    await say(t, '➕ افزودن محصول');
    await press(t, 'sup_key_' + sid);
    const deleted = t.tg.of('deleteMessage').length;
    await say(t, 'NEW-KEY-123456');
    expect(t.tg.of('deleteMessage').length).toBe(deleted + 1);
    expect(one(t.storeDb, 'SELECT api_key FROM suppliers').api_key).toBe('NEW-KEY-123456');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n).toBe(products);
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('🔑 کلید دریافت و پیام حاوی آن پاک شد.');
  });

  it('a refused key (wrong) is deleted too and the old key stays', async () => {
    const { t, sid } = await setup();
    await say(t, '➕ افزودن محصول');
    await press(t, 'sup_key_' + sid);
    const deleted = t.tg.of('deleteMessage').length;
    await say(t, 'WRONG-KEY-99999');
    expect(t.tg.of('deleteMessage').length).toBe(deleted + 1);
    expect(one(t.storeDb, 'SELECT api_key FROM suppliers').api_key).toBe(KEY);
  });

  it('a key sent after the prompt expired is still deleted', async () => {
    const { t, sid } = await setup();
    await press(t, 'sup_key_' + sid);
    const deleted = t.tg.of('deleteMessage').length;
    t.deps.now = () => new Date(Date.now() + 16 * 60_000);
    await say(t, 'NEW-KEY-123456');
    expect(t.tg.of('deleteMessage').length).toBe(deleted + 1);
    expect(one(t.storeDb, 'SELECT api_key FROM suppliers').api_key).toBe(KEY);
  });
});
