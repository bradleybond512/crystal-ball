import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSupplyContributor } from '../supply-contributor.ts';
import { makeSupplyMoveProvider } from '../supply-move-provider.ts';
import { makeWeatherContributor } from '../weather-contributor.ts';
import { computeMultiAxisPosture, type MultiAxisInput } from '../survival-posture.ts';
import { availableMoves } from '../survival-moves.ts';
import { supplyContributorForBase, shortageCacheAction } from '../storm-posture-state.ts';
import type { ShortageSummaryEntry } from '../../shortage/shortage-fullset.ts';
import type { ShortageForecast } from '../../shortage/shortage-types.ts';
import type { WorldSnapshot } from '../survival-types.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;

function forecast(commodity: string, riskScore: number, confidence: ShortageForecast['confidence']): ShortageForecast {
  return {
    commodity,
    domain: 'energy',
    region: 'global',
    horizonDays: 30,
    riskScore,
    confidence,
    drivers: [],
    confirmingIndicators: [],
    invalidatingIndicators: [],
    dataGaps: [],
    lastUpdated: new Date(NOW).toISOString(),
  };
}

function entry(
  commodity: ShortageSummaryEntry['commodity'],
  riskScore: number,
  riskLevel: ShortageSummaryEntry['riskLevel'],
  confidence: ShortageForecast['confidence'] = 'medium',
  drivers: string[] = [],
): ShortageSummaryEntry {
  return {
    commodity,
    riskScore,
    riskLevel,
    primaryDrivers: drivers,
    timeToImpact: '≤30 days',
    trend: 'stable',
    forecast: forecast(commodity, riskScore, confidence),
  };
}

const fresh = [{ domain: 'weather' as const, fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok: true }];

// ── Weather fixtures (mirror posture-contributor.test) ──────────────────────
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
const TORNADO: NwsAlertMinimal = {
  id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon),
  sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString(),
};

// ── Supply contributor ──────────────────────────────────────────────────────

test('CRITICAL diesel entry -> a supply threat (severity~=risk, emergency, Diesel shortage)', () => {
  const c = makeSupplyContributor([
    entry('diesel', 82, 'CRITICAL', 'high', ['Distillate inventories below 5-year range']),
  ]);
  const threats = c.contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'supply');
  assert.equal(t.severity, 82);
  assert.equal(t.threatLevel, 'emergency');
  assert.equal(t.hazardKind, 'other');
  assert.equal(t.hazardLabel, 'Diesel shortage');
  assert.equal(t.sourceEventId, 'shortage-diesel');
  assert.equal(t.confidenceLabel, 'high');
  assert.equal(t.why, 'Distillate inventories below 5-year range');
  assert.equal(t.timeToImpactMins, null);
});

test('multi-word commodity titlecases the label (natural-gas -> Natural gas shortage)', () => {
  const c = makeSupplyContributor([entry('natural-gas', 55, 'HIGH')]);
  const t = c.contribute(NOW)[0]!;
  assert.equal(t.hazardLabel, 'Natural gas shortage');
  assert.equal(t.threatLevel, 'warning');
});

test('LOW entry produces no threat', () => {
  const c = makeSupplyContributor([entry('wheat', 12, 'LOW')]);
  assert.equal(c.contribute(NOW).length, 0);
});

test('threat level + clamp mapping across risk levels', () => {
  const c = makeSupplyContributor([
    entry('corn', 120, 'CRITICAL'),
    entry('rice', 30, 'MODERATE'),
    entry('crude', 5, 'LOW'),
  ]);
  const threats = c.contribute(NOW);
  assert.equal(threats.length, 2); // LOW filtered
  const corn = threats.find((t) => t.sourceEventId === 'shortage-corn')!;
  assert.equal(corn.severity, 100); // clamped
  assert.equal(corn.threatLevel, 'emergency');
  const rice = threats.find((t) => t.sourceEventId === 'shortage-rice')!;
  assert.equal(rice.threatLevel, 'advisory');
});

// ── Multi-axis posture: weather + supply ─────────────────────────────────────

