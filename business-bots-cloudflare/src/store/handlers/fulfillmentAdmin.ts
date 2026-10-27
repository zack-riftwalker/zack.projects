import type { Bot } from 'grammy';
import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { buildPagedKeyboard, escapeHtml, formatPrice } from '../utils';
import { ACTIVATION_CONTACT } from '../labels';
import { COMPLETION_TEXT } from '../bridgeHandlers';
import { logEvent } from '../events';
import { buildDecisionCard, buildOrderCard, historyText } from '../suppliers/decisionCard';
import {
  deliverToCustomer, deliveryMessages, kickSupplierOrder, latestDelivery, queueSupplierOrder, raiseNeedsAction, recordRemoteOrderId, resendDelivery,
  sendDeliveredNotice, SOURCE_SELECT, unknownSupplierOrderId, type SourceCandRow,
} from '../suppliers/engine';
import {
  addDisabledSource, cancelOrder, claimForManualDelivery, deadlineFrom, finishSelfDelivery, markRefunded, releaseManualClaim,
  setOrderCost, startSelfDelivery, undoSelfDelivery,
} from '../suppliers/fulfillmentActions';
import { formatAccountsHtml, parseContent } from '../suppliers/format';
import { availableStockFor } from '../suppliers/stockCards';
import { costToman } from '../suppliers/pricing';
import { listSuppliers } from '../suppliers/store';
import { catalogPicker, findCatalogItem } from './supplierSources';
import { INPUT_TTL_MS, beginSupplierInput, beginSupplierWizard } from '../supplierInput';
import type { StoreContext } from '../types';

const html = { parse_mode: 'HTML' as const };
const ALREADY = 'ℹ️ قبلاً تصمیم گرفته شد.';
const IMPOSSIBLE = '❌ این کار در وضعیت فعلی سفارش ممکن نیست.';
const CANCEL_INPUT = Markup.button.callback('❌ انصراف', 'sup_cancel_input');

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const asciiDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30)).replace(/[\s,،٬]/g, '');
const adminName = (ctx: StoreContext) => ctx.from?.first_name ?? 'ادمین';

type OrderRow = NonNullable<Awaited<ReturnType<StoreApp['db']['getOrderById']>>>;

/** Appends the outcome line `… توسط ADMIN` to the pressed card and drops its keyboard (other admins' copies stay). */
export async function markCard(ctx: StoreContext, outcome: string, rows?: InlineButton[][]): Promise<void> {
  const m: any = ctx.callbackQuery?.message;
  if (!m?.text) return;
  await ctx.editMessageText(m.text + '\n\n' + outcome + ' توسط ' + adminName(ctx), {
    entities: m.entities, ...(rows ? Markup.inlineKeyboard(rows) : {}),
  }).catch(() => {});
}

/** The order if it is a confirmed supplier order; otherwise answers the callback and returns null. */
async function liveOrder(ctx: StoreContext, orderId: number, fulfillments: string[] = ['supplier']): Promise<OrderRow | null> {
  const order = await ctx.app.db.getOrderById(orderId);
  if (!order) {
    await ctx.answerCallbackQuery({ text: '❌ سفارش یافت نشد.', show_alert: true });
    return null;
  }
  if (order.status !== 'confirmed' || !fulfillments.includes(order.fulfillment ?? '')) {
    await ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    return null;
  }
  return order;
}

const UNKNOWN_FIRST =
  '❓ سفارش قبلی در تأمین‌کننده هنوز نامشخص است؛ ممکن است خریداری شده باشد. اول «🔢 ثبت شده بود» یا «🔁 ثبت نشده بود» را بزنید.';

/** True (after telling the admin) while an `unknown` supplier order of the order exists: nothing else may buy then. */
async function refuseWhileUnknown(ctx: StoreContext, orderId: number): Promise<boolean> {
  if ((await unknownSupplierOrderId(ctx.app, orderId)) === null) return false;
  await ctx.answerCallbackQuery({ text: UNKNOWN_FIRST, show_alert: true });
  return true;
}

/** A card for the order: the decision card when it needs a decision, else the order card. */
async function cardFor(app: StoreApp, orderId: number) {
  const o = await app.db.getOrderById(orderId);
  if (!o) return null;
  return o.needs_action_reason && o.status === 'confirmed' ? buildDecisionCard(app, orderId) : buildOrderCard(app, orderId);
}

/** The session's confirmation draft (cancel reason, account text) if it belongs to this order and is fresh. */
function draft(ctx: StoreContext, step: string, orderId: number): Record<string, any> | null {
  const w = ctx.session.supplierWizard;
  if (!w || w.step !== step || w.data.orderId !== orderId) return null;
  if (w.at !== undefined && ctx.app.apps.now().getTime() - w.at > INPUT_TTL_MS) return null;
  return w.data;
}

