import type { StoreApp } from '../../apps';
import { BudgetExceededError } from '../../lib/budget';
import { Markup, type InlineButton } from '../../lib/markup';
import { tehranDateTime } from '../../lib/time';
import { eventStatement } from '../events';
import { sendToAdmins } from '../customerRef';
import { escapeHtml } from '../utils';
import { createStockBatch } from './stock';
import { buildBatchCard } from './stockCards';
import { getSupplier, readCatalog } from './store';
import type { SupplierOrderRow } from './types';
import type { AccountField } from './format';

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));

/** «NAME — ATTRS» of the item a direct buy ordered; falls back to the remote ids when the catalog no longer lists it. */
export async function stockOrderTitle(app: StoreApp, so: SupplierOrderRow): Promise<string> {
  if (so.supplier_id !== null) {
    const cached = await readCatalog(app, so.supplier_id);
    const item = cached?.catalog.items.find((i) => i.remoteProductId === so.remote_product_id && i.remoteVariationId === (so.remote_variation_id ?? ''));
    if (item) {
      const attrs = Object.values(item.attributes ?? {}).filter((v) => v !== '' && v != null).join(' · ');
      return attrs ? item.name + ' — ' + attrs : item.name;
    }
  }
  return 'خرید مستقیم #' + so.remote_product_id + (so.remote_variation_id ? '/' + so.remote_variation_id : '');
}

/** Sends an HTML message to the admin who asked for the direct buy (every admin for an automatic one). */
async function tellRequester(app: StoreApp, so: SupplierOrderRow, html: string, rows: InlineButton[][] = []): Promise<void> {
  if (so.requested_by === 0) {
    await sendToAdmins(app, html, rows);
    return;
  }
  try {
    await app.api.sendMessage(so.requested_by, html, { parse_mode: 'HTML', ...(rows.length ? Markup.inlineKeyboard(rows) : {}) });
  } catch (err: any) {
    if (err instanceof BudgetExceededError) throw err;
    console.warn('⚠️ [Stock] could not reach admin ' + so.requested_by + ':', err?.description ?? err?.message);
  }
}

/** A direct buy that did not go through: the reason and a button; there are never automatic retries for stock buys (§10.1). */
export async function notifyStockProblem(
  app: StoreApp, soId: number, kind: 'failed' | 'unknown' | 'empty', reasonFa: string,
): Promise<void> {
  const so = await app.raw.prepare('SELECT * FROM supplier_orders WHERE id = ?').bind(soId).first<SupplierOrderRow>();
  if (!so) return;
  const sup = so.supplier_id !== null ? await getSupplier(app, so.supplier_id) : undefined;
  const title = await stockOrderTitle(app, so);
  const head = '🛒 خرید مستقیم #' + so.id + ' از «' + escapeHtml(sup?.name ?? 'تأمین‌کننده') + '» — ' + escapeHtml(title) + ' × ' + fa(so.quantity);
  if (kind === 'unknown') {
    await tellRequester(app, so, head + '\n❓ معلوم نیست سفارش ثبت شده یا نه (' + escapeHtml(so.last_error ?? '') + '). در پنل تأمین‌کننده دنبال یادداشت stock/so#' + so.id + ' بگردید.', [
      [cb('🔢 ثبت شده بود؛ شماره‌اش را وارد می‌کنم', 'stk_rid_' + so.id)],
      [cb('🔁 ثبت نشده بود؛ دوباره بخر', 'stk_rtu_' + so.id)],
    ]);
    return;
  }
  await tellRequester(app, so, head + '\n❌ ' + reasonFa, kind === 'failed' ? [[cb('🔁 دوباره', 'stk_rt_' + so.id)]] : []);
}

/**
 * A direct buy finished with accounts: the supplier order completes and the batch with its accounts is saved in ONE
 * batch (so a crash can't lose the accounts). Fewer accounts than ordered are saved and noted. Only the requesting
 * admin hears about it.
 */
export async function completeStockOrder(
  app: StoreApp, so: SupplierOrderRow, remoteStatus: string, raw: string, accounts: { fields: AccountField[] }[],
): Promise<number | null> {
  const now = tehranDateTime(app.apps.now());
  const title = await stockOrderTitle(app, so);
  const partial = accounts.length < so.quantity;
  const batchId = await createStockBatch(app, {
    supplierId: so.supplier_id, supplierOrderId: so.id, title, accounts,
    unitPriceUsd: so.price_usd, usdToman: so.usd_toman, costToman: so.cost_toman,
    note: partial ? 'فقط ' + accounts.length + ' از ' + so.quantity + ' اکانت رسید' : null, createdBy: so.requested_by,
    eventKind: 'completed', eventDetail: 'stock batch',
    claim: app.raw.prepare("UPDATE supplier_orders SET status = 'completed', remote_status = ?, raw_response = ?, completed_at = ?, next_check_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'placed'")
      .bind(remoteStatus, raw, now, now, so.id),
  });
  if (batchId === null) return null;
  const card = await buildBatchCard(app, batchId);
  const lines = [
    '✅ خرید مستقیم #' + so.id + ' تکمیل شد — ' + fa(accounts.length) + ' اکانت به «اکانت‌های من» اضافه شد.',
    ...(partial ? ['⚠️ فقط ' + fa(accounts.length) + ' از ' + fa(so.quantity) + ' اکانت رسید؛ با تأمین‌کننده هماهنگ کنید.'] : []),
    '',
    card?.html ?? '',
  ];
  await tellRequester(app, so, lines.join('\n'), card?.rows ?? []);
  return batchId;
}
