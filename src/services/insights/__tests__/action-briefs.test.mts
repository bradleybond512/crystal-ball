import assert from 'node:assert/strict';
import test from 'node:test';

import { buildActionBrief } from '../action-briefs.ts';
import {
  getPlaybook,
  allPlaybooks,
  listCategories,
} from '../reaction-playbooks.ts';
import type { SituationDescriptor } from '../action-briefs.ts';
import type { PlaybookCategory } from '../reaction-playbooks.ts';

function sit(overrides: Partial<SituationDescriptor> = {}): SituationDescriptor {
  return {
    id: 's-1',
    title: 'Severe weather near home',
    category: 'severe_weather',
    severityScore: 60,
    confidence: 'medium',
    ...overrides,
  };
}

// ── Playbook library hygiene ────────────────────────────────────────────

test('library: 11 categories present', () => {
  const cats = listCategories();
  assert.equal(cats.length, 11);
  for (const c of [
    'severe_weather', 'wildfire', 'oil_fuel_shortage', 'food_shortage',
    'cyber_campaign', 'banking_outage', 'conflict_escalation',
    'travel_disruption', 'grid_outage', 'disease_outbreak', 'earthquake',
  ] as const) {
    assert.ok(cats.includes(c), `missing ${c}`);
  }
});

test('library: every playbook has nonempty actions, sources, panels', () => {
  for (const p of allPlaybooks()) {
    assert.ok(p.userActions.length > 0, `${p.category} userActions`);
    assert.ok(p.confirmingSources.length > 0, `${p.category} confirmingSources`);
    assert.ok(p.invalidatingSources.length > 0, `${p.category} invalidatingSources`);
    assert.ok(p.recommendedPanels.length > 0, `${p.category} panels`);
    assert.ok(p.timeWindow.length > 0);
    assert.ok(p.notificationRule.length > 0);
  }
});

test('getPlaybook: returns correct category', () => {
  assert.equal(getPlaybook('cyber_campaign').category, 'cyber_campaign');
  assert.equal(getPlaybook('conflict_escalation').category, 'conflict_escalation');
});

// ── Tier logic ─────────────────────────────────────────────────────────

test('tier: severity 20 → monitor', () => {
  const b = buildActionBrief(sit({ severityScore: 20 }));
  assert.equal(b.tier, 'monitor');
});

test('tier: severity 40 → prepare', () => {
  const b = buildActionBrief(sit({ severityScore: 40 }));
  assert.equal(b.tier, 'prepare');
});

test('tier: severity 75 + medium confidence → act_now', () => {
  const b = buildActionBrief(sit({ severityScore: 75, confidence: 'medium' }));
  assert.equal(b.tier, 'act_now');
});

test('tier: severity 90 + high confidence + severe weather + short fuse → shelter', () => {
  const b = buildActionBrief(sit({
    severityScore: 90,
    confidence: 'high',
    category: 'severe_weather',
    minutesUntilImpact: 20,
  }));
  assert.equal(b.tier, 'shelter');
});

test('tier: low confidence caps at "prepare"', () => {
  // Severity 80 but low confidence → don\'t escalate to act_now.
  const b = buildActionBrief(sit({ severityScore: 80, confidence: 'low' }));
  assert.notEqual(b.tier, 'act_now');
  assert.notEqual(b.tier, 'shelter');
});

test('tier: shelter requires severe_weather category', () => {
  // Same severity / confidence / fuse, but cyber category → no shelter.
  const b = buildActionBrief(sit({
    category: 'cyber_campaign',
    severityScore: 95,
    confidence: 'high',
    minutesUntilImpact: 15,
  }));
  assert.notEqual(b.tier, 'shelter');
});

// ── Headlines ──────────────────────────────────────────────────────────

test('headline: shelter tier mentions "shelter now"', () => {
  const b = buildActionBrief(sit({
    severityScore: 95,
    confidence: 'high',
    category: 'severe_weather',
    minutesUntilImpact: 15,
  }));
  assert.match(b.headline, /shelter now/i);
});

test('headline: act_now mentions "act now" + time window', () => {
  const b = buildActionBrief(sit({ severityScore: 80, confidence: 'high' }));
  assert.match(b.headline, /act now/i);
  // Severe weather time window is "0-2 hours from issuance".
  assert.match(b.headline, /0-2 hours/);
});

test('headline: monitor tier is calm', () => {
  const b = buildActionBrief(sit({ severityScore: 15 }));
  assert.match(b.headline, /monitor/i);
});

