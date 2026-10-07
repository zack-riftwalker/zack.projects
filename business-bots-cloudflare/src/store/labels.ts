export const STOREFRONT_LABEL = '🛍 لیست محصولات';
export const MY_SUBS_LABEL = '📋 اشتراک‌های من';
export const MANUAL_PURCHASE_LABEL = '🛒 ثبت خرید مشتری';

/** Telegram ID customers are told to message to kick off product activation. */
export const ACTIVATION_CONTACT = '@maiposhtibani';

/**
 * Shown before every renewal purchase (renew button + reminders): accounts
 * are pre-built, so "renewal" means receiving a NEW account, not extending
 * the current one.
 */
export const RENEWAL_NOTE =
  'ℹ️ توجه: اکانت‌ها به‌صورت پیش‌ساخته تحویل می‌شوند؛ «تمدید» یعنی دریافت یک اکانت جدید، نه تمدید همان اکانت فعلی.';

/** Reject reasons offered to the admin; `text` is what the customer is told. */
export const REJECT_REASONS: { code: string; button: string; text: string }[] = [
  { code: 'amount', button: '💸 مبلغ اشتباه', text: 'مبلغ واریزی با مبلغ سفارش مطابقت ندارد.' },
  { code: 'unreadable', button: '🔍 رسید ناخوانا', text: 'تصویر رسید خوانا نیست یا اطلاعات کامل ندارد.' },
  { code: 'notreceived', button: '🏦 واریز نرسیده', text: 'واریزی با این مشخصات به حساب ما نرسیده است.' },
  { code: 'wrongcard', button: '💳 کارت اشتباه', text: 'واریز به شماره کارت اشتباهی انجام شده است.' },
  { code: 'duplicate', button: '♻️ رسید تکراری', text: 'این رسید قبلاً برای سفارش دیگری استفاده شده است.' },
];
export const DUPLICATE_REASON_TEXT = REJECT_REASONS.find((r) => r.code === 'duplicate')!.text;
export const MAX_REJECT_REASON_LENGTH = 200;

export const REPORT_LABEL = '📊 گزارش فروش';

export const REFERRAL_LABEL = '🎁 دعوت دوستان';
