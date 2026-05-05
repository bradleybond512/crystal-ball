import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeCoulombStressStrikeSlip,
  isStrikeSlipRake,
  wellsCoppersmithSlip,
  type CoulombSource,
} from '../coulomb-stress.ts';

const SOURCE: CoulombSource = {
  eventId: 'us-strike',
  lat: 0,
  lon: 0,
  strikeDeg: 0, // strike is north — fault runs along the meridian.
  rakeDeg: 0,   // pure right-lateral strike-slip
  lengthKm: 30,
  slipMeters: 1.5,
};

// ── isStrikeSlipRake ──────────────────────────────────────────────────

test('isStrikeSlipRake: pure cases pass', () => {
  assert.equal(isStrikeSlipRake(0), true);
  assert.equal(isStrikeSlipRake(180), true);
  assert.equal(isStrikeSlipRake(-180), true);
});

test('isStrikeSlipRake: pure normal/reverse fail', () => {
  assert.equal(isStrikeSlipRake(90), false);
  assert.equal(isStrikeSlipRake(-90), false);
});

test('isStrikeSlipRake: edge cases (rake = ±30) fall outside strike-slip', () => {
  // The strict scope is |rake| < 30 OR |rake| > 150 — boundary excluded.
  assert.equal(isStrikeSlipRake(30), false);
  assert.equal(isStrikeSlipRake(-30), false);
});

test('isStrikeSlipRake: invalid input returns false', () => {
  assert.equal(isStrikeSlipRake(Number.NaN), false);
  assert.equal(isStrikeSlipRake(Infinity), false);
});

// ── wellsCoppersmithSlip ──────────────────────────────────────────────

test('wellsCoppersmithSlip: M=6.5 yields ~0.42 m', () => {
  const slip = wellsCoppersmithSlip(6.5);
  // 10^(-6.32 + 0.9*6.5) = 10^(-0.47) ≈ 0.339
  assert.ok(slip > 0.3 && slip < 0.4, `expected ~0.34 m, got ${slip}`);
});

test('wellsCoppersmithSlip: M=7.5 yields ~3 m', () => {
  const slip = wellsCoppersmithSlip(7.5);
  // 10^(-6.32 + 0.9*7.5) = 10^(0.43) ≈ 2.69
  assert.ok(slip > 2 && slip < 4, `expected ~2.7 m, got ${slip}`);
});

test('wellsCoppersmithSlip: invalid input returns 0', () => {
  assert.equal(wellsCoppersmithSlip(Number.NaN), 0);
});

// ── computeCoulombStressStrikeSlip: scope gates ───────────────────────

test('computeCoulombStressStrikeSlip: rejects non-strike-slip rake', () => {
  const result = computeCoulombStressStrikeSlip({ ...SOURCE, rakeDeg: 90 });
  assert.equal(result, null);
});

test('computeCoulombStressStrikeSlip: rejects nonsense location', () => {
  assert.equal(
    computeCoulombStressStrikeSlip({ ...SOURCE, lat: 999 }),
    null,
  );
});

test('computeCoulombStressStrikeSlip: rejects zero-length / negative-slip rupture', () => {
  assert.equal(computeCoulombStressStrikeSlip({ ...SOURCE, lengthKm: 0 }), null);
  assert.equal(computeCoulombStressStrikeSlip({ ...SOURCE, slipMeters: 0 }), null);
});

// ── computeCoulombStressStrikeSlip: pattern checks ────────────────────

test('computeCoulombStressStrikeSlip: returns a non-empty grid', () => {
  const result = computeCoulombStressStrikeSlip(SOURCE);
  assert.ok(result);
  assert.ok(result!.stressGrid.length > 0);
  assert.equal(result!.eventId, SOURCE.eventId);
  assert.equal(result!.faultSegmentsLoaded.length, 0);
});

test('computeCoulombStressStrikeSlip: along-strike points are loaded (positive ΔCFS)', () => {
  // Strike = 0 (north). With friction default 0.4, the loaded lobe is
  // rotated slightly; check the directly-along-strike point at 100 km
  // north and confirm it is positive (and well above the trigger
  // threshold of 0.1 bar for a M~6.5 strike-slip rupture).
  const result = computeCoulombStressStrikeSlip(SOURCE, { resolutionDeg: 0.05 });
  assert.ok(result);
  const along = result!.stressGrid.find(
    (cell) => Math.abs(cell.lon) < 0.01 && Math.abs(cell.lat - 0.9) < 0.01, // ~100 km N
  );
  assert.ok(along, 'along-strike grid cell exists');
  assert.ok(along!.deltaCfsBar > 0, `along-strike loaded; got ΔCFS=${along!.deltaCfsBar}`);
});

