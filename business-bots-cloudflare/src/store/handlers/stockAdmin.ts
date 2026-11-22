import type { Bot } from 'grammy';
import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { tehranDateTime } from '../../lib/time';
import { eventStatement, logEvent } from '../events';
import { escapeHtml, formatPrice, buildPagedKeyboard } from '../utils';
import { onPurchaseConfirmed } from '../referrals';
import { deliverToCustomer, kickSupplierOrder, recordStockRemoteOrderId } from '../suppliers/engine';
import { parseContent } from '../suppliers/format';
import { buildAccountCard, buildBatchCard, batchLabel, listBatches, loadAccount, type AccountRow } from '../suppliers/stockCards';
import { listSuppliers, readCatalog } from '../suppliers/store';
import { usd, walletBalance } from '../suppliers/wallet';
import { catalogPicker, findCatalogItem } from './supplierSources';
import { INPUT_TTL_MS, beginSupplierInput, beginSupplierWizard } from '../supplierInput';
import type { StoreContext } from '../types';

const html = { parse_mode: 'HTML' as const };
const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const CANCEL_INPUT = Markup.button.callback('❌ انصراف', 'sup_cancel_input');
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));
const normalizeDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30))
  .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30)).replace(/[−–]/g, '-').replace(/[\s,،٬]/g, '');
const nowStr = (app: StoreApp) => tehranDateTime(app.apps.now());
const adminName = (ctx: StoreContext) => ctx.from?.first_name ?? 'ادمین';

/** A whole number (a leading «-» allowed when `signed`) from admin text; null when it is not one. */
function parseInteger(text: string, signed = false): number | null {
  const t = normalizeDigits(text);
  if (!(signed ? /^-?\d{1,12}$/ : /^\d{1,12}$/).test(t)) return null;
  return parseInt(t, 10);
}

/** The session's draft for a confirmation step, if it matches and is fresh. */
function draft(ctx: StoreContext, step: string): Record<string, any> | null {
  const w = ctx.session.supplierWizard;
  if (!w || w.step !== step) return null;
  if (w.at !== undefined && ctx.app.apps.now().getTime() - w.at > INPUT_TTL_MS) return null;
  return w.data;
}

/** Product options that share the account's remote ids come first (🎯). */
export const MATCHING_PRODUCTS_SQL = `SELECT DISTINCT s.customer_product_id AS id FROM stock_accounts a
  JOIN stock_batches b ON b.id = a.batch_id JOIN supplier_orders so ON so.id = b.supplier_order_id
  JOIN product_sources s ON s.supplier_id = so.supplier_id AND s.remote_product_id = so.remote_product_id AND s.remote_variation_id = COALESCE(so.remote_variation_id, '')
  WHERE a.id = ?`;
/** «stk_rel_»: withdraws the manual link that holds a stock account (found by the account; indexed). */
export const RELEASE_LINK_SQL = "DELETE FROM manual_purchase_claims WHERE stock_account_id = ? AND status = 'pending'";
export const CUSTOMER_BY_ID_SQL = 'SELECT telegram_id, display_name, username FROM customers WHERE telegram_id = ?';
export const CUSTOMER_BY_NAME_SQL = 'SELECT telegram_id, display_name, username FROM customers WHERE username = ? LIMIT 1';

interface CustomerRow { telegram_id: number; display_name: string; username: string | null }

async function findCustomer(app: StoreApp, raw: string): Promise<CustomerRow | null> {
  const t = normalizeDigits(raw.trim());
  if (/^\d{1,15}$/.test(t)) return (await app.raw.prepare(CUSTOMER_BY_ID_SQL).bind(parseInt(t, 10)).first<CustomerRow>()) ?? null;
  const m = raw.trim().match(/^@?([A-Za-z0-9_]{3,32})$/);
  if (!m) return null;
  for (const name of new Set([m[1], m[1].toLowerCase()])) {
    const row = await app.raw.prepare(CUSTOMER_BY_NAME_SQL).bind(name).first<CustomerRow>();
    if (row) return row;
  }
  return null;
}

// ─── Views ───────────────────────────────────────────────────────────────────

