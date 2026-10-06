/** FAQ store management from inside Telegram — add, edit, enable/disable. */
import { Markup } from '../../lib/markup';
import type { FaqRow } from '../db';
import { hasSpecificKeyword } from '../services/faq';
import type { MonshiCtx } from '../types';
import { adminGuard, cancelButton, clearWizardStates, commandArgs, safeEdit } from './common';

const MAX_LIST_ITEMS = 20;

// Warning when every keyword is generic (price/cost/…): such an FAQ never matches by keyword
// and is answered only via Gemini or the exact question text
const ALL_GENERIC_WARNING =
  '\n\n⚠️ همه کلیدواژه‌ها عمومی‌اند (مثل «قیمت»، «هزینه»). این FAQ از مسیر ' +
  'کلیدواژه‌ای تطبیق نمی‌خورد؛ یک کلیدواژه اختصاصی محصول (مثل «جمینای») اضافه کن.';

function keywordsWarning(keywords: string): string {
  if (keywords.trim() && !hasSpecificKeyword(keywords)) return ALL_GENERIC_WARNING;
  return '';
}

function faqSummary(f: FaqRow): string {
  const status = f.enabled ? '✅' : '🚫';
  const q = f.question.length <= 60 ? f.question : f.question.slice(0, 57) + '...';
  return `${status} #${f.id} — ${q} (پرسیده‌شده: ${f.hit_count})`;
}

function faqDetailKeyboard(faqId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ ویرایش سوال', `fq_edit:${faqId}:question`)],
    [Markup.button.callback('✏️ ویرایش جواب', `fq_edit:${faqId}:answer`)],
    [Markup.button.callback('🏷 ویرایش کلیدواژه‌ها', `fq_edit:${faqId}:keywords`)],
    [Markup.button.callback('🔁 فعال/غیرفعال', `fq_toggle:${faqId}`)],
    [Markup.button.callback('🔙 بازگشت به لیست', 'fq_list')],
  ]);
}

function faqDetailText(f: FaqRow): string {
  const status = f.enabled ? 'فعال ✅' : 'غیرفعال 🚫';
  return (
    `📋 FAQ شماره ${f.id} (${status})\n\n` +
    `❓ سوال: ${f.question}\n\n` +
    `💬 جواب: ${f.answer}\n\n` +
    `🏷 کلیدواژه‌ها: ${f.keywords || '—'}\n` +
    `📊 تعداد استفاده: ${f.hit_count}`
  );
}

/** Text + keyboard of the FAQ list (always with the add button on top). */
async function faqListView(ctx: MonshiCtx) {
  const rows = (await ctx.app.db.getAllFaqs()).slice(0, MAX_LIST_ITEMS);
  const buttons = [[Markup.button.callback('➕ افزودن FAQ', 'fq_add')]];
  let text: string;
  if (!rows.length) {
    text = '📋 هنوز هیچ FAQ‌ای ثبت نشده.';
  } else {
    for (const r of rows) buttons.push([Markup.button.callback(`#${r.id} ${r.question.slice(0, 40)}`, `fq_view:${r.id}`)]);
    text = '📋 لیست FAQها:\n\n' + rows.map(faqSummary).join('\n');
    text += '\n\nبرای مشاهده/ویرایش هرکدام روی دکمه‌اش بزن.';
  }
  return { text, markup: Markup.inlineKeyboard(buttons) };
}

export async function cmdFaqList(ctx: MonshiCtx): Promise<void> {
  const { text, markup } = await faqListView(ctx);
  await ctx.reply(text, markup);
}

const startFaqAddWizard = (ctx: MonshiCtx) => {
  ctx.session.faq_wizard = { step: 'question', data: {} };
};

const ADD_PROMPT = '➕ افزودن FAQ جدید\n\n۱) سوال اصلی (canonical) را بفرست:';

export async function cmdFaqAdd(ctx: MonshiCtx): Promise<void> {
  startFaqAddWizard(ctx);
  await ctx.reply(ADD_PROMPT, cancelButton());
}

export async function cmdFaqEdit(ctx: MonshiCtx): Promise<void> {
  const args = commandArgs(ctx);
  if (!args.length || !/^\d+$/.test(args[0])) {
    await ctx.reply('فرمت: /faq_edit <شماره> — مثال: /faq_edit 3\nبرای دیدن شماره‌ها: /faq_list');
    return;
  }
  const row = await ctx.app.db.getFaq(parseInt(args[0], 10));
  if (!row) {
    await ctx.reply('❌ FAQ‌ای با این شماره پیدا نشد.');
    return;
  }
  await ctx.reply(faqDetailText(row), faqDetailKeyboard(row.id));
}

async function cmdFaqSetEnabled(ctx: MonshiCtx, enabled: boolean, cmdName: string): Promise<void> {
  const args = commandArgs(ctx);
  if (!args.length || !/^\d+$/.test(args[0])) {
    await ctx.reply(`فرمت: /${cmdName} <شماره>`);
    return;
  }
  const faqId = parseInt(args[0], 10);
  if (!(await ctx.app.db.getFaq(faqId))) {
    await ctx.reply('❌ FAQ‌ای با این شماره پیدا نشد.');
    return;
  }
  await ctx.app.db.setFaqEnabled(faqId, enabled);
  await ctx.reply(enabled ? `✅ FAQ #${faqId} فعال شد.` : `🚫 FAQ #${faqId} غیرفعال شد.`);
}

