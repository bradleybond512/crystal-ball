import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const loaderText = readFileSync(new URL('../../src/app/data-loader.ts', import.meta.url), 'utf8');
const loaderAst = ts.createSourceFile('data-loader.ts', loaderText, ts.ScriptTarget.Latest, true);
const NOW = Date.now();
function row(id = 'one', expires = NOW + 60_000) {
  return { id, event: 'Flood Warning', severity: 'Severe', headline: 'Flooding', areaDesc: 'Test',
    sent: new Date(NOW - 30_000).toISOString(), expires: new Date(expires).toISOString() };
}
function snapshot(alerts = [row()], observedAt = NOW - 1000, source = 'network') {
  return { data: { schemaVersion: 1, scope: 'national-active', completeness: 'complete', observedAt, alerts },
    source, cachedAt: observedAt, expiresAt: observedAt + 3_600_000, isStale: source !== 'network', staleDurationMs: NOW - observedAt };
}
function harness(result: unknown, { watermark = 0, disposition = 'applied', previous = null as ReturnType<typeof snapshot> | null, expireDuringAncillary = false } = {}) {
  const calls = { reconcile: [] as unknown[], panel: [] as { state: string; alerts: ReturnType<typeof row>[]; observedAt: number | null }[], context: [] as unknown[], ancillary: 0, predictions: 0 };
  const methods: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && ['refreshNWSAlerts', 'publishNwsSnapshot', 'loadNWSAlerts'].includes(node.name.getText(loaderAst))) methods.push(node.getText(loaderAst));
    ts.forEachChild(node, visit);
  }
  visit(loaderAst);
  assert.ok(methods.some(m => m.includes('refreshNWSAlerts()')), 'dedicated NWS refresh must exist');
  const context = { nwsAlerts: [] as ReturnType<typeof row>[], spcSummary: null, marineHazards: [], excessiveRainfallOutlooks: [], winterWeatherOutlooks: [] };
  const bindings = {
    fetchCachedNwsSnapshot: async () => { if (result instanceof Error) throw result; return result; },
    NWS_SNAPSHOT_FRESH_MS: 300_000,
    unifiedAlertStore: {
      getNwsObservedAt: () => watermark || null,
      reconcileNwsSnapshot: (s: unknown) => { calls.reconcile.push(s); return { disposition }; },
      getOperationalNwsAlerts: (s: ReturnType<typeof snapshot>['data']) => s.alerts.filter(a => Date.parse(a.expires) > Date.now()),
    },
    getStormPreparednessContext: () => context,
    updateStormPreparednessContext: (value: unknown) => { calls.context.push(value); Object.assign(context, value); },
    fetchSpcSummary: async () => { calls.ancillary++; return null; },
    fetchMarineHazards: async () => { calls.ancillary++; return []; },
    fetchExcessiveRainfallOutlooks: async () => { calls.ancillary++; return []; },
    fetchWinterWeatherOutlooks: async () => { calls.ancillary++; return []; },
    recordWarningPredictions: () => { calls.predictions++; if (expireDuringAncillary) context.nwsAlerts = []; else throw new Error('stop after boot-owned prediction hook'); },
    nwsAlertMinimal: (a: unknown) => a,
    console: { warn() {} },
  };
  const compiled = ts.transpileModule(`class Subject { ${methods.join('\n')} } return Subject;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const Subject = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  const owner = Object.assign(new Subject(), {
    ctx: { isDestroyed: false, panels: { 'nws-alerts': { updateSnapshot: (s: unknown) => calls.panel.push(s as typeof calls.panel[number]) } } },
    lastNwsSnapshot: previous, nwsAcquisitionFailed: false, lastNwsProjection: null,
  });
  return { calls, owner, context };
}

test('dedicated NWS refresh admits a complete live snapshot without boot ancillary or prediction work', async () => {
  const incoming = snapshot(Array.from({ length: 600 }, (_, i) => row(String(i))));
  const h = harness(incoming);
  await h.owner.refreshNWSAlerts();
  assert.equal(h.calls.reconcile.length, 1);
  assert.equal(h.calls.panel.at(-1).state, 'current');
  assert.equal(h.calls.panel.at(-1).alerts.length, 600);
  assert.equal(h.calls.panel.at(-1).observedAt, incoming.data.observedAt);
  assert.equal(h.calls.ancillary, 0);
  assert.equal(h.calls.predictions, 0);
});

test('offline replay never reconciles or upgrades an older empty snapshot to a national all-clear', async () => {
  const incoming = snapshot([], NOW - 10_000, 'offline-cache');
  const h = harness(incoming, { watermark: NOW - 1000 });
  await h.owner.refreshNWSAlerts();
  assert.equal(h.calls.reconcile.length, 0);
  assert.equal(h.calls.panel.at(-1).state, 'stale');
  assert.equal(h.calls.panel.at(-1).observedAt, NOW - 10_000);
  assert.equal(h.calls.context.length, 0, 'older cache must not clear newer storm context');
});

test('a backend snapshot older than persisted lifecycle watermark is not current despite network success', async () => {
  const incoming = snapshot([], NOW - 10_000);
  const h = harness(incoming, { watermark: NOW - 1000, disposition: 'older' });
  await h.owner.refreshNWSAlerts();
  assert.equal(h.calls.panel.at(-1).state, 'stale');
  assert.equal(h.calls.context.length, 0);
});

test('failed acquisition preserves newer known alerts and degrades the panel', async () => {
  const previous = snapshot([row('known')]);
  const h = harness(new Error('offline'), { previous });
  await h.owner.refreshNWSAlerts();
  assert.equal(h.calls.panel.at(-1).state, 'stale');
  assert.equal(h.calls.panel.at(-1).alerts[0].id, 'known');
  assert.equal(h.calls.reconcile.length, 0);
  const empty = harness(new Error('offline'));
  await empty.owner.refreshNWSAlerts();
  assert.equal(empty.calls.panel.at(-1).state, 'unavailable');
});

test('an older cache cannot replace a newer in-memory snapshot after offline-cache persistence failure', async () => {
  const previous = snapshot([row('known')], NOW - 1000);
  const h = harness(snapshot([], NOW - 10_000, 'offline-cache'), { previous, watermark: NOW - 1000 });
  await h.owner.refreshNWSAlerts();
  assert.equal(h.owner.lastNwsSnapshot, previous);
  assert.equal(h.calls.panel.at(-1).alerts[0].id, 'known');
  assert.equal(h.calls.panel.at(-1).state, 'stale');
});

test('expiry subscription projection removes expired rows without asserting a new complete empty acquisition', () => {
  const h = harness(snapshot(), { previous: snapshot([row('expired', NOW - 1)]) });
  h.owner.publishNwsSnapshot();
  assert.equal(h.calls.panel.at(-1).alerts.length, 0);
  assert.equal(h.calls.panel.at(-1).state, 'stale');
});

test('boot loader retains the four ancillary fetches and prediction hook', async () => {
  const h = harness(snapshot());
  await h.owner.loadNWSAlerts();
  assert.equal(h.calls.ancillary, 4);
  assert.equal(h.calls.predictions, 1);
});

test('App registers only the NWS refresh on a five-minute full-variant, panel-independent cadence', async () => {
  const app = readFileSync(new URL('../../src/App.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('App.ts', app, ts.ScriptTarget.Latest, true);
  let registration = '';
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'name' && p.initializer.getText(ast) === "'nwsAlerts'")) registration = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(registration, 'NWS must have a scheduler registration');
  let refreshCalls = 0;
  const owner = { dataLoader: { refreshNWSAlerts: async () => { refreshCalls++; } }, state: { panels: {}, mapLayers: {} } };
  const compiled = ts.transpileModule(`return (${registration});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const variant of ['full', 'tech']) {
    const scheduled = new Function('SITE_VARIANT', compiled).call(owner, variant);
    assert.equal(scheduled.intervalMs, 300_000);
    assert.equal(scheduled.condition(), variant === 'full');
    if (scheduled.condition()) await scheduled.fn();
  }
  assert.equal(refreshCalls, 1);
});

