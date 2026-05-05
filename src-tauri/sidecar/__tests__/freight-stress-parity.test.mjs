/**
 * Parity test: the sidecar's inline JS port of the freight-stress logic
 * (parseFredCsvSidecar + computeFreightStressSidecar) MUST produce the
 * same result as the canonical TS module in src/services/maritime/.
 *
 * If you change one, change the other and update this test.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  parseFredCsvSidecar,
  computeFreightStressSidecar,
} from '../local-api-server.mjs';

const SAMPLE_CSV = [
  'DATE,PPIACO',
  '2025-04-01,250',
  '2025-05-01,251',
  '2025-06-01,249',
  '2025-07-01,252',
  '2025-08-01,250',
  '2025-09-01,253',
  '2025-10-01,251',
  '2025-11-01,255',
  '2025-12-01,254',
  '2026-01-01,256',
  '2026-02-01,258',
  '2026-03-01,260',
  '2026-04-01,275',
].join('\n');

test('parseFredCsvSidecar: parses header + numeric rows', () => {
  const out = parseFredCsvSidecar(SAMPLE_CSV);
  assert.equal(out.length, 13);
  assert.equal(out[0].date, '2025-04-01');
  assert.equal(out[0].value, 250);
  assert.equal(out[12].value, 275);
});

test('parseFredCsvSidecar: skips FRED missing-value rows (".")', () => {
  const csv = `DATE,PPIACO\n2026-01-01,.\n2026-02-01,251`;
  const out = parseFredCsvSidecar(csv);
  assert.equal(out.length, 1);
});

test('parseFredCsvSidecar: tolerates CRLF line endings + empty body', () => {
  assert.deepEqual(parseFredCsvSidecar(''), []);
  const out = parseFredCsvSidecar(`DATE,X\r\n2026-01-01,1.0\r\n2026-02-01,2.0`);
  assert.equal(out.length, 2);
});

test('computeFreightStressSidecar: empty observations → empty result', () => {
  const r = computeFreightStressSidecar('PPIACO', []);
  assert.equal(r.current, null);
  assert.equal(r.observationCount, 0);
  assert.equal(r.stressScore, 0);
  assert.equal(r.stressLevel, 'low');
});

test('computeFreightStressSidecar: flat baseline → score 0', () => {
  const flat = [];
  const dates = [
    '2025-04-01','2025-05-01','2025-06-01','2025-07-01','2025-08-01','2025-09-01',
    '2025-10-01','2025-11-01','2025-12-01','2026-01-01','2026-02-01','2026-03-01',
    '2026-04-01',
  ];
  for (const date of dates) flat.push({ date, value: 250 });
  const r = computeFreightStressSidecar('PPIACO', flat);
  assert.equal(r.stressScore, 0);
  assert.equal(r.stressLevel, 'low');
});

test('computeFreightStressSidecar: 2σ+ above noisy baseline → critical', () => {
  const values = [248, 252, 246, 254, 250, 245, 255, 247, 253, 250, 244, 256];
  const dates = [
    '2025-04-01','2025-05-01','2025-06-01','2025-07-01','2025-08-01','2025-09-01',
    '2025-10-01','2025-11-01','2025-12-01','2026-01-01','2026-02-01','2026-03-01',
  ];
  const obs = dates.map((date, i) => ({ date, value: values[i] }));
  obs.push({ date: '2026-04-01', value: 270 });
  const r = computeFreightStressSidecar('PPIACO', obs);
  assert.ok(r.zScore >= 3, `zScore was ${r.zScore}`);
  assert.equal(r.stressLevel, 'critical');
});

test('computeFreightStressSidecar: rising trend detection', () => {
  const flat = [];
  const dates = [
    '2025-04-01','2025-05-01','2025-06-01','2025-07-01','2025-08-01','2025-09-01',
    '2025-10-01','2025-11-01','2025-12-01','2026-01-01','2026-02-01','2026-03-01',
  ];
  for (const date of dates) flat.push({ date, value: 250 });
  flat.push({ date: '2026-04-01', value: 260 });
  const r = computeFreightStressSidecar('PPIACO', flat);
  assert.equal(r.trend, 'rising');
});

test('computeFreightStressSidecar: handles unsorted input', () => {
  const obs = [
    { date: '2026-04-01', value: 275 },
    { date: '2025-04-01', value: 250 },
    { date: '2025-05-01', value: 251 },
    { date: '2025-06-01', value: 249 },
    { date: '2025-07-01', value: 252 },
    { date: '2025-08-01', value: 250 },
    { date: '2025-09-01', value: 253 },
    { date: '2025-10-01', value: 251 },
    { date: '2025-11-01', value: 255 },
    { date: '2025-12-01', value: 254 },
    { date: '2026-01-01', value: 256 },
    { date: '2026-02-01', value: 258 },
    { date: '2026-03-01', value: 260 },
  ];
  const r = computeFreightStressSidecar('PPIACO', obs);
  assert.equal(r.asOf, '2026-04-01');
  assert.equal(r.current, 275);
});
