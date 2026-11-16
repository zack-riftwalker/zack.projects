/** Core of the bot: the Business connection and every customer message pipeline. */
import type { MonshiApp } from '../../apps';
import { Markup } from '../../lib/markup';
import { normalizeText } from '../normalize';
import * as faq from '../services/faq';
import * as gemini from '../services/gemini';
import * as hours from '../services/hours';
import * as orders from '../services/orders';
import * as rules from '../services/rules';
import { sendToStaff } from '../services/topics';
import { storeCustomerSummary } from '../../bridge';
import { customerCardLines } from '../views';
import type { MonshiCtx } from '../types';
import { notifyAll } from './common';
import { isEitaaChat } from '../eitaa/client';

const replaceSalesBot = async (app: MonshiApp, text: string | null) =>
  (text || '').replaceAll('{sales_bot}', (await app.ctx.getSetting('sales_bot')) || '');

/** The owner's account was connected / disconnected. */
export async function onBusinessConnection(ctx: MonshiCtx): Promise<void> {
  const app = ctx.app;
  const bc = ctx.businessConnection!;
  // Any Telegram Business user can attach this bot to their own account — only the owner's connection counts.
  if (bc.user.id !== app.cfg.adminId) {
    console.warn(`Ignored business connection ${bc.id} from non-owner user ${bc.user.id}`);
    return;
  }
  const isEnabled = !!bc.is_enabled;
  await app.db.saveConnection(bc.id, bc.user.id, isEnabled);
  app.ctx.invalidateConnection();
  console.log(`Business connection ${bc.id} from user ${bc.user.id} (enabled=${isEnabled})`);

  const status = isEnabled ? 'برقرار شد ✅' : 'قطع شد ❌';
  const rights = bc.rights as any;
  const canReply = !!(rights && rights.can_reply);
  const canRead = !!(rights && rights.can_read_messages);
  const text =
    `اتصال به حساب شما ${status}\n\n` +
    `🔹 مجوز پاسخ‌گویی: ${canReply ? 'دارد ✅' : 'ندارد ❌ (بدون این مجوز ربات نمی‌تواند جواب بدهد)'}\n` +
    `🔹 مجوز mark-as-read: ${canRead ? 'دارد ✅' : 'ندارد ❌ (برای خوانده‌شدن چت‌ها لازم است)'}\n\n` +
    'برای مشاهده وضعیت: /status';
  try {
    if (app.cfg.allNotifyIds.includes(bc.user_chat_id)) await sendToStaff(app, bc.user_chat_id, 'system', text);
    else await app.api.sendMessage(bc.user_chat_id, text);
  } catch (err: any) {
    console.error('Failed to send connection confirmation', err?.message ?? err);
  }
}

/**
 * Sends an automatic reply on behalf of the owner and stores it as an 'out' message, so the conversation history
 * Gemini sees includes what the bot already answered. A failed store never fails the reply.
 */
async function sendReply(app: MonshiApp, chatId: number, text: string, bcid: string): Promise<void> {
  const sent = await app.api.sendMessage(chatId, text, { business_connection_id: bcid });
  try {
    await app.db.saveMessage(chatId, sent.message_id, 'out', 'text', text, bcid);
  } catch (err: any) {
    console.warn(`Could not store the auto-reply in chat ${chatId}`, err?.message ?? err);
  }
}

async function markRead(app: MonshiApp, bcid: string, chatId: number, messageId: number): Promise<void> {
  if ((await app.ctx.getSetting('mark_read_enabled')) !== '1') return;
  try {
    await app.api.readBusinessMessage(bcid, chatId, messageId);
  } catch {
    console.warn(`mark-as-read failed for chat ${chatId} (permission?)`);
  }
}

