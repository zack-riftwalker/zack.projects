import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { normalizeKeyword } from '../../src/lib/keyword';

const kw = (t: TestEnv, id = 1) => one(t.storeDb, 'SELECT eitaa_keyword AS k FROM customer_products WHERE id = ?', id).k;
async function openCard(t: TestEnv, id = 1) {
  await t.send('store', textUpdate(ADMIN, '✏️ ویرایش محصول'));
  await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_select_' + id));
}
const ask = async (t: TestEnv) => t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_eitaa'));
const last = (t: TestEnv): string => t.tg.calls.filter((c) => ['sendMessage', 'editMessageText'].includes(c.method) && c.payload.chat_id === ADMIN.id).at(-1)!.payload.text;

describe('normalizeKeyword', () => {
  it('unifies letters, drops half-spaces, quotes and trailing punctuation', () => {
    expect(normalizeKeyword('  «جمینای»؟ ')).toBe('جمینای');
    expect(normalizeKeyword('كيمياء')).toBe('کیمیاء');
    expect(normalizeKeyword('می‌خرم  ChatGPT!')).toBe('می خرم chatgpt');
    expect(normalizeKeyword('‏جمینای')).toBe('جمینای');
  });
});

describe('eitaa keyword: admin button', () => {
  it('the card shows the button and the line; set, clear', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    await openCard(t);
    expect(last(t)).toContain('🔑 کلمه‌ی ایتا: —');
    const kb = t.tg.calls.filter((c) => c.payload?.reply_markup?.inline_keyboard && c.payload.chat_id === ADMIN.id).at(-1)!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.some((b: any) => b.callback_data === 'cprod_edit_f_eitaa' && b.text === '🔑 کلمه‌ی ایتا')).toBe(true);
    await ask(t);
    expect(last(t)).toContain('🔑 کلمه‌ای که مشتری در ایتا می‌فرستد');
    await t.send('store', textUpdate(ADMIN, ' جمینای '));
    expect(kw(t)).toBe('جمینای');
    expect(last(t)).toContain('🔑 کلمه‌ی ایتا: جمینای');
    await ask(t);
    await t.send('store', textUpdate(ADMIN, 'حذف'));
    expect(kw(t)).toBeNull();
    expect(last(t)).toContain('🔑 کلمه‌ی ایتا: —');
  });

  it('validation errors re-ask and store nothing', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    await openCard(t);
    await ask(t);
    const SHAPE = '⚠️ کلمه باید ۱ یا ۲ کلمه و حداکثر ۲۰ حرف باشد.';
    const RESERVED = '⚠️ این کلمه رزرو شده است؛ کلمه‌ی دیگری انتخاب کنید.';
    for (const [text, msg] of [
      ['آ', SHAPE], ['یک دو سه', SHAPE], ['ا'.repeat(21), SHAPE],
      ['منو', RESERVED], ['قیمت‌ها', RESERVED], ['خرید', RESERVED], ['شرایط', RESERVED], ['خرید جمینای', RESERVED], ['قیمت چت', RESERVED],
    ]) {
      await t.send('store', textUpdate(ADMIN, text));
      expect(last(t), text).toBe(msg);
    }
    expect(kw(t)).toBeNull();
  });

  it('duplicates are refused against active products only', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'Gemini' });
    seedProduct(t, { name: 'GPT' });
    q(t.storeDb, "UPDATE customer_products SET eitaa_keyword = 'جمینای' WHERE id = 1");
    await openCard(t, 2);
    await ask(t);
    await t.send('store', textUpdate(ADMIN, 'جمینای؟'));
    expect(last(t)).toBe('⚠️ محصول «Gemini» همین کلمه را دارد.');
    expect(kw(t, 2)).toBeNull();
    q(t.storeDb, 'UPDATE customer_products SET is_active = 0 WHERE id = 1');
    await t.send('store', textUpdate(ADMIN, 'جمینای'));
    expect(kw(t, 2)).toBe('جمینای');
  });

  it('re-saving the product\'s own keyword is fine', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    q(t.storeDb, "UPDATE customer_products SET eitaa_keyword = 'جمینای' WHERE id = 1");
    await openCard(t);
    await ask(t);
    await t.send('store', textUpdate(ADMIN, 'جمینای'));
    expect(kw(t)).toBe('جمینای');
  });
});
