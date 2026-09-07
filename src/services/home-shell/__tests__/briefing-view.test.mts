import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBriefingView, CRITICAL_EVENT_FLOOR } from '../briefing-view.ts';
import type { BriefingInput, HighSeverityEvent } from '../briefing-view.ts';
import type { PersonalImpact, PersonalImpactReport } from '../../personal/personal-impact.ts';
import type { WhatChangedEvent } from '../../command-center/what-changed.ts';
import type { SituationDescriptor } from '../../insights/action-briefs.ts';

const NOW = 1_752_000_000_000;

function impact(overrides: Partial<PersonalImpact> = {}): PersonalImpact {
  return {
    eventId: 'evt-1',
    category: 'immediate_risk',
    severity: 'critical',
    description: 'Severe cell approaching HOME',
    exposures: [{ exposureId: 'home', label: 'HOME', reason: 'inside warning polygon' }],
    recommendedAction: 'Move to interior room',
    reason: 'polygon intersects saved place',
    ...overrides,
  };
}

function report(impacts: PersonalImpact[] = []): PersonalImpactReport {
  return {
    generatedAt: NOW,
    impacts,
    summary: impacts.length === 0 ? 'No personal impacts' : `Personal impacts: ${impacts.length}`,
    recommendations: impacts.map((i) => `${i.description}: ${i.recommendedAction}`),
  };
}

function delta(overrides: Partial<WhatChangedEvent> = {}): WhatChangedEvent {
  return {
    id: 'chg-1',
    timestamp: NOW - 60_000,
    domain: 'weather',
    type: 'new-alert',
    summary: 'Severe Thunderstorm Warning',
    ...overrides,
  };
}

function sit(overrides: Partial<SituationDescriptor> = {}): SituationDescriptor {
  return {
    id: 'sit-1',
    title: 'Black Sea corridor escalation',
    category: 'conflict_escalation' as SituationDescriptor['category'],
    severityScore: 90,
    confidence: 'high',
    ...overrides,
  };
}

function quiet(): BriefingInput {
  return { personal: report([]), changed: [], recentEvents: [], savedPlacesCount: 3 };
}

const SOURCE_NEXT_STEP = 'Review source status before relying on this summary.';
const COVERAGE_NOTE = 'Available reports only · coverage unverified · evidence age unknown.';
const DIGEST_NOTE = 'Recorded changes only · source coverage and evidence age unverified.';

function assertEvidence(view: ReturnType<typeof buildBriefingView>): void {
  for (const band of view.bands) {
    const base = band.kind === 'changed' ? DIGEST_NOTE : COVERAGE_NOTE;
    assert.ok(band.evidenceNote.startsWith(base), `${band.kind}: ${band.evidenceNote}`);
    assert.equal('staleness' in band, false);
  }
  assert.equal('allClear' in view, false);
  assert.equal('allClearText' in view, false);
}

test('empty available reports retain three neutral evidence-scoped bands', () => {
  const view = buildBriefingView(quiet(), NOW);
  assert.deepEqual(view.bands.map((b) => b.kind), ['personal', 'changed', 'critical']);
  assert.deepEqual(view.bands.map((b) => b.headline), [
    'No personal impacts identified in available reports.',
    'No changes recorded in the available digest.',
    'No critical items in available reports.',
  ]);
  assert.ok(view.bands.every((b) => b.tone === 'info'));
  assert.ok(view.bands.every((b) => b.entries.length === 0));
  assertEvidence(view);
  assert.deepEqual(view.bands.map((b) => b.evidenceNote), [
    `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`,
    `${DIGEST_NOTE} ${SOURCE_NEXT_STEP}`,
    `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`,
  ]);
  assert.equal(view.generatedAt, NOW);
});

test('zero saved places is distinct from an empty local assessment', () => {
  const view = buildBriefingView({ ...quiet(), savedPlacesCount: 0 }, NOW);
  const personal = view.bands[0]!;
  assert.equal(personal.headline, 'No saved places for a local assessment.');
  assert.equal(personal.tone, 'info');
  assert.deepEqual(personal.entries, [{ text: 'Add a place in Settings.' }]);
  assert.equal(personal.evidenceNote, COVERAGE_NOTE);
  assertEvidence(view);
});

test('an unknown saved-place count cannot assert that no places are saved', () => {
  const view = buildBriefingView({ ...quiet(), savedPlacesCount: undefined }, NOW);
  assert.equal(view.bands[0]!.headline, 'No personal impacts identified in available reports.');
  assert.deepEqual(view.bands[0]!.entries, []);
  assert.equal(view.bands[0]!.evidenceNote, `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`);
});

