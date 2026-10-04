// Hardening follow-up: shared secrets are compared in constant time, and the
// sidecar's event-store routes never fall back to the cloud API.
import { strict as assert } from 'node:assert';
import test, { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { timingSafeEqualString, timingSafeIncludes } from '../api/_timing-safe.js';
import { requireAppAuth } from '../api/_auth.js';
import { validateApiKey } from '../api/_api-key.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const saved = { ...process.env };
afterEach(() => {
  for (const key of ['CRYSTALBALL_APP_KEY', 'CRYSTALBALL_VALID_KEYS', 'LOCAL_API_PORT']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('constant-time equality matches === semantics', () => {
  assert.equal(timingSafeEqualString('k-123', 'k-123'), true);
  assert.equal(timingSafeEqualString('k-123', 'k-124'), false);
  assert.equal(timingSafeEqualString('k-123', 'k-12'), false, 'a prefix is not equal');
  assert.equal(timingSafeEqualString('k-12', 'k-123'), false);
  assert.equal(timingSafeEqualString('', ''), true);
  // Trailing NUL bytes compare equal to "missing" bytes in the loop; only the
  // length term catches them.
  assert.equal(timingSafeEqualString('key', `key${String.fromCodePoint(0)}`), false);
  assert.equal(timingSafeEqualString('', 'a'), false);
  const snow = String.fromCodePoint(0x26_03);
  assert.equal(timingSafeEqualString(`key${snow}`, `key${snow}`), true);
  assert.equal(timingSafeEqualString(`key${snow}`, 'keyx'), false);
  for (const bad of [undefined, null, 1, {}]) assert.equal(timingSafeEqualString(bad, 'a'), false);
});

test('includes checks every entry and finds any position', () => {
  const keys = new Set(['alpha', 'bravo', 'charlie']);
  assert.equal(timingSafeIncludes(keys, 'alpha'), true);
  assert.equal(timingSafeIncludes(keys, 'charlie'), true);
  assert.equal(timingSafeIncludes(keys, 'delta'), false);
  assert.equal(timingSafeIncludes(new Set(), 'alpha'), false);
});

test('the comparison loop never exits early', () => {
  const source = read('api/_timing-safe.js');
  const body = source.slice(source.indexOf('export function timingSafeEqualString'), source.indexOf('/** True when'));
  const loop = body.slice(body.indexOf('for ('), body.indexOf('return diff === 0'));
  assert.equal(/return|break/.test(loop), false, 'no return or break inside the byte loop');
  const includes = source.slice(source.indexOf('export function timingSafeIncludes'));
  assert.equal(/return true|break/.test(includes), false, 'every candidate is compared');
});

test('the app key gate accepts only the exact key', () => {
  delete process.env.LOCAL_API_PORT;
  process.env.CRYSTALBALL_APP_KEY = 'app-key-123';
  const call = (key) => requireAppAuth(new Request('https://x/api/y', { headers: key === undefined ? {} : { 'X-CrystalBall-Key': key } }), {});
  assert.equal(call('app-key-123'), null);
  assert.equal(call('app-key-12')?.status, 401);
  assert.equal(call('app-key-1234')?.status, 401);
  assert.equal(call(undefined)?.status, 401);
});

test('API keys are matched against every configured key', () => {
  process.env.CRYSTALBALL_VALID_KEYS = 'k1,k2';
  const desktop = (key) => validateApiKey(new Request('https://x/api/y', { headers: { Origin: 'tauri://localhost', 'X-CrystalBall-Key': key } }));
  assert.equal(desktop('k2').valid, true);
  assert.equal(desktop('k1').valid, true);
  assert.equal(desktop('k3').valid, false);
  assert.equal(desktop('k').valid, false);
});

test('no plain comparison of secrets remains in the auth helpers', () => {
  assert.equal(read('api/_auth.js').includes('provided !== expected'), false);
  assert.equal(read('api/_api-key.js').includes('validKeys.has('), false);
});

test("the sidecar's event-store routes are local-only in the renderer", () => {
  const runtime = read('src/services/runtime.ts');
  const list = runtime.slice(runtime.indexOf('const LOCAL_ONLY_API_TARGETS'), runtime.indexOf(']);', runtime.indexOf('const LOCAL_ONLY_API_TARGETS')));
  for (const route of ['health', 'query', 'count', 'prune']) {
    assert.ok(list.includes(`'/api/events/${route}'`), route);
  }
});
