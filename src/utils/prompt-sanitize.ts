/**
 * Neutralize untrusted text before interpolating it into an LLM prompt.
 *
 * Feed-derived content (alert titles, anomaly descriptions, evidence labels)
 * flows into the analyst's skeptic/ensemble reviews. The defense is STRUCTURAL:
 * an injected value must not be able to break out of its delimited line and
 * forge a new instruction block. We collapse all whitespace (including
 * newlines) to single spaces, strip control characters, and cap length.
 */
export function sanitizeForPrompt(input: string, maxLen = 300): string {
  if (!input || typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex -- intentional: stripping control chars from untrusted prompt input
  const collapsed = input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
}
