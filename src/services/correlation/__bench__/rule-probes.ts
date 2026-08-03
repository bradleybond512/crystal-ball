/**
 * Per-rule coverage probes for the ACC-501 correlation benchmark.
 *
 * The golden corpus grades the built-in rule set in AGGREGATE: pair precision,
 * pair recall, decoy leakage. Aggregates only measure what the corpus happens
 * to exercise, and the corpus exercises four of the nine shipped rules. The
 * other five can have their matchers permanently disabled with every benchmark
 * number holding steady — measured, not hypothesised.
 *
 * Pinning the rule INVENTORY by set equality closes the deletion channel but
 * not the disablement one: an id that exists proves nothing about a matcher
 * that no longer fires. So every rule gets two hand-built fixtures instead —
 * one pair it must emit, and one near-miss that fails exactly one clause and it
 * must reject. Both run through a live `CorrelateEngine` carrying the whole
 * shipped rule set, so the probe exercises the real registration, the real
 * domain gate, the real time window and the real matcher.
 *
 * Deliberately NOT part of the golden corpus: these fixtures answer "does each
 * rule work", not "how well does the stack score a realistic stream", and
 * folding them in would perturb every mined edge, every rate and the corpus
 * digest to answer a question the corpus was not built to ask.
 *
 * Pure deterministic. No DOM, no fetch, no clock reads.
 */

import type { ObservationEvent } from '@/types/intelligence';
import { CorrelateEngine } from '../../intelligence/correlate-engine';
import { builtInCorrelationRules } from '../../intelligence/built-in-correlation-rules';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Fixed instant, unrelated to the corpus — probes are graded in isolation. */
const PROBE_T0 = Date.UTC(2026, 5, 1, 12, 0, 0);
const PROBE_NOW = new Date(PROBE_T0 + HOUR);

interface ProbeSpec {
  id: string;
  sourceId: string;
  domain: string;
  offsetMs: number;
  severity?: ObservationEvent['severity'];
  lat?: number;
  lon?: number;
  entityIds?: string[];
  tags?: string[];
}

function ev(spec: ProbeSpec): ObservationEvent {
  return {
    id: spec.id,
    sourceId: spec.sourceId,
    domain: spec.domain,
    timestamp: PROBE_T0 + spec.offsetMs,
    severity: spec.severity ?? 'MEDIUM',
    title: spec.id,
    raw: { probe: spec.id },
    entityIds: spec.entityIds ?? [],
    tags: spec.tags ?? [],
    ...(spec.lat === undefined || spec.lon === undefined
      ? {}
      : { location: { lat: spec.lat, lon: spec.lon } }),
  };
}

interface RuleFixture {
  ruleId: string;
  /** Why the negative fixture must be rejected — the single clause it fails. */
  nearMiss: string;
  positive: readonly ObservationEvent[];
  negative: readonly ObservationEvent[];
}

/**
 * One positive and one near-miss fixture per shipped rule.
 *
 * Each near-miss violates exactly ONE clause of its rule. A fixture that fails
 * two would still be rejected after a matcher lost one of them, which is the
 * regression the probe exists to catch.
 */
