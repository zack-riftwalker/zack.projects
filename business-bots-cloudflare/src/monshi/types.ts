import type { Context, SessionFlavor } from 'grammy';
import type { MonshiApp } from '../apps';

export interface MonshiSession {
  faq_wizard?: { step: 'question' | 'answer' | 'keywords'; data: Record<string, any> };
  faq_edit?: { id: number; field: string };
  order_wizard?: { step: 'customer' | 'title'; data: Record<string, any> };
  awaiting_hours_day?: string;
  settings_edit?: { key: string };
  awaiting_cooldown?: boolean;
}

/** `ctx.session` exists only in the admin's private chat — never touch it in other handlers. */
export type MonshiCtx = Context & SessionFlavor<MonshiSession> & { app: MonshiApp };

/** Keys of every wizard state that can be open in the admin session. */
export const WIZARD_STATE_KEYS = [
  'faq_wizard', 'faq_edit', 'order_wizard', 'awaiting_hours_day', 'settings_edit', 'awaiting_cooldown',
] as const;
