import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { makeFakeAriobox, type FakeAriobox } from '../helpers/fakeAriobox';
import { one, q } from '../helpers/seed';
import { SUPPLIER_LABEL } from '../../src/store/labels';
import { getSupplierDefaults } from '../../src/store/supplierDefaults';
import { callbackDataOf, lastSent } from './helpers';

const KEY = 'SECRET-KEY-1234';

function setup(): { t: TestEnv; fake: FakeAriobox } {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ fetch: fake.fetch });
  return { t, fake };
}

const say = (t: TestEnv, text: string) => t.send('store', textUpdate(ADMIN, text));
const press = (t: TestEnv, data: string) => t.send('store', callbackUpdate(ADMIN, data));

/** Walks the add-supplier steps with the given key; returns the saved supplier's id when the test passed. */
async function addSupplier(t: TestEnv, key = KEY) {
  await press(t, 'sup_add');
  await say(t, 'ArioBox Main');
  await say(t, 'https://ariobox.test/');
  await say(t, key);
  await say(t, '42');
}

describe('supplier panel: menu', () => {
  it('the panel label opens the menu with the supplier and default-markup buttons', async () => {
    const { t } = setup();
    await say(t, SUPPLIER_LABEL);
    const sent = lastSent(t);
    expect(sent.text).toContain('API تأمین‌کننده');
    expect(callbackDataOf(sent)).toEqual(['sup_list', 'sup_def', 'sup_close']);
  });
});

describe('supplier panel: add supplier (SUPPLIER_PLAN.md §4.5)', () => {
  it('success: the key message is deleted, the supplier and its first catalog are saved, the key is never echoed', async () => {
    const { t, fake } = setup();
    fake.state.validKey = KEY;
    fake.state.items = [fake.item('1300', '', 'ChatGPT Plus', 5.28)];
    await addSupplier(t);

    expect(t.tg.of('deleteMessage')).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT name, base_url, api_key, remote_user_id FROM suppliers')).toEqual({
      name: 'ArioBox Main', base_url: 'https://ariobox.test', api_key: KEY, remote_user_id: 42,
    });
    const cat = one(t.storeDb, 'SELECT usd_toman, items_json FROM supplier_catalogs');
    expect(cat.usd_toman).toBe(150000);
    expect(JSON.parse(cat.items_json)).toHaveLength(1);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('✅ اتصال برقرار شد — ۱ محصول، نرخ دلار ۱۵۰٬۰۰۰ تومان');
    expect(JSON.stringify(t.tg.calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload))).not.toContain(KEY);
    // the test call used the typed base URL without its trailing slash
    expect(fake.calls[0].url).toBe('https://ariobox.test/api/v1/reseller/products');
  });

  it('auth failure: the admin is asked to type the key again and nothing is saved', async () => {
    const { t, fake } = setup();
    fake.state.validKey = 'SOMETHING-ELSE';
    await addSupplier(t);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('❌ کلید API نامعتبر است.');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM suppliers').n).toBe(0);
    expect(callbackDataOf(lastSent(t))).toContain('sup_add_retype');
  });

  it('a temporary failure offers saving without the test; saving makes the supplier with no catalog yet', async () => {
    const { t, fake } = setup();
    fake.state.catalogStatus = 503;
    await addSupplier(t);
    expect(callbackDataOf(lastSent(t))).toEqual(['sup_add_save_untested', 'sup_add_retry', 'sup_cancel_input']);
    await press(t, 'sup_add_save_untested');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM suppliers').n).toBe(1);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_catalogs').n).toBe(0);
  });

  it('a too-short key is refused (and still deleted)', async () => {
    const { t, fake } = setup();
    fake.state.validKey = KEY;
    await press(t, 'sup_add');
    await say(t, 'Name');
    await say(t, 'https://ariobox.test');
    await say(t, 'short');
    expect(t.tg.of('deleteMessage')).toHaveLength(1);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('کلید باید بین ۸ تا ۲۰۰ کاراکتر باشد');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM suppliers').n).toBe(0);
  });

  it('the base URL must start with https://', async () => {
    const { t } = setup();
    await press(t, 'sup_add');
    await say(t, 'Name');
    await say(t, 'http://ariobox.test');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('باید با https:// شروع شود');
  });
});

