/**
 * Minimal Eitaa user-account client: every call is one HTTPS POST of a TL-serialized `eitaaObject` (token, imei,
 * packed method) — no MTProto encryption or open socket, so it runs inside the Worker and new messages are polled.
 * Unofficial (the Eitaa web client's protocol): it can break if Eitaa changes it.
 */
import type { MonshiApp } from '../../apps';
import { updateSession, type EitaaSession } from './session';
import { TLDeserialization, TLSerialization } from './tl/tl_utils.js';

export const EITAA_BCID = 'eitaa';
const ENDPOINT = 'https://hasan.eitaa.ir/eitaa/';
const LAYER = 133;
// public web-client identity (the same one EitaaBun uses)
export const API_ID = 1025907;
export const API_HASH = '452b0359b988148995f22ff0f4229750';

/** Eitaa customers live next to Telegram ones under negative chat ids (Telegram business chats are always > 0). */
export const eitaaChatId = (userId: number | string): number => -Number(userId);
export const isEitaaChat = (chatId: number): boolean => chatId < 0;
export const eitaaUserId = (chatId: number): string => String(-chatId);

export class EitaaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EitaaError';
  }
}

export interface Credentials { token: string; imei: string }

export function newImei(): string {
  const l = () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  const d = () => String(Math.floor(Math.random() * 10));
  return Array.from({ length: 8 }, l).join('') + d() + d() + d() + l() + l() + d() + l() + '__web';
}

export const randomLong = (): string => String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

export function encodeCall(cred: Credentials, method: string, params: Record<string, unknown>): Uint8Array {
  const inner = new TLSerialization({ mtproto: false });
  inner.storeMethod(method, params);
  const outer = new TLSerialization({ mtproto: false });
  outer.storeMethod('eitaaObject', { token: cred.token, imei: cred.imei, packed_data: inner.getBytes(true), layer: LAYER });
  return outer.getBytes(true);
}

export function decodeResponse(buf: Uint8Array): any {
  const obj = new TLDeserialization(buf, { mtproto: true }).fetchObject('', 'INPUT');
  if (obj?.packed_data) return new TLDeserialization(new Uint8Array(obj.packed_data), { mtproto: true }).fetchObject('', 'INPUT');
  return obj;
}

async function rawCall(app: MonshiApp, cred: Credentials, method: string, params: Record<string, unknown>): Promise<any> {
  app.apps.budget.take();
  let out;
  // cleared once the call is done: a timer left pending can keep the fast poller's Durable Object active (billed time)
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new DOMException('The operation timed out.', 'TimeoutError')), 15000);
  try {
    const res = await app.apps.fetch(ENDPOINT, { method: 'POST', body: encodeCall(cred, method, params), signal: abort.signal });
    if (!res.ok) throw new EitaaError('HTTP ' + res.status);
    out = decodeResponse(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    // network, timeout, a blocked IP or an undecodable reply: all must reach the owner's alert, not just the log
    if (err instanceof EitaaError) throw err;
    throw new EitaaError((err instanceof Error ? err.name + ': ' + err.message : String(err)).slice(0, 150));
  } finally {
    clearTimeout(timer);
  }
  if (out?._ === 'rpc_error' || out?._ === 'error') throw new EitaaError(String(out.error_message ?? out.text ?? 'rpc_error'));
  return out;
}

/**
 * One API call (counts one subrequest). Throws EitaaError on an rpc error. A logged-in session's token expires
 * after a while: Eitaa then answers any call with eitaa_updates_expire_token → renew it, save it, retry once.
 */
export async function call(app: MonshiApp, cred: Credentials, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const out = await rawCall(app, cred, method, params);
  // the deserializer may camelCase these Eitaa-only predicates (eitaa_updates_expire_token → eitaaUpdatesExpireToken)
  const kind = String(out?._ ?? '').replace(/_(\w)/g, (_m, c) => c.toUpperCase());
  if (kind !== 'eitaaUpdatesExpireToken' || !('me' in cred)) return out;
  const r = await rawCall(app, cred, 'eitaaRefreshToken', {
    app_info: { _: 'eitaaAppInfo', build_version: 0, device_model: 'Web', system_version: 'Chrome', app_version: '4.6.2 K', lang_code: 'fa', sign: '' },
  });
  if (!/^eitaa_?[uU]pdates_?[tT]oken$/.test(r?._ ?? '') || !r.token) throw new EitaaError('token refresh failed: ' + r?._);
  // only the token field is written, and only while this login is still the stored one
  await updateSession(app, cred as EitaaSession, { token: r.token });
  console.log('🔑 [Eitaa] token renewed');
  return rawCall(app, cred, method, params);
}

/** «media» of an incoming message → the bot's message_type names. */
export function messageType(m: any): string {
  const media = m.media?._;
  if (!media || media === 'messageMediaEmpty' || media === 'messageMediaWebPage') return 'text';
  if (media === 'messageMediaPhoto') return 'photo';
  if (media === 'messageMediaContact') return 'contact';
  if (media === 'messageMediaGeo' || media === 'messageMediaVenue') return 'location';
  if (media !== 'messageMediaDocument') return 'other';
  const attrs: any[] = m.media.document?.attributes ?? [];
  const audio = attrs.find((a) => a._ === 'documentAttributeAudio');
  if (audio) return audio.pFlags?.voice ? 'voice' : 'audio';
  if (attrs.some((a) => a._ === 'documentAttributeSticker')) return 'sticker';
  if (attrs.some((a) => a._ === 'documentAttributeVideo')) return 'video';
  return 'document';
}
