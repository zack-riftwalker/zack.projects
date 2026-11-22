/** Round 4 (CAMPAIGN_PLAN.md §3): `/start src_<name>` marks where a brand-new customer came from (first touch only). */
export const SRC_PAYLOAD_RE = /^src_([a-z0-9]{1,24})$/;
export const SOURCE_NAME_RE = /^[a-z0-9]{1,24}$/;

/** The source name in a /start payload, or null when it isn't a (valid) source link. */
export function parseSourcePayload(payload: string): string | null {
  return SRC_PAYLOAD_RE.exec(payload.toLowerCase())?.[1] ?? null;
}
