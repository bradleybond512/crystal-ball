import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAriSnapshot,
  colorForLevel,
  parseAriRow,
  severityForLevel,
  type AriRowRaw,
} from '../cdc-ari.ts';

test('severityForLevel: numeric map', () => {
  assert.equal(severityForLevel('Minimal'), 0);
  assert.equal(severityForLevel('Very Low'), 0);
  assert.equal(severityForLevel('Low'), 1);
  assert.equal(severityForLevel('Moderate'), 2);
  assert.equal(severityForLevel('High'), 4);
  assert.equal(severityForLevel('Very High'), 5);
  assert.equal(severityForLevel('Data Unavailable'), null);
});

test('parseAriRow: happy path', () => {
  const row: AriRowRaw = {
    week_end: '2026-04-25T00:00:00.000',
    geography: 'Alabama',
    label: 'Low',
    buildnumber: 'irrelevant',
  };
  const out = parseAriRow(row);
  assert.deepEqual(out, {
    state: 'Alabama',
    weekEnd: '2026-04-25',
    level: 'Low',
    severity: 1,
  });
});

test('parseAriRow: rejects missing fields', () => {
  assert.equal(parseAriRow({ week_end: '2026-04-25', label: 'Low' }), null);
  assert.equal(parseAriRow({ geography: 'Alabama', label: 'Low' }), null);
  assert.equal(parseAriRow({ week_end: '2026-04-25', geography: 'Alabama' }), null);
});

test('parseAriRow: rejects unknown labels', () => {
  assert.equal(parseAriRow({ week_end: '2026-04-25', geography: 'Alabama', label: 'Unknown' }), null);
});

test('buildAriSnapshot: keeps latest week per state', () => {
  const rows: AriRowRaw[] = [
    { week_end: '2026-04-18T00:00:00.000', geography: 'Alabama', label: 'Moderate' },
    { week_end: '2026-04-25T00:00:00.000', geography: 'Alabama', label: 'Low' },
    { week_end: '2026-04-25T00:00:00.000', geography: 'Alaska', label: 'Very Low' },
  ];
  const snap = buildAriSnapshot(rows);
  assert.equal(snap.rows.length, 2);
  const al = snap.rows.find((r) => r.state === 'Alabama');
  assert.equal(al?.level, 'Low');
});

test('buildAriSnapshot: sorted by severity desc', () => {
  const rows: AriRowRaw[] = [
    { week_end: '2026-04-25', geography: 'A', label: 'Low' },
    { week_end: '2026-04-25', geography: 'B', label: 'Very High' },
    { week_end: '2026-04-25', geography: 'C', label: 'Moderate' },
    { week_end: '2026-04-25', geography: 'D', label: 'Data Unavailable' },
  ];
  const snap = buildAriSnapshot(rows);
  assert.deepEqual(snap.rows.map((r) => r.state), ['B', 'C', 'A', 'D']);
});

test('buildAriSnapshot: byLevel counts + hotStates + weekEnd', () => {
  const rows: AriRowRaw[] = [
    { week_end: '2026-04-25', geography: 'A', label: 'Low' },
    { week_end: '2026-04-25', geography: 'B', label: 'High' },
    { week_end: '2026-04-25', geography: 'C', label: 'Very High' },
    { week_end: '2026-04-25', geography: 'D', label: 'Data Unavailable' },
    { week_end: '2026-04-25', geography: 'E', label: 'Moderate' },
  ];
  const snap = buildAriSnapshot(rows);
  assert.equal(snap.byLevel.High, 1);
  assert.equal(snap.byLevel['Very High'], 1);
  assert.equal(snap.byLevel.Low, 1);
  assert.equal(snap.byLevel.Moderate, 1);
  assert.equal(snap.byLevel['Data Unavailable'], 1);
  assert.equal(snap.hotStates, 2);
  assert.equal(snap.reportingStates, 4);
  assert.equal(snap.weekEnd, '2026-04-25');
});

test('buildAriSnapshot: empty input', () => {
  const snap = buildAriSnapshot([]);
  assert.equal(snap.rows.length, 0);
  assert.equal(snap.weekEnd, null);
  assert.equal(snap.hotStates, 0);
  assert.equal(snap.reportingStates, 0);
});

test('buildAriSnapshot: tolerates malformed rows mixed in', () => {
  const rows: AriRowRaw[] = [
    { week_end: '2026-04-25', geography: 'A', label: 'Low' },
    { label: 'Low' }, // missing geo and week
    { week_end: '2026-04-25', geography: 'B', label: 'Bogus' as unknown as 'Low' },
    { week_end: '2026-04-25', geography: 'C', label: 'High' },
  ];
  const snap = buildAriSnapshot(rows);
  assert.equal(snap.rows.length, 2);
  assert.deepEqual(snap.rows.map((r) => r.state), ['C', 'A']);
});

test('colorForLevel: every level returns a #hex', () => {
  for (const lvl of ['Minimal', 'Very Low', 'Low', 'Moderate', 'High', 'Very High', 'Data Unavailable'] as const) {
    assert.match(colorForLevel(lvl), /^#[0-9a-f]{6}$/i);
  }
});
