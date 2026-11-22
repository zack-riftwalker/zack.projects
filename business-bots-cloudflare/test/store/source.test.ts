import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { parseSourcePayload } from '../../src/store/source';
import { DEFAULT_REFERRAL_CONFIG } from '../../src/store/referralConfig';

const fa = (n: number) => n.toLocaleString('fa-IR');
const NOW = new Date(Date.UTC(2026, 9, 7, 8, 30)); // 2026-10-07 12:00 Tehran
const U = (id: number) => ({ id, first_name: 'U' + id });
const sourceOf = (t: TestEnv, id: number) => one(t.storeDb, 'SELECT source FROM customers WHERE telegram_id = ?', id)?.source;

describe('source links: capture', () => {
  it('payload parsing is strict and case-insensitive', () => {
    expect(parseSourcePayload('src_partnera')).toBe('partnera');
    expect(parseSourcePayload('src_PartnerA')).toBe('partnera');
    expect(parseSourcePayload('src_Bad-Name!')).toBeNull();
    expect(parseSourcePayload('src_' + 'a'.repeat(25))).toBeNull();
    expect(parseSourcePayload('ref_ABCDEFGH')).toBeNull();
  });

  it('a brand-new customer gets the source; the welcome still comes', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(U(2001), '/start src_partnera'));
    expect(sourceOf(t, 2001)).toBe('partnera');
    expect(t.tg.texts(2001).at(-1)).toContain('سلام، خوش آمدید!');
  });

  it('an existing customer opening a source link never changes anything (first touch only)', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(U(2002), '/start'));
    await t.send('store', textUpdate(U(2002), '/start src_partnera'));
    expect(sourceOf(t, 2002)).toBeNull();
    await t.send('store', textUpdate(U(2003), '/start src_first'));
    await t.send('store', textUpdate(U(2003), '/start src_second'));
    expect(sourceOf(t, 2003)).toBe('first');
  });

  it('an invalid payload is ignored', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(U(2004), '/start src_Bad-Name!'));
    expect(sourceOf(t, 2004)).toBeNull();
    expect(t.tg.texts(2004).at(-1)).toContain('سلام، خوش آمدید!');
  });

  it('ref_ links still work', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    q(t.storeDb, "INSERT OR REPLACE INTO store_kv (key, value) VALUES ('referral', ?)", JSON.stringify({ ...DEFAULT_REFERRAL_CONFIG, enabled: true, discProductId: 1 }));
    await t.send('store', textUpdate(U(2005), '/start'));
    await t.send('store', textUpdate(U(2005), '🎁 دعوت دوستان'));
    const code = /ref_([A-Z2-9]{8})/.exec(t.tg.texts(2005).at(-1)!)![1];
    await t.send('store', textUpdate(U(2006), '/start ref_' + code));
    expect(q(t.storeDb, 'SELECT * FROM referrals')).toHaveLength(1);
    expect(sourceOf(t, 2006)).toBeNull();
  });
});

describe('source links: admin wizard', () => {
  it('asks for a name, validates, and returns the t.me link', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '🔗 لینک منبع'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('مثال: partnera');
    await t.send('store', textUpdate(ADMIN, 'Bad Name!'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ نام منبع نامعتبر است.');
    await t.send('store', textUpdate(ADMIN, ' PartnerA '));
    const msg = t.tg.texts(ADMIN.id).at(-1)!;
    expect(msg).toContain('✅ لینک منبع «partnera»:');
    expect(msg).toContain('https://t.me/store_bot?start=src_partnera');
  });

  it('can be cancelled; non-admins cannot use the button', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '🔗 لینک منبع'));
    await t.send('store', callbackUpdate(ADMIN, 'srclink_cancel', { chatId: ADMIN.id }));
    await t.send('store', textUpdate(ADMIN, 'partnera'));
    expect(t.tg.texts(ADMIN.id).join('\n')).not.toContain('https://t.me/');
    await t.send('store', textUpdate(U(2010), '🔗 لینک منبع'));
    expect(t.tg.texts(2010).join('\n')).not.toContain('نام منبع');
  });

  it('the admin panel has the button', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '/panel'));
    const kb = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.reply_markup.keyboard.flat().map((b: any) => b.text);
    expect(kb).toContain('🔗 لینک منبع');
  });
});

describe('source links: sales report section', () => {
  const cust = (t: TestEnv, id: number, source: string | null, created: string) =>
    q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name, source, created_at) VALUES (?, ?, ?, ?)', id, 'c' + id, source, created);
  const order = (t: TestEnv, cid: number, price: number, status = 'confirmed') =>
    q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, purchase_source, status, decided_at) VALUES (?, 1, 'A', ?, 'receipt', ?, '2026-10-07 10:00:00')", cid, price, status);

  it('groups new customers by source, counts buyers and paid revenue, excludes 0-Toman orders; no-source comes last', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => NOW;
    seedProduct(t);
    cust(t, 1, 'partnera', '2026-10-07 09:00:00');
    cust(t, 2, 'partnera', '2026-10-07 09:10:00');
    cust(t, 3, 'partnera', '2026-10-07 09:20:00');
    for (let i = 4; i <= 8; i++) cust(t, i, null, '2026-10-07 09:30:00');
    cust(t, 9, 'old', '2026-09-01 09:00:00'); // not new in the period
    order(t, 1, 1000);
    order(t, 1, 500);
    order(t, 2, 0); // free reward: not a buyer
    order(t, 4, 2000);
    order(t, 5, 700, 'rejected');
    order(t, 9, 9999);
    await t.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    const text = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text as string;
    expect(text).toContain('🔗 منبع مشتری‌های جدید');
    expect(text).toContain('• partnera: ' + fa(3) + ' مشتری جدید، ' + fa(1) + ' خریدار، ' + fa(1500) + ' ت');
    expect(text).toContain('• (بدون منبع): ' + fa(5) + ' مشتری جدید، ' + fa(1) + ' خریدار، ' + fa(2000) + ' ت');
    expect(text.indexOf('partnera:')).toBeLessThan(text.indexOf('(بدون منبع)'));
    expect(text).not.toContain('• old');
  });

  it('is omitted when the period has no new customers', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => NOW;
    await t.send('store', textUpdate(ADMIN, '📊 گزارش فروش'));
    expect(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text).not.toContain('منبع مشتری‌های جدید');
  });
});
