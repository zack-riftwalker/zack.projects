/**
 * Reply-from-notification: a staff member (owner or notify account) replies to a handoff notification and the
 * bot sends that reply to the customer from the business account. Also the «📚 FAQ» quick-send buttons.
 */
import type { MonshiApp } from '../../apps';
import { Markup } from '../../lib/markup';
import * as rules from '../services/rules';
import type { MonshiCtx } from '../types';
import { adminGuard } from './common';

const CANT_SEND_NOTE =
  'ℹ️ ربات فقط به چت‌هایی می‌تواند جواب بدهد که در ۲۴ ساعت گذشته پیام داده‌اند، و مجوز «پاسخ‌گویی» در اتصال بیزینس باید روشن باشد.';

/** A human answered through the bridge: store it, mark the chat handled and (setting) step the bot back for a while. */
async function afterHumanReply(app: MonshiApp, customerChatId: number, sentId: number, bcid: string, type: string, text: string | null) {
  await app.db.saveMessage(customerChatId, sentId, 'owner', type, text, bcid);
  await app.db.markChatAnsweredByHuman(customerChatId);
  if ((await app.ctx.getSetting('reply_bridge_pause')) === '1') await rules.pauseChat(app, customerChatId);
}

/** Sends the staff message to the customer by its type; null = a type the bridge doesn't support. */
async function forward(ctx: MonshiCtx, customerChatId: number, bcid: string): Promise<{ id: number; type: string; text: string | null } | null> {
  const api = ctx.app.api;
  const m: any = ctx.message;
  const biz = { business_connection_id: bcid };
  const cap = { ...biz, caption: m.caption, caption_entities: m.caption_entities };
  const text = m.caption ?? null;
  if (m.text !== undefined) {
    const r = await api.sendMessage(customerChatId, m.text, { ...biz, entities: m.entities });
    return { id: r.message_id, type: 'text', text: m.text };
  }
  if (m.photo?.length) return { id: (await api.sendPhoto(customerChatId, m.photo.at(-1).file_id, cap)).message_id, type: 'photo', text };
  if (m.animation) return { id: (await api.sendAnimation(customerChatId, m.animation.file_id, cap)).message_id, type: 'animation', text };
  if (m.document) return { id: (await api.sendDocument(customerChatId, m.document.file_id, cap)).message_id, type: 'document', text };
  if (m.video) return { id: (await api.sendVideo(customerChatId, m.video.file_id, cap)).message_id, type: 'video', text };
  if (m.voice) return { id: (await api.sendVoice(customerChatId, m.voice.file_id, cap)).message_id, type: 'voice', text };
  if (m.audio) return { id: (await api.sendAudio(customerChatId, m.audio.file_id, cap)).message_id, type: 'audio', text };
  if (m.sticker) return { id: (await api.sendSticker(customerChatId, m.sticker.file_id, biz)).message_id, type: 'sticker', text: null };
  return null;
}

/** Staff reply to a notification. Anything that isn't a reply to a notification falls through to the normal handlers. */
export async function onStaffReply(ctx: MonshiCtx, next: () => Promise<void>): Promise<void> {
  const app = ctx.app;
  const reply = ctx.message?.reply_to_message;
  if (!reply || ctx.message?.entities?.some((e) => e.type === 'bot_command' && e.offset === 0)) return next();
  const customerChatId = await app.db.getNotifyLink(ctx.chat!.id, reply.message_id);
  if (customerChatId === null) return next();

  const conn = await app.ctx.getConnection();
  if (!conn) {
    await ctx.reply('❌ اتصال بیزینس فعال نیست.');
    return;
  }

  let sent;
  try {
    sent = await forward(ctx, customerChatId, conn.business_connection_id);
  } catch (err: any) {
    await ctx.reply('❌ پیام به مشتری نرسید.\nدلیل: ' + (err?.description ?? err?.message ?? 'نامشخص') + '\n\n' + CANT_SEND_NOTE);
    return;
  }
  if (!sent) {
    await ctx.reply('⚠️ این نوع پیام پشتیبانی نمی‌شود.');
    return;
  }
  await afterHumanReply(app, customerChatId, sent.id, conn.business_connection_id, sent.type, sent.text);
  try {
    await app.api.setMessageReaction(ctx.chat!.id, ctx.message!.message_id, [{ type: 'emoji', emoji: '👍' }]);
  } catch {
    await ctx.reply('✅ ارسال شد.').catch(() => {});
  }
}

/** «📚 {question}» under a handoff notification → send that FAQ's answer to the customer. */
export const onHandoffFaqCallback = adminGuard(async (ctx) => {
  const app = ctx.app;
  const [, chatIdRaw, faqIdRaw] = (ctx.callbackQuery?.data ?? '').split(':');
  const customerChatId = parseInt(chatIdRaw, 10);
  const faq = await app.db.getFaq(parseInt(faqIdRaw, 10));
  const alert = (text: string) => ctx.answerCallbackQuery({ text, show_alert: true });

  if (!faq || !faq.enabled) return void (await alert('❌ این FAQ دیگر فعال نیست.'));
  const conn = await app.ctx.getConnection();
  if (!conn) return void (await alert('❌ اتصال بیزینس فعال نیست.'));
  if (await rules.autoReplyRecentlySent(app, customerChatId, 'faq:' + faq.id)) {
    return void (await alert('ℹ️ این جواب همین الان برای مشتری ارسال شده.'));
  }

  let sentId: number;
  try {
    sentId = (await app.api.sendMessage(customerChatId, faq.answer, { business_connection_id: conn.business_connection_id })).message_id;
  } catch (err: any) {
    return void (await alert('❌ پیام به مشتری نرسید. فقط به چت‌هایی که در ۲۴ ساعت گذشته پیام داده‌اند می‌توان جواب داد.'));
  }
  await afterHumanReply(app, customerChatId, sentId, conn.business_connection_id, 'text', faq.answer);
  await app.db.logAutoReply(customerChatId, 'faq:' + faq.id);
  await app.db.incrementFaqHit(faq.id);

  await ctx.answerCallbackQuery('✅ ارسال شد');
  const original = (ctx.callbackQuery?.message as any)?.text ?? '';
  await ctx.editMessageText(
    original + '\n\n✅ جواب «' + faq.question.slice(0, 40) + '» ارسال شد (توسط ' + (ctx.from?.first_name ?? '—') + ').',
    Markup.inlineKeyboard([[Markup.button.callback('💤 توقف ۴ساعته ربات برای این چت', `pause_chat:${customerChatId}`)]]),
  ).catch(() => {});
});
