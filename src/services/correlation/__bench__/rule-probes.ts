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
 * that no longer fires. So every rule gets hand-built fixtures instead — one
 * pair it must emit, and one near-miss PER CLAUSE, each defeating a single
 * guard and nothing else. They run through a live `CorrelateEngine` carrying
 * the whole shipped rule set, so the probe exercises the real registration, the
 * real domain gate, the real time window and the real matcher.
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
import { digestRecords } from './golden-streams';

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

/** A field-level perturbation of one positive-fixture event. */
type SpecPatch = { [K in keyof ProbeSpec]?: ProbeSpec[K] | undefined };

/**
 * One near-miss: the positive fixture with exactly one clause defeated.
 *
 * Stored as a PATCH rather than a second hand-written event pair. Copies drift:
 * the reviewer's finding was that the earthquake-tsunami near-miss tested only
 * distance while silently holding the GDACS source clause valid, so deleting
 * that clause from the rule changed nothing anyone could see. A patch cannot
 * differ from the positive except in the field it names, and the set of patches
 * per rule is the set of clauses the probe claims to cover.
 *
 * A patch may touch two fields when the clause is a DISJUNCTION — `strong` in
 * space-weather-infrastructure is satisfied by either a G4/G5 tag or a HIGH
 * severity, so defeating that one clause means lowering both.
 */
export interface RuleNearMiss {
  /** The single clause this fixture defeats. */
  clause: string;
  /** Field-level perturbations, keyed by position in the positive pair. */
  patch: { 0?: SpecPatch; 1?: SpecPatch };
}

export interface RuleFixture {
  ruleId: string;
  /** The pair the rule must emit, as specs so near-misses can patch them. */
  positive: readonly [ProbeSpec, ProbeSpec];
  /** One near-miss per independently-defeatable clause of the rule. */
  nearMisses: readonly RuleNearMiss[];
}

/**
 * One positive fixture and one near-miss PER CLAUSE for every shipped rule.
 *
 * A single near-miss per rule was not coverage. It proved the matcher still
 * rejects something; it said nothing about the clauses it did not exercise, and
 * a rule that quietly loses one of those keeps rejecting the one fixture that
 * tests a different clause. Every guard a rule applies — source, tag, severity,
 * distance, shared entity, time window, domain gate — now has a fixture that
 * defeats it alone.
 */
