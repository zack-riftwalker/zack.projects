import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { onPurchaseConfirmed, sweepReferralRewards, tryGrantInviteeGift, tryGrantRewards } from '../../src/store/referrals';
import { DEFAULT_REFERRAL_CONFIG, getReferralConfig } from '../../src/store/referralConfig';

const REF = { id: 3001, first_name: 'Referrer', username: 'ref_user' };
const F1 = { id: 3101, first_name: 'Friend1' };
const F2 = { id: 3102, first_name: 'Friend2' };
const F3 = { id: 3103, first_name: 'Friend3' };
const at = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 9, 6, utcHour, utcMin));

const CFG = { ...DEFAULT_REFERRAL_CONFIG, enabled: true, required: 2, discProductId: 1 };
function enable(t: TestEnv, over: Record<string, unknown> = {}) {
  q(t.storeDb, "INSERT OR REPLACE INTO store_kv (key, value) VALUES ('referral', ?)", JSON.stringify({ ...CFG, ...over }));
}

async function linkOf(t: TestEnv, user = REF): Promise<string> {
  await t.send('store', textUpdate(user, '/start'));
  await t.send('store', textUpdate(user, '🎁 دعوت دوستان'));
  return /ref_([A-Z2-9]{8})/.exec(t.tg.texts(user.id).at(-1)!)![1];
}
const invite = (t: TestEnv, code: string, user: { id: number; first_name: string }) => t.send('store', textUpdate(user, '/start ref_' + code));

/** customer buys product `pid` with a receipt and the admin confirms it */
async function buyConfirmed(t: TestEnv, user: { id: number; first_name: string }, pid = 1) {
  await t.send('store', callbackUpdate(user, 'cust_prod_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_disc_skip_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_agree_' + pid));
  await t.send('store', photoUpdate(user, 'r-' + user.id + '-' + Math.random()));
  const id = one(t.storeDb, "SELECT MAX(id) AS id FROM orders WHERE customer_telegram_id = ?", user.id).id;
  await t.send('store', callbackUpdate(ADMIN, 'order_confirm_' + id, { caption: 'CAP', chatId: ADMIN.id }));
  return id as number;
}
const referrals = (t: TestEnv) => q(t.storeDb, 'SELECT referrer_telegram_id AS r, invitee_telegram_id AS i, qualified_at IS NOT NULL AS ok, reward_id FROM referrals ORDER BY id');
const rewards = (t: TestEnv) => q(t.storeDb, 'SELECT * FROM referral_rewards ORDER BY id');

