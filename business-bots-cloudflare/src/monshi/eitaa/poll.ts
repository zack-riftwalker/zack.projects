/**
 * Stage 1 of Monshi on Eitaa: every cron minute pull new private messages of the logged-in Eitaa account and hand
 * each customer message to the owner (same notification + reply bridge as Telegram). No automatic replies yet.
 */
import type { MonshiApp } from '../../apps';
import { notifyAdmin } from '../handlers/business';
import { notifyAll } from '../handlers/common';
import { utcIsoNow } from '../../lib/time';
import { call, EITAA_BCID, eitaaChatId, eitaaUserId, EitaaError, messageType, randomLong } from './client';
import { loadSession, SESSION_KEY, updateSession, type EitaaSession } from './session';

/**
 * Worst-case subrequests for one customer message: saveMessage, saveEitaaPeer, upsertCustomer (3-statement batch),
 * then per staff account one send + one notify-link statement, plus creating its topic (2) when topics are on.
 */
function perMessageBudget(app: MonshiApp, topics: boolean): number {
  return 5 + app.cfg.allNotifyIds.length * (topics ? 4 : 2);
}

// subrequests left for the jobs that run after this poll in the same cron tick
const CRON_RESERVE = 15;

// Eitaa's own service account (Telegram's id; Eitaa is a fork — unverified): its «your login code is …» must never be
// shown to staff or stored. The flags and the text check below catch it if the id differs.
const SERVICE_USER_IDS = new Set(['777000']);
const LOGIN_CODE_TEXT = /(کد|code)[^\n]{0,40}(ورود|login|تایید|تأیید)[\s\S]{0,80}ایتا|eitaa[\s\S]{0,80}(login|verification) code/i;

/** Owner gets one Telegram alert per day while the Eitaa connection keeps failing. */
async function alertOnce(app: MonshiApp, err: unknown): Promise<void> {
  const day = utcIsoNow(app.apps.now()).slice(0, 10);
  if ((await app.ctx.getState('eitaa_alert_day')) === day) return;
  const reason = err instanceof Error ? err.message : String(err);
  const sent = await notifyAll(app, '⚠️ اتصال منشی به ایتا خطا دارد: ' + reason.slice(0, 200) + '\n\nاگر ادامه داشت دوباره وصل شوید: /eitaa', undefined, 'system');
  if (sent.length) await app.ctx.setState('eitaa_alert_day', day); // nobody got it → try again next minute
}

export async function pollEitaa(app: MonshiApp): Promise<void> {
  const s = await loadSession(app);
  if (!s) {
    // a stored session that can't be decrypted (WEBHOOK_SECRET changed) must not go quiet
    if (await app.ctx.getState(SESSION_KEY)) await alertOnce(app, new EitaaError('توکن ذخیره‌شده قابل رمزگشایی نیست'));
    return;
  }
  try {
    if (s.pts === undefined) {
      // normally set at login; this is the fallback when that call failed
      await resetCursor(app, s);
      return;
    }
    const diff = await call(app, s, 'updates.getDifference', { flags: 0, pts: s.pts, date: s.date, qts: s.qts });
    if (diff._ === 'updates.differenceEmpty') return;
    if (diff._ === 'updates.differenceTooLong') {
      // Eitaa won't list what was missed: start over from now and tell the owner to look in the app
      await resetCursor(app, s);
      await notifyAll(app, '⚠️ تعداد پیام‌های عقب‌افتاده‌ی ایتا خیلی زیاد بود و ایتا آن‌ها را تحویل نداد.\nممکن است چند پیام اینجا نیامده باشد؛ لطفاً داخل اپ ایتا چک کنید.', undefined, 'system');
      return;
    }
    // anything else unknown must alert instead of silently stopping (that's how an expired token went unnoticed)
    const next = diff.state ?? diff.intermediate_state;
    if ((diff._ !== 'updates.difference' && diff._ !== 'updates.differenceSlice') || !next) {
      throw new EitaaError('unexpected getDifference reply: ' + diff._);
    }
    const users = new Map<string, any>((diff.users ?? []).map((u: any) => [String(u.id), u]));
    const need = perMessageBudget(app, (await app.ctx.getSetting('topics_enabled')) === '1');
    // message ids only grow, so lastId marks what's done: a big backlog advances a few messages per minute
    // without re-reading the handled ones, and the cursor moves once all of them are through
    const todo = (diff.new_messages ?? []).filter((m: any) => m.id > (s.lastId ?? 0)).sort((a: any, b: any) => a.id - b.id);
    for (const m of todo) {
      // +1: the cursor write after the loop; the rest of the cron (store jobs, broadcast) keeps its share
      if (app.apps.budget.remaining() < need + 1 + CRON_RESERVE) return void (await updateSession(app, s, { lastId: s.lastId }));
      // not delivered to anyone: keep it for the next minute
      if (!(await handleMessage(app, s.me.id, m, users))) return void (await updateSession(app, s, { lastId: s.lastId }));
      s.lastId = m.id;
    }
    await updateSession(app, s, { pts: next.pts, date: next.date, qts: next.qts, lastId: s.lastId });
  } catch (err) {
    console.error('❌ [Eitaa] poll failed:', err instanceof Error ? err.message : err);
    if (err instanceof EitaaError) await alertOnce(app, err);
    else throw err;
  }
}

