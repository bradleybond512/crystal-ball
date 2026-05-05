import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TsunamiReasoner,
  DARTAnomalyDetector,
  DART_BUOY_IDS,
  parsePTWCAtom,
  parseDartTxt,
  locateSubductionZone,
  buildTsunamiStatusSnapshot,
  SUBDUCTION_ZONES,
} from '../tsunami-reasoner.ts';

// ── TsunamiReasoner.assessThreat ──────────────────────────────────────

test('threat: HIGH for M7.6 / 30 km / Sunda Trench', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 7.6, depthKm: 30, lat: -3, lon: 100 });
  assert.equal(r.level, 'high');
  assert.equal(r.isSubmarine, true);
  assert.equal(r.subductionZone, 'sunda-trench');
  assert.equal(r.cascadeRuleFired, true);
  assert.ok(r.reasons.some((x) => x.includes('high tsunami potential')));
});

test('threat: HIGH cascade does NOT fire when high event is outside known zones', () => {
  // Mid-Atlantic ridge area not in our subduction list — still HIGH from M+depth, but cascade is gated.
  const r = TsunamiReasoner.assessThreat({ magnitude: 7.8, depthKm: 25, lat: 5, lon: -30 });
  assert.equal(r.level, 'high');
  assert.equal(r.isSubmarine, false);
  assert.equal(r.cascadeRuleFired, false);
  assert.ok(r.reasons.some((x) => x.includes('cascade auto-advisory not fired')));
});

test('threat: MODERATE for M6.6 / 40 km / inland', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 6.6, depthKm: 40, lat: 35, lon: -100 });
  assert.equal(r.level, 'moderate');
  assert.equal(r.cascadeRuleFired, false);
});

test('threat: LOW for M6.0 submarine subduction', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 6.0, depthKm: 60, lat: -20, lon: -71 });
  assert.equal(r.level, 'low');
  assert.equal(r.isSubmarine, true);
  assert.equal(r.subductionZone, 'peru-chile');
});

test('threat: NONE for shallow M5.5', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 5.5, depthKm: 10, lat: 35, lon: 139 });
  assert.equal(r.level, 'none');
});

test('threat: deep M ≥ 7.5 in subduction zone falls to LOW (submarine fallback)', () => {
  // M7.6 at 200 km depth fails HIGH (depth > 70) and MODERATE (depth > 50),
  // but is still in a submarine subduction zone with M ≥ 6.0 → LOW.
  const r = TsunamiReasoner.assessThreat({ magnitude: 7.6, depthKm: 200, lat: -3, lon: 100 });
  assert.equal(r.level, 'low');
  assert.equal(r.isSubmarine, true);
});

test('threat: NONE when M ≥ 7.5 but depth > 70 km AND outside subduction zones', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 7.6, depthKm: 200, lat: 5, lon: -30 });
  assert.equal(r.level, 'none');
});

test('threat: NONE when M ≥ 6.5 but depth > 50 km (and below high threshold)', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 6.7, depthKm: 80, lat: 35, lon: -100 });
  assert.equal(r.level, 'none');
});

test('threat: magnitude null falls through to NONE with reason', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: null, depthKm: 10, lat: 0, lon: 0 });
  assert.equal(r.level, 'none');
  assert.ok(r.reasons.some((x) => x.includes('magnitude unknown')));
});

test('threat: depth null still meets HIGH (treated as shallow)', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 7.5, depthKm: null, lat: -5, lon: 105 });
  assert.equal(r.level, 'high');
});

test('threat: result is JSON-serializable', () => {
  const r = TsunamiReasoner.assessThreat({ magnitude: 7.0, depthKm: 30, lat: -3, lon: 100 });
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
});

// ── locateSubductionZone (antimeridian + Hellenic + non-zones) ─────────

test('subduction: Tonga-Kermadec straddles antimeridian (lon = 175 hits)', () => {
  assert.equal(locateSubductionZone(-25, 175).zone, 'tonga-kermadec');
});

test('subduction: Tonga-Kermadec straddles antimeridian (lon = -175 hits)', () => {
  assert.equal(locateSubductionZone(-25, -175).zone, 'tonga-kermadec');
});

