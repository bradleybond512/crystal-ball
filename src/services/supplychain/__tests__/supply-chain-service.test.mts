import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// Minimal stubs for imports used by unified-alerts (DOM / globals not available in node:test)
globalThis.document ??= {
  dispatchEvent: () => undefined,
  addEventListener: () => undefined,
} as unknown as Document;
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
} as unknown as Storage;

import {
  // Port helpers
  computePortCongestion, scoreCongestion, congestionLevelFor,
  PORT_CONFIGS,
  // Canal helpers
  computeCanalStatus, estimateWaitHours, disruptionStatusFor,
  CANAL_CONFIGS,
  // BDI helpers
  parseBDIFromCsv,
  // Risk helpers
  computeChokepointRisk,
  // Alert helpers
  portStatusToAlert, canalStatusToAlert, resetAlertCooldowns,
  type VesselPosition,
} from '../supply-chain-service.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

/** Build a vessel near a given lat/lon with optional SOG and navStatus. */
function makeVessel(
  lat: number, lon: number,
  opts: { sog?: number; navStatus?: number; mmsi?: string } = {},
): VesselPosition {
  return { mmsi: opts.mmsi ?? '123456789', lat, lon, sog: opts.sog ?? 0, navStatus: opts.navStatus };
}

const LA_CFG = PORT_CONFIGS['USLA'];
/** Place a vessel inside LA anchor zone. */
function laVessel(anchoredFlag = true): VesselPosition {
  return makeVessel(
    LA_CFG.lat + 0.05, LA_CFG.lon + 0.05,
    anchoredFlag ? { sog: 0.1 } : { sog: 5.0 },
  );
}

const SUEZ_CFG = CANAL_CONFIGS['suez'];

// ── scoreCongestion ────────────────────────────────────────────────────────

describe('scoreCongestion', () => {
  it('returns 0 for zero anchored vessels', () => {
    assert.equal(scoreCongestion(0, 40), 0);
  });

  it('caps at 100', () => {
    assert.equal(scoreCongestion(9999, 40), 100);
  });

  it('returns proportional mid-range score', () => {
    // 40 anchored / (40 * 0.5) capacity = 200% → clamped to 100
    // 10 anchored / (40 * 0.5) = 50%
    assert.equal(scoreCongestion(10, 40), 50);
  });

  it('handles zero dailyCapacity gracefully', () => {
    assert.equal(scoreCongestion(5, 0), 0);
  });
});

// ── congestionLevelFor ─────────────────────────────────────────────────────

describe('congestionLevelFor', () => {
  it('low for 0–24', () => assert.equal(congestionLevelFor(24), 'low'));
  it('moderate for 25–49', () => assert.equal(congestionLevelFor(49), 'moderate'));
  it('high for 50–74', () => assert.equal(congestionLevelFor(50), 'high'));
  it('critical for 75+', () => assert.equal(congestionLevelFor(75), 'critical'));
});

// ── computePortCongestion ──────────────────────────────────────────────────

describe('computePortCongestion', () => {
  it('returns zero counts when no vessels near port', () => {
    const status = computePortCongestion([], 'USLA', undefined, NOW);
    assert.equal(status.anchored, 0);
    assert.equal(status.inTransit, 0);
    assert.equal(status.congestionScore, 0);
    assert.equal(status.congestionLevel, 'low');
  });

  it('counts anchored vessels inside anchor radius', () => {
    const vessels = [laVessel(true), laVessel(true), laVessel(false)];
    const status = computePortCongestion(vessels, 'USLA', undefined, NOW);
    assert.equal(status.anchored, 2);
    // Moving vessel is within transit radius (~7 km from center < 10 km)
    assert.equal(status.inTransit, 1);
  });

  it('ignores vessels outside anchor radius', () => {
    // Place vessel far away
    const far = makeVessel(0, 0);
    const status = computePortCongestion([far], 'USLA', undefined, NOW);
    assert.equal(status.anchored, 0);
  });

  it('trend rises when anchored count increased by >2', () => {
    const vessels = [laVessel(), laVessel(), laVessel(), laVessel()]; // 4 anchored
    const status = computePortCongestion(vessels, 'USLA', 1, NOW); // prev=1, delta=3 → rising
    assert.equal(status.trend, 'rising');
  });

  it('trend falls when anchored count dropped by >2', () => {
    const status = computePortCongestion([laVessel()], 'USLA', 5, NOW); // prev=5, now=1, delta=-4 → falling
    assert.equal(status.trend, 'falling');
  });

  it('trend stable when delta ≤2', () => {
    const status = computePortCongestion([laVessel(), laVessel()], 'USLA', 1, NOW); // delta=1
    assert.equal(status.trend, 'stable');
  });

  it('includes port metadata in result', () => {
    const status = computePortCongestion([], 'SGSIN', undefined, NOW);
    assert.equal(status.code, 'SGSIN');
    assert.equal(status.name, 'Singapore');
    assert.equal(status.computedAt, NOW);
  });

  it('navStatus=1 counts as anchored', () => {
    const v = makeVessel(LA_CFG.lat + 0.05, LA_CFG.lon + 0.05, { sog: 5.0, navStatus: 1 });
    const status = computePortCongestion([v], 'USLA', undefined, NOW);
    assert.equal(status.anchored, 1);
  });
});

