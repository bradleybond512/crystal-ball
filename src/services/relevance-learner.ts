/**
 * Relevance Learner — per-user topic learning from alert engagement.
 *
 * Complements source-feedback.ts (which learns at the SOURCE level) by
 * learning at the TOPIC level: terms the user clicks, pins, or spends time
 * on get positive weight; terms they fast-ack get negative weight.
 *
 * The learner:
 *   - watches alert ack/pin/snooze transitions on unifiedAlertStore
 *   - tokenizes alert title+body, filters stopwords, takes top N terms
 *   - maintains a weight map (term → signed score)
 *   - exposes getRelevanceBoost(alert) → multiplicative factor in [0.6, 1.6]
 *
 * Ghost Mode suppresses learning (user expects no engagement footprint) but
 * still applies already-learned weights.
 *
 * All state is local: localStorage only, never transmitted.
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';
import { isGhostMode } from './mode-manager';
import { getMemory, putMemory } from './reasoning-memory';
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-relevance-weights-v1';
const MAX_TERMS = 500;
const MIN_TERM_LEN = 4;
const TOP_TERMS_PER_ALERT = 8;
const FAST_ACK_MS = 10_000;
const POSITIVE_STEP = 0.25;
const NEGATIVE_STEP = 0.12;
const DECAY_PER_WRITE = 0.998;
const WEIGHT_CLAMP = 4;
const BOOST_MIN = 0.6;
const BOOST_MAX = 1.6;

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

// ── State ─────────────────────────────────────────────────────────────────────

interface LearnerState {
  weights: Record<string, number>;
  writeCount: number;
}

let state: LearnerState = { weights: {}, writeCount: 0 };
let writtenSinceLoad = false;

function applyState(parsed: Partial<LearnerState> | null): void {
  if (!parsed) return;
  if (parsed.weights && typeof parsed.weights === 'object') {
    state.weights = parsed.weights;
  }
  if (typeof parsed.writeCount === 'number') {
    state.writeCount = parsed.writeCount;
  }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyState(JSON.parse(raw) as Partial<LearnerState>);
  } catch { /* ignore */ }
  void getMemory<LearnerState>(STORAGE_KEY).then(parsed => {
    if (writtenSinceLoad) return;
    applyState(parsed);
  });
}
function save(): void {
  writtenSinceLoad = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, state);
}

// ── Tokenization ──────────────────────────────────────────────────────────────

/** Extract informative terms from alert text. Lowercase, deduped, stopword-filtered. */
function extractTerms(alert: UnifiedAlert): string[] {
  const text = `${alert.title} ${alert.body}`.toLowerCase();
  const tokens = text.match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < MIN_TERM_LEN) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= TOP_TERMS_PER_ALERT) break;
  }
  // Always include source and severity as "pseudo-terms" for coarse signal.
  out.push(`__src:${alert.source}`, `__sev:${alert.severity}`);
  return out;
}

// ── Weight updates ────────────────────────────────────────────────────────────

function bump(term: string, delta: number): void {
  const cur = state.weights[term] ?? 0;
  const next = Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, cur + delta));
  if (next === 0) delete state.weights[term];
  else state.weights[term] = next;
}

function decayAll(): void {
  // Periodic decay stops stale preferences from dominating forever.
  for (const [k, v] of Object.entries(state.weights)) {
    const next = v * DECAY_PER_WRITE;
    if (Math.abs(next) < 0.05) delete state.weights[k];
    else state.weights[k] = next;
  }
}

function prune(): void {
  const entries = Object.entries(state.weights);
  if (entries.length <= MAX_TERMS) return;
  // Keep the MAX_TERMS strongest (by |weight|).
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const kept = entries.slice(0, MAX_TERMS);
  state.weights = Object.fromEntries(kept);
}

