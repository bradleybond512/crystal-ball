import assert from 'node:assert/strict';

export function createClock({ startMs = 1_000_000, seed = 36, randomValues, maxCallbacks = 50_000, maxTrace = 50_000 } = {}) {
  assert.ok(Number.isSafeInteger(startMs) && startMs > 0);
  assert.ok(Number.isSafeInteger(maxCallbacks) && maxCallbacks > 0 && maxCallbacks <= 100_000);
  assert.ok(Number.isSafeInteger(maxTrace) && maxTrace > 0 && maxTrace <= 100_000);
  assert.ok(randomValues === undefined || (randomValues.length > 0 && randomValues.every(value => Number.isFinite(value) && value >= 0 && value <= 1)));
  let now = startMs, nextId = 1, callbacks = 0, state = seed >>> 0, randomIndex = 0;
  const tasks = new Map(), trace = [];
  const record = event => { assert.ok(trace.length < maxTrace, 'Clock trace budget exceeded'); trace.push({ at: now - startMs, ...event }); };
  const clock = {
    get now() { return now; }, get elapsed() { return now - startMs; }, trace,
    random() {
      if (randomValues) return randomValues[randomIndex++ % randomValues.length];
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    },
    setTimeout(fn, delay = 0, ...args) {
      assert.equal(typeof fn, 'function'); assert.ok(Number.isFinite(delay) && delay >= 0 && delay <= Number.MAX_SAFE_INTEGER);
      const id = nextId++; tasks.set(id, { at: now + delay, fn: () => fn(...args) }); record({ kind: 'arm', id, delay }); return id;
    },
    clearTimeout(id) { if (tasks.delete(id)) record({ kind: 'cancel', id }); },
    async flushMicrotasks() { for (let turn = 0; turn < 32; turn++) await Promise.resolve(); },
    async advanceBy(ms) {
      assert.ok(Number.isFinite(ms) && ms >= 0 && ms <= 86_400_000, 'Bounded forward clock advance required');
      const target = now + ms;
      await clock.flushMicrotasks();
      while (true) {
        const due = [...tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (due.length === 0) break;
        assert.ok(++callbacks <= maxCallbacks, 'Clock callback budget exceeded');
        const [id, task] = due[0]; tasks.delete(id); now = task.at; record({ kind: 'fire', id }); task.fn(); await clock.flushMicrotasks();
      }
      now = target; await clock.flushMicrotasks();
    },
    pending() { return [...tasks].map(([id, task]) => ({ id, at: task.at - startMs })).sort((a, b) => a.at - b.at || a.id - b.id); },
    clear() { tasks.clear(); },
  };
  return clock;
}

export async function createSchedulerHarness(options = {}) {
  const clock = createClock(options), originals = [], storage = new Map(), starts = [], completions = [], messages = [], loads = new Set();
  let active = 0, maxActive = 0, disposed = false;
  const replace = (object, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key); originals.push(() => descriptor ? Object.defineProperty(object, key, descriptor) : Reflect.deleteProperty(object, key));
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  };
  const document = new EventTarget(); document.visibilityState = 'visible';
  const battery = new EventTarget(); battery.charging = true;
  const navigator = { getBattery: () => Promise.resolve(battery) };
  replace(globalThis, 'localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) });
  replace(globalThis, 'document', document); replace(globalThis, 'window', new EventTarget()); replace(globalThis, 'navigator', navigator);
  replace(globalThis, 'CustomEvent', class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } });
  replace(globalThis, 'setTimeout', clock.setTimeout); replace(globalThis, 'clearTimeout', clock.clearTimeout);
  replace(Date, 'now', () => clock.now); replace(Math, 'random', clock.random); replace(globalThis, 'performance', { now: () => clock.elapsed });
  for (const level of ['warn', 'error']) replace(console, level, (...args) => { assert.ok(messages.length < 10_000); messages.push({ level, at: clock.elapsed, message: String(args[0]) }); });
  replace(globalThis, 'fetch', () => { throw new Error('Network forbidden in scheduler fixture'); });
  let scheduler, cadence, mode, prefs, power;
  const ctx = { isDestroyed: false, inFlight: new Set() };
  try {
    const modules = await Promise.all([
      import('../../src/app/refresh-scheduler.ts'), import('../../src/services/adaptive-cadence.ts'),
      import('../../src/services/mode-manager.ts'), import('../../src/services/alerting-prefs.ts'), import('../../src/services/low-power.ts'),
    ]);
    const [{ RefreshScheduler }, cadenceModule, modeModule, prefsModule, powerModule] = modules;
    cadence = cadenceModule; mode = modeModule; prefs = prefsModule; power = powerModule;
    cadence._setOnBatteryForTest(false); mode.setMode(null); prefs.setPreset('loud'); power.setLowPowerMode(false);
    cadence.installBatteryMonitor(); await clock.flushMicrotasks(); scheduler = new RefreshScheduler(ctx);
  } catch (error) { for (const restore of originals.reverse()) restore(); throw error; }
  const harness = {
    scheduler, ctx, clock, starts, completions, messages, battery, navigator, cadence,
    get maxActive() { return maxActive; }, get active() { return active; },
    async policy({ onBattery, lowPower, silent, ghost, alwaysOn } = {}) {
      if (onBattery !== undefined) { battery.charging = !onBattery; battery.dispatchEvent(new Event('chargingchange')); }
      if (lowPower !== undefined) power.setLowPowerMode(lowPower);
      if (silent !== undefined) prefs.setPreset(silent ? 'silent' : 'loud');
      if (ghost !== undefined) mode.setMode(ghost ? 'ghost' : null);
      if (alwaysOn !== undefined) storage.set('cb-always-on', String(alwaysOn));
      await clock.flushMicrotasks();
    },
    hidden(value) { document.visibilityState = value ? 'hidden' : 'visible'; if (value) scheduler.setHiddenSince(clock.now); },
    resume() { document.visibilityState = 'visible'; scheduler.flushStaleRefreshes(); },
    job(name, { durationMs = 0, outcome = 'success', blocked = false } = {}) {
      assert.ok(Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 60_000);
      assert.ok(['success', 'unchanged', 'failure'].includes(outcome));
      return async () => {
        assert.ok(starts.length < 50_000, 'Loader trace budget exceeded'); starts.push({ name, at: clock.elapsed }); active++; maxActive = Math.max(maxActive, active);
        try {
          if (blocked || durationMs > 0) await new Promise((resolve, reject) => {
            const load = { name, resolve, reject, timer: undefined }; loads.add(load);
            if (!blocked) load.timer = clock.setTimeout(() => { loads.delete(load); resolve(); }, durationMs);
          });
          if (outcome === 'failure') throw new Error('Synthetic loader failure');
          return outcome === 'unchanged' ? false : true;
        } finally { active--; completions.push({ name, at: clock.elapsed }); }
      };
    },
    release(name, fail = false) {
      const load = [...loads].find(item => item.name === name); assert.ok(load, `Blocked loader missing: ${name}`); loads.delete(load); if (load.timer) clock.clearTimeout(load.timer);
      if (fail) load.reject(new Error('Synthetic release failure')); else load.resolve();
    },
    async dispose() {
      if (disposed) return { pendingTimers: clock.pending().length, active };
      disposed = true; ctx.isDestroyed = true; scheduler.destroy();
      for (const load of [...loads]) harness.release(load.name);
      await clock.flushMicrotasks(); const cleanup = { pendingTimers: clock.pending().length, active };
      cadence._setOnBatteryForTest(false); mode.setMode(null); prefs.setPreset('loud'); power.setLowPowerMode(false);
      clock.clear(); for (const restore of originals.reverse()) restore(); return cleanup;
    },
  };
  return harness;
}

