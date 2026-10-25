import type { Bot } from 'grammy';
import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { formatJalaliDateTime } from '../../lib/time';
import { SUPPLIER_LABEL } from '../labels';
import { escapeHtml, buildPagedKeyboard, formatPrice } from '../utils';
import { DEFAULT_BASE_URL, adapterFor } from '../suppliers';
import {
  countLinkedOptions, getSupplier, insertSupplier, listSuppliers, markSyncDue, readCatalog, setSupplierKey, setSupplierUserId, toggleSupplier,
} from '../suppliers/store';
import type { Catalog, SupplierRow } from '../suppliers/types';
import { getSupplierDefaults, setSupplierDefaults } from '../supplierDefaults';
import type { StoreContext } from '../types';
import { handleImportCallback, handleImportText, startImport } from './supplierImport';
import { handleSourcesCallback, handleSourcesText } from './supplierSources';
import { recomputeOption } from '../suppliers/recompute';

const INPUT_TTL_MS = 15 * 60_000;
const ITEMS_PAGE_PREFIX = 'sup_items_';
const CANCEL_INPUT = Markup.button.callback('❌ انصراف', 'sup_cancel_input');

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const kb = (rows: InlineButton[][]) => Markup.inlineKeyboard(rows);
const html = { parse_mode: 'HTML' as const };

const fa = (n: number | string) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));
const asciiDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30))
  .replace(/[\s,،٬]/g, '');

// ─── Menu ────────────────────────────────────────────────────────────────────

const MENU_TEXT = '🔌 <b>API تأمین‌کننده</b>\n\nتأمین‌کننده‌ها را اضافه کنید و محصولاتشان را با قیمت خرید ببینید.';

function menuKb() {
  return kb([
    [cb('🏪 تأمین‌کننده‌ها', 'sup_list')],
    [cb('💹 سود پیش‌فرض', 'sup_def')],
    [cb('❌ بستن', 'sup_close')],
  ]);
}

// ─── Supplier list and card ──────────────────────────────────────────────────

async function listView(app: StoreApp): Promise<{ text: string; keyboard: ReturnType<typeof kb> }> {
  const suppliers = await listSuppliers(app);
  const rows: InlineButton[][] = suppliers.map((s) => [cb((s.is_enabled ? '' : '⏸ ') + s.name, 'sup_s_' + s.id)]);
  rows.push([cb('➕ افزودن تأمین‌کننده', 'sup_add')]);
  rows.push([cb('🔙 بازگشت', 'sup_menu')]);
  const text = suppliers.length
    ? '🏪 <b>تأمین‌کننده‌ها</b>'
    : '🏪 <b>تأمین‌کننده‌ها</b>\n\nهنوز تأمین‌کننده‌ای اضافه نشده است.';
  return { text, keyboard: kb(rows) };
}

const maskedKey = (key: string) => '••••' + key.slice(-4);

async function cardView(app: StoreApp, s: SupplierRow): Promise<{ text: string; keyboard: ReturnType<typeof kb> }> {
  const cached = await readCatalog(app, s.id);
  const linked = await countLinkedOptions(app, s.id);
  const lines = [
    '🔌 <b>' + escapeHtml(s.name) + '</b>',
    '',
    'نوع: آریوباکس (ArioBox)',
    'وضعیت: ' + (s.is_enabled ? '✅ فعال' : '⏸ غیرفعال'),
    '🔑 کلید: <code>' + escapeHtml(maskedKey(s.api_key)) + '</code>',
    '👤 user_id: <code>' + s.remote_user_id + '</code>',
    '🕒 آخرین همگام‌سازی موفق: ' + (s.last_sync_ok_at ? formatJalaliDateTime(s.last_sync_ok_at) : '—'),
  ];
  if (s.last_sync_error) lines.push('⚠️ خطای آخرین همگام‌سازی: ' + escapeHtml(s.last_sync_error.slice(0, 300)));
  lines.push(
    '💵 نرخ دلار: ' + (cached ? formatPrice(cached.catalog.usdToman) + ' ت' : '—'),
    '📦 محصولات در کاتالوگ: ' + (cached ? fa(cached.catalog.items.length) : '۰'),
    '🔗 گزینه‌های متصل: ' + fa(linked),
  );
  const keyboard = kb([
    [cb('🔄 همگام‌سازی الان', 'sup_sync_' + s.id), cb('📋 محصولات', ITEMS_PAGE_PREFIX + s.id + '_0')],
    [cb('🔑 تغییر کلید', 'sup_key_' + s.id), cb('👤 تغییر user_id', 'sup_uid_' + s.id)],
    [cb(s.is_enabled ? '⏸ غیرفعال کردن' : '▶️ فعال کردن', 'sup_tog_' + s.id)],
    [cb('🔙 بازگشت', 'sup_list')],
  ]);
  return { text: lines.join('\n'), keyboard };
}