function learn(alert: UnifiedAlert, polarity: 'positive' | 'negative'): void {
  if (isGhostMode()) return;
  const _t0 = Date.now();
  const step = polarity === 'positive' ? POSITIVE_STEP : -NEGATIVE_STEP;
  const terms = extractTerms(alert);
  for (const term of terms) bump(term, step);

  state.writeCount += 1;
  if (state.writeCount % 20 === 0) decayAll();
  prune();
  save();

  try {
    recordAlgorithmEvaluation('relevance-learner', {
      durationMs: Date.now() - _t0,
      score: polarity === 'positive' ? 1 : 0,
      label: polarity,
      detail: { terms: terms.length, totalWeights: Object.keys(state.weights).length },
    });
  } catch { /* ledger unavailable */ }
}

// ── Boost computation ────────────────────────────────────────────────────────

/**
 * Compute a multiplier in [BOOST_MIN, BOOST_MAX] to apply to an alert's score.
 * Unknown alerts return 1.0. The boost reflects learned preference for the
 * terms/source/severity the alert carries.
 */
export function getRelevanceBoost(alert: UnifiedAlert): number {
  const terms = extractTerms(alert);
  let sum = 0;
  let n = 0;
  for (const t of terms) {
    const w = state.weights[t];
    if (w === undefined) continue;
    sum += w;
    n += 1;
  }
  if (n === 0) return 1;
  const avg = sum / n;
  // avg is in roughly [-WEIGHT_CLAMP, WEIGHT_CLAMP]; map via tanh into the boost range.
  const shaped = Math.tanh(avg / 2);
  const mid = (BOOST_MIN + BOOST_MAX) / 2;
  const half = (BOOST_MAX - BOOST_MIN) / 2;
  return mid + shaped * half;
}

/** Debug / settings surface — read-only weights snapshot. */
export function getRelevanceWeights(): Readonly<Record<string, number>> {
  return { ...state.weights };
}

/** User-facing reset for the learned profile. */
export function resetRelevanceWeights(): void {
  state = { weights: {}, writeCount: 0 };
  writtenSinceLoad = true;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  void putMemory(STORAGE_KEY, state);
}

// ── Engagement observer ──────────────────────────────────────────────────────

let started = false;

export function startRelevanceLearner(): void {
  if (started) return;
  started = true;
  load();

  const firstSeen = new Map<string, number>();
  const prevAcked = new Set<string>();
  const prevPinned = new Set<string>();
  const prevSnoozed = new Set<string>();

  for (const a of unifiedAlertStore.getAll()) {
    firstSeen.set(a.id, Date.now());
    if (a.acknowledged) prevAcked.add(a.id);
    if (a.pinned) prevPinned.add(a.id);
    if (a.snoozedUntil && a.snoozedUntil > Date.now()) prevSnoozed.add(a.id);
  }

  const onPin = (alert: UnifiedAlert): void => {
    if (!alert.pinned || prevPinned.has(alert.id)) return;
    learn(alert, 'positive');
    prevPinned.add(alert.id);
  };
  const onAck = (alert: UnifiedAlert, now: number): void => {
    if (!alert.acknowledged || prevAcked.has(alert.id)) return;
    const seen = firstSeen.get(alert.id) ?? now;
    if (now - seen < FAST_ACK_MS) learn(alert, 'negative');
    prevAcked.add(alert.id);
  };
  const onSnooze = (alert: UnifiedAlert, now: number): void => {
    if (!alert.snoozedUntil || alert.snoozedUntil <= now) return;
    if (prevSnoozed.has(alert.id)) return;
    learn(alert, 'negative');
    prevSnoozed.add(alert.id);
  };

  unifiedAlertStore.subscribe(() => {
    const now = Date.now();
    for (const alert of unifiedAlertStore.getAll()) {
      if (!firstSeen.has(alert.id)) firstSeen.set(alert.id, now);
      onPin(alert);
      onAck(alert, now);
      onSnooze(alert, now);
    }
  });

  // Click-through engagement: if anything dispatches a map-pulse focus event
  // for an alert, treat that as a positive engagement signal.
  document.addEventListener('cb:alert-focused', (e: Event) => {
    const ce = e as CustomEvent<{ alertId?: string }>;
    const id = ce.detail?.alertId;
    if (!id) return;
    const a = unifiedAlertStore.getAll().find(x => x.id === id);
    if (a) learn(a, 'positive');
  });
}
