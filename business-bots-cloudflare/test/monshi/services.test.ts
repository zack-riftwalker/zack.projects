import { describe, expect, it } from 'vitest';
import { normalizeChars, normalizeDigits, normalizeText } from '../../src/monshi/normalize';
import { formatHours, isBusinessHours, isOvernight, parseFlexibleRange } from '../../src/monshi/services/hours';
import { findBestMatch, hasSpecificKeyword, isPriceQuery } from '../../src/monshi/services/faq';
import { detectMessageType, isSensitive } from '../../src/monshi/services/rules';
import { looksLikeOrderQuery, statusText, buildChecklist } from '../../src/monshi/services/orders';

describe('normalize', () => {
  it('converts Persian/Arabic digits and characters', () => {
    expect(normalizeDigits('۱۰:۰۰ و ٢٠')).toBe('10:00 و 20');
    expect(normalizeChars('كيك')).toBe('کیک');
    expect(normalizeText('  می‌خوام   ۱۲  ')).toBe('می خوام 12');
  });
});

describe('hours', () => {
  it.each([
    ['۱۰ تا ۲۲', '10:00-22:00'],
    ['9:30-23', '09:30-23:00'],
    ['10 تا 24', '10:00-23:59'],
    ['24-6', '00:00-06:00'],
    ['10:00-22:00', '10:00-22:00'],
    ['۹ الی ۱۷:۴۵', '09:00-17:45'],
  ])('parseFlexibleRange(%s)', (input, expected) => {
    expect(parseFlexibleRange(input)).toBe(expected);
  });
  it('rejects invalid ranges', () => {
    expect(parseFlexibleRange('25 تا 30')).toBeNull();
    expect(parseFlexibleRange('hello')).toBeNull();
    expect(parseFlexibleRange('10:70-12:00')).toBeNull();
  });
  it('detects overnight ranges', () => {
    expect(isOvernight('22:00-06:00')).toBe(true);
    expect(isOvernight('10:00-22:00')).toBe(false);
    expect(isOvernight('00:00-23:59')).toBe(false);
  });
  it('isBusinessHours honours day, boundaries and yesterday\'s overnight window', () => {
    const map = { sat: '10:00-22:00', sun: '22:00-06:00', mon: null } as any;
    // 2026-10-03 is a Saturday. Tehran = UTC+3:30
    const sat = (h: number, m: number) => new Date(Date.UTC(2026, 9, 3, h, m) - 3.5 * 3600_000);
    expect(isBusinessHours(map, sat(9, 59))).toBe(false);
    expect(isBusinessHours(map, sat(10, 0))).toBe(true);
    expect(isBusinessHours(map, sat(21, 59))).toBe(true);
    expect(isBusinessHours(map, sat(22, 0))).toBe(false);
    const sun = (h: number, m: number) => new Date(Date.UTC(2026, 9, 4, h, m) - 3.5 * 3600_000);
    expect(isBusinessHours(map, sun(21, 0))).toBe(false);
    expect(isBusinessHours(map, sun(23, 0))).toBe(true); // tonight's overnight window
    const mon = (h: number, m: number) => new Date(Date.UTC(2026, 9, 5, h, m) - 3.5 * 3600_000);
    expect(isBusinessHours(map, mon(3, 0))).toBe(true); // yesterday's window runs to 06:00
    expect(isBusinessHours(map, mon(6, 0))).toBe(false);
    expect(isBusinessHours(map, mon(12, 0))).toBe(false); // monday closed
  });
  it('formatHours lists the Iranian week', () => {
    const text = formatHours({ sat: '10:00-22:00', fri: null });
    expect(text.split('\n')[0]).toBe('شنبه: 10:00-22:00');
    expect(text.split('\n')[6]).toBe('جمعه: تعطیل ❌');
  });
});

describe('faq matcher', () => {
  const faq = (id: number, question: string, keywords: string) => ({ id, question, answer: 'a' + id, keywords, enabled: 1 } as any);
  it('price words alone never match; a specific keyword is required', () => {
    const faqs = [faq(1, 'قیمت جمینای', 'جمینای, قیمت'), faq(2, 'قیمت جیپیتی', 'جیپیتی, قیمت')];
    expect(findBestMatch('قیمت جیپیتی چنده', faqs)?.faq.id).toBe(2);
    expect(findBestMatch('قیمت جمینای چنده', faqs)?.faq.id).toBe(1);
    expect(findBestMatch('قیمت چنده', faqs)).toBeNull();
    expect(findBestMatch('جمینای', faqs)).toBeNull(); // 1 point < MIN_SCORE 2
  });
  it('exact question text counts extra', () => {
    expect(findBestMatch('سلام گارانتی دارید؟', [faq(1, 'گارانتی دارید؟', '')])?.faq.id).toBe(1);
  });
  it('helpers', () => {
    expect(isPriceQuery('قیمت چنده')).toBe(true);
    expect(isPriceQuery('سلام')).toBe(false);
    expect(hasSpecificKeyword('قیمت, هزینه')).toBe(false);
    expect(hasSpecificKeyword('قیمت, جمینای')).toBe(true);
  });
});

describe('rules', () => {
  it('flags sensitive text and media', () => {
    expect(isSensitive('رسید فرستادم', 'text')).toBe(true);
    expect(isSensitive('پسورد من رو بدید', 'text')).toBe(true);
    expect(isSensitive('قیمت چنده', 'text')).toBe(false);
    expect(isSensitive(null, 'photo')).toBe(true);
    expect(isSensitive(null, 'contact')).toBe(false);
  });
  it('detects message types', () => {
    expect(detectMessageType({ text: 'x' } as any)).toBe('text');
    expect(detectMessageType({ photo: [{}] } as any)).toBe('photo');
    expect(detectMessageType({ sticker: {} } as any)).toBe('sticker');
    expect(detectMessageType({} as any)).toBe('other');
  });
});

describe('orders service', () => {
  it('order query detection and status text', () => {
    expect(looksLikeOrderQuery(normalizeText('سفارشم چی شد'))).toBe(true);
    expect(looksLikeOrderQuery(normalizeText('سفارش میدم'))).toBe(false);
    expect(statusText({ title: 'T', status: 'cancelled' } as any)).toContain('لغو شده');
    expect(statusText({ title: 'T', status: 'delivered' } as any)).toBe('وضعیت سفارش «T»: تحویل ✅');
  });
  it('checklist marks done / current / pending', () => {
    const c = buildChecklist({ title: 'T', status: 'provisioning' } as any);
    expect(c.title).toBe('📦 پیگیری سفارش: T');
    expect(c.tasks.map((x) => x.text)).toEqual(['✅ ثبت سفارش', '✅ تایید پرداخت', '🔄 آماده‌سازی اکانت', '⚪ تحویل']);
    expect(c.tasks.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });
});
