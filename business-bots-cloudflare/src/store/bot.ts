import { Bot, GrammyError, session, type BotError } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { StoreApp } from '../apps';
import { D1SessionStorage } from '../lib/session';
import { Stage } from '../lib/wizard';
import { isAdminId } from './config';
import { registerAdminPanelHandler, adminPanelKeyboard } from './handlers/adminPanel';
import { announceWizard } from './handlers/announceWizard';
import { customerProductsWizard, customerProductsDeactivateWizard } from './handlers/customerProducts';
import { registerStorefrontHandler, customerStorefrontKeyboard } from './handlers/storefront';
import {
  discountCodeAddWizard, discountCodeEditWizard, discountCodeRenewWizard, registerDiscountCodeHandler,
} from './handlers/discountCodes';
import { storeSettingsWizard } from './handlers/storeSettings';
import { manualPurchaseWizard, handleManualPurchaseStart } from './handlers/manualPurchases';
import { registerBridgeHandler } from './bridgeHandlers';
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

  const stage = new Stage<StoreContext>([
    announceWizard, customerProductsWizard, customerProductsDeactivateWizard,
    discountCodeAddWizard, discountCodeEditWizard, discountCodeRenewWizard,
    storeSettingsWizard,
    manualPurchaseWizard,
  ], {
    // receipt decisions / manual delivery must work even while the admin is half-way through a wizard
    bypass: (ctx) => /^order_(confirm|reject|deliver)_\d+$/.test(ctx.callbackQuery?.data ?? ''),
    // /start and /panel leave the wizard instead of becoming its input (e.g. a product named "/start")
    exit: (ctx) => /^\/(start|panel)(@\w+)?(\s|$)/.test(ctx.message?.text ?? ''),
  });
  bot.use(stage.middleware());

  // /start — admins go straight into the panel, everyone else into the storefront.
  bot.command('start', async (ctx) => {
    try {
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

      await ctx.app.db.upsertCustomer({
        telegramId: ctx.from!.id,
        displayName: ctx.from!.first_name || ctx.from!.username || String(ctx.from!.id),
      });

      if (await handleManualPurchaseStart(ctx, payload)) return;

      await ctx.reply(
        '👋 *سلام!*\n\n' +
        'به ربات فروشگاه خوش آمدید. 🎓\n\n' +
        'برای مشاهده محصولات و خرید، دکمه زیر را بزنید:',
        { parse_mode: 'Markdown', ...customerStorefrontKeyboard() },
      );
    } catch (err: any) {
      console.error('❌ [Bot] /start handler error:', err.message);
    }
  });

  bot.command('panel', async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      await ctx.reply('🎛 پنل مدیریت:', adminPanelKeyboard());
      return;
    }
    await ctx.reply('🛍 فروشگاه:', customerStorefrontKeyboard());
  });

  registerAdminPanelHandler(bot, isAdmin);
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