async function batchListView(app: StoreApp, page: number): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
  const batches = await listBatches(app);
  const back = cb('🔙 بازگشت', 'sup_menu');
  const keyboard = buildPagedKeyboard(batches, page, (b) => cb(batchLabel(b), 'stk_b_' + b.id), 'stk_list_', back);
  return {
    text: batches.length ? '📦 <b>اکانت‌های من</b>\nدسته‌ها (جدیدترین اول):' : '📦 <b>اکانت‌های من</b>\n\nهنوز اکانتی ندارید. از «🛒 خرید مستقیم» می‌توانید بخرید.',
    keyboard,
  };
}

// ─── Direct buy ──────────────────────────────────────────────────────────────

interface BuyChoice { sid: number; ref: string; qty: number }

/** The confirmation text of a direct buy: cost in USD and Toman, and the estimated wallet. */
async function confirmView(app: StoreApp, c: BuyChoice, nonce: string): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null> {
  const item = await findCatalogItem(app, c.sid, c.ref);
  const supplier = (await listSuppliers(app)).find((s) => s.id === c.sid);
  const cached = await readCatalog(app, c.sid);
  if (!item || !supplier || !cached) return null;
  const attrs = Object.values(item.attributes ?? {}).filter((v) => v !== '').join(' · ');
  const lines = [
    '🛒 <b>خرید مستقیم از «' + escapeHtml(supplier.name) + '»</b>',
    '📦 ' + escapeHtml(item.name) + (attrs ? ' — ' + escapeHtml(attrs) : '') + ' × ' + fa(c.qty),
  ];
  if (item.priceUsd !== null) {
    const total = Math.round(item.priceUsd * c.qty * 1e6) / 1e6;
    lines.push('💵 هزینه: $' + total + ' ≈ ' + formatPrice(Math.round(total * cached.catalog.usdToman)) + ' ت (نرخ ' + formatPrice(cached.catalog.usdToman) + ')');
  } else {
    lines.push('💵 هزینه: قیمت این گزینه در کاتالوگ نیست.');
  }
  lines.push('💳 موجودی تخمینی کیف پول: ' + usd(await walletBalance(app, c.sid)));
  return {
    text: lines.join('\n'),
    keyboard: Markup.inlineKeyboard([[cb('✅ خرید', 'stk_buyok_' + c.sid + '_' + c.ref + '_' + c.qty + '_' + nonce), cb('❌', 'stk_x')]]),
  };
}

/** A fresh random token per confirmation (12 hex digits): one nonce can place one direct buy, whatever any session says. */
const newNonce = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

async function showConfirm(ctx: StoreContext, c: BuyChoice, edit: boolean): Promise<void> {
  const nonce = newNonce();
  const v = await confirmView(ctx.app, c, nonce);
  if (!v) {
    await ctx.reply('❌ این گزینه دیگر در کاتالوگ نیست.');
    return;
  }
  await beginSupplierWizard(ctx, 'buy', { ...c, nonce });
  if (edit) await ctx.editMessageText(v.text, { ...html, ...v.keyboard }).catch(() => {});
  else await ctx.reply(v.text, { ...html, ...v.keyboard });
}

/**
 * Inserts the queued `purpose='stock'` supplier order. The nonce column is UNIQUE, so the same confirmation can insert at
 * most one row however many times (or from however stale a session) its button is pressed. Returns the id, or null when
 * this nonce was used already.
 */
async function queueDirectBuy(
  app: StoreApp, c: { supplierId: number; remoteProductId: string; remoteVariationId: string; quantity: number }, admin: number, nonce: string,
): Promise<number | null> {
  const now = nowStr(app);
  const rs = await app.raw.batch([
    app.raw.prepare(`INSERT OR IGNORE INTO supplier_orders (purpose, supplier_id, remote_product_id, remote_variation_id, quantity, status, next_attempt_at, requested_by, buy_nonce, created_at, updated_at)
                     VALUES ('stock', ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`).bind(c.supplierId, c.remoteProductId, c.remoteVariationId, c.quantity, now, admin, nonce, now, now),
    eventStatement(app, { supplierOrderId: 'last', kind: 'queued', actor: admin, detail: 'direct buy', onlyIfChanged: true }),
  ]);
  return rs[0].meta.changes === 1 ? rs[0].meta.last_row_id : null;
}

