# Business Bots: New Features Plan (round 2)

> **Audience:** an implementing agent (e.g. Claude Sonnet) working in this repo, plus the owner (Zakaria).
> **Status:** features chosen by the owner. Defaults marked **(default)** were picked by the planner; the owner may change them before implementation starts.
> Implement exactly this plan. If something in it is impossible or wrong, stop and tell the user. Don't silently pick a different design.

---

## خلاصه برای زکریا (فارسی)

### فیچرهای انتخاب‌شده، دسته‌بندی‌شده

**دسته‌ی ۱: محصول و فروش (ربات فروشگاه)**
- **ویرایش محصول** (نام، قیمت، شرایط، مدت اشتراک، گارانتی) بدون حذف و ساخت دوباره، تا دکمه‌های «تمدید» قبلی خراب نشوند. *(ایده ۴)*
- **وضعیت «ناموجود»:** محصول در لیست با برچسب ناموجود دیده می‌شود ولی خریدنی نیست. مشتری می‌تواند «🔔 موجود شد خبرم کن» بزند. وقتی دوباره موجودش کنی، ربات به لیست انتظار خبر می‌دهد.
- **اطلاعیه‌ی هدفمند:** ارسال برای همه، مشترک‌های فعال، اشتراک‌تمام‌شده‌ها، خریدارهای یک محصول، یا کسانی که هنوز خرید نکرده‌اند. *(ایده ۹)*
- **دعوت دوستان (Referral) با تنظیمات کامل:** مثلاً «هر کس ۳ نفر دعوت کند و خریدشان تأیید شود، کد ٪۲۰ یا یک محصول رایگان بگیرد». تعداد، حداقل مبلغ خرید، نوع جایزه، اعتبار کد و تکرارپذیری را از پنل تنظیم می‌کنی. *(ایده ۱۷)*

**دسته‌ی ۲: رسید و سفارش (ربات فروشگاه)**
- **دلیل رد رسید** با دکمه‌های آماده یا متن دلخواه، و دکمه‌ی «📸 ارسال مجدد رسید» برای مشتری. *(ایده ۲)*
- **تشخیص رسید تکراری:** اگر همان فایل رسید قبلاً فرستاده شده باشد، روی رسید ادمین هشدار ⚠️ می‌آید. *(ایده ۳)*
- **«اشتراک‌های من» سفارش‌های در جریان را هم نشان می‌دهد:** در انتظار بررسی، تأییدشده و ردشده با دلیل. *(ایده ۵)*

**دسته‌ی ۳: گزارش (ربات فروشگاه)**
- **گزارش فروش:** امروز، ۷ روز، ۳۰ روز، ماه شمسی جاری و کل. شامل درآمد، پرفروش‌ها، رسیدهای منتظر، مشتری جدید و دعوت‌های موفق. *(ایده ۱)*

**دسته‌ی ۴: ربات منشی**
- **جدا کردن پیام‌ها با تاپیک:** چت تو با ربات منشی چهار تاپیک جدا پیدا می‌کند: 🔔 نیازمند پاسخ، 📦 سفارش‌ها، 📊 گزارش‌ها، ⚙️ سیستم. *(درخواست جدید)*
- **کارت مشتری:** زیر هر پیام ارجاعی، سابقه‌ی خرید و اشتراک فعال آن مشتری در ربات فروشگاه نوشته می‌شود. *(ایده ۷)*
- **جواب از داخل نوتیف:** روی پیام ارجاع Reply بزنی، جوابت از اکانت بیزینس برای مشتری می‌رود. چند دکمه‌ی «📚 ارسال FAQ» هم زیر نوتیف می‌آید. *(ایده ۸)*
- **یادگیری از جواب‌های خودت:** برای سؤال‌های بی‌جواب، جوابی که خودت دستی داده بودی پیدا و پیشنهاد می‌شود تا با یک دکمه FAQ شود. *(ایده ۱۳)*

### تصمیم‌هایی که من (برنامه‌ریز) گرفتم و می‌توانی عوضشان کنی
1. دعوت فقط برای **کاربر کاملاً جدید** حساب می‌شود (کسی که قبلاً ربات فروشگاه را استارت نزده)، و فقط وقتی **اولین خریدش تأیید شود**. ضد تقلب است.
2. جایزه‌ی دعوت دو نوع دارد: **کد تخفیف شخصی** (فقط برای خود معرف قابل استفاده است) یا **یک محصول رایگان** (یک سفارش تأییدشده‌ی ۰ تومانی که مثل بقیه‌ی سفارش‌ها از مسیر منشی تحویل داده می‌شود).
3. جواب دادن از داخل نوتیف (ایده ۸) هم برای تو و هم برای اکانت‌های نوتیف (`MONSHI_NOTIFY_USER_IDS`) فعال است، و بعد از جواب، ربات مثل جواب دستی برای آن چت ۴ ساعت ساکت می‌شود.
4. تاپیک‌ها فقط برای **ربات منشی** است. ربات فروشگاه با مشتری‌ها چت خصوصی دارد و روشن کردن حالت تاپیک، چت مشتری‌ها را هم تاپیکی می‌کند. برای همین آن را دست نمی‌زنیم.
5. تشخیص رسید تکراری فقط **همان فایل** را می‌گیرد. اگر کسی از رسید دوباره اسکرین‌شات بگیرد، فایل جدید حساب می‌شود و تشخیص داده نمی‌شود.

### کاری که خودت باید بکنی (بعد از پیاده‌سازی)
- `npm run db:migrate:remote` و بعد `npm run deploy` (یا دوباره `npm run setup`).
- برای تاپیک‌ها: در @BotFather، برای **ربات منشی** حالت تاپیک (Threaded Mode / Topics) را روشن کن. بعد در ربات منشی: ⚙️ تنظیمات ← «🗂 دسته‌بندی پیام‌ها».

---

## 0. Ground rules for the implementer

1. **Work only inside `business-bots-cloudflare/`.** Read `PLAN.md` §3 (free-plan budget rules R1–R7) and §18 (pitfalls) first. They still apply to every line you write.
2. The legacy zip is **not** needed. The code in `src/` is the source of truth now. This plan was written against commit `46ebcd3` (receipt-draft TTL, broadcast lease, atomic discount redemption, wizard `bypass`/`exit` options are already in). If the code has moved further, follow the current code and adapt the plan's details, not the other way round.
3. **Existing behavior stays the same unless this plan changes it.** Keep every existing Persian string, callback-data string and step order, except where a section below explicitly replaces them. New Persian strings: use the exact text given here. Where this plan doesn't give a text, write short, polite Persian in the same style (emoji + one-line summary) and use only the Persian characters ی and ک.
4. **Budget (R1):** every Telegram call, Gemini call and D1 statement costs 1 from a 50-unit budget per invocation. Any new loop over recipients must check `budget.remaining()`. Keep normal updates ≤ 35. `test/setup.ts` already fails any test whose invocation exceeds 50.
5. **Indexes (R4):** add every new hot query to `test/indexes.test.ts`. Add the new big tables (`referrals`, `referral_rewards`, `product_waitlist`, `notify_links`) to that test's `BIG` list.
6. SQL: plain positional `?` placeholders only. Never `bind(undefined)`. Never interpolate user input into SQL. Audience and kv strings are parsed with strict regexes (see §3).
7. Before every commit run `npm run typecheck && npm test`. Both must pass. One commit per milestone (§13). Push to the branch your session tells you to use. Don't open a PR unless the user asks.
8. Don't run `npm run setup`, `wrangler deploy` or any remote D1 command. Code and tests only.
9. Plain-text messages (no `parse_mode`) whenever the text contains product names, customer names or FAQ text, unless you escape them with `escapeMarkdown`. Prefer plain text in new code.

---

## 1. Schema changes (milestone F1)

Add **two new migration files**. Never edit `0001_*.sql` or `0002_seed_settings.sql`.

### 1.1 `migrations/store/0002_features.sql`

