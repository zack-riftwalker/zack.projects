import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2 } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { itemRef } from '../../src/store/suppliers/store';
import { at, callbackDataOf, press } from './helpers';
import {
  addBackupSource, buy, completedOrder, confirm, events, failedOrder, iso, orderRow, pressAs, posts, shop, soRow,
} from './engineHelpers';

const lastEdit = (t: any) => t.tg.of('editMessageText').at(-1)!.payload;

describe('🔀 خرید از منبع دیگر (§8.3 fo_src)', () => {
  it('lists every source (disabled ones too) with cost, profit and 🔻 for a loss; a pick needs a confirmation; then it buys from that source', async () => {
    const { t, fake, sid, m1 } = await shop();
    const backup = await addBackupSource(t, sid, m1);
    await press(t, 'sup_srctog_' + m1 + '_' + backup); // the backup is switched off (by the admin)
    await press(t, 'sup_srcn_' + m1 + '_' + sid + '_' + (await itemRef('1300', '3m'))); // a dearer third source ($14)
    const third = one(t.storeDb, "SELECT id FROM product_sources WHERE remote_variation_id = '3m' AND customer_product_id = ?", m1).id;
    const orderId = await failedOrder(t, fake, m1);
    expect(posts(fake)).toHaveLength(1);

    await press(t, 'fo_src_' + orderId);
    const list = lastEdit(t);
    const labels = list.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(callbackDataOf(list)).toEqual([
      ...q(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ? ORDER BY priority', m1).map((r) => 'fo_srcp_' + orderId + '_' + r.id),
      'fo_srcnew_' + orderId, 'fo_card_' + orderId,
    ]);
    expect(labels[0]).toContain('ArioBox Main — $5.28 ≈');
    expect(labels[1]).toContain('$5.50');
    expect(labels[1]).toContain('غیرفعال'); // disabled by the admin, still listed
    expect(labels[1]).not.toContain('🔻');
    expect(labels[2]).toContain('$14.00');
    expect(labels[2]).toContain('🔻'); // 2,100,000 > the sale price

    await press(t, 'fo_srcp_' + orderId + '_' + backup);
    expect(lastEdit(t).text).toContain('خرید از «ArioBox Main» با هزینه‌ی ≈');
    expect(callbackDataOf(lastEdit(t))).toEqual(['fo_srcok_' + orderId + '_' + backup, 'fo_src_' + orderId]);
    expect(posts(fake)).toHaveLength(1); // nothing bought by a pick

    await press(t, 'fo_srcok_' + orderId + '_' + backup);
    expect(posts(fake)).toHaveLength(2);
    expect(posts(fake)[1].body).toMatchObject({ product_id: '1400', quantity: 1 });
    expect(q(t.storeDb, 'SELECT status, forced_source_id, source_id, requested_by FROM supplier_orders ORDER BY id')).toEqual([
      { status: 'failed', forced_source_id: null, source_id: one(t.storeDb, 'SELECT id FROM product_sources WHERE priority = 1 AND customer_product_id = ?', m1).id, requested_by: 0 },
      { status: 'placed', forced_source_id: backup, source_id: backup, requested_by: ADMIN.id },
    ]);
    expect(orderRow(t, orderId).needs_action_reason).toBeNull();
    expect(events(t, 'admin_source')[0]).toMatchObject({ actor: ADMIN.id, order_id: orderId });
    expect(lastEdit(t).text).toContain('🔀 خرید از «ArioBox Main» ثبت شد توسط Admin');

    // a forced source skips the loss check: the dear one is bought when the admin says so
    expect(third).toBeGreaterThan(0);
  });

  it('a forced source that sells at a loss is bought when the admin confirms (the loss check is skipped)', async () => {
    const { t, fake, sid, m1 } = await shop();
    await press(t, 'sup_srcn_' + m1 + '_' + sid + '_' + (await itemRef('1300', '3m')));
    const third = one(t.storeDb, "SELECT id FROM product_sources WHERE remote_variation_id = '3m' AND customer_product_id = ?", m1).id;
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_srcp_' + orderId + '_' + third);
    expect(lastEdit(t).text).toContain('🔻');
    await press(t, 'fo_srcok_' + orderId + '_' + third);
    expect(posts(fake).at(-1)!.body).toMatchObject({ product_id: '1300', variation_id: '3m' });
    expect(soRow(t, 2)).toMatchObject({ status: 'placed', cost_toman: 2100000 });
  });

  it('➕ منبع جدید: supplier → catalog item → a DISABLED last-priority source, then the confirmation', async () => {
    const { t, fake, sid, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_srcnew_' + orderId);
    expect(callbackDataOf(lastEdit(t))).toEqual(['fo_srcs_' + orderId + '_' + sid, 'fo_src_' + orderId]);
    await press(t, 'fo_srcs_' + orderId + '_' + sid);
    const items = callbackDataOf(lastEdit(t));
    const ref = await itemRef('1400', '');
    expect(items).toContain('fo_srcn_' + orderId + '_' + sid + '_' + ref);
    await press(t, 'fo_srcn_' + orderId + '_' + sid + '_' + ref);
    expect(one(t.storeDb, "SELECT is_enabled, priority FROM product_sources WHERE remote_product_id = '1400'")).toEqual({ is_enabled: 0, priority: 2 });
    expect(lastEdit(t).text).toContain('خرید از «ArioBox Main»');
    await press(t, 'fo_srcok_' + orderId + '_' + one(t.storeDb, "SELECT id FROM product_sources WHERE remote_product_id = '1400'").id);
    expect(posts(fake).at(-1)!.body.product_id).toBe('1400');
    expect(soRow(t, 2).status).toBe('placed');
    // the same item again is the same source (not a duplicate)
    expect(one(t.storeDb, "SELECT COUNT(*) n FROM product_sources WHERE remote_product_id = '1400'").n).toBe(1);
  });

  it('while the order only WAITS (all sources out of stock) the new choice replaces the waiting supplier order', async () => {
    const { t, fake, sid, m1 } = await shop();
    const backup = await addBackupSource(t, sid, m1);
    fake.state.postQueue.push({ status: 409, body: { detail: 'x' } }, { status: 409, body: { detail: 'x' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t).status).toBe('queued');
    expect(posts(fake)).toHaveLength(2);

    await pressAs(t, ADMIN, 'fo_srcok_' + orderId + '_' + backup);
    expect(q(t.storeDb, 'SELECT status FROM supplier_orders ORDER BY id').map((r) => r.status)).toEqual(['cancelled', 'placed']);
    expect(posts(fake)).toHaveLength(3);
    await at(t, iso('10:30')); // the cancelled one never wakes up
    expect(posts(fake)).toHaveLength(3);
  });

  it('refused from the wrong state: an order already placed (money may be spent), a delivered order, a stranger', async () => {
    const { t, fake, sid, m1 } = await shop();
    const backup = await addBackupSource(t, sid, m1);
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t).status).toBe('placed');
    // the card of a placed order has no 🔀; a forged press adds no second purchase
    await pressAs(t, ADMIN, 'fo_srcok_' + orderId + '_' + backup);
    expect(posts(fake)).toHaveLength(1);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ممکن نیست');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(1);

    completedOrder(fake);
    await at(t, iso('09:52'));
    expect(orderRow(t, orderId).status).toBe('delivered');
    await pressAs(t, ADMIN, 'fo_src_' + orderId);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    await pressAs(t, { id: 2002, first_name: 'Ali' }, 'fo_srcok_' + orderId + '_' + backup);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('دسترسی ندارید');
    expect(posts(fake)).toHaveLength(1);
  });

  it('two admins pressing the same confirmation at once: one purchase', async () => {
    const { t, fake, sid, m1 } = await shop();
    const backup = await addBackupSource(t, sid, m1);
    const orderId = await failedOrder(t, fake, m1);
    await Promise.all([
      pressAs(t, ADMIN, 'fo_srcok_' + orderId + '_' + backup),
      pressAs(t, ADMIN2, 'fo_srcok_' + orderId + '_' + backup),
    ]);
    expect(posts(fake)).toHaveLength(2); // the failed first try + ONE new one
    const statuses = q(t.storeDb, 'SELECT status FROM supplier_orders WHERE id > 1 ORDER BY id').map((r) => r.status);
    expect(statuses.filter((x) => x === 'placed')).toHaveLength(1); // the other press was superseded while it only waited
    expect(statuses.filter((x) => x === 'placing' || x === 'queued')).toHaveLength(0);
  });
});
