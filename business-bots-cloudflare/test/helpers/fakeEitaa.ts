import { TLDeserialization, TLSerialization } from '../../src/monshi/eitaa/tl/tl_utils.js';
import { Specs } from '../../src/monshi/eitaa/tl/specs.js';

export interface EitaaCall { method: string; token: string; raw: Uint8Array }

function encode(obj: any): Uint8Array {
  const inner = new TLSerialization({ mtproto: obj._ === 'rpc_error' }) as any;
  inner.storeObject(obj, 'Object', 'resp');
  const outer = new TLSerialization({ mtproto: false }) as any;
  outer.storeObject({ _: 'eitaaObject', token: '', imei: '', packed_data: inner.getBytes(true), layer: 133 }, 'Object', 'wrap');
  return outer.getBytes(true);
}

/** Fake Eitaa endpoint: decodes which method was called and answers from per-method queues (in order). */
export function fakeEitaa() {
  const calls: EitaaCall[] = [];
  const queues: Record<string, any[]> = {};
  const fetchImpl = (async (input: any, init?: any) => {
    if (!String(input).includes('eitaa')) throw new Error('unexpected fetch ' + input);
    const outer = new TLDeserialization(new Uint8Array(init.body), { mtproto: true }).fetchObject('', 'INPUT');
    const raw = new Uint8Array(outer.packed_data);
    const id = new DataView(raw.buffer).getInt32(0, true);
    const method = Specs.API.methods.find((m) => m.id === id)?.method ?? 'unknown:' + id;
    calls.push({ method, token: outer.token, raw });
    const r = queues[method]?.shift();
    if (!r) throw new Error('fakeEitaa: no response queued for ' + method);
    return new Response(encode(r));
  }) as typeof fetch;
  return {
    calls,
    fetch: fetchImpl,
    respond(method: string, ...objs: any[]) { (queues[method] ??= []).push(...objs); },
    methods: () => calls.map((c) => c.method),
    /** the request bytes contain this UTF-8 text (TL strings are stored inline) */
    sent: (c: EitaaCall, text: string) => Buffer.from(c.raw).includes(Buffer.from(text)),
  };
}

export const state = (pts: number) => ({ _: 'updates.state', pts, qts: 0, date: 1794845973 + pts, seq: 0, unread_count: 0 });
export const eUser = (id: number, first_name: string, username?: string) =>
  ({ _: 'user', flags: 1 | 2 | (username ? 8 : 0), id: String(id), access_hash: '777' + id, first_name, username });
export const peerUser = (id: number) => ({ _: 'peerUser', user_id: String(id) });
export const eMsg = (id: number, peer: any, text: string, out = false) =>
  ({ _: 'message', flags: out ? 2 : 0, id, peer_id: peer, date: 1794846000, message: text });
export const difference = (pts: number, messages: any[], users: any[] = []) =>
  ({ _: 'updates.difference', new_messages: messages, new_encrypted_messages: [], other_updates: [], chats: [], users, state: state(pts) });
