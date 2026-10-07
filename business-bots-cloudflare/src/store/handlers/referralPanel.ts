import type { Bot } from 'grammy';
import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { formatJalaliDate, tehranDateTimeString } from '../../lib/time';
import { REFERRAL_LABEL } from '../labels';
import { getReferralConfig, referralConfigProblem, setReferralConfig, type ReferralConfig } from '../referralConfig';
import { discountLabel, getOrCreateRefCode, rulesText } from '../referrals';
import { adminProductLabel, formatPrice, productPickerKeyboard } from '../utils';
import type { StoreContext } from '../types';

const fa = (n: number) => n.toLocaleString('fa-IR');
const BACK_BTN = Markup.button.callback('🔙 بازگشت', 'ref_adm_back');

// ─── Customer side ───────────────────────────────────────────────────────────

async function showCustomerView(ctx: StoreContext): Promise<void> {
  const app = ctx.app;
  const cfg = await getReferralConfig(app);
  if (!cfg.enabled) {
    await ctx.reply('🎁 برنامه دعوت دوستان فعلاً فعال نیست.');
    return;
  }
  const me = ctx.from!;
  await app.db.upsertCustomer({ telegramId: me.id, displayName: me.first_name || me.username || String(me.id) });
  const code = await getOrCreateRefCode(app, me.id);
  if (!code) {
    await ctx.reply('❌ ساخت لینک دعوت ممکن نشد. لطفاً دوباره تلاش کنید.');
    return;
  }
  const link = 'https://t.me/' + ctx.me.username + '?start=ref_' + code;
  const ov = await app.db.getReferralOverview(me.id);

  const lines = [
    '🎁 دعوت دوستان', '',
    await rulesText(app, cfg), '',
    '🔗 لینک دعوت شما:', link, '',
    '📊 وضعیت شما:',
    '👥 دعوت‌شده: ' + fa(ov.invited) + ' نفر',
    '✅ دعوت موفق (خرید تأییدشده): ' + fa(ov.qualified) + ' نفر',
  ];
  if (!cfg.repeatable && ov.rewarded > 0) lines.push('🏁 جایزه‌ی شما گرفته شده است.');
  else lines.push('🎯 تا جایزه‌ی بعدی: ' + fa(Math.max(0, cfg.required - ov.unrewarded)) + ' دعوت موفق دیگر');

  if (ov.rewards.length) {
    lines.push('', '🏆 جایزه‌های شما:');
    const now = tehranDateTimeString(app.apps.now());
    for (const r of ov.rewards) {
      if (r.reward_type === 'product') {
        lines.push('• «' + (r.product_name ?? '—') + '» رایگان — سفارش #' + r.order_id);
      } else {
        const state = (r.used ?? 0) > 0 ? 'استفاده شده' : r.expires_at && r.expires_at < now ? 'منقضی شده' : 'معتبر تا ' + formatJalaliDate(r.expires_at ?? '');
        lines.push('• کد ' + r.code + ' — ' + discountLabel(r.discount_type ?? 'percent', r.discount_value ?? 0) + ' تخفیف «' + (r.product_name ?? '—') + '» — ' + state);
      }
    }
  }

  const shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('با این لینک وارد فروشگاه شو 👇');
  await ctx.reply(lines.join('\n'), Markup.inlineKeyboard([[Markup.button.url('📤 ارسال لینک برای دوستان', shareUrl)]]));
}

// ─── Admin panel ─────────────────────────────────────────────────────────────

