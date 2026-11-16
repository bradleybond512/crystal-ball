import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

async function mockedChild(t, suffix, spawned = true) {
  const child = new EventEmitter();
  child.pid = spawned ? 123456 : undefined; // Synthetic only; no OS signals or process lookup.
  child.exitCode = null; child.signalCode = null; child.calls = [];
  child.kill = (signal) => {
    child.calls.push(signal);
    child.emit('error', Object.assign(new Error('synthetic signal failure'), { code: 'EPERM' }));
    return false;
  };
  const spawnMock = t.mock.method(childProcess, 'spawn', () => child);
  syncBuiltinESMExports();
  t.after(() => { spawnMock.mock.restore(); syncBuiltinESMExports(); });
  const { runChild } = await import(new URL(`../.github/tools/filesystem-mcp/child-lifecycle.mjs?${suffix}`, import.meta.url));
  const outcome = runChild({ command: '/synthetic-never-executed', args: [], options: {} });
  let settled = false;
  const observed = outcome.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  if (spawned) child.emit('spawn');
  t.after(() => { child.emit('exit', 1, null); child.emit('close', 1, null); });
  return { child, observed, settled: () => settled };
}

test('post-spawn kill error retains ownership and escalation until actual close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await mockedChild(t, 'live-error');
  process.emit('SIGTERM'); // Deliver only to this isolated test-process listener, not the OS.
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.settled(), false, 'a signal error is not child reaping');
  assert.deepEqual(f.child.calls, ['SIGTERM']);
  assert.doesNotThrow(() => t.mock.timers.tick(2000), 'repeated escalation error must be handled');
  assert.deepEqual(f.child.calls, ['SIGTERM', 'SIGKILL']);
  assert.equal(f.settled(), false, 'failed escalation is not observed exit');
  f.child.emit('exit', 1, null); f.child.emit('close', 1, null);
  const result = await f.observed;
  assert.equal(result.error?.code, 'EPERM', 'signal failure remains visible after reaping');
});

test('repeated post-spawn errors retain an error listener until close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await mockedChild(t, 'repeated-error');
  const error = Object.assign(new Error('synthetic kill error'), { code: 'EPERM' });
  f.child.emit('error', error);
  assert.doesNotThrow(() => f.child.emit('error', error), 'second live-child error must not become unhandled');
  f.child.emit('exit', 1, null); f.child.emit('close', 1, null);
  assert.equal((await f.observed).error?.code, 'EPERM');
});

test('actual spawn failure with no child rejects without pretending to reap', async t => {
  const f = await mockedChild(t, 'spawn-failure', false);
  const error = Object.assign(new Error('synthetic spawn failure'), { code: 'ENOENT' });
  f.child.emit('error', error);
  assert.equal((await f.observed).error, error);
  assert.deepEqual(f.child.calls, []);
});
