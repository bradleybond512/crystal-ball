import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { Window } from 'happy-dom';

const ROOT = resolve(import.meta.dirname, '../..');
const NOW = 1_800_000_000_000;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const FILES = {
  phish: 'src/components/PhishstatsFeedPanel.ts', tv: 'src/services/tv-mode.ts',
  digest: 'src/services/notification-digest.ts', scheduler: 'src/services/intelligence/improvement-scheduler.ts',
  consolidation: 'src/services/cognition/consolidation-cadence.ts', self: 'src/services/cognition/self-tuning.ts',
};

function memory(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const attempts: Array<{ key: string; value: string }> = [];
  const successes: Array<{ key: string; value: string }> = [];
  const storage = {
    data, attempts, successes, denyRead: false, denyWrite: false,
    getItem(key: string) {
      if (storage.denyRead) throw new Error('fixture storage read denied');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      const write = { key, value: String(value) };
      attempts.push(write);
      if (storage.denyWrite) throw new Error('fixture storage write denied');
      data.set(key, write.value); successes.push(write);
    },
    removeItem(key: string) { data.delete(key); },
    checkpoint() { attempts.length = 0; successes.length = 0; },
  };
  return storage;
}

function fixture(t: TestContext, storage = memory()) {
  const window = new Window({ url: 'http://127.0.0.1/' });
  const intervals = new Map<number, { callback: () => void; ms: number }>();
  const idle = new Map<number, () => void>();
  const cache = new Map<string, Record<string, any>>();
  let now = NOW;
  let taskId = 0;
  let executions = 0;
  const blocked: string[] = [];
  const deny = (kind: string): never => { blocked.push(kind); throw new Error(`Forbidden fixture access: ${kind}`); };
  const interval = (callback: () => void, ms: number) => { const id = ++taskId; intervals.set(id, { callback, ms }); return id; };
  const enqueue = (callback: () => void) => { const id = ++taskId; idle.set(id, callback); return id; };
  const deps: Record<string, unknown> = {};
  const warnings: unknown[][] = [];
  const context = vm.createContext({
    window, document: window.document, localStorage: storage,
    Date: class extends Date { static now() { return now; } },
    CustomEvent: window.CustomEvent, HTMLElement: window.HTMLElement,
    setInterval: interval, clearInterval: (id: number) => intervals.delete(id),
    setTimeout: enqueue, clearTimeout: (id: number) => idle.delete(id),
    requestIdleCallback: (callback: (deadline: unknown) => void) => enqueue(() => callback({ didTimeout: false, timeRemaining: () => 50 })),
    fetch: () => deny('network'), XMLHttpRequest: class { constructor() { deny('network'); } },
    console: { log() {}, warn: (...args: unknown[]) => warnings.push(args), error: (...args: unknown[]) => warnings.push(args) },
  });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  for (const [name, value] of Object.entries({
    setInterval: interval, clearInterval: (id: number) => intervals.delete(id),
    setTimeout: enqueue, clearTimeout: (id: number) => idle.delete(id),
    requestAnimationFrame: enqueue, cancelAnimationFrame: (id: number) => idle.delete(id),
    fetch: () => deny('window network'),
    XMLHttpRequest: class { constructor() { deny('window network'); } },
    WebSocket: class { constructor() { deny('window network'); } },
  })) Object.defineProperty(window, name, { configurable: true, value });
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, get: () => deny('native') });
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'visible' });
  const realModules: Record<string, string> = {
    '@/utils/sanitize': 'src/utils/sanitize.ts',
    '@/services/security/phishstats-classify': 'src/services/security/phishstats-classify.ts',
    './idle-scheduler': 'src/services/cognition/idle-scheduler.ts',
    '@/services/algorithms/drift-detector': 'src/services/algorithms/drift-detector.ts',
    './ensemble-voter.ts': 'src/services/algorithms/ensemble-voter.ts',
  };
  t.after(async () => {
    intervals.clear(); idle.clear();
    await window.happyDOM.abort();
    assert.deepEqual(blocked, [], 'no unexpected network/native/import access');
  });
  function load(file: string): Record<string, any> {
    const cached = cache.get(file);
    if (cached) return cached;
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as Record<string, any> };
    cache.set(file, module.exports);
    const execute = vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename: file });
    execute((name: string) => {
      if (Object.prototype.hasOwnProperty.call(deps, name)) return deps[name];
      if (realModules[name]) return load(realModules[name]);
      return deny(`import:${name}`);
    }, module, module.exports);
    return module.exports;
  }
  async function drain() {
    for (let turn = 0; turn < 100; turn++) {
      for (const [id, callback] of idle) {
        idle.delete(id);
        assert.ok(++executions <= 100, 'fixture callback budget exceeded');
        callback();
      }
      await Promise.resolve();
    }
    assert.equal(idle.size, 0);
  }
  return {
    storage, window, deps, intervals, warnings, load, drain,
    at: (value: number) => { now = value; },
    now: () => now,
    async tick(count = 1) {
      executions = 0;
      for (let index = 0; index < count; index++) {
        for (const { callback } of [...intervals.values()]) {
          assert.ok(++executions <= 100, 'fixture callback budget exceeded');
          callback();
        }
        await drain();
      }
    },
  };
}

