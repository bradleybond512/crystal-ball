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
  return { personal: report([]), changed: [], monitoredPlacesCount: 3 };
}

test('all quiet collapses to allClear with places count', () => {
  const view = buildBriefingView(quiet(), NOW);
  assert.equal(view.allClear, true);
  assert.ok(view.allClearText.includes('3 places'));
  assert.equal(view.bands.length, 3);
  assert.ok(view.bands.every((b) => b.tone === 'clear'));
  assert.equal(view.generatedAt, NOW);
});

test('critical personal impact drives band tone and lines', () => {
  const view = buildBriefingView({ ...quiet(), personal: report([impact()]) }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.tone, 'critical');
  assert.equal(personal.headline, '1 personal impact near you');
  assert.ok(personal.entries[0]!.text.includes('Severe cell approaching HOME'));
  assert.equal(view.allClear, false);
});

test('low/none impacts do not break all-clear', () => {
  const view = buildBriefingView(
    { ...quiet(), personal: report([impact({ severity: 'low' }), impact({ severity: 'none' })]) },
    NOW,
  );
  assert.equal(view.bands.find((b) => b.kind === 'personal')!.tone, 'clear');
  assert.equal(view.allClear, true);
});

test('missing personal report renders honest staleness and blocks all-clear', () => {
  const view = buildBriefingView(
    { changed: [], personal: undefined, lastGoodPersonalAt: NOW - 3_600_000 },
    NOW,
  );
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.tone, 'info');
  assert.ok(personal.staleness!.startsWith('unavailable · last good '));
  assert.equal(view.allClear, false);
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

test('undefined changed digest is stale, not empty', () => {
  const view = buildBriefingView({ ...quiet(), changed: undefined }, NOW);
  const changed = view.bands.find((b) => b.kind === 'changed')!;
  assert.equal(changed.tone, 'info');
  assert.ok(changed.staleness!.startsWith('unavailable'));
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
  assert.equal(view.bands.find((b) => b.kind === 'critical')!.tone, 'clear');
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

test('no successful update yet renders the undefined-lastGood staleness line', () => {
  const view = buildBriefingView({ changed: [], personal: undefined }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.staleness, 'unavailable · no successful update yet');
});

test('singular forms: one change and one place', () => {
  const changedView = buildBriefingView({ ...quiet(), changed: [delta()] }, NOW);
  const changed = changedView.bands.find((b) => b.kind === 'changed')!;
  assert.ok(changed.headline.startsWith('1 change since'));

  const placeView = buildBriefingView({ ...quiet(), monitoredPlacesCount: 1 }, NOW);
  assert.ok(placeView.allClearText.includes('1 place monitored'));
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
  assert.equal(personal.tone, 'clear');
  assert.equal(personal.headline, 'All clear near your places');
  assert.equal(view.allClear, true);
});

test('critical entries carry situation/event ids for dossier entry', () => {
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: [
    { eventId: 'e9', description: 'High-sev event', domain: 'conflict', severity: 88 },
  ] }, NOW);
  const critical = view.bands.find((b) => b.kind === 'critical')!;
  assert.equal(critical.entries[0]!.situationId, 'sit-1');
  assert.equal(critical.entries[1]!.situationId, 'e9');
});

test('personal entries carry no ids', () => {
  const view = buildBriefingView({ ...quiet(), personal: report([impact()]) }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.entries[0]!.situationId, undefined);
});