/** Resets the order after a new supplier order was queued for it. */
async function resetForNewAttempt(app: StoreApp, orderId: number): Promise<void> {
  await app.raw.prepare(
    `UPDATE orders SET needs_action_reason = NULL, needs_action_at = NULL, supplier_deadline_at = ?, stalled_alert_sent = 0
     WHERE id = ? AND status = 'confirmed'`,
  ).bind(deadlineFrom(app), orderId).run();
}

/** A confirmed order can be cancelled while it waits on us (supplier / by hand) or after its own delivery failed to send. */
const CANCELLABLE = ['supplier', 'manual_outside', 'stock', 'manual_text'];

const CANCEL_REASONS: Record<string, string | null> = {
  oos: 'ناموجودی', price: 'گران شدن قیمت خرید', cust: 'درخواست مشتری', none: null,
};

/** Order-level admin actions of the decision card (SUPPLIER_PLAN.md §8). */
export function registerFulfillmentAdmin(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  const guard = async (ctx: StoreContext): Promise<boolean> => {
    if (isAdmin(ctx.from?.id)) return true;
    await ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    return false;
  };

  // ── cards ──────────────────────────────────────────────────────────────────
  // 🔙 from a confirmation: show the card again in place
  bot.callbackQuery(/^fo_card_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const card = await cardFor(ctx.app, parseInt(ctx.match[1], 10));
    await ctx.answerCallbackQuery();
    if (card) await ctx.editMessageText(card.html, { ...html, ...Markup.inlineKeyboard(card.rows) }).catch(() => {});
  });

  // opens an order from a list as a new message
  bot.callbackQuery(/^fo_open_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const card = await cardFor(ctx.app, parseInt(ctx.match[1], 10));
    if (!card) return ctx.answerCallbackQuery({ text: '❌ سفارش یافت نشد.', show_alert: true });
    await ctx.answerCallbackQuery();
    await ctx.reply(card.html, { ...html, ...Markup.inlineKeyboard(card.rows) });
  });

  // /order 1234 and /order_1234
  const showOrder = async (ctx: StoreContext, raw: string) => {
    if (!isAdmin(ctx.from?.id)) return;
    const id = parseInt(asciiDigits(raw), 10);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply('ℹ️ شماره‌ی سفارش را بعد از دستور بنویسید، مثلاً: /order 1234');
      return;
    }
    const card = await buildOrderCard(ctx.app, id);
    if (!card) {
      await ctx.reply('❌ سفارش یافت نشد.');
      return;
    }
    await ctx.reply(card.html, { ...html, ...Markup.inlineKeyboard(card.rows) });
  };
  bot.command('order', (ctx) => showOrder(ctx, typeof ctx.match === 'string' ? ctx.match.trim() : ''));
  bot.hears(/^\/order_(\d+)(?:@\w+)?$/, (ctx) => showOrder(ctx, ctx.match[1]));

  bot.callbackQuery(/^fo_hist_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(await historyText(ctx.app, parseInt(ctx.match[1], 10)), html);
  });

  // ── 🔁 تلاش دوباره: a new supplier order, only when none is live (one conditional INSERT decides) ──
  bot.callbackQuery(/^fo_retry_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    if (order.needs_action_reason === 'loss' || order.needs_action_reason === 'approval') {
      const p = await ctx.app.db.getCustomerProductById(order.customer_product_id);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        '⚠️ خرید با قیمت فعلی (≈ ' + formatPrice(p?.cost_toman ?? 0) + ' ت) انجام شود؟',
        Markup.inlineKeyboard([[cb('✅ بله', 'fo_retryok_' + order.id), cb('🔙', 'fo_card_' + order.id)]]),
      ).catch(() => {});
      return;
    }
    await retryNow(ctx, order);
  });
  bot.callbackQuery(/^fo_retryok_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (order) await retryNow(ctx, order, { lossConfirmed: true });
  });

  // ── 🔢 an `unknown` order that did exist: the admin types its number ──
  bot.callbackQuery(/^fo_rid_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    if (order.needs_action_reason !== 'unknown') return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    await beginSupplierInput(ctx, 'fo_rid', String(order.id));
    await ctx.answerCallbackQuery();
    await ctx.reply('🔢 شماره‌ی سفارش #' + order.id + ' را در پنل تأمین‌کننده وارد کنید (فقط عدد):', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });

  // ── 🔁 ارسال دوباره / 👁 نمایش اکانت ──
  bot.callbackQuery(/^fo_resend_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const result = await resendDelivery(ctx.app, parseInt(ctx.match[1], 10), ctx.from.id);
    if (result === 'delivered') {
      await ctx.answerCallbackQuery('✅ ارسال شد.');
      await markCard(ctx, '✅ دوباره ارسال شد');
    } else if (result === 'send_failed') {
      await ctx.answerCallbackQuery({ text: '❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده.', show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: result === 'none' ? '❌ اکانتی برای این سفارش ذخیره نشده.' : ALREADY, show_alert: true });
    }
  });
  bot.callbackQuery(/^fo_view_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await ctx.app.db.getOrderById(parseInt(ctx.match[1], 10));
    const d = order ? await latestDelivery(ctx.app, order.id) : null;
    if (!order || !d) return ctx.answerCallbackQuery({ text: '❌ اکانتی برای این سفارش ذخیره نشده.', show_alert: true });
    await ctx.answerCallbackQuery();
    for (const part of deliveryMessages(order.product_name, d.content)) await ctx.reply(part, html);
  });

  // ── 🔀 خرید از منبع دیگر ──
  bot.callbackQuery(/^fo_src_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order || (await refuseWhileUnknown(ctx, order.id))) return;
    const sources = await orderSources(ctx.app, order);
    const rows = sources.map((s) => [cb(sourceLabel(s, order.price), 'fo_srcp_' + order.id + '_' + s.id)]);
    rows.push([cb('➕ منبع جدید از تأمین‌کننده', 'fo_srcnew_' + order.id)], [cb('🔙 بازگشت', 'fo_card_' + order.id)]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '🔀 منبع خرید سفارش #' + order.id + ' را انتخاب کنید (منبع‌های غیرفعال هم نمایش داده می‌شوند):',
      Markup.inlineKeyboard(rows),
    ).catch(() => {});
  });

  bot.callbackQuery(/^fo_srcp_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order || (await refuseWhileUnknown(ctx, order.id))) return;
    const source = (await orderSources(ctx.app, order)).find((s) => s.id === parseInt(ctx.match[2], 10));
    if (!source) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    await showSourceConfirmation(ctx, order, source);
  });

  bot.callbackQuery(/^fo_srcok_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order || (await refuseWhileUnknown(ctx, order.id))) return;
    const source = (await orderSources(ctx.app, order)).find((s) => s.id === parseInt(ctx.match[2], 10));
    if (!source) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    const soId = await queueSupplierOrder(ctx.app, order, {
      forcedSourceId: source.id, requestedBy: ctx.from.id, eventKind: 'admin_source', eventDetail: source.sup_name + ' #' + source.id, supersedeQueued: true,
    });
    if (soId === null) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    await resetForNewAttempt(ctx.app, order.id);
    await ctx.answerCallbackQuery('🔀 ثبت می‌شود.');
    await markCard(ctx, '🔀 خرید از «' + source.sup_name + '» ثبت شد');
    if (ctx.app.apps.budget.remaining() >= 15) await kickSupplierOrder(ctx.app, soId);
  });

  // ➕ a new source: supplier → catalog item → a DISABLED source (last priority) used as the forced one
  bot.callbackQuery(/^fo_srcnew_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order || (await refuseWhileUnknown(ctx, order.id))) return;
    const suppliers = await listSuppliers(ctx.app);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('➕ منبع را از کدام تأمین‌کننده می‌خواهید؟', Markup.inlineKeyboard([
      ...suppliers.map((s) => [cb(s.name, 'fo_srcs_' + order.id + '_' + s.id)]),
      [cb('🔙 بازگشت', 'fo_src_' + order.id)],
    ])).catch(() => {});
  });
  const showCatalog = async (ctx: StoreContext, orderId: number, sid: number, page: number) => {
    const order = await liveOrder(ctx, orderId);
    if (!order) return;
    const v = await catalogPicker(ctx.app, sid, page, (ref) => 'fo_srcn_' + orderId + '_' + sid + '_' + ref, 'fo_srcl_' + orderId + '_' + sid + '_',
      cb('🔙 بازگشت', 'fo_srcnew_' + orderId));
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(v.text, v.keyboard).catch(() => {});
  };
  bot.callbackQuery(/^fo_srcs_(\d+)_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showCatalog(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10), 0);
  });
  bot.callbackQuery(/^fo_srcl_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showCatalog(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10), parseInt(ctx.match[3], 10));
  });
  bot.callbackQuery(/^fo_srcn_(\d+)_(\d+)_([0-9a-f]{12})$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order || (await refuseWhileUnknown(ctx, order.id))) return;
    const sid = parseInt(ctx.match[2], 10);
    const item = await findCatalogItem(ctx.app, sid, ctx.match[3]);
    if (!item) return ctx.answerCallbackQuery({ text: '❌ این گزینه دیگر در کاتالوگ نیست.', show_alert: true });
    await addDisabledSource(ctx.app, order.customer_product_id, sid, item);
    // the item may already be a source of this option: it is found by its remote ids either way
    const source = (await orderSources(ctx.app, order)).find((s) => s.supplier_id === sid
      && s.remote_product_id === item.remoteProductId && s.remote_variation_id === item.remoteVariationId);
    if (!source) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    await showSourceConfirmation(ctx, order, source);
  });

  // ── 📦 از اکانت‌های من ──
  const showStock = async (ctx: StoreContext, orderId: number, page: number) => {
    const order = await liveOrder(ctx, orderId);
    if (!order) return;
    const accounts = await availableStockFor(ctx.app, order.customer_product_id);
    await ctx.answerCallbackQuery();
    if (accounts.length === 0) {
      await ctx.editMessageText('📦 اکانت آزادی در «اکانت‌های من» نیست.', Markup.inlineKeyboard([[cb('🔙 بازگشت', 'fo_card_' + order.id)]])).catch(() => {});
      return;
    }
    const kb = buildPagedKeyboard(accounts, page, (a) => cb((a.match ? '🎯 ' : '') + a.title.slice(0, 36) + ' — اکانت #' + a.id, 'fo_stk_' + order.id + '_' + a.id),
      'fo_stockp_' + order.id + '_', cb('🔙 بازگشت', 'fo_card_' + order.id));
    await ctx.editMessageText('📦 یک اکانت برای سفارش #' + order.id + ' انتخاب کنید (🎯 = از همین منبع):', kb).catch(() => {});
  };
  bot.callbackQuery(/^fo_stock_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showStock(ctx, parseInt(ctx.match[1], 10), 0);
  });
  bot.callbackQuery(/^fo_stockp_(\d+)_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showStock(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10));
  });
  bot.callbackQuery(/^fo_stk_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    const account = await loadStockAccount(ctx.app, parseInt(ctx.match[2], 10));
    if (!account || account.status !== 'available') return ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '⚠️ این اکانت برای سفارش #' + order.id + ' به مشتری ارسال شود؟\n\n' + (account.content ? formatAccountsHtml(account.content) : '—'),
      { ...html, ...Markup.inlineKeyboard([[cb('✅ بله، ارسال شود', 'fo_stkok_' + order.id + '_' + account.id), cb('🔙', 'fo_stock_' + order.id)]]) },
    ).catch(() => {});
  });
  bot.callbackQuery(/^fo_stkok_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    const accountId = parseInt(ctx.match[2], 10);
    const account = await loadStockAccount(ctx.app, accountId);
    if (!account?.content || account.status !== 'available') return ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true });
    if (!(await claimForManualDelivery(ctx.app, order.id, 'stock', ctx.from.id, accountId))) {
      await releaseManualClaim(ctx.app, order.id, 'stock').catch(() => {});
      return ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    }
    const result = await deliverToCustomer(ctx.app, order.id, account.content, {
      kind: 'stock', stockAccountId: accountId, actor: ctx.from.id, actorName: adminName(ctx), costToman: account.unitCost,
    });
    await finishManualDelivery(ctx, result, '📦 از اکانت‌های من ارسال شد');
  });

  // ── ✍️ ارسال متن اکانت ──
  bot.callbackQuery(/^fo_text_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    await beginSupplierInput(ctx, 'fo_text', String(order.id));
    await ctx.answerCallbackQuery();
    await ctx.reply('✍️ اطلاعات اکانت را بنویسید (همان‌طور که باید برای مشتری ارسال شود):', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });
  bot.callbackQuery(/^fo_textok_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const orderId = parseInt(ctx.match[1], 10);
    const data = draft(ctx, 'fo_text_preview', orderId);
    if (!data) return ctx.answerCallbackQuery({ text: '⌛️ مهلت تمام شد؛ دوباره از «✍️ ارسال متن اکانت» شروع کنید.', show_alert: true });
    const order = await liveOrder(ctx, orderId);
    if (!order) return;
    ctx.session.supplierWizard = null; // one press sends: a second press has nothing to send
    if (!(await claimForManualDelivery(ctx.app, order.id, 'manual_text', ctx.from.id))) {
      return ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    }
    const result = await deliverToCustomer(ctx.app, order.id, { text: String(data.text) }, {
      kind: 'manual_text', actor: ctx.from.id, actorName: adminName(ctx), costToman: null,
    });
    if (await finishManualDelivery(ctx, result, '✍️ متن اکانت ارسال شد')) await askCost(ctx, order.id);
  });

  // ── 🙋 خودم تحویل می‌دهم / ✅ تحویل شد / ↩️ برگشت ──
  bot.callbackQuery(/^fo_self_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    if (!(await startSelfDelivery(ctx.app, order.id, ctx.from.id))) return ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    await ctx.answerCallbackQuery('🙋 ثبت شد.');
    const card = await buildDecisionCard(ctx.app, order.id, {
      header: '🙋 تحویل دستی توسط ' + escapeHtml(adminName(ctx)) + ' — سفارش #' + order.id +
        '\nبعد از تحویل اکانت به مشتری، دکمه‌ی «✅ تحویل شد» را بزنید.',
    });
    if (card) await ctx.editMessageText(card.html, { ...html, ...Markup.inlineKeyboard(card.rows) }).catch(() => {});
  });
  bot.callbackQuery(/^fo_done_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10), ['manual_outside']);
    if (!order) return;
    if (!(await finishSelfDelivery(ctx.app, order.id, ctx.from.id))) return ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    try {
      await ctx.api.sendMessage(order.customer_telegram_id, COMPLETION_TEXT);
    } catch (err: any) {
      console.error('❌ [Admin] Completion message failed for order #' + order.id + ':', err?.description ?? err?.message);
    }
    await ctx.answerCallbackQuery('✅ تحویل ثبت شد.');
    await markCard(ctx, '✅ تحویل شد');
    const fresh = await ctx.app.db.getOrderById(order.id);
    if (fresh) await sendDeliveredNotice(ctx.app, fresh, { kind: 'manual_outside', actor: ctx.from.id, actorName: adminName(ctx) }, null, null);
    await askCost(ctx, order.id);
  });
  bot.callbackQuery(/^fo_undo_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10), ['manual_outside']);
    if (!order) return;
    if (!(await undoSelfDelivery(ctx.app, order.id, ctx.from.id))) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    // a supplier order that was left running gets its accounts back; otherwise a new one is queued (no confirmation)
    const fresh = (await ctx.app.db.getOrderById(order.id))!;
    const soId = await queueSupplierOrder(ctx.app, fresh, { requestedBy: ctx.from.id, eventKind: 'admin_retry', eventDetail: 'undo' });
    if (soId === null && (await unknownSupplierOrderId(ctx.app, order.id)) !== null) {
      // an order that may exist at the supplier is never bought again by an undo: the unknown card is out again
      await ctx.answerCallbackQuery({ text: UNKNOWN_FIRST, show_alert: true });
      await markCard(ctx, '↩️ به تحویل خودکار برگشت (سفارش نامشخص هنوز تعیین‌تکلیف نشده)');
      await raiseNeedsAction(ctx.app, order.id, 'unknown');
      return;
    }
    await resetForNewAttempt(ctx.app, order.id);
    await ctx.answerCallbackQuery('↩️ برگشت.');
    await markCard(ctx, '↩️ به تحویل خودکار برگشت');
    if (soId !== null && ctx.app.apps.budget.remaining() >= 15) await kickSupplierOrder(ctx.app, soId);
  });

  // ── ❌ لغو سفارش ──
  bot.callbackQuery(/^fo_cancel_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10), CANCELLABLE);
    if (!order) return;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('❌ دلیل لغو سفارش #' + order.id + ' چیست؟', Markup.inlineKeyboard([
      [cb('ناموجودی', 'fo_cr_' + order.id + '_oos'), cb('گران شدن قیمت خرید', 'fo_cr_' + order.id + '_price')],
      [cb('درخواست مشتری', 'fo_cr_' + order.id + '_cust'), cb('دلیل دلخواه', 'fo_cr_' + order.id + '_custom')],
      [cb('بدون دلیل', 'fo_cr_' + order.id + '_none')],
      [cb('🔙 بازگشت', 'fo_card_' + order.id)],
    ])).catch(() => {});
  });
  bot.callbackQuery(/^fo_cr_(\d+)_(oos|price|cust|none|custom)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10), CANCELLABLE);
    if (!order) return;
    const code = ctx.match[2];
    if (code === 'custom') {
      await beginSupplierInput(ctx, 'fo_cancel_reason', String(order.id));
      await ctx.answerCallbackQuery();
      await ctx.reply('✍️ دلیل لغو را بنویسید (۱ تا ۲۰۰ کاراکتر):', Markup.inlineKeyboard([[CANCEL_INPUT]]));
      return;
    }
    await beginSupplierWizard(ctx, 'fo_cancel_confirm', { orderId: order.id, reason: CANCEL_REASONS[code] });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(cancelConfirmText(order, CANCEL_REASONS[code]), Markup.inlineKeyboard([[
      cb('✅ بله، لغو شود', 'fo_cok_' + order.id), cb('🔙', 'fo_card_' + order.id),
    ]])).catch(() => {});
  });
  bot.callbackQuery(/^fo_cok_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const orderId = parseInt(ctx.match[1], 10);
    const data = draft(ctx, 'fo_cancel_confirm', orderId);
    if (!data) return ctx.answerCallbackQuery({ text: '⌛️ مهلت تمام شد؛ دوباره «❌ لغو سفارش» را بزنید.', show_alert: true });
    const order = await liveOrder(ctx, orderId, CANCELLABLE);
    if (!order) return;
    ctx.session.supplierWizard = null;
    const reason: string | null = data.reason ?? null;
    if (!(await cancelOrder(ctx.app, order, ctx.from.id, reason))) return ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    try {
      await ctx.api.sendMessage(order.customer_telegram_id,
        '❌ سفارش «' + order.product_name + '» لغو شد.' + (reason ? '\n📝 دلیل: ' + reason : '') +
        (order.price > 0 ? '\n\n💸 مبلغ پرداختی شما (' + formatPrice(order.price) + ' تومان) بازگردانده می‌شود. برای پیگیری به ' + ACTIVATION_CONTACT + ' پیام دهید.' : ''));
    } catch (err: any) {
      console.warn('⚠️ [Admin] cancel message to ' + order.customer_telegram_id + ' failed:', err?.description ?? err?.message);
    }
    await ctx.answerCallbackQuery('❌ لغو شد.');
    await markCard(ctx, '❌ سفارش لغو شد', order.price > 0 ? [[cb('✅ بازپرداخت انجام شد', 'fo_refund_' + order.id)]] : undefined);
  });
  bot.callbackQuery(/^fo_refund_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const orderId = parseInt(ctx.match[1], 10);
    const order = await ctx.app.db.getOrderById(orderId);
    if (!order) return ctx.answerCallbackQuery({ text: '❌ سفارش یافت نشد.', show_alert: true });
    if (!(await markRefunded(ctx.app, orderId, ctx.from.id))) return ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    try {
      await ctx.api.sendMessage(order.customer_telegram_id, '✅ مبلغ سفارش «' + order.product_name + '» (' + formatPrice(order.price) + ' تومان) به شما بازگردانده شد.');
    } catch (err: any) {
      console.warn('⚠️ [Admin] refund message to ' + order.customer_telegram_id + ' failed:', err?.description ?? err?.message);
    }
    await ctx.answerCallbackQuery('✅ ثبت شد.');
    await markCard(ctx, '✅ بازپرداخت انجام شد');
  });

  // ── ✉️ پیام از طرف ربات (was the minimal handler of orderMessage.ts) ──
  bot.callbackQuery(/^fo_msg_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await ctx.app.db.getOrderById(parseInt(ctx.match[1], 10));
    if (!order) return ctx.answerCallbackQuery({ text: '❌ سفارش یافت نشد.', show_alert: true });
    await beginSupplierInput(ctx, 'fo_msg', String(order.id));
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '✉️ متنی را که می‌خواهید ربات برای مشتری سفارش #' + order.id + ' بفرستد بنویسید (۱ تا ۱٬۰۰۰ کاراکتر):',
      Markup.inlineKeyboard([[CANCEL_INPUT]]),
    );
  });

  // ── 💵 the cost of a manually delivered order ──
  bot.callbackQuery(/^fo_costskip_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    if (ctx.session.awaitingSupplierInput?.kind === 'fo_cost') ctx.session.awaitingSupplierInput = null;
    await ctx.answerCallbackQuery('⏭ رد شد.');
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  });
}

