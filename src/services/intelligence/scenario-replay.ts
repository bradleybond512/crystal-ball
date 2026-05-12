/**
 * Scenario Replay — Phase 7E foundation.
 *
 * Injects a deterministic set of `ObservationEvent`s into the intelligence
 * pipeline (observation-store + situation-detector) and verifies that the
 * resulting alerts and situations match the fixture's expectations.
 *
 * Pure-deterministic core: no DOM, no fetch, no globals at import time.
 * Pipeline dependencies are injectable so unit tests can run without
 * touching the real module-level state in observation-store /
 * situation-store.
 *
 * The replay engine answers the question "given this sequence of
 * observations, would Crystal Ball today detect what we expect?" It does
 * NOT exercise downstream notification rungs, panel rendering, or the
 * unified-alert UI; those are gates a separate harness covers.
 */

import {
  _clearStoreForTests as resetObservationStore,
  ingest as defaultIngest,
} from './observation-store';
import {
  detect as defaultDetect,
  resetForTests as resetSituationStore,
} from './situation-detector';
import { getAll as defaultGetAllSituations } from './situation-store';
import type {
  ObservationEvent,
  ObservationLocation,
  ObservationSeverity,
  Situation,
  SituationSeverity,
} from '@/types/intelligence';

// ── Public types ────────────────────────────────────────────────────────

/**
 * A single event in a scenario fixture. Offsets are millisecond deltas
 * from the fixture's `startTime` so the same fixture replays the same way
 * regardless of when it is run.
 */
export interface ScenarioEventTemplate {
  id: string;
  sourceId: string;
  domain: string;
  /** Milliseconds added to fixture.startTime to produce the real timestamp. */
  offsetMs: number;
  location?: ObservationLocation;
  severity: ObservationSeverity;
  title: string;
  raw?: unknown;
  entityIds?: string[];
  tags?: string[];
}

/**
 * Lightweight alert / situation expectations. Title is matched case-
 * insensitively; if the actual event title contains the expected fragment
 * it counts as a hit. Use shorter, distinctive fragments to keep the
 * expectations resilient to UI copy changes.
 */
export interface ExpectedAlert {
  domain: string;
  severity: ObservationSeverity;
  /** Substring (case-insensitive) the actual event title must contain. */
  titleContains: string;
}

export interface ExpectedSituation {
  domain: string;
  titleContains: string;
}

export interface ScenarioFixture {
  id: string;
  name: string;
  description: string;
  /** Epoch ms anchoring all event offsets. Set to a fixed value so reruns
   *  are bit-for-bit identical. */
  startTime: number;
  events: ScenarioEventTemplate[];
  expectedAlerts: ExpectedAlert[];
  expectedSituations: ExpectedSituation[];
}

/** A flat ObservationEvent + the offset / source template that produced it. */
export interface ReplayedEvent extends ObservationEvent {
  offsetMs: number;
}

/** An ObservationEvent the replay surfaced as an alert. */
export interface FiredAlert {
  eventId: string;
  domain: string;
  severity: ObservationSeverity;
  title: string;
  occurredAtOffsetMs: number;
}

export interface CreatedSituation {
  id: string;
  domain: string;
  severity: SituationSeverity;
  title: string;
  observationCount: number;
}

export interface ScenarioReplayResult {
  fixtureId: string;
  alertsFired: FiredAlert[];
  situationsCreated: CreatedSituation[];
  missedAlerts: ExpectedAlert[];
  missedSituations: ExpectedSituation[];
  elapsedMs: number;
  ingestedEventCount: number;
}

export interface ReplayPipeline {
  /** Reset both stores so a replay starts from a known state. */
  resetStores: () => void;
  /** Append one event to the observation store. */
  ingest: (event: ObservationEvent) => void;
  /** Drive the situation detector against a freshly-ingested event. */
  detect: (event: ObservationEvent, nowMs: number) => Situation | null;
  /** Return every situation currently in the store. */
  getSituations: () => Situation[];
}

export interface ReplayOptions {
  pipeline?: Partial<ReplayPipeline>;
  /** Override Date.now() throughout the replay — useful in tests. */
  nowMs?: () => number;
}

// ── Default pipeline (real module-level state) ──────────────────────────

const SEVERITIES: ObservationSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const ALERT_FLOOR: ObservationSeverity = 'HIGH';

function severityRank(s: ObservationSeverity): number {
  const idx = SEVERITIES.indexOf(s);
  return idx === -1 ? 0 : idx;
}

function isAlertSeverity(s: ObservationSeverity): boolean {
  return severityRank(s) >= severityRank(ALERT_FLOOR);
}

function caseInsensitiveContains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function buildDefaultPipeline(): ReplayPipeline {
  return {
    resetStores: () => {
      resetObservationStore();
      resetSituationStore();
    },
    ingest: (event) => { defaultIngest(event); },
    detect: (event, nowMs) => defaultDetect(event, { now: nowMs, dispatch: null }),
    getSituations: () => defaultGetAllSituations(),
  };
}

