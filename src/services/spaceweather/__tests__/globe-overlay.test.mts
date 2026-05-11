import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auroraColorForKp,
  buildOverlayDescriptor,
  deriveSpaceWxBanner,
  flarePulseRadiusAt,
  ringAtLatitude,
  subsolarPoint,
} from '../globe-overlay.ts';
import type { SpaceWxStatus } from '../swpc-monitor.ts';

const NOW = Date.parse('2026-05-06T12:00:00Z');

function makeStatus(over: Partial<SpaceWxStatus> = {}): SpaceWxStatus {
  return {
    xray: null,
    geomag: null,
    gpsDisruption: 'none',
    hfRadioBlackout: false,
    earthwardCmes: [],
    asOf: new Date(NOW).toISOString(),
    ...over,
  };
}

// ── Ring geometry ──────────────────────────────────────────────────────────

test('ringAtLatitude samples lon every 5° from -180 through 180 inclusive', () => {
  const ring = ringAtLatitude(60);
  assert.equal(ring.length, 73);
  assert.deepEqual(ring[0], [-180, 60]);
  assert.deepEqual(ring[ring.length - 1], [180, 60]);
});

test('ringAtLatitude honours custom step', () => {
  const ring = ringAtLatitude(45, 30);
  assert.equal(ring.length, 13);
  assert.deepEqual(ring[1], [-150, 45]);
});

// ── Color ladder ───────────────────────────────────────────────────────────

test('auroraColorForKp ladder: green at G1/G2, violet at G3, deep purple at G4/G5', () => {
  const g1 = auroraColorForKp(5);
  assert.ok(g1.g > g1.r); // green dominates
  const g4 = auroraColorForKp(8);
  assert.ok(g4.b > g4.g); // blue dominates → purple
  const g5 = auroraColorForKp(9);
  assert.deepEqual(g5, auroraColorForKp(8));
});

// ── Subsolar point ─────────────────────────────────────────────────────────

test('subsolarPoint at 12:00 UTC sits over the prime meridian', () => {
  const point = subsolarPoint(Date.parse('2026-03-21T12:00:00Z')); // ~equinox
  assert.ok(Math.abs(point.lonDeg) < 0.5);
  // March 21 is the equinox so latitude is near 0°.
  assert.ok(Math.abs(point.latDeg) < 2);
});

test('subsolarPoint moves 15°/h westward as UTC clock advances', () => {
  const noon = subsolarPoint(Date.parse('2026-03-21T12:00:00Z'));
  const onepm = subsolarPoint(Date.parse('2026-03-21T13:00:00Z'));
  // 1h after noon UTC → subsolar moved to ~ -15° lon.
  assert.ok(Math.abs(onepm.lonDeg + 15) < 0.5, `got ${onepm.lonDeg}`);
  // Latitude shouldn't change appreciably across one hour.
  assert.ok(Math.abs(onepm.latDeg - noon.latDeg) < 0.5);
});

test('subsolarPoint reflects seasonal declination at solstices', () => {
  // June solstice → ~+23.45°N
  const june = subsolarPoint(Date.parse('2026-06-21T12:00:00Z'));
  assert.ok(june.latDeg > 22 && june.latDeg < 24, `got ${june.latDeg}`);
  // December solstice → ~-23.45°S
  const dec = subsolarPoint(Date.parse('2026-12-21T12:00:00Z'));
  assert.ok(dec.latDeg < -22 && dec.latDeg > -24, `got ${dec.latDeg}`);
});

// ── Descriptor: aurora ─────────────────────────────────────────────────────

test('buildOverlayDescriptor returns invisible descriptor for null status', () => {
  const d = buildOverlayDescriptor(null, NOW);
  assert.equal(d.visible, false);
  assert.equal(d.aurora, null);
  assert.equal(d.flarePulse, null);
});

test('buildOverlayDescriptor: Kp <5 yields no aurora ring', () => {
  const status = makeStatus({
    geomag: { kp: 4, level: 'G0', auroraVisibilityLatN: 90, observedAt: '', kpMax24h: 4 },
  });
  const d = buildOverlayDescriptor(status, NOW);
  assert.equal(d.aurora, null);
});

test('buildOverlayDescriptor: Kp 7 produces northern + mirrored southern ring', () => {
  const status = makeStatus({
    geomag: { kp: 7, level: 'G3', auroraVisibilityLatN: 55, observedAt: '', kpMax24h: 7 },
  });
  const d = buildOverlayDescriptor(status, NOW);
  assert.ok(d.aurora);
  assert.equal(d.aurora?.latN, 55);
  assert.equal(d.aurora?.latS, -55);
  assert.equal(d.aurora?.ringNorth.length, 73);
  assert.equal(d.aurora?.ringSouth.length, 73);
  assert.equal(d.aurora?.widthPx, 3);
});

