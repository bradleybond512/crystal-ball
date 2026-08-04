import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCompoundRisk } from '../compound-risk.ts';
import type { CompoundRiskInput } from '../compound-risk.ts';
import { replaceInhibitorySnapshot, clearInhibitorySnapshot } from '../../correlation/inhibition.ts';

function inp(overrides: Partial<CompoundRiskInput>): CompoundRiskInput {
  return {
    id: 'sit-1',
    title: 'Default situation',
    domain: 'weather',
    domains: ['weather'],
    severityScore: 50,
    confidence: 0.7,
    entities: ['US-IN'],
    ...overrides,
  };
}

// ── Empty / single ─────────────────────────────────────────────────────

test('compound: empty input → empty result', () => {
  const result = computeCompoundRisk([]);
  assert.deepEqual(result, []);
});

test('compound: single situation produces a result with that single member', () => {
  const result = computeCompoundRisk([inp({})]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.memberIds.length, 1);
});

// ── Clustering ─────────────────────────────────────────────────────────

test('compound: shared entity merges two situations', () => {
  const a = inp({ id: 'a', entities: ['JP'], domain: 'space' });
  const b = inp({ id: 'b', entities: ['JP'], domain: 'humanitarian', domains: ['humanitarian'], title: 'tsunami' });
  const result = computeCompoundRisk([a, b]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.memberIds.sort(), ['a', 'b']);
});

test('compound: spatial proximity merges (within 100 km)', () => {
  const a = inp({ id: 'a', centroid: { lat: 28.0, lon: -80.0 }, entities: ['unique-a'] });
  const b = inp({ id: 'b', centroid: { lat: 28.5, lon: -80.5 }, entities: ['unique-b'] }); // ~70 km away
  const result = computeCompoundRisk([a, b]);
  assert.equal(result.length, 1);
});

test('compound: distant + no shared entity → separate clusters', () => {
  const a = inp({ id: 'a', entities: ['unique-a'], centroid: { lat: 0, lon: 0 } });
  const b = inp({ id: 'b', entities: ['unique-b'], centroid: { lat: 50, lon: 50 }, domain: 'cyber', domains: ['cyber'] });
  const result = computeCompoundRisk([a, b]);
  assert.equal(result.length, 2);
});

test('compound: known cascade pair (weather × markets) merges even without entity overlap', () => {
  const a = inp({ id: 'storm', domain: 'weather', domains: ['weather'], entities: ['storm-only'] });
  const b = inp({ id: 'mkt', domain: 'markets', domains: ['markets'], entities: ['markets-only'] });
  const result = computeCompoundRisk([a, b]);
  assert.equal(result.length, 1);
});

// ── Score ──────────────────────────────────────────────────────────────

test('score: cross-domain breadth bumps result above mean', () => {
  // 1 weather situation + 1 markets situation + 1 humanitarian = 3 domains, breadth bump +25%.
  const ws = inp({ id: 'w', domain: 'weather', domains: ['weather'], severityScore: 50, confidence: 1, entities: ['JP'] });
  const ms = inp({ id: 'm', domain: 'markets', domains: ['markets'], severityScore: 50, confidence: 1, entities: ['JP'] });
  const hs = inp({ id: 'h', domain: 'humanitarian', domains: ['humanitarian'], severityScore: 50, confidence: 1, entities: ['JP'] });
  const result = computeCompoundRisk([ws, ms, hs]);
  // Mean weighted = 50, breadth × 1.25, corroboration × 1.2 = 75.
  assert.equal(result[0]!.score, 75);
});

test('score: clamped to 100', () => {
  const inputs = Array.from({ length: 4 }).map((_, i) => inp({
    id: `s-${i}`,
    domain: i === 0 ? 'weather' : i === 1 ? 'markets' : i === 2 ? 'humanitarian' : 'cyber',
    domains: [i === 0 ? 'weather' : i === 1 ? 'markets' : i === 2 ? 'humanitarian' : 'cyber'],
    severityScore: 100,
    confidence: 1,
    entities: ['JP'],
  }));
  const result = computeCompoundRisk(inputs);
  assert.equal(result[0]!.score, 100);
});

test('score: low-confidence members produce a low score', () => {
  const a = inp({ severityScore: 90, confidence: 0.2 });
  const result = computeCompoundRisk([a]);
  assert.ok(result[0]!.score < 30);
});