function resolvePipeline(partial?: Partial<ReplayPipeline>): ReplayPipeline {
  const base = buildDefaultPipeline();
  if (!partial) return base;
  return {
    resetStores: partial.resetStores ?? base.resetStores,
    ingest: partial.ingest ?? base.ingest,
    detect: partial.detect ?? base.detect,
    getSituations: partial.getSituations ?? base.getSituations,
  };
}

// ── Replay ──────────────────────────────────────────────────────────────

function templateToEvent(template: ScenarioEventTemplate, startTime: number): ObservationEvent {
  return {
    id: template.id,
    sourceId: template.sourceId,
    domain: template.domain,
    timestamp: startTime + template.offsetMs,
    severity: template.severity,
    title: template.title,
    raw: template.raw ?? null,
    entityIds: template.entityIds ?? [],
    tags: template.tags ?? [],
    ...(template.location ? { location: template.location } : {}),
  };
}

function matchesExpectedAlert(fired: FiredAlert, expected: ExpectedAlert): boolean {
  return fired.domain === expected.domain
    && fired.severity === expected.severity
    && caseInsensitiveContains(fired.title, expected.titleContains);
}

function matchesExpectedSituation(actual: CreatedSituation, expected: ExpectedSituation): boolean {
  return actual.domain === expected.domain
    && caseInsensitiveContains(actual.title, expected.titleContains);
}

export function replayScenario(
  fixture: ScenarioFixture,
  options: ReplayOptions = {},
): ScenarioReplayResult {
  const pipeline = resolvePipeline(options.pipeline);
  const now = options.nowMs ?? Date.now;
  const start = now();

  pipeline.resetStores();

  const alertsFired: FiredAlert[] = [];
  // Process events in chronological order so timestamps land monotonically
  // in the observation-store ring buffer.
  const ordered = [...fixture.events].sort((a, b) => a.offsetMs - b.offsetMs);

  for (const template of ordered) {
    const event = templateToEvent(template, fixture.startTime);
    pipeline.ingest(event);
    // Drive the situation detector with the event's logical "now". Using
    // the event timestamp keeps situation-matching deterministic — real
    // wall-clock time would otherwise affect the MATCH_WINDOW_MS check.
    pipeline.detect(event, event.timestamp);
    if (isAlertSeverity(event.severity)) {
      alertsFired.push({
        eventId: event.id,
        domain: event.domain,
        severity: event.severity,
        title: event.title,
        occurredAtOffsetMs: template.offsetMs,
      });
    }
  }

  const situations = pipeline.getSituations();
  const situationsCreated: CreatedSituation[] = situations.map((s) => ({
    id: s.id,
    domain: s.domain,
    severity: s.severity,
    title: s.name,
    observationCount: s.observationIds.length,
  }));

  const missedAlerts = fixture.expectedAlerts.filter(
    (exp) => !alertsFired.some((a) => matchesExpectedAlert(a, exp)),
  );
  const missedSituations = fixture.expectedSituations.filter(
    (exp) => !situationsCreated.some((s) => matchesExpectedSituation(s, exp)),
  );

  return {
    fixtureId: fixture.id,
    alertsFired,
    situationsCreated,
    missedAlerts,
    missedSituations,
    elapsedMs: now() - start,
    ingestedEventCount: ordered.length,
  };
}

// ── Validation ──────────────────────────────────────────────────────────

export interface ReplayDiff {
  /** Type of expectation that wasn't met. */
  kind: 'missed-alert' | 'missed-situation';
  detail: ExpectedAlert | ExpectedSituation;
}

export interface ReplayValidation {
  ok: boolean;
  diffs: ReplayDiff[];
  /** Plain-English summary of what passed and what didn't. */
  summary: string;
}

export function validateReplay(
  result: ScenarioReplayResult,
  fixture: ScenarioFixture,
): ReplayValidation {
  const diffs: ReplayDiff[] = [
    ...result.missedAlerts.map((d): ReplayDiff => ({ kind: 'missed-alert', detail: d })),
    ...result.missedSituations.map((d): ReplayDiff => ({ kind: 'missed-situation', detail: d })),
  ];
  const ok = diffs.length === 0;
  const summary = ok
    ? `✓ ${fixture.name}: ${result.alertsFired.length}/${fixture.expectedAlerts.length} alerts, `
      + `${result.situationsCreated.length}/${fixture.expectedSituations.length} situations`
    : `✗ ${fixture.name}: ${result.missedAlerts.length} missed alert(s), `
      + `${result.missedSituations.length} missed situation(s)`;
  return { ok, diffs, summary };
}

// ── Convenience: replay + validate ──────────────────────────────────────

export interface ScenarioRunReport {
  result: ScenarioReplayResult;
  validation: ReplayValidation;
}

export function runScenario(
  fixture: ScenarioFixture,
  options: ReplayOptions = {},
): ScenarioRunReport {
  const result = replayScenario(fixture, options);
  const validation = validateReplay(result, fixture);
  return { result, validation };
}

// ── Test seam ───────────────────────────────────────────────────────────

export const __TEST_HOOKS__ = {
  buildDefaultPipeline,
  templateToEvent,
  isAlertSeverity,
  severityRank,
};
