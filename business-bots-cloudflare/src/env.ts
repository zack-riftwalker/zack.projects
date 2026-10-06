export interface Env {
  STORE_DB: D1Database;
  MONSHI_DB: D1Database;
  STORE_BOT_TOKEN?: string;
  MONSHI_BOT_TOKEN?: string;
  STORE_ADMIN_IDS?: string;
  MONSHI_ADMIN_USER_ID?: string;
  MONSHI_NOTIFY_USER_IDS?: string;
  GEMINI_API_KEY?: string;
  WEBHOOK_SECRET?: string;
}

export function parseIdList(raw: string | undefined): number[] {
  return [...new Set(
    (raw || '').split(',').map((s) => Number(s.trim())).filter((id) => Number.isInteger(id) && id > 0),
  )];
}
