import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { processBroadcastBatch } from '../broadcast';
import { adminProductLabel, buildPagedKeyboard, formatPrice, parsePrice, productPickerKeyboard } from '../utils';
import { parseDays, productNameError } from './customerProducts';
import type { CustomerProduct } from '../db';
import { recomputeOption } from '../suppliers/recompute';
import type { StoreContext } from '../types';

const CANCEL_BTN = Markup.button.callback('❌ انصراف', 'cprod_edit_cancel');

const FIELD_PROMPTS: Record<string, string> = {
  name: '✏️ نام جدید محصول را وارد کنید:',
  price: '💰 قیمت جدید را به تومان وارد کنید:\n\nمثال: 1200000',
  terms: '📜 متن جدید شرایط و قوانین را وارد کنید:',
  duration: '⏱ مدت اشتراک را به روز وارد کنید (مثال: 30):',
  warranty: '🛡 مدت گارانتی را به روز وارد کنید (مثال: 7):',
  // grouped options and groups (SUPPLIER_PLAN.md §3.2)
  label: '🏷 عنوان گزینه را وارد کنید (۱ تا ۴۰ کاراکتر):',
  grpname: '✏️ نام جدید گروه را وارد کنید (۱ تا ۶۰ کاراکتر):',
  grpnew: '🗂 نام گروه جدید را وارد کنید (۱ تا ۶۰ کاراکتر):',
  sort: '🔢 ترتیب گزینه را وارد کنید (عدد صحیح از ۰ تا ۹۹۹):',
  grpsort: '🔢 ترتیب گروه در فهرست را وارد کنید (عدد صحیح از ۰ تا ۹۹۹):',
};

const GROUP_PICK_PAGE_PREFIX = 'cprod_edit_grppage_';

const pickerKb = (products: CustomerProduct[], page: number) =>
  productPickerKeyboard(products, page, 'cprod_edit_select_', 'cprod_edit_page_', CANCEL_BTN, adminProductLabel);

/** Default option label: the duration as «N روزه», or the current name. */
const defaultOptionLabel = (p: CustomerProduct): string => (p.duration_days ? formatPrice(p.duration_days) + ' روزه' : p.name);

/** Groups, paged, with «➕ گروه جدید» and «▫️ بدون گروه» above the back button. */
function groupPickerKb(groups: { id: number; name: string }[], page: number) {
  const kb = buildPagedKeyboard(groups, page, (g) => Markup.button.callback(g.name, 'cprod_edit_grp_' + g.id), GROUP_PICK_PAGE_PREFIX,
    Markup.button.callback('🔙 بازگشت', 'cprod_edit_menu'));
  const rows = kb.reply_markup.inline_keyboard;
  rows.splice(rows.length - 1, 0, [Markup.button.callback('➕ گروه جدید', 'cprod_edit_grpnew')], [Markup.button.callback('▫️ بدون گروه', 'cprod_edit_grpnone')]);
  return kb;
}

export function productCardText(p: CustomerProduct): string {
  return (
    '✏️ ویرایش محصول\n\n' +
    '📦 نام: ' + p.name + '\n' +
    '💰 قیمت: ' + formatPrice(p.price) + ' تومان\n' +
    '📜 شرایط: ' + (p.terms_text ? 'دارد' : 'ندارد') + '\n' +
    '⏱ مدت اشتراک: ' + (p.duration_days ? p.duration_days + ' روز' : 'ندارد') + '\n' +
    '🛡 گارانتی: ' + (p.warranty_days ? p.warranty_days + ' روز' : 'ندارد') + '\n' +
    '📦 وضعیت: ' + (p.is_available === 0 ? '⛔️ ناموجود' : '✅ موجود') + '\n' +
    (p.group_id != null ? '🏷 عنوان گزینه: ' + (p.option_label ?? '') + '\n' : '') +
    '\nکدام مورد را می‌خواهید تغییر دهید؟'
  );
}

