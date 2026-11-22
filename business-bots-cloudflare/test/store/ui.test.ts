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