function phish(t: TestContext, storage = memory()) {
  const f = fixture(t, storage);
  let fetches = 0;
  f.deps['./Panel'] = { Panel: class {
    root = f.window.document.createElement('section');
    setContent(html: string, after?: () => void) { this.root.innerHTML = html; after?.(); }
    setCount() {}
    getElement() { return this.root; }
    destroy() { this.root.remove(); }
  } };
  f.deps['@/services/security/phishstats-service'] = { fetchPhishingRecords: async () => { fetches++; return { records: [], degraded: false, source: 'synthetic' }; } };
  const api = f.load(FILES.phish);
  const panel = new api.PhishstatsFeedPanel();
  const slider = () => panel.getElement().querySelector('.phish-score-slider');
  return { ...f, panel, slider, fetches: () => fetches };
}

test('phish refresh is write-free; slider persists across reload and destroy stops refresh', async (t) => {
  const f = phish(t); await f.drain(); f.storage.checkpoint();
  await f.tick(3);
  assert.equal(f.fetches(), 4);
  assert.equal(f.storage.attempts.length, 0);
  f.slider().value = '7'; f.slider().dispatchEvent(new f.window.Event('input'));
  assert.deepEqual(f.storage.successes, [{ key: 'cb:phishstats-min-score', value: '7' }]);
  const reload = phish(t, f.storage); await reload.drain();
  assert.equal(reload.slider().value, '7');
  f.panel.destroy(); assert.equal(f.intervals.size, 0);
  await f.tick(); assert.equal(f.fetches(), 4);
  reload.panel.destroy();
});

test('phish denied reads use default and denied writes retain only current in-memory preference', async (t) => {
  const storage = memory(); storage.denyRead = true; storage.denyWrite = true;
  const f = phish(t, storage); await f.drain();
  assert.equal(f.slider().value, '5');
  f.slider().value = '6'; f.slider().dispatchEvent(new f.window.Event('input'));
  assert.equal(f.slider().value, '6');
  assert.equal(storage.attempts.length, 1); assert.equal(storage.successes.length, 0);
  const reload = phish(t, storage); await reload.drain(); assert.equal(reload.slider().value, '5');
  f.panel.destroy(); reload.panel.destroy();
});

function tv(t: TestContext, storage = memory()) {
  const f = fixture(t, storage);
  f.window.document.body.innerHTML = '<div id="mapSection"></div><div id="panelsGrid"><section class="panel"></section><section class="panel"></section></div>';
  const changes: string[] = [];
  const api = f.load(FILES.tv);
  return { ...f, changes, create: () => new api.TvModeController({ panelKeys: ['map', 'first', 'second'], onPanelChange: (key: string) => changes.push(key) }) };
}

