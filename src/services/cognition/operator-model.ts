/**
 * Operator Model — unified personalization layer (Cognitive Enhancement PR 4).
 *
 * One persistent model of the operator that fuses four existing learning
 * signals and answers three questions any surface can ask:
 *   - How much does this matter to this user? → interestScore(text)
 *   - How much should we explain? → preferredDepth(domain)
 *   - When should we surface it? → attentionWeight(ts)
 *
 * THIS IS NOT A NEW LEARNER.  It *consumes* signals that already exist:
 *   - unifiedAlertStore transitions (same subscription as relevance-learner)
 *   - action-memory playbooks (thumbs-up/down, panel-jumps, exports, dismissals)
 *   - hypothesis-feedback votes
 *   - ack latency from alert reactions
 * Each source keeps its own store; this is the read-fusion layer with
 * weekly half-life decay on interest weights.
 *
 * Personalization tilt bound: ±20% hard cap (0.8 ≤ multiplier ≤ 1.2).
 * The system tilts — it never dominates.
 *
 * Ghost Mode: recordEngagement no-ops; reads still work.
 *
 * Privacy: local-only. All state lives in localStorage (fast read) with
 * IDB reasoning-memory backup. Nothing is ever transmitted or logged
 * externally. State is never attached to any network payload.
 */

import { getMemory, putMemory } from '@/services/reasoning-memory';
import { isGhostMode } from '@/services/mode-manager';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DepthPreference = 'headline' | 'standard' | 'deep';

export interface InterestTerm {
  term: string;
  weight: number;
  /** Unix-ms timestamp of last reinforcement (for decay). */
  lastReinforced: number;
}

/** The 168 hour-of-week activity weight array, index = (dayOfWeek * 24 + hourOfDay). */
type AttentionRhythm = number[];

export interface ResponseProfile {
  /** Median ms from alert arrival to acknowledgment. */
  medianAckMs: number;
  /** Fraction of viewed alerts the user pins. */
  pinRate: number;
  /** Fraction of viewed alerts the user dismisses without action. */
  dismissRate: number;
}

export interface OperatorModel {
  version: 1;
  /** ≤ 200 interest terms, decayed by weekly half-life. */
  interests: InterestTerm[];
  /** 0–1 per domain, EWMA of engagement fraction. */
  domainAffinity: Record<string, number>;
  /** Per-domain expertise based on depth of interaction. */
  expertise: Record<string, 'novice' | 'familiar' | 'expert'>;
  /** 168 hour-of-week weights, index = dayOfWeek * 24 + hourOfDay. */
  attentionRhythm: AttentionRhythm;
  responseProfile: ResponseProfile;
  updatedAt: number;
  /**
   * Per-domain human edge = systemBrier − operatorBrier (from PR 10 journal).
   * Positive = operator outperforms system in that domain.
   * Computed only when n ≥ 30 resolved entries on BOTH sides.
   * Feeds into interestMultiplier: the combined [0.8, 1.2] bound is preserved.
   * Optional for backward compatibility — absent means edge unknown.
   */
  humanEdge?: Record<string, number>;
}