export async function notifyAdmin(
  app: MonshiApp, sender: { id: number; first_name?: string; username?: string } | undefined,
  chatId: number, messageType: string, text: string | null | undefined, reason: string,
  customer?: { first_seen_at: string | null } | null,
  suggestedFaqs: { id: number; question: string }[] = [],
): Promise<void> {
  const eitaa = isEitaaChat(chatId);
  const name = (eitaa ? '📗 ایتا · ' : '') + (sender?.first_name || 'ناشناس');
  const link = eitaa
    ? (sender?.username ? `https://eitaa.com/${sender.username}` : '—')
    : sender?.username ? `https://t.me/${sender.username}` : sender ? `tg://user?id=${sender.id}` : '—';
  const preview = text ? text.slice(0, 200) : `[${messageType}]`;
  // what the store knows about this customer (their chat id is their Telegram id) — never blocks the notification
  const card = customerCardLines(eitaa ? null : await storeCustomerSummary(app.apps, chatId), customer, app.apps.now());
  const canReply = eitaa || !!(await app.ctx.getConnection());
  const notif = `🔔 پیام نیازمند بررسی شما (${reason})\n\n👤 ${name}\n💬 ${preview}\n` + card.map((l) => l + '\n').join('') + `🔗 ${link}` +
    (canReply ? '\n↩️ برای جواب دادن، روی همین پیام Reply بزنید.' : '');
  // up to 3 FAQs that may answer it (one tap sends the answer), then the pause button: with one tap the bot
  // steps away from this chat while the owner continues by hand
  const markup = Markup.inlineKeyboard([
    ...suggestedFaqs.slice(0, 3).map((f) => [Markup.button.callback('📚 ' + f.question.slice(0, 28), `hfaq:${chatId}:${f.id}`)]),
    [Markup.button.callback('💤 توقف ۴ساعته ربات برای این چت', `pause_chat:${chatId}`)],
  ]);
  const sent = await notifyAll(app, notif, markup, 'handoff');
  // remember which customer each notification is about, so a Reply to it can be forwarded
  try {
    await app.db.saveNotifyLinks(sent.map((s) => ({ recipientChatId: s.userId, messageId: s.messageId, customerChatId: chatId })));
  } catch (err: any) {
    console.warn('Could not store notification links', err?.message ?? err);
  }
}

/**
 * Sends an auto-reply unless the same one (replyKey) went to this chat within the repeat cooldown — claimed
 * atomically, so a burst of identical messages gets one answer. 'repeat' = suppressed, still counts as answered;
 * 'failed' = the send failed and the claim was released.
 */
async function sendAutoReplyOnce(
  app: MonshiApp, chatId: number, messageId: number, bcid: string,
  replyKey: string, text: string, answeredBy: string, faqId?: number,
): Promise<'sent' | 'repeat' | 'failed'> {
  const claim = await rules.claimAutoReply(app, chatId, replyKey);
  if (claim) {
    try {
      await sendReply(app, chatId, text, bcid);
    } catch (err: any) {
      // the decision was right; only the send failed — don't record it as answered
      console.error(`Failed to send ${replyKey} to chat ${chatId}`, err?.message ?? err);
      await claim.release();
      return 'failed';
    }
  }
  await app.db.markMessageAnswered(chatId, messageId, answeredBy, faqId);
  await markRead(app, bcid, chatId, messageId);
  return claim ? 'sent' : 'repeat';
}

/** Generic «use the sales bot» answer for price questions without an FAQ. true = handled. */
async function sendPriceFallback(app: MonshiApp, chatId: number, messageId: number, bcid: string): Promise<boolean> {
  const fallbackText = await replaceSalesBot(app, await app.ctx.getSetting('price_fallback_message'));
  if (!fallbackText.trim()) return false;
  await sendAutoReplyOnce(app, chatId, messageId, bcid, 'price_fallback', fallbackText, 'price_fallback');
  return true;
}

/** If the customer has an open order, answer with its status from the DB. false = no open order. */
async function tryOrderStatusReply(app: MonshiApp, chatId: number, messageId: number, bcid: string): Promise<boolean> {
  const order = await app.db.getLatestOpenOrderForChat(chatId);
  if (!order) return false;
  // keyed by status: asking again repeats nothing until the order actually moves
  await sendAutoReplyOnce(app, chatId, messageId, bcid, `order:${order.id}:${order.status}`, orders.statusText(order), 'order_status');
  return true;
}