export const RULE_FIXTURES: readonly RuleFixture[] = [
  {
    ruleId: 'earthquake-tsunami',
    positive: [
      {
        id: 'p1a', sourceId: 'usgs-earthquake', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 38.2, lon: 142.5, tags: ['major-earthquake'],
      },
      {
        id: 'p1b', sourceId: 'gdacs-alerts', domain: 'humanitarian', offsetMs: 30 * MINUTE,
        severity: 'HIGH', lat: 38.9, lon: 143.1, tags: ['ocean-hazard'],
      },
    ],
    nearMisses: [
      { clause: 'the quake is not a USGS record', patch: { 0: { sourceId: 'emsc-seismic' } } },
      { clause: 'the quake lacks the major-earthquake tag', patch: { 0: { tags: [] } } },
      {
        clause: 'the quake is MEDIUM, below the M6.5 severity floor',
        patch: { 0: { severity: 'MEDIUM' } },
      },
      {
        clause: 'the ocean bulletin is not a GDACS record',
        patch: { 1: { sourceId: 'nws-alerts' } },
      },
      {
        clause: 'the ocean bulletin is ~1500 km away, past the 800 km radius',
        patch: { 1: { lon: 159.5 } },
      },
      {
        clause: 'the ocean bulletin has no location, so no distance can be proven',
        patch: { 1: { lat: undefined, lon: undefined } },
      },
      {
        clause: 'the ocean bulletin lands 3 h later, outside the 60 min window',
        patch: { 1: { offsetMs: 3 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains (weather + humanitarian)',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
  {
    ruleId: 'earthquake-infrastructure',
    positive: [
      {
        id: 'p2a', sourceId: 'usgs-earthquake', domain: 'weather', offsetMs: 0,
        severity: 'MEDIUM', lat: 34.05, lon: -118.24, tags: ['earthquake'],
      },
      {
        id: 'p2b', sourceId: 'cisa-infrastructure', domain: 'infra', offsetMs: 2 * HOUR,
        severity: 'HIGH', lat: 34.4, lon: -118.6,
      },
    ],
    nearMisses: [
      { clause: 'the quake is not a USGS record', patch: { 0: { sourceId: 'emsc-seismic' } } },
      {
        clause: 'the quake is LOW, below the M5 severity floor',
        patch: { 0: { severity: 'LOW' } },
      },
      {
        clause: 'the advisory is not a CISA record',
        patch: { 1: { sourceId: 'eia-grid-status' } },
      },
      {
        clause: 'the CISA advisory carries no location, so no distance can be proven',
        patch: { 1: { lat: undefined, lon: undefined } },
      },
      {
        clause: 'the advisory is ~1000 km away, past the 500 km radius',
        patch: { 1: { lon: -107 } },
      },
      {
        clause: 'the advisory lands 6 h later, outside the 4 h window',
        patch: { 1: { offsetMs: 6 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains (weather + infra)',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
  {
    ruleId: 'weather-wildfire',
    positive: [
      {
        id: 'p3a', sourceId: 'nws-alerts', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', entityIds: ['US-CA'], tags: ['red-flag-warning'],
      },
      {
        id: 'p3b', sourceId: 'inciweb-wildfire', domain: 'weather', offsetMs: 6 * HOUR,
        severity: 'HIGH', entityIds: ['US-CA'], tags: ['wildfire'],
      },
    ],
    nearMisses: [
      {
        clause: 'the warning is not an NWS alert',
        patch: { 0: { sourceId: 'noaa-observations' } },
      },
      {
        clause: 'the warning carries neither red-flag-warning nor fire-weather-watch',
        patch: { 0: { tags: ['heat-advisory'] } },
      },
      {
        clause: 'the second event is neither an InciWeb record nor tagged wildfire',
        patch: { 1: { sourceId: 'nasa-firms', tags: ['thermal-anomaly'] } },
      },
      {
        clause: 'the red-flag warning and the fire sit in different states',
        patch: { 1: { entityIds: ['US-MT'] } },
      },
      { clause: 'the fire carries no entity ids at all', patch: { 1: { entityIds: [] } } },
      {
        clause: 'the fire lands 30 h later, outside the 24 h window',
        patch: { 1: { offsetMs: 30 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domain (weather)',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
  {
    ruleId: 'airquality-wildfire',
    positive: [
      {
        id: 'p4a', sourceId: 'airnow', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 45.52, lon: -122.68, tags: ['smoke-relevant'],
      },
      {
        id: 'p4b', sourceId: 'inciweb-wildfire', domain: 'weather', offsetMs: 6 * HOUR,
        severity: 'HIGH', lat: 46.1, lon: -121.5, tags: ['wildfire'],
      },
    ],
    nearMisses: [
      { clause: 'the reading is not an AirNow record', patch: { 0: { sourceId: 'openaq' } } },
      { clause: 'the reading is not tagged smoke-relevant', patch: { 0: { tags: [] } } },
      {
        clause: 'the second event is neither an InciWeb record nor tagged wildfire',
        patch: { 1: { sourceId: 'nasa-firms', tags: ['thermal-anomaly'] } },
      },
      {
        clause: 'the fire is ~400 km from the monitor, past the 150 km smoke radius',
        patch: { 1: { lat: 49.1, lon: -122.68 } },
      },
      {
        clause: 'the fire has no location, so no distance can be proven',
        patch: { 1: { lat: undefined, lon: undefined } },
      },
      {
        clause: 'the fire lands 30 h later, outside the 24 h window',
        patch: { 1: { offsetMs: 30 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domain (weather)',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
  {
    ruleId: 'biosurv-aviation',
    positive: [
      {
        id: 'p5a', sourceId: 'cdc-biosurveillance', domain: 'humanitarian', offsetMs: 0,
        severity: 'HIGH', lat: 41.88, lon: -87.63,
      },
      {
        id: 'p5b', sourceId: 'aviation-track', domain: 'aviation', offsetMs: 24 * HOUR,
        severity: 'MEDIUM', lat: 42.2, lon: -87.9,
      },
    ],
    nearMisses: [
      {
        clause: 'the spike is not a CDC biosurveillance record',
        patch: { 0: { sourceId: 'who-outbreaks' } },
      },
      {
        clause: 'the track is not an aviation-track observation',
        patch: { 1: { sourceId: 'adsb-exchange' } },
      },
      {
        clause: 'the aircraft is ~1700 km from the surveillance signal',
        patch: { 1: { lon: -67 } },
      },
      {
        clause: 'the track has no location, so no distance can be proven',
        patch: { 1: { lat: undefined, lon: undefined } },
      },
      {
        clause: 'the track lands 96 h later, outside the 72 h window',
        patch: { 1: { offsetMs: 96 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
  {
    ruleId: 'sanctions-maritime',
    positive: [
      {
        id: 'p6a', sourceId: 'ofac-sanctions', domain: 'macro', offsetMs: 0,
        severity: 'HIGH', entityIds: ['MMSI-273845000'],
      },
      {
        id: 'p6b', sourceId: 'ais-disruption', domain: 'maritime', offsetMs: 3 * HOUR,
        severity: 'MEDIUM', entityIds: ['MMSI-273845000'],
      },
    ],
    nearMisses: [
      {
        clause: 'the designation is not an OFAC record',
        patch: { 0: { sourceId: 'eu-sanctions' } },
      },
      {
        clause: 'the gap is not an ais-disruption observation',
        patch: { 1: { sourceId: 'marinetraffic' } },
      },
      {
        clause: 'the designation and the AIS gap name different vessels',
        patch: { 1: { entityIds: ['MMSI-999000111'] } },
      },
      { clause: 'the AIS gap names no vessel at all', patch: { 1: { entityIds: [] } } },
      {
        clause: 'the AIS gap lands 18 h later, outside the 12 h window',
        patch: { 1: { offsetMs: 18 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains (macro + maritime)',
        patch: { 0: { domain: 'weather' }, 1: { domain: 'weather' } },
      },
    ],
  },
  {
    ruleId: 'space-weather-infrastructure',
    positive: [
      {
        id: 'p7a', sourceId: 'swpc-space-weather', domain: 'space', offsetMs: 0,
        severity: 'HIGH', tags: ['scale-g4'],
      },
      {
        id: 'p7b', sourceId: 'cisa-infrastructure', domain: 'infra', offsetMs: 90 * MINUTE,
        severity: 'HIGH',
      },
    ],
    nearMisses: [
      {
        clause: 'the storm bulletin is not an SWPC record',
        patch: { 0: { sourceId: 'gfz-potsdam-kp' } },
      },
      {
        clause: 'the storm is neither G4/G5-tagged nor HIGH severity',
        patch: { 0: { tags: ['scale-g2'], severity: 'MEDIUM' } },
      },
      {
        clause: 'the grid advisory is not a CISA record',
        patch: { 1: { sourceId: 'eia-grid-status' } },
      },
      {
        clause: 'the grid advisory lands 3 h later, outside the 2 h window',
        patch: { 1: { offsetMs: 3 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains (space + infra)',
        patch: { 0: { domain: 'weather' }, 1: { domain: 'weather' } },
      },
    ],
  },
  {
    ruleId: 'weather-aviation',
    positive: [
      {
        id: 'p8a', sourceId: 'nws-alerts', domain: 'weather', offsetMs: 0,
        severity: 'HIGH', lat: 32.9, lon: -97.04, tags: ['severe-thunderstorm'],
      },
      {
        id: 'p8b', sourceId: 'aviation-track', domain: 'aviation', offsetMs: 2 * HOUR,
        severity: 'MEDIUM', lat: 33.2, lon: -97.3,
      },
    ],
    nearMisses: [
      {
        clause: 'the alert is not an NWS record',
        patch: { 0: { sourceId: 'noaa-observations' } },
      },
      {
        clause: 'the alert is LOW severity, below the HIGH/CRITICAL floor',
        patch: { 0: { severity: 'LOW' } },
      },
      {
        clause: 'the track is not an aviation-track observation',
        patch: { 1: { sourceId: 'adsb-exchange' } },
      },
      { clause: 'the aircraft is ~1500 km from the alert', patch: { 1: { lon: -81 } } },
      {
        clause: 'the track has no location, so no distance can be proven',
        patch: { 1: { lat: undefined, lon: undefined } },
      },
      {
        clause: 'the track lands 8 h later, outside the 6 h window',
        patch: { 1: { offsetMs: 8 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
  {
    ruleId: 'conflict-displacement',
    positive: [
      {
        id: 'p9a', sourceId: 'acled-events', domain: 'conflict', offsetMs: 0,
        severity: 'HIGH', entityIds: ['SD'],
      },
      {
        id: 'p9b', sourceId: 'gdacs-alerts', domain: 'humanitarian', offsetMs: 12 * HOUR,
        severity: 'HIGH', entityIds: ['SD'], tags: ['displacement'],
      },
    ],
    nearMisses: [
      {
        clause: 'the first event is neither in the conflict domain nor an ACLED record',
        patch: { 0: { domain: 'humanitarian', sourceId: 'reliefweb' } },
      },
      {
        clause: 'the second event is neither tagged displacement nor a GDACS record',
        patch: { 1: { sourceId: 'reliefweb', tags: [] } },
      },
      {
        clause: 'the conflict event and the displacement record name different countries',
        patch: { 1: { entityIds: ['MM'] } },
      },
      {
        clause: 'the displacement record names no country',
        patch: { 1: { entityIds: [] } },
      },
      {
        clause: 'the displacement record lands 60 h later, outside the 48 h window',
        patch: { 1: { offsetMs: 60 * HOUR } },
      },
      {
        clause: 'both events sit outside the rule domains (conflict + humanitarian)',
        patch: { 0: { domain: 'macro' }, 1: { domain: 'macro' } },
      },
    ],
  },
];

/** The pair a rule must emit. */
export function positiveEvents(f: RuleFixture): ObservationEvent[] {
  return f.positive.map((spec) => ev(spec));
}

/** The positive pair with exactly the named clause defeated. */
export function nearMissEvents(f: RuleFixture, nm: RuleNearMiss): ObservationEvent[] {
  return f.positive.map((spec, i) => ev({ ...spec, ...(i === 0 ? nm.patch[0] : nm.patch[1]) }));
}

/** One near-miss verdict, carrying the clause it was aimed at. */
export interface BenchNearMissProbe {
  clause: string;
  /** No pair attributed to this rule survived the perturbation. */
  rejected: boolean;
}

/** One rule's coverage verdict across its positive fixture and every clause. */
export interface BenchRuleProbe {
  ruleId: string;
  /** The positive fixture produced a pair attributed to THIS rule. */
  positiveMatched: boolean;
  /**
   * The edge type the rule actually asserted, not merely that it fired.
   *
   * Five of the nine rules never emit over the golden corpus, so for those the
   * probe is the ONLY place their semantics are observed. While this was absent,
   * rewriting `airquality-wildfire` from `causal-candidate` to `contradicts` —
   * the opposite claim, and a different evidence edge downstream — left both
   * booleans, the fixture digest and the whole report digest unmoved.
   */
  positiveEdgeType: string | null;
  /** `from→to` in EMISSION order, so an inverted matcher is visible too. */
  positiveDirection: string | null;
  /** One verdict per independently-defeatable clause. */
  nearMisses: BenchNearMissProbe[];
  /**
   * Digest over the probe's INPUTS and expected outcomes, not its verdicts.
   *
   * Booleans do not pin a probe. Move `n1b.sourceId` off GDACS and delete the
   * earthquake-tsunami distance clause together and the positive still matches,
   * the near-miss still rejects — on the SOURCE gate now, not on the radius the
   * fixture was built to test — and every leaf of the report holds still. The
   * probe would be reporting `true` about a clause that no longer exists.
   *
   * This covers every field of the positive fixture, every near-miss patch and
   * its clause text, and the expected outcomes, so re-aiming a fixture moves the
   * report digest and lands in a reviewed diff. It pins WHAT WAS ASKED; the
   * verdicts stay as the answer.
   */
  fixtureDigest: string;
}

/**
 * Canonical, key-sorted serialisation of one fixture event.
 *
 * Key-SORTED rather than `JSON.stringify` over the literal: the object's key
 * order is an artefact of how `ev()` happens to spread its optional location,
 * so a harmless reordering there would move every probe digest at once and
 * present as nine simultaneous regressions.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** The records that make up one fixture's digest — inputs and expectations. */
function fixtureRecords(f: RuleFixture): string[] {
  return [
    `rule:${f.ruleId}`,
    // Constant today, recorded anyway: an inverted probe that expects the
    // positive to be REJECTED must not be able to inherit this digest.
    'expect:positive=matched',
    'expect:every-near-miss=rejected',
    `clauseCount:${f.nearMisses.length}`,
    ...positiveEvents(f).map((e, i) => `pos:${i}:${canonical(e)}`),
    // Clause text AND resolved events: renaming a clause without re-aiming it is
    // a documentation change, and re-aiming it without renaming is the defect.
    // Both move the digest.
    ...f.nearMisses.flatMap((nm) => [
      `miss:${nm.clause}`,
      ...nearMissEvents(f, nm).map((e, i) => `miss:${nm.clause}:${i}:${canonical(e)}`),
    ]),
  ];
}

/**
 * Runs one fixture through the whole shipped rule set and returns what `ruleId`
 * emitted, or `null` when it did not fire.
 */
function emissionOf(
  ruleId: string,
  observations: readonly ObservationEvent[],
): { edgeType: string; fromId: string; toId: string } | null {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  const hit = engine.correlate(observations, PROBE_NOW).pairs.find((p) => p.ruleId === ruleId);
  return hit === undefined
    ? null
    : { edgeType: hit.edgeType, fromId: hit.eventA.id, toId: hit.eventB.id };
}

/**
 * Exported so a test can perturb a fixture and watch the digest move — the
 * fixtures themselves are what this pins, and a digest nobody has seen react is
 * indistinguishable from a constant.
 */
export function digestRuleFixture(f: RuleFixture): string {
  return digestRecords(fixtureRecords(f));
}

/**
 * Every shipped rule, exercised positively and once per clause.
 *
 * Sorted by rule id so the report is byte-stable, and returned for EVERY
 * fixture regardless of outcome — a rule that has lost its fixture must show up
 * as a missing probe, not as a silently shorter list.
 */
export function probeBuiltInRules(): BenchRuleProbe[] {
  return RULE_FIXTURES
    .map((f) => {
      const hit = emissionOf(f.ruleId, positiveEvents(f));
      return {
        ruleId: f.ruleId,
        positiveMatched: hit !== null,
        positiveEdgeType: hit?.edgeType ?? null,
        positiveDirection: hit === null ? null : `${hit.fromId}→${hit.toId}`,
        nearMisses: f.nearMisses.map((nm) => ({
          clause: nm.clause,
          rejected: emissionOf(f.ruleId, nearMissEvents(f, nm)) === null,
        })),
        fixtureDigest: digestRuleFixture(f),
      };
    })
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
