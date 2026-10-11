// Execute the actual loader orchestration without importing the app or providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  __resetDatacenterStateForTests, getDatacenterSite, setDatacenterSite,
  getDatacenterPosture, recomputeDatacenterPosture, markDatacenterPostureStale,
  subscribeDatacenterPosture,
} from '../src/services/datacenter/datacenter-state.ts';
import { resolveSiteZonesBestEffort, siteZoneCacheKey } from '../src/services/datacenter/site-zones.ts';
import type { SiteConfig } from '../src/services/datacenter/datacenter-types.ts';

const source = readFileSync(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('data-loader.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const methods: ts.MethodDeclaration[] = [];
function visit(node: ts.Node): void {
  if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'loadWeatherAlerts') methods.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(methods.length, 1, 'exactly one production loadWeatherAlerts method');
const declarations: ts.VariableStatement[] = [];
function findDeclaration(node: ts.Node): void {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) =>
    ts.isIdentifier(d.name) && d.name.text === 'refreshDatacenterPosture')) declarations.push(node);
  ts.forEachChild(node, findDeclaration);
}
findDeclaration(methods[0]!.body!);
assert.equal(declarations.length, 1, 'exactly one production datacenter closure declaration');
const declaration = declarations[0]!;
assert.equal(declaration.declarationList.declarations.length, 1, 'closure statement has exactly one declaration');
const arrow = declaration.declarationList.declarations[0]!.initializer;
assert.ok(arrow && ts.isArrowFunction(arrow), 'datacenter initializer is the production arrow');
assert.ok(arrow.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword), 'datacenter arrow is async');
assert.equal(arrow.parameters.length, 0, 'datacenter arrow has no parameters');
assert.ok(ts.isBlock(arrow.body), 'datacenter arrow has its complete production block body');
assert.ok(ts.isBlock(declaration.parent), 'closure has a production statement container');
for (let parent: ts.Node = declaration.parent; parent !== methods[0]; parent = parent.parent) {
  assert.ok(!ts.isFunctionLike(parent), 'closure belongs directly to loadWeatherAlerts, not another nested function');
}
const statements = declaration.parent.statements;
const text = declaration.getText(ast);
assert.ok(text.includes('recomputeDatacenterPosture(') && text.includes('markDatacenterPostureStale('), 'whole closure includes recompute and catch');
const invocation = statements[statements.indexOf(declaration) + 1]!;
// Accept the unsafe return-await mutant so its behavioral continuation oracle runs.
assert.ok(ts.isExpressionStatement(invocation) || ts.isReturnStatement(invocation), 'actual awaited invocation statement');
const awaited = invocation.expression;
assert.ok(awaited && ts.isAwaitExpression(awaited), 'production invocation awaits datacenter completion');
const call = awaited.expression;
assert.ok(ts.isCallExpression(call) && ts.isIdentifier(call.expression), 'production invocation calls its named closure');
assert.equal(call.expression.text, 'refreshDatacenterPosture');
assert.equal(call.arguments.length, 0, 'production invocation passes no arguments');
const next = statements[statements.indexOf(declaration) + 2]!;
assert.ok(ts.isVariableStatement(next), 'immediately following invocation statement is a declaration');
assert.equal(next.declarationList.declarations.length, 1);
assert.equal(next.declarationList.declarations[0]!.name.getText(ast), 'weatherTraceIds');
assert.equal(next.declarationList.declarations[0]!.initializer!.getText(ast), 'weatherOccurrenceTraceIds(alerts.map((alert) => alert.id))');
const productionSequence = source.slice(declaration.getStart(ast), next.end);
const compiled = ts.transpileModule(`async function tick() { ${productionSequence} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error), []);
assert.doesNotMatch(compiled.outputText, /\bimport\s*\(/, 'extracted fixture cannot dynamically import app dependencies');
const bindings = ['getDatacenterSite', 'setDatacenterSite', 'resolveSiteZonesBestEffort', '_siteUgcZoneCache',
  'fetchUgcZonesForPoint', 'fetchGridStatus', 'alerts', 'toIsoString', 'fetchOpenMeteoConditions',
  'fetchSite24hForecast', 'fetchSiteAirQuality', 'fetchConnectivitySignal', 'resolveGridInfrastructure',
  'recomputeDatacenterPosture', 'markDatacenterPostureStale', 'weatherOccurrenceTraceIds', 'console'];
const createTick = new Function(...bindings, `${compiled.outputText}\nreturn tick;`);

function site(id: string, extra: Partial<SiteConfig> = {}): SiteConfig {
  return { id, name: id, lat: id === 'A' ? 41.6 : 40, lon: id === 'A' ? -86.7 : -75,
    radiusKm: 25, eiaRegion: id === 'A' ? 'MISO' : 'PJM', ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function ring(lat: number, lon: number) {
  return [[lon - .2, lat - .2], [lon + .2, lat - .2], [lon + .2, lat + .2], [lon - .2, lat + .2]];
}
function alert(zones: string[] = ['PAZ001'], polygonRings?: number[][][]) {
  return { id: 'zone-warning', event: 'Ice Storm Warning', headline: 'fixture warning', severity: 'Severe',
    onset: new Date(Date.now() - 60_000), expires: new Date(Date.now() + 3_600_000), coordinates: [],
    ugcZones: zones, polygonRings };
}
const stages = ['zones', 'grid', 'conditions', 'forecast', 'aq', 'connectivity', 'infrastructure'] as const;
type Stage = typeof stages[number];
function fixture(options: { pause?: Stage; zones?: string[]; failZones?: boolean; alerts?: ReturnType<typeof alert>[];
  cache?: Map<string, string[]>; failInfrastructure?: boolean } = {}) {
  const owner = getDatacenterSite()?.id ?? 'none';
  const isA = owner === 'A';
  const calls: { stage: string; args: unknown[] }[] = [];
  const entered = deferred<void>();
  const held = deferred<any>();
  const cache = options.cache ?? new Map<string, string[]>();
  let traceCalls = 0;
  let staleCalls = 0;
  let recomputeCalls = 0;
  const infrastructure = { marker: `${owner} infrastructure`, plants: [], substations: [], lines: [] };
  const forecast = [{ offsetHours: 1, tempC: isA ? 35 : 11, precipProbabilityPct: 20, weatherCode: 3 }];
  const aq = { usAqi: isA ? 101 : 37, pm25: isA ? 31 : 9 };
  const connectivity = { status: isA ? 'outage' : 'degraded', cloudflare: false, fastly: !isA };
  const conditions = { temperature: isA ? 39 : 17, feelsLike: 16, humidity: 41, windSpeed: 12,
    windDirection: 190, precipitation: 2, uvIndex: 3, weatherCode: 4 };
  const grid = [{ region: 'MISO', utilizationPct: 94, alerts: [] }, { region: 'PJM', utilizationPct: 42, alerts: [] }];
  function provider(stage: Stage, value: unknown, error?: Error) {
    return (...args: unknown[]) => {
      calls.push({ stage, args });
      if (options.pause === stage) { entered.resolve(); return held.promise; }
      return error ? Promise.reject(error) : Promise.resolve(value);
    };
  }
  const values = {
    zones: options.zones ?? ['PAZ001'], grid, conditions, forecast, aq, connectivity, infrastructure,
  };
  const tick = createTick(getDatacenterSite, (nextSite: SiteConfig) => { calls.push({ stage: 'setter', args: [nextSite] }); setDatacenterSite(nextSite); },
    resolveSiteZonesBestEffort, cache,
    provider('zones', values.zones, options.failZones ? new Error('fixture points failure') : undefined),
    provider('grid', grid), options.alerts ?? [alert()], (date: Date) => date.toISOString(),
    provider('conditions', conditions), provider('forecast', forecast), provider('aq', aq), provider('connectivity', connectivity),
    provider('infrastructure', infrastructure, options.failInfrastructure ? new Error('fixture infrastructure failure') : undefined),
    (input: Parameters<typeof recomputeDatacenterPosture>[0]) => { recomputeCalls++; return recomputeDatacenterPosture(input); },
    (label: string) => { staleCalls++; markDatacenterPostureStale(label); },
    (ids: string[]) => { traceCalls++; assert.deepEqual(ids, (options.alerts ?? [alert()]).map((a) => a.id)); return ids; },
    { warn: (...args: unknown[]) => calls.push({ stage: 'warn', args }) });
  const context = { ctx: { intelligenceCache: { earthquakes: [
    { magnitude: 4.2, location: { latitude: 40, longitude: -75 }, place: 'B quake', occurredAt: Date.now() },
    { magnitude: 4.3, location: { latitude: 41.6, longitude: -86.7 }, place: 'A quake', occurredAt: Date.now() },
  ] } }, haversineKm: (lat: number, lon: number, eqLat: number, eqLon: number) => Math.hypot(lat - eqLat, lon - eqLon) * 111 };
  return { run: () => tick.call(context), calls, cache, entered: entered.promise,
    release: () => held.resolve(values[options.pause!]), reject: () => held.reject(new Error('fixture deferred failure')),
    counts: () => ({ traceCalls, staleCalls, recomputeCalls }), values };
}
function stageCalls(f: ReturnType<typeof fixture>) { return f.calls.filter((c) => stages.includes(c.stage as Stage)); }
function assertBInputs(f: ReturnType<typeof fixture>, b: SiteConfig) {
  const p = getDatacenterPosture();
  assert.ok(p, 'fresh B must publish its own real posture');
  assert.equal(p.site, getDatacenterSite());
  assert.equal(p.site.id, b.id);
  assert.deepEqual(p.site.ugcZones, ['PAZ001']);
  assert.equal(p.weather.level, 'critical', 'fresh B own zone-only warning matches through the real matcher');
  assert.ok(!p.staleInputs.includes('weather zones'), 'B own successful resolution is verified');
  assert.equal(p.power.gridUtilizationPct, 42, 'B grid region selected');
  assert.deepEqual(p.conditions, { tempC: 17, feelsLikeC: 16, humidityPct: 41, windSpeedKmh: 12,
    windDirectionDeg: 190, precipMm: 2, uvIndex: 3, weatherCode: 4 });
  assert.deepEqual(p.forecast24h, f.values.forecast);
  assert.deepEqual(p.airQuality, f.values.aq);
  assert.deepEqual(p.connectivity, f.values.connectivity);
  assert.deepEqual(p.gridInfrastructure, f.values.infrastructure);
  assert.deepEqual(p.seismicNearby.map((eq) => eq.place), ['B quake']);
  for (const call of stageCalls(f).filter((c) => !['grid', 'connectivity'].includes(c.stage))) {
    assert.deepEqual(call.args, [b.lat, b.lon], `${call.stage} uses B coordinates`);
  }
  assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 1 });
}
async function freshB(b: SiteConfig) {
  const f = fixture(); await f.run(); assertBInputs(f, b);
}

for (const result of ['success', 'failure', 'empty'] as const) {
  test(`G1 discards old A zone ${result}; fresh B gets its own zone-only warning`, async () => {
    __resetDatacenterStateForTests();
    const a = site('A'); const b = site('B'); setDatacenterSite(a);
    const f = fixture({ pause: 'zones', zones: result === 'empty' ? [] : ['INZ003'] });
    const pending = f.run(); await f.entered;
    setDatacenterSite(b); result === 'failure' ? f.reject() : f.release(); await pending;
    assert.equal(getDatacenterSite(), b); assert.equal(b.ugcZones, undefined);
    assert.equal(getDatacenterPosture(), null);
    assert.deepEqual(stageCalls(f).map((c) => c.stage), ['zones'], 'G1 starts no later A providers');
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
    assert.equal(f.cache.has(siteZoneCacheKey(a)), result !== 'failure', 'geographic success only may cache A');
    await freshB(b);
  });
}
for (const boundary of ['grid', 'conditions', 'forecast', 'aq', 'connectivity', 'infrastructure'] as const) {
  test(`ownership loss during ${boundary} discards A and stops its next provider stage`, async () => {
    __resetDatacenterStateForTests();
    const a = site('A', { ugcZones: ['INZ003'] }); const b = site('B'); setDatacenterSite(a);
    const f = fixture({ pause: boundary }); const pending = f.run(); await f.entered; setDatacenterSite(b); f.release(); await pending;
    assert.equal(getDatacenterSite(), b); assert.equal(getDatacenterPosture(), null);
    const expected = boundary === 'grid' ? ['grid'] : boundary === 'infrastructure'
      ? ['grid', 'conditions', 'forecast', 'aq', 'connectivity', 'infrastructure']
      : ['grid', 'conditions', 'forecast', 'aq', 'connectivity'];
    assert.deepEqual(stageCalls(f).map((c) => c.stage), expected, `${boundary} checkpoint starts no next A stage`);
    for (const call of stageCalls(f).filter((c) => !['grid', 'connectivity'].includes(c.stage))) assert.deepEqual(call.args, [a.lat, a.lon]);
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
    await freshB(b);
  });
}
for (const [name, edit] of [
  ['same ID relocated', { lat: 39, lon: -74 }], ['same ID renamed', { name: 'edited' }],
  ['same ID radius edited', { radiusKm: 80 }], ['same ID region edited', { eiaRegion: 'PJM' }],
  ['different ID same coordinates', { id: 'B' }],
] as const) {
  test(`reference ownership rejects ${name}`, async () => {
    __resetDatacenterStateForTests(); const a = site('A'); const replacement = { ...a, ...edit } as SiteConfig; setDatacenterSite(a);
    const f = fixture({ pause: 'zones', zones: ['INZ003'] }); const pending = f.run(); await f.entered;
    setDatacenterSite(replacement); f.release(); await pending;
    assert.equal(getDatacenterSite(), replacement); assert.equal(replacement.ugcZones, undefined);
    assert.equal(getDatacenterPosture(), null); assert.deepEqual(stageCalls(f).map((c) => c.stage), ['zones']);
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
  });
}
test('removal and repeated A to B to C switches discard old work and continue weather', async () => {
  for (const remove of [true, false]) {
    __resetDatacenterStateForTests(); setDatacenterSite(site('A'));
    const f = fixture({ pause: 'zones' }); const pending = f.run(); await f.entered;
    setDatacenterSite(site('B')); const c = remove ? null : site('C'); setDatacenterSite(c); f.release(); await pending;
    assert.equal(getDatacenterSite(), c); assert.equal(getDatacenterPosture(), null);
    assert.deepEqual(stageCalls(f).map((call) => call.stage), ['zones']);
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
  }
  __resetDatacenterStateForTests(); const f = fixture(); await f.run();
  assert.deepEqual(stageCalls(f), []); assert.equal(f.counts().traceCalls, 1, 'null site continues real weather statement');
});
test('G2 synchronous enrichment subscriber replacement prevents further A providers', async () => {
  __resetDatacenterStateForTests(); const a = site('A'); const b = site('B'); setDatacenterSite(a);
  const unsubscribe = subscribeDatacenterPosture(() => { if (getDatacenterSite()?.id === 'A') setDatacenterSite(b); });
  try {
    const f = fixture({ zones: ['INZ003'] }); await f.run();
    assert.equal(getDatacenterSite(), b); assert.equal(b.ugcZones, undefined); assert.equal(getDatacenterPosture(), null);
    assert.deepEqual(stageCalls(f).map((c) => c.stage), ['zones']);
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
  } finally { unsubscribe(); }
});
test('owned enrichment is adopted before a synchronous subscriber throws', async () => {
  __resetDatacenterStateForTests(); const a = site('A'); setDatacenterSite(a);
  const unsubscribe = subscribeDatacenterPosture(() => { throw new Error('fixture listener'); });
  try {
    const f = fixture({ zones: ['INZ003'] }); await f.run();
    assert.notEqual(getDatacenterSite(), a); assert.deepEqual(getDatacenterSite()?.ugcZones, ['INZ003']);
    assert.equal(getDatacenterPosture(), null);
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 1, recomputeCalls: 0 }, 'catch still owns its exact enrichment');
    assert.deepEqual(stageCalls(f).map((c) => c.stage), ['zones']);
  } finally { unsubscribe(); }
});
test('G6 old A infrastructure rejection cannot stale or emit over a newer B posture', async () => {
  __resetDatacenterStateForTests(); setDatacenterSite(site('A', { ugcZones: ['INZ003'] }));
  const old = fixture({ pause: 'infrastructure' }); const pending = old.run(); await old.entered;
  const b = site('B'); setDatacenterSite(b); await freshB(b);
  const posture = getDatacenterPosture(); const stale = [...posture!.staleInputs]; let events = 0;
  const unsubscribe = subscribeDatacenterPosture(() => events++);
  try {
    old.reject(); await pending;
    assert.equal(getDatacenterPosture(), posture); assert.deepEqual(posture!.staleInputs, stale); assert.equal(events, 0);
    assert.deepEqual(old.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
  } finally { unsubscribe(); }
});
test('owned non-zone catch marks prior posture stale once, emits once, and next success clears it', async () => {
  __resetDatacenterStateForTests(); const a = site('A', { ugcZones: ['INZ003'] }); setDatacenterSite(a);
  await fixture({ alerts: [] }).run(); const prior = getDatacenterPosture();
  assert.ok(prior, 'owned stable computation publishes the prior posture before catch');
  let events = 0;
  const unsubscribe = subscribeDatacenterPosture(() => events++);
  try {
    const failed = fixture({ failInfrastructure: true }); await failed.run();
    assert.ok(getDatacenterPosture(), 'owned failure retains a posture to mark stale');
    assert.notEqual(getDatacenterPosture(), prior);
    assert.ok(getDatacenterPosture()!.staleInputs.includes('posture recompute failed')); assert.equal(events, 1);
    await failed.run(); assert.equal(events, 1, 'stale label deduplication emits once');
    assert.deepEqual(failed.counts(), { traceCalls: 2, staleCalls: 2, recomputeCalls: 0 });
    await fixture({ alerts: [] }).run(); assert.equal(events, 2);
    assert.ok(getDatacenterPosture(), 'next owned success republishes posture and clears stale label');
    assert.ok(!getDatacenterPosture()!.staleInputs.includes('posture recompute failed'));
  } finally { unsubscribe(); }
});
test('fresh B failed zones exposes uncertainty, retains second polygon ring warning, and retries', async () => {
  __resetDatacenterStateForTests(); const b = site('B'); setDatacenterSite(b);
  const polygons = [ring(10, 10), ring(b.lat, b.lon)];
  const cache = new Map<string, string[]>();
  const failed = fixture({ failZones: true, cache, alerts: [alert([], polygons)] }); await failed.run();
  assert.ok(getDatacenterPosture(), 'failed zone lookup still publishes the polygon warning posture');
  assert.equal(getDatacenterPosture()!.site, b); assert.equal(getDatacenterPosture()!.weather.level, 'critical');
  assert.ok(getDatacenterPosture()!.staleInputs.includes('weather zones')); assert.equal(cache.size, 0);
  assert.deepEqual(failed.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 1 });
  const success = fixture({ cache }); await success.run(); assertBInputs(success, b);
  assert.equal(stageCalls(success).filter((c) => c.stage === 'zones').length, 1, 'failed lookup retried');
});
test('legacy single polygon coordinates still match after failed zone lookup', async () => {
  __resetDatacenterStateForTests(); const b = site('B'); setDatacenterSite(b);
  const warning = { ...alert([]), coordinates: ring(b.lat, b.lon) };
  const f = fixture({ failZones: true, alerts: [warning] }); await f.run();
  assert.ok(getDatacenterPosture(), 'failed zones still publish the legacy polygon warning posture');
  assert.equal(getDatacenterPosture()!.weather.level, 'critical'); assert.ok(getDatacenterPosture()!.staleInputs.includes('weather zones'));
  assert.equal(f.counts().traceCalls, 1);
});
for (const mode of ['enrich', 'own', 'own empty', 'cached', 'cached empty', 'resolved empty', 'zero coordinates'] as const) {
  test(`stable ${mode} computes real posture with authoritative zone and cache semantics`, async () => {
    __resetDatacenterStateForTests(); const a = site('A', mode === 'own' ? { ugcZones: ['INZ003'] }
      : mode === 'own empty' ? { ugcZones: [] } : mode === 'zero coordinates' ? { lat: 0, lon: 0 } : {});
    setDatacenterSite(a); const cache = new Map<string, string[]>();
    if (mode.startsWith('cached')) cache.set(siteZoneCacheKey(a), mode === 'cached empty' ? [] : ['INZ003']);
    const f = fixture({ zones: mode === 'resolved empty' ? [] : ['INZ003'], cache, alerts: [] }); await f.run();
    const p = getDatacenterPosture();
    assert.ok(p, `stable ${mode} must publish its owned posture`);
    assert.equal(p.site, getDatacenterSite()); assert.equal(p.site.id, a.id);
    assert.equal(p.overall, 'warning', 'owned MISO grid input reaches real power posture');
    assert.ok(!p.staleInputs.includes('weather zones')); assert.equal(p.power.gridUtilizationPct, 94);
    const fetchExpected = ['enrich', 'resolved empty', 'zero coordinates'].includes(mode);
    assert.equal(stageCalls(f).filter((c) => c.stage === 'zones').length, fetchExpected ? 1 : 0);
    assert.equal(f.calls.filter((c) => c.stage === 'setter').length, ['own', 'own empty', 'cached empty', 'resolved empty'].includes(mode) ? 0 : 1);
    assert.deepEqual(f.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 1 });
    if (mode === 'resolved empty') {
      assert.deepEqual(cache.get(siteZoneCacheKey(a)), []);
      assert.equal(p.site, a, 'successful empty resolution requires no enrichment');
    }
    if (mode === 'zero coordinates') assert.deepEqual(stageCalls(f)[0]!.args, [0, 0]);
    const repeat = fixture({ cache, alerts: [] }); await repeat.run();
    assert.equal(stageCalls(repeat).filter((c) => c.stage === 'zones').length, 0, 'stable own/cached response avoids another lookup');
  });
}

test('G5 delayed successful A infrastructure cannot replace computed B outputs or emit', async () => {
  __resetDatacenterStateForTests(); setDatacenterSite(site('A', { ugcZones: ['INZ003'] }));
  const old = fixture({ pause: 'infrastructure' }); const pending = old.run(); await old.entered;
  const b = site('B'); setDatacenterSite(b); const current = fixture(); await current.run(); assertBInputs(current, b);
  assert.notDeepEqual(old.values.conditions, current.values.conditions);
  assert.notDeepEqual(old.values.forecast, current.values.forecast);
  assert.notDeepEqual(old.values.aq, current.values.aq);
  assert.notDeepEqual(old.values.connectivity, current.values.connectivity);
  assert.notDeepEqual(old.values.infrastructure, current.values.infrastructure);
  const posture = getDatacenterPosture(); let events = 0;
  const unsubscribe = subscribeDatacenterPosture(() => events++);
  try {
    old.release(); await pending; assert.equal(getDatacenterPosture(), posture); assert.equal(events, 0);
    assertBInputs(current, b);
    assert.deepEqual(old.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 0 });
  } finally { unsubscribe(); }
});

test('nonnull subscriber failures during publish and stale notification remain contained and continue weather', async () => {
  __resetDatacenterStateForTests();
  const a = site('A', { ugcZones: ['INZ003'] }); setDatacenterSite(a);
  const events: NonNullable<ReturnType<typeof getDatacenterPosture>>[] = [];
  const unsubscribe = subscribeDatacenterPosture((posture) => {
    if (posture) { events.push(posture); throw new Error('fixture persistent nonnull publication subscriber'); }
  });
  try {
    const f = fixture({ alerts: [alert(['INZ003'])] });
    for (const tick of [1, 2]) {
      await assert.doesNotReject(f.run(), 'datacenter publication/stale subscriber failures must remain locally contained');
      assert.deepEqual(f.counts(), { traceCalls: tick, staleCalls: tick, recomputeCalls: tick },
        'each publication failure must still execute the real next weather statement once');
      assert.equal(events.length, tick * 2, 'each tick emits the fresh posture then its stale clone');
      const fresh = events[(tick - 1) * 2]!; const stale = events[(tick - 1) * 2 + 1]!;
      const current = getDatacenterPosture();
      assert.ok(current, 'contained subscriber failure retains the real published posture');
      assert.equal(fresh.site, a); assert.equal(stale.site, a); assert.equal(getDatacenterSite(), a);
      assert.ok(!fresh.staleInputs.includes('posture recompute failed'), 'each fresh recompute clears the failure label before notification');
      assert.equal(stale, current);
      assert.deepEqual(stale, { ...fresh, staleInputs: [...fresh.staleInputs, 'posture recompute failed'] },
        'stale marking retains all real published warning and input data');
      assert.equal(current.staleInputs.filter((label) => label === 'posture recompute failed').length, 1);
      assert.equal(current.weather.level, 'critical', 'owned zone-only warning survives both subscriber throws');
      assert.equal(current.power.gridUtilizationPct, 94);
      assert.equal(current.conditions?.tempC, 39);
      assert.deepEqual(current.forecast24h, f.values.forecast);
      assert.deepEqual(current.airQuality, f.values.aq);
      assert.deepEqual(current.connectivity, f.values.connectivity);
      assert.deepEqual(current.gridInfrastructure, f.values.infrastructure);
      assert.deepEqual(current.seismicNearby.map((eq) => eq.place), ['A quake']);
      assert.deepEqual(stageCalls(f).map((call) => call.stage),
        Array.from({ length: tick }, () => ['grid', 'conditions', 'forecast', 'aq', 'connectivity', 'infrastructure']).flat());
    }
    unsubscribe();
    const success = fixture({ alerts: [alert(['INZ003'])] }); await success.run();
    const recovered = getDatacenterPosture();
    assert.ok(recovered, 'success after unsubscribing republishes the real posture');
    assert.ok(!recovered.staleInputs.includes('posture recompute failed'));
    assert.equal(events.length, 4, 'unsubscribed throwing listener receives no recovery event');
    assert.deepEqual(success.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 1 });
  } finally { unsubscribe(); __resetDatacenterStateForTests(); }
});

test('nonnull subscriber failure while marking a prior posture stale preserves it and continues weather', async () => {
  __resetDatacenterStateForTests();
  const a = site('A', { ugcZones: ['INZ003'] }); setDatacenterSite(a);
  await fixture({ alerts: [alert(['INZ003'])] }).run();
  const prior = getDatacenterPosture();
  assert.ok(prior, 'successful seed publishes the real owned prior posture');
  const events: NonNullable<ReturnType<typeof getDatacenterPosture>>[] = [];
  const unsubscribe = subscribeDatacenterPosture((posture) => {
    if (posture) { events.push(posture); throw new Error('fixture persistent nonnull stale subscriber'); }
  });
  try {
    const failed = fixture({ failInfrastructure: true });
    await assert.doesNotReject(failed.run(), 'owned stale notification failure must not reject the weather tick');
    const stale = getDatacenterPosture();
    assert.ok(stale, 'contained stale notification retains the prior posture');
    assert.notEqual(stale, prior); assert.equal(stale.site, a); assert.equal(getDatacenterSite(), a);
    assert.deepEqual(stale, { ...prior, staleInputs: [...prior.staleInputs, 'posture recompute failed'] },
      'stale clone retains every prior real warning, input, and timestamp');
    assert.equal(stale.staleInputs.filter((label) => label === 'posture recompute failed').length, 1);
    assert.deepEqual(events, [stale], 'first failed stale notification emits its committed clone once');
    assert.deepEqual(failed.counts(), { traceCalls: 1, staleCalls: 1, recomputeCalls: 0 },
      'first infrastructure failure still executes the real next weather statement once');
    await assert.doesNotReject(failed.run(), 'repeated owned stale notification failure must not reject the weather tick');
    assert.equal(getDatacenterPosture(), stale, 'repeated failure deduplicates the existing label without a new clone');
    assert.deepEqual(events, [stale], 'repeated failure with throwing listener emits no extra event');
    assert.deepEqual(failed.counts(), { traceCalls: 2, staleCalls: 2, recomputeCalls: 0 });
    assert.deepEqual(stageCalls(failed).map((call) => call.stage),
      Array.from({ length: 2 }, () => ['grid', 'conditions', 'forecast', 'aq', 'connectivity', 'infrastructure']).flat());
    unsubscribe();
    const success = fixture({ alerts: [alert(['INZ003'])] }); await success.run();
    const recovered = getDatacenterPosture();
    assert.ok(recovered, 'success after unsubscribing clears the prior failure label');
    assert.ok(!recovered.staleInputs.includes('posture recompute failed'));
    assert.equal(events.length, 1, 'unsubscribed throwing listener receives no recovery event');
    assert.deepEqual(success.counts(), { traceCalls: 1, staleCalls: 0, recomputeCalls: 1 });
  } finally { unsubscribe(); __resetDatacenterStateForTests(); }
});
