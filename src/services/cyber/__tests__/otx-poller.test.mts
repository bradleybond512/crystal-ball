import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOtxSubscribedUrl,
  emptyOtxPollerState,
  ingestOtxPulses,
  parseOtxResponse,
  OTX_PULSES_DEFAULT_CAP,
} from '../otx-poller.ts';
import type { OtxPulse } from '../apt-tracker.ts';

function pulse(id: string, modified = '2026-05-05T00:00:00Z', extras: Partial<OtxPulse> = {}): OtxPulse {
  return { id, modified, ...extras };
}

// ── parseOtxResponse ───────────────────────────────────────────────────

test('parseOtxResponse: handles {results:[…]} envelope', () => {
  const out = parseOtxResponse({ results: [pulse('a'), pulse('b')] });
  assert.equal(out.length, 2);
});

test('parseOtxResponse: handles raw array', () => {
  const out = parseOtxResponse([pulse('a'), pulse('b')]);
  assert.equal(out.length, 2);
});

test('parseOtxResponse: drops items missing id', () => {
  const out = parseOtxResponse({ results: [pulse('a'), { name: 'no-id' }, { id: '' }] });
  assert.equal(out.length, 1);
});

test('parseOtxResponse: returns [] for non-object', () => {
  assert.deepEqual(parseOtxResponse(null), []);
  assert.deepEqual(parseOtxResponse('string'), []);
  assert.deepEqual(parseOtxResponse(42), []);
});

// ── ingestOtxPulses ────────────────────────────────────────────────────

test('ingest: empty prior + fresh batch → fresh dominates', () => {
  const prior = emptyOtxPollerState();
  const next = ingestOtxPulses(prior, [pulse('a'), pulse('b')]);
  assert.equal(next.pulses.length, 2);
});

test('ingest: dedupes by id, fresh overwrites prior', () => {
  const prior = ingestOtxPulses(emptyOtxPollerState(), [pulse('a', '2026-05-01T00:00:00Z', { name: 'old' })]);
  const next = ingestOtxPulses(prior, [pulse('a', '2026-05-05T00:00:00Z', { name: 'new' })]);
  assert.equal(next.pulses.length, 1);
  assert.equal(next.pulses[0]!.name, 'new');
});

test('ingest: sorts newest-first by modified', () => {
  const prior = emptyOtxPollerState();
  const next = ingestOtxPulses(prior, [
    pulse('old', '2026-04-01T00:00:00Z'),
    pulse('mid', '2026-04-15T00:00:00Z'),
    pulse('new', '2026-05-01T00:00:00Z'),
  ]);
  assert.deepEqual(next.pulses.map((p) => p.id), ['new', 'mid', 'old']);
});

test('ingest: caps at OTX_PULSES_DEFAULT_CAP (200)', () => {
  const fresh = Array.from({ length: 250 }, (_, i) => pulse(`id-${i}`, `2026-05-${(i % 28) + 1}`.padEnd(20, '0').slice(0, 20)));
  const next = ingestOtxPulses(emptyOtxPollerState(), fresh);
  assert.equal(next.pulses.length, OTX_PULSES_DEFAULT_CAP);
});

test('ingest: explicit cap overrides default', () => {
  const fresh = Array.from({ length: 50 }, (_, i) => pulse(`id-${i}`));
  const next = ingestOtxPulses(emptyOtxPollerState(), fresh, { cap: 10 });
  assert.equal(next.pulses.length, 10);
});

test('ingest: cursor reflects max modified across the cap', () => {
  const next = ingestOtxPulses(emptyOtxPollerState(), [
    pulse('a', '2026-04-01T00:00:00Z'),
    pulse('b', '2026-05-01T00:00:00Z'),
    pulse('c', '2026-04-15T00:00:00Z'),
  ]);
  assert.equal(next.cursor, '2026-05-01T00:00:00Z');
});

test('ingest: empty fresh batch keeps prior unchanged', () => {
  const prior = ingestOtxPulses(emptyOtxPollerState(), [pulse('a')]);
  const next = ingestOtxPulses(prior, []);
  assert.equal(next.pulses.length, 1);
  assert.equal(next.cursor, prior.cursor);
});

test('ingest: pulse with no modified falls to bottom', () => {
  const next = ingestOtxPulses(emptyOtxPollerState(), [
    { id: 'no-time' } as OtxPulse,
    pulse('with-time', '2026-05-05T00:00:00Z'),
  ]);
  assert.equal(next.pulses[0]!.id, 'with-time');
});

// ── buildOtxSubscribedUrl ──────────────────────────────────────────────

test('buildOtxSubscribedUrl: default limit 50', () => {
  const url = buildOtxSubscribedUrl();
  assert.match(url, /limit=50/);
  assert.doesNotMatch(url, /modified_since/);
});

test('buildOtxSubscribedUrl: includes modified_since cursor', () => {
  const url = buildOtxSubscribedUrl({ modifiedSince: '2026-05-01T00:00:00Z' });
  assert.match(url, /modified_since=2026-05-01T00%3A00%3A00Z/);
});

test('buildOtxSubscribedUrl: custom limit', () => {
  const url = buildOtxSubscribedUrl({ limit: 100 });
  assert.match(url, /limit=100/);
});

test('buildOtxSubscribedUrl: null modifiedSince is omitted', () => {
  const url = buildOtxSubscribedUrl({ modifiedSince: null });
  assert.doesNotMatch(url, /modified_since/);
});
