import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEvidenceGraph,
  buildGraphFromFacts,
  inferFactRelations,
  countIndependentRoots,
  factNodeId,
  sourceNodeId,
  entityNodeId,
  locationNodeId,
} from '../evidence-graph.ts';
import { scoreFact, defaultContext } from '../truth-score.ts';
import { buildExplanation, buildConfidenceBreakdown } from '../confidence-explanation.ts';
import type { NormalizedFact, SourceAttestation } from '../types.ts';

const NOW = 1_745_000_000_000;

function source(providerId: string, observedAt = NOW, derivedFrom?: string): SourceAttestation {
  return { providerId, observedAt, derivedFrom };
}

function quakeFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'quake-1',
    domain: 'space',
    eventType: 'earthquake',
    claim: 'M6.2 quake near Tokyo',
    severity: 'high',
    occurredAt: NOW,
    lat: 35.68,
    lon: 139.69,
    locationPrecision: 'point',
    entities: ['JP'],
    sources: [source('usgs'), source('jma')],
    ...overrides,
  };
}

// ── Construction ────────────────────────────────────────────────────────

test('addFact: creates fact, source, location, entity nodes', () => {
  const g = createEvidenceGraph();
  const factId = g.addFact(quakeFact());
  assert.equal(factId, factNodeId('quake-1'));
  assert.ok(g.nodes.has(factNodeId('quake-1')));
  assert.ok(g.nodes.has(sourceNodeId('usgs')));
  assert.ok(g.nodes.has(sourceNodeId('jma')));
  assert.ok(g.nodes.has(entityNodeId('JP')));
  assert.ok(g.nodes.has(locationNodeId(35.68, 139.69, 'point')));
});

test('addFact: creates attests edges from sources to fact', () => {
  const g = createEvidenceGraph();
  g.addFact(quakeFact());
  const attesters = g.sourcesFor('quake-1');
  const ids = attesters.map((n) => n.id).sort();
  assert.deepEqual(ids, [sourceNodeId('jma'), sourceNodeId('usgs')]);
});

test('addFact: undirected same_location edge connects fact ↔ location', () => {
  const g = createEvidenceGraph();
  g.addFact(quakeFact());
  const fid = factNodeId('quake-1');
  const locId = locationNodeId(35.68, 139.69, 'point');
  const fromFact = g.edgesFrom(fid, 'same_location').map((e) => e.to);
  const fromLoc = g.edgesFrom(locId, 'same_location').map((e) => e.to);
  assert.deepEqual(fromFact, [locId]);
  assert.deepEqual(fromLoc, [fid]);
});

test('upsertNode: re-adding merges meta but preserves identity fields', () => {
  const g = createEvidenceGraph();
  g.upsertNode({ id: 'x', kind: 'fact', label: 'first', meta: { a: 1 } });
  g.upsertNode({ id: 'x', kind: 'fact', label: 'second', meta: { b: 2 } });
  const node = g.nodes.get('x')!;
  assert.equal(node.label, 'first');
  assert.deepEqual(node.meta, { a: 1, b: 2 });
});

test('addEdge: deduplicates same-kind edges between same endpoints, keeps max weight', () => {
  const g = createEvidenceGraph();
  g.addEdge({ from: 'a', to: 'b', kind: 'corroborates', weight: 0.5 });
  g.addEdge({ from: 'a', to: 'b', kind: 'corroborates', weight: 0.9 });
  const edges = g.edgesFrom('a', 'corroborates');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].weight, 0.9);
});

test('addEdge: different kinds between same endpoints coexist', () => {
  const g = createEvidenceGraph();
  g.addEdge({ from: 'a', to: 'b', kind: 'corroborates', weight: 0.5 });
  g.addEdge({ from: 'a', to: 'b', kind: 'contradicts', weight: 1 });
  assert.equal(g.edgesFrom('a').length, 2);
});

// ── Queries ──────────────────────────────────────────────────────────────

test('contradictionsFor: returns linked contradicting facts', () => {
  const g = createEvidenceGraph();
  g.addFact(quakeFact());
  g.addFact({
    ...quakeFact(),
    id: 'quake-2',
    claim: 'No, it was M5.5',
    contradictedBy: ['quake-1'],
  });
  const contradicting = g.contradictionsFor('quake-1');
  // quake-2 contradicts quake-1, so quake-1's contradictions include quake-2
  const ids = contradicting.map((n) => n.id);
  assert.ok(ids.includes(factNodeId('quake-2')));
});

test('sameLocationFacts: finds facts at same coords', () => {
  const g = createEvidenceGraph();
  g.addFact(quakeFact());
  g.addFact({
    ...quakeFact(),
    id: 'quake-2',
    claim: 'Aftershock M4.5',
    occurredAt: NOW + 60 * 1000,
  });
  const same = g.sameLocationFacts('quake-1');
  assert.equal(same.length, 1);
  assert.equal(same[0].id, factNodeId('quake-2'));
});

test('sameEntityFacts: finds facts sharing an entity', () => {
  const g = createEvidenceGraph();
  g.addFact(quakeFact());
  g.addFact({
    id: 'tsunami-1',
    domain: 'humanitarian',
    eventType: 'tsunami-warning',
    claim: 'Tsunami warning for Japan',
    severity: 'critical',
    occurredAt: NOW + 5 * 60 * 1000,
    locationPrecision: 'country',
    entities: ['JP'],
    sources: [source('jma')],
  });
  const same = g.sameEntityFacts('quake-1');
  assert.equal(same.length, 1);
  assert.equal(same[0].id, factNodeId('tsunami-1'));
});

