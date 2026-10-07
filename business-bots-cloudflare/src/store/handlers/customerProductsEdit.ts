import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { processBroadcastBatch } from '../broadcast';
import { adminProductLabel, formatPrice, parsePrice, productPickerKeyboard } from '../utils';
import { parseDays, productNameError } from './customerProducts';
import type { CustomerProduct } from '../db';
import type { StoreContext } from '../types';

const CANCEL_BTN = Markup.button.callback('❌ انصراف', 'cprod_edit_cancel');

const FIELD_PROMPTS: Record<string, string> = {
  name: '✏️ نام جدید محصول را وارد کنید:',
  price: '💰 قیمت جدید را به تومان وارد کنید:\n\nمثال: 1200000',
  terms: '📜 متن جدید شرایط و قوانین را وارد کنید:',
  duration: '⏱ مدت اشتراک را به روز وارد کنید (مثال: 30):',
  warranty: '🛡 مدت گارانتی را به روز وارد کنید (مثال: 7):',
};

const pickerKb = (products: CustomerProduct[], page: number) =>
  productPickerKeyboard(products, page, 'cprod_edit_select_', 'cprod_edit_page_', CANCEL_BTN, adminProductLabel);

export function productCardText(p: CustomerProduct): string {
  return (
    '✏️ ویرایش محصول\n\n' +
    '📦 نام: ' + p.name + '\n' +
    '💰 قیمت: ' + formatPrice(p.price) + ' تومان\n' +
    '📜 شرایط: ' + (p.terms_text ? 'دارد' : 'ندارد') + '\n' +
    '⏱ مدت اشتراک: ' + (p.duration_days ? p.duration_days + ' روز' : 'ندارد') + '\n' +
    '🛡 گارانتی: ' + (p.warranty_days ? p.warranty_days + ' روز' : 'ندارد') + '\n' +
    '📦 وضعیت: ' + (p.is_available === 0 ? '⛔️ ناموجود' : '✅ موجود') + '\n\n' +
    'کدام مورد را می‌خواهید تغییر دهید؟'
  );
}

function cardKb(p: CustomerProduct, extra: ReturnType<typeof Markup.button.callback>[][] = []) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ نام', 'cprod_edit_f_name'), Markup.button.callback('💰 قیمت', 'cprod_edit_f_price')],
    [Markup.button.callback('📜 شرایط', 'cprod_edit_f_terms')],
    [Markup.button.callback('⏱ مدت اشتراک', 'cprod_edit_f_duration'), Markup.button.callback('🛡 گارانتی', 'cprod_edit_f_warranty')],
    [Markup.button.callback(p.is_available === 0 ? '✅ موجود کن' : '⛔️ ناموجود کن', 'cprod_edit_toggle_stock')],
    ...extra,
    [Markup.button.callback('✅ پایان', 'cprod_edit_done')],
  ]);
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
  const kb = cardKb(p, opts.extra);
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
  const codes = await ctx.app.db.getFixedCodesAtLeast(p.id, p.price);
  return codes
    .map((c) => '\n⚠️ کد تخفیف ' + c.code + ' (مبلغ ثابت ' + formatPrice(c.discount_value) +
      ' تومان) از قیمت جدید بیشتر یا برابر است و محصول را رایگان می‌کند. آن را ویرایش یا غیرفعال کنید.')
    .join('');
}

const NOTE_SNAPSHOT = '\nℹ️ سفارش‌های قبلی تغییری نمی‌کنند.';

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
        await ctx.answerCallbackQuery();
        await showCard(ctx, p, { edit: true });
        return;
      }

      const fieldMatch = data.match(/^cprod_edit_f_(name|price|terms|duration|warranty)$/);
      if (fieldMatch) {
        edit.field = fieldMatch[1];
        await ctx.answerCallbackQuery();
        const extra =
          edit.field === 'terms' ? [[Markup.button.callback('▫️ حذف شرایط', 'cprod_edit_clear_terms')]]
          : edit.field === 'duration' || edit.field === 'warranty' ? [[Markup.button.callback('▫️ ندارد', 'cprod_edit_clear_days')]]
          : [];
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
        if (!(await applyPatch(ctx, { isAvailable: makeAvailable }))) {
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

    if (!(await applyPatch(ctx, patch))) return productGone(ctx);
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
