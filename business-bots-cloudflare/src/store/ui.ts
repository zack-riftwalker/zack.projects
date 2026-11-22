import { GrammyError } from 'grammy';
import type { MessageEntity } from 'grammy/types';
import { BudgetExceededError } from '../lib/budget';
import type { InlineKb } from '../lib/markup';
import type { StoreContext } from './types';

export interface ScreenExtra {
  parse_mode?: 'Markdown';
  entities?: MessageEntity[];
  reply_markup: InlineKb['reply_markup'];
}

const isGrammy400 = (err: unknown, re: RegExp): boolean =>
  err instanceof GrammyError && err.error_code === 400 && re.test(err.description);

async function sendNew(ctx: StoreContext, text: string, extra: ScreenExtra): Promise<void> {
  const sent = await ctx.reply(text, extra as any);
  ctx.session.screenMsgId = sent.message_id;
}

/** Shows a customer «screen»: edits the screen message the customer pressed, otherwise sends a new one. */
export async function showScreen(ctx: StoreContext, text: string, extra: ScreenExtra): Promise<void> {
  const msg = ctx.callbackQuery?.message;
  const editable = !!msg && ctx.session.screenMsgId != null && msg.message_id === ctx.session.screenMsgId;
  if (!editable) {
    await sendNew(ctx, text, extra);
    return;
  }
  try {
    await ctx.editMessageText(text, extra as any);
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    if (isGrammy400(err, /message is not modified/i)) return;
    if (!isGrammy400(err, /message to edit not found|message can't be edited/i)) {
      console.warn('⚠️ [UI] edit failed, sending a new screen:', (err as Error)?.message);
    }
    await sendNew(ctx, text, extra);
  }
}