/** What the caller observed about user interaction with one piece of content. */
export interface EngagementEvent {
  /** Discriminated union tag. */
  kind:
    | 'ack'           // user acknowledged an alert
    | 'pin'           // user pinned an alert
    | 'dismiss'       // user dismissed (fast-swiped / fast-acked) with no action
    | 'expand'        // user opened detail view
    | 'export'        // user exported / copied content
    | 'thumbs-up'     // user voted hypothesis useful
    | 'thumbs-down';  // user voted hypothesis noise
  /** Free-text content (alert title + body, hypothesis statement). Used for term extraction. */
  text: string;
  /** Primary domain (e.g. 'finance', 'weather', 'cyber'). */
  domain?: string;
  /** Ms from content creation to this action. Used for ack-latency tracking. */
  ackMs?: number;
  /** Whether the user went deep (opened detail, panel-jump, export). */
  wentDeep?: boolean;
  /** Unix-ms timestamp of the event. Defaults to Date.now(). */
  ts?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-cognition-operator-v1';
const MAX_INTERESTS = 200;
const MIN_TERM_LEN = 4;
const TOP_TERMS_PER_CONTENT = 8;

/** Weekly half-life: weight halves after 7 days without reinforcement. */
const INTEREST_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Interest weight step sizes. */
const POSITIVE_STEP = 0.3;
const NEGATIVE_STEP = 0.15;
const WEIGHT_CLAMP = 5;

/** EWMA alpha for domain affinity updates (recent engagement weighted at ~10%). */
const AFFINITY_ALPHA = 0.1;

/**
 * Fast-ack threshold: if ack arrives within this many ms, it's dismissive.
 * Matches relevance-learner.FAST_ACK_MS.
 */
const FAST_ACK_MS = 10_000;

/** Attention rhythm smoothing alpha (EWMA per bucket). */
const RHYTHM_ALPHA = 0.05;

/** Ack-latency running median window size. */
const ACK_WINDOW = 50;

const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'has', 'have', 'had',
  'was', 'were', 'are', 'will', 'been', 'being', 'into', 'onto', 'over',
  'under', 'after', 'before', 'near', 'against', 'between', 'about', 'than',
  'then', 'them', 'they', 'their', 'there', 'where', 'which', 'while', 'when',
  'what', 'whom', 'whose', 'also', 'some', 'more', 'most', 'such', 'very',
  'said', 'says', 'just', 'like', 'your', 'you', 'our', 'its', 'his', 'her',
  'him', 'she', 'out', 'due', 'per', 'via', 'off', 'new', 'old',
  'alert', 'alerts', 'warning', 'advisory', 'update', 'report', 'reports',
  'breaking', 'news', 'latest',
]);

// ── Default model ─────────────────────────────────────────────────────────────

function emptyRhythm(): number[] {
  return Array.from({length: 168}, () => 1);
}

function defaultModel(): OperatorModel {
  return {
    version: 1,
    interests: [],
    domainAffinity: {},
    expertise: {},
    attentionRhythm: emptyRhythm(),
    responseProfile: { medianAckMs: 30_000, pinRate: 0.05, dismissRate: 0.15 },
    updatedAt: Date.now(),
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

let _model: OperatorModel = defaultModel();
let _loaded = false;
let _writtenSinceLoad = false;

/** Running window of ack latencies for median computation. */
let _ackWindow: number[] = [];

// ── Persistence ───────────────────────────────────────────────────────────────

function applyLoaded(parsed: Partial<OperatorModel> | null): void {
  if (parsed?.version !== 1) return;
  if (Array.isArray(parsed.interests)) _model.interests = parsed.interests;
  if (parsed.domainAffinity && typeof parsed.domainAffinity === 'object') {
    _model.domainAffinity = parsed.domainAffinity;
  }
  if (parsed.expertise && typeof parsed.expertise === 'object') {
    _model.expertise = parsed.expertise;
  }
  if (Array.isArray(parsed.attentionRhythm) && parsed.attentionRhythm.length === 168) {
    _model.attentionRhythm = parsed.attentionRhythm;
  }
  if (parsed.responseProfile && typeof parsed.responseProfile === 'object') {
    _model.responseProfile = { ..._model.responseProfile, ...parsed.responseProfile };
  }
  if (typeof parsed.updatedAt === 'number') _model.updatedAt = parsed.updatedAt;
}

function ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as Partial<OperatorModel>);
  } catch { /* ignore */ }
  void getMemory<Partial<OperatorModel>>(STORAGE_KEY).then(parsed => {
    if (_writtenSinceLoad) return;
    applyLoaded(parsed);
  });
}

function save(): void {
  _writtenSinceLoad = true;
  _model.updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_model)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, _model);
}

// ── Tokenization ──────────────────────────────────────────────────────────────

function extractTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = lower.match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < MIN_TERM_LEN) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= TOP_TERMS_PER_CONTENT) break;
  }
  return out;
}

// ── Interest weight helpers ───────────────────────────────────────────────────

/**
 * Apply weekly half-life decay to a weight based on age since last reinforcement.
 * weight × 0.5^(age / half-life)
 */
export function decayWeight(weight: number, lastReinforced: number, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - lastReinforced);
  const halfLives = ageMs / INTEREST_HALF_LIFE_MS;
  return weight * Math.pow(0.5, halfLives);
}

