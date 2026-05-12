/**
 * Driver-based severity scorer for ObservationEvents.
 *
 * Replaces simple threshold math with evidence-weighted, domain-specific
 * scoring. Each domain defines a set of Drivers with weights that sum to 1.
 * The final driverScore (0–100) = sum(driver.weight × driver.value × direction_sign) × 100.
 *
 * Pure: no fetch, no DOM. Accepts optional ObservationGraph for the
 * evidence-connections driver.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type { ObservationGraph } from './observation-graph';

// ── Types ────────────────────────────────────────────────────────────────

export interface Driver {
  name: string;
  /** Fractional weight in the score formula (all drivers sum to 1.0). */
  weight: number;
  /** Normalized contribution in [0, 1]. */
  value: number;
  direction: 'amplifying' | 'mitigating';
}

export interface ScoredEvent extends ObservationEvent {
  driverScore: number;
  drivers: Driver[];
  scoreReason: string;
}

export interface ScorerOptions {
  graph?: ObservationGraph;
  /** Clock override for tests. */
  now?: () => number;
}

// ── Severity baseline mapping ─────────────────────────────────────────────

const SEVERITY_BASE: Record<ObservationSeverity, number> = {
  CRITICAL: 1,
  HIGH: 0.75,
  MEDIUM: 0.5,
  LOW: 0.25,
  INFO: 0.05,
};

// ── Recency helper ────────────────────────────────────────────────────────

function recencyValue(timestamp: number, nowMs: number): number {
  const ageMs = nowMs - timestamp;
  if (ageMs <= 5 * 60_000) return 1;
  if (ageMs <= 30 * 60_000) return 0.8;
  if (ageMs <= 2 * 60 * 60_000) return 0.5;
  if (ageMs <= 24 * 60 * 60_000) return 0.2;
  return 0.05;
}

// ── Raw-field extractors (safe — raw is unknown) ──────────────────────────

function numField(raw: unknown, ...keys: string[]): number | undefined {
  let obj: unknown = raw;
  for (const k of keys) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = (obj as Record<string, unknown>)[k];
  }
  return typeof obj === 'number' ? obj : undefined;
}

function strField(raw: unknown, ...keys: string[]): string | undefined {
  let obj: unknown = raw;
  for (const k of keys) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = (obj as Record<string, unknown>)[k];
  }
  return typeof obj === 'string' ? obj : undefined;
}

// ── Domain scorers ────────────────────────────────────────────────────────

function scoreEarthquake(event: ObservationEvent): Driver[] {
  const mag = numField(event.raw, 'mag') ?? numField(event.raw, 'properties', 'mag') ?? 0;
  const depth = numField(event.raw, 'depth') ?? numField(event.raw, 'geometry', 'coordinates', '2') ?? 30;
  const isAfterShock = event.tags.includes('aftershock') || strField(event.raw, 'properties', 'type') === 'quarry';

  // magnitude: 0 → 0, M5 → 0.5, M7 → 0.85, M9+ → 1.0
  const magValue = Math.min(1, Math.max(0, (mag - 2) / 7));
  // depth: <10km → 1.0 (shallow → more dangerous), else attenuates
  const depthValue = depth < 10 ? 1 : Math.max(0, 1 - (depth - 10) / 200);
  // population proximity: use severity as proxy when no geocoding
  const popValue = SEVERITY_BASE[event.severity] ?? 0.5;
  // aftershock pattern: reduces amplification (mitigating if aftershock)
  const aftershockValue = isAfterShock ? 0.5 : 0;

  return [
    { name: 'magnitude', weight: 0.4, value: magValue, direction: 'amplifying' },
    { name: 'shallow_depth', weight: 0.2, value: depthValue, direction: 'amplifying' },
    { name: 'population_proximity', weight: 0.25, value: popValue, direction: 'amplifying' },
    { name: 'aftershock_pattern', weight: 0.15, value: aftershockValue, direction: 'mitigating' },
  ];
}

function scoreWildfire(event: ObservationEvent): Driver[] {
  const acres = numField(event.raw, 'acres') ?? numField(event.raw, 'PercentContained') ?? 0;
  const containment = numField(event.raw, 'containment') ?? numField(event.raw, 'PercentContained') ?? 50;
  const windSpeed = numField(event.raw, 'windSpeed') ?? numField(event.raw, 'wind_speed') ?? 0;
  const popValue = SEVERITY_BASE[event.severity] ?? 0.5;

  // acres: 0 → 0, 1000ac → 0.5, 10000+ → 1.0
  const acresValue = Math.min(1, acres / 10_000);
  // containment: 0% → 1.0 (worst), 100% → 0.0 (contained = no threat)
  const containValue = Math.max(0, 1 - containment / 100);
  // wind: 0mph → 0, 50mph → 1.0
  const windValue = Math.min(1, windSpeed / 50);

  return [
    { name: 'fire_acres', weight: 0.3, value: acresValue, direction: 'amplifying' },
    { name: 'containment_pct', weight: 0.25, value: containValue, direction: 'amplifying' },
    { name: 'wind_speed', weight: 0.2, value: windValue, direction: 'amplifying' },
    { name: 'proximity_populated', weight: 0.25, value: popValue, direction: 'amplifying' },
  ];
}

