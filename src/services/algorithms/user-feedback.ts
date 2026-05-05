/**
 * User Annotation + Algorithm Feedback Loop.
 *
 * Lets the user tag Crystal Ball alerts as confirmed / false_positive /
 * observed_early / missed / inconclusive, and routes the tag through the
 * outcome resolver so it counts towards the algorithm's accuracy metrics.
 *
 * `observed_early` annotations (the user noticed the situation BEFORE
 * Crystal Ball alerted) record a lead-time delta that surfaces in the
 * diagnostics panel: lead = alertTime - userObservedTime.
 *
 * Pure deterministic core; the annotation store is a small in-memory
 * Map exposed via getter/setter helpers. Persistence is the caller's
 * job (router pushes through to persistent-cache or the sidecar).
 */

import { applyManualGrade, type GroundTruthObservation } from './outcome-resolver';
import type { AlgorithmEvaluationLedger } from './algorithm-evaluation-ledger';

// Public types

export type AnnotationType =
  | 'confirmed'
  | 'false_positive'
  | 'observed_early'
  | 'missed'
  | 'inconclusive';

export interface UserAnnotation {
  alertId: string;
  algorithmId: string;
  annotationType: AnnotationType;
  /** ms timestamp when the user observed the situation. */
  observedAt: number;
  notes?: string;
  /** ms timestamp when the user submitted the annotation. */
  submittedAt: number;
}

export interface AnnotationCounts {
  confirmed: number;
  false_positive: number;
  observed_early: number;
  missed: number;
  inconclusive: number;
}

export interface AnnotationSummary {
  algorithmId: string | null;
  counts: AnnotationCounts;
  /** Mean lead time (alertTime - observedTime) for observed_early
   *  annotations. null when there are none. */
  meanEarlyLeadMs: number | null;
  earlyDetectionsWithLead: number;
  total: number;
}

// Module state

const annotations: UserAnnotation[] = [];

export function clearAnnotations(): void {
  annotations.length = 0;
}

// Submission

export interface SubmitAnnotationInput {
  alertId: string;
  algorithmId: string;
  annotationType: AnnotationType;
  observedAt?: number;
  notes?: string;
  /** ms timestamp for `submittedAt`. Defaults to Date.now(). */
  now?: number;
}

const VALID_TYPES: ReadonlySet<AnnotationType> = new Set([
  'confirmed',
  'false_positive',
  'observed_early',
  'missed',
  'inconclusive',
]);

export function submitAnnotation(input: SubmitAnnotationInput): UserAnnotation {
  if (!input.alertId) throw new Error('alertId is required');
  if (!input.algorithmId) throw new Error('algorithmId is required');
  if (!VALID_TYPES.has(input.annotationType)) {
    throw new Error(`Unsupported annotationType: ${input.annotationType}`);
  }
  const submittedAt = input.now ?? Date.now();
  const ann: UserAnnotation = {
    alertId: input.alertId,
    algorithmId: input.algorithmId,
    annotationType: input.annotationType,
    observedAt: input.observedAt ?? submittedAt,
    notes: input.notes,
    submittedAt,
  };
  annotations.push(ann);
  return { ...ann };
}

// Read

export interface ListAnnotationsFilter {
  algorithmId?: string;
  /** Only return annotations submitted at or after this ms timestamp. */
  since?: number;
}

export function listAnnotations(filter: ListAnnotationsFilter = {}): UserAnnotation[] {
  let list = [...annotations];
  if (filter.algorithmId) {
    list = list.filter((a) => a.algorithmId === filter.algorithmId);
  }
  if (typeof filter.since === 'number' && Number.isFinite(filter.since)) {
    list = list.filter((a) => a.submittedAt >= filter.since!);
  }
  return list.map((a) => ({ ...a }));
}

// Roll-up

export function summarizeAnnotations(
  algorithmId: string | null,
  ledger?: AlgorithmEvaluationLedger,
): AnnotationSummary {
  const counts: AnnotationCounts = {
    confirmed: 0,
    false_positive: 0,
    observed_early: 0,
    missed: 0,
    inconclusive: 0,
  };
  let leadMsTotal = 0;
  let earlyCount = 0;
  let total = 0;
  for (const a of annotations) {
    if (algorithmId && a.algorithmId !== algorithmId) continue;
    counts[a.annotationType] += 1;
    total += 1;
    if (a.annotationType === 'observed_early' && ledger) {
      const record = ledger.get(a.alertId);
      if (record) {
        const lead = record.at - a.observedAt;
        if (lead > 0) {
          leadMsTotal += lead;
          earlyCount += 1;
        }
      }
    }
  }
  return {
    algorithmId,
    counts,
    meanEarlyLeadMs: earlyCount === 0 ? null : leadMsTotal / earlyCount,
    earlyDetectionsWithLead: earlyCount,
    total,
  };
}

// Bridge to outcome resolver

const ANNOTATION_TO_OBSERVATION: Record<
  AnnotationType,
  GroundTruthObservation | null
> = {
  confirmed: { eventOccurred: true, alertFired: true },
  false_positive: { eventOccurred: false, alertFired: true },
  missed: { eventOccurred: true, alertFired: false },
  observed_early: { eventOccurred: true, alertFired: true },
  // Inconclusive doesn't grade — let the resolver auto-grade later.
  inconclusive: null,
};

/**
 * Submit an annotation AND grade the linked ledger record. Throws if
 * the alert id doesn't exist in the ledger or is already graded.
 *
 * Returns both the stored annotation and the grade result. For
 * `inconclusive` annotations, returns annotation only (grade=null).
 */
export function annotateAndGrade(
  ledger: AlgorithmEvaluationLedger,
  input: SubmitAnnotationInput,
): { annotation: UserAnnotation; graded: boolean; outcome?: string } {
  const annotation = submitAnnotation(input);
  const observation = ANNOTATION_TO_OBSERVATION[annotation.annotationType];
  if (!observation) {
    return { annotation, graded: false };
  }
  const obsWithNotes: GroundTruthObservation = {
    ...observation,
    notes: annotation.notes,
  };
  const { result } = applyManualGrade({ ledger }, {
    id: annotation.alertId,
    observation: obsWithNotes,
  });
  return {
    annotation,
    graded: true,
    outcome: result.outcome,
  };
}
