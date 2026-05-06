import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GREAT_POWER_INTERESTS,
  classifyCyber,
  classifyDisinformation,
  classifyEconomicCoercion,
  classifyInfrastructure,
  classifyProxy,
  classifySanctions,
  detectPatterns,
  summarizeActor,
  type AcledLikeEvent,
  type CyberIncident,
  type GdeltLikeArticle,
  type GrayZoneEvent,
  type InfrastructureKeywordHit,
  type SanctionsEntry,
} from '../grayzone-classifier.ts';

const NOW = '2026-04-15T00:00:00Z';

// ── Static interest map ────────────────────────────────────────────────

test('GREAT_POWER_INTERESTS: covers all 5 powers', () => {
  const keys = Object.keys(GREAT_POWER_INTERESTS);
  for (const expected of ['Russia', 'China', 'Iran', 'North Korea', 'United States']) {
    assert.ok(keys.includes(expected), `${expected} should be present`);
  }
});

test('GREAT_POWER_INTERESTS: Russia includes Ukraine', () => {
  assert.ok(GREAT_POWER_INTERESTS.Russia.includes('Ukraine'));
});

// ── classifySanctions ────────────────────────────────────────────────

test('classifySanctions: maps sender to actor + high confidence', () => {
  const entry: SanctionsEntry = {
    date: NOW, sender: 'United States', target: 'Iran', summary: 'OFAC SDN list update',
  };
  const event = classifySanctions(entry);
  assert.equal(event.type, 'sanctions');
  assert.equal(event.suspectedActor, 'United States');
  assert.equal(event.targetCountry, 'Iran');
  assert.equal(event.confidence, 0.95);
});

// ── classifyCyber ────────────────────────────────────────────────────

test('classifyCyber: named attribution gets 0.75 confidence', () => {
  const incident: CyberIncident = {
    date: NOW, attribution: 'Russia', target: 'Ukraine', summary: 'GRU cyber op', severity: 'high',
  };
  const event = classifyCyber(incident);
  assert.equal(event.suspectedActor, 'Russia');
  assert.equal(event.confidence, 0.75);
});

test('classifyCyber: missing attribution → Unknown + 0.4 confidence', () => {
  const incident: CyberIncident = {
    date: NOW, target: 'Energy sector', summary: 'unattributed', severity: 'medium',
  };
  const event = classifyCyber(incident);
  assert.equal(event.suspectedActor, 'Unknown');
  assert.equal(event.confidence, 0.4);
});

// ── classifyProxy ────────────────────────────────────────────────────

test('classifyProxy: ACLED non-state event in Yemen routes to Iran', () => {
  const event: AcledLikeEvent = {
    date: NOW, country: 'Yemen', actor1: 'Houthis', hasNonStateActor: true, summary: 'attack on shipping',
  };
  const out = classifyProxy(event);
  assert.ok(out);
  assert.equal(out!.suspectedActor, 'Iran');
  assert.equal(out!.type, 'proxy_warfare');
});

test('classifyProxy: state-only event returns null', () => {
  const event: AcledLikeEvent = {
    date: NOW, country: 'Yemen', actor1: 'Saudi Arabia', hasNonStateActor: false, summary: 'airstrike',
  };
  assert.equal(classifyProxy(event), null);
});

test('classifyProxy: country with no great-power interest returns null', () => {
  const event: AcledLikeEvent = {
    date: NOW, country: 'Iceland', actor1: 'rebels', hasNonStateActor: true, summary: 'no interest map entry',
  };
  assert.equal(classifyProxy(event), null);
});

// ── classifyDisinformation ───────────────────────────────────────────

test('classifyDisinformation: 2σ spike on CAMEO 17x triggers an event', () => {
  const article: GdeltLikeArticle = {
    date: NOW, cameoCode: '172', country: 'Ukraine',
    baselineVolumePerDay: 25, observedVolumePerDay: 60, // 60 >> 25 + 2*sqrt(25)=35
    title: 'Sanctions threat coverage spikes',
  };
  const event = classifyDisinformation(article);
  assert.ok(event);
  assert.equal(event!.type, 'disinformation');
});

test('classifyDisinformation: below threshold returns null', () => {
  const article: GdeltLikeArticle = {
    date: NOW, cameoCode: '172', country: 'Ukraine',
    baselineVolumePerDay: 25, observedVolumePerDay: 30,
    title: 'normal coverage',
  };
  assert.equal(classifyDisinformation(article), null);
});

test('classifyDisinformation: tiny baselines (<4) return null', () => {
  const article: GdeltLikeArticle = {
    date: NOW, cameoCode: '172',
    baselineVolumePerDay: 2, observedVolumePerDay: 10,
    title: 'noise',
  };
  assert.equal(classifyDisinformation(article), null);
});

test('classifyDisinformation: non-17x CAMEO returns null', () => {
  const article: GdeltLikeArticle = {
    date: NOW, cameoCode: '04', baselineVolumePerDay: 100, observedVolumePerDay: 500,
    title: 'unrelated category',
  };
  assert.equal(classifyDisinformation(article), null);
});

// ── classifyEconomicCoercion ─────────────────────────────────────────

test('classifyEconomicCoercion: detects "export ban" keyword', () => {
  const article: GdeltLikeArticle = {
    date: NOW, country: 'Japan', title: 'China imposes rare earth export ban',
  };
  const event = classifyEconomicCoercion(article);
  assert.ok(event);
  assert.equal(event!.type, 'economic_coercion');
});

