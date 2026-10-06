import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper
import * as h from '../scripts/setupHelpers.mjs';
import { readFileSync } from 'node:fs';

describe('setup helpers', () => {
  it('validates bot tokens and id lists', () => {
    expect(h.validBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_')).toBe(true);
    expect(h.validBotToken('nope')).toBe(false);
    expect(h.parseIdList('123, 456,123')).toEqual(['123', '456']);
    expect(h.parseIdList('12a')).toBeNull();
    expect(h.parseIdList('0')).toBeNull();
  });

  it('edits the real wrangler.toml', () => {
    let t = readFileSync('wrangler.toml', 'utf8');
    t = h.setDatabaseId(t, 'STORE_DB', '11111111-1111-1111-1111-111111111111');
    t = h.setDatabaseId(t, 'MONSHI_DB', '22222222-2222-2222-2222-222222222222');
    t = h.setTomlVar(t, 'STORE_ADMIN_IDS', '1,2');
    t = h.setTomlVar(t, 'MONSHI_ADMIN_USER_ID', '1');
    t = h.setTomlVar(t, 'MONSHI_NOTIFY_USER_IDS', '');
    expect(t).toMatch(/binding = "STORE_DB"[\s\S]*?database_id = "11111111-1111-1111-1111-111111111111"/);
    expect(t).toMatch(/binding = "MONSHI_DB"[\s\S]*?database_id = "22222222-2222-2222-2222-222222222222"/);
    expect(t).toContain('STORE_ADMIN_IDS = "1,2"');
    expect(t).toContain('MONSHI_NOTIFY_USER_IDS = ""');
    expect(t.match(/database_id/g)).toHaveLength(2);
    expect(() => h.setTomlVar(t, 'NOPE', 'x')).toThrow();
  });

  it('parses wrangler output', () => {
    expect(h.parseDatabaseId('[[d1_databases]]\nbinding = "DB"\ndatabase_name = "x"\ndatabase_id = "abcdef01-2345-6789-abcd-ef0123456789"')).toBe('abcdef01-2345-6789-abcd-ef0123456789');
    expect(h.parseDatabaseId('"database_id": "abcdef01-2345-6789-abcd-ef0123456789"')).toBe('abcdef01-2345-6789-abcd-ef0123456789');
    expect(h.parseWorkerUrl('Deployed business-bots\n  https://business-bots.zack.workers.dev\nVersion')).toBe('https://business-bots.zack.workers.dev');
    expect(h.findDatabaseId('[{"name":"a","uuid":"u1"},{"name":"b","uuid":"u2"}]', 'b')).toBe('u2');
    expect(h.findDatabaseId('garbage', 'b')).toBeNull();
  });
});
