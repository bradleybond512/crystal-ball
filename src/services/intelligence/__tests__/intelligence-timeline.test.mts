import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTimeline,
  filterTimeline,
  uniqueDomains,
  alertToTimelineEvent,
  situationToTimelineEvent,
  notificationToTimelineEvent,
  whatChangedToTimelineEvents,
  diagnosticToTimelineEvent,
  type TimelineEvent,
  type DiagnosticTimelineInput,
} from '../intelligence-timeline.ts';
import type { UnifiedAlert } from '@/services/unified-alerts';
import type { Situation } from '@/types/intelligence';
import type { NotificationHistoryEntry } from '@/services/notifications/notification-history-service';
import type { WhatChangedReport } from '../what-changed.ts';

const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function alert(over: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id: 'a1',
    source: 'earthquake',
    severity: 'high',
    title: 'M6.2 earthquake near Tokyo',
    body: 'Strong shaking reported',
    timestamp: NOW - HOUR,
    relevanceScore: 0.7,
    acknowledged: false,
    pinned: false,
    ...over,
  };
}

function sit(over: Partial<Situation> = {}): Situation {
  return {
    id: 's1',
    name: 'Test situation',
    status: 'active',
    severity: 'moderate',
    domain: 'earthquake',
    startedAt: NOW - 2 * HOUR,
    updatedAt: NOW - HOUR,
    observationIds: ['o1', 'o2'],
    correlationIds: [],
    summary: 'Summary',
    tags: [],
    confidence: 0.8,
    ...over,
  };
}

function notif(over: Partial<NotificationHistoryEntry> = {}): NotificationHistoryEntry {
  return {
    id: 'n1',
    recordedAt: NOW - 30 * 60_000,
    domain: 'seismic',
    source: 'push-notifier',
    action: 'fired',
    title: 'Seismic alert',
    body: 'M6.2 reported',
    severity: 'high',
    ...over,
  };
}

// ─── Per-source projectors ────────────────────────────────────────────

test('alertToTimelineEvent: maps severity + sets dedup id', () => {
  const ev = alertToTimelineEvent(alert());
  assert.equal(ev.id, 'alert:a1');
  assert.equal(ev.type, 'alert');
  assert.equal(ev.severity, 'high');
  assert.ok(ev.linkedPanelIds.includes('unified-alert-inbox'));
});

test('alertToTimelineEvent: critical severity passes through', () => {
  const ev = alertToTimelineEvent(alert({ severity: 'critical' }));
  assert.equal(ev.severity, 'critical');
});

test('situationToTimelineEvent: maps moderate → medium', () => {
  const ev = situationToTimelineEvent(sit({ severity: 'moderate' }));
  assert.equal(ev.severity, 'medium');
});

test('situationToTimelineEvent: caps sourceIds at 10 observations', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `obs-${i}`);
  const ev = situationToTimelineEvent(sit({ observationIds: ids }));
  assert.equal(ev.sourceIds.length, 10);
});

test('notificationToTimelineEvent: includes rule id when present', () => {
  const ev = notificationToTimelineEvent(notif({ ruleId: 'rule-7' }));
  assert.ok(ev.sourceIds.includes('rule-7'));
  assert.equal(ev.type, 'notification');
});

test('notificationToTimelineEvent: unknown-domain still produces an event', () => {
  const ev = notificationToTimelineEvent(notif({ domain: 'unknown' }));
  assert.equal(ev.domain, 'unknown');
});

// ─── whatChangedToTimelineEvents ──────────────────────────────────────

const whatChangedFixture: WhatChangedReport = {
  since: NOW - HOUR,
  until: NOW,
  newEventsByDomain: { earthquake: ['e1', 'e2', 'e3'] },
  resolvedEventIds: ['r1'],
  severityEscalations: [{ domain: 'cyber', from: 3, to: 7 }],
  newCorrelationIds: ['c1'],
  totalNewEvents: 3,
  totalResolved: 1,
};

test('whatChanged: emits items per delta type', () => {
  const evs = whatChangedToTimelineEvents(whatChangedFixture, NOW);
  assert.ok(evs.length >= 2);
  assert.ok(evs.every((e) => e.type === 'what-changed'));
});

test('whatChanged: null report → empty list', () => {
  assert.deepEqual(whatChangedToTimelineEvents(null, NOW), []);
});

test('whatChanged: high-weight items get high severity', () => {
  const evs = whatChangedToTimelineEvents(whatChangedFixture, NOW);
  const escalation = evs.find((e) => e.title.includes('cyber severity'));
  assert.ok(escalation);
  assert.ok(escalation!.severity === 'critical' || escalation!.severity === 'high');
});

// ─── diagnosticToTimelineEvent ────────────────────────────────────────

test('diagnostic: passes through severity + builds id with prefix', () => {
  const d: DiagnosticTimelineInput = {
    id: 'd1', timestamp: NOW, domain: 'feed-health', severity: 'medium',
    title: 'USGS feed degraded', summary: 'Last-success age > 5min',
  };
  const ev = diagnosticToTimelineEvent(d);
  assert.equal(ev.id, 'diagnostic:d1');
  assert.equal(ev.severity, 'medium');
});

// ─── buildTimeline: merge + dedupe + sort ─────────────────────────────

