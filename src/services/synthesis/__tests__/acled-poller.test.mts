import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __INTERNAL,
  buildAcledReadUrl,
  filterAcledRecords,
  parseAcledResponse,
  pipelineAcledToCorpus,
  transformAcledToHistorical,
  type AcledRecord,
} from '../acled-poller.ts';

const MIN_RECORD: AcledRecord = {
  event_id_cnty: 'IRQ12345',
  event_date: '2026-04-30',
  event_type: 'Violence against civilians',
  sub_event_type: 'Attack',
  actor1: 'Unknown Armed Group',
  actor2: 'Civilians (Iraq)',
  country: 'Iraq',
  location: 'Mosul',
  admin1: 'Nineveh',
  latitude: '36.34',
  longitude: '43.13',
  fatalities: '5',
};

// ── parseAcledResponse ─────────────────────────────────────────────────

test('parseAcledResponse: returns [] for non-object', () => {
  assert.deepEqual(parseAcledResponse(null), []);
  assert.deepEqual(parseAcledResponse('string'), []);
  assert.deepEqual(parseAcledResponse(42), []);
});

test('parseAcledResponse: returns [] when data is missing', () => {
  assert.deepEqual(parseAcledResponse({}), []);
});

test('parseAcledResponse: extracts records from data array', () => {
  const out = parseAcledResponse({ data: [MIN_RECORD, MIN_RECORD] });
  assert.equal(out.length, 2);
});

test('parseAcledResponse: skips non-object items in data array', () => {
  const out = parseAcledResponse({ data: [MIN_RECORD, 'string', null, 42] });
  assert.equal(out.length, 1);
});

// ── filterAcledRecords ─────────────────────────────────────────────────

test('filterAcledRecords: drops records without event_id_cnty', () => {
  const records: AcledRecord[] = [MIN_RECORD, { event_date: '2026-04-30' }, { event_id_cnty: '' }];
  assert.equal(filterAcledRecords(records).length, 1);
});

test('filterAcledRecords: sinceDate drops older records', () => {
  const records: AcledRecord[] = [
    { ...MIN_RECORD, event_id_cnty: 'OLD', event_date: '2025-01-01' },
    { ...MIN_RECORD, event_id_cnty: 'NEW', event_date: '2026-04-30' },
  ];
  const filtered = filterAcledRecords(records, { sinceDate: '2026-01-01' });
  assert.deepEqual(filtered.map((r) => r.event_id_cnty), ['NEW']);
});

test('filterAcledRecords: limit caps result', () => {
  const records = Array.from({ length: 100 }, (_, i) => ({ ...MIN_RECORD, event_id_cnty: `ID-${i}` }));
  assert.equal(filterAcledRecords(records, { limit: 10 }).length, 10);
});

// ── transformAcledToHistorical ─────────────────────────────────────────

test('transform: returns null when event_id_cnty missing', () => {
  assert.equal(transformAcledToHistorical({}), null);
});

test('transform: maps standard record correctly', () => {
  const ev = transformAcledToHistorical(MIN_RECORD)!;
  assert.equal(ev.id, 'acled-IRQ12345');
  assert.equal(ev.date, '2026-04-30');
  assert.equal(ev.country, 'Iraq');
  assert.equal(ev.location, 'Mosul, Nineveh, Iraq');
  assert.deepEqual(ev.actors, ['Unknown Armed Group', 'Civilians (Iraq)']);
  assert.equal(ev.eventType, 'Attack'); // sub_event_type wins
  assert.equal(ev.intensity, 'medium'); // 5 fatalities
  assert.equal(ev.source, 'acled');
});

test('transform: 0 fatalities → low intensity', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, fatalities: 0 })!;
  assert.equal(ev.intensity, 'low');
});

test('transform: 50+ fatalities → critical', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, fatalities: 60 })!;
  assert.equal(ev.intensity, 'critical');
});

test('transform: 10-49 fatalities → high', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, fatalities: 25 })!;
  assert.equal(ev.intensity, 'high');
});

test('transform: deduplicates identical actor1 + actor2', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, actor1: 'X', actor2: 'X' })!;
  assert.deepEqual(ev.actors, ['X']);
});

test('transform: handles string fatalities', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, fatalities: '15' })!;
  assert.equal(ev.intensity, 'high');
});

test('transform: invalid date defaults to today', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, event_date: 'bogus' })!;
  // Today's date is YYYY-MM-DD with 10 chars
  assert.equal(ev.date.length, 10);
});

test('transform: missing country falls back to Unknown', () => {
  const ev = transformAcledToHistorical({
    event_id_cnty: 'X',
    event_date: '2026-04-30',
  })!;
  assert.equal(ev.country, 'Unknown');
});

test('transform: summary includes fatality count when > 0', () => {
  const ev = transformAcledToHistorical(MIN_RECORD)!;
  assert.match(ev.summary, /5 fatalities/);
});

test('transform: summary omits fatalities when 0', () => {
  const ev = transformAcledToHistorical({ ...MIN_RECORD, fatalities: 0 })!;
  assert.doesNotMatch(ev.summary, /fatalities/);
});

// ── pipelineAcledToCorpus ──────────────────────────────────────────────

test('pipeline: end-to-end happy path', () => {
  const corpus = pipelineAcledToCorpus({ data: [MIN_RECORD] });
  assert.equal(corpus.length, 1);
  assert.equal(corpus[0]!.id, 'acled-IRQ12345');
});

test('pipeline: empty input → empty output', () => {
  assert.deepEqual(pipelineAcledToCorpus(null), []);
});

// ── buildAcledReadUrl ──────────────────────────────────────────────────

test('buildAcledReadUrl: includes key, email, default limit', () => {
  const url = buildAcledReadUrl({ accessToken: 'TOK', email: 'a@b.com' });
  assert.match(url, /key=TOK/);
  assert.match(url, /email=a%40b\.com/);
  assert.match(url, /limit=500/);
});

test('buildAcledReadUrl: sinceDate adds event_date_where=%3E%3D', () => {
  const url = buildAcledReadUrl({ accessToken: 'T', email: 'e', sinceDate: '2026-04-01' });
  assert.match(url, /event_date=2026-04-01/);
  assert.match(url, /event_date_where=%3E%3D/);
});

test('buildAcledReadUrl: includes the fields list', () => {
  const url = buildAcledReadUrl({ accessToken: 'T', email: 'e' });
  // pipe-separated fields are URL-encoded as %7C
  assert.match(url, /fields=.*event_id_cnty.*fatalities/);
});

// ── Internal helpers ───────────────────────────────────────────────────

test('intensityForFatalities boundary at exactly 50', () => {
  assert.equal(__INTERNAL.intensityForFatalities(49), 'high');
  assert.equal(__INTERNAL.intensityForFatalities(50), 'critical');
});
