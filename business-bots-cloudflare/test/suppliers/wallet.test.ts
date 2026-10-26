import { describe, expect, it } from 'vitest';
import { one, q } from '../helpers/seed';
import { callbackDataOf, press, say } from './helpers';
import { buy, confirm, failedOrder, orderRow, posts, shop } from './engineHelpers';

const ledger = (t: any) => q(t.storeDb, 'SELECT kind, amount_usd, supplier_order_id, created_by FROM wallet_ledger ORDER BY id');

describe('S7 wallet ledger (§10.4)', () => {
  it('«💳 ثبت شارژ کیف پول» records a top-up and the estimate appears on the supplier card and in the direct-buy confirmation', async () => {
    const { t, sid } = await shop();
    await press(t, 'sup_s_' + sid);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('💳 موجودی تخمینی: $0.00 (بر اساس شارژهایی که ثبت کرده‌اید)');
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual(expect.arrayContaining(['sup_topup_' + sid, 'sup_wal_' + sid]));

    await press(t, 'sup_topup_' + sid);
    await say(t, '۵۰');
    expect(ledger(t)).toEqual([{ kind: 'topup', amount_usd: 50, supplier_order_id: null, created_by: 1001 }]);
    expect(t.tg.of('sendMessage', 1001).at(-1)!.payload.text).toContain('$50.00');
    await press(t, 'sup_s_' + sid);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('$50.00');
  });

  it('only a positive amount up to 100,000 is accepted; the prompt stays open after a bad answer', async () => {
    const { t, sid } = await shop();
    await press(t, 'sup_topup_' + sid);
    for (const bad of ['0', '-5', 'abc', '100001', '']) {
      if (!bad) continue;
      await say(t, bad);
      expect(t.tg.texts(1001).at(-1)).toContain('❌');
    }
    expect(ledger(t)).toHaveLength(0);
    await say(t, '12.5');
    expect(ledger(t)).toEqual([expect.objectContaining({ kind: 'topup', amount_usd: 12.5 })]);
  });

  it('every placement adds a spend; the estimate is the sum; history shows the last 10 rows with refund / adjust buttons', async () => {
    const { t, sid, m1 } = await shop();
    await press(t, 'sup_topup_' + sid);
    await say(t, '50');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(ledger(t).map((r) => [r.kind, r.amount_usd])).toEqual([['topup', 50], ['spend', -5.28]]);

    await press(t, 'sup_wal_' + sid);
    const history = t.tg.of('editMessageText').at(-1)!.payload;
    expect(history.text).toContain('$44.72');
    expect(history.text).toContain('🛒 خرج -$5.28');
    expect(history.text).toContain('💳 شارژ $50.00');
    expect(callbackDataOf(history)).toEqual(['sup_walr_' + sid, 'sup_wala_' + sid, 'sup_s_' + sid]);

    await press(t, 'sup_walr_' + sid);
    await say(t, '5.28');
    await press(t, 'sup_wala_' + sid);
    await say(t, '-1.5');
    expect(ledger(t).map((r) => [r.kind, r.amount_usd])).toEqual([['topup', 50], ['spend', -5.28], ['refund', 5.28], ['adjust', -1.5]]);
    expect(t.tg.of('sendMessage', 1001).at(-1)!.payload.text).toContain('$48.50');
  });

  it('refund must be positive; adjust must not be zero; a long history shows only the last 10', async () => {
    const { t, sid } = await shop();
    await press(t, 'sup_walr_' + sid);
    await say(t, '-3');
    expect(ledger(t)).toHaveLength(0);
    await press(t, 'sup_wala_' + sid);
    await say(t, '0');
    expect(ledger(t)).toHaveLength(0);
    for (let i = 1; i <= 12; i++) q(t.storeDb, "INSERT INTO wallet_ledger (supplier_id, kind, amount_usd, created_at) VALUES (?, 'topup', ?, '2026-10-25 10:00:00')", sid, i);
    await press(t, 'sup_wal_' + sid);
    const lines = (t.tg.of('editMessageText').at(-1)!.payload.text as string).split('\n').filter((l) => l.startsWith('💳 شارژ'));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('$12.00');
  });

  it('the estimate never blocks a purchase: a zero balance still sends the POST', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(posts(fake)).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT SUM(amount_usd) AS b FROM wallet_ledger').b).toBe(-5.28);
  });

  it('retry_later with a balance below the cost adds the low-balance line to the card; enough balance does not', async () => {
    const low = await shop();
    low.fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
    await confirm(low.t, await buy(low.t, low.m1));
    const card = low.t.tg.of('sendMessage', 1001).map((c) => c.payload).find((p) => p.text.includes('نیازمند تصمیم'))!;
    expect(card.text).toContain('💳 موجودی تخمینی ($0.00) کمتر از هزینه است.');
    expect(orderRow(low.t, 1).needs_action_reason).toBe('retry_later');

    const rich = await shop();
    await press(rich.t, 'sup_topup_' + rich.sid);
    await say(rich.t, '100');
    rich.fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
    await confirm(rich.t, await buy(rich.t, rich.m1));
    const card2 = rich.t.tg.of('sendMessage', 1001).map((c) => c.payload).find((p) => p.text.includes('نیازمند تصمیم'))!;
    expect(card2.text).not.toContain('کمتر از هزینه');
  });

  it('a wallet-related refusal gets the low-balance header, and still one POST', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 402, body: { detail: 'Insufficient balance' } });
    await confirm(t, await buy(t, m1));
    const card = t.tg.of('sendMessage', 1001).map((c) => c.payload).find((p) => p.text.includes('کافی نیست'))!;
    expect(card.text).toContain('💳 موجودی کیف پول «ArioBox Main» کافی نیست');
    expect(posts(fake)).toHaveLength(1);
  });

  it('a failed placement spends nothing', async () => {
    const { t, fake, m1 } = await shop();
    await failedOrder(t, fake, m1);
    expect(ledger(t)).toHaveLength(0);
  });
});
