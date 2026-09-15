import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';
import { projectDigestStories } from '../src/services/digest-alert-projection.ts';
import { DigestOverlay } from '../src/components/DigestOverlay.ts';

const layout = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
const faaService = readFileSync(new URL('../src/services/faa-cameras.ts', import.meta.url), 'utf8');
const faa = readFileSync(new URL('../src/components/FAAWeatherCamsPanel.ts', import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-14T12:00:00Z');
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
function execute(source, bindings, owner = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), compiled).call(owner, ...Object.values(bindings));
}
function environment() {
  const win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent']) {
    globalThis[key] = key === 'window' ? win : win[key];
  }
  return win;
}
function nws(id = 'nws', expires = NOW + 1000, retrievedAt = NOW) {
  return { id, source: 'nws', spatialScope: { kind: 'area' }, raw: {
    status: 'Actual', messageType: 'Alert', sent: new Date(NOW - 1000).toISOString(),
    onset: new Date(NOW - 1000).toISOString(), expires: new Date(expires).toISOString(), retrievedAt,
    geometry: { type: 'Polygon', coordinates: [[[10,10],[11,10],[11,11],[10,11],[10,10]]] },
  } };
}
function digestHarness(alerts = [nws()]) {
  const win = environment();
  let now = NOW;
  let nextId = 0;
  const timers = new Map();
  win.setTimeout = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  const owner = { digestGeneration: 0, digestSeeds: [], destroyed: false };
  const subscriptions = new Set();
  const visibilityListeners = new Set();
  const addListener = win.document.addEventListener.bind(win.document);
  const removeListener = win.document.removeEventListener.bind(win.document);
  win.document.addEventListener = (type, listener, ...options) => {
    if (type === 'visibilitychange') visibilityListeners.add(listener);
    addListener(type, listener, ...options);
  };
  win.document.removeEventListener = (type, listener, ...options) => {
    if (type === 'visibilitychange') visibilityListeners.delete(listener);
    removeListener(type, listener, ...options);
  };
  let calls = 0;
  let result = [{ id: 'story', alertIds: alerts.map(a => a.id), headline: 'Weather', narrative: 'Conditions' }];
  const start = layout.indexOf('this.digestOverlay = new DigestOverlay');
  const end = layout.indexOf('// Mount Today view', start);
  assert.ok(start > 0 && end > start);
  execute(layout.slice(start, end), {
    DigestOverlay, projectDigestStories, document: win.document, window: win,
    Date: { now: () => now }, AbortController,
    unifiedAlertStore: { getAll: () => alerts, subscribe: fn => { subscriptions.add(fn); return () => subscriptions.delete(fn); } },
    getSavedPlaces: () => [{ id: 'home', name: 'Home', lat: 0, lon: 0, radiusKm: 20 }],
    subscribeSavedPlaces: fn => { subscriptions.add(fn); return () => subscriptions.delete(fn); },
    shouldShowDigest: () => false, markDigestShown: () => {},
    generateDigest: () => { calls += 1; return result instanceof Error ? Promise.reject(result) : Promise.resolve(result); },
    console: { warn: () => {} },
  }, owner);
  return {
    win, owner, timers, subscriptions, visibilityListeners,
    get calls() { return calls; },
    async open() { win.document.dispatchEvent(new win.Event('cb:show-digest')); await settle(); },
    text() { return win.document.querySelector('[data-digest-impact]')?.textContent ?? ''; },
    setResult(value) { result = value; },
    notify() { for (const fn of subscriptions) fn(); },
    advance(value, fire = true) {
      now = value;
      if (fire) for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    close() { win.document.querySelector('.digest-close').click(); },
    destroy() {
      owner.destroyed = true;
      const cleanupStart = layout.indexOf('this.cancelScheduledDigest?.()');
      const cleanupEnd = layout.indexOf('// Clean up datacenter strip', cleanupStart);
      execute(layout.slice(cleanupStart, cleanupEnd), { document: win.document, window: win }, owner);
    },
  };
}

test('open digest expires locally without another request or store event', async () => {
  const h = digestHarness();
  await h.open();
  assert.match(h.text(), /No reported overlap/);
  h.advance(NOW + 1000);
  assert.match(h.text(), /Unknown/);
  assert.equal(h.calls, 1);
  assert.equal(h.timers.size, 0);
  h.destroy();
});

test('timer preserves modal focus and scroll position while refreshing an open digest', async () => {
  const h = digestHarness();
  await h.open();
  const close = h.win.document.querySelector('.digest-close');
  close.focus();
  const body = h.win.document.querySelector('.digest-body');
  body.scrollTop = 42;
  h.advance(NOW + 1000);
  assert.equal(h.win.document.activeElement === close, true);
  assert.equal(body.scrollTop, 42);
  assert.match(h.text(), /Unknown/);
  h.destroy();
});

test('retrieval freshness uses its inclusive boundary then turns unknown', async () => {
  const h = digestHarness([nws('nws', NOW + 60 * 60_000)]);
  await h.open();
  h.advance(NOW + 30 * 60_000);
  assert.match(h.text(), /No reported overlap/);
  h.advance(NOW + 30 * 60_000 + 1);
  assert.match(h.text(), /Unknown/);
  assert.equal(h.calls, 1);
  h.destroy();
});

test('earliest member boundary replaces one timer and delayed callbacks do not loop', async () => {
  const h = digestHarness([nws('a', NOW + 1000), nws('b', NOW + 2000)]);
  await h.open();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].at, NOW + 1000);
  h.notify();
  assert.equal(h.timers.size, 1);
  h.advance(NOW + 1000);
  assert.match(h.text(), /Unknown/);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].at, NOW + 2000);
  h.advance(NOW + 5000);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls, 1);
  h.destroy();
});

