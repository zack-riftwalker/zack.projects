import type { StoreApp } from '../apps';
import { storeOrderPaid } from '../bridge';
import { BudgetExceededError } from '../lib/budget';
import { Markup } from '../lib/markup';
import { formatJalaliDate, tehranParts } from '../lib/time';
import { getReferralConfig, type ReferralConfig } from './referralConfig';
import { formatPrice } from './utils';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REF_PAYLOAD_RE = /^ref_([A-Z2-9]{8})$/;
/**
 * Calls one reward round can spend (reads, claim, issue, referrer message, one message per admin).
 * Below this the grant waits for the cron sweep: running out mid-way would strand a «pending» reward.
 */
const grantBudgetNeeded = (app: StoreApp) => 12 + app.cfg.adminIds.length;

const fa = (n: number) => n.toLocaleString('fa-IR');

function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** The customer's personal code, generated lazily. null when the customer row doesn't exist. */
export async function getOrCreateRefCode(app: StoreApp, telegramId: number): Promise<string | null> {
  const existing = await app.db.getRefCode(telegramId);
  if (existing) return existing;
  for (let i = 0; i < 3; i++) {
    if (await app.db.setRefCode(telegramId, randomCode(8))) break;
  }
  return app.db.getRefCode(telegramId);
}

export const discountLabel = (type: string, value: number) => (type === 'percent' ? '٪' + fa(value) : formatPrice(value) + ' تومان');

/** The program's rules in one or two Persian sentences, generated from the config. */
export async function rulesText(app: StoreApp, cfg: ReferralConfig): Promise<string> {
  const min = cfg.minAmount > 0 ? ' (حداقل ' + formatPrice(cfg.minAmount) + ' تومان)' : '';
  const head = 'هر ' + fa(cfg.required) + ' نفر که با لینک شما وارد ربات شوند و اولین خریدشان' + min + ' تأیید شود، ';
  let body: string;
  if (cfg.reward === 'product') {
    const p = cfg.productId ? await app.db.getCustomerProductById(cfg.productId) : undefined;
    body = 'یک «' + (p?.name ?? '—') + '» رایگان هدیه می‌گیرید.';
  } else {
    const p = cfg.discProductId ? await app.db.getCustomerProductById(cfg.discProductId) : undefined;
    body = 'یک کد تخفیف ' + discountLabel(cfg.discType, cfg.discValue) + ' برای «' + (p?.name ?? '—') + '» هدیه می‌گیرید (اعتبار ' + fa(cfg.discValidDays) + ' روز).';
  }
  return head + body + (cfg.repeatable ? '' : '\nاین جایزه فقط یک بار داده می‌شود.');
}

/**
 * `/start ref_<code>`: records who invited this customer. Only a brand-new customer can be invited
 * (the anti-abuse rule), and only while the program is on. Everything else is silently ignored.
 */
export async function handleRefStart(app: StoreApp, inviteeId: number, code: string, isNew: boolean): Promise<void> {
  if (!isNew) return;
  const cfg = await getReferralConfig(app);
  if (!cfg.enabled) return;
  const referrerId = await app.db.findCustomerByRefCode(code);
  if (!referrerId || referrerId === inviteeId) return;
  if (!(await app.db.insertReferral(referrerId, inviteeId))) return;
  try {
    const progress = await app.db.countUnrewardedReferrals(referrerId);
    await app.api.sendMessage(
      referrerId,
      '👋 یک نفر با لینک دعوت شما وارد فروشگاه شد!\n' +
      'وقتی اولین خریدش تأیید شود، برای شما حساب می‌شود. (دعوت موفق فعلی: ' + fa(progress) + ' از ' + fa(cfg.required) + ')',
    );
  } catch (err: any) {
    if (err instanceof BudgetExceededError) return;
    console.warn('⚠️ [Referral] Could not notify referrer ' + referrerId + ':', err.message);
  }
}