```sql
-- ============================================================
--  Round-2 features (see FEATURES_PLAN.md)
-- ============================================================

-- Out of stock ≠ deleted: is_active=0 hides a product, is_available=0 shows it as «ناموجود».
ALTER TABLE customer_products ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;

-- Receipt review: reject reason + duplicate-receipt detection.
ALTER TABLE orders ADD COLUMN reject_reason TEXT;
ALTER TABLE orders ADD COLUMN receipt_unique_id TEXT;

-- Discount codes that only one customer may use (referral rewards).
ALTER TABLE discount_codes ADD COLUMN owner_telegram_id INTEGER;
ALTER TABLE discount_codes ADD COLUMN source TEXT NOT NULL DEFAULT 'admin';   -- 'admin' | 'referral'

-- Personal referral code (generated lazily).
ALTER TABLE customers ADD COLUMN ref_code TEXT;

-- Broadcast audiences + an optional inline keyboard (JSON) on every message.
ALTER TABLE broadcast_jobs ADD COLUMN audience TEXT NOT NULL DEFAULT 'all';
ALTER TABLE broadcast_jobs ADD COLUMN reply_markup TEXT;

-- Generic key/value settings (referral program config lives under key 'referral').
CREATE TABLE IF NOT EXISTS store_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+03:30'))
);

-- «🔔 موجود شد خبرم کن»
CREATE TABLE IF NOT EXISTS product_waitlist (
  product_id           INTEGER NOT NULL,
  customer_telegram_id INTEGER NOT NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  PRIMARY KEY (product_id, customer_telegram_id)
);

-- One row per invited customer. invitee is UNIQUE: a person can be invited only once.
CREATE TABLE IF NOT EXISTS referrals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_telegram_id INTEGER NOT NULL,
  invitee_telegram_id  INTEGER NOT NULL UNIQUE,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  qualified_at         TEXT,              -- set when the invitee's first qualifying purchase is confirmed
  qualifying_order_id  INTEGER,
  reward_id            INTEGER            -- set when this referral was "spent" on a reward
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_telegram_id INTEGER NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'failed')),
  reward_type          TEXT    NOT NULL CHECK (reward_type IN ('discount', 'product')),
  discount_code_id     INTEGER,
  order_id             INTEGER,
  config_snapshot      TEXT    NOT NULL,  -- JSON of the referral config at grant time
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  issued_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_receipt_unique   ON orders(receipt_unique_id);
CREATE INDEX IF NOT EXISTS idx_customers_created       ON customers(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_ref_code ON customers(ref_code);
CREATE INDEX IF NOT EXISTS idx_discount_source         ON discount_codes(source, id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer      ON referrals(referrer_telegram_id, id);
CREATE INDEX IF NOT EXISTS idx_referrals_created       ON referrals(created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_qualified     ON referrals(qualified_at);
CREATE INDEX IF NOT EXISTS idx_referrals_unrewarded    ON referrals(referrer_telegram_id) WHERE qualified_at IS NOT NULL AND reward_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rewards_referrer        ON referral_rewards(referrer_telegram_id, id);
CREATE INDEX IF NOT EXISTS idx_waitlist_customer       ON product_waitlist(customer_telegram_id);
```

### 1.2 `migrations/monshi/0003_features.sql`

```sql
-- Which customer message an unanswered entry came from (to find the owner's own reply later).
ALTER TABLE unanswered ADD COLUMN last_message_row_id INTEGER;

-- Maps a notification message in a staff chat to the customer it is about (reply-from-notification).
CREATE TABLE IF NOT EXISTS notify_links (
  recipient_chat_id     INTEGER NOT NULL,
  message_id            INTEGER NOT NULL,
  customer_chat_id      INTEGER NOT NULL,
  created_at            TEXT    NOT NULL,
  PRIMARY KEY (recipient_chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_notify_links_created ON notify_links(created_at);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('topics_enabled', '0'),
  ('reply_bridge_pause', '1');
```

### 1.3 Other F1 work
- `scripts/sqlite_to_d1.py`: `test/migration.test.ts` compares the script's hard-coded target columns with the migrated schema. Add the new columns to `STORE_TABLES` / `MONSHI_TABLES`: `customers.ref_code`, `customer_products.is_available`, `discount_codes.owner_telegram_id`, `discount_codes.source`, `orders.reject_reason`, `orders.receipt_unique_id`, `unanswered.last_message_row_id`. Legacy DBs don't have them, so the script already skips them and the defaults apply. Fix the comment `must match migrations/*/0001_init.sql` to say `migrations/*/*.sql`.
- Update the TypeScript row interfaces (`CustomerProduct`, `Order`, `DiscountCode`, `BroadcastJob` in `src/store/db.ts`, and `UnansweredRow` in `src/monshi/db.ts`) with the new fields.
- `getAllActiveCustomerProducts()` and `getCustomerProductById()` must also select `is_available`.
- `test/helpers/fakeTelegram.ts` canned responses (needed later; add now): `createForumTopic` → `{ message_thread_id: ++mid, name: payload.name, icon_color: payload.icon_color ?? 0x6FB9F0 }`. `sendPhoto`/`sendDocument`/`sendVideo`/`sendVoice`/`sendAudio`/`sendAnimation`/`sendSticker` → same shape as `sendMessage`.
- Tests: migration test green; `indexes.test.ts` gains the `BIG` tables listed in §0.5.

---

## 2. Shared helpers (milestone F1, used later)

### 2.1 `src/store/kv.ts`: per-request key/value cache (rule R2)
```ts
export class StoreKv {
  constructor(private db: Db) {}
  private map?: Map<string, string>;
  async get(key: string): Promise<string | null>          // first call loads ALL rows in one query: SELECT key, value FROM store_kv
  async set(key: string, value: string): Promise<void>     // upsert + update the cache
}
```
Add `kv: StoreKv` to `StoreApp` in `src/apps.ts` (constructed with the counted `raw` db).

### 2.2 `src/store/referralConfig.ts`
```ts
export interface ReferralConfig {
  enabled: boolean;
  required: number;          // qualified invites per reward (1..50)                    default 3
  minAmount: number;         // invitee's confirmed order price must be ≥ this (Toman)   default 0
  reward: 'discount' | 'product';                                                      // default 'discount'
  discType: 'percent' | 'fixed';                                                       // default 'percent'
  discValue: number;         // 1..100 for percent, > 0 for fixed                       default 20
  discProductId: number | null;                                                         // default null
  discValidDays: number;     // 1..365                                                  default 30
  productId: number | null;  // free product for reward='product'                      default null
  repeatable: boolean;       // every N invites → another reward; false = one reward max  default true
}
export const DEFAULT_REFERRAL_CONFIG: ReferralConfig;
export async function getReferralConfig(app: StoreApp): Promise<ReferralConfig>;   // JSON.parse(kv 'referral') merged over defaults; corrupt JSON → defaults + console.error
export async function setReferralConfig(app: StoreApp, cfg: ReferralConfig): Promise<void>;
export function referralConfigProblem(cfg: ReferralConfig, products: CustomerProduct[]): string | null;
// returns a Persian reason when the program can't be enabled, e.g. no reward product chosen or the product is inactive
```

### 2.3 Customer reply keyboard becomes config-aware
Reply keyboards replace each other, so every place that sends the customer keyboard must send the same one. Replace `customerStorefrontKeyboard()` with:
```ts
export async function customerKeyboard(app: StoreApp) // [[🛍 لیست محصولات, 📋 اشتراک‌های من]] + [[🎁 دعوت دوستان]] when referral is enabled
```
Update every call site (`store/bot.ts` /start and /panel, `manualPurchases.ts` ×5). It costs one D1 read per request, then it's cached. Keep `customerStorefrontKeyboard()` exported as the 2-button version only if a test still needs it. Otherwise remove it.

### 2.4 Admin reply keyboard (final layout, built up across milestones)
```
[📢 اطلاعیه‌ها]       [📊 گزارش فروش]
[➕ افزودن محصول]     [✏️ ویرایش محصول]
[🗑 حذف محصول]        [🎟 کد تخفیف]
[💳 شماره کارت]       [🎁 دعوت دوستان]
[🛒 ثبت خرید مشتری]
```
Labels live in `adminPanel.ts` `LABEL`. Add each button in the milestone that implements it. The customer label «🎁 دعوت دوستان» is the same text as the admin one. Dispatch by `isAdmin` inside the one `bot.hears` handler. Update `test/store/purchase.test.ts` (keyboard length).

