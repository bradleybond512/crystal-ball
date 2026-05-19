import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVesselAnomalies,
  buildChokepointRows,
  waitTimeForRisk,
  derivePortDisruptions,
  deriveSanctionsVessels,
  derivePiracyIncidents,
} from '../../src/components/MaritimeSuperpowerPanel.js';
import type { LegacyEntity } from '../../src/services/intelligence/entity-registry.js';
import type { TradeRoute } from '../../src/services/intelligence/trade-route-risk-scorer.js';
import type { Situation } from '../../src/services/situation-types.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeVessel(id: string, name: string, meta: Record<string, unknown> = {}): LegacyEntity {
  return { id, kind: 'ship', name, lastSeenAt: Date.now(), meta };
}

function makeSituation(overrides: Partial<Situation> & { domain?: string; name?: string; tags?: string[]; severity?: string } = {}): Situation {
  return {
    id: 'sit-1',
    title: overrides.name ?? 'Test Situation',
    summary: 'Test summary',
    phase: 'active',
    domain: (overrides.domain ?? 'military') as Situation['domain'],
    confidence: 0.7,
    geo: { lat: 0, lon: 0, label: 'Test Location', countries: [], radiusKm: 100 },
    signalIds: [],
    signals: [],
    domainDiversity: 1,
    evidence: null,
    scenarios: [],
    actions: [],
    causalChainId: null,
    firstSeen: Date.now(),
    lastUpdated: Date.now(),
    reassessmentCount: 0,
    ...overrides,
  } as unknown as Situation;
}

function makeRoute(overrides: Partial<TradeRoute> = {}): TradeRoute {
  return {
    id: 'route-1',
    name: 'Test Route',
    type: 'maritime',
    lat: 0,
    lon: 0,
    radiusKm: 50,
    annualTradeUsd: 100_000_000,
    riskScore: 0,
    riskLevel: 'minimal',
    lastUpdatedAt: Date.now(),
    contributingFactors: [],
    ...overrides,
  };
}

// ── waitTimeForRisk ──────────────────────────────────────────────────────────

describe('waitTimeForRisk', () => {
  it('returns < 4h for minimal', () => {
    assert.equal(waitTimeForRisk('minimal'), '< 4h');
  });

  it('returns 8–24h for elevated', () => {
    assert.equal(waitTimeForRisk('elevated'), '8–24h');
  });

  it('returns 24–48h for high', () => {
    assert.equal(waitTimeForRisk('high'), '24–48h');
  });

  it('returns 48h+ for critical', () => {
    assert.equal(waitTimeForRisk('critical'), '48h+');
  });

  it('returns N/A for unknown level', () => {
    assert.equal(waitTimeForRisk('unknown'), 'N/A');
  });
});

// ── classifyVesselAnomalies ──────────────────────────────────────────────────

describe('classifyVesselAnomalies', () => {
  it('returns empty array for no vessels', () => {
    assert.deepEqual(classifyVesselAnomalies([]), []);
  });

  it('detects AIS gap', () => {
    const vessels = [makeVessel('v1', 'MV Atlas', { aisGap: true })];
    const result = classifyVesselAnomalies(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.flags.includes('AIS gap'));
  });

  it('detects spoofing', () => {
    const vessels = [makeVessel('v2', 'MV Bravo', { spoofing: true })];
    const result = classifyVesselAnomalies(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.flags.includes('spoofing'));
  });

  it('detects sanctioned waters', () => {
    const vessels = [makeVessel('v3', 'MV Charlie', { sanctionedWaters: true })];
    const result = classifyVesselAnomalies(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.flags.includes('sanctioned waters'));
  });

  it('filters out non-anomalous vessels', () => {
    const vessels = [makeVessel('v4', 'MV Clean', {})];
    assert.deepEqual(classifyVesselAnomalies(vessels), []);
  });

  it('includes all flags when vessel has multiple anomalies', () => {
    const vessels = [makeVessel('v5', 'MV Delta', { aisGap: true, spoofing: true, sanctionedWaters: true })];
    const result = classifyVesselAnomalies(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.flags.includes('AIS gap'));
    assert.ok(result[0]!.flags.includes('spoofing'));
    assert.ok(result[0]!.flags.includes('sanctioned waters'));
    assert.equal(result[0]!.flags.length, 3);
  });
});

// ── buildChokepointRows ──────────────────────────────────────────────────────

