import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { formatJalaliDateTime, tehranDateTime } from '../../src/lib/time';

const NOW = new Date(Date.UTC(2026, 9, 7, 8, 30)); // 12:00 Tehran
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);
const jal = (d: Date) => formatJalaliDateTime(tehranDateTime(d));

function setup(customers = 3) {
  const t = makeTestEnv({ monshi: false });
  const clock = { now: NOW };
  t.deps.now = () => clock.now;
  for (let i = 0; i < customers; i++) q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', 100 + i, 'c' + i);
  return { t, clock };
}
const jobs = (t: TestEnv) => q(t.storeDb, 'SELECT id, status, cancelled, total, send_after, cursor_customer_id AS cur FROM broadcast_jobs ORDER BY id');
const got = (t: TestEnv, text: string) => t.tg.of('sendMessage').filter((c) => c.payload.text === text).map((c) => c.payload.chat_id);

async function schedule(t: TestEnv, when: string, text = 'SALE SOON') {
  await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
  await t.send('store', callbackUpdate(ADMIN, 'ann_aud_all', { chatId: ADMIN.id }));
  await t.send('store', textUpdate(ADMIN, text));
  await t.send('store', callbackUpdate(ADMIN, 'announce_schedule', { chatId: ADMIN.id }));
  await t.send('store', textUpdate(ADMIN, when));
}

describe('scheduled announcements: queue', () => {
  it('is not sent before its time and is sent after', async () => {
    const { t, clock } = setup();
    await schedule(t, jal(min(30)));
    expect(jobs(t)).toHaveLength(1);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('زمان‌بندی شد (همه مشتری‌ها)');
    await t.cron(NOW);
    clock.now = min(29);
    await t.cron(clock.now);
    expect(got(t, 'SALE SOON')).toHaveLength(0);
    clock.now = min(31);
    await t.cron(clock.now);
    expect(got(t, 'SALE SOON').sort()).toEqual([100, 101, 102]);
    expect(jobs(t)[0].status).toBe('done');
  });

  it('a future job does not block an immediate job queued after it', async () => {
    const { t } = setup();
    await schedule(t, jal(min(60)), 'LATER');
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_all', { chatId: ADMIN.id }));
    await t.send('store', textUpdate(ADMIN, 'NOW'));
    await t.send('store', callbackUpdate(ADMIN, 'announce_confirm', { chatId: ADMIN.id }));
    await t.cron(NOW);
    expect(got(t, 'NOW')).toHaveLength(3);
    expect(got(t, 'LATER')).toHaveLength(0);
  });

  it('total is recomputed when the scheduled job starts', async () => {
    const { t, clock } = setup(3);
    await schedule(t, jal(min(10)));
    expect(jobs(t)[0].total).toBe(3);
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (500, 'n1'), (501, 'n2')");
    clock.now = min(11);
    await t.cron(clock.now);
    expect(jobs(t)[0].total).toBe(5);
    expect(got(t, 'SALE SOON')).toHaveLength(5);
  });
});

describe('scheduled announcements: wizard', () => {
  it('rejects bad, past and too-far times and re-asks', async () => {
    const { t } = setup();
    await schedule(t, 'garbage');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('زمان نامعتبر است');
    await t.send('store', textUpdate(ADMIN, jal(min(-5))));
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ این زمان گذشته است.');
    await t.send('store', textUpdate(ADMIN, jal(new Date(NOW.getTime() + 15 * 86_400_000))));
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ حداکثر ۱۴ روز جلوتر.');
    expect(jobs(t)).toHaveLength(0);
    await t.send('store', textUpdate(ADMIN, jal(min(90))));
    expect(jobs(t)).toHaveLength(1);
  });

  it('accepts Persian digits and keeps the immediate path unchanged', async () => {
    const { t } = setup();
    await schedule(t, jal(min(45)).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d))));
    expect(jobs(t)[0].send_after).toBe(tehranDateTime(min(45)).slice(0, 16) + ':00');
    const confirm = t.tg.of('sendMessage', ADMIN.id).find((c) => JSON.stringify(c.payload.reply_markup ?? '').includes('announce_confirm'))!;
    expect(JSON.stringify(confirm.payload.reply_markup)).toContain('⏰ زمان‌بندی ارسال');
  });
});

describe('scheduled announcements: list and cancel', () => {
  it('lists waiting jobs from the first keyboard and cancels before start', async () => {
    const { t } = setup();
    await schedule(t, jal(min(60)), 'A long announcement text that goes beyond forty characters for sure');
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_sched_list', { chatId: ADMIN.id }));
    const list = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(list.text).toContain('🗓 اطلاعیه‌های زمان‌بندی‌شده');
    expect(list.text).toContain(jal(min(60)));
    expect(list.text).toContain('A long announcement text that goes beyon…');
    expect(list.text).not.toContain('for sure');
    const cb = list.reply_markup.inline_keyboard[0][0].callback_data as string;
    expect(cb).toMatch(/^ann_sched_cancel_\d+$/);
    await t.send('store', callbackUpdate(ADMIN, cb, { chatId: ADMIN.id }));
    expect(jobs(t)[0]).toMatchObject({ status: 'done', cancelled: 1 });
    await t.cron(min(61));
    expect(got(t, 'A long announcement text that goes beyond forty characters for sure')).toHaveLength(0);
  });

  it('cancel works while the admin is inside another wizard (stage bypass)', async () => {
    const { t } = setup();
    await schedule(t, jal(min(60)));
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_sched_cancel_1', { chatId: ADMIN.id }));
    expect(jobs(t)[0].cancelled).toBe(1);
  });

  it('a started job cannot be cancelled', async () => {
    const { t, clock } = setup(100);
    await schedule(t, jal(min(10)));
    clock.now = min(11);
    await t.cron(clock.now); // first batch goes out, cursor moves
    expect(jobs(t)[0].cur).toBeGreaterThan(0);
    await t.send('store', callbackUpdate(ADMIN, 'ann_sched_cancel_1', { chatId: ADMIN.id }));
    expect(jobs(t)[0].cancelled).toBe(0);
    const ans = t.tg.of('answerCallbackQuery').at(-1)!.payload;
    expect(ans.text).toContain('شروع شده و دیگر قابل لغو نیست');
  });

  it('a due job whose first batch is on its way (cursor still 0) cannot be cancelled either', async () => {
    const { t, clock } = setup();
    await schedule(t, jal(min(10)));
    clock.now = min(11); // due; no cron tick has moved the cursor yet
    expect(jobs(t)[0].cur).toBe(0);
    await t.send('store', callbackUpdate(ADMIN, 'ann_sched_cancel_1', { chatId: ADMIN.id }));
    expect(jobs(t)[0]).toMatchObject({ status: 'running', cancelled: 0 });
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('شروع شده و دیگر قابل لغو نیست');
    await t.cron(clock.now);
    expect(got(t, 'SALE SOON')).toHaveLength(3);
  });

  it('non-admins cannot cancel; an empty list says so', async () => {
    const { t } = setup();
    await schedule(t, jal(min(60)));
    await t.send('store', callbackUpdate({ id: 77, first_name: 'X' }, 'ann_sched_cancel_1'));
    expect(jobs(t)[0].cancelled).toBe(0);
    q(t.storeDb, "UPDATE broadcast_jobs SET status = 'done'");
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_sched_list', { chatId: ADMIN.id }));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('وجود ندارد');
  });
});
