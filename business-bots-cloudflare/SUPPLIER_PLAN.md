# Store Bot: Supplier API (reseller) Plan (round 3)

> **Audience:** an implementing agent (Claude Sonnet recommended; see the model note below) working in this repo, plus the owner (Zakaria).
> **Status:** every decision below was agreed with the owner in chat. Implement exactly this plan. If something in it is impossible or wrong, **stop and tell the user**. Don't silently pick a different design.
> Supplier API reference: ArioBox Reseller API (summarised in §4.1; the owner has the original HTML).

---

## خلاصه برای زکریا (فارسی)

### این فیچر چه کار می‌کند
- **پنل «🔌 API تأمین‌کننده»** در ربات فروشگاه. تأمین‌کننده (فعلاً آریوباکس) را با کلید API و `user_id` اضافه می‌کنید و محصولاتش را با قیمت خرید (دلار و تومان) می‌بینید.
- **وارد کردن محصول:** یک محصول تأمین‌کننده را انتخاب می‌کنید. مشخصات (مدت اشتراک، گارانتی، عنوان گزینه‌ها) **خودکار پر می‌شود و قبل از ساخت نشانتان داده می‌شود**. می‌توانید ویرایشش کنید یا همان‌طور قبولش کنید.
- **محصول با دکمه‌ی انتخاب مدت:** مشتری مثلاً «ChatGPT Plus» را می‌زند و بعد بین «۱ ماهه / ۳ ماهه / ۱۲ ماهه» انتخاب می‌کند. این قابلیت برای محصولات معمولی (غیر API) هم کار می‌کند.
- **قیمت خودکار:** قیمت فروش = قیمت دلاری × نرخ خود API + سود. سود هم درصدی است، هم مبلغ ثابت، هم هر دو با هم. یک سود پیش‌فرض کلی دارید که برای هر گزینه قابل تغییر است. قیمت نهایی همیشه به **نزدیک‌ترین ۱۰٬۰۰۰ تومانِ بالاتر** گرد می‌شود.
- **همگام‌سازی هر ۱۰ دقیقه:** قیمت، موجودی و مشخصات به‌روز می‌شوند. اگر مشخصات محصول در تأمین‌کننده عوض شود، فقط به شما **خبر داده می‌شود** و محصول شما دست نمی‌خورد.
- **چند منبع برای یک گزینه:** هر گزینه می‌تواند یک منبع اصلی و چند منبع پشتیبان (حتی از تأمین‌کننده‌های دیگر) داشته باشد. هر منبع را می‌توانید غیرفعال کنید، مثلاً وقتی گران شده.
- **سفارش خودکار:** با تأیید رسید، سفارش خودکار در تأمین‌کننده ثبت می‌شود. وقتی اکانت آماده شد، **ربات فروشگاه** آن را برای مشتری می‌فرستد و به شما خبر می‌دهد که تحویل شد یا نشد و چرا. پیام شما **آیدی مشتری** را دارد و اگر یوزرنیم نداشت، دکمه‌ی «💬 چت با مشتری» و «✉️ پیام از طرف ربات».
- **موجودی ناکافی یا ناموجود:** مشتری پیام «حداکثر تا ۲۴ ساعت» را می‌بیند و ربات هر ۱۵ دقیقه دوباره امتحان می‌کند. اگر تا ۲۰ ساعت نشد، کارت **«⏸ نیازمند تصمیم»** برای شما می‌آید.
- **کارت «⏸ نیازمند تصمیم»** این گزینه‌ها را دارد:
  - 🔁 تلاش دوباره
  - 🔀 خرید از منبع دیگر (حتی منبع غیرفعال)
  - 📦 تحویل از اکانت‌های خودتان
  - ✍️ نوشتن متن اکانت (ربات برای مشتری می‌فرستد)
  - 🙋 «خودم تحویل می‌دهم»: بعد از تحویل دکمه‌ی «✅ تحویل شد» را می‌زنید، مثل سیستم فعلی
  - ❌ لغو سفارش با دلیل، و پیگیری بازپرداخت
- **کف سود:** هیچ کد تخفیفی قیمت را زیر قیمت خرید نمی‌برد؛ هنگام ساخت کد و هنگام وارد کردن کد توسط مشتری جلویش گرفته می‌شود. اگر سفارشی ضررده باشد، خودکار خرید نمی‌شود و تصمیمش با شماست.
- **خرید مستقیم برای خودتان:** از کیف پول چند اکانت می‌خرید و در «📦 اکانت‌های من» نگه داشته می‌شوند. هر اکانت را می‌توانید به مشتری ربات بدهید، تبدیل به لینک خرید دستی کنید، یا بگویید «بیرون از ربات فروختم به X». سود را هم می‌شود برای هر اکانت یا برای کل دسته ثبت کرد.
- **خرید دستی (لینک) و جایزه‌ی محصول رایگان دعوت دوستان:** اگر محصولشان از تأمین‌کننده می‌آید، **با تأیید شما** خرید یا تحویل می‌شوند.
- **گزارش فروش:** هزینه‌ی خرید، سود واقعی، لغوشده‌ها و بازپرداخت‌ها، فروش بیرون از ربات و خرج کیف پول را هم نشان می‌دهد.
- **ثبت همه‌چیز در دیتابیس:** هر سفارش تأمین‌کننده، جواب API، اکانت تحویل‌شده و هر کاری که شما یا ربات انجام داده‌اید (با زمان و نام ادمین) ثبت می‌شود. با `/order 1234` تاریخچه‌ی کامل هر سفارش را می‌بینید.

### تصمیم‌هایی که با هم گرفتیم
1. `user_id` ثابت است و همراه کلید برای هر تأمین‌کننده ذخیره می‌شود. کلید فقط از داخل پنل وارد می‌شود و ربات پیام حاوی کلید را **پاک می‌کند**.
2. کیف پول پیش‌پرداخت است. API آدرسی برای دیدن موجودی ندارد، پس ربات یک **موجودی تخمینی** از روی شارژهایی که ثبت می‌کنید و خریدها نشان می‌دهد.
3. **نرخ دلار** همان `usd_toman` خود API است.
4. **قیمت رسید:** رسیدی که مشتری با قیمت قبلی فرستاده (تا ۲۴ ساعت) پذیرفته می‌شود.
5. **ناموجود شدن خودکار:** گزینه فقط وقتی **همه‌ی منبع‌هایش** ناموجود باشند ناموجود می‌شود.
6. **ربات منشی** در سفارش‌های تأمین‌کننده دخالتی ندارد؛ همه‌چیز از ربات فروشگاه است.
7. **گارانتی** مثل الان به ادمین می‌رسد، به‌علاوه‌ی آیدی و دکمه‌ی چت با مشتری.
8. **«خرج دوباره از کیف پول» هرگز خودکار اتفاق نمی‌افتد.** اگر معلوم نباشد سفارش ثبت شده یا نه (قطع شدن ارتباط)، ربات دوباره سفارش نمی‌دهد و از شما می‌پرسد.

### قبل از شروع (کار شما)
- در تنظیمات محیط سشن این‌ها را بگذارید: `CLOUDFLARE_API_TOKEN` و `CLOUDFLARE_ACCOUNT_ID` (برای گرفتن کپی دیتابیس) و `ARIOBOX_API_KEY` و `ARIOBOX_USER_ID` (برای تست API). کلید را در چت نفرستید.
- **پیوست A** (تست واقعی API) و **پیوست B** (تمرین مایگریشن روی کپی دیتای واقعی) را **همان سشن برنامه‌ریز (Opus) انجام می‌دهد**، نه مدل پیاده‌ساز.

### کدام مدل؟
- **Sonnet** برای همه‌ی مرحله‌ها. مرحله‌های S5 تا S7 با پول (کیف پول) سروکار دارند و یک اشتباه در آن‌ها یعنی خرید دوباره.
- **Haiku** فقط برای S8 (گزارش) و S9 (README).
- بعد از هر مرحله، `npm run typecheck && npm test` باید سبز باشد.

### بعد از پیاده‌سازی (کار شما)
`npm run db:backup` ← `npm run db:migrate:remote` ← `npm run deploy` ← پنل «🔌 API تأمین‌کننده» ← «➕ افزودن تأمین‌کننده».

---

## 0. Ground rules for the implementer

1. **Work only inside `business-bots-cloudflare/`.** Read `PLAN.md` §3 (free-plan budget rules R1–R7) and §18, and `FEATURES_PLAN.md` §0 and §15. All of those rules still apply.
2. **The code is the source of truth.** This plan was written against commit `5145306`. If the code has moved, adapt this plan's details to the code, not the other way round.
3. **Existing behavior stays the same unless this plan changes it.** Products **without** supplier sources must behave exactly as today, including the receipt flow, the monshi bridge, manual purchase links and referral rewards. Keep every existing Persian string and callback-data string unless a section below explicitly replaces it.
4. **Budget (R1):** every Telegram call, D1 statement (each statement inside `batch()` counts) and supplier `fetch` costs 1 from the 50-unit budget per invocation. Supplier fetches must call `app.apps.budget.take()` before `app.apps.fetch(...)`, the same way `src/monshi/services/gemini.ts` does. Keep normal updates ≤ 35. Cron loops check `budget.remaining()` before each unit of work.
5. **Indexes (R4):** add every new hot query to `test/indexes.test.ts`, and add `product_sources`, `supplier_orders`, `fulfillment_events`, `order_deliveries`, `stock_accounts` to its `BIG` list.
6. **SQL:** plain positional `?` placeholders. Never `bind(undefined)`. Never interpolate user input or supplier data into SQL.
7. **Money safety (the most important rule).** A supplier `POST /orders` may be sent **only** by `placeSupplierOrder()` (§7.3), and **only** after it won the atomic claim `queued → placing`. Nothing else may ever call the order endpoint. Any outcome where we don't know whether the order was created becomes `unknown` and goes to the admin. It is **never** retried automatically.
8. **New admin messages use `parse_mode: 'HTML'`** and pass every dynamic value (product names, customer names, supplier names, account values, error texts) through `escapeHtml` (§2.4). Customer-facing delivery messages also use HTML, so account values can be shown in `<code>`.
9. **Secrets:** never log an API key, never put it in a URL (use the `X-Api-Key` header), and never echo it back in a message (show `••••` + last 4 characters only). Supplier error texts saved to D1 or shown to admins are cut to 300 characters.
10. **Commits and checks:** run `npm run typecheck && npm test` before every commit; both must pass. One commit per milestone (§13). Push to the branch your session tells you to use. Don't open a PR unless the user asks.
11. **No remote commands:** don't run `npm run setup`, `wrangler deploy` or any remote D1 command. Code and tests only.
12. **Stop points:** ~~if Appendix A is empty, stop before S5~~. The owner decided to build S5–S9 on the conservative assumptions listed in Appendix A, and to verify them against the live API before any deploy.

---

## 1. Concepts

| Concept | Where it lives | Meaning |
|---|---|---|
| **Group** | `product_groups` | What the customer sees in the catalog («ChatGPT Plus»). Optional: a product without a group behaves exactly as today. |
| **Option** | `customer_products` row with `group_id` set | One sellable choice inside a group («۱ ماهه»). It is still an ordinary `customer_products` row with its own price, duration, warranty, terms, stock and waitlist. Orders, discount codes, renewals, reminders, waitlist, manual links and referral rewards keep pointing at `customer_products.id`, so they need no changes. |
| **Display name** | `customer_products.name` | For a grouped option, always kept equal to `group.name + ' — ' + option_label` (denormalised on every rename). That way every existing `product.name` / `orders.product_name` usage keeps working. |
| **Supplier** | `suppliers` | One reseller account (kind `ariobox`), with its key and `remote_user_id`. |
| **Catalog cache** | `supplier_catalogs` | The last fetched product list as **one JSON blob** per supplier. One write per sync; we never write one row per supplier item. |
| **Source** | `product_sources` | Links an option to one supplier item (remote product id + variation id), with a priority and an enabled flag. An option with **≥ 1 source row** (enabled or not) is a **supplier-fulfilled** option. |
| **Supplier order** | `supplier_orders` | One attempt to buy from a supplier, either for a customer order (`purpose='customer'`) or for the admin's own stock (`purpose='stock'`). |
| **Delivery** | `order_deliveries` | What was given to a customer (account fields or admin text). Kept forever and shown again under «📋 اشتراک‌های من». |
| **Stock** | `stock_batches`, `stock_accounts` | Accounts the admin bought for themselves («📦 اکانت‌های من»). |
| **Event log** | `fulfillment_events` | Append-only audit trail: every automatic step and every admin action, with the actor and time. |
| **Wallet ledger** | `wallet_ledger` | Top-ups the admin records, plus automatic spends. Used for the *estimated* balance. |