export function summarizeStarts(starts) {
  const times = starts.map(row => row.at).sort((a, b) => a - b), perJob = {};
  for (const { name, at } of starts) (perJob[name] ??= []).push(at);
  const maxStarts = windowMs => {
    let left = 0, maximum = 0;
    for (let right = 0; right < times.length; right++) { while (times[right] - times[left] >= windowMs) left++; maximum = Math.max(maximum, right - left + 1); }
    return maximum;
  };
  return { perJob: Object.fromEntries(Object.entries(perJob).map(([name, values]) => [name, { starts: values.length, maximumStartGapMs: values.length < 2 ? null : values.slice(1).reduce((max, at, index) => Math.max(max, at - values[index]), 0), at: values }])), maxStartsInWindow: { '1': maxStarts(1), '150': maxStarts(150), '1000': maxStarts(1000) } };
}

export async function runSchedulingScenario({ seed = 36, randomValues, horizonMs = 7_200_000, intervals = [60_000], cohortSize = 1, durationMs = 0, outcome = 'success', policy = {}, hiddenUntilMs = 0 } = {}) {
  assert.ok(Number.isSafeInteger(horizonMs) && horizonMs >= 0 && horizonMs <= 28_800_000);
  assert.ok(Number.isSafeInteger(cohortSize) && cohortSize > 0 && cohortSize <= 48);
  assert.ok(intervals.length > 0 && intervals.length <= 8 && intervals.every(value => Number.isSafeInteger(value) && value >= 1000 && value <= 7_200_000));
  assert.ok(intervals.length * cohortSize <= 48); assert.ok(hiddenUntilMs >= 0 && hiddenUntilMs <= horizonMs);
  const harness = await createSchedulerHarness({ seed, randomValues });
  let summary;
  try {
    await harness.policy(policy); if (hiddenUntilMs > 0) harness.hidden(true);
    harness.scheduler.registerAll(Array.from({ length: cohortSize }, (_, cohort) => intervals.map((intervalMs, index) => ({ name: `job-${cohort}-${index}`, intervalMs, fn: harness.job(`job-${cohort}-${index}`, { durationMs, outcome }) }))).flat());
    if (hiddenUntilMs > 0) { await harness.clock.advanceBy(hiddenUntilMs); harness.resume(); }
    await harness.clock.advanceBy(horizonMs - hiddenUntilMs);
    summary = { seed, randomValues: randomValues ?? null, horizonMs, intervals, cohortSize, durationMs, outcome, policy, hiddenUntilMs, ...summarizeStarts(harness.starts), maximumActiveLoaders: harness.maxActive };
    for (let cohort = 0; cohort < cohortSize; cohort++) for (let index = 0; index < intervals.length; index++) summary.perJob[`job-${cohort}-${index}`] ??= { starts: 0, maximumStartGapMs: null, at: [] };
  } finally { const cleanup = await harness.dispose(); if (summary) summary.cleanup = cleanup; }
  return summary;
}