function cardKb(p: CustomerProduct, extra: ReturnType<typeof Markup.button.callback>[][] = [], canAutoStock = false) {
  const grouped = p.group_id != null;
  return Markup.inlineKeyboard([
    grouped
      ? [Markup.button.callback('🏷 عنوان گزینه', 'cprod_edit_f_label'), Markup.button.callback('💰 قیمت', 'cprod_edit_f_price')]
      : [Markup.button.callback('✏️ نام', 'cprod_edit_f_name'), Markup.button.callback('💰 قیمت', 'cprod_edit_f_price')],
    [Markup.button.callback('📜 شرایط', 'cprod_edit_f_terms')],
    [Markup.button.callback('⏱ مدت اشتراک', 'cprod_edit_f_duration'), Markup.button.callback('🛡 گارانتی', 'cprod_edit_f_warranty')],
    [Markup.button.callback(p.is_available === 0 ? '✅ موجود کن' : '⛔️ ناموجود کن', 'cprod_edit_toggle_stock')],
    ...(canAutoStock ? [[Markup.button.callback('📦 موجودی خودکار', 'cprod_edit_stock_auto')]] : []),
    [Markup.button.callback('🗂 گروه', 'cprod_edit_grp_menu'), Markup.button.callback('🔢 ترتیب گزینه', 'cprod_edit_f_sort')],
    ...(grouped ? [[Markup.button.callback('✏️ نام گروه', 'cprod_edit_f_grpname'), Markup.button.callback('🔢 ترتیب گروه', 'cprod_edit_f_grpsort')]] : []),
    [Markup.button.callback('🔌 منابع و قیمت', 'sup_src_' + p.id)],
    ...extra,
    [Markup.button.callback('✅ پایان', 'cprod_edit_done')],
  ]);
}

/** Puts the option into the group. Asks for its label first when it has none (the default is offered). */
async function attachToGroup(ctx: StoreContext, p: CustomerProduct, groupId: number): Promise<'moved' | 'asked' | 'gone'> {
  if (!p.option_label) {
    ctx.wizard.state.edit.field = 'label';
    ctx.wizard.state.edit.pendingGroupId = groupId;
    await ctx.reply(
      FIELD_PROMPTS.label,
      Markup.inlineKeyboard([
        [Markup.button.callback('▫️ همین پیش‌فرض (' + defaultOptionLabel(p) + ')', 'cprod_edit_label_default')],
        [Markup.button.callback('🔙 بازگشت', 'cprod_edit_menu')],
      ]),
    );
    return 'asked';
  }
  return completeMove(ctx, p, groupId, p.option_label);
}

async function completeMove(ctx: StoreContext, p: CustomerProduct, groupId: number, label: string): Promise<'moved' | 'gone'> {
  const group = await ctx.app.db.getProductGroup(groupId);
  if (!group) return 'gone';
  const r = await ctx.app.db.moveOptionToGroup(p.id, groupId, label, group.name + ' — ' + label);
  ctx.wizard.state.edit.pendingGroupId = null;
  ctx.wizard.state.edit.field = null;
  return r.changes === 1 ? 'moved' : 'gone';
}

async function loadProduct(ctx: StoreContext): Promise<CustomerProduct | null> {
  const id = ctx.wizard.state.edit?.productId;
  const p = id ? await ctx.app.db.getCustomerProductById(id) : undefined;
  return p && p.is_active ? p : null;
}

async function productGone(ctx: StoreContext) {
  await ctx.reply('❌ این محصول دیگر موجود نیست.');
  return ctx.scene.leave();
}

/** Shows the card as a new message (after text input) or edits the current one (after a button). */
async function showCard(ctx: StoreContext, p: CustomerProduct, opts: { prefix?: string; edit?: boolean; extra?: any[][] } = {}) {
  const text = (opts.prefix ? opts.prefix + '\n\n' : '') + productCardText(p);
  // a manual stock setting on an option with supplier sources can be handed back to the supplier
  const canAutoStock = p.stock_mode === 'manual' && (await ctx.app.raw.prepare(
    'SELECT 1 AS x FROM product_sources WHERE customer_product_id = ? LIMIT 1').bind(p.id).first()) !== null;
  const kb = cardKb(p, opts.extra, canAutoStock);
  if (opts.edit) {
    await ctx.editMessageText(text, kb).catch(() => {});
  } else {
    await ctx.reply(text, kb);
  }
}

async function applyPatch(ctx: StoreContext, patch: Parameters<StoreContext['app']['db']['updateCustomerProduct']>[1]) {
  const r = await ctx.app.db.updateCustomerProduct(ctx.wizard.state.edit.productId, patch);
  return r.changes === 1;
}

