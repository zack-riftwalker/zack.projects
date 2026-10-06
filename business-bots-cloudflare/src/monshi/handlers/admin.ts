/** Admin commands and hubs — only in the owner's direct chat with the bot. */
import type { MonshiApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { tehranParts } from '../../lib/time';
import { normalizeChars } from '../normalize';
import { buildDigest } from '../services/digest';
import * as gemini from '../services/gemini';
import * as hours from '../services/hours';
import * as rules from '../services/rules';
import { unansweredView } from '../views';
import type { MonshiCtx } from '../types';
import { adminGuard, cancelButton, clearWizardStates, commandArgs, commandRest, safeEdit } from './common';
import * as faqAdmin from './faqAdmin';
import * as orderAdmin from './orderAdmin';

export const DAY_ALIASES: Record<string, string> = {
  sat: 'sat', 'شنبه': 'sat',
  sun: 'sun', 'یکشنبه': 'sun', 'يکشنبه': 'sun',
  mon: 'mon', 'دوشنبه': 'mon',
  tue: 'tue', 'سه‌شنبه': 'tue', 'سه شنبه': 'tue', 'سهشنبه': 'tue',
  wed: 'wed', 'چهارشنبه': 'wed',
  thu: 'thu', 'پنجشنبه': 'thu', 'پنج‌شنبه': 'thu', 'پنج شنبه': 'thu',
  fri: 'fri', 'جمعه': 'fri',
};

// Ready-made presets for quick button selection
export const HOUR_PRESETS: [string, string][] = [
  ['۰۹:۰۰ تا ۲۱:۰۰', '09:00-21:00'],
  ['۱۰:۰۰ تا ۲۲:۰۰', '10:00-22:00'],
  ['۱۱:۰۰ تا ۲۳:۰۰', '11:00-23:00'],
  ['۲۴ ساعته', '00:00-23:59'],
];

/** Splits the day name (any spelling) off the start of the text; returns the rest. */
export function splitDay(rest: string): [string | null, string] {
  const normalized = normalizeChars(rest);
  const aliases = Object.entries(DAY_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, key] of aliases) {
    if (normalized.startsWith(normalizeChars(alias))) return [key, rest.slice(alias.length).trim()];
  }
  return [null, rest];
}