test('TV cycling is write-free; explicit interval persists across reload and destroy clears timer', async (t) => {
  const f = tv(t); const controller = f.create(); controller.enter(); f.storage.checkpoint();
  await f.tick(3);
  assert.deepEqual(f.changes, ['map', 'first', 'second', 'map']); assert.equal(f.storage.attempts.length, 0);
  controller.setIntervalMs(90_000);
  assert.deepEqual(f.storage.successes, [{ key: 'tv-mode-interval', value: '90000' }]);
  const reload = tv(t, f.storage); const next = reload.create(); next.enter();
  assert.equal([...reload.intervals.values()][0]!.ms, 90_000);
  controller.destroy(); assert.equal(f.intervals.size, 0);
  await f.tick(); assert.equal(f.changes.length, 4);
  assert.equal(f.window.document.querySelectorAll('.tv-hidden, .tv-active').length, 0);
  next.destroy();
});

test('TV storage read and write exceptions stay observable without claiming recovery', (t) => {
  const storage = memory({ 'tv-mode-interval': '60000' }); const f = tv(t, storage);
  storage.denyRead = true; assert.throws(() => f.create(), /fixture storage read denied/);
  storage.denyRead = false; const controller = f.create(); controller.enter(); storage.denyWrite = true;
  assert.throws(() => controller.setIntervalMs(90_000), /fixture storage write denied/);
  assert.equal(storage.attempts.length, 1); assert.equal(storage.successes.length, 0);
  assert.equal(storage.data.get('tv-mode-interval'), '60000');
  assert.equal([...f.intervals.values()][0]!.ms, 60_000, 'failed write precedes timer restart');
  controller.destroy();
});

function digest(t: TestContext, storage = memory()) {
  const f = fixture(t, storage);
  const listeners = new Set<() => void>();
  const rows: Array<Record<string, unknown>> = [];
  let summaries = 0;
  const operational = (alert: Record<string, unknown>) => alert.id !== 'retired';
  f.deps['./unified-alerts'] = { unifiedAlertStore: {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getOperationalAlerts: () => rows.filter(operational), isOperationalAlert: operational,
  } };
  f.deps['./summarization'] = { generateSummary: async () => { summaries++; return null; } };
  const api = f.load(FILES.digest); api.initNotificationDigest();
  return { ...f, api, rows, listeners, summaries: () => summaries, notify: () => { for (const listener of listeners) listener(); } };
}
const alert = (timestamp: number, id = 'current', source = 'cyber') => ({ id, source, title: 'Synthetic fixture alert', severity: 'high', timestamp });

test('empty and retired-only digest ticks do not write; deliverable digest persists and teardown unsubscribes', async (t) => {
  const f = digest(t); f.storage.checkpoint(); await f.tick(3);
  f.api.queueAlert(alert(NOW, 'retired', 'nws')); await f.tick();
  assert.equal(f.storage.attempts.length, 0); assert.equal(f.summaries(), 0);
  f.rows.push(alert(NOW + 1)); f.notify(); f.at(NOW + 1000);
  const delivered: unknown[] = []; f.api.subscribeDigest((value: unknown) => delivered.push(value)); await f.tick();
  assert.equal(delivered.length, 1); assert.equal(f.storage.successes.length, 1);
  assert.equal(f.storage.successes[0]!.key, 'crystalball-notification-digests');
  const saved = JSON.parse(f.storage.successes[0]!.value);
  assert.equal(saved[0].totalAlerts, 1); assert.equal(saved[0].groups[0].alerts[0].id, 'current');
  const reload = digest(t, f.storage);
  assert.equal(reload.api.getRecentDigests()[0].id, saved[0].id);
  f.api.destroyNotificationDigest(); assert.equal(f.intervals.size, 0); assert.equal(f.listeners.size, 0);
  await f.tick(); f.notify(); assert.equal(delivered.length, 1);
  reload.api.destroyNotificationDigest();
});

