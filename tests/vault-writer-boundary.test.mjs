// R3-BUG-001 slice B source gates: the one vault writer owns every cache
// change, vault write, shadow write and sidecar push; nothing holds the cache
// lock across the Keychain; readiness is signalled, not polled; saves are
// gated on a complete vault source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const main = read('src-tauri/src/main.rs');
const coordinator = read('src-tauri/src/vault_coordinator.rs');

function fnBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  return source.slice(start, source.indexOf('\n}\n', start));
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

test('only the vault writer store writes the vault and the shadow copy', () => {
  const store = main.slice(main.indexOf('impl VaultStore for TauriVaultStore'), main.indexOf('    fn late_outcome('));
  assert.equal(occurrences(main, 'save_vault('), 2, 'the definition and the store');
  assert.match(store, /save_vault\(secrets\)/);
  assert.equal(occurrences(main, 'write_vault_shadow('), 2, 'the definition and the store');
  assert.match(store, /write_vault_shadow\(&self\.app, secrets\)/);
  assert.equal(occurrences(main, '.delete_credential()'), 1, 'only migration cleanup, inside the store');
  assert.match(store, /fn finish_migration[\s\S]*delete_credential\(\)[\s\S]*mark_migration_done/);
});

test('nothing in main.rs locks the cache directly', () => {
  assert.doesNotMatch(main, /\.secrets\.lock\(\)/);
  assert.doesNotMatch(main, /user_mutated|populate_from_keychain|repopulate_vault_only|read_keychain_blocking/);
  assert.match(fnBody(main, 'fn start_local_api('), /secrets_cache\.state\.transport_launch\(&secrets_cache\.revisions\)/);
});

test('the writer never holds the cache lock across the Keychain or the disk', () => {
  const mutate = coordinator.slice(coordinator.indexOf('    fn mutate(&self, key: &str, value: Option<&str>)'), coordinator.indexOf('    fn apply_load('));
  const snapshotEnd = mutate.indexOf('            proposed\n        };');
  const write = mutate.indexOf('self.store.write_vault(&proposed)?;');
  const relock = mutate.indexOf('let mut inner = self.state.lock();');
  assert.ok(snapshotEnd > 0 && write > snapshotEnd && relock > write, 'copy, unlock, write, then lock to commit');
  const commitBlock = mutate.slice(relock, mutate.indexOf('        self.store.write_shadow(&proposed);'));
  assert.doesNotMatch(commitBlock, /self\.store\./, 'no store call while committing');
  const load = coordinator.slice(coordinator.indexOf('    fn apply_load('), coordinator.indexOf('    fn migrate('));
  assert.ok(load.indexOf('self.store.write_shadow(&map);') > load.indexOf('inner.source\n        };'), 'shadow refresh after unlock');
});

test('saves wait on signalled readiness, then go through the writer with a bound', () => {
  assert.doesNotMatch(main, /fn wait_until_secrets_loaded/);
  const save = fnBody(main, 'fn save_secret_change(');
  assert.match(save, /cache\.state\.wait_loaded\(SECRET_SAVE_WAIT\)/);
  assert.match(save, /\.mutate\(key, value, SECRET_SAVE_WAIT\)\.into_result\(\)/);
  assert.match(main, /const SECRET_SAVE_WAIT: Duration = Duration::from_secs\(15\);/);
  assert.match(coordinator, /wait_timeout_while\(guard, timeout, \|phase\| \*phase == LoadPhase::Loading\)/);
  for (const name of ['set_secret', 'delete_secret']) {
    const body = fnBody(main, `async fn ${name}(`);
    assert.match(body, /require_trusted_window\(webview\.label\(\)\)\?;/);
    assert.match(body, /spawn_blocking\(move \|\| save_secret_change\(/);
    assert.doesNotMatch(body, /\.lock\(\)/);
  }
});

test('boot fails closed through a guard, and the retry stays vault-only', () => {
  const boot = main.slice(main.indexOf(' // 2. Read the keychain on a worker thread and hand the result to the'), main.indexOf(' Ok(())\n })\n .build('));
  assert.match(boot, /let _guard = LoadGuard::new\(cache\.state\.clone\(\)\);/);
  assert.match(boot, /read_vault_only\(KEYCHAIN_VAULT_RETRY_TIMEOUT\)/);
  const retry = boot.slice(boot.indexOf('if vault_timed_out {'));
  assert.doesNotMatch(retry, /read_vault_for_load|read_legacy_for_migration|read_vault_shadow/);
  assert.match(main, /VaultCoordinator::start\(cache\.state\.clone\(\), store\)/);
  assert.match(main, /Err\(err\) => \{[\s\S]{0,200}cache\.state\.mark_failed\(\);/);
});

test('a read error never counts as an empty vault', () => {
  const classify = fnBody(main, 'fn classify_keychain_read(');
  assert.match(classify, /Err\(keyring::Error::NoEntry\) => KeychainRead::Absent,/);
  assert.match(classify, /Err\(_\) => KeychainRead::Error,/);
  const load = fnBody(main, 'fn read_vault_for_load(');
  assert.match(load, /KeychainRead::Error => \{[\s\S]*ReadResult::Unavailable/);
  assert.match(load, /KeychainRead::Absent => \(read_legacy_for_migration\(app\), false\)/);
  assert.match(coordinator, /VaultSource::Vault \| VaultSource::Absent => None,/);
});

test('the write state command is trusted-window only and carries no value', () => {
  const handlers = main.slice(main.indexOf('tauri::generate_handler!['), main.indexOf('])', main.indexOf('tauri::generate_handler![')));
  assert.match(handlers, /\bget_secret_write_state,/);
  const body = fnBody(main, 'async fn get_secret_write_state(');
  assert.match(body, /^async fn get_secret_write_state\(webview: Webview\)[^{]*\{\s*require_trusted_window\(webview\.label\(\)\)\?;/);
  const fields = main.slice(main.indexOf('struct SecretWriteState {'), main.indexOf('}', main.indexOf('struct SecretWriteState {')));
  assert.deepEqual([...fields.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]), ['revision', 'pending', 'source']);
});

test('webviews still have no Tauri event permission (the late outcome is pulled)', () => {
  const dir = path.join(root, 'src-tauri/capabilities');
  for (const file of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(path.join(dir, file), 'utf8'), /core:event/, file);
  }
});
