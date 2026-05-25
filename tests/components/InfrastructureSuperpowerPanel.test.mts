/**
 * InfrastructureSuperpowerPanel — pure-engine + render-helper tests.
 *
 * Covers compute (sector scores, tier banding, composite weighting)
 * and the HTML/string contract of each section renderer. No DOM —
 * imports only pure helpers exposed from the panel module.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InfrastructureSuperpowerEngine,
  SECTOR_WEIGHTS,
  TIER_COLOR,
  compositeRisk,
  formatCustomers,
  formatEta,
  powerSectorScore,
  renderPowerSection,
  renderRiskIndex,
  renderTelecomSection,
  renderTransportSection,
  renderWaterSection,
  telecomSectorScore,
  tierFromScore,
  transportSectorScore,
  waterSectorScore,
  type PowerOutage,
  type PowerSectorState,
  type TelecomSectorState,
  type TransportIncident,
  type TransportSectorState,
  type WaterAdvisory,
  type WaterSectorState,
} from '../../src/components/infrastructure-superpower-render.ts';

// ── Fixtures ──────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function outage(over: Partial<PowerOutage> = {}): PowerOutage {
  return {
    id: 'o1',
    region: 'MISO South',
    nercRegion: 'MISO',
    customersAffected: 250_000,
    cause: 'Severe storm',
    restorationEtaMs: NOW + 4 * 3_600_000,
    reportedAt: NOW,
    ...over,
  };
}

function advisory(over: Partial<WaterAdvisory> = {}): WaterAdvisory {
  return {
    id: 'a1',
    region: 'Jackson, MS',
    level: 'warning',
    populationAffected: 150_000,
    contaminant: null,
    facility: null,
    ...over,
  };
}

function incident(over: Partial<TransportIncident> = {}): TransportIncident {
  return {
    id: 'i1',
    mode: 'highway',
    location: 'I-10 mile 45',
    cause: 'Multi-vehicle collision',
    restorationEstimateMs: NOW + 3 * 3_600_000,
    closureDurationMs: 3 * 3_600_000,
    ...over,
  };
}

const ENGINE = new InfrastructureSuperpowerEngine();

// ── tierFromScore ─────────────────────────────────────────────────────

describe('tierFromScore', () => {
  it('returns operational for low scores', () => {
    assert.equal(tierFromScore(0), 'operational');
    assert.equal(tierFromScore(14), 'operational');
  });
  it('returns degraded at 15..39', () => {
    assert.equal(tierFromScore(15), 'degraded');
    assert.equal(tierFromScore(39), 'degraded');
  });
  it('returns stressed at 40..69', () => {
    assert.equal(tierFromScore(40), 'stressed');
    assert.equal(tierFromScore(69), 'stressed');
  });
  it('returns critical at 70..100', () => {
    assert.equal(tierFromScore(70), 'critical');
    assert.equal(tierFromScore(100), 'critical');
  });
});

// ── SECTOR_WEIGHTS ────────────────────────────────────────────────────

describe('SECTOR_WEIGHTS', () => {
  it('weights sum to 1.0', () => {
    const sum = SECTOR_WEIGHTS.energy + SECTOR_WEIGHTS.water + SECTOR_WEIGHTS.comms + SECTOR_WEIGHTS.transport;
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights summed to ${sum}`);
  });
  it('energy carries the largest weight', () => {
    assert.ok(SECTOR_WEIGHTS.energy > SECTOR_WEIGHTS.water);
    assert.ok(SECTOR_WEIGHTS.energy > SECTOR_WEIGHTS.comms);
    assert.ok(SECTOR_WEIGHTS.energy > SECTOR_WEIGHTS.transport);
  });
});

// ── Engine: classifyPower ─────────────────────────────────────────────

describe('Engine.classifyPower', () => {
  it('returns zeros when no outages', () => {
    const s = ENGINE.classifyPower([]);
    assert.equal(s.totalCustomersAffected, 0);
    assert.equal(s.hasCriticalOutage, false);
    assert.equal(s.outages.length, 0);
  });
  it('sums totalCustomersAffected across outages', () => {
    const s = ENGINE.classifyPower([outage({ customersAffected: 100_000 }), outage({ customersAffected: 50_000 })]);
    assert.equal(s.totalCustomersAffected, 150_000);
  });
  it('flags hasCriticalOutage when any single outage ≥500k', () => {
    const s = ENGINE.classifyPower([outage({ customersAffected: 600_000 })]);
    assert.equal(s.hasCriticalOutage, true);
  });
  it('does NOT flag critical when total exceeds 500k but no single outage does', () => {
    const s = ENGINE.classifyPower([outage({ customersAffected: 300_000 }), outage({ customersAffected: 300_000 })]);
    assert.equal(s.hasCriticalOutage, false);
    assert.equal(s.totalCustomersAffected, 600_000);
  });
});

// ── Engine: classifyTransport ─────────────────────────────────────────

describe('Engine.classifyTransport', () => {
  it('counts major highway closures ≥2h only', () => {
    const s = ENGINE.classifyTransport([
      incident({ mode: 'highway', closureDurationMs: 3 * 3_600_000 }),
      incident({ mode: 'highway', closureDurationMs: 60 * 60_000 }),
      incident({ mode: 'bridge', closureDurationMs: 10 * 3_600_000 }),
    ]);
    assert.equal(s.majorHighwayClosures, 1);
    assert.equal(s.incidents.length, 3);
  });
});

// ── Sector scoring ────────────────────────────────────────────────────

describe('powerSectorScore', () => {
  it('returns 0 when no customers affected', () => {
    assert.equal(powerSectorScore({ outages: [], totalCustomersAffected: 0, hasCriticalOutage: false }), 0);
  });
  it('produces a positive score when customers affected', () => {
    const score = powerSectorScore({ outages: [], totalCustomersAffected: 100_000, hasCriticalOutage: false });
    assert.ok(score > 0);
  });
  it('approaches 100 as customers reach 10M', () => {
    const score = powerSectorScore({ outages: [], totalCustomersAffected: 10_000_000, hasCriticalOutage: false });
    assert.equal(score, 100);
  });
  it('caps at 100', () => {
    const score = powerSectorScore({ outages: [], totalCustomersAffected: 100_000_000, hasCriticalOutage: false });
    assert.equal(score, 100);
  });
});

describe('waterSectorScore', () => {
  it('returns 0 when no advisories or disruptions', () => {
    assert.equal(waterSectorScore({ advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 }), 0);
  });
  it('emergency advisories score higher than advisory-tier', () => {
    const advisoryScore = waterSectorScore({ advisories: [advisory({ level: 'advisory' })], facilityDisruptions: 0, totalPopulationAffected: 150_000 });
    const emergencyScore = waterSectorScore({ advisories: [advisory({ level: 'emergency' })], facilityDisruptions: 0, totalPopulationAffected: 150_000 });
    assert.ok(emergencyScore > advisoryScore);
  });
  it('facility disruptions add penalty', () => {
    const noDisruption = waterSectorScore({ advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 });
    const withDisruption = waterSectorScore({ advisories: [], facilityDisruptions: 3, totalPopulationAffected: 0 });
    assert.ok(withDisruption > noDisruption);
  });
});

describe('telecomSectorScore', () => {
  it('returns 0 when telecom healthy and no events', () => {
    assert.equal(telecomSectorScore({ cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'healthy' }), 0);
  });
  it('one cloud outage scores ≥30', () => {
    const s = telecomSectorScore({ cableEvents: [], cloudOutages: [{ id: 'c', provider: 'AWS', region: 'us-east-1', services: ['S3'], startedAt: NOW }], bgpAnomalies: [], cdnPerformance: 'healthy' });
    assert.ok(s >= 30);
  });
  it('major CDN outage alone scores 40', () => {
    const s = telecomSectorScore({ cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'major-outage' });
    assert.equal(s, 40);
  });
  it('caps at 100', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, provider: 'AWS', region: 'r', services: [], startedAt: NOW }));
    const s = telecomSectorScore({ cableEvents: [], cloudOutages: many, bgpAnomalies: [], cdnPerformance: 'major-outage' });
    assert.equal(s, 100);
  });
});

describe('transportSectorScore', () => {
  it('returns 0 for no incidents', () => {
    assert.equal(transportSectorScore({ incidents: [], majorHighwayClosures: 0 }), 0);
  });
  it('scales with incident count', () => {
    const s = transportSectorScore({ incidents: [incident(), incident()], majorHighwayClosures: 1 });
    assert.equal(s, 2 * 15 + 1 * 5);
  });
  it('caps at 100', () => {
    const many = Array.from({ length: 20 }, () => incident());
    const s = transportSectorScore({ incidents: many, majorHighwayClosures: 0 });
    assert.equal(s, 100);
  });
});

// ── compositeRisk ─────────────────────────────────────────────────────

describe('compositeRisk', () => {
  function defaultSectors(): {
    power: PowerSectorState;
    water: WaterSectorState;
    telecom: TelecomSectorState;
    transport: TransportSectorState;
  } {
    return {
      power: { outages: [], totalCustomersAffected: 0, hasCriticalOutage: false },
      water: { advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 },
      telecom: { cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'healthy' },
      transport: { incidents: [], majorHighwayClosures: 0 },
    };
  }

  it('returns composite 0 / operational when all sectors quiet', () => {
    const r = compositeRisk(defaultSectors());
    assert.equal(r.composite, 0);
    assert.equal(r.tier, 'operational');
    assert.equal(r.sectors.length, 4);
  });

  it('always includes the 4 named sectors', () => {
    const r = compositeRisk(defaultSectors());
    const names = r.sectors.map((s) => s.sector).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, ['comms', 'energy', 'transport', 'water']);
  });

  it('energy stress dominates the composite at its 35% weight', () => {
    const base = defaultSectors();
    base.power = { outages: [], totalCustomersAffected: 10_000_000, hasCriticalOutage: true };
    const r = compositeRisk(base);
    // energy score 100 × 0.35 = 35
    assert.equal(r.composite, 35);
    assert.equal(r.tier, 'degraded');
  });

  it('multiple critical sectors push composite into critical tier', () => {
    const base = defaultSectors();
    base.power = { outages: [], totalCustomersAffected: 10_000_000, hasCriticalOutage: true };
    base.telecom = { cableEvents: [], cloudOutages: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, provider: 'AWS', region: 'r', services: [], startedAt: NOW })), bgpAnomalies: [], cdnPerformance: 'major-outage' };
    base.transport = { incidents: Array.from({ length: 10 }, () => incident()), majorHighwayClosures: 5 };
    const r = compositeRisk(base);
    assert.ok(r.composite >= 70, `expected ≥70 got ${r.composite}`);
    assert.equal(r.tier, 'critical');
  });
});

// ── Format helpers ────────────────────────────────────────────────────

describe('formatCustomers', () => {
  it('formats millions with M suffix', () => assert.equal(formatCustomers(1_500_000), '1.5M'));
  it('formats thousands with k suffix', () => assert.equal(formatCustomers(15_000), '15k'));
  it('formats sub-thousand as raw number', () => assert.equal(formatCustomers(750), '750'));
});

describe('formatEta', () => {
  it('returns Unknown for null', () => assert.equal(formatEta(null, NOW), 'Unknown'));
  it('returns Past due for past timestamps', () => assert.equal(formatEta(NOW - 1000, NOW), 'Past due'));
  it('formats hours+minutes', () => assert.equal(formatEta(NOW + 3 * 3_600_000 + 15 * 60_000, NOW), '~3h 15m'));
  it('formats sub-hour as minutes', () => assert.equal(formatEta(NOW + 20 * 60_000, NOW), '~20m'));
  it('formats multi-day with days+hours', () => assert.equal(formatEta(NOW + 50 * 3_600_000, NOW), '~2d 2h'));
});

// ── renderPowerSection ────────────────────────────────────────────────

describe('renderPowerSection', () => {
  it('renders empty-state copy when no outages', () => {
    const html = renderPowerSection({ outages: [], totalCustomersAffected: 0, hasCriticalOutage: false });
    assert.match(html, /No active outages/);
  });
  it('shows CRITICAL OUTAGE badge when flag set', () => {
    const html = renderPowerSection({ outages: [outage({ customersAffected: 800_000 })], totalCustomersAffected: 800_000, hasCriticalOutage: true });
    assert.match(html, /CRITICAL OUTAGE/);
  });
  it('omits critical badge when flag not set', () => {
    const html = renderPowerSection({ outages: [outage({ customersAffected: 100_000 })], totalCustomersAffected: 100_000, hasCriticalOutage: false });
    assert.ok(!html.includes('CRITICAL OUTAGE'));
  });
  it('escapes XSS in region name', () => {
    const html = renderPowerSection({ outages: [outage({ region: '<script>x</script>' })], totalCustomersAffected: 250_000, hasCriticalOutage: false });
    assert.ok(!html.includes('<script>x'));
    assert.match(html, /&lt;script&gt;/);
  });
});

// ── renderWaterSection ────────────────────────────────────────────────

describe('renderWaterSection', () => {
  it('renders empty-state when no advisories or disruptions', () => {
    const html = renderWaterSection({ advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 });
    assert.match(html, /No active advisories/);
  });
  it('renders emergency-level badge', () => {
    const html = renderWaterSection({ advisories: [advisory({ level: 'emergency' })], facilityDisruptions: 0, totalPopulationAffected: 150_000 });
    assert.match(html, /emergency/i);
  });
  it('shows facility disruption count', () => {
    const html = renderWaterSection({ advisories: [], facilityDisruptions: 4, totalPopulationAffected: 0 });
    assert.match(html, /Treatment facility disruptions: <strong>4<\/strong>/);
  });
});

// ── renderTelecomSection ──────────────────────────────────────────────

describe('renderTelecomSection', () => {
  it('renders empty-state when fully healthy', () => {
    const html = renderTelecomSection({ cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'healthy' });
    assert.match(html, /CDN: healthy/i);
    assert.match(html, /No telecom anomalies/);
  });
  it('renders cloud outage row with provider + services', () => {
    const html = renderTelecomSection({ cableEvents: [], cloudOutages: [{ id: 'c', provider: 'AWS', region: 'us-east-1', services: ['S3', 'EC2'], startedAt: NOW }], bgpAnomalies: [], cdnPerformance: 'healthy' });
    assert.match(html, /AWS/);
    assert.match(html, /S3, EC2/);
  });
  it('shows BGP anomaly rows', () => {
    const html = renderTelecomSection({ cableEvents: [], cloudOutages: [], bgpAnomalies: [{ id: 'b', asn: '12345', region: 'EU', type: 'hijack' }], cdnPerformance: 'healthy' });
    assert.match(html, /AS12345/);
    assert.match(html, /hijack/);
  });
});

// ── renderTransportSection ────────────────────────────────────────────

describe('renderTransportSection', () => {
  it('renders empty-state with no incidents', () => {
    const html = renderTransportSection({ incidents: [], majorHighwayClosures: 0 });
    assert.match(html, /No active transportation incidents/);
  });
  it('shows major highway closure count when > 0', () => {
    const html = renderTransportSection({ incidents: [incident()], majorHighwayClosures: 1 });
    assert.match(html, /Major highway closures \(≥2h\): <strong>1<\/strong>/);
  });
  it('renders incidents with mode-specific icons', () => {
    const html = renderTransportSection({ incidents: [incident({ mode: 'bridge', location: 'GW Bridge' })], majorHighwayClosures: 0 });
    assert.match(html, /🌉/);
    assert.match(html, /GW Bridge/);
  });
});

// ── renderRiskIndex ───────────────────────────────────────────────────

describe('renderRiskIndex', () => {
  it('renders composite score + tier label', () => {
    const r = compositeRisk({
      power: { outages: [], totalCustomersAffected: 1_000_000, hasCriticalOutage: false },
      water: { advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 },
      telecom: { cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'healthy' },
      transport: { incidents: [], majorHighwayClosures: 0 },
    });
    const html = renderRiskIndex(r);
    assert.match(html, new RegExp(String(r.composite)));
    assert.match(html, new RegExp(r.tier, 'i'));
  });
  it('renders all 4 sector rows', () => {
    const r = compositeRisk({
      power: { outages: [], totalCustomersAffected: 0, hasCriticalOutage: false },
      water: { advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 },
      telecom: { cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'healthy' },
      transport: { incidents: [], majorHighwayClosures: 0 },
    });
    const html = renderRiskIndex(r);
    for (const sec of ['energy', 'water', 'comms', 'transport']) {
      assert.match(html, new RegExp(sec, 'i'), `expected to see ${sec} row`);
    }
  });
  it('uses tier color from TIER_COLOR table', () => {
    const r = compositeRisk({
      power: { outages: [], totalCustomersAffected: 10_000_000, hasCriticalOutage: true },
      water: { advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 },
      telecom: { cableEvents: [], cloudOutages: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, provider: 'AWS', region: 'r', services: [], startedAt: NOW })), bgpAnomalies: [], cdnPerformance: 'major-outage' },
      transport: { incidents: Array.from({ length: 10 }, () => incident()), majorHighwayClosures: 5 },
    });
    const html = renderRiskIndex(r);
    assert.ok(html.includes(TIER_COLOR.critical), 'critical tier should be color-coded');
  });
});

// ── TIER_COLOR ────────────────────────────────────────────────────────

describe('TIER_COLOR', () => {
  it('has all four tiers', () => {
    assert.ok(TIER_COLOR.operational);
    assert.ok(TIER_COLOR.degraded);
    assert.ok(TIER_COLOR.stressed);
    assert.ok(TIER_COLOR.critical);
  });
  it('critical is the red hue', () => {
    assert.equal(TIER_COLOR.critical, '#f44336');
  });
});