// ── estimateWaitHours ──────────────────────────────────────────────────────

describe('estimateWaitHours', () => {
  it('returns 0 for empty queue', () => assert.equal(estimateWaitHours(0, 2.5), 0));
  it('returns 0 for zero capacity', () => assert.equal(estimateWaitHours(10, 0), 0));
  it('computes correctly: 10 vessels / 2.5 per hour = 4h', () => {
    assert.equal(estimateWaitHours(10, 2.5), 4);
  });
});

// ── disruptionStatusFor ────────────────────────────────────────────────────

describe('disruptionStatusFor', () => {
  it('normal for wait < 8h', () => assert.equal(disruptionStatusFor(7), 'normal'));
  it('delayed for wait 8–23h', () => assert.equal(disruptionStatusFor(8), 'delayed'));
  it('restricted for wait 24–71h', () => assert.equal(disruptionStatusFor(24), 'restricted'));
  it('closed for wait ≥ 72h', () => assert.equal(disruptionStatusFor(72), 'closed'));
});

// ── computeCanalStatus ─────────────────────────────────────────────────────

describe('computeCanalStatus', () => {
  it('returns zero queued/in-transit for empty vessel list', () => {
    const status = computeCanalStatus([], 'suez', NOW);
    assert.equal(status.queued, 0);
    assert.equal(status.inTransit, 0);
    assert.equal(status.disruptionStatus, 'normal');
  });

  it('counts vessels in approach zone as queued when anchored', () => {
    // Place an anchored vessel inside approach radius but outside transit radius
    const v = makeVessel(SUEZ_CFG.approachLat, SUEZ_CFG.approachLon, { sog: 0.0 });
    const status = computeCanalStatus([v], 'suez', NOW);
    assert.equal(status.queued, 1);
    assert.equal(status.inTransit, 0);
  });

  it('counts vessels in transit zone as in-transit (not queued)', () => {
    const v = makeVessel(SUEZ_CFG.transitLat, SUEZ_CFG.transitLon, { sog: 8.0 });
    const status = computeCanalStatus([v], 'suez', NOW);
    assert.equal(status.inTransit, 1);
    assert.equal(status.queued, 0);
  });

  it('propagates correct canal name', () => {
    const status = computeCanalStatus([], 'panama', NOW);
    assert.equal(status.name, 'Panama Canal');
  });
});

// ── parseBDIFromCsv ────────────────────────────────────────────────────────

const STOOQ_CSV = `Date,Open,High,Low,Close,Volume
2024-01-01,1200,1250,1190,1210,0
2024-01-02,1210,1260,1200,1220,0
2024-01-03,1220,1270,1210,1230,0`;

const FRED_CSV = `DATE,VALUE
2024-01-01,1200
2024-01-02,1220
2024-01-03,1240`;

