/** The logged-in Eitaa account, kept in Monshi's app_state; the token is AES-GCM encrypted (it opens the whole account). */
import type { MonshiApp } from '../../apps';
import type { Credentials } from './client';

const SESSION_KEY = 'eitaa_session';
export const LOGIN_KEY = 'eitaa_login';

export interface EitaaSession extends Credentials {
  me: { id: string; name: string };
  /** updates cursor; absent until the first poll sets the baseline */
  pts?: number;
  date?: number;
  qts?: number;
  /** highest message id already handed to the owner */
  lastId?: number;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(app: MonshiApp): Promise<CryptoKey> {
  const secret = app.apps.env.WEBHOOK_SECRET;
  if (!secret) throw new Error('WEBHOOK_SECRET is not set');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eitaa-token:' + secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(app: MonshiApp, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(app), new TextEncoder().encode(text)));
  return b64(iv) + '.' + b64(ct);
}

async function decrypt(app: MonshiApp, value: string): Promise<string> {
  const [iv, ct] = value.split('.').map(unb64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(app), ct));
}

export async function loadSession(app: MonshiApp): Promise<EitaaSession | null> {
  const raw = await app.ctx.getState(SESSION_KEY);
  if (!raw) return null;
  const { token_enc, ...rest } = JSON.parse(raw);
  try {
    return { ...rest, token: await decrypt(app, token_enc) };
  } catch {
    console.error('❌ [Eitaa] stored token cannot be decrypted (WEBHOOK_SECRET changed?) — log in again');
    return null;
  }
}

export async function saveSession(app: MonshiApp, s: EitaaSession): Promise<void> {
  const { token, ...rest } = s;
  await app.ctx.setState(SESSION_KEY, JSON.stringify({ ...rest, token_enc: await encrypt(app, token) }));
}

export async function clearSession(app: MonshiApp): Promise<void> {
  await app.ctx.deleteState(SESSION_KEY);
}