// ─── Products of a catalog (paged, grouped by product) ───────────────────────

async function itemsView(app: StoreApp, s: SupplierRow, page: number): Promise<{ text: string; keyboard: ReturnType<typeof kb> }> {
  const cached = await readCatalog(app, s.id);
  const back = cb('🔙 بازگشت', 'sup_s_' + s.id);
  if (!cached) {
    return { text: '📋 هنوز کاتالوگی از «' + escapeHtml(s.name) + '» دریافت نشده است. ابتدا همگام‌سازی کنید.', keyboard: kb([[back]]) };
  }
  const groups = new Map<string, { id: string; name: string; count: number; min: number | null }>();
  for (const it of cached.catalog.items) {
    const g = groups.get(it.remoteProductId) ?? { id: it.remoteProductId, name: it.name, count: 0, min: null };
    g.count += 1;
    if (it.priceUsd !== null && (g.min === null || it.priceUsd < g.min)) g.min = it.priceUsd;
    groups.set(it.remoteProductId, g);
  }
  const products = [...groups.values()];
  const keyboard = buildPagedKeyboard(products, page, (g) => {
    const price = g.min === null ? '—' : '$' + g.min.toFixed(2);
    return cb(g.name.slice(0, 40) + ' (' + g.count + ' گزینه) از ' + price, 'sup_imp_' + s.id + '_' + g.id);
  }, ITEMS_PAGE_PREFIX + s.id + '_', back);
  const text = '📋 <b>محصولات ' + escapeHtml(s.name) + '</b>\n' + products.length + ' محصول — نرخ دلار ' + formatPrice(cached.catalog.usdToman) + ' ت';
  return { text, keyboard };
}

// ─── Default markup (kv) ─────────────────────────────────────────────────────

async function defaultsView(app: StoreApp): Promise<{ text: string; keyboard: ReturnType<typeof kb> }> {
  const d = await getSupplierDefaults(app);
  const text = '💹 <b>سود پیش‌فرض</b>\n\n' +
    '٪ درصد: ' + (d.markupPercent === null ? 'تعیین نشده' : fa(d.markupPercent) + '٪') + '\n' +
    '＋ مبلغ ثابت: ' + (d.markupFixed === null ? 'تعیین نشده' : formatPrice(d.markupFixed) + ' ت') + '\n\n' +
    'این سود برای محصولاتی استفاده می‌شود که سود اختصاصی ندارند.';
  return { text, keyboard: kb([[cb('٪ درصد', 'sup_def_pct'), cb('＋ مبلغ ثابت', 'sup_def_fix')], [cb('🔙 بازگشت', 'sup_menu')]]) };
}

// ─── Add-supplier wizard (session: supplierWizard) ───────────────────────────

const WIZ_STEP_TEXT: Record<string, string> = {
  name: '✏️ نام تأمین‌کننده را وارد کنید (۱ تا ۴۰ کاراکتر):',
  url: '🌐 آدرس پایه‌ی API را وارد کنید (باید با https:// شروع شود):',
  key: '🔑 کلید API را بفرستید.\nپیام شما بلافاصله پاک می‌شود و کلید فقط در پایگاه داده ذخیره می‌شود.',
  user: '👤 user_id (عدد مثبت) حساب مشتری در تأمین‌کننده را وارد کنید:',
};

