# Monshi on Eitaa: Menu and Keyword Auto-Replies (round 7)

> **Audience:** an implementing agent (Claude Code) working in this repo.
> **Base:** branch `business-bots-cloudflare` at `77dad25` or later. Production runs `77dad25`. Baseline: typecheck clean, 944 passed, 1 skipped.
> Implement exactly this plan. If something doesn't fit the code, pick the closest safe option, write it down in your final report, and continue. Nobody watches the session live.

## خلاصه (فارسی)
منشی ایتا (با اکانت شخصی صاحب کسب‌وکار) به مشتری‌ها جواب خودکار می‌دهد:
- **منو:** بار اولی که مشتری پیام می‌دهد، یا هر وقت بنویسد «منو». منو شامل «📦 موجودی امروز» (زنده از ربات استور) و «⚡️ جواب سریع» با کلمه‌های قابل‌کپی است.
- **جواب هر کلمه** (مثلاً «جمینای»): اسم، قیمت، موجودی و شرایط کامل همان محصول، عیناً از ربات استور.
- **«خرید جمینای»:** مشتری پیام «ثبت شد» می‌گیرد و صاحب کسب‌وکار یک اعلان خرید می‌گیرد.

کلمه‌ی هر محصول در ربات استور با دکمه‌ی «🔑 کلمه‌ی ایتا» تنظیم می‌شود. بعد از دیپلوی، این قابلیت خاموش است تا صاحب کسب‌وکار اول تستش کند.

---

## 0. Rules
1. Same rules as `CAMPAIGN_PLAN.md` §0/§0.5, `UI_PLAN.md` §0 and `PRICE_SCHEDULE_PLAN.md` §0:
   - **Budget:** 50 units per invocation. Every Telegram call, every Eitaa call and every D1 statement (store or monshi) costs 1.
   - **SQL:** plain `?` placeholders only. Add every new hot query to `test/indexes.test.ts`.
   - **Messages:** plain text, or explicit entities. No Markdown parse mode for text containing product names.
2. **Data safety:** only *add* the one nullable store column (§1) and new Monshi `settings` keys with defaults. Don't modify or delete existing rows or columns. Don't touch store migrations `0001`–`0007` or Monshi migrations `0001`–`0004`.
3. **Don't touch:**
   - the Telegram Monshi auto-reply pipeline (`autoRespond` in `src/monshi/handlers/business.ts`), except for reusing exported helpers
   - the store purchase/payment flow
   - the supplier engine
   - price schedules
4. **The new code only reads the store.** Monshi must never write to the store DB. If `app.apps.store` is null (store not configured), the feature is off.
5. **Git:**
   - Before every commit run `npm run typecheck && npx vitest run`. Both must be green.
   - Make one commit per milestone and push with `git push -u origin business-bots-cloudflare`.
   - Never force-push. If the push is rejected, fetch, merge, re-test, push.
6. **Never deploy**, run wrangler, touch a remote database, or open a PR.

## 1. Store: Eitaa keyword per product (milestone E0)

**Migration** `migrations/store/0008_eitaa_keyword.sql`:
```sql
-- round 7: the word an Eitaa customer types to get this product's details (EITAA_MENU_PLAN.md)
ALTER TABLE customer_products ADD COLUMN eitaa_keyword TEXT;
```
- Add `eitaa_keyword?: string | null` to `CustomerProduct` in `src/store/db.ts`.
- Check `scripts/sqlite_to_d1.py` for explicit column lists and update it if needed.
- Extend `test/migration.test.ts`.

**Admin button** in `src/store/handlers/customerProductsEdit.ts`, wired the same way as `cprod_edit_f_compare` (prompt, cancel button, back to the card):
- **Card button:** a new row `[Markup.button.callback('🔑 کلمه‌ی ایتا', 'cprod_edit_f_eitaa')]` under the `⏰ قیمت زمان‌دار` row.
- **Card line** (after the `⏰ قیمت زمان‌دار` line): `'🔑 کلمه‌ی ایتا: ' + (p.eitaa_keyword ?? '—')`.
- **Prompt:** `'🔑 کلمه‌ای که مشتری در ایتا می‌فرستد تا شرایط و قیمت این محصول را بگیرد (مثلاً: جمینای).\nبرای حذف بنویسید: حذف'`.
- **Validation:** normalize with the same rules as §2.2 (`normalizeKeyword`, exported from a shared place both apps can import, e.g. `src/lib/keyword.ts`). The input is:
  - `حذف`: stored as NULL.
  - anything else must pass every check below, or the step re-asks with the stated message:

    | Check | Message on failure |
    |---|---|
    | 1–2 words, normalized length 2–20 characters | `'⚠️ کلمه باید ۱ یا ۲ کلمه و حداکثر ۲۰ حرف باشد.'` |
    | not a reserved word: `منو`, `قیمت`, `قیمتها`, `خرید`, `شرایط` | `'⚠️ این کلمه رزرو شده است؛ کلمه‌ی دیگری انتخاب کنید.'` |
    | not starting with `خرید `, `شرایط ` or `قیمت ` | (same) |
    | no other **active** product has the same normalized keyword | `'⚠️ محصول «' + other.name + '» همین کلمه را دارد.'` |

