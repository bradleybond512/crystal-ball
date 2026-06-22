import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimativeTerm,
  bandFor,
  hedgePhrase,
  isPoorlyCalibrated,
  verifyHedge,
} from '../kent-hedging.ts';

// ── Scale mapping ────────────────────────────────────────────────────────────

test('estimativeTerm maps each band to its Kent term', () => {
  assert.equal(estimativeTerm(0.02), 'remote');
  assert.equal(estimativeTerm(0.1), 'very unlikely');
  assert.equal(estimativeTerm(0.3), 'unlikely');
  assert.equal(estimativeTerm(0.5), 'roughly even chance');
  assert.equal(estimativeTerm(0.7), 'likely');
  assert.equal(estimativeTerm(0.9), 'very likely');
  assert.equal(estimativeTerm(0.98), 'almost certain');
});

test('estimativeTerm: boundaries land in the upper band; clamps out-of-range', () => {
  assert.equal(estimativeTerm(0.55), 'likely'); // lower-inclusive
  assert.equal(estimativeTerm(1), 'almost certain');
  assert.equal(estimativeTerm(0), 'remote');
  assert.equal(estimativeTerm(2), 'almost certain'); // clamped
  assert.equal(estimativeTerm(Number.NaN), 'remote'); // clamped to 0
});

test('bandFor round-trips: a band midpoint maps back to the term', () => {
  const { lo, hi } = bandFor('likely');
  const mid = (lo + hi) / 2;
  assert.equal(estimativeTerm(mid), 'likely');
});

// ── Hedged phrasing ──────────────────────────────────────────────────────────

test('hedgePhrase: single-layer by default', () => {
  assert.equal(hedgePhrase(0.7), 'likely');
});

test('hedgePhrase: double-hedges when poorly calibrated', () => {
  const phrase = hedgePhrase(0.7, { poorlyCalibrated: true });
  assert.match(phrase, /^likely, though .*unreliable recently$/);
});

test('hedgePhrase: capitalize option', () => {
  assert.equal(hedgePhrase(0.9, { capitalize: true }), 'Very likely');
});

test('isPoorlyCalibrated: over/under-confident trigger the meta-hedge; others do not', () => {
  assert.equal(isPoorlyCalibrated('overconfident'), true);
  assert.equal(isPoorlyCalibrated('underconfident'), true);
  assert.equal(isPoorlyCalibrated('well_calibrated'), false);
  assert.equal(isPoorlyCalibrated('insufficient_data'), false);
});

// ── Verification gate ────────────────────────────────────────────────────────

test('verifyHedge: matching term passes', () => {
  const v = verifyHedge('Entity X is likely to reach the port.', 0.7);
  assert.equal(v.ok, true);
  assert.equal(v.found, 'likely');
  assert.equal(v.bandDistance, 0);
});

test('verifyHedge: overstated hedge fails (almost certain on a 70% call)', () => {
  const v = verifyHedge('Entity X is almost certain to reach the port.', 0.7);
  assert.equal(v.ok, false);
  assert.equal(v.expected, 'likely');
  assert.equal(v.found, 'almost certain');
  assert.ok((v.bandDistance ?? 0) >= 1);
  assert.match(v.reason, /overstates|understates/);
});

test('verifyHedge: longest-match wins ("very likely" not "likely")', () => {
  const v = verifyHedge('This is very likely to happen.', 0.9);
  assert.equal(v.found, 'very likely');
  assert.equal(v.ok, true);
});

test('verifyHedge: no estimative term found → fails with expected term', () => {
  const v = verifyHedge('Entity X is heading to Y, ETA 20 minutes.', 0.7);
  assert.equal(v.ok, false);
  assert.equal(v.expected, 'likely');
  assert.equal(v.found, undefined);
});

test('verifyHedge: adjacent-band slack tolerated when allowed', () => {
  // p=0.9 warrants "very likely"; "likely" is one band off.
  const strict = verifyHedge('It is likely.', 0.9, 0);
  const lenient = verifyHedge('It is likely.', 0.9, 1);
  assert.equal(strict.ok, false);
  assert.equal(lenient.ok, true);
});
