import { Markup, type InlineButton } from '../../lib/markup';
import { formatPrice, escapeHtml, buildPagedKeyboard } from '../utils';
import type { StoreContext } from '../types';
import { readCatalog, listSuppliers, itemRef } from '../suppliers/store';
import { costToman, markupFor } from '../suppliers/pricing';
import { recomputeOption } from '../suppliers/recompute';
import { getSupplierDefaults } from '../supplierDefaults';
import type { StoreApp } from '../../apps';
import type { CatalogItem } from '../suppliers/types';
import { tehranDateTime } from '../../lib/time';
import { beginSupplierInput } from '../supplierInput';

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const html = { parse_mode: 'HTML' as const };
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));
const SRC_LIST_PREFIX = 'sup_srcl_';

interface ProductRow {
  id: number; name: string; price: number; pricing_mode: string; stock_mode: string; markup_percent: number | null;
  markup_fixed: number | null; cost_toman: number | null; is_available: number;
}
interface SourceView {
  id: number; supplier_id: number; remote_name: string; remote_variation_id: string; price_usd: number | null;
  listed: number; oos_until: string | null; priority: number; is_enabled: number; sup_name: string; sup_enabled: number;
}

async function loadProduct(app: StoreApp, id: number): Promise<ProductRow | null> {
  return (await app.raw.prepare(
    'SELECT id, name, price, pricing_mode, stock_mode, markup_percent, markup_fixed, cost_toman, is_available FROM customer_products WHERE id = ? AND is_active = 1',
  ).bind(id).first<ProductRow>()) ?? null;
}

async function loadSources(app: StoreApp, productId: number): Promise<SourceView[]> {
  return (await app.raw.prepare(`
    SELECT s.id, s.supplier_id, s.remote_name, s.remote_variation_id, s.price_usd, s.listed, s.oos_until, s.priority, s.is_enabled,
           sup.name AS sup_name, sup.is_enabled AS sup_enabled
    FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id
    WHERE s.customer_product_id = ? ORDER BY s.priority, s.id`).bind(productId).all<SourceView>()).results;
}

function statusOf(s: SourceView, now: string): string {
  if (!s.sup_enabled) return '⛔️ تأمین‌کننده غیرفعال است';
  if (!s.is_enabled) return '⛔️ غیرفعال (توسط شما)';
  if (!s.listed) return '⚠️ در لیست تأمین‌کننده نیست';
  if (s.oos_until && s.oos_until > now) return '⛔️ ناموجود';
  return '✅ فعال، موجود';
}

/** The sources screen of one option (SUPPLIER_PLAN.md §5.3). */
async function sourcesView(app: StoreApp, productId: number): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null> {
  const p = await loadProduct(app, productId);
  if (!p) return null;
  const sources = await loadSources(app, productId);
  const defaults = await getSupplierDefaults(app);
  const markup = markupFor(p, defaults);
  const now = tehranDateTime(app.apps.now());
  const own = p.markup_percent !== null || p.markup_fixed !== null;

  const cost = p.cost_toman;
  const lines = [
    '🔌 <b>منابع «' + escapeHtml(p.name) + '»</b>',
    'قیمت‌گذاری: ' + (p.pricing_mode === 'auto' ? 'خودکار' : 'ثابت') +
      (markup ? ' (سود ' + fa(markup.percent) + '٪ + ' + formatPrice(markup.fixed) + ' ت' + (own ? '' : ' پیش‌فرض') + ')' : ' (سود تعیین نشده)') +
      ' | موجودی: ' + (p.stock_mode === 'auto' ? 'خودکار' : 'دستی'),
    'قیمت فعلی: ' + formatPrice(p.price) + ' ت | قیمت خرید: ' + (cost === null ? '—' : formatPrice(cost) + ' ت'),
  ];
  if (sources.length === 0) lines.push('', 'هنوز منبعی ندارد (قیمت و موجودی دستی است).');
  sources.forEach((s, i) => {
    const price = s.price_usd === null ? '—' : '$' + s.price_usd.toFixed(2);
    const variation = s.remote_variation_id ? ' / ' + escapeHtml(s.remote_variation_id) : '';
    lines.push(fa(i + 1) + '. ' + escapeHtml(s.sup_name) + ' — ' + escapeHtml(s.remote_name) + variation + ' — ' + price + ' — ' + statusOf(s, now));
  });

  const rows: InlineButton[][] = sources.map((s) => [
    cb('⬆️', 'sup_srcup_' + productId + '_' + s.id),
    cb('⬇️', 'sup_srcdn_' + productId + '_' + s.id),
    cb(s.is_enabled ? '⏸' : '▶️', 'sup_srctog_' + productId + '_' + s.id),
    cb('🗑', 'sup_srcdel_' + productId + '_' + s.id),
  ]);
  rows.push([cb('➕ افزودن منبع', 'sup_srcadd_' + productId)]);
  rows.push([cb('💲 حالت قیمت: ' + (p.pricing_mode === 'auto' ? 'خودکار' : 'ثابت'), 'sup_pmode_' + productId),
    cb('💹 سود اختصاصی', 'sup_pmk_' + productId)]);
  rows.push([cb('📦 حالت موجودی: ' + (p.stock_mode === 'auto' ? 'خودکار' : 'دستی'), 'sup_smode_' + productId)]);
  rows.push([cb('🔙 بازگشت', 'sup_menu')]);
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows) };
}

