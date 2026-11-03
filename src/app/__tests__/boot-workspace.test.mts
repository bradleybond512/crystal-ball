import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import ts from 'typescript';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const source = readFileSync(new URL('../../App.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '{}');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(heldStage?: string) {
  const calls: string[] = [];
  const stage = deferred();
  const wave = deferred(), geometry = deferred(), db = deferred();
  const note = (name: string) => { calls.push(name); };
  const fake = new Proxy({} as Record<string, any>, {
    get(obj, key: string) { return key === 'then' ? undefined : obj[key] ?? (() => note(key)); },
  });
  const dependencies: Record<string, any> = {
    startNotificationRouter: () => { note('router-attached'); return () => note('router-detached'); },
    BETA_MODE: false,
    shouldInitializeBrowserMl: () => heldStage === 'ml',
    mlWorker: { init: () => { note('ml'); return stage.promise; } },
    initDB: () => db.promise,
    preloadCountryGeometry: () => geometry.promise,
    cleanOldSnapshots: () => Promise.resolve(),
    bootTrace: note,
    parseMapUrlState: () => ({}),
    getCalibrationStore: () => ({ all: () => [] }),
    subscribeAiFlowChange: () => () => {},
    SignalModal: class { setLocationClickHandler() {} },
    trackEvent: note,
    dataFreshness: { hasSufficientData: () => true },
    CountryIntelManager: { resolveCountryName: () => 'Ukraine' },
    SITE_VARIANT: heldStage === 'happy-cache' ? 'happy' : 'full',
  };
  if (heldStage && !['ml', 'happy-cache', 'log', 'warm'].includes(heldStage)) {
    dependencies[heldStage] = () => { note(heldStage); return stage.promise; };
  }
  const modules = new Proxy(dependencies, { get(obj, key: string) { return obj[key] ?? fake[key]; } });
  const exports: any = {};
  new Function('require', 'exports', compiled)(() => modules, exports);
  Object.assign(globalThis, { document: new EventTarget(), window: { location: { search: '', href: 'https://fixture.test/' } }, history: { replaceState() {} } });
  const app = Object.create(exports.App.prototype);
  const dataLoader = Object.create(fake);
  dataLoader.hydrateHappyPanelsFromCache = () => { note('happy-cache'); return stage.promise; };
  dataLoader.loadAllData = () => { note('wave'); return wave.promise; };
  const state = { isMobile: true, mapLayers: {}, panels: {}, isDestroyed: false, newsSnapshot: fake };
  Object.assign(app, {
    state, searchManager: fake, dataLoader, eventHandlers: fake, panelLayout: fake, countryIntel: fake,
    modules: [], desktopUpdater: fake, desktopNotifications: {
      init: () => note('listen'), openWorkspace: () => note('allow'), sourcesSettled: () => note('settings-ready'), destroy() {},
    }, releaseGodsVisionControls() {}, panelRetryTimer: null,
    handleDeepLinks: () => note('deep-links'), setupRefreshIntervals: () => note('refresh'),
  });
  return { app, calls, wave, geometry, db, state, stage };
}

test('interactive prerequisites resolve once while acquisition and geometry remain outstanding', async () => {
  const { app, calls, wave, geometry, db } = fixture();
  let ready = 0;
  const first = app.init().then(() => ready++);
  app.openWorkspace();
  assert.ok(!calls.includes('allow'));
  db.resolve();
  await nextTurn();
  assert.equal(ready, 1);
  assert.ok(calls.indexOf('listen') >= 0 && calls.indexOf('listen') < calls.indexOf('wave'));
  assert.ok(!calls.includes('refresh'));
  await app.init();
  assert.equal(calls.filter(x => x === 'wave').length, 1);
  app.openWorkspace();
  assert.ok(calls.includes('allow'));
  wave.resolve(); await nextTurn();
  assert.ok(!calls.includes('wm_app_loaded'));
  geometry.resolve(); await first; await nextTurn();
  for (const name of ['startLearning', 'refresh', 'setupSnapshotSaving', 'deep-links', 'settings-ready', 'wm_app_loaded']) {
    assert.equal(calls.filter(x => x === name).length, 1, name);
  }
});

test('an acquisition error remains visible without rejecting an interactive workspace', async () => {
  const { app, calls, wave, geometry, db } = fixture();
  db.resolve(); geometry.resolve();
  const ready = app.init();
  wave.reject(new Error('fixture unavailable'));
  await ready; await nextTurn();
  assert.ok(calls.includes('showToast'));
  assert.ok(!calls.includes('wm_app_loaded'));
});

test('fatal prerequisite failure never marks the workspace interactive', async () => {
  const { app, db, calls } = fixture();
  const ready = app.init();
  db.reject(new Error('fixture database'));
  await assert.rejects(ready, /fixture database/);
  app.openWorkspace();
  assert.ok(!calls.includes('allow'));
  assert.ok(!calls.includes('wave'));
});

test('destroy during prerequisite, successful acquisition or failed acquisition leaves no late effects', async () => {
  for (const phase of ['prerequisite', 'success', 'failure']) {
    const { app, db, calls, wave, geometry } = fixture();
    const ready = app.init(); await nextTurn();
    if (phase !== 'prerequisite') { db.resolve(); await nextTurn(); }
    app.destroy(); const afterFirstDestroy = calls.length; app.destroy();
    assert.equal(calls.length, afterFirstDestroy, 'repeated destroy is inert');
    const atDestroy = calls.length;
    db.resolve(); geometry.resolve();
    if (phase === 'failure') wave.reject(new Error('stale load')); else wave.resolve();
    await ready; await nextTurn(); app.openWorkspace();
    assert.deepEqual(calls.slice(atDestroy), [], phase);
  }
});

test('canceling each async prerequisite prevents new boot work after destruction', async () => {
  const stages = ['log', 'initDB', 'initI18n', 'ml', 'fetchBootstrapData', 'resolveUserRegion',
    'preloadIdbBackedStores', 'startAlgorithmLedgerPersistence', 'persistAlgorithmLedger', 'happy-cache'];
  for (const held of stages) {
    const { app, calls, stage, db } = fixture(held);
    db.resolve(); const ready = app.init();
    if (held !== 'log') { await nextTurn(); assert.ok(calls.includes(held), held); }
    app.destroy(); const atDestroy = calls.length;
    stage.resolve(); await ready; app.openWorkspace();
    assert.deepEqual(calls.slice(atDestroy), [], held);
    assert.equal(calls.filter(x => x === 'router-detached').length, calls.filter(x => x === 'router-attached').length, held);
  }
});

test('an optional preload or ledger rejection after cancel cannot resume layout', async () => {
  for (const held of ['preloadIdbBackedStores', 'persistAlgorithmLedger']) {
    const { app, calls, stage, db } = fixture(held);
    db.resolve(); const ready = app.init(); await nextTurn();
    app.destroy(); const atDestroy = calls.length; stage.reject(new Error('disposed optional store'));
    await ready;
    assert.deepEqual(calls.slice(atDestroy), [], held);
  }
});

test('deep-link timers act on live data and leave replacement workspaces alone after teardown', async (t) => {
  const timers: (() => void)[] = [];
  t.mock.method(globalThis, 'setTimeout', (cb: () => void) => { timers.push(cb); return 1; });
  for (const kind of ['story', 'brief']) {
    for (const disposed of [false, true]) {
      const { app, state, calls, db, wave, geometry } = fixture();
      delete app.handleDeepLinks;
      window.location.href = kind === 'story' ? 'https://fixture.test/story?c=UA' : 'https://fixture.test/?country=UA';
      db.resolve(); await app.init();
      Object.assign(state, { latestClusters: [{}] }); app.pendingDeepLinkCountry = 'UA';
      wave.resolve(); geometry.resolve(); await nextTurn();
      assert.equal(timers.length, 1, kind);
      if (disposed) { app.destroy(); fixture(); }
      const beforeCallback = calls.length;
      timers.shift()!();
      assert.deepEqual(calls.slice(beforeCallback), disposed ? [] : [kind === 'story' ? 'openCountryStory' : 'openCountryBriefByCode']);
      assert.equal(timers.length, 0, 'no stale retry is armed');
    }
  }
});

test('only App owns the threat-router subscription across a real layout init', () => {
  const body = readFileSync(new URL('../panel-layout.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(body, /\bstartNotificationRouter\s*\(/, 'layout must not leak an unowned shared router lease');
  assert.match(source, /this\.releaseNotificationRouter\s*=\s*startNotificationRouter\(\)/);
});