/** Called after an order is confirmed (receipt) or a manual purchase is claimed. */
export async function onPurchaseConfirmed(app: StoreApp, order: { id: number; customer_telegram_id: number; price: number }): Promise<void> {
  const cfg = await getReferralConfig(app);
  if (!cfg.enabled) return;
  const referral = await app.db.getReferralByInvitee(order.customer_telegram_id);
  if (!referral || referral.qualified_at) return;
  if (order.price < cfg.minAmount) return; // a later, bigger order can still qualify
  if (!(await app.db.qualifyReferral(referral.id, order.id))) return;
  console.log('🎁 [Referral] Invite of customer ' + order.customer_telegram_id + ' qualified (referrer ' + referral.referrer_telegram_id + ').');
  await tryGrantRewards(app, referral.referrer_telegram_id);
  // otherwise the cron sweep grants it
}

async function notifyAdmins(app: StoreApp, text: string): Promise<void> {
  for (const adminId of app.cfg.adminIds) {
    try {
      await app.api.sendMessage(adminId, text);
    } catch (err: any) {
      if (err instanceof BudgetExceededError) return;
      console.warn('⚠️ [Referral] Could not notify admin ' + adminId + ':', err.message);
    }
  }
}

/** Local 'YYYY-MM-DD 23:59:59' (Tehran) `days` days from now. */
function expiryAfterDays(now: Date, days: number): string {
  return tehranParts(new Date(now.getTime() + days * 86400000)).day + ' 23:59:59';
}

/**
 * Turns every full set of `required` qualified invites into a reward (at most 3 per call).
 * Safe under concurrency: the invites are claimed with one conditional UPDATE, so two racing callers can't both win.
 */
export async function tryGrantRewards(app: StoreApp, referrerId: number): Promise<void> {
  for (let round = 0; round < 3; round++) {
    if (app.apps.budget.remaining() < grantBudgetNeeded(app)) return; // the cron sweep continues
    const cfg = await getReferralConfig(app);
    if (!cfg.enabled) return;
    if (!cfg.repeatable && (await app.db.hasLiveReward(referrerId))) return;

    const ids = await app.db.getOldestUnrewardedReferralIds(referrerId, cfg.required);
    if (ids.length < cfg.required) return;

    const rewardId = await app.db.createReferralReward(referrerId, cfg.reward, JSON.stringify(cfg));
    if ((await app.db.claimReferrals(ids, rewardId)) !== ids.length) {
      await app.db.releaseReward(rewardId); // a concurrent request took some of them
      return;
    }
    try {
      await issueReward(app, referrerId, rewardId, cfg);
    } catch (err: any) {
      if (err instanceof BudgetExceededError) throw err;
      console.error('❌ [Referral] Issuing reward ' + rewardId + ' failed:', err.message);
      await app.db.finishReferralReward(rewardId, 'failed');
      await notifyAdmins(app, '⚠️ صدور جایزه دعوت برای مشتری ' + referrerId + ' ناموفق بود (' + err.message + '). لطفاً دستی رسیدگی کنید.');
    }
  }
}

