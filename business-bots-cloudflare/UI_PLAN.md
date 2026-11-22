# Store Bot: New Customer UI (round 5)

> **Audience:** an implementing agent (Claude Code) working in this repo, plus the owner (Zakaria).
> **Where this file goes:** `business-bots-cloudflare/UI_PLAN.md`, next to `CAMPAIGN_PLAN.md`.
> **Production runs commit `c4fb57e`** (worker version `6041abf2`, deployed 22 Nov 2026). Start from there; the baseline is typecheck clean, 869 passed, 1 skipped.
> **Status:** don't deploy. The owner tests it first. The main session deploys after his OK.
> Implement exactly this plan. If something in it is impossible or wrong against the current code, pick the closest safe option, write it down in your final report, and continue. Nobody watches the session live.

---

## خلاصه برای زکریا (فارسی)

ظاهر بخش مشتری فروشگاه شبیه ربات‌های حرفه‌ای می‌شود:

| # | چه چیزی | مشتری چه می‌بیند |
|---|---|---|
| ۱ | **منوی اصلی زیر پیام** | با `/start` یک پیام خوش‌آمد با دکمه‌های رنگی زیرش: 🛍 محصولات، 📋 اشتراک‌های من، 🎁 دعوت دوستان، 💬 پشتیبانی. کیبورد پایین صفحه حذف می‌شود. |
| ۲ | **همه‌چیز در همان پیام** | هر دکمه همان پیام را عوض می‌کند (پیام جدید نمی‌آید)، با «🔙 بازگشت» و «🏠 منوی اصلی». |
| ۳ | **دکمه‌های رنگی** | سبز برای خرید و پرداخت، آبی برای بخش‌ها و کد تخفیف، قرمز برای انصراف و ناموجود. |
| ۴ | **جدول محصول و قیمت** | داخل هر دسته، هر ردیف دو دکمه دارد: اسم و قیمت. |
| ۵ | **صفحه‌ی محصول** | اسم، قیمت (و قیمت قبل از تخفیف)، شرایط، و دکمه‌های «🎟 کد تخفیف»، «💳 پرداخت کارت به کارت». |
| ۶ | **اشتراک‌های من** | یک لیست مرتب به‌جای چند پیام جدا. با زدن هر سفارش جزئیاتش (گارانتی، تمدید، اطلاعات اکانت) در همان پیام می‌آید. |
| ۷ | **عکس محصول (اختیاری)** | ادمین می‌تواند برای هر محصول یک عکس بگذارد که بالای صفحه‌ی محصول نشان داده شود. |

بدون تلگرام پرمیوم، لوگوی کنار دکمه‌ها (ایموجی سفارشی) ممکن نیست. ایموجی‌های معمولی هستند.
پنل ادمین عوض نمی‌شود. پرداخت، رسید، سفارش و تحویل هم دقیقاً مثل قبل کار می‌کنند. فقط ظاهر بخش مشتری عوض می‌شود.

### بعد از پیاده‌سازی، کار تو
روی سرور نمی‌رود تا خودت بگویی. بعد از دیپلوی، با یک اکانت غیرادمین این‌ها را چک کن:
- [ ] `/start`: پیام خوش‌آمد با دکمه‌های رنگی بیاید و کیبورد پایین صفحه برود.
- [ ] محصولات ← یک دسته ← یک محصول ← بازگشت ← منوی اصلی: همه در یک پیام.
- [ ] یک خرید کامل با کد تخفیف و رسید.
- [ ] اشتراک‌های من ← یک سفارش ← تمدید.
- [ ] دعوت دوستان و پشتیبانی.
- [ ] دکمه‌ی یک اطلاعیه‌ی قدیمی یا یادآوری سبد را بزن. خود اطلاعیه نباید پاک شود و صفحه‌ی محصول باید به‌صورت پیام جدید بیاید.

---

## 0. Ground rules for the implementer

