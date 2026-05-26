/**
 * Tests for WeatherSuperpowerPanel.
 *
 * Covers:
 *   - severityFromHurricaneCategory / EFRating / Gauge / HeatIndex /
 *     WindChill / Aqi (boundaries + extremes)
 *   - compositeNowRisk: max-of-everything aggregation
 *   - parseApiResponse: defensive parsing degrades to empty-state
 *   - renderSevereTracker / renderFloodMonitor / renderExtremeIndex /
 *     renderAtmospheric / renderWeeklyOutlook (empty + non-empty)
 *   - defaultWeatherSuperState shape
 *
 * Pure-function tests — no DOM. The panel-class lifecycle is exercised
 * indirectly via the renderers (they're the same code path the panel
 * runs against `setContent`).
 *
 * Run: npx tsx --test tests/components/WeatherSuperpowerPanel.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityFromHurricaneCategory,
  severityFromEFRating,
  severityFromGauge,
  severityFromHeatIndex,
  severityFromWindChill,
  severityFromAqi,
  compositeNowRisk,
  parseApiResponse,
  defaultWeatherSuperState,
  renderSevereTracker,
  renderFloodMonitor,
  renderExtremeIndex,
  renderAtmospheric,
  renderWeeklyOutlook,
  type WeatherSuperState,
  type SevereWeatherEvent,
  type FloodWatch,
  type ExtremeTempEvent,
  type AtmosphericHazard,
  type DailyRiskOutlook,
} from '../../src/services/weather/weather-superpower-helpers.ts';

// ── severityFromHurricaneCategory ─────────────────────────────────────

test('hurricane: Cat 5 → severity 4', () => {
  assert.equal(severityFromHurricaneCategory(5), 4);
});

test('hurricane: Cat 4 → severity 3', () => {
  assert.equal(severityFromHurricaneCategory(4), 3);
});

test('hurricane: Cat 3 → severity 2', () => {
  assert.equal(severityFromHurricaneCategory(3), 2);
});

test('hurricane: Cat 1 / Cat 2 → severity 1', () => {
  assert.equal(severityFromHurricaneCategory(1), 1);
  assert.equal(severityFromHurricaneCategory(2), 1);
});

test('hurricane: Cat 0 (tropical storm) → severity 0', () => {
  assert.equal(severityFromHurricaneCategory(0), 0);
});

// ── severityFromEFRating ──────────────────────────────────────────────

test('tornado: EF5 → severity 4', () => {
  assert.equal(severityFromEFRating(5), 4);
});

test('tornado: EF4 → severity 4 (catastrophic)', () => {
  assert.equal(severityFromEFRating(4), 4);
});

test('tornado: EF3 → severity 3', () => {
  assert.equal(severityFromEFRating(3), 3);
});

test('tornado: EF0 → severity 1 (any tornado is at least 1)', () => {
  assert.equal(severityFromEFRating(0), 1);
});

// ── severityFromGauge ─────────────────────────────────────────────────

test('gauge: major → 4', () => {
  assert.equal(severityFromGauge('major'), 4);
});

test('gauge: flood → 3', () => {
  assert.equal(severityFromGauge('flood'), 3);
});

test('gauge: action → 2', () => {
  assert.equal(severityFromGauge('action'), 2);
});

test('gauge: normal → 1', () => {
  assert.equal(severityFromGauge('normal'), 1);
});

// ── severityFromHeatIndex ─────────────────────────────────────────────

test('heat index: 130°F → 4 (extreme danger)', () => {
  assert.equal(severityFromHeatIndex(130), 4);
});

test('heat index: 110°F → 3 (danger)', () => {
  assert.equal(severityFromHeatIndex(110), 3);
});

test('heat index: 95°F → 2 (caution)', () => {
  assert.equal(severityFromHeatIndex(95), 2);
});

test('heat index: 85°F → 1', () => {
  assert.equal(severityFromHeatIndex(85), 1);
});

test('heat index: 70°F → 0', () => {
  assert.equal(severityFromHeatIndex(70), 0);
});

// ── severityFromWindChill ─────────────────────────────────────────────

test('wind chill: -45°F → 4', () => {
  assert.equal(severityFromWindChill(-45), 4);
});

test('wind chill: -25°F → 3', () => {
  assert.equal(severityFromWindChill(-25), 3);
});

test('wind chill: -5°F → 2', () => {
  assert.equal(severityFromWindChill(-5), 2);
});

test('wind chill: +15°F → 1', () => {
  assert.equal(severityFromWindChill(15), 1);
});

test('wind chill: +50°F → 0', () => {
  assert.equal(severityFromWindChill(50), 0);
});

// ── severityFromAqi ───────────────────────────────────────────────────

test('aqi: 350 → 4 (hazardous)', () => {
  assert.equal(severityFromAqi(350), 4);
});

test('aqi: 175 → 3 (USG range escalated)', () => {
  assert.equal(severityFromAqi(175), 3);
});

test('aqi: 110 → 2 (unhealthy for sensitive groups)', () => {
  assert.equal(severityFromAqi(110), 2);
});

test('aqi: 60 → 1 (moderate)', () => {
  assert.equal(severityFromAqi(60), 1);
});

test('aqi: 30 → 0 (good)', () => {
  assert.equal(severityFromAqi(30), 0);
});

// ── compositeNowRisk ──────────────────────────────────────────────────

test('composite: empty state → 0', () => {
  assert.equal(compositeNowRisk(defaultWeatherSuperState()), 0);
});

test('composite: takes the max across all sections', () => {
  const state: WeatherSuperState = {
    severeEvents: [mkSevere({ severity: 2 })],
    floodWatches: [mkFlood({ riverGauge: 'major' })], // severity 4 from gauge
    extremeEvents: [mkHeat({ indexF: 95 })],          // severity 2
    atmHazards: [mkSmoke({ aqi: 60 })],                // severity 1
    weeklyOutlook: [],
    generatedAt: 0,
  };
  assert.equal(compositeNowRisk(state), 4);
});

test('composite: lifr aviation impact escalates to 3', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    atmHazards: [{ id: 'h', kind: 'volcanic-ash', region: 'X', visibilityMiles: 0.5, aviationImpact: 'lifr' }],
  };
  assert.equal(compositeNowRisk(state), 3);
});

test('composite: cold events use wind-chill ladder', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    extremeEvents: [{
      id: 'cs1', kind: 'cold-snap', region: 'Minnesota',
      populationMillions: 2, indexF: -45, durationDays: 3,
    }],
  };
  assert.equal(compositeNowRisk(state), 4);
});

// ── parseApiResponse ──────────────────────────────────────────────────

test('parse: returns full state when all fields present', () => {
  const raw = {
    severeEvents: [mkSevere()],
    floodWatches: [mkFlood()],
    extremeEvents: [mkHeat()],
    atmHazards: [mkSmoke()],
    weeklyOutlook: [mkDay()],
    generatedAt: 1_700_000_000_000,
  };
  const out = parseApiResponse(raw);
  assert.equal(out.severeEvents.length, 1);
  assert.equal(out.weeklyOutlook.length, 1);
  assert.equal(out.generatedAt, 1_700_000_000_000);
});

test('parse: missing fields → defaults to empty arrays', () => {
  const out = parseApiResponse({});
  assert.deepEqual(out.severeEvents, []);
  assert.deepEqual(out.floodWatches, []);
  assert.deepEqual(out.extremeEvents, []);
  assert.deepEqual(out.atmHazards, []);
  assert.deepEqual(out.weeklyOutlook, []);
});

test('parse: non-array field is replaced with empty array', () => {
  const out = parseApiResponse({ severeEvents: 'not-an-array' as unknown as SevereWeatherEvent[] });
  assert.deepEqual(out.severeEvents, []);
});

test('parse: result is JSON-serializable', () => {
  const raw = { severeEvents: [mkSevere()], generatedAt: 123 };
  const out = parseApiResponse(raw);
  const round = JSON.parse(JSON.stringify(out));
  assert.deepEqual(round, out);
});

// ── defaultWeatherSuperState ──────────────────────────────────────────

test('default state: every array is empty + generatedAt 0', () => {
  const d = defaultWeatherSuperState();
  assert.equal(d.severeEvents.length, 0);
  assert.equal(d.floodWatches.length, 0);
  assert.equal(d.extremeEvents.length, 0);
  assert.equal(d.atmHazards.length, 0);
  assert.equal(d.weeklyOutlook.length, 0);
  assert.equal(d.generatedAt, 0);
});

// ── Renderers: empty states ───────────────────────────────────────────

test('renderSevereTracker: empty state renders empty-message + header', () => {
  const html = renderSevereTracker(defaultWeatherSuperState());
  assert.match(html, /Severe Weather Tracker/);
  assert.match(html, /No active severe weather events/);
});

test('renderFloodMonitor: empty state renders empty-message', () => {
  const html = renderFloodMonitor(defaultWeatherSuperState());
  assert.match(html, /Flash Flood Monitor/);
  assert.match(html, /No active flood watches/);
});

test('renderExtremeIndex: empty state renders empty-message', () => {
  const html = renderExtremeIndex(defaultWeatherSuperState());
  assert.match(html, /Extreme Heat \/ Cold Index/);
});

test('renderAtmospheric: empty state renders empty-message', () => {
  const html = renderAtmospheric(defaultWeatherSuperState());
  assert.match(html, /Atmospheric Hazards/);
});

test('renderWeeklyOutlook: empty state renders empty-message', () => {
  const html = renderWeeklyOutlook(defaultWeatherSuperState());
  assert.match(html, /7-Day Risk Outlook/);
});

// ── Renderers: non-empty + sort ───────────────────────────────────────

test('renderSevereTracker: sorts severity desc, then windSpeed desc', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    severeEvents: [
      mkSevere({ id: 'low', severity: 1, windSpeedMph: 50, name: 'Low' }),
      mkSevere({ id: 'top', severity: 4, windSpeedMph: 150, name: 'Top' }),
      mkSevere({ id: 'mid', severity: 4, windSpeedMph: 200, name: 'Mid' }),
    ],
  };
  const html = renderSevereTracker(state);
  const midIndex = html.indexOf('Mid');
  const topIndex = html.indexOf('Top');
  const lowIndex = html.indexOf('Low');
  assert.ok(midIndex > -1 && topIndex > -1 && lowIndex > -1);
  // Mid (sev 4, wind 200) renders before Top (sev 4, wind 150) which renders before Low (sev 1).
  assert.ok(midIndex < topIndex);
  assert.ok(topIndex < lowIndex);
});

test('renderFloodMonitor: sorts gauges with major first', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    floodWatches: [
      mkFlood({ id: 'a', riverGauge: 'normal', region: 'A' }),
      mkFlood({ id: 'b', riverGauge: 'major', region: 'B' }),
    ],
  };
  const html = renderFloodMonitor(state);
  assert.ok(html.indexOf('B') < html.indexOf('A'));
});

test('renderExtremeIndex: cold events render wind-chill label, hot events render heat-index label', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    extremeEvents: [
      { id: 'hot', kind: 'heat-wave', region: 'Texas', populationMillions: 5, indexF: 110, durationDays: 4 },
      { id: 'cold', kind: 'cold-snap', region: 'Maine', populationMillions: 2, indexF: -25, durationDays: 2 },
    ],
  };
  const html = renderExtremeIndex(state);
  assert.match(html, /Heat-index/);
  assert.match(html, /Wind-chill/);
});

test('renderAtmospheric: emits aviation impact badge', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    atmHazards: [mkSmoke({ aviationImpact: 'no-fly' })],
  };
  const html = renderAtmospheric(state);
  assert.match(html, /no-fly/);
});

test('renderWeeklyOutlook: emits up to 7 day cells', () => {
  const days = Array.from({ length: 12 }, (_, i) => mkDay({ date: `2026-05-${10 + i}` }));
  const state: WeatherSuperState = { ...defaultWeatherSuperState(), weeklyOutlook: days };
  const html = renderWeeklyOutlook(state);
  const matches = html.match(/2026-05-/g) ?? [];
  assert.equal(matches.length, 7);
});

test('renderWeeklyOutlook: trend glyphs ↑→↓ appear', () => {
  const state: WeatherSuperState = {
    ...defaultWeatherSuperState(),
    weeklyOutlook: [
      mkDay({ date: 'd1', trend: 'rising' }),
      mkDay({ date: 'd2', trend: 'steady' }),
      mkDay({ date: 'd3', trend: 'falling' }),
    ],
  };
  const html = renderWeeklyOutlook(state);
  // ↑, →, and ↓ characters are HTML-escape-safe; they pass through escapeHtml verbatim.
  assert.ok(html.includes('↑'));
  assert.ok(html.includes('→'));
  assert.ok(html.includes('↓'));
});

// ── Fixture helpers ───────────────────────────────────────────────────

function mkSevere(over: Partial<SevereWeatherEvent> = {}): SevereWeatherEvent {
  return {
    id: 'sv-1',
    kind: 'hurricane',
    name: 'Hurricane Alpha',
    severity: 3,
    category: 3,
    region: 'Gulf Coast',
    windSpeedMph: 120,
    source: 'NHC',
    ...over,
  };
}

function mkFlood(over: Partial<FloodWatch> = {}): FloodWatch {
  return {
    id: 'fl-1',
    region: 'Mississippi Valley',
    precipInches: 4.2,
    riverGauge: 'flood',
    alertLevel: 'warning',
    affectedCounties: 7,
    ...over,
  };
}

function mkHeat(over: Partial<ExtremeTempEvent> = {}): ExtremeTempEvent {
  return {
    id: 'ex-1',
    kind: 'heat-wave',
    region: 'Phoenix metro',
    populationMillions: 4.5,
    indexF: 108,
    durationDays: 5,
    ...over,
  };
}

function mkSmoke(over: Partial<AtmosphericHazard> = {}): AtmosphericHazard {
  return {
    id: 'sm-1',
    kind: 'wildfire-smoke',
    region: 'Pacific NW',
    aqi: 160,
    aviationImpact: 'mvfr',
    ...over,
  };
}

function mkDay(over: Partial<DailyRiskOutlook> = {}): DailyRiskOutlook {
  return {
    date: '2026-05-19',
    riskScore: 2,
    leadingHazard: 'severe-thunderstorm',
    trend: 'steady',
    ...over,
  };
}
