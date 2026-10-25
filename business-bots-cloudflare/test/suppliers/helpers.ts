import type { TestEnv } from '../helpers/env';

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
