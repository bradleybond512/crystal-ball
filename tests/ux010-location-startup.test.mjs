import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('startup resolves only a coarse timezone region and never acquires location', () => {
  const app = read('src/App.ts');
  const resolver = read('src/utils/user-location.ts');

  assert.match(app, /await resolveUserRegion\(\)/);
  assert.doesNotMatch(resolver, /locationService|getLocation|geolocation|latitude|longitude|coordsToRegion/);
  assert.match(resolver, /resolvedOptions\(\)\.timeZone/);
});

test('macOS startup no longer requests or retains CoreLocation authorization', () => {
  const main = read('src-tauri/src/main.rs');

  assert.doesNotMatch(main, /requestWhenInUseAuthorization/);
  assert.doesNotMatch(main, /Get device location via native CoreLocation/);
  assert.match(main, /mod current_location;/);
  assert.match(main, /current_location::get_native_location/);
  assert.match(main, /current_location::cleanup_on_exit/);
});

test('native location module is bounded, one-shot, main-only, and subprocess-free', () => {
  const source = read('src-tauri/src/current_location.rs');

  assert.match(source, /LOCATION_DEADLINE_MS:\s*u64\s*=\s*15_000/);
  assert.match(source, /label\s*==\s*"main"/);
  assert.match(source, /requestLocation/);
  assert.doesNotMatch(source, /startUpdatingLocation|Command::new|swift/);
  assert.match(source, /horizontal_accuracy_meters/);
  assert.match(source, /observed_at_unix_ms/);
  assert.match(source, /unsafe fn start_session[\s\S]*requestWhenInUseAuthorization/);
});

test('app-exit cleanup runs synchronously on the macOS event-loop thread', () => {
  const source = read('src-tauri/src/current_location.rs');

  assert.match(source, /pub fn cleanup_on_exit\(\) \{\s*#\[cfg\(target_os = "macos"\)\]\s*unsafe \{\s*macos::cleanup_all_sessions_on_main_thread\(\);\s*\}\s*\}/);
  assert.doesNotMatch(source, /pub fn cleanup_on_exit\(\)[\s\S]{0,180}run_on_main_thread/);
});

test('macOS TCC prompt uses the approved click-initiated disclosure', () => {
  const plist = read('src-tauri/Info.plist');

  assert.match(plist, /<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>Crystal Ball accesses your location only when you request a location-based feature, such as nearby Lifelines or location sharing\.<\/string>/);
});