test('fresh calculation timestamps never establish source evidence age', () => {
  const baseline = buildBriefingView(quiet(), NOW);
  for (const elapsed of [1, 60_000, 86_400_000]) {
    const now = NOW + elapsed;
    const view = buildBriefingView({ ...quiet(), personal: { ...report(), generatedAt: now } }, now);
    assert.equal(view.generatedAt, now);
    assert.deepEqual(view.bands, baseline.bands);
    assertEvidence(view);
  }
});

test('critical personal impact drives band tone and lines', () => {
  const view = buildBriefingView({ ...quiet(), personal: report([impact()]) }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.tone, 'critical');
  assert.equal(personal.headline, '1 personal impact near you');
  assert.ok(personal.entries[0]!.text.includes('Severe cell approaching HOME'));
  assertEvidence(view);
});

test('low/none impacts stay filtered while empty coverage remains unverified', () => {
  const view = buildBriefingView(
    { ...quiet(), personal: report([impact({ severity: 'low' }), impact({ severity: 'none' })]) },
    NOW,
  );
  assert.equal(view.bands.find((b) => b.kind === 'personal')!.tone, 'info');
  assert.equal(view.bands[0]!.entries.length, 0);
  assertEvidence(view);
});

test('missing personal report takes precedence over zero saved places', () => {
  for (const savedPlacesCount of [0, 3]) {
    const view = buildBriefingView({ ...quiet(), personal: undefined, savedPlacesCount }, NOW);
    const personal = view.bands[0]!;
    assert.equal(personal.headline, 'Personal status unavailable.');
    assert.equal(personal.tone, 'info');
    assert.deepEqual(personal.entries, []);
    assert.equal(personal.evidenceNote, `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`);
    assertEvidence(view);
  }
});

test('changed band counts events, formats lines, escalates tone', () => {
  const view = buildBriefingView(
    { ...quiet(), changed: [delta(), delta({ id: 'chg-2', type: 'escalated', summary: 'Wheat risk tier 2→3' })] },
    NOW,
  );
  const changed = view.bands.find((b) => b.kind === 'changed')!;
  assert.equal(changed.tone, 'elevated');
  assert.ok(changed.headline.startsWith('2 changes'));
  assert.equal(changed.entries.length, 2);
  assert.ok(changed.entries.some((l) => l.text.includes('Wheat risk tier 2→3')));
});

test('undefined changed digest is unavailable, not empty', () => {
  const view = buildBriefingView({ ...quiet(), changed: undefined }, NOW);
  const changed = view.bands.find((b) => b.kind === 'changed')!;
  assert.equal(changed.tone, 'info');
  assert.equal(changed.headline, 'Change digest unavailable');
  assert.equal(changed.evidenceNote, `${DIGEST_NOTE} ${SOURCE_NEXT_STEP}`);
});

test('critical band ranks situation + high-severity events, caps at 4 lines', () => {
  const events: HighSeverityEvent[] = [72, 88, 74, 71, 90].map((severity, i) => ({
    eventId: `e${i}`,
    description: `Event ${i}`,
    domain: 'conflict',
    severity,
  }));
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: events }, NOW);
  const critical = view.bands.find((b) => b.kind === 'critical')!;
  assert.equal(critical.tone, 'critical');
  assert.ok(critical.entries.length <= 4);
  assert.ok(critical.entries[0]!.text.includes('Black Sea corridor escalation'));
  assert.ok(critical.headline.includes('6 situations'));
});

test('sub-floor events stay out of the critical band', () => {
  const view = buildBriefingView(
    { ...quiet(), recentEvents: [{ eventId: 'e', description: 'Minor', domain: 'other', severity: CRITICAL_EVENT_FLOOR - 1 }] },
    NOW,
  );
  assert.equal(view.bands.find((b) => b.kind === 'critical')!.tone, 'info');
});

test('critical band dedupes the active situation from recent events', () => {
  const view = buildBriefingView(
    {
      ...quiet(),
      situation: sit(),
      recentEvents: [{ eventId: 'sit-1', description: 'Black Sea corridor escalation', domain: 'conflict', severity: 90 }],
    },
    NOW,
  );
  const critical = view.bands.find((b) => b.kind === 'critical')!;
  assert.equal(critical.entries.length, 1);
  assert.equal(critical.headline, '1 situation worldwide');
});

test('missing critical reports do not become an empty worldwide assessment', () => {
  const view = buildBriefingView({ ...quiet(), recentEvents: undefined }, NOW);
  const critical = view.bands[2]!;
  assert.equal(critical.headline, 'Critical reports unavailable.');
  assert.equal(critical.tone, 'info');
  assert.deepEqual(critical.entries, []);
  assert.equal(critical.evidenceNote, `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`);
});

