import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedCard } from '../helpers/seed';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };

describe('below_cost is checked at code entry only (review should-fix 2, SUPPLIER_PLAN.md §5.4)', () => {
  async function pendingOrderWithCode() {
    const t = makeTestEnv({ monshi: false });
    seedCard(t);
    const pid = Number(t.storeDb.sqlite.prepare(
      "INSERT INTO customer_products (name, price, cost_toman, duration_days, warranty_days) VALUES ('GPT', 1000000, 800000, 30, 7)").run().lastInsertRowid);
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at, max_uses) VALUES ('REF1', ?, 'fixed', 100000, '2999-01-01 00:00:00', 1)", pid);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + pid));
    await t.send('store', textUpdate(CUSTOMER, 'REF1'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    await t.send('store', photoUpdate(CUSTOMER));
    return { t, pid };
  }

  it('a code accepted at entry is still redeemed when the cost rises before the receipt is confirmed', async () => {
    const { t, pid } = await pendingOrderWithCode();
    expect(one(t.storeDb, 'SELECT price, discount_code_id FROM orders')).toEqual({ price: 900000, discount_code_id: 1 });
    // cost rises: 900,000 is now below the cost
    q(t.storeDb, 'UPDATE customer_products SET cost_toman = 950000 WHERE id = ?', pid);
    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('confirmed');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM discount_code_redemptions').n).toBe(1);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text ?? '').not.toContain('below_cost');
  });

  it('at code entry the floor still applies', async () => {
    const t = makeTestEnv({ monshi: false });
    seedCard(t);
    const pid = Number(t.storeDb.sqlite.prepare(
      "INSERT INTO customer_products (name, price, cost_toman) VALUES ('GPT', 1000000, 950000)").run().lastInsertRowid);
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('LOW', ?, 'fixed', 100000, '2999-01-01 00:00:00')", pid);
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + pid));
    await t.send('store', textUpdate(CUSTOMER, 'LOW'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('❌ این کد برای این محصول قابل استفاده نیست.');
  });
});
