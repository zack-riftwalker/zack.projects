/**
 * Eitaa auto-replies (EITAA_MENU_PLAN.md §2.3): menu, price list, product details and «خرید» for a customer message.
 * Only short keyword messages are answered; everything else stays with the owner. Reads the store, never writes to it.
 */
import type { MessageEntity } from 'grammy/types';
import type { MonshiApp } from '../../apps';
import * as rules from '../services/rules';
import { utcIsoNow } from '../../lib/time';
import { EITAA_BCID } from './client';
import {
  buildMenu, buildPrices, buildProductReply, DEFAULT_GREETING, loadEitaaProducts, matchMessage, type Built, type EitaaProduct,
} from './menu';
import { sendEitaaText } from './poll';

export const MAX_AUTO_REPLIES_PER_HOUR = 5;
const HOUR_MS = 3600 * 1000;

/** What one poll needs to answer customers; null = the feature is off (switch, global automation, or no store). */
export interface AutoState { products: EitaaProduct[]; greeting: string }

export async function loadAutoState(app: MonshiApp): Promise<AutoState | null> {
  if ((await app.ctx.getSetting('eitaa_auto_enabled')) !== '1') return null;
  if (!(await rules.isAutomationEnabled(app))) return null;
  const products = await loadEitaaProducts(app);
  if (!products) return null;
  return { products, greeting: (await app.ctx.getSetting('eitaa_menu_greeting')) || DEFAULT_GREETING };
}

interface Planned { key: string; label: string; built: Built; cooldownHours?: number }

const plain = (text: string): Built => ({ text, entities: [] as MessageEntity[] });
const cleanName = (n: string) => n.replace(/^[‏‎]+/, '');

/**
 * Sends whatever the customer's message calls for. Returns the reason line for the owner's notification, or null when
 * the usual «پیام جدید» applies. Never throws: a failure is logged and the notification still goes out.
 */
export async function autoReply(
  app: MonshiApp, state: AutoState | null,
  msg: { chatId: number; text: string | null; type: string; isNew: boolean; customer: Parameters<typeof rules.isChatPaused>[0] },
): Promise<string | null> {
  let reason: string | null = null;
  try {
    if (!state || msg.type !== 'text' || !msg.text) return null;
    if (rules.isChatPaused(msg.customer, app.apps.now()) || rules.isSensitive(msg.text, msg.type)) return null;

    const m = matchMessage(msg.text, state.products);
    const plan: Planned[] = [];
    const menu = (): Planned => ({ key: 'eitaa_menu', label: 'منو', built: buildMenu(state.greeting, state.products) });
    // every chat gets the menu with its first message, then again only after 24 h of quiet (owner's request)
    plan.push({ ...menu(), key: 'eitaa_menu_auto', cooldownHours: 24 });
    if (m?.kind === 'menu') plan.push(menu());
    else if (m?.kind === 'prices') plan.push({ key: 'eitaa_prices', label: 'قیمت‌ها', built: buildPrices(state.products) });
    else if (m?.kind === 'product') plan.push({ key: 'eitaa_p_' + m.product.id, label: cleanName(m.product.name), built: buildProductReply(m.product) });
    else if (m?.kind === 'buy') {
      const name = cleanName(m.product.name);
      reason = '🛒 خرید از ایتا: ' + name;
      plan.push({
        key: 'eitaa_buy_' + m.product.id, label: name,
        built: plain(m.product.is_available === 0
          ? '⛔️ «' + name + '» فعلاً ناموجود است؛ به‌زودی پیام می‌دهم.'
          : '✅ درخواست خرید «' + name + '» ثبت شد؛ به‌زودی پیام می‌دهم.'),
      });
    }
    if (!plan.length) return reason;

    // at most 5 auto-replies per chat per rolling hour
    const since = utcIsoNow(new Date(app.apps.now().getTime() - HOUR_MS));
    let room = MAX_AUTO_REPLIES_PER_HOUR - (await app.db.countOutSince(msg.chatId, since));
    const sent: string[] = [];
    for (const item of plan) {
      if (room <= 0) break;
      if (item.key === 'eitaa_menu' && sent.includes('منو')) continue; // the 24 h menu just went out
      const claim = await rules.claimAutoReply(app, msg.chatId, item.key, item.cooldownHours);
      if (!claim) continue; // the same reply went out within the cooldown
      let id: number;
      try {
        id = await sendEitaaText(app, msg.chatId, item.built.text, item.built.entities);
      } catch (err: any) {
        console.error('❌ [Eitaa] auto-reply ' + item.key + ' failed:', err?.message ?? err);
        await claim.release();
        break;
      }
      room--;
      sent.push(item.label);
      try {
        await app.db.saveMessage(msg.chatId, id, 'out', 'text', item.built.text, EITAA_BCID);
      } catch (err: any) {
        console.warn('Could not store the Eitaa auto-reply', err?.message ?? err);
      }
    }
    return reason ?? (sent.length ? '🤖 جواب خودکار رفت: ' + sent.join('، ') : null);
  } catch (err: any) {
    console.error('❌ [Eitaa] auto-reply failed:', err?.message ?? err);
    return reason;
  }
}
