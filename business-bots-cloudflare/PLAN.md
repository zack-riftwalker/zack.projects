# Business Bots → Cloudflare Workers: Implementation Plan

> **Audience:** an implementing agent (e.g. Claude Sonnet) working in this repo, plus the owner (Zakaria).
> **Status:** approved by the owner. Decisions locked: **direct in-process bridge**, **migrate existing data**, **Cloudflare Free plan**.
> Implement exactly this plan. If something in it is impossible or wrong, stop and tell the user. Don't silently pick a different design.

---

## خلاصه برای زکریا (فارسی)

- دو ربات (فروشگاه Node.js و منشی پایتون) داخل **یک Cloudflare Worker** با TypeScript اجرا می‌شوند. سرور لازم نیست و همیشه روشن‌اند.
- تلگرام پیام‌ها را با **Webhook** می‌فرستد و دیتابیس‌ها روی **D1** هستند (دو دیتابیس جدا). کارهای زمان‌بندی‌شده (یادآوری اشتراک، هشدار سفارش معطل، دایجست شنبه، صف اطلاعیه) با یک **Cron هر دقیقه** اجرا می‌شوند.
- ربات‌ها **مستقیم** همدیگر را صدا می‌زنند و کانال پل دیگر لازم نیست. جریان سفارش و همه‌ی متن‌های فارسی دقیقاً مثل قبل می‌ماند.
- برای پلن رایگان: هر پیام حداکثر ۵۰ «زیردرخواست» دارد (تماس با تلگرام + کوئری D1 + Gemini). برای همین کد یک «بودجه‌شمار» دارد. خواندن‌ها کش و دسته‌ای می‌شوند، همه‌ی کوئری‌های پرتکرار ایندکس دارند و اطلاعیه‌ی همگانی دسته‌ای از صف ارسال می‌شود (حدود ۴۰ نفر در دقیقه).
- دیتای فعلی با یک اسکریپت پایتون از فایل‌های `.db` به D1 منتقل می‌شود.
- **کاری که شما باید بکنید:** فایل zip ربات‌ها را دوباره در جلسه‌ی Sonnet آپلود کنید (کد اصلی عمداً در رپو نیست، چون رپو عمومی است). در آخر هم مراحل بخش ۱۶ را روی حساب کلودفلر خودتان انجام بدهید.

---

## 0. Ground rules for the implementer

1. **Work only inside `business-bots-cloudflare/`.** Don't touch anything else in the repo.
2. **Legacy source is not in git** (the repo is public). The owner uploads `buisiness_bots.zip`. Extract it into `business-bots-cloudflare/legacy/`, which is gitignored:
   ```bash
   cd business-bots-cloudflare
   T=$(mktemp -d) && unzip -q "<path-to-uploaded-zip>" -d "$T"
   mkdir -p legacy
   mv "$T/buisiness bots/store bot" legacy/store-bot
   mv "$T/buisiness bots/monshi_bot" legacy/monshi-bot
   # never needed, never read, never print: secrets, databases, logs, nested zips
   rm -f legacy/*/.env legacy/*/*.db legacy/*/*.db-* legacy/*/*.zip legacy/*/bot.log
   rm -rf legacy/*/.claude legacy/*/node_modules
   ```
   If the zip isn't available, **stop and ask the owner to upload it.** Don't reconstruct the bots from this plan alone.
3. **Behavior parity is the top priority.** Every user-facing Persian string, button label, callback-data string, emoji and step order must be copied **verbatim** from `legacy/`. Don't translate, reword, "fix" typos, or reorder steps. The only allowed behavior changes are listed in §2.3.
4. **Never commit secrets, `.db` files, `.env`, or `legacy/`.** Secrets live only in `wrangler secret` and in the gitignored `.dev.vars`.
5. Commit in the milestone order of §17, one commit per milestone, and push to the branch your session tells you to use. Don't open a PR unless the user asks.
6. Before every commit, run `npm run typecheck && npm test`. Both must pass.
7. Use plain positional `?` SQL placeholders only. Don't use `?1`/`?NNN` or named parameters, so SQL behaves the same in tests (node:sqlite) and in D1.
8. **Never pass `undefined` to a D1 `bind()`** (D1 throws on it). Convert to `null`.

---

## 1. What exists today (legacy)

### 1.1 Store bot: `legacy/store-bot` (Node.js, Telegraf, better-sqlite3, long polling)
- `src/bot.js`: entry point. In-memory `session()` and a `Scenes.Stage` with 8 wizard scenes, `/start`, `/panel`, global error handler.
- `src/admin.js`: `ADMIN_IDS` from env, `isAdmin()`.
- `src/db/schema.sql` and `src/db/database.js`: SQLite schema, column migrations, ~40 query helpers.
- `src/handlers/storefront.js`: customer catalog, discount step, terms, receipt upload, admin confirm/reject, "My subscriptions", warranty claim, renew.
- `src/handlers/discountCodes.js`: add/edit/renew wizards, list/view/delete actions, `validateDiscountCode*`, `applyDiscount`.
- `src/handlers/customerProducts.js`: add-product wizard (5 steps) and deactivate wizard.
- `src/handlers/announceWizard.js`: broadcast an announcement to all customers.
- `src/handlers/storeSettings.js`: card number and holder wizard, `formatCardNumber`.
- `src/handlers/manualPurchases.js`: admin creates a one-time activation link (`/start mp_<token>`) and the customer redeems it.
- `src/handlers/adminPanel.js`: admin reply keyboard and dispatch.
- `src/services/receiptDelivery.js`: caption builder and `copyMessage` fan-out to admins.
- `src/bridge.js`: channel bridge with monshi (`order_paid` out; `order_delivered` and `order_paid_failed` in), plus the `order_deliver_<id>` admin button.
- `src/scheduler.js`: every 30 min. Stalled-order alerts; daily 11:00 Tehran subscription reminders (7d, 3d, expired).
- `src/utils.js`: Markdown escape, price parse/format, Jalali helpers, paged keyboards.
- `test/`: existing node:test tests. **Port their assertions** (§15).

### 1.2 Monshi (secretary) bot: `legacy/monshi-bot` (Python, python-telegram-bot 22, SQLite, google-genai, polling)
- `bot.py`: handler registration order, weekly digest job (Saturday 09:00 Tehran), `on_admin_free_text` dispatcher.
- `config.py`: `BOT_TOKEN`, `ADMIN_USER_ID`, `NOTIFY_USER_IDS`, `GEMINI_API_KEY`, `BRIDGE_CHANNEL_ID`.
- `db.py`: schema, default settings, all CRUD.
- `normalize.py`: Persian digit and char normalization.
- `handlers/business.py`: **the core**. Business connection, the customer message pipeline (owner pause → save → sensitive handoff → greeting → Gemini/keyword FAQ → order status → price fallback → after-hours ack).
- `handlers/admin.py`: menu keyboard, status hub, hours wizard, settings hub, unanswered, stats, Gemini settings.
- `handlers/faq_admin.py`, `handlers/order_admin.py`: FAQ CRUD wizard, orders panel and wizard.
- `handlers/bridge.py`: channel bridge, `deliver_order`, `orddlv:<id>` delivery button.
- `handlers/common.py`: `admin_guard`, `notify_all`, wizard cancel.
- `services/`: `faq.py` (keyword matcher), `gemini.py` (embedding retrieval + structured classification + fallback model), `hours.py`, `rules.py`, `orders.py` (checklist), `digest.py`.

---

## 2. Target architecture

### 2.1 Overview

```
                    ┌──────────────── Cloudflare Worker "business-bots" ────────────────┐
Telegram (store) ──►│ POST /tg/store   ─► createStoreBot(app)  ─┐                        │
Telegram (monshi)──►│ POST /tg/monshi  ─► createMonshiBot(app) ─┤ direct calls (bridge.ts)│
Browser (once)   ──►│ GET  /setup?key= ─► setWebhook ×2, cache getMe                    │
Cron * * * * *   ──►│ scheduled()      ─► store jobs + monshi digest + broadcast queue  │
                    │                                                                    │
                    │  STORE_DB (D1)  ◄── store code      MONSHI_DB (D1) ◄── monshi code │
                    └────────────────────────────────────────────────────────────────────┘
                         ▲ Gemini REST (monshi only)   ▲ Telegram Bot API (both)
```

- **One Worker, two webhook routes, two D1 databases** (`STORE_DB`, `MONSHI_DB`). The schemas stay separate, which keeps data migration 1:1.
- **Language:** TypeScript (ES modules), bundled by wrangler. **Telegram library:** grammY (already on npm, v1.46+, supports Business and Checklists).
- **Bots are constructed per request** (cheap) with a cached `botInfo`, so the bot holds no shared mutable state between requests.

### 2.2 Legacy concept → Cloudflare equivalent

