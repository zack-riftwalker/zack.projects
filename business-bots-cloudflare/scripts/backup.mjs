#!/usr/bin/env node
/**
 * Full SQL dump (schema + data) of both remote D1 databases into ./backups/ (git-ignored).
 *
 *   npm run db:backup
 *
 * Runs automatically before `npm run db:migrate:remote`. Restore one into a database with:
 *   npx wrangler d1 execute <db-name> --remote --file=backups/<file>.sql
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { backupFileName, databaseNames } from './setupHelpers.mjs';

const names = databaseNames(readFileSync('wrangler.toml', 'utf8'));
if (!names.length) throw new Error('No [[d1_databases]] entries in wrangler.toml');
mkdirSync('backups', { recursive: true });

const now = new Date();
let failed = false;
for (const name of names) {
  const file = backupFileName(name, now);
  console.log(`💾 ${name} → ${file}`);
  const r = spawnSync('npx', ['wrangler', 'd1', 'export', name, '--remote', '--output', file], {
    stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    failed = true;
    console.error(`❌ پشتیبان‌گیری از ${name} ناموفق بود.`);
    continue;
  }
  console.log(`✅ ${file} (${statSync(file).size} bytes)`);
}
if (failed) {
  console.error('❌ پشتیبان کامل نشد — ادامه ندهید.');
  process.exit(1);
}
