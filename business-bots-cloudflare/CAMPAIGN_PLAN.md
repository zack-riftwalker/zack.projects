# Store Bot: Black Friday Campaign Features (round 4)

> **Audience:** an implementing agent (Claude Code) working in this repo, plus the owner (Zakaria).
> **Where this file goes:** `business-bots-cloudflare/CAMPAIGN_PLAN.md`, next to `PLAN.md`, `FEATURES_PLAN.md` and `SUPPLIER_PLAN.md`.
> **Deadline:** the campaign's VIP pre-sale starts **Wednesday 4 Azar 1405 (25 Nov 2026) 20:00 Tehran**. The public sale starts **Thursday 5 Azar (26 Nov) 20:00 Tehran**. Milestones are ordered by value. Each one can be deployed on its own. If time runs out, stop after any milestone that is finished and green.
> Implement exactly this plan. If something in it is impossible or wrong against the current code, stop and tell the user. Don't silently pick a different design.

---

## خلاصه برای زکریا (فارسی)

### این دور چه چیزهایی اضافه می‌شود
VPN هدیه را خودت دستی تحویل می‌دهی، برای همین در این طرح نیست. بقیه‌ی چیزهایی که برای جشنواره کم داشتیم:

| # | فیچر | به چه دردی می‌خورد |
|---|---|---|
| ۱ | **هدیه برای دوستِ دعوت‌شده (دعوت دوطرفه)** | الان فقط معرف جایزه می‌گیرد. از این به بعد دوستِ دعوت‌شده هم با اولین خرید تأییدشده‌اش یک محصول رایگان (مثلاً «VPN ۵ گیگ») می‌گیرد. سفارش رایگانش مثل بقیه‌ی سفارش‌ها در صف تحویل منشی می‌آید و تو دستی تحویلش می‌دهی. |
| ۲ | **لینک منبع** (`?start=src_نام`) | به هر کانال همکار یک لینک جدا می‌دهی. در گزارش فروش می‌بینی هر کانال چند مشتری جدید آورد و آن مشتری‌ها چقدر خرید کردند. |
| ۳ | **یادآوری سبد نیمه‌کاره** | اگر کسی شرایط را قبول کرد و شماره کارت را دید ولی تا یک ساعت رسید نفرستاد، ربات یک بار (فقط یک بار) یادآوری می‌فرستد. شب‌ها (۰۰ تا ۰۸) چیزی نمی‌فرستد. از تنظیمات فروشگاه روشن/خاموش می‌شود. |
| ۴ | **زمان‌بندی اطلاعیه** | اطلاعیه را الان می‌نویسی و برای مثلاً «امروز ۱۹:۴۵» زمان‌بندی می‌کنی. لیست اطلاعیه‌های زمان‌بندی‌شده و دکمه‌ی لغو هم دارد. |
| ۵ | **زمان شروع برای کد تخفیف** | کد را از قبل می‌سازی ولی از ساعتی که تعیین کردی فعال می‌شود. قبل از آن، مشتری پیام «هنوز فعال نشده» می‌گیرد. |
| ۶ | **مخاطب «همه‌ی خریدارها»** | یک گزینه‌ی جدید در اطلاعیه: هر کسی که حداقل یک خرید پولی تأییدشده دارد. برای پیش‌فروش VIP. |
| ۷ | **درآمد هر کد تخفیف** | در صفحه‌ی هر کد و در گزارش فروش، تعداد سفارش و درآمد هر کد نشان داده می‌شود. |
| ۸ | **قیمت قبل از تخفیف** | برای هر محصول می‌توانی «قیمت عادی» بگذاری. مشتری می‌بیند: «قیمت عادی: X ← قیمت ویژه: Y (Z٪ تخفیف)». |

### بعد از پیاده‌سازی، کار تو
1. مایگریشن و دیپلوی را Claude (سشن اصلی) با بکاپ قبلی انجام می‌دهد، نه سشن پیاده‌سازی.
2. **پنل دعوت:** «🎁 هدیه‌ی دوستِ دعوت‌شده» را روی محصول «VPN ۵ گیگ» بگذار (اول این محصول را با قیمت دلخواه بساز. قیمتش برای هدیه مهم نیست، سفارش هدیه ۰ تومانی است).
3. **📢 اطلاعیه‌ها:** در همان صفحه‌ی اول (انتخاب مخاطب) دکمه‌ی «🛒 یادآوری سبد نیمه‌کاره» را روشن کن.
4. **لینک منبع:** از پنل «🔗 لینک منبع» برای هر کانال همکار یک لینک بساز (مثلاً `partnera`).
5. **چک‌لیست تست، سه‌شنبه شب** (با یک اکانت دوم که ادمین نیست):
   - [ ] با لینک منبع `/start` بزن و یک خرید کامل کن. در گزارش فروش زیر همان منبع بیاید.
   - [ ] یک محصول را تا مرحله‌ی شماره کارت ببر، رسید نفرست و یک ساعت صبر کن. یادآوری بیاید، فقط یک بار.
   - [ ] یک کد با زمان شروع ۱۰ دقیقه بعد بساز. قبلش پیام «هنوز فعال نشده» بیاید، بعدش کار کند.
   - [ ] یک اطلاعیه برای ۵ دقیقه بعد زمان‌بندی کن و فقط به خودت بفرست («خریداران یک محصول» که فقط خودت خریده‌ای). سر وقت برسد. یکی دیگر زمان‌بندی کن و لغوش کن.
   - [ ] اکانت سوم با لینک دعوت اکانت دوم وارد شود و خرید کند. هر دو سفارش رایگان هدیه (معرف و دعوت‌شده) در صف تحویل بیایند.