/** After the kick: tells the admin how far the order got (failures were already reported by the engine). */
async function reportKick(ctx: StoreContext, soId: number): Promise<void> {
  const row = await ctx.app.raw.prepare('SELECT status, remote_order_id FROM supplier_orders WHERE id = ?').bind(soId).first<{ status: string; remote_order_id: string | null }>();
  if (row?.status === 'placed') await ctx.reply('⏳ سفارش ثبت شد (#' + row.remote_order_id + ')؛ با آماده شدن خبرتان می‌کنم.');
  else if (row?.status === 'queued') await ctx.reply('⏳ سفارش در صف است و تا دقایقی دیگر ثبت می‌شود.');
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerStockAdmin(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  const guard = async (ctx: StoreContext): Promise<boolean> => {
    if (isAdmin(ctx.from?.id)) return true;
    await ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    return false;
  };
  const edit = async (ctx: StoreContext, text: string, keyboard?: ReturnType<typeof Markup.inlineKeyboard>) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { ...html, ...(keyboard ?? {}) }).catch(() => {});
  };

  bot.callbackQuery('stk_x', async (ctx) => {
    if (!(await guard(ctx))) return;
    ctx.session.supplierWizard = null;
    await edit(ctx, '❌ انصراف شد.');
  });

  // ── 🛒 خرید مستقیم ──
  bot.callbackQuery('stk_buy', async (ctx) => {
    if (!(await guard(ctx))) return;
    const suppliers = (await listSuppliers(ctx.app)).filter((s) => s.is_enabled);
    if (suppliers.length === 0) return ctx.answerCallbackQuery({ text: '❌ تأمین‌کننده‌ی فعالی ندارید.', show_alert: true });
    await edit(ctx, '🛒 <b>خرید مستقیم</b>\nاز کدام تأمین‌کننده می‌خواهید بخرید؟',
      Markup.inlineKeyboard([...suppliers.map((s) => [cb(s.name, 'stk_buys_' + s.id)]), [cb('🔙 بازگشت', 'sup_menu')]]));
  });
  const showItems = async (ctx: StoreContext, sid: number, page: number) => {
    const v = await catalogPicker(ctx.app, sid, page, (ref) => 'stk_buyi_' + sid + '_' + ref, 'stk_buyp_' + sid + '_', cb('🔙 بازگشت', 'stk_buy'));
    await edit(ctx, v.text, v.keyboard);
  };
  bot.callbackQuery(/^stk_buys_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showItems(ctx, parseInt(ctx.match[1], 10), 0);
  });
  bot.callbackQuery(/^stk_buyp_(\d+)_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showItems(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10));
  });
  bot.callbackQuery(/^stk_buyi_(\d+)_([0-9a-f]+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const sid = parseInt(ctx.match[1], 10);
    const ref = ctx.match[2];
    if (!(await findCatalogItem(ctx.app, sid, ref))) return ctx.answerCallbackQuery({ text: '❌ این گزینه دیگر در کاتالوگ نیست.', show_alert: true });
    const q = (n: number) => cb(fa(n), 'stk_buyq_' + sid + '_' + ref + '_' + n);
    await edit(ctx, '🔢 چند عدد؟', Markup.inlineKeyboard([
      [q(1), q(2), q(3), q(5), q(10)],
      [cb('عدد دلخواه (۱ تا ۱۰)', 'stk_buyc_' + sid + '_' + ref)],
      [cb('🔙 بازگشت', 'stk_buys_' + sid)],
    ]));
  });
  bot.callbackQuery(/^stk_buyq_(\d+)_([0-9a-f]+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const qty = parseInt(ctx.match[3], 10);
    if (qty < 1 || qty > 10) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await showConfirm(ctx, { sid: parseInt(ctx.match[1], 10), ref: ctx.match[2], qty }, true);
  });
  bot.callbackQuery(/^stk_buyc_(\d+)_([0-9a-f]+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    await beginSupplierInput(ctx, 'stk_qty', ctx.match[1] + '_' + ctx.match[2]);
    await ctx.answerCallbackQuery();
    await ctx.reply('🔢 تعداد را بنویسید (۱ تا ۱۰):', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });
  bot.callbackQuery(/^stk_buyok_(\d+)_([0-9a-f]+)_(\d+)_([0-9a-f]{12})$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const sid = parseInt(ctx.match[1], 10);
    const ref = ctx.match[2];
    const qty = parseInt(ctx.match[3], 10);
    const nonce = ctx.match[4];
    const used = () => ctx.answerCallbackQuery({ text: '⌛️ این تأیید قبلاً استفاده شده یا منقضی شده است. دوباره شروع کنید.', show_alert: true });
    // The session draft makes a replayed button cheap to refuse; the UNIQUE nonce in the DB is what really decides.
    const d = draft(ctx, 'buy');
    if (!d || d.sid !== sid || d.ref !== ref || d.qty !== qty || d.nonce !== nonce) return used();
    ctx.session.supplierWizard = null;
    const item = await findCatalogItem(ctx.app, sid, ref);
    if (!item) return ctx.answerCallbackQuery({ text: '❌ این گزینه دیگر در کاتالوگ نیست.', show_alert: true });
    const soId = await queueDirectBuy(ctx.app, { supplierId: sid, remoteProductId: item.remoteProductId, remoteVariationId: item.remoteVariationId, quantity: qty }, ctx.from.id, nonce);
    if (soId === null) return used();
    await ctx.answerCallbackQuery('⏳ در حال ثبت سفارش…');
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    // the kick can take 25 s (a stale catalog sync + the POST): the consumed draft is saved first, not after the handler
    await ctx.flushSession();
    await kickSupplierOrder(ctx.app, soId);
    await reportKick(ctx, soId);
  });

  // a failed direct buy is retried only when the admin presses the button
  bot.callbackQuery(/^stk_rt_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const oldId = parseInt(ctx.match[1], 10);
    const now = nowStr(ctx.app);
    // A NEW row per retry (like fo_retry): the failed row keeps its remote number, raw answer and wallet spend, so a refund
    // stays traceable to the order that was charged. The old row is closed in the same batch, so a second press finds nothing.
    const rs = await ctx.app.raw.batch([
      ctx.app.raw.prepare("UPDATE supplier_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND purpose = 'stock' AND status = 'failed'").bind(now, oldId),
      ctx.app.raw.prepare(`INSERT INTO supplier_orders (purpose, supplier_id, remote_product_id, remote_variation_id, quantity, status, next_attempt_at, requested_by, created_at, updated_at)
                           SELECT 'stock', supplier_id, remote_product_id, remote_variation_id, quantity, 'queued', ?, ?, ?, ? FROM supplier_orders
                           WHERE id = ? AND status = 'cancelled' AND changes() = 1`).bind(now, ctx.from.id, now, now, oldId),
      eventStatement(ctx.app, { supplierOrderId: 'last', kind: 'admin_retry', actor: ctx.from.id, detail: 'retry of #' + oldId, onlyIfChanged: true }),
    ]);
    if (rs[1].meta.changes !== 1) return ctx.answerCallbackQuery({ text: 'ℹ️ قبلاً تصمیم گرفته شد.', show_alert: true });
    const soId = rs[1].meta.last_row_id;
    await ctx.answerCallbackQuery('⏳ دوباره تلاش می‌شود…');
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await kickSupplierOrder(ctx.app, soId);
    await reportKick(ctx, soId);
  });
  bot.callbackQuery(/^stk_rtu_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const soId = parseInt(ctx.match[1], 10);
    await edit(ctx, '⚠️ اگر سفارش واقعاً در تأمین‌کننده ثبت شده باشد، دوبار شارژ می‌شوید. مطمئنید ثبت نشده بود؟',
      Markup.inlineKeyboard([[cb('✅ مطمئنم، دوباره بخر', 'stk_rtuok_' + soId), cb('❌', 'stk_x')]]));
  });
  bot.callbackQuery(/^stk_rtuok_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const soId = parseInt(ctx.match[1], 10);
    const now = nowStr(ctx.app);
    const rs = await ctx.app.raw.batch([
      ctx.app.raw.prepare("UPDATE supplier_orders SET status = 'queued', next_attempt_at = ?, last_error = NULL, requested_by = ?, updated_at = ? WHERE id = ? AND purpose = 'stock' AND status = 'unknown'")
        .bind(now, ctx.from.id, now, soId),
      eventStatement(ctx.app, { supplierOrderId: soId, kind: 'admin_retry', actor: ctx.from.id, detail: 'from unknown', onlyIfChanged: true }),
    ]);
    if (rs[0].meta.changes !== 1) return ctx.answerCallbackQuery({ text: 'ℹ️ قبلاً تصمیم گرفته شد.', show_alert: true });
    await ctx.answerCallbackQuery('⏳ دوباره تلاش می‌شود…');
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await kickSupplierOrder(ctx.app, soId);
    await reportKick(ctx, soId);
  });
  bot.callbackQuery(/^stk_rid_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    await beginSupplierInput(ctx, 'stk_rid', ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply('🔢 شماره‌ی سفارش را از پنل تأمین‌کننده بنویسید:', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });

  // ── 📦 اکانت‌های من ──
  bot.callbackQuery(/^stk_list_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const v = await batchListView(ctx.app, parseInt(ctx.match[1], 10));
    await edit(ctx, v.text, v.keyboard);
  });
  bot.callbackQuery(/^stk_b_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const card = await buildBatchCard(ctx.app, parseInt(ctx.match[1], 10));
    if (!card) return ctx.answerCallbackQuery({ text: '❌ دسته یافت نشد.', show_alert: true });
    await edit(ctx, card.html, Markup.inlineKeyboard(card.rows));
  });
  const showAccount = async (ctx: StoreContext, id: number) => {
    const a = await loadAccount(ctx.app, id);
    if (!a) return ctx.answerCallbackQuery({ text: '❌ اکانت یافت نشد.', show_alert: true });
    const card = buildAccountCard(a);
    await edit(ctx, card.html, Markup.inlineKeyboard(card.rows));
  };
  bot.callbackQuery(/^stk_a_(\d+)$/, async (ctx) => {
    if (await guard(ctx)) await showAccount(ctx, parseInt(ctx.match[1], 10));
  });

  bot.callbackQuery(/^stk_bp_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    await beginSupplierInput(ctx, 'stk_batch_profit', ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply('💰 سود کل این دسته را به تومان بنویسید (عدد صحیح؛ ضرر را با - بنویسید):', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });
  bot.callbackQuery(/^stk_bn_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    await beginSupplierInput(ctx, 'stk_note', ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply('📝 یادداشت این دسته را بنویسید:', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });

  // ── account actions ──
  bot.callbackQuery(/^stk_out_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const a = await loadAccount(ctx.app, parseInt(ctx.match[1], 10));
    if (!a || a.status !== 'available') return ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true });
    await beginSupplierInput(ctx, 'stk_sold', String(a.id));
    await ctx.answerCallbackQuery();
    await ctx.reply('💰 به چه قیمتی (تومان) بیرون از ربات فروختید؟', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });
  bot.callbackQuery(/^stk_bad_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const a = await loadAccount(ctx.app, parseInt(ctx.match[1], 10));
    if (!a || a.status !== 'available') return ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true });
    await beginSupplierInput(ctx, 'stk_dnote', String(a.id));
    await ctx.answerCallbackQuery();
    await ctx.reply('⚠️ یادداشت (مثلاً دلیل خرابی) را بنویسید، یا «-» بفرستید تا بدون یادداشت ثبت شود:', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });
  bot.callbackQuery(/^stk_back_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const id = parseInt(ctx.match[1], 10);
    const r = await ctx.app.raw.prepare(`UPDATE stock_accounts SET status = 'available', sold_price_toman = NULL, sold_at = NULL, note = NULL, updated_at = ?
      WHERE id = ? AND status IN ('sold_outside', 'defective')`).bind(nowStr(ctx.app), id).run();
    if (r.meta.changes !== 1) return ctx.answerCallbackQuery({ text: 'ℹ️ وضعیت این اکانت تغییر کرده است.', show_alert: true });
    await showAccount(ctx, id);
  });
  // a link that was never opened: frees the reserved account and withdraws the link
  bot.callbackQuery(/^stk_rel_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const id = parseInt(ctx.match[1], 10);
    const rs = await ctx.app.raw.batch([
      ctx.app.raw.prepare(RELEASE_LINK_SQL).bind(id),
      ctx.app.raw.prepare("UPDATE stock_accounts SET status = 'available', updated_at = ? WHERE id = ? AND status = 'reserved' AND order_id IS NULL").bind(nowStr(ctx.app), id),
    ]);
    if (rs[1].meta.changes !== 1) return ctx.answerCallbackQuery({ text: 'ℹ️ لینک قبلاً استفاده شده است.', show_alert: true });
    await showAccount(ctx, id);
  });

  // ── 📤 ارسال برای مشتری ──
  bot.callbackQuery(/^stk_send_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const a = await loadAccount(ctx.app, parseInt(ctx.match[1], 10));
    if (!a || a.status !== 'available') return ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true });
    await beginSupplierInput(ctx, 'stk_send_to', String(a.id));
    await ctx.answerCallbackQuery();
    await ctx.reply('📤 شناسه‌ی عددی تلگرام مشتری یا @username او را بنویسید:', Markup.inlineKeyboard([[CANCEL_INPUT]]));
  });
  const showProducts = async (ctx: StoreContext, aid: number, cid: number, page: number, edit_: boolean) => {
    const [products, matches] = await Promise.all([
      ctx.app.db.getAllActiveCustomerProducts(),
      ctx.app.raw.prepare(MATCHING_PRODUCTS_SQL).bind(aid).all<{ id: number }>(),
    ]);
    const mine = new Set(matches.results.map((r) => r.id));
    const sorted = [...products.filter((p) => mine.has(p.id)), ...products.filter((p) => !mine.has(p.id))];
    const kb = buildPagedKeyboard(sorted, page, (p) => cb((mine.has(p.id) ? '🎯 ' : '') + p.name.slice(0, 30) + ' — ' + formatPrice(p.price), 'stk_sp_' + aid + '_' + cid + '_' + p.id),
      'stk_spp_' + aid + '_' + cid + '_', cb('❌ انصراف', 'stk_x'));
    const text = '📦 کدام محصول برای مشتری ثبت شود؟ (🎯 = از همین منبع)';
    if (edit_) await ctx.editMessageText(text, kb).catch(() => {});
    else await ctx.reply(text, kb);
  };
  bot.callbackQuery(/^stk_spp_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    await ctx.answerCallbackQuery();
    await showProducts(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10), parseInt(ctx.match[3], 10), true);
  });
  bot.callbackQuery(/^stk_sp_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const [aid, cid, pid] = [1, 2, 3].map((i) => parseInt(ctx.match[i], 10));
    const product = await ctx.app.db.getCustomerProductById(pid);
    if (!product?.is_active) return ctx.answerCallbackQuery({ text: '❌ این محصول فعال نیست.', show_alert: true });
    await beginSupplierInput(ctx, 'stk_send_price', aid + '_' + cid + '_' + pid);
    await ctx.answerCallbackQuery();
    await ctx.reply('💰 قیمت فروش به تومان را بنویسید (۰ هم مجاز است)، یا قیمت خود محصول را بزنید:',
      Markup.inlineKeyboard([[cb('قیمت محصول: ' + formatPrice(product.price) + ' ت', 'stk_spd_' + aid + '_' + cid + '_' + pid)], [CANCEL_INPUT]]));
  });
  bot.callbackQuery(/^stk_spd_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const [aid, cid, pid] = [1, 2, 3].map((i) => parseInt(ctx.match[i], 10));
    const product = await ctx.app.db.getCustomerProductById(pid);
    if (!product?.is_active) return ctx.answerCallbackQuery({ text: '❌ این محصول فعال نیست.', show_alert: true });
    ctx.session.awaitingSupplierInput = null;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await sellFromStock(ctx, aid, cid, pid, Math.round(product.price));
  });

  // ── 🔗 لینک خرید دستی: the manual-purchase wizard with this account attached ──
  bot.callbackQuery(/^stk_link_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const a = await loadAccount(ctx.app, parseInt(ctx.match[1], 10));
    if (!a || a.status !== 'available') return ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true });
    await ctx.answerCallbackQuery();
    ctx.session.awaitingSupplierInput = null;
    ctx.session.supplierWizard = null;
    await ctx.scene.enter('manual-purchase-wizard', { stockAccountId: a.id });
  });
}

