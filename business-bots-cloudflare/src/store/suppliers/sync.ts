import type { StoreApp } from '../../apps';
import { formatPrice, escapeHtml } from '../utils';
import { tehranDateTime } from '../../lib/time';
import { getAppState, setAppState } from '../../lib/appstate';
import { sendToAdmins } from '../customerRef';
import { applyDiscount } from '../handlers/discountCodes';
import { adapterFor } from './index';
import { catalogHash, readCatalog, sortItems, writeCatalog } from './store';
import { loadRecomputeEnv, recomputeOption, type OptionChange } from './recompute';
import type { CatalogItem, SupplierRow } from './types';

/** Statements per apply tick (SUPPLIER_PLAN.md §6.2). */
const APPLY_STATEMENTS_PER_TICK = 20;
/** Keep this much budget for the other cron jobs before each unit of apply work. */
const APPLY_RESERVE = 12;
const REPORT_MAX = 3500;
const SPEC_KEYS = ['subscription-duration', 'duration', 'warranty'];

const itemKey = (productId: string, variationId: string) => productId + '|' + variationId;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// ─── §6.1 fetch ──────────────────────────────────────────────────────────────

/** One fetch of a supplier's catalog: stores it when it changed, and raises the alerts of §6.1. */
export async function syncSupplier(app: StoreApp, s: SupplierRow): Promise<void> {
  const now = app.apps.now();
  const nowStr = tehranDateTime(now);
  const r = await adapterFor(s.kind, app.apps).fetchCatalog(s);

  if (!r.ok) {
    await app.raw.prepare('UPDATE suppliers SET last_sync_at = ?, last_sync_error = ? WHERE id = ?')
      .bind(nowStr, cut(r.detail, 300), s.id).run();
    if (s.sync_alert_sent) return;
    if (r.kind === 'auth') {
      await alert(app, s, '❌ کلید API «' + escapeHtml(s.name) + '» نامعتبر است. همگام‌سازی و سفارش خودکار متوقف است تا کلید را درست کنید.');
    } else if (!s.last_sync_ok_at || s.last_sync_ok_at < tehranDateTime(new Date(now.getTime() - 30 * 60_000))) {
      await alert(app, s, '⚠️ همگام‌سازی «' + escapeHtml(s.name) + '» ناموفق بود: ' + escapeHtml(cut(r.detail, 300)));
    }
    return;
  }

  const items = sortItems(r.value.items);
  const hash = await catalogHash(items, r.value.usdToman);
  const stored = await app.raw.prepare('SELECT items_hash FROM supplier_catalogs WHERE supplier_id = ?')
    .bind(s.id).first<{ items_hash: string }>();
  if (stored?.items_hash !== hash) {
    await writeCatalog(app, s.id, { ...r.value, items });
    await setAppState(app.raw, 'sync_cursor_' + s.id, '0');
  }

  await app.raw.prepare(
    'UPDATE suppliers SET last_sync_at = ?, last_sync_ok_at = ?, last_sync_error = NULL, sync_alert_sent = 0 WHERE id = ?',
  ).bind(nowStr, nowStr, s.id).run();
  if (s.sync_alert_sent) await sendToAdmins(app, '✅ اتصال «' + escapeHtml(s.name) + '» برقرار شد.');
}

async function alert(app: StoreApp, s: SupplierRow, html: string): Promise<void> {
  await sendToAdmins(app, html);
  await app.raw.prepare('UPDATE suppliers SET sync_alert_sent = 1 WHERE id = ?').bind(s.id).run();
}

// ─── §6.2 apply ──────────────────────────────────────────────────────────────

interface SourceApply {
  id: number; customer_product_id: number; remote_product_id: string; remote_variation_id: string;
  price_usd: number | null; listed: number; attributes_json: string; supplier_name: string; product_name: string;
}

/**
 * Applies the stored catalog to this supplier's sources, a few statements per tick, and reports once per round.
 * Phase 1 writes the sources that differ; phase 2 recomputes every option of the supplier (a new rate changes
 * prices even when no source row changed). A cursor in app_state keeps phase 2 going across ticks. Idempotent:
 * an interrupted round just continues.
 */
