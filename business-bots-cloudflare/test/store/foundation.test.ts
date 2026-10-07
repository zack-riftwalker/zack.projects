import { describe, expect, it } from 'vitest';
import { makeTestEnv } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { DEFAULT_REFERRAL_CONFIG, getReferralConfig, referralConfigProblem, setReferralConfig } from '../../src/store/referralConfig';

describe('round-2 schema', () => {
  it('new columns and tables exist with safe defaults', () => {
    const t = makeTestEnv({ monshi: false });
    t.storeDb.sqlite.prepare("INSERT INTO customer_products (name, price) VALUES ('x', 1)").run();
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products').is_available).toBe(1);
    for (const table of ['store_kv', 'product_waitlist', 'referrals', 'referral_rewards']) {
      expect(q(t.storeDb, `SELECT * FROM ${table}`)).toEqual([]);
    }
    expect(one(t.monshiDb, "SELECT value FROM settings WHERE key='topics_enabled'").value).toBe('0');
    expect(q(t.monshiDb, 'SELECT * FROM notify_links')).toEqual([]);
  });
});

describe('referral config', () => {
  it('defaults, round-trip through kv, corrupt JSON falls back', async () => {
    const t = makeTestEnv({ monshi: false });
    const app = t.apps().store!;
    expect(await getReferralConfig(app)).toEqual(DEFAULT_REFERRAL_CONFIG);
    await setReferralConfig(app, { ...DEFAULT_REFERRAL_CONFIG, enabled: true, required: 5 });
    const fresh = t.apps().store!;
    expect((await getReferralConfig(fresh)).required).toBe(5);
    t.storeDb.sqlite.prepare("UPDATE store_kv SET value = '{bad'").run();
    expect(await getReferralConfig(t.apps().store!)).toEqual(DEFAULT_REFERRAL_CONFIG);
  });

  it('referralConfigProblem demands a reward product', () => {
    const products = [{ id: 1 } as any];
    expect(referralConfigProblem(DEFAULT_REFERRAL_CONFIG, products)).toContain('محصول');
    expect(referralConfigProblem({ ...DEFAULT_REFERRAL_CONFIG, discProductId: 1 }, products)).toBeNull();
    expect(referralConfigProblem({ ...DEFAULT_REFERRAL_CONFIG, discProductId: 2 }, products)).not.toBeNull();
    expect(referralConfigProblem({ ...DEFAULT_REFERRAL_CONFIG, reward: 'product', productId: 1 }, products)).toBeNull();
  });
});