test('digest denied save preserves current delivery but does not invent persisted history', async (t) => {
  const f = digest(t); f.storage.denyWrite = true;
  const delivered: unknown[] = []; f.api.subscribeDigest((value: unknown) => delivered.push(value));
  f.api.queueAlert(alert(NOW + 1)); await f.tick();
  assert.equal(delivered.length, 1); assert.equal(f.storage.attempts.length, 1); assert.equal(f.storage.successes.length, 0);
  const reload = digest(t, f.storage); assert.equal(reload.api.getRecentDigests().length, 0);
  f.api.destroyNotificationDigest(); reload.api.destroyNotificationDigest();
});

function scheduler(t: TestContext, storage = memory(), seed = true) {
  const f = fixture(t, storage); const api = f.load(FILES.scheduler);
  let runs = 0;
  if (seed) {
    const template = api.createImprovementScheduler({ storage: null, now: f.now }).getAllTasks();
    for (const task of template) { task.enabled = task.id === 'scan-bias'; task.nextRunAt = new Date(NOW + 60_000); }
    storage.data.set('wm-scheduler-tasks', JSON.stringify(template));
  }
  const service = api.createImprovementScheduler({ storage, now: f.now, taskRunners: { 'scan-bias': async () => { runs++; } } });
  service.start();
  return { ...f, service, runs: () => runs };
}

test('disabled/not-due scheduler timers do not write; due history and schedule survive reload and stop', async (t) => {
  const f = scheduler(t); f.service.disableTask('scan-bias'); f.at(NOW + 60_000); f.storage.checkpoint(); await f.tick(3);
  assert.equal(f.storage.attempts.length, 0); assert.equal(f.runs(), 0);
  f.service.enableTask('scan-bias'); f.storage.checkpoint(); f.at(NOW + 59_999); await f.tick(3);
  assert.equal(f.storage.attempts.length, 0);
  f.at(NOW + 60_000); await f.tick(); assert.equal(f.runs(), 1);
  assert.deepEqual(f.storage.successes.map((write) => write.key), ['wm-scheduler-tasks', 'wm-scheduler-history']);
  assert.equal(f.service.getHistory().length, 1);
  const nextRun = f.service.getTask('scan-bias').nextRunAt.getTime();
  assert.equal(nextRun, NOW + 60_000 + 4 * 60 * 60 * 1000);
  const reload = scheduler(t, f.storage, false); reload.at(NOW + 60_000); f.storage.checkpoint(); await reload.tick();
  assert.equal(reload.service.getHistory().length, 1); assert.equal(reload.service.getTask('scan-bias').nextRunAt.getTime(), nextRun);
  assert.equal(f.storage.attempts.length, 0); assert.equal(reload.runs(), 0);
  f.service.stop(); reload.service.stop(); assert.equal(f.intervals.size, 0); assert.equal(reload.intervals.size, 0);
  reload.at(nextRun); await reload.tick(); assert.equal(reload.runs(), 0);
});

test('scheduler denied writes keep in-memory result but reload retains the previously saved schedule', async (t) => {
  const f = scheduler(t); const saved = f.storage.data.get('wm-scheduler-tasks'); f.storage.denyWrite = true;
  f.at(NOW + 60_000); await f.tick();
  assert.equal(f.runs(), 1); assert.equal(f.service.getHistory()[0].result, 'success');
  assert.equal(f.storage.attempts.length, 2); assert.equal(f.storage.successes.length, 0);
  assert.equal(f.storage.data.get('wm-scheduler-tasks'), saved);
  const reload = scheduler(t, f.storage, false);
  assert.equal(reload.service.getTask('scan-bias').nextRunAt.getTime(), NOW + 60_000);
  assert.equal(reload.service.getHistory().length, 0);
  f.service.stop(); reload.service.stop();
});

