import { GrammyError } from 'grammy';
import type { MessageEntity } from 'grammy/types';
import { BudgetExceededError } from '../lib/budget';
import { Markup, type InlineButton, type InlineKb } from '../lib/markup';
import type { StoreApp } from '../apps';
import { getReferralConfig } from './referralConfig';
import { ACTIVATION_CONTACT } from './labels';
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

// ─── Main menu ───────────────────────────────────────────────────────────────

export const MENU_TEXT = '👋 *سلام، خوش آمدید!*\n\nاز دکمه‌های زیر انتخاب کنید:';
export const HOME_BTN = () => Markup.button.callback('🏠 منوی اصلی', 'ui_menu_home');

/** The customer main menu (text + inline keyboard). */
export async function mainMenu(app: StoreApp): Promise<{ text: string; reply_markup: InlineKb['reply_markup'] }> {
  const rows: InlineButton[][] = [
    [Markup.button.callback('🛍 محصولات', 'ui_menu_shop', 'success')],
    [Markup.button.callback('📋 اشتراک‌های من', 'ui_menu_subs', 'primary')],
  ];
  if ((await getReferralConfig(app)).enabled) rows.push([Markup.button.callback('🎁 دعوت دوستان', 'ui_menu_ref', 'primary')]);
  rows.push([Markup.button.url('💬 پشتیبانی', 'https://t.me/' + ACTIVATION_CONTACT.replace(/^@/, ''))]);
  return { text: MENU_TEXT, reply_markup: Markup.inlineKeyboard(rows).reply_markup };
}

/** Shows the main menu as the current screen; `prefix` is prepended to the menu text (e.g. «❌ خرید لغو شد.»). */
export async function showMainMenu(ctx: StoreContext, prefix = ''): Promise<void> {
  const menu = await mainMenu(ctx.app);
  await showScreen(ctx, prefix + menu.text, { parse_mode: 'Markdown', reply_markup: menu.reply_markup });
}

/** One-time: removes the old reply keyboard (a message carries either an inline keyboard or a removal, hence its own message). */
export async function ensureUiV2(ctx: StoreContext): Promise<void> {
  if (ctx.session.uiV2 === true) return;
  await ctx.reply('✨ منوی ربات به‌روز شد.', { reply_markup: { remove_keyboard: true } });
  ctx.session.uiV2 = true;
}

// ─── Plain text + entities builder ───────────────────────────────────────────

/**
 * Builds a message as plain text + entities (no parse_mode), so the admin's stored `terms_entities` can sit in the
 * same message as our own bold header. Offsets are UTF-16 code units, i.e. JS `string.length`.
 */
export class RichText {
  text = '';
  entities: MessageEntity[] = [];
  add(chunk: string, opts: { bold?: boolean } = {}): this {
    if (opts.bold && chunk.length) this.entities.push({ type: 'bold', offset: this.text.length, length: chunk.length });
    this.text += chunk;
    return this;
  }
  /** appends `body` and its own entities, shifted to where the body now starts */
  addEntitied(body: string, bodyEntities: MessageEntity[] | null | undefined): this {
    const shift = this.text.length;
    for (const e of bodyEntities ?? []) this.entities.push({ ...e, offset: e.offset + shift });
    this.text += body;
    return this;
  }
}

/** header + body in one text; the body's entities (which start at 0) are shifted by the header's length. */
export function withHeader(
  header: string, headerEntities: MessageEntity[], body: string, bodyEntities: MessageEntity[] | null | undefined,
): { text: string; entities: MessageEntity[] } {
  const rt = new RichText();
  rt.text = header;
  rt.entities = [...headerEntities];
  rt.addEntitied(body, bodyEntities);
  return { text: rt.text, entities: rt.entities };
}