test('subduction: Cascadia hit', () => {
  assert.equal(locateSubductionZone(45, -125).zone, 'cascadia');
});

test('subduction: middle of Atlantic is NOT a subduction zone', () => {
  assert.equal(locateSubductionZone(20, -40).hit, false);
});

test('subduction: NaN coordinates do not crash', () => {
  assert.equal(locateSubductionZone(Number.NaN, 0).hit, false);
});

test('subduction: zone list is non-empty + all coordinates finite', () => {
  assert.ok(SUBDUCTION_ZONES.length >= 10);
  for (const z of SUBDUCTION_ZONES) {
    assert.ok(Number.isFinite(z.minLat) && Number.isFinite(z.maxLat));
    assert.ok(Number.isFinite(z.minLon) && Number.isFinite(z.maxLon));
  }
});

// ── DARTAnomalyDetector ───────────────────────────────────────────────

test('DART: stable readings → no anomaly', () => {
  const readings = Array.from({ length: 10 }, (_, i) => ({
    buoyId: '46411',
    timestamp: 1_700_000_000_000 + i * 60_000,
    seaLevelMeters: 2942.0 + (i % 2 === 0 ? 0.005 : -0.005), // ±0.5 cm
  }));
  const r = DARTAnomalyDetector.analyze('46411', readings);
  assert.equal(r.anomalyDetected, false);
  assert.equal(r.sampleCount, 10);
});

test('DART: 5 cm jump on latest reading → anomaly', () => {
  const readings = Array.from({ length: 9 }, (_, i) => ({
    buoyId: '46411',
    timestamp: 1_700_000_000_000 + i * 60_000,
    seaLevelMeters: 2942.0,
  }));
  readings.push({ buoyId: '46411', timestamp: 1_700_000_000_000 + 9 * 60_000, seaLevelMeters: 2942.05 });
  const r = DARTAnomalyDetector.analyze('46411', readings);
  assert.equal(r.anomalyDetected, true);
  assert.ok(Math.abs(r.deviationCm - 5) < 1e-6);
  assert.ok(r.reason.includes('exceeds'));
});

test('DART: insufficient samples reports gracefully', () => {
  const r = DARTAnomalyDetector.analyze('46411', [
    { buoyId: '46411', timestamp: 1, seaLevelMeters: 2942.0 },
  ]);
  assert.equal(r.anomalyDetected, false);
  assert.equal(r.sampleCount, 1);
  assert.ok(r.reason.includes('insufficient'));
});

test('DART: only the most recent WINDOW=10 samples are used', () => {
  // 20 samples; first 10 are noisy at 2940, last 10 are stable at 2942.
  const readings = [
    ...Array.from({ length: 10 }, (_, i) => ({ buoyId: '46411', timestamp: i, seaLevelMeters: 2940.0 })),
    ...Array.from({ length: 10 }, (_, i) => ({ buoyId: '46411', timestamp: 100 + i, seaLevelMeters: 2942.0 })),
  ];
  const r = DARTAnomalyDetector.analyze('46411', readings);
  // Baseline = mean of last 9 of the stable batch = 2942; latest = 2942 → 0 cm deviation.
  assert.equal(r.anomalyDetected, false);
  assert.ok(Math.abs(r.deviationCm) < 1e-6);
});

test('DART: NaN-height readings are filtered out', () => {
  const readings = [
    ...Array.from({ length: 9 }, (_, i) => ({ buoyId: '46411', timestamp: i, seaLevelMeters: 2942.0 })),
    { buoyId: '46411', timestamp: 9, seaLevelMeters: Number.NaN },
    { buoyId: '46411', timestamp: 10, seaLevelMeters: 2942.04 }, // 4 cm
  ];
  const r = DARTAnomalyDetector.analyze('46411', readings);
  assert.equal(r.anomalyDetected, true);
  assert.equal(r.sampleCount, 10);
});

test('DART: there are exactly 10 supported buoys', () => {
  assert.equal(DART_BUOY_IDS.length, 10);
});

// ── parseDartTxt ──────────────────────────────────────────────────────