// ─── pieces ──────────────────────────────────────────────────────────────────

/**
 * Adds a new queued supplier order for the order, clears the card state and places it right away. Only the unknown
 * card's «🔁 ثبت نشده بود» (reason still `unknown`) may buy over an `unknown` row, and it cancels that row.
 */
async function retryNow(ctx: StoreContext, order: OrderRow, opts: { lossConfirmed?: boolean } = {}) {
  const app = ctx.app;
  const fromUnknownId = order.needs_action_reason === 'unknown' ? (await unknownSupplierOrderId(app, order.id)) ?? undefined : undefined;
  const soId = await queueSupplierOrder(app, order, {
    requestedBy: ctx.from!.id, eventKind: 'admin_retry', ...(fromUnknownId !== undefined ? { fromUnknownId } : {}),
    ...(opts.lossConfirmed ? { lossConfirmed: true } : {}),
  });
  if (soId === null) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
  await resetForNewAttempt(app, order.id);
  await ctx.answerCallbackQuery('🔁 دوباره ثبت می‌شود.');
  await markCard(ctx, '🔁 تلاش دوباره ثبت شد');
  if (app.apps.budget.remaining() >= 15) await kickSupplierOrder(app, soId);
}

type SourceInfo = SourceCandRow & { cost: number | null };