### روش دادن به Claude Code
این فایل را در پوشه‌ی `business-bots-cloudflare/` بگذار، Claude Code را داخل ریپو باز کن و بنویس:
> فایل `business-bots-cloudflare/CAMPAIGN_PLAN.md` را بخوان و milestone به milestone پیاده کن. بعد از هر milestone تست‌ها را اجرا کن و commit بزن.

---

## 0. Ground rules for the implementer

1. **Work only inside `business-bots-cloudflare/`.** Read `PLAN.md` §3 (free-plan budget rules R1–R7) and §18 (pitfalls), and `FEATURES_PLAN.md` §0, first. They apply to every line you write.
2. **The code in `src/` is the source of truth.** This plan was written against `main`; the branch you work on (`business-bots-cloudflare`, from merge commit `69ba048`) is `main` + the Eitaa work, and §0.5 below records what was re-checked against it. If the code has moved, follow the code and adapt this plan's details, not the other way round. Names quoted below (`createRewardOrder`, `onPurchaseConfirmed`, `issueReward`, `processBroadcastBatch`, `validateDiscountCodeRecord`, `REF_PAYLOAD_RE`, `upsertCustomer`, `sendDiscountPrompt`, `optionButtonLabel`, `AUDIENCE_RE`, `parseJalaliDateTime`, `tehranDateTime`, `formatJalaliDateTime`, `getBotInfo`) exist today. Verify each before you use it.
3. **Existing behavior stays the same unless this plan changes it.** Keep every existing Persian string, callback-data string and step order, except where a section below explicitly replaces them. New Persian strings: use the exact text given here. Where no text is given, write short, polite Persian in the same style (emoji + one line). Use only the Persian characters ی and ک.
4. **Budget (R1):** every Telegram call, Gemini call and D1 statement costs 1 from the 50-unit per-invocation budget. Any new loop over recipients must check `budget.remaining()` and stop early, leaving the rest for the next cron tick. Keep normal updates ≤ 35. `test/setup.ts` already fails any test whose invocation exceeds 50.
5. **Indexes (R4):** add every new hot query to `test/indexes.test.ts`, and the new table `checkout_drafts` to that test's `BIG` list.
6. **SQL:** plain positional `?` placeholders only. Never `bind(undefined)`. Never interpolate user input into SQL. New audience / payload strings are parsed with strict regexes.
7. **Times:** local Tehran times are stored as `'YYYY-MM-DD HH:MM:SS'` strings, comparable to `datetime('now', '+03:30')`, exactly like `discount_codes.expires_at`. Reuse `tehranDateTime`, `parseJalaliDateTime` and `formatJalaliDateTime` from `src/lib/time.ts`. Don't add a new date format.
8. **Plain text** (no `parse_mode`) for any new message that contains product names, customer names or codes, unless you escape them with the existing helper.
9. Before every commit run `npm run typecheck && npm test`. Both must pass. One commit per milestone (§10). Push to the branch your session tells you to use. Don't open a PR unless the user asks.
10. Don't run `npm run setup`, `wrangler deploy` or any remote D1 command. Code and tests only. Push after each milestone (§0.5).
11. Every new feature gets tests in `test/store/` (use the existing helpers in `test/helpers/`: `fakeTelegram`, `fakeD1`, `seed`, `updates`, `env`). The test cases each section requires are listed at its end.

## 0.5 Verified against this branch (22 Nov 2026), read before C0

These notes override the sections below where they differ.

**Base and baseline**
- Work on branch `business-bots-cloudflare`, starting at commit `69ba048`: `main` (supplier API) merged with the Eitaa work.
  - Baseline: `npm run typecheck` is clean. `npx vitest run` gives 781 passed, 1 skipped (70 files).
  - Every milestone must keep all of those green.
- Store migrations on this branch are `0001`–`0004`, so the new file `0005_campaign.sql` is correct. Production already has `0001`–`0004` applied.
- **Don't touch** `src/monshi/**`, `src/monshi/eitaa/**`, `migrations/monshi/**` or the supplier engine (`src/store/suppliers/**`), except where a section below names a function.

**Cron budget (the real numbers)**
- `runCron` (`src/cron.ts`) runs these in order, sharing one 50-unit budget:
  1. `pollEitaa` first. It may stop early to leave ~15 units for the store jobs.
  2. The store jobs: `stalled-orders` at `%10==0`, `referral-rewards` at `%10==5`, `reminders` at 11:xx.
  3. Then `supplier-orders`, `supplier-sync` and `broadcast` (`reserve: 2`).
- Put `cart-reminders` inside the first `if (apps.store)` block after the referral sweep, guarded by `t.minute % 10 === 7`.
- `sendCartReminders` must work correctly with as little as ~12 units left. Follow `sendReminders` in `src/store/scheduler.ts`:
  - Use a `RESERVE` constant.
  - Check `if (budget.remaining() <= RESERVE + 2) break;` before each row (one send plus the order-exists check).
  - Do the batched `reminded = 1` update once at the end.

