/**
 * CyberSuperpowerPanel — pure-helper unit tests.
 *
 * No DOM, no fetch: each test calls the exported helper with fixture
 * ObservationEvent / Situation / Entity records and asserts the
 * returned view-model. The renderer is exercised through the
 * exported renderCyberSuperpowerHtml() function so the panel logic is
 * fully covered without spinning up Panel base-class machinery.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeThreatLevel,
  buildActiveCampaigns,
  buildInfrastructureExposure,
  buildZeroDayWatch,
  buildAttributionSignals,
  renderCyberSuperpowerHtml,
  obsSeverityScore,
  situationSeverityScore,
} from '../../src/components/cyber-superpower-helpers.ts';
import type {
  ObservationEvent,
  ObservationSeverity,
  Situation,
} from '../../src/types/intelligence.ts';
import type { Entity } from '../../src/services/intelligence/entity-registry.ts';

const NOW = 1_748_000_000_000;
const H = 3_600_000;

function makeEvent(o: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: o.id ?? 'ev-1',
    sourceId: o.sourceId ?? 'pulsedive',
    domain: o.domain ?? 'cyber',
    timestamp: o.timestamp ?? NOW,
    severity: o.severity ?? 'MEDIUM',
    title: o.title ?? 'test event',
    raw: o.raw ?? {},
    entityIds: o.entityIds ?? [],
    tags: o.tags ?? [],
    location: o.location,
  };
}

function makeSituation(o: Partial<Situation> = {}): Situation {
  return {
    id: o.id ?? 'sit-1',
    name: o.name ?? 'Cyber campaign',
    status: o.status ?? 'active',
    severity: o.severity ?? 'moderate',
    domain: o.domain ?? 'cyber',
    startedAt: o.startedAt ?? NOW - H,
    updatedAt: o.updatedAt ?? NOW,
    observationIds: o.observationIds ?? ['ev-1', 'ev-2'],
    correlationIds: o.correlationIds ?? [],
    summary: o.summary ?? 'A test cyber campaign',
    location: o.location,
    tags: o.tags ?? [],
    confidence: o.confidence ?? 0.7,
  };
}

function makeEntity(o: Partial<Entity> = {}): Entity {
  return {
    id: o.id ?? 'ent-1',
    type: o.type ?? 'organization',
    canonicalName: o.canonicalName ?? 'APT29',
    aliases: o.aliases ?? [],
    identifiers: o.identifiers ?? {},
    domains: o.domains ?? ['cyber'],
    riskScore: o.riskScore ?? 0.5,
    lastSeen: o.lastSeen ?? NOW - H,
    attributes: o.attributes ?? {},
  };
}

// ── severity score helpers ──────────────────────────────────────────

describe('severity score helpers', () => {
  it('maps observation severities to numeric scores monotonically', () => {
    const order: ObservationSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const scores = order.map(obsSeverityScore);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i]! > scores[i - 1]!);
    }
  });

  it('maps situation severities to numeric scores monotonically', () => {
    const order: Situation['severity'][] = ['info', 'low', 'moderate', 'high', 'critical'];
    const scores = order.map(situationSeverityScore);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i]! > scores[i - 1]!);
    }
  });
});

// ── computeThreatLevel ─────────────────────────────────────────────

describe('computeThreatLevel', () => {
  it('returns low / 0 / 0 for empty input', () => {
    const r = computeThreatLevel([]);
    assert.equal(r.level, 'low');
    assert.equal(r.score, 0);
    assert.equal(r.eventCount, 0);
  });

  it('classifies critical when peak severity is CRITICAL', () => {
    const r = computeThreatLevel([
      makeEvent({ severity: 'CRITICAL' }),
      makeEvent({ severity: 'HIGH' }),
    ]);
    assert.equal(r.level, 'critical');
    assert.equal(r.maxSeverity, 'CRITICAL');
  });

  it('classifies elevated when only mid-severity events fire', () => {
    const r = computeThreatLevel([
      makeEvent({ severity: 'MEDIUM' }),
      makeEvent({ severity: 'MEDIUM' }),
    ]);
    assert.equal(r.level, 'elevated');
    assert.ok(r.score >= 35 && r.score < 60, `score=${r.score} out of elevated band`);
  });

  it('counts events and computes mean across severities', () => {
    const r = computeThreatLevel([
      makeEvent({ severity: 'LOW' }),
      makeEvent({ severity: 'HIGH' }),
    ]);
    assert.equal(r.eventCount, 2);
    assert.equal(r.meanScore, 4.5);
  });
});

// ── buildActiveCampaigns ───────────────────────────────────────────

describe('buildActiveCampaigns', () => {
  it('filters out non-active situations', () => {
    const out = buildActiveCampaigns([
      makeSituation({ id: 'a', status: 'active' }),
      makeSituation({ id: 'b', status: 'monitoring' }),
      makeSituation({ id: 'c', status: 'resolved' }),
    ]);
    assert.deepEqual(out.map((c) => c.id), ['a']);
  });

  it('sorts by severity desc then by startedAt desc', () => {
    const out = buildActiveCampaigns([
      makeSituation({ id: 'low', severity: 'low', startedAt: NOW - 2 * H }),
      makeSituation({ id: 'crit', severity: 'critical', startedAt: NOW - 4 * H }),
      makeSituation({ id: 'high-new', severity: 'high', startedAt: NOW - H }),
      makeSituation({ id: 'high-old', severity: 'high', startedAt: NOW - 5 * H }),
    ]);
    assert.deepEqual(out.map((c) => c.id), ['crit', 'high-new', 'high-old', 'low']);
  });

  it('caps at the requested limit', () => {
    const list = Array.from({ length: 12 }, (_, i) =>
      makeSituation({ id: `s${i}`, startedAt: NOW - i * H }));
    assert.equal(buildActiveCampaigns(list, 5).length, 5);
  });

  it('derives a continental region label from location', () => {
    const out = buildActiveCampaigns([
      makeSituation({ id: 'a', location: { lat: 50, lon: 10, radiusKm: 10 } }),
      makeSituation({ id: 'b' }),
    ]);
    const a = out.find((c) => c.id === 'a');
    const b = out.find((c) => c.id === 'b');
    assert.equal(a?.region, 'Europe');
    assert.equal(b?.region, undefined);
  });

  it('falls back to id when name is empty', () => {
    const out = buildActiveCampaigns([makeSituation({ id: 'fallback', name: '' })]);
    assert.equal(out[0]?.title, 'fallback');
  });
});

// ── buildInfrastructureExposure ────────────────────────────────────

describe('buildInfrastructureExposure', () => {
  it('classifies events by tag into bgp / dns / target buckets', () => {
    const exposure = buildInfrastructureExposure([
      makeEvent({ id: 'b1', tags: ['bgp-hijack'] }),
      makeEvent({ id: 'b2', tags: ['bgp-anomaly'] }),
      makeEvent({ id: 'd1', tags: ['dns-anomaly'] }),
      makeEvent({ id: 't1', tags: ['infrastructure-target'], entityIds: ['cf-network'] }),
      makeEvent({ id: 'x', tags: ['unrelated'] }),
    ]);
    assert.equal(exposure.bgpHijackCount, 2);
    assert.equal(exposure.dnsAnomalyCount, 1);
    assert.equal(exposure.targetedAssetCount, 1);
    assert.equal(exposure.signals.length, 4);
  });

  it('orders signals by severity desc then timestamp desc', () => {
    const exposure = buildInfrastructureExposure([
      makeEvent({ id: 'a', tags: ['dns-anomaly'], severity: 'LOW', timestamp: NOW }),
      makeEvent({ id: 'b', tags: ['bgp-hijack'], severity: 'CRITICAL', timestamp: NOW - H }),
      makeEvent({ id: 'c', tags: ['bgp-anomaly'], severity: 'HIGH', timestamp: NOW }),
    ]);
    assert.deepEqual(exposure.signals.map((s) => s.kind), ['bgp-hijack', 'bgp-hijack', 'dns-anomaly']);
    assert.equal(exposure.signals[0]?.title, 'test event');
  });

  it('counts top targets by entityId for target-hit events', () => {
    const exposure = buildInfrastructureExposure([
      makeEvent({ tags: ['infrastructure-target'], entityIds: ['cf-network', 'akamai'] }),
      makeEvent({ tags: ['infrastructure-target'], entityIds: ['cf-network'] }),
      makeEvent({ tags: ['dns-anomaly'], entityIds: ['cf-network'] }), // not a target hit
    ]);
    const top = exposure.topTargets;
    assert.equal(top[0]?.entity, 'cf-network');
    assert.equal(top[0]?.count, 2);
    assert.ok(top.some((t) => t.entity === 'akamai' && t.count === 1));
  });

  it('returns zero counts when no infrastructure tags are present', () => {
    const exposure = buildInfrastructureExposure([
      makeEvent({ tags: ['malware'] }),
      makeEvent({ tags: ['phishing'] }),
    ]);
    assert.equal(exposure.bgpHijackCount, 0);
    assert.equal(exposure.dnsAnomalyCount, 0);
    assert.equal(exposure.targetedAssetCount, 0);
    assert.equal(exposure.signals.length, 0);
  });
});

// ── buildZeroDayWatch ──────────────────────────────────────────────

describe('buildZeroDayWatch', () => {
  it('picks up CVE-tagged events', () => {
    const out = buildZeroDayWatch([
      makeEvent({ id: 'a', tags: ['cve'], title: 'Critical RCE in nginx', severity: 'HIGH' }),
      makeEvent({ id: 'b', tags: ['malware'] }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, 'a');
  });

  it('extracts CVE id from entityIds when present', () => {
    const out = buildZeroDayWatch([
      makeEvent({ entityIds: ['CVE-2026-12345', 'nginx'], title: 'unspecified RCE' }),
    ]);
    assert.equal(out[0]?.cveId, 'CVE-2026-12345');
    assert.deepEqual(out[0]?.affectedProducts, ['nginx']);
  });

  it('extracts CVE id from title when entities lack it', () => {
    const out = buildZeroDayWatch([
      makeEvent({ tags: ['cve'], title: 'CVE-2026-99999 patches dropped', entityIds: [] }),
    ]);
    assert.equal(out[0]?.cveId, 'CVE-2026-99999');
  });

  it('flags KEV status when tags or entities include KEV markers', () => {
    const out = buildZeroDayWatch([
      makeEvent({ id: 'kev', tags: ['cisa-kev'], title: 'Exchange RCE' }),
      makeEvent({ id: 'plain', tags: ['cve'], title: 'minor patch' }),
    ]);
    const kev = out.find((z) => z.id === 'kev');
    const plain = out.find((z) => z.id === 'plain');
    assert.equal(kev?.inKev, true);
    assert.equal(plain?.inKev, false);
  });

  it('orders zero-days by severity then timestamp', () => {
    const out = buildZeroDayWatch([
      makeEvent({ id: 'low', tags: ['cve'], severity: 'LOW', timestamp: NOW }),
      makeEvent({ id: 'crit', tags: ['cve'], severity: 'CRITICAL', timestamp: NOW - H }),
      makeEvent({ id: 'med', tags: ['cve'], severity: 'MEDIUM', timestamp: NOW }),
    ]);
    assert.deepEqual(out.map((z) => z.id), ['crit', 'med', 'low']);
  });

  it('returns CVSS hint from severity score', () => {
    const out = buildZeroDayWatch([
      makeEvent({ tags: ['cve'], severity: 'CRITICAL' }),
      makeEvent({ tags: ['cve'], severity: 'INFO' }),
    ]);
    assert.equal(out[0]?.cvss, 9);
    assert.equal(out[1]?.cvss, undefined);
  });
});

// ── buildAttributionSignals ────────────────────────────────────────

describe('buildAttributionSignals', () => {
  it('matches actors by APT-pattern canonical name', () => {
    const r = buildAttributionSignals(
      [makeEntity({ canonicalName: 'APT29' }), makeEntity({ id: 'plain', canonicalName: 'Some Org' })],
      [],
    );
    assert.equal(r.actors.length, 1);
    assert.equal(r.actors[0]?.name, 'APT29');
  });

  it('matches actors by attribute flag actor=true', () => {
    const r = buildAttributionSignals(
      [makeEntity({ canonicalName: 'Group X', attributes: { actor: true } })],
      [],
    );
    assert.equal(r.actors.length, 1);
  });

  it('matches actors by mitre-attack-group identifier', () => {
    const r = buildAttributionSignals(
      [makeEntity({ canonicalName: 'Cozy Bear', identifiers: { 'mitre-attack-group': 'G0016' } })],
      [],
    );
    assert.equal(r.actors.length, 1);
  });

  it('counts campaigns by matching events to actor id / name / aliases (case-insensitive)', () => {
    const actor = makeEntity({
      id: 'apt29',
      canonicalName: 'APT29',
      aliases: ['Cozy Bear', 'Nobelium'],
    });
    const events: ObservationEvent[] = [
      makeEvent({ id: 'e1', entityIds: ['apt29'] }),
      makeEvent({ id: 'e2', entityIds: ['cozy bear'] }),
      makeEvent({ id: 'e3', entityIds: ['nobelium'] }),
      makeEvent({ id: 'e4', entityIds: ['other'] }),
    ];
    const r = buildAttributionSignals([actor], events);
    assert.equal(r.actors[0]?.campaignCount, 3);
  });

  it('aggregates top sectors across actors with sector: tags', () => {
    const actor = makeEntity({ canonicalName: 'APT77' });
    const events = [
      makeEvent({ entityIds: ['apt77'], tags: ['sector:finance'] }),
      makeEvent({ entityIds: ['apt77'], tags: ['sector:energy', 'sector:finance'] }),
    ];
    const r = buildAttributionSignals([actor], events);
    assert.ok(r.actors[0]?.targetedSectors.includes('finance'));
    assert.ok(r.actors[0]?.targetedSectors.includes('energy'));
    assert.equal(r.topSectors[0]?.sector, 'energy'); // sorted by count desc, ties by alpha
  });

  it('uses event.timestamp for lastSeenAt when events match', () => {
    const actor = makeEntity({ canonicalName: 'APT78', lastSeen: NOW - 10 * H });
    const events = [
      makeEvent({ entityIds: ['apt78'], timestamp: NOW - H }),
      makeEvent({ entityIds: ['apt78'], timestamp: NOW - 5 * H }),
    ];
    const r = buildAttributionSignals([actor], events);
    assert.equal(r.actors[0]?.lastSeenAt, NOW - H);
  });

  it('falls back to entity.lastSeen when no events match', () => {
    const actor = makeEntity({ canonicalName: 'APT79', lastSeen: NOW - 3 * H });
    const r = buildAttributionSignals([actor], []);
    assert.equal(r.actors[0]?.lastSeenAt, NOW - 3 * H);
  });

  it('reads confidence from attributes with 0.5 default', () => {
    const a = makeEntity({ canonicalName: 'APT80', attributes: { confidence: 0.8 } });
    const b = makeEntity({ canonicalName: 'APT81' });
    const r = buildAttributionSignals([a, b], []);
    const ra = r.actors.find((x) => x.name === 'APT80');
    const rb = r.actors.find((x) => x.name === 'APT81');
    assert.equal(ra?.confidence, 0.8);
    assert.equal(rb?.confidence, 0.5);
  });

  it('caps the actor list at the requested limit', () => {
    const list = Array.from({ length: 10 }, (_, i) =>
      makeEntity({ id: `apt${i}`, canonicalName: `APT${i}` }));
    const r = buildAttributionSignals(list, [], 4);
    assert.equal(r.actors.length, 4);
  });

  it('ignores non-cyber observation events when counting campaigns', () => {
    const actor = makeEntity({ canonicalName: 'APT82' });
    const events = [
      makeEvent({ entityIds: ['apt82'], domain: 'cyber' }),
      makeEvent({ entityIds: ['apt82'], domain: 'weather' }),
    ];
    const r = buildAttributionSignals([actor], events);
    assert.equal(r.actors[0]?.campaignCount, 1);
  });
});

// ── renderCyberSuperpowerHtml (DOM-free smoke) ─────────────────────

describe('renderCyberSuperpowerHtml', () => {
  it('renders all 5 section headings even when data is empty', () => {
    const html = renderCyberSuperpowerHtml({
      threat: computeThreatLevel([]),
      campaigns: [],
      exposure: buildInfrastructureExposure([]),
      zeroDays: [],
      attribution: buildAttributionSignals([], []),
      generatedAt: NOW,
    });
    for (const heading of [
      'Threat Level Gauge',
      'Active Campaign Tracker',
      'Infrastructure Exposure Map',
      'Zero-Day Watch',
      'Attribution Signals',
    ]) {
      assert.ok(html.includes(heading), `missing heading: ${heading}`);
    }
  });

  it('includes the threat level chip in uppercase', () => {
    const html = renderCyberSuperpowerHtml({
      threat: computeThreatLevel([makeEvent({ severity: 'CRITICAL' })]),
      campaigns: [],
      exposure: buildInfrastructureExposure([]),
      zeroDays: [],
      attribution: buildAttributionSignals([], []),
      generatedAt: NOW,
    });
    assert.ok(html.includes('critical'));
  });

  it('shows campaign titles when campaigns are present', () => {
    const html = renderCyberSuperpowerHtml({
      threat: computeThreatLevel([]),
      campaigns: buildActiveCampaigns([
        makeSituation({ id: 's1', name: 'Solar Spider campaign', severity: 'high' }),
      ]),
      exposure: buildInfrastructureExposure([]),
      zeroDays: [],
      attribution: buildAttributionSignals([], []),
      generatedAt: NOW,
    });
    assert.ok(html.includes('Solar Spider campaign'));
  });

  it('escapes user-influenced campaign titles', () => {
    const html = renderCyberSuperpowerHtml({
      threat: computeThreatLevel([]),
      campaigns: buildActiveCampaigns([
        makeSituation({ id: 's1', name: '<script>x</script>' }),
      ]),
      exposure: buildInfrastructureExposure([]),
      zeroDays: [],
      attribution: buildAttributionSignals([], []),
      generatedAt: NOW,
    });
    assert.ok(!html.includes('<script>x</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('marks KEV zero-days with a KEV badge', () => {
    const html = renderCyberSuperpowerHtml({
      threat: computeThreatLevel([]),
      campaigns: [],
      exposure: buildInfrastructureExposure([]),
      zeroDays: buildZeroDayWatch([
        makeEvent({ tags: ['cisa-kev'], title: 'CVE-2026-1 Exchange RCE' }),
      ]),
      attribution: buildAttributionSignals([], []),
      generatedAt: NOW,
    });
    assert.ok(html.includes('KEV'));
    assert.ok(html.includes('CVE-2026-1'));
  });
});
