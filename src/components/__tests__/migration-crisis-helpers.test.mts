import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreDisplacementRisk,
  computeFlowVolume,
  categorizeMigrant,
  assessHostCapacity,
  detectCrisisHotspots,
  estimatePushFactors,
  rankRoutesByRisk,
  rankEventsByScale,
  buildRenderData,
  type MigrationRoute,
  type DisplacementEvent,
  type HostCapacityData,
} from '../migration-crisis-helpers.js';

// ── scoreDisplacementRisk ────────────────────────────────────────────────────

describe('scoreDisplacementRisk', () => {
  test('conflict + increasing trend raises score', () => {
    const e: DisplacementEvent = { region: 'X', displacedCount: 1000000, pushFactor: 'conflict', date: '2026-01-01', trend: 'increasing' };
    const score = scoreDisplacementRisk(e);
    assert.ok(score > 0 && score <= 100, `score out of range: ${score}`);
  });

  test('decreasing trend lowers score vs stable', () => {
    const base: DisplacementEvent = { region: 'X', displacedCount: 500000, pushFactor: 'conflict', date: '2026-01-01', trend: 'stable' };
    const dec: DisplacementEvent = { ...base, trend: 'decreasing' };
    assert.ok(scoreDisplacementRisk(dec) < scoreDisplacementRisk(base));
  });

  test('increasing trend raises score vs stable', () => {
    const base: DisplacementEvent = { region: 'X', displacedCount: 500000, pushFactor: 'conflict', date: '2026-01-01', trend: 'stable' };
    const inc: DisplacementEvent = { ...base, trend: 'increasing' };
    assert.ok(scoreDisplacementRisk(inc) > scoreDisplacementRisk(base));
  });

  test('conflict outweighs natural-disaster at same displacement count', () => {
    const conflict: DisplacementEvent = { region: 'X', displacedCount: 100000, pushFactor: 'conflict', date: '2026-01-01', trend: 'stable' };
    const natdis: DisplacementEvent = { ...conflict, pushFactor: 'natural-disaster' };
    assert.ok(scoreDisplacementRisk(conflict) > scoreDisplacementRisk(natdis));
  });

  test('score is clamped to [0, 100]', () => {
    const huge: DisplacementEvent = { region: 'X', displacedCount: 999999999, pushFactor: 'conflict', date: '2026-01-01', trend: 'increasing' };
    assert.equal(scoreDisplacementRisk(huge), 100);
  });

  test('zero displaced with decreasing does not go below 0', () => {
    const zero: DisplacementEvent = { region: 'X', displacedCount: 0, pushFactor: 'natural-disaster', date: '2026-01-01', trend: 'decreasing' };
    assert.ok(scoreDisplacementRisk(zero) >= 0);
  });

  test('persecution factor scores between conflict and climate', () => {
    const mkEvent = (f: DisplacementEvent['pushFactor']): DisplacementEvent =>
      ({ region: 'X', displacedCount: 100000, pushFactor: f, date: '2026-01-01', trend: 'stable' });
    assert.ok(scoreDisplacementRisk(mkEvent('persecution')) < scoreDisplacementRisk(mkEvent('conflict')));
    assert.ok(scoreDisplacementRisk(mkEvent('persecution')) > scoreDisplacementRisk(mkEvent('climate')));
  });

  test('returns integer', () => {
    const e: DisplacementEvent = { region: 'X', displacedCount: 3333333, pushFactor: 'economic', date: '2026-01-01', trend: 'stable' };
    assert.equal(scoreDisplacementRisk(e), Math.round(scoreDisplacementRisk(e)));
  });
});

// ── computeFlowVolume ────────────────────────────────────────────────────────

describe('computeFlowVolume', () => {
  const r = (flow: number): MigrationRoute => ({
    id: 'r', origin: 'A', destination: 'B', monthlyFlow: flow, primaryPushFactor: 'conflict', routeRiskLevel: 50,
  });

  test('single route, 1 month', () => {
    assert.equal(computeFlowVolume([r(1000)], 1), 1000);
  });

  test('multiple routes, 3 months', () => {
    assert.equal(computeFlowVolume([r(1000), r(2000)], 3), 9000);
  });

  test('empty routes returns 0', () => {
    assert.equal(computeFlowVolume([], 12), 0);
  });

  test('zero months returns 0', () => {
    assert.equal(computeFlowVolume([r(5000)], 0), 0);
  });

  test('scales linearly with time window', () => {
    const routes = [r(500), r(1500)];
    assert.equal(computeFlowVolume(routes, 6), computeFlowVolume(routes, 3) * 2);
  });
});