/** Every source of the order's option (disabled ones included) with its current cost. */
async function orderSources(app: StoreApp, order: OrderRow): Promise<SourceInfo[]> {
  const rows = (await app.raw.prepare(SOURCE_SELECT + ' WHERE s.customer_product_id = ? ORDER BY s.priority, s.id')
    .bind(order.customer_product_id).all<SourceCandRow>()).results;
  return rows.map((s) => ({ ...s, cost: s.price_usd !== null && s.usd_toman !== null ? costToman(s.price_usd, s.usd_toman) : null }));
}

function sourceStatus(s: SourceInfo): string {
  if (!s.sup_enabled) return 'تأمین‌کننده غیرفعال';
  if (!s.is_enabled) return 'غیرفعال';
  if (!s.listed) return 'خارج از لیست';
  return 'فعال';
}

/** `SUPPLIER — $X ≈ C ت — سود: P−C ت — وضعیت`; a loss gets 🔻. */
function sourceLabel(s: SourceInfo, salePrice: number): string {
  const usd = s.price_usd === null ? '—' : '$' + s.price_usd.toFixed(2);
  const money = s.cost === null ? '≈ ؟' : '≈ ' + formatPrice(s.cost) + ' ت — سود: ' + formatPrice(salePrice - s.cost) + (salePrice < s.cost ? ' 🔻' : '');
  return (s.sup_name + ' — ' + usd + ' ' + money + ' — ' + sourceStatus(s)).slice(0, 100);
}