/** Warns when the new price makes active fixed discount codes give the product away. */
async function priceWarnings(ctx: StoreContext, p: CustomerProduct): Promise<string> {
  const codes = await ctx.app.db.getFixedCodesAtLeast(p.id, p.price, p.group_id ?? null);
  return codes
    .map((c) => '\n⚠️ کد تخفیف ' + c.code + ' (مبلغ ثابت ' + formatPrice(c.discount_value) +
      ' تومان) از قیمت جدید بیشتر یا برابر است و محصول را رایگان می‌کند. آن را ویرایش یا غیرفعال کنید.')
    .join('');
}

const NOTE_SNAPSHOT = '\nℹ️ سفارش‌های قبلی تغییری نمی‌کنند.';

/** 0–999 in Persian or Latin digits; anything else is null. */
function parseSortOrder(text: string): number | null {
  const normalised = text.trim().replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,3}$/.test(normalised)) return null;
  const n = Number(normalised);
  return n <= 999 ? n : null;
}

export const customerProductsEditWizard = new WizardScene<StoreContext>(
  'customer-products-edit-wizard',

  // STEP 0: pick an active product.
  async (ctx) => {
    ctx.wizard.state.edit = {};
    const products = await ctx.app.db.getAllActiveCustomerProducts();
    if (products.length === 0) {
      await ctx.reply('✅ هیچ محصول فعالی در فروشگاه وجود ندارد.');
      return ctx.scene.leave();
    }
    await ctx.reply('✏️ *ویرایش محصول*\n\nمحصول مورد نظر را انتخاب کنید:', { parse_mode: 'Markdown', ...pickerKb(products, 0) });
    return ctx.wizard.next();
  },

  // STEP 1: menu loop (picker → card → field input). Never advances; «پایان» leaves.
  async (ctx) => {
    const edit = ctx.wizard.state.edit;
    const data = ctx.callbackQuery?.data;

    if (data) {
      if (data === 'cprod_edit_cancel') {
        await ctx.answerCallbackQuery('عملیات لغو شد.');
        await ctx.editMessageText('❌ عملیات لغو شد.').catch(() => {});
        return ctx.scene.leave();
      }
      if (data === 'cprod_edit_done') {
        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
        await ctx.reply('✅ ویرایش محصول تمام شد.');
        return ctx.scene.leave();
      }

      const pageMatch = data.match(/^cprod_edit_page_(\d+)$/);
      if (pageMatch) {
        await ctx.answerCallbackQuery();
        const products = await ctx.app.db.getAllActiveCustomerProducts();
        await ctx.editMessageReplyMarkup({ reply_markup: pickerKb(products, parseInt(pageMatch[1], 10)).reply_markup }).catch(() => {});
        return;
      }

      const selMatch = data.match(/^cprod_edit_select_(\d+)$/);
      if (selMatch) {
        const p = await ctx.app.db.getCustomerProductById(parseInt(selMatch[1], 10));
        if (!p || !p.is_active) {
          await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
          return;
        }
        edit.productId = p.id;
        edit.field = null;
        await ctx.answerCallbackQuery();
        await showCard(ctx, p, { edit: true });
        return;
      }

      if (!edit.productId) {
        await ctx.answerCallbackQuery('⚠️ ابتدا یک محصول را انتخاب کنید.');
        return;
      }

      const p = await loadProduct(ctx);
      if (!p) {
        await ctx.answerCallbackQuery();
        return productGone(ctx);
      }

      if (data === 'cprod_edit_menu') {
        edit.field = null;
        edit.termsAll = false;
        await ctx.answerCallbackQuery();
        await showCard(ctx, p, { edit: true });
        return;
      }

      // ── groups (SUPPLIER_PLAN.md §3.2) ───────────────────────────────────
      if (data === 'cprod_edit_grp_menu') {
        edit.field = null;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText('🗂 گروه این گزینه را انتخاب کنید:', groupPickerKb(await ctx.app.db.listGroups(), 0)).catch(() => {});
        return;
      }

      const grpPageMatch = data.match(new RegExp('^' + GROUP_PICK_PAGE_PREFIX + '(\\d+)$'));
      if (grpPageMatch) {
        await ctx.answerCallbackQuery();
        const kb = groupPickerKb(await ctx.app.db.listGroups(), parseInt(grpPageMatch[1], 10));
        await ctx.editMessageReplyMarkup({ reply_markup: kb.reply_markup }).catch(() => {});
        return;
      }

      const grpMatch = data.match(/^cprod_edit_grp_(\d+)$/);
      if (grpMatch) {
        await ctx.answerCallbackQuery();
        const r = await attachToGroup(ctx, p, parseInt(grpMatch[1], 10));
        if (r === 'gone') return productGone(ctx);
        if (r === 'moved') await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ به گروه اضافه شد.' });
        return;
      }

      if (data === 'cprod_edit_grpnew') {
        edit.field = 'grpnew';
        await ctx.answerCallbackQuery();
        await ctx.reply(FIELD_PROMPTS.grpnew, Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'cprod_edit_menu')]]));
        return;
      }

      if (data === 'cprod_edit_grpnone') {
        await ctx.answerCallbackQuery();
        if (p.group_id != null) {
          const r = await ctx.app.db.leaveGroup(p.id);
          if (r.changes !== 1) return productGone(ctx);
        }
        edit.field = null;
        await showCard(ctx, (await loadProduct(ctx))!, { edit: true, prefix: '✅ از گروه خارج شد.' });
        return;
      }

      if (data === 'cprod_edit_label_default' && edit.pendingGroupId) {
        await ctx.answerCallbackQuery();
        if ((await completeMove(ctx, p, edit.pendingGroupId, defaultOptionLabel(p))) === 'gone') return productGone(ctx);
        await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ به گروه اضافه شد.' });
        return;
      }

      if (data === 'cprod_edit_terms_all' && p.group_id != null) {
        edit.field = 'terms';
        edit.termsAll = true;
        await ctx.answerCallbackQuery();
        const group = await ctx.app.db.getProductGroup(p.group_id);
        await ctx.reply(
          FIELD_PROMPTS.terms + '\n\nاین شرایط برای همه‌ی گزینه‌های «' + (group?.name ?? '') + '» ذخیره می‌شود.',
          Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'cprod_edit_menu')]]),
        );
        return;
      }

      const fieldMatch = data.match(/^cprod_edit_f_(name|price|terms|duration|warranty|label|grpname|grpsort|sort)$/);
      if (fieldMatch) {
        edit.field = fieldMatch[1];
        edit.termsAll = false;
        await ctx.answerCallbackQuery();
        const extra =
          edit.field === 'terms' ? [[Markup.button.callback('▫️ حذف شرایط', 'cprod_edit_clear_terms')]]
          : edit.field === 'duration' || edit.field === 'warranty' ? [[Markup.button.callback('▫️ ندارد', 'cprod_edit_clear_days')]]
          : [];
        if (edit.field === 'terms' && p.group_id != null) {
          extra.push([Markup.button.callback('📋 اعمال روی همه‌ی گزینه‌های گروه', 'cprod_edit_terms_all')]);
        }
        await ctx.reply(FIELD_PROMPTS[edit.field], Markup.inlineKeyboard([...extra, [Markup.button.callback('🔙 بازگشت', 'cprod_edit_menu')]]));
        return;
      }

      if (data === 'cprod_edit_clear_terms' && edit.field === 'terms') {
        await ctx.answerCallbackQuery();
        if (!(await applyPatch(ctx, { termsText: null, termsEntities: null }))) return productGone(ctx);
        edit.field = null;
        await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ ذخیره شد.' });
        return;
      }

      if (data === 'cprod_edit_clear_days' && (edit.field === 'duration' || edit.field === 'warranty')) {
        await ctx.answerCallbackQuery();
        const patch = edit.field === 'duration' ? { durationDays: null } : { warrantyDays: null };
        if (!(await applyPatch(ctx, patch))) return productGone(ctx);
        edit.field = null;
        await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ ذخیره شد.' + NOTE_SNAPSHOT });
        return;
      }

      if (data === 'cprod_edit_toggle_stock') {
        const makeAvailable = p.is_available === 0;
        // a hand-made ⛔️/✅ on a supplier-stocked option must stick: the next recompute leaves manual stock alone
        const patch = p.stock_mode === 'auto' ? { isAvailable: makeAvailable, stockMode: 'manual' as const } : { isAvailable: makeAvailable };
        if (!(await applyPatch(ctx, patch))) {
          await ctx.answerCallbackQuery();
          return productGone(ctx);
        }
        await ctx.answerCallbackQuery(makeAvailable ? '✅ موجود شد.' : '⛔️ ناموجود شد.');
        const fresh = (await loadProduct(ctx))!;
        let extra: any[][] = [];
        if (makeAvailable) {
          const n = await ctx.app.db.countWaitlist(p.id);
          if (n > 0) {
            extra = [[
              Markup.button.callback('📣 به ' + n + ' نفر در لیست انتظار خبر بده', 'cprod_edit_notify_wait'),
              Markup.button.callback('بعداً', 'cprod_edit_menu'),
            ]];
          }
        }
        await showCard(ctx, fresh, { edit: true, extra });
        return;
      }

      if (data === 'cprod_edit_fixp_no') {
        edit.pendingFixedPrice = null;
        edit.field = null;
        await ctx.answerCallbackQuery();
        await showCard(ctx, p, { edit: true, prefix: '❌ قیمت تغییر نکرد.' });
        return;
      }

      if (data === 'cprod_edit_fixp_yes') {
        const price = edit.pendingFixedPrice;
        await ctx.answerCallbackQuery();
        if (typeof price !== 'number' || !(price > 0)) {
          await ctx.reply('⚠️ ابتدا قیمت جدید را وارد کنید.');
          return;
        }
        // «ثابت» keeps the typed price: the sync no longer recomputes it
        if (!(await applyPatch(ctx, { price, pricingMode: 'manual' }))) return productGone(ctx);
        edit.pendingFixedPrice = null;
        edit.field = null;
        const fresh = (await loadProduct(ctx))!;
        await showCard(ctx, fresh, { edit: true, prefix: '✅ ذخیره شد؛ قیمت این گزینه ثابت شد.' + NOTE_SNAPSHOT + (await priceWarnings(ctx, fresh)) });
        return;
      }

      if (data === 'cprod_edit_stock_auto') {
        if (!(await applyPatch(ctx, { stockMode: 'auto' }))) {
          await ctx.answerCallbackQuery();
          return productGone(ctx);
        }
        await recomputeOption(ctx.app, p.id);
        await ctx.answerCallbackQuery('📦 موجودی خودکار شد.');
        await showCard(ctx, (await loadProduct(ctx))!, { edit: true });
        return;
      }

      if (data === 'cprod_edit_notify_wait') {
        await ctx.answerCallbackQuery();
        if (p.is_available === 0) {
          await ctx.reply('⚠️ محصول هنوز ناموجود است.');
          return;
        }
        const n = await ctx.app.db.countWaitlist(p.id);
        if (n === 0) {
          await ctx.reply('ℹ️ لیست انتظار خالی است.');
          return;
        }
        const buttonText = ('🛍 خرید «' + p.name + '»').slice(0, 60);
        await ctx.app.db.enqueueBroadcast({
          adminChatId: ctx.chat!.id,
          text: '✅ خبر خوب! «' + p.name + '» دوباره موجود شد.\n\nبرای خرید روی دکمه زیر بزنید:',
          entities: null,
          audience: 'waitlist:' + p.id,
          replyMarkup: { inline_keyboard: [[{ text: buttonText, callback_data: 'cust_prod_' + p.id }]] },
        });
        await ctx.editMessageText('⏳ در حال خبر دادن به لیست انتظار «' + p.name + '»...').catch(() => {});
        await processBroadcastBatch(ctx.app, { reserve: 8 });
        return;
      }

      await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
      return;
    }

    // ── text input ────────────────────────────────────────────────────────
    if (!edit.productId) {
      await ctx.reply('⚠️ لطفاً یک محصول را از لیست بالا انتخاب کنید.');
      return;
    }
    const text = ctx.message?.text;
    if (!text || !edit.field) {
      await ctx.reply('⚠️ ابتدا یکی از دکمه‌های ویرایش را بزنید.');
      return;
    }

    const field: string = edit.field;
    const p = await loadProduct(ctx);
    if (!p) return productGone(ctx);

    // ── group fields (SUPPLIER_PLAN.md §3.2) ───────────────────────────────
    if (field === 'label' || field === 'grpname' || field === 'grpnew' || field === 'grpsort' || field === 'sort') {
      const value = text.trim();
      if (field === 'label' && (value.length < 1 || value.length > 40)) return ctx.reply('⚠️ عنوان گزینه باید بین ۱ تا ۴۰ کاراکتر باشد.');
      if ((field === 'grpname' || field === 'grpnew') && (value.length < 1 || value.length > 60)) {
        return ctx.reply('⚠️ نام گروه باید بین ۱ تا ۶۰ کاراکتر باشد.');
      }
      const order = field === 'sort' || field === 'grpsort' ? parseSortOrder(text) : null;
      if ((field === 'sort' || field === 'grpsort') && order === null) {
        return ctx.reply('⚠️ لطفاً یک عدد صحیح از ۰ تا ۹۹۹ وارد کنید.');
      }

      if (field === 'grpnew') {
        const groupId = await ctx.app.db.createGroup(value);
        edit.field = null;
        const r = await attachToGroup(ctx, p, groupId);
        if (r === 'moved') await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ به گروه اضافه شد.' });
        return;
      }
      if (field === 'label' && edit.pendingGroupId) {
        if ((await completeMove(ctx, p, edit.pendingGroupId, value)) === 'gone') return productGone(ctx);
        await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ به گروه اضافه شد.' });
        return;
      }
      if (p.group_id == null) return ctx.reply('⚠️ این گزینه در هیچ گروهی نیست.');

      let changed = false;
      if (field === 'label') changed = (await ctx.app.db.setOptionLabel(p.id, p.group_id, value)).changes === 1;
      else if (field === 'grpname') { await ctx.app.db.renameGroup(p.group_id, value); changed = true; }
      else if (field === 'grpsort') { await ctx.app.db.setGroupSortOrder(p.group_id, order!); changed = true; }
      else changed = (await ctx.app.db.setOptionSortOrder(p.id, order!)).changes === 1;
      if (!changed) return productGone(ctx);
      edit.field = null;
      await showCard(ctx, (await loadProduct(ctx))!, { prefix: '✅ ذخیره شد.' });
      return;
    }

    let patch: Parameters<typeof applyPatch>[1];
    let note = '';
    if (field === 'name') {
      const name = text.trim();
      const err = productNameError(name);
      if (err) {
        await ctx.reply(err);
        return;
      }
      patch = { name };
    } else if (field === 'price') {
      const price = parsePrice(text);
      if (isNaN(price)) {
        await ctx.reply('❌ عدد وارد‌شده معتبر نیست.\n\nلطفاً یک عدد مثبت بدون حروف وارد کنید:');
        return;
      }
      if (p.pricing_mode === 'auto') {
        // the next recompute would silently overwrite a typed price: ask whether to make it fixed
        edit.pendingFixedPrice = price;
        await ctx.reply(
          'این گزینه قیمت خودکار دارد. قیمت ثابت شود؟',
          Markup.inlineKeyboard([[
            Markup.button.callback('✅ بله، قیمت ثابت', 'cprod_edit_fixp_yes'),
            Markup.button.callback('❌ انصراف', 'cprod_edit_fixp_no'),
          ]]),
        );
        return;
      }
      patch = { price };
      note = NOTE_SNAPSHOT;
    } else if (field === 'terms') {
      if (!text.trim()) {
        await ctx.reply('⚠️ لطفاً متن شرایط را تایپ کنید یا دکمه «حذف شرایط» را بزنید.');
        return;
      }
      // Not trimmed — entity offsets are computed against the exact original text.
      patch = { termsText: text, termsEntities: ctx.message?.entities || null };
    } else {
      const days = parseDays(text);
      if (isNaN(days)) {
        await ctx.reply('⚠️ لطفاً تعداد روز را به صورت یک عدد صحیح مثبت وارد کنید.');
        return;
      }
      patch = field === 'duration' ? { durationDays: days } : { warrantyDays: days };
      note = NOTE_SNAPSHOT;
    }

    if (field === 'terms' && edit.termsAll && p.group_id != null) {
      await ctx.app.db.setGroupTerms(p.group_id, patch.termsText ?? null, patch.termsEntities ?? null);
      edit.termsAll = false;
    } else if (!(await applyPatch(ctx, patch))) {
      return productGone(ctx);
    }
    edit.field = null;
    const fresh = (await loadProduct(ctx))!;
    const warn = field === 'price' ? await priceWarnings(ctx, fresh) : '';
    await showCard(ctx, fresh, { prefix: '✅ ذخیره شد.' + note + warn });
  },
);

const CANCEL_REPLY = '❌ *عملیات لغو شد.*\n\nبرای بازگشت به پنل /panel را بزنید.';

customerProductsEditWizard.command('cancel', async (ctx) => {
  await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
  return ctx.scene.leave();
});

customerProductsEditWizard.hears(/^(لغو|انصراف|cancel|exit|خروج)$/i, async (ctx) => {
  await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
  return ctx.scene.leave();
});
