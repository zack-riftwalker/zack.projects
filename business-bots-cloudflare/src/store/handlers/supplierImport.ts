import { Markup, type InlineButton } from '../../lib/markup';
import { tehranDateTime } from '../../lib/time';
import { escapeHtml, formatPrice } from '../utils';
import type { StoreContext } from '../types';
import type { Stmt } from '../../lib/budget';
import { readCatalog, getSupplier } from '../suppliers/store';
import { costToman, finalPrice, markupFor } from '../suppliers/pricing';
import { getSupplierDefaults } from '../supplierDefaults';
import {
  optionsFromItems, unknownAttributes, type ImportDraft, type ImportOption,
} from '../suppliers/importDraft';
import { parseDays } from './customerProducts';

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const html = { parse_mode: 'HTML' as const };
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));
const CANCEL = cb('❌ انصراف', 'sup_impx');

/** The product's existing sources on this supplier: variation → the product name it feeds. */
async function existingVariations(ctx: StoreContext, supplierId: number, remoteProductId: string): Promise<Map<string, string>> {
  const rows = (await ctx.app.raw.prepare(`
    SELECT s.remote_variation_id, p.name FROM product_sources s JOIN customer_products p ON p.id = s.customer_product_id
    WHERE s.supplier_id = ? AND s.remote_product_id = ?`).bind(supplierId, remoteProductId)
    .all<{ remote_variation_id: string; name: string }>()).results;
  return new Map(rows.map((r) => [r.remote_variation_id, r.name]));
}

/** Opens the preview of importing one catalog product. */
export async function startImport(ctx: StoreContext, supplierId: number, remoteProductId: string): Promise<boolean> {
  const cached = await readCatalog(ctx.app, supplierId);
  const supplier = await getSupplier(ctx.app, supplierId);
  if (!cached || !supplier) return false;
  const items = cached.catalog.items.filter((it) => it.remoteProductId === remoteProductId);
  if (items.length === 0) return false;
  const draft: ImportDraft = {
    supplierId, supplierName: supplier.name, remoteProductId, remoteName: items[0].name, groupName: items[0].name,
    usdToman: cached.catalog.usdToman, markupPercent: null, markupFixed: null, terms: null, editing: null,
    options: optionsFromItems(items, await existingVariations(ctx, supplierId, remoteProductId)),
  };
  ctx.session.supplierImport = draft;
  await showPreview(ctx, false);
  return true;
}

function previewParts(d: ImportDraft, defaults: { markupPercent: number | null; markupFixed: number | null }) {
  const own = d.markupPercent !== null || d.markupFixed !== null;
  const markup = markupFor({ markup_percent: d.markupPercent, markup_fixed: d.markupFixed }, defaults);
  const markupText = !markup ? 'تعیین نشده'
    : fa(markup.percent) + '٪ + ' + formatPrice(markup.fixed) + ' ت' + (own ? '' : ' (پیش‌فرض)');
  const lines: string[] = [
    '📥 <b>وارد کردن از «' + escapeHtml(d.supplierName) + '»</b>',
    '📦 نام گروه: ' + escapeHtml(d.groupName),
    '💹 سود: ' + markupText,
  ];
  for (const o of d.options) {
    const days = (n: number | null, unit: string) => (n === null ? '—' : fa(n) + ' ' + unit);
    const cost = o.priceUsd === null ? null : costToman(o.priceUsd, d.usdToman);
    const sale = cost !== null && markup ? formatPrice(finalPrice(cost, markup)) + ' ت' : '—';
    const buy = o.priceUsd === null ? '—' : '$' + o.priceUsd.toFixed(2) + ' ≈ ' + formatPrice(cost!) + ' ت';
    lines.push((o.selected ? '☑️' : '⬜️') + ' ' + escapeHtml(o.label) + ' — مدت ' + days(o.durationDays, 'روز') +
      '، گارانتی ' + days(o.warrantyDays, 'روز') + ' — خرید ' + buy + ' → فروش ' + sale);
    if (o.existingName) lines.push('   🔗 قبلاً وارد شده («' + escapeHtml(o.existingName) + '»)');
  }
  const unknown = [...new Set(d.options.flatMap((o) => unknownAttributes(o.attributes)))];
  if (unknown.length) lines.push('ℹ️ ویژگی‌های ناشناخته: ' + escapeHtml(unknown.join(', ')));
  lines.push('📜 شرایط: ' + (d.terms ? 'دارد' : 'ندارد'));
  return lines;
}

