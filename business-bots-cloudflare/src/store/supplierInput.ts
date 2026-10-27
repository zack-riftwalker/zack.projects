import type { StoreContext, StoreSession } from './types';

/** An open typed-input prompt or add-supplier step expires after this long (SUPPLIER_PLAN.md §9.2). */
export const INPUT_TTL_MS = 15 * 60_000;

export type SupplierInputKind = NonNullable<StoreSession['awaitingSupplierInput']>['kind'];

/** Prompts whose answer is an API key: the message is deleted before any handler can see it. */
export const KEY_INPUT_KINDS: readonly string[] = ['sup_key', 'sup_key_edit'];

/** Callbacks that work while an admin is mid-wizard; every other callback belongs to the wizard (or ends a supplier prompt). */
export const STAGE_BYPASS_RE = /^(order_(confirm|reject|deliver)_\d+|order_rejr_\d+_[a-z]+|rpt_\w+|ref_adm_\w+|fo_\w+|sup_\w+|stk_\w+|acct_show_\d+)$/;

/**
 * Opens a supplier text prompt. The prompt leaves any active scene: the supplier text handler runs before the
 * Stage, but a scene left open would also swallow the admin's next unrelated message once the prompt is done.
 */
export async function beginSupplierInput(ctx: StoreContext, kind: SupplierInputKind, ref: string): Promise<void> {
  await ctx.scene?.leave();
  ctx.session.awaitingSupplierInput = { kind, ref, at: ctx.app.apps.now().getTime() };
}

/** Same for the multi-step add-supplier flow. */
export async function beginSupplierWizard(ctx: StoreContext, step: string, data: Record<string, any>): Promise<void> {
  await ctx.scene?.leave();
  ctx.session.supplierWizard = { step, data, at: ctx.app.apps.now().getTime() };
}

/** Drops every open supplier prompt, the add-supplier steps (and the API key they may hold) and the import draft. */
export function clearSupplierInputs(ctx: StoreContext): void {
  if (!ctx.session) return;
  ctx.session.awaitingSupplierInput = null;
  ctx.session.supplierWizard = null;
  ctx.session.supplierImport = null;
}
