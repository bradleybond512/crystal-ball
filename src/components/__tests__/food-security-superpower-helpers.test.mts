import assert from 'node:assert/strict';
import test from 'node:test';

import {
  severityNumeric,
  pressureLevel,
  computeFoodPressure,
  commodityRiskTier,
  isFoodCommodity,
  commoditiesByRisk,
  ipcPhaseLabel,
  buildFamineWatch,
  classifyChokepoint,
  buildChokepointSignals,
  breadbasketLabel,
  regionOfEvent,
  buildBreadbasketStress,
  formatPopulation,
  formatTimeAgo,
  buildFoodSecurityState,
  renderFoodSecurityHtml,
} from '../food-security-superpower-helpers.ts';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type { FoodInsecurityAlert, IpcPhase } from '@/services/food-insecurity';
import type { ShortageForecast } from '@/services/shortage/shortage-types';

const NOW = Date.parse('2026-05-26T12:00:00Z');
const DAY_MS = 86_400_000;

function obs(over: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: over.id ?? 'ev-1',
    sourceId: over.sourceId ?? 'test',
    domain: over.domain ?? 'food',
    timestamp: over.timestamp ?? NOW,
    location: over.location,
    severity: over.severity ?? 'MEDIUM',
    title: over.title ?? 'Test event',
    raw: over.raw ?? {},
    entityIds: over.entityIds ?? [],
    tags: over.tags ?? [],
  };
}

function alert(over: Partial<FoodInsecurityAlert> = {}): FoodInsecurityAlert {
  return {
    id: over.id ?? 'a-1',
    country: over.country ?? 'Somalia',
    countryCode: over.countryCode ?? 'SO',
    title: over.title ?? 'Test alert',
    description: over.description ?? '',
    ipcPhase: over.ipcPhase ?? null,
    populationAffected: over.populationAffected ?? null,
    source: over.source ?? 'IPC',
    pubDate: over.pubDate ?? new Date(NOW),
    url: over.url ?? '',
    severity: over.severity ?? 'medium',
  };
}

function forecast(over: Partial<ShortageForecast> = {}): ShortageForecast {
  return {
    commodity: over.commodity ?? 'wheat',
    domain: over.domain ?? 'food',
    region: over.region ?? 'global',
    horizonDays: over.horizonDays ?? 60,
    riskScore: over.riskScore ?? 50,
    confidence: over.confidence ?? 'medium',
    drivers: over.drivers ?? [],
    confirmingIndicators: over.confirmingIndicators ?? [],
    invalidatingIndicators: over.invalidatingIndicators ?? [],
    dataGaps: over.dataGaps ?? [],
    lastUpdated: over.lastUpdated ?? new Date(NOW).toISOString(),
  };
}

// ── severityNumeric ─────────────────────────────────────────────────

test('severityNumeric returns 0 for INFO', () => {
  assert.equal(severityNumeric('INFO'), 0);
});

test('severityNumeric maps LOW → 2', () => {
  assert.equal(severityNumeric('LOW'), 2);
});

test('severityNumeric maps MEDIUM → 5', () => {
  assert.equal(severityNumeric('MEDIUM'), 5);
});

test('severityNumeric maps HIGH → 7', () => {
  assert.equal(severityNumeric('HIGH'), 7);
});

test('severityNumeric maps CRITICAL → 9', () => {
  assert.equal(severityNumeric('CRITICAL'), 9);
});

test('severityNumeric returns 0 for unknown severity values', () => {
  assert.equal(severityNumeric('NONSENSE' as ObservationSeverity), 0);
});

// ── pressureLevel ───────────────────────────────────────────────────

test('pressureLevel returns low for 0', () => {
  assert.equal(pressureLevel(0), 'low');
});

test('pressureLevel returns elevated at 35', () => {
  assert.equal(pressureLevel(35), 'elevated');
});

test('pressureLevel returns high at 60', () => {
  assert.equal(pressureLevel(60), 'high');
});

test('pressureLevel returns critical at 80', () => {
  assert.equal(pressureLevel(80), 'critical');
});

test('pressureLevel returns low just under elevated threshold', () => {
  assert.equal(pressureLevel(34), 'low');
});

// ── computeFoodPressure ────────────────────────────────────────────

