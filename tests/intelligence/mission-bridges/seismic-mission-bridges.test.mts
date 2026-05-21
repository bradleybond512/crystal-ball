import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AfterShockMissionBridge,
  SeismicMissionBridge,
  TsunamiMissionBridge,
  integerToRoman,
  magnitudeRank,
  mmiRank,
  mmiToInteger,
  rankToSeverity,
  ruptureRadiusKm,
  tsunamiLevelRank,
  type RawShakeAlertEEW,
  type RawTsunamiAlert,
  type RawUsgsQuake,
} from '../../../src/services/intelligence/mission-bridges/seismic-mission-bridges.ts';
import type { MissionBridgeOptions } from '../../../src/services/intelligence/mission-bridge-core.ts';
import type { ObservationEvent } from '../../../src/types/intelligence.ts';

// ── Test infra ────────────────────────────────────────────────────────────

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

function noopStorage(): MissionBridgeOptions {
  return { storage: new MemoryStorage(), now: () => 1_700_000_000_000 };
}

function quake(over: Partial<RawUsgsQuake> = {}): RawUsgsQuake {
  return {
    id: over.id ?? 'us7000abcd',
    magnitude: over.magnitude ?? 6.2,
    place: over.place ?? 'offshore Honshu, Japan',
    timestamp: over.timestamp ?? 1_700_000_000_000,
    lat: over.lat ?? 38.3,
    lon: over.lon ?? 142.4,
    ...(over.depthKm !== undefined ? { depthKm: over.depthKm } : {}),
  };
}

function tsunamiAlert(over: Partial<RawTsunamiAlert> = {}): RawTsunamiAlert {
  return {
    id: over.id ?? 'ptwc-2026-001',
    level: over.level ?? 'Warning',
    region: over.region ?? 'Pacific Coast',
    issuedAt: over.issuedAt ?? 1_700_000_000_000,
    ...(over.lat !== undefined ? { lat: over.lat } : {}),
    ...(over.lon !== undefined ? { lon: over.lon } : {}),
    ...(over.sourceEventId !== undefined ? { sourceEventId: over.sourceEventId } : {}),
  };
}

function eew(over: Partial<RawShakeAlertEEW> = {}): RawShakeAlertEEW {
  return {
    id: over.id ?? 'eew-2026-9001',
    mmi: over.mmi ?? 'V',
    issuedAt: over.issuedAt ?? 1_700_000_000_000,
    lat: over.lat ?? 37.77,
    lon: over.lon ?? -122.42,
    ...(over.magnitude !== undefined ? { magnitude: over.magnitude } : {}),
    ...(over.warningSeconds !== undefined ? { warningSeconds: over.warningSeconds } : {}),
  };
}

// ── magnitudeRank ─────────────────────────────────────────────────────────

test('magnitudeRank: M7+ maps to 4 (CRITICAL)', () => {
  assert.equal(magnitudeRank(7.0), 4);
  assert.equal(magnitudeRank(8.1), 4);
});

test('magnitudeRank: M6–7 maps to 3 (HIGH)', () => {
  assert.equal(magnitudeRank(6.0), 3);
  assert.equal(magnitudeRank(6.9), 3);
});

test('magnitudeRank: M5–6 maps to 2 (MEDIUM)', () => {
  assert.equal(magnitudeRank(5.0), 2);
  assert.equal(magnitudeRank(5.9), 2);
});

test('magnitudeRank: sub-M5 (and NaN / negative) all map to 1 (LOW)', () => {
  assert.equal(magnitudeRank(4.9), 1);
  assert.equal(magnitudeRank(0), 1);
  assert.equal(magnitudeRank(-1), 1);
  assert.equal(magnitudeRank(Number.NaN), 1);
});

// ── tsunamiLevelRank ──────────────────────────────────────────────────────

