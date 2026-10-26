import { escapeHtml } from '../utils';

/** What `order_deliveries.content_json` / `stock_accounts.content_json` hold (SUPPLIER_PLAN.md §2.5). */
export type AccountField = { key: string; value: string };
export type DeliveryContent = { accounts: { fields: AccountField[] }[] } | { text: string };

export const CONTINUED_NOTE = '(…ادامه در پیام بعد)';
export const HTML_MAX = 3500;

const LABELS: [RegExp, string][] = [
  [/^activation_link$/i, '🔗 لینک فعال‌سازی'],
  [/^(email|username|login|user)$/i, '👤 نام کاربری'],
  [/^(password|pass)$/i, '🔑 رمز عبور'],
  [/^(code|license|key)$/i, '🎫 کد'],
];

const labelOf = (key: string): string => LABELS.find(([re]) => re.test(key))?.[1] ?? '▫️ ' + escapeHtml(key);

/** A link stays plain (clickable) text; everything else is copyable `<code>`. */
const valueOf = (value: string): string => (value.startsWith('http') ? escapeHtml(value) : '<code>' + escapeHtml(value) + '</code>');

/** The account block shown to the customer and the admin (HTML; every dynamic string is escaped). */
export function formatAccountsHtml(content: DeliveryContent): string {
  if ('text' in content) return '<code>' + escapeHtml(content.text) + '</code>';
  const many = content.accounts.length > 1;
  return content.accounts
    .map((a, i) => (many ? 'اکانت ' + (i + 1) + ':\n' : '') + a.fields.map((f) => labelOf(f.key) + ': ' + valueOf(f.value)).join('\n'))
    .join('\n\n');
}

/** Cuts `text` into pieces of at most `size` characters without breaking an `&amp;`-style entity. */
function chunkEscaped(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = size;
    const amp = rest.lastIndexOf('&', cut - 1);
    if (amp > cut - 7 && !rest.slice(amp, cut).includes(';')) cut = amp;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Splits a long block at line ends into parts under `HTML_MAX` characters. Every part but the last ends with
 * `(…ادامه در پیام بعد)`. A single over-long line is cut inside its `<code>` span (the tag is closed and reopened,
 * so every part is valid HTML).
 */
export function splitHtml(html: string, max = HTML_MAX): string[] {
  if (html.length <= max) return [html];
  const room = max - CONTINUED_NOTE.length - 1;
  const parts: string[] = [];
  let current = '';
  for (const line of html.split('\n')) {
    if (line.length > room) {
      if (current) { parts.push(current); current = ''; }
      const m = /^(.*?<code>)(.*)<\/code>$/s.exec(line);
      const open = m ? m[1] : '';
      const close = m ? '</code>' : '';
      const pieces = chunkEscaped(m ? m[2] : line, room - open.length - close.length);
      pieces.slice(0, -1).forEach((piece) => parts.push(open + piece + close));
      current = open + pieces[pieces.length - 1] + close;
      continue;
    }
    if (current && (current + '\n' + line).length > room) {
      parts.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) parts.push(current);
  return parts.map((p, i) => (i < parts.length - 1 ? p + '\n' + CONTINUED_NOTE : p));
}

export function parseContent(json: string): DeliveryContent | null {
  try {
    const c = JSON.parse(json);
    if (c && Array.isArray(c.accounts)) return c;
    if (c && typeof c.text === 'string') return c;
  } catch { /* corrupt */ }
  return null;
}
