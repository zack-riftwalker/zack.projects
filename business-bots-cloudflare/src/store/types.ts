import type { Context, SessionFlavor } from 'grammy';
import type { StoreApp } from '../apps';
import type { SceneSession, WizardFlavor } from '../lib/wizard';

export interface PurchaseDraft {
  productId: number;
  productName: string;
  price: number;
  discountCodeId: number | null;
  /** epoch ms when the customer agreed to the terms (receipt drafts expire, see RECEIPT_DRAFT_TTL_MS) */
  createdAt?: number;
}

export interface StoreSession extends SceneSession {
  awaitingDiscountCodeFor?: number | null;
  pendingPurchase?: PurchaseDraft | null;
  awaitingReceiptFor?: PurchaseDraft | null;
  /** admin typing a custom number for a referral setting */
  awaitingReferralInput?: 'required' | 'minAmount' | 'discValue' | 'discValidDays' | null;
  /** admin typing a custom reject reason for a receipt (expires after 15 min) */
  awaitingRejectReasonFor?: { orderId: number; chatId: number; messageId: number; caption: string; at: number } | null;
}

export type StoreContext = Context & SessionFlavor<StoreSession> & WizardFlavor & { app: StoreApp };