**Anchors (file:line on this branch)**
- `/start`: `src/store/bot.ts` ~l.110. `const upserted = await ctx.app.db.upsertCustomer({...})`, then `REF_PAYLOAD_RE.exec(payload)` and `handleRefStart(..., upserted.changes === 1)`. Put the `src_` block next to it in the same try/log style.
- `onPurchaseConfirmed(app, order: { id, customer_telegram_id, price })`: `src/store/referrals.ts:78`. Callers:
  - `storefront.ts` ~l.926 (receipt confirm)
  - `manualPurchases.ts:130` (manual link)
- `issueReward`: `referrals.ts:143`. Its product branch (`isSupplierOption` → `markRewardForApproval`, else `storeOrderPaid` + `notifyAdmins`) is what §2.2 extracts into `deliverFreeProductOrder`. `grantBudgetNeeded = 16 + adminIds.length`.
- `db.qualifyReferral(id, orderId)` → boolean (`src/store/db.ts:669`). `db.createRewardOrder` is at `db.ts:710`.
- **Broadcast queue:** the job is picked by `db.getRunningBroadcast()` (`db.ts:812`), not inside `processBroadcastBatch`.
  - `processBroadcastBatch` calls it twice: before the lease, and again under it.
  - Change `getRunningBroadcast(nowLocal: string)` to the §5.1 filter `status='running' AND cancelled=0 AND (send_after IS NULL OR send_after <= ?) ORDER BY id LIMIT 1`, and pass `tehranDateTime(app.apps.now())` at both call sites.
  - Grep for other callers and update them too.
- `enqueueBroadcast(p)` is at `db.ts:799`. Add `sendAfter?: string | null`.
- `countAudience` is at `db.ts:794`.
- Time helpers in `src/lib/time.ts`:
  - `tehranDateTime(date: Date)` returns `'YYYY-MM-DD HH:MM:SS'`. Always pass `app.apps.now()`, never `new Date()`, so tests can fake the clock.
  - `parseJalaliDateTime(text)` accepts `YYYY/MM/DD HH:MM` (or `-`, Persian or English digits) and returns the same local string or null.
  - `formatJalaliDateTime(s)`.
- Discount validation: `validateDiscountCodeRecord` in `src/store/handlers/discountCodes.ts`.
  - The reason labels map is `DISCOUNT_ERROR_LABEL` (l.22). Add `not_started` there.
  - The comment at l.37 says some checks run "at code entry only". Reuse that same switch for the start-time check, so `validateDiscountCodeForOrder` (l.80) skips it.
  - `db.createDiscountCode` (`db.ts:548`) already takes `productGroupId`. Add `startsAt?: string | null` next to it.
- Storefront drafts (`src/store/handlers/storefront.ts`):
  - `receiptDraft(ctx)` l.35 (drops an expired draft)
  - `cust_agree_` l.460 (draft set at ~l.476)
  - `cust_decline_` l.499
  - receipt `createOrder` ~l.564
  - **Don't** create a checkout draft in `onReupload` (~l.758, re-sending a receipt after a rejection), because that order already exists.
  - The manual link claim is `handleManualPurchaseStart` in `src/store/handlers/manualPurchases.ts:89`.
- Product options: `optionButtonLabel(p)` is at `src/store/catalog.ts:51`, used for group options at `storefront.ts:342` with `cust_prod_<id>`. `sendDiscountPrompt` is at `storefront.ts:78`. Put `priceLines` in `catalog.ts`.
- Sales report: `PROFIT_SQL` in `src/store/handlers/salesReport.ts:26` is the pattern to copy (exported object of SQL strings, run with `...range`).
  - Export the new SQL as `CAMPAIGN_SQL = { sources, codes }`.
  - Add both to `test/indexes.test.ts`, which `EXPLAIN QUERY PLAN`s and asserts no full scan of the tables in `BIG`.
  - Add `checkout_drafts` to `BIG`.
- Audiences: `src/store/audience.ts` (`AUDIENCE_RE`, `audienceFilter`, `AUDIENCE_LABEL`).
- kv flag: `app.kv.get(key)` / `app.kv.set(key, value)` (`src/store/kv.ts`, cached per request).
- Wizard routing: callbacks that must work while an admin is inside any wizard go in `STAGE_BYPASS_RE` in `src/store/supplierInput.ts:12`. Add `ann_sched_cancel_\d+` there. New reply-keyboard panel labels go in `LABEL` in `src/store/handlers/adminPanel.ts`, which feeds `ADMIN_PANEL_LABELS` and the panel keyboard layout.

**6. Decisions where the original plan didn't match the code**
- **Cart-reminder toggle (§4.3) and the scheduled list (§5.3):** `storeSettings.ts` is only the card-number wizard, with no settings view. The `📢 اطلاعیه‌ها` button enters `announce-wizard` directly, with no menu.
  - **Placement:** add two rows at the bottom of the wizard's first keyboard (`AUDIENCE_KB`, above `❌ انصراف`):
    1. `'🗓 اطلاعیه‌های زمان‌بندی‌شده'` (`ann_sched_list`): sends the §5.3 list as a new message and leaves the scene.
    2. `'🛒 یادآوری سبد نیمه‌کاره: ' + (on ? '✅ روشن' : '⛔️ خاموش')` (`ann_cart_toggle`): flips the kv flag, then `editMessageReplyMarkup` with the new label and stays on the same step, so the admin can still pick an audience.
  - Because the label depends on the flag, `AUDIENCE_KB` becomes a function `audienceKb(cartOn)`.
  - Register `ann_sched_cancel_<id>` with a global `bot.callbackQuery` in an admin-guarded register function, not inside the wizard.