async function showSourceConfirmation(ctx: StoreContext, order: OrderRow, s: SourceInfo): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    '⚠️ خرید از «' + s.sup_name + '» با هزینه‌ی ' + (s.cost === null ? 'نامشخص' : '≈ ' + formatPrice(s.cost) + ' ت') +
    (s.cost !== null ? ' (سود: ' + formatPrice(order.price - s.cost) + ' ت' + (order.price < s.cost ? ' 🔻' : '') + ')' : '') + ' انجام شود؟',
    Markup.inlineKeyboard([[cb('✅ بله', 'fo_srcok_' + order.id + '_' + s.id), cb('🔙', 'fo_src_' + order.id)]]),
  ).catch(() => {});
}

interface StockAccountView { id: number; status: string; content: ReturnType<typeof parseContent>; unitCost: number | null }

async function loadStockAccount(app: StoreApp, id: number): Promise<StockAccountView | null> {
  const row = await app.raw.prepare(`SELECT a.id, a.status, a.content_json, b.cost_toman, b.quantity FROM stock_accounts a
    JOIN stock_batches b ON b.id = a.batch_id WHERE a.id = ?`).bind(id)
    .first<{ id: number; status: string; content_json: string; cost_toman: number | null; quantity: number }>();
  if (!row) return null;
  return {
    id: row.id, status: row.status, content: parseContent(row.content_json),
    unitCost: row.cost_toman !== null && row.quantity > 0 ? Math.round(row.cost_toman / row.quantity) : null,
  };
}

