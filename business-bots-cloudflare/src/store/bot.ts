import { Bot, GrammyError, session, type BotError } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { StoreApp } from '../apps';
import { D1SessionStorage } from '../lib/session';
import { Stage } from '../lib/wizard';
import { isAdminId } from './config';
import { registerAdminPanelHandler, adminPanelKeyboard } from './handlers/adminPanel';
import { announceWizard } from './handlers/announceWizard';
import { customerProductsWizard, customerProductsDeactivateWizard } from './handlers/customerProducts';
import { customerProductsEditWizard } from './handlers/customerProductsEdit';
import { registerStorefrontHandler, customerKeyboard } from './handlers/storefront';
import { registerSalesReportHandler } from './handlers/salesReport';
import {
  discountCodeAddWizard, discountCodeEditWizard, discountCodeRenewWizard, registerDiscountCodeHandler,
} from './handlers/discountCodes';
import { storeSettingsWizard } from './handlers/storeSettings';
import { manualPurchaseWizard, handleManualPurchaseStart } from './handlers/manualPurchases';
import { registerBridgeHandler } from './bridgeHandlers';
import { registerReferralHandler } from './handlers/referralPanel';
import { registerSupplierPanel, supplierTextMiddleware } from './handlers/supplierPanel';
import { registerFulfillmentAdmin } from './handlers/fulfillmentAdmin';
import { registerStockAdmin } from './handlers/stockAdmin';
import { registerAccountView } from './handlers/accountView';
import { STAGE_BYPASS_RE } from './supplierInput';
import { REF_PAYLOAD_RE, handleRefStart } from './referrals';
import type { StoreContext, StoreSession } from './types';

export function logBotError(err: BotError<any>): void {
  const e = err.error;
  const code = e instanceof GrammyError ? e.error_code : undefined;
  const updateType = Object.keys(err.ctx?.update ?? {}).find((k) => k !== 'update_id') ?? 'unknown';
  if (code === 403) {
    console.warn('⚠️  [Bot] 403 Forbidden (bot blocked) for update "' + updateType + '" from ID:', err.ctx?.from?.id ?? 'N/A');
    return;
  }
  if (code === 429) {
    const retryAfter = (e as GrammyError).parameters?.retry_after ?? '?';
    console.warn('⚠️  [Bot] 429 Too Many Requests — retry after', retryAfter, 'seconds.');
    return;
  }
  console.error('❌ [Bot] Unhandled error for update type "' + updateType + '":', (e as Error)?.message ?? e);
}

export function createStoreBot(app: StoreApp, botInfo: UserFromGetMe): Bot<StoreContext> {
  const bot = new Bot<StoreContext>(app.cfg.token, { botInfo });
  // Use the shared, budget-counted Api (also what tests inject).
  (bot as any).api = app.api;
  const isAdmin = (id: number | undefined) => isAdminId(app.cfg, id);

  bot.catch(logBotError);

  bot.use(async (ctx, next) => {
    ctx.app = app;
    await next();
  });

  // Private chats only (sessions are keyed per private chat).
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;
    await next();
  });

  bot.use(session<StoreSession, StoreContext>({
    initial: () => ({}),
    storage: new D1SessionStorage<StoreSession>(app.raw),
    getSessionKey: (ctx) => (ctx.from && ctx.chat ? `${ctx.from.id}:${ctx.chat.id}` : undefined),
  }));

  // supplier prompts take their typed answer before any wizard can (SUPPLIER_PLAN.md §9.1)
  bot.use(supplierTextMiddleware(isAdmin));

  const stage = new Stage<StoreContext>([
    announceWizard, customerProductsWizard, customerProductsDeactivateWizard, customerProductsEditWizard,
    discountCodeAddWizard, discountCodeEditWizard, discountCodeRenewWizard,
    storeSettingsWizard,
    manualPurchaseWizard,
  ], {
    // receipt decisions / manual delivery must work even while the admin is half-way through a wizard
    bypass: (ctx) => STAGE_BYPASS_RE.test(ctx.callbackQuery?.data ?? ''),
    // /start and /panel leave the wizard instead of becoming its input (e.g. a product named "/start")
    exit: (ctx) => /^\/(start|panel)(@\w+)?(\s|$)/.test(ctx.message?.text ?? ''),
  });
  bot.use(stage.middleware());

  // /start — admins go straight into the panel, everyone else into the storefront.
  bot.command('start', async (ctx) => {
    try {
      if (ctx.session && isAdmin(ctx.from?.id)) {
        ctx.session.awaitingSupplierInput = null;
        ctx.session.supplierWizard = null;
        ctx.session.supplierImport = null;
      }
      const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
      if (isAdmin(ctx.from?.id)) {
        if (await handleManualPurchaseStart(ctx, payload)) return;
        await ctx.reply(
          '👋 *سلام مدیر!*\n\n' +
          'به ربات فروشگاه خوش آمدید. 🎓\n\n' +
          '📌 از دکمه‌های زیر برای مدیریت استفاده کنید.',
          { parse_mode: 'Markdown', ...adminPanelKeyboard() },
        );
        return;
      }

      const upserted = await ctx.app.db.upsertCustomer({
        telegramId: ctx.from!.id,
        displayName: ctx.from!.first_name || ctx.from!.username || String(ctx.from!.id),
        username: ctx.from!.username ?? null,
      });

      // /start ref_<code>: remember who invited this (brand-new) customer; never blocks the welcome
      const refMatch = REF_PAYLOAD_RE.exec(payload);
      if (refMatch) {
        try {
          await handleRefStart(ctx.app, ctx.from!.id, refMatch[1], upserted.changes === 1);
        } catch (err: any) {
          console.error('❌ [Bot] referral attribution failed:', err.message);
        }
      }

      if (await handleManualPurchaseStart(ctx, payload)) return;

      await ctx.reply(
        '👋 *سلام!*\n\n' +
        'به ربات فروشگاه خوش آمدید. 🎓\n\n' +
        'برای مشاهده محصولات و خرید، دکمه زیر را بزنید:',
        { parse_mode: 'Markdown', ...(await customerKeyboard(ctx.app)) },
      );
    } catch (err: any) {
      console.error('❌ [Bot] /start handler error:', err.message);
    }
  });

  bot.command('panel', async (ctx) => {
    if (ctx.session && isAdmin(ctx.from?.id)) {
      ctx.session.awaitingSupplierInput = null;
      ctx.session.supplierWizard = null;
      ctx.session.supplierImport = null;
    }
    if (isAdmin(ctx.from?.id)) {
      await ctx.reply('🎛 پنل مدیریت:', adminPanelKeyboard());
      return;
    }
    await ctx.reply('🛍 فروشگاه:', await customerKeyboard(ctx.app));
  });

  registerAdminPanelHandler(bot, isAdmin);
  registerSalesReportHandler(bot, isAdmin);
  registerReferralHandler(bot, isAdmin);
  registerSupplierPanel(bot, isAdmin);
  registerFulfillmentAdmin(bot, isAdmin);
  registerStockAdmin(bot, isAdmin);
  registerAccountView(bot);
  registerDiscountCodeHandler(bot, isAdmin);
  registerBridgeHandler(bot);
  registerStorefrontHandler(bot);

  // Fallback for unmatched text from admins.
  bot.on('message:text', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply('🤖 این پیام با هیچ عملیاتی مطابقت نداشت. برای باز کردن پنل /panel را بزنید.')
      .catch((err) => console.error('❌ [Bot] Fallback reply failed:', err.message));
  });

  return bot;
}
