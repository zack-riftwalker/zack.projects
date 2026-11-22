import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { formatJalaliDateTime } from '../../src/lib/time';

const CUSTOMER = { id: 6001, first_name: 'Cust' };

/** a Tehran 'YYYY-MM-DD HH:MM:SS' relative to the fake D1's own clock */
const local = (t: TestEnv, offset: string) => one(t.storeDb, "SELECT datetime('now', '+03:30', ?) AS d", offset).d as string;
const jal = (s: string) => formatJalaliDateTime(s);

function seedCode(t: TestEnv, startsAt: string | null, code = 'BF') {
  q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at, starts_at) VALUES (?, 1, 'percent', 20, '2999-01-01 00:00:00', ?)", code, startsAt);
}
async function enterCode(t: TestEnv, code: string, user = CUSTOMER) {
  await t.send('store', textUpdate(user, '/start'));
  await t.send('store', callbackUpdate(user, 'cust_prod_1'));
  await t.send('store', callbackUpdate(user, 'cust_disc_enter_1'));
  await t.send('store', textUpdate(user, code));
}
const setup = () => {
  const t = makeTestEnv({ monshi: false });
  seedProduct(t, { price: 500000 });
  return t;
};

describe('discount start time: customer entry', () => {
  it('before the start: «not started» with the Jalali time', async () => {
    const t = setup();
    const start = local(t, '+2 hours');
    seedCode(t, start);
    await enterCode(t, 'BF');
    const msg = t.tg.texts(CUSTOMER.id).at(-1)!;
    expect(msg).toContain('⏳ این کد تخفیف هنوز فعال نشده است.');
    expect(msg).toContain('از ' + jal(start) + ' قابل استفاده است.');
  });

  it('after the start the code works; NULL codes are unaffected', async () => {
    const t = setup();
    seedCode(t, local(t, '-1 minutes'), 'STARTED');
    await enterCode(t, 'STARTED');
    expect(t.tg.texts(CUSTOMER.id).join('\n')).toContain('کد تخفیف اعمال شد');
    const t2 = setup();
    seedCode(t2, null, 'OLD');
    await enterCode(t2, 'OLD');
    expect(t2.tg.texts(CUSTOMER.id).join('\n')).toContain('کد تخفیف اعمال شد');
  });

  it('an order entered after the start and confirmed later is fine; confirm never fails on not_started', async () => {
    const t = setup();
    seedCode(t, local(t, '-1 minutes'));
    await enterCode(t, 'BF');
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_1'));
    await t.send('store', photoUpdate(CUSTOMER, 'r1'));
    // the start time is moved into the future before the admin confirms: the customer entered the code in time
    q(t.storeDb, "UPDATE discount_codes SET starts_at = datetime('now', '+03:30', '+1 days')");
    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'C', chatId: ADMIN.id }));
    expect(q(t.storeDb, 'SELECT customer_telegram_id FROM discount_code_redemptions')).toEqual([{ customer_telegram_id: CUSTOMER.id }]);
  });
});

describe('discount start time: admin', () => {
  const future = (t: TestEnv, offset: string) => local(t, offset);
  async function addUntilStartQuestion(t: TestEnv) {
    const exp = jal(local(t, '+30 days'));
    await t.send('store', textUpdate(ADMIN, '🎟 کد تخفیف'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_add'));
    await t.send('store', textUpdate(ADMIN, 'bfx'));
    await t.send('store', callbackUpdate(ADMIN, 'disc_type_percent'));
    await t.send('store', textUpdate(ADMIN, '10'));
    await t.send('store', callbackUpdate(ADMIN, 'disc_prod_select_1'));
    await t.send('store', callbackUpdate(ADMIN, 'disc_maxuses_unlimited'));
    await t.send('store', textUpdate(ADMIN, exp));
    return exp;
  }

  it('the add wizard asks for the start time; «from now» stores NULL', async () => {
    const t = setup();
    await addUntilStartQuestion(t);
    const ask = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(ask.text).toBe('⏰ کد از چه زمانی فعال شود؟');
    expect(ask.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(['▶️ از همین الان', '⏰ زمان مشخص']);
    await t.send('store', callbackUpdate(ADMIN, 'disc_start_now'));
    expect(one(t.storeDb, 'SELECT starts_at FROM discount_codes').starts_at).toBeNull();
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('▶️ شروع: از ابتدا');
  });

  it('a specific time is parsed, must be in the future and before the expiry', async () => {
    const t = setup();
    await addUntilStartQuestion(t);
    await t.send('store', callbackUpdate(ADMIN, 'disc_start_custom'));
    await t.send('store', textUpdate(ADMIN, jal(local(t, '-1 days'))));
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ این زمان گذشته است.');
    await t.send('store', textUpdate(ADMIN, jal(local(t, '+40 days'))));
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ زمان شروع باید قبل از انقضای کد باشد.');
    expect(q(t.storeDb, 'SELECT * FROM discount_codes')).toHaveLength(0);
    const ok = local(t, '+2 days').slice(0, 16) + ':00';
    await t.send('store', textUpdate(ADMIN, jal(ok)));
    expect(one(t.storeDb, 'SELECT starts_at FROM discount_codes').starts_at).toBe(ok);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('▶️ شروع: ' + jal(ok));
  });

  it('detail view shows the start, the list marks waiting codes ⏳, and the edit button changes it', async () => {
    const t = setup();
    seedCode(t, local(t, '+3 days'), 'LATER');
    seedCode(t, null, 'NOW');
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_list', { chatId: ADMIN.id }));
    const labels = t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(labels).toContain('⏳ ✅ LATER');
    expect(labels).toContain('✅ NOW');

    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_view_1', { chatId: ADMIN.id }));
    const view = t.tg.of('editMessageText').at(-1)!.payload;
    expect(view.text).toContain('▶️ شروع: ' + jal(one(t.storeDb, 'SELECT starts_at FROM discount_codes WHERE id = 1').starts_at));
    expect(JSON.stringify(view.reply_markup)).toContain('⏰ تغییر زمان شروع');

    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_startnow_1', { chatId: ADMIN.id }));
    expect(one(t.storeDb, 'SELECT starts_at FROM discount_codes WHERE id = 1').starts_at).toBeNull();

    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_startat_1', { chatId: ADMIN.id }));
    const when = local(t, '+1 days').slice(0, 16) + ':00';
    await t.send('store', textUpdate(ADMIN, jal(when)));
    expect(one(t.storeDb, 'SELECT starts_at FROM discount_codes WHERE id = 1').starts_at).toBe(when);
  });

  it('non-admins cannot change the start time', async () => {
    const t = setup();
    seedCode(t, null);
    await t.send('store', callbackUpdate(CUSTOMER, 'cprod_disc_startnow_1'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cprod_disc_startat_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('⛔️ دسترسی ندارید.');
  });

  it('referral reward codes keep NULL', async () => {
    const t = setup();
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at, source) VALUES ('REF-X', 1, 'percent', 10, '2999-01-01 00:00:00', 'referral')");
    expect(one(t.storeDb, 'SELECT starts_at FROM discount_codes').starts_at).toBeNull();
  });
});