/** After a text / stock delivery: answers the callback and edits the card; true when the customer got it. */
async function finishManualDelivery(ctx: StoreContext, result: Awaited<ReturnType<typeof deliverToCustomer>>, outcome: string): Promise<boolean> {
  if (result === 'delivered') {
    await ctx.answerCallbackQuery('✅ ارسال شد.');
    await markCard(ctx, outcome);
    return true;
  }
  if (result === 'send_failed') {
    await ctx.answerCallbackQuery({ text: '❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده. کارت تحویل‌نشده برایتان آمد.', show_alert: true });
  } else {
    await ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
  }
  return false;
}

async function askCost(ctx: StoreContext, orderId: number): Promise<void> {
  await beginSupplierInput(ctx, 'fo_cost', String(orderId));
  await ctx.reply('💵 هزینه‌ی خرید این اکانت چند تومان بود؟ (برای گزارش سود)', Markup.inlineKeyboard([[cb('⏭ رد شدن', 'fo_costskip_' + orderId)]]));
}

const cancelConfirmText = (order: OrderRow, reason: string | null): string =>
  '⚠️ سفارش #' + order.id + ' لغو شود؟ مبلغ ' + formatPrice(order.price) + ' ت باید به مشتری برگردانده شود.' + (reason ? '\n📝 دلیل: ' + reason : '');

