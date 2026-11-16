export class TLSerialization {
  constructor(options?: { mtproto?: boolean });
  storeMethod(method: string, params: Record<string, unknown>): string;
  getBytes(typed: true): Uint8Array;
}
export class TLDeserialization {
  constructor(buffer: Uint8Array, options?: { mtproto?: boolean });
  fetchObject(type: string, field: string): any;
}