---

## 2. Schema and shared helpers (milestone S1)

### 2.1 `migrations/store/0003_supplier.sql`

Never edit `0001_*` / `0002_*`. (`0003` keeps the `orders` AUTOINCREMENT counter across the rebuild via a scratch table `_orders_seq` and `sqlite_sequence`, so the id of a deleted pending order is never reused.) The `orders` table is **rebuilt** because its `status` CHECK must gain `'cancelled'`, and SQLite can't alter a CHECK. Follow the SQLite "12-step" procedure. D1 doesn't allow `PRAGMA foreign_keys=OFF` in migrations; use `PRAGMA defer_foreign_keys = on` as the D1 docs advise.

```sql
-- ============================================================
--  Round-3: supplier API, option groups, cancellation (see SUPPLIER_PLAN.md)
-- ============================================================
PRAGMA defer_foreign_keys = on;

-- ---- orders: rebuild to add status 'cancelled' + fulfillment columns ----
CREATE TABLE orders_new (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_telegram_id INTEGER NOT NULL,
    customer_product_id  INTEGER NOT NULL,
    product_name         TEXT    NOT NULL,
    price                REAL    NOT NULL,
    receipt_file_id      TEXT,
    receipt_type         TEXT    CHECK (receipt_type IN ('photo', 'document')),
    purchase_source      TEXT    NOT NULL DEFAULT 'receipt' CHECK (purchase_source IN ('receipt', 'manual')),
    status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'delivered', 'cancelled')),
    created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
    decided_at           TEXT,
    decided_by           INTEGER,
    discount_code_id     INTEGER,
    duration_days        INTEGER,
    warranty_days        INTEGER,
    delivered_at         TEXT,
    expires_at           TEXT,
    warranty_expires_at  TEXT,
    reminded_7d          INTEGER NOT NULL DEFAULT 0,
    reminded_3d          INTEGER NOT NULL DEFAULT 0,
    reminded_expired     INTEGER NOT NULL DEFAULT 0,
    stalled_alert_sent   INTEGER NOT NULL DEFAULT 0,
    last_warranty_claim_at TEXT,
    paid_failed_handled  INTEGER NOT NULL DEFAULT 0,
    reject_reason        TEXT,
    receipt_unique_id    TEXT,
    -- round 3
    customer_username    TEXT,                -- snapshot at order time (without '@'); NULL = none/unknown
    fulfillment          TEXT CHECK (fulfillment IN ('supplier', 'stock', 'manual_text', 'manual_outside')),  -- NULL = legacy path (monshi / manual link)
    needs_action_reason  TEXT,                -- NULL = nothing for the admin to decide (see §8.1 codes)
    needs_action_at      TEXT,
    supplier_deadline_at TEXT,                -- decided_at + 20 h; automatic retries stop after this
    cost_toman           INTEGER,             -- what we paid for this order (NULL = unknown)
    cancel_reason        TEXT,
    cancelled_at         TEXT,
    cancelled_by         INTEGER,
    refund_status        TEXT CHECK (refund_status IN ('pending', 'done', 'none')),
    refunded_at          TEXT,
    FOREIGN KEY (customer_product_id) REFERENCES customer_products(id),
    FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
);
INSERT INTO orders_new (
    id, customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type,
    purchase_source, status, created_at, decided_at, decided_by, discount_code_id, duration_days, warranty_days,
    delivered_at, expires_at, warranty_expires_at, reminded_7d, reminded_3d, reminded_expired, stalled_alert_sent,
    last_warranty_claim_at, paid_failed_handled, reject_reason, receipt_unique_id)
SELECT
    id, customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type,
    purchase_source, status, created_at, decided_at, decided_by, discount_code_id, duration_days, warranty_days,
    delivered_at, expires_at, warranty_expires_at, reminded_7d, reminded_3d, reminded_expired, stalled_alert_sent,
    last_warranty_claim_at, paid_failed_handled, reject_reason, receipt_unique_id
FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX IF NOT EXISTS idx_orders_status_decided  ON orders(status, decided_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_expires  ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_telegram_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_receipt_unique  ON orders(receipt_unique_id);
CREATE INDEX IF NOT EXISTS idx_orders_needs_action    ON orders(needs_action_at) WHERE needs_action_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status_cancelled ON orders(status, cancelled_at);

-- ---- customers / products / codes / claims ----
ALTER TABLE customers ADD COLUMN username TEXT;                         -- without '@'
CREATE INDEX IF NOT EXISTS idx_customers_username ON customers(username);

CREATE TABLE IF NOT EXISTS product_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);
ALTER TABLE customer_products ADD COLUMN group_id INTEGER REFERENCES product_groups(id);
ALTER TABLE customer_products ADD COLUMN option_label TEXT;               -- required when group_id is set
ALTER TABLE customer_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_products ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'manual';  -- 'manual' | 'auto'
ALTER TABLE customer_products ADD COLUMN markup_percent REAL;             -- NULL (with markup_fixed NULL) = use the default
ALTER TABLE customer_products ADD COLUMN markup_fixed INTEGER;            -- Toman
ALTER TABLE customer_products ADD COLUMN cost_toman INTEGER;              -- current cost from the active source; NULL = no source / unknown
ALTER TABLE customer_products ADD COLUMN stock_mode TEXT NOT NULL DEFAULT 'manual';    -- 'manual' | 'auto'
ALTER TABLE customer_products ADD COLUMN price_updated_at TEXT;
CREATE INDEX IF NOT EXISTS idx_products_group ON customer_products(group_id, is_active);

ALTER TABLE discount_codes ADD COLUMN product_group_id INTEGER;           -- set = valid for every option of the group

ALTER TABLE manual_purchase_claims ADD COLUMN fulfillment TEXT;           -- NULL/'outside' (as today) | 'stock' | 'supplier'
ALTER TABLE manual_purchase_claims ADD COLUMN stock_account_id INTEGER;

-- ---- suppliers ----
CREATE TABLE IF NOT EXISTS suppliers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT    NOT NULL CHECK (kind IN ('ariobox')),
  name             TEXT    NOT NULL,
  base_url         TEXT    NOT NULL,
  api_key          TEXT    NOT NULL,
  remote_user_id   INTEGER NOT NULL,
  is_enabled       INTEGER NOT NULL DEFAULT 1,
  last_sync_at     TEXT,
  last_sync_ok_at  TEXT,
  last_sync_error  TEXT,
  sync_alert_sent  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);

CREATE TABLE IF NOT EXISTS supplier_catalogs (
  supplier_id   INTEGER PRIMARY KEY REFERENCES suppliers(id),
  fetched_at    TEXT    NOT NULL,
  usd_toman     REAL    NOT NULL,
  items_json    TEXT    NOT NULL,     -- normalised items, see §4.2
  items_hash    TEXT    NOT NULL,     -- sha-256 of items_json + usd_toman
  applied_hash  TEXT                  -- = items_hash once every source/option is updated (§6.2)
);

CREATE TABLE IF NOT EXISTS product_sources (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_product_id INTEGER NOT NULL REFERENCES customer_products(id),
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
  remote_product_id   TEXT    NOT NULL,
  remote_variation_id TEXT    NOT NULL DEFAULT '',     -- '' = item has no variation
  remote_name         TEXT    NOT NULL,
  attributes_json     TEXT    NOT NULL DEFAULT '{}',
  price_usd           REAL,
  listed              INTEGER NOT NULL DEFAULT 1,      -- present in the last catalog
  oos_until           TEXT,                            -- set after a 409; treated as unavailable until then
  priority            INTEGER NOT NULL DEFAULT 1,      -- 1 = primary
  is_enabled          INTEGER NOT NULL DEFAULT 1,      -- admin switch
  created_at          TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  UNIQUE (customer_product_id, supplier_id, remote_product_id, remote_variation_id)
);
CREATE INDEX IF NOT EXISTS idx_sources_supplier ON product_sources(supplier_id, id);
CREATE INDEX IF NOT EXISTS idx_sources_product  ON product_sources(customer_product_id, priority);
CREATE INDEX IF NOT EXISTS idx_sources_remote   ON product_sources(supplier_id, remote_product_id, remote_variation_id);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose             TEXT    NOT NULL CHECK (purpose IN ('customer', 'stock')),
  order_id            INTEGER,                 -- store order (purpose='customer')
  customer_product_id INTEGER,
  source_id           INTEGER,                 -- the source actually used (NULL while not chosen)
  forced_source_id    INTEGER,                 -- admin chose this source (skips enabled/loss checks)
  supplier_id         INTEGER,
  remote_product_id   TEXT,
  remote_variation_id TEXT,
  quantity            INTEGER NOT NULL DEFAULT 1,
  status              TEXT    NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'placing', 'placed', 'completed', 'failed', 'unknown', 'cancelled')),
  lease_until         TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  checks              INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TEXT,
  next_check_at       TEXT,
  remote_order_id     TEXT,
  remote_status       TEXT,
  price_usd           REAL,                    -- unit price we were charged (see Appendix A for unit/total)
  usd_toman           REAL,
  cost_toman          INTEGER,                 -- total, rounded
  last_http           INTEGER,
  last_error          TEXT,
  divert_to_stock     INTEGER NOT NULL DEFAULT 0,   -- customer order was resolved otherwise → accounts go to stock
  first_fail_notified INTEGER NOT NULL DEFAULT 0,
  requested_by        INTEGER NOT NULL DEFAULT 0,   -- admin telegram id, 0 = automatic
  raw_response        TEXT,                    -- last supplier JSON (cut to 4000 chars)
  created_at          TEXT    NOT NULL,
  placed_at           TEXT,
  completed_at        TEXT,
  updated_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_so_queue  ON supplier_orders(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_so_poll   ON supplier_orders(status, next_check_at);
CREATE INDEX IF NOT EXISTS idx_so_lease  ON supplier_orders(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_so_order  ON supplier_orders(order_id, id);

CREATE TABLE IF NOT EXISTS order_deliveries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('supplier', 'stock', 'manual_text')),
  content_json      TEXT    NOT NULL,          -- §2.5
  supplier_order_id INTEGER,
  stock_account_id  INTEGER,
  sent_ok           INTEGER NOT NULL DEFAULT 0,
  send_error        TEXT,
  created_by        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON order_deliveries(order_id, id);

CREATE TABLE IF NOT EXISTS fulfillment_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER,
  supplier_order_id INTEGER,
  batch_id          INTEGER,
  kind              TEXT    NOT NULL,          -- §2.6
  actor             INTEGER NOT NULL DEFAULT 0, -- admin telegram id, 0 = system
  detail            TEXT,                       -- short JSON or text, ≤ 500 chars
  created_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON fulfillment_events(order_id, id);
CREATE INDEX IF NOT EXISTS idx_events_so    ON fulfillment_events(supplier_order_id, id);

CREATE TABLE IF NOT EXISTS stock_batches (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id           INTEGER,
  supplier_order_id     INTEGER,
  title                 TEXT    NOT NULL,
  quantity              INTEGER NOT NULL,
  unit_price_usd        REAL,
  usd_toman             REAL,
  cost_toman            INTEGER,              -- total
  reported_profit_toman INTEGER,              -- admin's free-form profit for the whole batch (overrides per-account)
  reported_at           TEXT,
  note                  TEXT,
  created_by            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id         INTEGER NOT NULL REFERENCES stock_batches(id),
  content_json     TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available', 'reserved', 'delivered', 'sold_outside', 'defective')),
  order_id         INTEGER,
  sold_price_toman INTEGER,
  sold_at          TEXT,
  note             TEXT,
  updated_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_batch  ON stock_accounts(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_status ON stock_accounts(status, id);
CREATE INDEX IF NOT EXISTS idx_stock_sold   ON stock_accounts(status, sold_at);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id       INTEGER NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('topup', 'spend', 'refund', 'adjust')),
  amount_usd        REAL    NOT NULL,          -- + top-up / refund, − spend
  supplier_order_id INTEGER,
  note              TEXT,
  created_by        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_supplier ON wallet_ledger(supplier_id, id);

PRAGMA defer_foreign_keys = off;
```

