import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../vault-intro.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
const cargo = readFileSync(
  new URL('../../../src-tauri/Cargo.toml', import.meta.url),
  'utf8',
);
const capability = JSON.parse(readFileSync(
  new URL('../../../src-tauri/capabilities/default.json', import.meta.url),
  'utf8',
)) as { permissions: string[] };

test('vault intro is an honest animation, not a simulated authentication boundary', () => {
  assert.doesNotMatch(source, /plugin:biometry\|authenticate/);
  assert.doesNotMatch(source, /FAKE_AUTH|attemptAuth|BIOMETRY_ENABLED_KEY/);
  assert.doesNotMatch(source, /BIOMETRIC SCAN READY|PLACE FINGER ON SENSOR|ACCESS GRANTED/);
  assert.doesNotMatch(mainSource, /biometric gate|secure unlock/i);
  assert.match(source, /visual intro/i);
});

test('unused native biometry is absent from the desktop attack surface', () => {
  assert.doesNotMatch(cargo, /tauri-plugin-biometry/);
  assert.equal(capability.permissions.some((permission) => permission.startsWith('biometry:')), false);
  assert.equal(existsSync(new URL('../biometric-gate.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../biometric-gate-3d.ts', import.meta.url)), false);
});