async function panelView(app: StoreApp, cfg: ReferralConfig) {
  const stats = await app.db.getReferralAdminStats();
  const productName = async (id: number | null) => (id ? (await app.db.getCustomerProductById(id))?.name : undefined) ?? '—';
  const reward = cfg.reward === 'product'
    ? 'محصول رایگان «' + (await productName(cfg.productId)) + '»'
    : 'کد تخفیف ' + discountLabel(cfg.discType, cfg.discValue) + ' برای «' + (await productName(cfg.discProductId)) + '» با اعتبار ' + fa(cfg.discValidDays) + ' روز';

  const lines = [
    '🎁 برنامه دعوت دوستان — ' + (cfg.enabled ? '✅ فعال' : '🚫 خاموش'), '',
    '🎯 تعداد دعوت موفق برای هر جایزه: ' + fa(cfg.required),
    '💵 حداقل مبلغ خرید دوست: ' + (cfg.minAmount > 0 ? formatPrice(cfg.minAmount) + ' تومان' : 'بدون حداقل'),
    '🏆 نوع جایزه: ' + reward,
    '🔁 تکرار جایزه: ' + (cfg.repeatable ? 'بله، هر ' + fa(cfg.required) + ' دعوت' : 'فقط یک بار'), '',
    '📊 آمار کل:',
    '👥 دعوت‌شده: ' + fa(stats.invited) + ' · ✅ موفق: ' + fa(stats.qualified) + ' · 🎁 جایزه صادرشده: ' + fa(stats.rewards),
  ];
  if (stats.top.length) {
    lines.push('🥇 برترین معرف‌ها:');
    stats.top.forEach((r, i) => lines.push(fa(i + 1) + '. ' + (r.display_name || r.referrer_telegram_id) + ' — ' + fa(r.n) + ' دعوت موفق'));
  }
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback(cfg.enabled ? '🚫 خاموش کن' : '✅ روشن کن', 'ref_adm_toggle')],
    [Markup.button.callback('🎯 تعداد دعوت', 'ref_adm_req'), Markup.button.callback('💵 حداقل خرید', 'ref_adm_min')],
    [Markup.button.callback('🏆 نوع جایزه', 'ref_adm_type')],
    [Markup.button.callback('🔁 تکرار جایزه: ' + (cfg.repeatable ? 'روشن' : 'خاموش'), 'ref_adm_repeat')],
    [Markup.button.callback('🔙 بستن', 'ref_adm_close')],
  ]);
  return { text: lines.join('\n'), kb };
}

const presetRows = (prefix: string, values: [string, number][], customCb: string) => {
  const row: InlineButton[] = values.map(([label, v]) => Markup.button.callback(label, prefix + v));
  return Markup.inlineKeyboard([row, [Markup.button.callback('✏️ دلخواه', customCb)], [BACK_BTN]]);
};

const INPUT_PROMPTS: Record<string, string> = {
  required: '🎯 تعداد دعوت موفق لازم برای هر جایزه را وارد کنید (۱ تا ۵۰):',
  minAmount: '💵 حداقل مبلغ خرید دوست را به تومان وارد کنید (۰ = بدون حداقل):',
  discValue: '٪ مقدار تخفیف را وارد کنید (درصد: ۱ تا ۱۰۰، مبلغ ثابت: به تومان):',
  discValidDays: '⏳ مدت اعتبار کد تخفیف را به روز وارد کنید (۱ تا ۳۶۵):',
};

function parseWhole(text: string): number {
  const ascii = text.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30)).replace(/[\s,،٬]/g, '');
  return /^\d{1,12}$/.test(ascii) ? parseInt(ascii, 10) : NaN;
}

/** null = fine, otherwise the Persian complaint. Mutates cfg on success. */
function applyInput(cfg: ReferralConfig, key: string, n: number): string | null {
  if (Number.isNaN(n)) return '⚠️ عدد معتبر وارد کنید.';
  if (key === 'required') {
    if (n < 1 || n > 50) return '⚠️ عدد معتبر وارد کنید (۱ تا ۵۰).';
    cfg.required = n;
  } else if (key === 'minAmount') {
    cfg.minAmount = n;
  } else if (key === 'discValue') {
    if (cfg.discType === 'percent' ? n < 1 || n > 100 : n < 1) return '⚠️ عدد معتبر وارد کنید.' + (cfg.discType === 'percent' ? ' (درصد: ۱ تا ۱۰۰)' : '');
    cfg.discValue = n;
  } else if (key === 'discValidDays') {
    if (n < 1 || n > 365) return '⚠️ عدد معتبر وارد کنید (۱ تا ۳۶۵).';
    cfg.discValidDays = n;
  } else {
    return '⚠️ عدد معتبر وارد کنید.';
  }
  return null;
}

async function productPicker(ctx: StoreContext, prefix: 'dprod' | 'pprod', page: number, title: string, edit = true) {
  const products = await ctx.app.db.getAllActiveCustomerProducts();
  if (!products.length) {
    await ctx.reply('⚠️ هیچ محصول فعالی وجود ندارد.');
    return;
  }
  const kb = productPickerKeyboard(products, page, 'ref_adm_' + prefix + '_', 'ref_adm_' + prefix + 'page_', BACK_BTN, adminProductLabel);
  if (edit) await ctx.editMessageText(title, kb).catch(() => {});
  else await ctx.reply(title, kb);
}