// ─── typed answers ───────────────────────────────────────────────────────────

/** Typed answers of the fulfillment prompts. Returns true when the kind belongs here. */
export async function handleFulfillmentText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  const orderId = parseInt(ref, 10);

  if (kind === 'fo_rid') {
    const id = asciiDigits(text);
    if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) {
      await ctx.reply('❌ شماره باید فقط عدد باشد. دوباره وارد کنید:');
      return true;
    }
    ctx.session.awaitingSupplierInput = null;
    const result = await recordRemoteOrderId(ctx.app, orderId, String(Number(id)), ctx.from!.id);
    await ctx.reply(result === 'ok' ? '✅ ثبت شد؛ پیگیری خودکار سفارش شروع شد.' : IMPOSSIBLE);
    return true;
  }

  if (kind === 'fo_msg') {
    const message = text.trim();
    if (message.length < 1 || message.length > 1000) {
      await ctx.reply('❌ پیام باید بین ۱ تا ۱٬۰۰۰ کاراکتر باشد. دوباره بنویسید:');
      return true;
    }
    const order = await ctx.app.db.getOrderById(orderId);
    ctx.session.awaitingSupplierInput = null;
    if (!order) {
      await ctx.reply('❌ سفارش یافت نشد.');
      return true;
    }
    try {
      await ctx.app.api.sendMessage(
        order.customer_telegram_id,
        '📩 پیام پشتیبانی درباره‌ی سفارش «' + order.product_name + '»:\n\n' + message + '\n\nبرای پاسخ به ' + ACTIVATION_CONTACT + ' پیام دهید.',
      );
    } catch (err: any) {
      console.warn('⚠️ [Admin] order message to ' + order.customer_telegram_id + ' failed:', err?.description ?? err?.message);
      await ctx.reply('❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده.');
      return true;
    }
    await logEvent(ctx.app, { orderId: order.id, kind: 'admin_message', actor: ctx.from?.id, detail: message });
    await ctx.reply('✅ ارسال شد');
    return true;
  }

  if (kind === 'fo_text') {
    if (text.length < 1 || text.length > 3500) {
      await ctx.reply('❌ متن باید بین ۱ تا ۳٬۵۰۰ کاراکتر باشد. دوباره بنویسید:');
      return true;
    }
    ctx.session.awaitingSupplierInput = null;
    await beginSupplierWizard(ctx, 'fo_text_preview', { orderId, text });
    await ctx.reply(
      '👁 این متن برای مشتری ارسال می‌شود:\n\n' + formatAccountsHtml({ text }),
      { ...html, ...Markup.inlineKeyboard([[cb('✅ ارسال برای مشتری', 'fo_textok_' + orderId), cb('✏️ دوباره', 'fo_text_' + orderId)], [cb('🔙', 'fo_card_' + orderId)]]) },
    );
    return true;
  }

  if (kind === 'fo_cost') {
    const n = Number(asciiDigits(text));
    if (text.trim() === '' || !Number.isInteger(n) || n < 0 || n > 1_000_000_000) {
      await ctx.reply('❌ یک عدد صحیح بین ۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان وارد کنید:');
      return true;
    }
    ctx.session.awaitingSupplierInput = null;
    await ctx.reply((await setOrderCost(ctx.app, orderId, n, ctx.from!.id)) ? '✅ هزینه ثبت شد (' + formatPrice(n) + ' ت).' : IMPOSSIBLE);
    return true;
  }

  if (kind === 'fo_cancel_reason') {
    const reason = text.trim();
    if (reason.length < 1 || reason.length > 200) {
      await ctx.reply('❌ دلیل باید بین ۱ تا ۲۰۰ کاراکتر باشد. دوباره بنویسید:');
      return true;
    }
    const order = await ctx.app.db.getOrderById(orderId);
    ctx.session.awaitingSupplierInput = null;
    if (!order || order.status !== 'confirmed') {
      await ctx.reply(ALREADY);
      return true;
    }
    await beginSupplierWizard(ctx, 'fo_cancel_confirm', { orderId, reason });
    await ctx.reply(cancelConfirmText(order, reason), Markup.inlineKeyboard([[cb('✅ بله، لغو شود', 'fo_cok_' + orderId), cb('🔙', 'fo_card_' + orderId)]]));
    return true;
  }
  return false;
}
