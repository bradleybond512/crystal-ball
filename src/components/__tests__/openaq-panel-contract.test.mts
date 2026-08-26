import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../OpenaqMonitorPanel.ts', import.meta.url), 'utf8');

test('OpenAQ panel labels the bounded feed as Recent Highs and never global worst', () => {
  assert.match(source, /worst: 'Recent Highs'/);
  assert.match(source, /Best-effort sample from the last 2 hours; not complete global coverage\./);
  assert.doesNotMatch(source, /worst: 'Global Worst'/);
});

test('OpenAQ panel distinguishes per-tab failures from valid empty samples', () => {
  assert.match(source, /nearbyError/);
  assert.match(source, /worstError/);
  assert.match(source, /No nearby readings are present in this best-effort sample\./);
  assert.match(source, /OpenAQ unavailable \(HTTP/);
});

test('OpenAQ search promises only fields present in the normalized sample', () => {
  assert.match(source, /Search loaded station or location ID/);
  assert.doesNotMatch(source, /Search by station \/ city \/ country/);
});