describe('referral: customer side and attribution', () => {
  it('the customer keyboard shows «🎁 دعوت دوستان» only while the program is enabled', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    await t.send('store', textUpdate(REF, '/start'));
    expect(t.tg.of('sendMessage', REF.id).at(-1)!.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).not.toContain('ui_menu_ref');
    enable(t);
    await t.send('store', textUpdate(REF, '/panel'));
    const kb = t.tg.of('sendMessage', REF.id).at(-1)!.payload.reply_markup.inline_keyboard;
    expect(kb[2]).toEqual([{ text: '🎁 دعوت دوستان', callback_data: 'ui_menu_ref', style: 'primary' }]);
  });

  it('disabled program: the button explains, no link', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(REF, '/start'));
    await t.send('store', textUpdate(REF, '🎁 دعوت دوستان'));
    expect(t.tg.texts(REF.id).at(-1)).toContain('فعلاً فعال نیست');
  });

  it('shows rules, a stable personal link, stats and a share button', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'GPT Plus' });
    enable(t);
    const code = await linkOf(t);
    const msg = t.tg.of('sendMessage', REF.id).at(-1)!.payload;
    expect(msg.text).toContain('هر ۲ نفر که با لینک شما وارد ربات شوند');
    expect(msg.text).toContain('کد تخفیف ٪۲۰ برای «GPT Plus»');
    expect(msg.text).toContain('https://t.me/store_bot?start=ref_' + code);
    expect(msg.text).toContain('🎯 تا جایزه‌ی بعدی: ۲ دعوت موفق دیگر');
    expect(msg.reply_markup.inline_keyboard[0][0].url).toContain('https://t.me/share/url?url=');
    expect(await linkOf(t)).toBe(code); // stable
  });

  it('a brand-new customer is attributed; the referrer is told', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    enable(t);
    const code = await linkOf(t);
    await invite(t, code, F1);
    expect(referrals(t)).toEqual([{ r: REF.id, i: F1.id, ok: 0, reward_id: null }]);
    expect(t.tg.texts(REF.id).at(-1)).toContain('یک نفر با لینک دعوت شما وارد فروشگاه شد');
    expect(t.tg.texts(REF.id).at(-1)).toContain('(دعوت موفق فعلی: ۰ از ۲)');
    expect(t.tg.texts(F1.id).at(-1)).toContain('سلام، خوش آمدید!'); // the normal welcome still comes
  });

  it('existing customers, self-invites, bad codes and a disabled program record nothing', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    enable(t);
    const code = await linkOf(t);
    await t.send('store', textUpdate(F1, '/start')); // already a customer
    await invite(t, code, F1);
    await invite(t, code, REF);
    await invite(t, 'ZZZZZZZZ', F2);
    await invite(t, 'bad', F3);
    expect(referrals(t)).toEqual([]);

    enable(t, { enabled: false });
    await invite(t, code, { id: 3200, first_name: 'New' });
    expect(referrals(t)).toEqual([]);
  });

  it('a person can be invited only once', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    enable(t);
    const code = await linkOf(t);
    const other = await linkOf(t, { id: 3002, first_name: 'Other', username: 'o' } as any);
    await invite(t, code, F1);
    await invite(t, other, F1);
    expect(referrals(t)).toHaveLength(1);
  });
});

