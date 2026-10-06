#!/usr/bin/env node
/**
 * One-command setup: creates the D1 databases, writes wrangler.toml, uploads secrets, migrates, deploys,
 * (optionally) imports the old data, and registers the Telegram webhooks.
 *
 *   npm run setup            interactive
 *   npm run setup -- --dry-run   print what would run, change nothing
 *
 * Safe to re-run. Secrets are sent to Cloudflare only (never written to disk or git).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline/promises';
import {
  listDatabases, setDatabaseName, parseDatabaseId, parseIdList, parseWorkerUrl, setDatabaseId, setTomlVar, validBotToken,
} from './setupHelpers.mjs';

const DRY = process.argv.includes('--dry-run');
const TOML = 'wrangler.toml';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const say = (s = '') => console.log(s);
const step = (n, s) => say(`\n━━ مرحله ${n}: ${s}`);

function wrangler(args, { input, inherit = false, allowFail = false } = {}) {
  const shown = 'npx wrangler ' + args.join(' ');
  if (DRY) {
    say('   [dry-run] ' + shown);
    return { ok: true, out: args[0] === 'deploy' ? 'https://business-bots.example.workers.dev' : '' };
  }
  const r = spawnSync('npx', ['wrangler', ...args], {
    input, encoding: 'utf8', shell: process.platform === 'win32', stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 && !allowFail) {
    say(out.trim());
    throw new Error('دستور ناموفق بود: ' + shown);
  }
  return { ok: r.status === 0, out };
}

async function ask(q, { required = true, check, def } = {}) {
  for (;;) {
    const a = (await rl.question(q + (def ? ` [${def}]` : '') + ': ')).trim() || def || '';
    if (!a && !required) return '';
    if (a && (!check || check(a))) return a;
    say('   ⚠️ مقدار نامعتبر است، دوباره وارد کنید.');
  }
}

async function main() {
  if (!existsSync(TOML)) throw new Error('این اسکریپت را داخل پوشه‌ی business-bots-cloudflare اجرا کنید.');
  say('🚀 راه‌اندازی ربات‌های فروشگاه و منشی روی Cloudflare' + (DRY ? '  (حالت آزمایشی — هیچ تغییری اعمال نمی‌شود)' : ''));

  step(1, 'ورود به کلودفلر');
  if (!DRY) {
    const who = wrangler(['whoami'], { allowFail: true });
    if (!who.ok || /not authenticated|You are not/i.test(who.out)) {
      say('مرورگر باز می‌شود؛ وارد حساب Cloudflare شوید و Allow را بزنید.');
      wrangler(['login'], { inherit: true });
    } else say('✅ قبلاً وارد شده‌اید.');
  }

  step(2, 'اطلاعات (از شما فقط همین‌ها را می‌خواهم)');
  const storeToken = await ask('توکن ربات فروشگاه (از BotFather)', { check: validBotToken });
  const monshiToken = await ask('توکن ربات منشی (از BotFather)', { check: validBotToken });
  const storeAdmins = await ask('آیدی عددی ادمین‌های فروشگاه (چندتا: با کاما)', { check: (v) => parseIdList(v) });
  const monshiAdmin = await ask('آیدی عددی مالک حساب Business (منشی)', { def: parseIdList(storeAdmins)[0], check: (v) => /^\d+$/.test(v) });
  const notify = await ask('آیدی حساب‌های نوتیف‌گیر اضافه (اختیاری، Enter = ندارم)', { required: false, check: (v) => parseIdList(v) });
  const gemini = await ask('کلید Gemini (اختیاری، Enter = ندارم)', { required: false });
  const oldStore = await ask('مسیر فایل storefront.db قدیمی (اختیاری، Enter = از صفر)', { required: false, check: existsSync });
  const oldMonshi = await ask('مسیر فایل monshi.db قدیمی (اختیاری، Enter = از صفر)', { required: false, check: existsSync });
  const webhookSecret = randomBytes(32).toString('hex');

  step(3, 'دیتابیس‌ها');
  let toml = readFileSync(TOML, 'utf8');
  const original = toml;
  let existing = [];
  if (!DRY) {
    const list = wrangler(['d1', 'list', '--json'], { allowFail: true });
    existing = listDatabases(list.out.slice(Math.max(0, list.out.indexOf('['))));
  }
  const names = {};
  for (const [label, defName, binding] of [['فروشگاه', 'store-bot-db', 'STORE_DB'], ['منشی', 'monshi-bot-db', 'MONSHI_DB']]) {
    let db = existing.find((d) => d.name === defName);
    if (!db && existing.length) {
      say(`دیتابیس‌های موجود در حساب شما:`);
      existing.forEach((d, i) => say(`  ${i + 1}) ${d.name}  (${d.id})`));
      const pick = await ask(`شماره‌ی دیتابیس «${label}» (Enter = بساز)`, { required: false, check: (v) => existing[Number(v) - 1] });
      if (pick) db = existing[Number(pick) - 1];
    }
    if (db) {
      say(`✅ برای ${label} از «${db.name}» استفاده می‌شود.`);
    } else if (DRY) {
      wrangler(['d1', 'create', defName]);
      db = { name: defName, id: '00000000-0000-0000-0000-000000000000' };
    } else {
      const created = wrangler(['d1', 'create', defName]);
      writeFileSync(TOML, original); // `d1 create` may append its own binding block — undo that
      const id = parseDatabaseId(created.out);
      if (!id) throw new Error('شناسه‌ی دیتابیس ' + defName + ' پیدا نشد.');
      db = { name: defName, id };
      say(`✅ ${defName} ساخته شد.`);
    }
    names[binding] = db.name;
    toml = setDatabaseName(setDatabaseId(toml, binding, db.id), binding, db.name);
  }
  toml = setTomlVar(toml, 'STORE_ADMIN_IDS', parseIdList(storeAdmins).join(','));
  toml = setTomlVar(toml, 'MONSHI_ADMIN_USER_ID', monshiAdmin);
  toml = setTomlVar(toml, 'MONSHI_NOTIFY_USER_IDS', notify ? parseIdList(notify).join(',') : '');
  if (!DRY) writeFileSync(TOML, toml);
  say('✅ wrangler.toml به‌روز شد.');

  step(4, 'ساخت جدول‌ها');
  wrangler(['d1', 'migrations', 'apply', names.STORE_DB, '--remote'], { inherit: !DRY });
  wrangler(['d1', 'migrations', 'apply', names.MONSHI_DB, '--remote'], { inherit: !DRY });

  step(5, 'انتقال دیتای قدیمی');
  if (oldStore || oldMonshi) {
    const args = ['-I', 'scripts/sqlite_to_d1.py', '--out-dir', 'migration_out'];
    if (oldStore) args.push('--store', oldStore);
    if (oldMonshi) args.push('--monshi', oldMonshi);
    if (DRY) say('   [dry-run] python3 ' + args.join(' '));
    else {
      const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', args, { stdio: 'inherit' });
      if (py.status !== 0) throw new Error('تبدیل دیتا ناموفق بود (Python 3 نصب است؟)');
    }
    if (oldStore) wrangler(['d1', 'execute', names.STORE_DB, '--remote', '--file=migration_out/store_data.sql', '-y'], { inherit: !DRY });
    if (oldMonshi) wrangler(['d1', 'execute', names.MONSHI_DB, '--remote', '--file=migration_out/monshi_data.sql', '-y'], { inherit: !DRY });
    if (!DRY) rmSync('migration_out', { recursive: true, force: true });
    say('✅ دیتا منتقل شد و فایل‌های موقت پاک شدند.');
  } else say('از صفر شروع می‌شود.');

  step(6, 'Deploy');
  const deployed = wrangler(['deploy']);
  const url = parseWorkerUrl(deployed.out);
  if (!url) throw new Error('آدرس Worker در خروجی deploy پیدا نشد.');
  say('✅ ' + url);

  step(7, 'ثبت توکن‌ها (فقط روی Cloudflare، جایی ذخیره نمی‌شوند)');
  const secrets = { STORE_BOT_TOKEN: storeToken, MONSHI_BOT_TOKEN: monshiToken, WEBHOOK_SECRET: webhookSecret };
  if (gemini) secrets.GEMINI_API_KEY = gemini;
  if (DRY) say('   [dry-run] wrangler secret bulk (' + Object.keys(secrets).join(', ') + ')');
  else {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    const file = join(dir, 's.json');
    try {
      writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
      wrangler(['secret', 'bulk', file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  say('✅ ثبت شد.');

  step(8, 'وصل کردن webhook تلگرام');
  if (DRY) say(`   [dry-run] GET ${url}/setup?key=…`);
  else {
    let report;
    for (let i = 0; i < 5 && !report; i++) {
      try {
        const res = await fetch(`${url}/setup?key=${webhookSecret}`);
        if (res.ok) report = await res.json();
      } catch { /* the new Worker may need a few seconds */ }
      if (!report) await new Promise((r) => setTimeout(r, 4000));
    }
    if (!report) say(`⚠️ نتوانستم /setup را صدا بزنم. این آدرس را در مرورگر باز کنید:\n   ${url}/setup?key=${webhookSecret}`);
    else {
      for (const [name, r] of Object.entries(report)) {
        say(`${r.ok ? '✅' : '❌'} ${name}: ${r.username ? '@' + r.username : r.error || ''} ${r.problems?.length ? '— ' + r.problems.join('; ') : ''}`);
      }
    }
  }

  say('\n🎉 تمام شد. حالا فقط دو کار داخل تلگرام مانده:');
  say('  ۱) BotFather ← ربات منشی ← Bot Settings ← Business Mode ← Turn on');
  say('  ۲) تلگرام ← Settings ← Telegram Business ← Chatbots ← ربات منشی را اضافه کنید (Reply و Read فعال)');
  say('\nرمز WEBHOOK_SECRET (برای باز کردن دوباره‌ی /setup لازم می‌شود؛ جای امنی نگه دارید):');
  say('  ' + webhookSecret);
  say('\nپیشنهاد: ربات‌های قدیمی را خاموش نگه دارید و بعد از یک هفته پاک کنید.');
}

main().catch((e) => { console.error('\n❌ ' + e.message); process.exitCode = 1; }).finally(() => rl.close());
