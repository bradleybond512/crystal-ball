import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjustmentsFor,
  applyAdjustment,
  buildSnapshot,
  currentPhaseRun,
  outlookFor,
  parseOniAscii,
  type EnsoObservation,
} from '../enso-monitor.ts';

// ── parseOniAscii ────────────────────────────────────────────────────

test('parseOniAscii: parses a standard NOAA fixture', () => {
  const text = `SEAS  YR  TOTAL  ANOM
DJF  1950  24.72  -1.54
JFM  1950  25.16  -1.34
FMA  1950  25.66  -1.16`;
  const obs = parseOniAscii(text);
  assert.equal(obs.length, 3);
  assert.equal(obs[0]!.season, 'DJF');
  assert.equal(obs[0]!.year, 1950);
  assert.equal(obs[0]!.oni, -1.54);
});

test('parseOniAscii: tolerates blank + comment lines', () => {
  const text = `# header note
SEAS YR TOTAL ANOM
DJF 2025 25.5 0.6

JFM 2025 25.8 0.8
`;
  const obs = parseOniAscii(text);
  assert.equal(obs.length, 2);
});

test('parseOniAscii: drops malformed rows', () => {
  const text = `DJF 2025 25.5 NaN
JFM 2025 25.5 0.6
GARBAGE LINE
FMA bad-year 25 0.7`;
  const obs = parseOniAscii(text);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.season, 'JFM');
});

test('parseOniAscii: empty input returns []', () => {
  assert.deepEqual(parseOniAscii(''), []);
});

// ── currentPhaseRun ──────────────────────────────────────────────────

function obs(values: number[]): EnsoObservation[] {
  return values.map((v, i) => ({ year: 2024, season: `S${i}`, oni: v }));
}

test('currentPhaseRun: el_nino run of 5', () => {
  const out = currentPhaseRun(obs([0, 0.3, 0.6, 0.7, 0.9, 1.0, 1.1]));
  assert.equal(out.phase, 'el_nino');
  assert.equal(out.runLength, 5);
});

test('currentPhaseRun: la_nina run of 3', () => {
  const out = currentPhaseRun(obs([0.2, -0.6, -0.7, -0.8]));
  assert.equal(out.phase, 'la_nina');
  assert.equal(out.runLength, 3);
});

test('currentPhaseRun: latest neutral → run length 0', () => {
  const out = currentPhaseRun(obs([0.6, 0.4]));
  assert.equal(out.phase, 'neutral');
  assert.equal(out.runLength, 0);
});

test('currentPhaseRun: empty input → neutral 0', () => {
  const out = currentPhaseRun([]);
  assert.equal(out.phase, 'neutral');
  assert.equal(out.runLength, 0);
});

// ── outlookFor ──────────────────────────────────────────────────────

test('outlookFor: warming El Niño → strengthening message', () => {
  const text = outlookFor(obs([0.5, 0.6, 0.8, 1.0]));
  assert.match(text, /El Niño/);
  assert.match(text, /strengthening/);
});

test('outlookFor: neutral with strong upward drift → "trending toward El Niño"', () => {
  const text = outlookFor(obs([-0.1, 0, 0.2, 0.4]));
  assert.match(text, /Trending toward El Niño/);
});

test('outlookFor: neutral flat → no strong signal', () => {
  const text = outlookFor(obs([0.05, 0.0, -0.05, 0.0]));
  assert.match(text, /Neutral conditions persisting/);
});

test('outlookFor: insufficient history → explicit message', () => {
  const text = outlookFor(obs([0.1]));
  assert.match(text, /Insufficient history/);
});

// ── buildSnapshot ───────────────────────────────────────────────────

test('buildSnapshot: produces a JSON-serializable record', () => {
  const snap = buildSnapshot(obs([-0.6, -0.7, -0.8, -0.9]));
  assert.ok(snap);
  assert.equal(snap!.phase, 'la_nina');
  const round = structuredClone(snap);
  assert.equal(round.phase, 'la_nina');
});

test('buildSnapshot: empty input → null', () => {
  assert.equal(buildSnapshot([]), null);
});

// ── adjustmentsFor ──────────────────────────────────────────────────

test('adjustmentsFor: el_nino includes wheat_australia at >1 multiplier', () => {
  const adjustments = adjustmentsFor('el_nino');
  const wheatAU = adjustments.find((a) => a.commodity === 'wheat_australia');
  assert.ok(wheatAU);
  assert.ok(wheatAU!.multiplier > 1);
});

test('adjustmentsFor: la_nina includes wheat_north_america + coffee_east_africa', () => {
  const adjustments = adjustmentsFor('la_nina');
  assert.ok(adjustments.find((a) => a.commodity === 'wheat_north_america'));
  assert.ok(adjustments.find((a) => a.commodity === 'coffee_east_africa'));
});

test('adjustmentsFor: neutral → empty', () => {
  assert.deepEqual(adjustmentsFor('neutral'), []);
});

// ── applyAdjustment ─────────────────────────────────────────────────

test('applyAdjustment: el_nino raises wheat_australia probability', () => {
  const adjusted = applyAdjustment(0.4, 'wheat_australia', 'el_nino');
  assert.ok(adjusted > 0.4);
});

test('applyAdjustment: clamps at 1', () => {
  assert.equal(applyAdjustment(0.9, 'wheat_australia', 'el_nino'), 1);
});

test('applyAdjustment: la_nina lowers corn_north_america probability slightly', () => {
  const adjusted = applyAdjustment(0.5, 'corn_north_america', 'la_nina');
  assert.ok(adjusted < 0.5);
});

test('applyAdjustment: neutral phase passes through', () => {
  assert.equal(applyAdjustment(0.42, 'wheat_australia', 'neutral'), 0.42);
});

test('applyAdjustment: commodity not in current phase passes through', () => {
  assert.equal(applyAdjustment(0.42, 'coffee_east_africa', 'el_nino'), 0.42);
});