describe('referral: qualification and rewards', () => {
  async function setup(over: Record<string, unknown> = {}, monshi = false) {
    const t = makeTestEnv({ monshi });
    seedProduct(t, { name: 'GPT Plus', price: 500000 });
    enable(t, over);
    const code = await linkOf(t);
    return { t, code };
  }

  it('qualifies on the first confirmed purchase and grants a personal discount code at exactly N', async () => {
    const { t, code } = await setup();
    await invite(t, code, F1);
    await invite(t, code, F2);
    await buyConfirmed(t, F1);
    expect(referrals(t)[0].ok).toBe(1);
    expect(rewards(t)).toHaveLength(0); // 1 of 2

    await buyConfirmed(t, F2);
    expect(rewards(t)).toHaveLength(1);
    const reward = rewards(t)[0];
    expect(reward.status).toBe('issued');
    expect(referrals(t).every((r) => r.reward_id === reward.id)).toBe(true);
    const dc = one(t.storeDb, 'SELECT * FROM discount_codes');
    expect(dc).toMatchObject({ owner_telegram_id: REF.id, source: 'referral', max_uses: 1, discount_type: 'percent', discount_value: 20, customer_product_id: 1 });
    expect(dc.code).toMatch(/^REF-[A-Z2-9]{6}$/);
    expect(dc.expires_at).toMatch(/ 23:59:59$/);
    const msg = t.tg.of('sendMessage', REF.id).at(-1)!.payload;
    expect(msg.text).toContain('کد تخفیف ' + dc.code);
    expect(msg.reply_markup.inline_keyboard[0][0].callback_data).toBe('cust_prod_1');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('جایزه دعوت صادر شد');
  });

  it('the reward code works only for its owner and is hidden from the admin list', async () => {
    const { t, code } = await setup({ required: 1 });
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    const dc = one(t.storeDb, 'SELECT code FROM discount_codes').code;
    expect(await t.apps().store!.db.getAllDiscountCodes()).toHaveLength(0);

    const tryCode = async (user: { id: number; first_name: string }) => {
      await t.send('store', textUpdate(user, '/start'));
      await t.send('store', callbackUpdate(user, 'cust_prod_1'));
      await t.send('store', callbackUpdate(user, 'cust_disc_enter_1'));
      await t.send('store', textUpdate(user, dc));
      return t.tg.texts(user.id).join('\n');
    };
    expect(await tryCode(F2)).toContain('مخصوص حساب دیگری');
    expect(await tryCode(REF)).toContain('✅ کد تخفیف اعمال شد!');
  });

  it('min amount: a cheaper first order does not qualify', async () => {
    const { t, code } = await setup({ required: 1, minAmount: 600000 });
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    expect(referrals(t)[0].ok).toBe(0);
    expect(rewards(t)).toHaveLength(0);
  });

  it('a rejected receipt does not count', async () => {
    const { t, code } = await setup({ required: 1 });
    await invite(t, code, F1);
    await t.send('store', callbackUpdate(F1, 'cust_prod_1'));
    await t.send('store', callbackUpdate(F1, 'cust_disc_skip_1'));
    await t.send('store', callbackUpdate(F1, 'cust_agree_1'));
    await t.send('store', photoUpdate(F1, 'x'));
    await t.send('store', callbackUpdate(ADMIN, 'order_rejr_1_none', { caption: 'CAP', chatId: ADMIN.id }));
    expect(referrals(t)[0].ok).toBe(0);
  });

  it('a manual purchase claim qualifies too', async () => {
    const { t, code } = await setup({ required: 1 });
    await invite(t, code, F1);
    q(t.storeDb, "INSERT INTO manual_purchase_claims (creation_key, token_hash, customer_product_id, product_name, price, approved_by) VALUES ('k', 'h', 1, 'GPT Plus', 500000, ?)", ADMIN.id);
    // redeem through the DB layer + hook (the link flow itself is covered in manual.test.ts)
    const { rawToken, tokenHash } = await (await import('../../src/store/handlers/manualPurchases')).createActivationToken();
    q(t.storeDb, "UPDATE manual_purchase_claims SET token_hash = ?", tokenHash);
    await t.send('store', textUpdate(F1, '/start mp_' + rawToken));
    expect(referrals(t)[0].ok).toBe(1);
    expect(rewards(t)).toHaveLength(1);
  });

  it('repeatable: every N invites give another reward; one-time: only the first', async () => {
    for (const repeatable of [true, false]) {
      const { t, code } = await setup({ required: 1, repeatable });
      await invite(t, code, F1);
      await invite(t, code, F2);
      await buyConfirmed(t, F1);
      await buyConfirmed(t, F2);
      expect(rewards(t)).toHaveLength(repeatable ? 2 : 1);
      if (!repeatable) {
        expect(referrals(t).filter((r) => r.reward_id === null)).toHaveLength(1);
        // the sweep must not keep retrying a one-time program
        await t.cron(at(5, 5));
        expect(rewards(t)).toHaveLength(1);
      }
    }
  });

  it('two racing grants produce exactly one reward', async () => {
    const { t } = await setup();
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (3101, 'a'), (3102, 'b')");
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at) VALUES (?, 3101, datetime('now')), (?, 3102, datetime('now'))", REF.id, REF.id);
    await Promise.all([tryGrantRewards(t.apps().store!, REF.id), tryGrantRewards(t.apps().store!, REF.id)]);
    expect(rewards(t)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT * FROM discount_codes')).toHaveLength(1);
  });

  it('free-product reward: a confirmed 0-Toman order that follows the normal delivery flow', async () => {
    const { t, code } = await setup({ required: 1, reward: 'product', productId: 1 });
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    const r = rewards(t)[0];
    expect(r).toMatchObject({ status: 'issued', reward_type: 'product' });
    const order = one(t.storeDb, 'SELECT * FROM orders WHERE id = ?', r.order_id);
    expect(order).toMatchObject({ customer_telegram_id: REF.id, price: 0, status: 'confirmed', purchase_source: 'manual', product_name: 'GPT Plus' });
    expect(t.tg.texts(REF.id).join('\n')).toContain('یک «GPT Plus» رایگان');
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('سفارش رایگان #' + r.order_id);
  });

  it('free-product reward with monshi on: the bridge fallback tells the referrer and the admins', async () => {
    const { t, code } = await setup({ required: 1, reward: 'product', productId: 1 }, true);
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    const id = rewards(t)[0].order_id;
    expect(t.tg.texts(REF.id).join('\n')).toContain('در حال آماده‌سازی');
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('سفارش #' + id);
  });

  it('a reward product that vanished marks the reward failed and tells the admins', async () => {
    const { t, code } = await setup({ required: 1 });
    await invite(t, code, F1);
    q(t.storeDb, 'UPDATE customer_products SET is_active = 1'); // still active for the purchase…
    await t.send('store', callbackUpdate(F1, 'cust_prod_1'));
    await t.send('store', callbackUpdate(F1, 'cust_disc_skip_1'));
    await t.send('store', callbackUpdate(F1, 'cust_agree_1'));
    await t.send('store', photoUpdate(F1, 'p'));
    enable(t, { required: 1, discProductId: 99 }); // …but the configured reward product is gone
    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
    expect(rewards(t)[0].status).toBe('failed');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('ناموفق بود');
    expect(referrals(t)[0].reward_id).toBe(rewards(t)[0].id); // not granted twice
  });

  it('cron sweep grants rewards that were not granted inline; stale pending rewards are closed', async () => {
    const { t } = await setup();
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (3101, 'a'), (3102, 'b')");
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at) VALUES (?, 3101, datetime('now')), (?, 3102, datetime('now'))", REF.id, REF.id);
    await t.cron(at(5, 4)); // minute 4 → no sweep
    expect(rewards(t)).toHaveLength(0);
    await t.cron(at(5, 5));
    expect(rewards(t)).toHaveLength(1);

    q(t.storeDb, "INSERT INTO referral_rewards (referrer_telegram_id, status, reward_type, config_snapshot, created_at) VALUES (?, 'pending', 'discount', '{}', datetime('now', '+03:30', '-1 hours'))", REF.id);
    await t.cron(at(5, 15));
    expect(rewards(t).at(-1)!.status).toBe('failed');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('نیمه‌کاره');
  });

  it('the customer view lists rewards and the remaining invites', async () => {
    const { t, code } = await setup();
    await invite(t, code, F1);
    await invite(t, code, F2);
    await invite(t, code, F3);
    await buyConfirmed(t, F1);
    await buyConfirmed(t, F2);
    await buyConfirmed(t, F3);
    await t.send('store', textUpdate(REF, '🎁 دعوت دوستان'));
    const text = t.tg.texts(REF.id).at(-1)!;
    expect(text).toContain('👥 دعوت‌شده: ۳ نفر');
    expect(text).toContain('✅ دعوت موفق (خرید تأییدشده): ۳ نفر');
    expect(text).toContain('🎯 تا جایزه‌ی بعدی: ۱ دعوت موفق دیگر');
    expect(text).toContain('🏆 جایزه‌های شما:');
    expect(text).toMatch(/• کد REF-[A-Z2-9]{6} — ٪۲۰ تخفیف «GPT Plus» — معتبر تا /);
  });
});