- **Source link (§3.2):** a new reply-keyboard button `'🔗 لینک منبع'` in `LABEL`, placed in its own row (or next to `manualPurchase`). It opens a small `WizardScene` (`source-link-wizard`), registered in the `Stage([...])` list in `bot.ts`, that asks for the name.
  - Get the bot username from `ctx.me.username`, which grammY already has. Don't make an extra `getBotInfo` call.
- **The invitee-gift picker (§2.1):** copy how `referralPanel.ts` picks `productId` for the referrer's product reward, including its callback prefix style under `ref_adm_`, so it's already covered by `STAGE_BYPASS_RE`.

**Other constraints**
- Callback data must stay ≤ 64 bytes, and every new callback handler re-checks `isAdmin`. Callback data is forgeable.
- Each new test file uses the existing helpers. Look at `test/store/referral.test.ts`, `announce.test.ts`, `cron.test.ts` and `report.test.ts` first and copy their setup.
- `test/setup.ts` fails any invocation over 50 units. Add one test where a cron tick has the cart reminders due **and** a running broadcast, and check that both make progress over two ticks.
- **Commit and push after every milestone:**
  - Run `git push -u origin business-bots-cloudflare`, retrying network errors up to 4 times with backoff.
  - Never force-push.
  - If the push is rejected, run `git fetch origin business-bots-cloudflare && git merge --no-edit FETCH_HEAD`, rerun the tests, then push.
- **Never** deploy, run `wrangler`, touch remote D1, or open a PR. The main session reviews, backs up and deploys.
- When done, reply with this report:
  - one line per milestone: commit hash, tests passed/skipped
  - any place you had to deviate from this plan, and why
  - anything left unfinished

---

## 1. Schema (milestone C0)

Create **one new migration file**: `migrations/store/0005_campaign.sql`. Never edit 0001–0004. D1 supports `ALTER TABLE … ADD COLUMN` only, so don't try to change CHECK constraints.

```sql
-- ============================================================
--  Round-4: Black Friday campaign features (see CAMPAIGN_PLAN.md)
-- ============================================================

-- §2 double-sided referral: the invitee's own free gift
ALTER TABLE referrals ADD COLUMN invitee_reward_eligible INTEGER NOT NULL DEFAULT 0; -- 1 = qualified while an invitee gift was configured
ALTER TABLE referrals ADD COLUMN invitee_reward_order_id INTEGER;                    -- NULL = not issued; -1 = claimed / being issued

-- §3 source links (?start=src_<name>): first touch only
ALTER TABLE customers ADD COLUMN source TEXT;

-- §4 abandoned checkout reminder
CREATE TABLE IF NOT EXISTS checkout_drafts (
  customer_telegram_id INTEGER PRIMARY KEY,
  product_id           INTEGER NOT NULL,
  product_name         TEXT    NOT NULL,
  price                REAL    NOT NULL,
  created_at           TEXT    NOT NULL,             -- local Tehran 'YYYY-MM-DD HH:MM:SS'
  reminded             INTEGER NOT NULL DEFAULT 0
);

-- §5 scheduled announcements
ALTER TABLE broadcast_jobs ADD COLUMN send_after TEXT;                    -- NULL = send now; local Tehran time
ALTER TABLE broadcast_jobs ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0; -- cancelled jobs are status 'done' + cancelled 1

-- §6 discount code start time
ALTER TABLE discount_codes ADD COLUMN starts_at TEXT;                     -- NULL = active immediately; local Tehran time

-- §9 compare-at price
ALTER TABLE customer_products ADD COLUMN compare_at_price INTEGER;        -- Toman; shown only when > price

CREATE INDEX IF NOT EXISTS idx_customers_source_created ON customers(source, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_due               ON checkout_drafts(reminded, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_code_status       ON orders(discount_code_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_status_after   ON broadcast_jobs(status, send_after);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee_gift   ON referrals(invitee_reward_eligible, invitee_reward_order_id);
```

Update the TypeScript row types in `src/store/db.ts` (`Customer`, `CustomerProduct`, `DiscountCode`, the broadcast job type, the referral type) with the new optional fields. Update `scripts/sqlite_to_d1.py` only if it lists columns explicitly. If it copies whatever exists, leave it.

**Tests:** extend the existing migration test so 0005 applies cleanly on top of 0001–0004 and the new columns default as above.

---

## 2. Double-sided referral: a gift for the invitee (milestone C1)

**Today:** `onPurchaseConfirmed` qualifies the referral, and `tryGrantRewards` / `issueReward` reward only the referrer (discount code or free product).
**New:** optionally, the **invitee** also gets one free product order when their first qualifying purchase is confirmed. Delivery uses the normal flow (monshi «being prepared» message, delivery button, 20 h stalled alert), so the owner delivers it by hand like any other order.

### 2.1 Config
- `ReferralConfig` (`src/store/referralConfig.ts`) gets `inviteeProductId: number | null`, default `null` (= off). Add it to `DEFAULT_REFERRAL_CONFIG`.
- `referralConfigProblem`: if `inviteeProductId` is set but that product isn't active, return `'⚠️ محصول هدیه‌ی دوستِ دعوت‌شده فعال نیست.'`.
- Referral panel (`src/store/handlers/referralPanel.ts`): add one row in the settings view, using the panel's existing product-picker pattern:
  - label: `'🎁 هدیه‌ی دوستِ دعوت‌شده: ' + (product ? '«' + product.name + '»' : 'خاموش')`
  - picking a product sets it. An extra button `'🚫 خاموش'` sets `null`.

