// src/services/survival/__tests__/comms-fallback.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommsFallback } from '../comms-fallback.ts';
import { GUIDANCE_LEVEL } from '../grid-down-certify.ts';
import { bandForLevel, SURVIVAL_AXES } from '../survival-types.ts';
import type { AxisState, SurvivalAxis, SurvivalPosture, WorldSnapshot } from '../survival-types.ts';

const CAP = 1_700_000_000_000;

function axisState(axis: SurvivalAxis, level: number): AxisState {
  return {
    axis, level, band: bandForLevel(level), trend: 'steady', threats: [],
    confidence: { total: level, max: 100, items: [{ label: 'x', value: level, max: 100, polarity: 'negative' }] },
    explanation: { headline: `${axis}`, lines: [], missingConfirmation: [] },
    drivers: [],
  };
}

function posture(overrides: Partial<Record<SurvivalAxis, number>> = {}): SurvivalPosture {
  const axes = SURVIVAL_AXES.map((a) => axisState(a, overrides[a] ?? 0));
  const worst = axes.reduce((m, a) => (a.level > m.level ? a : m), axes[0]!);
  return {
    axes, overallLevel: worst.level, overallBand: worst.band, worstAxis: worst.axis,
    headline: 'x', capturedAtMs: CAP, staleInputs: [],
  };
}

function snapshot(p: SurvivalPosture): WorldSnapshot {
  return { version: 1, capturedAtMs: CAP, freshness: [], weatherAlerts: [], savedPlaces: [], posture: p, plan: { committed: [] } };
}

const rung = (plan: ReturnType<typeof resolveCommsFallback>, id: string) => plan.ladder.find((r) => r.id === id)!;

test('a nominal snapshot recommends broadband and keeps the whole ladder viable', () => {
  const plan = resolveCommsFallback(snapshot(posture()));
  assert.equal(plan.commsBand, 'secure');
  assert.equal(plan.powerCompromised, false);
  assert.equal(plan.recommendedRungId, 'broadband_internet');
  assert.ok(plan.ladder.every((r) => r.viable), 'every rung viable when nothing is down');
  assert.equal(plan.capturedAtMs, CAP);
  assert.match(plan.headline, /Comms nominal — primary path: Broadband internet/);
});

test('an elevated comms band drops internet rungs to cellular', () => {
  const plan = resolveCommsFallback(snapshot(posture({ comms: GUIDANCE_LEVEL })));
  assert.equal(plan.commsBand, 'elevated');
  assert.equal(rung(plan, 'broadband_internet').viable, false);
  assert.equal(rung(plan, 'wifi_calling').viable, false);
  assert.equal(rung(plan, 'cellular_data').viable, true);
  assert.equal(plan.recommendedRungId, 'cellular_data');
  assert.match(plan.headline, /Comms elevated — fall back to Cellular data/);
});

test('a high comms band drops cellular too, down to copper landline', () => {
  const plan = resolveCommsFallback(snapshot(posture({ comms: 65 })));
  assert.equal(plan.commsBand, 'high');
  assert.equal(rung(plan, 'cellular_data').viable, false);
  assert.equal(rung(plan, 'cellular_voice_sms').viable, false);
  assert.equal(rung(plan, 'landline_pots').viable, true);
  assert.equal(plan.recommendedRungId, 'landline_pots');
});

test('a critical comms band leaves only battery/foot rungs — recommend two-way radio to transmit', () => {
  const plan = resolveCommsFallback(snapshot(posture({ comms: 90 })));
  assert.equal(plan.commsBand, 'critical');
  assert.equal(rung(plan, 'landline_pots').viable, false);
  assert.equal(rung(plan, 'noaa_weather_radio').viable, true);
  assert.equal(rung(plan, 'two_way_radio').viable, true);
  assert.equal(rung(plan, 'physical_runner').viable, true);
  // Weather radio is receive-only, so the transmit recommendation skips it.
  assert.equal(plan.recommendedRungId, 'two_way_radio');
  assert.equal(plan.receiveRungId, 'noaa_weather_radio');
});

