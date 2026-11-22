import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { one } from '../helpers/seed';
import { formatJalaliDateTime } from '../../src/lib/time';
import { formatPrice } from '../../src/store/utils';
import { at, callbackDataOf, press, say } from './helpers';
import { buy, completedOrder, confirm, CUSTOMER, failedOrder, iso, orderRow, pressAs, shop } from './engineHelpers';

const sent = (t: any) => t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;

describe('/order <id> (§8.5)', () => {
  it('shows the card of a needs-decision order: customer, product, money, supplier order, events and the decision buttons', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await say(t, '/order ' + orderId);
    const card = sent(t);
    expect(card.parse_mode).toBe('HTML');
    expect(card.text).toContain('📄 <b>سفارش #' + orderId + '</b> — تأییدشده، منتظر تحویل');
    expect(card.text).toContain('(@ali_user)');
    expect(card.text).toContain('<code>2002</code>');
    expect(card.text).toContain('📦 محصول: ChatGPT — ۱ ماهه');
    expect(card.text).toContain('🚚 تحویل: 🔌 خودکار از تأمین‌کننده');
    expect(card.text).toContain('🔌 سفارش تأمین‌کننده: ArioBox Main — failed');
    expect(card.text).toContain('💵 هزینه: نامشخص');
    expect(card.text).toContain('📝 نیازمند تصمیم: ❌ تنظیمات «ArioBox Main» مشکل دارد');
    expect(card.text).toContain('آخرین رویدادها');
    expect(card.text).toContain('نیازمند تصمیم');
    expect(callbackDataOf(card)).toEqual([
      'fo_retry_' + orderId, 'fo_src_' + orderId, 'fo_stock_' + orderId, 'fo_text_' + orderId, 'fo_self_' + orderId, 'fo_cancel_' + orderId,
      'fo_msg_' + orderId, 'fo_hist_' + orderId,
    ]);
    expect(card.reply_markup.inline_keyboard.flat().some((b: any) => b.url === 'https://t.me/ali_user')).toBe(true);
  });

  it('works as /order_N too; a delivered order shows cost, profit and 👁/📜; unknown ids, bad input and non-admins are handled', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    await at(t, iso('09:52'));

    await say(t, '/order_' + orderId);
    const card = sent(t);
    expect(card.text).toContain('— تحویل‌شده');
    expect(card.text).toContain('💵 هزینه: ' + formatPrice(792000) + ' ت');
    expect(card.text).toContain('سود: ');
    expect(card.text).toContain('🔌 سفارش تأمین‌کننده: ArioBox Main — completed (#5001) [completed]');
    expect(callbackDataOf(card)).toEqual(['fo_msg_' + orderId, 'fo_hist_' + orderId, 'fo_view_' + orderId]);

    await say(t, '/order 9999');
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('❌ سفارش یافت نشد.');
    await say(t, '/order');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('/order 1234');
    await say(t, '/order abc');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('/order 1234');

    t.tg.reset();
    await t.send('store', textUpdate(CUSTOMER, '/order ' + orderId));
    await t.send('store', textUpdate(CUSTOMER, '/order_' + orderId));
    expect(t.tg.of('sendMessage', CUSTOMER.id)).toHaveLength(0);
  });

  it('a cancelled order shows the reason and the refund state, with the refund button while it is pending', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_cust');
    await press(t, 'fo_cok_' + orderId);
    await say(t, '/order ' + orderId);
    expect(sent(t).text).toContain('— لغوشده');
    expect(sent(t).text).toContain('❌ لغو: درخواست مشتری | بازپرداخت: در انتظار');
    expect(callbackDataOf(sent(t))[0]).toBe('fo_refund_' + orderId);
    await press(t, 'fo_refund_' + orderId);
    await say(t, '/order ' + orderId);
    expect(sent(t).text).toContain('بازپرداخت: انجام شد');
    expect(callbackDataOf(sent(t))).not.toContain('fo_refund_' + orderId);
  });
});

describe('📜 history (fo_hist)', () => {
  it('lists the last events: time — kind — actor — detail', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_retry_' + orderId);
    await press(t, 'fo_hist_' + orderId);
    const text = sent(t).text as string;
    expect(sent(t).parse_mode).toBe('HTML');
    expect(text).toContain('📜 <b>تاریخچه‌ی سفارش #' + orderId + '</b>');
    const lines = text.split('\n').slice(2);
    expect(lines.map((l) => l.split(' — ')[1])).toEqual([
      'در صف خرید', 'شروع ثبت سفارش', 'ثبت سفارش ناموفق', 'نیازمند تصمیم', 'تلاش دوباره', 'شروع ثبت سفارش', 'در تأمین‌کننده ثبت شد',
    ]);
    expect(lines.some((l) => l.includes('ادمین ' + ADMIN.id))).toBe(true);
    expect(lines.some((l) => l.includes('سیستم'))).toBe(true);
    const created = one(t.storeDb, 'SELECT created_at FROM fulfillment_events ORDER BY id LIMIT 1').created_at;
    expect(lines[0].startsWith(formatJalaliDateTime(created))).toBe(true);
  });

  it('keeps only the newest 15 events and escapes supplier text', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 400, body: { detail: '<script> & bad' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_hist_' + orderId);
    expect(sent(t).text).toContain('&lt;script&gt; &amp; bad');
    for (let i = 0; i < 20; i++) await pressAs(t, ADMIN, 'fo_msg_' + orderId), await say(t, 'm' + i);
    await press(t, 'fo_hist_' + orderId);
    expect(sent(t).text.split('\n').slice(2)).toHaveLength(15);
    expect(sent(t).text).toContain('m19');
    expect(sent(t).text).not.toContain('m0\n');
  });
});

describe('⏸ نیازمند تصمیم in the panel (§8.5)', () => {
  it('the menu counts the orders; the list opens each card; a settled order leaves the list', async () => {
    const { t, fake, m1 } = await shop();
    await say(t, '🔌 API تأمین‌کننده');
    expect(sent(t).text).toContain('⏸ نیازمند تصمیم: ۰ سفارش');

    const a = await failedOrder(t, fake, m1);
    const b = await failedOrder(t, fake, m1, { id: 2005, first_name: 'Reza' });
    await say(t, '🔌 API تأمین‌کننده');
    expect(sent(t).text).toContain('⏸ نیازمند تصمیم: ۲ سفارش');
    expect(callbackDataOf(sent(t))).toContain('sup_na');
    expect(sent(t).reply_markup.inline_keyboard.flat().map((x: any) => x.text)).toContain('⏸ نیازمند تصمیم (۲)');

    await press(t, 'sup_na');
    const list = t.tg.of('editMessageText').at(-1)!.payload;
    expect(callbackDataOf(list)).toEqual(['fo_open_' + a, 'fo_open_' + b, 'sup_menu']);
    await press(t, 'fo_open_' + b);
    expect(sent(t).text).toContain('⏸ سفارش #' + b + ' — نیازمند تصمیم');

    await press(t, 'fo_cancel_' + a);
    await press(t, 'fo_cr_' + a + '_none');
    await press(t, 'fo_cok_' + a);
    await press(t, 'sup_na');
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual(['fo_open_' + b, 'sup_menu']);
    expect(orderRow(t, a).status).toBe('cancelled');
  });

  it('an empty list says so', async () => {
    const { t } = await shop();
    await say(t, '🔌 API تأمین‌کننده');
    await press(t, 'sup_na');
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('سفارشی نیازمند تصمیم نیست');
  });
});
