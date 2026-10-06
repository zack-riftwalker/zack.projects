import type { Message } from 'grammy/types';
import { utcIsoNow } from '../../lib/time';
import type { MonshiApp } from '../../apps';
import type { CustomerRow } from '../db';
import { normalizeText } from '../normalize';

// A message containing any of these never gets an automatic reply and is handed to the owner.
// General money words («پول»/«مبلغ») are intentionally absent — they swallowed price questions.
export const SENSITIVE_KEYWORDS = [
  'رسید', 'فیش', 'واریز', 'پرداخت کردم', 'پرداختم', 'کارت به کارت',
  'کسر شد', 'برنگشت', 'بازپرداخت', 'برگشت وجه',
  'رمز', 'پسورد', 'password', 'کد ورود', 'کد تایید', 'کد تأیید',
  'شکایت', 'کلاهبردار', 'گزارش میدم', 'گزارش می دم',
  'هک', 'دسترسی ندارم', 'قطع شد', 'کار نمیکنه', 'کار نمی کنه',
];
const NORMALIZED_KEYWORDS = SENSITIVE_KEYWORDS.map((kw) => normalizeText(kw).toLowerCase());

export const MEDIA_TYPES = new Set(['photo', 'voice', 'video', 'document', 'audio', 'video_note', 'sticker']);

export function detectMessageType(msg: Message): string {
  const m = msg as any;
  if (m.text) return 'text';
  if (m.photo) return 'photo';
  if (m.voice) return 'voice';
  if (m.video) return 'video';
  if (m.document) return 'document';
  if (m.audio) return 'audio';
  if (m.video_note) return 'video_note';
  if (m.sticker) return 'sticker';
  if (m.contact) return 'contact';
  if (m.location) return 'location';
  return 'other';
}

/** Media or sensitive text → bot stays silent and notifies the owner. */
export function isSensitive(text: string | null | undefined, messageType: string): boolean {
  if (MEDIA_TYPES.has(messageType)) return true;
  if (!text) return false;
  const normalized = normalizeText(text).toLowerCase();
  return NORMALIZED_KEYWORDS.some((kw) => normalized.includes(kw));
}

export async function isAutomationEnabled(app: MonshiApp): Promise<boolean> {
  return (await app.ctx.getSetting('automation_enabled')) === '1';
}

export function isChatPaused(customer: CustomerRow | null | undefined, now: Date = new Date()): boolean {
  if (!customer || !customer.automation_paused_until) return false;
  return now.getTime() < Date.parse(customer.automation_paused_until);
}

/** Temporary pause of auto-replies after the owner steps in manually. */
export async function pauseChat(app: MonshiApp, chatId: number): Promise<void> {
  const hours = parseInt((await app.ctx.getSetting('manual_pause_hours')) || '4', 10);
  const until = new Date(app.apps.now().getTime() + hours * 3600 * 1000);
  await app.db.setChatPause(chatId, utcIsoNow(until));
}

/** Has the same auto-reply gone to this chat within the cooldown (default 1 h)? */
export async function autoReplyRecentlySent(app: MonshiApp, chatId: number, replyKey: string): Promise<boolean> {
  const sentAt = await app.db.getAutoReplySentAt(chatId, replyKey);
  if (!sentAt) return false;
  const cooldown = parseFloat((await app.ctx.getSetting('faq_repeat_cooldown_hours')) || '1');
  return app.apps.now().getTime() - Date.parse(sentAt) < cooldown * 3600 * 1000;
}

/** ISO cutoff before which a previous "received" ack no longer counts (now − ack cooldown). */
export async function ackCutoffIso(app: MonshiApp): Promise<string> {
  const cooldown = parseFloat((await app.ctx.getSetting('ack_cooldown_hours')) || '8');
  return utcIsoNow(new Date(app.apps.now().getTime() - cooldown * 3600 * 1000));
}
