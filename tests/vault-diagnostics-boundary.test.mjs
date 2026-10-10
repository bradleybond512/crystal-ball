// R3-SEC-003 phase A: the keys & signing diagnostics are trusted-window only
// and never carry a secret value; shadow fallbacks are counted and logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const main = readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');

function structFields(name) {
  const start = main.indexOf(`struct ${name} {`);
  assert.ok(start >= 0, name);
  return [...main.slice(start, main.indexOf('}', start)).matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

test('get_vault_diagnostics is registered and trusted-window only', () => {
  const handlers = main.slice(main.indexOf('tauri::generate_handler!['), main.indexOf('])', main.indexOf('tauri::generate_handler![')));
  assert.match(handlers, /\bget_vault_diagnostics,/);
  const start = main.indexOf('async fn get_vault_diagnostics(');
  assert.match(main.slice(start, start + 200), /\{\s*require_trusted_window\(webview\.label\(\)\)\?;/);
});

test('the diagnostics carry no secret values', () => {
  assert.deepEqual(structFields('VaultDiagnostics'), ['signing', 'vault_source', 'saves_gated', 'shadow_fallbacks']);
  assert.deepEqual(structFields('SigningInfo'), ['kind', 'authority']);
  assert.deepEqual(structFields('ShadowFallbacks'), ['count', 'last_at_ms']);
});

test('the signing check reads only the app bundle, with a timeout', () => {
  const start = main.indexOf('fn running_app_signing()');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(body, /Command::new\("\/usr\/bin\/codesign"\)\.args\(\["-dv", "--verbose=2"\]\)\.arg\(&bundle\)/);
  assert.match(body, /recv_timeout\(Duration::from_secs\(5\)\)/);
  assert.doesNotMatch(body, /security|Entry::|keyring/);
});

test('every shadow-vault fallback is counted and logged as a warning', () => {
  const load = main.slice(main.indexOf('fn read_vault_for_load('), main.indexOf('fn read_legacy_for_migration('));
  const shadow = load.slice(load.indexOf('match read_vault_shadow(app) {'));
  assert.match(shadow, /let fallbacks = record_shadow_fallback\(app\);[\s\S]*"WARN",[\s\S]*shadow fallback #\{fallbacks\}/);
});

test('boot logs how the running app is signed', () => {
  assert.match(main, /let signing = running_app_signing\(\);\s*append_desktop_log\(\s*&load_handle,\s*if signing\.kind == "stable" \{ "INFO" \} else \{ "WARN" \},/);
});

test('System Diagnostic shows the row, escaped, and keeps it fresh', () => {
  const panel = readFileSync(path.join(root, 'src/components/SystemDiagnosticPanel.ts'), 'utf8');
  const selfTest = panel.slice(panel.indexOf('private renderSelfTest('), panel.indexOf('private async refreshLocalEngine('));
  assert.match(selfTest, /\$\{this\.renderLocalEngine\(\)\}\s*\$\{this\.renderVaultDiagnostics\(\)\}/);
  const row = panel.slice(panel.indexOf('private renderVaultDiagnostics('), panel.indexOf('private renderLocalEngineRestartButton('));
  assert.match(row, /\$\{escapeHtml\(view\.text\)\}/);
  const start = panel.slice(panel.indexOf('private start(): void {'), panel.indexOf('public override destroy('));
  assert.equal((start.match(/void this\.refreshVaultDiagnostics\(\);/g) ?? []).length, 2, 'on open and on every refresh');
});
