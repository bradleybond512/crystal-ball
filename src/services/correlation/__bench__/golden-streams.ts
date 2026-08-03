/**
 * Golden Streams — frozen fixture corpus for the Correlation Benchmark (ACC-501).
 *
 * House pattern: mirrors src/services/cognition/__bench__/golden-windows.ts
 * (frozen fixtures with planted ground truth, fixed-seed PRNG, stable
 * timestamps, no live fetch, no Math.random, no Date.now).
 *
 * Ten streams over a fixed 30-day span, each planted for a specific reason.
 * Ground truth exists at two levels because the correlation stack has two
 * independently-movable halves:
 *
 *   1. DOMAIN level (`PLANTED_COUPLINGS`) — grades the lead-lag miner
 *      (mineLeadLag → significantEdges → learnedRulesFromEdges), which only
 *      ever sees `{domain, at}`.
 *   2. EVENT level (`truePairKeys` / `decoyEventIds`) — grades the
 *      CorrelateEngine's built-in rules, which see the whole ObservationEvent.
 *
 * The streams and what each one defends:
 *
 *   S1 seismic-ocean      TRUE causal, spatial matcher (earthquake-tsunami)
 *   S2 grid-storm         TRUE causal, non-spatial matcher (space-weather-infrastructure)
 *   S3 fire-weather       TRUE causal, shared-entity matcher (weather-wildfire)
 *   S4 sanctions-shipping TRUE causal, shared-entity matcher (sanctions-maritime)
 *   S5 quiet-independents planted independent, all gaps > the widest mining
 *                         window — must never produce an edge
 *   S6 chatty-independent the BASE-RATE TRAP: a domain firing every 3h
 *                         "follows" everything. Naive follow-counting calls
 *                         this a coupling; Poisson normalization must not.
 *                         This is the regression guard on the miner's core.
 *   S7 bursty-confounder  a hidden driver fires two domains together in
 *                         bursts. Within-burst follow rate is ~1.0 while the
 *                         span-averaged rate is tiny, so the UNCORRECTED
 *                         miner calls it significant. ACC-504 (dispersion
 *                         correction) must drive these to zero.
 *   S8 mediated-chain     X→Y→Z, so X→Z looks significant by transitivity
 *                         alone. ACC-503 (mediation filtering) must remove it.
 *   S9 inhibitory-pair    calm-signal SUPPRESSES escalation. The current
 *                         miner cannot represent a negative edge at all
 *                         (`lift >= 2` filters one direction only), so today
 *                         an inhibitory coupling looks like *nothing*.
 *                         ACC-502 fills this slot.
 *   S10 decoy-near-miss   events that ALMOST satisfy a built-in rule (wrong
 *                         magnitude / wrong state / outside the window /
 *                         different vessel). Any pair emitted here is a
 *                         built-in-rule false positive and fails the gate
 *                         with zero tolerance.
 *
 * Deliberately NOT enumerated: the incidental couplings between unrelated
 * streams. With 12 domains there are ~132 ordered pairs, and a corpus with
 * no accidental coincidences would be a corpus that understates the
 * multiple-comparisons problem ACC-502 exists to solve. Any significant edge
 * that is not a planted causal one is counted against precision, which is
 * the honest accounting.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Time anchors ────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fixed corpus epoch — 2026-01-01T00:00:00Z. Never a live clock read. */