D1 runs each migration file in an implicit transaction, which `defer_foreign_keys` needs; `FakeD1.migrate()` mirrors this by wrapping each file in BEGIN/COMMIT.

Then:
- **Update `src/store/db.ts`:** the `Order`, `CustomerProduct`, `DiscountCode` types and every `SELECT` that lists columns explicitly. Grep for `FROM orders` and `customer_products`.
- **`STALLED_QUERY`:** add `AND (fulfillment IS NULL OR fulfillment <> 'supplier')`. Supplier orders get their own 20 h handling (§7.6). The index test must still pass.
- **`scripts/sqlite_to_d1.py`:** add the new columns of `customers`, `customer_products`, `orders`, `discount_codes`, `manual_purchase_claims` to its target column lists, exactly the way `0002` columns (`is_available`, `ref_code`, …) were added. `test/migration.test.ts` compares the lists with the migrated schema.
- **New test `test/store/migration0003.test.ts`:**
  1. Build a DB from `0001` + `0002` only.
  2. Seed it with rows that reference `orders`: a manual claim with `order_id`, a discount redemption with `order_id`, and an order of every status.
  3. Apply `0003`.
  4. Assert that every row and value survived, `PRAGMA foreign_key_check` is empty, the four old indexes exist, and an `INSERT … status='cancelled'` now works.

  If the rebuild fails under `node:sqlite` with foreign keys ON, **stop and tell the user**. Don't drop the FK clauses.

### 2.2 Time helper
Add `tehranDateTime(d: Date): string` to `src/lib/time.ts`. It returns `'YYYY-MM-DD HH:MM:SS'` at UTC+03:30, the same format and offset as `datetime('now', '+03:30')`; reuse an existing formatter if one is there. **Every new time column is written from JS with `tehranDateTime(app.apps.now())`** (or `now + Δ`), so tests can drive time through `deps.now` and `t.cron(now)`. Comparisons in SQL take that string as a bound parameter.

### 2.3 Customer identity: `src/store/customerRef.ts`
- `upsertCustomer` gets an optional `username`. Store it without `@`, and refresh it whenever it's given. `/start` and receipt submission pass `ctx.from.username ?? null`.
- `createOrder` stores `customer_username` (from `ctx.from.username`). The other order creators fill it from `customers.username`: manual claim, reward order, and send-from-stock.
- `customerRefHtml({ id, name, username })` returns two lines:
  `👤 مشتری: <a href="tg://user?id=ID">NAME</a>` + (username ? ` (@USERNAME)` : '') and `🆔 آیدی عددی: <code>ID</code>`. Escape `NAME` and `USERNAME`.
- `customerContactRow(id, username, orderId)` returns one keyboard row:
  `[💬 چت با مشتری]` (url `https://t.me/USERNAME` if there is a username, else `tg://user?id=ID`) + `[✉️ پیام از طرف ربات]` (callback `fo_msg_<orderId>`).
