/**
 * Hypothesis Accuracy — grades analyst-loop hypotheses against outcomes.
 *
 * Each emitted hypothesis is stamped and kept for a grading window. After
 * the window, we check whether the underlying evidence actually escalated
 * (situation went to `active`, compound threat persisted, alert burst held
 * its hot score) or fizzled. The result feeds a per-kind+signature
 * accuracy score used by analyst-loop as an additional ranking signal.
 *
 * Over time the scorer answers "which hypothesis patterns tend to pan out?"
 * without any supervised labels from the user — pure outcome tracking.
 */

import type { Hypothesis, AnalystSnapshot } from './analyst-loop';
import { logDebug } from './reasoning-debug';
import { situationEngine } from './situation-engine';
import { unifiedAlertStore } from './unified-alerts';
import { scoreAlert } from './alert-routing';
import { signatureFor } from './hypothesis-feedback';
import { getMemory, putMemory } from './reasoning-memory';
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';
import { resolveHypothesisPredictionBySig } from './intelligence/hypothesis-prediction-bridge';
import { resolveEpisodeForSignature } from '@/services/cognition/episodic-memory-bridge';
import { getCachedAnalogScore } from '@/services/cognition/episodic-memory';
import { interestMultiplier } from '@/services/cognition/operator-model';
import {
  gradeEpisodicAnalogOnResolution,
  gradeOperatorRankingOnResolution,
} from '@/services/cognition/self-tuning';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-hypothesis-accuracy-v1';
const GRADE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours — long enough for a situation to mature
const MAX_PENDING = 200;
const HOT_SCORE_THRESHOLD = 40;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingHypothesis {
  id: string;
  signature: string;
  kind: Hypothesis['kind'];
  emittedAt: number;
  /** Evidence pointers captured at emit time. */
  situationIds: string[];
  alertIds: string[];
  initialConfidence: number;
  /** EMIT-TIME episodic analog score for this signature (cognition PR 12).
   *  Stamped so grading never reads the post-resolution cache, which would
   *  include the resolved episode itself (outcome leakage). Optional:
   *  entries persisted before PR 12 lack it and are skipped by the grader. */
  analogScore?: number | null;
  /** EMIT-TIME operator interest multiplier (cognition PR 12). Stamped so
   *  grading is not biased by in-window engagement reinforcement. Optional:
   *  legacy entries lack it and are skipped by the grader. */
  operatorMult?: number;
}

interface AccuracyStats {
  /** Count of hypotheses graded correct (evidence escalated or persisted). */
  hits: number;
  /** Count of hypotheses graded incorrect (evidence fizzled). */
  misses: number;
  lastGraded: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

const pending: PendingHypothesis[] = [];
const bySignature = new Map<string, AccuracyStats>();
const byKind = new Map<Hypothesis['kind'], AccuracyStats>();
let loaded = false;
let writtenSinceLoad = false;

interface Persisted {
  pending: PendingHypothesis[];
  bySignature: Record<string, AccuracyStats>;
  byKind: Record<string, AccuracyStats>;
}

function hydrate(parsed: Partial<Persisted>): void {
  if (Array.isArray(parsed.pending)) {
    pending.length = 0;
    pending.push(...parsed.pending);
  }
  if (parsed.bySignature) {
    bySignature.clear();
    for (const [k, v] of Object.entries(parsed.bySignature)) bySignature.set(k, v);
  }
  if (parsed.byKind) {
    byKind.clear();
    for (const [k, v] of Object.entries(parsed.byKind)) {
      byKind.set(k as Hypothesis['kind'], v);
    }
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) hydrate(JSON.parse(raw) as Partial<Persisted>);
  } catch { /* ignore */ }
  void getMemory<Persisted>(STORAGE_KEY).then(value => {
    if (writtenSinceLoad) return;
    if (value) hydrate(value);
  }).catch(() => { /* IDB unavailable; localStorage bootstrap still valid */ });
}

function save(): void {
  writtenSinceLoad = true;
  const out: Persisted = {
    pending,
    bySignature: Object.fromEntries(bySignature),
    byKind: Object.fromEntries(byKind),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, out).catch(() => { /* IDB write failed */ });
}