export const CORPUS_T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Observed span the miner normalizes base rates against. */
export const CORPUS_SPAN_DAYS = 30;

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
// Fixed seed so burst placement is byte-identical across runs and machines.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    // `| 0` performs real int32-wraparound arithmetic (the algorithm's
    // defining property) — not interchangeable with Math.trunc.
    // eslint-disable-next-line unicorn/prefer-math-trunc
    a = (a + 0x6D_2B_79_F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const rand = mulberry32(0xAC_C5_01);

/** ±`spreadMinutes` of deterministic jitter, applied only to burst anchors
 *  (never inside a burst) so no event is ever nudged across a rule window. */
function jitter(spreadMinutes: number): number {
  return Math.round((rand() * 2 - 1) * spreadMinutes) * MINUTE;
}

function at(days: number): number {
  return CORPUS_T0 + Math.round(days * DAY);
}

// ── Ground-truth types ──────────────────────────────────────────────────────

export type PlantedCouplingKind =
  /** A genuine directed coupling the miner SHOULD find. */
  | 'causal'
  /** No relationship — any edge here is a false positive. */
  | 'independent'
  /** Both sides driven by a hidden third cause (ACC-504 target). */
  | 'confounded'
  /** Real only through an intermediate domain (ACC-503 target). */
  | 'mediated'
  /** Antecedent SUPPRESSES the consequent (ACC-502 target). */
  | 'inhibitory';

export interface PlantedCoupling {
  from: string;
  to: string;
  kind: PlantedCouplingKind;
  /** Why this coupling is in the corpus — read by the benchmark report. */
  rationale: string;
}

export interface GoldenStream {
  id: string;
  description: string;
  observations: readonly ObservationEvent[];
  /** Event-level pairs a correct built-in rule set should emit. */
  truePairKeys: readonly string[];
  /** Events that must never appear in ANY emitted pair. */
  decoyEventIds: readonly string[];
}

/**
 * Direction-independent pair key. Deliberately NOT `|`-separated:
 * correlation-outcomes.ts splits prediction ids on `|`.
 *
 * Each id is LENGTH-PREFIXED, for the same reason the corpus digest is: a bare
 * separator is not a boundary, it is just more characters in the key. With
 * plain `a::b`, `pairKeyFor('a', 'b::c')` and `pairKeyFor('a::b', 'c')` produce
 * the identical key, so two distinct planted pairs collapse into one truth row
 * and one ledger row — one of them silently stops being graded.
 */
export function pairKeyFor(aId: string, bId: string): string {
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  return `${a.length}:${a}::${b.length}:${b}`;
}

// ── Observation builder ─────────────────────────────────────────────────────

interface ObsSpec {
  id: string;
  sourceId: string;
  domain: string;
  timestamp: number;
  severity?: ObservationSeverity;
  title?: string;
  lat?: number;
  lon?: number;
  entityIds?: string[];
  tags?: string[];
}

function obs(spec: ObsSpec): ObservationEvent {
  return {
    id: spec.id,
    sourceId: spec.sourceId,
    domain: spec.domain,
    timestamp: spec.timestamp,
    severity: spec.severity ?? 'MEDIUM',
    title: spec.title ?? spec.id,
    raw: { fixture: spec.id },
    entityIds: spec.entityIds ?? [],
    tags: spec.tags ?? [],
    ...(spec.lat === undefined || spec.lon === undefined
      ? {}
      : { location: { lat: spec.lat, lon: spec.lon } }),
  };
}

// ── S1 — seismic → ocean hazard (TRUE causal, spatial) ──────────────────────
// M6.8 quake followed 20-45 min later by a GDACS ocean hazard ~180km away.
// Fires the built-in `earthquake-tsunami` rule (60 min / 800 km).
// Bursts are 4 days apart so no quake can reach a neighbouring alert.

function buildSeismicOcean(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const truePairKeys: string[] = [];
  const anchors = [0.5, 4.5, 8.5, 12.5, 16.5, 20.5];

  for (const [i, day] of anchors.entries()) {
    const t = at(day) + jitter(90);
    const quakeId = `s1-quake-${i}`;
    const alertId = `s1-gdacs-${i}`;
    observations.push(
      obs({
        id: quakeId,
        sourceId: 'usgs-earthquake',
        domain: 'weather',
        timestamp: t,
        severity: 'HIGH',
        title: `M6.8 earthquake offshore (fixture ${i})`,
        lat: 38.2 + i * 0.4,
        lon: 142.5 + i * 0.4,
        tags: ['earthquake', 'major-earthquake'],
      }),
      obs({
        id: alertId,
        sourceId: 'gdacs-alerts',
        domain: 'humanitarian',
        timestamp: t + 20 * MINUTE + i * 5 * MINUTE,
        severity: 'HIGH',
        title: `GDACS ocean hazard bulletin (fixture ${i})`,
        lat: 38.2 + i * 0.4 + 1.2,
        lon: 142.5 + i * 0.4 + 0.6,
        tags: ['ocean-hazard', 'tsunami-risk'],
      }),
    );
    truePairKeys.push(pairKeyFor(quakeId, alertId));
  }

  return {
    id: 'seismic-ocean',
    description: 'M6.8 quake → GDACS ocean hazard within 60 min and 800 km (spatial matcher).',
    observations,
    truePairKeys,
    decoyEventIds: [],
  };
}

// ── S2 — geomagnetic storm → infrastructure (TRUE causal, non-spatial) ──────
// Fires `space-weather-infrastructure` (2h, no distance check). CISA events
// deliberately carry NO location so `earthquake-infrastructure` — which needs
// both sides located — can never fire on them.

function buildGridStorm(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const truePairKeys: string[] = [];
  const anchors = [1.5, 5.5, 9.5, 13.5, 17.5, 21.5];

  for (const [i, day] of anchors.entries()) {
    const t = at(day) + jitter(120);
    const stormId = `s2-storm-${i}`;
    const incidentId = `s2-cisa-${i}`;
    observations.push(
      obs({
        id: stormId,
        sourceId: 'swpc-space-weather',
        domain: 'space',
        timestamp: t,
        severity: 'CRITICAL',
        title: `G4 geomagnetic storm (fixture ${i})`,
        tags: ['scale-g4', 'geomagnetic-storm'],
      }),
      obs({
        id: incidentId,
        sourceId: 'cisa-infrastructure',
        domain: 'infra',
        timestamp: t + 40 * MINUTE + i * 8 * MINUTE,
        severity: 'HIGH',
        title: `Grid operator anomaly advisory (fixture ${i})`,
        tags: ['grid-anomaly'],
      }),
    );
    truePairKeys.push(pairKeyFor(stormId, incidentId));
  }

  return {
    id: 'grid-storm',
    description: 'G4 storm → CISA infrastructure advisory within 2h (non-spatial matcher).',
    observations,
    truePairKeys,
    decoyEventIds: [],
  };
}

// ── S3 — red-flag → wildfire (TRUE causal, shared entity) ───────────────────
// Fires `weather-wildfire` (24h window, shared state code). Both sides sit in
// the `weather` domain, so this stream grades the ENGINE only — the miner
// excludes self-domain edges by design.

function buildFireWeather(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const truePairKeys: string[] = [];
  const anchors = [2.2, 6.2, 10.2, 14.2, 18.2];

  for (const [i, day] of anchors.entries()) {
    const t = at(day) + jitter(150);
    const warnId = `s3-redflag-${i}`;
    const fireId = `s3-wildfire-${i}`;
    observations.push(
      obs({
        id: warnId,
        sourceId: 'nws-alerts',
        domain: 'weather',
        timestamp: t,
        severity: 'HIGH',
        title: `Red flag warning, interior California (fixture ${i})`,
        lat: 38.6, lon: -121.5,
        entityIds: ['US-CA'],
        tags: ['red-flag-warning'],
      }),
      obs({
        id: fireId,
        sourceId: 'inciweb-wildfire',
        domain: 'weather',
        timestamp: t + 6 * HOUR + i * 90 * MINUTE,
        severity: 'HIGH',
        title: `New wildfire start (fixture ${i})`,
        lat: 38.9, lon: -121.1,
        entityIds: ['US-CA'],
        tags: ['wildfire'],
      }),
    );
    truePairKeys.push(pairKeyFor(warnId, fireId));
  }

  return {
    id: 'fire-weather',
    description: 'Red-flag warning → wildfire start sharing a state code within 24h.',
    observations,
    truePairKeys,
    decoyEventIds: [],
  };
}

// ── S4 — sanctions → AIS disruption (TRUE causal, shared entity) ────────────
// Fires `sanctions-maritime` (12h window, shared MMSI).

function buildSanctionsShipping(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const truePairKeys: string[] = [];
  const anchors = [3.1, 7.1, 11.1, 15.1, 19.1];

  for (const [i, day] of anchors.entries()) {
    const t = at(day) + jitter(100);
    const mmsi = `MMSI-27310000${i}`;
    const listingId = `s4-ofac-${i}`;
    const gapId = `s4-ais-${i}`;
    observations.push(
      obs({
        id: listingId,
        sourceId: 'ofac-sanctions',
        domain: 'macro',
        timestamp: t,
        severity: 'HIGH',
        title: `OFAC SDN designation (fixture ${i})`,
        entityIds: [mmsi],
        tags: ['sanctions', 'sdn-listing'],
      }),
      obs({
        id: gapId,
        sourceId: 'ais-disruption',
        domain: 'maritime',
        timestamp: t + 3 * HOUR + i * 45 * MINUTE,
        severity: 'MEDIUM',
        title: `AIS transponder gap (fixture ${i})`,
        entityIds: [mmsi],
        tags: ['ais-gap'],
      }),
    );
    truePairKeys.push(pairKeyFor(listingId, gapId));
  }

  return {
    id: 'sanctions-shipping',
    description: 'OFAC designation → AIS gap on the same MMSI within 12h.',
    observations,
    truePairKeys,
    decoyEventIds: [],
  };
}

// ── S5 — quiet independents (planted independent) ───────────────────────────
// Period 7 days, offset 3.5 days: every gap in BOTH directions is 84h, which
// exceeds the widest default mining window (72h). Support is structurally 0,
// so this pair must never yield an edge at any window scale.

function buildQuietIndependents(): GoldenStream {
  const observations: ObservationEvent[] = [];

  for (const [i, day] of [0.5, 7.5, 14.5, 21.5, 28.5].entries()) {
    observations.push(obs({
      id: `s5-radiation-${i}`,
      sourceId: 'radnet-monitor',
      domain: 'radiation',
      timestamp: at(day) + jitter(20),
      severity: 'LOW',
      title: `Background radiation sample (fixture ${i})`,
      tags: ['radiation-sample'],
    }));
  }
  for (const [i, day] of [4, 11, 18, 25].entries()) {
    observations.push(obs({
      id: `s5-pharma-${i}`,
      sourceId: 'fda-shortage',
      domain: 'pharma',
      timestamp: at(day) + jitter(20),
      severity: 'LOW',
      title: `Drug shortage listing update (fixture ${i})`,
      tags: ['pharma-shortage'],
    }));
  }

  return {
    id: 'quiet-independents',
    description: 'Two unrelated low-rate domains, anti-phased so every gap exceeds 72h.',
    observations,
    truePairKeys: [],
    decoyEventIds: [],
  };
}

// ── S6 — chatty independent (THE BASE-RATE TRAP) ────────────────────────────
// `newswire` fires every 3 hours for 30 days. Every one of the 8 `macro-quiet`
// events is therefore "followed by" a newswire item almost immediately. Naive
// follow-counting scores this as a perfect coupling; the Poisson base-rate
// normalization in mineLeadLag must reduce the lift to ~1. If this edge ever
// becomes significant, the miner has regressed to counting.

function buildChattyIndependent(): GoldenStream {
  const observations: ObservationEvent[] = [];

  const tickCount = (CORPUS_SPAN_DAYS * 24) / 3;
  for (let i = 0; i < tickCount; i++) {
    observations.push(obs({
      id: `s6-newswire-${i}`,
      sourceId: 'gdelt-news',
      domain: 'newswire',
      timestamp: CORPUS_T0 + i * 3 * HOUR,
      severity: 'INFO',
      title: `Wire item (fixture ${i})`,
      tags: ['news'],
    }));
  }
  for (const [i, day] of [1.7, 5.3, 8.9, 12.4, 16.1, 19.6, 23.2, 27.8].entries()) {
    observations.push(obs({
      id: `s6-macroquiet-${i}`,
      sourceId: 'worldbank-indicator',
      domain: 'macro-quiet',
      timestamp: at(day) + jitter(45),
      severity: 'LOW',
      title: `Quarterly indicator revision (fixture ${i})`,
      tags: ['indicator'],
    }));
  }

  return {
    id: 'chatty-independent',
    description: 'A 3-hourly firehose domain that "follows" everything — the base-rate trap.',
    observations,
    truePairKeys: [],
    decoyEventIds: [],
  };
}

// ── S7 — bursty confounder (ACC-504 target) ─────────────────────────────────
// A hidden driver fires both domains together in 5 tight bursts. There is no
// A→B causation, but within-burst follow rate is 1.0 against a span-averaged
// Poisson rate of ~2%, so the uncorrected miner calls BOTH directions
// significant. These are the false positives dispersion correction must kill.

function buildBurstyConfounder(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const anchors = [1, 7, 13, 19, 25];

  for (const [burst, day] of anchors.entries()) {
    const t = at(day) + jitter(60);
    for (let k = 0; k < 3; k++) {
      observations.push(
        obs({
          id: `s7-a-${burst}-${k}`,
          sourceId: 'confounded-feed-a',
          domain: 'bursty-a',
          timestamp: t + k * 40 * MINUTE,
          severity: 'MEDIUM',
          title: `Burst ${burst} signal A${k}`,
          tags: ['burst'],
        }),
        obs({
          id: `s7-b-${burst}-${k}`,
          sourceId: 'confounded-feed-b',
          domain: 'bursty-b',
          timestamp: t + k * 40 * MINUTE + 20 * MINUTE,
          severity: 'MEDIUM',
          title: `Burst ${burst} signal B${k}`,
          tags: ['burst'],
        }),
      );
    }
  }

  return {
    id: 'bursty-confounder',
    description: 'Two domains co-fired by a hidden driver in 5 bursts — no direct coupling.',
    observations,
    truePairKeys: [],
    decoyEventIds: [],
  };
}

// ── S8 — mediated chain (ACC-503 target) ────────────────────────────────────
// X→Y (45 min) →Z (75 min). X→Y and Y→Z are real; X→Z is significant purely
// by transitivity and must be filtered as mediated, not reported as direct.

function buildMediatedChain(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const anchors = [2, 6, 10, 14, 18, 22];

  for (const [i, day] of anchors.entries()) {
    const t = at(day) + jitter(80);
    observations.push(
      obs({
        id: `s8-x-${i}`,
        sourceId: 'chain-source-x',
        domain: 'chain-x',
        timestamp: t,
        severity: 'MEDIUM',
        title: `Chain antecedent X (fixture ${i})`,
        tags: ['chain'],
      }),
      obs({
        id: `s8-y-${i}`,
        sourceId: 'chain-source-y',
        domain: 'chain-y',
        timestamp: t + 45 * MINUTE,
        severity: 'MEDIUM',
        title: `Chain mediator Y (fixture ${i})`,
        tags: ['chain'],
      }),
      obs({
        id: `s8-z-${i}`,
        sourceId: 'chain-source-z',
        domain: 'chain-z',
        timestamp: t + 2 * HOUR,
        severity: 'MEDIUM',
        title: `Chain consequent Z (fixture ${i})`,
        tags: ['chain'],
      }),
    );
  }

  return {
    id: 'mediated-chain',
    description: 'X→Y→Z, so X→Z scores significant through the mediator alone.',
    observations,
    truePairKeys: [],
    decoyEventIds: [],
  };
}

// ── S9 — inhibitory pair (ACC-502 target) ───────────────────────────────────
// `calm-signal` suppresses `escalation`: each calm sits at the centre of a
// ~4-day escalation-free gap it caused. Because the current miner only tests
// for follow rates ABOVE chance, an inhibitory coupling is invisible to it —
// support is 0 in both directions and no edge is produced. That absence is
// the baseline; ACC-502's negative-edge support fills the slot.

function buildInhibitoryPair(): GoldenStream {
  const observations: ObservationEvent[] = [];
  const blocks = [0.2, 10, 20];
  let seq = 0;

  for (const start of blocks) {
    for (let k = 0; k < 6; k++) {
      observations.push(obs({
        id: `s9-escalation-${seq++}`,
        sourceId: 'acled-events',
        domain: 'escalation',
        timestamp: at(start + k * 0.4),
        severity: 'MEDIUM',
        title: 'Escalation report',
        tags: ['escalation'],
      }));
    }
  }
  for (const [i, day] of [6, 16, 26].entries()) {
    observations.push(obs({
      id: `s9-calm-${i}`,
      sourceId: 'ceasefire-monitor',
      domain: 'calm-signal',
      timestamp: at(day),
      severity: 'LOW',
      title: `De-escalation confirmation (fixture ${i})`,
      tags: ['de-escalation'],
    }));
  }

  return {
    id: 'inhibitory-pair',
    description: 'A calm signal that suppresses escalation — a negative edge today\'s miner cannot see.',
    observations,
    truePairKeys: [],
    decoyEventIds: [],
  };
}

// ── S10 — decoy near-misses (built-in rule precision) ───────────────────────
// Four pairs that each fail exactly one clause of a built-in rule. All sit in
// the tail of the corpus, clear of every planted burst, so nothing else can
// reach them. Any emitted pair touching these ids is a false positive with
// zero tolerance.

function buildDecoyNearMiss(): GoldenStream {
  const observations: ObservationEvent[] = [];

  // d1 — M4.2 is below the rule's M6.5 floor (severity LOW, no
  // 'major-earthquake' tag), so earthquake-tsunami must not fire.
  const d1a = at(26);
  observations.push(
    obs({
      id: 's10-smallquake',
      sourceId: 'usgs-earthquake',
      domain: 'weather',
      timestamp: d1a,
      severity: 'LOW',
      title: 'M4.2 earthquake (below correlation floor)',
      lat: 35.1, lon: 139.7,
      tags: ['earthquake'],
    }),
    obs({
      id: 's10-gdacs-nearby',
      sourceId: 'gdacs-alerts',
      domain: 'humanitarian',
      timestamp: d1a + 30 * MINUTE,
      severity: 'MEDIUM',
      title: 'Unrelated GDACS bulletin',
      lat: 35.6, lon: 140.2,
      tags: ['ocean-hazard'],
    }),
  );

  // d2 — red flag and wildfire in DIFFERENT states: shareEntity fails.
  const d2a = at(27);
  observations.push(
    obs({
      id: 's10-redflag-or',
      sourceId: 'nws-alerts',
      domain: 'weather',
      timestamp: d2a,
      severity: 'HIGH',
      title: 'Red flag warning, Oregon',
      lat: 44, lon: -120.5,
      entityIds: ['US-OR'],
      tags: ['red-flag-warning'],
    }),
    obs({
      id: 's10-wildfire-wa',
      sourceId: 'inciweb-wildfire',
      domain: 'weather',
      timestamp: d2a + 8 * HOUR,
      severity: 'HIGH',
      title: 'Wildfire start, Washington',
      lat: 47.4, lon: -120.3,
      entityIds: ['US-WA'],
      tags: ['wildfire'],
    }),
  );

  // d3 — G4 storm and CISA advisory 3h apart: outside the rule's 2h window.
  const d3a = at(28);
  observations.push(
    obs({
      id: 's10-storm-late',
      sourceId: 'swpc-space-weather',
      domain: 'space',
      timestamp: d3a,
      severity: 'CRITICAL',
      title: 'G4 storm (advisory arrives too late to join)',
      tags: ['scale-g4'],
    }),
    obs({
      id: 's10-cisa-late',
      sourceId: 'cisa-infrastructure',
      domain: 'infra',
      timestamp: d3a + 3 * HOUR,
      severity: 'HIGH',
      title: 'Infrastructure advisory, 3h after storm onset',
      tags: ['grid-anomaly'],
    }),
  );

  // d4 — sanctioned vessel and AIS gap on DIFFERENT MMSIs.
  const d4a = at(29);
  observations.push(
    obs({
      id: 's10-ofac-other',
      sourceId: 'ofac-sanctions',
      domain: 'macro',
      timestamp: d4a,
      severity: 'HIGH',
      title: 'OFAC designation, vessel A',
      entityIds: ['MMSI-999999999'],
      tags: ['sanctions'],
    }),
    obs({
      id: 's10-ais-other',
      sourceId: 'ais-disruption',
      domain: 'maritime',
      timestamp: d4a + 4 * HOUR,
      severity: 'MEDIUM',
      title: 'AIS gap, unrelated vessel B',
      entityIds: ['MMSI-888888888'],
      tags: ['ais-gap'],
    }),
  );

  return {
    id: 'decoy-near-miss',
    description: 'Four pairs each failing exactly one clause of a built-in rule.',
    observations,
    truePairKeys: [],
    decoyEventIds: observations.map((o) => o.id),
  };
}

// ── Corpus ──────────────────────────────────────────────────────────────────

export const GOLDEN_STREAMS: readonly GoldenStream[] = [
  buildSeismicOcean(),
  buildGridStorm(),
  buildFireWeather(),
  buildSanctionsShipping(),
  buildQuietIndependents(),
  buildChattyIndependent(),
  buildBurstyConfounder(),
  buildMediatedChain(),
  buildInhibitoryPair(),
  buildDecoyNearMiss(),
];

/**
 * Domain-level ground truth for the lead-lag miner.
 *
 * Only pairs whose relationship was deliberately constructed appear here.
 * `fire-weather` is absent because both of its sides live in the `weather`
 * domain and the miner excludes self-domain edges — it grades the engine only.
 */
export const PLANTED_COUPLINGS: readonly PlantedCoupling[] = [
  {
    from: 'weather', to: 'humanitarian', kind: 'causal',
    rationale: 'S1 — each M6.8 quake is followed by an ocean-hazard bulletin within 45 min.',
  },
  {
    from: 'space', to: 'infra', kind: 'causal',
    rationale: 'S2 — each G4 storm is followed by a grid advisory within 90 min.',
  },
  {
    from: 'macro', to: 'maritime', kind: 'causal',
    rationale: 'S4 — each OFAC designation is followed by an AIS gap within 6h.',
  },
  {
    from: 'chain-x', to: 'chain-y', kind: 'causal',
    rationale: 'S8 — the real first link of the mediated chain.',
  },
  {
    from: 'chain-y', to: 'chain-z', kind: 'causal',
    rationale: 'S8 — the real second link of the mediated chain.',
  },
  {
    from: 'chain-x', to: 'chain-z', kind: 'mediated',
    rationale: 'S8 — significant only through chain-y; ACC-503 must filter it.',
  },
  {
    from: 'bursty-a', to: 'bursty-b', kind: 'confounded',
    rationale: 'S7 — co-fired by a hidden driver; ACC-504 must filter it.',
  },
  {
    from: 'bursty-b', to: 'bursty-a', kind: 'confounded',
    rationale: 'S7 — the reverse direction of the same burst artefact.',
  },
  {
    from: 'macro-quiet', to: 'newswire', kind: 'independent',
    rationale: 'S6 — the base-rate trap; significance here means the miner regressed to counting.',
  },
  {
    from: 'radiation', to: 'pharma', kind: 'independent',
    rationale: 'S5 — anti-phased beyond the widest mining window.',
  },
  {
    from: 'pharma', to: 'radiation', kind: 'independent',
    rationale: 'S5 — the reverse direction, equally out of window.',
  },
  {
    from: 'calm-signal', to: 'escalation', kind: 'inhibitory',
    rationale: 'S9 — suppression, invisible to a lift-only miner; ACC-502 fills this slot.',
  },
];

// ── Derived accessors ───────────────────────────────────────────────────────

/** Every observation in the corpus, time-sorted (ties broken by id so the
 *  ordering is total and stable across engines). */
export function allGoldenObservations(): ObservationEvent[] {
  return GOLDEN_STREAMS
    .flatMap((s) => [...s.observations])
    .sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : 1));
}