async function renderPanel(ctx: StoreContext, cfg: ReferralConfig, edit: boolean) {
  const { text, kb } = await panelView(ctx.app, cfg);
  if (edit) await ctx.editMessageText(text, kb).catch(() => {});
  else await ctx.reply(text, kb);
}

async function save(ctx: StoreContext, cfg: ReferralConfig) {
  await setReferralConfig(ctx.app, cfg);
}

async function onAdminCallback(ctx: StoreContext) {
  const rest = ctx.match![1] as string;
  const app = ctx.app;
  const cfg = await getReferralConfig(app);
  const ans = (text?: string) => ctx.answerCallbackQuery(text).catch(() => {});
  let m: RegExpMatchArray | null;

  if (rest === 'close') {
    await ans();
    await ctx.editMessageText('🎁 بسته شد.').catch(() => {});
    return;
  }
  if (rest === 'back') {
    await ans();
    await renderPanel(ctx, cfg, true);
    return;
  }
  if (rest === 'toggle') {
    if (!cfg.enabled) {
      const problem = referralConfigProblem(cfg, await app.db.getAllActiveCustomerProducts());
      if (problem) {
        await ctx.answerCallbackQuery({ text: problem, show_alert: true });
        return;
      }
    }
    cfg.enabled = !cfg.enabled;
    await save(ctx, cfg);
    await ans(cfg.enabled ? '✅ روشن شد' : '🚫 خاموش شد');
    await renderPanel(ctx, cfg, true);
    return;
  }
  if (rest === 'repeat') {
    cfg.repeatable = !cfg.repeatable;
    await save(ctx, cfg);
    await ans();
    await renderPanel(ctx, cfg, true);
    return;
  }

  // ── numeric settings (presets + custom) ──────────────────────────────────
  if (rest === 'req') {
    await ans();
    await ctx.editMessageText('🎯 تعداد دعوت موفق برای هر جایزه:', presetRows('ref_adm_req_', [['۱', 1], ['۲', 2], ['۳', 3], ['۵', 5], ['۱۰', 10]], 'ref_adm_req_custom')).catch(() => {});
    return;
  }
  if (rest === 'min') {
    await ans();
    await ctx.editMessageText('💵 حداقل مبلغ خرید دوست:', presetRows('ref_adm_min_', [['بدون حداقل', 0], ['۱۰۰٬۰۰۰', 100000], ['۲۰۰٬۰۰۰', 200000], ['۵۰۰٬۰۰۰', 500000]], 'ref_adm_min_custom')).catch(() => {});
    return;
  }
  const customKey: Record<string, string> = { req_custom: 'required', min_custom: 'minAmount', dv_custom: 'discValue', dd_custom: 'discValidDays' };
  if (customKey[rest]) {
    await ans();
    ctx.session.awaitingReferralInput = customKey[rest] as any;
    await ctx.reply(INPUT_PROMPTS[customKey[rest]]);
    return;
  }
  if ((m = rest.match(/^req_(\d+)$/))) {
    cfg.required = parseInt(m[1], 10);
    await save(ctx, cfg);
    await ans();
    await renderPanel(ctx, cfg, true);
    return;
  }
  if ((m = rest.match(/^min_(\d+)$/))) {
    cfg.minAmount = parseInt(m[1], 10);
    await save(ctx, cfg);
    await ans();
    await renderPanel(ctx, cfg, true);
    return;
  }

  // ── reward type ──────────────────────────────────────────────────────────
  if (rest === 'type') {
    await ans();
    await ctx.editMessageText('🏆 نوع جایزه چیست؟', Markup.inlineKeyboard([
      [Markup.button.callback('🎟 کد تخفیف', 'ref_adm_type_discount'), Markup.button.callback('🎁 محصول رایگان', 'ref_adm_type_product')],
      [BACK_BTN],
    ])).catch(() => {});
    return;
  }
  if (rest === 'type_discount' || rest === 'type_product') {
    cfg.reward = rest === 'type_discount' ? 'discount' : 'product';
    // a half-finished reward must never be live: it is switched on again by hand once the flow is complete
    if (cfg.enabled && referralConfigProblem(cfg, await app.db.getAllActiveCustomerProducts())) cfg.enabled = false;
    await save(ctx, cfg);
    await ans();
    if (cfg.reward === 'product') {
      await productPicker(ctx, 'pprod', 0, '🎁 کدام محصول به‌عنوان جایزه داده شود؟');
    } else {
      await ctx.editMessageText('🎟 نوع تخفیف:', Markup.inlineKeyboard([
        [Markup.button.callback('٪ درصدی', 'ref_adm_dt_percent'), Markup.button.callback('💵 مبلغ ثابت', 'ref_adm_dt_fixed')],
        [BACK_BTN],
      ])).catch(() => {});
    }
    return;
  }
  if (rest === 'dt_percent' || rest === 'dt_fixed') {
    cfg.discType = rest === 'dt_percent' ? 'percent' : 'fixed';
    // the old value may be out of range for the new type
    cfg.discValue = cfg.discType === 'percent' ? Math.min(Math.max(1, Math.round(cfg.discValue)), 100) : cfg.discValue;
    await save(ctx, cfg);
    await ans();
    if (cfg.discType === 'percent') {
      await ctx.editMessageText('٪ درصد تخفیف:', presetRows('ref_adm_dv_', [['۱۰', 10], ['۱۵', 15], ['۲۰', 20], ['۳۰', 30], ['۵۰', 50]], 'ref_adm_dv_custom')).catch(() => {});
    } else {
      ctx.session.awaitingReferralInput = 'discValue';
      await ctx.reply(INPUT_PROMPTS.discValue);
    }
    return;
  }
  if ((m = rest.match(/^dv_(\d+)$/))) {
    cfg.discValue = parseInt(m[1], 10);
    await save(ctx, cfg);
    await ans();
    await productPicker(ctx, 'dprod', 0, '🛍 کد تخفیف برای کدام محصول صادر شود؟');
    return;
  }
  if ((m = rest.match(/^dprodpage_(\d+)$/)) || (m = rest.match(/^pprodpage_(\d+)$/))) {
    await ans();
    await productPicker(ctx, rest.startsWith('dprod') ? 'dprod' : 'pprod', parseInt(m[1], 10), rest.startsWith('dprod') ? '🛍 کد تخفیف برای کدام محصول صادر شود؟' : '🎁 کدام محصول به‌عنوان جایزه داده شود؟');
    return;
  }
  if ((m = rest.match(/^(dprod|pprod)_(\d+)$/))) {
    const product = await app.db.getCustomerProductById(parseInt(m[2], 10));
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
      return;
    }
    if (m[1] === 'dprod') cfg.discProductId = product.id;
    else cfg.productId = product.id;
    await save(ctx, cfg);
    await ans();
    if (m[1] === 'dprod') {
      await ctx.editMessageText('⏳ مدت اعتبار کد تخفیف (روز):', presetRows('ref_adm_dd_', [['۷', 7], ['۱۴', 14], ['۳۰', 30], ['۶۰', 60], ['۹۰', 90]], 'ref_adm_dd_custom')).catch(() => {});
    } else {
      await renderPanel(ctx, cfg, true);
    }
    return;
  }
  if ((m = rest.match(/^dd_(\d+)$/))) {
    cfg.discValidDays = parseInt(m[1], 10);
    await save(ctx, cfg);
    await ans();
    await renderPanel(ctx, cfg, true);
    return;
  }

  await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
}

