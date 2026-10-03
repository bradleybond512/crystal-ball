// R4-SEC-001 source and drift gates: webviews read presence for every secret
// and values only for one allowlist that native and renderer agree on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const main = read('src-tauri/src/main.rs');
const runtimeConfig = read('src/services/runtime-config.ts');
const MAP_AND_APP_KEYS = ['CESIUM_ION_TOKEN', 'GOOGLE_MAPS_API_KEY', 'MAPBOX_API_KEY', 'MAPTILER_API_KEY', 'OWM_API_KEY', 'CRYSTALBALL_API_KEY'];

function quoted(block) {
  return [...block.matchAll(/['"]([A-Z0-9_]+)['"]/g)].map((m) => m[1]).sort();
}
function rustList(name) {
  const m = main.match(new RegExp(`const ${name}: \\[&str; (\\d+)\\] = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} not found`);
  const keys = quoted(m[2]);
  assert.equal(keys.length, Number(m[1]), `${name} length annotation`);
  return keys;
}
function tsSet(source, name) {
  const m = source.match(new RegExp(`export const ${name}[^=]*= new Set<RuntimeSecretKey>\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `${name} not found`);
  return quoted(m[1]);
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('native and renderer agree on the readable allowlist', () => {
  const rust = rustList('RENDERER_READABLE_KEYS');
  const renderer = tsSet(runtimeConfig, 'RENDERER_READABLE_KEYS');
  const plaintext = tsSet(read('src/services/settings-constants.ts'), 'PLAINTEXT_KEYS');
  assert.deepEqual(rust, renderer);
  assert.deepEqual(renderer, [...plaintext, ...MAP_AND_APP_KEYS].sort());
  const supported = rustList('SUPPORTED_SECRET_KEYS');
  for (const key of rust) assert.ok(supported.includes(key), `${key} is supported`);
});

test('get_secret is gone; status and renderer config replace it', () => {
  const handlers = main.slice(main.indexOf('tauri::generate_handler!['), main.indexOf('])', main.indexOf('tauri::generate_handler![')));
  assert.doesNotMatch(handlers, /\bget_secret,/);
  assert.match(handlers, /\bget_secret_status,/);
  assert.match(handlers, /\bget_renderer_config,/);
  assert.doesNotMatch(main, /async fn get_secret\(/);
  for (const file of walk(path.join(root, 'src'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /['"]get_secret['"]/, path.relative(root, file));
  }
});

test('Settings writes reach the sidecar from native, after the vault write', () => {
  for (const name of ['set_secret', 'delete_secret']) {
    const start = main.indexOf(`async fn ${name}(`);
    const body = main.slice(start, main.indexOf('\n}\n', start));
    const persist = body.indexOf('save_vault(&proposed)?;');
    const push = body.indexOf('sync_secret_to_sidecar(&sync_app, &sync_key).await;');
    assert.ok(persist > 0 && push > persist, `${name} pushes after persisting`);
  }
  const sync = main.slice(main.indexOf('async fn sync_secret_to_sidecar('), main.indexOf('// ── Sidecar supervision (R4-BUG-004)'));
  assert.match(sync, /confirmed_sidecar_target\(app\)/, 'only to our confirmed, live sidecar');
  const afterRead = sync.slice(sync.indexOf('let value = app'), sync.indexOf('post_secret_update('));
  assert.ok(afterRead.length > 0 && !/\breturn\b/.test(afterRead), 'a missing (deleted) key is still posted');
  assert.match(sync, /post_secret_update\(&client, port, &token, key, value\.as_deref\(\)\)/, 'a deleted key is sent as an unset');
  const target = main.slice(main.indexOf('fn confirmed_sidecar_target('), main.indexOf('fn sidecar_env_update_body('));
  assert.match(target, /matches!\(child\.try_wait\(\), Ok\(None\)\)/, 'our child must be alive');
  assert.match(target, /if !alive \{\s*return Err/);
  assert.match(target, /if !state\.port_confirmed\.load\(Ordering::SeqCst\) \{\s*return Err/, 'its port must be confirmed');
});

test('both new commands are limited to trusted windows', () => {
  for (const name of ['get_secret_status', 'get_renderer_config']) {
    const start = main.indexOf(`async fn ${name}(`);
    assert.ok(start > 0, name);
    assert.match(main.slice(start, start + 200), /\{\s*require_trusted_window\(webview\.label\(\)\)\?;/, name);
  }
});

test('renderer code reads values only for allowlisted keys', () => {
  const allowed = new Set(tsSet(runtimeConfig, 'RENDERER_READABLE_KEYS'));
  // Dynamic `secrets[key]?.value` reads are allowed only where the key is a PLAINTEXT key.
  const DYNAMIC_OK = new Set(['src/settings-main.ts', 'src/components/RuntimeConfigPanel.ts', 'src/services/settings-manager.ts', 'src/services/runtime-config.ts']);
  for (const file of walk(path.join(root, 'src'))) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/secrets\.([A-Z][A-Z0-9_]+)\?\.value/g)) {
      assert.ok(allowed.has(m[1]), `${rel} reads ${m[1]}, which is not renderer-readable`);
    }
    if (/secrets\[[a-z][A-Za-z]*\]\?\.value/.test(source)) {
      assert.ok(DYNAMIC_OK.has(rel), `${rel} reads a secret value by dynamic key`);
    }
  }
});

test('the sidecar can verify a saved key without being sent its value', () => {
  const sidecar = read('src-tauri/sidecar/local-api-server.mjs');
  assert.match(sidecar, /const candidate = useStored === true \? process\.env\[key\] : value;/);
  assert.match(sidecar, /validateSecretAgainstProvider\(key, candidate, safeContext\)/);
  const stored = runtimeConfig.slice(runtimeConfig.indexOf('export async function verifyStoredSecretWithApi('));
  assert.match(stored.slice(0, 900), /requestSidecarVerification\(\{ key, useStored: true, context \}\)/);
});