/** Event-level pairs a correct built-in rule set should emit. */
export function plantedTruePairKeys(): Set<string> {
  return new Set(GOLDEN_STREAMS.flatMap((s) => [...s.truePairKeys]));
}

/**
 * Every domain the corpus actually contains.
 *
 * The lead-lag miner only ever names domains it observed, so an edge row
 * pointing at anything else did not come from this corpus — and an endpoint the
 * planted index does not know grades as `unplanted`, which is exactly the
 * verdict a fabricated name wants.
 */
export function corpusDomains(): Set<string> {
  return new Set(GOLDEN_STREAMS.flatMap((s) => s.observations.map((o) => o.domain)));
}

/** Events that must never appear in any emitted pair. */
export function decoyEventIds(): Set<string> {
  return new Set(GOLDEN_STREAMS.flatMap((s) => [...s.decoyEventIds]));
}

/** Planted couplings keyed `from->to` for O(1) lookup while grading edges. */
export function plantedCouplingIndex(): Map<string, PlantedCoupling> {
  return new Map(PLANTED_COUPLINGS.map((c) => [`${c.from}->${c.to}`, c]));
}

/**
 * Content digest over every byte of the corpus that can change a benchmark
 * number: each observation's identity/time/domain/type/severity/position, and
 * all three layers of planted truth.
 *
 * Counting streams and observations is NOT corpus identity. Timestamps,
 * domains, decoy labels, and planted-coupling kinds can all be edited while the
 * counts hold steady, which is exactly how someone quietly makes the corpus
 * easier and reports the resulting numbers as an improvement. The digest makes
 * that impossible: any edit to the fixture invalidates the baseline and forces
 * a deliberate re-seed.
 *
 * FNV-1a rather than a crypto hash because this module must stay importable in
 * the renderer bundle (no `node:crypto`). It runs at 128 bits, not 32: a 32-bit
 * digest is brute-forceable in seconds, and a review of this file found a live
 * preimage — swapping a decoy id for a 7-character string reproduced the
 * committed digest exactly, so the corpus could be edited without invalidating
 * the baseline. 128 bits puts that out of reach, which matters because the
 * digest is the ONLY thing standing between "the fixture got easier" and "the
 * numbers improved". Records are LENGTH-PREFIXED rather than separator-joined —
 * see `eat` for the regrouping collision that separators leave open at any
 * width.
 */