test('score: inhibitory evidence applies after grouping, floors at 15%, and leaves membership and level unchanged', () => {
  clearInhibitorySnapshot();
  const a = inp({
    id: 'a', domain: 'weather', domains: ['weather'], sourceDomains: ['wildfire'],
    severityScore: 80, confidence: 1, entities: ['shared'],
  });
  const b = inp({
    id: 'b', domain: 'infra', domains: ['infra'], sourceDomains: ['infrastructure'],
    severityScore: 80, confidence: 1, entities: ['shared'],
  });
  const originalInputs = structuredClone([a, b]);
  const baseline = computeCompoundRisk([a, b])[0]!;
  const snapshot = replaceInhibitorySnapshot([{
    effect: 'inhibitory', from: 'wildfire', to: 'infrastructure', windowMs: 1,
    support: 0, antecedents: 12, followRate: 0, expectedRate: 0.5, lift: 0,
    zScore: -100, strength: 0, explanation: 'learned suppression',
  }], 4, 1);

  const adjusted = computeCompoundRisk([a, b], { inhibitorySnapshot: snapshot })[0]!;

  assert.equal(adjusted.score, Math.round(baseline.score * 0.85));
  assert.deepEqual(adjusted.memberIds, baseline.memberIds);
  assert.deepEqual(adjusted.affectedDomains, baseline.affectedDomains);
  assert.equal(adjusted.level, baseline.level);
  assert.deepEqual([a, b], originalInputs);
  assert.deepEqual(adjusted.inhibition, {
    kind: 'learned-inhibition',
    fromDomain: 'wildfire',
    toDomain: 'infrastructure',
    zScore: -100,
    criticalAbsZ: 4,
    evidenceStrength: 1,
    factor: 0.85,
    explanation: 'learned suppression',
    publishedAt: 1,
  });
});

// ── Level labels ──────────────────────────────────────────────────────

test('level: thresholds map score to background/elevated/severe/critical', () => {
  const cases: Array<{ severity: number; expected: string }> = [
    { severity: 20, expected: 'background' },
    { severity: 40, expected: 'elevated' },
    { severity: 65, expected: 'severe' },
    { severity: 85, expected: 'critical' },
  ];
  for (const c of cases) {
    const r = computeCompoundRisk([inp({ severityScore: c.severity, confidence: 1 })])[0]!;
    assert.equal(r.level, c.expected, `severity ${c.severity}`);
  }
});

// ── Affected domains ──────────────────────────────────────────────────

test('affectedDomains: union of member.domain and member.domains', () => {
  const a = inp({ id: 'a', domain: 'weather', domains: ['weather', 'infra'], entities: ['US'] });
  const b = inp({ id: 'b', domain: 'markets', domains: ['markets'], entities: ['US'] });
  const result = computeCompoundRisk([a, b]);
  assert.deepEqual(result[0]!.affectedDomains.sort(), ['infra', 'markets', 'weather']);
});

// ── Impact categories ─────────────────────────────────────────────────

test('impactCategories: weather + cyber + humanitarian → human_safety + critical_infrastructure + food_security', () => {
  const a = inp({ id: 'a', domain: 'weather', domains: ['weather'], entities: ['JP'] });
  const b = inp({ id: 'b', domain: 'cyber', domains: ['cyber'], entities: ['JP'] });
  const c = inp({ id: 'c', domain: 'humanitarian', domains: ['humanitarian'], entities: ['JP'] });
  const result = computeCompoundRisk([a, b, c]);
  const cats = result[0]!.impactCategories;
  assert.ok(cats.includes('human_safety'));
  assert.ok(cats.includes('critical_infrastructure'));
  assert.ok(cats.includes('food_security'));
});

// ── Cascade paths ─────────────────────────────────────────────────────

test('cascade: weather → markets follows natural order', () => {
  const w = inp({ id: 'storm', title: 'Hurricane near Gulf', domain: 'weather', domains: ['weather'] });
  const m = inp({ id: 'fuel', title: 'Diesel stress', domain: 'markets', domains: ['markets'] });
  const result = computeCompoundRisk([w, m]);
  const path = result[0]!.cascadePaths.find((p) => p.situationIds.length === 2);
  assert.ok(path);
  assert.equal(path!.situationIds[0], 'storm');
  assert.equal(path!.situationIds[1], 'fuel');
  assert.match(path!.narrative, /Hurricane.*Diesel/);
});

test('cascade: plausibility decreases with hop count', () => {
  const a = inp({ id: 'a', domain: 'weather', domains: ['weather'], confidence: 0.9, title: 'A', entities: ['JP'] });
  const b = inp({ id: 'b', domain: 'infra', domains: ['infra'], confidence: 0.9, title: 'B', entities: ['JP'] });
  const c = inp({ id: 'c', domain: 'markets', domains: ['markets'], confidence: 0.9, title: 'C', entities: ['JP'] });
  const result = computeCompoundRisk([a, b, c]);
  const wholeGroup = result[0]!.cascadePaths.find((p) => p.situationIds.length === 3);
  const pair = result[0]!.cascadePaths.find((p) => p.situationIds.length === 2);
  assert.ok(wholeGroup);
  assert.ok(pair);
  // Whole-group plausibility should be ≤ pair plausibility (more hops = less certain).
  assert.ok(wholeGroup!.plausibility <= pair!.plausibility);
});

