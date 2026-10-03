import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const commands = {
  // R4-SEC-001 replaced get_secret with these two value-limited reads.
  get_secret_status: ['.state::<SecretsCache>()', '.secrets', '.lock()', 'secret_status_from('],
  get_renderer_config: ['.state::<SecretsCache>()', '.secrets', '.lock()', 'renderer_config_from('],
  set_secret: ['.state::<SecretsCache>()', 'wait_until_secrets_loaded(', '.lock()', 'save_vault(', 'write_vault_shadow('],
  delete_secret: ['.state::<SecretsCache>()', 'wait_until_secrets_loaded(', '.lock()', 'save_vault(', 'write_vault_shadow('],
  read_cache_entry: ['.state::<PersistentCache>()', 'cache.get(&key)'],
  write_cache_entry: ['.state::<PersistentCache>()', 'serde_json::from_str', '.lock()', 'schedule_cache_flush('],
  delete_cache_entry: ['.state::<PersistentCache>()', '.lock()', 'schedule_cache_flush('],
  save_brief: ['std::env::var_os', 'fs::create_dir_all', 'fs::write', 'fs::set_permissions'],
};
for (const [name, operations] of Object.entries(commands)) {
  test(`${name} validates its caller and keeps all blocking work inside an awaited worker`, () => {
    const body = source.match(new RegExp(`(?:async )?fn ${name}\\([\\s\\S]*?\\n\\}`, 'u'))?.[0];
    assert.ok(body, `${name} command must exist`);
    assert.match(body, new RegExp(`async fn ${name}\\(`, 'u'));
    const worker = body.indexOf('tauri::async_runtime::spawn_blocking');
    assert.ok(worker > body.indexOf('require_trusted_window(') && body.includes('require_trusted_window('));
    assert.match(body.slice(worker), /\.await[\s\S]*\.map_err\(/u);
    assert.doesNotMatch(body.slice(0, worker), /tauri::State|\.lock\(\)|serde_json::from_str|fs::write|fs::create_dir_all/u);
    for (const operation of operations) {
      assert.ok(body.indexOf(operation) > worker, `${operation} must run inside the blocking worker`);
    }
  });
}

test('watchdog background work never queries native window focus', () => {
  const start = source.indexOf('// ── Renderer watchdog');
  const end = source.indexOf('// Mark the app data dir as excluded', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /\.is_focused\(/u);
});

test('main-window focus events handle both states on every platform', () => {
  assert.match(source, /RunEvent::WindowEvent\s*\{[\s\S]*?WindowEvent::Focused\((?!true\b|false\b)\w+\)[\s\S]*?if label == "main"/u);
  assert.doesNotMatch(source, /#\[cfg\(target_os = "macos"\)\]\s*RunEvent::WindowEvent\s*\{[^}]*?WindowEvent::Focused/u);
});

test('main focus event publishes its actual state to native watchdog authority', () => {
  assert.match(source, /MAIN_WINDOW_FOCUS\.update\(label, \*focused\)/u);
});

test('watchdog consumes native focus and records reload timing through its tested policy', () => {
  const start = source.indexOf('// ── Renderer watchdog');
  const end = source.indexOf('// Mark the app data dir as excluded', start);
  const block = source.slice(start, end);
  assert.match(block, /let focus = MAIN_WINDOW_FOCUS\.snapshot\(\)/u);
  assert.match(block, /policy\.tick\(/u);
  assert.match(block, /policy\.did_reload\(/u);
});

test('initial native focus is seeded only after the main window exists', () => {
  const build = source.indexOf('main_builder.build()');
  const seed = source.indexOf('MAIN_WINDOW_FOCUS.update("main"');
  assert.ok(build >= 0 && seed > build);
  assert.match(source.slice(seed, source.indexOf(';', seed)), /\.is_focused\(\)/u);
});
