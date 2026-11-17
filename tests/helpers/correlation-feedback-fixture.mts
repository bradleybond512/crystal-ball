import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const FEEDBACK_KEY = 'crystalball-correlation-feedback-v1';
const PAIRS = ['earthquake|tsunami', 'power-grid|comms-health', 'tsunami|earthquake'];
export const BEHAVIOR_SCENARIOS = ['transitions', 'pair-order', 'boundary', 'reintroduction', 'reentrancy'];

export function runIsolatedFeedback(request) {
  const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', SELF, '--worker'], {
    cwd: ROOT, input: JSON.stringify(request), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(child.error, undefined, child.stderr); assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

async function runFixture(request) {
  assert.ok(['capacity', 'restart', ...BEHAVIOR_SCENARIOS].includes(request.scenario));
  if (request.scenario === 'capacity') assert.ok([0, 1, 500].includes(request.transitions));
  const values = new Map(Object.entries(request.storage ?? {})), writes = [], frames = [], costs = [], callbackErrors = [], archives = [], notifications = [], steps = [];
  let now = 1_790_000_000_000, callbackCost, allReads = 0, allReferences = 0, observerCalls = 0, laterCalls = 0, deliberateExceptions = 0, reenter = false, reentered = false;
  Date.now = () => now;
  Object.assign(globalThis, {
    window: {}, requestAnimationFrame: callback => { assert.ok(frames.length < 64); frames.push(callback); return frames.length; },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push(key); }, removeItem: key => values.delete(key) },
    fetch: () => { throw new Error('Network forbidden in feedback fixture'); },
  });
  const { unifiedAlertStore: store, _setNotifyThrottleForTest } = await import('../../src/services/unified-alerts.ts');
  const { alertDB } = await import('../../src/services/alert-store.ts');
  const { notificationDispatcher } = await import('../../src/services/notification-dispatcher.ts');
  alertDB.putBatch = async rows => { archives.push(rows.length); };
  notificationDispatcher.dispatchNotification = alert => { notifications.push(alert.id); };
  _setNotifyThrottleForTest(0);
  const alert = (id, overrides = {}) => ({ id, source: 'correlation', severity: 'info', title: id, body: '', timestamp: now, relevanceScore: 0.5, acknowledged: false, pinned: false, correlationPair: ['earthquake', 'tsunami'], ...overrides });
  const drain = () => {
    store._flushNowForTest(); let count = 0;
    while (frames.length) { assert.ok(++count <= 32, 'Bounded fixture flush exceeded'); frames.shift()(); }
  };
  if (request.scenario === 'capacity') store.ingest(Array.from({ length: 500 }, (_, i) => alert(`row-${i}`)));
  if (request.scenario === 'transitions') store.ingest([alert('a'), alert('ordinary', { source: 'breaking-news', correlationPair: undefined }), alert('missing', { correlationPair: undefined }), alert('power', { correlationPair: ['power-grid', 'comms-health'] })]);
  if (request.scenario === 'pair-order') store.ingest([alert('pin-first', { correlationPair: ['power-grid', 'comms-health'] }), alert('ack-second')]);
  if (request.scenario === 'boundary') store.ingest(Array.from({ length: 9 }, (_, i) => alert(`bound-${i}`, { correlationPair: i < 3 ? ['earthquake', 'tsunami'] : i < 6 ? ['power-grid', 'comms-health'] : ['tsunami', 'earthquake'] })));
  if (request.scenario === 'reintroduction') store.ingest([alert('return')]);
  if (request.scenario === 'reentrancy') store.ingest([alert('a'), alert('b')]);
  drain();
  const getAll = store.getAll.bind(store), subscribe = store.subscribe.bind(store);
  if (request.scenario === 'capacity') assert.equal(getAll().length, 500);
  store.getAll = () => {
    const rows = getAll(); allReads++; allReferences += rows.length;
    if (callbackCost) { callbackCost.getAllCalls++; callbackCost.arrayReferences += rows.length; }
    return rows;
  };
  subscribe(() => {
    observerCalls++; store.getAll();
    if (reenter && !reentered) { reentered = true; store.acknowledge('b'); }
  });
  if (request.scenario === 'reentrancy') subscribe(() => { deliberateExceptions++; throw new Error('Synthetic earlier subscriber failure'); });
  store.subscribe = fn => subscribe(() => {
    const cost = { getAllCalls: 0, arrayReferences: 0, elapsedMs: 0 }; const start = performance.now(); callbackCost = cost;
    try { fn(); } catch (error) { callbackErrors.push(String(error)); throw error; } finally { cost.elapsedMs = performance.now() - start; costs.push(cost); callbackCost = undefined; }
  });
  const { startCorrelationFeedback, getPairFeedbackMult } = await import('../../src/services/correlation-feedback.ts');
  startCorrelationFeedback(); startCorrelationFeedback(); store.subscribe = subscribe;
  const initializationReads = allReads;
  subscribe(() => { observerCalls++; laterCalls++; store.getAll(); });
  const feedbackWrites = () => writes.filter(key => key === FEEDBACK_KEY).length;
  const record = (label, action = () => {}, advance = 0) => {
    assert.ok(steps.length < 20); now += advance; const saved = feedbackWrites(), priorCost = costs.length;
    action(); drain();
    steps.push({ label, serializedStats: values.get(FEEDBACK_KEY) ?? null, multipliers: Object.fromEntries(PAIRS.map(pair => [pair, getPairFeedbackMult(pair)])), saves: feedbackWrites() - saved,
      alerts: getAll().map(a => ({ id: a.id, source: a.source, acknowledged: a.acknowledged, pinned: a.pinned, pair: a.correlationPair ?? null })), callbackCosts: costs.slice(priorCost) });
  };
  const initialSaves = feedbackWrites(); allReads = 0; allReferences = 0;
  const begin = performance.now(); let flushElapsedMs = 0;
  if (request.scenario === 'capacity') {
    if (request.transitions === 0) store.snooze('row-0', 1);
    else {
      const ids = Array.from({ length: request.transitions }, (_, i) => `row-${i}`);
      store.acknowledgeMany(ids); for (const id of ids) store.togglePin(id);
    }
    const flushStart = performance.now(); drain(); flushElapsedMs = performance.now() - flushStart;
  } else {
    record('initial');
    if (request.scenario === 'transitions') {
      record('combined', () => { store.acknowledgeMany(['a', 'ordinary', 'missing']); for (const id of ['a', 'ordinary', 'missing']) store.togglePin(id); });
      record('unchanged', () => store.snooze('a', 1));
      record('update-pair', () => store.ingest([alert('a', { title: 'updated report', correlationPair: ['tsunami', 'earthquake'] })]));
      record('unpin', () => store.togglePin('a')); record('repin', () => store.togglePin('a'));
      record('both-new-pair', () => { store.acknowledge('power'); store.togglePin('power'); });
      record('missing-pair-now-present', () => store.ingest([alert('missing', { correlationPair: ['power-grid', 'comms-health'] })]));
      record('missing-pair-unpin', () => store.togglePin('missing')); record('missing-pair-repin', () => store.togglePin('missing'));
    }
    if (request.scenario === 'pair-order') record('ack-before-pin', () => { store.togglePin('pin-first'); store.acknowledge('ack-second'); });
    if (request.scenario === 'boundary') {
      record('9999ms', () => store.acknowledgeMany(['bound-0', 'bound-1', 'bound-2']), 9999);
      record('10000ms', () => store.acknowledgeMany(['bound-3', 'bound-4', 'bound-5']), 1);
      record('three-pins', () => { for (const id of ['bound-6', 'bound-7', 'bound-8']) store.togglePin(id); });
    }
    if (request.scenario === 'reintroduction') {
      record('age-out', () => store.ingest([alert('marker', { source: 'breaking-news', correlationPair: undefined })]), 49 * 60 * 60 * 1000);
      record('reintroduced', () => store.ingest([alert('return')]));
      record('new-window-ack', () => store.acknowledge('return'), 9999);
    }
    if (request.scenario === 'reentrancy') {
      reenter = true; record('reentrant-ack', () => store.acknowledge('a')); record('unchanged-after-reentry', () => store.snooze('a', 1));
    }
    if (request.scenario === 'restart') {
      record('unchanged-after-restart', () => store.snooze('a', 1)); record('restart-unpin', () => store.togglePin('a')); record('restart-repin', () => store.togglePin('a'));
    }
  }
  return {
    scenario: request.scenario, capacity: getAll().length, transitions: request.transitions, initializationReads,
    behavior: { serializedStats: values.get(FEEDBACK_KEY) ?? null, multiplier: getPairFeedbackMult('earthquake|tsunami'), saves: feedbackWrites() - initialSaves, callbackErrors },
    steps, storage: request.scenario === 'capacity' ? undefined : Object.fromEntries(values),
    callbackCosts: costs, fanout: { getAllCalls: allReads, arrayReferences: allReferences, observerCalls, laterCalls, deliberateExceptions, flushElapsedMs, mutationAndFlushElapsedMs: performance.now() - begin },
    fixture: { archives: archives.length, notificationCalls: notifications.length, pendingFrames: frames.length },
  };
}

if (process.argv[1] === SELF && process.argv[2] === '--worker') {
  const input = readFileSync(0, 'utf8'); assert.ok(input.length <= 2_000_000);
  console.log(JSON.stringify(await runFixture(JSON.parse(input))));
}