/** Every message in chats connected to the owner's account. */
export async function onBusinessMessage(ctx: MonshiCtx): Promise<void> {
  const app = ctx.app;
  const msg = ctx.businessMessage;
  if (!msg || !msg.chat) return;

  const chatId = msg.chat.id;
  const bcid = msg.business_connection_id!;
  const sender = msg.from;
  const ownerId = app.cfg.adminId;
  const conn = await app.ctx.getConnection();
  // A disabled connection of the owner: store and forward the message, but never auto-reply through it.
  let connectionDisabled = false;
  // Self-heal: the connection event may have been missed (e.g. the account was connected from the profile
  // settings before this webhook existed). Every business message carries the connection id → fetch it,
  // and keep it only if it belongs to the owner. Messages from anyone else's account are ignored entirely.
  const known = !conn || conn.business_connection_id !== bcid ? await app.db.getConnectionById(bcid) : null;
  if (known && known.owner_user_id === ownerId && !known.is_enabled) {
    // already known as disabled → no Telegram lookup per message; a business_connection update re-enables it
    connectionDisabled = true;
  } else if (!conn || conn.business_connection_id !== bcid) {
    let bc;
    try {
      bc = await app.api.getBusinessConnection(bcid);
    } catch (err: any) {
      console.warn('Could not verify business connection ' + bcid + ' — message ignored', err?.message ?? err);
      return;
    }
    if (bc.user.id !== ownerId) {
      console.warn(`Ignored message from business connection ${bcid} of non-owner user ${bc.user.id}`);
      return;
    }
    await app.db.saveConnection(bc.id, bc.user.id, !!bc.is_enabled);
    app.ctx.invalidateConnection();
    connectionDisabled = !bc.is_enabled;
    console.log(`Business connection ${bc.id} registered from a business message (user ${bc.user.id}, enabled=${!connectionDisabled})`);
  }
  const messageType = rules.detectMessageType(msg);
  const text = (msg as any).text || (msg as any).caption || null;

  // 1) the owner's own manual message → store + pause auto-replies in this chat
  if (sender && sender.id === ownerId) {
    // already stored = a reply sent through the notification bridge (or a redelivered update): handled there
    if (!(await app.db.saveMessage(chatId, msg.message_id, 'owner', messageType, text, bcid))) return;
    await app.db.markChatAnsweredByHuman(chatId);
    await rules.pauseChat(app, chatId);
    console.log(`Owner replied manually in chat ${chatId} -> paused`);
    return;
  }

  // 2) store the customer message (dedupe) + detect a new customer
  const { isNew: isNewCustomer, customer } = await app.db.upsertCustomer(
    chatId, sender?.id ?? null, sender?.username ?? null, sender?.first_name ?? null,
  );
  const messageRowId = await app.db.saveMessage(chatId, msg.message_id, 'in', messageType, text, bcid);
  if (!messageRowId) return; // duplicate

  // every customer message reaches the owner's bot chat once: a handoff notification if the pipeline sends one,
  // otherwise a plain one after it ran (even if it threw)
  let notified = false;
  try {
    if (!connectionDisabled) notified = await autoRespond(app, msg, chatId, bcid, sender, messageType, text, messageRowId, isNewCustomer, customer);
  } finally {
    if (!notified) await notifyAdmin(app, sender, chatId, messageType, text, 'پیام جدید', customer);
  }
}

