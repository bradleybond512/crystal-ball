import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { startCalibrationResolutionScheduler as start } from '../calibration-resolution-scheduler.ts';

const period = 15 * 60_000;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const disk = new Map<string, string>();
  let permitted = true;
  const requests: string[] = [];
  const locks = { request: async (key: string, _: unknown, cb: (v: unknown) => unknown) => {
    requests.push(key); await Promise.resolve(); return cb(permitted ? {} : null);
  } };
  const data = { ready: true, enabled: true, due: true, calls: 0, bridges: 0, fail: false };
  const notes: any[] = [];
  let breaks = 0;
  const environment = {
    document: doc,
    storage: { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => disk.set(k, v) },
    locks,
    record: (r: any) => notes.push(r),
    interrupt: () => { breaks++; },
    reset: () => {},
  };
  const deps = { isBridgeReady: () => true, isReady: () => data.ready, enabled: () => data.enabled, hasDueWork: () => data.due,
    resolve: () => { data.calls++; if (data.fail) throw Error('fixture'); return {}; },
    bridge: () => { data.bridges++; return { failed: false }; } };
  const owner = start(deps as any, environment as any);
  t.after(() => owner.stop());
  const visibility = (hidden: boolean) => { doc.hidden = hidden; doc.dispatchEvent(new Event('visibilitychange')); };
  return { owner, deps, environment, data, notes, requests, disk, visibility, breaks: () => breaks, allow: (v: boolean) => { permitted = v; } };
}

test('due startup coalesces with hydration notifications; scheduled passes share spacing and retain scheduled slots', async t => {
  const f = fixture(t); f.owner.notifyReady(); f.owner.notifyReady();
  await settle(); assert.equal(f.data.calls, 1);
  assert.equal(f.notes.at(-1).kind, 'catchup');
  t.mock.timers.tick(period-1); await settle(); assert.equal(f.data.calls, 1);
  t.mock.timers.tick(1); await settle(); assert.equal(f.data.calls, 2);
  assert.equal(f.notes.at(-1).kind, 'scheduled');
  assert.equal(f.notes.at(-1).dueAt, Date.now());
});

test('hidden, cold and disabled work cannot settle; due resume catches up once and empty catchups do not run', async t => {
  const f = fixture(t); f.data.ready = false; await settle(); assert.equal(f.data.calls, 0);
  f.visibility(true); f.data.ready = true; f.owner.notifyReady();
  t.mock.timers.tick(2 * period); await settle(); assert.equal(f.data.calls, 0);
  f.data.enabled = false; f.visibility(false); await settle(); assert.equal(f.data.calls, 0);
  f.data.enabled = true; f.data.due = false; f.owner.notifyReady(); await settle(); assert.equal(f.data.calls, 0);
  f.data.due = true; f.owner.notifyReady(); await settle(); assert.equal(f.data.calls, 1);
  assert.equal(f.notes.filter(r => r.outcome === 'completed').length, 1);
  assert.ok(f.breaks() > 0);
});

test('a delayed, failed scheduled pass breaks continuity, records no completion and does not immediately retry', async t => {
  const f = fixture(t); await settle(); const due = Date.now() + period;
  f.data.fail = true; t.mock.timers.setTime(due + period); t.mock.timers.tick(1); await settle();
  assert.equal(f.data.calls, 2); const r = f.notes.findLast(r => r.kind === 'scheduled');
  assert.equal(r.dueAt, due); assert.equal(r.outcome, 'failed'); assert.equal(r.metrics, null);
  assert.ok(f.breaks() > 0); f.owner.notifyReady(); await settle(); assert.equal(f.data.calls, 2);
});

test('another workspace cannot duplicate work and the last owner cancels pending admission', async t => {
  const f = fixture(t); const other = start(f.deps as any, f.environment as any);
  await settle(); assert.equal(f.data.calls, 1); f.owner.stop();
  t.mock.timers.tick(period); await settle(); assert.equal(f.data.calls, 2);
  t.mock.timers.tick(period); other.stop(); await settle(); assert.equal(f.data.calls, 2);
  t.mock.timers.tick(4*period); await settle(); assert.equal(f.data.bridges, 0);
});