async function showSources(ctx: StoreContext, productId: number, edit: boolean): Promise<void> {
  const v = await sourcesView(ctx.app, productId);
  if (!v) {
    await ctx.reply('❌ این محصول دیگر موجود نیست.');
    return;
  }
  if (edit) await ctx.editMessageText(v.text, { ...html, ...v.keyboard }).catch(() => {});
  else await ctx.reply(v.text, { ...html, ...v.keyboard });
}

/** Handles the sources screen's callbacks. Returns false when the callback is not one of them. */
export async function handleSourcesCallback(ctx: StoreContext, data: string): Promise<boolean> {
  const app = ctx.app;
  const m = (re: RegExp) => data.match(re);

  const open = m(/^sup_src_(\d+)$/);
  if (open) {
    await ctx.answerCallbackQuery();
    await showSources(ctx, parseInt(open[1], 10), false);
    return true;
  }

  const move = m(/^sup_src(up|dn)_(\d+)_(\d+)$/);
  if (move) {
    const pid = parseInt(move[2], 10);
    const sid = parseInt(move[3], 10);
    const list = await loadSources(app, pid);
    const i = list.findIndex((s) => s.id === sid);
    const j = move[1] === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < list.length) {
      // swap the two priorities in one batch
      await app.raw.batch([
        app.raw.prepare('UPDATE product_sources SET priority = ? WHERE id = ?').bind(list[j].priority, list[i].id),
        app.raw.prepare('UPDATE product_sources SET priority = ? WHERE id = ?').bind(list[i].priority, list[j].id),
      ]);
      await recomputeOption(app, pid);
    }
    await ctx.answerCallbackQuery();
    await showSources(ctx, pid, true);
    return true;
  }

  const tog = m(/^sup_srctog_(\d+)_(\d+)$/);
  if (tog) {
    const pid = parseInt(tog[1], 10);
    await app.raw.prepare('UPDATE product_sources SET is_enabled = 1 - is_enabled WHERE id = ? AND customer_product_id = ?')
      .bind(parseInt(tog[2], 10), pid).run();
    await recomputeOption(app, pid);
    await ctx.answerCallbackQuery();
    await showSources(ctx, pid, true);
    return true;
  }

  const del = m(/^sup_srcdel_(\d+)_(\d+)$/);
  if (del) {
    const pid = parseInt(del[1], 10);
    const count = (await loadSources(app, pid)).length;
    await ctx.answerCallbackQuery();
    if (count === 1) {
      await ctx.reply(
        '⚠️ این آخرین منبع است؛ محصول به حالت دستی برمی‌گردد. مطمئنید؟',
        Markup.inlineKeyboard([[cb('✅ بله، حذف کن', 'sup_srcdelok_' + pid + '_' + del[2])], [cb('🔙 بازگشت', 'sup_src_' + pid)]]),
      );
      return true;
    }
    await deleteSource(app, pid, parseInt(del[2], 10), false);
    await showSources(ctx, pid, true);
    return true;
  }

  const delOk = m(/^sup_srcdelok_(\d+)_(\d+)$/);
  if (delOk) {
    const pid = parseInt(delOk[1], 10);
    await ctx.answerCallbackQuery();
    await deleteSource(app, pid, parseInt(delOk[2], 10), true);
    await showSources(ctx, pid, false);
    return true;
  }

  const pmode = m(/^sup_pmode_(\d+)$/);
  if (pmode) {
    const pid = parseInt(pmode[1], 10);
    await app.raw.prepare("UPDATE customer_products SET pricing_mode = CASE WHEN pricing_mode = 'auto' THEN 'manual' ELSE 'auto' END WHERE id = ?")
      .bind(pid).run();
    await recomputeOption(app, pid);
    await ctx.answerCallbackQuery();
    await showSources(ctx, pid, true);
    return true;
  }

  const smode = m(/^sup_smode_(\d+)$/);
  if (smode) {
    const pid = parseInt(smode[1], 10);
    await app.raw.prepare("UPDATE customer_products SET stock_mode = CASE WHEN stock_mode = 'auto' THEN 'manual' ELSE 'auto' END WHERE id = ?")
      .bind(pid).run();
    await recomputeOption(app, pid);
    await ctx.answerCallbackQuery();
    await showSources(ctx, pid, true);
    return true;
  }

  const pmk = m(/^sup_pmk_(\d+)$/);
  if (pmk) {
    await ctx.answerCallbackQuery();
    await ctx.reply('💹 سود اختصاصی این محصول:', Markup.inlineKeyboard([
      [cb('٪ درصد', 'sup_pmkp_' + pmk[1]), cb('＋ مبلغ ثابت', 'sup_pmkf_' + pmk[1])],
      [cb('↩️ استفاده از پیش‌فرض', 'sup_pmkr_' + pmk[1])],
      [cb('🔙 بازگشت', 'sup_src_' + pmk[1])],
    ]));
    return true;
  }
  const pmkr = m(/^sup_pmkr_(\d+)$/);
  if (pmkr) {
    const pid = parseInt(pmkr[1], 10);
    await app.raw.prepare('UPDATE customer_products SET markup_percent = NULL, markup_fixed = NULL WHERE id = ?').bind(pid).run();
    await recomputeOption(app, pid);
    await ctx.answerCallbackQuery();
    await showSources(ctx, pid, false);
    return true;
  }
  const pmkInput = m(/^sup_pmk([pf])_(\d+)$/);
  if (pmkInput) {
    const kind = pmkInput[1] === 'p' ? 'src_percent' : 'src_fixed';
    await beginSupplierInput(ctx, kind, pmkInput[2]);
    await ctx.answerCallbackQuery();
    await ctx.reply(kind === 'src_percent' ? '٪ درصد سود این محصول را وارد کنید (۰ تا ۵۰۰):' : '＋ مبلغ ثابت سود این محصول را به تومان وارد کنید (۰ مجاز است):');
    return true;
  }

  const add = m(/^sup_srcadd_(\d+)$/);
  if (add) {
    const pid = parseInt(add[1], 10);
    const suppliers = await listSuppliers(app);
    await ctx.answerCallbackQuery();
    await ctx.reply('➕ منبع را از کدام تأمین‌کننده می‌خواهید؟', Markup.inlineKeyboard([
      ...suppliers.map((s) => [cb(s.name, 'sup_srcs_' + pid + '_' + s.id)]),
      [cb('🔙 بازگشت', 'sup_src_' + pid)],
    ]));
    return true;
  }
  const pickSup = m(/^sup_srcs_(\d+)_(\d+)$/);
  if (pickSup) {
    await ctx.answerCallbackQuery();
    await showCatalogPage(ctx, pickSup[1], pickSup[2], 0, false);
    return true;
  }
  const page = m(/^sup_srcl_(\d+)_(\d+)_(\d+)$/);
  if (page) {
    await ctx.answerCallbackQuery();
    await showCatalogPage(ctx, page[1], page[2], parseInt(page[3], 10), true);
    return true;
  }
  const pickItem = m(/^sup_srcn_(\d+)_(\d+)_([0-9a-f]{12})$/);
  if (pickItem) {
    await ctx.answerCallbackQuery();
    await addSource(ctx, parseInt(pickItem[1], 10), parseInt(pickItem[2], 10), pickItem[3]);
    return true;
  }
  return false;
}

