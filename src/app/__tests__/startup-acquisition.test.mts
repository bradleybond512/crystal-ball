import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createConcurrencyLimiter, type ConcurrencyLimiter } from '../../utils/concurrency-limiter.ts';

const source = readFileSync(new URL('../data-loader.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replaceAll('import.meta.env', 'viteEnv'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function fixture(variant = 'full', overrides: Record<string, unknown> = {}) {
  const facts: string[] = [];
  const scheduling = { waves: 0, running: 0, peak: 0 };
  function measuredLimiter(limit: number): ConcurrencyLimiter {
    const limiter = createConcurrencyLimiter(limit);
    return {
      mapSettled(items, visit) {
        scheduling.waves++;
        return limiter.mapSettled(items, async (item, index) => {
          scheduling.running++;
          scheduling.peak = Math.max(scheduling.running, scheduling.peak);
          try { return await visit(item, index); } finally { scheduling.running--; }
        });
      },
    };
  }
  const document = new EventTarget();
  document.addEventListener('wm:data-refreshed', () => facts.push('published'));
  const deps: Record<string, unknown> = {
    '@/config': { SITE_VARIANT: variant },
    '@/utils': { debounce: () => () => {} },
    '@/utils/concurrency-limiter': { createConcurrencyLimiter: measuredLimiter },
    '@/services/runtime-config': { subscribeRuntimeConfig: () => () => {} },
    '@/services/intelligence/conflict-observation-adapters': { createConflictObservationDeduper: () => () => {} },
    ...overrides,
  };
  const module = {} as typeof import('../data-loader.ts');
  new Function('require', 'exports', 'document', 'viteEnv', compiled)(
    (id: string) => deps[id] ?? {}, module, document, {},
  );
  // Other providers already have active requests. Keep just the controlled leaves eligible.
  class InFlight extends Set<string> {
    override has(name: string) {
      return !['news', 'nwsAlerts', 'shakeAlert', 'fred'].includes(name) || super.has(name);
    }
  }
  const ctx = { panels: {}, mapLayers: {}, isDestroyed: false, inFlight: new InFlight(), newsSnapshot: { bindScope() {} } };
  const loader = new module.DataLoaderManager(ctx as unknown as import('../app-context.ts').AppContext, { renderCriticalBanner() {} });
  const news = deferred();
  const fred = deferred();
  Object.assign(loader, {
    loadNews: () => { facts.push('news'); return news.promise; },
    loadNWSAlerts: async () => { facts.push('nws'); },
    loadShakeAlert: async () => { facts.push('shake'); },
    loadFredData: () => { facts.push('fred'); return fred.promise; },
    updateSearchIndex: () => { facts.push('search'); },
  });
  return { loader, facts, news, fred, ctx, scheduling, document, realNws: module.DataLoaderManager.prototype.loadNWSAlerts.bind(loader) };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('ShakeAlert and NWS start with news held, only for the full variant', async () => {
  for (const variant of ['full', 'tech', 'finance', 'happy']) {
    const { loader, facts, news, fred, scheduling } = fixture(variant);
    const completion = loader.loadAllData();
    await turn();
    assert.ok(facts.includes('news'));
    assert.equal(facts.includes('shake'), variant === 'full', variant);
    assert.equal(facts.includes('nws'), variant === 'full', variant);
    assert.equal(facts.includes('fred'), false);
    news.release();
    fred.release();
    await completion;
    assert.equal(scheduling.waves, 2);
    assert.ok(scheduling.peak <= 12, 'at most twelve simultaneous task slots');
  }
});

test('a reentrant or concurrent refresh joins one complete wave and a later refresh runs again', async () => {
  const { loader, facts, news, fred } = fixture();
  let reentrant!: Promise<void>;
  loader.loadNews = async () => {
    facts.push('news');
    reentrant = loader.loadAllData();
    await news.promise;
  };
  const first = loader.loadAllData();
  const retry = loader.loadAllData();
  await turn();
  assert.equal(retry, first, 'retry joined the current acquisition');
  assert.equal(reentrant, first, 'synchronous producer reentry joined the same acquisition');
  assert.equal(facts.includes('fred'), false);
  news.release();
  await turn();
  assert.ok(facts.includes('fred'));
  assert.equal(facts.includes('published'), false);
  fred.release();
  await first;
  assert.deepEqual(facts.filter((f) => f === 'search' || f === 'published'), ['search', 'published']);
  await loader.loadAllData();
  assert.equal(facts.filter((f) => f === 'news').length, 2);
  assert.equal(facts.filter((f) => f === 'published').length, 2);
});

test('destroying an app during either wave prevents late search or refresh publication', async () => {
  for (const phase of ['critical', 'deferred']) {
    const { loader, facts, news, fred, ctx, scheduling } = fixture();
    const completion = loader.loadAllData();
    await turn();
    if (phase === 'deferred') {
      news.release();
      await turn();
      assert.ok(facts.includes('fred'));
    }
    ctx.isDestroyed = true;
    news.release();
    fred.release();
    await completion;
    assert.equal(facts.includes('search'), false, phase);
    assert.equal(facts.includes('published'), false, phase);
    assert.equal(facts.includes('fred'), phase === 'deferred');
    assert.equal(scheduling.waves, phase === 'critical' ? 1 : 2, 'teardown cannot queue another wave');
  }
});

test('an orchestration failure reaches all waiting callers and leaves a fresh attempt eligible', async () => {
  const { loader, news, fred, facts } = fixture();
  news.release();
  fred.release();
  loader.updateSearchIndex = () => { throw new Error('search offline'); };
  const results = await Promise.allSettled([loader.loadAllData(), loader.loadAllData()]);
  assert.deepEqual(results.map((r) => r.status === 'rejected' && r.reason.message), ['search offline', 'search offline']);
  loader.updateSearchIndex = () => { facts.push('search'); };
  await loader.loadAllData();
  assert.equal(facts.filter((f) => f === 'news').length, 2);
  assert.equal(facts.filter((f) => f === 'published').length, 1);
});

function warningFixture() {
  const published: string[] = [];
  const network = deferred();
  const zones = deferred();
  const enteredZones = deferred();
  const deps = {
    '@/services': {
      getStormPreparednessContext: () => ({ nwsAlerts: [] }),
      updateStormPreparednessContext: () => published.push('storm context'),
      fetchSpcSummary() {}, fetchMarineHazards() {}, fetchExcessiveRainfallOutlooks() {}, fetchWinterWeatherOutlooks() {},
    },
    '@/services/offline-alert-cache': { withOfflineCache: async () => {
      await network.promise;
      return { data: [{ id: 'fixture', event: 'Storm' }], source: 'network' };
    } },
    '@/services/alert-normalizer': { normalizeNWSAlert: (row: unknown) => row },
    '@/services/unified-alerts': { unifiedAlertStore: { ingest: () => published.push('store') } },
    '@/services/weather/warning-verification-bridge': { recordWarningPredictions: () => published.push('prediction') },
    '@/services/weather/weather-warning-router': { routeWeatherAlert: () => ({}) },
    '@/services/saved-places': { getSavedPlaces: () => [{ id: 'home', offlinePinned: true }] },
    '@/services/weather/saved-place-adapter': {
      resolveSavedPlaceZones: async () => { enteredZones.release(); await zones.promise; return new Map(); },
      toMatcherPlace: () => ({}),
    },
    '@/services/lifelines/lifeline-prewarm': { lifelinePrewarmCoordinator: { enqueue: () => published.push('prewarm') } },
  };
  const f = fixture('full', deps);
  Object.assign(f.ctx.panels, { 'nws-alerts': { update: () => published.push('panel') } });
  f.document.addEventListener('cb:storm-decision', () => published.push('storm event'));
  return { ...f, published, network, zones, enteredZones, deps };
}

test('fresh NWS updates ready panels, store, storm event and matched-place prewarm on a live owner', async () => {
  const f = warningFixture();
  const loading = f.realNws();
  f.network.release();
  f.zones.release();
  await loading;
  await turn();
  assert.deepEqual(f.published.sort(), ['panel', 'prediction', 'prewarm', 'store', 'storm context', 'storm event']);
});

test('late NWS acquisition cannot publish to the next app after destroy', async () => {
  const f = warningFixture();
  const loading = f.realNws();
  f.ctx.isDestroyed = true;
  f.network.release();
  f.zones.release();
  await loading;
  await turn();
  assert.deepEqual(f.published, []);
});

test('destroy during saved-place resolution preserves earlier NWS evidence without any late storm state', async () => {
  const f = warningFixture();
  const loading = f.realNws();
  f.network.release();
  await f.enteredZones.promise;
  f.ctx.isDestroyed = true;
  f.zones.release();
  await loading;
  await turn();
  assert.deepEqual(f.published, ['panel', 'store', 'prediction']);
});

test('disposal from a storm event cannot queue a late prewarm or publish context', async () => {
  const f = warningFixture();
  f.document.addEventListener('cb:storm-decision', () => { f.ctx.isDestroyed = true; });
  f.network.release();
  f.zones.release();
  await f.realNws();
  await turn();
  assert.deepEqual(f.published, ['panel', 'store', 'prediction', 'storm event']);
});

test('a disposed NWS owner never resets the panel through its failure fallback', async (t) => {
  const f = warningFixture();
  t.mock.method(console, 'warn', () => {});
  f.deps['@/services'].getStormPreparednessContext = () => { throw new Error('context unavailable'); };
  await f.realNws();
  assert.deepEqual(f.published, ['panel']);
  f.ctx.isDestroyed = true;
  await f.realNws();
  assert.deepEqual(f.published, ['panel']);
});

test('ShakeMap updates its panel only if the owner survives acquisition', async () => {
  const source = readFileSync(new URL('../loaders/cyber.ts', import.meta.url), 'utf8');
  const module = {} as typeof import('../loaders/cyber.ts');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const acquisition = deferred();
  const status = { marker: 1 };
  new Function('require', 'exports', compiled)(
    () => ({ fetchShakemapEvents: async () => { await acquisition.promise; return status; } }), module,
  );
  const updates: unknown[] = [];
  const panels = { shakealert: { update: (value: unknown) => updates.push(value) } };
  const ctx = { panels, isDestroyed: false } as unknown as import('../app-context.ts').AppContext;
  const loading = module.loadShakeAlert(ctx);
  ctx.isDestroyed = true;
  acquisition.release();
  await loading;
  assert.deepEqual(updates, []);
  await module.loadShakeAlert({ ...ctx, isDestroyed: false });
  assert.deepEqual(updates, [status]);
});