// ── categorizeMigrant ────────────────────────────────────────────────────────

describe('categorizeMigrant', () => {
  test('conflict → refugee', () => assert.equal(categorizeMigrant('conflict'), 'refugee'));
  test('persecution → asylum-seeker', () => assert.equal(categorizeMigrant('persecution'), 'asylum-seeker'));
  test('economic → economic', () => assert.equal(categorizeMigrant('economic'), 'economic'));
  test('climate → climate-displaced', () => assert.equal(categorizeMigrant('climate'), 'climate-displaced'));
  test('natural-disaster → climate-displaced', () => assert.equal(categorizeMigrant('natural-disaster'), 'climate-displaced'));
});

// ── assessHostCapacity ───────────────────────────────────────────────────────

describe('assessHostCapacity', () => {
  const cap = (arrivals: number, max: number): HostCapacityData =>
    ({ country: 'X', currentArrivals: arrivals, maxCapacity: max, strainIndex: 0 });

  test('90% utilization → critical', () => assert.equal(assessHostCapacity(cap(9000, 10000)), 'critical'));
  test('100% utilization → critical', () => assert.equal(assessHostCapacity(cap(10000, 10000)), 'critical'));
  test('70% utilization → high', () => assert.equal(assessHostCapacity(cap(7000, 10000)), 'high'));
  test('80% utilization → high', () => assert.equal(assessHostCapacity(cap(8000, 10000)), 'high'));
  test('40% utilization → medium', () => assert.equal(assessHostCapacity(cap(4000, 10000)), 'medium'));
  test('60% utilization → medium', () => assert.equal(assessHostCapacity(cap(6000, 10000)), 'medium'));
  test('10% utilization → low', () => assert.equal(assessHostCapacity(cap(1000, 10000)), 'low'));
  test('0% utilization → low', () => assert.equal(assessHostCapacity(cap(0, 10000)), 'low'));
});

// ── detectCrisisHotspots ─────────────────────────────────────────────────────

describe('detectCrisisHotspots', () => {
  const mkRoute = (id: string, flow: number): MigrationRoute =>
    ({ id, origin: 'A', destination: 'B', monthlyFlow: flow, primaryPushFactor: 'conflict', routeRiskLevel: 50 });

  test('returns routes above 2x average by default', () => {
    const routes = [mkRoute('a', 100), mkRoute('b', 100), mkRoute('c', 500)];
    // avg = 233.3, 2x = 466.7 → only 'c' qualifies
    const hotspots = detectCrisisHotspots(routes);
    assert.equal(hotspots.length, 1);
    assert.equal(hotspots[0].id, 'c');
  });

  test('empty routes returns empty', () => {
    assert.deepEqual(detectCrisisHotspots([]), []);
  });

  test('custom multiplier respected', () => {
    const routes = [mkRoute('a', 100), mkRoute('b', 250)];
    // avg = 175, 1x = 175 → 'b' qualifies at multiplier 1
    const hotspots = detectCrisisHotspots(routes, 1);
    assert.equal(hotspots.length, 1);
    assert.equal(hotspots[0].id, 'b');
  });

  test('does not mutate input array', () => {
    const routes = [mkRoute('a', 1000), mkRoute('b', 100)];
    const copy = [...routes];
    detectCrisisHotspots(routes);
    assert.deepEqual(routes, copy);
  });

  test('all equal flows returns empty (none exceed 2x avg)', () => {
    const routes = [mkRoute('a', 100), mkRoute('b', 100), mkRoute('c', 100)];
    assert.equal(detectCrisisHotspots(routes).length, 0);
  });
});

// ── estimatePushFactors ──────────────────────────────────────────────────────

describe('estimatePushFactors', () => {
  test('sums correctly by factor', () => {
    const events: DisplacementEvent[] = [
      { region: 'A', displacedCount: 1000, pushFactor: 'conflict', date: '2026-01-01', trend: 'stable' },
      { region: 'B', displacedCount: 2000, pushFactor: 'conflict', date: '2026-01-01', trend: 'stable' },
      { region: 'C', displacedCount: 500, pushFactor: 'economic', date: '2026-01-01', trend: 'stable' },
    ];
    const totals = estimatePushFactors(events);
    assert.equal(totals.conflict, 3000);
    assert.equal(totals.economic, 500);
    assert.equal(totals.climate, 0);
  });

  test('empty events returns all zeros', () => {
    const totals = estimatePushFactors([]);
    assert.equal(totals.conflict, 0);
    assert.equal(totals.climate, 0);
    assert.equal(totals.economic, 0);
    assert.equal(totals.persecution, 0);
    assert.equal(totals['natural-disaster'], 0);
  });

  test('all five factors present', () => {
    const factors = ['conflict', 'climate', 'economic', 'persecution', 'natural-disaster'] as const;
    const events: DisplacementEvent[] = factors.map((f, i) => ({
      region: String(i), displacedCount: 100, pushFactor: f, date: '2026-01-01', trend: 'stable',
    }));
    const totals = estimatePushFactors(events);
    for (const f of factors) assert.equal(totals[f], 100);
  });
});

