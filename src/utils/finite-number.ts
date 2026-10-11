/**
 * Numbers from feeds and RPC responses (R3-SEC-009). Generated TypeScript
 * types are not runtime checks: a field typed `number` can arrive as a
 * string, NaN or markup. Coerce at the provider boundary with these, and
 * format for display with `formatFiniteNumber`, whose output only ever
 * contains digits, a sign, separators or "—".
 */

/** A finite number from a number or a numeric string; otherwise undefined. */
export function finiteOrUndefined(value: unknown): number | undefined {
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function finiteOr(value: unknown, fallback: number): number {
  return finiteOrUndefined(value) ?? fallback;
}

/** A positive whole count (fatalities, ships), or undefined. */
export function positiveCountOrUndefined(value: unknown): number | undefined {
  const n = finiteOrUndefined(value);
  return n !== undefined && n > 0 ? Math.round(n) : undefined;
}

/** Display form: grouped digits with at most `maximumFractionDigits`, or "—". */
export function formatFiniteNumber(value: unknown, maximumFractionDigits = 1): string {
  const n = finiteOrUndefined(value);
  return n === undefined ? '—' : n.toLocaleString('en-US', { maximumFractionDigits });
}
