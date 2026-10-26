import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { one, q, seedCard, seedProduct } from '../helpers/seed';
import { press, say, KEY } from './helpers';

const sessionOf = (t: TestEnv) => q(t.storeDb, "SELECT value FROM sessions WHERE key LIKE ?", ADMIN.id + ':%').map((r) => r.value).join('\n');

/** Walks the add-supplier steps until the connection test fails temporarily (the key now waits in the session). */
async function untestedState() {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
  fake.state.catalogStatus = 503;
  const base = Date.now();
  t.deps.now = () => new Date(base);
  await press(t, 'sup_add');
  await say(t, 'Name');
  await say(t, 'https://x.test');
  await say(t, KEY);
  await say(t, '42');
  return { t, base };
}

describe('the add-supplier wizard expires after 15 minutes and does not keep the key (review should-fix 8)', () => {
  it('while waiting for «save untested» the key is in the session (the precondition of the next tests)', async () => {
    const { t } = await untestedState();
    expect(sessionOf(t)).toContain(KEY);
  });

  it('«ذخیره بدون تست» after 16 minutes saves nothing and wipes the key from the session', async () => {
    const { t, base } = await untestedState();
    t.deps.now = () => new Date(base + 16 * 60_000);
    await press(t, 'sup_add_save_untested');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM suppliers').n).toBe(0);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('مهلت ورود تمام شد');
    expect(sessionOf(t)).not.toContain(KEY);
  });

  it('within the 15 minutes it still saves, and the key leaves the session', async () => {
    const { t, base } = await untestedState();
    t.deps.now = () => new Date(base + 10 * 60_000);
    await press(t, 'sup_add_save_untested');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM suppliers').n).toBe(1);
    expect(sessionOf(t)).not.toContain(KEY);
  });

  it('cancel wipes the key too', async () => {
    const { t } = await untestedState();
    await press(t, 'sup_cancel_input');
    expect(sessionOf(t)).not.toContain(KEY);
  });

  it('a step typed after 16 minutes is refused', async () => {
    const fake = makeFakeAriobox();
    const t = makeTestEnv({ monshi: false, fetch: fake.fetch });
    const base = Date.now();
    t.deps.now = () => new Date(base);
    await press(t, 'sup_add');
    await say(t, 'Name');
    t.deps.now = () => new Date(base + 16 * 60_000);
    await say(t, 'https://x.test');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('مهلت ورود تمام شد');
    await say(t, KEY);
    expect(sessionOf(t)).not.toContain(KEY);
  });
});

describe('receipt submission refreshes customers.username (SUPPLIER_PLAN.md §2.3)', () => {
  it('a changed or removed @username is stored on the customer and on the order', async () => {
    const t = makeTestEnv({ monshi: false });
    seedCard(t);
    const pid = seedProduct(t, {});
    const C = { id: 2002, first_name: 'Ali', username: 'old_name' };
    await t.send('store', textUpdate(C, '/start'));
    expect(one(t.storeDb, 'SELECT username FROM customers').username).toBe('old_name');
    await t.send('store', callbackUpdate({ ...C, username: 'new_name' }, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate({ ...C, username: 'new_name' }, 'cust_disc_skip_' + pid));
    await t.send('store', callbackUpdate({ ...C, username: 'new_name' }, 'cust_agree_' + pid));
    await t.send('store', photoUpdate({ ...C, username: 'new_name' }));
    expect(one(t.storeDb, 'SELECT username FROM customers').username).toBe('new_name');
    expect(one(t.storeDb, 'SELECT customer_username FROM orders').customer_username).toBe('new_name');
  });
});
