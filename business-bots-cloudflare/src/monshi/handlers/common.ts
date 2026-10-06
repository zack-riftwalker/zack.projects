import type { MonshiApp } from '../../apps';
import { Markup } from '../../lib/markup';
import { WIZARD_STATE_KEYS, type MonshiCtx, type MonshiSession } from '../types';

// The only callbacks notify-only accounts may press (the button under a handoff notification)
export const NOTIFY_ALLOWED_CALLBACK_PREFIXES = ['pause_chat:'];

/** Admin guard for callback handlers (they have no user filter). */
export function adminGuard(handler: (ctx: MonshiCtx) => Promise<unknown>) {
  return async (ctx: MonshiCtx): Promise<void> => {
    const uid = ctx.from?.id;
    const data = ctx.callbackQuery?.data ?? '';
    const cfg = ctx.app.cfg;
    const allowed = uid === cfg.adminId || (
      uid !== undefined && cfg.notifyIds.includes(uid) && NOTIFY_ALLOWED_CALLBACK_PREFIXES.some((p) => data.startsWith(p))
    );
    if (!allowed) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handler(ctx);
  };
}

/** /start reply for notify-only accounts — confirms registration, no admin access. */
export async function onNotifyStart(ctx: MonshiCtx): Promise<void> {
  await ctx.reply(
    '✅ این اکانت برای دریافت نوتیف‌های منشی ثبت شد.\n' +
    'از این به بعد پیام‌های نیازمند بررسی و دایجست هفتگی اینجا هم می‌آید.',
  );
}

/** Sends to the admin and every notify account; one failing recipient never breaks the rest. */
export async function notifyAll(app: MonshiApp, text: string, replyMarkup?: { reply_markup: any }): Promise<void> {
  for (const userId of app.cfg.allNotifyIds) {
    try {
      await app.api.sendMessage(userId, text, replyMarkup ?? {});
    } catch (err: any) {
      console.error('Failed to send notification to user ' + userId, err?.message ?? err);
    }
  }
}

export function cancelButton() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ لغو', 'wiz_cancel')]]);
}

/** Clears every wizard state; true if there was anything to clear. */
export function clearWizardStates(session: MonshiSession): boolean {
  let hadAny = false;
  for (const key of WIZARD_STATE_KEYS) {
    if (session[key] !== undefined && session[key] !== null) {
      hadAny = true;
      delete session[key];
    }
  }
  return hadAny;
}

export const onWizardCancel = adminGuard(async (ctx) => {
  await ctx.answerCallbackQuery();
  clearWizardStates(ctx.session);
  await ctx.editMessageText('لغو شد.');
});

/** Text after the command, newlines preserved (PTB's `text.split(None, 1)[1].strip()`). */
export function commandRest(ctx: MonshiCtx): string {
  return (ctx.message?.text ?? '').match(/^\/\S+\s+([\s\S]*)$/)?.[1].trim() ?? '';
}

export function commandArgs(ctx: MonshiCtx): string[] {
  return commandRest(ctx).split(/\s+/).filter(Boolean);
}

/** Edit a message; an identical-content edit ("message is not modified") is not an error. */
export async function safeEdit(ctx: MonshiCtx, text: string, markup?: { reply_markup: any }): Promise<void> {
  try {
    await ctx.editMessageText(text, markup ?? {});
  } catch (err: any) {
    if (String(err?.description ?? err?.message ?? '').includes('message is not modified')) return;
    throw err;
  }
}
