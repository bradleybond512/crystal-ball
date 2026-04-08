import test from 'node:test';
import assert from 'node:assert/strict';

import {
  updateCargoLockVersion,
  updatePackageLockVersion,
} from '../scripts/sync-desktop-version-lib.mjs';

test('updatePackageLockVersion updates both root version fields', () => {
  const packageLock = {
 name: 'crystal-ball',
 version: '2.6.1',
 packages: {
 '': {
 name: 'crystal-ball',
 version: '2.6.1',
 },
 'node_modules/esbuild': {
 version: '0.27.3',
 },
 },
  };

  const result = updatePackageLockVersion(packageLock, '2.7.0');

  assert.equal(result.changed, true);
  assert.equal(result.currentVersion, '2.6.1');
  assert.equal(result.updatedLockfile.version, '2.7.0');
  assert.equal(result.updatedLockfile.packages[''].version, '2.7.0');
  assert.equal(result.updatedLockfile.packages['node_modules/esbuild'].version, '0.27.3');
});

test('updateCargoLockVersion only updates the app package block', () => {
  const cargoLock = `[[package]]
name = "serde"
version = "1.0.0"

[[package]]
name = "crystal-ball"
version = "2.6.1"
dependencies = [
 "serde",
]

[[package]]
name = "crystal-ball-helper"
version = "9.9.9"
`;

  const result = updateCargoLockVersion(cargoLock, 'crystal-ball', '2.7.0');

  assert.equal(result.changed, true);
  assert.equal(result.currentVersion, '2.6.1');
  assert.match(result.updatedLock, /name = "crystal-ball"\nversion = "2.7.0"/);
  assert.match(result.updatedLock, /name = "crystal-ball-helper"\nversion = "9.9.9"/);
});