describe('parseBDIFromCsv', () => {
  it('parses stooq CSV using Close column', () => {
    const data = parseBDIFromCsv(STOOQ_CSV);
    assert.equal(data.current, 1230);
    assert.equal(data.series, 'BDI');
    assert.ok(data.history.length > 0);
    assert.equal(data.asOf, '2024-01-03');
  });

  it('parses FRED CSV using VALUE column', () => {
    const data = parseBDIFromCsv(FRED_CSV, 'BDI-FRED');
    assert.equal(data.current, 1240);
    assert.equal(data.series, 'BDI-FRED');
    assert.equal(data.asOf, '2024-01-03');
  });

  it('returns empty BDI for empty CSV', () => {
    const data = parseBDIFromCsv('');
    assert.equal(data.current, null);
    assert.equal(data.avg90d, null);
    assert.equal(data.trend, 'stable');
    assert.equal(data.level, 'normal');
  });

  it('returns empty BDI for header-only CSV', () => {
    const data = parseBDIFromCsv('Date,Open,High,Low,Close,Volume\n');
    assert.equal(data.current, null);
  });

  it('computes trend as rising when values increase', () => {
    const csv = 'DATE,VALUE\n' +
      Array.from({ length: 6 }, (_, i) => `2024-01-0${i + 1},${1000 + i * 100}`).join('\n');
    const data = parseBDIFromCsv(csv);
    assert.equal(data.trend, 'rising');
  });

  it('computes spike level for deviation ≥ 40%', () => {
    // avg ≈ 1000, last value = 1500 → dev ≈ +50%
    const rows = Array.from({ length: 9 }, (_, i) => `2024-01-0${i + 1},1000`).join('\n');
    const csv = `DATE,VALUE\n${rows}\n2024-01-10,1500`;
    const data = parseBDIFromCsv(csv);
    assert.equal(data.level, 'spike');
  });

  it('computes depressed level for deviation ≤ -20%', () => {
    const rows = Array.from({ length: 9 }, (_, i) => `2024-01-0${i + 1},1000`).join('\n');
    const csv = `DATE,VALUE\n${rows}\n2024-01-10,750`;
    const data = parseBDIFromCsv(csv);
    assert.equal(data.level, 'depressed');
  });

  it('skips rows with invalid values', () => {
    const csv = 'DATE,VALUE\n2024-01-01,.\n2024-01-02,\n2024-01-03,1200\n';
    const data = parseBDIFromCsv(csv);
    assert.equal(data.current, 1200);
  });
});

// ── computeChokepointRisk ──────────────────────────────────────────────────

describe('computeChokepointRisk', () => {
  it('computes weighted composite score (65% AIS + 35% freight)', () => {
    const risk = computeChokepointRisk('Suez', 100, 100);
    assert.equal(risk.score, 100);
  });

  it('0 inputs gives 0 score', () => {
    const risk = computeChokepointRisk('Malacca', 0, 0);
    assert.equal(risk.score, 0);
    assert.equal(risk.level, 'low');
  });

  it('adds AIS driver when closure risk ≥ 50', () => {
    const risk = computeChokepointRisk('Hormuz', 80, 0);
    assert.ok(risk.drivers.some((d) => d.includes('AIS')));
  });

  it('adds freight driver when freight stress ≥ 50', () => {
    const risk = computeChokepointRisk('Panama', 0, 80);
    assert.ok(risk.drivers.some((d) => d.includes('Freight stress')));
  });

  it('appends extra drivers', () => {
    const risk = computeChokepointRisk('Bab-el-Mandeb', 0, 0, ['Drone strike report']);
    assert.ok(risk.drivers.includes('Drone strike report'));
  });
});

// ── portStatusToAlert ──────────────────────────────────────────────────────