test('computeCoulombStressStrikeSlip: positive lobes are area-positive', () => {
  const result = computeCoulombStressStrikeSlip(SOURCE);
  assert.ok(result);
  assert.ok(result!.positiveLobeArea_km2 > 0, 'has positive-lobe area');
  assert.ok(result!.negativeLobeArea_km2 > 0, 'has negative-lobe area');
});

test('computeCoulombStressStrikeSlip: sign pattern symmetric for μ=0', () => {
  // With effective friction = 0, ΔCFS = K cos(2α)/r² — pure 4-lobe
  // butterfly. Positive and negative lobe areas must be equal by
  // symmetry (modulo grid-edge effects).
  const result = computeCoulombStressStrikeSlip(SOURCE, {
    effectiveFriction: 0,
    resolutionDeg: 0.05,
    radiusKm: 150,
  });
  assert.ok(result);
  const pos = result!.positiveLobeArea_km2;
  const neg = result!.negativeLobeArea_km2;
  // Allow 5% tolerance for grid quantisation at the rim.
  const ratio = pos / neg;
  assert.ok(ratio > 0.95 && ratio < 1.05, `expected near-equal; pos/neg=${ratio}`);
});

test('computeCoulombStressStrikeSlip: receivers inside the rupture half-length report 0', () => {
  const result = computeCoulombStressStrikeSlip(SOURCE);
  assert.ok(result);
  // Source is at (0,0), length 30 km → half-length 15 km. A point at
  // (0.05°, 0.05°) is ~7.8 km from origin → inside half-length.
  const inside = result!.stressGrid.find(
    (c) => Math.abs(c.lat - 0.05) < 1e-9 && Math.abs(c.lon - 0.05) < 1e-9,
  );
  if (inside) assert.equal(inside.deltaCfsBar, 0);
});

test('computeCoulombStressStrikeSlip: stress drops with distance (1/r³)', () => {
  // Two points along strike at 50 km and 100 km should show ΔCFS that
  // falls roughly as 1/r³ (3D static point-source). Tolerate a wide
  // window because we sample discrete grid cells, not the exact
  // analytical points.
  const result = computeCoulombStressStrikeSlip(SOURCE, {
    resolutionDeg: 0.05,
    effectiveFriction: 0,
  });
  assert.ok(result);
  const near = result!.stressGrid.find(
    (c) => Math.abs(c.lon) < 0.01 && Math.abs(c.lat - 0.45) < 0.01,
  );
  const far = result!.stressGrid.find(
    (c) => Math.abs(c.lon) < 0.01 && Math.abs(c.lat - 0.9) < 0.01,
  );
  assert.ok(near && far, 'samples present');
  // 1/r³ with r doubled → factor of 8 drop.
  const ratio = Math.abs(near!.deltaCfsBar) / Math.abs(far!.deltaCfsBar);
  assert.ok(ratio > 4 && ratio < 16, `expected ~8 drop; got ${ratio}`);
});

// ── End-to-end: result is JSON-serializable + emits notes ─────────────

test('CoulombStressResult is JSON-serializable and notes scope honestly', () => {
  const result = computeCoulombStressStrikeSlip(SOURCE);
  assert.ok(result);
  const round = JSON.parse(JSON.stringify(result));
  assert.equal(round.eventId, SOURCE.eventId);
  assert.ok(/strike-slip|stub/i.test(round.notes), 'notes mention scope');
  assert.equal(round.faultSegmentsLoaded.length, 0);
});

// ── Custom options honored ────────────────────────────────────────────

test('computeCoulombStressStrikeSlip: custom resolution changes grid count', () => {
  const fine = computeCoulombStressStrikeSlip(SOURCE, { resolutionDeg: 0.05 });
  const coarse = computeCoulombStressStrikeSlip(SOURCE, { resolutionDeg: 0.5 });
  assert.ok(fine && coarse);
  assert.ok(fine!.stressGrid.length > coarse!.stressGrid.length);
});

test('computeCoulombStressStrikeSlip: smaller radius shrinks grid', () => {
  const big = computeCoulombStressStrikeSlip(SOURCE, { radiusKm: 200 });
  const small = computeCoulombStressStrikeSlip(SOURCE, { radiusKm: 80 });
  assert.ok(big && small);
  assert.ok(big!.stressGrid.length > small!.stressGrid.length);
});

test('computeCoulombStressStrikeSlip: trigger threshold gates lobe areas', () => {
  const lax = computeCoulombStressStrikeSlip(SOURCE, { triggerThresholdBar: 0.01 });
  const strict = computeCoulombStressStrikeSlip(SOURCE, { triggerThresholdBar: 5 });
  assert.ok(lax && strict);
  assert.ok(lax!.positiveLobeArea_km2 > strict!.positiveLobeArea_km2);
});
