import type { Context, SessionFlavor } from 'grammy';
import type { StoreApp } from '../apps';
import type { SceneSession, WizardFlavor } from '../lib/wizard';
import type { ImportDraft } from './suppliers/importDraft';

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
  /** admin typing one value of the supplier panel (expires after 15 min) */
  awaitingSupplierInput?: {
    kind: 'sup_key' | 'sup_key_edit' | 'sup_uid' | 'def_percent' | 'def_fixed'
      | 'imp_group' | 'imp_label' | 'imp_duration' | 'imp_warranty' | 'imp_percent' | 'imp_fixed' | 'imp_terms'
      | 'src_percent' | 'src_fixed' | 'fo_msg' | 'fo_rid' | 'fo_text' | 'fo_cost' | 'fo_cancel_reason'
      | 'sup_topup' | 'wal_refund' | 'wal_adjust'
      | 'stk_qty' | 'stk_rid' | 'stk_sold' | 'stk_dnote' | 'stk_batch_profit' | 'stk_send_to' | 'stk_send_price' | 'stk_note';
    ref: string; at: number;
  } | null;
  /** the product import being prepared (SUPPLIER_PLAN.md §5.1) */
  supplierImport?: ImportDraft | null;
  /** add-supplier steps: the step name and the values typed so far (the key only until the test) */
  supplierWizard?: { step: string; data: Record<string, any>; at?: number } | null;
}

export type StoreContext = Context & SessionFlavor<StoreSession> & WizardFlavor & { app: StoreApp };