test('tsunamiLevelRank: official ladder Warning > Watch > Advisory > Information', () => {
  assert.equal(tsunamiLevelRank('Warning'), 4);
  assert.equal(tsunamiLevelRank('Watch'), 3);
  assert.equal(tsunamiLevelRank('Advisory'), 2);
  assert.equal(tsunamiLevelRank('Information'), 1);
});

test('tsunamiLevelRank: matches case-insensitively and trims whitespace', () => {
  assert.equal(tsunamiLevelRank('  WATCH  '), 3);
  assert.equal(tsunamiLevelRank('advisory'), 2);
});

test('tsunamiLevelRank: unknown levels and non-strings fall back to 1', () => {
  assert.equal(tsunamiLevelRank('Catastrophe'), 1);
  assert.equal(tsunamiLevelRank(''), 1);
  assert.equal(tsunamiLevelRank(null), 1);
  assert.equal(tsunamiLevelRank(undefined), 1);
});

// ── mmiToInteger / mmiRank ────────────────────────────────────────────────

test('mmiToInteger: Roman numerals I..XII map to 1..12', () => {
  assert.equal(mmiToInteger('I'), 1);
  assert.equal(mmiToInteger('IV'), 4);
  assert.equal(mmiToInteger('VII'), 7);
  assert.equal(mmiToInteger('XII'), 12);
});

test('mmiToInteger: plain integers and numeric strings pass through', () => {
  assert.equal(mmiToInteger(7), 7);
  assert.equal(mmiToInteger('5'), 5);
  assert.equal(mmiToInteger('5.8'), 5); // floor
});

test('mmiToInteger: garbage / empty / null returns null', () => {
  assert.equal(mmiToInteger(''), null);
  assert.equal(mmiToInteger('XX'), null);
  assert.equal(mmiToInteger(null), null);
  assert.equal(mmiToInteger(undefined), null);
});

test('mmiRank: MMI VII+ → 4 (CRITICAL)', () => {
  assert.equal(mmiRank('VII'), 4);
  assert.equal(mmiRank('IX'), 4);
  assert.equal(mmiRank(8), 4);
});

test('mmiRank: MMI V–VI → 3 (HIGH); MMI III–IV → 2 (MEDIUM)', () => {
  assert.equal(mmiRank('V'), 3);
  assert.equal(mmiRank('VI'), 3);
  assert.equal(mmiRank('III'), 2);
  assert.equal(mmiRank('IV'), 2);
});

test('mmiRank: MMI I–II and unknown → 1 (LOW)', () => {
  assert.equal(mmiRank('I'), 1);
  assert.equal(mmiRank('II'), 1);
  assert.equal(mmiRank('garbage'), 1);
  assert.equal(mmiRank(null), 1);
});

// ── rankToSeverity / formatting helpers ───────────────────────────────────

test('rankToSeverity: 1→LOW, 2→MEDIUM, 3→HIGH, 4→CRITICAL', () => {
  assert.equal(rankToSeverity(1), 'LOW');
  assert.equal(rankToSeverity(2), 'MEDIUM');
  assert.equal(rankToSeverity(3), 'HIGH');
  assert.equal(rankToSeverity(4), 'CRITICAL');
});

test('integerToRoman: matches MMI table, clamps high inputs, returns "-" for negatives', () => {
  assert.equal(integerToRoman(7), 'VII');
  assert.equal(integerToRoman(12), 'XII');
  assert.equal(integerToRoman(0), '-');
  assert.equal(integerToRoman(-3), '-');
});

test('ruptureRadiusKm: doubles per magnitude unit and floors at 1', () => {
  assert.equal(ruptureRadiusKm(2), 1);     // 2^0 = 1
  assert.equal(ruptureRadiusKm(4), 4);     // 2^2 = 4
  assert.equal(ruptureRadiusKm(7), 32);    // 2^5 = 32
  assert.equal(ruptureRadiusKm(-5), 0);
});

// ── SeismicMissionBridge ──────────────────────────────────────────────────

test('SeismicMissionBridge: domain="seismic" and feedId="usgs-earthquake"', () => {
  const b = new SeismicMissionBridge(noopStorage());
  const cfg = b.getConfig();
  assert.equal(cfg.domain, 'seismic');
  assert.equal(cfg.feedId, 'usgs-earthquake');
});

