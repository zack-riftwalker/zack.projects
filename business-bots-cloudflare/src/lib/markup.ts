import type { InlineKeyboardButton } from 'grammy/types';

/** Telegram button colors: blue / green / red. No style = default. */
export type ButtonStyle = 'primary' | 'success' | 'danger';

export type InlineButton = InlineKeyboardButton;

export interface InlineKb { reply_markup: { inline_keyboard: InlineButton[][] } }
export interface ReplyKb { reply_markup: { keyboard: { text: string }[][]; resize_keyboard: boolean; is_persistent?: boolean } }

export const Markup = {
  inlineKeyboard(rows: InlineButton[][]): InlineKb {
    return { reply_markup: { inline_keyboard: rows } };
  },
  keyboard(rows: string[][]) {
    const kb: ReplyKb = {
      reply_markup: { keyboard: rows.map((r) => r.map((text) => ({ text }))), resize_keyboard: false },
    };
    return {
      ...kb,
      resize(): ReplyKb {
        return { reply_markup: { ...kb.reply_markup, resize_keyboard: true } };
      },
    };
  },
  button: {
    callback(text: string, data: string, style?: ButtonStyle): InlineKeyboardButton.CallbackButton {
      return style ? { text, callback_data: data, style } : { text, callback_data: data };
    },
    url(text: string, url: string, style?: ButtonStyle): InlineKeyboardButton.UrlButton {
      return style ? { text, url, style } : { text, url };
    },
  },
};
