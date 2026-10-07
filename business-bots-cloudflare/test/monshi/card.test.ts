import { describe, expect, it } from 'vitest';
import { ADMIN, budgets, makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { businessMessageUpdate, callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { q, seedProduct } from '../helpers/seed';
import { CUST, connect, setHours, setSetting } from '../helpers/monshi';
import { customerCardLines } from '../../src/monshi/views';
import { formatJalaliDate } from '../../src/lib/time';

const fa = (n: number) => n.toLocaleString('fa-IR');

function order(t: TestEnv, pid: number, status: string, price: number, extra: { expires?: string | null; delivered?: boolean } = {}) {
  const expires = extra.expires === undefined ? 'NULL' : extra.expires === null ? 'NULL' : `datetime('now', '+03:30', '${extra.expires}')`;
  q(t.storeDb,
    `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, delivered_at, expires_at)
     VALUES (?, ?, 'GPT Plus', ?, 'f', 'photo', ?, ${extra.delivered ? "datetime('now', '+03:30')" : 'NULL'}, ${expires})`, CUST.id, pid, price, status);
}

async function setup(opts: { store?: boolean } = {}) {
  const t = makeTestEnv({ store: opts.store });
  await connect(t);
  setHours(t, 'closed');
  setSetting(t, 'greeting_enabled', '0');
  return t;
}
const handoff = async (t: TestEnv, text = 'رمزم کار نمیکنه') => {
  await t.send('monshi', businessMessageUpdate(CUST, text));
  return t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.text as string;
};

describe('customer card in handoff notifications', () => {
  it('a customer who never bought: 🆕 line, first-message line, in the right place', async () => {
    const t = await setup();
    const text = await handoff(t);
    const lines = text.split('\n');
    expect(lines.findIndex((l) => l.startsWith('💬'))).toBeLessThan(lines.findIndex((l) => l.includes('🆕 هنوز از فروشگاه خرید نکرده')));
    expect(text).toContain('👋 اولین پیام به پشتیبانی: ');
    const linkIdx = lines.findIndex((l) => /^🔗 https:\/\/t\.me\/cust_user$/.test(l));
    expect(linkIdx).toBeGreaterThan(lines.findIndex((l) => l.startsWith('👋')));
    expect(lines.at(-1)).toBe('↩️ برای جواب دادن، روی همین پیام Reply بزنید.');
  });

  it('a buyer: purchase count and spend, active subscriptions (dated and undated), pending and preparing orders', async () => {
    const t = await setup();
    const pid = seedProduct(t);
    order(t, pid, 'delivered', 100000, { delivered: true, expires: '+10 days' });
    order(t, pid, 'delivered', 50000, { delivered: true, expires: null });
    order(t, pid, 'delivered', 70000, { delivered: true, expires: '-3 days' }); // expired: not listed
    order(t, pid, 'confirmed', 30000);
    order(t, pid, 'pending', 99999);
    const text = await handoff(t);
    expect(text).toContain('🛍 سابقه فروشگاه: ' + fa(4) + ' خرید (' + fa(250000) + ' تومان)');
    expect(text).toMatch(/✅ اشتراک فعال: GPT Plus تا \d+\/\d+\/\d+ \(۱۰ روز مانده\)/);
    expect(text).toContain('✅ اشتراک فعال: GPT Plus (بدون تاریخ انقضا)');
    expect(text.match(/✅ اشتراک فعال/g)).toHaveLength(2);
    expect(text).toContain('⏳ ۱ رسید در انتظار بررسی · 🔄 ۱ سفارش در حال آماده‌سازی');
    expect(text).not.toContain('🆕');
  });

  it('the store disabled: only the first-message line', async () => {
    const t = await setup({ store: false });
    const text = await handoff(t);
    expect(text).not.toContain('🛍');
    expect(text).not.toContain('🆕');
    expect(text).toContain('👋 اولین پیام به پشتیبانی');
  });

  it('a store failure never blocks the notification', async () => {
    const t = await setup();
    t.storeDb.sqlite.exec('DROP TABLE orders');
    const text = await handoff(t);
    expect(text).toContain('پیام نیازمند بررسی شما');
    expect(text).toContain('🔗');
  });

  it('the handoff path stays well inside the call budget', async () => {
    const t = await setup();
    order(t, seedProduct(t), 'delivered', 1, { delivered: true, expires: '+5 days' });
    budgets.length = 0;
    await handoff(t);
    expect(budgets.at(-1)!.used).toBeLessThanOrEqual(35);
  });
});

describe('customerCardLines (pure)', () => {
  it('expired-today subscriptions show 0 days; unknown first-seen is skipped', () => {
    const now = new Date(Date.UTC(2026, 9, 7));
    const lines = customerCardLines({ purchases: 1, spent: 10, lastOrderAt: '2026-10-01 10:00:00', pending: 0, preparing: 0, active: [{ product: 'P', expiresAt: '2026-10-06 00:00:00' }] }, null, now);
    expect(lines[0]).toContain('آخرین: ' + formatJalaliDate('2026-10-01'));
    expect(lines[1]).toContain('(۰ روز مانده)');
    expect(lines).toHaveLength(2);
  });
});

describe('/customer', () => {
  it('shows the card, the last messages and a pause button — by username and by id', async () => {
    const t = await setup();
    const pid = seedProduct(t);
    order(t, pid, 'delivered', 100000, { delivered: true, expires: '+10 days' });
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام ' + 'x'.repeat(200)));
    t.tg.reset();
    await t.send('monshi', textUpdate(OWNER, '/customer @cust_user'));
    const msg = t.tg.of('sendMessage', OWNER.id).at(-1)!.payload;
    expect(msg.text).toContain('👤 Cust (@cust_user)');
    expect(msg.text).toContain('🛍 سابقه فروشگاه: ' + fa(1) + ' خرید');
    expect(msg.text).toContain('💬 آخرین پیام‌ها:');
    const msgLine = msg.text.split('\n').find((l: string) => l.startsWith('👤 سلام'))!;
    expect(msgLine.length).toBeLessThanOrEqual(84);
    expect(msg.reply_markup.inline_keyboard[0][0].callback_data).toBe('pause_chat:' + CUST.id);

    await t.send('monshi', textUpdate(OWNER, '/customer ' + CUST.id));
    expect(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.text).toContain('👤 Cust (@cust_user)');
  });

  it('a paused chat offers «resume»; unknown customers and missing args are explained', async () => {
    const t = await setup();
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام'));
    q(t.monshiDb, "UPDATE customers SET automation_paused_until = '2999-01-01T00:00:00+00:00'");
    await t.send('monshi', textUpdate(OWNER, '/customer @cust_user'));
    expect(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('resume_chat:' + CUST.id);
    await t.send('monshi', textUpdate(OWNER, '/customer @nobody'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('مشتری‌ای با این مشخصات پیدا نشد');
    await t.send('monshi', textUpdate(OWNER, '/customer'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('فرمت: /customer');
  });

  it('is owner-only and listed in /help', async () => {
    const t = await setup();
    await t.send('monshi', textUpdate({ id: 12345, first_name: 'X' }, '/customer 1'));
    expect(t.tg.of('sendMessage', 12345)).toHaveLength(0);
    await t.send('monshi', textUpdate(OWNER, '/help'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('/customer');
  });
});

describe('receipt caption history (store)', () => {
  const CUSTOMER = { id: 2002, first_name: 'Ali' };
  async function buy(t: TestEnv, pid: number, file: string) {
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    await t.send('store', photoUpdate(CUSTOMER, file));
    return t.tg.of('copyMessage').at(-1)!.payload.caption as string;
  }

  it('first purchase vs returning customer', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    expect(await buy(t, pid, 'a')).toContain('🆕 اولین خرید این مشتری');
    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
    const second = await buy(t, pid, 'b');
    expect(second).toContain('🧾 سابقه: 1 خرید تأییدشده');
    expect(second).not.toContain('🆕');
  });
});
