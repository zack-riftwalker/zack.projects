import { describe, expect, it } from 'vitest';
import { toJalaali } from 'jalaali-js';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';

const press = (t: TestEnv, data: string) => t.send('store', callbackUpdate(ADMIN, data));
const say = (t: TestEnv, text: string) => t.send('store', textUpdate(ADMIN, text));
const lastAdmin = (t: TestEnv) => t.tg.texts(ADMIN.id).at(-1) ?? '';

function futureJalali(): string {
  const d = new Date(Date.now() + 365 * 86400000);
  const { jy, jm, jd } = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${jy}/${jm}/${jd} 14:30`;
}

const group = (t: TestEnv, name: string) => Number(t.storeDb.sqlite.prepare('INSERT INTO product_groups (name) VALUES (?)').run(name).lastInsertRowid);
const option = (t: TestEnv, g: number, groupName: string, label: string, o: { price?: number; cost?: number | null } = {}) => Number(t.storeDb.sqlite.prepare(
  `INSERT INTO customer_products (name, price, duration_days, warranty_days, group_id, option_label, cost_toman) VALUES (?, ?, 30, 7, ?, ?, ?)`,
).run(groupName + ' — ' + label, o.price ?? 1_000_000, g, label, o.cost ?? null).lastInsertRowid);

describe('discount wizards: a value under the supplier cost is asked again, not abandoned (SUPPLIER_PLAN.md §5.4)', () => {
  it('add: the refused value re-asks the value step; a better value then completes the code', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 1_000_000 });
    t.storeDb.sqlite.prepare('UPDATE customer_products SET cost_toman = 950000 WHERE id = ?').run(pid);
    await say(t, '🎟 کد تخفیف');
    await press(t, 'cprod_disc_add');
    await say(t, 'deep');
    await press(t, 'disc_type_fixed');
    await say(t, '200000');
    await press(t, 'disc_prod_select_' + pid);
    // refused right after the product is chosen, and the value is asked again
    const texts = t.tg.texts(ADMIN.id);
    expect(texts.at(-2)).toContain('از قیمت خرید');
    expect(texts.at(-1)).toContain('مقدار تخفیف را به *تومان* وارد کنید');
    expect(q(t.storeDb, 'SELECT 1 FROM discount_codes')).toHaveLength(0);

    await say(t, '20000');
    await press(t, 'disc_prod_select_' + pid);
    await press(t, 'disc_maxuses_unlimited');
    await say(t, futureJalali());
    expect(one(t.storeDb, 'SELECT code, discount_value FROM discount_codes')).toEqual({ code: 'DEEP', discount_value: 20000 });
    expect(lastAdmin(t)).toContain('کد تخفیف با موفقیت ثبت شد');
  });

  it('add, group scope: the check covers every option of the group and the wizard asks the value again', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = group(t, 'GPT');
    const a = option(t, g, 'GPT', '۱ ماهه', { price: 1_000_000, cost: 500_000 });
    option(t, g, 'GPT', '۳ ماهه', { price: 1_000_000, cost: 950_000 });
    await say(t, '🎟 کد تخفیف');
    await press(t, 'cprod_disc_add');
    await say(t, 'grp');
    await press(t, 'disc_type_fixed');
    await say(t, '200000');
    await press(t, 'disc_prod_select_' + a);
    await press(t, 'disc_scope_group');
    expect(t.tg.texts(ADMIN.id).at(-2)).toContain('«GPT — ۳ ماهه»');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('مقدار تخفیف');
    await say(t, '20000');
    await press(t, 'disc_prod_select_' + a);
    await press(t, 'disc_scope_group');
    await press(t, 'disc_maxuses_unlimited');
    await say(t, futureJalali());
    expect(one(t.storeDb, 'SELECT product_group_id, discount_value FROM discount_codes')).toEqual({ product_group_id: g, discount_value: 20000 });
  });

  it('edit: same behaviour', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 1_000_000 });
    t.storeDb.sqlite.prepare('UPDATE customer_products SET cost_toman = 950000 WHERE id = ?').run(pid);
    t.storeDb.sqlite.prepare("INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('OLD', ?, 'fixed', 1000, '2999-01-01 00:00:00')").run(pid);
    await press(t, 'cprod_disc_edit_1');
    await press(t, 'disc_type_fixed');
    await say(t, '200000');
    await press(t, 'disc_prod_select_' + pid);
    expect(t.tg.texts(ADMIN.id).at(-2)).toContain('از قیمت خرید');
    expect(lastAdmin(t)).toContain('مقدار تخفیف را به *تومان* وارد کنید');
    expect(one(t.storeDb, 'SELECT discount_value FROM discount_codes').discount_value).toBe(1000);

    await say(t, '20000');
    await press(t, 'disc_prod_select_' + pid);
    await press(t, 'disc_maxuses_unlimited');
    expect(one(t.storeDb, 'SELECT discount_value FROM discount_codes').discount_value).toBe(20000);
  });
});

describe('S2 wizards driven through their real steps (review: missing tests)', () => {
  it('discount scope question: only this option, or the whole group', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = group(t, 'GPT');
    const a = option(t, g, 'GPT', '۱ ماهه');
    await say(t, '🎟 کد تخفیف');
    await press(t, 'cprod_disc_add');
    await say(t, 'one');
    await press(t, 'disc_type_percent');
    await say(t, '10');
    await press(t, 'disc_prod_select_' + a);
    const ask = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(ask.text).toContain('این کد برای کدام؟');
    expect(ask.reply_markup.inline_keyboard.map((r: any[]) => r[0].text)).toEqual(['فقط «۱ ماهه»', 'همه‌ی گزینه‌های «GPT»', '❌ انصراف']);
    await press(t, 'disc_scope_one');
    await press(t, 'disc_maxuses_unlimited');
    await say(t, futureJalali());
    expect(one(t.storeDb, 'SELECT customer_product_id, product_group_id FROM discount_codes')).toEqual({ customer_product_id: a, product_group_id: null });
  });

  it('edit card → گروه: pick an existing group; an option without a label is asked for one (default offered)', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = group(t, 'GPT Plus');
    option(t, g, 'GPT Plus', '۱ ماهه');
    const pid = seedProduct(t, { name: 'Loose', duration: 90 });
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    await press(t, 'cprod_edit_grp_menu');
    const picker = t.tg.of('editMessageText').at(-1)!.payload;
    expect(picker.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain('cprod_edit_grp_' + g);
    await press(t, 'cprod_edit_grp_' + g);
    expect(lastAdmin(t)).toContain('عنوان گزینه را وارد کنید');
    await say(t, '۳ ماهه');
    expect(one(t.storeDb, 'SELECT name, group_id, option_label FROM customer_products WHERE id = ?', pid))
      .toEqual({ name: 'GPT Plus — ۳ ماهه', group_id: g, option_label: '۳ ماهه' });
  });

  it('edit card → گروه → گروه جدید: creates the group, then takes the default label', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { name: 'Loose', duration: 90 });
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + pid);
    await press(t, 'cprod_edit_grp_menu');
    await press(t, 'cprod_edit_grpnew');
    await say(t, 'Canva');
    expect(one(t.storeDb, 'SELECT name FROM product_groups').name).toBe('Canva');
    await press(t, 'cprod_edit_label_default');
    expect(one(t.storeDb, 'SELECT name, option_label FROM customer_products WHERE id = ?', pid)).toEqual({ name: 'Canva — ۹۰ روزه', option_label: '۹۰ روزه' });
  });

  it('option label, group rename and "no group" through the card', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = group(t, 'GPT');
    const a = option(t, g, 'GPT', '۱ ماهه');
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + a);
    await press(t, 'cprod_edit_f_label');
    await say(t, 'یک ماه');
    expect(one(t.storeDb, 'SELECT name, option_label FROM customer_products WHERE id = ?', a)).toEqual({ name: 'GPT — یک ماه', option_label: 'یک ماه' });
    await press(t, 'cprod_edit_f_grpname');
    await say(t, 'ChatGPT');
    expect(one(t.storeDb, 'SELECT name FROM customer_products WHERE id = ?', a).name).toBe('ChatGPT — یک ماه');
    await press(t, 'cprod_edit_grp_menu');
    await press(t, 'cprod_edit_grpnone');
    expect(one(t.storeDb, 'SELECT group_id FROM customer_products WHERE id = ?', a).group_id).toBeNull();
  });
});
