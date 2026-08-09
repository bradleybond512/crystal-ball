import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auroraVisibilityLatitude,
  buildStatus,
  classifyGpsDisruption,
  classifyXrayFlux,
  filterEarthwardCmes,
  kpToStormLevel,
  summarizeAlerts,
  xrayLabel,
} from '../swpc-monitor.ts';
import type {
  DonkiCmeRaw,
  KpIndexPoint,
  MonitorInput,
  SwpcAlertRaw,
  SwpcAlertSeverity,
  XrayFluxPoint,
} from '../swpc-monitor.ts';

const NOW = Date.parse('2026-05-06T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

function isoMinus(hours: number, baseMs = NOW): string {
  return new Date(baseMs - hours * HOUR_MS).toISOString();
}

function emptyInput(over: Partial<MonitorInput> = {}): MonitorInput {
  return { xrayFlux: [], kpIndex: [], alerts: [], cmes: [], now: NOW, ...over };
}

// ── X-ray classification ───────────────────────────────────────────────────

test('classifyXrayFlux thresholds A/B/C/M/X', () => {
  assert.equal(classifyXrayFlux(5e-9), 'A');
  assert.equal(classifyXrayFlux(5e-8), 'A');
  assert.equal(classifyXrayFlux(1e-7), 'B');
  assert.equal(classifyXrayFlux(5e-7), 'B');
  assert.equal(classifyXrayFlux(1e-6), 'C');
  assert.equal(classifyXrayFlux(4e-6), 'C');
  assert.equal(classifyXrayFlux(1e-5), 'M');
  assert.equal(classifyXrayFlux(4.2e-5), 'M');
  assert.equal(classifyXrayFlux(1e-4), 'X');
  assert.equal(classifyXrayFlux(2e-3), 'X');
});

test('classifyXrayFlux is defensive for invalid inputs', () => {
  assert.equal(classifyXrayFlux(0), 'A');
  assert.equal(classifyXrayFlux(-1), 'A');
  assert.equal(classifyXrayFlux(Number.NaN), 'A');
});

test('xrayLabel formats class + mantissa', () => {
  assert.equal(xrayLabel(4.2e-5), 'M4.2');
  assert.equal(xrayLabel(1.0e-4), 'X1.0');
  assert.equal(xrayLabel(2.5e-4), 'X2.5');
  assert.equal(xrayLabel(7.3e-7), 'B7.3');
  assert.equal(xrayLabel(3.1e-6), 'C3.1');
});

test('xrayLabel clamps extreme X-class peaks', () => {
  // 1e-2 W/m² → X100 — clamp at X99 for label width.
  assert.equal(xrayLabel(1e-2), 'X99.0');
});

// ── Kp / aurora ────────────────────────────────────────────────────────────

test('kpToStormLevel uses spec-mandated G0..G5 thresholds', () => {
  assert.equal(kpToStormLevel(0), 'G0');
  assert.equal(kpToStormLevel(4.99), 'G0');
  assert.equal(kpToStormLevel(5), 'G1');
  assert.equal(kpToStormLevel(6), 'G2');
  assert.equal(kpToStormLevel(7), 'G3');
  assert.equal(kpToStormLevel(8), 'G4');
  assert.equal(kpToStormLevel(9), 'G5');
});

test('auroraVisibilityLatitude matches the spec anchors', () => {
  assert.equal(auroraVisibilityLatitude(4), 90);
  assert.equal(auroraVisibilityLatitude(5), 60);
  assert.equal(auroraVisibilityLatitude(7), 55);
  assert.equal(auroraVisibilityLatitude(9), 45);
});

test('auroraVisibilityLatitude interpolates linearly between anchors', () => {
  // Between Kp7 (55°N) and Kp8 (50°N), Kp7.5 → 52.5°N (rounded to 0.5°).
  assert.equal(auroraVisibilityLatitude(7.5), 52.5);
  // Above Kp9 → clamped at 45°N.
  assert.equal(auroraVisibilityLatitude(10), 45);
});

// ── GPS / HF ───────────────────────────────────────────────────────────────

test('classifyGpsDisruption maps flare class to risk band', () => {
  assert.equal(classifyGpsDisruption('X'), 'high');
  assert.equal(classifyGpsDisruption('M'), 'moderate');
  assert.equal(classifyGpsDisruption('C'), 'low');
  assert.equal(classifyGpsDisruption('B'), 'none');
  assert.equal(classifyGpsDisruption('A'), 'none');
  assert.equal(classifyGpsDisruption(null), 'none');
});

// ── CME filtering ──────────────────────────────────────────────────────────

test('filterEarthwardCmes keeps CMEs with longitude within 30° of disk centre', () => {
  const earthward: DonkiCmeRaw = {
    activityID: 'cme-eward',
    startTime: isoMinus(2),
    cmeAnalyses: [{ longitude: 12, latitude: 5, halfAngle: 40, speed: 920,
      time21_5: isoMinus(-30), isMostAccurate: true }],
    link: 'https://example/test',
  };
  const offEarth: DonkiCmeRaw = {
    activityID: 'cme-off',
    startTime: isoMinus(3),
    cmeAnalyses: [{ longitude: 110, latitude: 0, halfAngle: 30, speed: 700,
      time21_5: isoMinus(-40), isMostAccurate: true }],
  };
  const filtered = filterEarthwardCmes([earthward, offEarth], NOW);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, 'cme-eward');
  assert.equal(filtered[0]?.speedKmS, 920);
  assert.equal(filtered[0]?.isMostAccurate, true);
});

