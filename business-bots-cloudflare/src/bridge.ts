import type { Apps } from './apps';
import { handleOrderPaid, type OrderPaidEvent } from './monshi/handlers/bridge';
import { onOrderDelivered, onOrderPaidFailed } from './store/bridgeHandlers';

export type { OrderPaidEvent };

/**
 * store → monshi: called at the end of the confirm handler. Monshi registers the order and sends the
 * «being prepared» message from the support account; if that is impossible (customer never chatted with
 * support, no business connection, send error) the store sends the fallback message itself and tells the admins.
 */
export async function storeOrderPaid(apps: Apps, event: OrderPaidEvent): Promise<void> {
  if (!apps.monshi) {
    // same as the legacy "no BRIDGE_CHANNEL_ID": orders still work, but no support-account messages
    console.warn('⚠️ [Bridge] Event dropped (monshi bot disabled): order_paid');
    return;
  }
  let result: Awaited<ReturnType<typeof handleOrderPaid>>;
  try {
    result = await handleOrderPaid(apps.monshi, event);
  } catch (err: any) {
    console.error('❌ [Bridge] Monshi failed to handle order_paid:', err?.message ?? err);
    result = { ok: false, reason: 'monshi_error' };
  }
  if (!result.ok && apps.store) {
    await onOrderPaidFailed(apps.store, { order_id: event.order_id, reason: result.reason });
  }
}

/** monshi → store: an externally-sourced order was delivered (starts the subscription/warranty clocks). */
export async function monshiOrderDelivered(apps: Apps, storeOrderId: number): Promise<void> {
  if (!apps.store) return;
  await onOrderDelivered(apps.store, storeOrderId);
}
