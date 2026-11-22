import { describe, expect, it } from 'vitest';
import { makeTestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { Markup } from '../../src/lib/markup';
import { showScreen } from '../../src/store/ui';
import { GrammyError } from 'grammy';

const C = { id: 2002, first_name: 'Ali', username: 'ali_user' };

describe('button colors', () => {
  it('adds the style key only when given', () => {
    expect(Markup.button.callback('a', 'b')).toEqual({ text: 'a', callback_data: 'b' });
    expect('style' in Markup.button.callback('a', 'b')).toBe(false);
    expect(Markup.button.callback('a', 'b', 'success')).toEqual({ text: 'a', callback_data: 'b', style: 'success' });
    expect(Markup.button.url('a', 'https://t.me/x')).toEqual({ text: 'a', url: 'https://t.me/x' });
    expect(Markup.button.url('a', 'https://t.me/x', 'primary')).toEqual({ text: 'a', url: 'https://t.me/x', style: 'primary' });
  });
});

/** Runs showScreen against a hand-made ctx on the fake Telegram. */
function harness() {
  const t = makeTestEnv();
  const api = t.tg.makeApi('store-token');
  const session: any = {};
  let editError: Error | null = null;
  const base: any = { session, api };
  const mk = (cbMessageId: number | null) => ({
    ...base,
    callbackQuery: cbMessageId == null ? undefined : { message: { message_id: cbMessageId } },
    reply: (text: string, extra: any) => api.sendMessage(C.id, text, extra),
    editMessageText: async (text: string, extra: any) => {
      if (editError) throw editError;
      return api.editMessageText(C.id, cbMessageId!, text, extra);
    },
  });
  return { t, session, mk, setEditError: (e: Error | null) => { editError = e; } };
}
const kb = Markup.inlineKeyboard([[Markup.button.callback('x', 'y')]]).reply_markup;

describe('showScreen', () => {
  it('edits when the pressed message is the screen', async () => {
    const h = harness();
    h.session.screenMsgId = 55;
    await showScreen(h.mk(55) as any, 'hi', { reply_markup: kb });
    expect(h.t.tg.of('editMessageText')).toHaveLength(1);
    expect(h.t.tg.of('editMessageText')[0].payload.message_id).toBe(55);
    expect(h.t.tg.of('sendMessage')).toHaveLength(0);
  });

  it('sends a new message (and records it) when the pressed message is not the screen — announcement case', async () => {
    const h = harness();
    h.session.screenMsgId = 55;
    await showScreen(h.mk(77) as any, 'hi', { reply_markup: kb });
    expect(h.t.tg.of('editMessageText')).toHaveLength(0);
    expect(h.t.tg.of('sendMessage')).toHaveLength(1);
    expect(h.session.screenMsgId).toBe(h.t.tg.of('sendMessage')[0].result.message_id);
  });

  it('sends when there is no callback, or no screen yet', async () => {
    const h = harness();
    await showScreen(h.mk(null) as any, 'a', { reply_markup: kb });
    await showScreen(h.mk(9) as any, 'b', { reply_markup: kb });
    expect(h.t.tg.of('sendMessage')).toHaveLength(2);
  });

  it('ignores "message is not modified"', async () => {
    const h = harness();
    h.session.screenMsgId = 55;
    h.setEditError(new GrammyError('x', { ok: false, error_code: 400, description: 'Bad Request: message is not modified: specified new message content' } as any, 'editMessageText', {}));
    await showScreen(h.mk(55) as any, 'hi', { reply_markup: kb });
    expect(h.t.tg.of('sendMessage')).toHaveLength(0);
    expect(h.session.screenMsgId).toBe(55);
  });

  it("falls back to a send on \"message can't be edited\"", async () => {
    const h = harness();
    h.session.screenMsgId = 55;
    h.setEditError(new GrammyError('x', { ok: false, error_code: 400, description: "Bad Request: message can't be edited" } as any, 'editMessageText', {}));
    await showScreen(h.mk(55) as any, 'hi', { reply_markup: kb });
    expect(h.t.tg.of('sendMessage')).toHaveLength(1);
    expect(h.session.screenMsgId).not.toBe(55);
  });
});

describe('main menu (U1)', () => {
  const menuOf = (t: ReturnType<typeof makeTestEnv>) => t.tg.of('sendMessage', C.id).at(-1)!.payload;

  it('new customer /start: keyboard-removal message first, then the colored menu', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(C, '/start'));
    const sent = t.tg.of('sendMessage', C.id);
    expect(sent).toHaveLength(2);
    expect(sent[0].payload.text).toBe('✨ منوی ربات به‌روز شد.');
    expect(sent[0].payload.reply_markup).toEqual({ remove_keyboard: true });
    expect(sent[1].payload.parse_mode).toBe('Markdown');
    expect(sent[1].payload.text).toBe('👋 *سلام، خوش آمدید!*\n\nاز دکمه‌های زیر انتخاب کنید:');
    expect(sent[1].payload.reply_markup.inline_keyboard).toEqual([
      [{ text: '🛍 محصولات', callback_data: 'ui_menu_shop', style: 'success' }],
      [{ text: '📋 اشتراک‌های من', callback_data: 'ui_menu_subs', style: 'primary' }],
      [{ text: '💬 پشتیبانی', url: 'https://t.me/maiposhtibani' }],
    ]);
  });

  it('second /start: only the menu', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(C, '/start'));
    t.tg.reset();
    await t.send('store', textUpdate(C, '/start'));
    expect(t.tg.of('sendMessage', C.id)).toHaveLength(1);
    expect(menuOf(t).text).toContain('سلام، خوش آمدید!');
  });

  it('old reply-keyboard label still opens the shop (and removes the keyboard once)', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(C, '🛍 لیست محصولات'));
    const texts = t.tg.texts(C.id);
    expect(texts[0]).toBe('✨ منوی ربات به‌روز شد.');
    expect(texts[1]).toContain('فعلاً محصولی');
  });

  it('ui_menu_home re-shows the menu; pressing it on the screen edits in place', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(C, '/start'));
    const screenId = t.tg.lastSentId(C.id);
    await t.send('store', callbackUpdate(C, 'ui_menu_home', { message_id: screenId }));
    const edit = t.tg.of('editMessageText').at(-1)!;
    expect(edit.payload.message_id).toBe(screenId);
    expect(edit.payload.text).toContain('سلام، خوش آمدید!');
  });

  it('admin /start is unchanged', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate({ id: 1001, first_name: 'Admin' }, '/start'));
    const p = t.tg.of('sendMessage', 1001).at(-1)!.payload;
    expect(p.text).toContain('سلام مدیر!');
    expect(p.reply_markup.keyboard).toBeTruthy();
  });
});