async function askWizardStep(ctx: StoreContext, step: string, extra: InlineButton[][] = []) {
  const wizardKb = kb([...extra, [CANCEL_INPUT]]);
  ctx.session.supplierWizard = { step, data: ctx.session.supplierWizard?.data ?? {} };
  await ctx.reply(WIZ_STEP_TEXT[step], wizardKb);
}

/** Runs the connection test with a temporary row (nothing is saved yet). */
async function testAndMaybeSave(ctx: StoreContext, data: Record<string, any>): Promise<void> {
  const temp: SupplierRow = {
    id: 0, kind: 'ariobox', name: data.name, base_url: data.baseUrl, api_key: data.apiKey, remote_user_id: data.userId,
    is_enabled: 1, last_sync_at: null, last_sync_ok_at: null, last_sync_error: null, sync_alert_sent: 0, created_at: '',
  };
  const r = await adapterFor('ariobox', ctx.app.apps).fetchCatalog(temp);
  if (r.ok) {
    const catalog: Catalog = r.value;
    const id = await insertSupplier(ctx.app, {
      kind: 'ariobox', name: data.name, baseUrl: data.baseUrl, apiKey: data.apiKey, remoteUserId: data.userId,
    }, catalog);
    ctx.session.supplierWizard = null;
    await ctx.reply(
      '✅ اتصال برقرار شد — ' + fa(catalog.items.length) + ' محصول، نرخ دلار ' + formatPrice(catalog.usdToman) + ' تومان',
      { ...html, ...kb([[cb('🔌 نمایش تأمین‌کننده', 'sup_s_' + id)]]) },
    );
    return;
  }
  if (r.kind === 'auth') {
    ctx.session.supplierWizard = { step: 'test', data: { ...data, apiKey: undefined } };
    await ctx.reply('❌ کلید API نامعتبر است.', kb([[cb('🔁 دوباره کلید را می‌فرستم', 'sup_add_retype')], [CANCEL_INPUT]]));
    return;
  }
  ctx.session.supplierWizard = { step: 'test', data };
  await ctx.reply(
    '❌ اتصال ناموفق بود: ' + escapeHtml(r.detail.slice(0, 300)),
    { ...html, ...kb([[cb('💾 ذخیره بدون تست', 'sup_add_save_untested')], [cb('🔁 دوباره', 'sup_add_retry')], [CANCEL_INPUT]]) },
  );
}

async function saveUntested(ctx: StoreContext) {
  const d = ctx.session.supplierWizard?.data;
  if (!d?.apiKey) return ctx.reply('⌛️ اطلاعات ورود تمام شد؛ دوباره از اول شروع کنید.');
  const id = await insertSupplier(ctx.app, {
    kind: 'ariobox', name: d.name, baseUrl: d.baseUrl, apiKey: d.apiKey, remoteUserId: d.userId,
  }, null);
  ctx.session.supplierWizard = null;
  await ctx.reply('✅ «' + escapeHtml(d.name) + '» بدون تست ذخیره شد.', { ...html, ...kb([[cb('🔌 نمایش تأمین‌کننده', 'sup_s_' + id)]]) });
}

// ─── Typed inputs ────────────────────────────────────────────────────────────