- **Storage:** store the keyword as the admin typed it, trimmed. Compare normalized.

**Tests:**
- set, clear and each validation error
- the card line
- the duplicate check ignores inactive products

## 2. The auto-reply (milestones E1 and E2)

### 2.1 Settings (Monshi `settings` table, read with `app.ctx.getSetting`)
| key | default | meaning |
|---|---|---|
| `eitaa_auto_enabled` | `'0'` | master switch for this feature |
| `eitaa_menu_greeting` | `'سلام 👋 خوش اومدید'` | first line of the menu |

No migration is needed if `getSetting` returns null for missing keys; treat null as the default. Seed nothing.

The feature also respects the existing global switch `rules.isAutomationEnabled(app)`. When that is off, Eitaa is silent too.

### 2.2 Pure builders (milestone E1): `src/monshi/eitaa/menu.ts`

**Reading products.** `loadEitaaProducts(app: MonshiApp)` runs one store query per poll invocation; cache it in a variable that the poll passes down, not a module global:
```sql
SELECT id, name, price, compare_at_price, is_available, terms_text, terms_entities, eitaa_keyword
FROM customer_products WHERE is_active = 1 ORDER BY group_id IS NOT NULL, group_id, sort_order, id
```
- Put this SQL as a method on `StoreDb`.
- Parse `terms_entities` JSON the same way the storefront does.
- Use the same ordering the store catalog uses if one exists (`buildCatalogEntries`). Don't invent a different order.

**`normalizeKeyword(s)`:**
- `normalizeText(s).toLowerCase()`
- remove zero-width/half-space characters (U+200C, U+200F, U+200E), replacing U+200C with a normal space first
- strip trailing `؟?!.،,` and surrounding «» "" quotes
- collapse spaces

**`matchMessage(text, products)`** returns one of:
- `{ kind: 'menu' }`
- `{ kind: 'prices' }`
- `{ kind: 'product', product }`
- `{ kind: 'buy', product }`
- `null`

It first normalizes the text and returns `null` if it has more than 3 words. Then:

| Message (normalized) | Result |
|---|---|
| `منو` | menu |
| `قیمت` / `قیمتها` / `قیمت ها` / `لیست قیمت` | prices |
| `خرید <k>` | buy that product |
| `<k>`, `شرایط <k>` or `قیمت <k>` | that product |

`<k>` is a product's normalized keyword. Only products with a keyword can match. An unavailable product still matches, because its reply says it's unavailable. Anything else returns `null`.

**`buildMenu(greeting, products)`** returns `{ text, entities }` in Telegram entity form `{ type, offset, length }`, with offsets in UTF-16, as the store uses:
```
<greeting>

📦 موجودی امروز:
• <name> — <price> ت[ 🔥]      (one line per AVAILABLE product; 🔥 when hasCompareAt)

⚡️ جواب سریع (کپی کنید و بفرستید):
<k1>  ·  <k2>  ·  …            (keywords of available products, each with a `code` entity)
قیمت ← لیست قیمت‌ها            («قیمت» gets a `code` entity)
منو ← همین پیام                 («منو» gets a `code` entity)

یا سؤالتون رو بنویسید 🙂
```
- If no product is available, the stock section is `📦 فعلاً محصولی موجود نیست.`
- If no product has a keyword, omit the keyword line.
- Use `formatPrice` and `hasCompareAt` from the store (`src/store/catalog.ts`).
- Strip a leading U+200F from names. Product names in prod start with it.

**`buildPrices(products)`:** the same stock section on its own, with the `منو` line at the end.

