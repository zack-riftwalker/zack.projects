/** Persian text normalisation — digits and common characters (port of normalize.py). */

export function normalizeDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 0x30))
    .replace(/[٠-٩]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 0x30));
}

/** Arabic ي/ك → Persian ی/ک, ZWNJ → space. Length-preserving. */
export function normalizeChars(text: string): string {
  return text.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ');
}

export function normalizeText(text: string): string {
  const t = normalizeChars(normalizeDigits(text));
  return t.split(/\s+/).filter(Boolean).join(' ').trim();
}
