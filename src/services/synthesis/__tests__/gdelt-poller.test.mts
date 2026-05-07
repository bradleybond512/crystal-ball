import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterMaterialConflict,
  parseGdeltEventsCsv,
  parseGdeltEventsCsvLine,
  parseLastUpdateTxt,
  pipelineCsvToCorpus,
  transformToHistoricalEvent,
  type GdeltEventRow,
} from '../gdelt-poller.ts';

// ── Fixture helpers ────────────────────────────────────────────────────

/**
 * Build a tab-separated GDELT 2.0 events row. Only sets the fields we
 * actually parse; everything else is empty strings to keep the column
 * count at 61.
 */
function gdeltRow(overrides: Partial<GdeltEventRow> & { globalEventId: string; quadClass: 1 | 2 | 3 | 4 }): string {
  const cols = new Array<string>(61).fill('');
  cols[0] = overrides.globalEventId;
  cols[1] = overrides.sqlDate ?? '20260505';
  cols[6] = overrides.actor1Name ?? '';
  cols[7] = overrides.actor1CountryCode ?? '';
  cols[16] = overrides.actor2Name ?? '';
  cols[26] = String(overrides.quadClass);
  cols[30] = overrides.goldsteinScale === undefined ? '0' : String(overrides.goldsteinScale);
  cols[31] = overrides.numMentions === undefined ? '0' : String(overrides.numMentions);
  cols[34] = overrides.avgTone === undefined ? '0' : String(overrides.avgTone);
  cols[53] = overrides.actionGeoFullName ?? '';
  cols[54] = overrides.actionGeoCountryCode ?? '';
  cols[56] = overrides.actionGeoLat === undefined || overrides.actionGeoLat === null ? '0' : String(overrides.actionGeoLat);
  cols[57] = overrides.actionGeoLon === undefined || overrides.actionGeoLon === null ? '0' : String(overrides.actionGeoLon);
  cols[60] = overrides.sourceUrl ?? '';
  return cols.join('\t');
}

// ── parseLastUpdateTxt ─────────────────────────────────────────────────

test('parseLastUpdateTxt extracts events / mentions / gkg URLs', () => {
  const text = [
    '12345 abcdef0123456789abcdef0123456789 http://data.gdeltproject.org/gdeltv2/20260505000000.export.CSV.zip',
    '67890 fedcba9876543210fedcba9876543210 http://data.gdeltproject.org/gdeltv2/20260505000000.mentions.CSV.zip',
    '11111 0000000000000000000000000000aaaa http://data.gdeltproject.org/gdeltv2/20260505000000.gkg.csv.zip',
  ].join('\n');
  const out = parseLastUpdateTxt(text);
  assert.equal(out.events?.url, 'http://data.gdeltproject.org/gdeltv2/20260505000000.export.CSV.zip');
  assert.equal(out.events?.size, 12345);
  assert.equal(out.mentions?.size, 67890);
  assert.equal(out.gkg?.size, 11111);
});

test('parseLastUpdateTxt: empty input → all nulls', () => {
  const out = parseLastUpdateTxt('');
  assert.equal(out.events, null);
  assert.equal(out.mentions, null);
  assert.equal(out.gkg, null);
});

test('parseLastUpdateTxt: malformed line is skipped, valid lines kept', () => {
  const text = [
    'garbage line that should be skipped',
    '99999 cccccccccccccccccccccccccccccccc http://data.gdeltproject.org/gdeltv2/foo.export.CSV.zip',
  ].join('\n');
  const out = parseLastUpdateTxt(text);
  assert.equal(out.events?.size, 99999);
});

// ── parseGdeltEventsCsvLine ────────────────────────────────────────────

test('parseGdeltEventsCsvLine: minimal valid row', () => {
  const line = gdeltRow({
    globalEventId: 'EID1',
    quadClass: 4,
    numMentions: 100,
    actor1Name: 'GOV',
    actor2Name: 'REB',
    actionGeoFullName: 'Mosul, Iraq',
    actionGeoCountryCode: 'IZ',
  });
  const row = parseGdeltEventsCsvLine(line);
  assert.ok(row);
  assert.equal(row.globalEventId, 'EID1');
  assert.equal(row.quadClass, 4);
  assert.equal(row.numMentions, 100);
  assert.equal(row.actor1Name, 'GOV');
});

test('parseGdeltEventsCsvLine: returns null for empty line', () => {
  assert.equal(parseGdeltEventsCsvLine(''), null);
});

test('parseGdeltEventsCsvLine: returns null on truncated row (<60 cols)', () => {
  const line = ['a', 'b', 'c'].join('\t');
  assert.equal(parseGdeltEventsCsvLine(line), null);
});

test('parseGdeltEventsCsvLine: returns null when QuadClass is not 1-4', () => {
  const cols = new Array<string>(61).fill('');
  cols[0] = 'X';
  cols[26] = '7'; // invalid QuadClass
  cols[31] = '100';
  assert.equal(parseGdeltEventsCsvLine(cols.join('\t')), null);
});

test('parseGdeltEventsCsvLine: returns null when globalEventId is empty', () => {
  const line = gdeltRow({ globalEventId: '', quadClass: 3, numMentions: 100 });
  assert.equal(parseGdeltEventsCsvLine(line), null);
});

// ── parseGdeltEventsCsv ────────────────────────────────────────────────

