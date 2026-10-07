import type { StoreApp } from '../apps';
import type { CustomerProduct } from './db';

export interface ReferralConfig {
  enabled: boolean;
  /** qualified invites per reward (1..50) */
  required: number;
  /** the invitee's confirmed order price must be ≥ this (Toman) */
  minAmount: number;
  reward: 'discount' | 'product';
  discType: 'percent' | 'fixed';
  /** 1..100 for percent, > 0 for fixed */
  discValue: number;
  discProductId: number | null;
  /** 1..365 */
  discValidDays: number;
  /** free product for reward = 'product' */
  productId: number | null;
  /** every N invites → another reward; false = one reward max */
  repeatable: boolean;
}

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  enabled: false, required: 3, minAmount: 0, reward: 'discount', discType: 'percent', discValue: 20,
  discProductId: null, discValidDays: 30, productId: null, repeatable: true,
};

const KEY = 'referral';

/** JSON from the kv row merged over the defaults; corrupt JSON falls back to the defaults. */
export async function getReferralConfig(app: StoreApp): Promise<ReferralConfig> {
  const raw = await app.kv.get(KEY);
  if (!raw) return { ...DEFAULT_REFERRAL_CONFIG };
  try {
    return { ...DEFAULT_REFERRAL_CONFIG, ...JSON.parse(raw) };
  } catch (err: any) {
    console.error('❌ [Referral] Corrupt referral config JSON:', err.message);
    return { ...DEFAULT_REFERRAL_CONFIG };
  }
}

export async function setReferralConfig(app: StoreApp, cfg: ReferralConfig): Promise<void> {
  await app.kv.set(KEY, JSON.stringify(cfg));
}

/** A Persian reason when the program can't be enabled with this config, else null. */
export function referralConfigProblem(cfg: ReferralConfig, products: CustomerProduct[]): string | null {
  const usable = (id: number | null) => id !== null && products.some((p) => p.id === id);
  if (cfg.reward === 'product') {
    if (!usable(cfg.productId)) return '⚠️ اول محصول جایزه را انتخاب کنید.';
  } else if (!usable(cfg.discProductId)) {
    return '⚠️ اول محصولی که کد تخفیف برای آن صادر می‌شود را انتخاب کنید.';
  }
  if (cfg.reward === 'discount') {
    if (cfg.discType === 'percent' && !(cfg.discValue >= 1 && cfg.discValue <= 100)) return '⚠️ درصد تخفیف باید بین ۱ تا ۱۰۰ باشد.';
    if (cfg.discType === 'fixed' && !(cfg.discValue > 0)) return '⚠️ مبلغ تخفیف باید بیشتر از صفر باشد.';
  }
  return null;
}