---

## 3. Targeted announcements (milestone F2, idea 9)

### 3.1 Audiences
Audience is a string stored in `broadcast_jobs.audience`. Allowed values (validate with `/^(all|active|expired|never|buyers:\d+|waitlist:\d+)$/`):

| audience | label (fa) | customers `c` WHERE … |
|---|---|---|
| `all` | همه مشتری‌ها | `1 = 1` |
| `active` | مشتری‌های دارای اشتراک فعال | `EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status = 'delivered' AND (o.expires_at IS NULL OR o.expires_at > datetime('now', '+03:30')))` |
| `expired` | مشتری‌هایی که اشتراکشان تمام شده | `EXISTS (… o.status = 'delivered' AND o.expires_at IS NOT NULL AND o.expires_at <= datetime('now', '+03:30'))` **AND NOT** the `active` condition |
| `never` | کسانی که هنوز خرید نکرده‌اند | `NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status IN ('confirmed', 'delivered'))` |
| `buyers:<pid>` | خریداران «<name>» | `EXISTS (… o.customer_product_id = ? AND o.status IN ('confirmed', 'delivered'))` |
| `waitlist:<pid>` | لیست انتظار «<name>» (system only, §4.4) | `EXISTS (SELECT 1 FROM product_waitlist w WHERE w.product_id = ? AND w.customer_telegram_id = c.telegram_id)` |

Implement `audienceFilter(audience): { where: string; args: unknown[] }` in `src/store/broadcast.ts`. It throws on an invalid audience. Use it in:
- `countAudience(audience)`: `SELECT COUNT(*) AS n FROM customers c WHERE <where>`
- `getCustomerBatch(afterId, limit, audience)`: `SELECT c.id, c.telegram_id FROM customers c WHERE c.id > ? AND (<where>) ORDER BY c.id LIMIT ?`
- `enqueueBroadcast({ adminChatId, text, entities, audience, replyMarkup })` stores `total` from `countAudience`.

`processBroadcastBatch` passes `job.audience` to `getCustomerBatch` and `reply_markup: JSON.parse(job.reply_markup)` (when not null) to `sendMessage`. Everything else stays the same (cursor, 429 handling, budget).

### 3.2 Announce wizard: new first step
The wizard becomes 3 steps. The old steps «〔 مرحله ۱ از ۲ 〕» and «〔 مرحله ۲ از ۲ 〕» become «〔 مرحله ۲ از ۳ 〕» and «〔 مرحله ۳ از ۳ 〕». Their texts stay otherwise identical, except that «برای همه مشتریان» becomes «برای گروه انتخاب‌شده» in step 2, and «این پیام برای همه مشتریان ارسال خواهد شد:» becomes `این پیام برای {n} نفر ({label}) ارسال خواهد شد:`.

Step 0 (new):
```
📢 *ارسال اطلاعیه به مشتریان*

〔 مرحله ۱ از ۳ 〕

👥 اطلاعیه برای چه کسانی ارسال شود؟
```
Buttons (one per row): `👥 همه مشتری‌ها` → `ann_aud_all`, `✅ اشتراک فعال` → `ann_aud_active`, `⌛️ اشتراک تمام‌شده` → `ann_aud_expired`, `🛍 خریداران یک محصول` → `ann_aud_buyers`, `🆕 هنوز خرید نکرده‌اند` → `ann_aud_never`, `❌ انصراف` → `announce_cancel`.

`ann_aud_buyers` edits the message into a product picker (`productPickerKeyboard(activeProducts, page, 'ann_prod_', 'ann_prod_page_', cancelBtn)`). Picking a product sets the audience `buyers:<id>`.

After choosing, compute `n = countAudience(audience)`. If `n === 0`: `⚠️ هیچ مشتری‌ای در این گروه نیست.` and leave the scene. Otherwise continue to the text step. The confirm step re-counts (members can change) and shows the line above. `SENDING_TEXT` is unchanged.

### 3.3 Tests
- Each audience selects the right customers (seed orders in each state, run cron ticks, assert recipients).
- `buyers:` picker flow end to end; zero-member audience stops early.
- Existing announce tests updated for the new step numbers.
- `indexes.test.ts`: the batch query for every audience (`assertNoScan` on `orders` and `product_waitlist`; `customers` is walked by its primary key, which is fine).

---

## 4. Edit product + out of stock + waitlist (milestone F3, idea 4)

### 4.1 Edit wizard `customer-products-edit-wizard` (`src/store/handlers/customerProductsEdit.ts`)
Admin button «✏️ ویرایش محصول» → product picker of **active** products (prefix `cprod_edit_select_`, pages `cprod_edit_page_`, cancel `cprod_edit_cancel`). The picker button text is the normal `productButton` text, prefixed with `⛔️ ` when the product is unavailable.

After picking, show the **product card** with a field menu, and edit it in place after every change:
```
✏️ ویرایش محصول

📦 نام: {name}
💰 قیمت: {price} تومان
📜 شرایط: {دارد | ندارد}
⏱ مدت اشتراک: {N روز | ندارد}
🛡 گارانتی: {N روز | ندارد}
📦 وضعیت: {✅ موجود | ⛔️ ناموجود}

کدام مورد را می‌خواهید تغییر دهید؟
```
(Plain text, no parse_mode.) Buttons: `✏️ نام` `cprod_edit_f_name`, `💰 قیمت` `cprod_edit_f_price` / `📜 شرایط` `cprod_edit_f_terms`, `⏱ مدت اشتراک` `cprod_edit_f_duration` / `🛡 گارانتی` `cprod_edit_f_warranty`, `{⛔️ ناموجود کن | ✅ موجود کن}` `cprod_edit_toggle_stock` / `✅ پایان` `cprod_edit_done`.

Field input rules: reuse the add wizard's validation. Extract the shared validators from `customerProducts.ts` (name length `MAX_NAME_LENGTH`, `parsePrice`, `parseDays`, terms with entities) into exported helpers. Don't duplicate them.
- Name/price: text input. On an invalid value, send the same error texts the add wizard uses.
- Terms: text (entities kept, like the add wizard), or the button `▫️ حذف شرایط` (`cprod_edit_clear_terms`).
- Duration/warranty: a number of days, or the button `▫️ ندارد` (`cprod_edit_clear_days`).
- After each saved change: `✅ ذخیره شد.` + the refreshed card. Add `ℹ️ سفارش‌های قبلی تغییری نمی‌کنند.` after price, duration or warranty edits (orders keep their snapshots).
- **Price edit safety:** after a price change, load the product's active **fixed** discount codes. For each code whose `discount_value >= newPrice`, add `⚠️ کد تخفیف {CODE} (مبلغ ثابت {value} تومان) از قیمت جدید بیشتر یا برابر است و محصول را رایگان می‌کند. آن را ویرایش یا غیرفعال کنید.`
- `/cancel` and the usual `^(لغو|انصراف|cancel|exit|خروج)$` hears leave the scene, like the other wizards.

DB: `updateCustomerProduct(id, patch: Partial<{ name; price; termsText; termsEntities; durationDays; warrantyDays; isAvailable }>)`. Build the SET clause from a **fixed whitelist** of columns. `WHERE id = ? AND is_active = 1`.

Implementation hint: a WizardScene with step 0 = picker and step 1 = a loop that handles both menu callbacks and field input, with `ctx.wizard.state.edit = { productId, field }`. Don't call `next()` from step 1. `cprod_edit_done` leaves the scene: `✅ ویرایش محصول تمام شد.`

### 4.2 Out of stock in the storefront
- Catalog: unavailable products stay in the list with the label `⛔️ {name} (ناموجود)` (no price). Add an optional label function parameter to `productPickerKeyboard`/`buildPagedKeyboard`. Don't fork it.
- `cust_prod_<id>` on an unavailable product does **not** answer with an alert. It sends:
  ```
  ⛔️ «{name}» فعلاً ناموجود است.

  می‌توانید عضو لیست انتظار شوید تا به‌محض موجود شدن خبرتان کنیم.
  ```
  with the button `🔔 موجود شد خبرم کن` → `waitlist_join_<id>`.
