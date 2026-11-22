import { Markup, type InlineButton } from '../../lib/markup';
import { formatJalaliDateTime } from '../../lib/time';
import { escapeHtml } from '../utils';
import { getSupplier } from '../suppliers/store';
import { KIND_FA, addLedger, ledgerHistory, usd, walletBalance } from '../suppliers/wallet';
import { beginSupplierInput } from '../supplierInput';
import type { StoreContext } from '../types';

const html = { parse_mode: 'HTML' as const };
const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const CANCEL_INPUT = Markup.button.callback('❌ انصراف', 'sup_cancel_input');

const normalize = (s: string) => s.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30))
  .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30)).replace(/[٫]/g, '.').replace(/[−–]/g, '-').replace(/[\s,،٬]/g, '');

/** A dollar amount (up to 6 decimals); `signed` allows a leading «-». null when it is not a number. */
function parseUsd(text: string, signed: boolean): number | null {
  const t = normalize(text);
  if (!(signed ? /^-?\d{1,7}(\.\d{1,6})?$/ : /^\d{1,7}(\.\d{1,6})?$/).test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

async function historyView(ctx: StoreContext, sid: number): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null> {
  const s = await getSupplier(ctx.app, sid);
  if (!s) return null;
  const [rows, balance] = await Promise.all([ledgerHistory(ctx.app, sid, 10), walletBalance(ctx.app, sid)]);
  const lines = [
    '🧾 <b>تاریخچه‌ی کیف پول «' + escapeHtml(s.name) + '»</b>',
    '💳 موجودی تخمینی: ' + usd(balance) + ' (بر اساس شارژهایی که ثبت کرده‌اید)',
    '',
    ...(rows.length ? rows.map((r) => KIND_FA[r.kind] + ' ' + usd(r.amount_usd) + ' — ' + formatJalaliDateTime(r.created_at) + (r.note ? ' — ' + escapeHtml(r.note.slice(0, 40)) : '')) : ['هنوز تراکنشی ثبت نشده است.']),
  ];
  return {
    text: lines.join('\n'),
    keyboard: Markup.inlineKeyboard([[cb('➕ بازگشت وجه', 'sup_walr_' + sid), cb('± اصلاح', 'sup_wala_' + sid)], [cb('🔙', 'sup_s_' + sid)]]),
  };
}

/** `sup_topup_<id>`, `sup_wal_<id>`, `sup_walr_<id>`, `sup_wala_<id>`. true = handled. */
export async function handleWalletCallback(ctx: StoreContext, data: string): Promise<boolean> {
  const m = data.match(/^sup_(topup|wal|walr|wala)_(\d+)$/);
  if (!m) return false;
  const sid = parseInt(m[2], 10);
  if (!(await getSupplier(ctx.app, sid))) {
    await ctx.answerCallbackQuery({ text: '❌ تأمین‌کننده یافت نشد.', show_alert: true });
    return true;
  }
  if (m[1] === 'wal') {
    const v = (await historyView(ctx, sid))!;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(v.text, { ...html, ...v.keyboard }).catch(() => {});
    return true;
  }
  const prompt = {
    topup: ['sup_topup', '💳 مبلغ شارژ را به دلار بنویسید (مثلاً 50):'],
    walr: ['wal_refund', '↩️ مبلغ بازگشت وجه را به دلار بنویسید (عدد مثبت):'],
    wala: ['wal_adjust', '± مبلغ اصلاح را به دلار بنویسید (برای کم کردن، با - شروع کنید):'],
  }[m[1] as 'topup' | 'walr' | 'wala']!;
  await beginSupplierInput(ctx, prompt[0] as 'sup_topup', String(sid));
  await ctx.answerCallbackQuery();
  await ctx.reply(prompt[1], Markup.inlineKeyboard([[CANCEL_INPUT]]));
  return true;
}

/** The typed amount of the three wallet prompts. true = the kind belongs here. */
export async function handleWalletText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  if (kind !== 'sup_topup' && kind !== 'wal_refund' && kind !== 'wal_adjust') return false;
  const sid = parseInt(ref, 10);
  const amount = parseUsd(text, kind === 'wal_adjust');
  const bad = amount === null || amount === 0 || (kind !== 'wal_adjust' && amount <= 0) || (kind !== 'wal_adjust' && amount > 100_000) || Math.abs(amount ?? 0) > 100_000;
  if (bad) {
    await ctx.reply(kind === 'wal_adjust' ? '❌ یک عدد غیرصفر (حداکثر ۱۰۰٬۰۰۰ دلار) بنویسید:' : '❌ یک عدد مثبت (حداکثر ۱۰۰٬۰۰۰ دلار) بنویسید:');
    return true;
  }
  ctx.session.awaitingSupplierInput = null;
  if (!(await getSupplier(ctx.app, sid))) {
    await ctx.reply('❌ تأمین‌کننده یافت نشد.');
    return true;
  }
  const noteFa = { sup_topup: 'شارژ', wal_refund: 'بازگشت وجه', wal_adjust: 'اصلاح' }[kind];
  await addLedger(ctx.app, { supplierId: sid, kind: kind === 'sup_topup' ? 'topup' : kind === 'wal_refund' ? 'refund' : 'adjust', amountUsd: amount!, actor: ctx.from!.id, note: noteFa });
  const v = (await historyView(ctx, sid))!;
  await ctx.reply('✅ ثبت شد.\n\n' + v.text, { ...html, ...v.keyboard });
  return true;
}
