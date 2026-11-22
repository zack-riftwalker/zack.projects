import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { ACTIVATION_CONTACT } from '../../src/store/labels';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };
const press = (t: TestEnv, data: string, who: any = ADMIN) => t.send('store', callbackUpdate(who, data));
const say = (t: TestEnv, text: string, who: any = ADMIN) => t.send('store', textUpdate(who, text));

function delivered(t: TestEnv) {
  const pid = seedProduct(t, { duration: 30, warranty: 7 });
  q(t.storeDb, `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, delivered_at, expires_at, warranty_expires_at)
    VALUES (?, ?, 'GPT Plus', 5, 'f', 'photo', 'delivered', datetime('now','+03:30','-1 days'), datetime('now','+03:30','+29 days'), datetime('now','+03:30','+6 days'))`, CUSTOMER.id, pid);
  return pid;
}

describe('✉️ پیام از طرف ربات on the warranty claim (review should-fix 6, SUPPLIER_PLAN.md §8.3)', () => {
  it('the button is answered: the admin writes, the customer gets the message, the event is logged', async () => {
    const t = makeTestEnv({ monshi: false });
    delivered(t);
    await press(t, 'warranty_claim_1', CUSTOMER);
    const claim = t.tg.of('sendMessage', ADMIN.id).find((c) => c.payload.text?.includes('درخواست گارانتی'))!;
    expect(claim.payload.reply_markup.inline_keyboard[0][1].callback_data).toBe('fo_msg_1');

    await press(t, 'fo_msg_1');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('سفارش #1');
    await say(t, 'اکانت شما در حال بررسی است');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toBe(
      '📩 پیام پشتیبانی درباره‌ی سفارش «GPT Plus»:\n\nاکانت شما در حال بررسی است\n\nبرای پاسخ به ' + ACTIVATION_CONTACT + ' پیام دهید.',
    );
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('✅ ارسال شد');
    expect(one(t.storeDb, "SELECT order_id, actor, detail FROM fulfillment_events WHERE kind = 'admin_message'"))
      .toEqual({ order_id: 1, actor: ADMIN.id, detail: 'اکانت شما در حال بررسی است' });
  });

  it('1–1000 characters: an empty or too long text is refused and the prompt stays open', async () => {
    const t = makeTestEnv({ monshi: false });
    delivered(t);
    await press(t, 'fo_msg_1');
    await say(t, 'x'.repeat(1001));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('بین ۱ تا ۱٬۰۰۰');
    expect(t.tg.texts(CUSTOMER.id)).toHaveLength(0);
    await say(t, 'x'.repeat(1000));
    expect(t.tg.texts(CUSTOMER.id)).toHaveLength(1);
  });

  it('a customer who blocked the bot: the admin is told, nothing is logged as sent', async () => {
    const t = makeTestEnv({ monshi: false });
    delivered(t);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id);
    await press(t, 'fo_msg_1');
    await say(t, 'سلام');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('❌ ارسال نشد');
    expect(q(t.storeDb, "SELECT 1 FROM fulfillment_events WHERE kind = 'admin_message'")).toHaveLength(0);
  });

  it('only admins: a customer pressing it gets nothing, an unknown order is refused', async () => {
    const t = makeTestEnv({ monshi: false });
    delivered(t);
    await press(t, 'fo_msg_1', CUSTOMER);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('دسترسی ندارید');
    await press(t, 'fo_msg_99');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('سفارش یافت نشد');
  });

  it('reached while a wizard is active, the text is the message, not the wizard input', async () => {
    const t = makeTestEnv({ monshi: false });
    delivered(t);
    await say(t, '➕ افزودن محصول');
    const products = one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n;
    await press(t, 'fo_msg_1');
    await say(t, 'پیام تست');
    expect(t.tg.texts(CUSTOMER.id)).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM customer_products').n).toBe(products);
  });
});