const SQUAWK_SEVERITY: Record<string, number> = {
  '7700': 1,  // general emergency
  '7600': 0.8,  // radio failure
  '7500': 1,  // hijack
  '7000': 0.1,  // VFR default
  '2000': 0.1,  // IFR default
};

const AIRCRAFT_RISK: Record<string, number> = {
  'B747': 0.9, 'B777': 0.9, 'A380': 0.9, 'B787': 0.8, 'A350': 0.8,
  'B737': 0.7, 'A320': 0.7, 'E175': 0.5, 'C172': 0.3,
};

function scoreAviation(event: ObservationEvent): Driver[] {
  const squawk = strField(event.raw, 'squawk') ?? strField(event.raw, 'properties', 'squawk') ?? '';
  const acType = strField(event.raw, 'aircraft_type') ?? strField(event.raw, 'icaoAircraftType') ?? '';
  const popValue = SEVERITY_BASE[event.severity] ?? 0.5;

  const squawkValue = SQUAWK_SEVERITY[squawk] ?? (squawk ? 0.3 : 0.1);
  const acValue = AIRCRAFT_RISK[acType] ?? 0.5;

  return [
    { name: 'squawk_severity', weight: 0.5, value: squawkValue, direction: 'amplifying' },
    { name: 'aircraft_type', weight: 0.2, value: acValue, direction: 'amplifying' },
    { name: 'location_risk', weight: 0.3, value: popValue, direction: 'amplifying' },
  ];
}

function scoreGeneric(event: ObservationEvent, evidenceValue: number, nowMs: number): Driver[] {
  const sevValue = SEVERITY_BASE[event.severity] ?? 0.1;
  const recValue = recencyValue(event.timestamp, nowMs);

  return [
    { name: 'raw_severity', weight: 0.6, value: sevValue, direction: 'amplifying' },
    { name: 'recency', weight: 0.2, value: recValue, direction: 'amplifying' },
    { name: 'evidence_connections', weight: 0.2, value: evidenceValue, direction: 'amplifying' },
  ];
}

// ── Domain detection ──────────────────────────────────────────────────────

function detectDomain(event: ObservationEvent): 'earthquake' | 'wildfire' | 'aviation' | 'generic' {
  const d = event.domain.toLowerCase();
  const tags = event.tags.map((t) => t.toLowerCase());
  if (d === 'seismic' || d === 'earthquake' || tags.includes('earthquake')) return 'earthquake';
  if (d === 'wildfire' || d === 'fire' || tags.some((t) => t.includes('fire') || t.includes('wildfire'))) return 'wildfire';
  if (d === 'aviation' || tags.includes('aviation') || tags.includes('flight-emergency')) return 'aviation';
  return 'generic';
}

// ── Score computation ─────────────────────────────────────────────────────

function computeScore(drivers: Driver[]): number {
  let score = 0;
  for (const d of drivers) {
    const sign = d.direction === 'amplifying' ? 1 : -1;
    score += d.weight * d.value * sign;
  }
  return Math.min(100, Math.max(0, Math.round(score * 100)));
}

function buildReason(drivers: Driver[], domain: string): string {
  const top = [...drivers]
    .filter((d) => d.direction === 'amplifying' && d.value > 0)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .slice(0, 2)
    .map((d) => `${d.name}=${(d.value * 100).toFixed(0)}%`)
    .join(', ');
  return `${domain}: ${top || 'base'}`;
}

// ── Public API ────────────────────────────────────────────────────────────

export function scoreEvent(event: ObservationEvent, opts: ScorerOptions = {}): ScoredEvent {
  const nowMs = opts.now ? opts.now() : Date.now();

  // Evidence connections: normalize edge count from graph (0 edges → 0, 10+ → 1.0)
  const edgeCount = opts.graph ? opts.graph.getEdges(event.id).length : 0;
  const evidenceValue = Math.min(1, edgeCount / 10);

  const domain = detectDomain(event);
  let drivers: Driver[];
  switch (domain) {
    case 'earthquake': { drivers = scoreEarthquake(event); break;
    }
    case 'wildfire': {   drivers = scoreWildfire(event); break;
    }
    case 'aviation': {   drivers = scoreAviation(event); break;
    }
    default: {           drivers = scoreGeneric(event, evidenceValue, nowMs);
    }
  }

  const driverScore = computeScore(drivers);

  return {
    ...event,
    driverScore,
    drivers,
    scoreReason: buildReason(drivers, domain),
  };
}

/** Score a batch of events. Preserves input order. */
export function scoreEvents(events: ObservationEvent[], opts: ScorerOptions = {}): ScoredEvent[] {
  return events.map((ev) => scoreEvent(ev, opts));
}