| Legacy | Cloudflare |
|---|---|
| Long polling (`bot.launch`, `run_polling`) | Webhook. Telegram POSTs each update, guarded by the `X-Telegram-Bot-Api-Secret-Token` header |
| better-sqlite3 / sqlite3 files | D1 (async; `prepare().bind().first/all/run`, `batch()` for atomic multi-statement work) |
| Telegraf in-memory `session()` + Scenes | grammY `session()` with a **D1 storage adapter**, plus a small **Telegraf-compatible wizard framework** (`src/lib/wizard.ts`) so wizard code ports almost line by line |
| PTB `context.user_data` (in memory) | grammY session (D1), only for the monshi admin's private chat |
| `setInterval` scheduler, PTB JobQueue | One cron trigger `* * * * *` with time-based dispatch inside `scheduled()` |
| Channel bridge (JSON posts) | Direct function calls between store and monshi modules (`src/bridge.ts`) |
| `google-genai` Python SDK | `fetch` to the Gemini REST API |
| `crypto.randomBytes`/`createHash` | `crypto.getRandomValues` / `crypto.subtle.digest` |
| File logging, systemd, AlwaysData, `PROXY_URL` | Removed. Workers Logs (`console.*`) via `[observability]` |

### 2.3 Allowed behavior changes (and nothing else)
1. **Bridge is direct** (§11). Channel posts and `BRIDGE_CHANNEL_ID` are gone. Store and monshi texts and the order flow stay the same.
2. **Announcement broadcast is queued** (§9.7). Sending happens in batches over cron instead of in one blocking loop. Add exactly one new line to the admin "sending" message (text in §9.7).
3. **Embeddings use 768 dimensions stored as base64 TEXT** (§10.6). Existing embeddings are discarded and recomputed automatically.
4. Monshi's double `query.answer()` bugs (`pause_chat:`, `st_toggle_gemini` without a key) become a single answer call with the intended text or alert.
5. Monshi's new-customer detection and after-hours ack claim become atomic (safe under concurrent webhooks, §10.3).
6. Status hub shows only cheap stats. Full stats are cached for 15 minutes (§10.9).
7. Store subscription reminders run in the 11:00 Tehran hour until all due reminders are sent (§12), not in a single pass.

---

## 3. Free-plan budget (hard constraints) and the design rules that follow