const INPUT_TTL_NOTE = 'awaitingReferralInput';

export function registerReferralHandler(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  // one label for both roles: admins manage the program, customers see their invite link
  bot.hears(REFERRAL_LABEL, async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      ctx.session.awaitingReferralInput = null;
      await renderPanel(ctx, await getReferralConfig(ctx.app), false);
      return;
    }
    await showCustomerView(ctx);
  });

  bot.callbackQuery(/^ref_adm_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    await onAdminCallback(ctx);
  });

  // typed number for a «✏️ دلخواه» setting
  bot.on('message:text', async (ctx, next) => {
    const key = ctx.session?.[INPUT_TTL_NOTE];
    if (!key || !isAdmin(ctx.from?.id)) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
      ctx.session[INPUT_TTL_NOTE] = null;
      return next();
    }
    const cfg = await getReferralConfig(ctx.app);
    const problem = applyInput(cfg, key, parseWhole(text));
    if (problem) {
      await ctx.reply(problem);
      return;
    }
    ctx.session[INPUT_TTL_NOTE] = null;
    await save(ctx, cfg);
    if (key === 'discValue') await productPicker(ctx, 'dprod', 0, '🛍 کد تخفیف برای کدام محصول صادر شود؟', false);
    else await renderPanel(ctx, cfg, false);
  });
}