test('computeFoodPressure handles empty event list', () => {
  const g = computeFoodPressure([]);
  assert.equal(g.level, 'low');
  assert.equal(g.score, 0);
  assert.equal(g.eventCount, 0);
  assert.equal(g.maxSeverity, 'INFO');
});

test('computeFoodPressure scores a single CRITICAL event high', () => {
  const g = computeFoodPressure([obs({ severity: 'CRITICAL' })]);
  assert.equal(g.eventCount, 1);
  assert.equal(g.maxSeverity, 'CRITICAL');
  assert.ok(g.score >= 80, `expected score>=80, got ${g.score}`);
  assert.equal(g.level, 'critical');
});

test('computeFoodPressure averages mixed severities into elevated band', () => {
  const events = [
    obs({ id: 'a', severity: 'HIGH' }),
    obs({ id: 'b', severity: 'LOW' }),
    obs({ id: 'c', severity: 'LOW' }),
  ];
  const g = computeFoodPressure(events);
  assert.equal(g.eventCount, 3);
  assert.equal(g.maxSeverity, 'HIGH');
  assert.ok(g.score >= 35 && g.score < 80, `unexpected score ${g.score}`);
});

test('computeFoodPressure clamps very high inputs to 100', () => {
  const events = Array.from({ length: 20 }, (_, i) => obs({ id: `c${i}`, severity: 'CRITICAL' }));
  const g = computeFoodPressure(events);
  assert.ok(g.score <= 100);
  assert.equal(g.level, 'critical');
});

// ── commodityRiskTier ──────────────────────────────────────────────

test('commodityRiskTier critical at 80+', () => {
  assert.equal(commodityRiskTier(80), 'critical');
  assert.equal(commodityRiskTier(100), 'critical');
});

test('commodityRiskTier high band 60-79', () => {
  assert.equal(commodityRiskTier(60), 'high');
  assert.equal(commodityRiskTier(79), 'high');
});

test('commodityRiskTier elevated band 40-59', () => {
  assert.equal(commodityRiskTier(40), 'elevated');
  assert.equal(commodityRiskTier(59), 'elevated');
});

test('commodityRiskTier watch band 20-39', () => {
  assert.equal(commodityRiskTier(20), 'watch');
  assert.equal(commodityRiskTier(39), 'watch');
});

test('commodityRiskTier low band under 20', () => {
  assert.equal(commodityRiskTier(0), 'low');
  assert.equal(commodityRiskTier(19), 'low');
});

// ── isFoodCommodity ────────────────────────────────────────────────

test('isFoodCommodity recognizes wheat and corn', () => {
  assert.equal(isFoodCommodity('wheat'), true);
  assert.equal(isFoodCommodity('corn'), true);
});

test('isFoodCommodity rejects energy commodities', () => {
  assert.equal(isFoodCommodity('diesel'), false);
  assert.equal(isFoodCommodity('gasoline'), false);
});

test('isFoodCommodity is case-insensitive', () => {
  assert.equal(isFoodCommodity('WHEAT'), true);
});

// ── commoditiesByRisk ──────────────────────────────────────────────

