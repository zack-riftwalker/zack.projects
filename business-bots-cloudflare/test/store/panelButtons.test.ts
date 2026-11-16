import { describe, expect, it } from 'vitest';
import { makeTestEnv, ADMIN } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, seedProduct } from '../helpers/seed';

describe('admin panel buttons', () => {
  it('a panel button pressed mid-wizard leaves the wizard and opens its menu (not taken as wizard input)', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, {});
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_add')); // discount wizard step 1
    t.tg.reset();
    await t.send('store', textUpdate(ADMIN, '🎟 کد تخفیف'));
    await t.send('store', textUpdate(ADMIN, '🎟 کد تخفیف'));
    expect(t.tg.texts(ADMIN.id)).toEqual(['🎟 *مدیریت کدهای تخفیف*', '🎟 *مدیریت کدهای تخفیف*']);
    expect(one(t.storeDb, 'SELECT COUNT(*) AS n FROM discount_codes').n).toBe(0);
  });

  it('a stale callback (answerCallbackQuery fails) still runs the button', async () => {
    const t = makeTestEnv({ monshi: false });
    t.tg.fail('answerCallbackQuery', () => true, 400, 'Bad Request: query is too old and response timeout expired or query ID is invalid');
    t.tg.reset();
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_list'));
    expect(t.tg.of('editMessageText')).toHaveLength(1);
  });
});