test('SeismicMissionBridge: normalize maps M7+ to CRITICAL and stamps tags', () => {
  const b = new SeismicMissionBridge(noopStorage());
  const evt = b.normalize(quake({ magnitude: 7.2, depthKm: 30 })) as ObservationEvent;
  assert.ok(evt);
  assert.equal(evt.severity, 'CRITICAL');
  assert.equal(evt.id, 'usgs-earthquake:us7000abcd');
  assert.equal(evt.sourceId, 'usgs-earthquake');
  assert.match(evt.title, /M7\.2 earthquake near offshore Honshu/);
  assert.ok(evt.tags.includes('earthquake'));
  assert.ok(evt.tags.includes('rank-4'));
  assert.ok(evt.tags.includes('severity-critical'));
  assert.ok(evt.tags.includes('depth-30km'));
  assert.deepEqual(
    { lat: evt.location?.lat, lon: evt.location?.lon },
    { lat: 38.3, lon: 142.4 },
  );
});

test('SeismicMissionBridge: M6 maps to HIGH; M5 maps to MEDIUM', () => {
  const b = new SeismicMissionBridge(noopStorage());
  assert.equal(b.normalize(quake({ magnitude: 6 }))?.severity, 'HIGH');
  assert.equal(b.normalize(quake({ magnitude: 5 }))?.severity, 'MEDIUM');
});

test('SeismicMissionBridge: drops M<5 events (returns null)', () => {
  const b = new SeismicMissionBridge(noopStorage());
  assert.equal(b.normalize(quake({ magnitude: 4.9 })), null);
  assert.equal(b.normalize(quake({ magnitude: 2.5 })), null);
});

test('SeismicMissionBridge: rejects malformed payloads (missing id / NaN mag / wrong types)', () => {
  const b = new SeismicMissionBridge(noopStorage());
  assert.equal(b.normalize(null), null);
  assert.equal(b.normalize({ ...quake(), id: '' }), null);
  assert.equal(b.normalize({ ...quake(), magnitude: Number.NaN }), null);
  assert.equal(b.normalize({ ...quake(), lat: 'oops' }), null);
});

test('SeismicMissionBridge: missing depth tags "depth-unknown"', () => {
  const b = new SeismicMissionBridge(noopStorage());
  const evt = b.normalize(quake({ magnitude: 6.5 })) as ObservationEvent;
  assert.ok(evt.tags.includes('depth-unknown'));
});

test('SeismicMissionBridge: processCycle integrates fetcher + filter + cap', async () => {
  const b = new SeismicMissionBridge({
    ...noopStorage(),
    fetcher: () => Promise.resolve([
      quake({ id: 'a', magnitude: 7.4 }),
      quake({ id: 'b', magnitude: 4.0 }),         // dropped (below M5)
      quake({ id: 'c', magnitude: 5.5 }),
    ]),
  });
  const events = await b.processCycle();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.severity), ['CRITICAL', 'MEDIUM']);
  const stats = b.getStats();
  assert.equal(stats.cyclesRun, 1);
  assert.equal(stats.totalObservations, 2);
  assert.equal(stats.nullSkipped, 1);
});

test('SeismicMissionBridge: maxObservationsPerCycle caps the result list', async () => {
  const b = new SeismicMissionBridge({
    ...noopStorage(),
    config: { maxObservationsPerCycle: 2 },
    fetcher: () => Promise.resolve([
      quake({ id: '1', magnitude: 7 }),
      quake({ id: '2', magnitude: 7 }),
      quake({ id: '3', magnitude: 7 }),
    ]),
  });
  const events = await b.processCycle();
  assert.equal(events.length, 2);
});

// ── TsunamiMissionBridge ──────────────────────────────────────────────────