- `waitlist_join_<id>`: `INSERT ... ON CONFLICT DO NOTHING`. When a row was inserted: answer `✅ ثبت شد` and edit the message to `🔔 ثبت شد. به‌محض موجود شدن «{name}» خبرتان می‌کنیم.` When it already existed: answer `ℹ️ قبلاً ثبت شده‌اید.` If the product is available again or inactive, answer accordingly and do nothing.
- Purchase guards: everywhere the code checks `!product || !product.is_active`, also check `!product.is_available`. This covers `renew_`, `cust_disc_skip_`, `cust_disc_enter_`, the discount-code text step and `cust_agree_`. Use the alert/text `⛔️ این محصول فعلاً ناموجود است.` Exception: `cust_prod_` shows the waitlist message above. **Exception 2:** the receipt handler already re-checks `is_active` when the receipt arrives. Do **not** add `is_available` there. A customer who agreed before the product went out of stock may already have paid, so the receipt is still accepted.
- Manual purchase (`manual_prod_`) and the admin pickers still allow unavailable products (they show the `⛔️ ` prefix).

### 4.3 Toggle stock
`cprod_edit_toggle_stock` flips `is_available`.
- When it becomes **available** and the waitlist for that product has rows: edit the card and add the buttons `📣 به {n} نفر در لیست انتظار خبر بده` → `cprod_edit_notify_wait` and `بعداً` → `cprod_edit_menu`.
- When it becomes **unavailable**: nothing else happens. Waitlist rows are kept.