describe('buildChokepointRows', () => {
  it('returns all 5 chokepoints when no routes provided', () => {
    const rows = buildChokepointRows([]);
    assert.equal(rows.length, 5);
  });

  it('defaults to minimal risk and N/A wait time when no matching route', () => {
    const rows = buildChokepointRows([]);
    for (const row of rows) {
      assert.equal(row.risk, 'minimal');
      assert.equal(row.waitTime, 'N/A');
    }
  });

  it('maps Suez Canal route risk correctly', () => {
    const routes = [makeRoute({ name: 'Suez Canal', riskLevel: 'high' })];
    const rows = buildChokepointRows(routes);
    const suez = rows.find((r) => r.name === 'Suez Canal');
    assert.ok(suez, 'Suez Canal row should exist');
    assert.equal(suez!.risk, 'high');
    assert.equal(suez!.waitTime, '24–48h');
  });

  it('maps Strait of Hormuz route risk correctly', () => {
    const routes = [makeRoute({ name: 'Strait of Hormuz', riskLevel: 'critical' })];
    const rows = buildChokepointRows(routes);
    const hormuz = rows.find((r) => r.name === 'Strait of Hormuz');
    assert.ok(hormuz, 'Strait of Hormuz row should exist');
    assert.equal(hormuz!.risk, 'critical');
    assert.equal(hormuz!.waitTime, '48h+');
  });

  it('maps Strait of Malacca route risk correctly', () => {
    const routes = [makeRoute({ name: 'Strait of Malacca', riskLevel: 'elevated' })];
    const rows = buildChokepointRows(routes);
    const malacca = rows.find((r) => r.name === 'Strait of Malacca');
    assert.ok(malacca, 'Strait of Malacca row should exist');
    assert.equal(malacca!.risk, 'elevated');
    assert.equal(malacca!.waitTime, '8–24h');
  });

  it('maps Bab-el-Mandeb Strait (spaced variant) risk correctly', () => {
    const routes = [makeRoute({ name: 'Bab el Mandeb Strait', riskLevel: 'high' })];
    const rows = buildChokepointRows(routes);
    const bab = rows.find((r) => r.name === 'Bab-el-Mandeb');
    assert.ok(bab, 'Bab-el-Mandeb row should exist');
    assert.equal(bab!.risk, 'high');
    assert.equal(bab!.waitTime, '24–48h');
  });

  it('maps Panama Canal route risk correctly', () => {
    const routes = [makeRoute({ name: 'Panama Canal', riskLevel: 'critical' })];
    const rows = buildChokepointRows(routes);
    const panama = rows.find((r) => r.name === 'Panama Canal');
    assert.ok(panama, 'Panama Canal row should exist');
    assert.equal(panama!.risk, 'critical');
    assert.equal(panama!.waitTime, '48h+');
  });
});

// ── deriveSanctionsVessels ───────────────────────────────────────────────────

describe('deriveSanctionsVessels', () => {
  it('returns empty array for no vessels', () => {
    assert.deepEqual(deriveSanctionsVessels([]), []);
  });

  it('detects OFAC SDN match', () => {
    const vessels = [makeVessel('s1', 'MV Sanctioned', { ofacMatch: true })];
    const result = deriveSanctionsVessels(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.reasons.includes('OFAC SDN match'));
  });

  it('detects flag of convenience', () => {
    const vessels = [makeVessel('s2', 'MV Flag', { flagOfConvenience: true })];
    const result = deriveSanctionsVessels(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.reasons.includes('flag of convenience'));
  });

  it('includes both reasons when both flags are present', () => {
    const vessels = [makeVessel('s3', 'MV Both', { ofacMatch: true, flagOfConvenience: true })];
    const result = deriveSanctionsVessels(vessels);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.reasons.includes('OFAC SDN match'));
    assert.ok(result[0]!.reasons.includes('flag of convenience'));
  });

  it('excludes vessels with no sanctions flags', () => {
    const vessels = [makeVessel('s4', 'MV Clean', {})];
    assert.deepEqual(deriveSanctionsVessels(vessels), []);
  });
});

// ── derivePiracyIncidents ────────────────────────────────────────────────────

describe('derivePiracyIncidents', () => {
  it('returns empty array for no situations', () => {
    assert.deepEqual(derivePiracyIncidents([]), []);
  });

  it('includes maritime situation with piracy tag', () => {
    const sit = makeSituation({ domain: 'maritime', tags: ['piracy', 'gulf-of-aden'] });
    const result = derivePiracyIncidents([sit]);
    assert.equal(result.length, 1);
  });

  it('includes maritime situation with piracy in title', () => {
    const sit = makeSituation({ domain: 'maritime', name: 'Piracy incident off Somalia' });
    const result = derivePiracyIncidents([sit]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Piracy incident off Somalia');
  });

  it('excludes non-maritime situation even with piracy tag', () => {
    const sit = makeSituation({ domain: 'military', tags: ['piracy'] });
    const result = derivePiracyIncidents([sit]);
    assert.deepEqual(result, []);
  });

  it('excludes maritime situation without piracy tag or title match', () => {
    const sit = makeSituation({ domain: 'maritime', name: 'Port congestion', tags: ['port'] });
    const result = derivePiracyIncidents([sit]);
    assert.deepEqual(result, []);
  });
});

// ── derivePortDisruptions ────────────────────────────────────────────────────

describe('derivePortDisruptions', () => {
  it('returns empty array for no situations', () => {
    assert.deepEqual(derivePortDisruptions([]), []);
  });

  it('includes maritime situation with port tag', () => {
    const sit = makeSituation({ domain: 'maritime', tags: ['port', 'strike'] });
    const result = derivePortDisruptions([sit]);
    assert.equal(result.length, 1);
  });

  it('includes maritime situation with congestion tag', () => {
    const sit = makeSituation({ domain: 'maritime', tags: ['congestion'] });
    const result = derivePortDisruptions([sit]);
    assert.equal(result.length, 1);
  });

  it('includes maritime situation with port in title', () => {
    const sit = makeSituation({ domain: 'maritime', name: 'Los Angeles port backlog' });
    const result = derivePortDisruptions([sit]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Los Angeles port backlog');
  });

  it('excludes situations from non-maritime domains', () => {
    const sit = makeSituation({ domain: 'economic', tags: ['port'] });
    const result = derivePortDisruptions([sit]);
    assert.deepEqual(result, []);
  });
});