const FNV_OFFSET_128 = 0x6C_62_27_2E_07_BB_01_42_62_B8_21_75_62_95_C5_8Dn;
const FNV_PRIME_128 = 0x00_00_00_00_01_00_00_00_00_00_00_00_00_00_01_3Bn;
const MASK_128 = (1n << 128n) - 1n;
/** Code-unit order, not locale order: the digest must not move with the host locale. */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The framing itself, exported so the unique-decodability property can be
 * tested directly. `digestRecords(['a', 'b'])` must not equal
 * `digestRecords(['a_b'])` — that inequality is the whole point of
 * length-prefixing, and it is invisible from the corpus-level digest.
 */
export function digestRecords(records: Iterable<string>): string {
  let h = FNV_OFFSET_128;
  const eat = (s: string): void => {
    // LENGTH-PREFIXED framing, not a trailing separator byte. A separator is
    // just another code unit, so hashing `decoy:first` then `decoy:second` with
    // a `_` between them reaches exactly the state of hashing the single record
    // `decoy:first_decoy:second` — two real decoy ids could be replaced by one
    // synthetic id, removing both traps from grading, without moving the digest.
    // Prefixing each record with its length makes the ENCODING uniquely
    // decodable: the mixed sequence parses back to exactly one grouping, so a
    // regrouping is no longer free. That is a property of the framing, not of
    // the hash — this is a custom FNV-like recurrence over UTF-16 code units,
    // not a cryptographic digest, so it is not collision-RESISTANT and no
    // claim here should be read as "collisions are impossible".
    h = ((h ^ BigInt(s.length)) * FNV_PRIME_128) & MASK_128;
    // charCodeAt, not codePointAt: this loop advances one code UNIT at a time,
    // so codePointAt would read a surrogate pair whole at the lead and then the
    // trail again on its own — the same bytes hashed inconsistently.
    for (let i = 0; i < s.length; i++) {
      // eslint-disable-next-line unicorn/prefer-code-point
      h = ((h ^ BigInt(s.charCodeAt(i))) * FNV_PRIME_128) & MASK_128;
    }
  };

  for (const r of records) eat(r);
  return h.toString(16).padStart(32, '0');
}

export function goldenCorpusDigest(): string {
  const records: string[] = [];
  // JSON.stringify, not template joins: `['a','b']` and `['a,b']` flatten to the
  // same delimited string, so a join-based digest lets an edit move content
  // across an array boundary without moving the hash. JSON quotes and escapes
  // every element, so the array shape is part of the hashed bytes.
  for (const o of allGoldenObservations()) {
    records.push(JSON.stringify([
      o.id, o.timestamp, o.domain, o.sourceId, o.severity,
      o.location?.lat ?? null, o.location?.lon ?? null,
      o.entityIds, o.tags,
    ]));
  }
  for (const c of PLANTED_COUPLINGS) records.push(JSON.stringify([c.from, c.to, c.kind]));
  // Set iteration order is insertion order, which an unrelated fixture edit can
  // reshuffle without changing the CONTENT — sort so the digest tracks the
  // truth labels themselves, not the order they happened to be declared in.
  for (const k of [...plantedTruePairKeys()].sort(byCodeUnit)) records.push(`true:${k}`);
  for (const id of [...decoyEventIds()].sort(byCodeUnit)) records.push(`decoy:${id}`);

  return digestRecords(records);
}