export const cmdFaqDisable = (ctx: MonshiCtx) => cmdFaqSetEnabled(ctx, false, 'faq_disable');
export const cmdFaqEnable = (ctx: MonshiCtx) => cmdFaqSetEnabled(ctx, true, 'faq_enable');

export async function cmdCancel(ctx: MonshiCtx): Promise<void> {
  const had = clearWizardStates(ctx.session);
  await ctx.reply(had ? 'لغو شد.' : 'چیزی برای لغو نبود.');
}

export const onFaqCallback = adminGuard(async (ctx) => {
  const app = ctx.app;
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery?.data ?? '';

  if (data === 'fq_list') {
    const v = await faqListView(ctx);
    return safeEdit(ctx, v.text, v.markup);
  }
  if (data === 'fq_add') {
    startFaqAddWizard(ctx);
    return safeEdit(ctx, ADD_PROMPT, cancelButton());
  }
  if (data.startsWith('fq_view:')) {
    const faqId = parseInt(data.split(':', 2)[1], 10);
    const row = await app.db.getFaq(faqId);
    if (!row) return safeEdit(ctx, '❌ این FAQ دیگر وجود ندارد.');
    return safeEdit(ctx, faqDetailText(row), faqDetailKeyboard(faqId));
  }
  if (data.startsWith('fq_toggle:')) {
    const faqId = parseInt(data.split(':', 2)[1], 10);
    const row = await app.db.getFaq(faqId);
    if (!row) return safeEdit(ctx, '❌ این FAQ دیگر وجود ندارد.');
    await app.db.setFaqEnabled(faqId, !row.enabled);
    const fresh = (await app.db.getFaq(faqId))!;
    return safeEdit(ctx, faqDetailText(fresh), faqDetailKeyboard(faqId));
  }
  if (data.startsWith('fq_edit:')) {
    const [, faqId, field] = data.split(':');
    ctx.session.faq_edit = { id: parseInt(faqId, 10), field };
    const fieldFa = ({ question: 'سوال', answer: 'جواب', keywords: 'کلیدواژه‌ها' } as Record<string, string>)[field];
    return safeEdit(ctx, `✏️ متن جدید برای «${fieldFa}» را بفرست:`, cancelButton());
  }
  if (data.startsWith('utofaq:')) {
    const uid = parseInt(data.split(':', 2)[1], 10);
    const row = await app.db.getUnansweredById(uid);
    if (!row) return safeEdit(ctx, '❌ این مورد دیگر موجود نیست.');
    ctx.session.faq_wizard = { step: 'answer', data: { question: row.text, _unanswered_id: uid } };
    return safeEdit(ctx, `➕ تبدیل به FAQ:\n❓ ${row.text}\n\nحالا متن جوابی که باید فرستاده شود را بنویس:`, cancelButton());
  }
});

/** Text messages belonging to the FAQ add/edit wizard; false when the message is unrelated. */
export async function onFaqFreeText(ctx: MonshiCtx): Promise<boolean> {
  const app = ctx.app;
  const text = (ctx.message?.text ?? '').trim();

  const editState = ctx.session.faq_edit;
  if (editState) {
    const { id: faqId, field } = editState;
    if (!(await app.db.getFaq(faqId))) {
      delete ctx.session.faq_edit;
      await ctx.reply('❌ این FAQ دیگر وجود ندارد.');
      return true;
    }
    const value = field === 'keywords' && text === '-' ? '' : text;
    await app.db.updateFaqField(faqId, field, value);
    app.ctx.invalidateFaqs();
    delete ctx.session.faq_edit;
    const row = (await app.db.getFaq(faqId))!;
    const warning = field === 'keywords' ? keywordsWarning(value) : '';
    await ctx.reply('✅ به‌روزرسانی شد.' + warning + '\n\n' + faqDetailText(row), faqDetailKeyboard(faqId));
    return true;
  }

  const wizard = ctx.session.faq_wizard;
  if (wizard) {
    const { step, data } = wizard;
    if (step === 'question') {
      data.question = text;
      wizard.step = 'answer';
      await ctx.reply('۲) حالا متن جوابی که باید فرستاده شود را بنویس:', cancelButton());
      return true;
    }
    if (step === 'answer') {
      data.answer = text;
      wizard.step = 'keywords';
      await ctx.reply(
        '۳) کلیدواژه‌های تشخیص این سوال را با ویرگول جدا بنویس.\n' +
        'مثال: قیمت, هزینه, چند تومن\n' +
        '(اگر می‌خوای فقط با خود متن سوال تشخیص داده بشه، بنویس: -)',
        cancelButton(),
      );
      return true;
    }
    if (step === 'keywords') {
      const keywords = text === '-' ? '' : text;
      const faqId = await app.db.addFaq(data.question, data.answer, keywords);
      app.ctx.invalidateFaqs();
      if (data._unanswered_id) await app.db.resolveUnanswered(data._unanswered_id);
      delete ctx.session.faq_wizard;
      await ctx.reply(
        `✅ FAQ #${faqId} ذخیره شد و فعال است.${keywordsWarning(keywords)}\n\n` +
        `❓ ${data.question}\n💬 ${data.answer}\n🏷 ${keywords || '—'}`,
      );
      return true;
    }
  }
  return false;
}
