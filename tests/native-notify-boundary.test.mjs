// R4-BUG-002 source gates: every native notification goes through one honest
// entry point, and the native command reports real outcomes per priority lane.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

function tsSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'generated') continue;
      out.push(...tsSources(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

test('send_notification is invoked only from services/native-notify.ts', () => {
  const offenders = tsSources(join(root, 'src'))
    .filter((file) => readFileSync(file, 'utf8').includes("'send_notification'"))
    .map((file) => relative(root, file));
  assert.deepEqual(offenders, ['src/services/native-notify.ts']);
});

test('native send_notification reports outcomes through the priority lane policy', () => {
  const main = readFileSync(join(root, 'src-tauri/src/main.rs'), 'utf8');
  const fn = main.slice(main.indexOf('fn send_notification('), main.indexOf('fn imessage_service('));
  assert.match(fn, /priority: Option<String>/);
  assert.match(fn, /-> Result<NativeOutcome, String>/);
  assert.match(fn, /notify_policy::Priority::parse\(priority\.as_deref\(\)\)/);
  assert.match(fn, /Admission::RateLimited\s*\{\s*return Ok\(NativeOutcome::RateLimited\);/);
  assert.match(fn, /Ok\(NativeOutcome::Delivered\)/);
  assert.doesNotMatch(main, /NOTIFICATION_LAST_SENT|NOTIFICATION_RATE_LIMIT/);
  assert.doesNotMatch(main, /return Ok\(\(\)\); \/\/ suppressed/);
  assert.match(main, /^mod notify_policy;$/m);
});

test('speak_aloud reports rate limiting instead of a silent success', () => {
  const main = readFileSync(join(root, 'src-tauri/src/main.rs'), 'utf8');
  const fn = main.slice(main.indexOf('fn speak_aloud('), main.indexOf('fn resolve_update_install_path('));
  assert.match(fn, /-> Result<NativeOutcome, String>/);
  assert.match(fn, /return Ok\(NativeOutcome::RateLimited\);/);
});

test('only life-safety proximity notices use the critical lane', () => {
  const src = readFileSync(join(root, 'src/services/proximity-alerts.ts'), 'utf8');
  assert.match(src, /priority: inc\.evacuationOrders \? 'critical' : 'high'/);
  assert.match(src, /const critical = inc\.severity === 'critical';[\s\S]{0,240}priority: critical \? 'critical' : 'high'/);
  assert.equal((src.match(/priority: 'normal'/g) ?? []).length, 2, 'spills and air quality stay normal');
  assert.doesNotMatch(src, /alerted\[[^\]]+\] = Date\.now\(\);/, 'alerted is only set after delivery');
});

test('non-safety producers never request the critical lane', () => {
  for (const file of [
    'src/app/desktop-notifications.ts',
    'src/app/desktop-updater.ts',
    'src/components/CommsHealthPanel.ts',
    'src/components/EconomicStressPanel.ts',
    'src/components/ResourceInventoryPanel.ts',
  ]) {
    const src = readFileSync(join(root, file), 'utf8');
    assert.match(src, /notifyNative\(/, `${file} uses notifyNative`);
    assert.doesNotMatch(src, /priority: 'critical'/, `${file} must not use the critical lane`);
  }
});
