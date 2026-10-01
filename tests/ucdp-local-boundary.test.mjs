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

test('deleting a desktop secret unsets it in the live sidecar environment (native push, R4-SEC-001)', () => {
  const main = readFileSync('src-tauri/src/main.rs', 'utf8');
  const deleteSecret = main.slice(main.indexOf('async fn delete_secret('), main.indexOf('fn migration_marker_path('));
  assert.match(deleteSecret, /sync_secret_to_sidecar\(&sync_app, &sync_key\)\.await;/);
  assert.match(main, /fn sidecar_env_update_body\(key: &str, value: Option<&str>\)/);
  assert.doesNotMatch(runtimeConfig, /pushSecretToSidecar/);
});

test('startup invokes the bounded UCDP event fetch once without renderer retries', () => {
  assert.match(dataLoader, /const result = await fetchUcdpEvents\(\)/);
  assert.doesNotMatch(dataLoader, /for \(let attempt = 1; attempt < 3 && !result\.success/);
});
