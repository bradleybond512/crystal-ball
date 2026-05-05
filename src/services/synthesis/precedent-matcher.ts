/**
 * Historical Precedent Matcher — per Batch 1 of the synthesis plan.
 *
 * Given a current event, find historical analogs and surface what came
 * next. TF-IDF feature vectors over location / event type / actors /
 * intensity / sector + cosine similarity, then rank top-K.
 *
 * Pure deterministic. No DOM, no fetch, no globals. The sidecar wraps
 * this module behind /api/precedents (corpus pre-computed at startup
 * so request-time work is just vectorize-current + cosine).
 *
 * Plan invariants:
 *   - Pure functions are unit-testable on static fixtures.
 *   - Aftermath aggregation surfaces best/worst/average — never just an
 *     average that hides outliers.
 *   - keyDifferences explains why two events ranked apart, so the user
 *     can see what's NOT analogous, not just what is.
 */

// ── Public types ───────────────────────────────────────────────────────

export type IntensityLabel = 'low' | 'medium' | 'high' | 'critical';

export interface HistoricalEvent {
  id: string;
  date: string;             // ISO 8601
  location: string;         // free-text place ("Mosul, Iraq")
  country: string;          // ISO country (or label)
  region?: string;          // ("Middle East")
  eventType: string;        // ("airstrike" | "drought" | …)
  actors: readonly string[];
  intensity: IntensityLabel;
  sector?: string;          // ("food" | "energy" | …)
  summary: string;
  aftermath30d?: string;
  aftermath90d?: string;
  source: 'gdelt' | 'ucdp' | 'acled' | 'fixture';
}

export interface PrecedentAnalog {
  id: string;
  date: string;
  location: string;
  country: string;
  similarity: number;       // [0, 1]
  summary: string;
  aftermath30d: string;
  aftermath90d: string;
  keyDifferences: string[];
  source: HistoricalEvent['source'];
}

export interface HistoricalPrecedent {
  currentEventSummary: string;
  analogs: PrecedentAnalog[];
  averageOutcome: string;   // narrative roll-up
  worstCase: string;
  bestCase: string;
}

export interface MatcherOptions {
  /** Top-K analogs returned. Default 10. */
  k?: number;
  /** Skip analogs with similarity below this floor. Default 0.05 — set
   *  higher to suppress weak matches when the corpus is noisy. */
  minSimilarity?: number;
}

// ── Tokenization ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'were', 'will', 'with',
]);

/** Lowercase, split on non-alphanumeric, drop stopwords + tokens shorter
 *  than 2 chars. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  // eslint-disable-next-line sonarjs/slow-regex -- linear character class split
  const parts = text.toLowerCase().split(/[^a-z0-9]+/);
  return parts.filter((p) => p.length >= 2 && !STOPWORDS.has(p));
}

/** Build a feature-token bag for a historical event. Combines structured
 *  fields with the summary so identical structured fields amplify
 *  similarity even when summaries diverge. */
export function eventTokens(event: HistoricalEvent): string[] {
  // Structured fields are repeated 2× to weight them above narrative
  // tokens — the spec calls out location / event type / actors /
  // intensity / sector as the feature axes.
  const actorTokens = event.actors.flatMap((a) => tokenize(a));
  const structured: string[] = [
    ...tokenize(event.location),
    ...tokenize(event.country),
    ...(event.region ? tokenize(event.region) : []),
    ...tokenize(event.eventType),
    ...actorTokens,
    `intensity_${event.intensity}`,
    ...(event.sector ? [`sector_${event.sector.toLowerCase()}`] : []),
  ];
  return [...structured, ...structured, ...tokenize(event.summary)];
}

// ── TF-IDF + vector math ───────────────────────────────────────────────

export type Vector = ReadonlyMap<string, number>;
export type Vocabulary = ReadonlyMap<string, number>; // term → IDF

/** Build IDF weights over the corpus. Standard formula:
 *      idf(term) = log( (N + 1) / (df + 1) ) + 1
 *  The +1 smoothing avoids log(0) for terms unique to one document. */
