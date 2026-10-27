import { describe, expect, it } from 'vitest';
import { one, q } from '../helpers/seed';
import { press, say } from './helpers';
import {
  addBackupSource, buy, confirm, CUSTOMER, orderRow, posts, seedStock, shop,
} from './engineHelpers';

type Shop = Awaited<ReturnType<typeof shop>>;

/** Every state in which an order waits for the admin, and how to reach it through the real flow. */
const STATES: Record<string, (s: Shop) => Promise<number>> = {
  failed: async ({ t, fake, m1 }) => {
    fake.state.postQueue.push({ status: 401, body: { detail: 'bad key' } });
    const id = await buy(t, m1);
    await confirm(t, id);
    return id;
  },
  waiting: async ({ t, fake, m1 }) => {
    fake.state.postQueue.push({ status: 409, body: { detail: 'x' } });
    const id = await buy(t, m1);
    await confirm(t, id);
    return id;
  },
  unknown: async ({ t, fake, m1 }) => {
    fake.state.postQueue.push('timeout');
    const id = await buy(t, m1);
    await confirm(t, id);
    return id;
  },
  placed: async ({ t, m1 }) => {
    const id = await buy(t, m1);
    await confirm(t, id);
    return id;
  },
  noSource: async ({ t, m1 }) => {
    await press(t, 'sup_smode_' + m1);
    await press(t, 'sup_srctog_' + m1 + '_' + one(t.storeDb, 'SELECT id FROM product_sources WHERE priority = 1 AND customer_product_id = ?', m1).id);
    const id = await buy(t, m1);
    await confirm(t, id);
    return id;
  },
};

const delivered = (t: any) => t.tg.of('sendMessage', CUSTOMER.id).filter((c: any) => c.payload.text.includes('آماده است')).length;

describe('every manual action works from every waiting state, and never buys or delivers twice', () => {
  for (const [name, reach] of Object.entries(STATES)) {
    it(name + ': ✍️ text', async () => {
      const s = await shop();
      const orderId = await reach(s);
      const before = posts(s.fake).length;
      await press(s.t, 'fo_text_' + orderId);
      await say(s.t, 'the account');
      await press(s.t, 'fo_textok_' + orderId);
      expect(orderRow(s.t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'manual_text' });
      expect(delivered(s.t)).toBe(1);
      expect(posts(s.fake).length).toBe(before); // nothing new bought
      expect(q(s.t.storeDb, "SELECT status FROM supplier_orders WHERE status IN ('queued', 'placing')")).toHaveLength(0);
    });

    it(name + ': 📦 stock', async () => {
      const s = await shop();
      const orderId = await reach(s);
      await seedStock(s.t, [{ email: 'a@x.test', password: '1' }]);
      const before = posts(s.fake).length;
      await press(s.t, 'fo_stkok_' + orderId + '_1');
      expect(orderRow(s.t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'stock' });
      expect(delivered(s.t)).toBe(1);
      expect(posts(s.fake).length).toBe(before);
    });

    it(name + ': 🙋 self → ✅ done', async () => {
      const s = await shop();
      const orderId = await reach(s);
      const before = posts(s.fake).length;
      await press(s.t, 'fo_self_' + orderId);
      expect(orderRow(s.t, orderId).fulfillment).toBe('manual_outside');
      await press(s.t, 'fo_done_' + orderId);
      expect(orderRow(s.t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'manual_outside' });
      expect(delivered(s.t)).toBe(0); // the customer got the completion text, not an account
      expect(posts(s.fake).length).toBe(before);
    });

    it(name + ': ❌ cancel', async () => {
      const s = await shop();
      const orderId = await reach(s);
      const before = posts(s.fake).length;
      await press(s.t, 'fo_cancel_' + orderId);
      await press(s.t, 'fo_cr_' + orderId + '_oos');
      await press(s.t, 'fo_cok_' + orderId);
      expect(orderRow(s.t, orderId)).toMatchObject({ status: 'cancelled', refund_status: 'pending' });
      expect(posts(s.fake).length).toBe(before);
    });

    it(name + ': 🔀 another source ' + (name === 'placed' ? '(refused: money may be spent)' : name === 'unknown' ? '(refused: it may exist, review B2)' : 'buys once'), async () => {
      const s = await shop();
      const orderId = await reach(s);
      const backup = await addBackupSource(s.t, s.sid, s.m1); // added afterwards: an enabled backup would have changed the state
      const before = posts(s.fake).length;
      await press(s.t, 'fo_srcok_' + orderId + '_' + backup);
      if (name === 'placed' || name === 'unknown') expect(posts(s.fake).length).toBe(before);
      else expect(posts(s.fake).length).toBe(before + 1);
    });
  }

  it('🔁 retry: from failed / unknown / no source (no live order) it buys once; from waiting / placed it is refused', async () => {
    for (const [name, bought] of [['failed', true], ['unknown', true], ['noSource', true], ['waiting', false], ['placed', false]] as const) {
      const s = await shop();
      const orderId = await STATES[name](s);
      if (name === 'noSource') await press(s.t, 'sup_srctog_' + s.m1 + '_' + one(s.t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ?', s.m1).id);
      const before = posts(s.fake).length;
      await press(s.t, 'fo_retry_' + orderId);
      expect(posts(s.fake).length, name).toBe(before + (bought ? 1 : 0));
    }
  });
});