- `sendToAdmins(app, html, rows)` sends to every admin with `parse_mode: 'HTML'`. If Telegram answers 400 and the description contains `BUTTON_USER_PRIVACY_RESTRICTED` (a `tg://user` button is refused when the customer's privacy settings forbid it), resend **once** without the `💬` button. It returns the number of admins reached. Use it for every new admin notification and for the warranty claim.
- **Warranty claim** (`warranty_claim_<id>` in `storefront.ts`): switch the admin message to `sendToAdmins` + `customerRefHtml` + `customerContactRow`. Keep the same lines and wording otherwise.

### 2.4 `escapeHtml(s)` in `src/store/utils.ts`
Escapes `&`, `<`, `>` and `"`.

### 2.5 Account content format (`content_json`)
```json
{ "accounts": [ { "fields": [ { "key": "activation_link", "value": "https://…" } ] } ] }   // supplier / stock
{ "text": "user: a@b.c\npass: 123" }                                                      // manual text
```
`formatAccountsHtml(content)` in `src/store/suppliers/format.ts`:
- **Field labels:** `activation_link`→`🔗 لینک فعال‌سازی`, `email`/`username`/`login`/`user`→`👤 نام کاربری`, `password`/`pass`→`🔑 رمز عبور`, `code`/`license`/`key`→`🎫 کد`, anything else → `▫️ ` + the escaped key.
- **Values:** in `<code>…</code>`. A value that starts with `http` is shown as plain escaped text, so it stays clickable.
- **Several accounts:** each block starts with `اکانت N:`.
- **Manual text:** `<code>` around the whole escaped text.
- **Length:** keep the result under 3,500 characters; if longer, cut it and add `(…ادامه در پیام بعد)`, then send the rest in a second message.

### 2.6 Event kinds (`fulfillment_events.kind`)
`queued`, `claim`, `placed`, `place_failed`, `out_of_stock`, `unknown`, `poll`, `completed`, `delivered`, `send_failed`, `needs_action`, `admin_retry`, `admin_source`, `admin_stock`, `admin_text`, `admin_self`, `admin_done`, `admin_cancel`, `refund_done`, `admin_message`, `diverted_to_stock`, `cost_set`, `remote_id_set`.
Helper: `logEvent(app, { orderId?, supplierOrderId?, batchId?, kind, actor?, detail? })`, 1 statement. Wherever possible, add it to the same `batch()` as the state change it records.

### 2.7 Supplier defaults (kv)
In `store_kv`, key `supplier_defaults` holds `{"markupPercent": number|null, "markupFixed": number|null}`. Both start `null` (not set). Parse with strict validation: `0 ≤ percent ≤ 500`, `0 ≤ fixed ≤ 100000000`, integers for `fixed`. Follow the `referralConfig.ts` pattern.

---

## 3. Groups and options (milestone S2)

### 3.1 Storefront catalog
- **Entries:** `getCatalogEntries(app)` loads the active products (the existing query plus `group_id, option_label, sort_order`) and their groups (`SELECT id, name, sort_order FROM product_groups WHERE id IN (…)`, chunked), in one `batch` when possible. It builds the entries:
  - a **group entry** for each group with ≥ 1 active option;
  - a **product entry** for each active product with `group_id IS NULL`.
- **Sort:** by `sort_order` (the group's or the product's), then the smallest member id.
- **Button labels:**
  - group, at least one option `is_available=1`: `NAME  |  از MIN ت`, where `MIN` is the minimum price among available options (`formatPrice`);
  - group, all options unavailable: `⛔️ NAME (ناموجود)`;
  - standalone product: unchanged (`catalogLabel`).
- **Paging:** `catalogKeyboard` pages over entries. Group callback: `cust_grp_<groupId>`. Product callback: `cust_prod_<id>` (unchanged). Make `productPickerKeyboard` generic over `{ id, label, callback }` entries, or add a sibling helper; don't break its other callers.
- **`cust_grp_<groupId>`:**
  - If the group has exactly **one** active option, behave exactly like `cust_prod_<thatId>`.
  - Otherwise, edit the message to `📦 *NAME*\n\nلطفاً مدت/نوع را انتخاب کنید:` (Markdown with `escapeMarkdown`, like the surrounding code). Show one button per active option, sorted by `sort_order`, then `duration_days`, then `id`: `LABEL  |  PRICE ت` → `cust_prod_<id>`, or `⛔️ LABEL (ناموجود)` → `cust_prod_<id>` (the existing out-of-stock / waitlist branch handles it). Add a last row `🔙 بازگشت` → `cust_catalog_page_0`; that handler must then edit the text back as well as the keyboard.
- **Everything after `cust_prod_<id>`** stays unchanged: discount prompt, terms, receipt, renew, waitlist.

### 3.2 Admin: editing options
In the edit wizard card (`customerProductsEdit.ts`):
- **Grouped option:** the `name` field is replaced by `🏷 عنوان گزینه` (`option_label`, 1–40 characters). Show the group name on the card.
- **New buttons:**
  - `🗂 گروه` lists groups paged (`cprod_edit_grp_<id>`), plus `➕ گروه جدید` (asks for a name, 1–60 characters) and `▫️ بدون گروه`. Moving an option into a group asks for its `option_label` if it's empty (default: the duration as `N روزه`, or the old name).
  - `✏️ نام گروه` renames the group.
  - `🔢 ترتیب` takes an integer from 0 to 999.
  - `🔌 منابع و قیمت` opens §5.3 (callback `sup_src_<productId>`, see bypass in §9).
- **Name sync:** `syncOptionNames(app, groupId)` sets `name = group.name || ' — ' || option_label` for every option of the group in **one** `UPDATE … WHERE group_id = ?`. Leaving a group sets `name = option_label`. Call it after every group rename or label change.
- **Terms for the whole group:** for a grouped option, the terms field offers `📋 اعمال روی همه‌ی گزینه‌های گروه`.

### 3.3 Discount codes for a whole group
- **Add/edit wizard:** after the product is picked, if it has a `group_id`, ask `این کد برای کدام؟` with `[فقط «LABEL»]` or `[همه‌ی گزینه‌های «GROUP»]`. For the group choice, store `product_group_id = group_id` and keep `customer_product_id = the picked option` (the column is NOT NULL).
- **Validation:** `validateDiscountCode` / `validateDiscountCodeForOrder` receive the `CustomerProduct` (change their signature and update the callers). The product check becomes: `code.product_group_id != null ? product.group_id === code.product_group_id : code.customer_product_id === product.id`.
- **Code list:** shows `همه‌ی گزینه‌های «GROUP»` for group codes.
- **Price warnings:** `getFixedCodesAtLeast` and the edit wizard's `priceWarnings` must also consider group codes.

### 3.4 Tests (S2)
- catalog with mixed groups and standalone products: order, labels, paging;
- group with a single option skips the choice step;
- all options unavailable;
- back button;
- name sync after a rename;
- a group discount code works for each option and is refused for other products;
- the full purchase of a grouped option reaches the admin receipt with the full name.

---

## 4. Suppliers: adapter and admin (milestone S3)

### 4.1 ArioBox API (from the owner's document)
Base `https://ariobox.space`. Auth: header `X-Api-Key: KEY` (query `apikey` and `Authorization: Bearer` also work; **use the header only**).

| Call | Request | Success body (relevant fields) |
|---|---|---|
| `GET /api/v1/reseller/products` | — | `{ ok, usd_toman: number, currency: "USD", updated_at, items: [{ name, product_id: string, sku, variation_id: string ('' = none), price: number (USD), attributes: { [k]: string } }] }` |
| `POST /api/v1/reseller/orders` | JSON `{ product_id, variation_id?, quantity (1–10, default 1), user_id (required, WooCommerce id), note? (≤ 500) }` | `{ ok, order_id: number, number, status: "pending", product_id, variation_id, quantity, user_id, price: number }` |
| `GET /api/v1/reseller/orders/{order_id}` | — | `{ ok, order_id, status, …, price: string, accounts?: [{ attributes: [{ key, value }] }], message?: string }` |

Errors in the document: `401` bad/no key (`{"detail":"invalid api key"}`), `400` invalid body / no id, `404` order or WooCommerce user not found, `409` out of stock or no price, `503` prices or ordering temporarily unavailable. **Unknown until Appendix A:** what "wallet balance too low" looks like; whether `price` in the order response is per unit or total; the status names besides `pending`/`completed`.

### 4.2 Adapter interface: `src/store/suppliers/types.ts`
```ts
export interface CatalogItem { remoteProductId: string; remoteVariationId: string; name: string; sku: string; priceUsd: number | null; attributes: Record<string, string> }
export interface Catalog { usdToman: number; items: CatalogItem[]; updatedAt: string | null }
export type FetchResult<T> = { ok: true; value: T } | { ok: false; kind: 'auth' | 'temporary' | 'bad_response'; http: number | null; detail: string };
export type PlaceResult =
  | { kind: 'placed'; remoteOrderId: string; remoteStatus: string; priceUsd: number | null; raw: string }
  | { kind: 'out_of_stock'; http: number; detail: string }              // nothing was bought
  | { kind: 'retry_later'; http: number | null; detail: string }        // nothing was bought (503, low balance per Appendix A)
  | { kind: 'config'; http: number; detail: string }                   // 401 / 404 user: the admin must fix settings
  | { kind: 'rejected'; http: number; detail: string }                 // 400 etc.: nothing was bought, won't succeed by retrying
  | { kind: 'unknown'; http: number | null; detail: string };          // MAY have been bought (timeout, network error, 5xx≠503, 2xx without order_id)
export type StatusResult =
  | { kind: 'ok'; remoteStatus: string; accounts: { fields: { key: string; value: string }[] }[]; message: string | null; raw: string }
  | { kind: 'error'; http: number | null; detail: string };
export interface SupplierAdapter {
  fetchCatalog(s: SupplierRow): Promise<FetchResult<Catalog>>;
  placeOrder(s: SupplierRow, p: { remoteProductId: string; remoteVariationId: string; quantity: number; note: string }): Promise<PlaceResult>;
  getOrder(s: SupplierRow, remoteOrderId: string): Promise<StatusResult>;
}
```

### 4.3 `src/store/suppliers/ariobox.ts`
- **Every call:** `app.apps.budget.take()`, then `app.apps.fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'X-Api-Key': key, Accept: 'application/json' } })`. Wrap it in try/catch. `base_url` has no trailing slash.
- **`fetchCatalog`:** parse the body defensively.
  - Error if `usd_toman` is not a positive number, or if `items` is not an array.
  - Skip any item whose `product_id` doesn't match `^[A-Za-z0-9_-]{1,24}$`, or whose `variation_id` isn't `''` or the same pattern. Ids go into callback data and must stay short and safe.
  - `price`: a finite number > 0, else `null`.
  - `attributes`: string values only.
  - Errors: 401/403 → `auth`; network/timeout/5xx → `temporary`; anything else → `bad_response`.
- **`placeOrder`:**
  - POST JSON with `product_id`, `variation_id` (omit if `''`), `quantity`, `user_id: remote_user_id`, `note`.
  - Mapping:
    - `2xx` with a numeric `order_id` → `placed`.
    - `2xx` without one → `unknown`.
    - `409` → `out_of_stock`.
    - `503` → `retry_later`.
    - `401`, or `404` with "user" in the detail → `config`.
    - `400` and other `4xx` → `rejected`, unless Appendix A maps a code to `retry_later` (e.g. low balance).
    - Network error, timeout, `5xx ≠ 503` → `unknown`.
  - **Never retry inside the adapter.**
- **`getOrder`:** GET with `encodeURIComponent(remoteOrderId)`. Map `accounts[].attributes[]` to `fields`.
- **Registry:** `adapterFor(kind)` in `src/store/suppliers/index.ts`.

### 4.4 Test helper `test/helpers/fakeAriobox.ts`
A programmable fake for `deps.fetch`:
- a catalog the test can change;
- a queue of responses for POST (`placed` / 409 / 503 / timeout / 500 / custom);
- order states for GET;
- a call log with method, path and the `X-Api-Key` value, so tests can assert the key never appears in the URL.

`makeTestEnv({ fetch })` already accepts a fetch.

### 4.5 Admin panel «🔌 API تأمین‌کننده» (`src/store/handlers/supplierPanel.ts`)
Add the label `SUPPLIER_LABEL = '🔌 API تأمین‌کننده'` to `labels.ts` and a new row `[LABEL.supplier]` in `adminPanelKeyboard()`. The panel is **callback-driven, not a wizard**, like `referralPanel.ts`. Typed inputs use one session field (§9.2).

Main menu (inline, `sup_menu`):
```
🔌 API تأمین‌کننده
⏸ نیازمند تصمیم: N سفارش
[🏪 تأمین‌کننده‌ها] [📥 افزودن محصول]
[🛒 خرید مستقیم]   [📦 اکانت‌های من]
[⏸ نیازمند تصمیم (N)] [💹 سود پیش‌فرض]
[❌ بستن]
```

- **`🏪 تأمین‌کننده‌ها` → list → supplier card** (`sup_s_<id>`):
  - **Card text:** name, kind, enabled state, key `••••abcd`, `user_id`, last sync (Jalali) and its error if any, `usd_toman`, number of items in the catalog, number of linked options, estimated wallet (§10.4).
  - **Buttons:** `🔄 همگام‌سازی الان` (runs §6.1 for this supplier inline if `budget.remaining() ≥ 30`, else answers «در دقیقه‌ی بعد انجام می‌شود» and sets `last_sync_at = NULL` so cron picks it up), `📋 محصولات`, `🔑 تغییر کلید`, `👤 تغییر user_id`, `⏯ فعال/غیرفعال`, `💳 ثبت شارژ کیف پول`, `🧾 تاریخچه‌ی کیف پول`, `🔙`.
- **`➕ افزودن تأمین‌کننده`** (at the bottom of the list):
  1. Kind: only `ArioBox` for now.
  2. Name: 1–40 characters; default `آریوباکس`.
  3. Base URL: button `پیش‌فرض (https://ariobox.space)` or typed; must start with `https://`.
  4. API key: 8–200 characters. **Delete the admin's message** with `ctx.deleteMessage()` (ignore failure) and confirm `🔑 کلید دریافت و پیام حاوی آن پاک شد.`
  5. `user_id`: a positive integer.
  6. **Test the connection** with `fetchCatalog`. On success, save the supplier together with its first `supplier_catalogs` row and show `✅ اتصال برقرار شد — N محصول، نرخ دلار X تومان`. On `auth` failure, show `❌ کلید API نامعتبر است.` and offer to retype the key. On other failures, show the error and offer `ذخیره بدون تست` / `دوباره`.
- **`📋 محصولات`** (`sup_items_<sid>_<page>`):
  - Read the catalog blob and group the items by `remoteProductId`. Paged, 8 per page.
  - Button label: `NAME (N گزینه) از $MIN` + ` ✅` if any of its variations is already a source somewhere.
  - Tapping one opens the import preview (§5.1).
- **`💹 سود پیش‌فرض`:** shows the current value, then `[٪ درصد] [＋ مبلغ ثابت] [🔙]`. Each asks for a number (`0` allowed). After saving, offer `🔁 اعمال روی همه‌ی گزینه‌های خودکاری که سود اختصاصی ندارند`, which recomputes them (§6.3) and reports the count.

### 4.6 Tests (S3)
- adapter mapping for every HTTP case;
- the key goes only in the header;
- bad ids are skipped;
- add-supplier flow: the message with the key is deleted, auth failure, success saves the catalog;
- supplier card;
- item list paging.

---

## 5. Import, sources and automatic pricing (milestone S4)

### 5.1 Import preview (`sup_imp_<sid>_<remoteProductId>`)
Build an import draft in the session (`supplierImport`, §9.2) from the catalog blob:
- **Group name:** the item `name`.
- **Options:** one per variation (or a single option when `remoteVariationId === ''`), in catalog order. For each option:
  - `durationDays` = `parseDuration(attributes['subscription-duration'] ?? attributes['duration'])`;
  - `warrantyDays` = `parseDuration(attributes['warranty'])`;
  - `label`: `N ساله` when the supplier's value is in years (`1-year`, `2-years`), else `N ماهه` (N = months, Persian digits) when the duration is a whole number of months, else `N روزه`. Without a duration, use the attribute values joined with ` | `, else `گزینه K`.
  - `parseDuration` accepts `^(\d+)[- ]?(day|days|month|months|year|years)$` (case-insensitive) → days (month = 30, year = 365). `none`, `no`, `0`, `no-warranty` → `null`. Anything else → `null` and the raw value is listed under «ویژگی‌های ناشناخته».
- **Pricing:** `markupPercent`/`markupFixed` start as `null` (= use the default); `terms` starts as `null`; every option starts `selected`.

Preview message (HTML):
```
📥 وارد کردن از «SUPPLIER»
📦 نام گروه: NAME
💹 سود: ۱۵٪ + ۰ ت (پیش‌فرض)
☑️ ۱ ماهه — مدت ۳۰ روز، گارانتی ۷ روز — خرید $5.28 ≈ ۱٬۴۲۰٬۸۴۸ ت → فروش ۱٬۶۴۰٬۰۰۰ ت
⬜️ ۳ ماهه — …
ℹ️ ویژگی‌های ناشناخته: region=EU
📜 شرایط: ندارد
```
- **Buttons:** one toggle per option `sup_impv_<index>` (index into the draft list), `✏️ نام گروه`, `🏷 عنوان/مدت/گارانتی یک گزینه` (pick an option, then a field), `💹 سود این محصول`, `📜 شرایط`, `✅ ساخت محصول`, `❌ انصراف`.
- **No markup set:** if neither the product nor the defaults have one, `✅` answers `⚠️ اول سود را تعیین کنید (پیش‌فرض یا همین محصول).`
- **Already imported:** if some variations are already a source of an existing option, mark them `🔗 قبلاً وارد شده («NAME»)` and start them unselected.

**`✅ ساخت محصول`** does the following in as few statements as possible (all in one `batch()`, using `last_insert_rowid()` sub-selects for the ids you need):
1. Create a `product_groups` row. If only one option is selected, still create the group; the single-option shortcut in §3.1 handles the display.
2. Create one `customer_products` row per selected option with `pricing_mode='auto'`, `stock_mode='auto'`, `group_id`, `option_label`, `sort_order = index`, duration/warranty/terms from the draft, and the draft's markup (both `null` = default).
3. Create one `product_sources` row per option with priority 1.
4. Compute prices (§6.3).

**Chunking:** one invocation creates at most `IMPORT_CHUNK` (10) options, so the batch is `1 + 2×10` statements and the invocation stays ≤ 35. The group `INSERT` is the first statement of the first batch (the options take its id with `(SELECT MAX(id) FROM product_groups)`, safe inside one transaction), so a failed batch leaves nothing behind. When more options are selected, the reply is `✅ N گزینه … ساخته شد. M گزینه‌ی دیگر مانده است.` with `[➕ ادامه‌ی ساخت]` (the same `sup_impok`), which adds the next chunk to the same group. A variation with no price (`price` null) is never selectable.

Then reply `✅ «NAME» با N گزینه ساخته شد و در لیست محصولات نمایش داده می‌شود.` with `[🔌 منابع و قیمت] [✏️ ویرایش محصول]`.

### 5.2 Price formula: `src/store/suppliers/pricing.ts`
```
cost_toman  = round(price_usd × usd_toman)
final_price = ceil((cost_toman × (1 + percent/100) + fixed) / 10000) × 10000
```
- **Integer-safe:** compute it in integers (the percent in hundredths), never as `cost * 1.1`: `100000 × 1.10` is `110000.00000000001` in floating point and would round up to 120,000. Tests use hard-coded expected prices.
- `percent`/`fixed` come from the option if either is non-null (a null in an override pair counts as 0), else from `supplier_defaults`.
- If the defaults are unset and the option has no override, the option keeps its current price and the sync reports `⚠️ سود تعیین نشده`.
- Pure functions, unit-tested: `costToman`, `roundUp10k`, `finalPrice`.

### 5.3 Sources screen (`sup_src_<productId>`)
```
🔌 منابع «NAME»
قیمت‌گذاری: خودکار (سود ۱۵٪ + ۰ ت) | موجودی: خودکار
قیمت فعلی: ۱٬۶۴۰٬۰۰۰ ت | قیمت خرید: ۱٬۴۲۰٬۸۴۸ ت
1️⃣ آریوباکس — chatgpt / 1300 — $5.28 — ✅ فعال، موجود
2️⃣ تأمین‌کننده B — … — ⛔️ غیرفعال (توسط شما)
```
- **Buttons per source:** `⬆️` / `⬇️` (swap priorities) and `⏯` (enable/disable). Also: `🗑 حذف منبع`, `➕ افزودن منبع` (pick supplier → product → variation from the catalog blob), `💲 حالت قیمت: خودکار/ثابت` (switches `pricing_mode`; to "ثابت" keeps the current price), `💹 سود اختصاصی` (set both, or `↩️ استفاده از پیش‌فرض`), `📦 حالت موجودی: خودکار/دستی`, `🔙`.
- **Last source:** the delete and the «no source left → manual» reset are one batch (the reset is conditional on no source remaining), so a concurrent add can't be undone. Removing the last one turns the option back into a normal product (`pricing_mode='manual'`, `stock_mode='manual'`, `cost_toman=NULL`) after the confirmation `⚠️ این آخرین منبع است؛ محصول به حالت دستی برمی‌گردد. مطمئنید؟`.
- **Recompute (§6.3)** after every change on this screen, and for every option of a supplier when that supplier is turned off or on (the rest by cron if the budget is short).
- **Adding a source:** the catalog item is identified by a 12-hex hash of its remote ids in the callback (`sup_srcn_<pid>_<sid>_<ref>`), looked up in the current catalog when tapped; never by position.
- The existing stock toggle in the edit wizard (`⛔️ ناموجود کن` / `✅ موجود کن`) sets `stock_mode='manual'` when pressed on an auto option. The card shows `📦 موجودی خودکار` to switch back.

### 5.4 Cost floor («زیر قیمت خرید نرود»)
A product has a floor when `cost_toman IS NOT NULL`.
- **Code creation and edit** (add/edit wizards, and `referrals.ts` when it builds a reward code): for each affected option (one, or every option of the group), compute `applyDiscount(price, code)`. If any result `< cost_toman`, refuse with (in the wizards, right after the product and scope are chosen, and then **ask the value again** instead of leaving the wizard): `⛔️ با این تخفیف، قیمت «NAME» (X تومان) از قیمت خرید (Y تومان) کمتر می‌شود. مقدار کمتری وارد کنید.` For referral reward codes, skip creating the code, mark the reward `failed` the same way the code already does for a missing product, and log a warning.
- **Customer code entry:** a new reason `below_cost` in `validateDiscountCode` (checked after the other rules). Customer label: `❌ این کد برای این محصول قابل استفاده نیست.`
- **Receipt confirm:** `below_cost` is **not** checked again here. The customer paid the price they were shown, and skipping the redemption would make a single-use (referral) code reusable. `validateDiscountCodeForOrder` skips the floor; only `validateDiscountCode` (code entry) applies it. The loss guard at confirmation is the separate rule in §7.2 (S5). The admin warning text has a label for `below_cost` all the same.

### 5.5 Tests (S4)
- `parseDuration` table;
- labels;
- draft toggles;
- create batch: rows, names, sources, prices;
- markup required;
- already-imported marking;
- the price formula, including rounding (1,420,848 × 1.15 = 1,633,975.2 → 1,640,000);
- sources screen: reorder, enable, remove the last source;
- floor checks in all three places.

---

## 6. Catalog sync (milestone S4, continued)

### 6.1 Fetch: `syncSupplier(app, supplier)`
Runs from cron when `t.minute % 10 === 2`, for each enabled supplier whose `last_sync_at` is NULL or older than 9 minutes; at most 3 suppliers per tick, and only while `budget.remaining() ≥ 25`.
1. Call `fetchCatalog`.
2. **Error:** write `last_sync_at` and `last_sync_error`. If `auth` and `sync_alert_sent = 0`, notify the admins at once: `❌ کلید API «NAME» نامعتبر است. همگام‌سازی و سفارش خودکار متوقف است تا کلید را درست کنید.` For other errors, notify only when `last_sync_ok_at` is older than 30 minutes and `sync_alert_sent = 0`. Set `sync_alert_sent = 1` after notifying.
3. **Success:** normalise the items, sort them by (product, variation), and compute `items_hash = sha256(JSON + usd_toman)`. Upsert `supplier_catalogs` only if the hash changed, then set `last_sync_ok_at` and `sync_alert_sent = 0`. If the supplier was in the alerted state, send `✅ اتصال «NAME» برقرار شد.`

### 6.2 Apply: `applyCatalog(app, supplierId)`
Runs every minute from cron while `applied_hash IS NOT items_hash`.
1. Load the blob and this supplier's sources (2 statements).
2. For each source, compute its new `listed`, `price_usd` and `attributes_json`.
3. Collect only the **changed** sources and write them in batches. Stop at 20 statements per tick; the next tick continues, which is safe because already-applied sources no longer differ.
4. Recompute every affected option (§6.3).
5. When nothing differs any more, set `applied_hash = items_hash`.

**Admin report:** one HTML message per apply round. Collect the lines in `app_state` key `sync_report_<sid>` across ticks and send the message when the round finishes. Line types:
- `• NAME: قیمت X ← Y تومان` (only when the **final** price changed);
- `• NAME: ناموجود شد` / `• NAME: دوباره موجود شد` (option availability changed). Add `📣 N نفر در لیست انتظارند` with the existing restock-notify button when the waitlist count > 0;
- `• NAME: مشخصات در تأمین‌کننده عوض شد: warranty 7-days ← 14-days (روی محصول شما تغییری داده نشد)`;
- `• NAME: از لیست «SUPPLIER» حذف شد`;
- `• «REMOTE NAME» گزینه‌ی جدید دارد: ATTRS` (a variation of an already-imported remote product that no source uses yet). Remember the reported keys in `app_state` `sync_seen_new_<sid>` so each one is reported only once;
- `⚠️ NAME: قیمت فروش (ثابت) X از قیمت خرید Y کمتر شده` (manual pricing mode with cost > price);
- `⚠️ کد تخفیف CODE روی «NAME» حالا قیمت را زیر قیمت خرید می‌برد` (fixed codes; cap at 5 lines).

Cut the message at 3,500 characters with `… و N مورد دیگر`. Send it to admins with `sendToAdmins`.

### 6.3 `recomputeOption(app, productId)`
1. Pick the **active source**: the first source by `priority` with `is_enabled = 1`, `listed = 1`, `price_usd` not null, the supplier enabled, and `oos_until` null or past. Use the catalog's `usd_toman`.
2. `cost_toman` = the active source's cost, or NULL if there is none.
3. If `pricing_mode = 'auto'` and there is an active source and a markup → set `price` to `finalPrice`. Otherwise keep the price.
4. If `stock_mode = 'auto'`, set `is_available = active source exists ? 1 : 0`.
5. Write only if something changed (1 statement); set `price_updated_at` when the price changes.
6. Return the change set so the sync report can use it.

The receipt drafts' 24 h TTL already gives "an old price is accepted for 24 h". Nothing else is needed for that.

### 6.4 Tests (S4)
- sync writes the blob only when it changed;
- apply is budget-capped and finishes over several ticks;
- report lines for every change type, sent once per round;
- new-variation report only once;
- auth alert once, plus a recovery message;
- price change follows the rate;
- an option becomes unavailable only when **all** sources are unavailable;
- a manual stock override sticks.

---

## 7. Supplier order engine (milestone S5; needs Appendix A)

### 7.1 Which orders use it
`isSupplierOption(app, productId)` is true when the product has ≥ 1 `product_sources` row (any state); 1 indexed query.

### 7.2 Receipt confirm (`handleOrderDecision`, status `confirmed`)
After the existing snapshot and discount logic, if `isSupplierOption`:
1. **Order update:** set `fulfillment='supplier'`, `supplier_deadline_at = now + 20 h`, `customer_username`.
2. **Customer message:** replace the activation-contact message with
   `SUPPLIER_CONFIRM_TEXT = '✅ پرداخت شما تایید شد! سفارش «X» با موفقیت ثبت شد.\n\n⏳ اکانت شما در حال آماده‌سازی است و همین‌جا در ربات برایتان ارسال می‌شود (معمولاً چند دقیقه، حداکثر تا ۲۴ ساعت).\n\nممنون از صبوری شما 🙏'`.
3. **Don't call `storeOrderPaid`** (monshi stays out of it).
4. **Still run `onPurchaseConfirmed`** (referrals).
5. **Loss guard:** if `order.price < product.cost_toman` (cost known), set `needs_action_reason='loss'` and send the decision card (§8). Don't queue anything.
6. **No enabled source:** if no source has `is_enabled=1` with an enabled supplier, set `needs_action_reason='no_enabled_source'` and send the card.
7. **Otherwise:** insert `supplier_orders` (`purpose='customer'`, `status='queued'`, `next_attempt_at=now`) + `logEvent('queued')`. If `budget.remaining() ≥ 15`, call `kickSupplierOrder(app, soId)` inline; else cron picks it up within a minute.

The admin's caption edit stays as today, plus the line `🔌 تحویل خودکار از تأمین‌کننده`.

### 7.3 Placing: `placeSupplierOrder(app, soId)`, the only caller of `adapter.placeOrder`
1. **Claim:** `UPDATE supplier_orders SET status='placing', lease_until=now+3min, attempts=attempts+1, updated_at=now WHERE id=? AND status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now)`. If `changes ≠ 1`, return without doing anything.
2. **Re-check the store order** (customer purpose). If it's no longer `confirmed`, or `divert_to_stock = 1`, or `needs_action_reason` is set by an admin action → set the supplier order to `cancelled`, log it, return.
3. **Choose the source.** Use `forced_source_id` if set (skip the enabled and loss checks). Otherwise take the active-source order of §6.3, skipping sources already tried and out of stock in this round (`oos_until` > now).
   - No candidate left: set `status='queued'` and `next_attempt_at = now + 15 min`. If `first_fail_notified = 0`, notify the admins once with the decision card (reason `all_out_of_stock`, card header `⚠️ … ربات هر ۱۵ دقیقه دوباره تلاش می‌کند تا TIME`) and set the flag. Return.
4. **Place:** call `adapter.placeOrder(supplier, { …source ids, quantity, note: 'store#ORDER/so#ID' })` (for stock: `'stock/so#ID'`). Then by result:

| Result | Action |
|---|---|
| `placed` | `status='placed'`, store `remote_order_id`, `remote_status`, `price_usd`, `usd_toman` (from the catalog), `cost_toman`, `source_id`, `supplier_id`, remote ids; `placed_at`, `next_check_at = now + 1 min`, `checks=0`. Ledger `spend` of −(price × quantity, or the total per Appendix A). Event `placed`. **One batch.** If `remoteStatus` is already `completed`, poll at once (§7.4). |
| `out_of_stock` | Set the source's `oos_until = now + 30 min`, recompute the option, event `out_of_stock`. Go back to step 3 with the next source if `budget.remaining() ≥ 10`, else `status='queued', next_attempt_at=now`. |
| `retry_later` | `status='queued'`, `next_attempt_at = now + 15 min`, save `last_http`/`last_error`, event `place_failed`. First time: card to admins (reason `retry_later`; if Appendix A says it's low balance, header `💳 موجودی کیف پول «SUPPLIER» کافی نیست — لطفاً شارژ کنید.`). |
| `config` | `status='failed'`, order `needs_action_reason='config'`, card: `❌ تنظیمات «SUPPLIER» مشکل دارد (DETAIL). کلید یا user_id را در پنل درست کنید، بعد «🔁 تلاش دوباره» را بزنید.` |
| `rejected` | `status='failed'`, `needs_action_reason='rejected'`, card with the detail. |
| `unknown` | `status='unknown'`, `needs_action_reason='unknown'`, card: `❓ معلوم نیست سفارش در «SUPPLIER» ثبت شده یا نه (DETAIL). در پنل تأمین‌کننده دنبال یادداشت store#ORDER بگردید.` with the extra buttons `[🔢 ثبت شده بود؛ شماره‌اش را وارد می‌کنم]` (`fo_rid_<orderId>`: a number → sets `remote_order_id`, `status='placed'`, polling starts, ledger spend recorded with the price from the first poll) and `[🔁 ثبت نشده بود؛ دوباره ثبت کن]` (= `fo_retry`). **Never retried automatically.** |

5. **Stale leases:** a `placing` row whose `lease_until < now` (the Worker died after sending) → `unknown`, exactly as above. Cron checks this every minute (`idx_so_lease`).

Before step 4, if the catalog for that supplier is older than 15 minutes, refetch it first (§6.1, one fetch).

### 7.4 Polling: `pollSupplierOrder(app, soId)`
- **Due:** `status='placed' AND next_check_at <= now`. Backoff by `checks`: 1, 2, 5 minutes, then every 10 minutes.
- **On each poll:** `adapter.getOrder`, then update `remote_status`, `raw_response`, `checks`, `next_check_at`, `price_usd` if it was null.
- **`completed` with ≥ 1 account:** `status='completed'`, `completed_at`, event `completed`, then deliver (§7.5).
- **`completed` with no accounts:** keep polling up to 3 more checks, then `needs_action_reason='completed_no_accounts'`.
- **`cancelled` / `failed` / `refunded`** (or any status Appendix A lists as final-negative): `status='failed'`, `needs_action_reason='supplier_failed'`, and a card that says the wallet may have been refunded by the supplier (ledger untouched; the admin can record a `refund`).
- **Other statuses** (`pending`, `processing`, `on-hold`, …): keep polling. The supplier's `message`, if any, is saved in `last_error`.
- **A poll error** never changes the state; it just retries on the next schedule.

### 7.5 Delivery: `deliverToCustomer(app, orderId, content, meta)`
Shared by supplier completion, stock, and manual text.
1. **Re-check the order.** If it's not `confirmed` (already delivered or cancelled), or `meta.supplierOrder?.divert_to_stock = 1`: for supplier content, create a stock batch with the accounts (§10.1, title `NAME (برگشتی از سفارش #ID)`), log `diverted_to_stock`, and notify the admins `📦 اکانت سفارش #ID که قبلاً تعیین‌تکلیف شده بود رسید و به «اکانت‌های من» اضافه شد.` Return.
2. **Record:** insert `order_deliveries` (`sent_ok=0`).
3. **Send** to the customer (HTML):
   `'🎉 سفارش «' + NAME + '» آماده است!\n\n' + formatAccountsHtml(content) + '\n\n✅ لطفاً مراحل فعال‌سازی را طی کنید.\n📣 کانال ما: @mai_academia\n\n🔑 این اطلاعات را بعداً هم از «📋 اشتراک‌های من» می‌توانید ببینید.'`
4. **Send OK:** in one batch, `markOrderDelivered(orderId)` (the existing conditional UPDATE), `sent_ok=1`, `cost_toman` on the order (from the supplier order or stock account; manual text: NULL until the admin sets it), `fulfillment` (`supplier` / `stock` / `manual_text`), `needs_action_reason=NULL`, event `delivered`. Then `onPurchaseConfirmed` is **not** run again (it ran at confirm).
   Admin message (`sendToAdmins`):
   ```
   ✅ سفارش #ID تحویل شد
   <customerRefHtml>
   📦 محصول: NAME
   🔌 منبع: SUPPLIER (سفارش #REMOTE)     | یا: 📦 از اکانت‌های من | ✍️ متن دستی (ADMIN)
   💰 فروش: P ت | خرید: C ت | سود: P−C ت   (if cost unknown: «هزینه نامشخص»)
   ```
   Buttons: `[👁 نمایش اکانت] (fo_view_<id>)`, `customerContactRow`.
5. **Send failed:** save `send_error`; order `needs_action_reason='send_failed'` (stays `confirmed`, accounts kept). Event `send_failed`. Card: `❌ سفارش #ID تحویل نشد — دلیل: مشتری ربات را بلاک کرده / ERROR`. Buttons: `[🔁 ارسال دوباره] (fo_resend_<id>)`, `[👁 نمایش اکانت]`, `[🙋 خودم تحویل می‌دهم]`, `customerContactRow`.
6. **Budget:** delivery needs about `6 + adminIds.length` units. Check before starting; if there isn't enough, leave the supplier order `completed` with `next_check_at` set, so the cron step "completed but not delivered" retries delivery. Add that query: supplier orders `status='completed'` whose store order is `confirmed` and has no `sent_ok=1` delivery.

**«📋 اشتراک‌های من»:** for a delivered order with an `order_deliveries` row (`sent_ok=1`), add a button `🔑 نمایش اطلاعات اکانت` → `acct_show_<orderId>`. Check ownership and resend the same HTML block. Budget: 2 D1 + 1 Telegram.

### 7.6 Cron: `processSupplierWork(store)` (`src/store/suppliers/engine.ts`)
Called every minute in `runCron`, before the broadcast step, inside `guarded('supplier-orders', …)`. It stops whenever `budget.remaining() < 12`. Order of work, each with a small `LIMIT`:
1. stale leases → `unknown`;
2. queued and due → `placeSupplierOrder` (LIMIT 3);
3. placed and due → `pollSupplierOrder` (LIMIT 5);
4. completed but not delivered → `deliverToCustomer` (LIMIT 2);
5. **deadlines:** customer orders with `fulfillment='supplier'`, status `confirmed`, `supplier_deadline_at < now`, `stalled_alert_sent = 0`:
   - If the supplier order is `queued` or `failed`: mark it `cancelled`, set `needs_action_reason='deadline'`, and send the card with the header `⏰ ۲۰ ساعت از تأیید سفارش #ID گذشته و هنوز تحویل نشده.`
   - If it is `placed`: same header plus `(در صف تأمین‌کننده: STATUS)`, and keep polling.
   - Set `stalled_alert_sent = 1`.

Then the existing `syncSupplier` (minute % 10 == 2) and `applyCatalog` (every minute). Budget order in `runCron`: supplier work, then sync/apply, then broadcast. Keep the existing `reserve: 2` for broadcast.

### 7.7 Tests (S5)
Use `fakeAriobox`. One test per row of the §7.3 table, plus:
- **Happy path:** confirm → placed inline → poll → completed → customer gets the HTML with `<code>` → order delivered, clocks started, cost/profit stored → admin message has `@username` or the id, and the chat buttons.
- **Customer has no username:** `tg://user` button, then the `BUTTON_USER_PRIVACY_RESTRICTED` retry without it.
- **Retries:** out of stock on source 1 → source 2 used; all out of stock → 15-minute retries → a single admin notice.
- **Unknown:** timeout → `unknown`, **no second POST ever** (assert the POST count stays 1 across 30 simulated cron minutes); stale lease → `unknown`.
- **Duplicate kick:** webhook kick and cron in the same minute → still one POST (claim test).
- **Deadline** at 20 h: card once.
- **Send failed** → resend works.
- **Supplier-side failure:** `completed_no_accounts`, `supplier_failed`.
- **Account view:** `acct_show` ownership check.
- **Budget:** every invocation ≤ 50; webhook confirm ≤ 35.
- **Untouched paths:** monshi is **not** called for supplier orders and **is** still called for normal ones.

---

## 8. Decision card and manual handling (milestone S6)

### 8.1 Reason codes → Persian text
| Code | Text |
|---|---|
| `loss` | `قیمت پرداختی مشتری (P ت) از قیمت خرید فعلی (C ت) کمتر است؛ خرید خودکار انجام نشد.` |
| `no_enabled_source` | `هیچ منبع فعالی برای این محصول نیست (همه را غیرفعال کرده‌اید).` |
| `all_out_of_stock` | `همه‌ی منبع‌ها ناموجودند.` (list: `SUPPLIER: ناموجود` / `SUPPLIER: غیرفعال (توسط شما)`) |
| `retry_later` | `تأمین‌کننده فعلاً سفارش را نپذیرفت (DETAIL).` |
| `config` / `rejected` / `unknown` / `supplier_failed` / `completed_no_accounts` / `send_failed` / `deadline` | as written in §7 |
| `approval` | `نیاز به تأیید شما: SOURCE_TEXT` (manual link or referral reward, §10.3) |

### 8.2 Card (`buildDecisionCard(app, orderId)` → `{ html, rows }`)
```
⏸ سفارش #ID — نیازمند تصمیم
<customerRefHtml>
📦 محصول: NAME
💰 مبلغ پرداختی: P تومان | 🕒 تأیید: JALALI
📝 دلیل: REASON
🛒 آخرین تلاش: SUPPLIER — HTTP DETAIL — TIME      (if any)
```
Rows. Show only the buttons that make sense for the current state:
```
[🔁 تلاش دوباره fo_retry_ID]  [🔀 خرید از منبع دیگر fo_src_ID]
[📦 از اکانت‌های من fo_stock_ID]  [✍️ ارسال متن اکانت fo_text_ID]
[🙋 خودم تحویل می‌دهم fo_self_ID]  [❌ لغو سفارش fo_cancel_ID]
[💬 چت با مشتری (url)]  [✉️ پیام از طرف ربات fo_msg_ID]
[📜 تاریخچه fo_hist_ID]
```
Send it with `sendToAdmins`. After every action, **edit the pressed card** to show the outcome (`✅ … توسط ADMIN_NAME`), the same way `handleOrderDecision` edits receipt captions. Other admins' copies are not edited; their buttons just answer `ℹ️ قبلاً تصمیم گرفته شد.` because the state check fails.

### 8.3 Actions
Every handler must: check admin rights; load the order; check that the state allows the action, and if not, answer `ℹ️ قبلاً تصمیم گرفته شد.` / `❌ این کار در وضعیت فعلی سفارش ممکن نیست.`; make the change with a **conditional** UPDATE; log the event with the admin's id.

- **`fo_retry_<id>`:**
  - Allowed when the order is `confirmed` and there is no live supplier order (`queued`/`placing`/`placed`).
  - Inserts a new `supplier_orders` row (`requested_by = admin`), clears `needs_action_reason`, sets `supplier_deadline_at = now + 20 h` and `stalled_alert_sent = 0`, then kicks it.
  - For `loss` / `approval` it shows a confirmation first: `⚠️ خرید با قیمت فعلی (≈ C ت) انجام شود؟` `[✅ بله] [🔙]`.
- **`fo_src_<id>`:**
  - Lists **all** sources of the option, disabled ones included: `SUPPLIER — $X ≈ C ت — سود: P−C ت — وضعیت`. A negative profit shows `🔻`.
  - Picking one → `fo_srcp_<id>_<sourceId>` → confirmation → a new supplier order with `forced_source_id`.
  - Also offers `➕ منبع جدید از تأمین‌کننده` (pick supplier → product → variation). It adds a disabled source (priority last) to the option and uses it as forced.
- **`fo_stock_<id>`:**
  - Lists available stock accounts (oldest first). Matching items come first, i.e. batches whose supplier order's remote ids equal one of the option's sources; then the rest. Up to 8, paged.
  - Picking one → `fo_stk_<id>_<accountId>` → confirmation.
  - On confirm: in one batch, the account → `reserved` (conditional on `available`) and `order_id` set. Then `deliverToCustomer(kind 'stock')`, and on success the account → `delivered`. If sending fails, the account stays reserved for this order (it's the order's delivery now) and the order shows `send_failed` as in §7.5.
- **`fo_text_<id>`:**
  - Waits for text (§9.2, 1–3,500 characters): `✍️ اطلاعات اکانت را بنویسید (همان‌طور که باید برای مشتری ارسال شود):`.
  - Preview (HTML) with `[✅ ارسال برای مشتری] [✏️ دوباره] [🔙]`.
  - On send → `deliverToCustomer(kind 'manual_text')`, then asks for the cost (§8.4).
- **`fo_self_<id>`** («خودم تحویل می‌دهم»):
  - Sets `fulfillment='manual_outside'` and clears `needs_action_reason`. If a supplier order is live, sets its `divert_to_stock = 1`; a queued one becomes `cancelled`.
  - Edits the card to `🙋 تحویل دستی توسط ADMIN — بعد از تحویل اکانت به مشتری، دکمه‌ی زیر را بزنید.` with `[✅ تحویل شد fo_done_<id>]`, `customerContactRow`, `[↩️ برگشت به تحویل خودکار fo_undo_<id>]` (only while no delivery exists). The undo restores `fulfillment='supplier'` and runs `fo_retry` logic without the confirmation.
  - **`fo_done_<id>`:** `markOrderDelivered` (conditional), sends the existing `COMPLETION_TEXT` to the customer (same as `order_deliver_<id>` today), event `admin_done`, then asks for the cost (§8.4). The admin messages from `fo_done`, `fo_text` and `fo_stk` carry the same lines as §7.5 step 4.
- **`fo_cancel_<id>`:**
  - Reason buttons: `ناموجودی`, `گران شدن قیمت خرید`, `درخواست مشتری`, `دلیل دلخواه` (text, 1–200 characters), `بدون دلیل`.
  - Confirmation: `⚠️ سفارش #ID لغو شود؟ مبلغ P ت باید به مشتری برگردانده شود.`
  - **On confirm, one batch:**
    - `UPDATE orders SET status='cancelled', cancel_reason, cancelled_at, cancelled_by, refund_status = CASE WHEN price > 0 THEN 'pending' ELSE 'none' END, needs_action_reason=NULL WHERE id=? AND status='confirmed'`;
    - delete this order's `discount_code_redemptions` row (gives the code back);
    - `UPDATE referrals SET qualified_at=NULL, qualifying_order_id=NULL WHERE qualifying_order_id=? AND reward_id IS NULL`;
    - a live supplier order → `divert_to_stock=1` (queued → `cancelled`);
    - a reserved stock account → back to `available`;
    - event `admin_cancel`.
  - **Customer message:** `'❌ سفارش «X» لغو شد.' + (reason ? '\n📝 دلیل: R' : '') + (price > 0 ? '\n\n💸 مبلغ پرداختی شما (P تومان) بازگردانده می‌شود. برای پیگیری به ' + ACTIVATION_CONTACT + ' پیام دهید.' : '')`.
  - **Admin card after cancel:** `[✅ بازپرداخت انجام شد fo_refund_<id>]` (only when `refund_status='pending'`). On press: `refund_status='done'`, `refunded_at`, event `refund_done`, and the customer gets `✅ مبلغ سفارش «X» (P تومان) به شما بازگردانده شد.`
- **`fo_msg_<id>`:**
  - Waits for text (1–1,000 characters).
  - Sends `'📩 پیام پشتیبانی درباره‌ی سفارش «X»:\n\n' + TEXT + '\n\nبرای پاسخ به ' + ACTIVATION_CONTACT + ' پیام دهید.'` (plain text). Event `admin_message`.
  - Reports `✅ ارسال شد` or `❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده.`
- **`fo_resend_<id>`:** resends the latest delivery (§7.5 steps 3–4).
- **`fo_view_<id>`:** shows the latest delivery's content (HTML) to the admin who pressed it, only in that chat.
- **`fo_hist_<id>`:** the last 15 events: `JALALI_TIME — KIND_FA — ACTOR — DETAIL`. Map each `kind` to short Persian text in one table.
- **`fo_rid_<id>`:** see §7.3, `unknown`.

### 8.4 Cost after manual delivery
After `fo_done` / `fo_text`, ask `💵 هزینه‌ی خرید این اکانت چند تومان بود؟ (برای گزارش سود)` with `[⏭ رد شدن]`. A number from 0 to 1,000,000,000 sets `orders.cost_toman`; event `cost_set`.

### 8.5 `/order <id>` and the list
- **`/order <id>`** (admin only, also as `/order_<id>`): the order card with status, customer ref, product, price, fulfillment, the supplier order's state, cost/profit and the last 5 events, plus the actions allowed in the current state: the decision buttons if `needs_action_reason` is set, `fo_cancel` for `confirmed` supplier/manual orders, `fo_refund` when pending, and `fo_view` / `fo_hist` always.
- **`⏸ نیازمند تصمیم (N)`** in the panel: lists the orders with `needs_action_reason IS NOT NULL AND status='confirmed'` (index `idx_orders_needs_action`), up to 10, each opening its card.

### 8.6 Tests (S6)
- every action from every allowed state;
- refusal from the wrong state;
- two admins pressing at once (only one wins);
- self-deliver: done sends `COMPLETION_TEXT` and starts the clocks;
- undo;
- cancel: redemption removed, referral un-qualified, refund flow, customer messages;
- an in-flight supplier order completing **after** cancel or self-delivery goes to stock and the customer gets nothing;
- manual text is stored and shown under «اشتراک‌های من»;
- cost prompt;
- `/order` card;
- history;
- the warranty claim message has the customer ref and buttons.

---

## 9. Wiring (S1–S7)

### 9.1 `store/bot.ts`
- **Registration:** `registerSupplierPanel(bot, isAdmin)` and `registerFulfillmentAdmin(bot, isAdmin)` go before `registerStorefrontHandler`.
- **Handler order for typed input (rule, S5–S9 rely on it):** the supplier text-input middleware (`supplierTextMiddleware`, §9.2) is registered **before** the Stage middleware, right after the session. Whenever `awaitingSupplierInput` or `supplierWizard` is set, it takes the admin's text itself, so no wizard (add/edit product, discount code, ...) can ever receive an answer meant for a supplier prompt. Every new text prompt (`fo_text`, `fo_msg`, `fo_cost`, `stk_*`, ...) is a new `kind` handled by this one middleware; never add a second text handler for it behind the Stage.
  - Every place that opens a prompt calls `beginSupplierInput` / `beginSupplierWizard` (`src/store/supplierInput.ts`), which also leaves any active scene.
  - Commands (`/...`) and admin panel buttons end the open prompt and then run normally. A button of another wizard (a callback outside the Stage `bypass` list) ends it too while a scene is active.
  - **Key prompts** (`sup_key`, `sup_key_edit`, wizard step `key`): the middleware deletes the incoming message first of all, even if the prompt has expired, and confirms with `🔑 کلید دریافت و پیام حاوی آن پاک شد.`
  - Prompts and the add-supplier wizard expire after 15 minutes (`INPUT_TTL_MS`); expiring clears the session fields, so the API key doesn't stay in the `sessions` row.
- **Stage `bypass` regex:** extend it to `^(order_(confirm|reject|deliver)_\d+|order_rejr_\d+_[a-z]+|rpt_\w+|ref_adm_\w+|fo_\w+|sup_\w+|stk_\w+|acct_show_\d+)$`.
- **Callback data length:** every callback string must stay ≤ 64 bytes. With ids ≤ 24 characters, `sup_impv_<i>` and `sup_imp_<sid>_<pid>` fit; assert it in a test.

### 9.2 One admin text-input slot
Add to `StoreSession`:
```ts
awaitingSupplierInput?: { kind: 'sup_name' | 'sup_url' | 'sup_key' | 'sup_user' | 'sup_topup' | 'def_percent' | 'def_fixed'
  | 'imp_group' | 'imp_label' | 'imp_duration' | 'imp_warranty' | 'imp_percent' | 'imp_fixed' | 'imp_terms'
  | 'src_percent' | 'src_fixed' | 'fo_text' | 'fo_msg' | 'fo_cost' | 'fo_rid' | 'fo_cancel_reason'
  | 'stk_qty' | 'stk_sold' | 'stk_batch_profit' | 'stk_send_to' | 'stk_send_price' | 'stk_note';
  ref: string; at: number } | null;
supplierImport?: { supplierId: number; remoteProductId: string; groupName: string; markupPercent: number | null; markupFixed: number | null;
  terms: { text: string; entities: any[] | null } | null;
  options: { remoteVariationId: string; label: string; durationDays: number | null; warrantyDays: number | null; selected: boolean }[] } | null;
supplierWizard?: { step: string; data: Record<string, any> } | null;   // add-supplier / direct-buy multi-step state
```
- **Expiry:** inputs expire after 15 minutes. The panel reply buttons, `/cancel`, `/start` and `/panel` clear all three fields; add them to the existing clearing code in `adminPanel.ts`.
- **Cancel button:** every prompt has `[❌ انصراف]` (`sup_cancel_input`).
- **Sensitive input:** the `sup_key` handler deletes the message. Values parsed as numbers accept Persian or Arabic digits, the same way the existing number inputs do.

---

## 10. Stock, direct buy, wallet, manual links, rewards (milestone S7)

### 10.1 Direct buy («🛒 خرید مستقیم»)
1. Pick supplier → remote product (catalog list) → variation.
2. Quantity: `[1] [2] [3] [5] [10] [عدد دلخواه]` (1–10).
3. Confirmation:
   ```
   🛒 خرید مستقیم از «SUPPLIER»
   📦 NAME — ATTRS × Q
   💵 هزینه: $T ≈ C ت (نرخ X)
   💳 موجودی تخمینی کیف پول: $B
   ```
   with `[✅ خرید] [❌]`.
4. Insert `supplier_orders` (`purpose='stock'`, `requested_by=admin`, `forced_source_id=NULL`, the remote ids and `supplier_id` set directly) and kick it. Results go **only to the requesting admin**:
   - `placed`: `⏳ سفارش ثبت شد (#REMOTE)؛ با آماده شدن خبرتان می‌کنم.`;
   - `out_of_stock` / `retry_later` / `rejected` / `config`: the reason and `[🔁 دوباره]`. **No automatic retries for stock buys:** queued retries are not used; `status='failed'`;
   - `unknown`: the same buttons as §7.3.
5. **On completion:** create `stock_batches` (title `REMOTE_NAME — ATTRS`, quantity, unit price, rate, total cost) plus one `stock_accounts` row per account, in one batch. If fewer accounts arrive than ordered, note it in the batch and tell the admin. Then send the batch card.

### 10.2 «📦 اکانت‌های من»
- **Batch list** (newest first, paged): `TITLE — آزاد k از n — JALALI`.
- **Batch card** (`stk_b_<id>`): cost, reported profit, note. Account buttons `اکانت N — STATUS_FA` (`stk_a_<id>`). Also `[💰 ثبت سود کل این دسته]` (an integer, may be negative with a leading `-`; sets `reported_profit_toman` and `reported_at`), `[📝 یادداشت]`, `[🔙]`.
- **Account card:** the content (HTML), status, linked order. Buttons by status:
  - **`available`:**
    - `📤 ارسال برای مشتری`: asks for the customer's numeric id or `@username` (looked up in `customers`; must exist, else `❌ این مشتری ربات را استارت نزده است.`). Then pick the product (any active product; options sharing the source's remote ids first). Then the sale price (default = that product's price; `0` allowed). Creates the order in one batch (`purchase_source='manual'`, `status='confirmed'`, `decided_by=admin`, duration/warranty snapshot from the product, `customer_username`, `fulfillment='stock'`), reserves the account, and calls `deliverToCustomer(kind 'stock')`. Cost = the batch unit cost.
    - `🔗 لینک خرید دستی`: enters the manual-purchase wizard with this account pre-attached (§10.3).
    - `💰 فروختم بیرون از ربات`: asks for the price → `sold_outside`, `sold_price_toman`, `sold_at`.
    - `⚠️ خراب/مرجوعی`: → `defective` (asks for an optional note).
  - **`sold_outside` / `defective`:** `↩️ برگشت به آزاد` (clears the sale fields).
  - **`delivered` / `reserved`:** no actions; shows `/order ID`.

### 10.3 Manual purchase links and referral rewards
- **Manual purchase wizard** (`manualPurchases.ts`): after the product pick, if `isSupplierOption(product)` **or** the wizard was entered from a stock account, add one step:
  `این خرید چطور تحویل شود؟` with `[🙋 خودم تحویل داده‌ام (مثل قبل)]` (`fulfillment='outside'`), `[📦 از اکانت‌های من]` (pick an available account → reserved; `fulfillment='stock'`), `[🛒 خرید از تأمین‌کننده وقتی مشتری لینک را زد]` (`fulfillment='supplier'`; the summary shows the estimated cost and the line `با زدن «تأیید»، خرید از کیف پول را تأیید می‌کنید.`). Products without sources skip this step, so the flow is unchanged for them.
- **`redeemManualPurchaseClaim`:**
  - `outside` / NULL: unchanged.
  - `stock`: the order is created `delivered` as today. After the batch, call the stock delivery message (send the account content to the customer; store `order_deliveries` with `sent_ok`; the account → `delivered` with `order_id`; `cost_toman`). On send failure, tell the admins with the §7.5 failure card.
  - `supplier`: the order is created `confirmed` (not delivered; `delivered_at`/`expires_at` NULL; extend the INSERT's SELECT with `CASE` on `c.fulfillment`), `fulfillment='supplier'`, `supplier_deadline_at=now+20h`. Then insert and kick a supplier order with `requested_by = claim.approved_by`; the admin approved it at link creation. The customer gets `activatedPurchaseText` with `'⏳ اکانت شما در حال آماده‌سازی است و همین‌جا برایتان ارسال می‌شود (حداکثر تا ۲۴ ساعت).'` instead of the subscription-start line. The clocks start at delivery.
- **Referral free product** (`referrals.ts`, product reward): if `isSupplierOption(product)`, don't call `storeOrderPaid`. Set the reward order's `fulfillment='supplier'`, `needs_action_reason='approval'`, `supplier_deadline_at = now + 20 h`, and send the decision card with reason `approval`: `جایزه‌ی دعوت دوستان — محصول رایگان (هزینه‌ی تقریبی C ت)`. `fo_retry` (with its confirmation) is the "approve and buy" button; stock, text, self and cancel work as usual. Rewards for products without sources are unchanged.

### 10.4 Wallet ledger
- **`💳 ثبت شارژ کیف پول`:** asks for an amount in USD (> 0, ≤ 100,000) → `topup`.
- **Automatic entries:** `spend` on every `placed` (§7.3). The admin can add `refund` / `adjust` from `🧾 تاریخچه‌ی کیف پول` (last 10 rows, plus `[➕ بازگشت وجه] [± اصلاح]`).
- **Estimated balance** = `SUM(amount_usd)`, shown as `💳 موجودی تخمینی: $B (بر اساس شارژهایی که ثبت کرده‌اید)`.
- **Low-balance warning:** when a placement fails with `retry_later` and the estimate is below the expected cost, the card adds `💳 موجودی تخمینی ($B) کمتر از هزینه است.`
- The estimate never blocks a purchase.

### 10.5 Tests (S7)
- direct buy: happy path, partial accounts, unknown;
- stock: send to a customer (order + clocks + cost), customer not found, sold outside, batch profit, defective / back to available;
- manual link: all three fulfillments, including a supplier link whose supplier order fails (→ card);
- referral reward with a supplier product → approval card, no monshi call;
- ledger: estimate and history.

---

## 11. Sales report (milestone S8)
Add these to `buildSalesReport`, in the same single `batch()`; every query must be index-backed and added to the index test:
- `💵 هزینه‌ی خرید: X ت (N سفارش)`: `SUM(cost_toman)` and the count over `status IN ('confirmed','delivered') AND cost_toman IS NOT NULL` in the range (on `decided_at`).
- `📈 سود سفارش‌های ربات: Y ت`: `SUM(price - cost_toman)` over the same rows. Then `ℹ️ M سفارش بدون هزینه‌ی ثبت‌شده در سود حساب نشده‌اند.` when M > 0, where M counts `fulfillment IS NOT NULL AND cost_toman IS NULL` in the range. Legacy orders (fulfillment NULL) aren't counted as missing.
- `❌ لغوشده: n (بازپرداخت در انتظار: k)`: `status='cancelled'` with `cancelled_at` in the range; `k` is the current pending count (no range).
- `🛍 فروش بیرون از ربات: درآمد X ت، سود Y ت`: accounts `sold_outside` with `sold_at` in the range. Profit: for batches with `reported_profit_toman`, use that amount when `reported_at` is in the range, and don't count those batches' accounts again; for the other batches, use `sold_price − unit cost`.
- `📦 خرید برای موجودی: X ت (n اکانت، آزاد: k)`: batches by `created_at` in the range; `k` is the current available count.
- `💳 خرج کیف پول: $X`: `SUM(-amount_usd)` over `kind='spend'` in the range.

The existing revenue lines stay as they are. Cancelled orders drop out of them on their own, because the status is no longer `confirmed`.

Implementation note (S8): the plan's schema had no index for the wallet spend, the batch dates and `reported_at`, so `migrations/store/0004_supplier_report_indexes.sql` adds `idx_ledger_kind_created`, `idx_batches_created` and `idx_batches_reported` (0003 is untouched). The supplier lines print only when there is something to show, so a shop without suppliers sees the old report.

Tests: numbers for a seeded mix; the index test.

---

## 12. README (milestone S9)
Add the Persian section «API تأمین‌کننده» to `README.md`:
- **Setup:** add a supplier, set the default markup, import a product.
- **What the customer sees:** choosing the duration, automatic delivery, «📋 اشتراک‌های من».
- **Price and stock:** the price formula and rounding; how stock and backup sources work.
- **The decision card:** each button explained; `/order`.
- **Money:** the "never charges twice" rule and the `unknown` case; the estimated wallet.
- **Your own accounts:** «📦 اکانت‌های من» and free-form profit.
- **Report:** the new lines.
- **Update commands:** `npm run db:backup`, `npm run db:migrate:remote`, `npm run deploy`.
- **Security:** the key is stored in D1 (backups contain it: keep `backups/` private); rotate the key at the supplier if it leaks.

---

## 13. Milestones (one commit each; `npm run typecheck && npm test` green before each)

| # | Commit message | Content | Model |
|---|---|---|---|
| S1 | `supplier: schema, customer ref, helpers` | §2 (migration + its test, db types, python column lists, `tehranDateTime`, `escapeHtml`, `customerRef.ts`, warranty message, `logEvent`, kv defaults) | Sonnet |
| — | *(planner session)* | **Appendix B**: rehearse the migration on a copy of the real DB | Opus |
| S2 | `store: product groups and options` | §3 | Sonnet |
| S3 | `supplier: adapter and supplier panel` | §4 | Sonnet |
| S4 | `supplier: import, sources, auto price, catalog sync` | §5, §6 | Sonnet |
| — | *(planner session)* | **Appendix A**: live API probe (must be filled before S5) | Opus |
| S5 | `supplier: automatic orders and delivery` | §7, §9 | Sonnet |
| S6 | `supplier: decision card and manual handling` | §8 | Sonnet |
| S7 | `supplier: stock, direct buy, wallet, links, rewards` | §10 | Sonnet |
| S8 | `store: profit in sales report` | §11 | Sonnet or Haiku |
| S9 | `docs: Persian README for the supplier API` | §12 | Sonnet or Haiku |

## 14. Pitfalls checklist (read before coding)
- **Double spend.**
  - Only `placeSupplierOrder` may POST, and only after winning the `queued → placing` claim.
  - `unknown` and stale `placing` are never retried automatically.
  - Tests must assert the POST count.
- **Customer gets nothing twice.**
  - `deliverToCustomer` re-checks `status='confirmed'` and `divert_to_stock` **before** sending.
  - A resend is only ever explicit (`fo_resend`).
- **Every state change is a conditional UPDATE** with `changes` checked. Two admins, cron and webhook can all race.
- **`markOrderDelivered` only works from `confirmed`.** Manual-link `stock` orders are created `delivered` directly (as today), so don't call it for them.
- **Budget.** A webhook confirm with an inline supplier kick must stay ≤ 35. Cron work checks `remaining()` before each unit. Delivery needs `6 + admins`.
- **Never one D1 row per catalog item.** The blob is the cache; only sources are rows.
- **Callback data** ≤ 64 bytes and forgeable: re-check admin rights and ownership in every handler (`acct_show_<id>` checks the customer).
- **HTML everywhere new:** escape every dynamic string, including supplier names and the account values from the API. A `<` in a password must not break the message.
- **`tg://user?id=` buttons** may be refused (`BUTTON_USER_PRIVACY_RESTRICTED`): retry once without the button. The `✉️ پیام از طرف ربات` button always works for customers who started the bot.
- **`orders.status` now has `'cancelled'`.** Check every place that lists statuses: the report, the customer summary, «اشتراک‌های من», the monshi customer card via `customerSummary`. Cancelled orders are not "in progress".
- **The monshi bridge must not be called for supplier orders**, and must still be called for all other confirmed orders.
- **Stage `bypass`:** add the new prefixes, or an admin who is mid-wizard can't press card buttons.
- **The admin's API key message must be deleted.** Never print the key, even in errors (`detail` comes from the response body, not the request).
- **Persian characters:** use only ی and ک; numbers shown to people go through `formatPrice` or `toLocaleString('fa-IR')`.

---

## Appendix A — Live API probe (planner session fills this before S5)
Done with the owner's key from the environment (`ARIOBOX_API_KEY`, `ARIOBOX_USER_ID`). Only `GET` calls without the owner's say-so. One cheap real `POST` **only after the owner explicitly approves it in chat**, on a product they choose.

To record:
1. A real `/products` response: item count, sample items, attribute keys and their value formats.
2. Is out-of-stock shown as missing items or as `price: null`?
3. The `POST /orders` response, and whether `price` is per unit or total.
4. The status sequence seen by polling, with time to completion, and the account `attributes` keys.
5. The response when the wallet balance is too low: HTTP code and body. Ask the supplier if it can't be tested.
6. Status names for cancelled/failed/refunded orders (ask the supplier).
7. Rate limits, if any.

### Assumptions (unverified, must be checked against the live API before deploy)
The owner decided to build S5–S9 now with these assumptions instead of waiting for the probe above. They live in **one small mapping**, `ARIOBOX_ASSUMPTIONS` / `classifyRemoteStatus` / `isLowBalanceText` in `src/store/suppliers/ariobox.ts` (plus the price-mismatch check in `src/store/suppliers/engine.ts`), so a correction after the live test is a few lines.

- **(a) `POST /orders` errors.** Any 4xx other than 400, 401, 404 or 409 → `retry_later` (a 4xx means the request was refused, so nothing was bought). If the response body mentions *balance, wallet, insufficient, credit* or *funds* (case-insensitive), the result carries `lowBalance: true` and the card uses the low-balance header of §7.3. 400, 401, 404, 409, 503, other 5xx and timeouts behave as the §4.3 table says.
- **(b) Cost.** Cost = catalog `price_usd` × `quantity` × `usd_toman`; the ledger `spend` uses the same USD amount (`price_usd × quantity`). `supplier_orders.price_usd` is the catalog **unit** price. The response `price` is stored raw (it stays inside `raw_response`; no new column) and is only compared: if it matches neither the unit price nor the total within 2 %, a `price_mismatch` event is logged and the delivery/admin message gets one extra line.
- **(c) Remote status.** `completed` = success. `cancelled`, `failed`, `refunded`, `trash` = final failure (`supplier_failed`). Any other status → keep polling.

To verify with the live API (planner session, before deploy): the real low-balance response, whether `price` is per unit or total, the real failure status names, and the status sequence.

## Appendix B — Migration rehearsal on real data (planner session, after S1)
With `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`:
1. `wrangler d1 export` both databases (read-only; a few seconds of blocked queries, so do it at a quiet hour) into the session scratchpad. **Never into the repo.**
2. Load the store dump into a local SQLite file and apply `0003_supplier.sql`.
3. Compare row counts per table, `PRAGMA foreign_key_check`, `PRAGMA integrity_check`, and a spot-check of 20 orders column by column.
4. Delete the dumps when done.

Record the result here.

*(empty, to be filled)*
