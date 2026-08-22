import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/SavedPlaceModal.ts', import.meta.url), 'utf8');

test('saved-place modal exposes an explicit accessible Lifelines offline control', () => {
  assert.match(source, /data-action="toggle-offline"/);
  assert.match(source, /aria-pressed="\$\{this\.formState\.offlinePinned \? 'true' : 'false'\}"/);
  assert.match(source, /Keep Disaster Lifelines offline/);
});

test('saved-place modal persists the offline pin and strictly parses coordinates', () => {
  const inputBlock = source.match(/const input = \{([\s\S]*?)\n \};/);
  assert.ok(inputBlock, 'save input object should exist');
  assert.match(inputBlock[1], /offlinePinned:\s*this\.formState\.offlinePinned/);
  assert.match(source, /const lat = Number\(this\.formState\.lat\)/);
  assert.match(source, /const lon = Number\(this\.formState\.lon\)/);
  assert.doesNotMatch(source, /Number\.parseFloat\(this\.formState\.(?:lat|lon)\)/);
});
