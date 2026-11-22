import type { StoreApp } from '../apps';
import { Markup, type InlineButton } from '../lib/markup';
import { escapeHtml } from './utils';

const USERNAME_RE = /^[A-Za-z0-9_]{1,64}$/;

/** `👤 مشتری` + `🆔 آیدی عددی` lines (HTML). Name and username are escaped. */
export function customerRefHtml(c: { id: number; name: string; username?: string | null }): string {
  const handle = c.username ? ` (@${escapeHtml(c.username)})` : '';
  return `👤 مشتری: <a href="tg://user?id=${c.id}">${escapeHtml(c.name)}</a>${handle}\n` +
    `🆔 آیدی عددی: <code>${c.id}</code>`;
}

/** `[💬 چت با مشتری]` (username link, or tg://user when there is none) + `[✉️ پیام از طرف ربات]`. */
export function customerContactRow(id: number, username: string | null | undefined, orderId: number): InlineButton[] {
  const url = username && USERNAME_RE.test(username) ? `https://t.me/${username}` : `tg://user?id=${id}`;
  return [
    Markup.button.url('💬 چت با مشتری', url),
    Markup.button.callback('✉️ پیام از طرف ربات', 'fo_msg_' + orderId),
  ];
}

const isPrivacyRestricted = (err: unknown): boolean => {
  const e = err as { error_code?: number; description?: string };
  return e?.error_code === 400 && String(e.description ?? '').includes('BUTTON_USER_PRIVACY_RESTRICTED');
};

/** Drops the 💬 button (a tg://user button is refused when the customer's privacy settings forbid it). */
const withoutChatButton = (rows: InlineButton[][]): InlineButton[][] =>
  rows
    .map((row) => row.filter((b) => !b.text.startsWith('💬')))
    .filter((row) => row.length > 0);

/**
 * Sends an HTML message to every admin. A BUTTON_USER_PRIVACY_RESTRICTED refusal is retried once without the
 * 💬 button. Returns how many admins were reached.
 */
export async function sendToAdmins(app: StoreApp, html: string, rows: InlineButton[][] = []): Promise<number> {
  const options = (kb: InlineButton[][]) => ({ parse_mode: 'HTML' as const, ...(kb.length ? Markup.inlineKeyboard(kb) : {}) });
  let reached = 0;
  for (const adminId of app.cfg.adminIds) {
    try {
      await app.api.sendMessage(adminId, html, options(rows));
      reached++;
      continue;
    } catch (err: any) {
      if (!isPrivacyRestricted(err)) {
        console.warn('⚠️ [Admin] send to ' + adminId + ' failed:', err?.description ?? err?.message);
        continue;
      }
    }
    try {
      await app.api.sendMessage(adminId, html, options(withoutChatButton(rows)));
      reached++;
    } catch (err: any) {
      console.warn('⚠️ [Admin] retry without chat button to ' + adminId + ' failed:', err?.description ?? err?.message);
    }
  }
  return reached;
}
