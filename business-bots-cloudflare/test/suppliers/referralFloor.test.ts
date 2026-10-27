import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { DEFAULT_REFERRAL_CONFIG } from '../../src/store/referralConfig';

const REF = { id: 3001, first_name: 'Referrer', username: 'ref_user' };
const F1 = { id: 3101, first_name: 'Friend1' };

function enable(t: TestEnv, over: Record<string, unknown> = {}) {
  q(t.storeDb, "INSERT OR REPLACE INTO store_kv (key, value) VALUES ('referral', ?)",
    JSON.stringify({ ...DEFAULT_REFERRAL_CONFIG, enabled: true, required: 1, discProductId: 1, ...over }));
}

async function referralPurchase(t: TestEnv) {
  await t.send('store', textUpdate(REF, '/start'));
  await t.send('store', textUpdate(REF, '🎁 دعوت دوستان'));
  const code = /ref_([A-Z2-9]{8})/.exec(t.tg.texts(REF.id).at(-1)!)![1];
  await t.send('store', textUpdate(F1, '/start ref_' + code));
  await t.send('store', callbackUpdate(F1, 'cust_prod_1'));
  await t.send('store', callbackUpdate(F1, 'cust_disc_skip_1'));
  await t.send('store', callbackUpdate(F1, 'cust_agree_1'));
  await t.send('store', photoUpdate(F1, 'p'));
  await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
}

describe('referral reward code respects the supplier cost floor (SUPPLIER_PLAN.md §5.4)', () => {
  it('a reward discount that would sell below the cost: no code is created, the reward is marked failed, the admins are told', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'GPT Plus', price: 500000 });
    q(t.storeDb, 'UPDATE customer_products SET cost_toman = 450000 WHERE id = 1'); // a 20% reward leaves 400,000
    enable(t, { discType: 'percent', discValue: 20 });
    await referralPurchase(t);
    expect(one(t.storeDb, 'SELECT status FROM referral_rewards').status).toBe('failed');
    expect(q(t.storeDb, "SELECT 1 FROM discount_codes WHERE source = 'referral'")).toHaveLength(0);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('ناموفق بود');
  });

  it('a product without a cost, or a discount above the cost, still gets its reward code', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { name: 'GPT Plus', price: 500000 });
    q(t.storeDb, 'UPDATE customer_products SET cost_toman = 350000 WHERE id = 1'); // 400,000 stays above it
    enable(t, { discType: 'percent', discValue: 20 });
    await referralPurchase(t);
    expect(one(t.storeDb, 'SELECT status FROM referral_rewards').status).toBe('issued');
    expect(q(t.storeDb, "SELECT 1 FROM discount_codes WHERE source = 'referral'")).toHaveLength(1);
  });
});
