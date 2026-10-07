import { Bot, session } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { MonshiApp } from '../apps';
import { D1SessionStorage } from '../lib/session';
import { logBotError } from '../store/bot';
import * as admin from './handlers/admin';
import * as bridge from './handlers/bridge';
import { onBusinessConnection, onBusinessMessage } from './handlers/business';
import { onNotifyStart, onWizardCancel } from './handlers/common';
import * as faqAdmin from './handlers/faqAdmin';
import * as orderAdmin from './handlers/orderAdmin';
import type { MonshiCtx, MonshiSession } from './types';

/**
 * Coordinates the owner's plain text messages between the button menu and the hours / FAQ / order / settings
 * wizards. Menu buttons always win: if a menu button is pressed mid-wizard, that button runs instead of its text being wizard input.
 */
async function onAdminFreeText(ctx: MonshiCtx): Promise<void> {
  if (await admin.dispatchMenuButton(ctx)) return;
  const s = ctx.session;
  if (s.faq_wizard || s.faq_edit) {
    if (await faqAdmin.onFaqFreeText(ctx)) return;
  }
  if (s.order_wizard) {
    if (await orderAdmin.onOrderFreeText(ctx)) return;
  }
  if (s.settings_edit) {
    if (await admin.onSettingsEditText(ctx)) return;
  }
  if (s.awaiting_cooldown) {
    if (await admin.onCooldownCustomText(ctx)) return;
  }
  if (s.awaiting_hours_day) {
    await admin.onHoursCustomText(ctx);
  }
}

export function createMonshiBot(app: MonshiApp, botInfo: UserFromGetMe): Bot<MonshiCtx> {
  const bot = new Bot<MonshiCtx>(app.cfg.token, { botInfo });
  (bot as any).api = app.api; // shared, budget-counted Api
  const { adminId, notifyIds } = app.cfg;

  bot.catch(logBotError);

  bot.use(async (ctx, next) => {
    ctx.app = app;
    await next();
  });

  // Session only in the admin's private chat (business messages and customers never touch D1 for it).
  bot.use(session<MonshiSession, MonshiCtx>({
    initial: () => ({}),
    storage: new D1SessionStorage<MonshiSession>(app.raw),
    getSessionKey: (ctx) =>
      ctx.chat?.type === 'private' && ctx.from && ctx.chat.id === ctx.from.id && ctx.from.id === adminId
        ? String(ctx.from.id)
        : undefined,
  }));

  // Business messages (customer chats on the owner's account)
  bot.on('business_connection', onBusinessConnection);
  bot.on('business_message', onBusinessMessage);

  // Admin commands: owner only, only in the direct chat with the bot
  const owner = bot.filter((ctx) => ctx.chat?.type === 'private' && ctx.from?.id === adminId);
  const commands: [string, (ctx: MonshiCtx) => Promise<unknown>][] = [
    ['start', admin.cmdStart],
    ['help', admin.cmdHelp],
    ['menu', admin.cmdMenu],
    ['status', admin.cmdStatus],
    ['pause', admin.cmdPause],
    ['resume', admin.cmdResume],
    ['settings', admin.cmdSettings],
    ['hours', admin.cmdHours],
    ['set_message', admin.cmdSetMessage],
    ['set_greeting', admin.cmdSetGreeting],
    ['resume_chat', admin.cmdResumeChat],
    ['customer', admin.cmdCustomer],
    ['set_cooldown', admin.cmdSetCooldown],
    ['unanswered', admin.cmdUnanswered],
    ['stats', admin.cmdStats],
    ['digest', admin.cmdDigest],
    ['faq_list', faqAdmin.cmdFaqList],
    ['faq_add', faqAdmin.cmdFaqAdd],
    ['faq_edit', faqAdmin.cmdFaqEdit],
    ['faq_disable', faqAdmin.cmdFaqDisable],
    ['faq_enable', faqAdmin.cmdFaqEnable],
    ['cancel', faqAdmin.cmdCancel],
    ['order_add', orderAdmin.cmdOrderAdd],
    ['orders', orderAdmin.cmdOrders],
    ['gemini_status', admin.cmdGeminiStatus],
    ['gemini_toggle', admin.cmdGeminiToggle],
    ['set_threshold', admin.cmdSetThreshold],
  ];
  for (const [name, handler] of commands) owner.command(name, async (ctx) => { await handler(ctx); });

  // Notify-only accounts: just /start so Telegram lets the bot message them — no admin commands
  if (notifyIds.length) {
    bot.filter((ctx) => ctx.chat?.type === 'private' && ctx.from !== undefined && notifyIds.includes(ctx.from.id))
      .command('start', onNotifyStart);
  }

  // Inline buttons (each handler is admin-guarded except the delivery button which checks itself)
  bot.callbackQuery(/^(hday|hset|hcustom|hback|hdone)/, admin.onHoursCallback);
  bot.callbackQuery(/^(fq_|utofaq:)/, faqAdmin.onFaqCallback);
  bot.callbackQuery(/^ord_/, orderAdmin.onOrderCallback);
  // «✅ تحویل شد» under the preparing message in the customer chat (the admin check is inside the handler)
  bot.callbackQuery(/^orddlv:/, bridge.onDeliveryCallback);
  bot.callbackQuery(/^(hub_|resume_chat:|pause_chat:)/, admin.onHubCallback);
  bot.callbackQuery(/^st_/, admin.onSettingsCallback);
  bot.callbackQuery(/^wiz_cancel$/, onWizardCancel);

  // Plain owner text while waiting for typed input (custom hours / FAQ text / …)
  owner.on('message:text', async (ctx, next) => {
    if (ctx.message.entities?.some((e) => e.type === 'bot_command' && e.offset === 0)) return next();
    await onAdminFreeText(ctx);
  });

  return bot;
}