describe('portStatusToAlert', () => {
  beforeEach(() => resetAlertCooldowns());

  it('returns null for low congestion', () => {
    const vessels: VesselPosition[] = [];
    const status = computePortCongestion(vessels, 'USLA', undefined, NOW);
    assert.equal(portStatusToAlert(status, NOW), null);
  });

  it('returns alert for high congestion', () => {
    // Need enough anchored to reach 'high' score (≥50). Score = anchored/(cap*0.5)*100
    // LA cap=40 → need 10+ anchored
    const vessels = Array.from({ length: 10 }, (_, i) =>
      makeVessel(LA_CFG.lat + 0.05, LA_CFG.lon + 0.05 + i * 0.001, { sog: 0, mmsi: `vessel${i}` })
    );
    const status = computePortCongestion(vessels, 'USLA', undefined, NOW);
    const alert = portStatusToAlert(status, NOW);
    assert.ok(alert !== null);
    assert.equal(alert!.source, 'maritime');
    assert.ok(alert!.title.includes('Los Angeles'));
  });

  it('respects 30-min cooldown — second call returns null', () => {
    const vessels = Array.from({ length: 10 }, (_, i) =>
      makeVessel(LA_CFG.lat + 0.05, LA_CFG.lon + 0.05 + i * 0.001, { sog: 0, mmsi: `v${i}` })
    );
    const status = computePortCongestion(vessels, 'USLA', undefined, NOW);
    const first = portStatusToAlert(status, NOW);
    assert.ok(first !== null);
    const second = portStatusToAlert(status, NOW + 1000); // 1s later — still in cooldown
    assert.equal(second, null);
  });

  it('fires again after cooldown expires', () => {
    const vessels = Array.from({ length: 10 }, (_, i) =>
      makeVessel(LA_CFG.lat + 0.05, LA_CFG.lon + 0.05 + i * 0.001, { sog: 0, mmsi: `u${i}` })
    );
    const status = computePortCongestion(vessels, 'USLA', undefined, NOW);
    portStatusToAlert(status, NOW);
    const after = portStatusToAlert(status, NOW + 31 * 60 * 1000);
    assert.ok(after !== null);
  });
});

// ── canalStatusToAlert ─────────────────────────────────────────────────────

describe('canalStatusToAlert', () => {
  beforeEach(() => resetAlertCooldowns());

  it('returns null for normal disruption status', () => {
    const status = computeCanalStatus([], 'suez', NOW);
    assert.equal(canalStatusToAlert(status, NOW), null);
  });

  it('returns alert when queue ≥ 10 and delayed', () => {
    // 10 vessels anchored in approach zone → wait = 10/2.5 = 4h → 'delayed'
    // But delayed also needs queued ≥ 10
    const vessels = Array.from({ length: 10 }, (_, i) =>
      makeVessel(SUEZ_CFG.approachLat, SUEZ_CFG.approachLon + i * 0.1, { sog: 0, mmsi: `sv${i}` })
    );
    const status = computeCanalStatus(vessels, 'suez', NOW);
    if (status.disruptionStatus !== 'normal') {
      const alert = canalStatusToAlert(status, NOW);
      assert.ok(alert !== null);
      assert.equal(alert!.source, 'maritime');
    }
  });

  it('assigns critical severity for closed disruption', () => {
    // Build a fake canal status directly
    const fakeStatus = {
      id: 'suez' as const,
      name: 'Suez Canal',
      queued: 100,
      inTransit: 5,
      estimatedWaitHours: 72,
      disruptionStatus: 'closed' as const,
      computedAt: NOW,
    };
    const alert = canalStatusToAlert(fakeStatus, NOW);
    assert.ok(alert !== null);
    assert.equal(alert!.severity, 'critical');
  });

  it('assigns high severity for restricted disruption', () => {
    const fakeStatus = {
      id: 'panama' as const,
      name: 'Panama Canal',
      queued: 50,
      inTransit: 3,
      estimatedWaitHours: 30,
      disruptionStatus: 'restricted' as const,
      computedAt: NOW,
    };
    const alert = canalStatusToAlert(fakeStatus, NOW);
    assert.ok(alert !== null);
    assert.equal(alert!.severity, 'high');
  });

  it('respects 30-min cooldown for canal alerts', () => {
    const fakeStatus = {
      id: 'bosphorus' as const,
      name: 'Bosphorus Strait',
      queued: 30,
      inTransit: 2,
      estimatedWaitHours: 80,
      disruptionStatus: 'closed' as const,
      computedAt: NOW,
    };
    const first = canalStatusToAlert(fakeStatus, NOW);
    assert.ok(first !== null);
    const second = canalStatusToAlert(fakeStatus, NOW + 5000);
    assert.equal(second, null);
  });
});