function consolidation(t: TestContext, storage = memory({ 'cb:consolidation-last': String(NOW) })) {
  const f = fixture(t, storage);
  const state = { ghost: false, enabled: true, fail: false, runs: 0, reports: 0 };
  f.deps['./consolidation'] = { runConsolidation: async () => { state.runs++; if (state.fail) throw new Error('synthetic run failed'); return { ranAt: f.now() }; } };
  f.deps['./consolidation-state'] = { recordConsolidationReport: () => { state.reports++; } };
  f.deps['./cognition-settings'] = { isCognitionEnabled: () => state.enabled };
  f.deps['@/services/mode-manager'] = { isGhostMode: () => state.ghost };
  const api = f.load(FILES.consolidation); api.startConsolidationCadence();
  return { ...f, state };
}

test('disabled/Ghost/not-due consolidation writes nothing; successful due work advances and reloads cadence', async (t) => {
  const f = consolidation(t); f.at(NOW + SIX_HOURS - 1); await f.tick(3);
  f.at(NOW + SIX_HOURS); f.state.enabled = false; await f.tick(3);
  f.state.enabled = true; f.state.ghost = true; await f.tick(3);
  assert.equal(f.state.runs, 0); assert.equal(f.storage.attempts.length, 0);
  f.state.ghost = false; await f.tick();
  assert.equal(f.state.runs, 1); assert.equal(f.state.reports, 1);
  assert.deepEqual(f.storage.successes, [{ key: 'cb:consolidation-last', value: String(NOW + SIX_HOURS) }]);
  const reload = consolidation(t, f.storage); reload.at(NOW + SIX_HOURS); f.storage.checkpoint(); await reload.tick(3);
  assert.equal(reload.state.runs, 0); assert.equal(f.storage.attempts.length, 0);
  assert.equal(f.intervals.size, 1, 'no production stop API; fixture cleanup is not lifecycle acceptance');
});

test('failed consolidation or denied storage never falsely advances the saved cadence', async (t) => {
  const f = consolidation(t); f.at(NOW + SIX_HOURS); f.state.fail = true; await f.tick();
  assert.equal(f.state.runs, 1); assert.equal(f.state.reports, 0); assert.equal(f.storage.attempts.length, 0);
  f.state.fail = false; f.storage.denyWrite = true; await f.tick();
  assert.equal(f.state.runs, 2); assert.equal(f.state.reports, 0);
  assert.equal(f.storage.attempts.length, 1); assert.equal(f.storage.successes.length, 0);
  assert.equal(f.storage.data.get('cb:consolidation-last'), String(NOW));
  f.storage.denyRead = true; await f.tick(); assert.equal(f.state.runs, 2);
});

