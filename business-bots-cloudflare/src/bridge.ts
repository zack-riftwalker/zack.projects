import type { Apps } from './apps';

export interface OrderPaidEvent { order_id: number; customer_id: number; product: string }

/** store → monshi: called at the end of handleOrderDecision when an order is confirmed. */
export async function storeOrderPaid(apps: Apps, event: OrderPaidEvent): Promise<void> {
  if (!apps.monshi) {
    console.warn('⚠️ [Bridge] Event dropped (monshi bot disabled): order_paid');
    return;
  }
  // Wired to the real monshi handler in M9.
  void event;
}

/** monshi → store: called when monshi marks an externally-sourced order delivered. */
export async function monshiOrderDelivered(apps: Apps, storeOrderId: number): Promise<void> {
  if (!apps.store) return;
  const { onOrderDelivered } = await import('./store/bridgeHandlers');
  await onOrderDelivered(apps.store, storeOrderId);
}
