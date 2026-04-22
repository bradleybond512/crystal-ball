import assert from 'node:assert/strict';
import test from 'node:test';

// Stub DOM before importing the module so addEventListener at top level doesn't throw.
(globalThis as unknown as { document: { addEventListener: () => void } }).document = {
  addEventListener: () => { /* noop */ },
};

import { extractEntitiesFromText } from '../hypothesis-entities.ts';

test('extractEntitiesFromText: country ISO3 allowlist', () => {
  const out = extractEntitiesFromText('Situation: IRN and USA escalating diplomatic dispute');
  const kinds = out.filter(m => m.kind === 'country').map(m => m.entity).sort();
  assert.deepEqual(kinds, ['IRN', 'USA']);
});

test('extractEntitiesFromText: rejects common 3-letter stopwords', () => {
  const out = extractEntitiesFromText('THE NEW report from USA on a ship');
  const countries = out.filter(m => m.kind === 'country').map(m => m.entity);
  assert.deepEqual(countries, ['USA']); // THE / NEW dropped, USA kept
});

test('extractEntitiesFromText: CVE ids case-normalized', () => {
  const out = extractEntitiesFromText('vulnerability cve-2024-12345 exploited in the wild');
  const cves = out.filter(m => m.kind === 'cve').map(m => m.entity);
  assert.deepEqual(cves, ['CVE-2024-12345']);
});

test('extractEntitiesFromText: ticker allowlist', () => {
  const out = extractEntitiesFromText('AAPL down 3% on SPY move; NVDA surging');
  const tickers = out.filter(m => m.kind === 'ticker').map(m => m.entity).sort();
  assert.deepEqual(tickers, ['AAPL', 'NVDA', 'SPY']);
});

test('extractEntitiesFromText: callsigns require digits', () => {
  const out = extractEntitiesFromText('Callsigns RCH4321 and BOMR017 operating today');
  const callsigns = out.filter(m => m.kind === 'callsign').map(m => m.entity).sort();
  assert.deepEqual(callsigns, ['BOMR017', 'RCH4321']);
});

test('extractEntitiesFromText: deduplicates multiple mentions', () => {
  const out = extractEntitiesFromText('IRN activity; later IRN again; AAPL and AAPL');
  const countries = out.filter(m => m.kind === 'country').map(m => m.entity);
  const tickers = out.filter(m => m.kind === 'ticker').map(m => m.entity);
  assert.deepEqual(countries, ['IRN']);
  assert.deepEqual(tickers, ['AAPL']);
});
