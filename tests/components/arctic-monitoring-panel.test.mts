/**
 * Tests for ArcticMonitoringPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/arctic-monitoring-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  iceTrendColor,
  iceTrendLabel,
  anomalyColor,
  routeStatusColor,
  routeStatusLabel,
  legalStatusLabel,
  tensionColor,
  tensionLabel,
  activityTrendColor,
  activityTrendLabel,
  resourceTypeLabel,
  devStatusColor,
  devStatusLabel,
  envConcernColor,
  envConcernLabel,
  countHighTensionClaims,
  countIncreasingMilitary,
  countOpenRoutes,
  ICE_ENVIRONMENT,
  SHIPPING_ROUTES,
  TERRITORIAL_CLAIMS,
  MILITARY_POSTURE,
  RESOURCE_PROJECTS,
  type IceTrend,
  type RouteStatus,
  type TensionLevel,
  type ActivityTrend,
  type DevStatus,
  type EnvConcern,
  type TerritorialClaim,
  type MilitaryPosture,
  type ShippingRoute,
} from '../../src/components/arctic-monitoring-helpers.ts';

// ── iceTrendColor ─────────────────────────────────────────────────────────

test('iceTrendColor: declining returns red', () => {
  assert.ok(iceTrendColor('declining').includes('#ef4444'));
});

test('iceTrendColor: stable returns yellow', () => {
  assert.ok(iceTrendColor('stable').includes('#facc15'));
});

test('iceTrendColor: recovering returns green', () => {
  assert.ok(iceTrendColor('recovering').includes('#4caf50'));
});

test('iceTrendColor: all trends return non-empty strings', () => {
  const trends: IceTrend[] = ['declining', 'stable', 'recovering'];
  for (const t of trends) assert.ok(iceTrendColor(t).length > 0);
});

// ── iceTrendLabel ─────────────────────────────────────────────────────────

test('iceTrendLabel: declining returns "Declining"', () => {
  assert.equal(iceTrendLabel('declining'), 'Declining');
});

test('iceTrendLabel: recovering returns "Recovering"', () => {
  assert.equal(iceTrendLabel('recovering'), 'Recovering');
});

test('iceTrendLabel: all trends return non-empty strings', () => {
  const trends: IceTrend[] = ['declining', 'stable', 'recovering'];
  for (const t of trends) assert.ok(iceTrendLabel(t).length > 0);
});

// ── anomalyColor ──────────────────────────────────────────────────────────

test('anomalyColor: score >= 3 returns red', () => {
  assert.ok(anomalyColor(3).includes('#ef4444'));
  assert.ok(anomalyColor(4).includes('#ef4444'));
});

test('anomalyColor: score 2–2.9 returns orange', () => {
  assert.ok(anomalyColor(2).includes('#fb923c'));
});

test('anomalyColor: score 1–1.9 returns yellow', () => {
  assert.ok(anomalyColor(1).includes('#facc15'));
});

test('anomalyColor: score < 1 returns green', () => {
  assert.ok(anomalyColor(0).includes('#4caf50'));
});

// ── routeStatusColor ──────────────────────────────────────────────────────

test('routeStatusColor: open returns green', () => {
  assert.ok(routeStatusColor('open').includes('#4caf50'));
});

test('routeStatusColor: seasonal returns yellow', () => {
  assert.ok(routeStatusColor('seasonal').includes('#facc15'));
});

test('routeStatusColor: closed returns grey', () => {
  assert.ok(routeStatusColor('closed').includes('#9e9e9e'));
});

test('routeStatusColor: all statuses return non-empty strings', () => {
  const statuses: RouteStatus[] = ['open', 'seasonal', 'closed'];
  for (const s of statuses) assert.ok(routeStatusColor(s).length > 0);
});

// ── routeStatusLabel ──────────────────────────────────────────────────────

test('routeStatusLabel: open returns "Open"', () => {
  assert.equal(routeStatusLabel('open'), 'Open');
});

test('routeStatusLabel: closed returns "Closed"', () => {
  assert.equal(routeStatusLabel('closed'), 'Closed');
});

test('routeStatusLabel: seasonal returns "Seasonal"', () => {
  assert.equal(routeStatusLabel('seasonal'), 'Seasonal');
});

// ── legalStatusLabel ──────────────────────────────────────────────────────

test('legalStatusLabel: UNCLOS returns "UNCLOS"', () => {
  assert.equal(legalStatusLabel('UNCLOS'), 'UNCLOS');
});

test('legalStatusLabel: unresolved returns "Unresolved"', () => {
  assert.equal(legalStatusLabel('unresolved'), 'Unresolved');
});

test('legalStatusLabel: bilateral returns "Bilateral"', () => {
  assert.equal(legalStatusLabel('bilateral'), 'Bilateral');
});

test('legalStatusLabel: ICJ returns "ICJ"', () => {
  assert.equal(legalStatusLabel('ICJ'), 'ICJ');
});

// ── tensionColor ──────────────────────────────────────────────────────────

test('tensionColor: low returns green', () => {
  assert.ok(tensionColor('low').includes('#4caf50'));
});

test('tensionColor: critical returns red', () => {
  assert.ok(tensionColor('critical').includes('#ef4444'));
});

test('tensionColor: high returns orange', () => {
  assert.ok(tensionColor('high').includes('#fb923c'));
});

test('tensionColor: medium returns yellow', () => {
  assert.ok(tensionColor('medium').includes('#facc15'));
});

test('tensionColor: all levels return non-empty strings', () => {
  const levels: TensionLevel[] = ['low', 'medium', 'high', 'critical'];
  for (const l of levels) assert.ok(tensionColor(l).length > 0);
});

// ── tensionLabel ──────────────────────────────────────────────────────────

test('tensionLabel: high returns "High"', () => {
  assert.equal(tensionLabel('high'), 'High');
});

test('tensionLabel: critical returns "Critical"', () => {
  assert.equal(tensionLabel('critical'), 'Critical');
});

// ── activityTrendColor ────────────────────────────────────────────────────

test('activityTrendColor: increasing returns orange', () => {
  assert.ok(activityTrendColor('increasing').includes('#fb923c'));
});

test('activityTrendColor: stable returns yellow', () => {
  assert.ok(activityTrendColor('stable').includes('#facc15'));
});

test('activityTrendColor: decreasing returns green', () => {
  assert.ok(activityTrendColor('decreasing').includes('#4caf50'));
});

test('activityTrendColor: all trends return non-empty strings', () => {
  const trends: ActivityTrend[] = ['increasing', 'stable', 'decreasing'];
  for (const t of trends) assert.ok(activityTrendColor(t).length > 0);
});

// ── activityTrendLabel ────────────────────────────────────────────────────

test('activityTrendLabel: increasing returns "Increasing"', () => {
  assert.equal(activityTrendLabel('increasing'), 'Increasing');
});

test('activityTrendLabel: decreasing returns "Decreasing"', () => {
  assert.equal(activityTrendLabel('decreasing'), 'Decreasing');
});

// ── resourceTypeLabel ─────────────────────────────────────────────────────

test('resourceTypeLabel: oil/gas returns "Oil / Gas"', () => {
  assert.equal(resourceTypeLabel('oil/gas'), 'Oil / Gas');
});

test('resourceTypeLabel: minerals returns "Minerals"', () => {
  assert.equal(resourceTypeLabel('minerals'), 'Minerals');
});

test('resourceTypeLabel: fishing returns "Fishing"', () => {
  assert.equal(resourceTypeLabel('fishing'), 'Fishing');
});

test('resourceTypeLabel: wind returns "Wind Energy"', () => {
  assert.equal(resourceTypeLabel('wind'), 'Wind Energy');
});

// ── devStatusColor ────────────────────────────────────────────────────────

test('devStatusColor: exploration returns green', () => {
  assert.ok(devStatusColor('exploration').includes('#4caf50'));
});

test('devStatusColor: operational returns orange', () => {
  assert.ok(devStatusColor('operational').includes('#fb923c'));
});

test('devStatusColor: suspended returns grey', () => {
  assert.ok(devStatusColor('suspended').includes('#9e9e9e'));
});

test('devStatusColor: all statuses return non-empty strings', () => {
  const statuses: DevStatus[] = ['exploration', 'development', 'operational', 'suspended'];
  for (const s of statuses) assert.ok(devStatusColor(s).length > 0);
});

// ── devStatusLabel ────────────────────────────────────────────────────────

test('devStatusLabel: operational returns "Operational"', () => {
  assert.equal(devStatusLabel('operational'), 'Operational');
});

test('devStatusLabel: suspended returns "Suspended"', () => {
  assert.equal(devStatusLabel('suspended'), 'Suspended');
});

// ── envConcernColor ───────────────────────────────────────────────────────

test('envConcernColor: extreme returns red', () => {
  assert.ok(envConcernColor('extreme').includes('#ef4444'));
});

test('envConcernColor: high returns orange', () => {
  assert.ok(envConcernColor('high').includes('#fb923c'));
});

test('envConcernColor: medium returns yellow', () => {
  assert.ok(envConcernColor('medium').includes('#facc15'));
});

test('envConcernColor: low returns green', () => {
  assert.ok(envConcernColor('low').includes('#4caf50'));
});

test('envConcernColor: all levels return non-empty strings', () => {
  const levels: EnvConcern[] = ['low', 'medium', 'high', 'extreme'];
  for (const l of levels) assert.ok(envConcernColor(l).length > 0);
});

// ── envConcernLabel ───────────────────────────────────────────────────────

test('envConcernLabel: extreme returns "Extreme"', () => {
  assert.equal(envConcernLabel('extreme'), 'Extreme');
});

test('envConcernLabel: low returns "Low"', () => {
  assert.equal(envConcernLabel('low'), 'Low');
});

// ── countHighTensionClaims ────────────────────────────────────────────────

test('countHighTensionClaims: empty array returns 0', () => {
  assert.equal(countHighTensionClaims([]), 0);
});

test('countHighTensionClaims: counts high + critical tension', () => {
  const claims: TerritorialClaim[] = [
    { area: 'A', claimants: 'X/Y', legalStatus: 'UNCLOS',     tensionLevel: 'high',     areaKm2: 100 },
    { area: 'B', claimants: 'X/Z', legalStatus: 'bilateral',  tensionLevel: 'critical', areaKm2: 200 },
    { area: 'C', claimants: 'X/W', legalStatus: 'unresolved', tensionLevel: 'medium',   areaKm2: 50  },
    { area: 'D', claimants: 'Y/Z', legalStatus: 'ICJ',        tensionLevel: 'low',      areaKm2: 10  },
  ];
  assert.equal(countHighTensionClaims(claims), 2);
});

test('countHighTensionClaims: low/medium not counted', () => {
  const claims: TerritorialClaim[] = [
    { area: 'A', claimants: 'X/Y', legalStatus: 'bilateral', tensionLevel: 'low',    areaKm2: 100 },
    { area: 'B', claimants: 'X/Z', legalStatus: 'bilateral', tensionLevel: 'medium', areaKm2: 50  },
  ];
  assert.equal(countHighTensionClaims(claims), 0);
});

// ── countIncreasingMilitary ───────────────────────────────────────────────

test('countIncreasingMilitary: empty array returns 0', () => {
  assert.equal(countIncreasingMilitary([]), 0);
});

test('countIncreasingMilitary: counts only increasing trend', () => {
  const postures: MilitaryPosture[] = [
    { country: 'A', recentActivity: 'x', basingActivity: 'y', trend: 'increasing' },
    { country: 'B', recentActivity: 'x', basingActivity: 'y', trend: 'increasing' },
    { country: 'C', recentActivity: 'x', basingActivity: 'y', trend: 'stable'     },
    { country: 'D', recentActivity: 'x', basingActivity: 'y', trend: 'decreasing' },
  ];
  assert.equal(countIncreasingMilitary(postures), 2);
});

// ── countOpenRoutes ───────────────────────────────────────────────────────

test('countOpenRoutes: empty array returns 0', () => {
  assert.equal(countOpenRoutes([]), 0);
});

test('countOpenRoutes: counts open + seasonal', () => {
  const routes: ShippingRoute[] = [
    { name: 'A', status: 'open',     transitCountYTD: 10, avgTransitDays: 20, iceConditions: 'clear' },
    { name: 'B', status: 'seasonal', transitCountYTD: 5,  avgTransitDays: 25, iceConditions: 'some'  },
    { name: 'C', status: 'closed',   transitCountYTD: 0,  avgTransitDays: 0,  iceConditions: 'heavy' },
  ];
  assert.equal(countOpenRoutes(routes), 2);
});

test('countOpenRoutes: closed routes not counted', () => {
  const routes: ShippingRoute[] = [
    { name: 'A', status: 'closed', transitCountYTD: 0, avgTransitDays: 0, iceConditions: 'heavy' },
  ];
  assert.equal(countOpenRoutes(routes), 0);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('ICE_ENVIRONMENT: is a non-empty array', () => {
  assert.ok(Array.isArray(ICE_ENVIRONMENT));
  assert.ok(ICE_ENVIRONMENT.length > 0);
});

test('ICE_ENVIRONMENT: all entries have valid fields', () => {
  for (const e of ICE_ENVIRONMENT) {
    assert.ok(e.parameter.length > 0);
    assert.ok(e.currentValue.length > 0);
    assert.ok(e.deviation.length > 0);
    assert.ok(['declining', 'stable', 'recovering'].includes(e.trend));
    assert.ok(e.anomalyScore >= 0);
  }
});

test('ICE_ENVIRONMENT: contains at least one declining entry', () => {
  assert.ok(ICE_ENVIRONMENT.some((e) => e.trend === 'declining'));
});

test('SHIPPING_ROUTES: is a non-empty array', () => {
  assert.ok(Array.isArray(SHIPPING_ROUTES));
  assert.ok(SHIPPING_ROUTES.length > 0);
});

test('SHIPPING_ROUTES: all entries have valid status', () => {
  for (const r of SHIPPING_ROUTES) {
    assert.ok(['open', 'seasonal', 'closed'].includes(r.status));
    assert.ok(r.name.length > 0);
    assert.ok(r.iceConditions.length > 0);
  }
});

test('SHIPPING_ROUTES: contains NSR', () => {
  assert.ok(SHIPPING_ROUTES.some((r) => r.name.includes('Northern Sea Route')));
});

test('TERRITORIAL_CLAIMS: is a non-empty array', () => {
  assert.ok(Array.isArray(TERRITORIAL_CLAIMS));
  assert.ok(TERRITORIAL_CLAIMS.length > 0);
});

test('TERRITORIAL_CLAIMS: all entries have required fields', () => {
  for (const c of TERRITORIAL_CLAIMS) {
    assert.ok(c.area.length > 0);
    assert.ok(c.claimants.length > 0);
    assert.ok(['ICJ', 'UNCLOS', 'bilateral', 'unresolved'].includes(c.legalStatus));
    assert.ok(['low', 'medium', 'high', 'critical'].includes(c.tensionLevel));
    assert.ok(c.areaKm2 > 0);
  }
});

test('TERRITORIAL_CLAIMS: contains at least one high-tension entry', () => {
  assert.ok(TERRITORIAL_CLAIMS.some((c) => c.tensionLevel === 'high' || c.tensionLevel === 'critical'));
});

test('MILITARY_POSTURE: is a non-empty array', () => {
  assert.ok(Array.isArray(MILITARY_POSTURE));
  assert.ok(MILITARY_POSTURE.length > 0);
});

test('MILITARY_POSTURE: all entries have valid trend', () => {
  for (const m of MILITARY_POSTURE) {
    assert.ok(['increasing', 'stable', 'decreasing'].includes(m.trend));
    assert.ok(m.country.length > 0);
    assert.ok(m.recentActivity.length > 0);
    assert.ok(m.basingActivity.length > 0);
  }
});

test('MILITARY_POSTURE: contains Russia and USA', () => {
  const countries = MILITARY_POSTURE.map((m) => m.country);
  assert.ok(countries.includes('Russia'));
  assert.ok(countries.includes('USA'));
});

test('MILITARY_POSTURE: contains at least one increasing trend', () => {
  assert.ok(MILITARY_POSTURE.some((m) => m.trend === 'increasing'));
});

test('RESOURCE_PROJECTS: is a non-empty array', () => {
  assert.ok(Array.isArray(RESOURCE_PROJECTS));
  assert.ok(RESOURCE_PROJECTS.length > 0);
});

test('RESOURCE_PROJECTS: all entries have valid fields', () => {
  for (const r of RESOURCE_PROJECTS) {
    assert.ok(r.project.length > 0);
    assert.ok(['oil/gas', 'minerals', 'fishing', 'wind'].includes(r.resourceType));
    assert.ok(['exploration', 'development', 'operational', 'suspended'].includes(r.devStatus));
    assert.ok(['low', 'medium', 'high', 'extreme'].includes(r.envConcern));
    assert.ok(r.countries.length > 0);
  }
});

test('RESOURCE_PROJECTS: contains at least one extreme environmental concern', () => {
  assert.ok(RESOURCE_PROJECTS.some((r) => r.envConcern === 'extreme'));
});
