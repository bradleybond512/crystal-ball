import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, VITE_VARIANT: 'full' };
const options = {
  cwd: root,
  encoding: 'utf8',
  env,
  maxBuffer: 10 * 1024 * 1024,
  timeout: 300_000,
};

test('focused full-variant gate type-checks and builds the application', () => {
  let result = spawnSync(process.execPath, [
    'node_modules/typescript/bin/tsc',
  ], options);
  let output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  let message = `TypeScript full-build stage failed\n${output}`;

  assert.equal(result.error, undefined, message);
  assert.equal(result.signal, null, message);
  assert.equal(result.status, 0, message);

  result = spawnSync(process.execPath, [
    'node_modules/vite/bin/vite.js',
    'build',
  ], options);
  output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  message = `Vite full-build stage failed\n${output}`;

  assert.equal(result.error, undefined, message);
  assert.equal(result.signal, null, message);
  assert.equal(result.status, 0, message);
});