### 2.2 Granting
1. In `onPurchaseConfirmed`, **right after** `qualifyReferral` succeeds and **before** `tryGrantRewards`: if `cfg.inviteeProductId !== null`, run
   `UPDATE referrals SET invitee_reward_eligible = 1 WHERE id = ? AND invitee_reward_order_id IS NULL`.
   (Eligibility is stamped at qualify time. Turning the option on later must **never** give gifts to people who qualified in the past.)
2. Then call a new `tryGrantInviteeGift(app, referralId)`:
   - Re-read the config. If `inviteeProductId` is null or the product is inactive, return. The row stays eligible. Log a warning.
   - Budget check like `tryGrantRewards` (`grantBudgetNeeded`). If short, return and let the cron sweep finish it.
   - **Claim atomically:** `UPDATE referrals SET invitee_reward_order_id = -1 WHERE id = ? AND invitee_reward_eligible = 1 AND invitee_reward_order_id IS NULL`. If `changes !== 1`, return (someone else is issuing it).
   - `orderId = await app.db.createRewardOrder({ customerTelegramId: invitee, product })`, then `UPDATE referrals SET invitee_reward_order_id = ? WHERE id = ?`.
   - **Delivery: reuse, don't copy.** Extract the product branch of `issueReward` (the `isSupplierOption` → `markRewardForApproval` path vs. the `storeOrderPaid` bridge path, plus the admin notify) into a shared helper, for example `deliverFreeProductOrder(app, { customerId, orderId, product, adminHeader })`. Call it from both `issueReward` and `tryGrantInviteeGift`. The referrer's behavior must not change. Its existing tests must still pass unchanged.
   - Customer message (plain text):
     `'🎁 چون با لینک دعوت دوستتان خرید کردید، یک «' + product.name + '» رایگان هدیه گرفتید!\nسفارش #' + orderId + ' ثبت شد و به‌زودی تحویل داده می‌شود.'`
   - Admin notify header: `'🎁 هدیه‌ی دوستِ دعوت‌شده صادر شد\n👤 مشتری: ' + invitee + '\n🏆 سفارش رایگان #' + orderId`, followed by the same tail the referrer reward uses (`— لطفاً تحویل دهید` or `— کارت تأیید خرید برایتان آمد`).
   - On an error after the claim: set `invitee_reward_order_id` back to `NULL` only if no order was created. If the order exists, keep it and notify admins like `issueReward` does on failure.
3. **Cron sweep:** extend `sweepReferralRewards` to also pick up to 3 rows `WHERE invitee_reward_eligible = 1 AND invitee_reward_order_id IS NULL` and call `tryGrantInviteeGift` for each. A row stuck at `-1` for more than 1 hour with no order is reset to `NULL` by the sweep. Use `referrals.qualified_at` for the age check.
4. **Guard:** reward orders have `price = 0`. Make sure a reward order can never itself qualify a referral or trigger another gift. `onPurchaseConfirmed` already returns when `price < minAmount`, but add an explicit `if (order.price <= 0) return;` at its top.

### 2.3 Customer-facing text
In the customer's «دعوت دوستان» screen (where the reward is described, see `referrals.ts` around the `body = …هدیه می‌گیرید` lines), when `inviteeProductId` is set and the product is active, append a line:
`'🤝 دوستتان هم با اولین خریدش یک «' + product.name + '» رایگان هدیه می‌گیرد.'`

**Tests (`test/store/referral.test.ts`):**
- off (`null`): behavior identical to today, no invitee order.
- on: invitee's first confirmed purchase → exactly one 0-Toman order for the invitee, `invitee_reward_order_id` set, invitee message sent, admin notified. The referrer reward still works as before.
- idempotency: calling `onPurchaseConfirmed` twice, or the cron sweep racing the direct call, produces one gift.
- retroactive guard: a referral qualified while the option was off, then the option is turned on and the sweep runs → no gift.
- budget short at confirm time → the sweep issues it on a later tick.
- a reward order (price 0) for the invitee doesn't trigger anything.

---

## 3. Source links: `?start=src_<name>` (milestone C2)

### 3.1 Capture
- In `src/store/referrals.ts` (next to `REF_PAYLOAD_RE`) or a new `src/store/source.ts`: `export const SRC_PAYLOAD_RE = /^src_([a-z0-9]{1,24})$/;`. Normalize the payload with `.toLowerCase()` before matching.
- In the `/start` handler (`src/store/bot.ts`), after `upsertCustomer`: if the payload matches and `upserted.changes === 1` (a brand-new customer), run
  `UPDATE customers SET source = ? WHERE telegram_id = ? AND source IS NULL`.
  First touch only: an existing customer opening a source link never changes their source. A failure here is logged and never blocks the welcome message, same as the ref block.
- `ref_` and `src_` are mutually exclusive (one payload). That's fine.