test('filterEarthwardCmes prefers the most-accurate analysis when present', () => {
  const cme: DonkiCmeRaw = {
    activityID: 'cme-multi',
    startTime: isoMinus(4),
    cmeAnalyses: [
      { longitude: 60, halfAngle: 30, speed: 500, isMostAccurate: false, time21_5: isoMinus(-20) },
      { longitude: 8, halfAngle: 40, speed: 1100, isMostAccurate: true, time21_5: isoMinus(-25) },
    ],
  };
  const filtered = filterEarthwardCmes([cme], NOW);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.speedKmS, 1100);
});

test('filterEarthwardCmes drops CMEs whose modeled arrival is in the past >12h', () => {
  const stale: DonkiCmeRaw = {
    activityID: 'cme-old',
    startTime: isoMinus(72),
    cmeAnalyses: [{ longitude: 5, halfAngle: 40, speed: 900,
      time21_5: isoMinus(36), isMostAccurate: true }],
  };
  const filtered = filterEarthwardCmes([stale], NOW);
  assert.equal(filtered.length, 0);
});

// ── Alerts ─────────────────────────────────────────────────────────────────

test('summarizeAlerts classifies ALERT/WARNING/WATCH/summary by headline', () => {
  const raw: SwpcAlertRaw[] = [
    { product_id: 'K07',  message: 'ALERT: Geomagnetic K-index of 7\nDetails…',  issue_datetime: isoMinus(2) },
    { product_id: 'K05',  message: 'WATCH: G2 (Moderate) Geomagnetic Storm',     issue_datetime: isoMinus(3) },
    { product_id: 'X1A',  message: 'WARNING: X-ray flare M5+ likely',            issue_datetime: isoMinus(4) },
    { product_id: 'OUT',  message: 'Daily report — no significant activity',     issue_datetime: isoMinus(50) },
  ];
  const summarized = summarizeAlerts(raw, NOW);
  assert.equal(summarized.length, 3);
  const sevs = summarized.map((a) => a.severity);
  assert.deepEqual(sevs, ['alert', 'watch', 'warning']);
});

// Mirrors the sidecar assertions in
// src-tauri/sidecar/__tests__/spaceweather-parity.test.mjs — these two must
// agree, since the sidecar serves /api/spaceweather/alerts and this module is
// the canonical definition of what that route is supposed to produce.
const swpcMessage = (body: string): string =>
  `Space Weather Message Code: ALTK07\r\nSerial Number: 366\r\nIssue Time: 2026 May 06 1000 UTC\r\n\r\n${body}\r\n`;

test('summarizeAlerts reads past the SWPC message-code preamble', () => {
  const raw: SwpcAlertRaw[] = [
    { product_id: 'K07', message: swpcMessage('ALERT: Geomagnetic K-index of 7\r\nThreshold Reached: 2026 May 06 0958 UTC'), issue_datetime: isoMinus(2) },
  ];
  const [a] = summarizeAlerts(raw, NOW);
  assert.equal(a.severity, 'alert');
  assert.equal(a.headline, 'ALERT: Geomagnetic K-index of 7');
});

// The eight keyword forms enumerated from a live 30-day products/alerts.json.
// CANCEL_* are stand-downs; CONTINUED ALERT is still active.
test('summarizeAlerts maps every keyword SWPC actually emits', () => {
  const cases: [string, SwpcAlertSeverity][] = [
    ['CANCEL WARNING: Geomagnetic K-index of 4',                    'summary'],
    ['CANCEL ALERT: Proton Event 100MeV Integral Flux exceeded 1pfu', 'summary'],
    ['CONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu', 'alert'],
    ['EXTENDED WARNING: Geomagnetic K-index of 5',                  'warning'],
    ['WARNING: Geomagnetic K-index of 5 expected',                  'warning'],
    ['ALERT: Geomagnetic K-index of 7',                             'alert'],
    ['WATCH: Geomagnetic Storm Category G3 Predicted',              'watch'],
    ['SUMMARY: X-ray Event exceeded M5',                            'summary'],
  ];
  for (const [body, expected] of cases) {
    const [a] = summarizeAlerts(
      [{ product_id: 'P', message: swpcMessage(body), issue_datetime: isoMinus(1) }], NOW);
    assert.equal(a.severity, expected, body);
    assert.equal(a.headline, body);
  }
});

