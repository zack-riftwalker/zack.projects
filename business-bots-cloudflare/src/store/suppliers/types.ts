/** A supplier row as stored in D1 (SUPPLIER_PLAN.md §2.1). */
export interface SupplierRow {
  id: number;
  kind: 'ariobox';
  name: string;
  base_url: string;
  api_key: string;
  remote_user_id: number;
  is_enabled: number;
  last_sync_at: string | null;
  last_sync_ok_at: string | null;
  last_sync_error: string | null;
  sync_alert_sent: number;
  created_at: string;
}

export interface CatalogItem {
  remoteProductId: string;
  remoteVariationId: string;
  name: string;
  sku: string;
  priceUsd: number | null;
  attributes: Record<string, string>;
}

export interface Catalog {
  usdToman: number;
  items: CatalogItem[];
  updatedAt: string | null;
}

export type FetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'auth' | 'temporary' | 'bad_response'; http: number | null; detail: string };

export type PlaceResult =
  | { kind: 'placed'; remoteOrderId: string; remoteStatus: string; priceUsd: number | null; raw: string }
  | { kind: 'out_of_stock'; http: number; detail: string }              // nothing was bought
  | { kind: 'retry_later'; http: number | null; detail: string }        // nothing was bought (503, low balance per Appendix A)
  | { kind: 'config'; http: number; detail: string }                   // 401 / 404 user: the admin must fix settings
  | { kind: 'rejected'; http: number; detail: string }                 // 400 etc.: nothing was bought, won't succeed by retrying
  | { kind: 'unknown'; http: number | null; detail: string };          // MAY have been bought (timeout, network error, 5xx≠503, 2xx without order_id)

export type StatusResult =
  | { kind: 'ok'; remoteStatus: string; accounts: { fields: { key: string; value: string }[] }[]; message: string | null; raw: string }
  | { kind: 'error'; http: number | null; detail: string };

export interface SupplierAdapter {
  fetchCatalog(s: SupplierRow): Promise<FetchResult<Catalog>>;
  placeOrder(s: SupplierRow, p: { remoteProductId: string; remoteVariationId: string; quantity: number; note: string }): Promise<PlaceResult>;
  getOrder(s: SupplierRow, remoteOrderId: string): Promise<StatusResult>;
}