/** Updates cursor = «now» (old history is not imported). */
export async function resetCursor(app: MonshiApp, s: EitaaSession): Promise<void> {
  const st = await call(app, s, 'updates.getState');
  await updateSession(app, s, { pts: st.pts, date: st.date, qts: st.qts });
}

/** false = a customer message that reached no staff account (its row is removed so the next poll retries it). */
async function handleMessage(app: MonshiApp, meId: string, m: any, users: Map<string, any>): Promise<boolean> {
  // private chats with real users only (no groups/channels, service messages or «saved messages»)
  if (m._ !== 'message' || m.peer_id?._ !== 'peerUser') return true;
  const userId = String(m.peer_id.user_id);
  if (userId === meId) return true;
  const user = users.get(userId);
  const text: string | null = m.message || null;
  if (SERVICE_USER_IDS.has(userId) || user?.pFlags?.bot || user?.pFlags?.support || user?.pFlags?.verified) return true;
  if (!m.pFlags?.out && text && LOGIN_CODE_TEXT.test(text)) return true;
  const chatId = eitaaChatId(userId);
  const type = messageType(m);
  // the reply bridge needs the peer's access hash, whoever wrote first
  if (user?.access_hash) await app.db.saveEitaaPeer(userId, String(user.access_hash));

  if (m.pFlags?.out) {
    // the owner typed in the Eitaa app (or it's our own bridge reply, already stored)
    if (await app.db.saveMessage(chatId, m.id, 'owner', type, text, EITAA_BCID)) await app.db.markChatAnsweredByHuman(chatId);
    return true;
  }
  const rowId = await app.db.saveMessage(chatId, m.id, 'in', type, text, EITAA_BCID);
  if (!rowId) return true; // already handled
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;
  const { customer } = await app.db.upsertCustomer(chatId, null, user?.username ?? null, name);
  const delivered = await notifyAdmin(app, { id: Number(userId), first_name: name ?? undefined, username: user?.username }, chatId, type, text, 'پیام جدید', customer);
  if (delivered) return true;
  await app.db.deleteMessageRow(rowId);
  return false;
}

/** Text from the owner (reply bridge) to an Eitaa customer; returns the Eitaa message id. */
export async function sendEitaaText(app: MonshiApp, chatId: number, text: string): Promise<number> {
  const s = await loadSession(app);
  if (!s) throw new EitaaError('ایتا وصل نیست (/eitaa)');
  const userId = eitaaUserId(chatId);
  const accessHash = await app.db.getEitaaAccessHash(userId);
  if (!accessHash) throw new EitaaError('اطلاعات تماس این مشتری در ایتا ذخیره نشده؛ این بار از خود اپ ایتا جواب دهید');
  const r = await call(app, s, 'messages.sendMessage', {
    flags: 0, peer: { _: 'inputPeerUser', user_id: userId, access_hash: accessHash }, message: text, random_id: randomLong(),
  }).catch((err) => {
    // a hash saved under another Eitaa login is useless; the customer's next message stores a fresh one
    if (/PEER_ID_INVALID|ACCESS_HASH/i.test(err?.message ?? '')) throw new EitaaError('اطلاعات تماس این مشتری قدیمی است؛ از خود اپ ایتا جواب دهید (با پیام بعدی مشتری درست می‌شود)');
    throw err;
  });
  const id = r.id ?? r.updates?.find((u: any) => u._ === 'updateMessageID')?.id;
  // unknown id: store under a unique negative one so the row can't collide with a real message
  return typeof id === 'number' ? id : -Date.now();
}
