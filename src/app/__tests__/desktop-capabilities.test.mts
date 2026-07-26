import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface Capability {
  windows: string[];
  permissions: string[];
}

function readCapability(name: string): Capability {
  return JSON.parse(readFileSync(
    new URL(`../../../src-tauri/capabilities/${name}.json`, import.meta.url),
    'utf8',
  )) as Capability;
}

test('clipboard reads are limited to the main setup-wizard window', () => {
  const main = readCapability('default');
  const auxiliary = readCapability('trusted-auxiliary');

  assert.deepEqual(main.windows, ['main']);
  assert.ok(main.permissions.includes('clipboard-manager:allow-read-text'));
  assert.deepEqual(auxiliary.windows.sort(), ['live-channels', 'settings']);
  assert.equal(
    auxiliary.permissions.some((permission) => permission.startsWith('clipboard-manager:')),
    false,
  );
});
