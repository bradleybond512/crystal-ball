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
  buildDonkiCmeUrlSidecar,
  donkiCmeFeedHealthySidecar,
  SPACEWX_CME_LOOKBACK_DAYS,
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

// Real SWPC messages open with a product-code preamble, so the severity keyword
// is never on line 0. Reading line 0 classified all 117 live alerts as
// `summary` and surfaced "Space Weather Message Code: ALTK07" as the headline.
const swpcMessage = (body) =>
  `Space Weather Message Code: ALTK07\r\nSerial Number: 366\r\nIssue Time: 2026 May 06 1000 UTC\r\n\r\n${body}\r\n`;

test('summarizeAlertsSidecar reads past the SWPC message-code preamble', () => {
  const raw = [
    { product_id: 'K07', message: swpcMessage('ALERT: Geomagnetic K-index of 7\r\nThreshold Reached: 2026 May 06 0958 UTC'), issue_datetime: isoMinus(2) },
  ];
  const [a] = summarizeAlertsSidecar(raw, NOW);
  assert.equal(a.severity, 'alert');
  assert.equal(a.headline, 'ALERT: Geomagnetic K-index of 7');
});

// The eight keyword forms enumerated from a live 30-day products/alerts.json.
// CANCEL_* are stand-downs; CONTINUED ALERT is still active.
test('summarizeAlertsSidecar maps every keyword SWPC actually emits', () => {
  const cases = [
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
    const [a] = summarizeAlertsSidecar(
      [{ product_id: 'P', message: swpcMessage(body), issue_datetime: isoMinus(1) }], NOW);
    assert.equal(a.severity, expected, body);
    assert.equal(a.headline, body);
  }
});

test('summarizeAlertsSidecar keeps recent alerts stamped with naïve-UTC issue times', () => {
  // "2026-05-06 10:00:00.000" — space-separated, no zone. Parsed as host-local
  // on a UTC-negative host this lands AFTER `now` and the `t > now` guard drops
  // it, silently hiding the newest alerts on exactly the machines that need them.
  const raw = [
    { product_id: 'K07', message: swpcMessage('ALERT: Geomagnetic K-index of 7'), issue_datetime: '2026-05-06 10:00:00.000' },
  ];
  const a = summarizeAlertsSidecar(raw, NOW);
  assert.equal(a.length, 1);
  // Asserted on the STAMPED string, not on Date.parse of it: comparing parsed
  // instants would agree with the buggy output on a UTC runner and only fail
  // off-UTC, so the regression could land green in CI.
  assert.equal(a[0].issuedAt, '2026-05-06T10:00:00.000Z');
});

