import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');

test('UCDP loaders report dataset currency instead of transport time as current freshness', () => {
  assert.match(source, /recordUcdpDatasetState\('ucdp', dataset, classifications\.size\)/);
  assert.match(source, /recordUcdpDatasetState\('ucdp_events', result\.dataset, events\.length\)/);
  assert.doesNotMatch(source, /dataFreshness\.recordUpdate\('ucdp', classifications\.size\)/);
  assert.doesNotMatch(source, /dataFreshness\.recordUpdate\('ucdp_events', events\.length\)/);
});
