import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN, type TestEnv } from '../helpers/env';
import { callbackUpdate } from '../helpers/updates';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { press, say, addSupplierOk, setDefaults } from './helpers';

const BIG = 999_999_999_999; // a 12-digit counter: every id generated afterwards has 13 digits
const REMOTE_ID = 'abcdefghij_klmnopqrstuv-', REMOTE_VAR = 'ABCDEFGHIJ_KLMNOPQRSTU-'; // 24 and 23 characters

/** Every callback_data of every keyboard the bot sent or edited so far. */
function allCallbacks(t: TestEnv): string[] {
  const out: string[] = [];
  for (const c of t.tg.calls) {
    const rows: any[][] = c.payload?.reply_markup?.inline_keyboard ?? [];
    for (const b of rows.flat()) if (typeof b.callback_data === 'string') out.push(b.callback_data);
  }
  return out;
}

describe('callback data stays within Telegram\'s 64 bytes (SUPPLIER_PLAN.md §9.1)', () => {
  it('every button of the supplier screens, with maximum-length ids', async () => {
    const fake = makeFakeAriobox();
    const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
    for (const table of ['suppliers', 'customer_products', 'product_sources', 'product_groups', 'orders']) {
      t.storeDb.sqlite.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, BIG);
    }
    fake.state.usdToman = 150000;
    fake.state.items = Array.from({ length: 12 }, (_, i) => fake.item(REMOTE_ID, i === 0 ? REMOTE_VAR : 'v' + String(i).padStart(2, '0'), 'Big', 1 + i,
      { 'subscription-duration': (i + 1) + '-months' }));
    await setDefaults(t);
    const sid = await addSupplierOk(t, fake);
    expect(sid).toBeGreaterThan(BIG);

    await press(t, 'sup_s_' + sid);
    await press(t, 'sup_items_' + sid + '_0');
    await press(t, 'sup_imp_' + sid + '_' + REMOTE_ID);
    await press(t, 'sup_impv_11');
    await press(t, 'sup_impv_11');
    await press(t, 'sup_impm');
    await press(t, 'sup_impo');
    await press(t, 'sup_impo_11');
    await press(t, 'sup_impok');

    const pid = one(t.storeDb, 'SELECT MIN(id) id FROM customer_products').id as number;
    expect(pid).toBeGreaterThan(BIG);
    const srcId = one(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ?', pid).id as number;
    await press(t, 'sup_src_' + pid);
    await press(t, 'sup_pmk_' + pid);
    await press(t, 'sup_srcdel_' + pid + '_' + srcId);
    await press(t, 'sup_srcadd_' + pid);
    await press(t, `sup_srcs_${pid}_${sid}`);
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    await press(t, 'cprod_edit_toggle_stock');

    // a delivered order with a huge id: the warranty-claim contact row (fo_msg_<orderId>)
    q(t.storeDb, `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, delivered_at, expires_at, warranty_expires_at)
      VALUES (2002, ?, 'GPT', 5, 'f', 'photo', 'delivered', datetime('now','+03:30','-1 days'), datetime('now','+03:30','+29 days'), datetime('now','+03:30','+6 days'))`, pid);
    await t.send('store', callbackUpdate({ id: 2002, first_name: 'Ali' }, 'warranty_claim_' + one(t.storeDb, 'SELECT id FROM orders').id));

    const all = allCallbacks(t);
    const tooLong = all.filter((d) => Buffer.byteLength(d, 'utf8') > 64);
    expect(tooLong).toEqual([]);
    // the walk really reached the long ones
    for (const prefix of ['sup_imp_', 'sup_impv_', 'sup_impo_', 'sup_srcup_', 'sup_srcdel_', 'sup_srcn_', 'sup_srcl_', 'fo_msg_', 'sup_items_', 'cprod_edit_select_']) {
      expect(all.some((d) => d.startsWith(prefix)), prefix).toBe(true);
    }
    const longest = Math.max(...all.map((d) => Buffer.byteLength(d, 'utf8')));
    expect(longest).toBeGreaterThan(40);
  });
});