### 3.2 Admin: create a link
- Add a button `'🔗 لینک منبع'` to the admin panel (where the other panel entries live: `adminPanel.ts` / `bot.ts`).
- Flow: ask `'نام منبع را بنویسید (فقط حروف انگلیسی کوچک و عدد، حداکثر ۲۴ حرف). مثال: partnera'`. Validate with `/^[a-z0-9]{1,24}$/` after `.toLowerCase().trim()`. On invalid input, re-ask with `'⚠️ نام منبع نامعتبر است.'`.
- Reply (plain text): `'✅ لینک منبع «' + name + '»:\nhttps://t.me/' + botUsername + '?start=src_' + name + '\n\nمشتری‌هایی که با این لینک برای اولین بار وارد شوند، در گزارش فروش زیر همین منبع می‌آیند.'`. Get `botUsername` from `ctx.me.username` (see §0.5 item 6).
- No table of sources is needed. Sources exist when customers carry them.

### 3.3 Report
In `src/store/handlers/salesReport.ts`, add a section for the selected period (use the same `reportRange` bounds as the rest of the report):

```
🔗 منبع مشتری‌های جدید
• partnera: ۱۲ مشتری جدید، ۴ خریدار، ۳٬۴۰۰٬۰۰۰ ت
• (بدون منبع): ۳۰ مشتری جدید، ۵ خریدار، ۴٬۱۰۰٬۰۰۰ ت
```

- New customers = `customers.created_at` within the period, grouped by `COALESCE(source, '')`.
- Buyers / revenue = those customers' orders with `status IN ('confirmed','delivered') AND price > 0`, decided within the period.
- Top 10 sources by new customers. Show `(بدون منبع)` last. Omit the section when there are no new customers in the period.
- One aggregate query (a `GROUP BY` with a correlated or joined order sum). Export its SQL like `PROFIT_SQL` so the index test can `EXPLAIN` it.

**Tests:** new customer with `src_partnera` → `source='partnera'`. Existing customer with a source link → unchanged. `ref_…` still works. Invalid payload (`src_Bad-Name!`) ignored. Report groups and sums correctly, and excludes 0-Toman orders.

---

## 4. Abandoned checkout reminder (milestone C3)

**Today:** after `cust_agree_<id>`, the draft lives in `ctx.session.awaitingReceiptFor` (with `createdAt`, TTL `RECEIPT_DRAFT_TTL_MS` = 24 h). Nothing reminds the customer. Sessions are JSON in D1. **Do not scan the sessions table.** Track drafts in `checkout_drafts` instead.

### 4.1 Writes
- **`cust_agree_<id>`** (storefront, after `awaitingReceiptFor` is set): upsert the row:
  `INSERT INTO checkout_drafts (customer_telegram_id, product_id, product_name, price, created_at, reminded) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(customer_telegram_id) DO UPDATE SET product_id = excluded.product_id, product_name = excluded.product_name, price = excluded.price, created_at = excluded.created_at, reminded = 0`
- **Delete the row** (`DELETE FROM checkout_drafts WHERE customer_telegram_id = ?`) when:
  - a receipt order is created successfully (right after `createOrder` in the receipt handler),
  - the customer presses `cust_decline_<id>`,
  - `receiptDraft(ctx)` drops an expired draft,
  - a manual-purchase link is claimed by that customer.
  These deletes are best-effort (log on failure, never break the main flow). Each one costs 1 budget unit, so keep it to one statement.

### 4.2 Cron job
In `src/cron.ts`, inside the `apps.store` block, at `t.minute % 10 === 7`: `guarded('cart-reminders', () => sendCartReminders(store))`. Put `sendCartReminders` in `src/store/scheduler.ts`.

- Skip entirely when the kv flag `cart_reminder_enabled` (in `store_kv`) isn't `'1'`. **Default off.**
- Skip when the Tehran hour is in `00–07` (quiet hours). Drafts wait for 08:00. Their 24 h window still applies.
- Select up to 15 due rows:
  `SELECT * FROM checkout_drafts WHERE reminded = 0 AND created_at <= ? AND created_at >= ? ORDER BY created_at LIMIT 15`
  with bounds `now − 60 min` and `now − 23 h` (local Tehran strings via `tehranDateTime`).
- For each row (check `budget.remaining()` against a reserve, like `sendReminders`):
  - If the customer has any order with `created_at >= draft.created_at` (any status), delete the row and continue (they already paid or ordered).
  - Otherwise send (plain text):
    `'🛒 سفارش «' + product_name + '» نیمه‌کاره مانده!\n\nاگر پرداخت را انجام داده‌اید، همین‌جا عکس یا فایل رسید را بفرستید. اگر سؤالی دارید، به پشتیبانی پیام بدهید.'`
    with one inline button `Markup.button.callback('🛍 ادامه‌ی خرید', 'cust_prod_' + product_id)`.
  - Set `reminded = 1` **whether or not the send succeeded**, so a dead chat can't retry forever. Batch the updates, like `setOrderRemindersSent`.
- Housekeeping in the same job: `DELETE FROM checkout_drafts WHERE created_at < ?` (now − 48 h).
- Exactly one reminder per draft. A new `cust_agree` resets it, which is intended.

### 4.3 Toggle
**Placement changed, see §0.5 item 6** (there is no settings view in `storeSettings.ts`). Toggle button:
`'🛒 یادآوری سبد نیمه‌کاره: ' + (on ? '✅ روشن' : '⛔️ خاموش')` that flips `cart_reminder_enabled` between `'1'` and `'0'` and re-renders the settings view.

**Tests (`test/store/cartReminder.test.ts`):** agree → row created. Receipt → row deleted. Decline → deleted. Due row → one message with the `cust_prod_` button, `reminded=1`. Second tick → nothing. Order created after the draft → no message, row deleted. Quiet hours → nothing. Flag off → nothing. Budget exhausted mid-batch → the rest go out next tick. Rows older than 48 h purged. Add the select to `test/indexes.test.ts`.