test('the transmit recommendation is never receive-only and always exists', () => {
  for (const level of [0, GUIDANCE_LEVEL, 65, 90, 100]) {
    const plan = resolveCommsFallback(snapshot(posture({ comms: level })));
    const rec = plan.ladder.find((r) => r.id === plan.recommendedRungId)!;
    assert.ok(rec.viable && !rec.receiveOnly, `level ${level}: recommended must be viable + transmit-capable`);
  }
});

test('a compromised power axis takes broadband even when comms is nominal', () => {
  const plan = resolveCommsFallback(snapshot(posture({ energy_water: 70 })));
  assert.equal(plan.commsBand, 'secure');
  assert.equal(plan.powerCompromised, true);
  // Broadband needs mains power (router); cellular does not.
  assert.equal(rung(plan, 'broadband_internet').viable, false);
  assert.equal(rung(plan, 'cellular_data').viable, true);
  assert.equal(plan.recommendedRungId, 'cellular_data');
  assert.match(plan.headline, /with power down/);
});

test('copper landline survives a blackout — mains loss does not take it', () => {
  const plan = resolveCommsFallback(snapshot(posture({ energy_water: 90 })));
  assert.equal(plan.powerCompromised, true);
  assert.equal(rung(plan, 'landline_pots').viable, true, 'POTS is central-office battery-backed');
});

test('battery and foot rungs are never assumed down (comms grid-down guarantee)', () => {
  const plan = resolveCommsFallback(snapshot(posture({ comms: 100, energy_water: 100 })));
  assert.equal(rung(plan, 'noaa_weather_radio').viable, true);
  assert.equal(rung(plan, 'two_way_radio').viable, true);
  assert.equal(rung(plan, 'physical_runner').viable, true);
});

test('offlineCapable flags exactly the battery/foot rungs', () => {
  const plan = resolveCommsFallback(snapshot(posture()));
  const offline = plan.ladder.filter((r) => r.offlineCapable).map((r) => r.id);
  assert.deepEqual(offline, ['noaa_weather_radio', 'two_way_radio', 'physical_runner']);
});

test('static reference data rides on the radio rungs', () => {
  const plan = resolveCommsFallback(snapshot(posture()));
  assert.match(rung(plan, 'noaa_weather_radio').reference ?? '', /162\.400/);
  assert.match(rung(plan, 'two_way_radio').reference ?? '', /462\.5625/);
  assert.equal(rung(plan, 'broadband_internet').reference, undefined);
});

test('check-in cadence tightens as the comms band climbs', () => {
  const secure = resolveCommsFallback(snapshot(posture())).checkIn.cadenceLabel;
  const elevated = resolveCommsFallback(snapshot(posture({ comms: GUIDANCE_LEVEL }))).checkIn.cadenceLabel;
  const critical = resolveCommsFallback(snapshot(posture({ comms: 90 }))).checkIn.cadenceLabel;
  assert.match(secure, /as needed/);
  assert.match(elevated, /every 4 hours/);
  assert.match(critical, /hourly/);
});

test('a non-finite comms level is treated as 0, not critical', () => {
  const plan = resolveCommsFallback(snapshot(posture({ comms: Number.NaN })));
  assert.equal(plan.commsLevel, 0);
  assert.equal(plan.commsBand, 'secure');
  assert.equal(plan.recommendedRungId, 'broadband_internet');
});

test('an infinite power level does not spuriously mark power compromised', () => {
  const plan = resolveCommsFallback(snapshot(posture({ energy_water: Number.POSITIVE_INFINITY })));
  assert.equal(plan.powerCompromised, false);
  assert.equal(rung(plan, 'broadband_internet').viable, true);
});

test('the ladder is ordered most-capable first and covers eight distinct rungs', () => {
  const plan = resolveCommsFallback(snapshot(posture()));
  assert.deepEqual(plan.ladder.map((r) => r.id), [
    'broadband_internet', 'cellular_data', 'cellular_voice_sms', 'wifi_calling',
    'landline_pots', 'noaa_weather_radio', 'two_way_radio', 'physical_runner',
  ]);
});