/** Steps 3–6: automatic handling of a stored customer message. true = a handoff notification was already sent. */
async function autoRespond(
  app: MonshiApp, msg: NonNullable<MonshiCtx['businessMessage']>, chatId: number, bcid: string,
  sender: NonNullable<MonshiCtx['businessMessage']>['from'], messageType: string, text: string | null,
  messageRowId: number, isNewCustomer: boolean, customer: Awaited<ReturnType<MonshiApp['db']['upsertCustomer']>>['customer'],
): Promise<boolean> {
  // 3) automation off or chat paused → store only
  if (!(await rules.isAutomationEnabled(app)) || rules.isChatPaused(customer, app.apps.now())) return false;

  // 4) silence rule: media / sensitive content → notify the owner, no reply
  if (rules.isSensitive(text, messageType)) {
    await app.db.markMessageAnswered(chatId, msg.message_id, 'handoff');
    await notifyAdmin(app, sender, chatId, messageType, text, 'حساس/مدیا', customer);
    return true;
  }

  // 4.2) welcome a new customer — once per chat, regardless of business hours.
  // It doubles as the «received» ack, so last_ack is set to avoid a duplicate ack right after.
  if (isNewCustomer && (await app.ctx.getSetting('greeting_enabled')) === '1') {
    const greetingText = await replaceSalesBot(app, await app.ctx.getSetting('greeting_message'));
    if (greetingText) {
      let sentOk = true;
      try {
        await sendReply(app, chatId, greetingText, bcid);
      } catch (err: any) {
        sentOk = false;
        console.error(`Failed to send greeting to chat ${chatId}`, err?.message ?? err);
      }
      if (sentOk) {
        await app.db.markMessageAnswered(chatId, msg.message_id, 'ack');
        await app.db.setLastAck(chatId);
        await markRead(app, bcid, chatId, msg.message_id);
        // flow continues; a matching FAQ answer is sent as well
      }
    }
  }

  // 4.5) FAQ matching — works inside and outside business hours.
  // Gemini first (if enabled); on any error or uncertainty silently fall back to keywords.
  let matchedFaq: Awaited<ReturnType<MonshiApp['db']['getFaq']>> = null;
  const geminiResult = text ? await gemini.getDecision(app, text, chatId, messageRowId) : null;
  if (geminiResult) {
    const faqThreshold = parseFloat((await app.ctx.getSetting('faq_threshold')) || '0.82');
    const handoffThreshold = parseFloat((await app.ctx.getSetting('human_handoff_threshold')) || '0.68');
    const route = gemini.routeDecision(geminiResult.decision, geminiResult.faq !== null, faqThreshold, handoffThreshold);
    if (route === 'answer') {
      matchedFaq = geminiResult.faq;
    } else if (route === 'handoff') {
      // mid-band confidence doesn't always mean «no FAQ»: a firm keyword match on the FAQ Gemini picked confirms it.
      // An explicit HUMAN_HANDOFF (complaint, refund…) is never answered automatically, whatever faq_id says —
      // keywords can't read intent.
      const midBand = geminiResult.decision.action === 'FAQ_ANSWER';
      const keywordMatch = midBand ? faq.findBestMatch(text, await app.ctx.getEnabledFaqs()) : null;
      if (keywordMatch && keywordMatch.faq.id === geminiResult.faq?.id) {
        matchedFaq = keywordMatch.faq;
      } else {
        // mid-band price question without an FAQ → point to the sales bot instead of notifying the owner
        if (midBand && text && faq.isPriceQuery(normalizeText(text))) {
          if (await sendPriceFallback(app, chatId, msg.message_id, bcid)) return false;
        }
        await app.db.markMessageAnswered(chatId, msg.message_id, 'handoff');
        const suggestions = geminiResult.candidates.length
          ? geminiResult.candidates
          : faq.topMatches(text, await app.ctx.getEnabledFaqs(), 3);
        await notifyAdmin(app, sender, chatId, messageType, text, 'نیازمند بررسی انسانی (تشخیص Gemini)', customer, suggestions);
        return true;
      }
    } else if (route === 'order_status') {
      if (await tryOrderStatusReply(app, chatId, msg.message_id, bcid)) return false;
      // no open order → quietly continue the normal flow
    }
  }

  if (matchedFaq === null) {
    const keywordMatch = faq.findBestMatch(text, await app.ctx.getEnabledFaqs());
    if (keywordMatch) matchedFaq = keywordMatch.faq;
  }

  // keyword fallback when Gemini was off/failed or did not detect order_status
  if (matchedFaq === null && text && orders.looksLikeOrderQuery(normalizeText(text))) {
    if (await tryOrderStatusReply(app, chatId, msg.message_id, bcid)) return false;
  }

  if (matchedFaq) {
    const replyKey = `faq:${matchedFaq.id}`;
    if ((await sendAutoReplyOnce(app, chatId, msg.message_id, bcid, replyKey, matchedFaq.answer, 'faq', matchedFaq.id)) === 'sent') {
      await app.db.incrementFaqHit(matchedFaq.id);
    }
    return false;
  }

  // no match → record for repeated-unanswered detection
  if (text) {
    await app.db.recordUnanswered(chatId, text, normalizeText(text), messageRowId);
    // price question without an FAQ → point to the sales bot
    if (faq.isPriceQuery(normalizeText(text))) {
      if (await sendPriceFallback(app, chatId, msg.message_id, bcid)) return false;
    }
  }

  // 5) inside business hours → the owner is awake; store only
  if (hours.isBusinessHours(await app.ctx.getBusinessHours(), app.apps.now())) return false;

  // 6) after hours → «received» ack with cooldown. Claimed atomically so two
  //    concurrent webhooks can't both send it.
  const previousAck = customer.last_ack_sent_at;
  if (!(await app.db.claimAck(chatId, await rules.ackCutoffIso(app)))) return false;

  const ackText = await replaceSalesBot(app, await app.ctx.getSetting('after_hours_message'));
  try {
    await sendReply(app, chatId, ackText, bcid);
  } catch (err: any) {
    console.error(`Failed to send after-hours ack to chat ${chatId}`, err?.message ?? err);
    await app.db.restoreAck(chatId, previousAck);
    return false;
  }

  await app.db.markMessageAnswered(chatId, msg.message_id, 'ack');
  await markRead(app, bcid, chatId, msg.message_id);
  return false;
}