// ─── U2: shop screens ────────────────────────────────────────────────────────

import { budgets } from '../helpers/env';
import { photoUpdate } from '../helpers/updates';
import { one, q, seedCard, seedProduct } from '../helpers/seed';
import { withHeader } from '../../src/store/ui';

const kbOf = (c: any) => c.payload.reply_markup.inline_keyboard as any[][];
const datas = (c: any) => kbOf(c).flat().map((b) => b.callback_data ?? b.url);
const lastSend = (t: any) => t.tg.of('sendMessage', C.id).at(-1)!;

describe('withHeader', () => {
  it('shifts the body entities by the header length in UTF-16 units (Persian, emoji, bold)', () => {
    const header = '📦 محصول ✨\n';
    const r = withHeader(header, [{ type: 'bold', offset: 3, length: 5 }], 'قانون یک و دو', [{ type: 'bold', offset: 6, length: 2 }]);
    expect(r.text).toBe(header + 'قانون یک و دو');
    expect(r.entities).toEqual([
      { type: 'bold', offset: 3, length: 5 },
      { type: 'bold', offset: header.length + 6, length: 2 },
    ]);
    expect(header.length).toBe(11); // the emoji counts 2 units
    expect(r.text.slice(header.length + 6, header.length + 8)).toBe('یک'.slice(0, 2));
  });
  it('no body entities → header entities only', () => {
    expect(withHeader('h\n', [], 'body', null).entities).toEqual([]);
  });
});

