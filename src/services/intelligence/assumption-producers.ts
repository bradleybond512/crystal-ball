/**
 * Assumption producers — facade that writes to both assumption tracker v1
 * (detector engine / stats surface) and v2 (lifecycle ledger / panel) from
 * one annotateModelOutput() entry point.
 *
 * Only critical or high-risk assumptions are mirrored into v2 to avoid
 * churning the 2000-row ring with routine low-confidence annotations.
 *
 * Pure deterministic — no DOM, no fetch, no globals at import time.
 * Injectable tracker/service for test isolation.
 */

import {
  AssumptionTracker,
  getAssumptionTracker,
  type AnnotatedOutput,
  type OutputType,
  type AssumptionContext,
  type AssumptionTrackerOptions,
} from './assumption-tracker';
import {
  AssumptionTrackerService,
  getAssumptionTrackerService,
  type AssumptionTrackerServiceOptions,
} from './assumption-tracker-v2';

export interface ProduceOptions {
  algorithmId: string;
  domain: string;
  /** ms until v2 assumption auto-expires; default 24h. */
  ttlMs?: number;
  /**
   * Injectable instances for test isolation. Leave undefined in production
   * to use the module singletons.
   */
  _tracker?: AssumptionTracker;
  _service?: AssumptionTrackerService;
  /** Injectable clock for test isolation (used to compute expiresAt). */
  _clock?: () => number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs v1 annotate() to detect assumptions in the model output, then mirrors
 * each assumption that is critical or has high violation-risk into the v2
 * lifecycle ledger. Returns the v1 AnnotatedOutput so callers can inspect
 * overallConfidence.
 */
export function annotateModelOutput(
  outputId: string,
  outputType: OutputType,
  context: AssumptionContext,
  opts: ProduceOptions,
): AnnotatedOutput {
  const tracker = opts._tracker ?? getAssumptionTracker();
  const svc = opts._service ?? getAssumptionTrackerService();

  const annotation = tracker.annotate(outputId, outputType, context);

  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const clock = opts._clock ?? Date.now;
  const now = clock();

  for (const a of annotation.assumptions) {
    if (!a.isCritical && a.violationRisk !== 'high') continue;

    const confidence =
      a.confidence >= 0.7 ? 'high'
      : a.confidence >= 0.4 ? 'medium'
      : ('low' as const);

    svc.register({
      label: a.statement,
      rationale: annotation.caveat,
      algorithmId: opts.algorithmId,
      outputId,
      domain: opts.domain,
      confidence,
      expiresAt: now + ttlMs,
    });
  }

  return annotation;
}

/**
 * Installs a 15-minute interval that sweeps expired v2 assumptions.
 * Returns a cleanup function (for tests or teardown).
 *
 * Call once at boot from panel-layout.ts next to the other cadence starts.
 */
export function startAssumptionExpirySweep(): () => void {
  const handle = setInterval(() => {
    try {
      getAssumptionTrackerService().expire(Date.now());
    } catch {
      // Expiry sweep must never throw into the boot context.
    }
  }, 15 * 60 * 1000);
  return () => clearInterval(handle);
}

// ── Test helpers ──────────────────────────────────────────────────────

/**
 * Convenience factory for isolated test instances. Pass the returned
 * { tracker, service } as _tracker/_service in ProduceOptions so tests
 * never touch the module singletons.
 */
export function makeTestInstances(
  trackerOpts?: AssumptionTrackerOptions,
  serviceOpts?: AssumptionTrackerServiceOptions,
): { tracker: AssumptionTracker; service: AssumptionTrackerService } {
  return {
    tracker: new AssumptionTracker({ storage: null, ...trackerOpts }),
    service: new AssumptionTrackerService({ storage: null, ...serviceOpts }),
  };
}
