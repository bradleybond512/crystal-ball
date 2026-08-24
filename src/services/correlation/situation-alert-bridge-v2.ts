/**
 * SituationStoreV2 → unified-alerts bridge — correlated situations can
 * finally raise user-facing alerts (the stated non-goal of the
 * next-gen program, now closed).
 *
 * Alert-fatigue discipline, in order:
 *  - Only CORRELATED situations alert: status 'active' with ≥2
 *    observations and ≥1 evidence edge. Singletons ('watching') are the
 *    direct feeds' job; alerting them here would double-cover.
 *  - Floors: severity ≥ medium AND confidence ≥ 0.5.
 *  - Stable id = situation.id (the store's own `sit-v2-…` namespace —
 *    disjoint from the OLD bridge's `sit-*`, and the alert-correlator's
 *    `corr-*`/`chain-*`), so re-emits update in place and the store
 *    preserves the user's acknowledged/pinned state.
 *  - Meaningful-change gate before any re-emit: severity or status
 *    changed, |Δconfidence| ≥ 0.1, or the situation accreted
 *    observations. timestamp = updatedAt so stale re-emits are dropped
 *    by the store's own timestamp guard.
 *  - Per-domain settings, quiet hours, and the 1-per-source rate limit
 *    are enforced downstream by notification-dispatcher on ingest of a
 *    NEW alert; this bridge never bypasses them. Correlation is
 *    inference, so candidates are never safety-critical (no quiet-hours
 *    override).
 *  - Every emit registers a candidate in the notification trace
 *    registry (SystemDiagnostic Notifications tab shows the lifecycle).
 */

import type { UnifiedAlert } from '../unified-alerts';
import type {
  Situation,
  SituationMutationSnapshot,
  SituationSeverity,
} from '../intelligence/situation-store-v2';
import { getSituationStoreV2 } from '../intelligence/situation-store-v2';
import type {
  NotificationDomain,
  NotificationTraceRegistry,
} from '../diagnostics/notification-trace';

const MIN_CONFIDENCE = 0.5;
const MIN_OBSERVATIONS = 2;
const MEANINGFUL_CONFIDENCE_DELTA = 0.1;
const SEVERITY_RANK: Record<SituationSeverity, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};

/** Observation domain → trace-registry domain. */
export function traceDomainFor(domain: string): NotificationDomain {
  const d = domain.toLowerCase();
  if (d === 'weather' || d === 'wildfire' || d === 'flood') return 'weather';
  if (d === 'cyber') return 'cyber';
  if (d === 'conflict' || d === 'military' || d === 'security') return 'conflict';
  if (d === 'markets' || d === 'macro' || d === 'finance') return 'market';
  if (d === 'supply' || d === 'shortage') return 'shortage';
  if (d === 'infra' || d === 'infrastructure' || d === 'energy' || d === 'grid') return 'energy';
  return 'other';
}

/** Pure gate + mapping: null when the situation must not alert.
 *  `nowMs` stamps the alert: emit time is monotonic, so the store's
 *  timestamp guard can never drop a legitimate update (re-emit control
 *  lives entirely in shouldReemit) — situation/alert persistence clocks
 *  can skew across reloads. */
type AlertableSituation = Situation | SituationMutationSnapshot;

function observationCount(s: AlertableSituation): number {
  return 'observationCount' in s ? s.observationCount : s.observations.length;
}

function edgeCount(s: AlertableSituation): number {
  return 'edgeCount' in s ? s.edgeCount : s.edges.length;
}

export function situationToAlert(s: AlertableSituation, nowMs: number): UnifiedAlert | null {
  if (s.status !== 'active') return null;
  if (observationCount(s) < MIN_OBSERVATIONS) return null;
  if (edgeCount(s) < 1) return null;
  if (SEVERITY_RANK[s.severity] < SEVERITY_RANK.medium) return null;
  if (!Number.isFinite(s.confidence) || s.confidence < MIN_CONFIDENCE) return null;

  const domains = [...new Set([s.domain, ...s.relatedDomains])];
  return {
    id: s.id,
    source: 'correlation',
    severity: s.severity,
    title: s.name,
    body: `${observationCount(s)} correlated signals across ${domains.join(', ')} — confidence ${Math.round(s.confidence * 100)}%`,
    timestamp: nowMs,
    location: s.location ? { lat: s.location.lat, lon: s.location.lon } : undefined,
    relevanceScore: Math.round(s.confidence * 100),
    acknowledged: false,
    pinned: false,
  };
}

export interface EmitRecord {
  severity: SituationSeverity;
  status: Situation['status'];
  confidence: number;
  observationCount: number;
}

export function toEmitRecord(s: AlertableSituation): EmitRecord {
  return {
    severity: s.severity,
    status: s.status,
    confidence: s.confidence,
    observationCount: observationCount(s),
  };
}

/** Re-emit only on meaningful change — never on persistence churn. */
export function shouldReemit(prev: EmitRecord | undefined, s: AlertableSituation): boolean {
  if (!prev) return true;
  if (prev.severity !== s.severity) return true;
  if (prev.status !== s.status) return true;
  if (Math.abs(prev.confidence - s.confidence) >= MEANINGFUL_CONFIDENCE_DELTA) return true;
  if (observationCount(s) > prev.observationCount) return true;
  return false;
}

