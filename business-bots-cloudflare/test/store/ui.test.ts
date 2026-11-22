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