function bumpInterest(terms: string[], delta: number, nowMs: number): void {
  const index = new Map(_model.interests.map(it => [it.term, it]));
  for (const term of terms) {
    const existing = index.get(term);
    if (existing) {
      // Decay to current moment, then apply delta.
      const decayed = decayWeight(existing.weight, existing.lastReinforced, nowMs);
      const next = Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, decayed + delta));
      existing.weight = next;
      existing.lastReinforced = nowMs;
    } else {
      _model.interests.push({ term, weight: delta, lastReinforced: nowMs });
      index.set(term, _model.interests[_model.interests.length - 1]!);
    }
  }
  // Prune: keep MAX_INTERESTS strongest (by absolute decayed weight).
  if (_model.interests.length > MAX_INTERESTS) {
    _model.interests.sort((a, b) =>
      Math.abs(decayWeight(b.weight, b.lastReinforced, nowMs)) -
      Math.abs(decayWeight(a.weight, a.lastReinforced, nowMs)),
    );
    _model.interests = _model.interests.slice(0, MAX_INTERESTS);
  }
}

// ── Domain affinity helpers ───────────────────────────────────────────────────

function updateAffinity(domain: string, positive: boolean): void {
  const cur = _model.domainAffinity[domain] ?? 0.5;
  const signal = positive ? 1 : 0;
  _model.domainAffinity[domain] = cur + AFFINITY_ALPHA * (signal - cur);
}

// ── Expertise heuristic ───────────────────────────────────────────────────────

/**
 * Update expertise level based on interaction depth in the given domain.
 * Fast-dismiss without expansion → novice signal.
 * Pin + export + panel-jump → expert signal.
 * Accumulate a running counter per domain; cross thresholds determine level.
 */
interface ExpertiseCounter { fastDismiss: number; deep: number; total: number }
const _expertiseCounts: Record<string, ExpertiseCounter> = {};

function updateExpertise(domain: string, wentDeep: boolean, fastDismiss: boolean): void {
  if (!domain) return;
  _expertiseCounts[domain] ??= { fastDismiss: 0, deep: 0, total: 0 };
  const c = _expertiseCounts[domain]!;
  c.total += 1;
  if (wentDeep) c.deep += 1;
  if (fastDismiss) c.fastDismiss += 1;

  // Need at least 10 interactions to form an opinion.
  if (c.total < 10) {
    _model.expertise[domain] = 'novice';
    return;
  }
  const deepRate = c.deep / c.total;
  const dismissRate = c.fastDismiss / c.total;
  if (deepRate >= 0.3) {
    _model.expertise[domain] = 'expert';
  } else if (dismissRate >= 0.6) {
    _model.expertise[domain] = 'novice';
  } else {
    _model.expertise[domain] = 'familiar';
  }
}

// ── Attention rhythm helpers ──────────────────────────────────────────────────

/** Convert a timestamp to hour-of-week index (0–167). */
export function hourOfWeekIndex(ts: number): number {
  const d = new Date(ts);
  return d.getDay() * 24 + d.getHours();
}

function updateRhythm(ts: number): void {
  const idx = hourOfWeekIndex(ts);
  const cur = _model.attentionRhythm[idx] ?? 1;
  // EWMA: signal is 1 (active), old value converges toward observed activity.
  _model.attentionRhythm[idx] = cur + RHYTHM_ALPHA * (1 - cur);
  // Passively decay all other buckets toward neutral (slower).
  for (let i = 0; i < 168; i++) {
    if (i !== idx) {
      const v = _model.attentionRhythm[i] ?? 1;
      _model.attentionRhythm[i] = v + RHYTHM_ALPHA * 0.1 * (1 - v);
    }
  }
}

// ── Ack latency tracking ──────────────────────────────────────────────────────

