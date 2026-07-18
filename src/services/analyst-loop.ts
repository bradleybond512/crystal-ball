/**
 * Analyst Loop — Cross-Domain Reasoning Orchestrator
 *
 * Persistent background loop that fuses outputs from the existing reasoning
 * services (situation-engine, anomaly-detection, unified-alert hot list,
 * compound-threat via threat-synthesis) into a single ranked list of
 * hypotheses with evidence links.
 *
 * Unlike threat-synthesis (which is an on-demand AI call), this service:
 *   - runs on a slow cadence in the background
 *   - merges multiple reasoning surfaces instead of one
 *   - always produces hypotheses even when AI is unavailable
 *   - emits a `cb:analyst-hypotheses` event + persists to localStorage so
 *     panels and the HUD can subscribe without duplicating the fusion logic
 *
 * This is intentionally a thin fusion layer over existing services — it does
 * not reimplement clustering, it reads what each service already produced.
 */

import { situationEngine } from './situation-engine';
import { anomalyEngine, type Anomaly } from './anomaly-detection';
import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';
import { scoreAlert, panelForAlert } from './alert-routing';
import { getCachedSynthesis, type CrossDomainCluster, type EscalationRisk } from './threat-synthesis';
import { isGhostMode, getGhostRefreshMultiplier } from './mode-manager';
import { getHypothesisFeedbackMult, signatureFor } from './hypothesis-feedback';
import { getHypothesisAccuracyMult } from './hypothesis-accuracy';
import { getDomainCalibrationMult } from './intelligence/forecast-calibration-adapter';
import { recordHypothesisPredictions, domainForHypothesis } from './intelligence/hypothesis-prediction-bridge';
import { isDismissed } from './analyst-command-listener';
import { dedupeHypotheses } from './hypothesis-dedupe';
import { getWatchlistHypotheses } from './watchlist-hypothesis-bridge';
import { logDebug } from './reasoning-debug';
import { recordLatency, incrementCounter } from './reasoning-metrics';
import type { Situation } from './situation-types';
import { recordEpisode, updateAnalogCache } from '@/services/cognition/episodic-memory';
import { interestMultiplier } from '@/services/cognition/operator-model';
import { ingestFromHypotheses } from '@/services/cognition/entity-dossier';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HypothesisKind =
  | 'cross-domain-cluster'
  | 'anomaly-convergence'
  | 'alert-burst'
  | 'situation-escalation'
  | 'watchlist-convergence';

export interface HypothesisEvidence {
  /** Where the evidence came from (service name). */
  source: 'situation-engine' | 'anomaly-detection' | 'unified-alerts' | 'threat-synthesis';
  /** Stable ID we can deep-link back to. */
  id: string;
  /** Short label to render in UI. */
  label: string;
  /** Panel ID the evidence lives in, for jumpToPanel(). */
  panelId?: string;
}

export interface Hypothesis {
  id: string;
  kind: HypothesisKind;
  /** One-sentence hypothesis in analyst voice. */
  statement: string;
  /** 0–1 confidence; priority-ranked descending. */
  confidence: number;
  /** Computed escalation risk on the shared scale. */
  risk: EscalationRisk;
  /** Evidence pointers — clickable links in the HUD/panel. */
  evidence: HypothesisEvidence[];
  /** Unix-ms timestamp of generation. */
  timestamp: number;
  /** Region label if one clearly dominates. */
  region?: string;
}

