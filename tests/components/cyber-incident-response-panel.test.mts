/**
 * Tests for CyberIncidentResponsePanel — pure helpers + derivations.
 *
 * Run with:
 *   npx tsx --test tests/components/cyber-incident-response-panel.test.mts
 *
 * No DOM required — helpers are exported from
 * `cyber-incident-helpers.ts` for testability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apTActivityColor,
  apTActivityLabel,
  computeIncidentScore,
  countCriticalIcsIndicators,
  countImminentApT,
  deriveCveExploits,
  icsSectorLabel,
  intelFeedColor,
  levelForScore,
  ransomwareTrendArrow,
  ransomwareTrendColor,
  severityColor,
  severityLabel,
  sumHighSeverityFeedIndicators,
  timeAgo,
  totalRansomwareVictims7d,
  APT_GROUPS,
  ICS_INDICATORS_BASE,
  INTEL_FEEDS_BASE,
  RANSOMWARE_CAMPAIGNS,
  type ApTActivity,
  type IcsIndicator,
  type IcsSector,
  type IncidentSeverity,
  type IntelFeedSource,
  type RansomwareCampaign,
  type RansomwareTrend,
} from '../../src/components/cyber-incident-helpers.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';

const NOW = 1_745_000_000_000;

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'o-1',
    sourceId: 'test',
    domain: 'cyber',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'fixture',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Color + label helpers ────────────────────────────────────────────

test('severityColor: critical returns red', () => {
  assert.ok(severityColor('critical').includes('#ef4444'));
});

test('severityLabel: covers all four levels with distinct strings', () => {
  const levels: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
  const set = new Set(levels.map((l) => severityLabel(l)));
  assert.equal(set.size, 4);
});

test('apTActivityColor: imminent returns red', () => {
  assert.ok(apTActivityColor('imminent').includes('#ef4444'));
});

test('apTActivityLabel: covers all four activity levels', () => {
  const levels: ApTActivity[] = ['dormant', 'active', 'campaign', 'imminent'];
  for (const l of levels) assert.ok(apTActivityLabel(l).length > 0);
});

test('icsSectorLabel: returns human-readable per sector', () => {
  const sectors: IcsSector[] = ['energy', 'water', 'health', 'financial', 'transport', 'comms', 'manufacturing'];
  const labels = new Set(sectors.map((s) => icsSectorLabel(s)));
  assert.equal(labels.size, sectors.length);
});

test('ransomwareTrendArrow: rising/falling/flat distinct symbols', () => {
  const set = new Set([
    ransomwareTrendArrow('rising'),
    ransomwareTrendArrow('falling'),
    ransomwareTrendArrow('flat'),
  ]);
  assert.equal(set.size, 3);
});

test('ransomwareTrendColor: rising red, falling green, flat grey', () => {
  assert.ok(ransomwareTrendColor('rising').includes('#ef4444'));
  assert.ok(ransomwareTrendColor('falling').includes('#4caf50'));
  assert.ok(ransomwareTrendColor('flat').includes('#9e9e9e'));
});

test('intelFeedColor: CISA-KEV stays red, OTX uses accent', () => {
  assert.ok(intelFeedColor('CISA-KEV').includes('#ef4444'));
  assert.ok(intelFeedColor('OTX').includes('#4a9eff'));
});

test('intelFeedColor: covers all five sources', () => {
  const sources: IntelFeedSource[] = ['CISA-KEV', 'OTX', 'AbuseIPDB', 'NVD', 'MISP'];
  const set = new Set(sources.map((s) => intelFeedColor(s)));
  assert.equal(set.size, sources.length);
});

// ── timeAgo ──────────────────────────────────────────────────────────

test('timeAgo: <60s returns "now"', () => {
  assert.equal(timeAgo(NOW - 30_000, NOW), 'now');
});

test('timeAgo: minutes returns "Xm ago"', () => {
  assert.equal(timeAgo(NOW - 5 * 60_000, NOW), '5m ago');
});

test('timeAgo: hours returns "Xh ago"', () => {
  assert.equal(timeAgo(NOW - 3 * 60 * 60_000, NOW), '3h ago');
});

test('timeAgo: days returns "Xd ago"', () => {
  assert.equal(timeAgo(NOW - 2 * 24 * 60 * 60_000, NOW), '2d ago');
});

test('timeAgo: future timestamp returns "future"', () => {
  assert.equal(timeAgo(NOW + 5_000, NOW), 'future');
});

// ── levelForScore ────────────────────────────────────────────────────

test('levelForScore: thresholds map per spec', () => {
  assert.equal(levelForScore(0), 'low');
  assert.equal(levelForScore(24), 'low');
  assert.equal(levelForScore(25), 'medium');
  assert.equal(levelForScore(49), 'medium');
  assert.equal(levelForScore(50), 'high');
  assert.equal(levelForScore(74), 'high');
  assert.equal(levelForScore(75), 'critical');
  assert.equal(levelForScore(100), 'critical');
});

// ── computeIncidentScore ─────────────────────────────────────────────

test('computeIncidentScore: empty input yields zero score and low level', () => {
  const score = computeIncidentScore({
    activeExploits: 0, ransomwareVictims7d: 0, imminentAptGroups: 0,
    criticalIcsIndicators: 0, highSeverityFeedIndicators: 0,
  });
  assert.equal(score.total, 0);
  assert.equal(score.level, 'low');
});

test('computeIncidentScore: saturates each contribution at its weight', () => {
  const score = computeIncidentScore({
    activeExploits: 999,
    ransomwareVictims7d: 9_999,
    imminentAptGroups: 999,
    criticalIcsIndicators: 999,
    highSeverityFeedIndicators: 9_999,
  });
  assert.equal(score.total, 100);
  assert.equal(score.level, 'critical');
  assert.equal(score.contributions.activeExploits, 30);
  assert.equal(score.contributions.ransomware, 20);
  assert.equal(score.contributions.apt, 20);
  assert.equal(score.contributions.ics, 20);
  assert.equal(score.contributions.feedActivity, 10);
});

test('computeIncidentScore: weights sum to 100', () => {
  const score = computeIncidentScore({
    activeExploits: 999, ransomwareVictims7d: 9_999, imminentAptGroups: 999,
    criticalIcsIndicators: 999, highSeverityFeedIndicators: 9_999,
  });
  const sum = Object.values(score.contributions).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('computeIncidentScore: half-weight on each axis lands in medium band', () => {
  const score = computeIncidentScore({
    activeExploits: 5,                    // 50% of 30 = 15
    ransomwareVictims7d: 25,              // 50% of 20 = 10
    imminentAptGroups: 2,                 // 40% of 20 = 8
    criticalIcsIndicators: 5,             // 50% of 20 = 10
    highSeverityFeedIndicators: 100,      // 50% of 10 = 5
  });
  // Sum: ~48 → high-end medium
  assert.ok(score.total >= 40 && score.total < 50);
  assert.equal(score.level, 'medium');
});

test('computeIncidentScore: contributions never negative', () => {
  const score = computeIncidentScore({
    activeExploits: -5, ransomwareVictims7d: -5, imminentAptGroups: -5,
    criticalIcsIndicators: -5, highSeverityFeedIndicators: -5,
  });
  for (const v of Object.values(score.contributions)) assert.ok(v >= 0);
});

// ── countCriticalIcsIndicators ───────────────────────────────────────

test('countCriticalIcsIndicators: counts only last-7d critical entries', () => {
  const indicators: IcsIndicator[] = [
    { sector: 'energy', region: 'X', observedTtps: [], severity: 'critical', detectedAt: NOW - 1 * 24 * 60 * 60_000 },
    { sector: 'water',  region: 'X', observedTtps: [], severity: 'critical', detectedAt: NOW - 8 * 24 * 60 * 60_000 }, // too old
    { sector: 'health', region: 'X', observedTtps: [], severity: 'high',     detectedAt: NOW - 1 * 24 * 60 * 60_000 }, // not critical
  ];
  assert.equal(countCriticalIcsIndicators(indicators, NOW), 1);
});

// ── totalRansomwareVictims7d ────────────────────────────────────────

test('totalRansomwareVictims7d: sums victimsLast7d across all campaigns', () => {
  const campaigns: RansomwareCampaign[] = [
    { group: 'A', victimsLast7d: 5,  victimsLast30d: 10, primarySector: 'energy', trend: 'flat' },
    { group: 'B', victimsLast7d: 7,  victimsLast30d: 20, primarySector: 'health', trend: 'rising' },
  ];
  assert.equal(totalRansomwareVictims7d(campaigns), 12);
});

test('totalRansomwareVictims7d: empty array returns 0', () => {
  assert.equal(totalRansomwareVictims7d([]), 0);
});

// ── countImminentApT ────────────────────────────────────────────────

test('countImminentApT: counts only imminent activity', () => {
  const groups = [
    { name: 'A', attribution: '', primaryTargets: [] as IcsSector[], activity: 'imminent' as ApTActivity, recentEventCount: 1, notableTtps: [] },
    { name: 'B', attribution: '', primaryTargets: [] as IcsSector[], activity: 'campaign' as ApTActivity, recentEventCount: 1, notableTtps: [] },
    { name: 'C', attribution: '', primaryTargets: [] as IcsSector[], activity: 'imminent' as ApTActivity, recentEventCount: 1, notableTtps: [] },
  ];
  assert.equal(countImminentApT(groups), 2);
});

// ── sumHighSeverityFeedIndicators ───────────────────────────────────

test('sumHighSeverityFeedIndicators: applies share per source', () => {
  const feeds = [
    { source: 'CISA-KEV' as IntelFeedSource, newIndicators: 10, highSeverityShare: 1, lastFetchedAt: NOW },
    { source: 'OTX' as IntelFeedSource,      newIndicators: 100, highSeverityShare: 0.25, lastFetchedAt: NOW },
  ];
  assert.equal(sumHighSeverityFeedIndicators(feeds), 10 + 25);
});

// ── deriveCveExploits ───────────────────────────────────────────────

test('deriveCveExploits: ignores non-cyber domain events', () => {
  assert.equal(deriveCveExploits([obs({ domain: 'finance', title: 'CVE-2024-12345' })], NOW).length, 0);
});

test('deriveCveExploits: ignores events without a CVE id', () => {
  assert.equal(deriveCveExploits([obs({ title: 'router compromise' })], NOW).length, 0);
});

test('deriveCveExploits: extracts CVE id from title regex', () => {
  const rows = deriveCveExploits([obs({ title: 'Exploit for CVE-2024-12345 found' })], NOW);
  assert.equal(rows[0]?.cveId, 'CVE-2024-12345');
});

test('deriveCveExploits: extracts CVE id from cve: tag', () => {
  const rows = deriveCveExploits([obs({ title: 'router compromise', tags: ['cve:CVE-2024-99999'] })], NOW);
  assert.equal(rows[0]?.cveId, 'CVE-2024-99999');
});

test('deriveCveExploits: dedupes identical CVE ids', () => {
  const events = [
    obs({ id: 'a', title: 'CVE-2024-12345 first', timestamp: NOW - 1_000 }),
    obs({ id: 'b', title: 'CVE-2024-12345 second', timestamp: NOW - 500 }),
  ];
  assert.equal(deriveCveExploits(events, NOW).length, 1);
});

test('deriveCveExploits: skips events older than 14 days', () => {
  const events = [obs({ title: 'CVE-2024-12345', timestamp: NOW - 15 * 24 * 60 * 60_000 })];
  assert.equal(deriveCveExploits(events, NOW).length, 0);
});

test('deriveCveExploits: marks KEV-tagged CVEs', () => {
  const rows = deriveCveExploits([obs({ title: 'CVE-2024-12345', tags: ['kev'] })], NOW);
  assert.equal(rows[0]?.inKevCatalog, true);
});

test('deriveCveExploits: marks "in-the-wild" tagged CVEs', () => {
  const rows = deriveCveExploits([obs({ title: 'CVE-2024-12345', tags: ['in-the-wild'] })], NOW);
  assert.equal(rows[0]?.exploitedInWild, true);
});

test('deriveCveExploits: caps at 12 rows', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    obs({ id: `e-${i}`, title: `CVE-2024-${10_000 + i}`, timestamp: NOW - 60_000 - i }),
  );
  assert.equal(deriveCveExploits(events, NOW).length, 12);
});

test('deriveCveExploits: prefers exploited-in-the-wild then CVSS-desc', () => {
  const events = [
    obs({ id: 'a', title: 'CVE-2024-00001', tags: [],                raw: { cvss: 9.5 } }),
    obs({ id: 'b', title: 'CVE-2024-00002', tags: ['in-the-wild'],   raw: { cvss: 5.0 } }),
    obs({ id: 'c', title: 'CVE-2024-00003', tags: ['in-the-wild'],   raw: { cvss: 8.0 } }),
  ];
  const rows = deriveCveExploits(events, NOW);
  assert.equal(rows[0]!.cveId, 'CVE-2024-00003');   // wild + higher cvss
  assert.equal(rows[1]!.cveId, 'CVE-2024-00002');   // wild but lower cvss
  assert.equal(rows[2]!.cveId, 'CVE-2024-00001');   // not wild, even with cvss 9.5
});

test('deriveCveExploits: uses raw.cvss when provided', () => {
  const rows = deriveCveExploits([obs({ title: 'CVE-2024-12345', raw: { cvss: 9.8 } })], NOW);
  assert.equal(rows[0]?.cvssScore, 9.8);
});

test('deriveCveExploits: falls back to severity-derived CVSS when raw.cvss missing', () => {
  const rows = deriveCveExploits([obs({ title: 'CVE-2024-12345', severity: 'CRITICAL' })], NOW);
  assert.equal(rows[0]?.cvssScore, 9.5);
});

test('deriveCveExploits: pulls product + vendor from raw payload', () => {
  const rows = deriveCveExploits([obs({
    title: 'CVE-2024-12345', raw: { vendor: 'AcmeCorp', product: 'Acme Web' },
  })], NOW);
  assert.equal(rows[0]?.vendor, 'AcmeCorp');
  assert.equal(rows[0]?.product, 'Acme Web');
});

// ── Static catalogues ───────────────────────────────────────────────

test('APT_GROUPS includes Volt Typhoon and Sandworm', () => {
  const names = APT_GROUPS.map((g) => g.name);
  assert.ok(names.includes('Volt Typhoon'));
  assert.ok(names.includes('Sandworm'));
});

test('APT_GROUPS: each group has at least one notableTtp', () => {
  for (const g of APT_GROUPS) assert.ok(g.notableTtps.length > 0, `${g.name} has no TTPs`);
});

test('RANSOMWARE_CAMPAIGNS: includes LockBit and ALPHV/BlackCat', () => {
  const groups = RANSOMWARE_CAMPAIGNS.map((c) => c.group);
  assert.ok(groups.includes('LockBit'));
  assert.ok(groups.includes('ALPHV/BlackCat'));
});

test('RANSOMWARE_CAMPAIGNS: trend values are all valid', () => {
  const valid = new Set<RansomwareTrend>(['rising', 'falling', 'flat']);
  for (const c of RANSOMWARE_CAMPAIGNS) assert.ok(valid.has(c.trend));
});

test('ICS_INDICATORS_BASE: every entry includes a sector and severity', () => {
  for (const i of ICS_INDICATORS_BASE) {
    assert.ok(i.sector.length > 0);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(i.severity));
  }
});

test('INTEL_FEEDS_BASE: covers all five canonical sources', () => {
  const sources = new Set(INTEL_FEEDS_BASE.map((f) => f.source));
  for (const s of ['CISA-KEV', 'OTX', 'AbuseIPDB', 'NVD', 'MISP']) {
    assert.ok(sources.has(s as IntelFeedSource));
  }
});

test('INTEL_FEEDS_BASE: highSeverityShare is in [0, 1] for every feed', () => {
  for (const f of INTEL_FEEDS_BASE) {
    assert.ok(f.highSeverityShare >= 0 && f.highSeverityShare <= 1);
  }
});