async function issueReward(app: StoreApp, referrerId: number, rewardId: number, cfg: ReferralConfig): Promise<void> {
  const intro = '🎉 تبریک! ' + fa(cfg.required) + ' نفر از دوستانتان با لینک شما خرید کردند.\n\n';

  if (cfg.reward === 'product') {
    const product = cfg.productId ? await app.db.getCustomerProductById(cfg.productId) : undefined;
    if (!product || !product.is_active) throw new Error('محصول جایزه موجود نیست');
    const orderId = await app.db.createRewardOrder({ customerTelegramId: referrerId, product });
    await app.db.finishReferralReward(rewardId, 'issued', { orderId });
    try {
      await app.api.sendMessage(referrerId, intro + '🎁 جایزه شما: یک «' + product.name + '» رایگان!\nسفارش #' + orderId + ' ثبت شد و به‌زودی تحویل داده می‌شود.');
    } catch (err: any) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn('⚠️ [Referral] Reward message to ' + referrerId + ' failed:', err.message);
    }
    // the normal delivery flow: monshi's «being prepared» message, the delivery button, the 20 h stalled alert
    try {
      await storeOrderPaid(app.apps, { order_id: orderId, customer_id: referrerId, product: product.name });
    } catch (err: any) {
      console.error('❌ [Referral] Bridge failed for reward order #' + orderId + ':', err.message);
    }
    await notifyAdmins(app, '🎁 جایزه دعوت صادر شد\n👤 مشتری: ' + referrerId + '\n🎯 ' + fa(cfg.required) + ' دعوت موفق\n🏆 جایزه: سفارش رایگان #' + orderId + ' — لطفاً تحویل دهید');
    return;
  }

  const product = cfg.discProductId ? await app.db.getCustomerProductById(cfg.discProductId) : undefined;
  if (!product || !product.is_active) throw new Error('محصول کد تخفیف موجود نیست');
  const expiresAt = expiryAfterDays(app.apps.now(), cfg.discValidDays);
  let code = '';
  let codeId = 0;
  for (let i = 0; i < 3 && !codeId; i++) {
    code = 'REF-' + randomCode(6);
    try {
      codeId = (await app.db.createDiscountCode({
        code, customerProductId: product.id, discountType: cfg.discType, discountValue: cfg.discValue,
        maxUses: 1, expiresAt, ownerTelegramId: referrerId, source: 'referral',
      })).lastInsertRowid;
    } catch (err: any) {
      if (err instanceof BudgetExceededError) throw err; // anything else is (most likely) a unique collision → retry
    }
  }
  if (!codeId) throw new Error('ساخت کد تخفیف ممکن نشد');
  await app.db.finishReferralReward(rewardId, 'issued', { discountCodeId: codeId });

  const label = discountLabel(cfg.discType, cfg.discValue);
  try {
    await app.api.sendMessage(
      referrerId,
      intro + '🎁 جایزه شما: کد تخفیف ' + code + '\n' + label + ' تخفیف برای «' + product.name + '» — معتبر تا ' + formatJalaliDate(expiresAt) + '\n\n' +
      'برای استفاده، «' + product.name + '» را از «🛍 لیست محصولات» انتخاب کنید و این کد را وارد کنید.',
      Markup.inlineKeyboard([[Markup.button.callback(('🛍 خرید «' + product.name + '»').slice(0, 60), 'cust_prod_' + product.id)]]),
    );
  } catch (err: any) {
    if (err instanceof BudgetExceededError) throw err;
    console.warn('⚠️ [Referral] Reward message to ' + referrerId + ' failed:', err.message);
  }
  await notifyAdmins(app, '🎁 جایزه دعوت صادر شد\n👤 مشتری: ' + referrerId + '\n🎯 ' + fa(cfg.required) + ' دعوت موفق\n🏆 جایزه: کد ' + code + ' (' + label + ' برای «' + product.name + '»)');
}

/** Cron: grant rewards that could not be granted inline (budget) — a few referrers per tick. */
export async function sweepReferralRewards(app: StoreApp): Promise<void> {
  // a reward stuck in «pending» (the invocation died mid-way) is closed as failed and handed to the admins
  for (const stuck of await app.db.getStalePendingRewards(3)) {
    await app.db.finishReferralReward(stuck.id, 'failed');
    await notifyAdmins(app, '⚠️ صدور جایزه دعوت برای مشتری ' + stuck.referrer_telegram_id + ' نیمه‌کاره ماند. لطفاً دستی رسیدگی کنید.');
  }
  const cfg = await getReferralConfig(app);
  if (!cfg.enabled) return;
  for (const referrerId of await app.db.getReferrersReadyForReward(cfg.required, cfg.repeatable, 5)) {
    if (app.apps.budget.remaining() < grantBudgetNeeded(app)) return;
    try {
      await tryGrantRewards(app, referrerId);
    } catch (err: any) {
      if (err instanceof BudgetExceededError) return;
      console.error('❌ [Referral] Sweep failed for ' + referrerId + ':', err.message);
    }
  }
}