test('member containers and new alert evidence replace the earliest pending boundary', async () => {
  const alerts = [
    { id: 'combined', source: 'correlation', spatialScope: { kind: 'members' }, correlationMembers: ['early', 'later'] },
    nws('early', NOW + 500), nws('later', NOW + 5000),
  ];
  const h = digestHarness(alerts);
  await h.open();
  assert.equal([...h.timers.values()][0].at, NOW + 500);
  alerts[1] = nws('early', NOW + 8000);
  h.notify();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].at, NOW + 5000);
  h.advance(NOW + 500);
  assert.match(h.text(), /No reported overlap/);
  assert.equal(h.calls, 1);
  h.destroy();
});

test('generation replacement and dismissal leave a late model completion inert', async () => {
  const h = digestHarness();
  await h.open();
  let resolve;
  h.setResult(new Promise(done => { resolve = done; }));
  h.win.document.dispatchEvent(new h.win.Event('cb:show-digest'));
  assert.equal(h.timers.size, 0);
  h.close();
  resolve([{ id: 'late', alertIds: ['nws'], headline: 'Late', narrative: 'Late' }]);
  await settle();
  assert.equal(h.owner.digestOverlay.isVisible(), false);
  assert.equal(h.timers.size, 0);
  h.destroy();
});

test('dismissal, reopen, empty, error and destruction release temporal work', async () => {
  const h = digestHarness();
  await h.open();
  assert.equal(h.timers.size, 1);
  h.close();
  assert.equal(h.timers.size, 0);
  await h.open();
  assert.equal(h.timers.size, 1);
  h.setResult([]);
  await h.open();
  assert.equal(h.timers.size, 0);
  h.setResult(new Error('unavailable'));
  await h.open();
  assert.equal(h.timers.size, 0);
  h.setResult([{ id: 'story', alertIds: ['nws'], headline: 'Weather', narrative: 'Conditions' }]);
  await h.open();
  h.destroy();
  assert.equal(h.timers.size, 0);
  assert.equal(h.subscriptions.size, 0);
  assert.equal(h.visibilityListeners.size, 0);
  h.win.document.dispatchEvent(new h.win.Event('visibilitychange'));
  assert.equal(h.timers.size, 0);
});

test('document resume refreshes evidence after a suspended timer', async () => {
  const h = digestHarness();
  await h.open();
  h.advance(NOW + 2000, false);
  Object.defineProperty(h.win.document, 'visibilityState', { value: 'visible', configurable: true });
  h.win.document.dispatchEvent(new h.win.Event('visibilitychange'));
  assert.match(h.text(), /Unknown/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls, 1);
  h.destroy();
});

