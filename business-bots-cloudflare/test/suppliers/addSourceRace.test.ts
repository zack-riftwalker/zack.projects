import { describe, expect, it } from 'vitest';
import { makeTestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one, q, seedProduct } from '../helpers/seed';
import { at, press, addSupplierOk, setDefaults, callbackDataOf, lastSent, DUE } from './helpers';

async function setup() {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = [fake.item('1000', '', 'Alpha', 1), fake.item('1100', '', 'Beta', 2), fake.item('1200', '', 'Gamma', 3)];
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  const pid = seedProduct(t, { name: 'Mine' });
  await press(t, 'sup_srcadd_' + pid);
  await press(t, `sup_srcs_${pid}_${sid}`);
  const list = t.tg.calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').at(-1)!.payload;
  const buttonFor = (name: string) => list.reply_markup.inline_keyboard.flat().find((b: any) => b.text.startsWith(name)).callback_data as string;
  return { t, fake, sid, pid, buttonFor };
}

describe('adding a source identifies the item by its remote ids, not by a list position (review should-fix 3)', () => {
  it('the catalog is re-sorted by a sync between the list and the tap: the tapped item is still the one linked', async () => {
    const { t, fake, pid, buttonFor } = await setup();
    const beta = buttonFor('Beta');
    fake.state.items = [fake.item('0900', '', 'Zero', 1), ...fake.state.items];
    await at(t, DUE);
    await press(t, beta);
    expect(q(t.storeDb, 'SELECT remote_product_id, remote_variation_id FROM product_sources WHERE customer_product_id = ?', pid))
      .toEqual([{ remote_product_id: '1100', remote_variation_id: '' }]);
  });

  it('the item vanished: a clear message and no source', async () => {
    const { t, fake, pid, buttonFor } = await setup();
    const beta = buttonFor('Beta');
    fake.state.items = fake.state.items.filter((i: any) => i.product_id !== '1100');
    await at(t, DUE);
    await press(t, beta);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM product_sources').n).toBe(0);
    expect(t.tg.texts(1001).at(-1)).toContain('❌ این گزینه دیگر در کاتالوگ نیست.');
  });

  it('every generated callback fits Telegram\'s 64 bytes', async () => {
    const { buttonFor } = await setup();
    expect(Buffer.byteLength(buttonFor('Alpha'))).toBeLessThanOrEqual(64);
  });
});
