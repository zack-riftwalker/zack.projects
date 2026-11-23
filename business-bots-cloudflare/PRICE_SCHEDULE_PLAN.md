# Store Bot: Scheduled Sale Prices (round 6)

> **Audience:** an implementing agent (Claude Code) working in this repo.
> **Base:** branch `business-bots-cloudflare` at `6a63c39` or later. Production runs `6a63c39`. Baseline: typecheck clean, 900 passed, 1 skipped.
> **Deadline:** the first real use is Thursday 26 Nov 2026 at 20:00 Tehran. The main session reviews and deploys.
> Implement exactly this plan. If something doesn't fit the code, pick the closest safe option, write it down in your final report, and continue. Nobody watches the session live.

## خلاصه (فارسی)
ادمین برای هر محصول یک «⏰ قیمت زمان‌دار» ثبت می‌کند: قیمت جشنواره، زمان شروع و زمان پایان. سر ساعت شروع، ربات خودش قیمت را عوض می‌کند و قیمت قبلی را «قیمت عادی» (خط‌خورده) نشان می‌دهد. سر ساعت پایان هم قیمت را برمی‌گرداند. موقع شروع و پایان به ادمین‌ها خبر می‌دهد و دکمه‌ی لغو هم دارد.

---

## 0. Rules
1. **Same rules as `CAMPAIGN_PLAN.md` §0 and §0.5, and `UI_PLAN.md` §0.** In short:
   - Work only in `business-bots-cloudflare/`.
   - **Budget:** 50 units per invocation. Every Telegram call and every D1 statement costs 1.
   - **SQL:** plain `?` placeholders only.
   - **Times:** local Tehran strings `'YYYY-MM-DD HH:MM:SS'`, via `tehranDateTime(app.apps.now())`, `parseJalaliDateTime` and `formatJalaliDateTime`.
   - Plain text for messages with product names, or `escapeMarkdown`.
   - **Indexes:** add every new hot query to `test/indexes.test.ts`, and the new table to its `BIG` list.
2. **Don't touch** Monshi/Eitaa, the supplier engine, the payment/receipt/order flow, migrations `0001`–`0006`, or the customer UI (`src/store/ui.ts`, storefront screens). The display already works from `price` + `compare_at_price`.
3. **Git:**
   - Before every commit run `npm run typecheck && npx vitest run`. Both must be green.
   - Make one commit per milestone (P0, P1, P2) and push with `git push -u origin business-bots-cloudflare`. Never force-push. If the push is rejected, fetch, merge, re-test, push.
4. **Never deploy**, run wrangler, touch a remote database, or open a PR.

## 1. Schema (milestone P0)
`migrations/store/0007_price_schedules.sql`:
```sql
-- round 6: scheduled sale prices (PRICE_SCHEDULE_PLAN.md)
CREATE TABLE IF NOT EXISTS price_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL,
  sale_price   INTEGER NOT NULL,              -- Toman
  normal_price INTEGER,                       -- the price it replaced; set when it starts
  starts_at    TEXT    NOT NULL,              -- local Tehran
  ends_at      TEXT    NOT NULL,              -- local Tehran
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'done', 'cancelled')),
  note         TEXT,                          -- why it ended oddly (e.g. price changed by hand)
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);
CREATE INDEX IF NOT EXISTS idx_price_sched_start ON price_schedules(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_price_sched_end   ON price_schedules(status, ends_at);
CREATE INDEX IF NOT EXISTS idx_price_sched_prod  ON price_schedules(product_id, status);
```
- Add a `PriceSchedule` row type in `src/store/db.ts`.
- Update `scripts/sqlite_to_d1.py` only if it lists tables or columns explicitly; it does list columns, so check it.
- Extend `test/migration.test.ts`.

## 2. The cron job (milestone P1)

`src/store/priceSchedule.ts`, `export async function applyPriceSchedules(app: StoreApp): Promise<void>`.