// ── Stamping ─────────────────────────────────────────────────────────────────

/** Cognition PR 12: capture the EMIT-TIME analog score + operator interest
 *  multiplier so resolution-time grading uses the values that actually
 *  influenced this cycle's ranking (never a post-resolution recomputation).
 *  Guarded: a cognition failure must never break hypothesis stamping. */
function cognitionStamps(h: Hypothesis, signature: string): { analogScore: number | null; operatorMult: number | undefined } {
  let analogScore: number | null = null;
  let operatorMult: number | undefined;
  try { analogScore = getCachedAnalogScore(signature); } catch { /* cache unavailable */ }
  try { operatorMult = interestMultiplier(h.statement); } catch { /* operator model unavailable */ }
  return { analogScore, operatorMult };
}

function stamp(snapshot: AnalystSnapshot): void {
  for (const h of snapshot.hypotheses) {
    const signature = signatureFor(h);
    const { analogScore, operatorMult } = cognitionStamps(h, signature);
    pending.push({
      id: h.id,
      signature,
      kind: h.kind,
      emittedAt: h.timestamp,
      situationIds: h.evidence.filter(e => e.source === 'situation-engine').map(e => e.id),
      alertIds: h.evidence.filter(e => e.source === 'unified-alerts').map(e => e.id),
      initialConfidence: h.confidence,
      analogScore,
      operatorMult,
    });
  }
  // Cap the pending queue to keep localStorage footprint bounded.
  if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
  save();
}

// ── Grading ──────────────────────────────────────────────────────────────────

/**
 * Grade a pending hypothesis. Returns true if evidence escalated,
 * false if it fizzled, and null when there's no evidence left to
 * check (e.g. the situation naturally resolved and the alert was
 * purged). Null means "skip — don't update stats either way", which
 * avoids a false-negative bias against hypotheses whose evidence
 * disappeared before we got to grade them.
 */
function didEvidenceEscalate(p: PendingHypothesis): boolean | null {
  // Situation evidence: escalation = still present AND phase is active/developing.
  const situations = situationEngine.getSituations();
  const sitMap = new Map(situations.map(s => [s.id, s]));
  let sitHit = 0;
  let sitChecked = 0;
  for (const sid of p.situationIds) {
    const s = sitMap.get(sid);
    if (!s) continue;
    sitChecked += 1;
    if (s.phase === 'active' || s.phase === 'developing') sitHit += 1;
  }

  // Alert evidence: escalation = still unacked with hot score OR pinned.
  const alerts = unifiedAlertStore.getAll();
  const alertMap = new Map(alerts.map(a => [a.id, a]));
  let alertHit = 0;
  let alertChecked = 0;
  const now = Date.now();
  for (const aid of p.alertIds) {
    const a = alertMap.get(aid);
    if (!a) continue;
    alertChecked += 1;
    if (a.pinned) { alertHit += 1; continue; }
    if (!a.acknowledged && scoreAlert(a, now) >= HOT_SCORE_THRESHOLD) alertHit += 1;
  }

  const totalChecked = sitChecked + alertChecked;
  if (totalChecked === 0) return null; // evidence gone — skip grading
  const hitRatio = (sitHit + alertHit) / totalChecked;
  return hitRatio >= 0.5;
}

function bumpStats(stats: AccuracyStats, hit: boolean): void {
  if (hit) stats.hits += 1;
  else stats.misses += 1;
  stats.lastGraded = Date.now();
}

