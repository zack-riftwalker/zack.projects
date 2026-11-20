/**
 * Stage 1 of Monshi on Eitaa: every cron minute pull new private messages of the logged-in Eitaa account and hand
 * each customer message to the owner (same notification + reply bridge as Telegram). No automatic replies yet.
 */
import type { MonshiApp } from '../../apps';
import { notifyAdmin } from '../handlers/business';
import { notifyAll } from '../handlers/common';
import { utcIsoNow } from '../../lib/time';
import { call, EITAA_BCID, eitaaChatId, eitaaUserId, EitaaError, messageType, randomLong } from './client';
import { loadSession, saveSession } from './session';

// one customer message costs ~10 subrequests (D1 + notifications to every staff account)
const PER_MESSAGE_BUDGET = 12;

/** Owner gets one Telegram alert per day while the Eitaa connection keeps failing. */
async function alertOnce(app: MonshiApp, err: unknown): Promise<void> {
  const day = utcIsoNow(app.apps.now()).slice(0, 10);
  if ((await app.ctx.getState('eitaa_alert_day')) === day) return;
  await app.ctx.setState('eitaa_alert_day', day);
  const reason = err instanceof Error ? err.message : String(err);
  await notifyAll(app, '⚠️ اتصال منشی به ایتا خطا دارد: ' + reason.slice(0, 200) + '\n\nاگر ادامه داشت دوباره وصل شوید: /eitaa', undefined, 'system');
}

export async function pollEitaa(app: MonshiApp): Promise<void> {
  const s = await loadSession(app);
  if (!s) return;
  try {
    if (s.pts === undefined) {
      // first run after login: start from now, old history is not imported
      const st = await call(app, s, 'updates.getState');
      await saveSession(app, { ...s, pts: st.pts, date: st.date, qts: st.qts });
      return;
    }
    const diff = await call(app, s, 'updates.getDifference', { flags: 0, pts: s.pts, date: s.date, qts: s.qts });
    if (diff._ === 'updates.differenceEmpty') return;
    // anything else unknown must alert instead of silently stopping (that's how an expired token went unnoticed)
    if (diff._ !== 'updates.difference' && diff._ !== 'updates.differenceSlice' && diff._ !== 'updates.differenceTooLong') {
      throw new EitaaError('unexpected getDifference reply: ' + diff._);
    }
    if (diff._ === 'updates.differenceTooLong') {
      console.warn('⚠️ [Eitaa] differenceTooLong — skipping ahead');
      await saveSession(app, { ...s, pts: diff.pts });
      return;
    }
    const users = new Map<string, any>((diff.users ?? []).map((u: any) => [String(u.id), u]));
    // message ids only grow, so lastId marks what's done: a big backlog advances a few messages per minute
    // without re-reading the handled ones, and the cursor moves once all of them are through
    const todo = (diff.new_messages ?? []).filter((m: any) => m.id > (s.lastId ?? 0)).sort((a: any, b: any) => a.id - b.id);
    for (const m of todo) {
      if (app.apps.budget.remaining() < PER_MESSAGE_BUDGET) {
        await saveSession(app, s);
        return;
      }
      await handleMessage(app, s.me.id, m, users);
      s.lastId = m.id;
    }
    const next = diff.state ?? diff.intermediate_state;
    if (next) await saveSession(app, { ...s, pts: next.pts, date: next.date, qts: next.qts });
  } catch (err) {
    console.error('❌ [Eitaa] poll failed:', err instanceof Error ? err.message : err);
    if (err instanceof EitaaError) await alertOnce(app, err);
    else throw err;
  }
}

async function handleMessage(app: MonshiApp, meId: string, m: any, users: Map<string, any>): Promise<void> {
  // private chats with real users only (no groups/channels, service messages or «saved messages»)
  if (m._ !== 'message' || m.peer_id?._ !== 'peerUser') return;
  const userId = String(m.peer_id.user_id);
  if (userId === meId) return;
  const chatId = eitaaChatId(userId);
  const type = messageType(m);
  const text: string | null = m.message || null;

  if (m.pFlags?.out) {
    // the owner typed in the Eitaa app (or it's our own bridge reply, already stored)
    if (await app.db.saveMessage(chatId, m.id, 'owner', type, text, EITAA_BCID)) await app.db.markChatAnsweredByHuman(chatId);
    return;
  }
  if (!(await app.db.saveMessage(chatId, m.id, 'in', type, text, EITAA_BCID))) return; // already handled
  const user = users.get(userId);
  if (user?.access_hash) await app.db.saveEitaaPeer(userId, String(user.access_hash));
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;
  const { customer } = await app.db.upsertCustomer(chatId, null, user?.username ?? null, name);
  await notifyAdmin(app, { id: Number(userId), first_name: name ?? undefined, username: user?.username }, chatId, type, text, 'پیام جدید', customer);
}

/** Text from the owner (reply bridge) to an Eitaa customer; returns the Eitaa message id. */
export async function sendEitaaText(app: MonshiApp, chatId: number, text: string): Promise<number> {
  const s = await loadSession(app);
  if (!s) throw new EitaaError('ایتا وصل نیست (/eitaa)');
  const userId = eitaaUserId(chatId);
  const accessHash = (await app.db.getEitaaAccessHash(userId)) ?? '0';
  const r = await call(app, s, 'messages.sendMessage', {
    flags: 0, peer: { _: 'inputPeerUser', user_id: userId, access_hash: accessHash }, message: text, random_id: randomLong(),
  });
  const id = r.id ?? r.updates?.find((u: any) => u._ === 'updateMessageID')?.id;
  // unknown id: store under a unique negative one so the row can't collide with a real message
  return typeof id === 'number' ? id : -Date.now();
}