**Where it runs:** in `src/cron.ts`, inside the first `if (apps.store)` block, **every minute, first in that block**, as `guarded('price-schedules', ...)`. Prices must flip on time, even at the cost of a minute of another job.

**Steps:**
1. If `budget.remaining() <= 10`, return.
2. One query: `SELECT * FROM price_schedules WHERE (status = 'pending' AND starts_at <= ?) OR (status = 'active' AND ends_at <= ?) ORDER BY id LIMIT 4`, with now (local) for both placeholders. On a normal minute it returns nothing. That one statement is the whole cost.
   - If the planner can't use the indexes for the OR, use two indexed selects in one `db.batch` instead. Prove it in the index test.
3. For each row, stop when `budget.remaining() <= 8`:
   - **Start** (`pending`, `starts_at <= now`, and `ends_at > now`):
     - One `db.batch` (a single transaction) with two statements, then check `changes` on both:
       1. `UPDATE price_schedules SET status = 'active', normal_price = (SELECT price FROM customer_products WHERE id = ?) WHERE id = ? AND status = 'pending'`
       2. `UPDATE customer_products SET compare_at_price = price, price = ? WHERE id = ? AND is_active = 1 AND pricing_mode = 'manual' AND price > ? AND EXISTS (SELECT 1 FROM price_schedules WHERE id = ? AND status = 'active')`, binding `sale_price, product_id, sale_price, schedule_id`. The guard `price > sale_price` means a sale never raises a price.
     - If the schedule claim changed 1 row but the product update changed 0 (product inactive, auto-priced, or already at or below the sale price), set the schedule to `status = 'done'` with `note = 'not applied: …'` and tell the admins.
     - On success, tell the admins (plain text): `'🔥 قیمت جشنواره‌ی «' + name + '» فعال شد: ' + formatPrice(sale) + ' تومان (قبلاً ' + formatPrice(normal) + ')\n⏰ تا ' + formatJalaliDateTime(ends_at)`.
   - **Start too late** (`pending` and `ends_at <= now`, for example the bot was down the whole window): set `status = 'done'`, `note = 'expired before start'`. Nothing else.
   - **End** (`active`, `ends_at <= now`):
     - One `db.batch`:
       1. `UPDATE customer_products SET price = ?, compare_at_price = NULL WHERE id = ? AND price = ? AND compare_at_price = ?`, binding `normal_price, product_id, sale_price, normal_price`. It only reverts while untouched.
       2. `UPDATE price_schedules SET status = 'done' WHERE id = ? AND status = 'active'`.
     - If the product update changed 0 rows (the admin changed the price or compare price by hand during the sale), leave the product alone, set `note = 'price changed by hand; not reverted'`, and tell the admins: `'⚠️ قیمت «' + name + '» وسط جشنواره دستی عوض شده بود؛ برنگرداندم. لطفاً خودتان چک کنید.'`.
     - On success: `'✅ جشنواره‌ی «' + name + '» تمام شد؛ قیمت برگشت به ' + formatPrice(normal) + ' تومان.'`.
4. Send admin notices with the existing `sendToAdmins` (`src/store/customerRef.ts`), escaping names with `escapeHtml` since it takes HTML, or the plain-text helper `referrals.ts` uses. A failed notice never undoes a price change.
5. A `BudgetExceededError` stops the loop. Whatever wasn't processed is retried next minute, because every step is a conditional update.

**Tests** (`test/store/priceSchedule.test.ts`; use the fake clock the other cron tests use):
- before the start nothing changes
- at the start: the price becomes the sale price, compare_at becomes the old price, the schedule is `active`, admins are notified, and the product screen shows the struck normal price
- at the end: the price is back, compare_at is NULL, the schedule is `done`
- a second tick after each is a no-op
- an `auto` product, an inactive product or a sale price ≥ price → not applied, plus a notice
- a price changed by hand mid-sale → not reverted, plus a notice
- a pending schedule whose window already passed → `done`, no price change
- budget: a tick with 4 due rows stays ≤ 50 and leaves the broadcast its share
- two overlapping ticks → applied once

