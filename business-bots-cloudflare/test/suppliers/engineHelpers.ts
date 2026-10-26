import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { makeFakeAriobox, type FakeAriobox } from '../helpers/fakeAriobox';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedCard } from '../helpers/seed';
import { itemRef } from '../../src/store/suppliers/store';
import { addSupplierOk, press, setDefaults } from './helpers';

export const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };
export const NO_NAME = { id: 2003, first_name: 'Sara' };

export const iso = (hhmm: string, day = '2026-10-25') => day + 'T' + hhmm + ':00Z';

/** A shop with one ArioBox supplier and ChatGPT imported as two options: 1 month ($5.28) and 3 months ($14). */
export async function shop(opts: { monshi?: boolean } = {}) {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: opts.monshi ?? false, fetch: fake.fetch });
  fake.state.usdToman = 150000;
  fake.state.items = [
    fake.item('1300', '', 'ChatGPT', 5.28, { 'subscription-duration': '1-month', warranty: '7-days' }),
    fake.item('1300', '3m', 'ChatGPT', 14, { 'subscription-duration': '3-months', warranty: '7-days' }),
    // not imported: the backup source of the tests ($5.50 is cheaper than the sale price of the 1-month option)
    fake.item('1400', '', 'ChatGPT backup', 5.5, { 'subscription-duration': '1-month' }),
  ];
  seedCard(t);
  await setDefaults(t);
  const sid = await addSupplierOk(t, fake);
  await press(t, 'sup_imp_' + sid + '_1300');
  await press(t, 'sup_impok');
  const rows = q(t.storeDb, 'SELECT id FROM customer_products WHERE group_id IS NOT NULL ORDER BY id');
  return { t, fake, sid, m1: rows[0].id as number, m3: rows[1].id as number };
}

/** The customer goes through the real purchase flow up to the receipt; returns the pending order id. */
export async function buy(t: TestEnv, pid: number, user: { id: number; first_name: string; username?: string } = CUSTOMER): Promise<number> {
  await t.send('store', textUpdate(user, '/start'));
  await t.send('store', callbackUpdate(user, 'cust_prod_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_disc_skip_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_agree_' + pid));
  await t.send('store', photoUpdate(user, 'receipt-' + Math.random()));
  return one(t.storeDb, 'SELECT MAX(id) AS id FROM orders').id;
}

export const confirm = (t: TestEnv, orderId: number, admin = ADMIN) =>
  t.send('store', callbackUpdate(admin, 'order_confirm_' + orderId, { caption: 'CAP', chatId: admin.id }));

/** The completed answer of the fake for a remote order (one account with a link and a password containing `<`). */
export function completedOrder(fake: FakeAriobox, remoteId = '5001', over: Record<string, unknown> = {}) {
  fake.state.orders[remoteId] = {
    ok: true, order_id: Number(remoteId), status: 'completed', price: '5.28',
    accounts: [{ attributes: [{ key: 'email', value: 'a@b.c' }, { key: 'password', value: 'p<w>d' }, { key: 'activation_link', value: 'https://x.test/a' }] }],
    ...over,
  };
}

export const posts = (fake: FakeAriobox) => fake.calls.filter((c) => c.method === 'POST');
export const orderRow = (t: TestEnv, id = 1) => one(t.storeDb, 'SELECT * FROM orders WHERE id = ?', id);
export const soRow = (t: TestEnv, id = 1) => one(t.storeDb, 'SELECT * FROM supplier_orders WHERE id = ?', id);
export const events = (t: TestEnv, kind: string) => q(t.storeDb, 'SELECT * FROM fulfillment_events WHERE kind = ? ORDER BY id', kind);

/** Admin messages (text) that contain a marker. */
export const adminTexts = (t: TestEnv, marker: string, admin = ADMIN.id) => t.tg.texts(admin).filter((x) => x.includes(marker));

/** Adds the backup catalog item (1400) as the second source of an option, through the sources screen. */
export async function addBackupSource(t: TestEnv, sid: number, pid: number): Promise<number> {
  await press(t, 'sup_srcn_' + pid + '_' + sid + '_' + (await itemRef('1400', '')));
  return one(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ? AND remote_product_id = ?', pid, '1400').id;
}