export function buildDayKeyboard() {
  const rows: InlineButton[][] = [];
  let row: InlineButton[] = [];
  for (const key of hours.IRAN_WEEK_ORDER) {
    row.push(Markup.button.callback(hours.PERSIAN_DAY_NAMES[key], `hday:${key}`));
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([Markup.button.callback('✅ پایان', 'hdone')]);
  return Markup.inlineKeyboard(rows);
}

function overnightNote(value: string): string {
  if (hours.isOvernight(value)) {
    return (
      '\n\n⚠️ توجه: این بازه از نیمه‌شب رد می‌شود (شبانه تفسیر شد). ' +
      'اگر منظورتان این نبود، همین روز را دوباره تنظیم کنید.'
    );
  }
  return '';
}

export function buildPresetKeyboard(dayKey: string) {
  const rows: InlineButton[][] = HOUR_PRESETS.map(([label, value]) => [Markup.button.callback(label, `hset:${dayKey}:${value}`)]);
  rows.push([Markup.button.callback('⏸ تعطیل', `hset:${dayKey}:off`)]);
  rows.push([Markup.button.callback('✏️ ساعت دلخواه', `hcustom:${dayKey}`)]);
  rows.push([Markup.button.callback('🔙 بازگشت به لیست روزها', 'hback')]);
  return Markup.inlineKeyboard(rows);
}

// Persistent reply keyboard — replaces typing commands. Six buttons, each a hub.
export const MENU_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📊 وضعیت' }, { text: '📚 سوالات متداول' }],
      [{ text: '🛒 سفارش‌ها' }, { text: '📥 بی‌پاسخ‌ها' }],
      [{ text: '⚙️ تنظیمات' }, { text: '❔ راهنما' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  },
};

export const HELP_TEXT =
  '🤖 راهنمای ربات منشی\n\n' +
  'همه‌چیز از طریق منوی دکمه‌ای زیر جعبه پیام در دسترسه — کافیه دکمه بزنی، لازم نیست چیزی تایپ کنی:\n\n' +
  '📊 وضعیت — وضعیت کلی، توقف/فعال‌سازی، آمار، دایجست هفتگی، چت‌های متوقف\n' +
  '📚 سوالات متداول — لیست FAQها + افزودن/ویرایش/فعال‌سازی با دکمه\n' +
  '🛒 سفارش‌ها — لیست سفارش‌های باز + ثبت سفارش جدید + پیشبرد مرحله\n' +
  '📥 بی‌پاسخ‌ها — پرتکرارترین سوالات بی‌جواب با دکمه تبدیل به FAQ\n' +
  '⚙️ تنظیمات — ساعت کاری، پیام‌ها، Cooldown، Gemini، خوانده‌شدن خودکار\n' +
  '❔ راهنما — همین متن\n\n' +
  'اگه منو بسته شد: /menu\n\n' +
  '───────────\n' +
  'میان‌برهای اختیاری (برای کسی که تایپ رو ترجیح می‌ده):\n\n' +
  '/status /pause /resume /settings /hours /set_message /set_greeting\n' +
  '/resume_chat <آیدی یا @یوزرنیم> /set_cooldown <ساعت> /unanswered /stats /digest\n' +
  '/faq_list /faq_add /faq_edit <شماره> /faq_disable <شماره> /faq_enable <شماره>\n' +
  '/order_add /orders\n' +
  '/gemini_status /gemini_toggle /set_threshold faq|handoff <عدد>\n' +
  '/cancel — لغو ویزارد در حال انجام';

export async function cmdStart(ctx: MonshiCtx): Promise<void> {
  await ctx.reply(
    'سلام 👋 من منشی فروشگاه شما هستم.\n' +
    'برای فعال‌شدن، از گوشی خودتان به مسیر زیر بروید و من را وصل کنید:\n' +
    'Settings → Chat Automation\n\n' + HELP_TEXT,
    MENU_KEYBOARD,
  );
}

export async function cmdMenu(ctx: MonshiCtx): Promise<void> {
  await ctx.reply('📋 منوی دکمه‌ای:', MENU_KEYBOARD);
}

export async function cmdHelp(ctx: MonshiCtx): Promise<void> {
  await ctx.reply(HELP_TEXT);
}

const labelOf = (c: { first_name: string | null; username: string | null; chat_id: number }) =>
  c.first_name || c.username || String(c.chat_id);

/** Cancels the 4h pause earlier so the bot becomes active in that chat again. */
export async function cmdResumeChat(ctx: MonshiCtx): Promise<void> {
  const args = commandArgs(ctx);
  if (!args.length) {
    await ctx.reply(
      'فرمت: /resume_chat <آیدی چت> یا /resume_chat @یوزرنیم\n' +
      'آیدی چت‌ها را می‌توانید از /unanswered یا نوتیف‌های قبلی پیدا کنید.',
    );
    return;
  }
  const target = args[0];
  const customer = target.startsWith('@')
    ? await ctx.app.db.getCustomerByUsername(target)
    : /^-?\d+$/.test(target) ? await ctx.app.db.getCustomer(parseInt(target, 10)) : null;
  if (!customer) {
    await ctx.reply('❌ مشتری‌ای با این مشخصات پیدا نشد.');
    return;
  }
  await ctx.app.db.setChatPause(customer.chat_id, null);
  await ctx.reply(`▶️ پاسخ خودکار برای چت «${labelOf(customer)}» دوباره فعال شد.`);
}

export async function cmdSetCooldown(ctx: MonshiCtx): Promise<void> {
  const args = commandArgs(ctx);
  const current = (await ctx.app.ctx.getSetting('ack_cooldown_hours')) || '8';
  if (!args.length) {
    await ctx.reply(`⏱ Cooldown فعلی پیام «دریافت شد»: ${current} ساعت\n\nبرای تغییر: /set_cooldown <ساعت>\nمثال: /set_cooldown 1`);
    return;
  }
  const value = parseFloat(args[0]);
  if (!Number.isFinite(value) || value < 0 || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(args[0])) {
    await ctx.reply('❌ عدد نامعتبر است. مثال درست: /set_cooldown 2');
    return;
  }
  await ctx.app.ctx.setSetting('ack_cooldown_hours', String(value));
  await ctx.reply(`✅ Cooldown روی ${value} ساعت تنظیم شد.`);
}

// ── status hub ───────────────────────────────────────────────────────────
async function statusView(app: MonshiApp) {
  const enabled = await rules.isAutomationEnabled(app);
  const connected = (await app.ctx.getConnection()) !== null;
  const hoursMap = await app.ctx.getBusinessHours();
  const inHours = hours.isBusinessHours(hoursMap, app.apps.now());
  const stats = await app.db.getLightStats(app.apps.now());
  const t = tehranParts(app.apps.now());
  const now = `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
  const text =
    '📊 وضعیت ربات منشی\n\n' +
    `🔌 اتصال به حساب: ${connected ? 'وصل ✅' : 'وصل نشده ❌ (Settings → Chat Automation)'}\n` +
    `🤖 پاسخ خودکار: ${enabled ? 'روشن ✅' : 'خاموش ⏸'}\n` +
    `🕐 الان (تهران): ${now} — ${inHours ? 'داخل ساعت کاری' : 'خارج ساعت کاری'}\n` +
    `✉️ پیام‌های امروز: ${stats.today_in}\n` +
    `👥 کل مشتری‌ها: ${stats.customers}\n\n` +
    `ساعت کاری:\n${hours.formatHours(hoursMap)}`;
  const toggleLabel = enabled ? '⏸ توقف کامل پاسخ خودکار' : '▶️ فعال‌سازی پاسخ خودکار';
  const pausedCount = (await app.db.getPausedChats()).length;
  const markup = Markup.inlineKeyboard([
    [Markup.button.callback(toggleLabel, 'hub_toggle_auto')],
    [Markup.button.callback('📈 آمار کامل', 'hub_stats'), Markup.button.callback('📊 دایجست هفتگی', 'hub_digest')],
    [Markup.button.callback(`💤 چت‌های متوقف (${pausedCount})`, 'hub_paused')],
  ]);
  return { text, markup };
}

const STATS_TTL_MS = 15 * 60 * 1000;

/** Full stats scan `messages` → cached for 15 minutes (rule: cost control). */
async function fullStatsCached(app: MonshiApp) {
  const raw = await app.ctx.getState('stats_cache');
  if (raw) {
    try {
      const c = JSON.parse(raw);
      if (app.apps.now().getTime() - c.at < STATS_TTL_MS) return c.data;
    } catch { /* recompute */ }
  }
  const data = await app.db.getFullStats(app.apps.now());
  await app.ctx.setState('stats_cache', JSON.stringify({ at: app.apps.now().getTime(), data }));
  return data;
}

export async function statsText(app: MonshiApp): Promise<string> {
  const s = await fullStatsCached(app);
  const by = s.by_type;
  return (
    '📈 آمار کلی\n\n' +
    `✉️ کل پیام‌های دریافتی: ${s.total_in}\n` +
    `📅 امروز: ${s.today_in}\n` +
    `👥 مشتری‌ها: ${s.customers}\n\n` +
    'پاسخ‌دهی:\n' +
    `🤖 پیام «دریافت شد»: ${by.ack ?? 0}\n` +
    `📚 پاسخ FAQ: ${by.faq ?? 0}\n` +
    `📦 پیگیری سفارش: ${by.order_status ?? 0}\n` +
    `💰 ارجاع قیمت به ربات فروش: ${by.price_fallback ?? 0}\n` +
    `🧑 پاسخ انسانی: ${by.human ?? 0}\n` +
    `🔔 ارجاع‌شده به شما: ${by.handoff ?? 0}\n` +
    `⏳ بی‌پاسخ: ${by.none ?? 0}`
  );
}

async function pausedChatsView(app: MonshiApp) {
  const rows = await app.db.getPausedChats();
  const back = [Markup.button.callback('🔙 بازگشت به وضعیت', 'hub_back')];
  if (!rows.length) return { text: '💤 هیچ چتی الان متوقف نیست.', markup: Markup.inlineKeyboard([back]) };
  const lines = ['💤 چت‌های متوقف (بعد از پاسخ دستی شما یا دکمه توقف):\n'];
  const buttons: InlineButton[][] = [];
  for (const c of rows) {
    const name = labelOf(c);
    lines.push(`👤 ${name} — تا ${hours.formatTehran(c.automation_paused_until!)} (تهران)`);
    buttons.push([Markup.button.callback(`▶️ فعال‌سازی (${name})`, `resume_chat:${c.chat_id}`)]);
  }
  buttons.push(back);
  return { text: lines.join('\n'), markup: Markup.inlineKeyboard(buttons) };
}

const backToStatusMarkup = () => Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت به وضعیت', 'hub_back')]]);

export async function cmdStatus(ctx: MonshiCtx): Promise<void> {
  const { text, markup } = await statusView(ctx.app);
  await ctx.reply(text, markup);
}

/** Status-hub buttons + single-chat pause/resume (from the hub or a notification). */
export const onHubCallback = adminGuard(async (ctx) => {
  const app = ctx.app;
  const data = ctx.callbackQuery?.data ?? '';
  if (!data.startsWith('pause_chat:')) await ctx.answerCallbackQuery();

  if (data === 'hub_toggle_auto') {
    const currentlyOn = await rules.isAutomationEnabled(app);
    await app.ctx.setSetting('automation_enabled', currentlyOn ? '0' : '1');
    const v = await statusView(app);
    return safeEdit(ctx, v.text, v.markup);
  }
  if (data === 'hub_back') {
    const v = await statusView(app);
    return safeEdit(ctx, v.text, v.markup);
  }
  if (data === 'hub_stats') return safeEdit(ctx, await statsText(app), backToStatusMarkup());
  if (data === 'hub_digest') {
    const { text, markup } = await buildDigest(app);
    // the digest has its own keyboard (convert to FAQ); add a back button if it doesn't
    return safeEdit(ctx, text, markup ?? backToStatusMarkup());
  }
  if (data === 'hub_paused') {
    const v = await pausedChatsView(app);
    return safeEdit(ctx, v.text, v.markup);
  }
  if (data.startsWith('resume_chat:')) {
    await app.db.setChatPause(parseInt(data.split(':', 2)[1], 10), null);
    const v = await pausedChatsView(app);
    return safeEdit(ctx, v.text, v.markup);
  }
  if (data.startsWith('pause_chat:')) {
    // from the button on a handoff notification — the bot steps away from this chat for a while
    await rules.pauseChat(app, parseInt(data.split(':', 2)[1], 10));
    await ctx.answerCallbackQuery({ text: 'ربات برای این چت متوقف شد 💤' });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      console.debug('Could not clear notification buttons');
    }
  }
});

export async function cmdPause(ctx: MonshiCtx): Promise<void> {
  await ctx.app.ctx.setSetting('automation_enabled', '0');
  await ctx.reply('⏸ پاسخ خودکار برای همه چت‌ها متوقف شد. فعال‌سازی: /resume');
}

export async function cmdResume(ctx: MonshiCtx): Promise<void> {
  await ctx.app.ctx.setSetting('automation_enabled', '1');
  await ctx.reply('▶️ پاسخ خودکار دوباره فعال شد.');
}

// ── business hours ───────────────────────────────────────────────────────
async function sendHoursMenu(ctx: MonshiCtx): Promise<void> {
  await ctx.reply(
    `🕐 ساعت کاری فعلی:\n${hours.formatHours(await ctx.app.ctx.getBusinessHours())}\n\n` +
    'روزی که می‌خواهید تنظیم کنید را انتخاب کنید 👇',
    buildDayKeyboard(),
  );
}

export async function cmdHours(ctx: MonshiCtx): Promise<void> {
  const rest = commandRest(ctx);
  // no argument → easiest path: pick the day with buttons
  if (!rest) return sendHoursMenu(ctx);

  // typed mode — flexible parsing
  const [dayKey, remainder] = splitDay(rest);
  if (!dayKey) {
    await ctx.reply('❌ روز هفته را نشناختم. راحت‌تره از دکمه‌ها استفاده کنید 👇', buildDayKeyboard());
    return;
  }
  if (!remainder) {
    await ctx.reply(`⏰ ساعت کاری روز ${hours.PERSIAN_DAY_NAMES[dayKey]} را انتخاب کنید 👇`, buildPresetKeyboard(dayKey));
    return;
  }

  const current = await ctx.app.ctx.getBusinessHours();
  if (['off', 'تعطیل', 'بسته'].includes(remainder.trim().toLowerCase())) {
    current[dayKey] = null;
    await ctx.app.ctx.setBusinessHours(current);
    await ctx.reply(`✅ ذخیره شد.\n\n${hours.formatHours(current)}`);
    return;
  }

  const parsed = hours.parseFlexibleRange(remainder);
  if (!parsed) {
    await ctx.reply('❌ ساعت رو متوجه نشدم. راحت‌تره از دکمه‌ها استفاده کنید 👇', buildPresetKeyboard(dayKey));
    return;
  }
  current[dayKey] = parsed;
  await ctx.app.ctx.setBusinessHours(current);
  await ctx.reply(`✅ ذخیره شد.\n\n${hours.formatHours(current)}${overnightNote(parsed)}`);
}

export const onHoursCallback = adminGuard(async (ctx) => {
  const app = ctx.app;
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery?.data ?? '';

  if (data === 'hdone') {
    return safeEdit(ctx, `🕐 ساعت کاری نهایی:\n\n${hours.formatHours(await app.ctx.getBusinessHours())}`);
  }
  if (data === 'hback') {
    return safeEdit(
      ctx,
      `🕐 ساعت کاری فعلی:\n${hours.formatHours(await app.ctx.getBusinessHours())}\n\nروزی که می‌خواهید تنظیم کنید را انتخاب کنید 👇`,
      buildDayKeyboard(),
    );
  }
  if (data.startsWith('hday:')) {
    const dayKey = data.split(':', 2)[1];
    return safeEdit(ctx, `⏰ ساعت کاری روز ${hours.PERSIAN_DAY_NAMES[dayKey]} را انتخاب کنید 👇`, buildPresetKeyboard(dayKey));
  }
  if (data.startsWith('hset:')) {
    const [, dayKey, ...rest] = data.split(':');
    const value = rest.join(':');
    const current = await app.ctx.getBusinessHours();
    current[dayKey] = value === 'off' ? null : value;
    await app.ctx.setBusinessHours(current);
    return safeEdit(
      ctx,
      `✅ ساعت روز ${hours.PERSIAN_DAY_NAMES[dayKey]} ذخیره شد.\n\n${hours.formatHours(current)}\n\nروز دیگری هم می‌خواهید تنظیم کنید؟ 👇`,
      buildDayKeyboard(),
    );
  }
  if (data.startsWith('hcustom:')) {
    const dayKey = data.split(':', 2)[1];
    clearWizardStates(ctx.session);
    ctx.session.awaiting_hours_day = dayKey;
    return safeEdit(
      ctx,
      `✏️ ساعت دلخواه روز ${hours.PERSIAN_DAY_NAMES[dayKey]} را بفرستید.\n` +
      'مثال‌های قابل قبول: 10:00-22:00 یا ۱۰ تا ۲۲ یا 9:30-23',
      cancelButton(),
    );
  }
});

export async function onHoursCustomText(ctx: MonshiCtx): Promise<void> {
  const dayKey = ctx.session.awaiting_hours_day;
  if (!dayKey) return; // not about hours
  const text = ctx.message?.text ?? '';
  let parsed: string | null;
  if (['off', 'تعطیل', 'بسته'].includes(text.trim().toLowerCase())) {
    parsed = null;
  } else {
    parsed = hours.parseFlexibleRange(text);
    if (!parsed) {
      await ctx.reply(
        '❌ متوجه نشدم. دوباره امتحان کن، مثلاً: 10:00-22:00 یا ۱۰ تا ۲۲\n' +
        'یا برای تعطیل بنویس: تعطیل',
      );
      return;
    }
  }
  delete ctx.session.awaiting_hours_day;
  const current = await ctx.app.ctx.getBusinessHours();
  current[dayKey] = parsed;
  await ctx.app.ctx.setBusinessHours(current);
  const note = parsed ? overnightNote(parsed) : '';
  await ctx.reply(`✅ ساعت روز ${hours.PERSIAN_DAY_NAMES[dayKey]} ذخیره شد.\n\n${hours.formatHours(current)}${note}`);
}

// ── settings hub ─────────────────────────────────────────────────────────
const COOLDOWN_PRESETS: [string, string][] = [['بدون فاصله', '0'], ['۱ ساعت', '1'], ['۴ ساعت', '4'], ['۸ ساعت', '8']];
const FAQ_THRESHOLD_PRESETS = [0.7, 0.75, 0.82, 0.9];
const HANDOFF_THRESHOLD_PRESETS = [0.5, 0.6, 0.68, 0.75];

const floatsEqual = (a: unknown, b: unknown) => {
  const x = parseFloat(String(a)), y = parseFloat(String(b));
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
};

async function settingsHubView(app: MonshiApp) {
  const markReadOn = (await app.ctx.getSetting('mark_read_enabled')) === '1';
  return {
    text: '⚙️ تنظیمات ربات\n\nیکی از موارد زیر را انتخاب کنید 👇',
    markup: Markup.inlineKeyboard([
      [Markup.button.callback('🕐 ساعت کاری', 'st_hours')],
      [Markup.button.callback('✉️ پیام غیرکاری', 'st_after_hours')],
      [Markup.button.callback('👋 پیام خوش‌آمد', 'st_greeting')],
      [Markup.button.callback('⏱ فاصله «دریافت شد»', 'st_cooldown')],
      [Markup.button.callback('🧠 Gemini', 'st_gemini')],
      [Markup.button.callback(`👁 خوانده‌شدن خودکار (${markReadOn ? 'فعال ✅' : 'خاموش 🚫'})`, 'st_toggle_markread')],
    ]),
  };
}

async function afterHoursView(app: MonshiApp) {
  const current = (await app.ctx.getSetting('after_hours_message') || '').replace('{sales_bot}', (await app.ctx.getSetting('sales_bot')) || '');
  return {
    text: '✉️ پیام خارج ساعت کاری:\n\n' + current,
    markup: Markup.inlineKeyboard([
      [Markup.button.callback('✏️ ویرایش', 'st_edit:after_hours_message')],
      [Markup.button.callback('🔙 بازگشت به تنظیمات', 'st_back')],
    ]),
  };
}

async function greetingView(app: MonshiApp) {
  const enabled = (await app.ctx.getSetting('greeting_enabled')) === '1';
  const current = ((await app.ctx.getSetting('greeting_message')) || '').replace('{sales_bot}', (await app.ctx.getSetting('sales_bot')) || '');
  return {
    text: `👋 پیام خوش‌آمد مشتری جدید (${enabled ? 'فعال ✅' : 'خاموش 🚫'}):\n\n` + current,
    markup: Markup.inlineKeyboard([
      [Markup.button.callback(enabled ? '🚫 خاموش کردن' : '✅ روشن کردن', 'st_toggle_greeting')],
      [Markup.button.callback('✏️ ویرایش متن', 'st_edit:greeting_message')],
      [Markup.button.callback('🔙 بازگشت به تنظیمات', 'st_back')],
    ]),
  };
}

async function cooldownView(app: MonshiApp) {
  const current = (await app.ctx.getSetting('ack_cooldown_hours')) || '8';
  const rows: InlineButton[][] = COOLDOWN_PRESETS.map(([label, value]) => [
    Markup.button.callback(`${floatsEqual(current, value) ? '✔ ' : ''}${label}`, `st_cooldown_set:${value}`),
  ]);
  rows.push([Markup.button.callback('✏️ دلخواه', 'st_cooldown_custom')]);
  rows.push([Markup.button.callback('🔙 بازگشت به تنظیمات', 'st_back')]);
  return { text: `⏱ فاصله فعلی بین دو پیام «دریافت شد»: ${current} ساعت`, markup: Markup.inlineKeyboard(rows) };
}

async function geminiSettingsView(app: MonshiApp) {
  const hasKey = !!app.cfg.geminiKey;
  const enabled = (await app.ctx.getSetting('gemini_enabled')) === '1';
  const faqTh = (await app.ctx.getSetting('faq_threshold')) || '0.82';
  const handoffTh = (await app.ctx.getSetting('human_handoff_threshold')) || '0.68';
  const text =
    '🧠 Gemini\n\n' +
    `🔑 کلید API: ${hasKey ? 'موجود ✅' : 'موجود نیست ❌ (در تنظیمات Worker قرار دهید)'}\n` +
    `⚙️ فعال: ${hasKey && enabled ? 'بله ✅' : 'خیر 🚫'}\n` +
    `📊 آستانه پاسخ خودکار: ${faqTh}\n` +
    `📊 آستانه ارجاع به انسان: ${handoffTh}`;
  const faqRow = FAQ_THRESHOLD_PRESETS.map((v) =>
    Markup.button.callback(`${floatsEqual(faqTh, v) ? '✔ ' : ''}${v}`, `st_thresh:faq:${v}`));
  const handoffRow = HANDOFF_THRESHOLD_PRESETS.map((v) =>
    Markup.button.callback(`${floatsEqual(handoffTh, v) ? '✔ ' : ''}${v}`, `st_thresh:handoff:${v}`));
  const markup = Markup.inlineKeyboard([
    [Markup.button.callback(enabled ? '🚫 خاموش کردن Gemini' : '✅ روشن کردن Gemini', 'st_toggle_gemini')],
    [Markup.button.callback('— آستانه پاسخ خودکار —', 'st_noop')],
    faqRow,
    [Markup.button.callback('— آستانه ارجاع به انسان —', 'st_noop')],
    handoffRow,
    [Markup.button.callback('🔙 بازگشت به تنظیمات', 'st_back')],
  ]);
  return { text, markup };
}

export async function cmdSettings(ctx: MonshiCtx): Promise<void> {
  const { text, markup } = await settingsHubView(ctx.app);
  await ctx.reply(text, markup);
}

export const onSettingsCallback = adminGuard(async (ctx) => {
  const app = ctx.app;
  const data = ctx.callbackQuery?.data ?? '';
  const noKeyAlert = data === 'st_toggle_gemini' && !app.cfg.geminiKey;
  if (!noKeyAlert) await ctx.answerCallbackQuery();

  const show = async (v: { text: string; markup: { reply_markup: any } }) => safeEdit(ctx, v.text, v.markup);

  if (data === 'st_noop') return;
  if (data === 'st_back') return show(await settingsHubView(app));
  if (data === 'st_hours') {
    return safeEdit(
      ctx,
      `🕐 ساعت کاری فعلی:\n${hours.formatHours(await app.ctx.getBusinessHours())}\n\nروزی که می‌خواهید تنظیم کنید را انتخاب کنید 👇`,
      buildDayKeyboard(),
    );
  }
  if (data === 'st_after_hours') return show(await afterHoursView(app));
  if (data === 'st_greeting') return show(await greetingView(app));
  if (data === 'st_toggle_greeting') {
    const enabled = (await app.ctx.getSetting('greeting_enabled')) === '1';
    await app.ctx.setSetting('greeting_enabled', enabled ? '0' : '1');
    return show(await greetingView(app));
  }
  if (data === 'st_toggle_markread') {
    const enabled = (await app.ctx.getSetting('mark_read_enabled')) === '1';
    await app.ctx.setSetting('mark_read_enabled', enabled ? '0' : '1');
    return show(await settingsHubView(app));
  }
  if (data === 'st_gemini') return show(await geminiSettingsView(app));
  if (data === 'st_toggle_gemini') {
    if (!app.cfg.geminiKey) {
      await ctx.answerCallbackQuery({ text: 'ابتدا GEMINI_API_KEY را تنظیم کنید.', show_alert: true });
      return;
    }
    const enabled = (await app.ctx.getSetting('gemini_enabled')) === '1';
    await app.ctx.setSetting('gemini_enabled', enabled ? '0' : '1');
    return show(await geminiSettingsView(app));
  }
  if (data.startsWith('st_thresh:')) {
    const [, kind, value] = data.split(':');
    await app.ctx.setSetting(kind === 'faq' ? 'faq_threshold' : 'human_handoff_threshold', value);
    return show(await geminiSettingsView(app));
  }
  if (data === 'st_cooldown') return show(await cooldownView(app));
  if (data.startsWith('st_cooldown_set:')) {
    await app.ctx.setSetting('ack_cooldown_hours', data.split(':', 2)[1]);
    return show(await cooldownView(app));
  }
  if (data === 'st_cooldown_custom') {
    clearWizardStates(ctx.session);
    ctx.session.awaiting_cooldown = true;
    return safeEdit(ctx, '✏️ فاصله دلخواه را به ساعت بفرست (مثلاً 2 یا 0.5):', cancelButton());
  }
  if (data.startsWith('st_edit:')) {
    const key = data.split(':', 2)[1];
    clearWizardStates(ctx.session);
    ctx.session.settings_edit = { key };
    const label = key === 'after_hours_message' ? 'پیام غیرکاری' : 'پیام خوش‌آمد';
    return safeEdit(ctx, `✏️ متن جدید «${label}» را بفرست:\n(عبارت {sales_bot} خودکار جایگزین می‌شود)`, cancelButton());
  }
});

/** Saves the edited after-hours / greeting message typed from the settings hub. */
export async function onSettingsEditText(ctx: MonshiCtx): Promise<boolean> {
  const state = ctx.session.settings_edit;
  if (!state) return false;
  const text = ctx.message?.text ?? '';
  await ctx.app.ctx.setSetting(state.key, text);
  if (state.key === 'greeting_message') await ctx.app.ctx.setSetting('greeting_enabled', '1');
  delete ctx.session.settings_edit;
  const label = state.key === 'after_hours_message' ? 'پیام غیرکاری' : 'پیام خوش‌آمد';
  await ctx.reply(`✅ ${label} به‌روز شد.`);
  return true;
}

export async function onCooldownCustomText(ctx: MonshiCtx): Promise<boolean> {
  if (!ctx.session.awaiting_cooldown) return false;
  const text = (ctx.message?.text ?? '').trim();
  const value = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? parseFloat(text) : NaN;
  if (!Number.isFinite(value) || value < 0) {
    await ctx.reply('❌ عدد نامعتبر است. دوباره امتحان کن (مثلاً 2 یا 0.5):', cancelButton());
    return true;
  }
  await ctx.app.ctx.setSetting('ack_cooldown_hours', String(value));
  delete ctx.session.awaiting_cooldown;
  await ctx.reply(`✅ Cooldown روی ${value} ساعت تنظیم شد.`);
  return true;
}

export async function cmdSetMessage(ctx: MonshiCtx): Promise<void> {
  // everything after the command, newlines kept
  const newText = commandRest(ctx);
  if (!newText) {
    const current = ((await ctx.app.ctx.getSetting('after_hours_message')) || '').replace('{sales_bot}', (await ctx.app.ctx.getSetting('sales_bot')) || '');
    await ctx.reply(
      'متن فعلی پیام خارج ساعت کاری:\n\n' + current +
      '\n\nبرای تغییر، متن جدید را بعد از دستور بنویسید:\n/set_message متن جدید...\n' +
      '(عبارت {sales_bot} به‌صورت خودکار با آیدی ربات فروش جایگزین می‌شود)',
    );
    return;
  }
  await ctx.app.ctx.setSetting('after_hours_message', newText);
  await ctx.reply('✅ متن پیام خارج ساعت کاری به‌روز شد.');
}

/** Show/change the new-customer greeting; «off»/«on» toggles it. */
export async function cmdSetGreeting(ctx: MonshiCtx): Promise<void> {
  const newText = commandRest(ctx);
  if (!newText) {
    const enabled = (await ctx.app.ctx.getSetting('greeting_enabled')) === '1';
    const current = ((await ctx.app.ctx.getSetting('greeting_message')) || '').replace('{sales_bot}', (await ctx.app.ctx.getSetting('sales_bot')) || '');
    await ctx.reply(
      `👋 پیام خوش‌آمد مشتری جدید (${enabled ? 'فعال ✅' : 'خاموش 🚫'}):\n\n` + current +
      '\n\nبرای تغییر، متن جدید را بعد از دستور بنویسید:\n/set_greeting متن جدید...\n' +
      'خاموش/روشن: /set_greeting off یا /set_greeting on\n' +
      '(عبارت {sales_bot} خودکار با آیدی ربات فروش جایگزین می‌شود)',
    );
    return;
  }
  if (['off', 'خاموش'].includes(newText.toLowerCase())) {
    await ctx.app.ctx.setSetting('greeting_enabled', '0');
    await ctx.reply('🚫 پیام خوش‌آمد خاموش شد.');
    return;
  }
  if (['on', 'روشن'].includes(newText.toLowerCase())) {
    await ctx.app.ctx.setSetting('greeting_enabled', '1');
    await ctx.reply('✅ پیام خوش‌آمد روشن شد.');
    return;
  }
  await ctx.app.ctx.setSetting('greeting_message', newText);
  await ctx.app.ctx.setSetting('greeting_enabled', '1');
  await ctx.reply('✅ متن پیام خوش‌آمد به‌روز شد و فعال است.');
}

export async function cmdUnanswered(ctx: MonshiCtx): Promise<void> {
  const view = await unansweredView(ctx.app, 10);
  if (!view) {
    await ctx.reply('🎉 سوال بی‌جوابی ثبت نشده.');
    return;
  }
  await ctx.reply(view.text, view.markup);
}

export async function cmdStats(ctx: MonshiCtx): Promise<void> {
  await ctx.reply(await statsText(ctx.app));
}

/** Runs the weekly digest right now (what is sent automatically every Saturday 09:00). */
export async function cmdDigest(ctx: MonshiCtx): Promise<void> {
  const { text, markup } = await buildDigest(ctx.app);
  await ctx.reply(text, markup ?? {});
}

export async function cmdGeminiStatus(ctx: MonshiCtx): Promise<void> {
  const app = ctx.app;
  const hasKey = !!app.cfg.geminiKey;
  const enabledSetting = (await app.ctx.getSetting('gemini_enabled')) === '1';
  const activeModel = await gemini.activeGenerationModel(app);
  let modelLine = activeModel;
  if (activeModel !== gemini.GENERATION_MODEL) modelLine += ' (فال‌بک — مدل اصلی موقتاً در دسترس نیست ⚠️)';
  await ctx.reply(
    '🤖 وضعیت Gemini\n\n' +
    `🔑 کلید API: ${hasKey ? 'موجود ✅' : 'موجود نیست ❌ (در تنظیمات Worker قرار دهید)'}\n` +
    `⚙️ فعال: ${hasKey && enabledSetting ? 'بله ✅' : 'خیر 🚫'}\n` +
    `🧠 مدل فعال: ${modelLine}\n` +
    `📊 آستانه پاسخ خودکار (faq): ${await app.ctx.getSetting('faq_threshold')}\n` +
    `📊 آستانه ارجاع به انسان (handoff): ${await app.ctx.getSetting('human_handoff_threshold')}\n\n` +
    'روشن/خاموش: /gemini_toggle\n' +
    'تغییر آستانه: /set_threshold faq 0.82',
  );
}

export async function cmdGeminiToggle(ctx: MonshiCtx): Promise<void> {
  if (!ctx.app.cfg.geminiKey) {
    await ctx.reply('❌ ابتدا GEMINI_API_KEY را تنظیم کنید.');
    return;
  }
  const currentlyOn = (await ctx.app.ctx.getSetting('gemini_enabled')) === '1';
  await ctx.app.ctx.setSetting('gemini_enabled', currentlyOn ? '0' : '1');
  await ctx.reply(`Gemini اکنون ${currentlyOn ? 'خاموش 🚫' : 'روشن ✅'} است.`);
}

export async function cmdSetThreshold(ctx: MonshiCtx): Promise<void> {
  const args = commandArgs(ctx);
  if (args.length < 2 || !['faq', 'handoff'].includes(args[0])) {
    await ctx.reply('فرمت: /set_threshold faq 0.82  یا  /set_threshold handoff 0.68\n(عدد باید بین 0 و 1 باشد)');
    return;
  }
  const value = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(args[1]) ? parseFloat(args[1]) : NaN;
  if (!Number.isFinite(value) || !(value >= 0 && value <= 1)) {
    await ctx.reply('❌ عدد نامعتبر است؛ باید بین 0 و 1 باشد.');
    return;
  }
  await ctx.app.ctx.setSetting(args[0] === 'faq' ? 'faq_threshold' : 'human_handoff_threshold', String(value));
  await ctx.reply(`✅ آستانه ${args[0]} روی ${value} تنظیم شد.`);
}

/** Same as /hours without arguments — the multi-word button text would confuse the command parser. */
async function menuHours(ctx: MonshiCtx) {
  await sendHoursMenu(ctx);
}

async function menuGeminiSettings(ctx: MonshiCtx) {
  const { text, markup } = await geminiSettingsView(ctx.app);
  await ctx.reply(text, markup);
}

/**
 * If the message text is exactly one of the persistent-menu buttons (current or legacy), run it.
 * Legacy labels stay as aliases: the keyboard on the owner's phone keeps showing them until /menu is sent again.
 */
export async function dispatchMenuButton(ctx: MonshiCtx): Promise<boolean> {
  const actions: Record<string, (c: MonshiCtx) => Promise<unknown>> = {
    // current menu (6 buttons)
    '📊 وضعیت': cmdStatus,
    '📚 سوالات متداول': faqAdmin.cmdFaqList,
    '🛒 سفارش‌ها': orderAdmin.cmdOrders,
    '📥 بی‌پاسخ‌ها': cmdUnanswered,
    '⚙️ تنظیمات': cmdSettings,
    '❔ راهنما': cmdHelp,
    // legacy menu aliases
    '🕐 ساعت کاری': menuHours,
    '❓ FAQ ها': faqAdmin.cmdFaqList,
    '🧠 Gemini': menuGeminiSettings,
    '📈 آمار': cmdStats,
    '⏸ توقف خودکار': cmdPause,
    '▶️ فعال‌سازی': cmdResume,
  };
  const handler = actions[(ctx.message?.text ?? '').trim()];
  if (!handler) return false;
  await handler(ctx);
  return true;
}
