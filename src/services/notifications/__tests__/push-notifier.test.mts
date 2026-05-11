import assert from 'node:assert/strict';
import test from 'node:test';
import { decideNotification, type NotifiableEvent } from '../push-notifier.ts';

test('decideNotification: seismic M5.5 below pushMinMagnitude=6 does not fire', () => {
  const event: NotifiableEvent = {
    kind: 'seismic',
    magnitude: 5.5,
    place: 'Test Region',
  };
  const decision = decideNotification(event, {
    thresholds: {
      seismic: { pushMinMagnitude: 6.0, voiceMinMagnitude: 7.0 },
      geomagnetic: { pushMinKp: 7, voiceMinKp: 8 },
      wildfire: { pushMinFRP: 100, radiusKm: 50 },
      airQuality: { pushMinAQI: 150 },
      economic: { pushMinVIX: 30, ofrFsiSigmas: 2.0 },
      hurricane: { pushMinCategory: 3 },
    },
  });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'magnitude-below-threshold');
});

test('decideNotification: seismic M6.4 (TIER_3) fires with tier metadata', () => {
  const decision = decideNotification({ kind: 'seismic', magnitude: 6.4, place: 'La Porte, IN' });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'seismic_tier3');
  assert.match(decision.payload?.title ?? '', /M6\.4/);
  assert.match(decision.payload?.body ?? '', /La Porte/);
  assert.equal(decision.payload?.threatLevel, 'high');
});

test('decideNotification: seismic M8.5 (TIER_5) is critical', () => {
  const decision = decideNotification({ kind: 'seismic', magnitude: 8.5, place: 'Pacific' });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'seismic_tier5');
  assert.equal(decision.payload?.threatLevel, 'critical');
});

test('decideNotification: seismic with magnitude < 5 does not fire', () => {
  const decision = decideNotification({ kind: 'seismic', magnitude: 4.7, place: 'X' });
  assert.equal(decision.shouldFire, false);
});

test('decideNotification: geomagnetic Kp 8 (G4) fires', () => {
  const decision = decideNotification({ kind: 'geomagnetic', kpIndex: 8 });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'geomagnetic_g4');
  assert.match(decision.payload?.body ?? '', /G4|Kp/);
});

test('decideNotification: geomagnetic Kp 6 below default pushMinKp=7 does not fire', () => {
  const decision = decideNotification({ kind: 'geomagnetic', kpIndex: 6 });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'kp-below-threshold');
});

test('decideNotification: geomagnetic Kp 7 (G3) fires at medium', () => {
  const decision = decideNotification({ kind: 'geomagnetic', kpIndex: 7 });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'geomagnetic_g3');
  assert.equal(decision.payload?.threatLevel, 'medium');
  assert.match(decision.payload?.body ?? '', /G3|Kp 7/);
});

test('decideNotification: geomagnetic Kp 9 (G5) fires critical', () => {
  const decision = decideNotification({ kind: 'geomagnetic', kpIndex: 9 });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatLevel, 'critical');
  assert.match(decision.payload?.body ?? '', /G5/);
});

test('decideNotification: CAP Extreme + Immediate fires', () => {
  const decision = decideNotification({
    kind: 'cap',
    severity: 'Extreme',
    urgency: 'Immediate',
    event: 'Tornado Warning',
    headline: 'Tornado Warning issued for La Porte',
    areaDesc: 'La Porte, IN',
  });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'cap_extreme');
  assert.match(decision.payload?.title ?? '', /Tornado Warning/);
});

test('decideNotification: CAP Severe + Immediate fires at high', () => {
  const decision = decideNotification({
    kind: 'cap',
    severity: 'Severe',
    urgency: 'Immediate',
    event: 'Severe Thunderstorm Warning',
    headline: 'Severe Thunderstorm',
    areaDesc: 'X',
  });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'cap_severe');
  assert.equal(decision.payload?.threatLevel, 'high');
});

test('decideNotification: CAP Moderate + Immediate does NOT fire', () => {
  const decision = decideNotification({
    kind: 'cap',
    severity: 'Moderate',
    urgency: 'Immediate',
    event: 'Special Weather Statement',
    headline: 'X',
    areaDesc: 'X',
  });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'cap-not-extreme-immediate');
});

test('decideNotification: CAP Extreme + Expected does NOT fire (not immediate)', () => {
  const decision = decideNotification({
    kind: 'cap',
    severity: 'Extreme',
    urgency: 'Expected',
    event: 'Tornado Watch',
    headline: 'Tornado Watch',
    areaDesc: 'X',
  });
  assert.equal(decision.shouldFire, false);
});

test('decideNotification: hurricane Cat 3 fires (when NHC data lands)', () => {
  const decision = decideNotification({
    kind: 'hurricane',
    nhcStorm: { name: 'Ida', category: 3 },
  });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'hurricane_cat3');
});

test('decideNotification: hurricane Cat 2 does NOT fire', () => {
  const decision = decideNotification({
    kind: 'hurricane',
    nhcStorm: { name: 'Bertha', category: 2 },
  });
  assert.equal(decision.shouldFire, false);
});

test('decideNotification: hurricane without nhcStorm payload returns todo skip', () => {
  const decision = decideNotification({ kind: 'hurricane' });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'todo-data-feed-pending');
});

test('decideNotification: wildfire <10% containment + >10k acres fires', () => {
  const decision = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Park Fire', state: 'CA', containment: 5, acres: 50_000 },
  });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'wildfire_extreme');
  assert.match(decision.payload?.body ?? '', /50,000 acres/);
});

test('decideNotification: wildfire <10% containment but <10k acres does NOT fire', () => {
  const decision = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Tiny Fire', state: 'CA', containment: 5, acres: 4_500 },
  });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'wildfire-below-acre-threshold');
});

test('decideNotification: wildfire containment 25 does NOT fire (containment gate)', () => {
  const decision = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Park Fire', state: 'CA', containment: 25, acres: 100_000 },
  });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'wildfire-containment-above-threshold');
});

test('decideNotification: wildfire missing acres bails out (cannot guess size)', () => {
  const decision = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Park Fire', state: 'CA', containment: 5 },
  });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'wildfire-below-acre-threshold');
});

test('decideNotification: wildfire without nifc payload returns todo skip', () => {
  const decision = decideNotification({ kind: 'wildfire' });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'todo-data-feed-pending');
});

// ── Solar flares ─────────────────────────────────────────────────────────

test('decideNotification: X-class solar flare fires', () => {
  const decision = decideNotification({
    kind: 'solar_flare',
    peakClass: 'X',
    peakLabel: 'X2.7',
    peakAt: '2026-05-08T12:00:00Z',
  });
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'solar_flare_x');
  assert.equal(decision.payload?.threatLevel, 'high');
  assert.match(decision.payload?.title ?? '', /X2\.7/);
});

test('decideNotification: M-class solar flare does NOT fire', () => {
  const decision = decideNotification({
    kind: 'solar_flare',
    peakClass: 'M',
    peakLabel: 'M5.4',
  });
  assert.equal(decision.shouldFire, false);
});