export interface AnalystSnapshot {
  timestamp: number;
  hypotheses: Hypothesis[];
  /** Whether this cycle used AI-synthesized clusters. */
  aiEnriched: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const HOT_ALERT_SCORE = 55;               // raised 50→55; tighter entry to burst pool
const BURST_WINDOW_MS = 15 * 60 * 1000;    // 15 minutes
const BURST_THRESHOLD = 10;                // raised 6→10; reduces false-positive hypotheses
const STORAGE_KEY = 'crystalball-analyst-snapshot-v1';
const EVENT_NAME = 'cb:analyst-hypotheses';
const MAX_HYPOTHESES = 12;

// ── ID generation ─────────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(): string {
  _idCounter += 1;
  return `hyp-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// ── Risk helpers ──────────────────────────────────────────────────────────────

function confidenceToRisk(c: number): EscalationRisk {
  if (c >= 0.8) return 'critical';
  if (c >= 0.6) return 'high';
  if (c >= 0.35) return 'moderate';
  return 'low';
}

const RISK_RANK: Record<EscalationRisk, number> = {
  critical: 3, high: 2, moderate: 1, low: 0,
};

/**
 * Ranking weight = raw confidence × learned user preference × outcome accuracy
 * × per-domain Brier-derived calibration multiplier
 * × operator-model personalization tilt (bounded ±20%).
 * Multiplier bounds: feedback [0.5,1.3] × accuracy [0.7,1.3] × calibration [0.7,1.2]
 * × operator interest [0.8,1.2] (0.8 + 0.4 × interestScore(statement), clamped inside
 * interestMultiplier() so personalization tilts the ranking, it does not determine it).
 */
function rankingWeight(h: Hypothesis): number {
  return h.confidence
    * getHypothesisFeedbackMult(h)
    * getHypothesisAccuracyMult(h)
    * getDomainCalibrationMult(domainForHypothesis(h))
    * interestMultiplier(h.statement);
}

// ── Per-source hypothesis builders ───────────────────────────────────────────

function fromClusters(clusters: CrossDomainCluster[]): Hypothesis[] {
  return clusters.map((c): Hypothesis => ({
    id: genId(),
    kind: 'cross-domain-cluster',
    statement: c.causalHypothesis && c.causalHypothesis.length > 10
      ? c.causalHypothesis.slice(0, 280)
      : `Concurrent ${c.domains.join('+')} signals converging on ${c.region}.`,
    confidence: c.confidence,
    risk: c.escalationRisk,
    region: c.region,
    timestamp: Date.now(),
    evidence: [
      ...c.situationIds.map((id): HypothesisEvidence => ({
        source: 'situation-engine',
        id,
        label: `Situation ${id}`,
        panelId: 'situation-awareness',
      })),
      ...c.compoundThreatIds.map((id): HypothesisEvidence => ({
        source: 'threat-synthesis',
        id,
        label: `Compound ${id}`,
        panelId: 'compound-threat',
      })),
    ],
  }));
}

/** Group active anomalies whose sources share a prefix (e.g. "weather:*"). */
function fromAnomalies(anomalies: Anomaly[]): Hypothesis[] {
  if (anomalies.length < 2) return [];
  const byPrefix = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    const prefix = a.source.split(':')[0] ?? a.source;
    const bucket = byPrefix.get(prefix);
    if (bucket) bucket.push(a);
    else byPrefix.set(prefix, [a]);
  }
  const out: Hypothesis[] = [];
  for (const [prefix, group] of byPrefix) {
    if (group.length < 2) continue;
    const worstZ = Math.max(...group.map(a => Math.abs(a.zScore)));
    const confidence = Math.min(0.95, 0.4 + Math.min(0.5, worstZ / 10));
    const descriptions = group.slice(0, 3).map(a => a.description).join('; ');
    out.push({
      id: genId(),
      kind: 'anomaly-convergence',
      statement:
        `${group.length} concurrent anomalies in ${prefix} domain (max z=${worstZ.toFixed(1)}): ${descriptions}`,
      confidence,
      risk: confidenceToRisk(confidence),
      timestamp: Date.now(),
      evidence: group.map((a): HypothesisEvidence => ({
        source: 'anomaly-detection',
        id: a.id,
        label: `${a.type} ${a.source}`,
      })),
    });
  }
  return out;
}

/**
 * Deduplicate burst alerts by title prefix so that 20 NWS "Flood Warning"
 * alerts for the same watershed don't each count as a separate burst signal.
 * Groups whose prefix (first 30 chars, lowercased) collide keep only the
 * highest-severity representative. Returns deduplicated list.
 */
function dedupeByTitlePrefix(alerts: UnifiedAlert[]): UnifiedAlert[] {
  const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const best = new Map<string, UnifiedAlert>();
  for (const a of alerts) {
    const key = a.title.toLowerCase().slice(0, 30);
    const prev = best.get(key);
    if (!prev || (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[prev.severity] ?? 0)) {
      best.set(key, a);
    }
  }
  return [...best.values()];
}

/** Detect geographic bursts: many hot alerts in a short window sharing a panel. */
/** The most frequent alert source in a group (ties broken by first-seen). */
function dominantSourceOf(alerts: readonly UnifiedAlert[]): UnifiedAlert['source'] | undefined {
  const counts = new Map<UnifiedAlert['source'], number>();
  for (const a of alerts) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  let dominant: UnifiedAlert['source'] | undefined;
  let max = 0;
  for (const [src, count] of counts) {
    if (count > max) { max = count; dominant = src; }
  }
  return dominant;
}

function fromAlertBurst(alerts: UnifiedAlert[]): Hypothesis[] {
  const now = Date.now();
  const hot = alerts.filter(a =>
    !a.acknowledged &&
    now - a.timestamp <= BURST_WINDOW_MS &&
    scoreAlert(a, now) >= HOT_ALERT_SCORE);

  if (hot.length < BURST_THRESHOLD) return [];

  const byPanel = new Map<string, UnifiedAlert[]>();
  for (const a of hot) {
    const pid = panelForAlert(a);
    const bucket = byPanel.get(pid);
    if (bucket) bucket.push(a);
    else byPanel.set(pid, [a]);
  }

  const out: Hypothesis[] = [];
  for (const [panelId, group] of byPanel) {
    if (group.length < BURST_THRESHOLD) continue;

    // Deduplicate same-type alerts (e.g. 20 "Flood Warning" zones → 1 representative)
    const unique = dedupeByTitlePrefix(group);
    if (unique.length < BURST_THRESHOLD) continue;

    // Severity-weighted confidence: a burst of critical/high alerts earns more
    // confidence than the same count of low/info alerts.
    const SWEIGHT: Record<string, number> = { critical: 4, high: 2.5, medium: 1.5, low: 0.5, info: 0.1 };
    const severitySum = unique.reduce((s, a) => s + (SWEIGHT[a.severity] ?? 1), 0);
    const rawConf = Math.min(0.85, 0.35 + severitySum / (unique.length * 4));

    // Source quality floor: cap confidence if the burst is dominated by
    // low-signal sources (e.g. air-quality or travel-advisory noise).
    const SOURCE_CAP: Partial<Record<UnifiedAlert['source'], number>> = {
      'air-quality': 0.6, 'travel-advisory': 0.65, 'local-ids': 0.55,
    };
    // Dominant = the most frequent source in the burst, not whichever alert
    // sorted first — otherwise a burst that is mostly low-signal noise escapes
    // the cap the moment a single high-signal alert happens to lead the group.
    const dominantSource = dominantSourceOf(unique);
    const cap = (dominantSource && SOURCE_CAP[dominantSource]) ?? 0.85;
    const confidence = Math.min(rawConf, cap);

    const title = unique[0]?.title ?? 'alerts';
    out.push({
      id: genId(),
      kind: 'alert-burst',
      statement:
        `Alert burst in ${panelId}: ${unique.length} distinct hot alerts within ${Math.round(BURST_WINDOW_MS / 60_000)}m, led by "${title.slice(0, 80)}".`,
      confidence,
      risk: confidenceToRisk(confidence),
      timestamp: now,
      evidence: unique.slice(0, 8).map((a): HypothesisEvidence => ({
        source: 'unified-alerts',
        id: a.id,
        label: a.title.slice(0, 80),
        panelId,
      })),
    });
  }
  return out;
}

/** Situations that just entered a more severe phase. */
function fromSituations(situations: Situation[]): Hypothesis[] {
  const escalating = situations.filter(s =>
    s.phase !== 'resolved' && s.confidence >= 0.6 && s.domainDiversity >= 2);
  return escalating.slice(0, 4).map((s): Hypothesis => ({
    id: genId(),
    kind: 'situation-escalation',
    statement:
      `${s.title}: ${s.summary.slice(0, 200)} (confidence ${(s.confidence * 100).toFixed(0)}%, ${s.domainDiversity} domains).`,
    confidence: s.confidence,
    risk: confidenceToRisk(s.confidence),
    region: s.geo.label,
    timestamp: Date.now(),
    evidence: [{
      source: 'situation-engine',
      id: s.id,
      label: s.title,
      panelId: 'situation-awareness',
    }],
  }));
}

// ── Ranking + persistence ────────────────────────────────────────────────────

function rank(hypotheses: Hypothesis[]): Hypothesis[] {
  const deduped = dedupeHypotheses(hypotheses);
  return deduped
    .filter(h => !isDismissed(h))
    .sort((a, b) => {
      const riskDelta = RISK_RANK[b.risk] - RISK_RANK[a.risk];
      if (riskDelta !== 0) return riskDelta;
      return rankingWeight(b) - rankingWeight(a);
    })
    .slice(0, MAX_HYPOTHESES);
}

function persist(snapshot: AnalystSnapshot): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* quota */ }
}

/** Minimal structural guard for a deserialized AnalystSnapshot. */
function isValidAnalystSnapshot(v: unknown): v is AnalystSnapshot {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  return typeof s.timestamp === 'number' && Array.isArray(s.hypotheses);
}

/** Retrieve the last persisted snapshot, if any. */
export function getAnalystSnapshot(): AnalystSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidAnalystSnapshot(parsed) ? parsed : null;
  } catch { return null; }
}

// ── Main cycle ────────────────────────────────────────────────────────────────

/** Guard a hypothesis builder: one failing builder (e.g. bad Situation shape,
 *  corrupt localStorage) returns [] instead of killing the whole cycle output. */
function safeBuilder<T>(fn: () => T[]): T[] {
  try { return fn(); } catch { return []; }
}

export function runAnalystCycle(): AnalystSnapshot {
  const t0 = performance.now();
  const cached = getCachedSynthesis();
  const clusters = cached?.clusters ?? [];
  const situations = situationEngine.getSituations();
  const anomalies = anomalyEngine.getActiveAnomalies();
  const alerts = unifiedAlertStore.getAll();

  const raw = [
    ...safeBuilder(() => fromClusters(clusters)),
    ...safeBuilder(() => fromAnomalies(anomalies)),
    ...safeBuilder(() => fromAlertBurst(alerts)),
    ...safeBuilder(() => fromSituations(situations)),
    ...safeBuilder(() => getWatchlistHypotheses()),
  ];
  const hypotheses = rank(raw);

  const snapshot: AnalystSnapshot = {
    timestamp: Date.now(),
    hypotheses,
    aiEnriched: cached?.aiPowered ?? false,
  };

  persist(snapshot);
  try { recordHypothesisPredictions(hypotheses); } catch { /* calibration is best-effort */ }
  document.dispatchEvent(new CustomEvent<AnalystSnapshot>(EVENT_NAME, { detail: snapshot }));

  const latencyMs = performance.now() - t0;
  recordLatency('analyst-cycle', latencyMs);
  incrementCounter('analyst-cycle.runs');

  // Episodic memory wiring: record new hypothesis signatures as episodes
  // and update the analog score cache for forecastAll. Ghost Mode suppression
  // is handled inside recordEpisode and updateAnalogCache.
  // Fire-and-forget: never block the sync cycle on async embedding.
  const hypothesisSnapshot = [...hypotheses]; // capture before async
  void (async () => {
    try {
      for (const h of hypothesisSnapshot) {
        await recordEpisode({
          kind: 'hypothesis',
          signature: signatureFor(h),
          summary: h.statement.slice(0, 500),
          domains: [h.kind],
          entities: [],
          region: h.region,
          createdAt: h.timestamp,
        });
      }
      await updateAnalogCache(
        hypothesisSnapshot.map(h => ({ statement: h.statement, id: h.id })),
        h => {
          const match = hypothesisSnapshot.find(hy => hy.id === h.id);
          return match ? signatureFor(match) : h.id;
        },
      );
    } catch (error) {
      // Never let episodic memory errors crash the analyst loop.
      logDebug({ level: 'warn', category: 'hypothesis', source: 'analyst-loop',
        message: 'episodic memory error',
        data: { error: error instanceof Error ? error.message : String(error) } });
    }
  })();

  // Entity dossier wiring: ingest hypotheses into the temporal knowledge graph.
  // Ghost Mode suppression is handled inside ingestFromHypotheses.
  // Fire-and-forget: never block the sync cycle on dossier ingestion.
  try {
    ingestFromHypotheses(hypothesisSnapshot);
  } catch (error) {
    // Never let entity-dossier errors crash the analyst loop.
    logDebug({ level: 'warn', category: 'hypothesis', source: 'analyst-loop',
      message: 'entity-dossier ingest error',
      data: { error: error instanceof Error ? error.message : String(error) } });
  }

  logDebug({ level: 'info', category: 'hypothesis', source: 'analyst-loop',
    message: 'cycle complete', latencyMs,
    data: {
      rawHypotheses: raw.length,
      rankedHypotheses: hypotheses.length,
      clusters: clusters.length,
      anomalies: anomalies.length,
      alerts: alerts.length,
      situations: situations.length,
      aiEnriched: snapshot.aiEnriched,
    } });
  return snapshot;
}

// ── Background loop ──────────────────────────────────────────────────────────

let started = false;
let timerId: ReturnType<typeof setTimeout> | null = null;

function scheduleNext(): void {
  if (!started) return;
  // Ghost mode slows the cadence by the same multiplier the scheduler uses.
  const interval = BASE_INTERVAL_MS * (isGhostMode() ? getGhostRefreshMultiplier() : 1);
  timerId = setTimeout(() => {
    if (!started) return;
    try { runAnalystCycle(); } catch (error) {
      incrementCounter('analyst-cycle.errors');
      logDebug({ level: 'error', category: 'hypothesis', source: 'analyst-loop',
        message: 'recurring cycle error',
        data: { error: error instanceof Error ? error.message : String(error) } });
    }
    scheduleNext();
  }, interval);
}

export function startAnalystLoop(): void {
  if (started) return;
  started = true;
  logDebug({ level: 'info', category: 'bootstrap', source: 'analyst-loop', message: 'start' });
  // Defer the initial cycle to the next task so subscribers registered
  // later in the bootstrap sequence (hypothesis-threads, entities,
  // accuracy, skeptic, notifier, snapshot-archive, sidecar-pusher,
  // command-listener) are all listening before we dispatch.
  setTimeout(() => {
    try { runAnalystCycle(); } catch (error) {
      incrementCounter('analyst-cycle.errors');
      logDebug({ level: 'error', category: 'hypothesis', source: 'analyst-loop',
        message: 'initial cycle threw',
        data: { error: error instanceof Error ? error.message : String(error) } });
    }
  }, 0);
  scheduleNext();
}

export function stopAnalystLoop(): void {
  started = false;
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

/** Subscribe to analyst snapshots. Returns an unsubscribe function. */
export function subscribeAnalyst(cb: (snapshot: AnalystSnapshot) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
