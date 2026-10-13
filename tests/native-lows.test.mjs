// Q20 native lows: R3-SEC-008 (no unsigned-executable-memory entitlement) and
// R4-LOW-007 (the sidecar's stdout/stderr log rotates while it runs).
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('the app binary no longer requests unsigned executable memory', () => {
  const plist = read('src-tauri/Entitlements.plist');
  assert.equal(plist.includes('com.apple.security.cs.allow-unsigned-executable-memory'), false);
  assert.match(plist, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  assert.match(plist, /<key>com\.apple\.security\.personal-information\.location<\/key>\s*<true\/>/);
});

test('the sidecar log is copy-truncated by a background rotator started at spawn', () => {
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /^mod log_rotation;$/m);
  const spawn = main.indexOf('&format!("local API sidecar started pid={child_pid}")');
  assert.ok(spawn > 0);
  assert.match(main.slice(spawn, spawn + 200), /start_sidecar_log_rotator\(log_path\.clone\(\)\);/);
  assert.match(main, /log_rotation::rotate_by_copy_truncate\(&path, MAX_LOG_BYTES, MAX_LOG_BACKUPS\)/);
  assert.match(main, /SIDECAR_LOG_ROTATE_EVERY: std::time::Duration = std::time::Duration::from_secs\(60\)/);
  assert.match(main, /SIDECAR_LOG_ROTATOR\.get_or_init/);
});