describe('shop screens', () => {
  async function setup(opts: { name?: string; terms?: string | null } = {}) {
    const t = makeTestEnv({ monshi: false });
    seedCard(t);
    const pid = seedProduct(t, { name: opts.name ?? 'GPT_Plus *x*', terms: opts.terms ?? null });
    await t.send('store', textUpdate(C, '/start'));
    return { t, pid };
  }
  /** presses `data` on the customer's current screen message */
  const press = async (t: any, data: string, id = screenId(t)) => {
    await t.send('store', callbackUpdate(C, data, { message_id: id }));
  };
  // the screen id is the newest sendMessage result (edits keep it)
  const screenId = (t: any) => t.tg.lastSentId(C.id);

  it('whole purchase happens in one message and ends with the same order as before', async () => {
    const { t, pid } = await setup();
    const id = screenId(t);
    await press(t, 'ui_menu_shop');
    await press(t, 'cust_prod_' + pid);
    await press(t, 'ui_pay_' + pid);
    await press(t, 'cust_agree_' + pid);
    // every step edited the same message; nothing new was sent after /start
    expect(t.tg.of('editMessageText').map((c: any) => c.payload.message_id)).toEqual([id, id, id, id]);
    expect(t.tg.of('sendMessage', C.id)).toHaveLength(2); // removal notice + menu
    const shop = t.tg.of('editMessageText')[0].payload;
    expect(shop.text).toBe('🛍 *محصولات*\n\nیک دسته را انتخاب کنید:');
    expect(shop.reply_markup.inline_keyboard[0][0]).toMatchObject({ callback_data: 'cust_prod_' + pid, style: 'success' });
    expect(shop.reply_markup.inline_keyboard.at(-1)).toEqual([{ text: '🏠 منوی اصلی', callback_data: 'ui_menu_home' }]);
    const prod = t.tg.of('editMessageText')[1].payload;
    expect(prod.text).toContain('📦 GPT_Plus *x*');
    expect(prod.text).toContain('⏱ مدت: 30 روز');
    expect(prod.text).toContain('🛡 گارانتی: 7 روز');
    expect(prod.reply_markup.inline_keyboard[1][0]).toMatchObject({ callback_data: 'ui_pay_' + pid, style: 'success' });
    expect(prod.reply_markup.inline_keyboard[0][0]).toMatchObject({ callback_data: 'cust_disc_enter_' + pid, style: 'primary' });
    const agree = t.tg.of('editMessageText')[2].payload;
    expect(agree.reply_markup.inline_keyboard[0]).toMatchObject([{ callback_data: 'cust_agree_' + pid, style: 'success' }, { callback_data: 'cust_decline_' + pid, style: 'danger' }]);
    expect(t.tg.of('editMessageText')[3].payload.text).toContain('6037-1234-1234-1234');

    await t.send('store', photoUpdate(C));
    expect(one(t.storeDb, 'SELECT status, price, customer_product_id FROM orders')).toEqual({ status: 'pending', price: 500000, customer_product_id: pid });
    const ok = lastSend(t);
    expect(ok.payload.text).toContain('رسید شما دریافت شد');
    expect(datas(ok)).toEqual(['ui_menu_home']);
  });

  it('discount code path: prompt edits in place, valid code answers with ONE new screen, old keyboard removed', async () => {
    const { t, pid } = await setup();
    await t.apps().store!.db.createDiscountCode({ code: 'OFF20', customerProductId: pid, discountType: 'percent', discountValue: 20, maxUses: null, expiresAt: '2099-01-01 00:00:00' });
    await press(t, 'ui_menu_shop');
    await press(t, 'cust_prod_' + pid);
    await press(t, 'cust_disc_enter_' + pid);
    const prompt = t.tg.of('editMessageText').at(-1)!.payload;
    expect(prompt.text).toBe('🎟 لطفاً کد تخفیف را تایپ کنید:');
    expect(prompt.reply_markup.inline_keyboard).toEqual([[{ text: '🔙 بازگشت', callback_data: 'cust_prod_' + pid }]]);
    const promptId = screenId(t);
    t.tg.reset();
    await t.send('store', textUpdate(C, 'off20'));
    expect(t.tg.of('sendMessage', C.id)).toHaveLength(1);
    const agree = lastSend(t).payload;
    expect(agree.text.startsWith('✅ کد تخفیف اعمال شد!\n\n📦 GPT_Plus *x*')).toBe(true);
    expect(agree.text).toContain('قیمت با تخفیف');
    expect(agree.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['cust_agree_' + pid, 'cust_decline_' + pid]);
    const drop = t.tg.of('editMessageReplyMarkup', C.id).at(-1)!.payload;
    expect(drop).toMatchObject({ message_id: promptId, reply_markup: { inline_keyboard: [] } });
    // the new message is now the screen
    await press(t, 'cust_agree_' + pid);
    expect(t.tg.of('editMessageText').at(-1)!.payload.message_id).toBe(screenId(t));
    await t.send('store', photoUpdate(C));
    expect(one(t.storeDb, 'SELECT price, discount_code_id FROM orders')).toEqual({ price: 400000, discount_code_id: 1 });
  });

  it('invalid code: same error text, «پرداخت بدون کد» + home', async () => {
    const { t, pid } = await setup();
    await press(t, 'ui_menu_shop');
    await press(t, 'cust_prod_' + pid);
    await press(t, 'cust_disc_enter_' + pid);
    await t.send('store', textUpdate(C, 'NOPE'));
    const m = lastSend(t);
    expect(m.payload.text).toContain('می‌توانید دوباره تلاش کنید، یا بدون کد ادامه دهید.');
    expect(kbOf(m)[0][0]).toMatchObject({ text: '💳 پرداخت بدون کد', callback_data: 'ui_pay_' + pid, style: 'success' });
    expect(datas(m)).toEqual(['ui_pay_' + pid, 'ui_menu_home']);
    // can still retry: the code entry is still armed
    expect(t.tg.of('sendMessage', C.id).length).toBeGreaterThan(2);
  });

  it('back buttons: product → categories, entry back → product clears the code wait, decline → menu in place', async () => {
    const { t, pid } = await setup();
    await press(t, 'ui_menu_shop');
    await press(t, 'cust_prod_' + pid);
    await press(t, 'cust_disc_enter_' + pid);
    const id = screenId(t);
    await press(t, 'cust_prod_' + pid); // 🔙 from the code entry
    await t.send('store', textUpdate(C, 'whatever')); // no longer a code
    expect(t.tg.texts(C.id).at(-1)).not.toContain('کد');
    await press(t, 'cust_catalog_page_0', id);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('محصولات');
    await press(t, 'cust_prod_' + pid, id);
    await press(t, 'ui_pay_' + pid, id);
    await press(t, 'cust_decline_' + pid, id);
    const menu = t.tg.of('editMessageText').at(-1)!.payload;
    expect(menu.text).toBe('❌ خرید لغو شد.\n\n👋 *سلام، خوش آمدید!*\n\nاز دکمه‌های زیر انتخاب کنید:');
    expect(one(t.storeDb, 'SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  });

  it('a product in a 2-option group goes back to its table; a group table has the 2-column rows; unavailable in red', async () => {
    const t = makeTestEnv({ monshi: false });
    q(t.storeDb, "INSERT INTO product_groups (name) VALUES ('Grp_*')");
    q(t.storeDb, "INSERT INTO customer_products (name, price, duration_days, group_id, option_label, is_available) VALUES ('G — a', 800, 30, 1, 'a', 1), ('G — b', 2000, 90, 1, 'b', 0)");
    await t.send('store', textUpdate(C, '/start'));
    await press(t, 'ui_menu_shop');
    await press(t, 'cust_grp_1');
    const table = t.tg.of('editMessageText').at(-1)!.payload;
    expect(table.text).toContain('Grp\\_\\*'); // escaped for Markdown
    const rows = table.reply_markup.inline_keyboard;
    expect(rows[0]).toEqual([
      { text: 'a', callback_data: 'cust_prod_1', style: 'success' },
      { text: '۸۰۰ تومان', callback_data: 'cust_prod_1', style: 'success' },
    ]);
    expect(rows[1]).toEqual([
      { text: '⛔️ b', callback_data: 'cust_prod_2', style: 'danger' },
      { text: 'ناموجود', callback_data: 'cust_prod_2', style: 'danger' },
    ]);
    await press(t, 'cust_prod_1');
    expect(kbOf({ payload: t.tg.of('editMessageText').at(-1)!.payload }).flat().map((b) => b.callback_data)).toContain('cust_grp_1');
    await press(t, 'cust_prod_2');
    const wl = t.tg.of('editMessageText').at(-1)!.payload;
    expect(wl.reply_markup.inline_keyboard[0][0]).toMatchObject({ callback_data: 'waitlist_join_2', style: 'primary' });
  });

  it('cust_prod_ pressed under an announcement sends a NEW message and never edits the announcement', async () => {
    const { t, pid } = await setup();
    const announcementId = 424242;
    await t.send('store', callbackUpdate(C, 'cust_prod_' + pid, { message_id: announcementId, text: 'ANNOUNCEMENT' }));
    expect(t.tg.of('editMessageText')).toHaveLength(0);
    expect(lastSend(t).payload.text).toContain('📦 GPT_Plus');
    // the product screen is now the screen: its buttons edit in place
    await t.send('store', callbackUpdate(C, 'ui_pay_' + pid, { message_id: screenId(t) }));
    expect(t.tg.of('editMessageText')).toHaveLength(1);
    expect(t.tg.of('editMessageText')[0].payload.message_id).not.toBe(announcementId);
  });

  it('old cust_disc_skip_ / cust_catalog_close buttons still work', async () => {
    const { t, pid } = await setup();
    await t.send('store', callbackUpdate(C, 'cust_disc_skip_' + pid, { message_id: 777 }));
    expect(lastSend(t).payload.text).toContain('آیا با شرایط بالا موافقید؟');
    await t.send('store', callbackUpdate(C, 'cust_catalog_close', { message_id: 778 }));
    expect(lastSend(t).payload.text).toContain('سلام، خوش آمدید!');
  });

  it('a customer update stays within the budget', async () => {
    const { t, pid } = await setup();
    await press(t, 'ui_menu_shop');
    await press(t, 'cust_prod_' + pid);
    await press(t, 'ui_pay_' + pid);
    await press(t, 'cust_agree_' + pid);
    await t.send('store', photoUpdate(C));
    expect(Math.max(...budgets.map((b) => b.used))).toBeLessThanOrEqual(35);
  });
});
