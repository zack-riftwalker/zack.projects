export type InlineButton = { text: string; callback_data?: string; url?: string };

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
    callback(text: string, data: string): InlineButton {
      return { text, callback_data: data };
    },
    url(text: string, url: string): InlineButton {
      return { text, url };
    },
  },
};