async function previewView(ctx: StoreContext, d: ImportDraft) {
  const defaults = await getSupplierDefaults(ctx.app);
  const rows: InlineButton[][] = d.options.map((o, i) => [cb((o.selected ? '☑️ ' : '⬜️ ') + o.label, 'sup_impv_' + i)]);
  rows.push([cb('✏️ نام گروه', 'sup_impn'), cb('🏷 گزینه‌ها', 'sup_impo')]);
  rows.push([cb('💹 سود این محصول', 'sup_impm'), cb('📜 شرایط', 'sup_impt')]);
  rows.push([cb('✅ ساخت محصول', 'sup_impok'), CANCEL]);
  return { text: previewParts(d, defaults).join('\n'), keyboard: Markup.inlineKeyboard(rows) };
}

async function showPreview(ctx: StoreContext, edit: boolean) {
  const d = ctx.session.supplierImport!;
  const v = await previewView(ctx, d);
  if (edit) await ctx.editMessageText(v.text, { ...html, ...v.keyboard }).catch(() => {});
  else await ctx.reply(v.text, { ...html, ...v.keyboard });
}

/** Creates the group and one product per selected option, each with its supplier source (SUPPLIER_PLAN.md §5.1). */
async function createFromDraft(ctx: StoreContext): Promise<void> {
  const app = ctx.app;
  const d = ctx.session.supplierImport!;
  const selected = d.options.filter((o: ImportOption) => o.selected);
  if (selected.length === 0) {
    await ctx.answerCallbackQuery({ text: 'حداقل یک گزینه را انتخاب کنید.', show_alert: true });
    return;
  }
  const markup = markupFor({ markup_percent: d.markupPercent, markup_fixed: d.markupFixed }, await getSupplierDefaults(app));
  if (!markup) {
    await ctx.answerCallbackQuery({ text: '⚠️ اول سود را تعیین کنید (پیش‌فرض یا همین محصول).', show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();

  const groupId = await app.db.createGroup(d.groupName);
  const now = tehranDateTime(app.apps.now());
  const termsText = d.terms?.text ?? null;
  const termsEntities = d.terms?.entities?.length ? JSON.stringify(d.terms.entities) : null;
  const stmts: Stmt[] = [];
  selected.forEach((o, i) => {
    const cost = o.priceUsd === null ? null : costToman(o.priceUsd, d.usdToman);
    const price = cost === null ? 0 : finalPrice(cost, markup);
    stmts.push(app.raw.prepare(`
      INSERT INTO customer_products (name, price, terms_text, terms_entities, duration_days, warranty_days, is_active, is_available,
        group_id, option_label, sort_order, pricing_mode, markup_percent, markup_fixed, cost_toman, stock_mode, price_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'auto', ?, ?, ?, 'auto', ?)`).bind(
      d.groupName + ' — ' + o.label, price, termsText, termsEntities, o.durationDays, o.warrantyDays,
      cost === null ? 0 : 1, groupId, o.label, i, d.markupPercent, d.markupFixed, cost, now,
    ));
    stmts.push(app.raw.prepare(`
      INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name,
        attributes_json, price_usd, listed, priority, is_enabled)
      VALUES (last_insert_rowid(), ?, ?, ?, ?, ?, ?, 1, 1, 1)`).bind(
      d.supplierId, d.remoteProductId, o.remoteVariationId, d.remoteName, JSON.stringify(o.attributes), o.priceUsd,
    ));
  });
  const results = await app.raw.batch(stmts);
  const firstId = results[0].meta.last_row_id;
  ctx.session.supplierImport = null;
  await ctx.reply(
    '✅ «' + escapeHtml(d.groupName) + '» با ' + fa(selected.length) + ' گزینه ساخته شد و در لیست محصولات نمایش داده می‌شود.',
    { ...html, ...Markup.inlineKeyboard([[cb('🔌 منابع و قیمت', 'sup_src_' + firstId)]]) },
  );
}

/** Handles the preview's buttons. Returns false when the callback is not an import one. */
export async function handleImportCallback(ctx: StoreContext, data: string): Promise<boolean> {
  const d = ctx.session.supplierImport;
  if (!d && data !== 'sup_impx') return false;
  if (!d) {
    await ctx.answerCallbackQuery('⌛️ این فرایند تمام شده است.');
    return true;
  }
  const idx = (m: RegExpMatchArray | null) => (m ? parseInt(m[1], 10) : -1);

  if (data === 'sup_impx') {
    ctx.session.supplierImport = null;
    ctx.session.awaitingSupplierInput = null;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('❌ انصراف شد.').catch(() => {});
    return true;
  }
  if (data === 'sup_impb') {
    await ctx.answerCallbackQuery();
    await showPreview(ctx, true);
    return true;
  }
  const toggle = idx(data.match(/^sup_impv_(\d+)$/));
  if (toggle >= 0 && d.options[toggle]) {
    d.options[toggle].selected = !d.options[toggle].selected;
    await ctx.answerCallbackQuery();
    await showPreview(ctx, true);
    return true;
  }
  if (data === 'sup_impn') return askInput(ctx, 'imp_group', '', '✏️ نام گروه را وارد کنید (۱ تا ۶۰ کاراکتر):');
  if (data === 'sup_impt') return askInput(ctx, 'imp_terms', '', '📜 متن شرایط را وارد کنید (همه‌ی گزینه‌ها):');
  if (data === 'sup_impmp') return askInput(ctx, 'imp_percent', '', '٪ درصد سود این محصول را وارد کنید (۰ تا ۵۰۰):');
  if (data === 'sup_impmf') return askInput(ctx, 'imp_fixed', '', '＋ مبلغ ثابت سود این محصول را به تومان وارد کنید (۰ مجاز است):');
  if (data === 'sup_impm') {
    await ctx.answerCallbackQuery();
    await ctx.reply('💹 سود این محصول:', Markup.inlineKeyboard([
      [cb('٪ درصد', 'sup_impmp'), cb('＋ مبلغ ثابت', 'sup_impmf')],
      [cb('↩️ استفاده از پیش‌فرض', 'sup_impmr')],
      [cb('🔙 بازگشت', 'sup_impb')],
    ]));
    return true;
  }
  if (data === 'sup_impmr') {
    d.markupPercent = null;
    d.markupFixed = null;
    await ctx.answerCallbackQuery();
    await showPreview(ctx, true);
    return true;
  }
  if (data === 'sup_impo') {
    await ctx.answerCallbackQuery();
    await ctx.reply('🏷 کدام گزینه؟', Markup.inlineKeyboard([
      ...d.options.map((o, i) => [cb(o.label, 'sup_impo_' + i)]),
      [cb('🔙 بازگشت', 'sup_impb')],
    ]));
    return true;
  }
  const pick = data.match(/^sup_impo_(\d+)$/);
  if (pick && d.options[parseInt(pick[1], 10)]) {
    const i = parseInt(pick[1], 10);
    await ctx.answerCallbackQuery();
    await ctx.reply('🏷 «' + escapeHtml(d.options[i].label) + '»: کدام را تغییر می‌دهید؟', Markup.inlineKeyboard([
      [cb('🏷 عنوان', 'sup_impf_' + i + '_l'), cb('⏱ مدت (روز)', 'sup_impf_' + i + '_d')],
      [cb('🛡 گارانتی (روز)', 'sup_impf_' + i + '_w')],
      [cb('🔙 بازگشت', 'sup_impb')],
    ]));
    return true;
  }
  const field = data.match(/^sup_impf_(\d+)_([ldw])$/);
  if (field && d.options[parseInt(field[1], 10)]) {
    const i = parseInt(field[1], 10);
    const kind = field[2] === 'l' ? 'imp_label' : field[2] === 'd' ? 'imp_duration' : 'imp_warranty';
    const prompt = field[2] === 'l' ? '🏷 عنوان گزینه را وارد کنید (۱ تا ۴۰ کاراکتر):' : '⏱ تعداد روز را وارد کنید:';
    return askInput(ctx, kind, String(i), prompt);
  }
  if (data === 'sup_impok') {
    await createFromDraft(ctx);
    return true;
  }
  return false;
}

async function askInput(ctx: StoreContext, kind: NonNullable<StoreContext['session']['awaitingSupplierInput']>['kind'], ref: string, prompt: string): Promise<boolean> {
  ctx.session.awaitingSupplierInput = { kind, ref, at: ctx.app.apps.now().getTime() };
  await ctx.answerCallbackQuery();
  await ctx.reply(prompt, Markup.inlineKeyboard([[CANCEL]]));
  return true;
}

/** Typed values of the import. Returns false when the kind is not an import one. */
export async function handleImportText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  if (!kind.startsWith('imp_')) return false;
  const d = ctx.session.supplierImport;
  if (!d) {
    await ctx.reply('⌛️ این فرایند تمام شده است.');
    return true;
  }
  const value = text.trim();
  const fail = async (msg: string) => { await ctx.reply(msg); return true; };
  const opt = d.options[parseInt(ref, 10)];

  if (kind === 'imp_group') {
    if (value.length < 1 || value.length > 60) return fail('⚠️ نام گروه باید بین ۱ تا ۶۰ کاراکتر باشد.');
    d.groupName = value;
  } else if (kind === 'imp_label') {
    if (!opt || value.length < 1 || value.length > 40) return fail('⚠️ عنوان باید بین ۱ تا ۴۰ کاراکتر باشد.');
    opt.label = value;
  } else if (kind === 'imp_duration' || kind === 'imp_warranty') {
    const days = parseDays(text);
    if (!opt || isNaN(days)) return fail('⚠️ لطفاً تعداد روز را به صورت یک عدد صحیح مثبت وارد کنید.');
    if (kind === 'imp_duration') opt.durationDays = days;
    else opt.warrantyDays = days;
  } else if (kind === 'imp_percent' || kind === 'imp_fixed') {
    const n = Number(value.replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 0x30)).replace(/[\s,،٬]/g, ''));
    if (!Number.isFinite(n) || n < 0) return fail('❌ عدد معتبر وارد کنید (۰ مجاز است).');
    if (kind === 'imp_percent') {
      if (n > 500) return fail('❌ درصد باید بین ۰ تا ۵۰۰ باشد.');
      d.markupPercent = n;
    } else {
      if (!Number.isInteger(n) || n > 100_000_000) return fail('❌ مبلغ باید عدد صحیح تا ۱۰۰٬۰۰۰٬۰۰۰ ت باشد.');
      d.markupFixed = n;
    }
  } else if (kind === 'imp_terms') {
    if (!value) return fail('⚠️ متن شرایط خالی است.');
    // not trimmed: entity offsets are computed against the exact text
    d.terms = { text: text, entities: ctx.message?.entities ?? null };
  }
  ctx.session.awaitingSupplierInput = null;
  const v = await previewView(ctx, d);
  await ctx.reply('✅ ذخیره شد.\n\n' + v.text, { ...html, ...v.keyboard });
  return true;
}

