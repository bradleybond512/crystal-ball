import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/app/desktop-updater.ts', import.meta.url), 'utf8');

test('native staging accepts no renderer-selected artifact inputs', () => {
  assert.match(native, /async fn stage_latest_update\(\s*webview: Webview\s*\)/);
  assert.doesNotMatch(native, /async fn stage_update\(/);
  assert.doesNotMatch(native, /^\s*stage_update,$/m);
});

test('the renderer requests staging without supplying an artifact or checksum', () => {
  assert.match(renderer, /invokeTauri(?:<[^>]+>)?\('stage_latest_update'\)/);
  assert.doesNotMatch(renderer, /['"]stage_update['"]/);
  assert.doesNotMatch(renderer, /expectedSha256|fetchExpectedSha256/);
});

test('native staged readiness has no renderer-storage fallback', () => {
  assert.doesNotMatch(renderer, /wm-update-staged-/);
  assert.doesNotMatch(renderer, /['"]staged_update_status['"]/);
  assert.doesNotMatch(native, /async fn staged_update_status\(/);
});

test('embedded native identity stops staging, manual apply and boot before their first side effect', () => {
  const stage = native.slice(native.indexOf('async fn stage_latest_update('), native.indexOf('fn stage_verified_update('));
  const stageGuard = stage.indexOf('updater_policy::require_full_channel(&config.identifier, config.product_name.as_deref())?');
  assert.ok(stageGuard >= 0 && stageGuard < stage.indexOf('UpdateStageGuard::acquire()'));
  assert.match(stage, /let config = webview\.app_handle\(\)\.config\(\)/);
  const apply = native.slice(native.indexOf('async fn apply_staged_update('), native.indexOf('fn apply_staged_update_blocking('));
  const applyGuard = apply.indexOf('updater_policy::require_full_channel(&config.identifier, config.product_name.as_deref())?');
  assert.ok(applyGuard >= 0 && applyGuard < apply.indexOf('spawn_blocking('));
  const boot = native.slice(native.indexOf('fn maybe_apply_staged_update_on_boot('), native.indexOf('async fn fetch_polymarket('));
  const guard = boot.indexOf('updater_policy::require_full_channel(identifier, product_name)');
  assert.ok(guard >= 0 && guard < boot.indexOf('resolve_update_install_path()'));
  assert.ok(guard < boot.indexOf('Path::new(&staged).exists()'));
  assert.equal((native.match(/tauri::generate_context!\(\)/g) ?? []).length, 1);
  assert.match(native, /maybe_apply_staged_update_on_boot\(&context\.config\(\)\.identifier, context\.config\(\)\.product_name\.as_deref\(\)\)/);
  assert.match(native, /\.build\(context\)/);
});
