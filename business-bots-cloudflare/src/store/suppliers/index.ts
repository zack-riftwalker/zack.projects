import type { Apps } from '../../apps';
import { makeAriobox } from './ariobox';
import type { SupplierAdapter } from './types';

export const SUPPLIER_KINDS = ['ariobox'] as const;
export const DEFAULT_BASE_URL: Record<string, string> = { ariobox: 'https://ariobox.space' };

/** The adapter for a supplier kind. Only ArioBox exists for now. */
export function adapterFor(kind: string, apps: Apps): SupplierAdapter {
  if (kind === 'ariobox') return makeAriobox(apps);
  throw new Error('Unknown supplier kind: ' + kind);
}

export * from './types';
