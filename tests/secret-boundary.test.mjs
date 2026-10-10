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
  const sync = main.slice(main.indexOf('async fn sync_secret_to_sidecar('), main.indexOf('/// Both normal and late publication'));
  assert.match(sync, /sync_secret_keys_to_sidecar\(app, vec!\[key\.to_string\(\)\]\)\.await/);
  const sender = main.slice(main.indexOf('async fn post_secret_update('), main.indexOf('/// Snapshots select keys only'));
  assert.match(sender, /secret_sync::send\(/, 'Settings uses the tested real controller');
  assert.match(sender, /cache\.revisions\.snapshot\(&cache\.secrets, key\)/, 'missing is a revisioned null and poison is unavailable');
  assert.match(sender, /confirmed_sidecar_target\(app\)\.map_err/, 'each attempt resolves only our confirmed live sidecar');
  assert.match(sender, /sidecar_env_update_body\(key, &snapshot\)/, 'request includes the authoritative value and revision');
  assert.match(main, /inject_secrets_into_running_sidecar\(&app, secrets\)\.await/, 'manual reload uses the sender');
  assert.match(main, /inject_secrets_into_running_sidecar\(&setup_handle, secrets\)\.await/, 'boot uses the sender');
  assert.match(main, /inject_secrets_into_running_sidecar\(&retry_handle, recovered\)\.await/, 'recovery uses the sender');
  const boot = main.slice(main.indexOf('async fn inject_secrets_into_running_sidecar('), main.indexOf('async fn sync_secret_keys_to_sidecar('));
  assert.match(boot, /sync_secret_keys_to_sidecar\(app, secrets\.into_iter\(\)\.map\(\|\(key, _\)\| key\)/, 'boot snapshots contribute keys only to the same controller');
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


test('native launch fences all allowed keys and reconciles both confirmation paths through the real sender', () => {
  const start = main.slice(main.indexOf('fn start_local_api('), main.indexOf('/// Frontend → desktop log bridge'));
  assert.match(start, /revisions\.launch\(&secrets_cache\.secrets\)/, 'launch snapshot and floor share cache ownership');
  assert.ok(start.indexOf('drop(token_slot);') > start.indexOf('let local_api_token = token_slot.clone().unwrap();'));
  assert.ok(start.indexOf('drop(token_slot);') < start.indexOf('let child = cmd'), 'release token ownership before publication can re-read it');
  assert.match(start, /cmd\.env\("LOCAL_API_SECRET_REVISION_FLOOR", seed_floor\)/);
  assert.match(start, /launch_secrets\.install\(generation, launch_secrets\)/);
  assert.match(start, /Tick::Running\(late\)[\s\S]*?if let Some\(port\) = late \{[\s\S]*?schedule_launch_secret_reconciliation\(&app_handle, generation\)/, 'late confirmation reconciles');
  assert.match(start, /Publication::Confirmed\(port\) => \{[\s\S]*?schedule_launch_secret_reconciliation\(app, generation\)/, 'normal confirmation reconciles');
  const scheduler = main.slice(main.indexOf('fn schedule_launch_secret_reconciliation('), main.indexOf('// ── Sidecar supervision'));
  assert.match(scheduler, /generation\.load\(Ordering::SeqCst\) != generation/);
  assert.match(scheduler, /take_changed\(generation, &cache\.secrets\)/);
  assert.match(scheduler, /sync_secret_keys_to_sidecar\(&handle, keys\)\.await/);
});

test('revision receiver is bundled and wraps every existing credential and cache effect', () => {
  const server = readFileSync(path.join(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
  const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.ok(config.bundle.resources.includes('sidecar/secret-sync.mjs'));
  assert.match(server, /import \{ createSecretUpdateReceiver \} from '\.\/secret-sync\.mjs'/);
  const route = server.slice(server.indexOf("if (requestUrl.pathname === '/api/local-env-update')"), server.indexOf("if (requestUrl.pathname === '/api/local-validate-secret')"));
  assert.ok(route.indexOf('isValidToken(') < route.indexOf('await readBody(req)'));
  assert.ok(route.indexOf('await readBody(req)') < route.indexOf('context.secretUpdates(JSON.parse('));
  assert.doesNotMatch(route, /delete process\.env|process\.env\[[^\]]+\]\s*=|moduleCache\.clear/);
  const transaction = server.slice(server.indexOf('context.secretUpdates = createSecretUpdateReceiver('), server.indexOf('  loadVerboseState(context.dataDir);', server.indexOf('context.secretUpdates = createSecretUpdateReceiver(')));
  assert.match(transaction, /native: context\.mode === 'tauri-sidecar'/);
  assert.match(transaction, /floor: process\.env\.LOCAL_API_SECRET_REVISION_FLOOR/);
  assert.doesNotMatch(transaction, /\bawait\b/);
  for (const effect of ['delete process.env[key]', 'process.env[key] = String(value)', 'aisOnKeyChanged(', 'invalidateOpenaqCredentialState(', 'acledTokenState.refreshToken =', 'acledTokenState.expiresAt =', 'synchronizeInfrastructureBgpCredential(', 's2uXmppApplyCreds()', 'moduleCache.clear()', 'failedImports.clear()', 'cloudPreferred.clear()', '_sidecarCache.clear()', '_responseCache.clear()']) {
    assert.ok(transaction.includes(effect), effect);
  }
});