---

## 5. Scheduled announcements (milestone C4)

### 5.1 Queue
- `enqueueBroadcast` accepts an optional `sendAfter: string | null` (local Tehran) and stores it in `send_after`.
- `processBroadcastBatch`: pick the oldest job with `status = 'running' AND cancelled = 0 AND (send_after IS NULL OR send_after <= ?)` (now, local). A future job must **not** block an older-due or newer immediate job. Keep the existing lease logic untouched.
- When a scheduled job sends its **first** batch (`cursor_customer_id = 0` and `send_after IS NOT NULL`), recompute `total` with `countAudience(audience)` and store it, since the audience may have changed since scheduling.
- The immediate `processBroadcastBatch(ctx.app, { reserve: 8 })` call in `announceWizard.ts` after confirmation stays. It simply finds nothing due for a scheduled job.

### 5.2 Wizard
In the confirmation step of `announceWizard.ts`, keep `'✅ بله، ارسال کن'` (`announce_confirm`, sends now, unchanged) and `'❌ خیر، انصراف'`. Add a third button `'⏰ زمان‌بندی ارسال'` (`announce_schedule`):
1. Ask: `'⏰ زمان ارسال را بنویسید (به وقت تهران)، مثلاً:\n۱۴۰۵/۰۹/۰۴ ۱۹:۴۵'`. Parse with the existing `parseJalaliDateTime` (accepts Persian or English digits; check its current accepted formats and reuse them as-is).
2. Reject past times (`'⚠️ این زمان گذشته است.'`) and times more than 14 days ahead (`'⚠️ حداکثر ۱۴ روز جلوتر.'`). Re-ask on error.
3. Enqueue with `sendAfter` and confirm: `'✅ اطلاعیه برای ' + formatJalaliDateTime(sendAfter) + ' زمان‌بندی شد (' + label + ').'`.

### 5.3 List and cancel
On the announce wizard's first message (the audience keyboard, which is the de facto entry menu, see §0.5 item 6), add `'🗓 اطلاعیه‌های زمان‌بندی‌شده'`:
- Lists up to 10 jobs `WHERE status = 'running' AND cancelled = 0 AND send_after > now` ordered by `send_after`: Jalali time, audience label, the first 40 characters of the text.
- Each has a button `'🗑 لغو'` (`ann_sched_cancel_<id>`) → `UPDATE broadcast_jobs SET cancelled = 1, status = 'done', finished_at = datetime('now', '+03:30') WHERE id = ? AND status = 'running' AND cursor_customer_id = 0`. If 0 rows changed: `'⚠️ ارسال این اطلاعیه شروع شده و دیگر قابل لغو نیست.'`.

**Tests:** a scheduled job isn't sent before its time and is sent after. A due immediate job isn't blocked by an earlier-created future job. `total` recomputed at start. Cancel before start works. Cancel after start refused. Past/too-far times rejected. Add the new select to `test/indexes.test.ts`.

---

## 6. Discount code start time (milestone C5)

- `validateDiscountCodeRecord` (`src/store/handlers/discountCodes.ts`): after the expiry check, if `starts_at` is set and `starts_at > now` → `{ ok: false, reason: 'not_started' }`. Add the reason message to the reasons map:
  `not_started: '⏳ این کد تخفیف هنوز فعال نشده است.'`. When showing it to the customer, append `' از ' + formatJalaliDateTime(starts_at) + ' قابل استفاده است.'`.
- `validateDiscountCodeForOrder` (used at confirm time) must **not** fail on `not_started`. The code was valid when the customer entered it. Make the start check apply only to customer entry.
- **Add-code wizard:** after the expiry step, ask `'⏰ کد از چه زمانی فعال شود؟'` with buttons `'▶️ از همین الان'` (→ `NULL`) and `'⏰ زمان مشخص'` (→ text input parsed by `parseJalaliDateTime`, must be in the future and before `expires_at`, else `'⚠️ زمان شروع باید قبل از انقضای کد باشد.'`).
- **Code detail view:** add a line `'▶️ شروع: ' + (starts_at ? formatJalaliDateTime(starts_at) : 'از ابتدا')`. In the **code list**, prefix not-yet-started codes with `⏳`.
- **Edit:** add `'⏰ تغییر زمان شروع'` with the same two options.
- `createDiscountCode` accepts an optional `startsAt`. Referral codes keep `NULL`.

**Tests:** entry before start → `not_started` message with the Jalali time. After start → OK. An order entered after start, confirmed later → fine. Start ≥ expiry rejected. Existing codes (`NULL`) unaffected.

---

## 7. Audience «همه‌ی خریدارها» (milestone C6, small)

- `src/store/audience.ts`: extend `AUDIENCE_RE` to `/^(all|active|expired|never|buyers_any|buyers:\d+|waitlist:\d+)$/`. Condition for `buyers_any`:
  `EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status IN ('confirmed', 'delivered') AND o.price > 0)`.
  Label: `buyers_any: 'همه‌ی خریدارها (هر محصولی)'`.
- `announceWizard.ts`: add the button `[Markup.button.callback('💎 همه‌ی خریدارها', 'ann_aud_buyers_any')]` after `'🛍 خریداران یک محصول'`. Extend the matcher `/^ann_aud_(all|active|expired|never)$/` to include `buyers_any`. **Careful:** the `buyers` product-picker branch checks `data === 'ann_aud_buyers'` (exact match). Keep it exact so `ann_aud_buyers_any` doesn't open the picker.

