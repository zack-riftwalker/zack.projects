import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { q, seedProduct } from '../helpers/seed';

const fa = (n: number) => n.toLocaleString('fa-IR');
const NOW = new Date(Date.UTC(2026, 9, 7, 8, 30));

function order(t: TestEnv, cust: number, price: number, status: string, code: number | null = null, decided = '2026-10-07 10:00:00') {
  q(t.storeDb,
    "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, purchase_source, status, decided_at, discount_code_id) VALUES (?, 1, 'A', ?, 'receipt', ?, ?, ?)",
    cust, price, status, decided, code);
}

/** 101 paid confirmed, 102 paid delivered, 103 only a 0-Toman reward, 104 only pending/rejected, 105 nothing */
function seed(t: TestEnv) {
  seedProduct(t, { name: 'A' });
  for (let i = 1; i <= 5; i++) q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', 100 + i, 'c' + i);
  order(t, 101, 100, 'confirmed');
  order(t, 102, 100, 'delivered');
  order(t, 103, 0, 'confirmed');
  order(t, 104, 100, 'pending');
  order(t, 104, 100, 'rejected');
}

describe('«💎 همه‌ی خریدارها» audience', () => {
  it('counts paid confirmed/delivered buyers only', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    expect(await t.apps().store!.db.countAudience('buyers_any')).toBe(2);
  });

  it('wizard path end to end (and the «buyers» picker still opens for the exact callback)', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    expect(JSON.stringify(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.reply_markup)).toContain('💎 همه‌ی خریدارها');
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_buyers', { chatId: ADMIN.id }));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('خریداران کدام محصول');
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_buyers_any', { chatId: ADMIN.id }));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('متن اطلاعیه');
    await t.send('store', textUpdate(ADMIN, 'VIP sale'));
    await t.send('store', callbackUpdate(ADMIN, 'announce_confirm', { chatId: ADMIN.id }));
    await t.cron(NOW);
    const got = t.tg.of('sendMessage').filter((c) => c.payload.text === 'VIP sale').map((c) => c.payload.chat_id).sort();
    expect(got).toEqual([101, 102]);
  });
});

describe('revenue per discount code', () => {
  function seedCodes(t: TestEnv) {
    seedProduct(t, { name: 'A' });
    q(t.storeDb, "INSERT INTO discount_codes (id, code, customer_product_id, discount_type, discount_value, expires_at) VALUES (1, 'BF-GPT', 1, 'percent', 10, '2999-01-01 00:00:00'), (2, 'SMALL', 1, 'percent', 10, '2999-01-01 00:00:00')");
    order(t, 1, 1000, 'confirmed', 1);
    order(t, 2, 500, 'delivered', 1);
    order(t, 3, 300, 'confirmed', 2);
    order(t, 4, 9999, 'rejected', 1);
    order(t, 5, 9999, 'pending', 1);
  }

  it('the code detail view shows orders and revenue, rejected / pending excluded', async () => {
    const t = makeTestEnv({ monshi: false });
    seedCodes(t);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_view_1', { chatId: ADMIN.id }));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('💰 درآمد: ' + fa(1500) + ' تومان (' + fa(2) + ' سفارش)');
  });

  it('the sales report lists codes by revenue; the section is omitted when no code was used', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => NOW;
    seedCodes(t);
    await t.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    const text = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text as string;
    expect(text).toContain('🎟 کدهای تخفیف');
    expect(text).toContain('• BF-GPT: ' + fa(2) + ' سفارش، ' + fa(1500) + ' ت');
    expect(text).toContain('• SMALL: ' + fa(1) + ' سفارش، ' + fa(300) + ' ت');
    expect(text.indexOf('BF-GPT')).toBeLessThan(text.indexOf('SMALL'));

    const t2 = makeTestEnv({ monshi: false });
    t2.deps.now = () => NOW;
    await t2.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    expect(t2.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text).not.toContain('🎟 کدهای تخفیف');
  });
});
