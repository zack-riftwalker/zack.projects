import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { STOREFRONT_LABEL } from '../../src/store/labels';
import { buildCatalogEntries } from '../../src/store/catalog';
import { validateDiscountCode } from '../../src/store/handlers/discountCodes';
import type { CustomerProduct, ProductGroup } from '../../src/store/db';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };

function seedGroup(t: TestEnv, name: string, sortOrder = 0): number {
  return Number(t.storeDb.sqlite.prepare('INSERT INTO product_groups (name, sort_order) VALUES (?, ?)').run(name, sortOrder).lastInsertRowid);
}

/** An option of a group; its display name is kept as «GROUP — LABEL» like the real code path. */
function seedOption(t: TestEnv, groupId: number, group: string, label: string, o: Partial<{ price: number; duration: number | null; available: number; sort: number; active: number }> = {}): number {
  const duration = o.duration === undefined ? 30 : o.duration;
  return Number(t.storeDb.sqlite.prepare(
    `INSERT INTO customer_products (name, price, duration_days, warranty_days, is_active, is_available, group_id, option_label, sort_order)
     VALUES (?, ?, ?, 7, ?, ?, ?, ?, ?)`,
  ).run(group + ' — ' + label, o.price ?? 100000, duration, o.active ?? 1, o.available ?? 1, groupId, label, o.sort ?? 0).lastInsertRowid);
}

function seedStandalone(t: TestEnv, name: string, o: Partial<{ price: number; sort: number; available: number }> = {}): number {
  return Number(t.storeDb.sqlite.prepare(
    'INSERT INTO customer_products (name, price, duration_days, warranty_days, is_available, sort_order) VALUES (?, ?, 30, 7, ?, ?)',
  ).run(name, o.price ?? 50000, o.available ?? 1, o.sort ?? 0).lastInsertRowid);
}

const product = (id: number, over: Partial<CustomerProduct>): CustomerProduct => ({
  id, name: 'P' + id, price: 1000, terms_text: null, terms_entities: null, duration_days: 30, warranty_days: 7, ...over,
});

describe('catalog entries (SUPPLIER_PLAN.md §3.1)', () => {
  it('mixes groups and standalone products, ordered by sort_order then smallest member id', () => {
    const groups: ProductGroup[] = [{ id: 1, name: 'GPT', sort_order: 5 }, { id: 2, name: 'Canva', sort_order: 0 }];
    const products = [
      product(10, { group_id: 1, option_label: '۱ ماهه', price: 300 }),
      product(11, { group_id: 1, option_label: '۳ ماهه', price: 200 }),
      product(12, { group_id: 2, option_label: '۱ ماهه', price: 900 }),
      product(3, { name: 'Standalone', price: 700, sort_order: 5 }),
      product(4, { name: 'Empty group product', group_id: null, price: 1 }),
    ];
    const entries = buildCatalogEntries(products, groups);
    expect(entries.map((e) => e.callback)).toEqual(['cust_prod_4', 'cust_grp_2', 'cust_prod_3', 'cust_grp_1']);
    expect(entries.find((e) => e.callback === 'cust_grp_1')!.label).toBe('GPT  |  از ۲۰۰ ت');
  });

  it('a group with no active option is not listed; all options unavailable → ⛔️ label', () => {
    const groups: ProductGroup[] = [{ id: 1, name: 'GPT', sort_order: 0 }, { id: 2, name: 'Old', sort_order: 0 }];
    const products = [
      product(10, { group_id: 1, is_available: 0, price: 300 }),
      product(11, { group_id: 1, is_available: 0, price: 200 }),
    ];
    const entries = buildCatalogEntries(products, groups);
    expect(entries).toEqual([{ label: '⛔️ GPT (ناموجود)', callback: 'cust_grp_1', sortOrder: 0, minId: 10 }]);
  });

  it('the minimum price counts only available options', () => {
    const products = [product(10, { group_id: 1, price: 100, is_available: 0 }), product(11, { group_id: 1, price: 250 })];
    expect(buildCatalogEntries(products, [{ id: 1, name: 'G', sort_order: 0 }])[0].label).toBe('G  |  از ۲۵۰ ت');
  });

  it('storefront paging: 9 entries → two pages, page 1 holds the last entry', async () => {
    const t = makeTestEnv({ monshi: false });
    for (let i = 0; i < 9; i++) seedStandalone(t, 'P' + i, { sort: i });
    await t.send('store', textUpdate(CUSTOMER, STOREFRONT_LABEL));
    const kb = t.tg.of('sendMessage').at(-1)!.payload.reply_markup.inline_keyboard;
    expect(kb.filter((r: any[]) => r[0].callback_data?.startsWith('cust_prod_'))).toHaveLength(8);
    expect(kb.at(-2).map((b: any) => b.callback_data)).toEqual(['cust_catalog_page_0', 'cust_catalog_page_1']);
  });
});

