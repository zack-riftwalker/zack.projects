import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { q, seedProduct } from '../helpers/seed';
import { reportRange } from '../../src/lib/time';

const fa = (n: number) => n.toLocaleString('fa-IR');
// 2026-10-07 12:00 Tehran = Jalali 1405/07/15 → the month began on 2026-09-23
const NOW = new Date(Date.UTC(2026, 9, 7, 8, 30));

describe('reportRange', () => {
  it('today / 7d / 30d / month / all', () => {
    expect(reportRange('today', NOW)).toEqual({ from: '2026-10-07 00:00:00', to: '2026-10-08 00:00:00', fromDay: '2026-10-07', toDay: '2026-10-07' });
    expect(reportRange('7d', NOW).from).toBe('2026-09-30 12:00:00');
    expect(reportRange('30d', NOW).from).toBe('2026-09-07 12:00:00');
    expect(reportRange('month', NOW).from).toBe('2026-09-23 00:00:00');
    expect(reportRange('all', NOW).fromDay).toBeNull();
  });
  it('uses the Tehran date, not the UTC date, around midnight', () => {
    const lateUtc = new Date(Date.UTC(2026, 9, 6, 21, 0)); // 00:30 Tehran on the 7th
    expect(reportRange('today', lateUtc).from).toBe('2026-10-07 00:00:00');
  });
});

function order(t: TestEnv, pid: number, status: string, price: number, decided: string | null, source = 'receipt', code: number | null = null) {
  q(t.storeDb,
    `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, purchase_source, status, decided_at, discount_code_id)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`, pid, pid === 1 ? 'A' : 'B', price, source, status, decided, code);
}

function seed(t: TestEnv) {
  seedProduct(t, { name: 'A' });
  seedProduct(t, { name: 'B' });
  q(t.storeDb, "INSERT INTO discount_codes (id, code, customer_product_id, discount_type, discount_value, expires_at) VALUES (5, 'X', 1, 'percent', 10, '2999-01-01 00:00:00')");
  order(t, 1, 'confirmed', 100, '2026-10-07 10:00:00', 'receipt', 5);
  order(t, 1, 'delivered', 50, '2026-10-07 11:00:00', 'manual');
  order(t, 2, 'confirmed', 200, '2026-10-06 23:00:00');
  order(t, 2, 'delivered', 300, '2026-09-29 10:00:00');
  order(t, 1, 'confirmed', 400, '2026-09-10 10:00:00');
  order(t, 1, 'rejected', 70, '2026-10-07 09:00:00');
  order(t, 1, 'pending', 70, null);
  q(t.storeDb, "INSERT INTO customers (telegram_id, display_name, created_at) VALUES (11, 'a', '2026-10-07 09:00:00'), (12, 'b', '2026-10-07 09:30:00'), (13, 'c', '2026-09-01 09:00:00')");
}

async function press(t: TestEnv, cb: string) {
  await t.send('store', callbackUpdate(ADMIN, cb, { text: 'old', chatId: ADMIN.id }));
  return t.tg.of('editMessageText').at(-1)!.payload.text as string;
}

describe('sales report', () => {
  it('opens on today with period buttons; numbers per period', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => NOW;
    seed(t);
    await t.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    const first = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(first.text).toContain('گزارش فروش — امروز');
    expect(first.text).toContain('💰 درآمد: ' + fa(150) + ' تومان (' + fa(2) + ' سفارش)');
    expect(first.text).toContain('├ رسید کارت‌به‌کارت: ' + fa(1) + ' سفارش — ' + fa(100) + ' تومان');
    expect(first.text).toContain('└ خرید دستی: ' + fa(1) + ' سفارش — ' + fa(50) + ' تومان');
    expect(first.text).toContain('❌ رسید ردشده: ' + fa(1));
    expect(first.text).toContain('🎟 سفارش با کد تخفیف: ' + fa(1));
    expect(first.text).toContain('👥 مشتری جدید: ' + fa(2));
    expect(first.text).toContain('۱. A — ' + fa(2) + ' سفارش (' + fa(150) + ' تومان)');
    expect(first.text).toContain('⏳ رسید در انتظار بررسی: ' + fa(1));
    expect(first.text).toContain('🔄 تأییدشده، منتظر تحویل: ' + fa(3));
    const labels = first.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(labels).toEqual(['✔ امروز', '۷ روز', '۳۰ روز', 'این ماه (شمسی)', 'کل']);

    const d7 = await press(t, 'rpt_7d');
    expect(d7).toContain('💰 درآمد: ' + fa(350) + ' تومان (' + fa(3) + ' سفارش)');
    const d30 = await press(t, 'rpt_30d');
    expect(d30).toContain('💰 درآمد: ' + fa(1050) + ' تومان (' + fa(5) + ' سفارش)');
    const month = await press(t, 'rpt_month');
    expect(month).toContain('💰 درآمد: ' + fa(650) + ' تومان (' + fa(4) + ' سفارش)');
    expect(month).toContain('این ماه (شمسی)');
    const all = await press(t, 'rpt_all');
    expect(all).toContain('💰 درآمد: ' + fa(1050) + ' تومان');
    expect(all).toContain('ابتدا تا');
  });

  it('an empty shop shows zeros and a dash for the top list', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    const text = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text as string;
    expect(text).toContain('💰 درآمد: ' + fa(0) + ' تومان (' + fa(0) + ' سفارش)');
    expect(text).toContain('🏆 پرفروش‌ها:\n—');
  });

  it('counts qualified referrals in the period', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => NOW;
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at) VALUES (1, 2, '2026-10-07 10:00:00'), (1, 3, '2026-09-01 10:00:00'), (1, 4, NULL)");
    await t.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    expect(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text).toContain('🎁 دعوت موفق: ' + fa(1));
  });

  it('a non-admin gets nothing', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate({ id: 2002, first_name: 'Ali' }, '📊 گزارش فروش'));
    expect(t.tg.texts(2002).join('')).not.toContain('گزارش فروش');
    await t.send('store', callbackUpdate({ id: 2002, first_name: 'Ali' }, 'rpt_all'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('⛔️ دسترسی ندارید.');
  });
});
