/** Core of the bot: the Business connection and every customer message pipeline. */
import type { MonshiApp } from '../../apps';
import { Markup } from '../../lib/markup';
import { normalizeText } from '../normalize';
import * as faq from '../services/faq';
import * as gemini from '../services/gemini';
import * as hours from '../services/hours';
import * as orders from '../services/orders';
import * as rules from '../services/rules';
import type { MonshiCtx } from '../types';
import { notifyAll } from './common';

const replaceSalesBot = async (app: MonshiApp, text: string | null) =>
  (text || '').replace('{sales_bot}', (await app.ctx.getSetting('sales_bot')) || '');

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
    await app.api.sendMessage(bc.user_chat_id, text);
  } catch (err: any) {
    console.error('Failed to send connection confirmation', err?.message ?? err);
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

async function notifyAdmin(
  app: MonshiApp, sender: { id: number; first_name?: string; username?: string } | undefined,
  chatId: number, messageType: string, text: string | null | undefined, reason: string,
): Promise<void> {
  const name = sender?.first_name || 'ناشناس';
  const link = sender?.username ? `https://t.me/${sender.username}` : sender ? `tg://user?id=${sender.id}` : '—';
  const preview = text ? text.slice(0, 200) : `[${messageType}]`;
  const notif = `🔔 پیام نیازمند بررسی شما (${reason})\n\n👤 ${name}\n💬 ${preview}\n🔗 ${link}`;
  // pause button: with one tap the bot steps away from this chat while the owner continues by hand
  const markup = Markup.inlineKeyboard([[
    Markup.button.callback('💤 توقف ۴ساعته ربات برای این چت', `pause_chat:${chatId}`),
  ]]);
  await notifyAll(app, notif, markup);
}

/** Generic «use the sales bot» answer for price questions without an FAQ. true = handled. */
async function sendPriceFallback(app: MonshiApp, chatId: number, messageId: number, bcid: string): Promise<boolean> {
  const fallbackText = await replaceSalesBot(app, await app.ctx.getSetting('price_fallback_message'));
  if (!fallbackText.trim()) return false;
  if (await rules.autoReplyRecentlySent(app, chatId, 'price_fallback')) {
    await app.db.markMessageAnswered(chatId, messageId, 'price_fallback');
    await markRead(app, bcid, chatId, messageId);
    return true;
  }
  try {
    await app.api.sendMessage(chatId, fallbackText, { business_connection_id: bcid });
  } catch (err: any) {
    // detection was right; only the send failed — stop like a failed FAQ send
    console.error(`Failed to send price fallback to chat ${chatId}`, err?.message ?? err);
    return true;
  }
  await app.db.markMessageAnswered(chatId, messageId, 'price_fallback');
  await app.db.logAutoReply(chatId, 'price_fallback');
  await markRead(app, bcid, chatId, messageId);
  return true;
}

/** If the customer has an open order, answer with its status from the DB. false = no open order. */
async function tryOrderStatusReply(app: MonshiApp, chatId: number, messageId: number, bcid: string): Promise<boolean> {
  const order = await app.db.getLatestOpenOrderForChat(chatId);
  if (!order) return false;
  try {
    await app.api.sendMessage(chatId, orders.statusText(order), { business_connection_id: bcid });
  } catch (err: any) {
    console.error(`Failed to send order status to chat ${chatId}`, err?.message ?? err);
    return true;
  }
  await app.db.markMessageAnswered(chatId, messageId, 'order_status');
  await markRead(app, bcid, chatId, messageId);
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
  // Self-heal: the connection event may have been missed (e.g. the account was connected from the profile
  // settings before this webhook existed). Every business message carries the connection id → fetch it,
  // and keep it only if it belongs to the owner. Messages from anyone else's account are ignored entirely.
  if (!conn || conn.business_connection_id !== bcid) {
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
    console.log(`Business connection ${bc.id} registered from a business message (user ${bc.user.id})`);
  }
  const messageType = rules.detectMessageType(msg);
  const text = (msg as any).text || (msg as any).caption || null;

  // 1) the owner's own manual message → store + pause auto-replies in this chat
  if (sender && sender.id === ownerId) {
    await app.db.saveMessage(chatId, msg.message_id, 'owner', messageType, text, bcid);
    await app.db.markChatAnsweredByHuman(chatId);
    await rules.pauseChat(app, chatId);
    console.log(`Owner replied manually in chat ${chatId} -> paused`);
    return;
  }

  // 2) store the customer message (dedupe) + detect a new customer
  const { isNew: isNewCustomer, customer } = await app.db.upsertCustomer(
    chatId, sender?.id ?? null, sender?.username ?? null, sender?.first_name ?? null,
  );
  if (!(await app.db.saveMessage(chatId, msg.message_id, 'in', messageType, text, bcid))) return; // duplicate

  // 3) automation off or chat paused → store only
  if (!(await rules.isAutomationEnabled(app)) || rules.isChatPaused(customer, app.apps.now())) return;

  // 4) silence rule: media / sensitive content → notify the owner, no reply
  if (rules.isSensitive(text, messageType)) {
    await app.db.markMessageAnswered(chatId, msg.message_id, 'handoff');
    await notifyAdmin(app, sender, chatId, messageType, text, 'حساس/مدیا');
    return;
  }

  // 4.2) welcome a new customer — once per chat, regardless of business hours.
  // It doubles as the «received» ack, so last_ack is set to avoid a duplicate ack right after.
  if (isNewCustomer && (await app.ctx.getSetting('greeting_enabled')) === '1') {
    const greetingText = await replaceSalesBot(app, await app.ctx.getSetting('greeting_message'));
    if (greetingText) {
      let sentOk = true;
      try {
        await app.api.sendMessage(chatId, greetingText, { business_connection_id: bcid });
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
  const geminiResult = text ? await gemini.getDecision(app, text, chatId) : null;
  if (geminiResult) {
    const faqThreshold = parseFloat((await app.ctx.getSetting('faq_threshold')) || '0.82');
    const handoffThreshold = parseFloat((await app.ctx.getSetting('human_handoff_threshold')) || '0.68');
    const route = gemini.routeDecision(geminiResult.decision, geminiResult.faq !== null, faqThreshold, handoffThreshold);
    if (route === 'answer') {
      matchedFaq = geminiResult.faq;
    } else if (route === 'handoff') {
      // mid-band confidence doesn't always mean «no FAQ»: a firm keyword match beats a handoff
      const keywordMatch = faq.findBestMatch(text, await app.ctx.getEnabledFaqs());
      if (keywordMatch) {
        matchedFaq = keywordMatch.faq;
      } else {
        // price question without an FAQ → point to the sales bot instead of notifying the owner
        if (text && faq.isPriceQuery(normalizeText(text))) {
          if (await sendPriceFallback(app, chatId, msg.message_id, bcid)) return;
        }
        await app.db.markMessageAnswered(chatId, msg.message_id, 'handoff');
        await notifyAdmin(app, sender, chatId, messageType, text, 'نیازمند بررسی انسانی (تشخیص Gemini)');
        return;
      }
    } else if (route === 'order_status') {
      if (await tryOrderStatusReply(app, chatId, msg.message_id, bcid)) return;
      // no open order → quietly continue the normal flow
    }
  }

  if (matchedFaq === null) {
    const keywordMatch = faq.findBestMatch(text, await app.ctx.getEnabledFaqs());
    if (keywordMatch) matchedFaq = keywordMatch.faq;
  }

  // keyword fallback when Gemini was off/failed or did not detect order_status
  if (matchedFaq === null && text && orders.looksLikeOrderQuery(normalizeText(text))) {
    if (await tryOrderStatusReply(app, chatId, msg.message_id, bcid)) return;
  }

  if (matchedFaq) {
    const replyKey = `faq:${matchedFaq.id}`;
    if (await rules.autoReplyRecentlySent(app, chatId, replyKey)) {
      // the same answer just went to this chat — a repeated question must not be answered twice
      await app.db.markMessageAnswered(chatId, msg.message_id, 'faq', matchedFaq.id);
      await markRead(app, bcid, chatId, msg.message_id);
      return;
    }
    try {
      await app.api.sendMessage(chatId, matchedFaq.answer, { business_connection_id: bcid });
    } catch (err: any) {
      // the match was right and only the send failed — don't record as unanswered or send an ack
      console.error(`Failed to send FAQ answer to chat ${chatId}`, err?.message ?? err);
      return;
    }
    await app.db.markMessageAnswered(chatId, msg.message_id, 'faq', matchedFaq.id);
    await app.db.incrementFaqHit(matchedFaq.id);
    await app.db.logAutoReply(chatId, replyKey);
    await markRead(app, bcid, chatId, msg.message_id);
    return;
  }

  // no match → record for repeated-unanswered detection
  if (text) {
    await app.db.recordUnanswered(chatId, text, normalizeText(text));
    // price question without an FAQ → point to the sales bot
    if (faq.isPriceQuery(normalizeText(text))) {
      if (await sendPriceFallback(app, chatId, msg.message_id, bcid)) return;
    }
  }

  // 5) inside business hours → the owner is awake; store only
  if (hours.isBusinessHours(await app.ctx.getBusinessHours(), app.apps.now())) return;

  // 6) after hours → «received» ack with cooldown. Claimed atomically so two
  //    concurrent webhooks can't both send it.
  const previousAck = customer.last_ack_sent_at;
  if (!(await app.db.claimAck(chatId, await rules.ackCutoffIso(app)))) return;

  const ackText = await replaceSalesBot(app, await app.ctx.getSetting('after_hours_message'));
  try {
    await app.api.sendMessage(chatId, ackText, { business_connection_id: bcid });
  } catch (err: any) {
    console.error(`Failed to send after-hours ack to chat ${chatId}`, err?.message ?? err);
    await app.db.restoreAck(chatId, previousAck);
    return;
  }

  await app.db.markMessageAnswered(chatId, msg.message_id, 'ack');
  await markRead(app, bcid, chatId, msg.message_id);
}
