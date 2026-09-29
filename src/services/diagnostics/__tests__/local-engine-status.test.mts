import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLocalEngineView,
  fetchLocalEngineStatus,
  parseLocalEngineStatus,
  requestLocalEngineRestart,
} from '../local-engine-status.ts';

const base = {
  phase: 'running',
  generation: 2,
  port: 46_123,
  portConfirmed: true,
  restarts: 1,
  lastExit: { code: 0, signal: null, secondsAgo: 42 },
  nextRetryInMs: null,
  failureLimit: 5,
  failureWindowMs: 300_000,
};

test('parses the native status payload', () => {
  assert.deepEqual(parseLocalEngineStatus(base), base);
  assert.deepEqual(parseLocalEngineStatus({ ...base, port: null, lastExit: null, portConfirmed: false }), {
    ...base, port: null, lastExit: null, portConfirmed: false,
  });
});

test('rejects malformed payloads instead of guessing', () => {
  for (const bad of [
    null, 'running', 42,
    { ...base, phase: 'exploded' },
    { ...base, generation: -1 },
    { ...base, restarts: 1.5 },
    { ...base, port: 70_000 },
    { ...base, port: '46123' },
    { ...base, portConfirmed: 'yes' },
    { ...base, nextRetryInMs: -5 },
    { ...base, lastExit: { code: 'x', signal: null, secondsAgo: 1 } },
    { ...base, lastExit: { code: 0, signal: null } },
    { ...base, failureLimit: undefined },
  ]) {
    assert.equal(parseLocalEngineStatus(bad), null, JSON.stringify(bad));
  }
});

test('the view explains each phase and offers Restart only when stopped', () => {
  assert.deepEqual(buildLocalEngineView({ ...parseLocalEngineStatus(base)!, restarts: 0 }), {
    tone: 'ok', text: 'Local engine running', canRestart: false,
  });
  assert.equal(buildLocalEngineView(parseLocalEngineStatus(base)).text, 'Local engine running (1 restart this session)');
  assert.deepEqual(buildLocalEngineView(parseLocalEngineStatus({ ...base, phase: 'restarting', nextRetryInMs: 3_200 })), {
    tone: 'warn', text: 'Local engine restarting (next try in 4 s)', canRestart: false,
  });
  assert.deepEqual(buildLocalEngineView(parseLocalEngineStatus({ ...base, phase: 'stopped' })), {
    tone: 'bad', text: 'Local engine stopped after 5 failures in 5 min — use Restart local engine', canRestart: true,
  });
  assert.equal(buildLocalEngineView(null).canRestart, false);
  assert.equal(buildLocalEngineView(parseLocalEngineStatus({ ...base, phase: 'shutting_down' })).canRestart, false);
});

test('IPC helpers call the trusted commands and validate the answer', async () => {
  const seen: string[] = [];
  const invoke = async <T>(command: string) => { seen.push(command); return base as T; };
  assert.deepEqual(await fetchLocalEngineStatus(invoke), base);
  assert.deepEqual(await requestLocalEngineRestart(invoke), base);
  assert.deepEqual(seen, ['get_local_api_status', 'restart_local_api']);
  assert.equal(await fetchLocalEngineStatus(async () => null), null);
});