1. **Work only inside `business-bots-cloudflare/`, on branch `business-bots-cloudflare`.** Read `PLAN.md` §3 (budget rules R1–R7) and §18, `FEATURES_PLAN.md` §0 and `CAMPAIGN_PLAN.md` §0/§0.5 first. They all apply.
2. **The scope is the customer side only.** Don't change:
   - the admin panel (`adminPanel.ts`, its reply keyboard, any admin wizard)
   - the payment, receipt, order, delivery, supplier, stock or referral-reward logic
   - Monshi or Eitaa
   - `migrations/store/0001`–`0005`
3. **Keep every `callback_data` that exists today** (`cust_prod_<id>`, `cust_grp_<id>`, `cust_catalog_page_<n>`, `cust_catalog_close`, `cust_disc_enter_/skip_`, `cust_agree_/decline_`, `waitlist_join_`, `renew_`, `warranty_claim_`, `reupload_`, `acct_show_`). Old messages in customers' chats (announcements, cart reminders, renewal reminders, old catalog messages) carry them and must keep working. New callbacks use the prefix `ui_` and stay ≤ 64 bytes.
4. **Keep the business texts verbatim:** the card-number/receipt instructions, `RENEWAL_NOTE`, the terms text (with its entities), the waitlist text, the warranty texts and every error/answerCallbackQuery text. Screen headers and button labels may change as specified below.
5. **Budget:**
   - Every Telegram call and every D1 statement costs 1 unit. A customer update must stay ≤ 35.
   - `editMessageText` costs the same as `reply`.
   - Never call `getChat`/`getMe` to build a screen. `ctx.me` is already there.
6. **Parse mode:** keep the current choice per message (legacy `Markdown` where the code uses it today, with `escapeMarkdown` on names). New screens that show product or customer names use the same `escapeMarkdown` pattern or plain text.
7. Before every commit run `npm run typecheck && npx vitest run`. Both must be green. Baseline is whatever the branch has when you start; note it in the report.
   - One commit per milestone (§9).
   - Push after each milestone: `git push -u origin business-bots-cloudflare`, retrying network errors up to 4 times. Never force-push. If the push is rejected: fetch, merge, re-test, push.
8. **Never deploy, run wrangler, touch a remote database, or open a PR.**
9. **Tests:**
   - Existing tests that assert a customer `sendMessage` will now see an `editMessageText` in some places. Update them so they still assert the same behavior: same text pieces, same buttons, same DB effects.
   - Don't delete an assertion without replacing it.
   - New behavior gets new tests in `test/store/ui.test.ts`, using the helpers in `test/helpers/`.

---

## 1. Building blocks (milestone U0)

### 1.1 Button colors
- Telegram's `InlineKeyboardButton` has `style?: 'primary' | 'success' | 'danger'` (blue, green, red), and the installed `@grammyjs/types` 5.0.0 already types it.
- Extend `src/lib/markup.ts`:
  - `button.callback(text, data, style?)` and `button.url(text, url, style?)`.
  - When `style` is undefined, don't add the key, so existing payloads stay byte-identical and existing tests keep passing.
- Don't use `icon_custom_emoji_id`. The owner has no Telegram Premium.

**Color rules** (apply them everywhere in §2–§6):

| Kind of button | style |
|---|---|
| buy/pay/confirm: `💳 پرداخت`, `✅ موافقم`, catalog items, product rows | `success` |
| sections and helpers: main-menu sections, `🎟 کد تخفیف`, `🔔 موجود شد خبرم کن`, `🔄 تمدید` | `primary` |
| cancel and unavailable: `❌ انصراف`, `⛔️ … (ناموجود)` | `danger` |
| navigation: `🔙 بازگشت`, `🏠 منوی اصلی`, page arrows, `💬 پشتیبانی` (url) | none (default) |

### 1.2 The screen helper: edit in place, safely
Create `src/store/ui.ts`:

```ts
/** Shows a customer «screen»: edits the screen message the customer pressed, otherwise sends a new one. */
export async function showScreen(ctx: StoreContext, text: string, extra: { parse_mode?: 'Markdown'; entities?: MessageEntity[]; reply_markup: InlineKb['reply_markup'] }): Promise<void>
```

Rules:
- **Which messages may be edited.** Edit only when the update is a callback query **and** `ctx.callbackQuery.message.message_id === ctx.session.screenMsgId`, the last screen this bot showed this customer. Anything else is sent as a new message, and that new message becomes `screenMsgId`. Anything else means: an announcement, a cart reminder, a renewal reminder, a delivery message, an old pre-UI message, or a text the customer typed.
  - This protects announcements: pressing `cust_prod_` under an announcement must never overwrite the announcement.
  - Sessions are already loaded per update. Saving `screenMsgId` costs the normal session write. Add `screenMsgId?: number | null` to `StoreSession` (`src/store/types.ts`).
- **Photo screens (§7):** if the message to edit is a photo and the new screen is text (or the reverse), delete the old message and send a new one (best-effort delete). Photo → photo uses `editMessageMedia`. Text → text uses `editMessageText`.
- **Errors:**
  - `400 message is not modified` is success, so ignore it.
  - `400 message to edit not found` / `message can't be edited` falls back to sending a new message.
  - `BudgetExceededError` is rethrown.
  - Other errors: log `⚠️ [UI]` and fall back to sending once.
- The helper never calls `answerCallbackQuery`. Each handler answers its callback exactly once, as today.

**Tests:**
- edit when the ids match
- send when they don't (the announcement case)
- `not modified` ignored
- `can't be edited` falls back to a send
- `screenMsgId` updated after a send
- no `style` key when no style is given

---

## 2. Main menu under the message (milestone U1)