// parseAlerts in src/services/space-weather-parse.ts tolerates 5 minutes of
// clock skew. Both paths feed the same panel, so an alert must not be visible
// through one and absent through the other.
test('summarizeAlertsSidecar tolerates the same clock skew as the renderer', () => {
  const at = (offsetMin) => new Date(NOW + offsetMin * 60_000).toISOString().replace('T', ' ').replace('Z', '');
  const build = (offsetMin) => [{
    product_id: 'K07',
    message: swpcMessage('ALERT: Geomagnetic K-index of 7'),
    issue_datetime: at(offsetMin),
  }];

  // A local clock a couple of minutes slow must not drop the newest alerts —
  // the exact silent-drop this whole change set exists to prevent.
  assert.equal(summarizeAlertsSidecar(build(2), NOW).length, 1, '+2 min is skew');
  assert.equal(summarizeAlertsSidecar(build(-1), NOW).length, 1, 'the past is always fine');
  // Far-future stamps are corrupt: they sort to the top and render "in 3 hours".
  assert.equal(summarizeAlertsSidecar(build(180), NOW).length, 0, '+3 h is corrupt');
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

test('buildDonkiCmeUrlSidecar targets the live DONKI web service, not the dead SWPC mirror', () => {
  // services.swpc.noaa.gov/json/donki/cme.json is a hard 404. fetchJsonSidecar
  // turns that into null, and a null CME list renders as a confident "no
  // Earthward CMEs" — an outage that looks exactly like good news.
  const url = buildDonkiCmeUrlSidecar(NOW);
  assert.ok(!url.includes('services.swpc.noaa.gov'), 'the SWPC mirror no longer exists');
  assert.ok(url.startsWith('https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/CME?'));
  // Keyless by design: the api.nasa.gov mirror of this same service would put
  // the CME list behind DEMO_KEY's shared 30-req/hour IP quota.
  assert.ok(!/api_key/.test(url), 'must not require a NASA key');
});

test('buildDonkiCmeUrlSidecar spans slow CMEs still in transit', () => {
  // A slow CME takes ~4 days to arrive and stays listed for 12h after that, so
  // a window shorter than the transit time would drop the event mid-flight —
  // precisely while it is the one worth showing.
  const url = buildDonkiCmeUrlSidecar(NOW);
  const start = new URL(url).searchParams.get('startDate');
  const end = new URL(url).searchParams.get('endDate');
  assert.equal(start, '2026-04-29');
  assert.ok(SPACEWX_CME_LOOKBACK_DAYS >= 5, 'must outlast the slowest transit');
  // endDate is inclusive by date; reaching a day past "now" keeps today's
  // events from falling off the end on a host running behind UTC.
  assert.equal(end, '2026-05-07');
  assert.ok(Date.parse(end) > NOW);
});

test('buildSpaceweatherStatusSidecar distinguishes "no CMEs" from "no CME feed"', () => {
  // Repointing the dead URL fixed the 404 but not the failure MODE:
  // fetchJsonSidecar turns any non-200 or throw into null, and an empty CME
  // list renders as a confident "no Earthward CMEs". Both cases carry
  // earthwardCmes: [] — only this flag tells them apart.
  const base = { xrayFlux: [], kpIndex: [], now: NOW };
  assert.equal(buildSpaceweatherStatusSidecar({ ...base, cmes: [], cmeFeedOk: true }).cmeFeedOk, true);
  const down = buildSpaceweatherStatusSidecar({ ...base, cmes: [], cmeFeedOk: false });
  assert.equal(down.cmeFeedOk, false);
  assert.deepEqual(down.earthwardCmes, [], 'still empty — the flag is the only signal');
  // An omitted flag is NOT healthy. Defaulting it to true is the same fail-open
  // one level up: a caller that forgets to pass it gets the reassuring answer.
  assert.equal(buildSpaceweatherStatusSidecar({ ...base, cmes: [] }).cmeFeedOk, false);
});

test('donkiCmeFeedHealthySidecar keeps an empty week healthy but catches schema drift', () => {
  // The distinction that matters: a 200 with a well-formed array is not the
  // same as a 200 we can read. If DONKI renames its fields, every row falls out
  // of the filter and the section renders as "nothing Earthward" — the outage
  // wearing the all-clear's clothes one level deeper than the 404 did.
  const good = { activityID: '2026-08-01T00:00:00-CME-001', cmeAnalyses: [{ longitude: 5 }] };
  assert.equal(donkiCmeFeedHealthySidecar([]), true, 'a quiet week is not drift');
  assert.equal(donkiCmeFeedHealthySidecar([good]), true);
  // A window of exclusively UNANALYZED CMEs reads as unhealthy, and that is
  // the honest answer rather than a false alarm: with no analysis there is no
  // longitude, so Earthward status is genuinely undeterminable from it. Rare
  // over seven days, and "unknown" is the correct direction to fail.
  assert.equal(
    donkiCmeFeedHealthySidecar([{ activityID: 'unanalyzed', cmeAnalyses: [] }]),
    false,
  );
  // Drift hides at every level, so the check goes all the way down to the field
  // the filter actually reads. An analyses array full of objects that have lost
  // `longitude` produces exactly the same empty-and-healthy result as a rename
  // one level up would have.
  assert.equal(donkiCmeFeedHealthySidecar([{ activityID: 'a', cmeAnalyses: [{}] }]), false);
  assert.equal(
    donkiCmeFeedHealthySidecar([{ activityID: 'a', cmeAnalyses: [{ lon: 5 }] }]),
    false,
    'a renamed longitude is drift, not a quiet sun',
  );
  // Container is right, contents are unrecognizable.
  assert.equal(donkiCmeFeedHealthySidecar([{ id: 'renamed' }, { id: 'also-renamed' }]), false);
  assert.equal(donkiCmeFeedHealthySidecar([null, 42, 'nope']), false);
  // PARTIAL drift is the likely kind, and the one that hides best: the identity
  // field survives while the field the filter reads is renamed away, so every
  // row silently falls out and the section renders as "nothing Earthward".
  assert.equal(donkiCmeFeedHealthySidecar([{ activityID: 'a' }, { activityID: 'b' }]), false);
  assert.equal(donkiCmeFeedHealthySidecar([{ activityID: 'a', analyses: [{}] }]), false);
  // Every field must be on the SAME row — one each across two rows is drift.
  assert.equal(
    donkiCmeFeedHealthySidecar([{ activityID: 'a' }, { cmeAnalyses: [{ longitude: 1 }] }]),
    false,
  );
  // One good row is enough — DONKI legitimately mixes in sparse records.
  assert.equal(donkiCmeFeedHealthySidecar([{ id: 'x' }, good]), true);
  // Not an array at all is the fetch having failed.
  assert.equal(donkiCmeFeedHealthySidecar(null), false);
  assert.equal(donkiCmeFeedHealthySidecar({ result: [] }), false);
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
