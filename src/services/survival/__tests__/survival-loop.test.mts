// src/services/survival/__tests__/survival-loop.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../world-snapshot.ts';
import { availableMoves } from '../survival-moves.ts';
import { commitMove, applyPlanToPosture } from '../survival-plan.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}

test('FULL LOOP: tornado threatens posture -> committing moves improves it', () => {
  const alerts: NwsAlertMinimal[] = [{ id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() }];
  const snapshot = buildSnapshot({ weatherAlerts: alerts, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });

  // World threatens.
  assert.equal(snapshot.posture.overallBand, 'critical');
  const startLevel = snapshot.posture.overallLevel;

  // You plan and commit the top two moves.
  const moves = availableMoves(snapshot.posture, snapshot, { now: NOW });
  assert.ok(moves.length >= 2);
  let plan = snapshot.plan;
  plan = commitMove(plan, moves[0]!, NOW);
  plan = commitMove(plan, moves[1]!, NOW);

  // Posture responds.
  const improved = applyPlanToPosture(snapshot.posture, plan, moves);
  assert.ok(improved.overallLevel < startLevel, 'committing moves should lower threat exposure');
  const phys = improved.axes.find((a) => a.axis === 'physical_safety')!;
  assert.equal(phys.trend, 'improving');
});