test('boot ancillary completion cannot restore warnings retired while its saved-place work awaited', async () => {
  const h = harness(snapshot(), { expireDuringAncillary: true });
  await h.owner.loadNWSAlerts();
  assert.equal(h.calls.predictions, 1);
  assert.deepEqual(h.context.nwsAlerts, []);
});

test('invalid reconciliation preserves the last known snapshot and destroyed loaders do not publish', async () => {
  const previous = snapshot([row('known')]);
  const h = harness(snapshot([]), { previous, disposition: 'invalid' });
  await h.owner.refreshNWSAlerts();
  assert.equal(h.owner.lastNwsSnapshot, previous);
  assert.equal(h.calls.panel.at(-1)?.state, 'stale');
  assert.equal(h.calls.panel.at(-1)?.alerts[0]?.id, 'known');
  const destroyed = harness(snapshot());
  destroyed.owner.ctx.isDestroyed = true;
  await destroyed.owner.refreshNWSAlerts();
  destroyed.owner.publishNwsSnapshot();
  assert.deepEqual(destroyed.calls.reconcile, []);
  assert.deepEqual(destroyed.calls.panel, []);
});

test('full loader lifecycle subscription invalidates the view and teardown stops local expiry work', () => {
  let constructor = '';
  let destroy = '';
  function visit(node: ts.Node) {
    if (ts.isConstructorDeclaration(node)) constructor = node.getText(loaderAst);
    if (ts.isMethodDeclaration(node) && node.name.getText(loaderAst) === 'destroy') destroy = node.getText(loaderAst);
    ts.forEachChild(node, visit);
  }
  visit(loaderAst);
  const compiled = ts.transpileModule(`class Subject { ${constructor}\n${destroy}\n publishNwsSnapshot(){ this.published = true; } } return Subject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const variant of ['full', 'tech']) {
    let starts = 0; let stops = 0; let unsubscribed = 0; let callback = () => {};
    const bindings = { SITE_VARIANT: variant, subscribeRuntimeConfig: () => () => {}, stopOrefPolling: () => {},
      unifiedAlertStore: { startNwsLifecycle: () => starts++, stopNwsLifecycle: () => stops++,
        subscribe: (fn: () => void) => { callback = fn; return () => unsubscribed++; } } };
    const Subject = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
    const owner = new Subject({ newsSnapshot: { bindScope() {} } }, {});
    assert.equal(starts, variant === 'full' ? 1 : 0);
    callback();
    assert.equal(Boolean(owner.published), variant === 'full');
    owner.destroy();
    assert.equal(stops, variant === 'full' ? 1 : 0);
    assert.equal(unsubscribed, variant === 'full' ? 1 : 0);
  }
});
