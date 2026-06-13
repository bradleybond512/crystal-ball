import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBdiCloseFromCsv } from '../bdi-feed.ts';

const HEADER = 'Date,Open,High,Low,Close,Volume';

test('valid CSV last row → correct BDI float extracted', () => {
  const csv = [
    HEADER,
    '2026-06-09,1452,1470,1448,1465,0',
    '2026-06-10,1465,1488,1460,1483.5,0',
  ].join('\n');
  const reading = parseBdiCloseFromCsv(csv);
  assert.equal(reading.bdi, 1483.5);
  assert.equal(reading.date, '2026-06-10');
});

test('trailing blank line is ignored — last data row still wins', () => {
  const csv = `${HEADER}\n2026-06-10,1465,1488,1460,1483,0\n\n`;
  assert.equal(parseBdiCloseFromCsv(csv).bdi, 1483);
});

test('malformed last row (too few columns) → throws', () => {
  const csv = `${HEADER}\n2026-06-10,1465`;
  assert.throws(() => parseBdiCloseFromCsv(csv), /malformed/);
});

test('non-numeric Close → throws', () => {
  const csv = `${HEADER}\n2026-06-10,1465,1488,1460,N/D,0`;
  assert.throws(() => parseBdiCloseFromCsv(csv), /finite/);
});

test('header-only CSV (no data rows) → throws', () => {
  assert.throws(() => parseBdiCloseFromCsv(HEADER), /no data rows/);
});
