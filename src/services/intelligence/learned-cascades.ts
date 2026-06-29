/**
 * Learned cascade discovery: mine empirical (domainA → domainB, lag) pairs
 * from a history of domain events, to AUGMENT compound-risk's fixed cascade
 * table with couplings the data actually exhibits.
 *
 * Pure: no DOM, no fetch, no globals. The caller supplies the event history
 * (e.g. from episodic memory / the forecast ledger); this module only mines.
 */

export interface DomainEvent {
  domain: string;
  /** epoch ms when the event occurred. */
  at: number;
}

export interface LearnedCascade {
  from: string;
  to: string;
  /** Count of antecedent A-events followed by a B-event within the window. */
  support: number;
  /** support / (count of A-events) — P(B follows A within the window). */
  confidence: number;
  /** Median lag (ms) from each A to its first following B. */
  medianLagMs: number;
}

export interface MineCascadeOptions {
  /** Max lag for B to count as following A. Default 72h. */
  windowMs?: number;
  /** Skip A→A pairs. Default true. */
  excludeSelf?: boolean;
  /** Minimum A-event count for a pair to be eligible. Default 3. */
  minAntecedents?: number;
  /** Minimum support to emit a cascade. Default 2. */
  minSupport?: number;
  /** Minimum confidence to emit a cascade. Default 0.3. */
  minConfidence?: number;
}

const HOUR_MS = 3_600_000;

interface ResolvedMineOptions {
  windowMs: number;
  excludeSelf: boolean;
  minAntecedents: number;
  minSupport: number;
  minConfidence: number;
}

export function mineCascades(
  events: readonly DomainEvent[],
  options: MineCascadeOptions = {},
): LearnedCascade[] {
  const opts: ResolvedMineOptions = {
    windowMs: options.windowMs ?? 72 * HOUR_MS,
    excludeSelf: options.excludeSelf ?? true,
    minAntecedents: options.minAntecedents ?? 3,
    minSupport: options.minSupport ?? 2,
    minConfidence: options.minConfidence ?? 0.3,
  };

  const byDomain = groupTimesByDomain(events);
  const domains = [...byDomain.keys()];
  const out: LearnedCascade[] = [];

  for (const from of domains) {
    const antecedents = byDomain.get(from)!;
    if (antecedents.length < opts.minAntecedents) continue;
    for (const to of domains) {
      if (opts.excludeSelf && to === from) continue;
      const cascade = minePair(from, to, antecedents, byDomain.get(to)!, opts);
      if (cascade) out.push(cascade);
    }
  }

  // Strongest first: confidence, then support.
  out.sort((a, b) => b.confidence - a.confidence || b.support - a.support);
  return out;
}

function groupTimesByDomain(events: readonly DomainEvent[]): Map<string, number[]> {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const byDomain = new Map<string, number[]>();
  for (const e of ordered) {
    const list = byDomain.get(e.domain) ?? [];
    list.push(e.at);
    byDomain.set(e.domain, list);
  }
  return byDomain;
}

function minePair(
  from: string,
  to: string,
  antecedents: readonly number[],
  consequents: readonly number[],
  opts: ResolvedMineOptions,
): LearnedCascade | null {
  let support = 0;
  const lags: number[] = [];
  for (const a of antecedents) {
    const lag = firstFollowingLag(consequents, a, opts.windowMs);
    if (lag !== null) {
      support += 1;
      lags.push(lag);
    }
  }
  if (support < opts.minSupport) return null;
  const confidence = support / antecedents.length;
  if (confidence < opts.minConfidence) return null;
  return { from, to, support, confidence, medianLagMs: median(lags) };
}

/** "from|to" keys for the cascades meeting a confidence floor — ready to
 *  union into compound-risk's CASCADE_PAIRS via registerLearnedCascadePairs. */
export function cascadePairKeys(
  cascades: readonly LearnedCascade[],
  minConfidence = 0.3,
): Set<string> {
  const keys = new Set<string>();
  for (const c of cascades) {
    if (c.confidence >= minConfidence) keys.add(`${c.from}|${c.to}`);
  }
  return keys;
}

/** Lag (ms) from antecedent time `a` to the first consequent strictly after
 *  `a` within the window, or null if none. `consequents` is time-sorted. */
function firstFollowingLag(consequents: readonly number[], a: number, windowMs: number): number | null {
  for (const c of consequents) {
    if (c <= a) continue;
    if (c - a > windowMs) return null; // sorted: nothing closer ahead qualifies
    return c - a;
  }
  return null;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
