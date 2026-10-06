import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER } from '../helpers/env';
import { businessMessageUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, connect, setHours, setSetting } from '../helpers/monshi';

// 2026-10-03 is a Saturday. Tehran = UTC+3:30 → 06:00Z = 09:30 Tehran.
const sat = (utcH: number, utcM = 0) => new Date(Date.UTC(2026, 9, 3, utcH, utcM));

describe('monshi weekly digest (cron)', () => {
  it('Saturday 09:xx Tehran sends once to every notify account; other days/hours do not', async () => {
    const t = makeTestEnv({ store: false, notify: '6001' });
    await connect(t);
    setHours(t, 'open');
    setSetting(t, 'greeting_enabled', '0');
    await t.send('monshi', businessMessageUpdate(CUST, 'ارسال دارید؟'));
    t.tg.reset();

    await t.cron(new Date(Date.UTC(2026, 9, 4, 6, 0))); // Sunday 09:30
    await t.cron(sat(8, 0)); // Saturday 11:30 Tehran
    expect(t.tg.of('sendMessage')).toHaveLength(0);

    await t.cron(sat(6, 0));
    const sent = t.tg.of('sendMessage');
    expect(sent.map((c) => c.payload.chat_id)).toEqual([OWNER.id, 6001]);
    expect(sent[0].payload.text).toContain('📊 دایجست هفتگی (۷ روز اخیر)');
    expect(sent[0].payload.text).toContain('✉️ پیام‌های دریافتی: 1');
    expect(sent[0].payload.text).toContain('پرتکرارترین سوالات بی‌جواب');
    expect(sent[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('utofaq:1');
    expect(one(t.monshiDb, "SELECT value FROM app_state WHERE key='last_digest_day'").value).toBe('2026-10-03');

    await t.cron(sat(6, 1));
    expect(t.tg.of('sendMessage')).toHaveLength(2); // latch
  });

  it('respects digest_enabled = 0', async () => {
    const t = makeTestEnv({ store: false });
    setSetting(t, 'digest_enabled', '0');
    await t.cron(sat(6, 0));
    expect(t.tg.of('sendMessage')).toHaveLength(0);
  });

  it('digest content: unused FAQs and open orders are listed', async () => {
    const t = makeTestEnv({ store: false });
    q(t.monshiDb, "INSERT INTO faqs (question, answer, created_at, updated_at) VALUES ('سوال بدون استفاده', 'a', 'x', 'x')");
    q(t.monshiDb, "INSERT INTO orders (chat_id, title, status) VALUES (1, 'T', 'paid')");
    await t.cron(sat(6, 0));
    const text = t.tg.of('sendMessage')[0].payload.text as string;
    expect(text).toContain('🛒 سفارش‌های باز مانده: 1');
    expect(text).toContain('📚 FAQهای بدون استفاده در ۷ روز اخیر (1):');
    expect(text).toContain('  • #1 سوال بدون استفاده');
  });
});