test('TsunamiMissionBridge: domain="seismic" and feedId="tsunami-alert"', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  const cfg = b.getConfig();
  assert.equal(cfg.domain, 'seismic');
  assert.equal(cfg.feedId, 'tsunami-alert');
});

test('TsunamiMissionBridge: Warning → CRITICAL with rank-4 + tagged level', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  const evt = b.normalize(tsunamiAlert({ level: 'Warning', region: 'Hawaii' })) as ObservationEvent;
  assert.equal(evt.severity, 'CRITICAL');
  assert.match(evt.title, /Tsunami Warning — Hawaii/);
  assert.ok(evt.tags.includes('tsunami'));
  assert.ok(evt.tags.includes('rank-4'));
  assert.ok(evt.tags.includes('level-warning'));
});

test('TsunamiMissionBridge: Watch → HIGH, Advisory → MEDIUM, Information → LOW', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  assert.equal(b.normalize(tsunamiAlert({ level: 'Watch' }))?.severity, 'HIGH');
  assert.equal(b.normalize(tsunamiAlert({ level: 'Advisory' }))?.severity, 'MEDIUM');
  assert.equal(b.normalize(tsunamiAlert({ level: 'Information' }))?.severity, 'LOW');
});

test('TsunamiMissionBridge: lat/lon present produces a location with 250km radius', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  const evt = b.normalize(tsunamiAlert({ lat: 21.3, lon: -157.8 })) as ObservationEvent;
  assert.deepEqual(evt.location, { lat: 21.3, lon: -157.8, radiusKm: 250 });
});

test('TsunamiMissionBridge: missing lat/lon yields undefined location, not malformed coords', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  const evt = b.normalize(tsunamiAlert()) as ObservationEvent;
  assert.equal(evt.location, undefined);
});

test('TsunamiMissionBridge: sourceEventId propagates as entityIds', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  const evt = b.normalize(tsunamiAlert({ sourceEventId: 'us7000abcd' })) as ObservationEvent;
  assert.deepEqual(evt.entityIds, ['us7000abcd']);
});

test('TsunamiMissionBridge: rejects malformed payloads', () => {
  const b = new TsunamiMissionBridge(noopStorage());
  assert.equal(b.normalize(null), null);
  assert.equal(b.normalize({ ...tsunamiAlert(), id: '' }), null);
  assert.equal(b.normalize({ ...tsunamiAlert(), issuedAt: Number.NaN }), null);
});

test('TsunamiMissionBridge: processCycle delivers events through the pipeline', async () => {
  const b = new TsunamiMissionBridge({
    ...noopStorage(),
    fetcher: () => Promise.resolve([
      tsunamiAlert({ id: 'w1', level: 'Warning' }),
      tsunamiAlert({ id: 'w2', level: 'Watch' }),
    ]),
  });
  const events = await b.processCycle();
  assert.equal(events.length, 2);
  assert.equal(events[0]?.severity, 'CRITICAL');
  assert.equal(events[1]?.severity, 'HIGH');
});

// ── AfterShockMissionBridge ───────────────────────────────────────────────

test('AfterShockMissionBridge: domain="seismic" and feedId="shakealert-eew"', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  const cfg = b.getConfig();
  assert.equal(cfg.domain, 'seismic');
  assert.equal(cfg.feedId, 'shakealert-eew');
});

test('AfterShockMissionBridge: MMI VII → CRITICAL; MMI V → HIGH; MMI III → MEDIUM; MMI I → LOW', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  assert.equal(b.normalize(eew({ mmi: 'VII' }))?.severity, 'CRITICAL');
  assert.equal(b.normalize(eew({ mmi: 'V' }))?.severity, 'HIGH');
  assert.equal(b.normalize(eew({ mmi: 'III' }))?.severity, 'MEDIUM');
  assert.equal(b.normalize(eew({ mmi: 'I' }))?.severity, 'LOW');
});

test('AfterShockMissionBridge: integer MMI inputs are accepted alongside Roman numerals', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  assert.equal(b.normalize(eew({ mmi: 9 }))?.severity, 'CRITICAL');
  assert.equal(b.normalize(eew({ mmi: 4 }))?.severity, 'MEDIUM');
});