test('parseDartTxt: parses the documented header + data layout', () => {
  const body = [
    '#YY  MM DD hh mm ss T   HEIGHT',
    '#yr  mo dy hr mn  s -   m',
    '2026 05 05 17 00  0 1   2942.123',
    '2026 05 05 17 15  0 1   2942.130',
    '',
    '2026 05 05 17 30  0 1   2942.127',
  ].join('\n');
  const r = parseDartTxt('46411', body);
  assert.equal(r.length, 3);
  assert.equal(r[0].seaLevelMeters, 2942.123);
  assert.equal(r[2].seaLevelMeters, 2942.127);
  assert.ok(r[0].timestamp < r[1].timestamp && r[1].timestamp < r[2].timestamp);
});

test('parseDartTxt: malformed rows are skipped, not thrown', () => {
  const body = [
    '#YY  MM DD hh mm ss T   HEIGHT',
    'not a row',
    '2026 05 05 17 00  0 1   2942.0',
    '2026 zz 05 17 00  0 1   2942.0',
  ].join('\n');
  const r = parseDartTxt('46411', body);
  assert.equal(r.length, 1);
});

// ── parsePTWCAtom ─────────────────────────────────────────────────────

test('parsePTWCAtom: parses entries with CDATA + nested HTML', () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>PTWC Atom</title>
  <entry>
    <id>urn:ptwc:1</id>
    <title type="html"><![CDATA[<b>Tsunami Information Statement</b>]]></title>
    <summary><![CDATA[NO TSUNAMI THREAT.]]></summary>
    <updated>2026-05-05T18:00:00Z</updated>
    <published>2026-05-05T17:55:00Z</published>
    <link href="https://www.tsunami.gov/events/1" />
  </entry>
  <entry>
    <id>urn:ptwc:2</id>
    <title>Tsunami Warning</title>
    <summary>Hazardous tsunami waves possible.</summary>
    <updated>2026-05-05T18:30:00Z</updated>
  </entry>
</feed>`;
  const out = parsePTWCAtom(xml);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'urn:ptwc:1');
  assert.equal(out[0].title, 'Tsunami Information Statement');
  assert.equal(out[0].summary, 'NO TSUNAMI THREAT.');
  assert.equal(out[0].link, 'https://www.tsunami.gov/events/1');
  assert.ok(out[0].publishedAt && out[0].updatedAt);
  assert.equal(out[1].link, null);
  assert.equal(out[1].publishedAt, null);
});

test('parsePTWCAtom: empty feed returns empty array', () => {
  assert.deepEqual(parsePTWCAtom('<feed></feed>'), []);
});

test('parsePTWCAtom: entries without an id are dropped', () => {
  const xml = `<feed><entry><title>x</title></entry></feed>`;
  assert.deepEqual(parsePTWCAtom(xml), []);
});

// ── buildTsunamiStatusSnapshot ────────────────────────────────────────

test('snapshot: anyDartAnomaly + hasActiveBulletin reflect inputs', () => {
  const snap = buildTsunamiStatusSnapshot({
    fetchedAt: 1_700_000_000_000,
    ptwcBulletins: [
      { id: 'a', title: 't', summary: 's', publishedAt: null, updatedAt: null, link: null },
    ],
    dartAnomalies: [
      {
        buoyId: '46411',
        anomalyDetected: false,
        deviationCm: 0.5,
        baselineMeters: 2942,
        latestMeters: 2942.005,
        sampleCount: 10,
        reason: 'within',
      },
      {
        buoyId: '46412',
        anomalyDetected: true,
        deviationCm: 4,
        baselineMeters: 2942,
        latestMeters: 2942.04,
        sampleCount: 10,
        reason: 'exceeds',
      },
    ],
  });
  assert.equal(snap.anyDartAnomaly, true);
  assert.equal(snap.hasActiveBulletin, true);
  assert.equal(snap.dartAnomalies.length, 2);
});

test('snapshot: empty inputs produce a valid snapshot', () => {
  const snap = buildTsunamiStatusSnapshot({
    fetchedAt: 1_700_000_000_000,
    ptwcBulletins: [],
    dartAnomalies: [],
  });
  assert.equal(snap.anyDartAnomaly, false);
  assert.equal(snap.hasActiveBulletin, false);
});
