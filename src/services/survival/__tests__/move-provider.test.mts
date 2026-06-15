// src/services/survival/__tests__/move-provider.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWeatherMoveProvider } from '../weather-move-provider.ts';
import { availableMovesFrom } from '../survival-moves.ts';
import type { MoveProvider } from '../move-provider.ts';
import { computePosture } from '../survival-posture.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';
import type { SurvivalMove, SurvivalPosture } from '../survival-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}

function tornadoPosture(): SurvivalPosture {
  const alerts: NwsAlertMinimal[] = [{
    id: 'al-t',
    event: 'Tornado Warning',
    polygon: around(HOME.lat, HOME.lon),
    sent: new Date(NOW - 60_000).toISOString(),
    expires: new Date(NOW + 3_600_000).toISOString(),
  }];
  const freshness = [{ domain: 'weather' as const, fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok: true }];
  return computePosture({ weatherAlerts: alerts, savedPlaces: [HOME], freshness, capturedAtMs: NOW }, { now: NOW });
}

// ── weather provider ──────────────────────────────────────────────────────────

test('weather provider: produces moves for tornado-threatened posture', () => {
  const posture = tornadoPosture();
  const provider = makeWeatherMoveProvider();
  const moves = provider.provide(posture, NOW);

  assert.equal(provider.id, 'weather');
  assert.ok(moves.length >= 1, 'expected at least one move');
  assert.ok(moves.every((m) => m.affects.includes('physical_safety')));
  assert.ok(moves.every((m) => m.effect.some((d) => d.axis === 'physical_safety' && d.deltaLevel < 0)));
  assert.ok(moves[0]!.playbookRef);
});

test('weather provider: no moves when physical_safety has no threats', () => {
  const posture = tornadoPosture();
  const calm: SurvivalPosture = {
    ...posture,
    axes: posture.axes.map((a) => ({ ...a, threats: [], level: 0, band: 'secure' as const })),
  };
  const provider = makeWeatherMoveProvider();
  assert.deepEqual(provider.provide(calm, NOW), []);
});

test('weather provider: respects maxMoves option', () => {
  const posture = tornadoPosture();
  const provider = makeWeatherMoveProvider({ maxMoves: 2 });
  const moves = provider.provide(posture, NOW);
  assert.ok(moves.length <= 2);
});

// ── availableMovesFrom aggregation ───────────────────────────────────────────

test('availableMovesFrom: aggregates weather + fake supply provider', () => {
  const posture = tornadoPosture();

  const supplyMove: SurvivalMove = {
    id: 'move-supply-water',
    label: 'Fill water containers',
    detail: 'Fill bathtub and containers before potential utility disruption',
    affects: ['supply'],
    cost: 'low',
    leadTimeMins: 5,
    trigger: 'Supply disruption risk',
    effect: [{ axis: 'supply', deltaLevel: -15, rationale: 'Water reserves reduce supply risk' }],
    playbookRef: 'supply-water',
  };

  const fakeSupplyProvider: MoveProvider = {
    id: 'supply',
    provide: () => [supplyMove],
  };

  const weatherProvider = makeWeatherMoveProvider();
  const moves = availableMovesFrom([weatherProvider, fakeSupplyProvider], posture, NOW);

  const weatherMoves = moves.filter((m) => m.affects.includes('physical_safety') && !m.affects.includes('supply'));
  const supplyMoves = moves.filter((m) => m.id === 'move-supply-water');

  assert.ok(weatherMoves.length >= 1, 'weather moves should be present');
  assert.equal(supplyMoves.length, 1, 'supply move should be present');
  assert.ok(moves.length >= 2, 'combined list should have both providers');

  // weather moves still affect physical_safety with negative delta
  assert.ok(weatherMoves.every((m) => m.effect.some((d) => d.axis === 'physical_safety' && d.deltaLevel < 0)));
});

test('availableMovesFrom: empty providers list returns empty array', () => {
  const posture = tornadoPosture();
  assert.deepEqual(availableMovesFrom([], posture, NOW), []);
});

test('availableMovesFrom: provider returning no moves is a no-op', () => {
  const posture = tornadoPosture();
  const silentProvider: MoveProvider = { id: 'silent', provide: () => [] };
  const weatherProvider = makeWeatherMoveProvider();
  const moves = availableMovesFrom([silentProvider, weatherProvider], posture, NOW);
  const direct = weatherProvider.provide(posture, NOW);
  assert.deepEqual(moves, direct);
});