const RULE_FIXTURES: readonly RuleFixture[] = [
  {
    ruleId: 'earthquake-tsunami',
    nearMiss: 'ocean bulletin is ~1500 km away, past the 800 km radius',
    positive: [
      ev({
        id: 'p1a', sourceId: 'usgs-earthquake', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 38.2, lon: 142.5, tags: ['major-earthquake'],
      }),
      ev({
        id: 'p1b', sourceId: 'gdacs-alerts', domain: 'humanitarian', offsetMs: 30 * MINUTE,
        severity: 'HIGH', lat: 38.9, lon: 143.1, tags: ['ocean-hazard'],
      }),
    ],
    negative: [
      ev({
        id: 'n1a', sourceId: 'usgs-earthquake', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 38.2, lon: 142.5, tags: ['major-earthquake'],
      }),
      ev({
        id: 'n1b', sourceId: 'gdacs-alerts', domain: 'humanitarian', offsetMs: 30 * MINUTE,
        severity: 'HIGH', lat: 38.2, lon: 159.5, tags: ['ocean-hazard'],
      }),
    ],
  },
  {
    ruleId: 'earthquake-infrastructure',
    nearMiss: 'the CISA advisory carries no location, so no distance can be proven',
    positive: [
      ev({
        id: 'p2a', sourceId: 'usgs-earthquake', domain: 'weather', offsetMs: 0,
        severity: 'MEDIUM', lat: 34.05, lon: -118.24, tags: ['earthquake'],
      }),
      ev({
        id: 'p2b', sourceId: 'cisa-infrastructure', domain: 'infra', offsetMs: 2 * HOUR,
        severity: 'HIGH', lat: 34.4, lon: -118.6,
      }),
    ],
    negative: [
      ev({
        id: 'n2a', sourceId: 'usgs-earthquake', domain: 'weather', offsetMs: 0,
        severity: 'MEDIUM', lat: 34.05, lon: -118.24, tags: ['earthquake'],
      }),
      ev({
        id: 'n2b', sourceId: 'cisa-infrastructure', domain: 'infra', offsetMs: 2 * HOUR,
        severity: 'HIGH',
      }),
    ],
  },
  {
    ruleId: 'weather-wildfire',
    nearMiss: 'the red-flag warning and the fire sit in different states',
    positive: [
      ev({
        id: 'p3a', sourceId: 'nws-alerts', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', entityIds: ['US-CA'], tags: ['red-flag-warning'],
      }),
      ev({
        id: 'p3b', sourceId: 'inciweb-wildfire', domain: 'weather', offsetMs: 6 * HOUR,
        severity: 'HIGH', entityIds: ['US-CA'], tags: ['wildfire'],
      }),
    ],
    negative: [
      ev({
        id: 'n3a', sourceId: 'nws-alerts', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', entityIds: ['US-CA'], tags: ['red-flag-warning'],
      }),
      ev({
        id: 'n3b', sourceId: 'inciweb-wildfire', domain: 'weather', offsetMs: 6 * HOUR,
        severity: 'HIGH', entityIds: ['US-MT'], tags: ['wildfire'],
      }),
    ],
  },
  {
    ruleId: 'airquality-wildfire',
    nearMiss: 'the fire is ~400 km from the monitor, past the 150 km smoke radius',
    positive: [
      ev({
        id: 'p4a', sourceId: 'airnow', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 45.52, lon: -122.68, tags: ['smoke-relevant'],
      }),
      ev({
        id: 'p4b', sourceId: 'inciweb-wildfire', domain: 'weather', offsetMs: 6 * HOUR,
        severity: 'HIGH', lat: 46.1, lon: -121.5, tags: ['wildfire'],
      }),
    ],
    negative: [
      ev({
        id: 'n4a', sourceId: 'airnow', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 45.52, lon: -122.68, tags: ['smoke-relevant'],
      }),
      ev({
        id: 'n4b', sourceId: 'inciweb-wildfire', domain: 'weather', offsetMs: 6 * HOUR,
        severity: 'HIGH', lat: 49.1, lon: -122.68, tags: ['wildfire'],
      }),
    ],
  },
  {
    ruleId: 'biosurv-aviation',
    nearMiss: 'the aircraft is ~1700 km from the surveillance signal',
    positive: [
      ev({
        id: 'p5a', sourceId: 'cdc-biosurveillance', domain: 'humanitarian', offsetMs: 0,
        severity: 'HIGH', lat: 41.88, lon: -87.63,
      }),
      ev({
        id: 'p5b', sourceId: 'aviation-track', domain: 'aviation', offsetMs: 24 * HOUR,
        severity: 'MEDIUM', lat: 42.2, lon: -87.9,
      }),
    ],
    negative: [
      ev({
        id: 'n5a', sourceId: 'cdc-biosurveillance', domain: 'humanitarian', offsetMs: 0,
        severity: 'HIGH', lat: 41.88, lon: -87.63,
      }),
      ev({
        id: 'n5b', sourceId: 'aviation-track', domain: 'aviation', offsetMs: 24 * HOUR,
        severity: 'MEDIUM', lat: 41.88, lon: -67,
      }),
    ],
  },
  {
    ruleId: 'sanctions-maritime',
    nearMiss: 'the designation and the AIS gap name different vessels',
    positive: [
      ev({
        id: 'p6a', sourceId: 'ofac-sanctions', domain: 'macro', offsetMs: 0,
        severity: 'HIGH', entityIds: ['MMSI-273845000'],
      }),
      ev({
        id: 'p6b', sourceId: 'ais-disruption', domain: 'maritime', offsetMs: 3 * HOUR,
        severity: 'MEDIUM', entityIds: ['MMSI-273845000'],
      }),
    ],
    negative: [
      ev({
        id: 'n6a', sourceId: 'ofac-sanctions', domain: 'macro', offsetMs: 0,
        severity: 'HIGH', entityIds: ['MMSI-273845000'],
      }),
      ev({
        id: 'n6b', sourceId: 'ais-disruption', domain: 'maritime', offsetMs: 3 * HOUR,
        severity: 'MEDIUM', entityIds: ['MMSI-999000111'],
      }),
    ],
  },
  {
    ruleId: 'space-weather-infrastructure',
    nearMiss: 'the grid advisory lands 3 h later, outside the 2 h window',
    positive: [
      ev({
        id: 'p7a', sourceId: 'swpc-space-weather', domain: 'space', offsetMs: 0,
        severity: 'HIGH', tags: ['scale-g4'],
      }),
      ev({
        id: 'p7b', sourceId: 'cisa-infrastructure', domain: 'infra', offsetMs: 90 * MINUTE,
        severity: 'HIGH',
      }),
    ],
    negative: [
      ev({
        id: 'n7a', sourceId: 'swpc-space-weather', domain: 'space', offsetMs: 0,
        severity: 'HIGH', tags: ['scale-g4'],
      }),
      ev({
        id: 'n7b', sourceId: 'cisa-infrastructure', domain: 'infra', offsetMs: 3 * HOUR,
        severity: 'HIGH',
      }),
    ],
  },
  {
    ruleId: 'weather-aviation',
    nearMiss: 'the alert is LOW severity, below the HIGH/CRITICAL floor',
    positive: [
      ev({
        id: 'p8a', sourceId: 'nws-alerts', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 32.9, lon: -97.04, tags: ['severe-thunderstorm'],
      }),
      ev({
        id: 'p8b', sourceId: 'aviation-track', domain: 'aviation', offsetMs: 2 * HOUR,
        severity: 'MEDIUM', lat: 33.2, lon: -97.3,
      }),
    ],
    negative: [
      ev({
        id: 'n8a', sourceId: 'nws-alerts', domain: 'weather', offsetMs: 0,
        severity: 'LOW', lat: 32.9, lon: -97.04, tags: ['severe-thunderstorm'],
      }),
      ev({
        id: 'n8b', sourceId: 'aviation-track', domain: 'aviation', offsetMs: 2 * HOUR,
        severity: 'MEDIUM', lat: 33.2, lon: -97.3,
      }),
    ],
  },
  {
    ruleId: 'conflict-displacement',
    nearMiss: 'the conflict event and the displacement record name different countries',
    positive: [
      ev({
        id: 'p9a', sourceId: 'acled-events', domain: 'conflict', offsetMs: 0,
        severity: 'HIGH', entityIds: ['SD'],
      }),
      ev({
        id: 'p9b', sourceId: 'gdacs-alerts', domain: 'humanitarian', offsetMs: 12 * HOUR,
        severity: 'HIGH', entityIds: ['SD'], tags: ['displacement'],
      }),
    ],
    negative: [
      ev({
        id: 'n9a', sourceId: 'acled-events', domain: 'conflict', offsetMs: 0,
        severity: 'HIGH', entityIds: ['SD'],
      }),
      ev({
        id: 'n9b', sourceId: 'gdacs-alerts', domain: 'humanitarian', offsetMs: 12 * HOUR,
        severity: 'HIGH', entityIds: ['MM'], tags: ['displacement'],
      }),
    ],
  },
];

/** One rule's two-fixture verdict. Both flags must be true. */
export interface BenchRuleProbe {
  ruleId: string;
  /** The positive fixture produced a pair attributed to THIS rule. */
  positiveMatched: boolean;
  /** The near-miss fixture produced no pair attributed to this rule. */
  nearMissRejected: boolean;
  /** Which single clause the near-miss fixture violates. */
  nearMiss: string;
}

/** Runs one fixture through the whole shipped rule set; true when `ruleId` fired. */
function fires(ruleId: string, observations: readonly ObservationEvent[]): boolean {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  return engine.correlate(observations, PROBE_NOW).pairs.some((p) => p.ruleId === ruleId);
}

/**
 * Every shipped rule, exercised positively and negatively.
 *
 * Sorted by rule id so the report is byte-stable, and returned for EVERY
 * fixture regardless of outcome — a rule that has lost its fixture must show up
 * as a missing probe, not as a silently shorter list.
 */
export function probeBuiltInRules(): BenchRuleProbe[] {
  return RULE_FIXTURES
    .map((f) => ({
      ruleId: f.ruleId,
      positiveMatched: fires(f.ruleId, f.positive),
      nearMissRejected: !fires(f.ruleId, f.negative),
      nearMiss: f.nearMiss,
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