function gradeOne(p: PendingHypothesis): void {
  const _t0 = Date.now();
  const hit = didEvidenceEscalate(p);
  if (hit === null) return; // no evidence left to judge — skip, don't record a miss

  const sigStats = bySignature.get(p.signature) ?? { hits: 0, misses: 0, lastGraded: 0 };
  bumpStats(sigStats, hit);
  bySignature.set(p.signature, sigStats);

  const kindStats = byKind.get(p.kind) ?? { hits: 0, misses: 0, lastGraded: 0 };
  bumpStats(kindStats, hit);
  byKind.set(p.kind, kindStats);

  try {
    recordAlgorithmEvaluation('hypothesis-accuracy', {
      durationMs: Date.now() - _t0,
      score: hit ? 1 : 0,
      label: hit ? 'hit' : 'miss',
      detail: { kind: p.kind, situationIds: p.situationIds.length, alertIds: p.alertIds.length },
    });
  } catch { /* ledger unavailable */ }
  try { resolveHypothesisPredictionBySig(p.signature, hit); } catch { /* best-effort */ }

  // Episodic memory: resolve the corresponding episode so it carries an outcome.
  // Fire-and-forget via bridge; never throws into this grading path.
  try {
    resolveEpisodeForSignature(
      p.signature,
      hit ? 'materialized' : 'fizzled',
    );
  } catch { /* episodic memory unavailable */ }

  // Cognition PR 12: grade the analog engine + the operator-model's
  // ranking personalization against this resolution, from the EMIT-TIME
  // values stamped on the pending hypothesis (unstamped legacy entries are
  // skipped). Fire-and-forget; never throws into this grading path.
  try {
    gradeEpisodicAnalogOnResolution(p.analogScore, hit);
  } catch { /* evaluation ledger unavailable */ }
  try {
    gradeOperatorRankingOnResolution(p.operatorMult, hit);
  } catch { /* evaluation ledger unavailable */ }
}

function gradeDue(): void {
  const now = Date.now();
  const kept: PendingHypothesis[] = [];
  for (const p of pending) {
    if (now - p.emittedAt < GRADE_WINDOW_MS) {
      kept.push(p);
      continue;
    }
    gradeOne(p);
  }
  if (kept.length !== pending.length) {
    pending.length = 0;
    pending.push(...kept);
    save();
  }
}

// ── Accuracy multiplier ──────────────────────────────────────────────────────

function accuracyRatio(stats: AccuracyStats | undefined, minSamples: number): number | null {
  if (!stats) return null;
  const total = stats.hits + stats.misses;
  if (total < minSamples) return null;
  return stats.hits / total;
}

/**
 * Returns a multiplier in [0.7, 1.3] reflecting how often hypotheses with
 * this signature (or kind, as a fallback) have panned out historically.
 * 0.5 hit ratio = 1.0; 1.0 hit ratio = 1.3; 0.0 hit ratio = 0.7.
 */
export function getHypothesisAccuracyMult(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): number {
  load();
  const sigRatio = accuracyRatio(bySignature.get(signatureFor(h)), 3);
  const kindRatio = accuracyRatio(byKind.get(h.kind), 5);
  const ratio = sigRatio ?? kindRatio;
  if (ratio === null) return 1;
  // Map [0,1] linearly to [0.7, 1.3].
  return 0.7 + ratio * 0.6;
}

/** Aggregate accuracy per hypothesis kind, for debug/status overlays. */
export function getKindAccuracy(): ReadonlyMap<Hypothesis['kind'], AccuracyStats> {
  load();
  return new Map(byKind);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;
let graderTimer: ReturnType<typeof setInterval> | null = null;
let _stampListener: ((e: Event) => void) | null = null;

export function startHypothesisAccuracy(): void {
  if (started) return;
  started = true;
  load();

  _stampListener = (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    stamp(ce.detail);
  };
  document.addEventListener('cb:analyst-hypotheses', _stampListener);

  // Grade pending hypotheses every 10 minutes.
  graderTimer = setInterval(() => {
    try { gradeDue(); } catch (error) {
      logDebug({ level: 'warn', category: 'hypothesis', source: 'hypothesis-accuracy',
        message: 'gradeDue error',
        data: { error: error instanceof Error ? error.message : String(error) } });
    }
  }, 10 * 60 * 1000);
  try { gradeDue(); } catch (error) {
    logDebug({ level: 'warn', category: 'hypothesis', source: 'hypothesis-accuracy',
      message: 'initial gradeDue error',
      data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

export function stopHypothesisAccuracy(): void {
  started = false;
  if (graderTimer !== null) {
    clearInterval(graderTimer);
    graderTimer = null;
  }
  if (_stampListener !== null) {
    document.removeEventListener('cb:analyst-hypotheses', _stampListener);
    _stampListener = null;
  }
}