test('AfterShockMissionBridge: title renders predicted MMI in Roman with magnitude prefix', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  const evt = b.normalize(eew({ mmi: 'VII', magnitude: 6.4 })) as ObservationEvent;
  assert.match(evt.title, /^M6\.4 ShakeAlert — predicted MMI VII$/);
});

test('AfterShockMissionBridge: warningSeconds present produces a warning-Ns tag', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  const evt = b.normalize(eew({ warningSeconds: 12 })) as ObservationEvent;
  assert.ok(evt.tags.includes('warning-12s'));
});

test('AfterShockMissionBridge: missing or zero warningSeconds tags warning-immediate', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  const noField = b.normalize(eew()) as ObservationEvent;
  const zero = b.normalize(eew({ warningSeconds: 0 })) as ObservationEvent;
  assert.ok(noField.tags.includes('warning-immediate'));
  assert.ok(zero.tags.includes('warning-immediate'));
});

test('AfterShockMissionBridge: rejects malformed payloads (missing id / mmi / bad coords)', () => {
  const b = new AfterShockMissionBridge(noopStorage());
  assert.equal(b.normalize(null), null);
  assert.equal(b.normalize({ ...eew(), id: '' }), null);
  assert.equal(b.normalize({ ...eew(), mmi: undefined as never }), null);
  assert.equal(b.normalize({ ...eew(), lat: Number.NaN }), null);
});

test('AfterShockMissionBridge: processCycle integrates fetcher and emits ObservationEvents', async () => {
  const b = new AfterShockMissionBridge({
    ...noopStorage(),
    fetcher: () => Promise.resolve([
      eew({ id: 'eew-a', mmi: 'VIII', magnitude: 7.0 }),
      eew({ id: 'eew-b', mmi: 'III' }),
      { broken: 'payload' },                          // dropped
    ]),
  });
  const events = await b.processCycle();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.severity), ['CRITICAL', 'MEDIUM']);
  assert.equal(b.getStats().nullSkipped, 1);
});

// ── Cross-cutting: all three bridges run independently ───────────────────

test('all three bridges produce non-overlapping ObservationEvent ids', async () => {
  const seismic = new SeismicMissionBridge({
    ...noopStorage(),
    fetcher: () => Promise.resolve([quake({ id: 'q1', magnitude: 7 })]),
  });
  const tsunami = new TsunamiMissionBridge({
    ...noopStorage(),
    fetcher: () => Promise.resolve([tsunamiAlert({ id: 't1' })]),
  });
  const aftershock = new AfterShockMissionBridge({
    ...noopStorage(),
    fetcher: () => Promise.resolve([eew({ id: 'e1', mmi: 'VII' })]),
  });
  const [a, b, c] = await Promise.all([
    seismic.processCycle(), tsunami.processCycle(), aftershock.processCycle(),
  ]);
  const ids = [a[0]?.id, b[0]?.id, c[0]?.id];
  assert.equal(new Set(ids).size, 3); // all distinct
  assert.deepEqual(ids, [
    'usgs-earthquake:q1', 'tsunami-alert:t1', 'shakealert-eew:e1',
  ]);
});

test('all three bridges record errors when the fetcher rejects', async () => {
  const failingFetcher = () => Promise.reject(new Error('fetch failed'));
  const seismic = new SeismicMissionBridge({ ...noopStorage(), fetcher: failingFetcher });
  const tsunami = new TsunamiMissionBridge({ ...noopStorage(), fetcher: failingFetcher });
  const aftershock = new AfterShockMissionBridge({ ...noopStorage(), fetcher: failingFetcher });
  for (const b of [seismic, tsunami, aftershock]) {
    await assert.rejects(() => b.processCycle(), /fetch failed/);
    const s = b.getStats();
    assert.equal(s.errorCount, 1);
    assert.match(s.lastError ?? '', /fetch failed/);
  }
});