test('buildOverlayDescriptor: Kp 9 widens the ring + uses deep purple', () => {
  const status = makeStatus({
    geomag: { kp: 9, level: 'G5', auroraVisibilityLatN: 45, observedAt: '', kpMax24h: 9 },
  });
  const d = buildOverlayDescriptor(status, NOW);
  assert.equal(d.aurora?.widthPx, 4);
  assert.equal(d.aurora?.color.b, 0.95);
});

// ── Descriptor: flare pulse ────────────────────────────────────────────────

test('buildOverlayDescriptor: only x-class flare emits a pulse', () => {
  const xClassStatus = makeStatus({
    xray: { peakFlux: 1.5e-4, currentFlux: 1.5e-4, peakClass: 'X', peakLabel: 'X1.5',
      peakAt: '', xClassActive: true, sampleCount: 10 },
  });
  const mClassStatus = makeStatus({
    xray: { peakFlux: 5e-5, currentFlux: 5e-5, peakClass: 'M', peakLabel: 'M5.0',
      peakAt: '', xClassActive: false, sampleCount: 10 },
  });
  assert.ok(buildOverlayDescriptor(xClassStatus, NOW).flarePulse);
  assert.equal(buildOverlayDescriptor(mClassStatus, NOW).flarePulse, null);
});

// ── Banner integration ────────────────────────────────────────────────────

test('deriveSpaceWxBanner: null status yields none', () => {
  assert.equal(deriveSpaceWxBanner(null).severity, 'none');
});

test('deriveSpaceWxBanner: G5 storm escalates to extreme banner', () => {
  const banner = deriveSpaceWxBanner(makeStatus({
    geomag: { kp: 9, level: 'G5', auroraVisibilityLatN: 45, observedAt: '', kpMax24h: 9 },
  }));
  assert.equal(banner.severity, 'g5');
  assert.match(banner.label, /EXTREME/);
  assert.match(banner.subtitle, /Kp 9\.0/);
});

test('deriveSpaceWxBanner: G4 / G3 escalate distinctly', () => {
  const g4 = deriveSpaceWxBanner(makeStatus({
    geomag: { kp: 8, level: 'G4', auroraVisibilityLatN: 50, observedAt: '', kpMax24h: 8 },
  }));
  assert.equal(g4.severity, 'g4');
  assert.match(g4.label, /SEVERE/);
  const g3 = deriveSpaceWxBanner(makeStatus({
    geomag: { kp: 7, level: 'G3', auroraVisibilityLatN: 55, observedAt: '', kpMax24h: 7 },
  }));
  assert.equal(g3.severity, 'g3');
  assert.match(g3.label, /STRONG/);
});

test('deriveSpaceWxBanner: G2 storm + X-class flare prefers the flare banner', () => {
  const banner = deriveSpaceWxBanner(makeStatus({
    geomag: { kp: 6, level: 'G2', auroraVisibilityLatN: 57.5, observedAt: '', kpMax24h: 6 },
    xray: { peakFlux: 2e-4, currentFlux: 2e-4, peakClass: 'X', peakLabel: 'X2.0',
      peakAt: '', xClassActive: true, sampleCount: 10 },
  }));
  assert.equal(banner.severity, 'flare');
  assert.match(banner.label, /X-CLASS/);
});

test('deriveSpaceWxBanner: G1/G2 alone returns none', () => {
  const banner = deriveSpaceWxBanner(makeStatus({
    geomag: { kp: 5, level: 'G1', auroraVisibilityLatN: 60, observedAt: '', kpMax24h: 5 },
  }));
  assert.equal(banner.severity, 'none');
});

const PULSE = { subsolarLonDeg: 0, subsolarLatDeg: 0, pulsePeriodMs: 1000, innerRadiusM: 100, outerRadiusM: 500 };

test('flarePulseRadiusAt: phase 0 sits at innerRadius', () => {
  assert.equal(flarePulseRadiusAt(0, PULSE), 100);
});

test('flarePulseRadiusAt: phase 0.5 sits at outerRadius', () => {
  assert.equal(flarePulseRadiusAt(500, PULSE), 500);
});

test('flarePulseRadiusAt: phase 0.25 is halfway up the ramp', () => {
  assert.equal(flarePulseRadiusAt(250, PULSE), 300);
});

test('flarePulseRadiusAt: phase 0.75 is halfway down the ramp', () => {
  assert.equal(flarePulseRadiusAt(750, PULSE), 300);
});

test('flarePulseRadiusAt: wraps cleanly across multiple periods', () => {
  assert.equal(flarePulseRadiusAt(2500, PULSE), flarePulseRadiusAt(500, PULSE));
});

test('flarePulseRadiusAt: tolerates zero-period pulse without dividing by zero', () => {
  const degenerate = { ...PULSE, pulsePeriodMs: 0 };
  const r = flarePulseRadiusAt(123, degenerate);
  assert.ok(Number.isFinite(r), 'radius must be finite');
  assert.ok(r >= PULSE.innerRadiusM && r <= PULSE.outerRadiusM, 'radius must stay in bounds');
});