describe('storefront group flow', () => {
  it('a group with one option skips the choice step and behaves like that product', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'Solo');
    const pid = seedOption(t, g, 'Solo', '۱ ماهه');
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_grp_' + g));
    expect(t.tg.of('editMessageText')).toHaveLength(0);
    const prompt = t.tg.of('sendMessage').at(-1)!.payload;
    expect(prompt.text).toContain('Solo — ۱ ماهه');
    expect(JSON.stringify(prompt.reply_markup)).toContain('cust_disc_skip_' + pid);
  });

  it('several options: the group message lists them, the back button returns to the catalog text', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', '۱ ماهه', { price: 100, sort: 0 });
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { price: 300, duration: 90, sort: 0 });
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_grp_' + g));
    const edit = t.tg.of('editMessageText').at(-1)!.payload;
    expect(edit.text).toContain('*GPT*');
    expect(edit.text).toContain('لطفاً مدت/نوع را انتخاب کنید:');
    const rows = edit.reply_markup.inline_keyboard;
    expect(rows.map((r: any[]) => r[0].callback_data)).toEqual(['cust_prod_' + a, 'cust_prod_' + b, 'cust_catalog_page_0']);
    expect(rows[0][0].text).toBe('۱ ماهه  |  ۱۰۰ ت');

    await t.send('store', callbackUpdate(CUSTOMER, 'cust_catalog_page_0'));
    const back = t.tg.of('editMessageText').at(-1)!.payload;
    expect(back.text).toContain('فهرست محصولات');
    expect(back.reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data === 'cust_grp_' + g)).toBe(true);
  });

  it('all options unavailable: the option buttons say so, and the product callback shows the waitlist', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', '۱ ماهه', { available: 0 });
    seedOption(t, g, 'GPT', '۳ ماهه', { available: 0, duration: 90 });
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_grp_' + g));
    const labels = t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text);
    expect(labels).toEqual(['⛔️ ۱ ماهه (ناموجود)', '⛔️ ۳ ماهه (ناموجود)', '🔙 بازگشت']);
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + a));
    expect(JSON.stringify(t.tg.of('sendMessage').at(-1)!.payload.reply_markup)).toContain('waitlist_join_' + a);
  });
});

describe('group discount codes (SUPPLIER_PLAN.md §3.3)', () => {
  it('a group code is valid for every option of the group and refused for other products', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', '۱ ماهه', { price: 100000 });
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { price: 300000, duration: 90 });
    const standalone = seedStandalone(t, 'Other');
    const app = t.apps().store!;
    await app.db.createDiscountCode({ code: 'GROUP20', customerProductId: a, discountType: 'percent', discountValue: 20, maxUses: null, expiresAt: '2099-01-01 00:00:00', productGroupId: g });

    const pa = (await app.db.getCustomerProductById(a))!;
    const pb = (await app.db.getCustomerProductById(b))!;
    const ps = (await app.db.getCustomerProductById(standalone))!;
    expect((await validateDiscountCode(app, 'group20', pa, CUSTOMER.id)).ok).toBe(true);
    expect((await validateDiscountCode(app, 'GROUP20', pb, CUSTOMER.id)).ok).toBe(true);
    expect(await validateDiscountCode(app, 'GROUP20', ps, CUSTOMER.id)).toEqual({ ok: false, reason: 'wrong_product' });
  });

  it('a single-option code still works only for its option', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', '۱ ماهه');
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { duration: 90 });
    const app = t.apps().store!;
    await app.db.createDiscountCode({ code: 'ONE', customerProductId: a, discountType: 'fixed', discountValue: 1000, maxUses: null, expiresAt: '2099-01-01 00:00:00' });
    expect((await validateDiscountCode(app, 'ONE', (await app.db.getCustomerProductById(a))!, CUSTOMER.id)).ok).toBe(true);
    expect(await validateDiscountCode(app, 'ONE', (await app.db.getCustomerProductById(b))!, CUSTOMER.id)).toEqual({ ok: false, reason: 'wrong_product' });
  });

  it('a group code bought on another option is applied to the order', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    seedOption(t, g, 'GPT', '۱ ماهه', { price: 100000 });
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { price: 300000, duration: 90 });
    await t.apps().store!.db.createDiscountCode({ code: 'GROUP50', customerProductId: b, discountType: 'percent', discountValue: 50, maxUses: null, expiresAt: '2099-01-01 00:00:00', productGroupId: g });
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + b));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + b));
    await t.send('store', textUpdate(CUSTOMER, 'group50'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + b));
    await t.send('store', photoUpdate(CUSTOMER));
    expect(one(t.storeDb, 'SELECT price, discount_code_id FROM orders')).toEqual({ price: 150000, discount_code_id: 1 });
  });

  it('the fixed-amount price warning also looks at group codes', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', '۱ ماهه', { price: 100000 });
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { price: 100000, duration: 90 });
    await t.apps().store!.db.createDiscountCode({ code: 'FREE', customerProductId: a, discountType: 'fixed', discountValue: 100000, maxUses: null, expiresAt: '2099-01-01 00:00:00', productGroupId: g });
    // the code is stored on option a; its sibling b is covered only through the group
    expect((await t.apps().store!.db.getFixedCodesAtLeast(b, 100000, g)).map((c) => c.code)).toEqual(['FREE']);
    expect(await t.apps().store!.db.getFixedCodesAtLeast(b, 100000, null)).toEqual([]);
  });
});