describe('supplier panel: card, items, toggle, sync', () => {
  it('the card shows only the last four characters of the key', async () => {
    const { t, fake } = setup();
    fake.state.validKey = KEY;
    await addSupplier(t);
    const id = one(t.storeDb, 'SELECT id FROM suppliers').id;
    await press(t, 'sup_s_' + id);
    const card = t.tg.of('editMessageText').at(-1)!.payload.text;
    expect(card).toContain('••••1234');
    expect(card).toContain('user_id: <code>42</code>');
    expect(card).not.toContain(KEY);
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual(
      ['sup_sync_' + id, 'sup_items_' + id + '_0', 'sup_key_' + id, 'sup_uid_' + id, 'sup_tog_' + id, 'sup_list'],
    );
  });

  it('the product list is paged, 8 per page, and grouped by product', async () => {
    const { t, fake } = setup();
    fake.state.validKey = KEY;
    fake.state.items = Array.from({ length: 10 }, (_, i) => fake.item('130' + i, '', 'P' + i, 1 + i));
    fake.state.items.push(fake.item('1300', '9', 'P0', 2));
    await addSupplier(t);
    const id = one(t.storeDb, 'SELECT id FROM suppliers').id;

    await press(t, 'sup_items_' + id + '_0');
    const page0 = callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload).filter((d) => d.startsWith('sup_imp_'));
    expect(page0).toHaveLength(8);
    expect(page0[0]).toBe('sup_imp_' + id + '_1300');

    await press(t, 'sup_items_' + id + '_1');
    const page1 = callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload).filter((d) => d.startsWith('sup_imp_'));
    expect(page1).toHaveLength(2);
    const page1Labels = t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text);
    expect(page1Labels[0]).toBe('P8 (1 گزینه) از $9.00');
    await press(t, 'sup_items_' + id + '_0');
    const page0Labels = t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard.map((r: any[]) => r[0].text);
    // the two variations of 1300 are one product, priced at its cheapest variation
    expect(page0Labels[0]).toBe('P0 (2 گزینه) از $1.00');
  });

  it('toggle switches enabled state; sync asks the cron to run it next minute', async () => {
    const { t, fake } = setup();
    fake.state.validKey = KEY;
    await addSupplier(t);
    const id = one(t.storeDb, 'SELECT id FROM suppliers').id;
    await press(t, 'sup_tog_' + id);
    expect(one(t.storeDb, 'SELECT is_enabled FROM suppliers').is_enabled).toBe(0);
    await press(t, 'sup_sync_' + id);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('در دقیقه‌ی بعد همگام‌سازی می‌شود.');
  });

  it('changing the key tests it first and keeps the old key when the new one is refused', async () => {
    const { t, fake } = setup();
    fake.state.validKey = KEY;
    await addSupplier(t);
    const id = one(t.storeDb, 'SELECT id FROM suppliers').id;
    await press(t, 'sup_key_' + id);
    await say(t, 'WRONG-KEY-99999');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('کلید API نامعتبر است');
    expect(one(t.storeDb, 'SELECT api_key FROM suppliers').api_key).toBe(KEY);
    fake.state.validKey = 'NEW-KEY-123456';
    await press(t, 'sup_key_' + id);
    await say(t, 'NEW-KEY-123456');
    expect(one(t.storeDb, 'SELECT api_key FROM suppliers').api_key).toBe('NEW-KEY-123456');
  });

  it('an open typed input expires after 15 minutes', async () => {
    const { t } = setup();
    await press(t, 'sup_def_pct');
    t.deps.now = () => new Date(Date.now() + 16 * 60_000);
    await say(t, '15');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('مهلت ورود تمام شد');
    expect((await getSupplierDefaults(t.apps().store!)).markupPercent).toBeNull();
  });
});

describe('supplier panel: default markup (kv)', () => {
  it('saves a percent and a fixed amount; 0 is allowed; out-of-range values are refused', async () => {
    const { t } = setup();
    await press(t, 'sup_def_pct');
    await say(t, '600');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('باید بین ۰ تا ۵۰۰ باشد');
    await say(t, '۱۵');
    await press(t, 'sup_def_fix');
    await say(t, '0');
    expect(await getSupplierDefaults(t.apps().store!)).toEqual({ markupPercent: 15, markupFixed: 0 });
    expect(q(t.storeDb, "SELECT key FROM store_kv WHERE key = 'supplier_defaults'")).toHaveLength(1);
  });
});
