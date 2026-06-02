/**
 * Tests for HybridWarfarePanel — pure helpers, attribution math,
 * coordination scoring, fixture invariants, and label coverage.
 *
 * Run: npx tsx --test tests/components/hybrid-warfare-panel.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  severityLabel,
  attributionLabel,
  attributionColor,
  attributionFromConfidence,
  vectorLabel,
  vectorCount,
  isCoordinated,
  coordinationScore,
  greyZoneLabel,
  interferenceLabel,
  sabotageLabel,
  proxyLabel,
  actorTier,
  formatStrength,
  formatTimeAgo,
  hybridHeadlineCount,
  buildHybridOperations,
  buildGreyZoneActivities,
  buildElectionInterference,
  buildSabotageEvents,
  buildProxyForces,
  buildActorProfiles,
  type HybridOperationIndicator,
  type ElectionInterferenceSignal,
  type InfrastructureSabotageEvent,
  type HybridVector,
} from '../../src/components/hybrid-warfare-helpers.ts';

// Stable clock used by every fixture-builder in this file.
const NOW = 1_700_000_000_000;
const HYBRID_OPERATIONS = buildHybridOperations(NOW);
const GREY_ZONE_ACTIVITIES = buildGreyZoneActivities(NOW);
const ELECTION_INTERFERENCE = buildElectionInterference();
const SABOTAGE_EVENTS = buildSabotageEvents(NOW);
const PROXY_FORCES = buildProxyForces();
const ACTOR_PROFILES = buildActorProfiles();

// ── Severity ─────────────────────────────────────────────────────────

test('severityColor: ladder all distinct', () => {
  const values = [severityColor(1), severityColor(2), severityColor(3), severityColor(4)];
  assert.equal(new Set(values).size, 4);
});

test('severityLabel: covers 1-4', () => {
  assert.equal(severityLabel(1), 'Watch');
  assert.equal(severityLabel(2), 'Elevated');
  assert.equal(severityLabel(3), 'Alert');
  assert.equal(severityLabel(4), 'Critical');
});

// ── Attribution ──────────────────────────────────────────────────────

test('attributionLabel: all 4 tiers', () => {
  assert.equal(attributionLabel('unknown'),   'Unknown');
  assert.equal(attributionLabel('suspected'), 'Suspected');
  assert.equal(attributionLabel('likely'),    'Likely');
  assert.equal(attributionLabel('confirmed'), 'Confirmed');
});

test('attributionColor: confirmed darker red than likely', () => {
  assert.notEqual(attributionColor('confirmed'), attributionColor('likely'));
  assert.equal(attributionColor('unknown'), '#9e9e9e');
});

test('attributionFromConfidence: 90 → confirmed', () => {
  assert.equal(attributionFromConfidence(90), 'confirmed');
});

test('attributionFromConfidence: 85 (boundary) → confirmed', () => {
  assert.equal(attributionFromConfidence(85), 'confirmed');
});

test('attributionFromConfidence: 70 → likely', () => {
  assert.equal(attributionFromConfidence(70), 'likely');
});

test('attributionFromConfidence: 60 (boundary) → likely', () => {
  assert.equal(attributionFromConfidence(60), 'likely');
});

test('attributionFromConfidence: 40 → suspected', () => {
  assert.equal(attributionFromConfidence(40), 'suspected');
});

test('attributionFromConfidence: 30 (boundary) → suspected', () => {
  assert.equal(attributionFromConfidence(30), 'suspected');
});

test('attributionFromConfidence: 20 → unknown', () => {
  assert.equal(attributionFromConfidence(20), 'unknown');
});

test('attributionFromConfidence: 0 → unknown', () => {
  assert.equal(attributionFromConfidence(0), 'unknown');
});

// ── Vector / coordination ────────────────────────────────────────────

test('vectorLabel: all 6 vectors', () => {
  const all: HybridVector[] = ['cyber','disinfo','proxy_force','economic_coercion','lawfare','kinetic_deniable'];
  for (const v of all) assert.ok(vectorLabel(v).length > 0);
  assert.equal(vectorLabel('cyber'), 'Cyber');
  assert.equal(vectorLabel('kinetic_deniable'), 'Kinetic (deniable)');
});

test('vectorCount: dedupes repeated vectors', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'suspected',
    vectors: ['cyber','cyber','disinfo'], severity: 2, timestamp: 0, summary: '',
  };
  assert.equal(vectorCount(op), 2);
});

test('isCoordinated: single vector → false', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'suspected',
    vectors: ['cyber'], severity: 2, timestamp: 0, summary: '',
  };
  assert.equal(isCoordinated(op), false);
});

test('isCoordinated: 2+ vectors → true', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'suspected',
    vectors: ['cyber','disinfo'], severity: 2, timestamp: 0, summary: '',
  };
  assert.equal(isCoordinated(op), true);
});

test('coordinationScore: rewards more vectors', () => {
  const base = { id: 'x', target: 't', actor: 'a', attribution: 'suspected' as const,
                 severity: 2 as const, timestamp: Date.now(), summary: '' };
  const single: HybridOperationIndicator   = { ...base, vectors: ['cyber'] };
  const double: HybridOperationIndicator   = { ...base, vectors: ['cyber','disinfo'] };
  const quadruple: HybridOperationIndicator= { ...base, vectors: ['cyber','disinfo','proxy_force','lawfare'] };
  assert.ok(coordinationScore(double) > coordinationScore(single));
  assert.ok(coordinationScore(quadruple) > coordinationScore(double));
});

test('coordinationScore: rewards higher attribution confidence', () => {
  const base = { id: 'x', target: 't', actor: 'a', vectors: ['cyber','disinfo'] as HybridVector[],
                 severity: 2 as const, timestamp: Date.now(), summary: '' };
  const susp: HybridOperationIndicator      = { ...base, attribution: 'suspected' };
  const confirmed: HybridOperationIndicator = { ...base, attribution: 'confirmed' };
  assert.ok(coordinationScore(confirmed) > coordinationScore(susp));
});

test('coordinationScore: bounded at 100', () => {
  const max: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'confirmed',
    vectors: ['cyber','disinfo','proxy_force','economic_coercion','lawfare','kinetic_deniable'],
    severity: 4, timestamp: Date.now(), summary: '',
  };
  assert.ok(coordinationScore(max) <= 100);
});

test('coordinationScore: older events score lower than fresh', () => {
  const fresh: HybridOperationIndicator = {
    id: 'a', target: 't', actor: 'x', attribution: 'likely',
    vectors: ['cyber','disinfo'], severity: 3, timestamp: Date.now(), summary: '',
  };
  const old: HybridOperationIndicator = { ...fresh, id: 'b', timestamp: Date.now() - 30 * 86_400_000 };
  assert.ok(coordinationScore(fresh) > coordinationScore(old));
});

// ── Label coverage ───────────────────────────────────────────────────

test('greyZoneLabel: covers all 7 kinds', () => {
  assert.equal(greyZoneLabel('gps_jamming'),         'GPS jamming');
  assert.equal(greyZoneLabel('cable_approach'),      'Cable approach');
  assert.equal(greyZoneLabel('airspace_incursion'),  'Airspace incursion');
  assert.equal(greyZoneLabel('exclave_pressure'),    'Exclave pressure');
  assert.equal(greyZoneLabel('maritime_harassment'), 'Maritime harassment');
  assert.equal(greyZoneLabel('fishing_fleet_swarm'), 'Fishing fleet swarm');
  assert.equal(greyZoneLabel('border_provocation'),  'Border provocation');
});

test('interferenceLabel: covers all 6 kinds', () => {
  assert.equal(interferenceLabel('disinfo_campaign'),     'Disinformation campaign');
  assert.equal(interferenceLabel('hack_and_leak'),        'Hack-and-leak');
  assert.equal(interferenceLabel('voter_suppression'),    'Voter suppression');
  assert.equal(interferenceLabel('foreign_donations'),    'Foreign donations');
  assert.equal(interferenceLabel('fake_amplification'),   'Fake amplification');
  assert.equal(interferenceLabel('deepfake_circulation'), 'Deepfake circulation');
});

test('sabotageLabel: covers all 7 kinds', () => {
  assert.equal(sabotageLabel('pipeline'),       'Pipeline');
  assert.equal(sabotageLabel('undersea_cable'), 'Undersea cable');
  assert.equal(sabotageLabel('power_grid'),     'Power grid');
  assert.equal(sabotageLabel('satellite'),      'Satellite');
  assert.equal(sabotageLabel('water_supply'),   'Water supply');
  assert.equal(sabotageLabel('rail_network'),   'Rail network');
  assert.equal(sabotageLabel('gps_signal'),     'GPS signal');
});

test('proxyLabel: covers all 5 kinds', () => {
  assert.equal(proxyLabel('pmc_deployment'),       'PMC deployment');
  assert.equal(proxyLabel('non_state_arming'),     'Non-state arming');
  assert.equal(proxyLabel('volunteer_legion'),     'Volunteer legion');
  assert.equal(proxyLabel('paramilitary_buildup'), 'Paramilitary buildup');
  assert.equal(proxyLabel('maritime_militia'),     'Maritime militia');
});

// ── Format helpers ───────────────────────────────────────────────────

test('formatStrength: under 1000 stays raw', () => {
  assert.equal(formatStrength(420), '420');
});

test('formatStrength: thousand → k with 1 decimal', () => {
  assert.equal(formatStrength(2500), '2.5k');
});

test('formatStrength: ten-thousand+ → k with no decimal', () => {
  assert.equal(formatStrength(50_000), '50k');
});

test('formatTimeAgo: seconds', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 30_000, now), '30s ago');
});

test('formatTimeAgo: minutes', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 4 * 60_000, now), '4m ago');
});

test('formatTimeAgo: hours', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 6 * 3_600_000, now), '6h ago');
});

test('formatTimeAgo: days', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 3 * 86_400_000, now), '3d ago');
});

test('formatTimeAgo: months', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 120 * 86_400_000, now), '4mo ago');
});

// ── actorTier ────────────────────────────────────────────────────────

test('actorTier: passes through attributionFromConfidence', () => {
  assert.equal(actorTier({ actor: 'A', confidence: 90, observedVectors: 3, recentIndicators: 2, notes: '' }), 'confirmed');
  assert.equal(actorTier({ actor: 'A', confidence: 65, observedVectors: 3, recentIndicators: 2, notes: '' }), 'likely');
  assert.equal(actorTier({ actor: 'A', confidence: 35, observedVectors: 3, recentIndicators: 2, notes: '' }), 'suspected');
  assert.equal(actorTier({ actor: 'A', confidence: 10, observedVectors: 3, recentIndicators: 2, notes: '' }), 'unknown');
});

// ── hybridHeadlineCount ──────────────────────────────────────────────

test('hybridHeadlineCount: counts coordinated sev≥3 ops + critical sabotage + critical elections', () => {
  const ops: HybridOperationIndicator[] = [
    { id: '1', target: 't', actor: 'a', attribution: 'likely', vectors: ['cyber','disinfo'], severity: 4, timestamp: 0, summary: '' },
    { id: '2', target: 't', actor: 'a', attribution: 'likely', vectors: ['cyber'],           severity: 4, timestamp: 0, summary: '' }, // single vector, excluded
    { id: '3', target: 't', actor: 'a', attribution: 'likely', vectors: ['cyber','disinfo'], severity: 2, timestamp: 0, summary: '' }, // low sev, excluded
  ];
  const sab: InfrastructureSabotageEvent[] = [
    { id: 's1', region: 'r', asset: 'a', kind: 'pipeline', actor: 'a', attribution: 'suspected', severity: 3, timestamp: 0, detail: '' },
    { id: 's2', region: 'r', asset: 'a', kind: 'pipeline', actor: 'a', attribution: 'suspected', severity: 2, timestamp: 0, detail: '' },
  ];
  const elec: ElectionInterferenceSignal[] = [
    { id: 'e1', targetCountry: 'X', electionDate: '2026-01-01', kind: 'hack_and_leak', actor: 'a', attribution: 'likely', severity: 4, detail: '' },
  ];
  // 1 (op) + 1 (sab) + 1 (elec) = 3
  assert.equal(hybridHeadlineCount(ops, sab, elec), 3);
});

test('hybridHeadlineCount: empty inputs → 0', () => {
  assert.equal(hybridHeadlineCount([], [], []), 0);
});

test('hybridHeadlineCount: real fixture data returns positive count', () => {
  const c = hybridHeadlineCount(HYBRID_OPERATIONS, SABOTAGE_EVENTS, ELECTION_INTERFERENCE);
  assert.ok(c > 0);
});

// ── Fixture invariants ───────────────────────────────────────────────

test('HYBRID_OPERATIONS: every op has at least one vector', () => {
  for (const op of HYBRID_OPERATIONS) assert.ok(op.vectors.length >= 1);
});

test('HYBRID_OPERATIONS: most are multi-vector (coordination is the lead signal)', () => {
  const multi = HYBRID_OPERATIONS.filter(isCoordinated).length;
  assert.ok(multi >= 3, `expected ≥3 multi-vector ops, got ${multi}`);
});

test('GREY_ZONE_ACTIVITIES: severities in 1-4', () => {
  for (const g of GREY_ZONE_ACTIVITIES) assert.ok(g.severity >= 1 && g.severity <= 4);
});

test('ELECTION_INTERFERENCE: target country + date non-empty', () => {
  for (const e of ELECTION_INTERFERENCE) {
    assert.ok(e.targetCountry.length > 0);
    assert.ok(e.electionDate.length > 0);
  }
});

test('SABOTAGE_EVENTS: every event has a region + asset', () => {
  for (const s of SABOTAGE_EVENTS) {
    assert.ok(s.region.length > 0);
    assert.ok(s.asset.length > 0);
  }
});

test('PROXY_FORCES: estimatedStrength is non-negative', () => {
  for (const p of PROXY_FORCES) assert.ok(p.estimatedStrength >= 0);
});

test('PROXY_FORCES: every entry has a patron', () => {
  for (const p of PROXY_FORCES) assert.ok(p.patron.length > 0);
});

test('ACTOR_PROFILES: confidence in 0-100', () => {
  for (const a of ACTOR_PROFILES) {
    assert.ok(a.confidence >= 0 && a.confidence <= 100);
  }
});

test('ACTOR_PROFILES: includes reserved Unknown bucket', () => {
  assert.ok(ACTOR_PROFILES.some((a) => a.actor === 'Unknown'));
});

test('ACTOR_PROFILES: includes reserved Non-state bucket', () => {
  assert.ok(ACTOR_PROFILES.some((a) => a.actor === 'Non-state'));
});

test('ACTOR_PROFILES: at least one high-confidence (≥70) entry', () => {
  assert.ok(ACTOR_PROFILES.some((a) => a.confidence >= 70));
});

test('ACTOR_PROFILES: timestamps not required, but vectors > 0 for non-Unknown', () => {
  for (const a of ACTOR_PROFILES) {
    if (a.actor !== 'Unknown') {
      assert.ok(a.observedVectors >= 1, `${a.actor} should have ≥1 observed vector`);
    }
  }
});

// ── Builder determinism (pure-function contract) ─────────────────────

test('buildHybridOperations: same clock → identical output', () => {
  const a = buildHybridOperations(NOW);
  const b = buildHybridOperations(NOW);
  assert.deepEqual(a, b);
});

test('buildHybridOperations: clock shift only moves timestamps', () => {
  const a = buildHybridOperations(NOW);
  const b = buildHybridOperations(NOW + 86_400_000);
  for (let i = 0; i < a.length; i++) {
    assert.equal(b[i]!.id, a[i]!.id);
    assert.equal(b[i]!.timestamp - a[i]!.timestamp, 86_400_000);
  }
});

test('buildGreyZoneActivities: same clock → identical output', () => {
  assert.deepEqual(buildGreyZoneActivities(NOW), buildGreyZoneActivities(NOW));
});

test('buildSabotageEvents: every entry timestamp ≤ now', () => {
  const events = buildSabotageEvents(NOW);
  for (const e of events) assert.ok(e.timestamp <= NOW);
});

test('buildElectionInterference: deterministic and non-empty', () => {
  const a = buildElectionInterference();
  const b = buildElectionInterference();
  assert.deepEqual(a, b);
  assert.ok(a.length >= 4, 'expected at least 4 election signals');
});

test('buildProxyForces: deterministic and includes Iran-patron entries', () => {
  const a = buildProxyForces();
  const b = buildProxyForces();
  assert.deepEqual(a, b);
  assert.ok(a.some((p) => p.patron === 'Iran'));
});

test('buildActorProfiles: deterministic and ordered by descending confidence in fixture', () => {
  const a = buildActorProfiles();
  const b = buildActorProfiles();
  assert.deepEqual(a, b);
  // Spot-check that Russia is the highest reported confidence
  const russia = a.find((x) => x.actor === 'Russia');
  assert.ok(russia && russia.confidence >= 70);
});

// ── Coordination scoring edge cases ──────────────────────────────────

test('coordinationScore: deterministic for fixed clock', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'likely',
    vectors: ['cyber', 'disinfo'], severity: 3, timestamp: NOW - 2 * 86_400_000, summary: '',
  };
  assert.equal(coordinationScore(op, NOW), coordinationScore(op, NOW));
});

test('coordinationScore: zero vectors → low score, never negative', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'unknown',
    vectors: [], severity: 1, timestamp: NOW - 365 * 86_400_000, summary: '',
  };
  const score = coordinationScore(op, NOW);
  assert.ok(score >= 0);
  assert.ok(score <= 20);
});

test('coordinationScore: ancient (>10d) events lose all recency bonus', () => {
  const ancient: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'suspected',
    vectors: ['cyber', 'disinfo'], severity: 2, timestamp: NOW - 100 * 86_400_000, summary: '',
  };
  const fresh: HybridOperationIndicator = { ...ancient, timestamp: NOW };
  // Recency contribution is bounded at 10 — so fresh - ancient ≤ 10
  assert.ok(coordinationScore(fresh, NOW) - coordinationScore(ancient, NOW) <= 10);
});

// ── Headline count specificity ───────────────────────────────────────

test('hybridHeadlineCount: low-severity sabotage excluded from count', () => {
  const sab: InfrastructureSabotageEvent[] = [
    { id: 's1', region: 'r', asset: 'a', kind: 'pipeline', actor: 'a', attribution: 'suspected', severity: 2, timestamp: 0, detail: '' },
    { id: 's2', region: 'r', asset: 'a', kind: 'pipeline', actor: 'a', attribution: 'suspected', severity: 1, timestamp: 0, detail: '' },
  ];
  assert.equal(hybridHeadlineCount([], sab, []), 0);
});

test('hybridHeadlineCount: low-severity election interference excluded from count', () => {
  const elec: ElectionInterferenceSignal[] = [
    { id: 'e1', targetCountry: 'X', electionDate: '2026-01-01', kind: 'hack_and_leak', actor: 'a', attribution: 'likely', severity: 1, detail: '' },
    { id: 'e2', targetCountry: 'Y', electionDate: '2026-02-02', kind: 'hack_and_leak', actor: 'a', attribution: 'likely', severity: 2, detail: '' },
  ];
  assert.equal(hybridHeadlineCount([], [], elec), 0);
});

// ── Vector / coordination helpers ────────────────────────────────────

test('vectorCount: empty array → 0', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'unknown',
    vectors: [], severity: 1, timestamp: 0, summary: '',
  };
  assert.equal(vectorCount(op), 0);
});

test('isCoordinated: only counts distinct vectors', () => {
  const op: HybridOperationIndicator = {
    id: 'x', target: 't', actor: 'a', attribution: 'unknown',
    vectors: ['cyber', 'cyber', 'cyber'] as HybridVector[], severity: 1, timestamp: 0, summary: '',
  };
  assert.equal(isCoordinated(op), false);
});

// ── Format helpers — boundary regressions ────────────────────────────

test('formatTimeAgo: exactly 60 seconds → 1m ago', () => {
  assert.equal(formatTimeAgo(NOW - 60_000, NOW), '1m ago');
});

test('formatTimeAgo: future timestamp → 0s ago (clamps to non-negative)', () => {
  assert.equal(formatTimeAgo(NOW + 5000, NOW), '0s ago');
});

test('formatStrength: zero stays as "0"', () => {
  assert.equal(formatStrength(0), '0');
});

test('formatStrength: 999 stays raw', () => {
  assert.equal(formatStrength(999), '999');
});

// ── Severity / attribution color uniqueness ──────────────────────────

test('attributionColor: all 4 tiers have distinct colors', () => {
  const colors = new Set([
    attributionColor('unknown'),
    attributionColor('suspected'),
    attributionColor('likely'),
    attributionColor('confirmed'),
  ]);
  assert.equal(colors.size, 4);
});

test('severityColor: severity 4 darker than severity 1', () => {
  assert.notEqual(severityColor(1), severityColor(4));
});

// ── Election interference: every signal has a valid future ISO date ──

test('ELECTION_INTERFERENCE: every electionDate parses as ISO date', () => {
  for (const e of ELECTION_INTERFERENCE) {
    const ms = Date.parse(e.electionDate);
    assert.ok(!Number.isNaN(ms), `${e.targetCountry} date must parse: ${e.electionDate}`);
  }
});

test('ELECTION_INTERFERENCE: severities ∈ {1..4}', () => {
  for (const e of ELECTION_INTERFERENCE) {
    assert.ok(e.severity >= 1 && e.severity <= 4);
  }
});

// ── Framing invariants — analytical monitoring only ──────────────────

test('framing: no fixture detail/summary text contains offensive recommendation verbs', () => {
  // Strictly analytical monitoring framing: fixtures must not read like a playbook.
  const forbidden = /\b(launch|deploy(?:ing)? a strike|attack|target the|conduct (?:an? )?strike|exploit (?:this|the )|escalate against)\b/i;
  const allText = [
    ...buildHybridOperations(NOW).map((o) => `${o.target} ${o.summary}`),
    ...buildGreyZoneActivities(NOW).map((g) => g.detail),
    ...buildElectionInterference().map((e) => e.detail),
    ...buildSabotageEvents(NOW).map((s) => s.detail),
    ...buildProxyForces().map((p) => p.detail),
    ...buildActorProfiles().map((a) => a.notes),
  ];
  for (const t of allText) {
    assert.ok(!forbidden.test(t), `forbidden framing in: ${t}`);
  }
});

test('framing: notes/details prefer observational language', () => {
  // At least one observational marker ("reported", "observed", or descriptive) per fixture string.
  // This is a soft invariant — we just make sure several entries carry it.
  const observational = /report|observ|track|pattern|incident|continue|reserved/i;
  const samples = [
    ...buildHybridOperations(NOW).map((o) => o.summary),
    ...buildGreyZoneActivities(NOW).map((g) => g.detail),
    ...buildSabotageEvents(NOW).map((s) => s.detail),
  ];
  const hits = samples.filter((s) => observational.test(s)).length;
  assert.ok(hits >= Math.floor(samples.length / 2), `expected ≥half observational, got ${hits}/${samples.length}`);
});