### 2.1 The menu screen
In `src/store/ui.ts`, add `mainMenu(app): Promise<{ text, reply_markup }>`:
- **Text (Markdown):** `'👋 *سلام، خوش آمدید!*\n\nاز دکمه‌های زیر انتخاب کنید:'`
- **Rows:**
  1. `[🛍 محصولات (success, ui_menu_shop)]`
  2. `[📋 اشتراک‌های من (primary, ui_menu_subs)]`
  3. `[🎁 دعوت دوستان (primary, ui_menu_ref)]`: only while the referral program is enabled (`getReferralConfig(app).enabled`, the same rule as today's reply keyboard)
  4. `[💬 پشتیبانی (url https://t.me/<ACTIVATION_CONTACT without @>)]`
- `ui_menu_home` re-shows this screen. Every other screen's `🏠 منوی اصلی` button uses it.

### 2.2 `/start`, `/panel` (non-admin) and removing the old reply keyboard
- Customer `/start`: everything before the welcome stays exactly as is (upsert, ref, src, manual link). Replace the welcome `ctx.reply(... customerKeyboard)` with:
  1. If `ctx.session.uiV2 !== true`, first send `'✨ منوی ربات به‌روز شد.'` with `reply_markup: { remove_keyboard: true }` and set `ctx.session.uiV2 = true`. A message can carry either an inline keyboard or a keyboard removal, not both. That is why this one-time extra message exists.
  2. Then `showScreen` the main menu. It is always a new message here (no callback).
- Non-admin `/panel`: same as 2. Admin `/start` and `/panel` are unchanged.
- **Old reply-keyboard buttons keep working.** Keep `bot.hears(STOREFRONT_LABEL)`, `bot.hears(MY_SUBS_LABEL)` and `bot.hears(REFERRAL_LABEL)`. Customers who never press `/start` again still have them.
  - Each now runs the uiV2 step (1), then shows the corresponding screen (§3, §5, §6) as a new message.
- `manualPurchases.ts` sends `customerKeyboard(...)` with 5 error/success replies. Replace that markup with the main-menu inline keyboard (`(await mainMenu(app)).reply_markup`), same texts.
- Delete `customerKeyboard` once nothing uses it.

**Tests:**
- new customer `/start` → removal message, then the menu with the colored buttons
- second `/start` → only the menu
- referral off → no `🎁` row
- old label `🛍 لیست محصولات` still opens the shop
- admin `/start` unchanged
- `ref_`/`src_`/manual-link payloads still do what they did

---

## 3. Shop: categories → table → product (milestone U2)

### 3.1 Categories screen (`ui_menu_shop`, `cust_catalog_page_<n>`, `STOREFRONT_LABEL`)
- **Text:** `'🛍 *محصولات*\n\nیک دسته را انتخاب کنید:'`
- **Entries:** `loadCatalogEntries`, unchanged. Groups and standalone products, same order, same paging (`buildPagedKeyboard` and its page size).
- **Each entry is one full-width button, `success`:**
  - a group shows `group.name`, without the «از X ت» suffix; the price moves into the table
  - a standalone product shows `catalogLabel(p)` as today
  - an unavailable entry keeps its `⛔️ … (ناموجود)` label and gets `danger`
- **Bottom row:** `[🏠 منوی اصلی]`.
- **Remove `❌ بستن`** (`cust_catalog_close`) from new screens. Keep its handler, which now shows the main menu, for old messages.
- Change `buildCatalogEntries` only by adding the style and dropping the suffix. Update its tests.

### 3.2 Group table (`cust_grp_<id>`)
- **Text:** `groupHeaderText(name)` (keep it).
- **Rows:** one per option (`sortOptions`), each with **two buttons on the same callback `cust_prod_<id>`**:
  - `[option_label ?? name (success)]`
  - `[formatPrice(price) + ' تومان' + (hasCompareAt ? ' 🔥' : '') (success)]`
  - an unavailable option: `[⛔️ label (danger)] [ناموجود (danger)]`
- **Bottom rows:** `[🔙 بازگشت (cust_catalog_page_0)]` and `[🏠 منوی اصلی]`.
- A group with one option still goes straight to the product, as today.
- `optionButtonLabel` stays exported and keeps its current output, because tests and the 🔥 rule use it. The table builds its own two labels next to it.

### 3.3 Product screen (`cust_prod_<id>`, `renew_<id>`)
This replaces today's "discount question" message (`sendDiscountPrompt`).

- **Text (Markdown):**
  ```
  📦 *{name}*
  {priceLines(product)}            ← the campaign helper (compare-at aware)
  ⏱ مدت: {duration_days} روز        ← only when duration_days
  🛡 گارانتی: {warranty_days} روز    ← only when warranty_days

  {terms block, see 3.4}
  ```
- **Buttons:**
  - `[🎟 کد تخفیف دارم (primary, cust_disc_enter_<id>)]`
  - `[💳 پرداخت کارت به کارت (success, ui_pay_<id>)]`
  - `[🔙 بازگشت]`: to the group (`cust_grp_<gid>`) when the product is in a group with more than 1 option, else to `cust_catalog_page_0`
  - `[🏠 منوی اصلی]`
- **`ui_pay_<id>`:**
  - Re-check the product as `cust_disc_skip_` does today.
  - Set `pendingPurchase` with the full price, then go to the agree step (3.4).
  - Keep `cust_disc_skip_<id>` working (old messages) with the same effect.
- **Unavailable product:** the waitlist text as today, with buttons `[🔔 موجود شد خبرم کن (primary)]`, `[🔙 بازگشت]` and `[🏠 منوی اصلی]`.
- **`renew_<id>`:** `RENEWAL_NOTE` stays a separate new message, as today, then the product screen as a new message. It comes from a subscription card or a reminder, so `showScreen` sends anyway.

### 3.4 Terms and agree (same message)
- The terms used to be two messages because entity offsets must start at 0.
  - Now build one text: header + `'📜 شرایط و قوانین:\n'` + `terms_text`.
  - Send it **without `parse_mode`**, using `entities`. The header's bold becomes a `bold` entity you add yourself.
  - Shift every stored `terms_entities` offset by the header's length in UTF-16 code units, which is JS `string.length`.
  - Write a pure function `withHeader(header, headerEntities, body, bodyEntities)` and unit-test it with Persian text, an emoji and a bold entity.
- **Agree step text** (after `ui_pay_` or a valid code): the product header + the price block exactly as `showTermsStep` builds it (`💰 قیمت با تخفیف …` or `💰 قیمت …`) + the terms (or `'📜 این محصول شرایط خاصی ندارد.'`) + `'\n\nآیا با شرایط بالا موافقید؟'`.
- **Buttons:** `[✅ موافقم (success, cust_agree_<id>)] [❌ انصراف (danger, cust_decline_<id>)]`, then `[🏠 منوی اصلی]`.
- **`cust_agree_`:** everything it does today (session draft, checkout-draft upsert, card info) stays. The card-info text is edited in place via `showScreen`. Add the row `[❌ انصراف (danger, cust_decline_<id>)]` and nothing else, because the customer's next action is to send the receipt.
- **`cust_decline_`:** same effects as today, then show the main menu in the same message with `'❌ خرید لغو شد.\n\n'` prepended to the menu text.

### 3.5 Discount code
- **`cust_disc_enter_<id>`:** same session effect. The screen becomes `'🎟 لطفاً کد تخفیف را تایپ کنید:'` with `[🔙 بازگشت (cust_prod_<id>)]`. Going back clears `awaitingDiscountCodeFor`.
- **The typed code is a message from the customer.** So the answer is a **new** screen message, which becomes `screenMsgId`:
  - Valid: `'✅ کد تخفیف اعمال شد!'` + the agree screen, all in one message. Today these are 2–3 messages.
  - Invalid: the same error text as today + `[💳 پرداخت بدون کد (success, ui_pay_<id>)]` + `[🏠 منوی اصلی]`.
- Remove the inline keyboard from the previous screen with one `editMessageReplyMarkup` (best-effort), so old buttons don't linger.

**Tests:**
- the full purchase path through the screens ends with the same order in the DB as today
- the code path
- an invalid code
- the back buttons
- a group table with 2 columns and the right callbacks
- an unavailable option in red
- `cust_prod_` pressed under an announcement → a new message, and the announcement is not edited
- the terms with entities keep their formatting in one message
- `withHeader` unit tests
- budget: a customer update stays ≤ 35

---

## 4. Receipt step (no change in logic)
The photo/document handler, the text nudge and `onReupload` keep their behavior and texts. After a receipt is accepted, the existing confirmation message gets the inline `[🏠 منوی اصلی]` row. Nothing else changes.

---

## 5. My subscriptions (milestone U3)

Entry points: `ui_menu_subs` and `MY_SUBS_LABEL`.
- **Load** the same data as today (`getCustomerOrderOverview` + the `viewable` query).
- **One screen:**
  - **Text:** `'📋 *اشتراک‌های من*'`, then the "in progress / rejected" lines exactly as today (if any). With no orders at all, the existing «شما هنوز سفارش تحویل‌شده‌ای ندارید…» text.
  - **Buttons:**
    - one per delivered order: `[📦 {product_name} (primary, ui_sub_<orderId>)]`, newest first, at most 8, with `[بیشتر ◀️ (ui_subs_<page>)]` paging when there are more
    - the existing `📸 ارسال مجدد رسید (#id)` buttons (same rule, max 3)
    - `[🏠 منوی اصلی]`
- **`ui_sub_<orderId>`:**
  - Check ownership: `order.customer_telegram_id === ctx.from.id`, or `'❌ سفارش یافت نشد.'`.
  - Show `subscriptionCardText(order)` (unchanged) with today's buttons: `🛠 مشکل دارم` (primary), `🔄 تمدید / خرید مجدد` (primary), `🔑 نمایش اطلاعات اکانت` (primary, when viewable), plus `[🔙 بازگشت (ui_menu_subs)]` and `[🏠 منوی اصلی]`.
- `warranty_claim_`, `renew_` and `acct_show_` keep their current behavior. They may still reply with new messages: that's fine and safer for account data.

**Tests:**
- the list
- the detail
- the ownership check with a forged `ui_sub_`
- paging
- in-progress and rejected lines
- the reupload button still works

---

## 6. Invite friends screen (milestone U3, same commit)
- Entry points: `ui_menu_ref` and `REFERRAL_LABEL`. Show the existing customer referral text (the `bot.hears(REFERRAL_LABEL)` body in `referralPanel.ts` ~l.345, including the link and any invitee-gift line) through `showScreen`.
- Add `[🏠 منوی اصلی]`. If the referral program is off, keep today's answer.
- Refactor the body into a function that returns `{ text, extra }`, so `hears` and the callback share it.

---

## 7. Product photo (milestone U4, optional, last)

- **Migration** `migrations/store/0006_product_photo.sql`:
  ```sql
  ALTER TABLE customer_products ADD COLUMN photo_file_id TEXT;   -- Telegram file_id of the store bot; NULL = no photo
  ```
  Add it to `CustomerProduct`, `scripts/sqlite_to_d1.py` and the migration test.
- **Admin:**
  - In `customerProductsEdit.ts`, add the button `'🖼 عکس محصول'`. It asks `'🖼 عکس محصول را بفرستید (یا «حذف»).'`.
  - A photo sets `photo_file_id = largest size's file_id`. `حذف` sets NULL. Anything else re-asks.
  - The product detail view shows `'🖼 عکس: ' + (photo ? 'دارد' : '—')`.
  - Follow the wizard's existing step pattern.
- **Product screen (§3.3)** with `photo_file_id`:
  - The screen is a photo with the same text as its **caption**.
  - Captions are limited to 1024 characters. If the caption would be longer, show the photo screen without the terms block and put `'📜 شرایط در مرحله‌ی بعد نمایش داده می‌شود.'`; the agree step (text) shows them.
  - `showScreen` handles the switch between photo and text screens as in §1.2.
- **Tests:**
  - set/clear the photo
  - the product screen sends a photo when set
  - text→photo→text navigation (delete + send)
  - the long-caption rule
  - a product without a photo is unchanged

---

## 8. Pitfalls checklist

- **Never edit a non-screen message:** announcements, reminders, delivery messages, admin cards. Use the `screenMsgId` rule only.
- **Callback answers:** exactly one `answerCallbackQuery` per callback, with the same alert texts as today.
- **Forged callbacks:** every `ui_*` handler with an id re-checks product state and order ownership, as the existing handlers do.
- **Markdown:** every product, group or option name inside a Markdown screen goes through `escapeMarkdown`. The fake Telegram's `markdownError` check catches mistakes, so keep tests on names with `_` and `*`.
- **Sessions:** `screenMsgId` and `uiV2` are the only new session fields. Don't store screens' content in the session.
- **Budget:** a screen change is `answerCallbackQuery` + one edit (+ the reads it needs). Any loop over orders or products stays a single query.
- **Admins:** admins never see the customer menu from `/start` or `/panel`. The admin panel stays the reply keyboard.
- **Old clients:** `style` is ignored by Telegram apps that don't support it. Nothing else depends on it.

## 9. Milestones (one commit each; typecheck + tests green before each)

| Milestone | Content | Commit message |
|---|---|---|
| U0 | §1 colors + `showScreen` | `ui: button colors and edit-in-place screens` |
| U1 | §2 main menu, keyboard removal | `ui: inline main menu` |
| U2 | §3 + §4 shop, table, product, purchase screens | `ui: shop screens` |
| U3 | §5 + §6 subscriptions and invite screens | `ui: subscriptions and invite screens` |
| U4 | §7 product photo | `ui: product photo` |

After U4, add a short Persian section to `README.md` (same style) describing the new customer menu and the admin `🖼 عکس محصول` button.

**When done, reply with:**
- per milestone: commit hash and tests passed/skipped
- every deviation from this plan, and why
- anything unfinished