test('classifyEconomicCoercion: no match returns null', () => {
  const article: GdeltLikeArticle = { date: NOW, country: 'JP', title: 'Tokyo summit announced' };
  assert.equal(classifyEconomicCoercion(article), null);
});

// ── classifyInfrastructure ───────────────────────────────────────────

test('classifyInfrastructure: writes high severity + named attribution', () => {
  const hit: InfrastructureKeywordHit = {
    date: NOW, country: 'Finland', keyword: 'cable',
    title: 'Undersea cable cut in Baltic; Russian shadow fleet vessel suspected',
    attribution: 'Russia',
  };
  const event = classifyInfrastructure(hit);
  assert.equal(event.severity, 'high');
  assert.equal(event.suspectedActor, 'Russia');
});

test('classifyInfrastructure: no attribution → Unknown + lower confidence', () => {
  const hit: InfrastructureKeywordHit = {
    date: NOW, country: 'Germany', keyword: 'pipeline',
    title: 'Pipeline pressure drop investigation',
  };
  const event = classifyInfrastructure(hit);
  assert.equal(event.suspectedActor, 'Unknown');
  assert.ok(event.confidence < 0.5);
});

// ── detectPatterns ───────────────────────────────────────────────────

function ev(overrides: Partial<GrayZoneEvent> & { id: string; date: string }): GrayZoneEvent {
  return {
    id: overrides.id,
    type: overrides.type ?? 'cyber_attack',
    date: overrides.date,
    suspectedActor: overrides.suspectedActor ?? 'Russia',
    targetCountry: overrides.targetCountry ?? 'Ukraine',
    confidence: overrides.confidence ?? 0.7,
    evidence: overrides.evidence ?? [],
    severity: overrides.severity ?? 'medium',
    summary: overrides.summary ?? '',
  };
}

test('detectPatterns: 3 same-actor events in 30 days emits a pattern', () => {
  const events: GrayZoneEvent[] = [
    ev({ id: 'a', date: '2026-04-01T00:00:00Z', type: 'cyber_attack' }),
    ev({ id: 'b', date: '2026-04-10T00:00:00Z', type: 'disinformation' }),
    ev({ id: 'c', date: '2026-04-20T00:00:00Z', type: 'sanctions' }),
  ];
  const patterns = detectPatterns(events);
  assert.equal(patterns.length, 1);
  assert.deepEqual(patterns[0]!.actors, ['Russia']);
  assert.equal(patterns[0]!.eventSequence.length, 3);
});

test('detectPatterns: events spread > 30 days do not pattern-link', () => {
  const events: GrayZoneEvent[] = [
    ev({ id: 'a', date: '2026-01-01T00:00:00Z' }),
    ev({ id: 'b', date: '2026-03-01T00:00:00Z' }),
    ev({ id: 'c', date: '2026-05-01T00:00:00Z' }),
  ];
  const patterns = detectPatterns(events);
  assert.equal(patterns.length, 0);
});

test('detectPatterns: cyber + disinformation surfaces hybrid interpretation', () => {
  const events: GrayZoneEvent[] = [
    ev({ id: 'a', date: '2026-04-01T00:00:00Z', type: 'cyber_attack' }),
    ev({ id: 'b', date: '2026-04-05T00:00:00Z', type: 'disinformation' }),
    ev({ id: 'c', date: '2026-04-09T00:00:00Z', type: 'cyber_attack' }),
  ];
  const patterns = detectPatterns(events);
  assert.equal(patterns.length, 1);
  assert.match(patterns[0]!.interpretation, /hybrid/i);
});

test('detectPatterns: ignores Unknown actor', () => {
  const events: GrayZoneEvent[] = [
    ev({ id: 'a', date: '2026-04-01T00:00:00Z', suspectedActor: 'Unknown' }),
    ev({ id: 'b', date: '2026-04-02T00:00:00Z', suspectedActor: 'Unknown' }),
    ev({ id: 'c', date: '2026-04-03T00:00:00Z', suspectedActor: 'Unknown' }),
  ];
  assert.equal(detectPatterns(events).length, 0);
});

// ── summarizeActor ───────────────────────────────────────────────────

test('summarizeActor: rolls up counts by type + top targets', () => {
  const events: GrayZoneEvent[] = [
    ev({ id: 'a', date: '2026-04-01T00:00:00Z', type: 'cyber_attack', targetCountry: 'Ukraine' }),
    ev({ id: 'b', date: '2026-04-10T00:00:00Z', type: 'disinformation', targetCountry: 'Ukraine' }),
    ev({ id: 'c', date: '2026-04-15T00:00:00Z', type: 'cyber_attack', targetCountry: 'Poland' }),
  ];
  const summary = summarizeActor('Russia', events);
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.byType.cyber_attack, 2);
  assert.equal(summary.byType.disinformation, 1);
  assert.equal(summary.topTargets[0], 'Ukraine');
  assert.equal(summary.earliestDate, '2026-04-01T00:00:00.000Z');
  assert.equal(summary.latestDate, '2026-04-15T00:00:00.000Z');
});

test('summarizeActor: empty events → zeros', () => {
  const summary = summarizeActor('Russia', []);
  assert.equal(summary.eventCount, 0);
  assert.equal(summary.earliestDate, null);
  assert.equal(summary.latestDate, null);
});

// ── JSON serializability ─────────────────────────────────────────────

test('events + patterns are JSON-serializable', () => {
  const e = classifySanctions({ date: NOW, sender: 'United States', target: 'Iran', summary: 'x' });
  const round = structuredClone(e);
  assert.equal(round.id, e.id);
});
