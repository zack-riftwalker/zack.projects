import { describe, expect, it } from 'vitest';
import { makeTestEnv, type TestEnv } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { q, seedProduct } from '../helpers/seed';

const CUSTOMER = { id: 2002, first_name: 'Ali' };

function order(t: TestEnv, pid: number, status: string, extra = '', customer = CUSTOMER.id, reason: string | null = null) {
  q(t.storeDb,
    `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, reject_reason, decided_at${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES (?, ?, 'GPT Plus', 100, 'f', 'photo', ?, ?, datetime('now', '+03:30')${extra ? ', ' + extra.split('=')[1] : ''})`,
    customer, pid, status, reason);
}
const sent = (t: TestEnv) => t.tg.of('sendMessage', CUSTOMER.id);

describe('my subscriptions: orders in progress', () => {
  it('empty: the old text, unchanged', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    expect(sent(t)).toHaveLength(1);
    expect(sent(t)[0].payload.text).toContain('هنوز سفارش تحویل‌شده‌ای ندارید');
  });

  it('shows pending and confirmed orders in one message, before the delivered cards', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    order(t, pid, 'pending');
    order(t, pid, 'confirmed');
    order(t, pid, 'delivered', "delivered_at=datetime('now', '+03:30')");
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    const msgs = sent(t).map((c) => c.payload.text as string);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toContain('🧾 سفارش‌های در جریان');
    expect(msgs[0]).toContain('⏳ «GPT Plus» — رسید شما در صف بررسی است');
    expect(msgs[0]).toContain('🔄 «GPT Plus» — پرداخت تأیید شد');
    expect(msgs[1]).toContain('📦');
  });

  it('only in-progress orders: no "no delivered orders" text', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    order(t, pid, 'pending');
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    expect(sent(t)).toHaveLength(1);
    expect(sent(t)[0].payload.text).not.toContain('هنوز سفارش تحویل‌شده‌ای');
  });

  it('rejected orders show the reason and a re-upload button; reused receipts and unavailable products get none', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    const gone = seedProduct(t, { name: 'Gone' });
    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', gone);
    order(t, pid, 'rejected', '', CUSTOMER.id, 'تصویر رسید خوانا نیست.');
    order(t, pid, 'rejected', '', CUSTOMER.id, 'این رسید قبلاً برای سفارش دیگری استفاده شده است.');
    order(t, gone, 'rejected', '', CUSTOMER.id, null);
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    const msg = sent(t)[0].payload;
    expect(msg.text).toContain('دلیل: تصویر رسید خوانا نیست.');
    expect(msg.text).toContain('دلیل: نامشخص');
    expect(msg.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toEqual(['reupload_1']);
  });

  it('old rejections and other customers\' orders are not shown', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    order(t, pid, 'pending', '', 9999);
    order(t, pid, 'rejected');
    q(t.storeDb, "UPDATE orders SET decided_at = datetime('now', '+03:30', '-10 days') WHERE status = 'rejected'");
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    expect(sent(t)[0].payload.text).toContain('هنوز سفارش تحویل‌شده‌ای ندارید');
  });
});
