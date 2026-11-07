import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1793966400000;
const compiledModules = new Map();

// Compile whole modules; only unrelated platform/acquisition boundaries are replaced.
function harness(t, { hidden = false, io = true, populated = false } = {}) {
  const win = new Window({ url: 'http://localhost/' });
  const timers = new Map();
  const observers = [];
  const forbiddenCalls = [];
  let nextTimer = 1;
  let now = NOW;
  Object.defineProperty(win.document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
  const schedule = (fn, ms, interval = false) => {
    const id = nextTimer++;
    timers.set(id, { fn, ms, interval });
    return id;
  };
  const interval = (fn, ms) => schedule(fn, ms, true);
  const cancel = (id) => timers.delete(id);
  win.setInterval = interval;
  win.clearInterval = cancel;
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
    emit(isIntersecting) { this.callback([{ target: this.element, isIntersecting }]); }
  }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const forbidden = (name) => () => {
    forbiddenCalls.push(name);
    throw new Error(`Forbidden presentation dependency: ${name}`);
  };
  win.fetch = forbidden('window.fetch');
  const globals = {
    window: win, document: win.document, Node: win.Node, HTMLElement: win.HTMLElement,
    Element: win.Element, Event: win.Event, CustomEvent: win.CustomEvent,
    AbortController: win.AbortController, localStorage: win.localStorage,
    getComputedStyle: win.getComputedStyle.bind(win), console, Date: ClockDate,
    fetch: forbidden('fetch'), Notification: forbidden('Notification'),
    setInterval: interval, clearInterval: cancel,
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: cancel,
    requestAnimationFrame: (fn) => schedule(fn, 0), cancelAnimationFrame: cancel,
    ...(io ? { IntersectionObserver: Observer } : {}),
  };
  const registry = new Proxy({}, { get: () => () => {} });
  const stubs = {
    'src/services/runtime.ts': { isDesktopRuntime: () => false, getApiBaseUrl: () => '' },
    'src/services/runtime-config.ts': { isFeatureAvailable: () => true },
    'src/services/tauri-bridge.ts': { invokeTauri: forbidden('native') },
    'src/services/i18n.ts': { t: (key) => key },
    'src/utils/index.ts': { safeSetItem: (...args) => win.localStorage.setItem(...args) },
    'src/services/analytics.ts': { trackPanelResized: () => {} },
    'src/services/summarization.ts': { generateSummary: forbidden('generation') },
    'src/services/diagnostics/diagnostics-state.ts': { getPanelHealthRegistry: () => registry },
    'src/services/intelligence/observation-adapters.ts': { getDefaultRegistry: forbidden('ingestion adapter') },
    'src/services/proximity-filter.ts': { haversineKm: forbidden('geographic computation') },
    'src/services/intelligence/domain-dependency.ts': {
      getDomainDependencyGraph: () => new Proxy({}, { get: (_, name) => forbidden(`dependency graph ${String(name)}`) }),
    },
    'src/services/correlation/learned-rules.ts': { LEARNED_RULE_PREFIX: 'learned:' },
  };
  const modules = new Map();
  function load(file) {
    if (file === 'src/utils.ts') file = 'src/utils/index.ts';
    if (stubs[file]) return stubs[file];
    if (modules.has(file)) return modules.get(file);
    if (!compiledModules.has(file)) {
      compiledModules.set(file, ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText);
    }
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(compiledModules.get(file), { ...globals, exports, require: (id) => {
      assert.ok(id.startsWith('@/') || id.startsWith('.'), `unexpected dependency ${id}`);
      let resolved = id.startsWith('@/') ? `src/${id.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(file), id));
      if (!resolved.endsWith('.ts')) resolved += '.ts';
      return load(resolved);
    } }, { filename: file });
    return exports;
  }
  const observations = Array.from({ length: 1000 }, (_, i) => ({
    id: `obs-${i}`, domain: ['earthquake', 'tsunami', 'weather', 'infrastructure'][i % 4],
    title: `Fixture observation ${i}`, timestamp: now - i * 60000,
    severity: 'HIGH', tags: [], sourceId: 'fixture',
  }));
  if (populated) {
    win.localStorage.setItem('wm-alert-fatigue', JSON.stringify({ alerts: Array.from({ length: 1000 }, (_, i) => ({
      id: `alert-${i}`, domain: ['weather', 'cyber', 'conflict', 'health'][i % 4],
      severity: 40 + i % 60, timestamp: now - i * 7200, acknowledged: i % 3 === 0,
    })) }));
    win.localStorage.setItem('wm-causal-chains', JSON.stringify({ chains: Array.from({ length: 100 }, (_, i) => ({
      id: `chain-${i}`, rootCause: observations[i * 5], leafEffects: [observations[i * 5 + 4]],
      links: Array.from({ length: 4 }, (_, j) => ({
        causeId: observations[i * 5 + j].id, effectId: observations[i * 5 + j + 1].id,
        mechanism: 'fixture link', confidence: 0.7, delayHours: 1, evidenceObservationIds: [],
      })), overallConfidence: 0.7, longestPath: 4, situationId: null, builtAt: now - i * 60000,
    })) }));
    load('src/services/intelligence/observation-store.ts').ingest(observations);
    const store = load('src/services/intelligence/correlation-store.ts').getCorrelationStore();
    for (let i = 0; i < 500; i++) store.add({
      ruleId: `rule-${i}`, eventA: observations[i], eventB: observations[i + 500],
      detectedAt: new ClockDate(now - i * 60000), confidence: 0.7, edgeType: 'causal-candidate',
      confidenceDetail: { factors: { base: 0.7, reliability: 1.2, regime: 1.1 }, explanation: 'Seeded fixture' },
    });
  }
  const chainBuilder = load('src/services/intelligence/causal-chain.ts').getCausalChainBuilder();
  chainBuilder.buildChain = forbidden('correlation production');
  chainBuilder.buildChainForSituation = forbidden('situation correlation production');
  const Panel = load('src/components/Panel.ts').Panel;
  const panels = [];
  function mount(Subject = Panel, options = { id: 'presentation-probe', title: 'Probe', presentationRefreshPolicy: 'visible-only' }) {
    const panel = new Subject(options);
    panels.push(panel);
    win.document.body.append(panel.getElement());
    return panel;
  }
  function settle() {
    for (let pass = 0; pass < 10; pass++) {
      const ready = [...timers].filter(([, timer]) => !timer.interval && timer.ms < 1000);
      if (!ready.length) return;
      for (const [id, timer] of ready) if (timers.delete(id)) timer.fn();
    }
    assert.fail('presentation timers failed to settle');
  }
  t.after(() => {
    for (const panel of panels) panel.destroy();
    Panel.stopHeartbeatTicker();
    win.happyDOM.abort();
    assert.deepEqual(forbiddenCalls, [], 'presentation must not acquire, score, notify, or call native services');
  });
  return {
    Panel, mount, load, timers, observers, win, settle, observations, ClockDate,
    advance: (ms) => { now += ms; },
    visibility: (value, dispatch = true) => {
      hidden = value;
      if (dispatch) win.document.dispatchEvent(new win.Event('visibilitychange'));
    },
  };
}

function spy(object, key) {
  const original = object[key];
  const calls = [];
  object[key] = function (...args) { calls.push(args); return original.apply(this, args); };
  return calls;
}

function candidate(t, name, options = {}) {
  const h = harness(t, { populated: true, ...options });
  const Subject = h.load(`src/components/${name}.ts`)[name];
  const builds = spy(Subject.prototype, 'buildHtml');
  const freshness = spy(h.Panel.prototype, 'markFresh');
  const reads = name === 'AlertFatigueDashboardPanel'
    ? ['getFatigueReport', 'getAlertRate', 'getAllAlerts'].map((key) =>
      spy(h.load('src/services/intelligence/alert-fatigue-detector.ts').AlertFatigueDetector.getInstance(), key))
    : [spy(h.load('src/services/intelligence/observation-store.ts'), 'query'),
      spy(h.load('src/services/intelligence/causal-chain.ts').getCausalChainBuilder(), 'getChains'),
      spy(h.load('src/services/intelligence/correlation-store.ts').getCorrelationStore(), 'getRecent')];
  const panel = h.mount(Subject);
  h.settle();
  const timer = [...h.timers.values()].find((value) => value.interval && value.ms === 30000);
  assert.ok(timer, 'candidate must retain its 30-second timer');
  return { ...h, panel, timer, builds, reads, freshness, io: h.observers.at(-1) };
}

function repeat(timer, count = 200) { for (let i = 0; i < count; i++) timer.fn(); }

for (const name of ['AlertFatigueDashboardPanel', 'CorrelationMapPanel']) {
  test(`${name}: constructor remains direct, including initially hidden documents`, (t) => {
    const h = candidate(t, name, { hidden: true });
    assert.equal(h.builds.length, 1, 'constructor must compute its initial presentation');
    for (const reads of h.reads) assert.equal(reads.length, 1);
    assert.ok(h.panel.getContentElement().querySelector(name === 'AlertFatigueDashboardPanel' ? '.afp-dashboard' : '.cm2-pair'),
      'direct constructor must retain initial content');
    repeat(h.timer);
    assert.equal(h.builds.length, 1, 'initial hidden document must suppress periodic computation');
    h.io.emit(true);
    assert.equal(h.builds.length, 1, 'IO while backgrounded cannot drain');
    h.visibility(false);
    assert.equal(h.builds.length, 2, 'foreground must drain once without another IO event');
  });

  test(`${name}: 200 visible callbacks compute 200 times, invisible stages compute zero and resume once`, (t) => {
    const h = candidate(t, name);
    h.io.emit(true);
    const initial = h.builds.length;
    repeat(h.timer);
    assert.equal(h.builds.length - initial, 200);
    for (const reads of h.reads) assert.equal(reads.length, 201);
    for (const [label, hide, show] of [
      ['offscreen', () => h.io.emit(false), () => h.io.emit(true)],
      ['background', () => h.visibility(true), () => h.visibility(false)],
      ['disabled before IO', () => h.panel.hide(), () => h.panel.show()],
    ]) {
      hide();
      const before = h.builds.length;
      const beforeReads = h.reads.map((reads) => reads.length);
      const beforeFreshness = h.freshness.length;
      repeat(h.timer);
      assert.equal(h.builds.length, before, `${label} must not build HTML`);
      h.reads.forEach((reads, i) => assert.equal(reads.length, beforeReads[i], `${label} must not read stores`));
      assert.equal(h.freshness.length, beforeFreshness, `${label} must not claim freshness`);
      show();
      assert.equal(h.builds.length, before + 1, `${label} resume must drain exactly one refresh`);
      show();
      assert.equal(h.builds.length, before + 1, 'duplicate resume must not replay');
    }
  });

  test(`${name}: destruction clears interval and rejects captured late timer and observer callbacks`, (t) => {
    const h = candidate(t, name);
    h.io.emit(false);
    h.timer.fn();
    const before = h.builds.length;
    h.panel.destroy();
    assert.equal([...h.timers.values()].filter((timer) => timer.interval).length, 0);
    assert.equal(h.io.disconnected, true);
    h.timer.fn();
    h.io.emit(true);
    h.panel.show();
    h.visibility(false);
    assert.equal(h.builds.length, before, 'destroyed panel must not execute captured or pending work');
  });
}

test('opt-in waits for first IO result, keeps only latest callback, and drains once on first true delivery', (t) => {
  const h = harness(t);
  const panel = h.mount();
  const calls = [];
  panel.renderWhenVisible(() => calls.push('old'));
  panel.renderWhenVisible(() => calls.push('latest'));
  assert.deepEqual(calls, [], 'optimistic intersection must not run work before observation');
  assert.equal(h.observers[0].options.rootMargin, '200px 0px');
  h.observers[0].emit(true);
  h.observers[0].emit(true);
  assert.deepEqual(calls, ['latest']);
});

test('hidden IO waits for foreground and offscreen foreground waits for intersection', (t) => {
  const h = harness(t);
  const panel = h.mount();
  const io = h.observers[0];
  let calls = 0;
  io.emit(false);
  h.visibility(true);
  panel.renderWhenVisible(() => calls++);
  io.emit(true);
  assert.equal(calls, 0, 'background IO must not run presentation');
  h.visibility(false);
  assert.equal(calls, 1, 'foreground drains with no fresh IO');
  io.emit(false);
  h.visibility(true);
  panel.renderWhenVisible(() => calls++);
  h.visibility(false);
  assert.equal(calls, 1, 'foreground cannot drain an offscreen panel');
  io.emit(true);
  assert.equal(calls, 2);
});

test('disable before IO is immediate; show uses the last observation and current document visibility', (t) => {
  const h = harness(t);
  const panel = h.mount();
  const io = h.observers[0];
  let calls = 0;
  io.emit(true);
  panel.hide();
  panel.renderWhenVisible(() => calls++);
  io.emit(true);
  assert.equal(calls, 0, 'hidden class suppresses stale true IO');
  panel.show();
  panel.show();
  assert.equal(calls, 1);
  io.emit(false);
  panel.hide();
  panel.renderWhenVisible(() => calls++);
  panel.show();
  assert.equal(calls, 1, 'show cannot override last offscreen observation');
  h.visibility(true);
  io.emit(true);
  panel.hide();
  panel.show();
  assert.equal(calls, 1, 'show cannot override background document');
  h.visibility(false);
  assert.equal(calls, 2);
});

test('no-IO fallback still observes document and explicit visibility, including initial hidden state', (t) => {
  const h = harness(t, { io: false, hidden: true });
  const panel = h.mount();
  const calls = [];
  panel.renderWhenVisible(() => calls.push('initial'));
  assert.deepEqual(calls, []);
  h.visibility(false);
  assert.deepEqual(calls, ['initial']);
  panel.hide();
  panel.renderWhenVisible(() => calls.push('disabled'));
  assert.deepEqual(calls, ['initial']);
  panel.show();
  panel.renderWhenVisible(() => calls.push('visible'));
  assert.deepEqual(calls, ['initial', 'disabled', 'visible']);
});

test('a newly eligible callback supersedes older pending work before visibility event delivery', (t) => {
  const h = harness(t);
  const panel = h.mount();
  h.observers[0].emit(true);
  const calls = [];
  h.visibility(true);
  panel.renderWhenVisible(() => calls.push('stale'));
  h.visibility(false, false);
  panel.renderWhenVisible(() => calls.push('current'));
  assert.deepEqual(calls, ['current'], 'gate reads current visibility synchronously');
  h.visibility(false);
  h.observers[0].emit(false);
  h.observers[0].emit(true);
  assert.deepEqual(calls, ['current'], 'superseded callback must not replay');
});

test('drain clears pending before executing, retains reentrant replacement, and isolates callback errors', (t) => {
  const h = harness(t);
  const panel = h.mount();
  const io = h.observers[0];
  const calls = [];
  io.emit(false);
  panel.renderWhenVisible(() => {
    calls.push('first');
    panel.hide();
    panel.renderWhenVisible(() => calls.push('reentrant'));
    throw new Error('presentation failure');
  });
  assert.doesNotThrow(() => io.emit(true));
  assert.deepEqual(calls, ['first']);
  panel.show();
  panel.show();
  assert.deepEqual(calls, ['first', 'reentrant']);
  panel.renderWhenVisible(() => calls.push('next tick'));
  assert.deepEqual(calls, ['first', 'reentrant', 'next tick']);
});

test('destroy discards pending work and all direct, show, foreground and late IO paths stay inert', (t) => {
  const h = harness(t);
  const panel = h.mount();
  const io = h.observers[0];
  let calls = 0;
  io.emit(false);
  panel.renderWhenVisible(() => calls++);
  panel.destroy();
  assert.equal(panel.pendingVisibleRender, null, 'destroy must release queued closure');
  panel.renderWhenVisible(() => calls++);
  io.emit(true);
  panel.show();
  h.visibility(false);
  assert.equal(calls, 0);
  assert.equal(panel.pendingVisibleRender, null, 'post-destroy requests cannot retain closures');
});

test('non-opted-in panels preserve optimistic, explicit-hide and legacy resume semantics', (t) => {
  const h = harness(t);
  const panel = h.mount(h.Panel, { id: 'legacy', title: 'Legacy' });
  const io = h.observers[0];
  const calls = [];
  panel.renderWhenVisible(() => calls.push('before IO'));
  panel.hide();
  panel.renderWhenVisible(() => calls.push('explicit hide'));
  h.visibility(true);
  panel.renderWhenVisible(() => calls.push('pending'));
  h.visibility(false);
  assert.deepEqual(calls, ['before IO', 'explicit hide'], 'legacy foreground must not gain a presentation drain');
  h.visibility(true);
  io.emit(false);
  io.emit(true);
  assert.deepEqual(calls, ['before IO', 'explicit hide', 'pending'], 'legacy IO behavior remains unchanged');
});

test('Alert Fatigue resume reads newly recorded alerts and current rolling window, preserving escaped output', (t) => {
  const h = candidate(t, 'AlertFatigueDashboardPanel');
  const detector = h.load('src/services/intelligence/alert-fatigue-detector.ts').AlertFatigueDetector.getInstance();
  h.io.emit(true);
  h.io.emit(false);
  h.timer.fn();
  h.advance(2 * 3600000);
  const domain = 'new <img src=x onerror=alert(1)>';
  detector.recordAlert(domain, 90);
  assert.equal(detector.getFatigueReport().alertCount, 1, 'detector keeps operating while presentation sleeps');
  const before = h.builds.length;
  h.io.emit(true);
  h.settle();
  assert.equal(h.builds.length, before + 1);
  assert.equal(h.builds.at(-1)[0].report.alertCount, 1);
  assert.equal(h.panel.getContentElement().querySelector('.afp-domain-name').textContent, domain);
  assert.equal(h.panel.getContentElement().querySelector('img'), null);
});

test('Alert Fatigue empty and read-failure fallbacks recover on the next eligible timer', (t) => {
  const h = candidate(t, 'AlertFatigueDashboardPanel', { populated: false });
  h.io.emit(true);
  assert.match(h.panel.getContentElement().textContent, /No alerts in current window/);
  const detector = h.load('src/services/intelligence/alert-fatigue-detector.ts').AlertFatigueDetector.getInstance();
  detector.recordAlert('weather', 90);
  const original = detector.getFatigueReport;
  detector.getFatigueReport = () => { throw new Error('read unavailable'); };
  assert.doesNotThrow(() => h.timer.fn());
  assert.equal(h.builds.at(-1)[0].report.alertCount, 0);
  detector.getFatigueReport = original;
  h.timer.fn();
  h.settle();
  assert.equal(h.builds.at(-1)[0].report.alertCount, 1);
  assert.match(h.panel.getContentElement().textContent, /weather/);
});

test('Correlation Map resumes current store rows and ages while preserving delegated expansion', (t) => {
  const h = candidate(t, 'CorrelationMapPanel');
  h.io.emit(true);
  const content = h.panel.getContentElement();
  assert.equal(content.querySelectorAll('.cm2-chain').length, 100);
  assert.equal(content.querySelectorAll('.cm2-pair').length, 30);
  content.querySelector('[data-chain-id="chain-0"]').click();
  h.settle();
  assert.match(content.textContent, /Fixture observation 1/);
  h.io.emit(false);
  h.timer.fn();
  const store = h.load('src/services/intelligence/correlation-store.ts').getCorrelationStore();
  store.clear();
  store.add({
    ruleId: 'learned:latest', eventA: h.observations[0], eventB: h.observations[1],
    detectedAt: new h.ClockDate(), confidence: 0.9, edgeType: 'causal-candidate',
    confidenceDetail: { factors: { base: 0.7, reliability: 1.2, regime: 1.1 }, explanation: '<img src=x onerror=alert(1)>' },
  });
  h.advance(120000);
  const before = h.builds.length;
  h.io.emit(true);
  h.settle();
  assert.equal(h.builds.length, before + 1);
  assert.equal(content.querySelectorAll('.cm2-pair').length, 1);
  assert.match(content.querySelector('.cm2-pair').textContent, /2m ago/);
  assert.match(content.querySelector('.cm2-pair').textContent, /LEARNED/);
  assert.match(content.textContent, /Fixture observation 1/);
  assert.equal(content.querySelector('img'), null);
  content.querySelector('[data-chain-id="chain-0"]').click();
  h.settle();
  assert.doesNotMatch(content.textContent, /Fixture observation 1/);
});

test('Correlation Map empty/error states recover using actual stores on the next eligible timer', (t) => {
  const h = candidate(t, 'CorrelationMapPanel', { populated: false });
  h.io.emit(true);
  const content = h.panel.getContentElement();
  assert.match(content.textContent, /No active correlation chains detected/);
  assert.match(content.textContent, /No kernel-scored pairs/);
  const observations = h.load('src/services/intelligence/observation-store.ts');
  const original = observations.query;
  observations.query = () => { throw new Error('store unavailable'); };
  h.timer.fn();
  h.settle();
  assert.match(content.textContent, /Correlation engine unavailable/);
  observations.query = original;
  const store = h.load('src/services/intelligence/correlation-store.ts').getCorrelationStore();
  store.add({ ruleId: 'recovered', eventA: h.observations[0], eventB: h.observations[1], detectedAt: new h.ClockDate(), confidence: 0.8, edgeType: 'causal-candidate' });
  h.timer.fn();
  h.settle();
  assert.doesNotMatch(content.textContent, /Correlation engine unavailable/);
  assert.equal(content.querySelectorAll('.cm2-pair').length, 1);
});

for (const transition of ['show', 'foreground']) {
  test(`${transition} drains isolate failure, do not retry on duplicate transitions, and recover on next request`, (t) => {
    const h = harness(t);
    const panel = h.mount();
    h.observers[0].emit(true);
    const hide = transition === 'show' ? () => panel.hide() : () => h.visibility(true);
    const resume = transition === 'show' ? () => panel.show() : () => h.visibility(false);
    hide();
    let calls = 0;
    panel.renderWhenVisible(() => { calls++; throw new Error('presentation failure'); });
    assert.doesNotThrow(resume);
    assert.equal(calls, 1);
    resume();
    assert.equal(calls, 1, 'failed callback must be consumed without automatic retry');
    panel.renderWhenVisible(() => calls++);
    assert.equal(calls, 2, 'new eligible request recovers normally');
  });
}

test('foreground recovery keeps pending work isolated between two opted-in panels and one legacy panel', (t) => {
  const h = harness(t);
  const first = h.mount();
  const second = h.mount(h.Panel, { id: 'second', title: 'Second', presentationRefreshPolicy: 'visible-only' });
  const legacy = h.mount(h.Panel, { id: 'legacy', title: 'Legacy' });
  for (const io of h.observers) io.emit(true);
  h.visibility(true);
  const calls = [];
  first.renderWhenVisible(() => { calls.push('first'); throw new Error('first panel failed'); });
  second.renderWhenVisible(() => calls.push('second-old'));
  second.renderWhenVisible(() => calls.push('second-latest'));
  legacy.renderWhenVisible(() => calls.push('legacy'));
  h.visibility(false);
  assert.deepEqual(calls, ['first', 'second-latest'], 'one failed panel cannot block another or drain legacy work');
  h.visibility(false);
  assert.deepEqual(calls, ['first', 'second-latest']);
});