Verified Oct 2026 from [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and the [D1 free-tier enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).

| Limit (Free) | Value | Consequence |
|---|---|---|
| Requests | 100,000 / day | Fine. Cron uses 1,440/day; each Telegram update is one request |
| CPU time | **10 ms / invocation** | No heavy startup. Cache decoded embeddings in module memory. No big JSON work |
| Subrequests | **50 / invocation**, and **D1 calls count** ("any request … to Cloudflare services like … D1") | Every Telegram API call, Gemini fetch **and D1 query** spends budget. See the `Budget` class (§7.3) |
| D1 queries | **50 / invocation**. Per-statement limits apply to each statement in `batch()` | Count each statement inside a batch as 1 (conservative) |
| Simultaneous open connections | 6 | Don't `Promise.all` more than ~5 outbound calls. Keep loops sequential |
| `waitUntil` | ≤ 30 s after the response | Webhook work must finish quickly (§7.1) |
| Cron Triggers | **5 per account** | Use exactly **one**: `* * * * *` |
| Cron duration | 15 min wall clock | Not the bottleneck; the 50-subrequest budget is |
| D1 rows read | **5,000,000 / day** (queries **fail** once exceeded, since 2026-09-01) | Every hot query must use an index. No full-table scans in cron or per-message paths |
| D1 rows written | **100,000 / day** | Don't rewrite unchanged sessions. Batch flag updates |
| D1 DB size | 500 MB per DB, 10 DBs | Fine (2 DBs) |

**Design rules (enforced in code review and tests):**
- **R1. Budget per invocation = 50.** All Telegram, Gemini and D1 calls go through counted wrappers. Loops over recipients check `budget.remaining()` and stop early, leaving work for the next cron tick. Target ≤ 35 for any normal update.
- **R2. Read once per request.** Monshi settings and app state load in one `batch()` at request start into a per-request cache. FAQs load once per message. The store product list loads once per handler. Reuse rows; don't re-query.
- **R3. Combine round trips** with `db.batch([...])` when several independent reads or writes happen together.
- **R4. Index every hot query** (§8). A test runs `EXPLAIN QUERY PLAN` on them and fails on `SCAN <table>` for large tables (§15).
- **R5. Skip no-op writes.** The session adapter doesn't write unchanged or empty sessions (§7.4). No session at all for monshi business messages or for non-private chats.
- **R6. Always return HTTP 200 to Telegram** for authenticated webhook calls, even when the handler throws. A 5xx with `max_connections=1` makes Telegram retry the same update and block the bot.
- **R7. Cron work is incremental and idempotent:** cursor-based broadcast, per-row flags, day latches in `app_state`.

**Expected daily usage** for a small shop (2,000 store updates, 1,000 business messages): about 4.5k requests, under 400k rows read, under 15k rows written.

---

## 4. Directory layout (create exactly this)

```
business-bots-cloudflare/
├── PLAN.md                         (this file; keep it)
├── README.md                       Persian deploy guide (§16), written last
├── .gitignore                      (already present)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wrangler.toml
├── .dev.vars.example               names of the secrets, no values
├── migrations/
│   ├── store/0001_init.sql
│   ├── monshi/0001_init.sql
│   └── monshi/0002_seed_settings.sql
├── scripts/
│   └── sqlite_to_d1.py             legacy .db → SQL import files (§14)
├── src/
│   ├── index.ts                    fetch() + scheduled() entry (§7.1, §12)
│   ├── env.ts                      Env interface + config parsing
│   ├── apps.ts                     per-invocation app factory (StoreApp, MonshiApp, Budget, makeApi)
│   ├── setup.ts                    GET /setup handler (§7.2)
│   ├── bridge.ts                   direct store⇄monshi calls (§11)
│   ├── lib/
│   │   ├── budget.ts               subrequest/query counter + grammY transformer + counted D1 wrapper
│   │   ├── session.ts              grammY StorageAdapter on D1 (§7.4)
│   │   ├── wizard.ts               Telegraf-compatible WizardScene/Stage (§7.5)
│   │   ├── markup.ts               Telegraf-like Markup helper (§7.6)
│   │   ├── time.ts                 Tehran clock, Python-compatible UTC ISO, Jalali helpers
│   │   └── botinfo.ts              cached getMe (§7.2)
│   ├── store/
│   │   ├── bot.ts                  createStoreBot(app) — registration order of legacy bot.js
│   │   ├── config.ts               ADMIN_IDS parsing, isAdmin
│   │   ├── db.ts                   StoreDb class (port of database.js)
│   │   ├── utils.ts                port of utils.js
│   │   ├── bridgeHandlers.ts       port of bridge.js minus channel code (§11)
│   │   ├── scheduler.ts            cron jobs (§12)
│   │   ├── broadcast.ts            announcement queue (§9.7)
│   │   ├── services/receiptDelivery.ts
│   │   └── handlers/{storefront,discountCodes,customerProducts,announceWizard,storeSettings,manualPurchases,adminPanel}.ts
│   └── monshi/
│       ├── bot.ts                  createMonshiBot(app) — registration order of bot.py
│       ├── config.ts
│       ├── db.ts                   MonshiDb class (port of db.py)
│       ├── normalize.ts
│       ├── context.ts              per-request settings/app_state/FAQ cache (R2)
│       ├── handlers/{business,admin,faqAdmin,orderAdmin,bridge,common}.ts
│       └── services/{faq,gemini,hours,rules,orders,digest}.ts
└── test/
    ├── helpers/{fakeD1.ts,fakeTelegram.ts,updates.ts,env.ts}
    ├── store/*.test.ts
    ├── monshi/*.test.ts
    ├── bridge.test.ts
    ├── infra.test.ts
    ├── indexes.test.ts
    └── migration.test.ts
```

---

## 5. Tooling and config files

### 5.1 `package.json`
```json
{
  "name": "business-bots-cloudflare",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --test-scheduled",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build:check": "wrangler deploy --dry-run --outdir dist",
    "db:migrate:remote": "wrangler d1 migrations apply store-bot-db --remote && wrangler d1 migrations apply monshi-bot-db --remote",
    "db:migrate:local": "wrangler d1 migrations apply store-bot-db --local && wrangler d1 migrations apply monshi-bot-db --local"
  }
}
```
Dependencies: `grammy`, `jalaali-js`. Dev dependencies: `wrangler`, `typescript`, `@cloudflare/workers-types`, `vitest`, `@types/node`, `@types/jalaali-js`. Install with `npm i` (latest). If TypeScript 7.x breaks the `tsc` run, pin `typescript@5`.

### 5.2 `tsconfig.json`
`target: ES2022`, `module: ES2022`, `moduleResolution: Bundler`, `strict: true`, `noEmit: true`, `types: ["@cloudflare/workers-types", "node"]` (node only for tests), `include: ["src", "test"]`.

### 5.3 `wrangler.toml`
```toml
name = "business-bots"
main = "src/index.ts"
compatibility_date = "2026-09-01"   # must be <= today and supported by installed wrangler; adjust if build:check complains

[triggers]
crons = ["* * * * *"]

[observability]
enabled = true

[vars]
STORE_ADMIN_IDS = ""          # e.g. "123456789,987654321"
MONSHI_ADMIN_USER_ID = ""     # e.g. "123456789"
MONSHI_NOTIFY_USER_IDS = ""   # optional, comma-separated

[[d1_databases]]
binding = "STORE_DB"
database_name = "store-bot-db"
database_id = "REPLACE_WITH_ID_FROM_wrangler_d1_create"
migrations_dir = "migrations/store"

[[d1_databases]]
binding = "MONSHI_DB"
database_name = "monshi-bot-db"
database_id = "REPLACE_WITH_ID_FROM_wrangler_d1_create"
migrations_dir = "migrations/monshi"
```
Secrets (via `wrangler secret put`, and `.dev.vars` locally): `STORE_BOT_TOKEN`, `MONSHI_BOT_TOKEN`, `GEMINI_API_KEY` (optional), `WEBHOOK_SECRET` (`openssl rand -hex 32`; also the `/setup` key; Telegram allows only `A-Za-z0-9_-`).

### 5.4 `src/env.ts`
```ts
export interface Env {
  STORE_DB: D1Database; MONSHI_DB: D1Database;
  STORE_BOT_TOKEN?: string; MONSHI_BOT_TOKEN?: string;
  STORE_ADMIN_IDS?: string; MONSHI_ADMIN_USER_ID?: string; MONSHI_NOTIFY_USER_IDS?: string;
  GEMINI_API_KEY?: string; WEBHOOK_SECRET?: string;
}
```
- Store config: `ADMIN_IDS` is parsed exactly like `admin.js` (dedupe, positive integers).
- Monshi config: `ALL_NOTIFY_IDS = [admin, ...notify without admin]`, exactly like `config.py`.
- A bot is **enabled** only if its token is set and its required admin config is valid. A disabled bot's route returns 200 and logs one warning. The bridge treats disabled monshi exactly like legacy "no BRIDGE_CHANNEL_ID" (§11).

---

## 6. Telegraf / PTB → grammY mapping (use consistently)

| Legacy | grammY |
|---|---|
| `bot.start(fn)`, `ctx.startPayload` | `bot.command('start', fn)`, `ctx.match` (string payload) |
| `bot.command('x')` | `bot.command('x')` |
| `bot.hears('label')` | `bot.hears('label')` (exact string) |
| `bot.action('data')` / `bot.action(/re/)`, `ctx.match` | `bot.callbackQuery('data')` / `bot.callbackQuery(/re/)`, `ctx.match` |
| `bot.on('text')` | `bot.on('message:text')` |
| `bot.on(['photo','document'])` | `bot.on(['message:photo','message:document'])` |
| `bot.on('message')` | `bot.on('message')` |
| `ctx.answerCbQuery(text?, {show_alert})` | `ctx.answerCallbackQuery({ text, show_alert })` |
| `ctx.editMessageReplyMarkup(markup)` | `ctx.editMessageReplyMarkup({ reply_markup: markup })` |
| `ctx.editMessageCaption(caption)` | `ctx.editMessageCaption({ caption })` |
| `ctx.telegram.sendMessage(id, text, extra)` | `ctx.api.sendMessage(id, text, extra)` |
| `ctx.telegram.copyMessage(to, from, mid, extra)` | `ctx.api.copyMessage(to, from, mid, extra)` |
| `ctx.botInfo.username` | `ctx.me.username` |
| `err.response.error_code` | `err instanceof GrammyError ? err.error_code : undefined` |
| PTB `context.args` | `(ctx.match as string).split(/\s+/).filter(Boolean)` |
| PTB `full.split(None, 1)[1].strip()` | `ctx.message.text.match(/^\S+\s+([\s\S]*)$/)?.[1].trim() ?? ''` |
| PTB `send_message(..., business_connection_id=b)` | `api.sendMessage(chat, text, { business_connection_id: b, ... })` |
| PTB `read_business_message(b, chat, mid)` | `api.readBusinessMessage(b, chat, mid)` |
| PTB `send_checklist` / `edit_message_checklist` | `api.sendChecklist(b, chat, {title, tasks})` / `api.editMessageChecklist(b, chat, mid, {title, tasks})` |
| PTB `edit_message_reply_markup(bcid, chat, mid, None)` | `api.editMessageReplyMarkup(chat, mid, { business_connection_id: b })` (no `reply_markup` removes it) |

**Handler-order semantics:** grammY, like Telegraf, runs middleware in registration order and stops when a handler doesn't call `next()`. PTB's "first matching handler in group 0 wins" is reproduced by registering in the same order and not calling `next()`.

---

## 7. Shared infrastructure

### 7.1 `src/index.ts`: webhook handling
```ts
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/tg/store')  return webhook('store', req, env, ctx);
    if (req.method === 'POST' && url.pathname === '/tg/monshi') return webhook('monshi', req, env, ctx);
    if (req.method === 'GET'  && url.pathname === '/setup')     return setup(req, env);   // §7.2
    if (url.pathname === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(env, new Date(controller.scheduledTime)));   // §12
  },
} satisfies ExportedHandler<Env>;
```
`webhook()`:
1. If `env.WEBHOOK_SECRET` is missing, or the header `X-Telegram-Bot-Api-Secret-Token` doesn't equal it, return **401** (no work).
2. `const update = await req.json()`. On a parse error, log and return 200.
3. `const apps = createApps(env)` (§7.3, fresh `Budget(50)`). Build the bot for the route. If it's disabled, log and return 200.
4. `const work = bot.handleUpdate(update).catch(logError); ctx.waitUntil(work);`
5. `await Promise.race([work, sleep(25_000)]); return new Response('ok');`. Normally this replies after processing (sequential like polling). Pathological slow work still gets 200 within 25 s and continues in `waitUntil`.
6. Never return 5xx after authentication (R6). Don't use grammY's `webhookCallback`, because its timeout behavior conflicts with step 5.

`bot.catch` (both bots): log `403` and `429` as warnings, as in legacy `bot.js`. Log anything else as an error. Never rethrow.

### 7.2 `/setup` and `botInfo`
- `GET /setup?key=<WEBHOOK_SECRET>`. Wrong key returns 401.
- For each enabled bot:
  - `getMe()`, saved to `app_state('bot_info')` in that bot's DB.
  - `setWebhook(origin + '/tg/<bot>', { secret_token, allowed_updates, max_connections, drop_pending_updates: false })`.
    - Store: `allowed_updates = ['message','callback_query']`, `max_connections = 1` (keeps per-user ordering, e.g. no double receipts).
    - Monshi: `allowed_updates = ['message','callback_query','business_connection','business_message']`, `max_connections = 3` (Gemini latency; made safe by §10.3).
- Return a JSON report: per bot, `ok/error`, webhook URL, config problems such as empty `STORE_ADMIN_IDS` or `MONSHI_ADMIN_USER_ID`, and whether `GEMINI_API_KEY` is set.
- `getBotInfo(app, which)`: module-level `Map` cache, then `app_state` row, then `getMe()` (and store it). Pass the result as `new Bot(token, { botInfo })` so grammY never calls `getMe` per request.

### 7.3 `src/lib/budget.ts` and `src/apps.ts`
```ts
export class Budget {
  constructor(public limit = 50, public used = 0) {}
  take(n = 1) { if (this.used + n > this.limit) throw new BudgetExceededError(); this.used += n; }
  remaining() { return this.limit - this.used; }
}
```
- **grammY transformer:** `api.config.use((prev, method, payload, signal) => { budget.take(); return prev(method, payload, signal); })`. Install it on every `Bot.api` and every `Api` created via `makeApi`.
- **Counted D1 wrapper:** `countedD1(db, budget)` returns an object with the same surface (`prepare(sql).bind(...).first/all/run/raw`, `batch(stmts)`, `exec`). Each terminal call takes 1; `batch` takes `stmts.length`. All DB classes receive the wrapped instance.
- **Gemini fetch:** `budget.take()` before each `fetch`.
- `createApps(env, deps?)` returns `{ budget, makeApi(token), store: StoreApp | null, monshi: MonshiApp | null }`, created lazily. Store and monshi in the same invocation **share one budget**, because the bridge runs inside the store request. `deps` lets tests inject a fake `makeApi` and a fake `fetch`.
- Recipient loops (broadcast, reminders, admin fan-out) check `budget.remaining() > reserve` (reserve = 6) before each send. `BudgetExceededError` is caught at loop level, so the remaining work is left for the next tick.

### 7.4 `src/lib/session.ts`: D1 session storage
- Table `sessions(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)` exists in **both** DBs.
- The adapter implements grammY `StorageAdapter<T>`:
  - `read(key)`: `SELECT value`, parse JSON. Remember the raw string per key (instance map; the adapter is per request).
  - `write(key, v)`: `JSON.stringify(v)`. **Skip** if it equals the remembered raw string. **Skip** if the value is `{}` and no row existed. Otherwise `INSERT … ON CONFLICT(key) DO UPDATE`.
  - `delete(key)`: `DELETE`.
- Store `getSessionKey`: `` `${from.id}:${chat.id}` `` when `ctx.from` and `ctx.chat` exist and `chat.type === 'private'`; otherwise `undefined`. This matches Telegraf's default key.
- Monshi `getSessionKey`: `` `${from.id}` `` only when `ctx.chat?.type === 'private' && ctx.chat.id === ctx.from?.id` and `from.id` is the admin. Otherwise `undefined`.
- **Never access `ctx.session` when the key is undefined** (grammY throws). For monshi, only admin-private handlers touch the session.
- `initial: () => ({})`.

### 7.5 `src/lib/wizard.ts`: Telegraf-compatible wizards
The goal is to port the store's 8 `Scenes.WizardScene`s with minimal edits.
- Session field: `__scene?: { id: string; step: number; state: Record<string, unknown> }`. State must be JSON-serializable. That holds already: strings, numbers and Telegram entity arrays.
- Context flavor:
  - `ctx.scene.enter(id, initialState?)`: sets `__scene = { id, step: 0, state: { ...initialState } }`, then **immediately runs step 0**.
  - `ctx.scene.leave()`: deletes `__scene`.
  - `ctx.wizard.state`: a live reference to `__scene.state`.
  - `ctx.wizard.next()`: `step++`. It doesn't run the step.
- `class WizardScene<C>(id, ...steps)` with `.command(name, fn)` and `.hears(regex, fn)` for scene-level handlers (internal grammY `Composer`).
- `class Stage<C>(scenes).middleware()`. Install `ctx.scene` and `ctx.wizard` on every ctx. If `__scene` is set and its scene exists:
  1. Run the scene composer (`/cancel`, cancel words). If none matched,
  2. run `steps[step]`. If `steps[step]` is undefined, `leave()`.
  3. **Do not call `next()`.** Like Telegraf, an active scene consumes every update, including stray callbacks and menu-button texts. Keep this legacy behavior.
- Scene-handler precedence equals Telegraf: scene-level handlers run before the step.
- Unknown scene id in the session: delete `__scene` and call `next()`.
- Manual-purchase wizard state contains the raw activation token. It's dropped from the session on `leave()` automatically, because `__scene` is deleted.

### 7.6 `src/lib/markup.ts`
Mimic the Telegraf API used in legacy code:
- `Markup.inlineKeyboard(rows)` → `{ reply_markup: { inline_keyboard: rows } }`
- `Markup.keyboard(rows).resize()` → `{ reply_markup: { keyboard: rows.map(r => r.map(t => ({ text: t }))), resize_keyboard: true } }`
- `Markup.button.callback(text, data)`, `Markup.button.url(text, url)`

Monshi's persistent menu: `{ keyboard, resize_keyboard: true, is_persistent: true }`.

### 7.7 `src/lib/time.ts`
- `TEHRAN_OFFSET_MS = 3.5h`. Iran has had no DST since 2022, consistent with legacy `'+03:30'`.
- `tehranParts(date = new Date())` uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', hour12: false, … })` and returns `{ y, m, d, hour, minute, weekdayKey }`. `weekdayKey` is one of `mon..sun`.
- `utcIsoNow()` returns a Python-compatible `isoformat()`: `new Date().toISOString().replace('Z', '000+00:00')`, e.g. `2026-10-06T12:00:00.123000+00:00`. Monshi stores and compares these lexicographically, mixed with migrated Python values.
- Jalali conversions via `jalaali-js`. Port `formatJalaliDate`, `formatJalaliDateTime`, `parseJalaliDateTime` and `parseLocalDateTime` from store `utils.js` verbatim. Monshi `format_tehran(iso)` uses the same library and must give the same output as the Python algorithm.
- `formatPrice` uses `toLocaleString('fa-IR')` (works in Workers).

---

## 8. D1 schemas

### 8.1 `migrations/store/0001_init.sql`
1. Copy `legacy/store-bot/src/db/schema.sql` **verbatim**: tables `customers`, `customer_products`, `orders`, `manual_purchase_claims`, `discount_codes`, `discount_code_redemptions`, `store_settings`, with identical column order, CHECKs and defaults. No column migrations or table rebuilds are needed (fresh DB, final shape).
2. Append:
```sql
CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_chat_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  entities TEXT,                                   -- JSON MessageEntity[] or NULL
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done')),
  cursor_customer_id INTEGER NOT NULL DEFAULT 0,   -- last customers.id processed
  total INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+03:30')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_broadcast_status       ON broadcast_jobs(status);
CREATE INDEX IF NOT EXISTS idx_orders_status_decided  ON orders(status, decided_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_expires  ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_telegram_id, status);
CREATE INDEX IF NOT EXISTS idx_redemptions_code_cust  ON discount_code_redemptions(discount_code_id, customer_telegram_id);
CREATE INDEX IF NOT EXISTS idx_products_active        ON customer_products(is_active, id);
```

### 8.2 `migrations/monshi/0001_init.sql`
1. Copy `SCHEMA` from `legacy/monshi-bot/db.py` **verbatim** (`customers`, `messages`, `faqs`, `settings`, `unanswered`, `connection`, `reply_log`, `orders` with `external_order_id`). One change: `faqs.embedding` is declared `TEXT` (base64 of Float32Array, 768 dims). Keep the column name `embedding`.
2. Append:
```sql
CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_msg_chat_id            ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_dir_received       ON messages(direction, received_at);
CREATE INDEX IF NOT EXISTS idx_msg_faq_received       ON messages(faq_id, received_at);
CREATE INDEX IF NOT EXISTS idx_unans_status_norm      ON unanswered(status, normalized_text);
CREATE INDEX IF NOT EXISTS idx_unans_status_count     ON unanswered(status, count DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_paused            ON customers(automation_paused_until);
CREATE INDEX IF NOT EXISTS idx_cust_username          ON customers(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cust_last_msg          ON customers(last_message_at);
CREATE INDEX IF NOT EXISTS idx_orders_external        ON orders(external_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_chat_status     ON orders(chat_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_created  ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_conn_enabled           ON connection(is_enabled, updated_at);
```

### 8.3 `migrations/monshi/0002_seed_settings.sql`
`INSERT OR IGNORE INTO settings (key, value) VALUES (...)` for **every** entry of `DEFAULT_SETTINGS` in `db.py`, with values copied verbatim. Multi-line Persian texts become SQL string literals with real newlines; escape `'` as `''`. `business_hours` must equal Python `json.dumps(DEFAULT_BUSINESS_HOURS)` exactly: `{"sat": "10:00-22:00", "sun": "10:00-22:00", "mon": "10:00-22:00", "tue": "10:00-22:00", "wed": "10:00-22:00", "thu": "10:00-22:00", "fri": null}`. Also seed `embedding_version` = `'3-768'`.

---

## 9. Store bot port (`src/store/`)

### 9.1 `StoreDb` (`db.ts`): port of `database.js`
- `class StoreDb { constructor(private db: CountedD1) }`. Every helper becomes `async`, same name and same semantics, **including which ones swallow errors** (return `undefined`/`[]` and `console.error`) and which ones throw (`countDiscountCodeRedemptions` and `hasCustomerRedeemedCode` must throw so callers fail closed).
- Return shapes: write helpers return `{ changes: meta.changes, lastInsertRowid: meta.last_row_id }`. `first()` returns `null`; normalize to `undefined` where legacy returned undefined.
- `parseProductRow` stays (JSON `terms_entities`).
- `nowLocalDateTimeString()` (legacy `discountCodes.js`) moves here: `SELECT datetime('now','+03:30') AS now`.
- **Transactions → `batch()`**:
  - `createManualPurchaseClaim({creationKey, tokenHash, customerProductId, approvedBy})`: one batch:
    ```sql
    INSERT INTO manual_purchase_claims (creation_key, token_hash, customer_product_id, product_name, price, duration_days, warranty_days, approved_by)
      SELECT ?, ?, id, name, price, duration_days, warranty_days, ? FROM customer_products WHERE id = ? AND is_active = 1
      ON CONFLICT(creation_key) DO NOTHING;
    SELECT * FROM manual_purchase_claims WHERE creation_key = ?;
    ```
    If no row comes back, `throw new Error('Selected customer product is unavailable.')`. An existing claim is returned even if the product was later deactivated (legacy semantics).
  - `redeemManualPurchaseClaim({tokenHash, customerTelegramId, displayName})`: **one** atomic batch (D1 serializes writes, so `MAX(id)` equals the row just inserted):
    ```sql
    -- s1 claim
    UPDATE manual_purchase_claims SET status='claimed', claimed_by=?, claimed_at=datetime('now','+03:30')
      WHERE token_hash=? AND status='pending';
    -- s2 customer upsert, only when this batch just claimed it
    INSERT INTO customers (telegram_id, display_name)
      SELECT ?, ? WHERE EXISTS (SELECT 1 FROM manual_purchase_claims WHERE token_hash=? AND claimed_by=? AND order_id IS NULL)
      ON CONFLICT(telegram_id) DO UPDATE SET display_name = excluded.display_name;
    -- s3 delivered order, clock = approval time
    INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type,
                        purchase_source, status, created_at, decided_at, decided_by, duration_days, warranty_days,
                        delivered_at, expires_at, warranty_expires_at)
      SELECT ?, c.customer_product_id, c.product_name, c.price, NULL, NULL, 'manual', 'delivered',
             c.approved_at, c.approved_at, c.approved_by, c.duration_days, c.warranty_days, c.approved_at,
             CASE WHEN c.duration_days IS NOT NULL THEN datetime(c.approved_at, '+' || c.duration_days || ' days') END,
             CASE WHEN c.warranty_days IS NOT NULL THEN datetime(c.approved_at, '+' || c.warranty_days || ' days') END
      FROM manual_purchase_claims c WHERE c.token_hash=? AND c.claimed_by=? AND c.order_id IS NULL;
    -- s4 link
    UPDATE manual_purchase_claims SET order_id = (SELECT MAX(id) FROM orders)
      WHERE token_hash=? AND claimed_by=? AND order_id IS NULL;
    -- s5 read back
    SELECT * FROM manual_purchase_claims WHERE token_hash=?;
    ```
    Outcome:
    - s5 returns no row → `invalid` (and nothing was written).
    - `s1.meta.changes === 1` → `claimed`.
    - Else `claimed_by === me` → `already_claimed`; else `claimed_by_other`.
    - Then fetch the order by `claim.order_id` (null-safe).
- Reminder queries (`REMINDER_QUERIES`) and the stalled query are copied verbatim. The §8.1 indexes make them index range scans.
- New helpers: `getAppState(key)`, `setAppState(key, value)`, plus broadcast-queue helpers (§9.7).

### 9.2 `config.ts`, `utils.ts`, `services/receiptDelivery.ts`
- Straight ports. `buildPagedKeyboard`, `productButton` and `productPickerKeyboard` use `Markup` from `lib/markup.ts`.
- `ackStrayCallback(ctx)` → `ctx.answerCallbackQuery().catch(() => {})` if `ctx.callbackQuery`.
- Product pickers take an **already-fetched** product list, so the handler fetches once (R2). Legacy `catalogKeyboard(page)` re-queried; now pass the list in.

### 9.3 `bot.ts`: registration order (identical to legacy `bot.js`)
1. `bot.catch(...)`
2. `session(...)` (D1 adapter, store key)
3. `stage.middleware()` with all 8 scenes: `announce-wizard`, `customer-products-wizard`, `customer-products-deactivate-wizard`, `discount-code-add-wizard`, `discount-code-edit-wizard`, `discount-code-renew-wizard`, `store-settings-wizard`, `manual-purchase-wizard`
4. `/start` (admin → `handleManualPurchaseStart` then admin welcome; customer → `upsertCustomer` then `handleManualPurchaseStart` then storefront welcome), then `/panel`
5. `registerAdminPanelHandler`, `registerDiscountCodeHandler`
6. `registerBridgeHandler` (only the `order_deliver_(\d+)` callback remains, §11)
7. `registerStorefrontHandler` (includes the customer catch-all)
8. Admin text fallback (`message:text`)

### 9.4 Handlers (port file by file, same order of statements)
- **`storefront.ts`:** port everything. Notes:
  - `ctx.session.awaitingDiscountCodeFor`, `pendingPurchase` and `awaitingReceiptFor` live in the D1 session.
  - `handleOrderDecision` (confirmed path). Keep the legacy order but **move the bridge call to the end**:
    1. admin check
    2. `getOrderById`
    3. `decideOrder` (`changes === 0` → "already handled", exactly as legacy)
    4. product snapshot
    5. answer callback + edit caption (both `.catch(() => {})`)
    6. discount revalidation + `recordDiscountCodeRedemption`
    7. customer message
    8. **`await bridge.storeOrderPaid(apps, {order_id, customer_id, product})` wrapped in try/catch** (§11)

    The end placement keeps the customer's message order as in legacy (store "confirmed" first, then the support-account "preparing" message). Since every earlier step catches its own errors, the bridge call can't be skipped.
  - The receipt flow keeps the copy-to-admins, rollback-on-total-failure logic (`deliverReceiptToAdmins`, `deletePendingOrder`) exactly.
  - Warranty claim keeps its once-per-day guard.
- **`discountCodes.ts`:** port the 3 wizards and the action handlers. `validateDiscountCodeRecord` becomes async, fail-closed. `applyDiscount` is unchanged. Stage-entering actions call `ctx.scene.enter('discount-code-edit-wizard', { codeId: id })`.
- **`customerProducts.ts`, `storeSettings.ts`, `adminPanel.ts`:** straight ports.
- **`announceWizard.ts`:** steps 0–1 unchanged. Step 2 on `announce_confirm`:
  1. answer the callback
  2. edit the message to the §9.7 text
  3. `enqueueBroadcast({adminChatId: ctx.chat.id, text, entities})`
  4. `await processBroadcastBatch(app, api, { reserve: 8 })` (first batch now, within budget)
  5. `ctx.scene.leave()`

  The summary message is sent by the broadcast module when the job finishes.
- **`manualPurchases.ts`:**
  - `createActivationToken()`: 32 bytes from `crypto.getRandomValues` → base64url without padding (43 chars). Hash: hex SHA-256 via `crypto.subtle.digest` (now async).
  - `creationKey = crypto.randomUUID()`.
  - Link building, share URL and all texts are unchanged.
  - The `/start mp_…` regex stays `^mp_([A-Za-z0-9_-]{43})$`.
  - The payload comes from `ctx.match` in the start command.

### 9.5 Error and edge behaviors to keep
- Every `.catch(() => {})` on edits and answers stays.
- Callback data is untrusted. Keep all ownership and active checks.
- Admin-gated actions answer `'⛔️ دسترسی ندارید.'` as in legacy.

### 9.6 Budget usage targets (store)
- Confirm order including the bridge into monshi: ≤ 30 (about 14 D1 + 6 Telegram + 2 session + monshi side ≈ 8).
- Receipt upload with N admins: about 6 + N. More than about 30 admins isn't supported; document it.
- Use a single `getAllActiveCustomerProducts()` per handler invocation.

### 9.7 Announcement queue (`broadcast.ts`)
- `enqueueBroadcast({adminChatId, text, entities})`: `total = SELECT COUNT(*) FROM customers`. Insert the job with `entities` as JSON or NULL.
- `processBroadcastBatch(app, api, {reserve})`:
  1. Load the oldest `running` job (`ORDER BY id LIMIT 1`, uses the index). None → return.
  2. `n = min(40, budget.remaining() - reserve - 2)`. If `n <= 0`, return.
  3. `SELECT id, telegram_id FROM customers WHERE id > ? ORDER BY id LIMIT ?` (PK range, reads ≤ n rows).
  4. Send sequentially: `api.sendMessage(tid, text, { entities })`.
     - Success → `sent++`.
     - Other errors → `failed++` with a `console.warn`, like legacy.
     - **429** → stop the loop *without* advancing past that customer.
     - `BudgetExceededError` → stop.
  5. One `UPDATE broadcast_jobs SET cursor_customer_id=?, sent=?, failed=?` for the batch.
  6. If fewer rows came back than requested and the loop wasn't stopped, mark the job `done`, set `finished_at`, and send the admin the legacy summary text (copied from `announceWizard.js`: `'✅ *اطلاعیه ارسال شد.*\n\n📨 ارسال موفق: …'`, Markdown).
- The admin-facing "sending" text is the legacy `'⏳ در حال ارسال اطلاعیه...'` followed by this **one new line**: `'\n\n📬 ارسال به‌صورت دسته‌ای (حدود ۴۰ نفر در دقیقه) انجام می‌شود و در پایان گزارش برایتان ارسال می‌شود.'`
- Cron calls `processBroadcastBatch` every minute with whatever budget is left (§12).

---

## 10. Monshi port (`src/monshi/`)

### 10.1 `MonshiDb` (`db.ts`): port of `db.py`
- Every function becomes async, same name in camelCase, same SQL. Timestamps use `utcIsoNow()` (§7.7).
- `save_message` returns `false` on a UNIQUE violation. Implement it as `INSERT … ON CONFLICT DO NOTHING` and return `meta.changes === 1`.
- `upsert_customer` must be **atomic** (§10.3):
  ```sql
  INSERT INTO customers (chat_id, telegram_user_id, username, first_name, first_seen_at, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO NOTHING;              -- changes===1 ⇒ is_new
  UPDATE customers SET telegram_user_id=?, username=?, first_name=?, last_message_at=? WHERE chat_id=?;
  SELECT * FROM customers WHERE chat_id=?;                                  -- returned for pause/ack checks (saves a query)
  ```
  This is one batch. Return `{ isNew, customer }`.
- FAQ embeddings: `setFaqEmbedding(id, base64)`. `update_faq_field` keeps its logic: question or keywords edits null the embedding; answer edits delete `reply_log` rows for `faq:<id>`.
- `get_stats` is split into `getLightStats()` (today_in via `idx_msg_dir_received`, customers count) and `getFullStats()` (legacy full query). See §10.9.
- `app_state` helpers: `getAppStateAll()`, `setAppState(key, value)`.

### 10.2 `context.ts`: per-request cache (R2)
`class MonshiRequestCache`:
- `load()`: one `batch([SELECT key,value FROM settings, SELECT key,value FROM app_state])` → two maps.
- `getSetting(key)` reads the map. `setSetting(key, value)` writes to DB **and** updates the map.
- `getEnabledFaqs()` is memoized (one query per request).
- `ownerUserId` and `activeBcid` come from one `SELECT … FROM connection WHERE is_enabled=1 ORDER BY updated_at DESC LIMIT 1`, memoized.

All services take the cache instead of calling `db.get_setting` repeatedly.

### 10.3 `handlers/business.ts`: port the pipeline exactly
Follow `on_business_message` step by step, with the same order, early returns and `answered_by` values (`handoff`, `ack`, `faq`, `price_fallback`, `order_status`, `human`). Changes:
- Step 2 uses the atomic `upsertCustomer`. Its returned `customer` row feeds `is_chat_paused` and `ack_recently_sent`, so they don't re-query.
- The after-hours ack claim is atomic. **Before** sending, run `UPDATE customers SET last_ack_sent_at=? WHERE chat_id=? AND (last_ack_sent_at IS NULL OR last_ack_sent_at < ?)` with cutoff = now − cooldown. Send only if `changes === 1`. If the send fails, restore the previous value (best effort). This replaces `ack_recently_sent` and `set_last_ack` in that step.
- The greeting path keeps its legacy semantics (sets `last_ack` after a successful send).
- `on_business_connection` is ported verbatim (texts, rights checks).
- `_mark_read`, `_notify_admin` (with the `pause_chat:<id>` button) and `_send_price_fallback` are ported verbatim.

Budget target per business message: ≤ 25 (about 12 D1 + up to 4 Gemini + up to 4 Telegram).

### 10.4 Admin side (`admin.ts`, `faqAdmin.ts`, `orderAdmin.ts`, `common.ts`, `bot.ts`)
- **Registration order equals `bot.py`:**
  1. business connection
  2. business message
  3. admin-only commands (the full list in `bot.py`; filter `chat.type==='private' && from.id === ADMIN_USER_ID`)
  4. notify-only `/start`
  5. callbacks in order: `^(hday|hset|hcustom|hback|hdone)`, `^(fq_|utofaq:)`, `^ord_`, `^orddlv:`, `^(hub_|resume_chat:|pause_chat:)`, `^st_`, `^wiz_cancel$`
  6. admin free text (`message:text`, skipped if the text starts with a `bot_command` entity at offset 0)
- `admin_guard` is ported exactly, including the `NOTIFY_ALLOWED_CALLBACK_PREFIXES = ['pause_chat:']` rule.
- `context.user_data` becomes `ctx.session` (admin private chat only). The keys `faq_wizard`, `faq_edit`, `order_wizard`, `awaiting_hours_day`, `settings_edit` and `awaiting_cooldown` keep their names.
- `on_admin_free_text` ordering is preserved: menu buttons first (`dispatch_menu_button`, including legacy aliases), then the wizards in the same order.
- Status hub (`_status_view`) uses `getLightStats()`. Full stats appear only on `hub_stats` and `/stats` (§10.9).
- `cmd_gemini_status` shows the active model from `app_state.gemini_primary_down_until` (§10.6).

### 10.5 Services
- **`normalize.ts`:** exact port. The digit maps cover Persian and Arabic digits. `ي→ی`, `ك→ک`, ZWNJ→space. `normalize_text` collapses whitespace.
- **`rules.ts`:** `SENSITIVE_KEYWORDS`, `MEDIA_TYPES` and `detect_message_type` are verbatim. Field names match in grammY (`photo`, `voice`, `video`, `document`, `audio`, `video_note`, `sticker`, `contact`, `location`). Pause and cooldown use `Date.parse` on stored ISO strings.
- **`faq.ts`:** `GENERIC_KEYWORDS`, `is_price_query`, `has_specific_keyword`, `find_best_match` (scoring and `MIN_SCORE = 2`) are verbatim. It takes FAQs from the request cache.
- **`hours.ts`:** `WEEKDAY_KEYS`, `PERSIAN_DAY_NAMES`, `IRAN_WEEK_ORDER`, `_parse_range`, `parse_flexible_range` (regex `(\d{1,2})(?::(\d{2}))?\s*(?:-|تا|الی|to|~|إلى)\s*(\d{1,2})(?::(\d{2}))?` and the `24` rules), `is_overnight`, `is_business_hours` (including yesterday's overnight window), `format_hours` and `format_tehran` are ported using `tehranParts`.
- **`orders.ts`:** `STATUS_LABELS`, `status_text`, checklist task building (✅/🔄/⚪), and `send_or_update_checklist` with the text fallback. `ORDER_STATUS_FLOW = ['registered','paid','provisioning','delivered']`.
- **`digest.ts`:** `build_digest` is ported verbatim (`LOOKBACK_DAYS = 7`, uses `_unanswered_view(5)`).

### 10.6 `services/gemini.ts`: REST port
- Constants as in legacy: `EMBEDDING_MODEL='gemini-embedding-001'`, `GENERATION_MODEL='gemini-3.5-flash'`, `FALLBACK_GENERATION_MODEL='gemini-3.1-flash-lite'`, `PRIMARY_RETRY_SECONDS=600`, `TOP_K_CANDIDATES=5`, `HISTORY_LOOKBACK=6`, `SHORT_TEXT_CHARS=15`. `SYSTEM_PROMPT` is verbatim.
- **Timeout:** 8000 ms per call (legacy 15 s; lowered to fit the webhook window). Use `AbortSignal.timeout(8000)`.
- **New:** `EMBEDDING_DIM = 768`, `EMBEDDING_SCHEMA_VERSION = '3-768'`.
- Base URL `https://generativelanguage.googleapis.com/v1beta`, header `x-goog-api-key: <GEMINI_API_KEY>`, `content-type: application/json`.
- **Batch documents:** `POST /models/gemini-embedding-001:batchEmbedContents`, body `{"requests":[{"model":"models/gemini-embedding-001","content":{"parts":[{"text":T}]},"taskType":"RETRIEVAL_DOCUMENT","outputDimensionality":768}, …]}` → `embeddings[i].values`.
- **Query:** `POST /models/gemini-embedding-001:embedContent`, body `{"content":{"parts":[{"text":T}]},"taskType":"RETRIEVAL_QUERY","outputDimensionality":768}` → `embedding.values`.
- **Classify:** `POST /models/{model}:generateContent`, body:
  ```json
  {"systemInstruction":{"parts":[{"text":SYSTEM_PROMPT}]},
   "contents":[{"role":"user","parts":[{"text":PROMPT}]}],
   "generationConfig":{"responseMimeType":"application/json","temperature":0.1,
     "responseJsonSchema":{"type":"object","properties":{
        "action":{"type":"string","enum":["FAQ_ANSWER","AFTER_HOURS_ACK","HUMAN_HANDOFF","ASK_CLARIFICATION","IGNORE","ORDER_STATUS"]},
        "faq_id":{"anyOf":[{"type":"integer"},{"type":"null"}]},
        "confidence":{"type":"number"}},"required":["action","confidence"]}}}
  ```
  Parse `candidates[0].content.parts[0].text` as JSON and validate manually (action in enum, confidence finite, faq_id integer or null). Invalid → throw (the caller falls back to keywords). Build `PROMPT` exactly as legacy (history block, `سوال جدید مشتری:`, candidate listing `#id: question`).
- **Circuit breaker:** `app_state.gemini_primary_down_until` (epoch ms). On a primary failure, set it to now + 600 s and retry once with the fallback model. A fallback failure throws.
- **`ensureEmbeddings(cache)`:**
  - If `settings.embedding_version !== '3-768'`: `UPDATE faqs SET embedding=NULL`, then set the version.
  - Then one `batchEmbedContents` for all enabled FAQs with a NULL embedding (text = legacy `_embedding_text`) and one write batch storing base64.
- **Decoding cache:** module-level `Map<string, Float32Array>` keyed `${id}:${updated_at}:${embedding.length}`. Cosine on Float32Array (CPU, R-limits).
- `get_decision`, `route_decision` and history formatting are ported verbatim. Any error returns `null` (silent keyword fallback), as in legacy.
- If `GEMINI_API_KEY` is missing, `is_enabled()` is false, as in legacy.

### 10.7 Monshi bridge handlers (`handlers/bridge.ts`)
- `PREPARING_TEXT` and `COMPLETION_TEXT` are verbatim (they must stay identical to the store's copies).
- `handleOrderPaid(app, api, event) → {ok:true} | {ok:false, reason}` ports `_handle_order_paid`, but **returns** the failure reason instead of posting to a channel:
  - An already-registered external id returns `{ok:true}` (idempotent).
  - Missing customer → `no_support_chat`. Missing bcid → `no_business_connection`. Send failure → cancel the order and return `send_failed`.
- `deliverOrder(app, api, order)` ports `deliver_order`. Where legacy posted `order_delivered`, call `bridge.monshiOrderDelivered(apps, external_order_id)` (try/catch; log on failure).
- `on_delivery_callback` (`orddlv:<id>`) is ported verbatim, including the admin-only alert text and button removal.
- `order_admin`'s `ord_next` on the last step for an external order calls `deliverOrder`, as legacy does.

### 10.8 Notify fan-out
`notify_all` loops `ALL_NOTIFY_IDS` sequentially with per-recipient try/catch (legacy), each send counted by the budget.

### 10.9 Stats cost control
- `getLightStats()` costs 2 indexed queries.
- `getFullStats()` scans `messages`. Cache the result JSON in `app_state.stats_cache` as `{at, data}` with a 15-minute TTL. `hub_stats` and `/stats` use the cache.

---

## 11. Direct bridge (`src/bridge.ts`)

```ts
// store → monshi  (called at the end of handleOrderDecision when confirmed)
export async function storeOrderPaid(apps, event: { order_id: number; customer_id: number; product: string }): Promise<void>
// monshi → store  (called from deliverOrder for orders with external_order_id)
export async function monshiOrderDelivered(apps, storeOrderId: number): Promise<void>
```

**`storeOrderPaid`:**
1. If `apps.monshi` is null (monshi disabled): `console.warn` like legacy "Event dropped (no BRIDGE_CHANNEL_ID)" and return. No fallback, same as legacy without a channel.
2. Otherwise `res = await monshiBridge.handleOrderPaid(apps.monshi, apps.makeApi(MONSHI_BOT_TOKEN), event)`. If it **throws**, treat it as `{ok:false, reason:'monshi_error'}`.
3. If `!res.ok`, call `storeBridge.onOrderPaidFailed(apps.store, storeApi, {order_id, reason})`. That's the legacy fallback: dedupe via `paid_failed_handled`, the store bot sends `PREPARING_TEXT`, admins get the notice with the `order_deliver_<id>` button. The texts are verbatim from `bridge.js`.

**`monshiOrderDelivered`:** if `apps.store` is null, return. Otherwise `storeBridge.onOrderDelivered(apps.store, id)`, which calls `markOrderDelivered` (status guard makes duplicates no-ops) and logs.

**Removed:** `postBridgeEvent`, the `channel_post` handlers, `BRIDGE_CHANNEL_ID`. **Kept:** the store `order_deliver_(\d+)` callback, verbatim.

Both bot APIs inside one invocation share the same `Budget`.

---

## 12. Cron (`scheduled()` → `runCron(env, now)`)

There's one trigger every minute. It creates `createApps(env)` with a fresh `Budget(50)`, then runs these steps in order. Each is wrapped in its own try/catch, so one failing job doesn't block the others.

1. **Store stalled-order alerts** when `tehranParts(now).minute % 10 === 0`. Port `checkStalledOrders` (threshold 20 h, legacy text, `stalled_alert_sent` set even after send failures). Stop when `budget.remaining() <= 6`.
2. **Store reminders** when Tehran `hour === 11` and `app_state.reminders_done_day !== today`.
   - Port `sendReminders` (kinds `7d`, `3d`, `expired`; legacy `reminderText` and renew button).
   - Collect sent ids per kind and set the flags in **one** batch at the end (`UPDATE orders SET reminded_x=1 WHERE id IN (...)`, chunked ≤ 90 params).
   - Flags are set even when a send failed (legacy rule).
   - If the pass finishes without hitting the budget, set `reminders_done_day = today` (Tehran `YYYY-MM-DD`). Otherwise the next minute continues.
3. **Monshi weekly digest** when Tehran weekday is `sat`, `hour === 9`, `setting digest_enabled === '1'` and `app_state.last_digest_day !== today`. Build `build_digest()` and send it with `notify_all`. Then set `last_digest_day`.
4. **Store broadcast queue:** `processBroadcastBatch` with `reserve: 2`, using the remaining budget.

When nothing is due, a tick costs about 1–3 D1 queries and almost no rows read (indexed).

---

## 13. Session and wizard parity checklist
- The store `/cancel` command and the words `لغو|انصراف|cancel|exit|خروج` inside every scene send the legacy `CANCEL_REPLY` and leave.
- Monshi `/cancel` and `wiz_cancel` clear exactly `WIZARD_STATE_KEYS`.
- Sessions survive across requests (tested by creating a new bot instance per update in tests).

---

## 14. Data migration (`scripts/sqlite_to_d1.py`)

Python 3, **standard library only** (`sqlite3`, `argparse`, `pathlib`).

```
python3 scripts/sqlite_to_d1.py --store /path/storefront.db --monshi /path/monshi.db --out-dir migration_out
```
- Open each DB read-only (`file:...?mode=ro`, `uri=True`). Keep the `-wal`/`-shm` files next to the `.db` so the latest writes are included.
- **Target column lists are hard-coded** in the script to match §8 exactly. For each table, write the intersection of source columns (`PRAGMA table_info`) and target columns as `INSERT INTO t (c1,c2,…) VALUES (…);` **with explicit column names** (legacy column order may differ due to ALTER TABLE history). Missing source tables are skipped with a warning.
- **Literals:**
  - `None` → `NULL`
  - `int`/`float` → `repr`
  - `str` → `'…'` with `''` escaping
  - `bytes` → `X'hex'`, except `faqs.embedding` → always `NULL`
- Each statement is ≤ 100 KB. If a single row exceeds that, abort with a clear error.
- **Output files:**
  - `migration_out/store_data.sql`. Order: `customers, customer_products, discount_codes, orders, discount_code_redemptions, manual_purchase_claims, store_settings`. `store_settings` uses `INSERT OR REPLACE`.
  - `migration_out/monshi_data.sql`. Order: `settings` (INSERT OR REPLACE, overriding the seeds; but **force `embedding_version` to `'3-768'`**), `connection, customers, faqs, messages, unanswered, reply_log, orders`.
  - Both start with `PRAGMA defer_foreign_keys = true;`. **No `BEGIN`/`COMMIT`** (D1 rejects them).
- **Skipped:** `sessions` (in-progress wizards are dropped), `sqlite_sequence` (explicit ids update AUTOINCREMENT automatically).
- Print row counts per table for both source and output.
- **Import:** `npx wrangler d1 execute store-bot-db --remote --file=migration_out/store_data.sql`, and the same for monshi. Run this **after** `db:migrate:remote` and **before** `/setup`.
- `migration_out/` is gitignored. It contains customer data and must never be committed.

---

## 15. Testing strategy (`vitest`, Node 22)

### 15.1 Helpers
- **`test/helpers/fakeD1.ts`:** a D1-compatible wrapper over `node:sqlite` `DatabaseSync(':memory:')`.
  - Methods: `prepare(sql)` → statement with `bind(...args)` (rejects `undefined`, like D1), `first(col?)`, `all()` → `{results, success:true, meta:{changes,last_row_id}}`, `run()`, `raw()`; `batch(stmts)` wrapped in `BEGIN`/`COMMIT` (rollback on error, all-or-nothing like D1); `exec(sql)`.
  - It enables `PRAGMA foreign_keys=ON` (D1 default) and applies all migration files of the given DB in order.
- **`test/helpers/fakeTelegram.ts`:** `makeFakeApi(token)` returns a grammY `Api` whose transformer records `{token, method, payload}` and returns canned results (`sendMessage`/`copyMessage` → `{message_id: n++}`, `sendChecklist` → `{message_id}`, `getMe` → bot user, others → `true`). Tests can register failure rules per method/chat (e.g. throw a 403 GrammyError for admin X). Inject it via `createApps(env, { makeApi, fetch })`.
- **`test/helpers/updates.ts`:** builders for a text message, `/start <payload>`, a callback query (with `message` incl. caption), a photo/document, `business_connection`, `business_message`. Each test update is processed by a **new** bot instance via `handleUpdate`, simulating separate webhook requests.
- **Fake Gemini fetch:** route by URL to scripted JSON.

### 15.2 Required test cases (all must pass)
**Store**
1. `/start` by a customer inserts a customers row and replies with the storefront keyboard. An admin gets the admin keyboard.
2. Full purchase: catalog → product → "no code" → agree (card text shown when settings exist) → photo → `copyMessage` to every admin with the legacy caption and confirm/reject buttons → order `pending`.
3. Port of `storefrontReceipt.test.js`: partial admin failure still succeeds; total failure rolls back and keeps `awaitingReceiptFor`; document receipts use `copyMessage`.
4. Admin confirm → caption edited, customer "confirmed" message, **monshi `sendMessage` with `business_connection_id` and the `orddlv:` button, plus `sendChecklist`**, monshi order `provisioning` with `external_order_id`. A second tap gives "already handled" and no duplicate messages.
5. Admin reject → customer rejection text. The discount redemption is not recorded.
6. Discount: add-code wizard end to end; the customer uses the code → discounted price in terms and order; redemption recorded on confirm; the same customer reusing it gets `already_used`; expired and max-uses checks.
7. Manual purchase: port all `manualPurchases` tests (token length and hash-only storage, link format, wizard with no products, link creation, redeem → delivered with approval-time clock, idempotent re-open, other user rejected, malformed payload, admin can't redeem, normal `/start` not consumed).
8. Announcement: confirm → job created, first batch sent ≤ budget, cron ticks finish the job and send the admin summary. A 429 stops without skipping a customer.
9. Scheduler: 7d, 3d and expired reminders are each sent exactly once across ticks (simulate the clock by passing `now`). The stalled alert is sent once. Budget exhaustion resumes on the next tick.
10. `/cancel` and `لغو` leave a wizard. An active wizard consumes a stray callback (legacy behavior).

**Monshi**

11. `business_connection` saves the row and sends the rights text.
12. An owner message pauses the chat and marks previous messages `human`.
13. New customer → greeting once. Two concurrent first messages → only one greeting (run both `handleUpdate` calls with `Promise.all`).
14. After hours → ack once per cooldown. In hours → silent.
15. Sensitive text or a photo → handoff `notify_all` with the `pause_chat:` button. A notify user can press `pause_chat:` but not other admin callbacks.
16. Keyword FAQ answer, then the repeat-cooldown suppression. Price fallback when no FAQ matches.
17. Gemini (fake fetch): `answer` / `handoff` (keyword rescue) / `order_status` routes. A Gemini HTTP error falls back to keywords. A primary-model error switches to the fallback model and sets `gemini_primary_down_until`. Embeddings are computed once and reused (count fetches).
18. Hours: `parse_flexible_range` cases (`۱۰ تا ۲۲`, `9:30-23`, `10 تا 24` → `10:00-23:59`, `24-6` → `00:00-06:00`), overnight detection, `is_business_hours` across midnight using yesterday's range.
19. Admin: menu buttons beat an active wizard; FAQ add wizard (3 steps) and the generic-keyword warning; hours preset and custom; settings edit; orders panel `ord_next` up to delivered for an external order → store order `delivered` with `expires_at` set.
20. Delivery button: admin → completion text, button removed, store delivered. Non-admin → alert, no change. A repeat press → "already delivered".
21. Digest cron: Saturday 09:xx Tehran sends once (latch). Other days don't send.

**Bridge**

22. `no_support_chat` → store fallback `PREPARING_TEXT` to the customer and an admin notice with `order_deliver_` → pressing it delivers and sends `COMPLETION_TEXT`. A repeat press → "already delivered".
23. Monshi disabled (no token) → confirm still works, no bridge, no fallback.

**Infra**

24. Webhook: a missing or wrong secret → 401. A handler that throws → still 200. An unknown path → 404. `/setup` with a wrong key → 401. With the right key it calls `setWebhook` with the §7.2 `allowed_updates` and `max_connections`.
25. Budget: an invocation never exceeds 50 counted calls in any test. Assert `budget.used <= 50` in a shared `afterEach`.
26. Session adapter skips writes for unchanged or empty sessions (count D1 writes).
27. `indexes.test.ts`: run `EXPLAIN QUERY PLAN` for every hot query (stalled, the 3 reminders, my-subscriptions, redemption checks, messages recent/today/unused-faqs, unanswered lookup/top, paused chats, external order lookup, open orders) and assert no `SCAN orders|messages|customers|unanswered` (a `SEARCH … USING INDEX` is fine).
28. `migration.test.ts`: build a legacy-shaped SQLite file from `legacy/store-bot/src/db/schema.sql` and the legacy `db.py` SCHEMA (skip the test if `legacy/` is absent). Columns are added in a different order via ALTER to mimic old DBs, plus sample rows including a BLOB embedding. Run the Python script via `child_process`, apply the output to fakeD1 after migrations, and assert row counts, explicit-column correctness, NULL embeddings, `embedding_version='3-768'`, and that a subsequent new order gets the id after the max migrated id.

### 15.3 Other checks
- `npm run typecheck` is clean.
- `npm run build:check` (wrangler dry-run bundle) succeeds.
- Optional manual: `npm run db:migrate:local && npm run dev`, then `curl` a fake update with the secret header, and `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.

---

## 16. Deploy guide (turn this into the Persian `README.md`)

The owner runs these on their own computer (Node 18+ and Python 3).

1. `cd business-bots-cloudflare && npm i`
2. `npx wrangler login`
3. `npx wrangler d1 create store-bot-db` and `npx wrangler d1 create monshi-bot-db`. Paste both `database_id`s into `wrangler.toml`.
4. Fill `[vars]` in `wrangler.toml`: `STORE_ADMIN_IDS`, `MONSHI_ADMIN_USER_ID`, `MONSHI_NOTIFY_USER_IDS`.
5. Secrets: `npx wrangler secret put STORE_BOT_TOKEN`, `MONSHI_BOT_TOKEN`, `GEMINI_API_KEY`, `WEBHOOK_SECRET` (generate with `openssl rand -hex 32`).
6. `npm run db:migrate:remote`
7. `npm run deploy`. Note the `https://business-bots.<subdomain>.workers.dev` URL.
8. **Cutover (data):**
   - Stop the old bots (AlwaysData site / `systemctl stop monshi-bot`).
   - Download the latest `storefront.db` and `monshi.db`, **with their `-wal`/`-shm` files**.
   - Run `python3 scripts/sqlite_to_d1.py --store … --monshi … --out-dir migration_out`.
   - Run both `wrangler d1 execute … --remote --file=…` commands.
9. Open `https://…workers.dev/setup?key=<WEBHOOK_SECRET>` once and check that the JSON report shows `ok` for both bots. Telegram then delivers any updates queued while the bots were off (kept up to ~24 h).
10. Test: `/start` in the store bot; a message to the support account from another account; `/status` in monshi.
11. Monitor: `npx wrangler tail`, and the Cloudflare dashboard → Workers → business-bots → Logs and Metrics; D1 → Metrics (rows read/written).
12. Delete the old bridge channel (optional). Keep the old server for a week as a rollback.

**Rollback:** `curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"` for each bot, then start the old servers again (data written on Cloudflare after cutover isn't copied back).

**If you ever hit limits:** Workers Paid ($5/month) raises subrequests to 10,000 and CPU to 30 s with no code changes.

---

## 17. Milestones (one commit each; tests green before each commit)

| # | Milestone | Done when |
|---|---|---|
| M1 | Scaffold: package.json, tsconfig, wrangler.toml, vitest config, `.dev.vars.example`, migrations (§8), `src/index.ts` skeleton with 401/404/200 routing | `typecheck`, `build:check` pass; infra test 24 (routing part) passes |
| M2 | `lib/` (budget, session, wizard, markup, time, botinfo), `apps.ts`, `setup.ts`, test helpers (fakeD1, fakeTelegram, updates) | tests 24–26 pass; wizard unit tests (enter/next/leave/cancel/consume) pass |
| M3 | Store DB + utils + receiptDelivery + config | DB-level manual-purchase and redemption tests pass; test 27 store part |
| M4 | Store handlers + store bot wiring (without bridge: `storeOrderPaid` stub that no-ops) | tests 1–3, 5–7, 10 pass |
| M5 | Store broadcast queue + scheduler + cron dispatcher (store parts) | tests 8–9 pass |
| M6 | Monshi DB, cache, normalize, services (hours, rules, faq, orders, digest) | test 18 + unit tests for faq/rules pass; test 27 monshi part |
| M7 | Monshi business pipeline + Gemini REST | tests 11–17 pass |
| M8 | Monshi admin (admin, faqAdmin, orderAdmin, common) + monshi bot wiring + digest cron | tests 19, 21 pass |
| M9 | Real bridge (both directions) + delivery buttons | tests 4, 20, 22, 23 pass |
| M10 | Migration script + test 28 | migration test passes (with `legacy/` present) |
| M11 | Persian `README.md` (§16), final full run: typecheck, tests, build:check, budget assertion across all tests | all green; README reviewed for accuracy against the code |

---

## 18. Pitfalls checklist (read before coding)
- `undefined` in D1 `bind` throws. Map to `null`.
- `ctx.session` throws when the session key is undefined (business messages, groups, non-admin monshi users).
- grammY `hears('text')` is exact-match, the same as Telegraf.
- **Don't use `@grammyjs/auto-retry`.** Its sleeps and retries burn budget and block the webhook.
- `parse_mode: 'Markdown'` texts must keep `escapeMarkdown` exactly where legacy used it. Plain-text messages stay plain (e.g. reminders, receipt captions).
- Keep the legacy `entities` reuse for terms and announcements. Text must start at offset 0 and must not be trimmed.
- Monshi timestamps are UTC ISO strings (Python format). Store timestamps are Tehran wall-clock `'YYYY-MM-DD HH:MM:SS'` from SQLite `datetime('now','+03:30')`. **Don't mix them.**
- Cron `scheduledTime` is UTC. Always derive Tehran parts via `tehranParts`.
- Use at most ~5 concurrent outbound calls (6-connection limit). Prefer sequential loops.
- Gemini can reject requests from unsupported locations. If logs show `User location is not supported`, report it to the owner. Gemini failures already fall back silently to keyword matching.
- A Telegram `copyMessage` caption is limited to 1024 chars, and the legacy caption is short. Keep it.
- D1 `batch()` is all-or-nothing. Don't put "best effort" statements in the same batch as critical ones.
- Every recipient loop must handle `BudgetExceededError` and leave the remaining work for cron. Never let it bubble up as an unhandled error.
