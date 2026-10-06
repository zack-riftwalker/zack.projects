import { describe, expect, it } from 'vitest';
import { Bot, session } from 'grammy';
import { FakeD1 } from './helpers/fakeD1';
import { Budget, BudgetExceededError, countedD1 } from '../src/lib/budget';
import { D1SessionStorage } from '../src/lib/session';
import { Stage, WizardScene, type SceneSession, type WizardFlavor } from '../src/lib/wizard';
import { formatJalaliDate, formatJalaliDateTime, formatTehran, parseJalaliDateTime, parseLocalDateTime, tehranParts, utcIsoNow } from '../src/lib/time';
import { textUpdate } from './helpers/updates';

describe('Budget & counted D1', () => {
  it('counts queries and batch statements, throws past the limit, maps undefined to null', async () => {
    const f = new FakeD1().migrate('store');
    const b = new Budget(5);
    const db = countedD1(f.asD1(), b);
    await db.prepare('SELECT 1').first();
    await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')]);
    expect(b.used).toBe(3);
    await db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').bind('a', undefined).run();
    expect(f.sqlite.prepare("SELECT value FROM app_state WHERE key='a'").get()).toEqual({ value: null });
    expect(() => b.take(5)).toThrow(BudgetExceededError);
    expect(b.exceeded).toBe(true);
    b.exceeded = false; // keep the global afterEach assertion honest for this deliberate overflow
    b.used = 0;
  });
});

describe('D1 session storage', () => {
  it('skips empty and unchanged writes', async () => {
    const f = new FakeD1().migrate('store');
    const budget = new Budget(50);
    const store = new D1SessionStorage<any>(countedD1(f.asD1(), budget));
    expect(await store.read('k')).toBeUndefined();
    await store.write('k', {});
    expect(f.log.filter((s) => s.startsWith('INSERT INTO sessions'))).toHaveLength(0);
    await store.write('k', { a: 1 });
    expect(f.log.filter((s) => s.startsWith('INSERT INTO sessions'))).toHaveLength(1);

    const again = new D1SessionStorage<any>(countedD1(f.asD1(), budget));
    expect(await again.read('k')).toEqual({ a: 1 });
    await again.write('k', { a: 1 });
    expect(f.log.filter((s) => s.startsWith('INSERT INTO sessions'))).toHaveLength(1);
    await again.write('k', { a: 2 });
    expect(f.log.filter((s) => s.startsWith('INSERT INTO sessions'))).toHaveLength(2);
  });
});

type Ctx = import('grammy').Context & import('grammy').SessionFlavor<SceneSession> & WizardFlavor;

describe('wizard framework', () => {
  function build() {
    const f = new FakeD1().migrate('store');
    const sent: string[] = [];
    const scene = new WizardScene<Ctx>(
      'demo',
      async (ctx) => { await ctx.reply('step0'); return ctx.wizard.next(); },
      async (ctx) => {
        if (!ctx.message?.text) return;
        ctx.wizard.state.name = ctx.message.text;
        await ctx.reply('step1 got ' + ctx.message.text);
        return ctx.wizard.next();
      },
      async (ctx) => { await ctx.reply('done ' + ctx.wizard.state.name); return ctx.scene.leave(); },
    );
    scene.command('cancel', async (ctx) => { await ctx.reply('cancelled'); return ctx.scene.leave(); });
    scene.hears(/^(لغو|cancel)$/i, async (ctx) => { await ctx.reply('cancelled2'); return ctx.scene.leave(); });
    const make = () => {
      const bot = new Bot<Ctx>('t', { botInfo: { id: 1, is_bot: true, first_name: 'b', username: 'b_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_manage_bots: false } as any });
      bot.api.config.use(async (_p, method, payload: any) => {
        if (method === 'sendMessage') sent.push(payload.text);
        return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, text: payload.text } } as any;
      });
      bot.use(session({ initial: () => ({}), storage: new D1SessionStorage<any>(countedD1(f.asD1(), new Budget(50))), getSessionKey: (c) => (c.from ? String(c.from.id) : undefined) }));
      bot.use(new Stage<Ctx>([scene]).middleware());
      bot.command('go', (ctx) => ctx.scene.enter('demo'));
      bot.on('message', (ctx) => ctx.reply('outside'));
      return bot;
    };
    const U = { id: 1 };
    const send = async (text: string) => { await make().handleUpdate(textUpdate(U, text)); };
    return { send, sent, f };
  }

  it('enter runs step 0 immediately; steps advance across separate requests; leave clears', async () => {
    const { send, sent } = build();
    await send('/go');
    await send('Ali');
    await send('anything');
    await send('hi');
    expect(sent).toEqual(['step0', 'step1 got Ali', 'done Ali', 'outside']);
  });

  it('scene-level /cancel and cancel words win; an active scene consumes unrelated updates', async () => {
    const { send, sent } = build();
    await send('/go');
    await send('/cancel');
    await send('after');
    await send('/go');
    await send('لغو');
    await send('/go');
    await send('/something');
    expect(sent).toEqual(['step0', 'cancelled', 'outside', 'step0', 'cancelled2', 'step0', 'step1 got /something']);
  });
});

describe('time helpers', () => {
  it('tehranParts uses a fixed +03:30 offset', () => {
    expect(tehranParts(new Date('2026-10-06T07:30:00Z'))).toMatchObject({ y: 2026, m: 10, d: 6, hour: 11, minute: 0, weekdayKey: 'tue', day: '2026-10-06' });
    expect(tehranParts(new Date('2026-10-06T21:00:00Z'))).toMatchObject({ d: 7, hour: 0, minute: 30, weekdayKey: 'wed' });
  });
  it('utcIsoNow is Python-isoformat compatible', () => {
    expect(utcIsoNow(new Date('2026-10-06T12:00:00.123Z'))).toBe('2026-10-06T12:00:00.123000+00:00');
  });
  it('Jalali parsing/formatting round-trips and rejects bad input', () => {
    const g = parseJalaliDateTime('۱۴۰۵/۰۷/۱۴ 14:30');
    expect(g).toBe('2026-10-06 14:30:00');
    expect(formatJalaliDateTime(g!)).toBe('1405/07/14 14:30');
    expect(formatJalaliDate(g!)).toBe('1405/07/14');
    expect(parseJalaliDateTime('1405/13/01 10:00')).toBeNull();
    expect(parseJalaliDateTime('garbage')).toBeNull();
    expect(parseJalaliDateTime('1405/07/14 25:00')).toBeNull();
  });
  it('parseLocalDateTime reads Tehran wall-clock regardless of host tz', () => {
    expect(parseLocalDateTime('2026-10-06 11:00:00')).toBe(Date.UTC(2026, 9, 6, 7, 30));
    expect(parseLocalDateTime('nope')).toBeNull();
  });
  it('formatTehran renders stored UTC timestamps in Jalali Tehran time', () => {
    expect(formatTehran('2026-10-06T07:30:00+00:00')).toBe('1405/07/14 11:00');
    expect(formatTehran('2026-10-06T07:30:00.123456+00:00', false)).toBe('1405/07/14');
  });
});