test('a peer holding the lock or retaining a recent pass blocks duplicate writes; unavailable coordination fails closed', async t => {
  const f = fixture(t); f.allow(false); await settle(); assert.equal(f.data.calls, 0);
  f.allow(true); f.owner.notifyReady(); await settle(); assert.equal(f.data.calls, 1);
  const key = [...f.disk.keys()][0]!; f.disk.set(key, String(Date.now()+period));
  t.mock.timers.tick(period); await settle(); assert.equal(f.data.calls,1);
  f.environment.storage.getItem = () => { throw new Error('denied'); };
  t.mock.timers.tick(period); await settle();
  assert.equal(f.data.calls, 1); assert.equal(f.notes.at(-1).readiness,'coordination-unavailable');
});

test('hourly bridge remains separate and reports partial failures without enabling a typed pass', async t => {
  const f = fixture(t); f.data.enabled = false; f.deps.bridge = () => { f.data.bridges++; return { failed: true }; };
  await settle(); t.mock.timers.tick(4*period); await settle();
  assert.equal(f.data.calls,0); assert.equal(f.data.bridges,1);
  const bridge=f.notes.find(r => r.kind==='bridge'); assert.equal(bridge.outcome,'failed'); assert.equal(bridge.metrics.failed,true);
});

test('a visibility round trip before lock admission still executes one currently eligible catch-up', async t => {
  const f = fixture(t);
  f.visibility(true);
  f.visibility(false);
  await settle();
  assert.equal(f.data.calls, 1);
  assert.equal(f.notes.filter(r => r.outcome === 'completed').length, 1);
});

test('entry guards run before dispatch when readiness or policy changes during lock admission', async t => {
  const f = fixture(t); f.data.due = false; await settle();
  f.data.due = true;
  t.mock.timers.tick(period);
  f.data.enabled = false;
  await settle();
  assert.equal(f.data.calls, 0);
  assert.equal(f.notes.at(-1).readiness, 'cognition-disabled');
  assert.equal(f.notes.at(-1).kind, 'scheduled');
});

test('simultaneous hourly and typed deadlines each run once under genuine exclusive lock semantics', async t => {
  const f = fixture(t);
  let busy = false;
  const held: (() => void)[] = [];
  f.environment.locks.request = async (_key, opts: any, cb) => {
    if (busy && opts.ifAvailable) return cb(null);
    if (busy) await new Promise<void>(resolve => held.push(resolve));
    busy = true;
    await Promise.resolve();
    try { return cb({}); } finally { busy = false; held.shift()?.(); }
  };
  await settle();
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(period); await settle(); }
  assert.equal(f.data.calls, 5);
  assert.equal(f.data.bridges, 1);
});

test('missed hidden slots are not relabeled as natural scheduled passes on reopening an empty workspace', async t => {
  const f = fixture(t); f.data.due = false; await settle(); f.visibility(true);
  t.mock.timers.tick(3*period); await settle();
  f.visibility(false); await settle(); t.mock.timers.tick(1); await settle();
  assert.equal(f.data.calls, 0);
  t.mock.timers.tick(period); await settle();
  assert.equal(f.data.calls, 1);
  assert.equal(f.notes.at(-1).kind, 'scheduled');
});

test('a lone ready owner performs due-only startup without a separate input or focus event', async t => {
  const f = fixture(t); await settle();
  assert.equal(f.data.calls, 1);
  assert.equal(f.notes.filter(r => r.kind === 'catchup').length, 1);
});

test('recent peer admission defers local work until the shared 15-minute window ends', async t => {
  const f = fixture(t); await settle();
  const key = [...f.disk.keys()][0]!;
  t.mock.timers.tick(period - 120_000); await settle();
  f.disk.set(key, String(Date.now()));
  t.mock.timers.tick(120_000); await settle();
  assert.equal(f.data.calls, 1, 'local slot respects the recent pass in a peer');
  t.mock.timers.tick(period - 120_000); await settle();
  assert.equal(f.data.calls, 2);
});

test('a scheduled admission held across hide and resume cannot claim a natural completion', async t => {
  const f = fixture(t); await settle();
  let admit!: () => void;
  let blocked = true;
  f.environment.locks.request = async (_key, _opts, cb) => {
    if (blocked) { blocked = false; await new Promise<void>(resolve => { admit = resolve; }); }
    return cb({});
  };
  t.mock.timers.tick(period);
  f.visibility(true); f.visibility(false);
  admit(); await settle();
  assert.equal(f.data.calls, 2);
  assert.equal(f.notes.at(-1).kind, 'catchup');
  assert.equal(f.notes.some(r => r.kind === 'scheduled' && r.outcome === 'completed'), false);
});

