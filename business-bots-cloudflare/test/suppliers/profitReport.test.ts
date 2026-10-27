import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { formatPrice } from '../../src/store/utils';
import { itemRef } from '../../src/store/suppliers/store';
import { at, press, say } from './helpers';
import { buy, completedOrder, confirm, CUSTOMER, failedOrder, iso, NO_NAME, seedStock, shop } from './engineHelpers';
import { makeTestEnv } from '../helpers/env';

const THIRD = { id: 2004, first_name: 'Reza', username: 'reza_u' };
const REPORT = '📊 گزارش فروش';
const reportText = async (t: any, period = 'all') => {
  await press(t, 'rpt_' + period);
  return t.tg.of('editMessageText').at(-1)!.payload.text as string;
};
const fa = (n: number) => n.toLocaleString('fa-IR');

/** A shop with a delivered supplier order, a waiting one, a legacy order, two cancellations, direct buys and outside sales. */
async function busyShop() {
  const s = await shop();
  const { t, fake, sid, m1, m3 } = s;

  // A: delivered by the supplier (cost 5.28 × 150,000 = 792,000)
  const a = await buy(t, m1);
  await confirm(t, a);
  completedOrder(fake, '5001');
  await at(t, iso('09:52'));

  // B: placed at the supplier, not delivered yet (cost unknown)
  fake.state.postQueue.push({ status: 200, body: { ok: true, order_id: 5002, status: 'pending', price: 5.28 } });
  const b = await buy(t, m1, NO_NAME);
  await confirm(t, b);
  // the engine now books the catalog cost at «placed» (review N4); an item without a catalog price has none, which this order models
  q(t.storeDb, 'UPDATE orders SET cost_toman = NULL WHERE id = ?', b);

  // C: an order of a product without sources (the old flow, fulfillment NULL)
  const plain = seedProduct(t, { name: 'Plain', price: 100000 });
  await confirm(t, await buy(t, plain, THIRD));

  // D, E: two cancellations; E is refunded
  const d = await failedOrder(t, fake, m3);
  await press(t, 'fo_cancel_' + d);
  await press(t, 'fo_cr_' + d + '_cust');
  await press(t, 'fo_cok_' + d);
  const e = await failedOrder(t, fake, m3, NO_NAME);
  await press(t, 'fo_cancel_' + e);
  await press(t, 'fo_cr_' + e + '_none');
  await press(t, 'fo_cok_' + e);
  await press(t, 'fo_refund_' + e);

  // a direct buy of 2 accounts ($10.56)
  const ref = await itemRef('1300', '');
  fake.state.postQueue.push({ status: 200, body: { ok: true, order_id: 5003, status: 'pending', price: 10.56 } });
  await press(t, 'stk_buy');
  await press(t, 'stk_buys_' + sid);
  await press(t, 'stk_buyi_' + sid + '_' + ref);
  await press(t, `stk_buyq_${sid}_${ref}_2`);
  const buyOk = t.tg.calls.flatMap((c: any) => c.payload.reply_markup?.inline_keyboard ?? []).flat()
    .map((b: any) => b.callback_data).filter((d: string) => d?.startsWith(`stk_buyok_${sid}_${ref}_2_`)).at(-1)!;
  await press(t, buyOk);
  fake.state.orders['5003'] = {
    ok: true, order_id: 5003, status: 'completed', price: '10.56',
    accounts: [1, 2].map((i) => ({ attributes: [{ key: 'email', value: `d${i}@x.test` }, { key: 'password', value: 'pw' }] })),
  };
  await at(t, iso('09:56'));

  // a second batch from «my accounts» with a reported profit
  await seedStock(t, [{ email: 's1@x.test', password: 'p' }, { email: 's2@x.test', password: 'p' }], 'Other — 1 month', 750000);

  // outside sales: one account of each batch
  await press(t, 'stk_out_1');
  await say(t, '900000');
  await press(t, 'stk_out_3');
  await say(t, '400000');
  await press(t, 'stk_bp_2');
  await say(t, '-50000');
  return s;
}