test('build: merges all five sources newest-first', () => {
  const events = buildTimeline({
    alerts: [alert({ id: 'a-new', timestamp: NOW - 60_000 })],
    situations: [sit({ id: 's-mid', updatedAt: NOW - 30 * 60_000 })],
    notifications: [notif({ id: 'n-old', recordedAt: NOW - 2 * HOUR })],
    whatChanged: { ...whatChangedFixture, until: NOW - 5 * HOUR },
    diagnostics: [],
    now: NOW,
  });
  // Newest first → alert event leads (alerts/situations/notifications
  // here are placed inside the last few hours; the what-changed report
  // is intentionally older).
  assert.equal(events[0]!.type, 'alert');
  // Oldest non-projected entry (notification) is later.
  assert.ok(events.some((e) => e.id === 'notification:n-old'));
});

test('build: dedupes by id across consecutive merges', () => {
  const events = buildTimeline({
    alerts: [alert({ id: 'dup' }), alert({ id: 'dup' })],
    now: NOW,
  });
  assert.equal(events.length, 1);
});

test('build: honors limit', () => {
  const alerts = Array.from({ length: 20 }, (_, i) => alert({ id: `a${i}`, timestamp: NOW - i * 60_000 }));
  const events = buildTimeline({ alerts, now: NOW, limit: 5 });
  assert.equal(events.length, 5);
});

test('build: honors since (drops older events)', () => {
  const events = buildTimeline({
    alerts: [
      alert({ id: 'old', timestamp: NOW - 6 * HOUR }),
      alert({ id: 'new', timestamp: NOW - 30 * 60_000 }),
    ],
    now: NOW,
    since: NOW - 2 * HOUR,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.id, 'alert:new');
});

test('build: ties broken by severity desc, then id stable order', () => {
  const events = buildTimeline({
    alerts: [
      alert({ id: 'low', severity: 'low', timestamp: NOW }),
      alert({ id: 'crit', severity: 'critical', timestamp: NOW }),
      alert({ id: 'med', severity: 'medium', timestamp: NOW }),
    ],
    now: NOW,
  });
  assert.deepEqual(events.map((e) => e.id), ['alert:crit', 'alert:med', 'alert:low']);
});

test('build: acknowledgments merge into the stream', () => {
  const ack: TimelineEvent = {
    id: 'ack:user-1', timestamp: NOW - 60_000, type: 'acknowledgment',
    domain: 'earthquake', severity: 'info', title: 'User dismissed', summary: '—',
    sourceIds: ['user'], confidence: null, linkedPanelIds: [], raw: null,
  };
  const events = buildTimeline({
    alerts: [alert()],
    acknowledgments: [ack],
    now: NOW,
  });
  assert.ok(events.find((e) => e.type === 'acknowledgment'));
});

test('build: result is JSON-serializable', () => {
  const events = buildTimeline({
    alerts: [alert()],
    situations: [sit()],
    notifications: [notif()],
    now: NOW,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), events);
});

test('build: empty input → empty timeline', () => {
  assert.deepEqual(buildTimeline({ now: NOW }), []);
});

// ─── filterTimeline ───────────────────────────────────────────────────

const sample = buildTimeline({
  alerts: [
    alert({ id: 'a-eq', source: 'earthquake', severity: 'high', timestamp: NOW - 60_000, title: 'EQ near Tokyo' }),
    alert({ id: 'a-cy', source: 'cyber', severity: 'medium', timestamp: NOW - 120_000, title: 'BGP anomaly' }),
  ],
  situations: [sit({ id: 's-eq', domain: 'earthquake' })],
  notifications: [notif({ id: 'n-x', domain: 'cyber', severity: 'low' })],
  now: NOW,
});

test('filter: by domain narrows results', () => {
  const out = filterTimeline(sample, { domain: 'earthquake' });
  assert.ok(out.every((e) => e.domain === 'earthquake'));
});

test('filter: by severity exact match', () => {
  const out = filterTimeline(sample, { severity: 'high' });
  assert.ok(out.every((e) => e.severity === 'high'));
});

test('filter: minSeverity drops weaker rows', () => {
  const out = filterTimeline(sample, { minSeverity: 'high' });
  assert.ok(out.every((e) => e.severity === 'high' || e.severity === 'critical'));
});

test('filter: by type', () => {
  const out = filterTimeline(sample, { type: 'alert' });
  assert.ok(out.every((e) => e.type === 'alert'));
});

test('filter: since / until window', () => {
  const out = filterTimeline(sample, { since: NOW - 90_000, until: NOW });
  assert.ok(out.every((e) => e.timestamp >= NOW - 90_000 && e.timestamp < NOW));
});

test('filter: query substring match (case-insensitive)', () => {
  const out = filterTimeline(sample, { query: 'tokyo' });
  assert.equal(out.length, 1);
  assert.match(out[0]!.title, /Tokyo/);
});

test('filter: empty filter → identity', () => {
  const out = filterTimeline(sample, {});
  assert.equal(out.length, sample.length);
});

test('filter: result is JSON-serializable', () => {
  const out = filterTimeline(sample, { domain: 'earthquake' });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

// ─── uniqueDomains ────────────────────────────────────────────────────

test('uniqueDomains: returns sorted unique values', () => {
  const out = uniqueDomains(sample);
  assert.deepEqual(out, [...new Set(out)].sort());
  assert.ok(out.length > 1);
});

test('uniqueDomains: empty input → empty array', () => {
  assert.deepEqual(uniqueDomains([]), []);
});
