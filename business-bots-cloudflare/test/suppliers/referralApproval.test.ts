import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { DEFAULT_REFERRAL_CONFIG } from '../../src/store/referralConfig';
import { at, callbackDataOf, press } from './helpers';
import { businessReplies, connect } from '../helpers/monshi';
import { completedOrder, iso, orderRow, posts, shop } from './engineHelpers';

const REF = { id: 3001, first_name: 'Referrer', username: 'ref_user' };
const F1 = { id: 3101, first_name: 'Friend1' };

describe('S7 referral free product with a supplier product (§10.3)', () => {
  async function rewarded(monshi: boolean) {
    const s = await shop({ monshi });
    if (monshi) await connect(s.t);
    const plain = seedProduct(s.t, { name: 'Plain', price: 200000 });
    q(s.t.storeDb, "INSERT OR REPLACE INTO store_kv (key, value) VALUES ('referral', ?)",
      JSON.stringify({ ...DEFAULT_REFERRAL_CONFIG, enabled: true, required: 1, reward: 'product', productId: s.m1 }));
    await s.t.send('store', textUpdate(REF, '/start'));
    await s.t.send('store', textUpdate(REF, '🎁 دعوت دوستان'));
    const code = /ref_([A-Z2-9]{8})/.exec(s.t.tg.texts(REF.id).at(-1)!)![1];
    await s.t.send('store', textUpdate(F1, '/start ref_' + code));
    await s.t.send('store', callbackUpdate(F1, 'cust_prod_' + plain));
    await s.t.send('store', callbackUpdate(F1, 'cust_disc_skip_' + plain));
    await s.t.send('store', callbackUpdate(F1, 'cust_agree_' + plain));
    await s.t.send('store', photoUpdate(F1, 'ref-receipt'));
    s.t.tg.reset();
    await s.t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
    return s;
  }
  const rewardOrder = (t: any) => one(t.storeDb, 'SELECT * FROM orders WHERE customer_telegram_id = ?', REF.id);

  it('the reward order waits for approval: no POST, no monshi message, a decision card with «تأیید و خرید»', async () => {
    const { t, fake } = await rewarded(true);
    const o = rewardOrder(t);
    expect(o).toMatchObject({ price: 0, status: 'confirmed', fulfillment: 'supplier', needs_action_reason: 'approval', purchase_source: 'manual' });
    expect(o.supplier_deadline_at).toBeTruthy();
    expect(posts(fake)).toHaveLength(0);
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(0);
    // nothing went through the monshi bridge for the reward order
    expect(businessReplies(t, REF.id)).toEqual([]);
    expect(t.tg.texts(REF.id).join('\n')).not.toContain('در حال آماده‌سازی');
    expect(t.tg.texts(REF.id).join('\n')).toContain('یک «ChatGPT — ۱ ماهه» رایگان');
    const card = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('جایزه‌ی دعوت دوستان'))!;
    expect(card.text).toContain('نیاز به تأیید شما');
    expect(callbackDataOf(card)).toContain('fo_retry_' + o.id);
    expect(JSON.stringify(card.reply_markup)).toContain('✅ تأیید و خرید');
  });

  it('«✅ تأیید و خرید» asks once more, then buys with exactly one POST (no loss guard: the admin decided) and the referrer gets the account', async () => {
    const { t, fake } = await rewarded(false);
    const id = rewardOrder(t).id;
    await press(t, 'fo_retry_' + id);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('خرید با قیمت فعلی');
    expect(posts(fake)).toHaveLength(0);
    await press(t, 'fo_retryok_' + id);
    expect(posts(fake)).toHaveLength(1);
    expect(orderRow(t, id)).toMatchObject({ needs_action_reason: null, status: 'confirmed' });

    completedOrder(fake);
    t.tg.reset();
    await at(t, iso('09:52'));
    expect(orderRow(t, id)).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000 });
    expect(t.tg.texts(REF.id).join('\n')).toContain('a@b.c');
    expect(posts(fake)).toHaveLength(1);
    await press(t, 'fo_retryok_' + id); // a stale press
    expect(posts(fake)).toHaveLength(1);
  });

  it('the admin can also cancel the reward order from the card', async () => {
    const { t, fake } = await rewarded(false);
    const id = rewardOrder(t).id;
    await press(t, 'fo_cancel_' + id);
    await press(t, 'fo_cr_' + id + '_none');
    await press(t, 'fo_cok_' + id);
    expect(orderRow(t, id)).toMatchObject({ status: 'cancelled', needs_action_reason: null });
    expect(posts(fake)).toHaveLength(0);
  });
});