### 4.4 Restock notification
`cprod_edit_notify_wait` enqueues a broadcast job with audience `waitlist:<pid>`, text:
```
✅ خبر خوب! «{name}» دوباره موجود شد.

برای خرید روی دکمه زیر بزنید:
```
and `reply_markup` `{ inline_keyboard: [[{ text: '🛍 خرید «{name}»', callback_data: 'cust_prod_<pid>' }]] }`. The button text is cut to 60 characters. Then it calls `processBroadcastBatch(ctx.app, { reserve: 8 })` like the announce wizard does.
- When a `waitlist:` job finishes (in `sendBatch`, right after `finishBroadcast`, still under the broadcast lease), it also runs `DELETE FROM product_waitlist WHERE product_id = ? AND created_at <= ?` (the job's `created_at`). In `processBroadcastBatch`'s `finished` branch, the admin summary for such jobs is `✅ به {sent} نفر از لیست انتظار «{name}» خبر داده شد.` (+ the failed line like the normal summary).

### 4.5 Tests
Edit each field (+ invalid input), fixed-code warning, unavailable product in the catalog and every guard, waitlist join (twice), restock → broadcast to waitlist only → waitlist cleared, renew button still works after a price edit (the core reason for this feature), receipt still accepted while unavailable.

---

## 5. Reject reason + re-upload + duplicate receipts (milestone F4, ideas 2 and 3)

### 5.1 Reject reasons
`order_reject_<id>` **no longer decides immediately.** In `store/bot.ts`, extend the Stage `bypass` regex so the new admin callbacks also work while an admin is half-way through a wizard: `/^(order_(confirm|reject|deliver)_\d+|order_rejr_\d+_[a-z]+|rpt_\w+|ref_adm_\w+)$/`.

The reject handler verifies the admin and that the order is still `pending` (otherwise it follows the existing "already decided" path). Then it replaces **this message's** keyboard (`editMessageReplyMarkup`) with:

| button | callback | reason text sent to the customer |
|---|---|---|
| `💸 مبلغ اشتباه` | `order_rejr_<id>_amount` | `مبلغ واریزی با مبلغ سفارش مطابقت ندارد.` |
| `🔍 رسید ناخوانا` | `order_rejr_<id>_unreadable` | `تصویر رسید خوانا نیست یا اطلاعات کامل ندارد.` |
| `🏦 واریز نرسیده` | `order_rejr_<id>_notreceived` | `واریزی با این مشخصات به حساب ما نرسیده است.` |
| `💳 کارت اشتباه` | `order_rejr_<id>_wrongcard` | `واریز به شماره کارت اشتباهی انجام شده است.` |
| `♻️ رسید تکراری` | `order_rejr_<id>_duplicate` | `این رسید قبلاً برای سفارش دیگری استفاده شده است.` |
| `✏️ دلیل دلخواه` | `order_rejr_<id>_custom` | (admin types it) |
| `▫️ بدون دلیل` | `order_rejr_<id>_none` | — |
| `🔙 بازگشت` | `order_rejr_<id>_back` | restores the original ✅/❌ keyboard |

Put the codes and texts in `src/store/labels.ts` as `REJECT_REASONS`. Layout: two per row, and `🔙 بازگشت` alone on the last row.

- `_custom`: leave any active scene, then set `ctx.session.awaitingRejectReasonFor = { orderId, chatId, messageId }` and reply `✏️ دلیل رد سفارش #{id} را بنویسید (حداکثر ۲۰۰ کاراکتر):`. The next admin text (handled **before** the admin fallback handler, and only when this session key is set) is the reason. Cut it to 200 characters and clear the key.
- All decided paths call the existing shared decision code, extended to take `rejectReason: string | null`. `decideOrder` writes `reject_reason` in the same UPDATE (still guarded by `status = 'pending'`).
- Admin caption: `originalCaption + '\n\n❌ رد شد (توسط ادمین).'` + (`'\n📝 دلیل: ' + reason` when there is one). For `_custom`, edit the original receipt message using the stored `chatId`/`messageId`.
- Customer message: the existing reject text, + `'\n\n📝 دلیل: ' + reason` when there is one. Add the button `📸 ارسال مجدد رسید` → `reupload_<orderId>` unless the reason is `duplicate`.

### 5.2 `reupload_<orderId>`
Check that the order belongs to `ctx.from.id`, has `status = 'rejected'`, and that its product is active **and** available. On success, set `session.awaitingReceiptFor = { productId, productName, price: order.price, discountCodeId: order.discount_code_id, createdAt: app.apps.now().getTime() }` (the draft TTL needs `createdAt`), answer the callback, and send:
```
📸 لطفاً رسید جدید پرداخت «{product}» به مبلغ {price} تومان را ارسال کنید.
```
The card details are sent again, the same way the `cust_agree_` text does when store settings exist. A discount code is re-validated at confirm time anyway (existing logic). On failure, answer with the matching alert: `❌ سفارش یافت نشد.` / `⛔️ این محصول فعلاً ناموجود است.`

### 5.3 Duplicate receipt detection
- On receipt, compute `uniqueId` = `photo.at(-1).file_unique_id` or `document.file_unique_id`. Save it in `orders.receipt_unique_id` (extend `createOrder`).
- **Before** creating the order: `SELECT id, status, customer_telegram_id FROM orders WHERE receipt_unique_id = ? ORDER BY id DESC LIMIT 1`.
- When there is a hit, `buildReceiptCaption` gets an optional `duplicateOf` and adds this line at the end:
  `⚠️ هشدار: همین فایل رسید قبلاً برای سفارش #{id} ({status_fa}، مشتری {customer_id}) ارسال شده است.`
  `status_fa`: pending=در انتظار بررسی, confirmed=تأییدشده, delivered=تحویل‌شده, rejected=ردشده.
- Never auto-reject. The admin decides.

### 5.4 Tests
Each reason (customer text, caption, DB column), custom-reason flow including a second admin deciding meanwhile, back button, re-upload creates a new pending order with the same price/discount, re-upload refused for someone else's order / unavailable product, duplicate warning shown for the same `file_unique_id` (update `test/helpers/updates.ts` so photo/document updates carry a `file_unique_id`), no warning for different files. Update the existing `order_reject_1` test in `test/store/admin.test.ts` to the two-step flow.

---

## 6. «📋 اشتراک‌های من» shows orders in progress (milestone F5, idea 5)

The label stays `📋 اشتراک‌های من` (old keyboards keep working). In one `db.batch`:
1. in-progress: `SELECT * FROM orders WHERE customer_telegram_id = ? AND status IN ('pending', 'confirmed') ORDER BY id DESC LIMIT 10`
2. recently rejected: `SELECT * FROM orders WHERE customer_telegram_id = ? AND status = 'rejected' AND decided_at >= datetime('now', '+03:30', '-7 days') ORDER BY id DESC LIMIT 5`
3. delivered: the existing query.

If (1) or (2) is not empty, send **one** message first (plain text):
```
🧾 سفارش‌های در جریان:

⏳ «{product}» — رسید شما در صف بررسی است (ثبت: {jalali date}).
🔄 «{product}» — پرداخت تأیید شد؛ در حال آماده‌سازی (حداکثر ۲۴ ساعت).
❌ «{product}» — رسید تأیید نشد. دلیل: {reason | نامشخص}
```
Each rejected order whose product is active+available and whose reason isn't `duplicate` gets a `📸 ارسال مجدد رسید (#{id})` → `reupload_<id>` button row (max 3 rows).

Then the delivered cards, exactly as today. The «no orders» text is shown only when all three lists are empty. Tests: each state shown, buttons, the empty case unchanged, index test for both new queries.

---

## 7. Sales report (milestone F6, idea 1)

Admin button «📊 گزارش فروش» → report for **today**, with period buttons (edit in place; callbacks `rpt_today`, `rpt_7d`, `rpt_30d`, `rpt_month`, `rpt_all`; the current one is marked with `✔ `):
`امروز` · `۷ روز` · `۳۰ روز` / `این ماه (شمسی)` · `کل`

All `orders`/`customers` times are Tehran local strings (`YYYY-MM-DD HH:MM:SS`), so the range is `[from, to)` as Tehran local strings. Today = Tehran midnight. 7d/30d = now minus N days. Month = the 1st of the current Jalali month (use `jalaali-js`). All = from `0000-01-01`. Put the helpers in `src/lib/time.ts` with unit tests.

One `db.batch` (≈6 statements, all index-backed):
1. `SELECT purchase_source, COUNT(*) AS n, COALESCE(SUM(price), 0) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY purchase_source`
2. `SELECT COUNT(*) AS n FROM orders WHERE status = 'rejected' AND decided_at >= ? AND decided_at < ?`
3. `SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed', 'delivered') AND discount_code_id IS NOT NULL AND decided_at >= ? AND decided_at < ?`
4. `SELECT customer_product_id, MAX(product_name) AS name, COUNT(*) AS n, SUM(price) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY customer_product_id ORDER BY n DESC, s DESC LIMIT 5`
5. `SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?`
6. `SELECT (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') AS waiting, (SELECT COUNT(*) FROM referrals WHERE qualified_at >= ? AND qualified_at < ?) AS ref_ok`

Text (plain, no parse_mode):
```
📊 گزارش فروش — {period}
🗓 {from jalali} تا {to jalali}

💰 درآمد: {total} تومان ({count} سفارش)
   ├ رسید کارت‌به‌کارت: {n1} سفارش — {s1} تومان
   └ خرید دستی: {n2} سفارش — {s2} تومان
❌ رسید ردشده: {rejected}
🎟 سفارش با کد تخفیف: {disc}
👥 مشتری جدید: {newCustomers}
🎁 دعوت موفق: {refOk}

🏆 پرفروش‌ها:
۱. {name} — {n} سفارش ({s} تومان)
…   (or «—» when empty)

📌 وضعیت فعلی:
⏳ رسید در انتظار بررسی: {pending}
🔄 تأییدشده، منتظر تحویل: {waiting}
```
Use `formatPrice` and Persian digits where the existing code does. Reward orders have price 0, so they don't change revenue (fine). Tests: numbers for a seeded dataset across period boundaries; index test for every statement.

---

## 8. Referral program (milestone F7, idea 17)

### 8.1 Customer side
**Button «🎁 دعوت دوستان»** (only in the keyboard when enabled, §2.3). If it's pressed while the program is disabled (old keyboard): `🎁 برنامه دعوت دوستان فعلاً فعال نیست.`

Get or create `customers.ref_code`: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, using `crypto.getRandomValues`. Write it with `UPDATE customers SET ref_code = ? WHERE telegram_id = ? AND ref_code IS NULL`, then re-read. On a unique collision, retry up to 3 times. Link: `https://t.me/{storeBotUsername}?start=ref_{code}` (bot username from `ctx.me.username`).

Message (plain text):
```
🎁 دعوت دوستان

{rulesText}

🔗 لینک دعوت شما:
{link}

📊 وضعیت شما:
👥 دعوت‌شده: {invited} نفر
✅ دعوت موفق (خرید تأییدشده): {qualified} نفر
🎯 تا جایزه‌ی بعدی: {remaining} دعوت موفق دیگر      ← or «🏁 جایزه‌ی شما گرفته شده است.» when !repeatable and already rewarded

🏆 جایزه‌های شما:
• کد {CODE} — {٪20 | ۵۰٬۰۰۰ تومان} تخفیف «{product}» — {معتبر تا {date} | استفاده شده | منقضی شده}
• «{product}» رایگان — سفارش #{id}
```
(The rewards section only shows when the customer has rewards. Show at most 5, newest first.)

`rulesText` is generated from the config:
- discount: `هر {required} نفر که با لینک شما وارد ربات شوند و اولین خریدشان{ (حداقل {minAmount} تومان)} تأیید شود، یک کد تخفیف {٪X | X تومان} برای «{product}» هدیه می‌گیرید (اعتبار {days} روز).`
- product: `… یک «{product}» رایگان هدیه می‌گیرید.`
- append `این جایزه فقط یک بار داده می‌شود.` when `!repeatable`.

Add a share button: `📤 ارسال لینک برای دوستان` → URL button `https://t.me/share/url?url={encodeURIComponent(link)}&text={encodeURIComponent('با این لینک وارد فروشگاه شو 👇')}`.

### 8.2 Attribution (`/start ref_<code>`)
In `store/bot.ts` `/start`, non-admin branch: `upsertCustomer` returns `changes`. If the payload matches `/^ref_([A-Z2-9]{8})$/`, call `referrals.handleRefStart(ctx, code, isNew = changes === 1)` **before** the normal welcome. The welcome is still sent as usual.

`handleRefStart` records nothing unless **all** of these hold:
- the program is enabled
- `isNew`
- the code resolves to an existing customer
- the referrer isn't the invitee

Then `INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id) VALUES (?, ?) ON CONFLICT(invitee_telegram_id) DO NOTHING`. If a row was inserted, notify the referrer (failure ignored):
```
👋 یک نفر با لینک دعوت شما وارد فروشگاه شد!
وقتی اولین خریدش تأیید شود، برای شما حساب می‌شود. (دعوت موفق فعلی: {qualified} از {required})
```
Admins are never customers, so they can't be invitees. Unknown or invalid codes are silently ignored.

### 8.3 Qualification
`referrals.onPurchaseConfirmed(app, order)` is called:
- in the store confirm path, **after** the existing customer message and bridge call, inside its own try/catch
- after a successful manual-purchase redemption (`outcome === 'claimed'`)

Steps:
1. If the program is disabled → return. Load the invitee's referral row. If there is none or it's already qualified → return. If `order.price < cfg.minAmount` → return (a later bigger order can still qualify).
2. `UPDATE referrals SET qualified_at = datetime('now', '+03:30'), qualifying_order_id = ? WHERE id = ? AND qualified_at IS NULL`. If `changes === 0` → return.
3. Call `tryGrantRewards(app, referrerId)` when `budget.remaining() >= 15`. Otherwise leave it for the cron sweep (§8.5).

### 8.4 Granting a reward: `tryGrantRewards(app, referrerId)`
Loop at most 3 times:
1. `cfg = getReferralConfig`. If `!cfg.repeatable` and the referrer already has a reward in status `issued`/`pending` → stop.
2. Select the ids of the oldest `cfg.required` rows: `SELECT id FROM referrals WHERE referrer_telegram_id = ? AND qualified_at IS NOT NULL AND reward_id IS NULL ORDER BY id LIMIT ?`. If fewer than `required` → stop.
3. `INSERT INTO referral_rewards (referrer_telegram_id, reward_type, config_snapshot) VALUES (?, ?, ?)` → `rewardId`.
4. Claim the referrals atomically: `UPDATE referrals SET reward_id = ? WHERE id IN (…) AND reward_id IS NULL`. If `changes !== required` (a concurrent request won), release them (`UPDATE referrals SET reward_id = NULL WHERE reward_id = ?`), delete the reward row, and stop.
5. Issue the reward:
   - **discount:** code `REF-` + 6 characters from the alphabet above (retry on a unique collision). `createDiscountCode` gets new optional args `ownerTelegramId` and `source = 'referral'`: `customer_product_id = cfg.discProductId`, type/value from cfg, `max_uses = 1`, `expires_at` = Tehran local now + `discValidDays` days at `23:59:59`. Store `discount_code_id`, then `status = 'issued'`, `issued_at`.
     Referrer message (plain text):
     ```
     🎉 تبریک! {required} نفر از دوستانتان با لینک شما خرید کردند.

     🎁 جایزه شما: کد تخفیف {CODE}
     {٪X | X تومان} تخفیف برای «{product}» — معتبر تا {jalali date}

     برای استفاده، «{product}» را از «🛍 لیست محصولات» انتخاب کنید و این کد را وارد کنید.
     ```
     with the button `🛍 خرید «{product}»` → `cust_prod_<id>`.
   - **product:** insert an order: `customer_product_id = cfg.productId`, `product_name`/`duration_days`/`warranty_days` snapshotted from the product, `price = 0`, `purchase_source = 'manual'`, `status = 'confirmed'`, `decided_at = now`, `decided_by = 0`. Store `order_id`, then `issued`. Call `storeOrderPaid(app.apps, { order_id, customer_id: referrerId, product })` so the normal monshi preparing/delivery flow and the stalled-order alerts apply.
     Referrer message: `🎉 تبریک! {required} نفر از دوستانتان با لینک شما خرید کردند.\n\n🎁 جایزه شما: یک «{product}» رایگان!\nسفارش #{id} ثبت شد و به‌زودی تحویل داده می‌شود.`
   - Every admin gets: `🎁 جایزه دعوت صادر شد\n👤 مشتری: {referrerId}\n🎯 {required} دعوت موفق\n🏆 جایزه: {code details | سفارش رایگان #{id} — لطفاً تحویل دهید}`.
   - If the reward product is missing/inactive, or issuing throws: set `status = 'failed'` (keep the referrals claimed) and send admins `⚠️ صدور جایزه دعوت برای مشتری {id} ناموفق بود ({reason}). لطفاً دستی رسیدگی کنید.`

### 8.5 Cron sweep
In `runCron`, when `t.minute % 10 === 5`: `SELECT referrer_telegram_id, COUNT(*) AS n FROM referrals WHERE qualified_at IS NOT NULL AND reward_id IS NULL GROUP BY referrer_telegram_id HAVING n >= ? LIMIT 5` (uses the partial index), then `tryGrantRewards` for each while `budget.remaining() >= 15`. Skip it when the program is disabled.

### 8.6 Discount-code changes
- `validateDiscountCodeRecord`: right after the `inactive` check, add `if (discountCode.owner_telegram_id !== null && discountCode.owner_telegram_id !== customerTelegramId) return { ok: false, reason: 'not_owner' }`, and `DISCOUNT_ERROR_LABEL.not_owner = '❌ این کد تخفیف مخصوص حساب دیگری است.'`. Also add `not_owner: 'کد مخصوص مشتری دیگری است'` to `DISCOUNT_REASON_ADMIN` in `storefront.ts`. The confirm path already re-validates and redeems atomically (`redeemDiscountCodeAtomic`). Keep that, and `max_uses = 1` on reward codes then works automatically.
- `getAllDiscountCodes` (the admin list) shows only `source = 'admin'` codes (`WHERE source = 'admin' ORDER BY id DESC`, index `idx_discount_source`).

### 8.7 Admin panel «🎁 دعوت دوستان»
One message, edited in place (callback prefix `ref_adm_`). Plain text:
```
🎁 برنامه دعوت دوستان — {✅ فعال | 🚫 خاموش}

🎯 تعداد دعوت موفق برای هر جایزه: {required}
💵 حداقل مبلغ خرید دوست: {minAmount | بدون حداقل}
🏆 نوع جایزه: {کد تخفیف {٪X | X تومان} برای «P» با اعتبار D روز | محصول رایگان «P»}
🔁 تکرار جایزه: {بله، هر {required} دعوت | فقط یک بار}

📊 آمار کل:
👥 دعوت‌شده: {a} · ✅ موفق: {b} · 🎁 جایزه صادرشده: {c}
🥇 برترین معرف‌ها:
۱. {display_name} — {n} دعوت موفق
…
```
Buttons:
- `{🚫 خاموش کن | ✅ روشن کن}` → `ref_adm_toggle`. Enabling runs `referralConfigProblem` and shows the problem as an alert when there is one (e.g. `⚠️ اول محصول جایزه را انتخاب کنید.`).
- `🎯 تعداد دعوت` → presets `1 2 3 5 10` + `✏️ دلخواه` (callbacks `ref_adm_req_<n>`, `ref_adm_req_custom`)
- `💵 حداقل خرید` → presets `بدون حداقل`, `۱۰۰٬۰۰۰`, `۲۰۰٬۰۰۰`, `۵۰۰٬۰۰۰` + `✏️ دلخواه`
- `🏆 نوع جایزه` → `🎟 کد تخفیف` / `🎁 محصول رایگان`, then:
  - discount: type (`٪ درصدی` / `💵 مبلغ ثابت`) → value (presets for percent `10 15 20 30 50` + custom; fixed is custom only) → product picker → validity presets `7 14 30 60 90` + custom
  - product: product picker
- `🔁 تکرار جایزه: {روشن|خاموش}` → `ref_adm_repeat`
- `🔙 بستن` → `ref_adm_close`

Custom number input uses `ctx.session.awaitingReferralInput = 'required' | 'minAmount' | 'discValue' | 'discValidDays'`, handled before the admin fallback (like §5.1). Validate it with the ranges in §2.2. On an invalid value: `⚠️ عدد معتبر وارد کنید.` After each change, re-render the panel as a **new** message (the old one may be far up).

Top referrers: `SELECT referrer_telegram_id, COUNT(*) AS n FROM referrals WHERE qualified_at IS NOT NULL GROUP BY referrer_telegram_id ORDER BY n DESC LIMIT 5`, joined to `customers.display_name` in a second query by id list (both in one batch is fine).

### 8.8 Tests
- Attribution: new vs existing customer, self, bad code, disabled.
- Qualification on a receipt confirm and on a manual claim; minAmount; a rejected order doesn't count.
- A reward at exactly N; not before.
- repeatable vs one-time.
- Concurrent grant safety: call `tryGrantRewards` twice and get one reward.
- Discount reward usable only by its owner (`not_owner` for others); the code is hidden from the admin list.
- Product reward creates a confirmed 0-price order and triggers the bridge (monshi on and off).
- Failed issuance path; cron sweep; admin panel edits and custom input; the customer keyboard shows the button only when enabled; budget ≤ 50 on the confirm path with a reward.

---

## 9. Monshi: separate messages with topics (milestone F8, new request)

Telegram lets a bot with **forum topic mode** (enabled in @BotFather) create topics in its private chats (`createForumTopic` with `chat_id` = the user, then `message_thread_id` on send). Monshi's private chats are only the owner and the notify accounts, so this is safe there. **Do not enable this for the store bot.**

### 9.1 `src/monshi/services/topics.ts`
```ts
export type TopicCategory = 'handoff' | 'orders' | 'reports' | 'system';
export const TOPICS: Record<TopicCategory, { name: string; color: number }> = {
  handoff: { name: '🔔 پیام‌های نیازمند پاسخ', color: 0xFB6F5F },
  orders:  { name: '📦 سفارش‌ها',               color: 0xFFD67E },
  reports: { name: '📊 گزارش‌ها',               color: 0x6FB9F0 },
  system:  { name: '⚙️ سیستم و اتصال',          color: 0x8EEE98 },
};
export async function ensureTopic(app, userId, cat): Promise<number | null>;   // app_state key `topic:{userId}:{cat}` (cached by MonshiContext); creates it on demand
export async function sendToStaff(app, userId, cat, text, extra?): Promise<Message | null>;
```
`sendToStaff`:
- If `topics_enabled !== '1'`: plain `sendMessage` (today's behavior).
- Otherwise get the thread, then send with `message_thread_id`.
- If the send fails with a 400 whose description contains `thread not found` (or `TOPIC_DELETED`/`TOPIC_CLOSED`): delete the state key, recreate the topic **once**, and resend.
- If topic creation itself fails: log it and send without a thread. Never lose the message.
- Returns the sent message (needed by §11).

Add `deleteAppState(key)` to `MonshiDb` + `MonshiContext.deleteState`.

### 9.2 Routing (change these call sites)
| message | category |
|---|---|
| `business.ts` `notifyAdmin` (handoffs) | `handoff` |
| `bridge.ts` completion-send failure notice | `orders` |
| `cron.ts` weekly digest | `reports` |
| `business.ts` `onBusinessConnection` confirmation (to `bc.user_chat_id`) | `system` (use `sendToStaff` when `user_chat_id` is in `allNotifyIds`, otherwise plain send) |

`notifyAll(app, text, markup?, cat = 'system')` now uses `sendToStaff` per recipient and **returns** `{ userId, messageId }[]` for the successful sends. Replies to commands, buttons and wizards are not routed (grammY's `ctx.reply` already answers in the topic the owner wrote in).

### 9.3 Settings toggle
In the settings hub (`admin.ts`), add a row before «👁 خوانده‌شدن خودکار»: `🗂 دسته‌بندی پیام‌ها ({فعال ✅ | خاموش 🚫})` → `st_toggle_topics`.
- Turning it **on** creates all four topics for the **admin** right away (4 calls) and saves the setting only if they were all created. On success: answer `✅ تاپیک‌ها ساخته شدند` and send one message into each topic: `این تاپیک برای «{name}» است.`. On failure: alert:
  `❌ ساخت تاپیک ممکن نشد. اول در @BotFather برای ربات منشی حالت تاپیک (Threaded Mode) را روشن کنید و دوباره امتحان کنید.`
- Notify accounts get their topics lazily on their first notification.
- Turning it **off** just sets `'0'`.

### 9.4 Tests
Handoff/digest/order notice/connection message each land in the right `message_thread_id`. Lazy creation happens once per (user, category) and is reused from app_state on the next request. Deleted topic → recreate + resend. Topic creation failure → plain send. Toggle on success/failure. Topics off = byte-identical calls to today (existing tests stay green).

---

## 10. Monshi: customer card (milestone F9, idea 7)

### 10.1 Store side `src/store/customerSummary.ts`
```ts
export interface CustomerSummary {
  purchases: number; spent: number; lastOrderAt: string | null; pending: number; preparing: number;
  active: { product: string; expiresAt: string | null }[];
}
export async function getCustomerSummary(app: StoreApp, telegramId: number): Promise<CustomerSummary>;
```
One `db.batch` with 2 statements:
1. `SELECT SUM(CASE WHEN status IN ('confirmed', 'delivered') THEN 1 ELSE 0 END) AS purchases, SUM(CASE WHEN status IN ('confirmed', 'delivered') THEN price ELSE 0 END) AS spent, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS preparing, MAX(created_at) AS last FROM orders WHERE customer_telegram_id = ?`
2. `SELECT product_name, expires_at FROM orders WHERE customer_telegram_id = ? AND status = 'delivered' AND (expires_at IS NULL OR expires_at > datetime('now', '+03:30')) ORDER BY delivered_at DESC LIMIT 3`

`src/bridge.ts`: add `storeCustomerSummary(apps, telegramId): Promise<CustomerSummary | null>`. It returns `null` when the store is disabled or on any error (logged).

### 10.2 Monshi: `customerCardLines(summary, customer)` in `views.ts`
```
🛍 سابقه فروشگاه: {purchases} خرید ({spent} تومان) · آخرین: {jalali date}
✅ اشتراک فعال: {product} تا {jalali date} ({n} روز مانده)        ← one line per active (max 3); «بدون تاریخ انقضا» when expiresAt is null
⏳ {pending} رسید در انتظار بررسی · 🔄 {preparing} سفارش در حال آماده‌سازی   ← only the non-zero parts
🆕 هنوز از فروشگاه خرید نکرده                                         ← when purchases = 0 and nothing pending
👋 اولین پیام به پشتیبانی: {formatTehran(first_seen_at, false)}
```
- Insert these lines into the handoff notification text, between the `💬` preview line and the `🔗` link line. Skip the store lines when the summary is null.
- Add an owner command `/customer <@username | numeric id>` (register it in the `commands` list, add it to `/help`). It sends the card + the last 5 messages of that chat (`getRecentMessages`, `👤`/`🧑`/`🤖` prefix by direction, 80 characters each) + the pause/resume button. When there's no customer: `❌ مشتری‌ای با این مشخصات پیدا نشد.`

### 10.3 Store receipt caption
`buildReceiptCaption` gets an optional `history` line from `getCustomerSummary` (computed in the receipt handler, 1 extra D1 batch):
- `🧾 سابقه: {purchases} خرید تأییدشده` when purchases > 0
- `🆕 اولین خرید این مشتری` otherwise

### 10.4 Tests
Card content for a new customer / a buyer with active, expired and no-expiry subscriptions / store disabled; the `/customer` command by username and id; the caption line; index test for both summary queries; handoff budget ≤ 35.

---

## 11. Monshi: reply from the notification (milestone F10, idea 8)

### 11.1 Links
In `notifyAdmin` (handoffs), after `notifyAll(..., 'handoff')`, insert a `notify_links` row for every `{ userId, messageId }` in one `db.batch` (`created_at = utcIsoNow()`).

Add this line at the end of the handoff text (only when there is an active business connection): `↩️ برای جواب دادن، روی همین پیام Reply بزنید.`

Cleanup: in `runCron`, once a day at 04:xx Tehran (day latch `notify_links_cleanup_day` in monshi app_state), run `DELETE FROM notify_links WHERE created_at < ?` (now − 30 days).

### 11.2 Staff reply handler (`src/monshi/handlers/replyBridge.ts`)
Register it in `bot.ts` **before** the owner free-text handler:
`bot.filter(ctx => ctx.chat?.type === 'private' && cfg.allNotifyIds.includes(ctx.from?.id) && !!ctx.message?.reply_to_message)`. Staff = the admin + the notify accounts.

- Skip (call `next()`) when the message is a command, or when there's no `notify_links` row for `(chat.id, reply_to_message.message_id)`.
- **Never touch `ctx.session`.** Notify accounts have none.
- Get the active connection via `app.ctx.getConnection()`. If there is none: `❌ اتصال بیزینس فعال نیست.`
- Send to `customer_chat_id` with `business_connection_id`:

  | staff message | method |
  |---|---|
  | text | `sendMessage(text, { entities })` |
  | photo (largest) | `sendPhoto(file_id, { caption, caption_entities })` |
  | document | `sendDocument` |
  | video | `sendVideo` |
  | voice | `sendVoice` |
  | audio | `sendAudio` |
  | animation | `sendAnimation` |
  | sticker | `sendSticker` |
  | anything else | reply `⚠️ این نوع پیام پشتیبانی نمی‌شود.` |
- On success:
  1. `saveMessage(customerChatId, sent.message_id, 'owner', type, text/caption, bcid)`
  2. `markChatAnsweredByHuman(customerChatId)`
  3. if `reply_bridge_pause === '1'`: `rules.pauseChat(app, customerChatId)`
  4. `setMessageReaction(chat.id, message_id, [{ type: 'emoji', emoji: '👍' }])`. If that fails, reply `✅ ارسال شد.`
- On a send failure, reply to the staff message:
  ```
  ❌ پیام به مشتری نرسید.
  دلیل: {description}

  ℹ️ ربات فقط به چت‌هایی می‌تواند جواب بدهد که در ۲۴ ساعت گذشته پیام داده‌اند، و مجوز «پاسخ‌گویی» در اتصال بیزینس باید روشن باشد.
  ```
- Auto-replies are already stored as direction `'out'` (`sendReply` in `business.ts`). Staff replies sent through this bridge are human answers, so store them as `'owner'`.
- Note: Telegram may echo the bot's own business send back as a `business_message` from the owner. That path already de-duplicates `saveMessage` (UNIQUE) and re-pausing is idempotent, so nothing else is needed. Add a test that simulates the echo.

### 11.3 FAQ quick-send buttons under a handoff
- `gemini.getDecision` also returns `candidates: FaqRow[]` (already computed there).
- Add `faq.topMatches(text, faqs, k = 3)` to `services/faq.ts`: the same scoring as `findBestMatch`, returning up to k FAQs with `specificHits >= 1`, best first.
- In the handoff path: candidates = Gemini candidates (first 3), or else keyword `topMatches`.
- Add up to 3 button rows above the pause button: `📚 {question cut to 28 characters}` → `hfaq:{customerChatId}:{faqId}`.
- Handler `hfaq:` (register it in `bot.ts`; add `'hfaq:'` to `NOTIFY_ALLOWED_CALLBACK_PREFIXES` so notify accounts may press it):
  - FAQ missing or disabled → `❌ این FAQ دیگر فعال نیست.`
  - `rules.autoReplyRecentlySent(app, chatId, 'faq:' + id)` → `ℹ️ این جواب همین الان برای مشتری ارسال شده.`
  - Otherwise send `faq.answer` via the business connection, then `saveMessage` (owner), `markChatAnsweredByHuman`, `logAutoReply`, `incrementFaqHit`, and pause as in §11.2.
  - Edit the notification text: append `\n\n✅ جواب «{question}» ارسال شد (توسط {from.first_name}).` and keep only the pause button. Send failure → same alert text as §11.2 (shortened to fit an alert).

### 11.4 Tests
Reply with text / photo / sticker / unsupported type; reply to a non-notification message falls through to the wizards; a notify account can reply; send failure message; pause applied/not applied by the setting; echo dedupe; FAQ buttons from Gemini candidates and from keywords; hfaq double-press; links cleanup cron; index test for the link lookup and the cleanup.

---

## 12. Monshi: learn from the owner's own replies (milestone F11, idea 13)

### 12.1 Plumbing
- `MonshiDb.saveMessage` returns the inserted row id (`number`, `0` on duplicate) instead of `boolean`. The existing `if (!(await saveMessage(...)))` checks keep working; update the types and other callers.
- `recordUnanswered(chatId, text, normalized, messageRowId)` also sets `last_message_row_id` (both the INSERT and the UPDATE).
- New `getOwnerRepliesAfter(pairs: { chatId: number; afterRowId: number }[])`: one `db.batch` of `SELECT id, text, received_at FROM messages WHERE chat_id = ? AND id > ? AND direction = 'owner' AND text IS NOT NULL ORDER BY id LIMIT 1` (uses `idx_msg_chat_id`). Keep the first reply only if it came within 24 hours of the question (compare with the question row's `received_at`; fetch it in the same batch with `SELECT received_at FROM messages WHERE id = ?`).

### 12.2 Privacy filter `looksPrivate(text)` in `rules.ts`
Treat the reply as private when any of these hold:
- `isSensitive(text, 'text')`
- it contains ≥ 6 consecutive digits (after Persian→Latin digit normalization)
- it contains an email address
- it matches `/(user(name)?|pass(word)?|login)\s*[:：]/i`
- it's shorter than 5 characters

Private replies are never suggested.

### 12.3 Unanswered view (used by `/unanswered` and the digest)
For each item that has a usable owner reply, add a line under it: `🧑 جواب خودت: «{reply cut to 120 characters}»`, and **one more button** in its row: `⚡️ FAQ با جواب خودم (#{id})` → `utofaq_own:{id}`. The existing `➕ تبدیل به FAQ (#{id})` button stays.

The digest also gets: `💡 برای {k} سؤال بی‌جواب، جواب خودت پیدا شد؛ با دکمه‌ی ⚡️ مستقیم FAQ کن.` when k > 0.

`utofaq_own:{id}` (extend the callback regex in `bot.ts` to `^(fq_|utofaq:|utofaq_own:)`):
- Re-fetch the unanswered row and the owner reply. **Never trust callback data for the text.**
- If the reply is gone or private: `❌ جواب قابل‌استفاده‌ای پیدا نشد.`
- Otherwise set `ctx.session.faq_wizard = { step: 'keywords', data: { question: row.text, answer: reply, _unanswered_id: id } }` and show the existing keywords-step prompt, preceded by `⚡️ تبدیل به FAQ:\n❓ {question}\n💬 {answer}\n\n`. The rest of the wizard (save, embedding reset, `resolveUnanswered`) is unchanged.

### 12.4 Tests
Reply found within 24 hours / ignored after; private replies are filtered (each rule); quick FAQ creation end to end resolves the unanswered item; the digest line; batch query budget with 10 items.

---

## 13. Milestones (one commit each; `npm run typecheck && npm test` green before each)

| # | Commit message (prefix) | Content |
|---|---|---|
| F1 | `features: schema + shared helpers` | §1, §2.1, §2.2 (config only, no UI), fake Telegram additions |
| F2 | `store: targeted announcements` | §3 |
| F3 | `store: edit product, out of stock, waitlist` | §4 (+ the «✏️ ویرایش محصول» admin button) |
| F4 | `store: reject reasons, receipt re-upload, duplicate receipts` | §5 |
| F5 | `store: in-progress orders in my subscriptions` | §6 |
| F6 | `store: sales report` | §7 (+ «📊 گزارش فروش» button) |
| F7 | `store: configurable referral program` | §8, §2.3 (+ «🎁 دعوت دوستان» buttons) |
| F8 | `monshi: topic-separated staff messages` | §9 |
| F9 | `monshi: customer card` | §10 |
| F10 | `monshi: reply and quick FAQ from notifications` | §11 |
| F11 | `monshi: suggest FAQs from the owner's replies` | §12 |
| F12 | `docs: Persian README for round-2 features` | §14 |

## 14. README (Persian) additions (F12)
Add a section «فیچرهای جدید» to `README.md`:
- a short "how to use" for each feature (where the button is, what the customer sees)
- the update commands: `npm run db:migrate:remote` then `npm run deploy`
- the BotFather step for topics
- the referral anti-abuse rules (new users only, first confirmed purchase, personal codes)
- the duplicate-receipt limitation (same file only)
- the 24-hour reply window for §11

## 15. Pitfalls checklist (read before coding)
- grammY `ctx.reply` keeps the topic automatically, but **`app.api.sendMessage` does not**. Always route staff notifications through `sendToStaff`.
- Reply keyboards: one inconsistent call site silently removes the «🎁 دعوت دوستان» button (§2.3).
- Store sessions are per `(user, chat)`. New session keys (`awaitingRejectReasonFor`, `awaitingReferralInput`) belong to admins only. Clear them on `/cancel` and on scene entry.
- The handler order in `store/bot.ts` matters: the admin custom-input handlers (§5.1, §8.7) go **after** the stage middleware and **before** the admin `message:text` fallback.
- Callback data is ≤ 64 bytes. Every `*_<id>` handler must re-check ownership/admin rights. Callback data is forgeable.
- SQLite `ALTER TABLE ADD COLUMN` can't add UNIQUE. That's why `ref_code` uses a unique index (NULLs are allowed many times).
- `orders.status` CHECK can't change. Reward orders use `purchase_source = 'manual'` with `price = 0`. Don't add a new status.
- D1 has at most 100 bound parameters per statement. Chunk the `IN (…)` lists (referral ids ≤ 50 by the config range, so this is fine).
- Budget: the receipt-confirm path now also runs referral qualification and maybe a reward. Keep the reward grant behind `budget.remaining() >= 15`, with the cron sweep as the fallback.
- Don't change `PREPARING_TEXT` / `COMPLETION_TEXT` or any monshi customer-facing auto-reply text.
- An order cancelled in monshi stays `confirmed` in the store (see `onOrderCancelledInMonshi`). The report's «🔄 تأییدشده، منتظر تحویل» and the customer card's «در حال آماده‌سازی» still count it. That's accepted. Mention it in the README (such orders are followed up by hand).
- New admin callbacks on standalone messages must be added to the Stage `bypass` regex (§5.1). Otherwise an admin who is mid-wizard can't press them.