test('weather + supply contributors populate both axes; worst axis wins by severity', () => {
  const input: MultiAxisInput = {
    contributors: [
      makeWeatherContributor([TORNADO], [HOME]),
      makeSupplyContributor([entry('diesel', 60, 'HIGH')]),
    ],
    freshness: fresh, capturedAtMs: NOW,
  };
  const p = computeMultiAxisPosture(input, { now: NOW });
  const physical = p.axes.find((a) => a.axis === 'physical_safety')!;
  const supply = p.axes.find((a) => a.axis === 'supply')!;
  assert.ok(physical.threats.length > 0);
  assert.equal(supply.level, 60);
  assert.equal(physical.band, 'critical');
  assert.equal(p.worstAxis, 'physical_safety'); // tornado 95 > supply 60
});

test('supply dominates when its severity exceeds weather', () => {
  // No weather threat -> supply is the only loaded axis -> worst axis is supply.
  const input: MultiAxisInput = {
    contributors: [
      makeWeatherContributor([], [HOME]),
      makeSupplyContributor([entry('diesel', 88, 'CRITICAL')]),
    ],
    freshness: fresh, capturedAtMs: NOW,
  };
  const p = computeMultiAxisPosture(input, { now: NOW });
  assert.equal(p.worstAxis, 'supply');
  assert.equal(p.overallLevel, 88);
  assert.equal(p.overallBand, 'critical');
});

// ── Supply move provider ─────────────────────────────────────────────────────

test('supply move provider returns supply moves when supply is threatened', () => {
  const posture = computeMultiAxisPosture({
    contributors: [makeSupplyContributor([entry('diesel', 70, 'HIGH', 'medium', ['inventory below floor'])])],
    freshness: fresh, capturedAtMs: NOW,
  }, { now: NOW });

  const moves = makeSupplyMoveProvider().provide(posture, NOW);
  assert.ok(moves.length >= 3);
  for (const m of moves) {
    assert.deepEqual(m.affects, ['supply']);
    assert.equal(m.effect.length, 1);
    assert.equal(m.effect[0]!.axis, 'supply');
    assert.ok(m.effect[0]!.deltaLevel < 0); // improves posture
    assert.ok(m.trigger.includes('Diesel shortage'));
    assert.ok(m.playbookRef);
  }
});

test('supply move provider returns [] when supply has no threats', () => {
  const posture = computeMultiAxisPosture({
    contributors: [makeSupplyContributor([entry('wheat', 10, 'LOW')])],
    freshness: fresh, capturedAtMs: NOW,
  }, { now: NOW });
  assert.deepEqual(makeSupplyMoveProvider().provide(posture, NOW), []);
});

// ── availableMoves combines weather + supply providers ───────────────────────

function snapshotFor(posture: ReturnType<typeof computeMultiAxisPosture>): WorldSnapshot {
  return {
    version: 1, capturedAtMs: NOW, freshness: fresh,
    weatherAlerts: [], savedPlaces: [HOME], posture, plan: { committed: [] },
  };
}

test('availableMoves offers supply moves when only supply is threatened', () => {
  const posture = computeMultiAxisPosture({
    contributors: [
      makeWeatherContributor([], [HOME]),
      makeSupplyContributor([entry('diesel', 70, 'HIGH', 'medium', ['inventory below floor'])]),
    ],
    freshness: fresh, capturedAtMs: NOW,
  }, { now: NOW });

  const moves = availableMoves(posture, snapshotFor(posture), { now: NOW });
  const supplyMoves = moves.filter((m) => m.affects.includes('supply'));
  const weatherMoves = moves.filter((m) => m.affects.includes('physical_safety'));
  assert.ok(supplyMoves.length >= 3, 'supply moves offered');
  assert.equal(weatherMoves.length, 0, 'no weather moves without a weather threat');
});

test('availableMoves offers both weather and supply moves for a combined posture', () => {
  const posture = computeMultiAxisPosture({
    contributors: [
      makeWeatherContributor([TORNADO], [HOME]),
      makeSupplyContributor([entry('diesel', 70, 'HIGH', 'medium', ['inventory below floor'])]),
    ],
    freshness: fresh, capturedAtMs: NOW,
  }, { now: NOW });

  const moves = availableMoves(posture, snapshotFor(posture), { now: NOW });
  assert.ok(moves.some((m) => m.affects.includes('physical_safety')), 'weather moves offered');
  assert.ok(moves.some((m) => m.affects.includes('supply')), 'supply moves offered');
});

// ── Cold-cache fallback (grid-down cold start) ────────────────────────────────
// Tested via the exported `supplyContributorForBase`. On a fresh module import
// the module-private shortage cache is uninitialized (hasShortageCache === false),
// which is exactly the grid-down cold-start state after hydrateStormPosture():
// `current` holds a persisted supply threat but no live refresh has run yet.

