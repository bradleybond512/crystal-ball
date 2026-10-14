/**
 * Best-effort full-traversal comparison for shared secrets (API and app keys).
 *
 * Compare code points at every UTF-16 index so the result preserves JavaScript
 * string equality, including lone surrogates. TextEncoder replaces lone surrogates
 * with U+FFFD and can make distinct strings compare equal.
 *
 * Every position through the longer string is visited, without an early exit
 * for a mismatch. Runtime depends on string length; JavaScript/JIT execution
 * does not provide a mathematically guaranteed wall-clock constant time.
 * Uses only language primitives, with no Node-specific runtime dependency.
 */
export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    // Visit every code-unit index, including the low half of surrogate pairs.
    // Preserve full code-point values; missing positions become zero under XOR.
    // The length mismatch above distinguishes absent positions from NULs.
    diff |= a.codePointAt(i) ^ b.codePointAt(i);
  }
  return diff === 0;
}

/** Compare every entry, including those after a match. Work still depends on
 * collection size and string lengths; this is not a wall-clock timing guarantee. */
export function timingSafeIncludes(candidates, candidate) {
  if (typeof candidate !== 'string' || candidates == null || typeof candidates[Symbol.iterator] !== 'function') return false;
  let found = false;
  for (const entry of candidates) {
    found = timingSafeEqualString(entry, candidate) || found;
  }
  return found;
}