describe('group names and options (SUPPLIER_PLAN.md §3.2)', () => {
  it('renaming a group rewrites every option name; changing a label does too', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', '۱ ماهه');
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { duration: 90 });
    const db = t.apps().store!.db;
    await db.renameGroup(g, 'ChatGPT');
    expect(q(t.storeDb, 'SELECT id, name FROM customer_products WHERE group_id = ? ORDER BY id', g)).toEqual([
      { id: a, name: 'ChatGPT — ۱ ماهه' }, { id: b, name: 'ChatGPT — ۳ ماهه' },
    ]);
    await db.setOptionLabel(b, g, 'سه‌ماهه');
    expect(one(t.storeDb, 'SELECT name FROM customer_products WHERE id = ?', b).name).toBe('ChatGPT — سه‌ماهه');
  });

  it('moving into a group sets the display name; leaving it returns the label as the name', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'Canva');
    const p = seedStandalone(t, 'Canva Pro 30 days');
    const db = t.apps().store!.db;
    await db.moveOptionToGroup(p, g, '۳۰ روزه', 'Canva — ۳۰ روزه');
    expect(one(t.storeDb, 'SELECT name, group_id, option_label FROM customer_products WHERE id = ?', p)).toEqual({ name: 'Canva — ۳۰ روزه', group_id: g, option_label: '۳۰ روزه' });
    await db.leaveGroup(p);
    expect(one(t.storeDb, 'SELECT name, group_id, option_label FROM customer_products WHERE id = ?', p)).toEqual({ name: '۳۰ روزه', group_id: null, option_label: null });
  });

  it('the terms of a whole group are saved on every option', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    const a = seedOption(t, g, 'GPT', 'A');
    const b = seedOption(t, g, 'GPT', 'B');
    await t.apps().store!.db.setGroupTerms(g, 'شرایط گروه', null);
    expect(q(t.storeDb, 'SELECT id, terms_text FROM customer_products WHERE group_id = ? ORDER BY id', g)).toEqual([
      { id: a, terms_text: 'شرایط گروه' }, { id: b, terms_text: 'شرایط گروه' },
    ]);
  });

  it('a full purchase of a grouped option reaches the admin receipt with the full name', async () => {
    const t = makeTestEnv({ monshi: false });
    const g = seedGroup(t, 'GPT');
    seedOption(t, g, 'GPT', '۱ ماهه');
    const b = seedOption(t, g, 'GPT', '۳ ماهه', { duration: 90, price: 300000 });
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + b));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + b));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + b));
    await t.send('store', photoUpdate(CUSTOMER));
    const forAdmin = t.tg.calls.filter((c) => c.method === 'copyMessage' && c.payload.chat_id === ADMIN.id);
    expect(forAdmin.at(-1)!.payload.caption).toContain('GPT — ۳ ماهه');
  });
});