export interface SituationAlertBridgeDeps {
  ingest(alerts: UnifiedAlert[]): void;
  registry?: Pick<NotificationTraceRegistry, 'register' | 'dispatch'> | null;
  now?: () => number;
  /** Current timestamp of the alert with this id in the target store,
   *  if any — lets emit stamps clear a persisted alert even when the
   *  wall clock went backwards across sessions. */
  existingTimestampFor?: (id: string) => number | undefined;
}

let started = false;

/**
 * Wire the bridge to a situation store. Idempotent; returns cleanup.
 * Deps are injectable for tests; production wiring lives in
 * startSituationV2AlertBridge's defaults (panel-layout bootstrap).
 */
export function createSituationV2AlertBridge(
  store: Pick<ReturnType<typeof getSituationStoreV2>, 'subscribeMutations' | 'list'>,
  deps: SituationAlertBridgeDeps,
): () => void {
  const lastEmitted = new Map<string, EmitRecord>();
  const lastStamp = new Map<string, number>();
  const now = deps.now ?? (() => Date.now());

  // The store's ingest drops updates whose timestamp is older than the
  // existing alert's. Wall clocks can go backwards (NTP, manual
  // adjustment, cross-session skew against the persisted alert store) —
  // stamps must therefore be monotonic per id, never raw now().
  const stampFor = (id: string, at: number): number => {
    const floor = Math.max(
      (lastStamp.get(id) ?? Number.NEGATIVE_INFINITY) + 1,
      (deps.existingTimestampFor?.(id) ?? Number.NEGATIVE_INFINITY) + 1,
    );
    const stamp = Math.max(at, floor);
    lastStamp.set(id, stamp);
    return stamp;
  };

  const sync = (situations: readonly AlertableSituation[], pruneMissing = false): void => {
    const live = new Set<string>();
    const out: UnifiedAlert[] = [];
    const at = now();
    for (const s of situations) {
      // A situation that left 'active' sheds its emit record even while
      // still in the store — a later reactivation must alert again.
      if (s.status !== 'active') {
        lastEmitted.delete(s.id);
        continue;
      }
      live.add(s.id);
      if (!shouldReemit(lastEmitted.get(s.id), s)) continue;
      const alert = situationToAlert(s, stampFor(s.id, at));
      if (!alert) continue;
      lastEmitted.set(s.id, toEmitRecord(s));
      out.push(alert);
      recordTrace(deps.registry, s, at);
    }
    // Evicted situations shed their emit records too.
    if (pruneMissing) {
      for (const id of lastEmitted.keys()) {
        if (!live.has(id)) {
          lastEmitted.delete(id);
          lastStamp.delete(id);
        }
      }
    }
    if (out.length > 0) deps.ingest(out);
  };

  const unsubscribe = store.subscribeMutations((result) => {
    try {
      for (const mutation of result.mutations) {
        if (mutation.kind === 'removed') {
          lastEmitted.delete(mutation.situationId);
          lastStamp.delete(mutation.situationId);
        } else {
          sync([mutation.situation]);
        }
      }
    } catch { /* bridge crash isolation */ }
  });
  try { sync(store.list(), true); } catch { /* initial sync isolation */ }
  return () => {
    unsubscribe();
    lastEmitted.clear();
  };
}

function recordTrace(
  registry: SituationAlertBridgeDeps['registry'],
  s: AlertableSituation,
  at: number,
): void {
  if (!registry) return;
  try {
    const candidateId = `sitv2-${s.id}-${s.updatedAt.getTime()}`;
    registry.register({
      candidateId,
      situationId: s.id,
      domain: traceDomainFor(s.domain),
      urgency: s.severity === 'medium' ? 'normal' : s.severity,
      confidence: s.confidence,
      // Correlation is inference — it never overrides quiet hours.
      safetyCritical: false,
      createdAt: at,
      headline: s.name,
    });
    // The alert is guaranteed present in-app (inbox/triage); native
    // escalation beyond that is notification-dispatcher's decision.
    registry.dispatch(candidateId, 'in_app', at);
  } catch { /* trace is best-effort */ }
}

/** Production wiring with default singletons. Idempotent. */
export function startSituationV2AlertBridge(): () => void {
  if (started) return noop;
  started = true;
  // Lazy requires keep this module import-pure for unit tests.
  const cleanupPromise = Promise.all([
    import('../unified-alerts'),
    import('../diagnostics/diagnostics-state'),
  ]).then(([alerts, diag]) =>
    createSituationV2AlertBridge(getSituationStoreV2(), {
      ingest: (batch) => alerts.unifiedAlertStore.ingest(batch),
      registry: diag.getNotificationTraceRegistry(),
      existingTimestampFor: (id) =>
        alerts.unifiedAlertStore.getAll().find((a) => a.id === id)?.timestamp,
    }),
  ).catch(() => {
    // Transient import/init failure must not permanently disable the
    // bridge — allow a later start to retry.
    started = false;
    return noop;
  });
  return () => {
    started = false;
    void cleanupPromise.then((cleanup) => cleanup());
  };
}

function noop(): void {
  // second start is a no-op; nothing to clean up
}
