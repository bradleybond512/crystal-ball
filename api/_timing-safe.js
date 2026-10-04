/**
 * Constant-time string comparison for shared secrets (API and app keys).
 *
 * `a === b` (and Set#has) stop at the first differing character, so response
 * timing can leak how much of a guessed key is right. This compares the UTF-8
 * bytes of both strings over the full length of the longer one, folding every
 * difference into one accumulator with no early exit. The only thing timing
 * can reveal is the longer string's length.
 *
 * Works in every runtime this repo uses (Vercel edge, Node sidecar, browser):
 * TextEncoder only, no node:crypto.
 */
const encoder = new TextEncoder();

export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** True when `candidate` equals ANY entry. Every entry is compared, so timing
 *  doesn't reveal which key matched or how many keys exist before it. */
export function timingSafeIncludes(candidates, candidate) {
  let found = false;
  for (const entry of candidates) {
    found = timingSafeEqualString(entry, candidate) || found;
  }
  return found;
}
