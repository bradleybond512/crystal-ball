import assert from 'node:assert/strict';
import { test } from 'node:test';

// R4-BUG-004: a failed /api/health probe asks the native supervisor why, so the
// ribbon says "restarting" or "stopped — use Restart" instead of a raw error,
// and re-probes shortly after a scheduled restart.

Object.assign(globalThis, {
  window: globalThis,
  location: { href: 'tauri://localhost/index.html', protocol: 'tauri:', host: 'localhost', origin: 'tauri://localhost' },
  __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null) },
});

const { probeSidecarHealth, resetSidecarProbeForTests } = await import('../sidecar-probe.ts');
type EngineStatus = import('../local-engine-status.ts').LocalEngineStatus;

const engine = (phase: EngineStatus['phase'], nextRetryInMs: number | null = null): EngineStatus => ({
  phase, generation: 3, port: null, portConfirmed: false, restarts: 2,
  lastExit: { code: null, signal: 9, secondsAgo: 1 }, nextRetryInMs, failureLimit: 5, failureWindowMs: 300_000,
});
const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;

test('a restarting engine is reported with its next try and re-probed once', async () => {
  resetSidecarProbeForTests();
  const scheduled: number[] = [];
  const options = {
    fetchImpl: down,
    readEngineStatus: async () => engine('restarting', 2_000),
    scheduleReprobe: (delayMs: number) => { scheduled.push(delayMs); },
  };
  const verdict = await probeSidecarHealth(options);
  assert.equal(verdict.status, 'failing');
  assert.equal(verdict.reason, 'Local engine restarting (next try in 2 s)');
  await probeSidecarHealth(options);
  assert.deepEqual(scheduled, [5_000], 'one pending re-probe, 3 s after the restart is due');
});

test('a stopped engine points at the Restart button', async () => {
  resetSidecarProbeForTests();
  const verdict = await probeSidecarHealth({ fetchImpl: down, readEngineStatus: async () => engine('stopped') });
  assert.equal(verdict.status, 'failing');
  assert.match(verdict.reason, /stopped after 5 failures in 5 min — use Restart local engine/);
});

test('a running engine or no status keeps the original probe error', async () => {
  for (const readEngineStatus of [async () => engine('running'), async () => null, async () => { throw new Error('ipc'); }]) {
    resetSidecarProbeForTests();
    const verdict = await probeSidecarHealth({ fetchImpl: down, readEngineStatus });
    assert.match(verdict.reason, /unreachable: fetch failed/);
  }
});

test('a healthy probe never consults the supervisor', async () => {
  let consulted = false;
  const ok = (async () => new Response(JSON.stringify({ ok: true, port: 46_123, uptime_ms: 5_000 }), { status: 200 })) as unknown as typeof fetch;
  const verdict = await probeSidecarHealth({ fetchImpl: ok, readEngineStatus: async () => { consulted = true; return null; } });
  assert.equal(verdict.status, 'healthy');
  assert.equal(consulted, false);
});