test('cold cache: supplyContributorForBase preserves the snapshot\'s persisted supply threat', () => {
  // A snapshot that already carries a supply threat (e.g. hydrated from disk).
  const hydratedPosture = computeMultiAxisPosture({
    contributors: [makeSupplyContributor([entry('diesel', 77, 'CRITICAL', 'high', ['Distillate inventories below 5-year range'])])],
    freshness: fresh, capturedAtMs: NOW,
  }, { now: NOW });
  const snapshot: WorldSnapshot = {
    version: 1, capturedAtMs: NOW, freshness: fresh,
    weatherAlerts: [], savedPlaces: [HOME], posture: hydratedPosture, plan: { committed: [] },
  };

  // Cache cold -> contributor falls back to the snapshot's existing supply threats.
  const contributor = supplyContributorForBase(snapshot);
  const threats = contributor.contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.sourceEventId, 'shortage-diesel');
  assert.equal(threats[0]!.severity, 77);
  assert.equal(threats[0]!.axis, 'supply');
});

test('cold cache: recomputing posture with the fallback keeps the supply axis (not cleared by [])', () => {
  // Reproduce the commitStormMove recompute: rebuild posture from weather + the
  // cold-cache supply contributor. Without the fix this used makeSupplyContributor([])
  // and dropped the supply axis to level 0.
  const hydratedPosture = computeMultiAxisPosture({
    contributors: [makeSupplyContributor([entry('diesel', 77, 'CRITICAL', 'high', ['inventory below floor'])])],
    freshness: fresh, capturedAtMs: NOW,
  }, { now: NOW });
  const snapshot: WorldSnapshot = {
    version: 1, capturedAtMs: NOW, freshness: fresh,
    weatherAlerts: [], savedPlaces: [HOME], posture: hydratedPosture, plan: { committed: [] },
  };

  const rebuilt = computeMultiAxisPosture({
    contributors: [
      makeWeatherContributor(snapshot.weatherAlerts, snapshot.savedPlaces),
      supplyContributorForBase(snapshot),
    ],
    freshness: snapshot.freshness, capturedAtMs: snapshot.capturedAtMs,
  }, { now: NOW });

  const supply = rebuilt.axes.find((a) => a.axis === 'supply')!;
  assert.equal(supply.level, 77, 'supply axis preserved through cold-cache recompute');
  assert.equal(supply.threats.length, 1);
  assert.equal(supply.threats[0]!.sourceEventId, 'shortage-diesel');
});

test('cold cache: empty base yields no supply threats (no crash, no phantom axis)', () => {
  const contributor = supplyContributorForBase(null);
  assert.deepEqual(contributor.contribute(NOW), []);
});

// ── Fail-closed shortage cache (a dead feed must not clear a known risk) ──────
// Each shortage feed (drought / grid / chokepoint) reports its own health, so
// `shortageCacheAction(gotAnyFeed, allFeedsOk, hasCache)` distinguishes a full
// refresh from partial and total outages: 'replace' (all feeds healthy →
// authoritative), 'merge' (partial outage + warm cache → keep cached entries for
// the dead feed's commodities, refresh the rest), 'keep' (total outage + warm
// cache → preserve prior risk), 'passthrough' (cold start under anything short of
// a clean refresh → baseline but NOT authoritative, so the hydrated fallback wins).

test('healthy refresh always replaces, regardless of prior cache', () => {
  assert.equal(shortageCacheAction(true, true, true), 'replace');
  assert.equal(shortageCacheAction(true, true, false), 'replace');
});

test('partial outage + warm cache: merge (keep dead-feed commodities, refresh rest)', () => {
  assert.equal(shortageCacheAction(true, false, true), 'merge');
});

test('total outage + warm cache: keep prior cache (preserve known risk)', () => {
  assert.equal(shortageCacheAction(false, false, true), 'keep');
});

test('cold start under an incomplete refresh: passthrough (do NOT become authoritative)', () => {
  // No prior cache: a hydrated snapshot's supply threat must survive, so neither a
  // total outage nor a partial refresh may seed the cache (only allFeedsOk does).
  assert.equal(shortageCacheAction(false, false, false), 'passthrough');
  assert.equal(shortageCacheAction(true, false, false), 'passthrough');
});