async function deleteSource(app: StoreApp, productId: number, sourceId: number, last: boolean): Promise<void> {
  const stmts = [app.raw.prepare('DELETE FROM product_sources WHERE id = ? AND customer_product_id = ?').bind(sourceId, productId)];
  if (last) {
    // no source left: back to an ordinary product, prices and stock by hand (SUPPLIER_PLAN.md §5.3)
    stmts.push(app.raw.prepare("UPDATE customer_products SET pricing_mode = 'manual', stock_mode = 'manual', cost_toman = NULL WHERE id = ?").bind(productId));
  }
  await app.raw.batch(stmts);
  await recomputeOption(app, productId);
}

async function showCatalogPage(ctx: StoreContext, pidRaw: string, sidRaw: string, page: number, edit: boolean): Promise<void> {
  const pid = parseInt(pidRaw, 10);
  const sid = parseInt(sidRaw, 10);
  const cached = await readCatalog(ctx.app, sid);
  const items = cached ? cached.catalog.items : [];
  const indexed = await Promise.all(items.map(async (it) => ({ it, ref: await itemRef(it.remoteProductId, it.remoteVariationId) })));
  const keyboard = buildPagedKeyboard(indexed, page, ({ it, ref }) => {
    const variation = it.remoteVariationId ? ' / ' + it.remoteVariationId : '';
    const price = it.priceUsd === null ? '—' : '$' + it.priceUsd.toFixed(2);
    return cb((it.name + variation).slice(0, 40) + ' — ' + price, 'sup_srcn_' + pid + '_' + sid + '_' + ref);
  }, SRC_LIST_PREFIX + pid + '_' + sid + '_', cb('🔙 بازگشت', 'sup_srcadd_' + pid));
  const text = items.length ? '➕ یک گزینه‌ی کاتالوگ را انتخاب کنید:' : 'کاتالوگی از این تأمین‌کننده نداریم. ابتدا همگام‌سازی کنید.';
  if (edit) await ctx.editMessageText(text, keyboard).catch(() => {});
  else await ctx.reply(text, keyboard);
}