// ── rankRoutesByRisk ─────────────────────────────────────────────────────────

describe('rankRoutesByRisk', () => {
  const mkRoute = (id: string, risk: number): MigrationRoute =>
    ({ id, origin: 'A', destination: 'B', monthlyFlow: 1000, primaryPushFactor: 'conflict', routeRiskLevel: risk });

  test('sorts descending by routeRiskLevel', () => {
    const routes = [mkRoute('a', 30), mkRoute('b', 90), mkRoute('c', 60)];
    const ranked = rankRoutesByRisk(routes);
    assert.equal(ranked[0].id, 'b');
    assert.equal(ranked[1].id, 'c');
    assert.equal(ranked[2].id, 'a');
  });

  test('does not mutate original array', () => {
    const routes = [mkRoute('a', 50), mkRoute('b', 80)];
    const original = [...routes];
    rankRoutesByRisk(routes);
    assert.deepEqual(routes, original);
  });

  test('empty array returns empty', () => {
    assert.deepEqual(rankRoutesByRisk([]), []);
  });

  test('single element returns same element', () => {
    const routes = [mkRoute('solo', 75)];
    assert.deepEqual(rankRoutesByRisk(routes), routes);
  });
});

// ── rankEventsByScale ────────────────────────────────────────────────────────

describe('rankEventsByScale', () => {
  const mkEvent = (region: string, count: number): DisplacementEvent =>
    ({ region, displacedCount: count, pushFactor: 'conflict', date: '2026-01-01', trend: 'stable' });

  test('sorts descending by displacedCount', () => {
    const events = [mkEvent('A', 1000), mkEvent('B', 5000), mkEvent('C', 3000)];
    const ranked = rankEventsByScale(events);
    assert.equal(ranked[0].region, 'B');
    assert.equal(ranked[1].region, 'C');
    assert.equal(ranked[2].region, 'A');
  });

  test('does not mutate original array', () => {
    const events = [mkEvent('X', 100), mkEvent('Y', 200)];
    const original = [...events];
    rankEventsByScale(events);
    assert.deepEqual(events, original);
  });

  test('empty returns empty', () => {
    assert.deepEqual(rankEventsByScale([]), []);
  });
});

// ── buildRenderData ──────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  test('returns all expected keys', () => {
    const data = buildRenderData();
    assert.ok('routes' in data);
    assert.ok('events' in data);
    assert.ok('totalDisplaced' in data);
    assert.ok('hotspots' in data);
    assert.ok('pushFactorTotals' in data);
  });

  test('routes are sorted descending by risk', () => {
    const { routes } = buildRenderData();
    for (let i = 1; i < routes.length; i++) {
      assert.ok(routes[i - 1].routeRiskLevel >= routes[i].routeRiskLevel);
    }
  });

  test('events are sorted descending by displaced count', () => {
    const { events } = buildRenderData();
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i - 1].displacedCount >= events[i].displacedCount);
    }
  });

  test('totalDisplaced matches sum of event counts', () => {
    const { events, totalDisplaced } = buildRenderData();
    const sum = events.reduce((s, e) => s + e.displacedCount, 0);
    assert.equal(totalDisplaced, sum);
  });

  test('hotspots is a non-empty subset of routes', () => {
    const { routes, hotspots } = buildRenderData();
    assert.ok(hotspots.length > 0);
    for (const h of hotspots) {
      assert.ok(routes.some(r => r.id === h.id));
    }
  });

  test('pushFactorTotals has all five keys', () => {
    const { pushFactorTotals } = buildRenderData();
    assert.ok('conflict' in pushFactorTotals);
    assert.ok('climate' in pushFactorTotals);
    assert.ok('economic' in pushFactorTotals);
    assert.ok('persecution' in pushFactorTotals);
    assert.ok('natural-disaster' in pushFactorTotals);
  });

  test('conflict is the dominant push factor in mock data', () => {
    const { pushFactorTotals } = buildRenderData();
    const max = Math.max(...Object.values(pushFactorTotals));
    assert.equal(pushFactorTotals.conflict, max);
  });
});