**`buildProductReply(product)`:**
```
📦 <name>
<priceLines(product)>              (strike the old price exactly like makeHead in storefront.ts; export a shared helper rather than copy it)
✅ موجود | ⛔️ فعلاً ناموجود

<terms_text with its terms_entities shifted>   (omit if no terms)

🛒 برای خرید بنویسید:  خرید <keyword>      («خرید <keyword>» gets a `code` entity; omit this line when unavailable)
```
- Reuse `withHeader` from `src/store/ui.ts` to join the header and terms with shifted entities.
- If the result is over 4000 UTF-16 units, cut the terms at a line break before the limit, append `…`, and drop or clip entities past the cut.

**`toEitaaEntities(entities)`** maps Telegram entity types to Eitaa TL objects, using the names that exist in `src/monshi/eitaa/tl/specs.js`:

| Telegram type | Eitaa TL object |
|---|---|
| bold | `messageEntityBold` |
| italic | `messageEntityItalic` |
| underline | `messageEntityUnderline` |
| strikethrough | `messageEntityStrike` |
| code | `messageEntityCode` |
| pre | `messageEntityPre` (language `''`) |
| text_link | `messageEntityTextUrl` (url) |
| blockquote | `messageEntityBlockquote` |
| url, mention, hashtag | the matching type |

Drop every other type (spoiler, custom_emoji, …). Offsets are UTF-16 on both sides, so copy them unchanged.

**Tests** (`test/monshi/eitaaMenu.test.ts`):
- matching:
  - each row of the table
  - Persian/Arabic letter variants
  - a half-space keyword
  - `؟` at the end
  - a 4-word message → null
  - `جمینای من کار نمیکنه` → null
- the menu text and its `code` entities land exactly on the keywords
- an unavailable product: not in the stock list, and its reply says `⛔️ فعلاً ناموجود` without a buy line
- a sale product shows 🔥, and the reply has a strikethrough over the old price
- entity conversion, including dropping unknown types
- truncation over 4000

### 2.3 Wiring into the Eitaa poll (milestone E2): `src/monshi/eitaa/poll.ts`

**Sending with entities.**
- Extend `sendEitaaText(app, chatId, text, entities?)`.
- When entities are given, pass them as `entities` with the matching `flags` bit. In MTProto `messages.sendMessage` that is bit 3 (`flags |= 8`). Verify it against `specs.js` and set it per the spec.
- Existing callers are unchanged.

**Budget.** Add a constant `AUTO_REPLY_UNITS = 6`: product read, up to 2 sends, save, claim and slack. Add it to `perMessageBudget` when `eitaa_auto_enabled === '1'`.

**`handleMessage` order for an incoming customer message.** Keep all existing behaviour (store, dedupe, notify) and add the auto-reply between storing and notifying. The notify call keeps its existing undelivered-row rollback.

1. If either switch is off, the chat is paused (`rules.isChatPaused(customer, now)`), the message is not text, or `rules.isSensitive(text, type)` is true: no auto-reply.
2. If the customer is new (`upsertCustomer(...).isNew`), send the menu first.
3. `const m = matchMessage(text, products)`:
   - **menu:** send the menu, unless step 2 already sent it.
   - **prices:** send the price list.
   - **product:** send its reply.
   - **buy:** send `'✅ درخواست خرید «' + name + '» ثبت شد؛ به‌زودی پیام می‌دهم.'`. If the product is unavailable, send `'⛔️ «' + name + '» فعلاً ناموجود است؛ به‌زودی پیام می‌دهم.'` instead.
   - **null:** nothing beyond step 2.
4. **Rate limit:** at most 5 auto-replies per chat per rolling hour.
   - Count `direction = 'out'` rows for the chat with `received_at > now − 1h`. Add an index if the plan shows a scan, and add the query to the index test.
   - Over the limit: send nothing.
5. **Repeat guard:** for each send, use `rules.claimAutoReply(app, chatId, replyKey)` with replyKey:
   - `eitaa_menu`
   - `eitaa_prices`
   - `eitaa_p_<id>`
   - `eitaa_buy_<id>`

   This gives the existing 1 h cooldown. Release the claim if the send fails, as `sendAutoReplyOnce` does. A repeat within the cooldown is skipped silently.
6. **Saving:** save every auto-reply with `app.db.saveMessage(chatId, sentId, 'out', 'text', text, EITAA_BCID)`.
7. **Notify the owner** with the existing `notifyAdmin`. Only the `reason` changes:

   | Case | reason |
   |---|---|
   | buy | `'🛒 خرید از ایتا: ' + name` |
   | an auto-reply went out | `'🤖 جواب خودکار رفت: ' + label` (label is `منو`, `قیمت‌ها` or the product name) |
   | nothing went out | `'پیام جدید'`, unchanged |

