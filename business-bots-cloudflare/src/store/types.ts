import type { Context, SessionFlavor } from 'grammy';
import type { StoreApp } from '../apps';
import type { SceneSession, WizardFlavor } from '../lib/wizard';

export interface PurchaseDraft {
  productId: number;
  productName: string;
  price: number;
  discountCodeId: number | null;
}

export interface StoreSession extends SceneSession {
  awaitingDiscountCodeFor?: number | null;
  pendingPurchase?: PurchaseDraft | null;
  awaitingReceiptFor?: PurchaseDraft | null;
}

export type StoreContext = Context & SessionFlavor<StoreSession> & WizardFlavor & { app: StoreApp };
