import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync('src/services/runtime.ts', 'utf8');
const runtimeConfig = readFileSync('src/services/runtime-config.ts', 'utf8');
const gateway = readFileSync('api/[domain]/v1/[rpc].ts', 'utf8');
const dataLoader = readFileSync('src/app/data-loader.ts', 'utf8');

test('desktop runtime pins both UCDP routes to the local sidecar', () => {
  assert.match(runtime, /\/api\/conflict\/v1\/list-ucdp-events/);
  assert.match(runtime, /\/api\/ucdp-classifications/);
  assert.match(runtime, /LOCAL_ONLY_API_TARGETS\.has/);
});

test('UCDP RPC is explicitly no-store at the cloud gateway', () => {
  assert.match(gateway, /'\/api\/conflict\/v1\/list-ucdp-events': 'no-store'/);
});

test('deleting a desktop secret sends the empty value to the live sidecar environment', () => {
  assert.match(runtimeConfig, /pushSecretToSidecar\(key, sanitized\)/);
  assert.doesNotMatch(runtimeConfig, /if \(sanitized\) \{\s*try \{\s*await pushSecretToSidecar/);
});

test('startup invokes the bounded UCDP event fetch once without renderer retries', () => {
  assert.match(dataLoader, /const result = await fetchUcdpEvents\(\)/);
  assert.doesNotMatch(dataLoader, /for \(let attempt = 1; attempt < 3 && !result\.success/);
});