8. A failed send is logged and never blocks the notification. A thrown error never loses the message: the notify still runs, like the `finally` in `onBusinessMessage`.

**The owner steps in.**
- In the `m.pFlags.out` branch, when `saveMessage` returns a new row (the owner typed in the Eitaa app), also call `rules.pauseChat(app, chatId)`, as Telegram does for the owner's manual message.
- **Our own auto-replies echo back through `getDifference` as `out` messages.**
  - They're already stored under their real id, so `saveMessage` returns 0 and nothing pauses.
  - When `sendEitaaText` couldn't learn the id (the `-Date.now()` fallback), the echo looks new. Before pausing, check whether this chat has an `out` row with the **same text** saved in the last 10 minutes. If so, it's our own echo: don't pause and don't call `markChatAnsweredByHuman`.
  - Add a small db method for that check, and test it.

**Tests** (`test/monshi/eitaaAuto.test.ts`; copy the setup of the existing Eitaa poll tests and their fake Eitaa transport):
- **Switches and pauses:**
  - switch off → no Eitaa send, notify as before
  - global automation off → silent
  - a paused chat → silent
- **New customer:**
  - `سلام` → the menu, sent with `messageEntityCode` entities
  - `جمینای` as the first message → menu + product reply
- **Matching messages:**
  - `شرایط جمینای` → the product reply with the terms entities converted
  - `خرید جمینای` → the confirmation, plus a notification whose text contains `🛒 خرید از ایتا`
  - a sensitive message (`رسید`) → no auto-reply
  - a long question → no auto-reply, `پیام جدید`
- **Limits:**
  - the same keyword twice within an hour → one reply
  - 6 different keywords within an hour → 5 replies
- **The owner steps in:**
  - the owner types in Eitaa → the chat is paused and the next keyword gets no reply
  - our own echo (both the known id and the unknown-id fallback) doesn't pause
- **Budget and failures:**
  - a tick with 4 keyword messages stays ≤ 50 and leaves `CRON_RESERVE`
  - the store being null → feature off, no throw
  - a failed send → the notification still goes out

## 3. Owner controls (milestone E3)

In the Monshi settings hub (`src/monshi/handlers/admin.ts`, next to `greetingView`), add a view `'📗 منوی ایتا'` (`st_eitaa_menu`):

- **Text:**
  ```
  '📗 جواب خودکار ایتا (' + (on ? 'روشن ✅' : 'خاموش 🚫') + ')\n\nخط اول منو:\n' + greeting
    + '\n\nکلمه‌ی هر محصول را در ربات استور ← ویرایش محصول ← «🔑 کلمه‌ی ایتا» تنظیم کنید.'
  ```
- **Buttons:**
  - toggle (`st_toggle_eitaa_auto`)
  - `✏️ ویرایش خط اول` (`st_edit:eitaa_menu_greeting`, reusing the existing `st_edit` flow; add the key to whatever whitelist it uses)
  - `🧪 پیش‌نمایش در ایتا` (`st_eitaa_preview`)
  - `🔙 بازگشت به تنظیمات`

**Preview.** It sends the menu, then the first keyword product's reply, to the owner's own Eitaa **Saved Messages** (`inputPeerSelf`). It works even while the switch is off. It answers the callback with `'✅ در Saved Messages ایتا ببینید'`, or the error text.
- The poll already ignores messages in the self chat (`userId === meId`). Keep it that way.
- This is how the owner checks that tap-to-copy works in the Eitaa app before switching the feature on.

**Admin guard.** Every new callback is guarded by the same admin guard as the other `st_` callbacks.

**Tests:**
- the toggle flips and the view re-renders
- the greeting edit
- the preview calls `messages.sendMessage` with `inputPeerSelf` and entities
- a non-admin callback is ignored

**README.** After E3, add a short Persian section, «📗 منوی خودکار ایتا», covering:
- how to set keywords
- preview first, then switch on
- the safety rules: short messages only, 5 per hour, silence after the owner replies

## 4. Milestones
| Milestone | Content | Commit message |
|---|---|---|
| E0 | §1 store column + keyword button | `eitaa menu: product keyword` |
| E1 | §2.2 builders + tests | `eitaa menu: builders` |
| E2 | §2.3 poll wiring + tests | `eitaa menu: auto-replies` |
| E3 | §3 settings, preview, README | `eitaa menu: owner controls` |

**When done, reply with:**
- per milestone: commit hash and tests passed/skipped
- every deviation from this plan
- anything unfinished
