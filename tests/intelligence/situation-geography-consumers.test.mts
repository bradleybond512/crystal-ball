import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as geography from '../../src/services/situation-types.ts';
import type { Situation, SituationGeo } from '../../src/services/situation-types.ts';

function loadService(name: string, dependencies: Record<string, unknown>, globals = {}) {
  const source = readFileSync(new URL(`../../src/services/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, { exports, Date, console, ...globals, require(id: string) {
    if (id === './situation-types') return geography;
    assert.ok(id in dependencies, `unexpected dependency ${id}`);
    return dependencies[id];
  } });
  return exports;
}

const context = { label: 'Unspecified', countries: [], radiusKm: 500 };
const point = (lat = 0, lon = 0): SituationGeo => ({ ...context, kind: 'point', basis: 'reported-event', lat, lon });
const unknown: SituationGeo = { ...context, kind: 'unknown' };
const area: SituationGeo = { ...context, kind: 'area', basis: 'nws-geometry', centroid: { lat: 0, lon: 0 } };
const centroid: SituationGeo = { ...point(), basis: 'regional-centroid' };
function situation(id: string, geo: SituationGeo, domain: Situation['domain'] = 'natural_hazard'): Situation {
  return { id, geo, domain, title: id, summary: '', phase: 'active', confidence: 0.8,
    signalIds: [], signals: [], domainDiversity: 1, evidence: null, scenarios: [], actions: [],
    causalChainId: null, firstSeen: Date.now() - 1000, lastUpdated: Date.now(), latestEventAt: Date.now(), reassessmentCount: 0 };
}
function synthesis(situations: Situation[]) {
  const captured: any[] = [];
  const service = loadService('threat-synthesis', {
    './situation-engine': { situationEngine: { getSituations: () => situations } },
    './compound-threat': { detectCompoundThreats: (signals: unknown[]) => { captured.push(...signals); return []; } },
    './situation-forecaster': { CAUSAL_TEMPLATES: [] },
    './claude-agent': { runClaudeAgent: () => { throw new Error('AI must remain disabled'); } },
    './runtime-config': { isFeatureAvailable: () => false },
  });
  return { service, captured };
}

test('unknown and area-only locations do not create a shared NaN region', async () => {
  for (const geo of [unknown, area, { ...context, kind: 'global' } as SituationGeo]) {
    const { service } = synthesis([situation('weather', geo), situation('cyber', geo, 'cyber')]);
    assert.equal((await service.synthesizeThreats()).clusters.length, 0, geo.kind);
  }
});

test('reported zero coordinates retain region clustering and hazard inputs', async () => {
  const { service, captured } = synthesis([situation('weather', point()), situation('cyber', point(), 'cyber')]);
  assert.equal((await service.synthesizeThreats()).clusters.length, 1);
  assert.equal(captured.length, 2);
  assert.ok(captured.every(signal => signal.lat === 0 && signal.lon === 0));
});

test('hazard proximity receives reported points only, never display centroids or missing coordinates', async () => {
  const geos: SituationGeo[] = [unknown, area, centroid, { ...context, kind: 'country', countries: ['US'] }, { ...point(), lat: Infinity }];
  const { service, captured } = synthesis(geos.map((geo, i) => situation(`excluded-${i}`, geo)));
  await service.synthesizeThreats();
  assert.equal(captured.length, 0);
});

test('theater distance excludes centroid and malformed points but retains zero and country overlap', () => {
  const { service } = synthesis([]);
  const zero = situation('zero', point());
  for (const geo of [centroid, area, unknown, { ...point(), lat: 91 }]) {
    assert.equal(service.groupByTheater([zero, situation('other', geo)]).length, 2);
  }
  assert.equal(service.groupByTheater([zero, situation('near', point(0, 0.01))]).length, 1);
  const country = { ...context, kind: 'country', countries: ['US'] } as SituationGeo;
  assert.equal(service.groupByTheater([situation('a', country), situation('b', country)]).length, 1);
});

function watchlist(geo: SituationGeo, title = 'unrelated') {
  const distances: unknown[][] = [];
  const service = loadService('watchlist-hypothesis-bridge', {
    './watchlist': { getWatchlist: () => [{ label: 'Home', keywords: ['matched'], lat: 0, lon: 0, radiusKm: 100 }] },
    './unified-alerts': { unifiedAlertStore: { getAll: () => [{ id: 'alert', title: 'matched warning', body: '', acknowledged: false }] },
      computeDistanceKm: (...args: unknown[]) => { distances.push(args); return args.every(value => typeof value === 'number' && Number.isFinite(value)) ? 0 : NaN; } },
    './situation-engine': { situationEngine: { getSituations: () => [{ ...situation('sit', geo), title }] } },
    './alert-routing': { scoreAlert: () => 100 },
  });
  return { hypotheses: service.getWatchlistHypotheses(), distances };
}

test('watchlist proximity excludes nonreported and invalid geography without removing text matches', () => {
  for (const geo of [unknown, area, centroid, { ...point(), lon: NaN }]) {
    const result = watchlist(geo);
    assert.equal(result.hypotheses.length, 0);
    assert.equal(result.distances.length, 0);
    assert.equal(watchlist(geo, 'matched situation').hypotheses.length, 1);
  }
});

test('watchlist accepts reported zero coordinates', () => {
  const result = watchlist(point());
  assert.equal(result.hypotheses.length, 1);
  assert.deepEqual(result.distances, [[0, 0, 0, 0]]);
});

function escalate(geo: SituationGeo) {
  const sit = { ...situation('escalating', geo), confidence: 0.4 };
  const alerts: any[] = [];
  let reassess: (() => void) | undefined;
  const service = loadService('escalation-lifecycle', {
    './situation-engine': { situationEngine: { getSituations: () => [sit] } },
    './notification-dispatcher': { notificationDispatcher: { dispatchNotification: (alert: unknown) => alerts.push(alert) }, actionForSeverity: () => 'badge' },
  }, { setInterval: (callback: () => void) => { reassess = callback; return 1; } });
  const events: any[] = [];
  service.subscribeLifecycle((event: unknown) => events.push(event));
  service.startEscalationTracking();
  sit.confidence = 0.9;
  reassess!();
  return { alerts, events };
}

test('escalation preserves severity events without inventing locations for nonreported geography', () => {
  for (const geo of [unknown, area, centroid, { ...context, kind: 'country' } as SituationGeo]) {
    const { alerts, events } = escalate(geo);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].location, undefined);
    assert.equal(events.filter(event => event.previousSeverity === 'medium' && event.severity === 'critical').length, 1);
  }
});

test('escalation preserves a reported zero coordinate location', () => {
  const { alerts } = escalate(point());
  assert.equal(alerts[0].location.lat, 0);
  assert.equal(alerts[0].location.lon, 0);
});

function personalizer(storage: Record<string, string> = {}, templates: unknown[] = [], denied = false) {
  return loadService('situation-personalizer', { './situation-forecaster': { CAUSAL_TEMPLATES: templates } }, {
    localStorage: { getItem: (key: string) => { if (denied) throw new Error('storage unavailable'); return storage[key] ?? null; } },
  });
}
const personalContext = { location: { lat: 0, lon: 0 }, watchlistCountries: [], watchlistTopics: [], appMode: 'default', savedPlaces: [] };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('personalizer preserves valid persisted context including zero coordinates', () => {
  const service = personalizer({
    'crystalball-watchlist': JSON.stringify([{ type: 'country', id: 'US' }, { type: 'topic', label: 'storm' }, { type: 'keyword', label: 'flood' }]),
    'crystalball-saved-places': JSON.stringify([{ name: 'Home', lat: 0, lon: 0, country: 'GH' }]),
    'crystalball-user-location': JSON.stringify({ lat: 0, lon: 0 }),
    'crystalball-app-mode': 'gods-vision',
  });
  assert.deepEqual(plain(service.buildUserContext()), { location: { lat: 0, lon: 0 }, watchlistCountries: ['US'], watchlistTopics: ['storm', 'flood'], appMode: 'gods-vision', savedPlaces: [{ name: 'Home', lat: 0, lon: 0, country: 'GH' }] });
});

test('personalizer rejects malformed watchlist values and saved-place rows individually', () => {
  const service = personalizer({
    'crystalball-watchlist': JSON.stringify([null, { type: 'country', id: 4 }, { type: 'country', id: 'US' }, { type: 'topic', label: {} }, { type: 'keyword', label: 'flood' }]),
    'crystalball-saved-places': JSON.stringify([{ name: 'bad-range', lat: 360, lon: 0 }, { lat: 0, lon: 0 }, { name: 'bad-country', lat: 0, lon: 0, country: 3 }, { name: 'Home', lat: 0, lon: 0 }]),
    'crystalball-user-location': JSON.stringify({ lat: 360, lon: 0 }),
  });
  assert.deepEqual(plain(service.buildUserContext()), { location: null, watchlistCountries: ['US'], watchlistTopics: ['flood'], appMode: 'default', savedPlaces: [{ name: 'Home', lat: 0, lon: 0 }] });
});

test('personalizer fails closed on malformed or unavailable storage', () => {
  for (const service of [personalizer({ 'crystalball-watchlist': '{', 'crystalball-saved-places': 'null', 'crystalball-user-location': '[]', 'crystalball-app-mode': 'unexpected' }), personalizer({}, [], true)]) {
    assert.deepEqual(plain(service.buildUserContext()), { ...personalContext, location: null });
  }
  for (const location of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: '0', lon: 0 }, null]) {
    assert.equal(personalizer({ 'crystalball-user-location': JSON.stringify(location) }).buildUserContext().location, null);
  }
});

test('personalizer proximity actions require reported points and preserve zero coordinates', () => {
  const service = personalizer();
  const zeroActions = service.personalizeSituation(situation('nearby', point()), personalContext);
  const safety = zeroActions.find((action: any) => action.headline === 'Review personal safety preparations');
  assert.equal(safety?.urgency, 'immediate');
  assert.equal(safety?.rationale, 'Situation is 0km from your location.');
  for (const geo of [unknown, area, centroid]) {
    const actions = service.personalizeSituation(situation('unlocated', geo), personalContext);
    assert.ok(actions.every((action: any) => action.headline !== 'Review personal safety preparations'));
    assert.equal(actions[0].headline, 'Monitor: unlocated');
  }
});

test('personalizer preserves Ghost silence and low-confidence background action', () => {
  const service = personalizer({ 'crystalball-app-mode': 'ghost' });
  assert.equal(service.personalizeSituation(situation('hidden', point())).length, 0);
  assert.equal(service.personalizeSituation(situation('hidden', point()), { ...personalContext, appMode: 'ghost' }).length, 0);
  const actions = service.personalizeSituation({ ...situation('quiet', unknown), confidence: 0.2 }, personalContext);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].headline, 'Background: quiet');
  assert.equal(actions[0].urgency, 'fyi');
});

test('personalizer keeps template urgency, scenario gates, ordering and deduplication', () => {
  const templateAction = { headline: 'Template response', rationale: 'Existing guidance', urgency: 'immediate', category: 'information', steps: ['Observe'], dismissed: false };
  const service = personalizer({}, [{ id: 'chain', actionTemplates: [templateAction, templateAction] }]);
  const base = { ...situation('military', point(), 'military'), causalChainId: 'chain', scenarios: [
    { id: 'major', label: 'Major outcome', probability: 0.7, severity: 'catastrophic', horizonHours: 24, confirmationIndicators: ['signal'], invalidationIndicators: ['quiet'] },
    { id: 'minor', label: 'Minor outcome', probability: 0.9, severity: 'minor', horizonHours: 24, confirmationIndicators: [], invalidationIndicators: [] },
    { id: 'unlikely', label: 'Unlikely', probability: 0.3, severity: 'major', horizonHours: 24, confirmationIndicators: [], invalidationIndicators: [] },
  ] };
  const near = service.personalizeSituation(base, personalContext);
  assert.equal(near.filter((action: any) => action.headline === 'Template response').length, 1);
  assert.equal(near.find((action: any) => action.headline === 'Template response').urgency, 'immediate');
  assert.equal(near.filter((action: any) => action.scenarioId !== null).length, 1);
  assert.equal(near.find((action: any) => action.scenarioId === 'major').urgency, 'soon');
  assert.equal(near.find((action: any) => action.category === 'financial').urgency, 'soon');
  const far = service.personalizeSituation({ ...base, geo: unknown }, personalContext);
  assert.equal(far.find((action: any) => action.headline === 'Template response').urgency, 'soon');
  const watched = service.personalizeSituation({ ...base, geo: { ...point(), countries: ['US'] } }, { ...personalContext, watchlistCountries: ['US'] });
  assert.equal(watched.find((action: any) => action.category === 'financial').urgency, 'immediate');
  assert.equal(watched[0].urgency, 'immediate');
});

function forecastOverlay(situations: Situation[]) {
  return loadService('forecast-overlay', {
    './ema-forecast': { forecastRegions: () => [] },
    './situation-engine': { situationEngine: { getActionableSituations: () => situations } },
  });
}

test('forecast risk circles reject area/display centroids and unknown situation geography', () => {
  for (const geo of [unknown, area, centroid, { ...context, kind: 'country' } as SituationGeo]) {
    assert.equal(forecastOverlay([situation('no-affected-point', geo)]).buildForecastOverlay().length, 0, geo.kind);
  }
});

test('forecast risk circles retain a reported point at zero coordinates', () => {
  const regions = forecastOverlay([situation('zero', point())]).buildForecastOverlay();
  assert.equal(regions.length, 1);
  assert.equal(regions[0].id, 'sit-zero');
  assert.deepEqual(plain(regions[0].center), [0, 0]);
  assert.equal(regions[0].riskScore, 80);
  assert.equal(regions[0].radius, 500);
});