## 3. Admin UI (milestone P2)

In `src/store/handlers/customerProductsEdit.ts`, add the product-edit field button `'⏰ قیمت زمان‌دار'` (`cprod_edit_f_sale`). Copy how `cprod_edit_f_compare` is wired: the same wizard step style, cancel button and return to the product card. The product card shows one extra line, `'⏰ قیمت زمان‌دار: ' + summary`, where summary is `—` or e.g. `'۱٬۹۸۰٬۰۰۰ ت از ۱۴۰۵/۰۹/۰۵ ۲۰:۰۰ تا ۱۴۰۵/۰۹/۰۷ ۲۳:۵۹ (در انتظار)'` / `'(فعال)'`.

**Pressing it:**
- If the product has a `pending` or `active` schedule, show it with the buttons:
  - `'🗑 لغو'` (`psched_cancel_<id>`):
    - **pending:** set `status = 'cancelled'`.
    - **active:** revert now with the same guarded batch as the cron end. If that revert updates 0 rows, still set the status to `cancelled` with the note, and tell the admin to check the price.
  - `'🔙 بازگشت'`.
- Otherwise ask, step by step, with the existing cancel button:
  1. `'💰 قیمت جشنواره را بنویسید (تومان):'`: an integer (Persian or English digits) that must be `> 0` and `<` the current price, else `'⚠️ قیمت جشنواره باید کمتر از قیمت فعلی باشد.'`.
  2. `'⏰ زمان شروع را بنویسید (به وقت تهران)، مثلاً:\n۱۴۰۵/۰۹/۰۵ ۲۰:۰۰'`: `parseJalaliDateTime`. It may be in the past by up to 5 minutes, which means "now", and at most 30 days ahead.
  3. `'⏰ زمان پایان را بنویسید (به وقت تهران)، مثلاً:\n۱۴۰۵/۰۹/۰۷ ۲۳:۵۹'`: must be after the start and at most 30 days after it.
  4. Insert the schedule, then confirm: `'✅ ثبت شد: «' + name + '» از ' + start + ' تا ' + end + ' با قیمت ' + formatPrice(sale) + ' تومان.'`.
- **Refuse** with a clear message for:
  - an `auto`-priced product: `'⚠️ قیمت این محصول خودکار (از تأمین‌کننده) است؛ قیمت زمان‌دار برایش ممکن نیست.'`
  - a product that already has a pending or active schedule
- Register `psched_cancel_<id>` as an admin-only global callback (re-check `isAdmin`), and add `psched_\w+` to `STAGE_BYPASS_RE` in `src/store/supplierInput.ts`. All callback data must be ≤ 64 bytes.
- **Manual edits while a sale is active:** editing the price or the compare price mid-sale isn't blocked. Show a one-line warning on the card, `'⚠️ جشنواره‌ی این محصول فعال است؛ با تغییر دستی قیمت، برگشت خودکار انجام نمی‌شود.'`.

**Tests:**
- the full wizard
- validation errors at each step
- refusing auto products and duplicates
- cancelling a pending schedule
- cancelling an active schedule (the price reverts)
- a forged `psched_cancel_` from a non-admin is ignored
- the card summary line

After P2, add a short Persian section to `README.md` about «⏰ قیمت زمان‌دار».

## 4. Milestones
| Milestone | Content | Commit message |
|---|---|---|
| P0 | §1 schema | `price schedules: schema 0007` |
| P1 | §2 cron | `price schedules: apply and revert on time` |
| P2 | §3 admin UI + README | `price schedules: admin button` |

**When done, reply with:**
- per milestone: commit hash and tests passed/skipped
- every deviation from this plan
- anything unfinished