describe('referral: admin panel', () => {
  const press = (t: TestEnv, data: string) => t.send('store', callbackUpdate(ADMIN, data, { text: 'x', chatId: ADMIN.id }));
  const lastEdit = (t: TestEnv) => t.tg.of('editMessageText').at(-1)!.payload;

  it('opens with the current settings and stats', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    const text = t.tg.texts(ADMIN.id).at(-1)!;
    expect(text).toContain('برنامه دعوت دوستان — 🚫 خاموش');
    expect(text).toContain('🎯 تعداد دعوت موفق برای هر جایزه: ۳');
    expect(text).toContain('💵 حداقل مبلغ خرید دوست: بدون حداقل');
    expect(text).toContain('🔁 تکرار جایزه: بله');
  });

  it('cannot be enabled before a reward product is chosen; the discount flow completes the config', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'GPT Plus' });
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    await press(t, 'ref_adm_toggle');
    const alert = t.tg.of('answerCallbackQuery').at(-1)!.payload;
    expect(alert).toMatchObject({ show_alert: true });
    expect(alert.text).toContain('محصول');
    expect((await getReferralConfig(t.apps().store!)).enabled).toBe(false);

    await press(t, 'ref_adm_type');
    await press(t, 'ref_adm_type_discount');
    await press(t, 'ref_adm_dt_percent');
    await press(t, 'ref_adm_dv_30');
    expect(lastEdit(t).text).toContain('کد تخفیف برای کدام محصول');
    await press(t, 'ref_adm_dprod_1');
    await press(t, 'ref_adm_dd_14');
    await press(t, 'ref_adm_req_5');
    await press(t, 'ref_adm_min_200000');
    await press(t, 'ref_adm_repeat');
    await press(t, 'ref_adm_toggle');
    expect(await getReferralConfig(t.apps().store!)).toMatchObject({
      enabled: true, reward: 'discount', discType: 'percent', discValue: 30, discProductId: 1, discValidDays: 14, required: 5, minAmount: 200000, repeatable: false,
    });
    expect(lastEdit(t).text).toContain('کد تخفیف ٪۳۰ برای «GPT Plus» با اعتبار ۱۴ روز');
    expect(lastEdit(t).text).toContain('🔁 تکرار جایزه: فقط یک بار');
  });

  it('free-product reward flow; switching the type switches a live program off until it is complete', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'GPT Plus' });
    enable(t);
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    await press(t, 'ref_adm_type');
    await press(t, 'ref_adm_type_product');
    expect((await getReferralConfig(t.apps().store!)).enabled).toBe(false);
    await press(t, 'ref_adm_pprod_1');
    expect(await getReferralConfig(t.apps().store!)).toMatchObject({ reward: 'product', productId: 1 });
    expect(lastEdit(t).text).toContain('محصول رایگان «GPT Plus»');
  });

  it('custom numbers are validated and saved', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    await press(t, 'ref_adm_req_custom');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('۱ تا ۵۰');
    await t.send('store', textUpdate(ADMIN, '99'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('عدد معتبر وارد کنید');
    await t.send('store', textUpdate(ADMIN, 'abc'));
    expect((await getReferralConfig(t.apps().store!)).required).toBe(3);
    await t.send('store', textUpdate(ADMIN, '۷'));
    expect((await getReferralConfig(t.apps().store!)).required).toBe(7);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('🎯 تعداد دعوت موفق برای هر جایزه: ۷');

    await press(t, 'ref_adm_min_custom');
    await t.send('store', textUpdate(ADMIN, '350,000'));
    expect((await getReferralConfig(t.apps().store!)).minAmount).toBe(350000);
  });

  it('a fixed-amount discount asks for the amount as text, then the product', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    await press(t, 'ref_adm_type_discount');
    await press(t, 'ref_adm_dt_fixed');
    await t.send('store', textUpdate(ADMIN, '50000'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('کد تخفیف برای کدام محصول');
    expect(await getReferralConfig(t.apps().store!)).toMatchObject({ discType: 'fixed', discValue: 50000 });
  });

  it('shows the top referrers; non-admins cannot touch the panel', async () => {
    const t = makeTestEnv({ monshi: false });
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (7, 'Top Person')");
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at) VALUES (7, 1, datetime('now')), (7, 2, datetime('now')), (8, 3, NULL)");
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    const text = t.tg.texts(ADMIN.id).at(-1)!;
    expect(text).toContain('👥 دعوت‌شده: ۳ · ✅ موفق: ۲');
    expect(text).toContain('۱. Top Person — ۲ دعوت موفق');

    await t.send('store', callbackUpdate(REF, 'ref_adm_toggle'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('⛔️ دسترسی ندارید.');
    expect((await getReferralConfig(t.apps().store!)).enabled).toBe(false);
  });
});

describe('referral: invitee gift (round 4, §2)', () => {
  async function setup(over: Record<string, unknown> = {}, monshi = false) {
    const t = makeTestEnv({ monshi });
    seedProduct(t, { name: 'GPT Plus', price: 500000 });
    seedProduct(t, { name: 'VPN 5G', price: 100000 });
    enable(t, { required: 1, ...over });
    const code = await linkOf(t);
    return { t, code };
  }
  const freeOrders = (t: TestEnv, id: number) => q(t.storeDb, 'SELECT * FROM orders WHERE customer_telegram_id = ? AND price = 0', id);
  const gift = (t: TestEnv) => q(t.storeDb, 'SELECT invitee_reward_eligible AS e, invitee_reward_order_id AS o FROM referrals')[0];

  it('off (null): no invitee order, nothing stamped', async () => {
    const { t, code } = await setup();
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    expect(freeOrders(t, F1.id)).toHaveLength(0);
    expect(gift(t)).toEqual({ e: 0, o: null });
    expect(rewards(t)).toHaveLength(1); // the referrer reward is unchanged
  });

  it('on: the invitee gets exactly one 0-Toman order, a message, and the admins are told; the referrer reward still works', async () => {
    const { t, code } = await setup({ inviteeProductId: 2 });
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    const orders = freeOrders(t, F1.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ price: 0, status: 'confirmed', product_name: 'VPN 5G' });
    expect(gift(t)).toEqual({ e: 1, o: orders[0].id });
    expect(t.tg.texts(F1.id).join('\n')).toContain('یک «VPN 5G» رایگان هدیه گرفتید');
    const adminText = t.tg.texts(ADMIN.id).join('\n');
    expect(adminText).toContain('هدیه‌ی دوستِ دعوت‌شده صادر شد');
    expect(adminText).toContain('سفارش رایگان #' + orders[0].id + ' — لطفاً تحویل دهید');
    expect(rewards(t)[0]).toMatchObject({ status: 'issued' });
  });

  it('idempotent: a second onPurchaseConfirmed and a racing sweep issue one gift', async () => {
    const { t, code } = await setup({ inviteeProductId: 2 });
    await invite(t, code, F1);
    const id = await buyConfirmed(t, F1);
    await onPurchaseConfirmed(t.apps().store!, { id, customer_telegram_id: F1.id, price: 500000 });
    await Promise.all([tryGrantInviteeGift(t.apps().store!, 1), tryGrantInviteeGift(t.apps().store!, 1)]);
    await t.cron(at(5, 5));
    expect(freeOrders(t, F1.id)).toHaveLength(1);
  });

  it('retroactive guard: qualified while off, option turned on later → no gift', async () => {
    const { t, code } = await setup();
    await invite(t, code, F1);
    await buyConfirmed(t, F1);
    expect(gift(t)).toEqual({ e: 0, o: null });
    enable(t, { required: 1, inviteeProductId: 2 });
    await t.cron(at(5, 5));
    expect(freeOrders(t, F1.id)).toHaveLength(0);
  });

  it('budget short at confirm time: the sweep issues the gift on a later tick', async () => {
    const { t, code } = await setup({ inviteeProductId: 2 });
    await invite(t, code, F1);
    await t.send('store', callbackUpdate(F1, 'cust_prod_1'));
    await t.send('store', callbackUpdate(F1, 'cust_disc_skip_1'));
    await t.send('store', callbackUpdate(F1, 'cust_agree_1'));
    await t.send('store', photoUpdate(F1, 'r1'));
    q(t.storeDb, "UPDATE orders SET status = 'confirmed' WHERE id = 1");
    const apps = t.apps();
    apps.budget.take(38);
    await onPurchaseConfirmed(apps.store!, { id: 1, customer_telegram_id: F1.id, price: 500000 });
    expect(gift(t)).toEqual({ e: 1, o: null }); // stamped, not issued
    await t.cron(at(5, 5));
    expect(freeOrders(t, F1.id)).toHaveLength(1);
  });

  it('a stuck claim with no order is released by the sweep after an hour', async () => {
    const { t } = await setup({ inviteeProductId: 2, enabled: true });
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (3101, 'a')");
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at, invitee_reward_eligible, invitee_reward_order_id) VALUES (?, 3101, datetime('now', '+03:30', '-2 hours'), 1, -1)", REF.id);
    await t.cron(at(5, 5));
    expect(freeOrders(t, F1.id)).toHaveLength(1);
  });

  it('an inactive gift product leaves the row pending; the panel blocks enabling with it', async () => {
    const { t, code } = await setup({ inviteeProductId: 2 });
    await invite(t, code, F1);
    q(t.storeDb, 'UPDATE customer_products SET is_active = 0 WHERE id = 2');
    await buyConfirmed(t, F1);
    expect(gift(t)).toEqual({ e: 1, o: null });
    expect(freeOrders(t, F1.id)).toHaveLength(0);
    q(t.storeDb, 'UPDATE customer_products SET is_active = 1 WHERE id = 2');
    await t.cron(at(5, 5));
    expect(freeOrders(t, F1.id)).toHaveLength(1);
  });

  it('a reward order (price 0) for the invitee triggers nothing', async () => {
    const { t, code } = await setup({ inviteeProductId: 2 });
    await invite(t, code, F1);
    await onPurchaseConfirmed(t.apps().store!, { id: 99, customer_telegram_id: F1.id, price: 0 });
    expect(gift(t)).toEqual({ e: 0, o: null });
    expect(referrals(t)[0].ok).toBe(0);
  });

  // a qualified referral whose claim (-1) is old enough for the sweep; the invitee is customer 3101
  const stuckRow = (t: TestEnv) => {
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (3101, 'a')");
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at, invitee_reward_eligible, invitee_reward_order_id) VALUES (?, 3101, datetime('now', '+03:30', '-2 hours'), 0, NULL)", REF.id);
    q(t.storeDb, 'UPDATE referrals SET invitee_reward_eligible = 1');
  };

  it('the record step fails after the order was inserted: the sweep links it, exactly one free order', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    stuckRow(t);
    const app = t.apps().store!;
    const db = (app.db as any).db;
    const batch = db.batch.bind(db);
    db.batch = async (stmts: unknown[]) => { await batch(stmts); throw new Error('lost reply'); }; // committed, but the caller sees an error
    await tryGrantInviteeGift(app, 1);
    expect(gift(t).o).not.toBeNull(); // linked in the same transaction
    // the older, non-atomic flow left the claim at -1 with an order; the sweep must not issue a second one
    q(t.storeDb, 'UPDATE referrals SET invitee_reward_order_id = -1');
    await t.cron(at(5, 5));
    expect(freeOrders(t, 3101)).toHaveLength(1);
    expect(gift(t).o).toBe(freeOrders(t, 3101)[0].id);
  });

  it('an error after the insert committed (claim kept, order unknown to the caller): one free order after the sweep', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    stuckRow(t);
    const app = t.apps().store!;
    const db = (app.db as any).db;
    const batch = db.batch.bind(db);
    db.batch = async (stmts: unknown[]) => { await batch(stmts); throw new Error('lost reply'); };
    await tryGrantInviteeGift(app, 1);
    q(t.storeDb, 'UPDATE referrals SET invitee_reward_order_id = -1'); // the state the old two-step flow could leave
    expect(freeOrders(t, 3101)).toHaveLength(1);
    await t.cron(at(5, 5));
    await t.cron(at(5, 15));
    expect(freeOrders(t, 3101)).toHaveLength(1);
  });

  it('the record step throws before anything commits: the claim stays for the sweep, which then issues exactly one order', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    stuckRow(t);
    const app = t.apps().store!;
    const db = (app.db as any).db;
    db.batch = async () => { throw new Error('D1 down'); };
    await tryGrantInviteeGift(app, 1);
    expect(gift(t).o).toBe(-1); // not released at once: we can't be sure
    expect(freeOrders(t, 3101)).toHaveLength(0);
    await t.cron(at(5, 5));
    expect(freeOrders(t, 3101)).toHaveLength(1);
  });

  it('a gift claim whose free order exists is never released by the sweep', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    stuckRow(t);
    q(t.storeDb, 'UPDATE referrals SET invitee_reward_order_id = -1');
    q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, status, created_at) VALUES (3101, 2, 'VPN 5G', 0, 'confirmed', datetime('now', '+03:30', '-1 hours'))");
    await t.cron(at(5, 5));
    expect(freeOrders(t, 3101)).toHaveLength(1);
    expect(gift(t).o).toBe(freeOrders(t, 3101)[0].id);
  });

  it('qualifyReferral stamps the gift eligibility in the same statement', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    q(t.storeDb, 'INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id) VALUES (1, 11), (1, 12)');
    const db = t.apps().store!.db;
    expect(await db.qualifyReferral(1, 5, true)).toBe(true);
    expect(await db.qualifyReferral(2, 6)).toBe(true);
    expect(q(t.storeDb, 'SELECT invitee_reward_eligible AS e FROM referrals ORDER BY id').map((r) => r.e)).toEqual([1, 0]);
  });

  it('turning the gift off clears the rows still waiting for it (turning it on later is not retroactive)', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    stuckRow(t);
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at, invitee_reward_eligible, invitee_reward_order_id) VALUES (?, 3102, datetime('now'), 1, 99)", REF.id);
    enable(t, { required: 1, inviteeProductId: 2 });
    await t.send('store', callbackUpdate(ADMIN, 'ref_adm_inv_off'));
    expect(q(t.storeDb, 'SELECT invitee_reward_eligible AS e FROM referrals ORDER BY id').map((r) => r.e)).toEqual([0, 1]); // an issued gift keeps its stamp
    enable(t, { required: 1, inviteeProductId: 2 });
    await t.cron(at(5, 5));
    expect(freeOrders(t, 3101)).toHaveLength(0);
  });

  it('the gift sweep still runs when the referrer loop stops for budget', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    q(t.storeDb, "INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id, qualified_at) VALUES (5, 1, datetime('now')), (5, 2, datetime('now'))"); // a referrer ready for a reward
    enable(t, { required: 2, inviteeProductId: 2 });
    stuckRow(t);
    q(t.storeDb, 'UPDATE referrals SET invitee_reward_order_id = -1 WHERE invitee_telegram_id = 3101');
    const app = t.apps().store!;
    app.apps.budget.take(30); // 20 left: the sweep's own queries fit, a grant (17+) no longer does after them
    await sweepReferralRewards(app);
    expect(q(t.storeDb, 'SELECT invitee_reward_order_id AS o FROM referrals WHERE invitee_telegram_id = 3101')[0].o).toBeNull(); // the stuck claim was released
  });

  it('customer view mentions the friend gift; the admin picker sets and clears it', async () => {
    const { t } = await setup({ inviteeProductId: 2 });
    await t.send('store', textUpdate(REF, '🎁 دعوت دوستان'));
    expect(t.tg.texts(REF.id).at(-1)).toContain('🤝 دوستتان هم با اولین خریدش یک «VPN 5G» رایگان هدیه می‌گیرد.');

    enable(t, { required: 1 });
    await t.send('store', textUpdate(ADMIN, '🎁 دعوت دوستان'));
    const panel = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(JSON.stringify(panel.reply_markup)).toContain('هدیه‌ی دوستِ دعوت‌شده: خاموش');
    await t.send('store', callbackUpdate(ADMIN, 'ref_adm_inv'));
    await t.send('store', callbackUpdate(ADMIN, 'ref_adm_iprod_2'));
    expect(JSON.parse(q(t.storeDb, "SELECT value FROM store_kv WHERE key = 'referral'")[0].value).inviteeProductId).toBe(2);
    await t.send('store', callbackUpdate(ADMIN, 'ref_adm_inv_off'));
    expect(JSON.parse(q(t.storeDb, "SELECT value FROM store_kv WHERE key = 'referral'")[0].value).inviteeProductId).toBeNull();
  });
});
