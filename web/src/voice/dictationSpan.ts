/**
 * The draft range one dictation session wrote. Segments append to it while
 * they land contiguously; any other insertion point marks it broken so the
 * cleanup pass never rewrites text the user placed elsewhere.
 */
export type DictationSpan = { start: number; text: string; broken: boolean };

export function extendDictationSpan(
  span: DictationSpan | null,
  start: number,
  inserted: string,
): DictationSpan {
  if (!span) return { start, text: inserted, broken: false };
  if (span.broken || start !== span.start + span.text.length)
    return { ...span, broken: true };
  return { ...span, text: span.text + inserted };
}

/**
 * The replacement for a cleaned-up span, or null when the draft no longer
 * holds the dictated text at its recorded offset (the user edited it).
 * Surrounding whitespace from the join is preserved around the cleaned text.
 */
export function dictationCleanupEdit(
  draft: string,
  span: DictationSpan,
  cleaned: string,
): { start: number; end: number; text: string } | null {
  const end = span.start + span.text.length;
  if (span.broken || draft.slice(span.start, end) !== span.text) return null;
  const body = cleaned.trim();
  if (!body) return null;
  const leading = /^\s*/.exec(span.text)?.[0] ?? "";
  const trailing = /\s*$/.exec(span.text.slice(leading.length))?.[0] ?? "";
  return { start: span.start, end, text: `${leading}${body}${trailing}` };
}