test('neighbors: filters by edge kind set', () => {
  const g = buildGraphFromFacts([quakeFact()]);
  const fid = factNodeId('quake-1');
  const allNeighbors = g.neighbors(fid);
  assert.ok(allNeighbors.length >= 4); // 2 sources + location + entity
  const onlyEntity = g.neighbors(fid, ['same_entity']);
  assert.equal(onlyEntity.length, 1);
  assert.equal(onlyEntity[0].kind, 'entity');
});

// ── Inference ────────────────────────────────────────────────────────────

test('inferFactRelations: same-eventType near each other becomes corroborates', () => {
  const a = quakeFact();
  const b = { ...quakeFact(), id: 'quake-2', sources: [source('emsc')], occurredAt: NOW + 30 * 1000 };
  const g = buildGraphFromFacts([a, b]);
  inferFactRelations(g, [a, b]);
  const corroborates = g.edgesFrom(factNodeId('quake-1'), 'corroborates').map((e) => e.to);
  assert.deepEqual(corroborates, [factNodeId('quake-2')]);
});

test('inferFactRelations: opposed eventTypes become contradicts', () => {
  const issued: NormalizedFact = {
    id: 'tsu-issued',
    domain: 'humanitarian',
    eventType: 'tsunami-warning-issued',
    claim: 'Warning issued',
    severity: 'critical',
    occurredAt: NOW,
    lat: 35.68,
    lon: 139.69,
    locationPrecision: 'country',
    entities: ['JP'],
    sources: [source('jma')],
  };
  const canceled: NormalizedFact = {
    ...issued,
    id: 'tsu-canceled',
    eventType: 'tsunami-warning-canceled',
    claim: 'Warning canceled',
    occurredAt: NOW + 10 * 60 * 1000,
  };
  const g = buildGraphFromFacts([issued, canceled]);
  inferFactRelations(g, [issued, canceled], {
    contradictoryPairs: [['tsunami-warning-issued', 'tsunami-warning-canceled']],
  });
  const contradicts = g.edgesFrom(factNodeId('tsu-issued'), 'contradicts');
  assert.equal(contradicts.length, 1);
  assert.equal(contradicts[0].to, factNodeId('tsu-canceled'));
});

test('inferFactRelations: skips facts outside time window', () => {
  const a = quakeFact();
  const b = {
    ...quakeFact(),
    id: 'quake-2',
    occurredAt: NOW + 24 * 60 * 60 * 1000,
  };
  const g = buildGraphFromFacts([a, b]);
  inferFactRelations(g, [a, b], { timeWindowMs: 60 * 60 * 1000 });
  assert.equal(g.edgesFrom(factNodeId('quake-1'), 'corroborates').length, 0);
});

// ── countIndependentRoots ───────────────────────────────────────────────

test('countIndependentRoots: collapses derivedFrom chains', () => {
  const sources = [
    source('wire'),
    source('reblog-a', NOW, 'wire'),
    source('reblog-b', NOW, 'reblog-a'),
    source('independent'),
  ];
  assert.equal(countIndependentRoots(sources), 2);
});

test('countIndependentRoots: cycle guard', () => {
  // Pathological cycle: a → b, b → a. Should not infinite-loop.
  const sources = [
    source('a', NOW, 'b'),
    source('b', NOW, 'a'),
  ];
  // Result is non-deterministic in identity but must be finite and ≥1.
  const n = countIndependentRoots(sources);
  assert.ok(n >= 1 && n <= 2);
});

// ── Integration: explanation + breakdown ────────────────────────────────

test('integration: scoreFact + buildExplanation produce consistent breakdown', () => {
  const fact = quakeFact();
  const ctx = defaultContext({ now: () => NOW });
  const score = scoreFact(fact, ctx);
  const explanation = buildExplanation(fact, score);
  const breakdown = buildConfidenceBreakdown(score);

  assert.ok(explanation.headline.length > 0);
  assert.ok(explanation.lines.length > 0);
  // Two sources → corroboration line should be in the explanation
  assert.ok(explanation.lines.some((l) => l.text.includes('2 providers')));
  assert.equal(breakdown.max, 100);
  assert.ok(breakdown.total >= 0 && breakdown.total <= 100);
  // Sum of positive item.value minus negatives should match breakdown.total
  // (within 1 point of rounding).
  const sum = breakdown.items.reduce((s, i) => s + i.value, 0);
  assert.ok(Math.abs(sum - breakdown.total) <= 1);
});

test('integration: missingConfirmation is suppressed when score is high', () => {
  const fact: NormalizedFact = {
    id: 'high-confidence',
    domain: 'aviation',
    eventType: 'flight-emergency',
    claim: 'Squawk 7700',
    severity: 'high',
    occurredAt: NOW,
    lat: 35.5,
    lon: -97.5,
    locationPrecision: 'point',
    entities: ['ABC123'],
    sources: [source('opensky'), source('adsb-fi'), source('airplanes-live'), source('adsb-lol')],
  };
  const ctx = defaultContext({
    now: () => NOW,
    reliabilityFor: () => 0.95,
    historicalAccuracyFor: () => 0.95,
  });
  const score = scoreFact(fact, ctx);
  const explanation = buildExplanation(fact, score);
  // 4 sources, fresh, high reliability → all components should be ≥0.7
  assert.equal(explanation.missingConfirmation.length, 0);
});

test('integration: contradictions surface a "Resolve" hint at the top', () => {
  const fact = quakeFact({ contradictedBy: ['x', 'y'] });
  const score = scoreFact(fact, defaultContext({ now: () => NOW }));
  const explanation = buildExplanation(fact, score);
  assert.ok(explanation.missingConfirmation[0]?.toLowerCase().includes('resolve'));
});