describe('S8 sales report with profit (§11)', () => {
  it('numbers for a seeded mix: cost, profit, missing note, cancelled, outside sales, stock purchases, wallet spend', async () => {
    const { t, m1 } = await busyShop();
    const price = Number(one(t.storeDb, 'SELECT price FROM customer_products WHERE id = ?', m1).price);
    t.deps.now = () => new Date(); // orders are stamped by SQL with the real time, so the report's «all» must end after it
    const text = await reportText(t);

    // the existing lines stay: cancelled orders left the revenue on their own
    expect(text).toContain('💰 درآمد: ' + formatPrice(price * 2 + 100000) + ' تومان (۳ سفارش)');
    expect(text).toContain('💵 هزینه‌ی خرید: ' + formatPrice(792000) + ' ت (۱ سفارش)');
    expect(text).toContain('📈 سود سفارش‌های ربات: ' + formatPrice(price - 792000) + ' ت');
    // B has a supplier but no recorded cost; the legacy order C is not counted as missing
    expect(text).toContain('ℹ️ ۱ سفارش بدون هزینه‌ی ثبت‌شده در سود حساب نشده‌اند.');
    expect(text).toContain('❌ لغوشده: ۲ (بازپرداخت در انتظار: ۱)');
    // outside: revenue 900,000 + 400,000; profit = 900,000 − 792,000 (batch 1) + the reported −50,000 of batch 2 (its account is not counted again)
    expect(text).toContain('🛍 فروش بیرون از ربات: درآمد ' + formatPrice(1300000) + ' ت، سود ' + formatPrice(900000 - 792000 - 50000) + ' ت');
    expect(text).toContain('📦 خرید برای موجودی: ' + formatPrice(1584000 + 750000) + ' ت (' + fa(4) + ' اکانت، آزاد: ' + fa(2) + ')');
    expect(text).toContain('💳 خرج کیف پول: $21.12');
  });

  it('rows outside the period are not counted; with nothing in the period no supplier line appears', async () => {
    const { t } = await busyShop();
    t.deps.now = () => new Date();
    const past = '2020-01-01 10:00:00';
    q(t.storeDb, 'UPDATE orders SET decided_at = ?, cancelled_at = ?', past, past);
    q(t.storeDb, 'UPDATE stock_accounts SET sold_at = ? WHERE sold_at IS NOT NULL', past);
    q(t.storeDb, 'UPDATE stock_batches SET created_at = ?, reported_at = ?', past, past);
    q(t.storeDb, 'UPDATE wallet_ledger SET created_at = ?', past);
    q(t.storeDb, "UPDATE stock_accounts SET status = 'defective' WHERE status = 'available'"); // no free account either
    q(t.storeDb, "UPDATE orders SET refund_status = 'done' WHERE refund_status = 'pending'");
    const today = await reportText(t, 'today');
    for (const marker of ['هزینه‌ی خرید', 'سود سفارش‌های ربات', 'بدون هزینه', 'لغوشده', 'فروش بیرون', 'خرید برای موجودی', 'خرج کیف پول']) {
      expect(today, marker).not.toContain(marker);
    }
    const all = await reportText(t, 'all');
    expect(all).toContain('❌ لغوشده: ۲ (بازپرداخت در انتظار: ۰)');
    expect(all).toContain('💳 خرج کیف پول: $21.12');
  });

  it('a shop without suppliers sees the old report: none of the new lines', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { name: 'Plain', price: 100000 });
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await confirm(t, await buy(t, pid));
    await t.send('store', textUpdate(ADMIN, REPORT));
    const text = t.tg.texts(ADMIN.id).at(-1)!;
    expect(text).toContain('💰 درآمد:');
    for (const marker of ['هزینه‌ی خرید', 'سود', 'لغوشده', 'فروش بیرون', 'خرید برای موجودی', 'خرج کیف پول']) expect(text, marker).not.toContain(marker);
    await t.send('store', callbackUpdate(ADMIN, 'rpt_7d'));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('💰 درآمد:');
  });

  it('a stock sale to a bot customer counts its cost and profit like any order', async () => {
    const { t, m1 } = await shop();
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await seedStock(t, [{ email: 'a@x.test', password: 'p' }, { email: 'b@x.test', password: 'p' }], 'ChatGPT', 750000);
    await press(t, 'stk_send_1');
    await say(t, '2002');
    await press(t, `stk_sp_1_2002_${m1}`);
    await say(t, '500000');
    const text = await reportText(t);
    expect(text).toContain('💵 هزینه‌ی خرید: ' + formatPrice(375000) + ' ت (۱ سفارش)');
    expect(text).toContain('📈 سود سفارش‌های ربات: ' + formatPrice(125000) + ' ت');
    expect(text).not.toContain('بدون هزینه');
  });

  it('a negative profit prints with its sign and a profit of a whole batch counts only in the range of its report time', async () => {
    const { t } = await busyShop();
    // the clock is still the tests' 2026-10-25, so «today» is the day of the sales above
    q(t.storeDb, "UPDATE stock_batches SET reported_at = '2020-01-01 10:00:00' WHERE id = 2");
    const text = await reportText(t, 'today');
    // batch 2 was reported long ago: the outside profit now counts only batch 1's account
    expect(text).toContain('سود ' + formatPrice(900000 - 792000) + ' ت');
  });
});
