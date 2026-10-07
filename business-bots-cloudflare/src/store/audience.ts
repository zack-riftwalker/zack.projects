/** Announcement audiences (broadcast_jobs.audience). Strictly validated: the value is parsed, never interpolated. */
export const AUDIENCE_RE = /^(all|active|expired|never|buyers:\d+|waitlist:\d+)$/;

const ACTIVE_COND =
  "EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status = 'delivered' " +
  "AND (o.expires_at IS NULL OR o.expires_at > datetime('now', '+03:30')))";

const EXPIRED_COND =
  "EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status = 'delivered' " +
  "AND o.expires_at IS NOT NULL AND o.expires_at <= datetime('now', '+03:30')) AND NOT " + ACTIVE_COND;

const NEVER_COND =
  "NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status IN ('confirmed', 'delivered'))";

/** WHERE fragment (over customers `c`) + its bound args. Throws on an invalid audience. */
export function audienceFilter(audience: string): { where: string; args: unknown[] } {
  if (!AUDIENCE_RE.test(audience)) throw new Error('invalid audience: ' + audience);
  if (audience === 'all') return { where: '1 = 1', args: [] };
  if (audience === 'active') return { where: ACTIVE_COND, args: [] };
  if (audience === 'expired') return { where: EXPIRED_COND, args: [] };
  if (audience === 'never') return { where: NEVER_COND, args: [] };
  const [kind, id] = audience.split(':');
  const pid = parseInt(id, 10);
  if (kind === 'buyers') {
    return {
      where: "EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.customer_product_id = ? AND o.status IN ('confirmed', 'delivered'))",
      args: [pid],
    };
  }
  return {
    where: 'EXISTS (SELECT 1 FROM product_waitlist w WHERE w.product_id = ? AND w.customer_telegram_id = c.telegram_id)',
    args: [pid],
  };
}

export const AUDIENCE_LABEL: Record<string, string> = {
  all: 'همه مشتری‌ها',
  active: 'مشتری‌های دارای اشتراک فعال',
  expired: 'مشتری‌هایی که اشتراکشان تمام شده',
  never: 'کسانی که هنوز خرید نکرده‌اند',
};
