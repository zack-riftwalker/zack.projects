import { describe, expect, it } from 'vitest';
import { makeTestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { optionLabel } from '../../src/store/suppliers/importDraft';
import { press, say, addSupplierOk, setDefaults, lastSent, callbackDataOf } from './helpers';

describe('year durations are labelled in years (review nit)', () => {
  it('1-year → ۱ ساله, 2-years → ۲ ساله; months and days are unchanged', () => {
    expect(optionLabel(365, 0, { 'subscription-duration': '1-year' })).toBe('۱ ساله');
    expect(optionLabel(730, 0, { 'subscription-duration': '2-years' })).toBe('۲ ساله');
    expect(optionLabel(365, 0, { duration: '1 year' })).toBe('۱ ساله');
    expect(optionLabel(360, 0, { 'subscription-duration': '12-months' })).toBe('۱۲ ماهه');
    expect(optionLabel(365, 0, { 'subscription-duration': '365-days' })).toBe('۳۶۵ روزه');
  });
});

async function setup() {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = [fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-year' })];
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  await press(t, 'sup_imp_' + sid + '_1300');
  await press(t, 'sup_impok');
  const pid = one(t.storeDb, 'SELECT id FROM customer_products').id as number;
  return { t, fake, sid, pid };
}

describe('per-product markup prompts can be cancelled (review nit)', () => {
  it('the src_* prompts carry ❌ انصراف, which closes the prompt', async () => {
    const { t, pid } = await setup();
    expect(one(t.storeDb, 'SELECT option_label FROM customer_products').option_label).toBe('۱ ساله');
    for (const kind of ['sup_pmkp_', 'sup_pmkf_']) {
      await press(t, kind + pid);
      expect(callbackDataOf(lastSent(t))).toEqual(['sup_cancel_input']);
      await press(t, 'sup_cancel_input');
      await say(t, '15');
      expect(one(t.storeDb, 'SELECT markup_percent, markup_fixed FROM customer_products').markup_percent).toBeNull();
    }
  });
});

describe('deleting the last source is safe against a concurrent add (review nit)', () => {
  it('a second source added between the confirmation and the tap: the option stays automatic', async () => {
    const { t, sid, pid } = await setup();
    const only = one(t.storeDb, 'SELECT id FROM product_sources').id as number;
    await press(t, 'sup_srcdel_' + pid + '_' + only);
    expect(t.tg.texts(1001).at(-1)).toContain('این آخرین منبع است');
    // another admin adds a source now
    t.storeDb.sqlite.prepare(`INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name, price_usd, listed, priority, is_enabled)
      VALUES (?, ?, '1300', 'x', 'ChatGPT', 6, 1, 2, 1)`).run(pid, sid);
    await press(t, 'sup_srcdelok_' + pid + '_' + only);
    expect(q(t.storeDb, 'SELECT remote_variation_id FROM product_sources')).toEqual([{ remote_variation_id: 'x' }]);
    expect(one(t.storeDb, 'SELECT pricing_mode, stock_mode FROM customer_products').pricing_mode).toBe('auto');
  });

  it('deleting the really last source still turns the option manual', async () => {
    const { t, pid } = await setup();
    const only = one(t.storeDb, 'SELECT id FROM product_sources').id as number;
    await press(t, 'sup_srcdelok_' + pid + '_' + only);
    expect(one(t.storeDb, 'SELECT pricing_mode, stock_mode, cost_toman FROM customer_products'))
      .toEqual({ pricing_mode: 'manual', stock_mode: 'manual', cost_toman: null });
  });
});