test('an active situation remains visible when other critical reports are unavailable', () => {
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: undefined }, NOW);
  const critical = view.bands[2]!;
  assert.equal(critical.headline, '1 situation worldwide');
  assert.equal(critical.tone, 'critical');
  assert.deepEqual(critical.entries, [{ text: '● Black Sea corridor escalation (90)', situationId: 'sit-1' }]);
  assert.ok(critical.evidenceNote.includes('Other critical reports unavailable.'));
  assert.ok(critical.evidenceNote.includes(SOURCE_NEXT_STEP));
  assertEvidence(view);
});

test('singular change and one saved place retain scoped descriptions', () => {
  const changedView = buildBriefingView({ ...quiet(), changed: [delta()] }, NOW);
  const changed = changedView.bands.find((b) => b.kind === 'changed')!;
  assert.ok(changed.headline.startsWith('1 change since'));
  const placeView = buildBriefingView({ ...quiet(), savedPlacesCount: 1 }, NOW);
  assert.equal(placeView.bands[0]!.headline, 'No personal impacts identified in available reports.');
});

test('single sub-tone-floor event yields elevated critical band', () => {
  const view = buildBriefingView(
    { ...quiet(), recentEvents: [{ eventId: 'e1', description: 'Border incident', domain: 'conflict', severity: 72 }] },
    NOW,
  );
  assert.equal(view.bands.find((b) => b.kind === 'critical')!.tone, 'elevated');
});

test('critical impact with zero exposures is not counted as personal', () => {
  const view = buildBriefingView(
    { ...quiet(), personal: report([impact({ exposures: [] })]) },
    NOW,
  );
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.tone, 'info');
  assert.equal(personal.headline, 'No personal impacts identified in available reports.');
  assert.deepEqual(personal.entries, []);
  assertEvidence(view);
});

test('critical entries carry situation/event ids for dossier entry', () => {
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: [
    { eventId: 'e9', description: 'High-sev event', domain: 'conflict', severity: 88 },
  ] }, NOW);
  const critical = view.bands.find((b) => b.kind === 'critical')!;
  assert.equal(critical.entries[0]!.situationId, 'sit-1');
  assert.equal(critical.entries[1]!.situationId, 'e9');
});

test('personal entries carry event ids for dossier entry', () => {
  const view = buildBriefingView({ ...quiet(), personal: report([impact()]) }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.entries[0]!.situationId, 'evt-1');
});

test('positive dependency impacts preserve order, action text, IDs and cap with no saved places', () => {
  const impacts = ['watch', 'critical', 'elevated', 'critical', 'elevated'].map((severity, index) => impact({
    eventId: `dependency-${index}`,
    severity: severity as PersonalImpact['severity'],
    description: `Dependency ${index}`,
    recommendedAction: `Action ${index}`,
    exposures: [{ exposureId: `holding:${index}`, label: `Holding ${index}`, reason: 'symbol match' }],
  }));
  const view = buildBriefingView({ ...quiet(), savedPlacesCount: 0, personal: report(impacts) }, NOW);
  const personal = view.bands[0]!;
  assert.equal(personal.headline, '5 personal impacts near you');
  assert.equal(personal.tone, 'critical');
  assert.deepEqual(personal.entries, [
    { text: '○ Dependency 0 — Action 0', situationId: 'dependency-0' },
    { text: '● Dependency 1 — Action 1', situationId: 'dependency-1' },
    { text: '▲ Dependency 2 — Action 2', situationId: 'dependency-2' },
    { text: '● Dependency 3 — Action 3', situationId: 'dependency-3' },
  ]);
  assert.equal(personal.evidenceNote, `${COVERAGE_NOTE} ${SOURCE_NEXT_STEP}`);
  assertEvidence(view);
});

test('critical threshold, descending event order, deduplication and four-entry cap remain intact', () => {
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: [
    { eventId: 'floor', description: 'At floor', domain: 'weather', severity: CRITICAL_EVENT_FLOOR },
    { eventId: 'below', description: 'Below floor', domain: 'weather', severity: CRITICAL_EVENT_FLOOR - 1 },
    { eventId: 'sit-1', description: 'Duplicate situation', domain: 'conflict', severity: 99 },
    { eventId: 'high', description: 'Higher event', domain: 'conflict', severity: 95 },
    { eventId: 'middle', description: 'Middle event', domain: 'cyber', severity: 80 },
    { eventId: 'tail', description: 'Capped event', domain: 'cyber', severity: 71 },
  ] }, NOW);
  assert.equal(view.bands[2]!.headline, '5 situations worldwide');
  assert.deepEqual(view.bands[2]!.entries.map((e) => e.situationId), ['sit-1', 'high', 'middle', 'tail']);
  const boundary = buildBriefingView({ ...quiet(), recentEvents: [
    { eventId: 'floor', description: 'At floor', domain: 'weather', severity: CRITICAL_EVENT_FLOOR },
  ] }, NOW);
  assert.deepEqual(boundary.bands[2]!.entries, [{ text: '▲ At floor (70)', situationId: 'floor' }]);
  assertEvidence(view);
});