export async function applyCatalog(app: StoreApp, supplierId: number): Promise<void> {
  const cached = await readCatalog(app, supplierId);
  const meta = await app.raw.prepare('SELECT items_hash, applied_hash FROM supplier_catalogs WHERE supplier_id = ?')
    .bind(supplierId).first<{ items_hash: string; applied_hash: string | null }>();
  if (!cached || !meta || meta.applied_hash === meta.items_hash) return;

  const byKey = new Map(cached.catalog.items.map((it) => [itemKey(it.remoteProductId, it.remoteVariationId), it]));
  const sources = (await app.raw.prepare(`
    SELECT s.id, s.customer_product_id, s.remote_product_id, s.remote_variation_id, s.price_usd, s.listed, s.attributes_json,
           sup.name AS supplier_name, p.name AS product_name
    FROM product_sources s
    JOIN suppliers sup ON sup.id = s.supplier_id
    JOIN customer_products p ON p.id = s.customer_product_id
    WHERE s.supplier_id = ? ORDER BY s.id`).bind(supplierId).all<SourceApply>()).results;

  type Change = { src: SourceApply; listed: number; price: number | null; attrs: string };
  const changes: Change[] = [];
  for (const src of sources) {
    const item = byKey.get(itemKey(src.remote_product_id, src.remote_variation_id));
    const listed = item ? 1 : 0;
    const price = item ? item.priceUsd : src.price_usd;
    const attrs = item ? JSON.stringify(item.attributes) : src.attributes_json;
    if (listed !== src.listed || price !== src.price_usd || attrs !== src.attributes_json) {
      changes.push({ src, listed, price, attrs });
    }
  }

  const report: string[] = JSON.parse((await getAppState(app.raw, 'sync_report_' + supplierId)) ?? '[]');
  let statements = 0;

  // phase 1: the sources that differ
  let next = 0;
  while (next < changes.length && statements < APPLY_STATEMENTS_PER_TICK && app.apps.budget.remaining() >= APPLY_RESERVE) {
    const c = changes[next++];
    await app.raw.prepare('UPDATE product_sources SET listed = ?, price_usd = ?, attributes_json = ? WHERE id = ?')
      .bind(c.listed, c.price, c.attrs, c.src.id).run();
    statements++;
    const name = escapeHtml(c.src.product_name);
    if (c.src.listed === 1 && c.listed === 0) report.push('• ' + name + ': از لیست «' + escapeHtml(c.src.supplier_name) + '» حذف شد');
    for (const line of specLines(c.src.attributes_json, c.attrs)) report.push('• ' + name + ': ' + line);
  }
  const phase1Done = next >= changes.length;

  // phase 2: every option of the supplier, from its cursor
  const optionIds = [...new Set(sources.map((x) => x.customer_product_id))];
  let cursor = Number((await getAppState(app.raw, 'sync_cursor_' + supplierId)) ?? '0');
  if (phase1Done) {
    const env = await loadRecomputeEnv(app);
    while (cursor < optionIds.length && statements < APPLY_STATEMENTS_PER_TICK && app.apps.budget.remaining() >= APPLY_RESERVE) {
      // count what the option really cost (recompute plus the report's waitlist and discount-code reads)
      const usedBefore = app.apps.budget.used;
      const change = await recomputeOption(app, optionIds[cursor++], env);
      if (change) report.push(...(await changeLines(app, change)));
      statements += app.apps.budget.used - usedBefore;
    }
  }

  if (phase1Done && cursor >= optionIds.length) {
    report.push(...(await newVariationLines(app, supplierId, cached.catalog.items, sources)));
    await app.raw.prepare('UPDATE supplier_catalogs SET applied_hash = items_hash WHERE supplier_id = ?').bind(supplierId).run();
    await setAppState(app.raw, 'sync_cursor_' + supplierId, '0');
    await flushReport(app, supplierId, report);
  } else {
    await setAppState(app.raw, 'sync_cursor_' + supplierId, String(cursor));
    await setAppState(app.raw, 'sync_report_' + supplierId, JSON.stringify(report));
  }
}

/** «warranty 7-days ← 14-days» for each spec attribute that changed (the product itself is not touched). */
function specLines(oldJson: string, newJson: string): string[] {
  let before: Record<string, string> = {};
  let after: Record<string, string> = {};
  try { before = JSON.parse(oldJson); after = JSON.parse(newJson); } catch { return []; }
  return SPEC_KEYS.filter((k) => before[k] !== undefined && after[k] !== undefined && before[k] !== after[k])
    .map((k) => 'مشخصات در تأمین‌کننده عوض شد: ' + escapeHtml(k) + ' ' + escapeHtml(before[k]) + ' ← ' + escapeHtml(after[k]) + ' (روی محصول شما تغییری داده نشد)');
}

async function changeLines(app: StoreApp, c: OptionChange): Promise<string[]> {
  const lines: string[] = [];
  const name = escapeHtml(c.name);
  if (c.priceChanged) lines.push('• ' + name + ': قیمت ' + formatPrice(c.oldPrice) + ' ← ' + formatPrice(c.newPrice) + ' تومان');
  if (c.availChanged) {
    lines.push(c.newAvail === 0 ? '• ' + name + ': ناموجود شد' : '• ' + name + ': دوباره موجود شد');
    const waiting = c.newAvail === 1 ? await app.db.countWaitlist(c.productId) : 0;
    if (waiting > 0) lines.push('📣 ' + formatPrice(waiting) + ' نفر در لیست انتظارند');
  }
  if (c.noMarkup) lines.push('• ' + name + ': ⚠️ سود تعیین نشده');
  if (c.pricingMode === 'manual' && c.cost !== null && c.newPrice < c.cost) {
    lines.push('⚠️ ' + name + ': قیمت فروش (ثابت) ' + formatPrice(c.newPrice) + ' از قیمت خرید ' + formatPrice(c.cost) + ' کمتر شده');
  }
  if (c.cost !== null) {
    const codes = await app.db.getActiveCodesForProduct(c.productId, c.groupId);
    for (const code of codes.filter((x) => x.discount_type === 'fixed')) {
      if (applyDiscount(c.newPrice, code) < c.cost) {
        lines.push('⚠️ کد تخفیف ' + escapeHtml(code.code) + ' روی «' + name + '» حالا قیمت را زیر قیمت خرید می‌برد');
      }
    }
  }
  return lines;
}