function faaHarness(actualCameraService = false) {
  const win = environment();
  const content = win.document.createElement('div');
  win.document.body.append(content);
  const camera = { id: 'cam', name: 'Working camera', state: 'IL', category: 'weather', imageUrl: '/image', lastUpdated: new Date(NOW).toISOString() };
  let sources = [[camera], [], []];
  let now = NOW;
  let httpFailure = false;
  let networkFailure = false;
  let cameraState = { status: 'fresh', lastUpdate: new Date(now), lastError: null };
  const dataFreshness = {
    getSource: () => cameraState,
    recordUpdate: () => { cameraState = { status: 'fresh', lastUpdate: new Date(now), lastError: null }; },
    recordError: (_id, error) => { cameraState = { ...cameraState, status: 'error', lastError: error }; },
  };
  const realCameraService = actualCameraService ? execute(
    `${faaService.replace(/^import .*?;\n/gms, '').replaceAll('export ', '')}\nreturn { fetchFAACameras, scoreCamerasAgainstAlerts };`, {
      getApiBaseUrl: () => '', dataFreshness, Date: class extends Date { static now() { return now; } }, AbortSignal,
      fetch: async () => {
        if (networkFailure) throw new Error('network unavailable');
        return { ok: !httpFailure, status: httpFailure ? 503 : 200, json: async () => sources[0] };
      },
    }) : null;
  const scored = [];
  class Panel {
    getContentElement() { return content; }
    setDataBadge(state, detail) { content.dataset.badge = `${state} ${detail ?? ''}`; }
    showLoading(message) { content.textContent = message; }
    destroy() {}
  }
  const source = faa.replace(/^import .*?;\n/gms, '').replace('export class ', 'class ');
  const Constructor = execute(`${source}\nreturn FAAWeatherCamsPanel;`, {
    Panel, document: win.document,
    fetchFAACameras: realCameraService?.fetchFAACameras ?? (() => sources[0] instanceof Error ? Promise.reject(sources[0]) : Promise.resolve(sources[0])),
    dataFreshness,
    fetchNWSAlerts: () => sources[1] instanceof Error ? Promise.reject(sources[1]) : Promise.resolve(sources[1]),
    fetchGDACSEventsTracked: () => sources[2] instanceof Error ? Promise.reject(sources[2])
      : Promise.resolve(Array.isArray(sources[2]) ? { events: sources[2], dataState: { mode: 'live' } } : sources[2]),
    scoreCamerasAgainstAlerts: realCameraService?.scoreCamerasAgainstAlerts ?? ((raw, nwsAlerts, gdacs) => {
      scored.push({ raw, nwsAlerts, gdacs });
      return raw.map(c => ({ ...c, alertProximityMi: gdacs.length ? 1 : null, alertLabel: gdacs.length ? 'Flood' : null, relevanceScore: 1 }));
    }),
    flightRuleColor: () => '',
  });
  return {
    content, scored, camera, create() { return new Constructor(); }, setSources(value) { sources = value; },
    advance(ms) { now += ms; },
    failHttp(value) { httpFailure = value; },
    failNetwork(value) { networkFailure = value; },
    setHealth(value) { cameraState = value; },
  };
}

test('successful cameras and GDACS survive rejected NWS enrichment and recover', async () => {
  const h = faaHarness();
  h.setSources([[h.camera], new Error('NWS down'), [{ id: 'flood' }]]);
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  assert.match(h.content.textContent, /Flood/);
  assert.match(h.content.textContent, /NWS.*unavailable/);
  assert.deepEqual(h.scored.at(-1).nwsAlerts, []);
  h.setSources([[h.camera], [], []]);
  panel.refresh();
  await settle();
  assert.doesNotMatch(h.content.textContent, /unavailable/);
  panel.destroy();
});

test('alert-only empty state admits incomplete evidence', async () => {
  const h = faaHarness();
  h.setSources([[h.camera], new Error('NWS down'), new Error('GDACS down')]);
  const panel = h.create();
  await settle();
  const toggle = h.content.querySelector('input');
  assert.ok(toggle);
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change'));
  assert.match(h.content.textContent, /NWS.*GDACS.*unavailable/);
  assert.match(h.content.textContent, /available alert evidence/);
  assert.doesNotMatch(h.content.textContent, /No cameras near active alerts/);
  panel.destroy();
});