/** Applies a typed value; returns a Persian problem message, or null when accepted. */
async function applyTypedInput(ctx: StoreContext, kind: string, ref: string, text: string): Promise<string | null> {
  if (kind === 'sup_key_edit' || kind === 'sup_uid') {
    const s = await getSupplier(ctx.app, parseInt(ref, 10));
    if (!s) return '❌ تأمین‌کننده یافت نشد.';
    if (kind === 'sup_uid') {
      const uid = asciiDigits(text);
      if (!/^\d{1,15}$/.test(uid) || Number(uid) <= 0) return '❌ user_id باید یک عدد مثبت باشد. دوباره وارد کنید:';
      await setSupplierUserId(ctx.app, s.id, Number(uid));
      return null;
    }
    const key = text.trim();
    if (key.length < 8 || key.length > 200) return '❌ کلید باید بین ۸ تا ۲۰۰ کاراکتر باشد. دوباره بفرستید:';
    const r = await adapterFor('ariobox', ctx.app.apps).fetchCatalog({ ...s, api_key: key });
    if (!r.ok) return r.kind === 'auth' ? '❌ کلید API نامعتبر است.' : '❌ اتصال ناموفق بود: ' + escapeHtml(r.detail.slice(0, 300));
    await setSupplierKey(ctx.app, s.id, key);
    return null;
  }
  // default markup
  const n = Number(asciiDigits(text));
  if (text.trim() === '' || !Number.isFinite(n) || n < 0) return '❌ عدد معتبر وارد کنید (۰ مجاز است):';
  const d = await getSupplierDefaults(ctx.app);
  if (kind === 'def_percent') {
    if (n > 500) return '❌ درصد باید بین ۰ تا ۵۰۰ باشد:';
    await setSupplierDefaults(ctx.app, { ...d, markupPercent: n });
  } else {
    if (!Number.isInteger(n) || n > 100_000_000) return '❌ مبلغ باید عدد صحیح تا ۱۰۰٬۰۰۰٬۰۰۰ ت باشد:';
    await setSupplierDefaults(ctx.app, { ...d, markupFixed: n });
  }
  return null;
}

const INPUT_PROMPT: Record<string, string> = {
  sup_key_edit: '🔑 کلید API جدید را بفرستید (پیام شما پاک می‌شود):',
  sup_uid: '👤 user_id جدید را وارد کنید:',
  def_percent: '٪ درصد سود پیش‌فرض را وارد کنید (۰ تا ۵۰۰):',
  def_fixed: '＋ مبلغ ثابت سود پیش‌فرض را به تومان وارد کنید (۰ مجاز است):',
};

type TypedInput = NonNullable<StoreContext['session']['awaitingSupplierInput']>['kind'];

async function startInput(ctx: StoreContext, kind: TypedInput, ref: string) {
  ctx.session.awaitingSupplierInput = { kind, ref, at: ctx.app.apps.now().getTime() };
  await ctx.answerCallbackQuery();
  await ctx.reply(INPUT_PROMPT[kind], kb([[CANCEL_INPUT]]));
}

function clearInputs(ctx: StoreContext) {
  if (!ctx.session) return;
  ctx.session.awaitingSupplierInput = null;
  ctx.session.supplierWizard = null;
  ctx.session.supplierImport = null;
}

/** One add-supplier step: name → url → key (message deleted) → user id → connection test. */
async function handleWizardText(ctx: StoreContext, step: string, text: string): Promise<void> {
  const d = ctx.session.supplierWizard!.data;
  if (step === 'key') await ctx.deleteMessage().catch(() => {});

  if (step === 'name') {
    const name = text.trim();
    if (name.length < 1 || name.length > 40) {
      await ctx.reply('❌ نام باید بین ۱ تا ۴۰ کاراکتر باشد. دوباره وارد کنید:');
      return;
    }
    d.name = name;
    await askWizardStep(ctx, 'url', [[cb('پیش‌فرض (https://ariobox.space)', 'sup_add_url_default')]]);
    return;
  }
  if (step === 'url') {
    const url = text.trim().replace(/\/+$/, '');
    if (!/^https:\/\/[^\s/]+/.test(url)) {
      await ctx.reply('❌ آدرس باید با https:// شروع شود. دوباره وارد کنید:');
      return;
    }
    d.baseUrl = url;
    await askWizardStep(ctx, 'key');
    return;
  }
  if (step === 'key') {
    const key = text.trim();
    if (key.length < 8 || key.length > 200) {
      await ctx.reply('❌ کلید باید بین ۸ تا ۲۰۰ کاراکتر باشد. دوباره بفرستید:');
      return;
    }
    d.apiKey = key;
    await askWizardStep(ctx, 'user');
    return;
  }
  // user id, then the connection test
  const uid = asciiDigits(text);
  if (!/^\d{1,15}$/.test(uid) || Number(uid) <= 0) {
    await ctx.reply('❌ user_id باید یک عدد مثبت باشد. دوباره وارد کنید:');
    return;
  }
  d.userId = Number(uid);
  await testAndMaybeSave(ctx, d);
}