test('the actual initial source loader releases calibration after an attempted markets wave, independently of news', async () => {
  const loader = readFileSync(new URL('../../../app/data-loader.ts', import.meta.url), 'utf8');
  const begin = loader.indexOf(' const runGuarded =', loader.indexOf('async loadAllData()'));
  const end = loader.indexOf(' const tasks:', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = ts.transpileModule(loader.slice(begin, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let ready = 0;
  const manager = { ctx: { inFlight: new Set(), isDestroyed: false },
    callbacks: { onForecastInputsAttempted() { ready++; } } };
  const guarded = new Function('slog', 'console', body + ';return runGuarded;').call(manager, () => undefined, { error() {} });
  let finishNews!: () => void;
  const news = guarded('news', () => new Promise<void>(done => { finishNews = done; }));
  await guarded('markets', () => Promise.reject(Error('no live evidence')));
  assert.equal(ready, 1);
  finishNews(); await news;
  assert.equal(ready, 1);
  let finishMarkets!: () => void;
  const inFlight = guarded('markets', () => new Promise<void>(done => { finishMarkets = done; }));
  manager.ctx.isDestroyed = true;
  finishMarkets(); await inFlight;
  assert.equal(ready, 1, 'a completed request cannot mark a disposed owner ready');
  await guarded('markets', () => Promise.resolve());
  assert.equal(ready, 1);
});

test('the production panel releases its owner and refuses delayed imports after teardown', () => {
  const src = readFileSync(new URL('../../../app/panel-layout.ts', import.meta.url), 'utf8');
  const wiring = src.slice(src.indexOf("import('@/services/intelligence/outcome-resolvers')"), src.indexOf('outcome resolver wiring failed'));
  const assertBefore = (whole: string, first: string, second: string) => {
    const a = whole.indexOf(first), b = whole.indexOf(second);
    assert.ok(a >= 0 && b > a, first + ' precedes ' + second);
  };
  assertBefore(wiring, 'if (this.destroyed || this.ctx.isDestroyed) return;', 'this.calibrationScheduler = startCalibrationResolutionScheduler');
  assert.match(wiring, /isReady: \(\) => this\.calibrationInputsReady && isCalibrationSnapshotCurrent\(\)/);
  assert.match(wiring, /return dispatchMeasuredOutcomeResolvers\(/);
  assert.match(wiring, /bridge: settleCalibrationBridges/);
  assert.match(src.slice(src.indexOf('  destroy(): void {'), src.indexOf('this.calibrationScheduler = undefined;') + 1), /this\.calibrationScheduler\?\.stop\(\)/);
  const app = readFileSync(new URL('../../../App.ts', import.meta.url), 'utf8');
  assert.match(app, /onForecastInputsAttempted: \(\) => this\.panelLayout\.markCalibrationInputsReady\(\)/);
});

test('a busy writer cannot keep an old pass queued past the five-second deadline; the next scheduled pass recovers', async t => {
  const f = fixture(t); await settle();
  const controller = new AbortController();
  let deadline = 0;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { deadline = ms; return controller.signal; });
  let aborted = false;
  const unlocked = f.environment.locks.request;
  f.environment.locks.request = async (_key, opts: { signal: AbortSignal }) => new Promise<void>((_, reject) => {
    opts.signal.addEventListener('abort', () => { aborted = true; reject(new Error('timed out')); }, { once: true });
  });
  t.mock.timers.tick(period); await settle();
  assert.equal(deadline, 5000, 'locks are admitted for at most five seconds');
  controller.abort(); await settle();
  assert.equal(aborted, true);
  assert.equal(f.data.calls, 1);
  assert.equal(f.notes.at(-1).readiness, 'coordination-unavailable');
  assert.equal(f.notes.at(-1).outcome, 'skipped');
  f.environment.locks.request = unlocked;
  t.mock.timers.tick(period); await settle();
  assert.equal(f.data.calls, 2);
  assert.equal(f.notes.at(-1).outcome, 'completed');
});
