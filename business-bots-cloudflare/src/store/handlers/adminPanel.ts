import type { Bot } from 'grammy';
import { Markup } from '../../lib/markup';
import { MANUAL_PURCHASE_LABEL } from '../labels';
import type { StoreContext } from '../types';

const LABEL = {
  announce: '📢 اطلاعیه‌ها',
  addProduct: '➕ افزودن محصول',
  editProduct: '✏️ ویرایش محصول',
  deactProduct: '🗑 حذف محصول',
  discountCode: '🎟 کد تخفیف',
  cardSettings: '💳 شماره کارت',
  manualPurchase: MANUAL_PURCHASE_LABEL,
};

export function adminPanelKeyboard() {
  return Markup.keyboard([
    [LABEL.announce],
    [LABEL.addProduct, LABEL.editProduct],
    [LABEL.deactProduct, LABEL.discountCode],
    [LABEL.cardSettings],
    [LABEL.manualPurchase],
  ]).resize();
}

const DISCOUNT_SUBMENU_KB = Markup.inlineKeyboard([
  [Markup.button.callback('➕ افزودن کد تخفیف جدید', 'cprod_disc_add')],
  [Markup.button.callback('📋 لیست کدهای تخفیف', 'cprod_disc_list')],
  [Markup.button.callback('❌ بستن', 'cprod_disc_close')],
]);

export function registerAdminPanelHandler(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  // Any panel button abandons a half-typed input (e.g. a custom reject reason waiting for text).
  bot.hears(Object.values(LABEL), async (ctx, next) => {
    if (isAdmin(ctx.from?.id) && ctx.session) ctx.session.awaitingRejectReasonFor = null;
    return next();
  });

  bot.hears(LABEL.announce, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.scene.enter('announce-wizard');
  });

  bot.hears(LABEL.addProduct, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.scene.enter('customer-products-wizard');
  });

  bot.hears(LABEL.editProduct, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.scene.enter('customer-products-edit-wizard');
  });

  bot.hears(LABEL.deactProduct, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.scene.enter('customer-products-deactivate-wizard');
  });

  bot.hears(LABEL.discountCode, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply('🎟 *مدیریت کدهای تخفیف*', { parse_mode: 'Markdown', ...DISCOUNT_SUBMENU_KB });
  });

  bot.hears(LABEL.cardSettings, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.scene.enter('store-settings-wizard');
  });

  bot.hears(LABEL.manualPurchase, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.scene.enter('manual-purchase-wizard');
  });
}
