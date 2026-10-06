// Pure helpers for scripts/setup.mjs (unit-tested in test/setupHelpers.test.ts).

export function validBotToken(t) {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(String(t).trim());
}

/** "123, 456" → ["123","456"]; returns null when any item is not a positive integer. */
export function parseIdList(raw) {
  const items = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.every((s) => /^\d+$/.test(s) && Number(s) > 0)) return null;
  return [...new Set(items)];
}

/** Replace `KEY = "..."` (a [vars] entry) keeping a trailing comment out of the way. */
export function setTomlVar(toml, key, value) {
  const re = new RegExp('^' + key + '\\s*=\\s*".*?"[^\\n]*$', 'm');
  if (!re.test(toml)) throw new Error('wrangler.toml has no entry for ' + key);
  return toml.replace(re, `${key} = "${value}"`);
}

/** Set database_id of the [[d1_databases]] block whose binding is `binding`. */
export function setDatabaseId(toml, binding, id) {
  const re = new RegExp('(binding\\s*=\\s*"' + binding + '"[\\s\\S]*?database_id\\s*=\\s*)"[^"]*"[^\\n]*');
  if (!re.test(toml)) throw new Error('wrangler.toml has no D1 block for ' + binding);
  return toml.replace(re, `$1"${id}"`);
}

export function parseDatabaseId(output) {
  const m = String(output).match(/database_id["']?\s*[:=]\s*["']([0-9a-fA-F-]{36})["']/);
  return m ? m[1] : null;
}

export function parseWorkerUrl(output) {
  const m = String(output).match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/);
  return m ? m[0] : null;
}

/** Find a database id in `wrangler d1 list --json` output. */
export function findDatabaseId(listJson, name) {
  try {
    const row = JSON.parse(listJson).find((d) => d.name === name);
    return row ? row.uuid || row.id || null : null;
  } catch {
    return null;
  }
}