test('parseGdeltEventsCsv: handles multiple rows + skips junk', () => {
  const csv = [
    gdeltRow({ globalEventId: 'A', quadClass: 4, numMentions: 100 }),
    'malformed line',
    gdeltRow({ globalEventId: 'B', quadClass: 3, numMentions: 50 }),
    '',
  ].join('\n');
  const rows = parseGdeltEventsCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.globalEventId, 'A');
  assert.equal(rows[1]!.globalEventId, 'B');
});

// ── filterMaterialConflict ─────────────────────────────────────────────

test('filterMaterialConflict: keeps QuadClass 3+4 with mentions ≥ 60', () => {
  const rows = parseGdeltEventsCsv([
    gdeltRow({ globalEventId: 'A', quadClass: 4, numMentions: 100 }), // keep
    gdeltRow({ globalEventId: 'B', quadClass: 3, numMentions: 80 }),  // keep
    gdeltRow({ globalEventId: 'C', quadClass: 4, numMentions: 30 }),  // drop (mentions)
    gdeltRow({ globalEventId: 'D', quadClass: 1, numMentions: 100 }), // drop (verbal coop)
    gdeltRow({ globalEventId: 'E', quadClass: 2, numMentions: 100 }), // drop (material coop)
  ].join('\n'));
  const filtered = filterMaterialConflict(rows);
  assert.deepEqual(filtered.map((r) => r.globalEventId).sort(), ['A', 'B']);
});

test('filterMaterialConflict: minMentions option overrides default', () => {
  const rows = parseGdeltEventsCsv(
    gdeltRow({ globalEventId: 'A', quadClass: 4, numMentions: 30 }),
  );
  assert.equal(filterMaterialConflict(rows, { minMentions: 20 }).length, 1);
  assert.equal(filterMaterialConflict(rows, { minMentions: 50 }).length, 0);
});

test('filterMaterialConflict: conflictOnly:false keeps coop classes too', () => {
  const rows = parseGdeltEventsCsv([
    gdeltRow({ globalEventId: 'A', quadClass: 1, numMentions: 100 }),
    gdeltRow({ globalEventId: 'B', quadClass: 4, numMentions: 100 }),
  ].join('\n'));
  const out = filterMaterialConflict(rows, { conflictOnly: false });
  assert.equal(out.length, 2);
});

// ── transformToHistoricalEvent ─────────────────────────────────────────

test('transform: maps QuadClass 4 → material-conflict eventType', () => {
  const row = parseGdeltEventsCsvLine(gdeltRow({
    globalEventId: 'EID',
    quadClass: 4,
    sqlDate: '20260505',
    actionGeoFullName: 'Aleppo, Syria',
    actionGeoCountryCode: 'SY',
    actor1Name: 'GOV',
    actor2Name: 'OPP',
    numMentions: 250,
    goldsteinScale: -8,
  }))!;
  const ev = transformToHistoricalEvent(row);
  assert.equal(ev.id, 'gdelt-EID');
  assert.equal(ev.date, '2026-05-05');
  assert.equal(ev.eventType, 'material-conflict');
  assert.equal(ev.country, 'SY');
  assert.equal(ev.location, 'Aleppo, Syria');
  assert.deepEqual(ev.actors, ['GOV', 'OPP']);
  assert.equal(ev.source, 'gdelt');
});

test('transform: M4 + Goldstein ≤ -7 + mentions ≥ 200 → critical intensity', () => {
  const row = parseGdeltEventsCsvLine(gdeltRow({
    globalEventId: 'EID',
    quadClass: 4,
    numMentions: 300,
    goldsteinScale: -8,
  }))!;
  assert.equal(transformToHistoricalEvent(row).intensity, 'critical');
});

test('transform: deduplicates identical actor1 + actor2', () => {
  const row = parseGdeltEventsCsvLine(gdeltRow({
    globalEventId: 'EID',
    quadClass: 3,
    numMentions: 100,
    actor1Name: 'SAME',
    actor2Name: 'SAME',
  }))!;
  assert.deepEqual(transformToHistoricalEvent(row).actors, ['SAME']);
});

test('transform: empty location falls back to Unknown', () => {
  const row = parseGdeltEventsCsvLine(gdeltRow({
    globalEventId: 'EID', quadClass: 3, numMentions: 100,
  }))!;
  const ev = transformToHistoricalEvent(row);
  assert.equal(ev.location, 'Unknown');
  assert.equal(ev.country, 'XX');
});

test('transform: low mentions → low intensity', () => {
  const row = parseGdeltEventsCsvLine(gdeltRow({
    globalEventId: 'EID', quadClass: 3, numMentions: 65,
  }))!;
  assert.equal(transformToHistoricalEvent(row).intensity, 'low');
});

// ── pipelineCsvToCorpus ────────────────────────────────────────────────

test('pipelineCsvToCorpus: end-to-end happy path', () => {
  const csv = [
    gdeltRow({ globalEventId: 'A', quadClass: 4, numMentions: 100 }), // keep
    gdeltRow({ globalEventId: 'B', quadClass: 1, numMentions: 100 }), // drop (coop)
    gdeltRow({ globalEventId: 'C', quadClass: 3, numMentions: 30 }),  // drop (mentions)
  ].join('\n');
  const corpus = pipelineCsvToCorpus(csv);
  assert.equal(corpus.length, 1);
  assert.equal(corpus[0]!.id, 'gdelt-A');
  assert.equal(corpus[0]!.source, 'gdelt');
});

test('pipelineCsvToCorpus: empty input → empty output', () => {
  assert.deepEqual(pipelineCsvToCorpus(''), []);
});
