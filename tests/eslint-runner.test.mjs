import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(repoRoot, 'scripts', 'run-eslint.mjs');

async function loadRunner() {
  assert.equal(existsSync(runnerPath), true, 'bounded ESLint runner should exist');
  return import(pathToFileURL(runnerPath).href);
}

test('ESLint runner reports progress and returns a successful exit', async () => {
  const { runCommandWithProgress } = await loadRunner();
  const messages = [];
  const result = await runCommandWithProgress(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 40)'],
    {
      label: 'fixture',
      timeoutMs: 10_000,
      progressIntervalMs: 10,
      stdio: 'ignore',
      logger: { log: message => messages.push(message), error: message => messages.push(message) },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.ok(messages.some(message => message.includes('fixture still running')));
});

test('ESLint runner preserves a child failure exit code', async () => {
  const { runCommandWithProgress } = await loadRunner();
  const result = await runCommandWithProgress(
    process.execPath,
    ['-e', 'process.exit(7)'],
    { label: 'fixture', timeoutMs: 10_000, progressIntervalMs: 100, stdio: 'ignore' },
  );

  assert.equal(result.exitCode, 7);
  assert.equal(result.timedOut, false);
});

test('ESLint runner terminates an over-budget process with exit 124', async () => {
  const { runCommandWithProgress } = await loadRunner();
  const messages = [];
  const result = await runCommandWithProgress(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1_000)'],
    {
      label: 'fixture',
      timeoutMs: 30,
      progressIntervalMs: 10,
      killGraceMs: 30,
      stdio: 'ignore',
      logger: { log: message => messages.push(message), error: message => messages.push(message) },
    },
  );

  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.ok(messages.some(message => message.includes('exceeded 30ms')));
});
