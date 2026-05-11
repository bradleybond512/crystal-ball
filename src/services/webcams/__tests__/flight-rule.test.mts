import assert from 'node:assert/strict';
import test from 'node:test';

import { ceilingFromClouds, deriveFlightRule, flightRuleColor } from '../flight-rule.ts';
import type { MetarCloudLayer } from '../metar-types.ts';

// ── ceilingFromClouds ───────────────────────────────────────────────────

test('ceilingFromClouds: BKN/OVC/VV count as ceiling, FEW/SCT/SKC do not', () => {
  const clouds: MetarCloudLayer[] = [
    { cover: 'FEW', baseFt: 200 },
    { cover: 'SCT', baseFt: 600 },
    { cover: 'BKN', baseFt: 2500 },
    { cover: 'OVC', baseFt: 5000 },
  ];
  assert.equal(ceilingFromClouds(clouds), 2500);
});

test('ceilingFromClouds: returns lowest BKN/OVC base', () => {
  assert.equal(
    ceilingFromClouds([
      { cover: 'OVC', baseFt: 4000 },
      { cover: 'BKN', baseFt: 1500 },
    ]),
    1500,
  );
});

test('ceilingFromClouds: VV (vertical visibility) counts as ceiling', () => {
  assert.equal(
    ceilingFromClouds([{ cover: 'VV', baseFt: 200 }]),
    200,
  );
});

test('ceilingFromClouds: only FEW/SCT means unlimited (returns null)', () => {
  assert.equal(
    ceilingFromClouds([
      { cover: 'FEW', baseFt: 5000 },
      { cover: 'SCT', baseFt: 8000 },
    ]),
    null,
  );
});

test('ceilingFromClouds: empty / missing array returns null', () => {
  assert.equal(ceilingFromClouds([]), null);
});

// ── deriveFlightRule ────────────────────────────────────────────────────

test('deriveFlightRule: VFR when vis>5 and ceiling>3000', () => {
  assert.equal(deriveFlightRule(10, 5000), 'VFR');
});

test('deriveFlightRule: VFR with no ceiling (clear sky) and good vis', () => {
  assert.equal(deriveFlightRule(10, null), 'VFR');
});

test('deriveFlightRule: MVFR when ceiling 1000-3000 ft', () => {
  assert.equal(deriveFlightRule(10, 2500), 'MVFR');
  assert.equal(deriveFlightRule(10, 1000), 'MVFR');
  assert.equal(deriveFlightRule(10, 3000), 'MVFR');
});

test('deriveFlightRule: MVFR when vis 3-5 sm', () => {
  assert.equal(deriveFlightRule(5, 5000), 'MVFR');
  assert.equal(deriveFlightRule(3, 5000), 'MVFR');
});

test('deriveFlightRule: IFR when ceiling 500-999 ft', () => {
  assert.equal(deriveFlightRule(10, 800), 'IFR');
  assert.equal(deriveFlightRule(10, 500), 'IFR');
});

test('deriveFlightRule: IFR when vis 1-2 sm', () => {
  assert.equal(deriveFlightRule(2, 5000), 'IFR');
  assert.equal(deriveFlightRule(1, 5000), 'IFR');
});

test('deriveFlightRule: LIFR when ceiling < 500', () => {
  assert.equal(deriveFlightRule(10, 400), 'LIFR');
  assert.equal(deriveFlightRule(10, 100), 'LIFR');
});

test('deriveFlightRule: LIFR when vis < 1', () => {
  assert.equal(deriveFlightRule(0.5, 5000), 'LIFR');
});

test('deriveFlightRule: worst-of-vis-or-ceiling wins', () => {
  // Good vis but very low ceiling = LIFR
  assert.equal(deriveFlightRule(10, 200), 'LIFR');
  // Good ceiling but very low vis = LIFR
  assert.equal(deriveFlightRule(0.25, 5000), 'LIFR');
});

test('deriveFlightRule: both vis and ceiling unknown returns null', () => {
  assert.equal(deriveFlightRule(null, null), null);
});

test('deriveFlightRule: NaN treated as unknown', () => {
  assert.equal(deriveFlightRule(Number.NaN, Number.NaN), null);
});

// ── flightRuleColor ─────────────────────────────────────────────────────

test('flightRuleColor: returns hex per rule', () => {
  assert.equal(flightRuleColor('VFR'), '#3fb950');
  assert.equal(flightRuleColor('MVFR'), '#58a6ff');
  assert.equal(flightRuleColor('IFR'), '#f85149');
  assert.equal(flightRuleColor('LIFR'), '#bc8cff');
  assert.equal(flightRuleColor(null), '#8b949e');
});