// ── Action filtering ───────────────────────────────────────────────────

test('actions: monitor tier returns ≤2 actions', () => {
  const b = buildActionBrief(sit({ severityScore: 15 }));
  assert.ok(b.recommendedActions.length <= 2);
});

test('actions: prepare tier returns ~half of playbook actions', () => {
  const b = buildActionBrief(sit({ severityScore: 35 }));
  const playbook = getPlaybook('severe_weather');
  assert.ok(b.recommendedActions.length <= Math.ceil(playbook.userActions.length / 2));
});

test('actions: act_now returns up to maxActions', () => {
  const b = buildActionBrief(sit({ severityScore: 80, confidence: 'high' }));
  assert.ok(b.recommendedActions.length <= 5);
  assert.ok(b.recommendedActions.length >= 3);
});

test('actions: caller can override maxActions', () => {
  const b = buildActionBrief(sit({ severityScore: 80, confidence: 'high' }), { maxActions: 2 });
  assert.ok(b.recommendedActions.length <= 2);
});

// ── Confirming-source pruning ──────────────────────────────────────────

test('confirming: observed signals are removed from the to-watch list', () => {
  const b = buildActionBrief(sit({
    category: 'cyber_campaign',
    severityScore: 70,
    confidence: 'high',
    observedConfirming: ['CISA KEV'],
  }));
  // CISA KEV should be filtered out of the still-to-watch list.
  assert.ok(!b.confirmingSources.some((s) => /cisa kev/i.test(s)));
});

test('confirming: full list when no observed signals provided', () => {
  const b = buildActionBrief(sit({ category: 'cyber_campaign', severityScore: 70, confidence: 'high' }));
  const playbook = getPlaybook('cyber_campaign');
  assert.equal(b.confirmingSources.length, playbook.confirmingSources.length);
});

// ── Invalidating sources + panels passed through ──────────────────────

test('invalidatingSources: matches playbook for category', () => {
  const b = buildActionBrief(sit({ category: 'wildfire' }));
  const playbook = getPlaybook('wildfire');
  assert.deepEqual(b.invalidatingSources, [...playbook.invalidatingSources]);
});

test('recommendedPanels: matches playbook', () => {
  const b = buildActionBrief(sit({ category: 'grid_outage' }));
  const playbook = getPlaybook('grid_outage');
  assert.deepEqual(b.recommendedPanels, [...playbook.recommendedPanels]);
});

// ── Reason ─────────────────────────────────────────────────────────────

test('reason: includes tier name + severity + confidence', () => {
  const b = buildActionBrief(sit({ severityScore: 80, confidence: 'high' }));
  assert.match(b.reason, /severity 80/i);
  assert.match(b.reason, /high confidence/i);
});

test('reason: includes lead time when provided', () => {
  const b = buildActionBrief(sit({ minutesUntilImpact: 25, severityScore: 70 }));
  assert.match(b.reason, /25 min lead time/);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const a = buildActionBrief(sit({ severityScore: 70, confidence: 'high' }));
  const b = buildActionBrief(sit({ severityScore: 70, confidence: 'high' }));
  assert.deepEqual(a, b);
});

// ── Plan worked examples ───────────────────────────────────────────────

test('integration: weather example "charge devices, avoid driving"', () => {
  const b = buildActionBrief(sit({
    severityScore: 70,
    confidence: 'high',
    category: 'severe_weather',
  }));
  const text = b.recommendedActions.join(' | ').toLowerCase();
  // Plan section 5 example mentions charge devices + avoid driving.
  assert.ok(/charge|battery/.test(text));
  assert.ok(/driv/.test(text));
});

test('integration: cyber example "patch + MFA + watch for phishing"', () => {
  const b = buildActionBrief(sit({
    title: 'Critical RCE in widely-used SaaS provider',
    category: 'cyber_campaign',
    severityScore: 80,
    confidence: 'high',
  }));
  const text = b.recommendedActions.join(' | ').toLowerCase();
  assert.ok(/patch/.test(text));
  assert.ok(/mfa/.test(text));
});

test('integration: travel example "review flights + avoid airspace"', () => {
  const b = buildActionBrief(sit({
    title: 'Airspace closure over conflict zone',
    category: 'travel_disruption',
    severityScore: 75,
    confidence: 'high',
  }));
  const text = b.recommendedActions.join(' | ').toLowerCase();
  assert.ok(/flight/.test(text) || /airline/.test(text));
});