async function addSource(ctx: StoreContext, pid: number, sid: number, ref: string): Promise<void> {
  const app = ctx.app;
  const cached = await readCatalog(app, sid);
  // the item is found by its remote ids in the CURRENT catalog; a sync may have re-sorted or changed it since the list
  let item: CatalogItem | undefined;
  for (const it of cached?.catalog.items ?? []) {
    if ((await itemRef(it.remoteProductId, it.remoteVariationId)) === ref) {
      item = it;
      break;
    }
  }
  if (!item || !(await loadProduct(app, pid))) {
    await ctx.reply('❌ این گزینه دیگر در کاتالوگ نیست.');
    return;
  }
  const before = (await loadSources(app, pid)).length;
  const stmts = [app.raw.prepare(`
    INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name,
      attributes_json, price_usd, listed, priority, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(priority), 0) + 1 FROM product_sources WHERE customer_product_id = ?), 1)
    ON CONFLICT DO NOTHING`).bind(pid, sid, item.remoteProductId, item.remoteVariationId, item.name,
    JSON.stringify(item.attributes), item.priceUsd, pid)];
  if (before === 0) {
    // the first source makes the option supplier-priced and supplier-stocked
    stmts.push(app.raw.prepare("UPDATE customer_products SET pricing_mode = 'auto', stock_mode = 'auto' WHERE id = ?").bind(pid));
  }
  const [inserted] = await app.raw.batch(stmts);
  if (inserted.meta.changes === 0) {
    await ctx.reply('ℹ️ این گزینه از قبل منبع این محصول است.');
  }
  await recomputeOption(app, pid);
  await showSources(ctx, pid, false);
}

/** The typed percent or fixed markup of one option. Returns false when the kind is not one of them. */
export async function handleSourcesText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  if (kind !== 'src_percent' && kind !== 'src_fixed') return false;
  const pid = parseInt(ref, 10);
  const n = Number(text.trim().replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 0x30)).replace(/[\s,،٬]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    await ctx.reply('❌ عدد معتبر وارد کنید (۰ مجاز است).');
    return true;
  }
  if (kind === 'src_percent') {
    if (n > 500) {
      await ctx.reply('❌ درصد باید بین ۰ تا ۵۰۰ باشد.');
      return true;
    }
    await ctx.app.raw.prepare('UPDATE customer_products SET markup_percent = ? WHERE id = ?').bind(n, pid).run();
  } else {
    if (!Number.isInteger(n) || n > 100_000_000) {
      await ctx.reply('❌ مبلغ باید عدد صحیح تا ۱۰۰٬۰۰۰٬۰۰۰ ت باشد.');
      return true;
    }
    await ctx.app.raw.prepare('UPDATE customer_products SET markup_fixed = ? WHERE id = ?').bind(n, pid).run();
  }
  ctx.session.awaitingSupplierInput = null;
  await recomputeOption(ctx.app, pid);
  await showSources(ctx, pid, false);
  return true;
}