test('summarizeAlerts keeps recent alerts stamped with naïve-UTC issue times', () => {
  const raw: SwpcAlertRaw[] = [
    { product_id: 'K07', message: swpcMessage('ALERT: Geomagnetic K-index of 7'), issue_datetime: '2026-05-06 10:00:00.000' },
  ];
  const a = summarizeAlerts(raw, NOW);
  assert.equal(a.length, 1);
  // Asserted on the STAMPED string, not on Date.parse of it: comparing parsed
  // instants would agree with the buggy output on a UTC runner and only fail
  // off-UTC, so the regression could land green in CI.
  assert.equal(a[0].issuedAt, '2026-05-06T10:00:00.000Z');
});

// parseAlerts tolerates 5 minutes of clock skew. This path and that one feed
// the same panel, so an alert must not exist in one and not the other.
test('summarizeAlerts tolerates the same clock skew as parseAlerts', () => {
  const at = (offsetMin: number) =>
    new Date(NOW + offsetMin * 60_000).toISOString().replace('T', ' ').replace('Z', '');
  const build = (offsetMin: number): SwpcAlertRaw[] => [
    { product_id: 'K07', message: swpcMessage('ALERT: Geomagnetic K-index of 7'), issue_datetime: at(offsetMin) },
  ];

  assert.equal(summarizeAlerts(build(2), NOW).length, 1, '+2 min is skew');
  assert.equal(summarizeAlerts(build(-1), NOW).length, 1, 'the past is always fine');
  assert.equal(summarizeAlerts(build(180), NOW).length, 0, '+3 h is corrupt');
});

// ── Full status ────────────────────────────────────────────────────────────

test('buildStatus returns null xray/geomag for empty inputs but stable shape', () => {
  const status = buildStatus(emptyInput());
  assert.equal(status.xray, null);
  assert.equal(status.geomag, null);
  assert.equal(status.gpsDisruption, 'none');
  assert.equal(status.hfRadioBlackout, false);
  assert.deepEqual(status.earthwardCmes, []);
  assert.equal(typeof status.asOf, 'string');
});

test('buildStatus flags HF blackout + high GPS risk on X-class', () => {
  const xrayFlux: XrayFluxPoint[] = [
    { time_tag: isoMinus(0.5), flux: 1.5e-4, energy: '0.1-0.8nm' },
    { time_tag: isoMinus(0.3), flux: 9e-5,    energy: '0.1-0.8nm' },
    { time_tag: isoMinus(0.1), flux: 4e-5,    energy: '0.1-0.8nm' },
  ];
  const status = buildStatus(emptyInput({ xrayFlux }));
  assert.ok(status.xray);
  assert.equal(status.xray?.peakClass, 'X');
  assert.equal(status.xray?.peakLabel, 'X1.5');
  assert.equal(status.xray?.xClassActive, true);
  assert.equal(status.gpsDisruption, 'high');
  assert.equal(status.hfRadioBlackout, true);
});

test('buildStatus reports geomag level + aurora latitude from latest Kp', () => {
  const kpIndex: KpIndexPoint[] = [
    { time_tag: isoMinus(20), kp: 4 },
    { time_tag: isoMinus(8),  kp: 6 },
    { time_tag: isoMinus(2),  kp: 7 },
  ];
  const status = buildStatus(emptyInput({ kpIndex }));
  assert.ok(status.geomag);
  assert.equal(status.geomag?.kp, 7);
  assert.equal(status.geomag?.level, 'G3');
  assert.equal(status.geomag?.auroraVisibilityLatN, 55);
  assert.equal(status.geomag?.kpMax24h, 7);
});

test('buildStatus skips X-ray and Kp samples outside the configured windows', () => {
  // 12h ago is outside the 6h X-ray window but inside the 24h Kp window.
  const xrayFlux: XrayFluxPoint[] = [
    { time_tag: isoMinus(12), flux: 5e-4 },
  ];
  const kpIndex: KpIndexPoint[] = [
    { time_tag: isoMinus(12), kp: 6 },
  ];
  const status = buildStatus(emptyInput({ xrayFlux, kpIndex }));
  assert.equal(status.xray, null);
  assert.ok(status.geomag);
});

test('buildStatus C-class flare → low GPS risk, no HF blackout', () => {
  const xrayFlux: XrayFluxPoint[] = [
    { time_tag: isoMinus(1), flux: 3e-6 },
  ];
  const status = buildStatus(emptyInput({ xrayFlux }));
  assert.equal(status.gpsDisruption, 'low');
  assert.equal(status.hfRadioBlackout, false);
});