test('commoditiesByRisk filters out non-food commodities', () => {
  const rows = commoditiesByRisk([
    forecast({ commodity: 'wheat', riskScore: 70 }),
    forecast({ commodity: 'diesel', riskScore: 90 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.commodity, 'wheat');
});

test('commoditiesByRisk sorts highest risk first', () => {
  const rows = commoditiesByRisk([
    forecast({ commodity: 'wheat', riskScore: 30 }),
    forecast({ commodity: 'rice', riskScore: 85 }),
    forecast({ commodity: 'corn', riskScore: 60 }),
  ]);
  assert.deepEqual(rows.map((r) => r.commodity), ['rice', 'corn', 'wheat']);
});

test('commoditiesByRisk caps at the limit argument', () => {
  const forecasts = Array.from({ length: 10 }, (_, i) =>
    forecast({ commodity: ['wheat', 'corn', 'rice', 'soybeans'][i % 4]!, riskScore: 50 - i }));
  const rows = commoditiesByRisk(forecasts, 3);
  assert.equal(rows.length, 3);
});

test('commoditiesByRisk extracts top 3 driver labels by score', () => {
  const rows = commoditiesByRisk([
    forecast({
      commodity: 'wheat',
      riskScore: 70,
      drivers: [
        { kind: 'production', score: 50, label: 'D1' },
        { kind: 'inventory', score: 80, label: 'D2' },
        { kind: 'transport', score: 30, label: 'D3' },
        { kind: 'policy', score: 90, label: 'D4' },
      ],
    }),
  ]);
  assert.deepEqual(rows[0]!.topDrivers, ['D4', 'D2', 'D1']);
});

test('commoditiesByRisk returns empty when no food forecasts provided', () => {
  assert.deepEqual(commoditiesByRisk([]), []);
});

// ── ipcPhaseLabel ──────────────────────────────────────────────────

test('ipcPhaseLabel covers each defined phase', () => {
  assert.equal(ipcPhaseLabel(1), 'Minimal');
  assert.equal(ipcPhaseLabel(2), 'Stressed');
  assert.equal(ipcPhaseLabel(3), 'Crisis');
  assert.equal(ipcPhaseLabel(4), 'Emergency');
  assert.equal(ipcPhaseLabel(5), 'Catastrophe');
});

test('ipcPhaseLabel returns Unknown for null', () => {
  assert.equal(ipcPhaseLabel(null), 'Unknown');
});

test('ipcPhaseLabel returns Unknown for out-of-range', () => {
  assert.equal(ipcPhaseLabel(9 as IpcPhase), 'Unknown');
});

// ── buildFamineWatch ───────────────────────────────────────────────

test('buildFamineWatch filters to IPC 3+ and high/critical severities', () => {
  const f = buildFamineWatch([
    alert({ country: 'A', ipcPhase: 1, severity: 'low' }),
    alert({ country: 'B', ipcPhase: 3, severity: 'high' }),
    alert({ country: 'C', ipcPhase: null, severity: 'critical' }),
  ]);
  assert.equal(f.rows.length, 2);
  assert.deepEqual(f.rows.map((r) => r.country).sort(), ['B', 'C']);
});

test('buildFamineWatch counts phases correctly', () => {
  const f = buildFamineWatch([
    alert({ ipcPhase: 3, severity: 'high' }),
    alert({ ipcPhase: 4, severity: 'critical' }),
    alert({ ipcPhase: 5, severity: 'critical' }),
  ]);
  assert.equal(f.phase3Plus, 3);
  assert.equal(f.phase4Plus, 2);
  assert.equal(f.phase5, 1);
});

test('buildFamineWatch sums population affected, ignoring nulls', () => {
  const f = buildFamineWatch([
    alert({ ipcPhase: 4, populationAffected: 1_000_000, severity: 'critical' }),
    alert({ ipcPhase: 3, populationAffected: null, severity: 'high' }),
    alert({ ipcPhase: 3, populationAffected: 500_000, severity: 'high' }),
  ]);
  assert.equal(f.totalPopulationAffected, 1_500_000);
});

test('buildFamineWatch sorts by phase then population descending', () => {
  const f = buildFamineWatch([
    alert({ country: 'Low', ipcPhase: 3, populationAffected: 100, severity: 'high' }),
    alert({ country: 'High', ipcPhase: 5, populationAffected: 200, severity: 'critical' }),
    alert({ country: 'Mid', ipcPhase: 4, populationAffected: 9_000_000, severity: 'critical' }),
  ]);
  assert.deepEqual(f.rows.map((r) => r.country), ['High', 'Mid', 'Low']);
});

test('buildFamineWatch caps rows at the requested limit', () => {
  const alerts = Array.from({ length: 20 }, (_, i) =>
    alert({ id: `a-${i}`, country: `C${i}`, ipcPhase: 3, severity: 'high' }));
  const f = buildFamineWatch(alerts, 5);
  assert.equal(f.rows.length, 5);
  assert.equal(f.phase3Plus, 20);
});

// ── classifyChokepoint ─────────────────────────────────────────────

test('classifyChokepoint maps direct tags', () => {
  assert.equal(classifyChokepoint(obs({ tags: ['chokepoint:black-sea'] })), 'black-sea');
  assert.equal(classifyChokepoint(obs({ tags: ['chokepoint:suez'] })), 'suez');
  assert.equal(classifyChokepoint(obs({ tags: ['export-ban'] })), 'export-ban');
});

test('classifyChokepoint recognizes strait variants', () => {
  assert.equal(classifyChokepoint(obs({ tags: ['chokepoint:strait-of-hormuz'] })), 'strait');
});

test('classifyChokepoint returns null when no chokepoint tag present', () => {
  assert.equal(classifyChokepoint(obs({ tags: ['drought', 'crop-stress'] })), null);
});

test('classifyChokepoint catches generic chokepoint tag', () => {
  assert.equal(classifyChokepoint(obs({ tags: ['chokepoint'] })), 'other');
});

// ── buildChokepointSignals ─────────────────────────────────────────

test('buildChokepointSignals sorts by severity then timestamp', () => {
  const signals = buildChokepointSignals([
    obs({ id: '1', tags: ['chokepoint:suez'], severity: 'MEDIUM', timestamp: NOW }),
    obs({ id: '2', tags: ['chokepoint:black-sea'], severity: 'CRITICAL', timestamp: NOW - 1000 }),
    obs({ id: '3', tags: ['port-closure'], severity: 'HIGH', timestamp: NOW }),
  ]);
  assert.equal(signals[0]!.kind, 'black-sea');
  assert.equal(signals[1]!.kind, 'port-closure');
  assert.equal(signals[2]!.kind, 'suez');
});

test('buildChokepointSignals ignores non-chokepoint events', () => {
  const signals = buildChokepointSignals([
    obs({ tags: ['drought'] }),
    obs({ tags: ['chokepoint:panama'] }),
  ]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.kind, 'panama');
});

test('buildChokepointSignals caps at limit', () => {
  const events = Array.from({ length: 12 }, (_, i) =>
    obs({ id: `c${i}`, tags: ['chokepoint:suez'], severity: 'HIGH', timestamp: NOW - i * 1000 }));
  const signals = buildChokepointSignals(events, 5);
  assert.equal(signals.length, 5);
});

// ── breadbasketLabel + regionOfEvent ───────────────────────────────

test('breadbasketLabel returns human-friendly labels', () => {
  assert.equal(breadbasketLabel('north-america'), 'North America');
  assert.equal(breadbasketLabel('black-sea'), 'Black Sea');
  assert.equal(breadbasketLabel('other'), 'Other');
});

test('regionOfEvent prefers explicit region tag', () => {
  const r = regionOfEvent(obs({ tags: ['region:ukraine'], location: { lat: 10, lon: 10 } }));
  assert.equal(r, 'black-sea');
});

test('regionOfEvent falls back to longitude/latitude bucket', () => {
  const usMidwest = regionOfEvent(obs({ tags: [], location: { lat: 40, lon: -90 } }));
  assert.equal(usMidwest, 'north-america');
});

test('regionOfEvent returns other when no location or matching tag', () => {
  assert.equal(regionOfEvent(obs({ tags: [], location: undefined })), 'other');
});

test('regionOfEvent identifies India breadbasket', () => {
  assert.equal(regionOfEvent(obs({ tags: [], location: { lat: 20, lon: 78 } })), 'india');
});

// ── buildBreadbasketStress ─────────────────────────────────────────

test('buildBreadbasketStress groups stress events by region', () => {
  const buckets = buildBreadbasketStress([
    obs({ id: '1', tags: ['drought', 'region:india'], severity: 'HIGH' }),
    obs({ id: '2', tags: ['heatwave', 'region:india'], severity: 'MEDIUM' }),
    obs({ id: '3', tags: ['drought', 'region:australia'], severity: 'LOW' }),
  ]);
  const india = buckets.find((b) => b.region === 'india');
  const australia = buckets.find((b) => b.region === 'australia');
  assert.ok(india);
  assert.ok(australia);
  assert.equal(india!.eventCount, 2);
  assert.equal(australia!.eventCount, 1);
});

test('buildBreadbasketStress sorts buckets by score descending', () => {
  const buckets = buildBreadbasketStress([
    obs({ id: '1', tags: ['drought', 'region:china'], severity: 'LOW' }),
    obs({ id: '2', tags: ['drought', 'region:europe'], severity: 'CRITICAL' }),
  ]);
  assert.equal(buckets[0]!.region, 'europe');
});

test('buildBreadbasketStress excludes events without stress tags', () => {
  const buckets = buildBreadbasketStress([
    obs({ tags: ['chokepoint:suez'] }),
    obs({ tags: ['drought', 'region:india'] }),
  ]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.region, 'india');
});

test('buildBreadbasketStress surfaces top stress tags', () => {
  const buckets = buildBreadbasketStress([
    obs({ id: '1', tags: ['drought', 'region:india'] }),
    obs({ id: '2', tags: ['drought', 'region:india'] }),
    obs({ id: '3', tags: ['heatwave', 'region:india'] }),
  ]);
  const india = buckets[0]!;
  assert.equal(india.topTags[0], 'drought');
  assert.ok(india.topTags.includes('heatwave'));
});

// ── formatPopulation ──────────────────────────────────────────────

test('formatPopulation renders millions with one decimal', () => {
  assert.equal(formatPopulation(1_500_000), '1.5M');
});

test('formatPopulation renders thousands with K', () => {
  assert.equal(formatPopulation(45_000), '45K');
});

test('formatPopulation returns em dash for null', () => {
  assert.equal(formatPopulation(null), '—');
});

test('formatPopulation handles small integers', () => {
  assert.equal(formatPopulation(420), '420');
});

// ── formatTimeAgo ─────────────────────────────────────────────────

test('formatTimeAgo returns seconds under one minute', () => {
  assert.equal(formatTimeAgo(NOW - 30_000, NOW), '30s ago');
});

test('formatTimeAgo returns minutes under one hour', () => {
  assert.equal(formatTimeAgo(NOW - 5 * 60_000, NOW), '5m ago');
});

test('formatTimeAgo returns hours under one day', () => {
  assert.equal(formatTimeAgo(NOW - 3 * 3_600_000, NOW), '3h ago');
});

test('formatTimeAgo returns days for older timestamps', () => {
  assert.equal(formatTimeAgo(NOW - 2 * DAY_MS, NOW), '2d ago');
});

test('formatTimeAgo handles future timestamps with just now', () => {
  assert.equal(formatTimeAgo(NOW + 60_000, NOW), 'just now');
});

// ── buildFoodSecurityState + renderFoodSecurityHtml ──────────────

test('buildFoodSecurityState produces every section', () => {
  const state = buildFoodSecurityState({
    events: [obs({ severity: 'HIGH', tags: ['drought', 'region:india'] })],
    forecasts: [forecast({ commodity: 'wheat', riskScore: 70 })],
    alerts: [alert({ ipcPhase: 4, severity: 'critical' })],
  }, NOW);
  assert.equal(state.generatedAt, NOW);
  assert.ok(state.pressure.score >= 0);
  assert.equal(state.commodities.length, 1);
  assert.equal(state.famine.phase4Plus, 1);
  assert.equal(state.breadbaskets.length, 1);
});

test('renderFoodSecurityHtml includes every section header', () => {
  const state = buildFoodSecurityState({
    events: [obs({ tags: ['chokepoint:suez'], severity: 'HIGH' })],
    forecasts: [forecast({ commodity: 'corn', riskScore: 50 })],
    alerts: [alert({ ipcPhase: 3, severity: 'high', country: 'Sudan' })],
  }, NOW);
  const html = renderFoodSecurityHtml(state, () => NOW);
  assert.match(html, /Food Pressure Gauge/);
  assert.match(html, /Commodity Risk Forecast/);
  assert.match(html, /Famine Watch/);
  assert.match(html, /Supply Chain Chokepoints/);
  assert.match(html, /Breadbasket Drought Watch/);
});

test('renderFoodSecurityHtml escapes user-provided text', () => {
  const state = buildFoodSecurityState({
    events: [],
    forecasts: [],
    alerts: [alert({ ipcPhase: 5, severity: 'critical', country: '<script>x</script>' })],
  }, NOW);
  const html = renderFoodSecurityHtml(state, () => NOW);
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderFoodSecurityHtml shows empty messages when no data', () => {
  const state = buildFoodSecurityState({ events: [], forecasts: [], alerts: [] }, NOW);
  const html = renderFoodSecurityHtml(state, () => NOW);
  assert.match(html, /No commodity forecasts loaded/);
  assert.match(html, /No IPC Phase 3\+ alerts/);
  assert.match(html, /No chokepoint disruptions tracked/);
  assert.match(html, /No drought or crop-stress signals/);
});
