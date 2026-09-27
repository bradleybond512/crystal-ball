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