**Tests:** counts include paid confirmed/delivered buyers, and exclude never-bought customers and customers whose only orders are 0-Toman rewards. The wizard path works end to end. Add the audience count query to the index test.

---

## 8. Revenue per discount code (milestone C6, same commit as §7)

- **Code detail view** (`discountCodes.ts`, the view that already shows `'🔢 استفاده‌شده: …'`): add
  `'💰 درآمد: ' + formatPrice(sum) + ' تومان (' + fa(n) + ' سفارش)'` from
  `SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS sum FROM orders WHERE discount_code_id = ? AND status IN ('confirmed', 'delivered')`.
- **Sales report:** add a section for the period, top 10 codes by revenue:
  ```
  🎟 کدهای تخفیف
  • BF-GPT: ۱۴ سفارش، ۲۶٬۶۰۰٬۰۰۰ ت
  ```
  `SELECT d.code, COUNT(*) AS n, SUM(o.price) AS sum FROM orders o JOIN discount_codes d ON d.id = o.discount_code_id WHERE o.status IN ('confirmed','delivered') AND o.decided_at >= ? AND o.decided_at < ? GROUP BY o.discount_code_id ORDER BY sum DESC LIMIT 10`.
  Omit the section when empty. Export the SQL for the index test.

**Tests:** sums and counts correct. Rejected/pending orders excluded. Section omitted when empty.

---

## 9. Compare-at price (milestone C7, small)

- **Display rule** (one helper, e.g. `priceLines(product)` in `src/store/catalog.ts`): if `compare_at_price` is a number and `> price`:
  ```
  💰 قیمت عادی: {compare} تومان
  🔥 قیمت ویژه: {price} تومان ({percent}٪ تخفیف)
  ```
  with `percent = Math.round((1 - price / compare) * 100)` in Persian digits. Otherwise keep today's single line `'💰 قیمت: ' + formatPrice(price) + ' تومان'`.
  Use it in `sendDiscountPrompt`. **Don't** use strikethrough markup: the current messages use legacy `Markdown`, which has none.
- `optionButtonLabel`: when the rule applies, append `' 🔥'` to the existing label. Keep the button short.
- **Admin edit** (`customerProductsEdit.ts`): button `'🏷 قیمت قبل از تخفیف'`. Ask for a number (Persian or English digits) or `'حذف'`. Validate: an integer `> price`, else `'⚠️ قیمت قبل از تخفیف باید بیشتر از قیمت فعلی باشد.'`. `'حذف'` → `NULL`. The product detail view shows `'🏷 قیمت قبل از تخفیف: ' + (v ? formatPrice(v) + ' ت' : '—')`.
- If the price is later raised to ≥ `compare_at_price`, the display rule simply stops showing it. No automatic clearing.

**Tests:** shown only when greater than price. Percent correct. Button gets 🔥. Admin set/clear/validation.

---

## 10. Milestones (one commit each; `npm run typecheck && npm test` green before each)

| Milestone | Content | Commit message |
|---|---|---|
| C0 | §1 migration + types + migration test | `campaign: schema 0005` |
| C1 | §2 double-sided referral | `campaign: invitee gift for referrals` |
| C2 | §3 source links + report section | `campaign: source links` |
| C3 | §4 abandoned checkout reminder | `campaign: cart reminders` |
| C4 | §5 scheduled announcements | `campaign: scheduled announcements` |
| C5 | §6 discount code start time | `campaign: discount start time` |
| C6 | §7 + §8 audience and per-code revenue | `campaign: buyers audience + code revenue` |
| C7 | §9 compare-at price | `campaign: compare-at price` |

After the last milestone, add a short section to `README.md` (Persian, same style as the existing sections) describing the new admin buttons: 🔗 لینک منبع, 🛒 یادآوری سبد نیمه‌کاره, ⏰ زمان‌بندی ارسال / 🗓 اطلاعیه‌های زمان‌بندی‌شده, ⏰ زمان شروع کد, 🎁 هدیه‌ی دوستِ دعوت‌شده, 🏷 قیمت قبل از تخفیف.

## 11. Pitfalls checklist (read before coding)

- **Budget:** every new cron job and loop checks `budget.remaining()` with a reserve and resumes next tick. The cron tick already runs supplier work and the broadcast. Don't starve the broadcast (it keeps its `reserve: 2`). Put `cart-reminders` on minute `% 10 === 7` so it doesn't collide with stalled orders (`0`) and referral sweeps (`5`).
- **Idempotency:** every send-once flag (`reminded`, `invitee_reward_order_id`, `cancelled`) is claimed with a conditional `UPDATE … WHERE …` and checked via `changes`, never read-then-write.
- **No retroactive effects:** turning on the invitee gift or the cart reminder must not message or reward anyone for events before it was turned on (`invitee_reward_eligible` stamp. Drafts older than 23 h are never reminded).
- **Callback data ≤ 64 bytes:** `ann_sched_cancel_<id>` and `cust_prod_<id>` are fine. Check any new one.
- **Customer-facing messages stay polite and single.** At most one cart reminder per draft. No reminders 00:00–07:59 Tehran.
- **Plain text** for messages with product names or codes.
- Don't touch payment flow, card display, Stars or supplier logic beyond what's listed here.
