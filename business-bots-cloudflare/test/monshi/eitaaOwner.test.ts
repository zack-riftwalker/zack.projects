import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { q } from '../helpers/seed';
import { decodeCall, fakeEitaa as eitaaFake, eUser, state } from '../helpers/fakeEitaa';
import { getSetting } from '../helpers/monshi';

const ME = 69152770;
const owner = (t: TestEnv, text: string) => t.send('monshi', textUpdate(OWNER, text));
const ownerCb = (t: TestEnv, data: string) => t.send('monshi', callbackUpdate(OWNER, data));
const lastEdit = (t: TestEnv) => t.tg.of('editMessageText').at(-1)!.payload;

async function setup(connected = true) {
  const e = eitaaFake();
  const t = makeTestEnv({ fetch: e.fetch });
  if (connected) {
    e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
    e.respond('auth.signIn', { _: 'auth.authorization', flags: 0, token: 'T', user: eUser(ME, 'پشتیبانی') });
    await owner(t, '/eitaa_login 09137780948');
    e.respond('updates.getState', state(100));
    await owner(t, '/eitaa_code 12345');
  }
  q(t.storeDb, `INSERT INTO customer_products (name, price, is_available, eitaa_keyword) VALUES ('جمینای', 500000, 1, 'جمینای'), ('GPT', 800000, 1, NULL)`);
  t.tg.reset();
  return { t, e };
}

describe('Eitaa menu: owner controls', () => {
  it('the hub opens the view; the toggle flips and re-renders', async () => {
    const { t } = await setup();
    await owner(t, '⚙️ تنظیمات');
    const kb = t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.some((b: any) => b.callback_data === 'st_eitaa_menu')).toBe(true);
    await ownerCb(t, 'st_eitaa_menu');
    expect(lastEdit(t).text).toBe('📗 جواب خودکار ایتا (خاموش 🚫)\n\nخط اول منو:\nسلام 👋 خوش اومدید\n\nکلمه‌ی هر محصول را در ربات استور ← ویرایش محصول ← «🔑 کلمه‌ی ایتا» تنظیم کنید.');
    const buttons = lastEdit(t).reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(buttons).toEqual(['st_toggle_eitaa_auto', 'st_edit:eitaa_menu_greeting', 'st_eitaa_preview', 'st_back']);
    await ownerCb(t, 'st_toggle_eitaa_auto');
    expect(getSetting(t, 'eitaa_auto_enabled')).toBe('1');
    expect(lastEdit(t).text).toContain('روشن ✅');
    await ownerCb(t, 'st_toggle_eitaa_auto');
    expect(getSetting(t, 'eitaa_auto_enabled')).toBe('0');
    expect(lastEdit(t).text).toContain('خاموش 🚫');
  });

  it('the greeting line is editable and shows in the view', async () => {
    const { t } = await setup();
    await ownerCb(t, 'st_edit:eitaa_menu_greeting');
    await owner(t, 'درود 🌹 به فروشگاه ما خوش آمدید');
    expect(getSetting(t, 'eitaa_menu_greeting')).toBe('درود 🌹 به فروشگاه ما خوش آمدید');
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('خط اول منوی ایتا به‌روز شد');
    expect(getSetting(t, 'greeting_enabled')).not.toBe('0'); // the Telegram greeting is untouched
    await ownerCb(t, 'st_eitaa_menu');
    expect(lastEdit(t).text).toContain('درود 🌹 به فروشگاه ما خوش آمدید');
  });

  it('the preview goes to Saved Messages with entities, even while the switch is off', async () => {
    const { t, e } = await setup();
    expect(getSetting(t, 'eitaa_auto_enabled')).not.toBe('1');
    e.respond('messages.sendMessage', { _: 'updateShortSentMessage', flags: 2, id: 1, pts: 1, pts_count: 1, date: 1 }, { _: 'updateShortSentMessage', flags: 2, id: 2, pts: 1, pts_count: 1, date: 1 });
    await ownerCb(t, 'st_eitaa_preview');
    const sent = e.calls.filter((c) => c.method === 'messages.sendMessage').map(decodeCall);
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.peer._ === 'inputPeerSelf')).toBe(true);
    expect(sent[0].message).toContain('📦 موجودی امروز:');
    expect(sent[0].entities.some((x: any) => x._ === 'messageEntityCode')).toBe(true);
    expect(sent[0].flags & 8).toBe(8);
    expect(sent[1].message).toContain('📦 جمینای');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('✅ در Saved Messages ایتا ببینید');
  });

  it('the preview reports a missing Eitaa login', async () => {
    const { t } = await setup(false);
    await ownerCb(t, 'st_eitaa_preview');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ایتا وصل نیست');
  });

  it('a non-admin callback is ignored', async () => {
    const { t, e } = await setup();
    await t.send('monshi', callbackUpdate({ id: 777, first_name: 'X' }, 'st_toggle_eitaa_auto'));
    await t.send('monshi', callbackUpdate({ id: 777, first_name: 'X' }, 'st_eitaa_preview'));
    expect(getSetting(t, 'eitaa_auto_enabled')).not.toBe('1');
    expect(e.calls.filter((c) => c.method === 'messages.sendMessage')).toHaveLength(0);
    expect(t.tg.of('editMessageText')).toHaveLength(0);
  });
});