/** Recomputes every automatic option that has no own markup (SUPPLIER_PLAN.md §4.5). Returns how many. */
async function applyDefaultsToAuto(ctx: StoreContext): Promise<number> {
  const rows = (await ctx.app.raw.prepare(`
    SELECT id FROM customer_products
    WHERE pricing_mode = 'auto' AND markup_percent IS NULL AND markup_fixed IS NULL
      AND EXISTS (SELECT 1 FROM product_sources s WHERE s.customer_product_id = customer_products.id)`)
    .bind().all<{ id: number }>()).results;
  let count = 0;
  for (const r of rows) {
    if (ctx.app.apps.budget.remaining() < 10) break;
    await recomputeOption(ctx.app, r.id);
    count++;
  }
  return count;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerSupplierPanel(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  bot.hears(SUPPLIER_LABEL, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    clearInputs(ctx);
    await ctx.reply(MENU_TEXT, { ...html, ...menuKb() });
  });

  bot.callbackQuery(/^sup_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    const data = ctx.callbackQuery.data;
    const app = ctx.app;

    const show = async (v: { text: string; keyboard: ReturnType<typeof kb> }) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(v.text, { ...html, ...v.keyboard }).catch(() => {});
    };

    if (data === 'sup_menu') return show({ text: MENU_TEXT, keyboard: menuKb() });
    if (data === 'sup_close') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('🔌 بسته شد.').catch(() => {});
      return;
    }
    if (data === 'sup_list') return show(await listView(app));
    if (data === 'sup_def') return show(await defaultsView(app));
    if (data === 'sup_cancel_input') {
      clearInputs(ctx);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ انصراف شد.').catch(() => {});
      return;
    }
    if (await handleSourcesCallback(ctx, data)) return;
    if (await handleImportCallback(ctx, data)) return;
    if (data === 'sup_defapply') {
      await ctx.answerCallbackQuery();
      const count = await applyDefaultsToAuto(ctx);
      await ctx.reply('🔁 ' + fa(count) + ' محصول به‌روز شد.');
      return;
    }

    // add-supplier steps
    if (data === 'sup_add') {
      ctx.session.supplierWizard = { step: 'name', data: {} };
      await ctx.answerCallbackQuery();
      await ctx.reply(WIZ_STEP_TEXT.name, kb([[cb('آریوباکس (پیش‌فرض)', 'sup_add_name_default')], [CANCEL_INPUT]]));
      return;
    }
    if (data === 'sup_add_name_default' && ctx.session.supplierWizard?.step === 'name') {
      ctx.session.supplierWizard.data.name = 'آریوباکس';
      await ctx.answerCallbackQuery();
      return askWizardStep(ctx, 'url', [[cb('پیش‌فرض (https://ariobox.space)', 'sup_add_url_default')]]);
    }
    if (data === 'sup_add_url_default' && ctx.session.supplierWizard?.step === 'url') {
      ctx.session.supplierWizard.data.baseUrl = DEFAULT_BASE_URL.ariobox;
      await ctx.answerCallbackQuery();
      return askWizardStep(ctx, 'key');
    }
    if (data === 'sup_add_retype' && ctx.session.supplierWizard) {
      await ctx.answerCallbackQuery();
      return askWizardStep(ctx, 'key');
    }
    if (data === 'sup_add_retry' && ctx.session.supplierWizard?.data?.apiKey) {
      await ctx.answerCallbackQuery();
      return testAndMaybeSave(ctx, ctx.session.supplierWizard.data);
    }
    if (data === 'sup_add_save_untested') {
      await ctx.answerCallbackQuery();
      return saveUntested(ctx);
    }

    const sMatch = data.match(/^sup_s_(\d+)$/);
    if (sMatch) {
      const s = await getSupplier(app, parseInt(sMatch[1], 10));
      if (!s) return show(await listView(app));
      return show(await cardView(app, s));
    }
    const togMatch = data.match(/^sup_tog_(\d+)$/);
    if (togMatch) {
      const id = parseInt(togMatch[1], 10);
      await toggleSupplier(app, id);
      const s = await getSupplier(app, id);
      if (!s) return show(await listView(app));
      return show(await cardView(app, s));
    }
    const syncMatch = data.match(/^sup_sync_(\d+)$/);
    if (syncMatch) {
      // the sync itself runs from the minute cron (SUPPLIER_PLAN.md §6.1); clearing last_sync_at makes it due now
      await markSyncDue(app, parseInt(syncMatch[1], 10));
      await ctx.answerCallbackQuery({ text: 'در دقیقه‌ی بعد همگام‌سازی می‌شود.', show_alert: true });
      return;
    }
    const itemsMatch = data.match(/^sup_items_(\d+)_(\d+)$/);
    if (itemsMatch) {
      const s = await getSupplier(app, parseInt(itemsMatch[1], 10));
      if (!s) return show(await listView(app));
      return show(await itemsView(app, s, parseInt(itemsMatch[2], 10)));
    }
    const impMatch = data.match(/^sup_imp_(\d+)_([A-Za-z0-9_-]+)$/);
    if (impMatch) {
      const started = await startImport(ctx, parseInt(impMatch[1], 10), impMatch[2]);
      if (!started) return ctx.answerCallbackQuery({ text: '❌ این محصول دیگر در کاتالوگ نیست.', show_alert: true });
      await ctx.answerCallbackQuery();
      return;
    }
    const keyMatch = data.match(/^sup_key_(\d+)$/);
    if (keyMatch) return startInput(ctx, 'sup_key_edit', keyMatch[1]);
    const uidMatch = data.match(/^sup_uid_(\d+)$/);
    if (uidMatch) return startInput(ctx, 'sup_uid', uidMatch[1]);
    if (data === 'sup_def_pct') return startInput(ctx, 'def_percent', '');
    if (data === 'sup_def_fix') return startInput(ctx, 'def_fixed', '');

    await ctx.answerCallbackQuery();
  });

  // typed inputs: the add-supplier steps, and the one open edit or default-markup prompt
  bot.on('message:text', async (ctx, next) => {
    if (!isAdmin(ctx.from?.id) || !ctx.session) return next();
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      clearInputs(ctx);
      return next();
    }
    const wiz = ctx.session.supplierWizard;
    const pending = ctx.session.awaitingSupplierInput;
    const wizardStep = wiz && ['name', 'url', 'key', 'user'].includes(wiz.step) ? wiz.step : null;
    if (!wizardStep && !pending) return next();

    if (!wizardStep && pending && ctx.app.apps.now().getTime() - pending.at > INPUT_TTL_MS) {
      clearInputs(ctx);
      await ctx.reply('⌛️ مهلت ورود تمام شد. دوباره از پنل شروع کنید.');
      return;
    }

    if (wizardStep) {
      await handleWizardText(ctx, wizardStep, text);
      return;
    }

    if (await handleImportText(ctx, pending!.kind, pending!.ref, text)) {
      ctx.session.awaitingSupplierInput = null;
      return;
    }
    if (await handleSourcesText(ctx, pending!.kind, pending!.ref, text)) return;

    const problem = await applyTypedInput(ctx, pending!.kind, pending!.ref, text);
    if (pending!.kind === 'sup_key_edit') await ctx.deleteMessage().catch(() => {});
    if (problem) {
      await ctx.reply(problem);
      return;
    }
    ctx.session.awaitingSupplierInput = null;
    if (pending!.kind.startsWith('def_')) {
      const v = await defaultsView(ctx.app);
      await ctx.reply('✅ ذخیره شد.\n\n' + v.text, { ...html, ...kb([
        [cb('🔁 اعمال روی همه‌ی گزینه‌های خودکاری که سود اختصاصی ندارند', 'sup_defapply')],
        [cb('🔙 بازگشت', 'sup_menu')],
      ]) });
      return;
    }
    const s = await getSupplier(ctx.app, parseInt(pending!.ref, 10));
    if (!s) {
      await ctx.reply('✅ ذخیره شد.');
      return;
    }
    const v = await cardView(ctx.app, s);
    await ctx.reply('✅ ذخیره شد.\n\n' + v.text, { ...html, ...v.keyboard });
  });
}