test('camera failure keeps previous rows and marks them stale, including refresh failure', async () => {
  const h = faaHarness();
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  h.setSources([new Error('Camera down'), [], []]);
  panel.refresh();
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  assert.match(h.content.textContent, /Camera.*unavailable.*stale/);
  assert.match(h.content.dataset.badge, /unavailable/);
  panel.destroy();
});

test('first camera failure visibly ends loading with unavailable evidence', async () => {
  const h = faaHarness();
  h.setSources([new Error('Camera down'), [], []]);
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /Camera.*unavailable/);
  assert.doesNotMatch(h.content.textContent, /Loading/);
  panel.destroy();
});


test('camera load completions after a newer refresh or destruction stay inert', async () => {
  const h = faaHarness();
  let resolve;
  h.setSources([new Promise(done => { resolve = done; }), [], []]);
  const panel = h.create();
  h.setSources([[{ ...h.camera, name: 'Latest camera' }], [], []]);
  panel.refresh();
  await settle();
  assert.match(h.content.textContent, /Latest camera/);
  resolve([h.camera]);
  await settle();
  assert.match(h.content.textContent, /Latest camera/);
  let resolveAfterDestroy;
  h.setSources([new Promise(done => { resolveAfterDestroy = done; }), [], []]);
  panel.refresh();
  panel.destroy();
  resolveAfterDestroy([{ ...h.camera, name: 'Destroyed camera' }]);
  await settle();
  assert.doesNotMatch(h.content.textContent, /Destroyed camera/);
});


test('actual FAA HTTP and network failures retain stale rows and genuine recovery clears warning', async () => {
  const h = faaHarness(true);
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  h.advance(16 * 60_000);
  h.failHttp(true);
  panel.refresh();
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  assert.match(h.content.textContent, /Camera refresh unavailable.*stale/);
  assert.match(h.content.dataset.badge, /cached/);
  h.failHttp(false);
  h.failNetwork(true);
  panel.refresh();
  await settle();
  assert.match(h.content.textContent, /Camera refresh unavailable.*stale/);
  h.failNetwork(false);
  panel.refresh();
  await settle();
  assert.doesNotMatch(h.content.textContent, /unavailable|stale/);
  panel.destroy();
});

test('actual first-load FAA empty failure is unavailable, not a successful empty refresh', async () => {
  const h = faaHarness(true);
  h.setHealth({ status: 'no_data', lastUpdate: null, lastError: null });
  h.failHttp(true);
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /Camera data unavailable/);
  assert.match(h.content.dataset.badge, /unavailable/);
  panel.destroy();
});

test('GDACS tracked unavailable and cached results qualify the alert-only view', async () => {
  const h = faaHarness();
  h.setSources([[h.camera], [], { events: [], dataState: { mode: 'unavailable' } }]);
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /GDACS alert evidence unavailable/);
  h.setSources([[h.camera], [], { events: [{ id: 'old-flood' }], dataState: { mode: 'cached' } }]);
  panel.refresh();
  await settle();
  assert.match(h.content.textContent, /GDACS alert evidence is cached/);
  assert.deepEqual(h.scored.at(-1).gdacs, []);
  const toggle = h.content.querySelector('input');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change'));
  assert.match(h.content.textContent, /available alert evidence/);
  panel.destroy();
});


test('camera provenance is snapshotted before slower enrichment can mutate shared health', async () => {
  const h = faaHarness();
  let finishGdacs;
  h.setSources([[h.camera], [], new Promise(resolve => { finishGdacs = resolve; })]);
  const panel = h.create();
  await settle();
  h.setHealth({ status: 'error', lastUpdate: new Date(NOW), lastError: 'another request failed' });
  finishGdacs({ events: [], dataState: { mode: 'live' } });
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  assert.doesNotMatch(h.content.textContent, /Camera refresh unavailable/);
  panel.destroy();
});


test('actual malformed camera rows preserve the existing load rejection boundary', async () => {
  const h = faaHarness(true);
  const panel = h.create();
  await settle();
  assert.match(h.content.textContent, /Working camera/);
  h.advance(16 * 60_000);
  h.setSources([[null], [], []]);
  await assert.doesNotReject(() => panel.load());
  assert.match(h.content.textContent, /Working camera/);
  assert.match(h.content.textContent, /Camera refresh unavailable.*stale/);
  panel.destroy();
});