// ── Watch items ───────────────────────────────────────────────────────

test('watchItems: emits one item per affected domain (up to 5)', () => {
  const a = inp({ id: 'a', domain: 'weather', domains: ['weather'], entities: ['JP'] });
  const b = inp({ id: 'b', domain: 'cyber', domains: ['cyber'], entities: ['JP'] });
  const c = inp({ id: 'c', domain: 'markets', domains: ['markets'], entities: ['JP'] });
  const result = computeCompoundRisk([a, b, c]);
  const labels = result[0]!.watchItems.map((w) => w.label);
  assert.ok(labels.some((l) => /NWS/.test(l)));
  assert.ok(labels.some((l) => /CISA/.test(l)));
  assert.ok(labels.some((l) => /Crack spread/.test(l)));
});

// ── Headline ───────────────────────────────────────────────────────────

test('headline: single situation uses its title', () => {
  const result = computeCompoundRisk([inp({ title: 'Hurricane Foo' })]);
  assert.match(result[0]!.headline, /Hurricane Foo/);
});

test('headline: multi-situation summarizes count + domains', () => {
  const a = inp({ id: 'a', domain: 'weather', domains: ['weather'], entities: ['JP'] });
  const b = inp({ id: 'b', domain: 'markets', domains: ['markets'], entities: ['JP'] });
  const result = computeCompoundRisk([a, b]);
  assert.match(result[0]!.headline, /Compound risk \d+/);
  assert.match(result[0]!.headline, /2 situations/);
});

// ── Sorting ────────────────────────────────────────────────────────────

test('sort: highest-score compound first', () => {
  // Two separate compounds: high-severity weather + entity-shared markets,
  // and a low-severity isolated 'other' situation (no domain cascade pair,
  // no entity overlap, no spatial proximity).
  const wHigh = inp({ id: 'w', severityScore: 90, confidence: 1, entities: ['JP'] });
  const mHigh = inp({ id: 'm', domain: 'markets', domains: ['markets'], severityScore: 90, confidence: 1, entities: ['JP'] });
  const lowIsolated = inp({
    id: 'iso',
    domain: 'other',
    domains: ['other'],
    severityScore: 30,
    confidence: 0.5,
    entities: ['UNIQUE-X'],
    centroid: { lat: -45, lon: -150 }, // far from JP
  });
  const result = computeCompoundRisk([wHigh, mHigh, lowIsolated]);
  assert.equal(result.length, 2);
  assert.ok(result[0]!.score > result[1]!.score);
});

// ── Determinism ───────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const a = inp({ id: 'a', entities: ['JP'] });
  const b = inp({ id: 'b', domain: 'markets', domains: ['markets'], entities: ['JP'] });
  const r1 = computeCompoundRisk([a, b]);
  const r2 = computeCompoundRisk([a, b]);
  assert.deepEqual(r1, r2);
});

// ── Plan worked example ────────────────────────────────────────────────

test('integration: hurricane + Gulf refinery + low gasoline inventory → critical compound', () => {
  // The plan example: hurricane × refinery × inventory deficit produces
  // a compound much worse than the sum of parts.
  const hurricane = inp({
    id: 'hurr',
    title: 'Major hurricane approaching Gulf Coast',
    domain: 'weather',
    domains: ['weather'],
    severityScore: 85,
    confidence: 0.9,
    entities: ['US-Gulf'],
    centroid: { lat: 28, lon: -90 },
  });
  const refinery = inp({
    id: 'refinery',
    title: 'Gulf refinery outage',
    domain: 'infra',
    domains: ['infra', 'energy'],
    severityScore: 75,
    confidence: 0.85,
    entities: ['US-Gulf'],
    centroid: { lat: 29, lon: -90 },
  });
  const fuel = inp({
    id: 'fuel',
    title: 'Gasoline inventory deficit',
    domain: 'markets',
    domains: ['markets'],
    severityScore: 70,
    confidence: 0.8,
    entities: ['US-Gulf'],
  });
  const result = computeCompoundRisk([hurricane, refinery, fuel]);
  assert.equal(result.length, 1);
  const r = result[0]!;
  assert.equal(r.level, 'critical');
  assert.ok(r.score >= 80);
  assert.ok(r.affectedDomains.length >= 3);
  assert.ok(r.cascadePaths.length > 0);
});