// ─── Selling an account to a bot customer ────────────────────────────────────

/**
 * Creates the confirmed order, reserves the account in the same batch and delivers it (SUPPLIER_PLAN.md §10.2). The
 * order only exists when the account was still available; a send that fails leaves the usual «send_failed» card.
 */
async function sellFromStock(ctx: StoreContext, accountId: number, customerId: number, productId: number, price: number): Promise<void> {
  const app = ctx.app;
  const [account, product, customer] = await Promise.all([
    loadAccount(app, accountId), app.db.getCustomerProductById(productId),
    app.raw.prepare(CUSTOMER_BY_ID_SQL).bind(customerId).first<CustomerRow>(),
  ]);
  const content = account ? parseContent(account.content_json) : null;
  if (!account || account.status !== 'available' || !content) return void (await ctx.reply('❌ این اکانت دیگر آزاد نیست.'));
  if (!product?.is_active) return void (await ctx.reply('❌ این محصول فعال نیست.'));
  if (!customer) return void (await ctx.reply('❌ این مشتری ربات را استارت نزده است.'));

  const unitCost = account.cost_toman !== null && account.quantity > 0 ? Math.round(account.cost_toman / account.quantity) : null;
  const now = nowStr(app);
  const rs = await app.raw.batch([
    app.raw.prepare(`INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, purchase_source, status, decided_at, decided_by,
                       duration_days, warranty_days, customer_username, fulfillment, cost_toman)
                     SELECT ?, ?, ?, ?, 'manual', 'confirmed', ?, ?, ?, ?, ?, 'stock', ?
                     WHERE EXISTS (SELECT 1 FROM stock_accounts WHERE id = ? AND status = 'available')`)
      .bind(customerId, product.id, product.name, price, now, ctx.from!.id, product.duration_days || null, product.warranty_days || null, customer.username, unitCost, accountId),
    app.raw.prepare("UPDATE stock_accounts SET status = 'reserved', order_id = (SELECT MAX(id) FROM orders), updated_at = ? WHERE id = ? AND status = 'available' AND changes() = 1")
      .bind(now, accountId),
  ]);
  if (rs[0].meta.changes !== 1) return void (await ctx.reply('❌ این اکانت دیگر آزاد نیست.'));
  const orderId = rs[0].meta.last_row_id;
  await logEvent(app, { orderId, kind: 'admin_stock', actor: ctx.from!.id, detail: 'sold from stock account ' + accountId });

  const result = await deliverToCustomer(app, orderId, content, {
    kind: 'stock', stockAccountId: accountId, actor: ctx.from!.id, actorName: adminName(ctx), costToman: unitCost,
  });
  if (result === 'delivered' || result === 'deferred') {
    try {
      await onPurchaseConfirmed(app, { id: orderId, customer_telegram_id: customerId, price });
    } catch (err: any) {
      console.error('❌ [Stock] referral qualification failed:', err?.message ?? err);
    }
    if (result === 'deferred') await ctx.reply('⏳ سفارش #' + orderId + ' ساخته شد؛ ارسال اکانت در صف است و تا دقایقی دیگر انجام می‌شود.');
  } else if (result === 'send_failed') {
    await ctx.reply('❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده. کارت تحویل‌نشده برایتان آمد؛ سفارش #' + orderId);
  } else {
    await ctx.reply('⚠️ سفارش #' + orderId + ' ساخته شد ولی ارسال انجام نشد (' + result + '). از /order ' + orderId + ' ادامه دهید.');
  }
}