function updateAckLatency(ackMs: number): void {
  _ackWindow.push(ackMs);
  if (_ackWindow.length > ACK_WINDOW) _ackWindow.shift();
  // Running median via sorted copy.
  const sorted = [..._ackWindow].sort((a, b) => a - b);
  _model.responseProfile.medianAckMs = sorted[Math.floor(sorted.length / 2)] ?? ackMs;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Return a snapshot of the current operator model (defensive copy). */
export function getOperatorModel(): OperatorModel {
  ensureLoaded();
  return {
    ..._model,
    interests: [..._model.interests],
    domainAffinity: { ..._model.domainAffinity },
    expertise: { ..._model.expertise },
    attentionRhythm: [..._model.attentionRhythm],
    responseProfile: { ..._model.responseProfile },
  };
}

/**
 * Compute how much the operator is likely to care about a piece of text.
 *
 * Returns a score in [0, 1] and the matched terms (for explanation invariant).
 * score = 0 means no learned preference; 0.5 is moderate; 1.0 is high interest.
 */
export function interestScore(
  text: string,
  model?: OperatorModel,
): { score: number; matched: string[] } {
  ensureLoaded();
  const m = model ?? _model;
  const terms = extractTerms(text);
  if (terms.length === 0) return { score: 0, matched: [] };

  const nowMs = Date.now();
  const termIndex = new Map(m.interests.map(it => [it.term, it]));
  let sum = 0;
  let n = 0;
  const matched: string[] = [];
  for (const t of terms) {
    const it = termIndex.get(t);
    if (!it) continue;
    const decayed = decayWeight(it.weight, it.lastReinforced, nowMs);
    sum += decayed;
    n += 1;
    matched.push(t);
  }
  if (n === 0) return { score: 0, matched: [] };
  // Average decayed weight, mapped from [-WEIGHT_CLAMP, WEIGHT_CLAMP] to [0, 1].
  const avg = sum / n;
  const score = Math.max(0, Math.min(1, (avg + WEIGHT_CLAMP) / (2 * WEIGHT_CLAMP)));
  return { score, matched };
}

/**
 * Bounded operator-model multiplier for any scoring surface.
 *
 * Formula: 0.8 + 0.4 × combinedScore
 * combinedScore = interestScore(text) blended with humanEdge signal for the
 * given domain (if available from the PR 10 forecast journal). humanEdge is
 * a Brier-difference in [-1, 1]; we normalize it into [0, 1] and weight it
 * at 30% of the combined signal when present, interestScore at 70%. When
 * humanEdge is absent the formula collapses to the original 0.8 + 0.4 × interestScore.
 *
 * Combined bound invariant: result is hard-clamped to [0.8, 1.2] so the total
 * personalization effect never exceeds ±20%, regardless of humanEdge value.
 * Property-tested in operator-model.test.mts.
 *
 * @param text    Content to score by interest terms.
 * @param domain  Domain for humanEdge lookup (optional).
 */
export function interestMultiplier(text: string, domain?: string): number {
  const { score: interestScoreVal } = interestScore(text);
  ensureLoaded();

  // Blend in humanEdge if available for this domain.
  // humanEdge ∈ [-1, 1] (systemBrier − operatorBrier); normalize to [0, 1].
  // Positive humanEdge (operator better) → boost; negative → pull back.
  const edge = domain !== undefined ? (_model.humanEdge?.[domain] ?? null) : null;
  let combinedScore: number;
  if (edge !== null) {
    // Normalize: edge of +0.25 (operator quite a bit better) → edgeNorm ≈ 1.0
    // edge of -0.25 (system better) → edgeNorm ≈ 0.0; clamp to [0, 1].
    const edgeNorm = Math.max(0, Math.min(1, (edge + 0.25) / 0.5));
    combinedScore = 0.7 * interestScoreVal + 0.3 * edgeNorm;
  } else {
    combinedScore = interestScoreVal;
  }

  // Hard clamp to [0.8, 1.2] — the ±20% personalization bound is inviolable.
  return Math.max(0.8, Math.min(1.2, 0.8 + 0.4 * combinedScore));
}

/**
 * Update the per-domain human edge values on the operator model.
 *
 * Called by forecast-journal.refreshHumanEdge() after each batch of resolutions.
 * Ghost Mode writes are suppressed by the journal before this is called, but
 * we guard here as well for defense-in-depth.
 *
 * @param edge  Record<domain, systemBrier − operatorBrier>
 */
export function updateHumanEdge(edge: Record<string, number>): void {
  if (isGhostMode()) return;
  ensureLoaded();
  _model.humanEdge = { ...(_model.humanEdge ?? {}), ...edge };
  save();
}

/**
 * Preferred explanation depth for a given domain based on accumulated expertise.
 *
 * 'novice' → 'headline' (keep it simple)
 * 'familiar' → 'standard' (normal depth)
 * 'expert' → 'deep' (full evidence trail)
 * Unknown domain → 'standard'.
 */
export function preferredDepth(domain: string): DepthPreference {
  ensureLoaded();
  const expertise = _model.expertise[domain] ?? 'familiar';
  switch (expertise) {
    case 'novice': { return 'headline';
    }
    case 'expert': { return 'deep';
    }
    default: { return 'standard';
    }
  }
}

/**
 * Attention weight at a given timestamp (defaults to now).
 *
 * Returns 0–1 from the stored attention rhythm. 1.0 = historically active
 * at this hour; lower = historically quiet. Used by notification-ladder to
 * decide whether to defer a non-safety notification.
 */
export function attentionWeight(ts?: number): number {
  ensureLoaded();
  const idx = hourOfWeekIndex(ts ?? Date.now());
  const raw = _model.attentionRhythm[idx] ?? 1;
  // Normalize to [0, 1] relative to the max bucket in the rhythm.
  const max = Math.max(..._model.attentionRhythm, 0.001);
  return Math.max(0, Math.min(1, raw / max));
}

/**
 * The next hour-of-week index at which attentionWeight >= threshold.
 * Used by the notification deferral path to find the next active window.
 *
 * Returns undefined if no such hour exists in the next 24 hours.
 */
export function nextActiveHour(
  afterTs: number,
  threshold = 0.5,
): number | undefined {
  ensureLoaded();
  const max = Math.max(..._model.attentionRhythm, 0.001);
  for (let h = 1; h <= 24; h++) {
    const candidateTs = afterTs + h * 60 * 60 * 1000;
    const idx = hourOfWeekIndex(candidateTs);
    const w = (_model.attentionRhythm[idx] ?? 1) / max;
    if (w >= threshold) return candidateTs;
  }
  return undefined;
}

/**
 * Single ingest point for all engagement signals.
 *
 * Ghost Mode: this is a complete no-op; reads still work.
 */
export function recordEngagement(e: EngagementEvent): void {
  if (isGhostMode()) return;
  ensureLoaded();

  const nowMs = e.ts ?? Date.now();
  const terms = extractTerms(e.text);

  // ── Interest weights ─────────────────────────────────────────────────
  const isPositive =
    e.kind === 'pin' ||
    e.kind === 'expand' ||
    e.kind === 'export' ||
    e.kind === 'thumbs-up';
  const isNegative =
    e.kind === 'dismiss' ||
    e.kind === 'thumbs-down' ||
    (e.kind === 'ack' && typeof e.ackMs === 'number' && e.ackMs < FAST_ACK_MS);

  if (isPositive) bumpInterest(terms, POSITIVE_STEP, nowMs);
  else if (isNegative) bumpInterest(terms, -NEGATIVE_STEP, nowMs);
  // Plain ack (not fast) → no interest update; it's a neutral action.

  // ── Domain affinity ──────────────────────────────────────────────────
  if (e.domain) {
    updateAffinity(e.domain, isPositive);
  }

  // ── Expertise heuristic ──────────────────────────────────────────────
  if (e.domain) {
    const isFastDismiss = isNegative && e.kind !== 'thumbs-down'; // thumbs-down is deliberate
    updateExpertise(e.domain, !!e.wentDeep, isFastDismiss);
  }

  // ── Attention rhythm ─────────────────────────────────────────────────
  updateRhythm(nowMs);

  // ── Response profile ─────────────────────────────────────────────────
  if (e.kind === 'ack' && typeof e.ackMs === 'number' && e.ackMs > 0) {
    updateAckLatency(e.ackMs);
  }
  if (e.kind === 'pin') {
    // Increment pin rate (running mean).
    const { pinRate } = _model.responseProfile;
    _model.responseProfile.pinRate = pinRate + 0.01 * (1 - pinRate);
  }
  if (e.kind === 'dismiss') {
    const { dismissRate } = _model.responseProfile;
    _model.responseProfile.dismissRate = dismissRate + 0.01 * (1 - dismissRate);
  }

  save();
}

/** Reset the operator model to factory defaults (user-facing wipe). */
export function resetOperatorModel(): void {
  _model = defaultModel();
  _ackWindow = [];
  for (const k of Object.keys(_expertiseCounts)) {
    delete _expertiseCounts[k];
  }
  _writtenSinceLoad = true;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  void putMemory(STORAGE_KEY, _model);
}

/** Exposed for tests — override the internal model instance directly. */
export function _testOnlySetModel(m: OperatorModel): void {
  _model = { ...m };
  _loaded = true;
  _writtenSinceLoad = false;
}

/** Exposed for tests — override loaded flag so ensureLoaded doesn't stompe. */
export function _testOnlyMarkLoaded(): void {
  _loaded = true;
}

/** Exposed for tests — reset expertise counters. */
export function _testOnlyResetExpertise(): void {
  for (const k of Object.keys(_expertiseCounts)) {
    delete _expertiseCounts[k];
  }
}