/** Each (remote product, variation) of an already-imported product is reported once, the first time it appears. */
async function newVariationLines(app: StoreApp, supplierId: number, items: CatalogItem[], sources: SourceApply[]): Promise<string[]> {
  const known = new Set(sources.map((s) => s.remote_product_id));
  const used = new Set(sources.map((s) => itemKey(s.remote_product_id, s.remote_variation_id)));
  const seen: string[] = JSON.parse((await getAppState(app.raw, 'sync_seen_new_' + supplierId)) ?? '[]');
  const lines: string[] = [];
  for (const it of items) {
    const key = itemKey(it.remoteProductId, it.remoteVariationId);
    if (!known.has(it.remoteProductId) || used.has(key) || seen.includes(key)) continue;
    seen.push(key);
    const attrs = Object.entries(it.attributes).map(([k, v]) => k + ': ' + v).join(' | ');
    lines.push('• «' + escapeHtml(it.name) + '» گزینه‌ی جدید دارد: ' + escapeHtml(attrs));
  }
  if (lines.length) await setAppState(app.raw, 'sync_seen_new_' + supplierId, JSON.stringify(seen));
  return lines;
}

const CODE_WARNING_PREFIX = '⚠️ کد تخفیف ';
const CODE_WARNING_MAX = 5;

/** Keeps the first 5 discount-code warnings and counts the rest in one line (SUPPLIER_PLAN.md §6.2). */
export function capCodeWarnings(lines: string[]): string[] {
  let seen = 0;
  let dropped = 0;
  const kept = lines.filter((l) => {
    if (!l.startsWith(CODE_WARNING_PREFIX)) return true;
    seen++;
    if (seen <= CODE_WARNING_MAX) return true;
    dropped++;
    return false;
  });
  if (dropped > 0) kept.push('… و ' + formatPrice(dropped) + ' هشدار کد تخفیف دیگر');
  return kept;
}

/** One message per finished round, cut to 3,500 characters (SUPPLIER_PLAN.md §6.2). */
async function flushReport(app: StoreApp, supplierId: number, allLines: string[]): Promise<void> {
  await setAppState(app.raw, 'sync_report_' + supplierId, '[]');
  const lines = capCodeWarnings(allLines);
  if (lines.length === 0) return;
  let text = '🔄 <b>گزارش همگام‌سازی</b>\n';
  let shown = 0;
  for (const line of lines) {
    if ((text + '\n' + line).length > REPORT_MAX) break;
    text += '\n' + line;
    shown++;
  }
  if (shown < lines.length) text += '\n… و ' + formatPrice(lines.length - shown) + ' مورد دیگر';
  await sendToAdmins(app, text);
}

// ─── Cron ────────────────────────────────────────────────────────────────────

/**
 * Called every minute: fetches due suppliers (at most 3, while the budget allows), then applies one catalog that
 * differs from its applied hash.
 */
export async function processSupplierSync(app: StoreApp, minute: number, nowMs: number): Promise<void> {
  // a supplier whose last_sync_at was cleared (the panel's «همگام‌سازی الان») is fetched on any tick;
  // the periodic fetch of all suppliers is at minute % 10 == 2
  const periodic = minute % 10 === 2 ? 1 : 0;
  const cutoff = tehranDateTime(new Date(nowMs - 9 * 60_000));
  const due = (await app.raw.prepare(
    "SELECT * FROM suppliers WHERE is_enabled = 1 AND (last_sync_at IS NULL OR (? = 1 AND last_sync_at < ?)) ORDER BY COALESCE(last_sync_at, '') LIMIT 3",
  ).bind(periodic, cutoff).all<SupplierRow>()).results;
  for (const s of due) {
    if (app.apps.budget.remaining() < 25) break;
    await syncSupplier(app, s);
  }
  if (app.apps.budget.remaining() >= 15) {
    const pending = await app.raw.prepare(
      'SELECT supplier_id FROM supplier_catalogs WHERE applied_hash IS NULL OR applied_hash <> items_hash LIMIT 1',
    ).bind().first<{ supplier_id: number }>();
    if (pending) await applyCatalog(app, pending.supplier_id);
  }
}