// ─── Typed answers (called by the supplier text middleware) ──────────────────

/** Handles the `stk_*` prompts. true = the kind belongs to this module (the middleware stops there). */
export async function handleStockText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  const app = ctx.app;
  const done = () => { ctx.session.awaitingSupplierInput = null; };

  switch (kind) {
    case 'stk_qty': {
      const qty = parseInteger(text);
      if (qty === null || qty < 1 || qty > 10) {
        await ctx.reply('❌ تعداد باید بین ۱ تا ۱۰ باشد. دوباره بنویسید:');
        return true;
      }
      const [sid, itemRef_] = ref.split('_');
      done();
      await showConfirm(ctx, { sid: parseInt(sid, 10), ref: itemRef_, qty }, false);
      return true;
    }

    case 'stk_rid': {
      const id = text.trim();
      if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) {
        await ctx.reply('❌ شماره‌ی سفارش معتبر نیست. دوباره بنویسید:');
        return true;
      }
      done();
      const r = await recordStockRemoteOrderId(app, parseInt(ref, 10), id, ctx.from!.id);
      await ctx.reply(r === 'ok' ? '✅ ثبت شد؛ با آماده شدن اکانت‌ها خبرتان می‌کنم.' : 'ℹ️ این سفارش دیگر در وضعیت نامشخص نیست.');
      return true;
    }

    case 'stk_batch_profit': {
      const amount = parseInteger(text, true);
      if (amount === null) {
        await ctx.reply('❌ یک عدد صحیح بنویسید (ضرر را با - بنویسید):');
        return true;
      }
      done();
      const batchId = parseInt(ref, 10);
      await app.raw.prepare('UPDATE stock_batches SET reported_profit_toman = ?, reported_at = ? WHERE id = ?').bind(amount, nowStr(app), batchId).run();
      const card = await buildBatchCard(app, batchId);
      await ctx.reply('✅ ثبت شد.\n\n' + (card?.html ?? ''), { ...html, ...(card ? Markup.inlineKeyboard(card.rows) : {}) });
      return true;
    }

    case 'stk_note': {
      done();
      const batchId = parseInt(ref, 10);
      await app.raw.prepare('UPDATE stock_batches SET note = ? WHERE id = ?').bind(text.trim().slice(0, 300), batchId).run();
      const card = await buildBatchCard(app, batchId);
      await ctx.reply('✅ ثبت شد.\n\n' + (card?.html ?? ''), { ...html, ...(card ? Markup.inlineKeyboard(card.rows) : {}) });
      return true;
    }

    case 'stk_sold': {
      const price = parseInteger(text);
      if (price === null) {
        await ctx.reply('❌ قیمت را به صورت عدد (تومان) بنویسید:');
        return true;
      }
      done();
      const id = parseInt(ref, 10);
      const now = nowStr(app);
      const r = await app.raw.prepare("UPDATE stock_accounts SET status = 'sold_outside', sold_price_toman = ?, sold_at = ?, updated_at = ? WHERE id = ? AND status = 'available'")
        .bind(price, now, now, id).run();
      await replyAccount(ctx, id, r.meta.changes === 1 ? '✅ به عنوان «فروخته‌شده بیرون از ربات» ثبت شد.' : '❌ این اکانت دیگر آزاد نیست.');
      return true;
    }

    case 'stk_dnote': {
      done();
      const id = parseInt(ref, 10);
      const note = text.trim() === '-' ? null : text.trim().slice(0, 300);
      const r = await app.raw.prepare("UPDATE stock_accounts SET status = 'defective', note = ?, updated_at = ? WHERE id = ? AND status = 'available'")
        .bind(note, nowStr(app), id).run();
      await replyAccount(ctx, id, r.meta.changes === 1 ? '✅ به عنوان «خراب/مرجوعی» ثبت شد.' : '❌ این اکانت دیگر آزاد نیست.');
      return true;
    }

    case 'stk_send_to': {
      const customer = await findCustomer(app, text);
      if (!customer) {
        await ctx.reply('❌ این مشتری ربات را استارت نزده است. شناسه یا @username دیگری بنویسید:');
        return true;
      }
      done();
      const aid = parseInt(ref, 10);
      const a = await loadAccount(app, aid);
      if (!a || a.status !== 'available') {
        await ctx.reply('❌ این اکانت دیگر آزاد نیست.');
        return true;
      }
      await ctx.reply('👤 مشتری: ' + customer.display_name + (customer.username ? ' (@' + customer.username + ')' : '') + ' — ' + customer.telegram_id);
      const products = await app.db.getAllActiveCustomerProducts();
      if (products.length === 0) {
        await ctx.reply('⚠️ محصول فعالی وجود ندارد.');
        return true;
      }
      // reuse the product picker with the account and customer in every button
      const matches = await app.raw.prepare(MATCHING_PRODUCTS_SQL).bind(aid).all<{ id: number }>();
      const mine = new Set(matches.results.map((r) => r.id));
      const sorted = [...products.filter((p) => mine.has(p.id)), ...products.filter((p) => !mine.has(p.id))];
      const kb = buildPagedKeyboard(sorted, 0, (p) => cb((mine.has(p.id) ? '🎯 ' : '') + p.name.slice(0, 30) + ' — ' + formatPrice(p.price), 'stk_sp_' + aid + '_' + customer.telegram_id + '_' + p.id),
        'stk_spp_' + aid + '_' + customer.telegram_id + '_', cb('❌ انصراف', 'stk_x'));
      await ctx.reply('📦 کدام محصول برای مشتری ثبت شود؟ (🎯 = از همین منبع)', kb);
      return true;
    }

    case 'stk_send_price': {
      const price = parseInteger(text);
      if (price === null) {
        await ctx.reply('❌ قیمت را به صورت عدد (تومان) بنویسید:');
        return true;
      }
      done();
      const [aid, cid, pid] = ref.split('_').map((x) => parseInt(x, 10));
      await sellFromStock(ctx, aid, cid, pid, price);
      return true;
    }

    default:
      return false;
  }
}

async function replyAccount(ctx: StoreContext, id: number, lead: string): Promise<void> {
  const a: AccountRow | null = await loadAccount(ctx.app, id);
  if (!a) {
    await ctx.reply(lead);
    return;
  }
  const card = buildAccountCard(a);
  await ctx.reply(lead + '\n\n' + card.html, { ...html, ...Markup.inlineKeyboard(card.rows) });
}

