import type { FaqRow } from '../db';
import { normalizeText } from '../normalize';

/** Minimum score to trust a match (avoids accidental one-word hits). */
export const MIN_SCORE = 2;

/**
 * Price-question words that point at no specific product. Together they give
 * at most 1 point and a match is never accepted without ≥1 specific keyword.
 * «چقدر» alone is intentionally absent (it also matches time/amount questions).
 */
export const GENERIC_KEYWORDS: ReadonlySet<string> = new Set(
  ['قیمت', 'هزینه', 'چند تومن', 'چنده', 'چقدره', 'تعرفه', 'هزینش', 'قیمتش', 'چند میشه', 'چند در میاد'].map(normalizeText),
);

export function isPriceQuery(normalizedText: string): boolean {
  const t = normalizedText.toLowerCase();
  for (const kw of GENERIC_KEYWORDS) if (t.includes(kw)) return true;
  return false;
}

export function hasSpecificKeyword(keywordsRaw: string | null | undefined): boolean {
  const kws = (keywordsRaw || '').split(',').filter((k) => k.trim()).map((k) => normalizeText(k).toLowerCase());
  return kws.some((kw) => kw && !GENERIC_KEYWORDS.has(kw));
}

function keywordsOf(faq: FaqRow): string[] {
  return (faq.keywords || '').split(',').filter((k) => k.trim()).map((k) => normalizeText(k).toLowerCase());
}

interface ScoredFaq { faq: FaqRow; score: number }

/** Every FAQ with at least one specific keyword (or question) hit, with its score. */
function scoreFaqs(text: string | null | undefined, faqs: FaqRow[]): ScoredFaq[] {
  if (!text) return [];
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return [];

  const out: ScoredFaq[] = [];
  const priceIntent = isPriceQuery(normalized);
  for (const faq of faqs) {
    let specificHits = 0;
    let hasGenericKw = false;
    for (const kw of keywordsOf(faq)) {
      if (!kw) continue;
      if (GENERIC_KEYWORDS.has(kw)) hasGenericKw = true;
      else if (normalized.includes(kw)) specificHits += 1;
    }
    let score = specificHits + (hasGenericKw && priceIntent ? 1 : 0);
    const questionNorm = normalizeText(faq.question).toLowerCase();
    if (questionNorm && normalized.includes(questionNorm)) {
      specificHits += 1;
      score += 2;
    }
    if (specificHits === 0) continue;
    out.push({ faq, score });
  }
  return out;
}

export function findBestMatch(text: string | null | undefined, faqs: FaqRow[]): { faq: FaqRow; score: number } | null {
  let best: ScoredFaq | null = null;
  for (const c of scoreFaqs(text, faqs)) if (!best || c.score > best.score) best = c;
  if (best !== null && best.score >= MIN_SCORE) return best;
  return null;
}

/** Up to k FAQs worth suggesting to a human (any specific hit, best first) — weaker than a firm auto-answer match. */
export function topMatches(text: string | null | undefined, faqs: FaqRow[], k = 3): FaqRow[] {
  return scoreFaqs(text, faqs)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((c) => c.faq);
}