function selfTuning(t: TestContext, storage = memory({ 'cb:cognition-selftune-last': String(NOW) })) {
  const f = fixture(t, storage);
  const state = { ghost: false, calibrationReads: 0, ledgerReads: 0, evaluations: [] as Array<{ id: string; inputHash: string }>, outcomes: [] as string[], events: 0 };
  const records = [
    { id: 'legacy-fixture', domain: 'conflict', sourceId: 'superforecast', probability: 0.8, status: 'resolved_true', resolvedAt: NOW - 20_000 },
    { id: 'linked-fixture', domain: 'conflict', sourceId: 'superforecast', probability: 0.8, status: 'resolved_true', resolvedAt: NOW - 10_000, targetKey: 'synthetic-target', algorithmVersion: 'synthetic-v1' },
  ];
  f.deps['./entity-dossier'] = { getAllDossiers: () => [], computeTrajectory: () => assert.fail('no dossier input in this fixture') };
  f.deps['@/services/intelligence/forecast-calibration-adapter'] = { getCalibrationStore: () => ({ all: () => { state.calibrationReads++; return records; } }), getRecalibrator: () => (p: number) => ({ p }) };
  f.deps['@/services/algorithms/record-evaluation'] = {
    recordAlgorithmEvaluation: (_id: string, input: { inputHash: string }) => { const evaluation = { id: `fixture-${state.evaluations.length}`, inputHash: input.inputHash }; state.evaluations.push(evaluation); return evaluation; },
    recordAlgorithmOutcome: (_id: string, outcome: string) => state.outcomes.push(outcome),
  };
  f.deps['@/services/algorithms/algorithms-state'] = { getAlgorithmEvaluationLedger: () => ({ byAlgorithm: (algorithmId: string) => {
    state.ledgerReads++;
    return algorithmId === 'superforecast' ? Array.from({ length: 30 }, (_, index) => ({ id: `ledger-${index}`, algorithmId, at: NOW - index * 1000, outcome: 'miss' })) : [];
  } }) };
  f.deps['./algorithm-registry.ts'] = { registerAlgorithm: (value: unknown) => value, getAlgorithm: () => undefined };
  f.deps['@/services/mode-manager'] = { isGhostMode: () => state.ghost };
  f.window.addEventListener('cb:cognition-drift', () => { state.events++; });
  const api = f.load(FILES.self); api.startCognitionSelfTuningCadence();
  return { ...f, state };
}

test('Ghost/not-due self-tuning writes nothing; actual due grading/drift and completion persist across reload', async (t) => {
  const f = selfTuning(t); f.at(NOW + SIX_HOURS - 1); await f.tick(3);
  f.state.ghost = true; f.at(NOW + SIX_HOURS); await f.tick(3);
  assert.equal(f.storage.attempts.length, 0); assert.equal(f.state.calibrationReads, 0); assert.equal(f.state.ledgerReads, 0);
  f.state.ghost = false; await f.tick();
  assert.deepEqual(f.state.evaluations.map((row) => row.inputHash), ['legacy-fixture'], 'ACC-104 linked forecast is not graded twice');
  assert.deepEqual(f.state.outcomes, ['hit']); assert.equal(f.state.ledgerReads, 5); assert.equal(f.state.events, 1);
  assert.deepEqual(f.storage.successes.map((write) => write.key), ['crystalball-cognition-selftune-v1', 'crystalball-cognition-selftune-v1', 'cb:cognition-selftune-last']);
  assert.equal(f.storage.data.get('cb:cognition-selftune-last'), String(NOW + SIX_HOURS));
  const persisted = JSON.parse(f.storage.data.get('crystalball-cognition-selftune-v1')!);
  assert.equal(persisted.calibrationResolvedThrough, NOW - 10_000); assert.equal(persisted.driftAlerting.superforecast, true);
  const reload = selfTuning(t, f.storage); reload.at(NOW + SIX_HOURS); f.storage.checkpoint(); await reload.tick(3);
  assert.equal(reload.state.calibrationReads, 0); assert.equal(reload.state.ledgerReads, 0); assert.equal(f.storage.attempts.length, 0);
  assert.equal(f.intervals.size, 1, 'no production stop API; fixture cleanup is not lifecycle acceptance');
});

test('self-tuning storage denial is contained and does not invent a persisted completion', async (t) => {
  const f = selfTuning(t); f.at(NOW + SIX_HOURS); f.storage.denyRead = true; await f.tick();
  assert.equal(f.state.calibrationReads, 0); assert.equal(f.storage.attempts.length, 0);
  f.storage.denyRead = false; f.storage.denyWrite = true; await f.tick();
  assert.equal(f.state.calibrationReads, 1); assert.equal(f.state.ledgerReads, 5);
  assert.equal(f.storage.attempts.length, 3); assert.equal(f.storage.successes.length, 0);
  assert.equal(f.storage.data.get('cb:cognition-selftune-last'), String(NOW));
  assert.equal(f.storage.data.has('crystalball-cognition-selftune-v1'), false);
});
