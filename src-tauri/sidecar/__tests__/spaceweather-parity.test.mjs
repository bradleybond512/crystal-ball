/**
 * Parity test: the sidecar's inline JS port of the spaceweather monitor
 * (classify/summarize/build helpers) MUST behave the same as the
 * canonical TS module in src/services/spaceweather/.
 *
 * If you change one, change the other and update this test.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  classifyXrayFluxSidecar,
  xrayLabelSidecar,
  kpToStormLevelSidecar,
  auroraVisibilityLatitudeSidecar,
  classifyGpsDisruptionSidecar,
  summarizeXrayFluxSidecar,
  summarizeKpSidecar,
  summarizeAlertsSidecar,
  filterEarthwardCmesSidecar,
  buildSpaceweatherStatusSidecar,
} from '../local-api-server.mjs';

const NOW = Date.parse('2026-05-06T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const isoMinus = (h) => new Date(NOW - h * HOUR_MS).toISOString();

test('classifyXrayFluxSidecar tiers match the spec', () => {
  assert.equal(classifyXrayFluxSidecar(5e-9), 'A');
  assert.equal(classifyXrayFluxSidecar(1e-7), 'B');
  assert.equal(classifyXrayFluxSidecar(1e-6), 'C');
  assert.equal(classifyXrayFluxSidecar(4.2e-5), 'M');
  assert.equal(classifyXrayFluxSidecar(1e-4), 'X');
});

test('xrayLabelSidecar matches TS formatting', () => {
  assert.equal(xrayLabelSidecar(4.2e-5), 'M4.2');
  assert.equal(xrayLabelSidecar(1e-4), 'X1.0');
  assert.equal(xrayLabelSidecar(1e-2), 'X99.0');
});

test('kpToStormLevelSidecar covers G0..G5', () => {
  assert.equal(kpToStormLevelSidecar(0), 'G0');
  assert.equal(kpToStormLevelSidecar(4.99), 'G0');
  assert.equal(kpToStormLevelSidecar(5), 'G1');
  assert.equal(kpToStormLevelSidecar(7), 'G3');
  assert.equal(kpToStormLevelSidecar(9), 'G5');
});

test('auroraVisibilityLatitudeSidecar matches TS anchors', () => {
  assert.equal(auroraVisibilityLatitudeSidecar(4), 90);
  assert.equal(auroraVisibilityLatitudeSidecar(5), 60);
  assert.equal(auroraVisibilityLatitudeSidecar(7), 55);
  assert.equal(auroraVisibilityLatitudeSidecar(7.5), 52.5);
  assert.equal(auroraVisibilityLatitudeSidecar(9), 45);
});

test('classifyGpsDisruptionSidecar maps flare class to risk band', () => {
  assert.equal(classifyGpsDisruptionSidecar('X'), 'high');
  assert.equal(classifyGpsDisruptionSidecar('M'), 'moderate');
  assert.equal(classifyGpsDisruptionSidecar('C'), 'low');
  assert.equal(classifyGpsDisruptionSidecar('B'), 'none');
  assert.equal(classifyGpsDisruptionSidecar(null), 'none');
});

test('summarizeXrayFluxSidecar picks the peak in window', () => {
  const points = [
    { time_tag: isoMinus(0.5), flux: 1.5e-4 },
    { time_tag: isoMinus(0.3), flux: 9e-5 },
    { time_tag: isoMinus(0.1), flux: 4e-5 },
  ];
  const x = summarizeXrayFluxSidecar(points, NOW);
  assert.ok(x);
  assert.equal(x.peakClass, 'X');
  assert.equal(x.peakLabel, 'X1.5');
  assert.equal(x.xClassActive, true);
});

test('summarizeKpSidecar reports latest Kp + max in window', () => {
  const points = [
    { time_tag: isoMinus(20), kp: 4 },
    { time_tag: isoMinus(8), kp: 6 },
    { time_tag: isoMinus(2), kp: 7 },
  ];
  const k = summarizeKpSidecar(points, NOW);
  assert.ok(k);
  assert.equal(k.kp, 7);
  assert.equal(k.level, 'G3');
  assert.equal(k.auroraVisibilityLatN, 55);
  assert.equal(k.kpMax24h, 7);
});

test('summarizeAlertsSidecar classifies severities', () => {
  const raw = [
    { product_id: 'K07', message: 'ALERT: Geomagnetic K-index of 7\nDetails…',  issue_datetime: isoMinus(2) },
    { product_id: 'K05', message: 'WATCH: G2 (Moderate) Geomagnetic Storm',     issue_datetime: isoMinus(3) },
    { product_id: 'X1A', message: 'WARNING: X-ray flare M5+ likely',            issue_datetime: isoMinus(4) },
  ];
  const a = summarizeAlertsSidecar(raw, NOW);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => x.severity), ['alert', 'watch', 'warning']);
});

test('filterEarthwardCmesSidecar keeps |lon| ≤ 30°, drops stale arrivals', () => {
  const cmes = [
    { activityID: 'cme-eward', startTime: isoMinus(2),
      cmeAnalyses: [{ longitude: 12, halfAngle: 40, speed: 920, isMostAccurate: true,
                       time21_5: isoMinus(-30) }] },
    { activityID: 'cme-off',   startTime: isoMinus(3),
      cmeAnalyses: [{ longitude: 110, halfAngle: 30, speed: 700, isMostAccurate: true,
                       time21_5: isoMinus(-40) }] },
    { activityID: 'cme-old',   startTime: isoMinus(72),
      cmeAnalyses: [{ longitude: 5, halfAngle: 40, speed: 900, isMostAccurate: true,
                       time21_5: isoMinus(36) }] },
  ];
  const out = filterEarthwardCmesSidecar(cmes, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'cme-eward');
});

test('buildSpaceweatherStatusSidecar mirrors TS top-level shape', () => {
  const xray = [{ time_tag: isoMinus(0.5), flux: 1.5e-4 }];
  const kp = [{ time_tag: isoMinus(2), kp: 7 }];
  const status = buildSpaceweatherStatusSidecar({ xrayFlux: xray, kpIndex: kp, cmes: [], now: NOW });
  assert.ok(status.xray);
  assert.ok(status.geomag);
  assert.equal(status.gpsDisruption, 'high');
  assert.equal(status.hfRadioBlackout, true);
  assert.equal(status.geomag.level, 'G3');
  assert.equal(status.geomag.auroraVisibilityLatN, 55);
  assert.equal(typeof status.asOf, 'string');
});
