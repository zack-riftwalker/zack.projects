import type { TestEnv } from '../helpers/env';
import { ADMIN, type TestEnv as Env } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one } from '../helpers/seed';
import type { FakeAriobox } from '../helpers/fakeAriobox';

/** The last message the bot sent or edited, as the Telegram call payload. */
export function lastSent(t: TestEnv): any {
  const calls = t.tg.calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText');
  return calls.at(-1)!.payload;
}

/** Every callback_data of the inline keyboard of a payload, in order. */
export function callbackDataOf(payload: any): string[] {
  const rows: any[][] = payload.reply_markup?.inline_keyboard ?? [];
  return rows.flat().map((b) => b.callback_data).filter((d): d is string => typeof d === 'string');
}


export const KEY = 'SECRET-KEY-1234';

export const press = (t: Env, data: string) => t.send('store', callbackUpdate(ADMIN, data));
export const say = (t: Env, text: string) => t.send('store', textUpdate(ADMIN, text));

/** Runs the cron as if it were this exact instant (the app's clock and the tick's clock agree). */
export async function at(t: Env, iso: string): Promise<void> {
  t.deps.now = () => new Date(iso);
  await t.cron(new Date(iso));
}

/** 10:02 UTC is 13:32 in Tehran (minute 2 of every 10): a due tick for suppliers. */
export const DUE = '2026-10-25T10:02:00Z';
export const DUE_NEXT = '2026-10-25T10:12:00Z';
/** 10:05 UTC is 13:35 in Tehran: no supplier fetch, but the apply step still runs every minute. */
export const NOT_DUE = '2026-10-25T10:05:00Z';

/** Adds the ArioBox supplier through the panel with the fake's valid key; returns its id. */
export async function addSupplierOk(t: Env, fake: FakeAriobox): Promise<number> {
  fake.state.validKey = KEY;
  // the connection test (and so the first sync time) happens at 09:50 UTC, before the due ticks of the tests
  t.deps.now = () => new Date('2026-10-25T09:50:00Z');
  await press(t, 'sup_add');
  await say(t, 'ArioBox Main');
  await say(t, 'https://ariobox.test');
  await say(t, KEY);
  await say(t, '42');
  return one(t.storeDb, 'SELECT id FROM suppliers').id;
}

/** Default markup 15% + 0 (the easy path for most tests). */
export async function setDefaults(t: Env) {
  await press(t, 'sup_def_pct');
  await say(t, '15');
  await press(t, 'sup_def_fix');
  await say(t, '0');
}