export function buildVocabulary(corpus: readonly HistoricalEvent[]): Vocabulary {
  const N = corpus.length;
  const docFreq = new Map<string, number>();
  for (const event of corpus) {
    const seen = new Set<string>();
    for (const term of eventTokens(event)) {
      if (seen.has(term)) continue;
      seen.add(term);
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const vocab = new Map<string, number>();
  for (const [term, df] of docFreq) {
    vocab.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }
  return vocab;
}

/** TF-IDF vector for an event under the given vocabulary. */
export function vectorize(event: HistoricalEvent, vocab: Vocabulary): Vector {
  const tokens = eventTokens(event);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v = new Map<string, number>();
  for (const [term, count] of tf) {
    const idf = vocab.get(term);
    if (idf === undefined) continue; // term not in vocab — drop
    v.set(term, count * idf);
  }
  return v;
}

/** Cosine similarity in [0, 1] (assumes non-negative tf-idf weights). */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.size === 0 || b.size === 0) return 0;
  // Iterate the smaller map; lookup against the larger.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  if (dot === 0) return 0;
  let normA = 0; for (const w of a.values()) normA += w * w;
  let normB = 0; for (const w of b.values()) normB += w * w;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Analog ranking + aftermath aggregation ─────────────────────────────

/** Find the top-K most similar historical events to `current`.
 *  `corpusVectors` should be pre-computed once and reused — vectorizing
 *  on every request is wasteful. */
export function findAnalogs(
  current: HistoricalEvent,
  corpus: readonly HistoricalEvent[],
  vocab: Vocabulary,
  corpusVectors: readonly Vector[],
  options: MatcherOptions = {},
): PrecedentAnalog[] {
  if (corpus.length !== corpusVectors.length) {
    throw new Error('corpus / corpusVectors length mismatch');
  }
  const k = options.k ?? 10;
  const minSim = options.minSimilarity ?? 0.05;
  const cv = vectorize(current, vocab);
  const ranked: { event: HistoricalEvent; similarity: number }[] = [];
  for (const [i, element] of corpus.entries()) {
    const event = element!;
    if (event.id === current.id) continue;
    const similarity = cosineSimilarity(cv, corpusVectors[i]!);
    if (similarity < minSim) continue;
    ranked.push({ event, similarity });
  }
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, k).map(({ event, similarity }) => ({
    id: event.id,
    date: event.date,
    location: event.location,
    country: event.country,
    similarity,
    summary: event.summary,
    aftermath30d: event.aftermath30d ?? '',
    aftermath90d: event.aftermath90d ?? '',
    keyDifferences: keyDifferences(current, event),
    source: event.source,
  }));
}

/** What's structurally different between the current event and an
 *  analog? Surfaces the top axes — country / actor / intensity / sector
 *  / event type — that don't match. Empty when everything aligns. */
export function keyDifferences(current: HistoricalEvent, analog: HistoricalEvent): string[] {
  const out: string[] = [];
  if (current.country !== analog.country) {
    out.push(`country: ${current.country} → ${analog.country}`);
  }
  if (current.eventType !== analog.eventType) {
    out.push(`event type: ${current.eventType} → ${analog.eventType}`);
  }
  if (current.intensity !== analog.intensity) {
    out.push(`intensity: ${current.intensity} → ${analog.intensity}`);
  }
  if (current.sector && analog.sector && current.sector !== analog.sector) {
    out.push(`sector: ${current.sector} → ${analog.sector}`);
  }
  const actorsMissing = current.actors.filter((a) => !analog.actors.includes(a));
  if (actorsMissing.length > 0) {
    out.push(`actors absent: ${actorsMissing.join(', ')}`);
  }
  return out;
}

/** Build the full HistoricalPrecedent envelope: analogs + best/worst/
 *  average outcome roll-ups. Aggregation is intentionally narrative —
 *  picking the most-cited aftermath strings rather than averaging
 *  numeric features that don't always exist. */
export function buildPrecedent(
  current: HistoricalEvent,
  analogs: readonly PrecedentAnalog[],
): HistoricalPrecedent {
  const aftermaths90 = analogs.map((a) => a.aftermath90d).filter((s) => s.length > 0);
  if (aftermaths90.length === 0) {
    return {
      currentEventSummary: current.summary,
      analogs: [...analogs],
      averageOutcome: 'No graded historical aftermaths in the corpus.',
      worstCase: 'unknown',
      bestCase: 'unknown',
    };
  }
  // Naive ordering by length as a stand-in for severity. The plan calls
  // for narrative aggregation; calibrated severity scoring lives later.
  const sortedByGravity = [...analogs]
    .filter((a) => a.aftermath90d.length > 0)
    .sort((a, b) => severityHeuristic(b.aftermath90d) - severityHeuristic(a.aftermath90d));
  const worst = sortedByGravity[0]!;
  const best = sortedByGravity[sortedByGravity.length - 1]!;
  const avgIdx = Math.floor(sortedByGravity.length / 2);
  const median = sortedByGravity[avgIdx]!;
  return {
    currentEventSummary: current.summary,
    analogs: [...analogs],
    averageOutcome: median.aftermath90d,
    worstCase: worst.aftermath90d,
    bestCase: best.aftermath90d,
  };
}

/** Heuristic severity score for narrative aftermath strings. Counts
 *  high-impact terms ("collapse", "famine", "war", "crash"…) and
 *  high-magnitude numbers. Deterministic for tests. */
export function severityHeuristic(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const heavyTerms = ['famine', 'collapse', 'genocide', 'war', 'crash', 'depression',
    'displacement', 'evacuation', 'casualties', 'killed', 'dead', 'insurgency',
    'sanctions', 'embargo', 'shortage', 'crisis', 'failure'];
  let score = 0;
  for (const term of heavyTerms) {
    if (lower.includes(term)) score += 2;
  }
  // Big numbers (k/M/B suffix or 4+ digits) → stronger gravity.
  // eslint-disable-next-line sonarjs/slow-regex -- linear non-backtracking pattern
  const bigNum = lower.match(/(\d{4,}|\d+\s*[kmb]\b)/g);
  if (bigNum) score += bigNum.length;
  return score;
}
