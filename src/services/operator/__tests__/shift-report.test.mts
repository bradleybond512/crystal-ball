import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShiftReportStats,
  renderShiftReportMarkdown,
  labelForHistoryDomain,
  TOP_SITUATIONS_LIMIT,
  type ShiftReportInput,
  type SituationSummary,
} from '../shift-report.ts';
import type { NotificationHistoryEntry } from '@/services/notifications/notification-history-service';

const NOW = 1_700_000_000_000;
const ONE_HOUR = 60 * 60 * 1000;

function sit(overrides: Partial<SituationSummary> = {}): SituationSummary {
  return {
    id: 's1', title: 'Event', severity: 'medium', timestamp: NOW - ONE_HOUR,
    ...overrides,
  };
}

function note(overrides: Partial<NotificationHistoryEntry> = {}): NotificationHistoryEntry {
  return {
    id: 'n1', recordedAt: NOW - ONE_HOUR, domain: 'seismic', source: 'push',
    action: 'fired', title: 'M5.2', body: '...', severity: 'medium',
    ...overrides,
  };
}

function input(over: Partial<ShiftReportInput> = {}): ShiftReportInput {
  return {
    now: NOW,
    situations: [],
    notifications: [],
    degradedFeeds: [],
    ...over,
  };
}

test('buildShiftReportStats: filters situations OUTSIDE the look-back window', () => {
  const stats = buildShiftReportStats(input({
    situations: [
      sit({ id: 'recent', timestamp: NOW - ONE_HOUR }),
      sit({ id: 'old',    timestamp: NOW - 10 * ONE_HOUR }), // before 8h window
    ],
  }));
  assert.equal(stats.totalSituations, 1);
  assert.equal(stats.topSituations[0]?.id, 'recent');
});

test('buildShiftReportStats: top situations sort by severity then timestamp desc', () => {
  const stats = buildShiftReportStats(input({
    situations: [
      sit({ id: 'a', severity: 'low',      timestamp: NOW - ONE_HOUR }),
      sit({ id: 'b', severity: 'critical', timestamp: NOW - 3 * ONE_HOUR }),
      sit({ id: 'c', severity: 'high',     timestamp: NOW - 2 * ONE_HOUR }),
      sit({ id: 'd', severity: 'high',     timestamp: NOW - ONE_HOUR }),     // newer high
    ],
  }));
  assert.deepEqual(stats.topSituations.map((s) => s.id), ['b', 'd', 'c', 'a']);
});

test(`buildShiftReportStats: top situations capped at ${TOP_SITUATIONS_LIMIT}`, () => {
  const many = Array.from({ length: TOP_SITUATIONS_LIMIT + 3 }, (_, i) =>
    sit({ id: `s${i}`, severity: 'critical', timestamp: NOW - i * 1000 }),
  );
  const stats = buildShiftReportStats(input({ situations: many }));
  assert.equal(stats.topSituations.length, TOP_SITUATIONS_LIMIT);
});

test('buildShiftReportStats: groups notifications by domain', () => {
  const stats = buildShiftReportStats(input({
    notifications: [
      note({ id: 'n1', domain: 'seismic'  }),
      note({ id: 'n2', domain: 'seismic'  }),
      note({ id: 'n3', domain: 'wildfire' }),
    ],
  }));
  assert.equal(stats.notificationsByDomain.seismic, 2);
  assert.equal(stats.notificationsByDomain.wildfire, 1);
});

test('buildShiftReportStats: counts fired/suppressed/escalated separately', () => {
  const stats = buildShiftReportStats(input({
    notifications: [
      note({ id: 'a', action: 'fired'      }),
      note({ id: 'b', action: 'fired'      }),
      note({ id: 'c', action: 'suppressed' }),
      note({ id: 'd', action: 'escalated'  }),
    ],
  }));
  assert.equal(stats.notificationsFired, 2);
  assert.equal(stats.notificationsSuppressed, 1);
  assert.equal(stats.notificationsEscalated, 1);
});

test('buildShiftReportStats: notifications outside window excluded from counts', () => {
  const stats = buildShiftReportStats(input({
    notifications: [
      note({ id: 'recent', recordedAt: NOW - ONE_HOUR }),
      note({ id: 'old',    recordedAt: NOW - 10 * ONE_HOUR }),
    ],
  }));
  assert.equal(stats.notificationsFired, 1);
});

test('buildShiftReportStats: custom window respected', () => {
  const stats = buildShiftReportStats(input({
    windowMs: 2 * ONE_HOUR,
    situations: [
      sit({ id: 'inside',  timestamp: NOW - ONE_HOUR }),
      sit({ id: 'outside', timestamp: NOW - 3 * ONE_HOUR }),
    ],
  }));
  assert.equal(stats.totalSituations, 1);
});

test('renderShiftReportMarkdown: contains required section headers', () => {
  const md = renderShiftReportMarkdown(input({
    situations: [sit({ title: 'TestSituation', severity: 'critical' })],
    notifications: [note({ action: 'fired' })],
    degradedFeeds: [{ id: 'usgs', name: 'USGS', reason: 'HTTP 503' }],
  }));
  assert.match(md, /# Shift handoff/);
  assert.match(md, /## Top situations/);
  assert.match(md, /## Alerts by domain/);
  assert.match(md, /## Notification delivery/);
  assert.match(md, /## Degraded feeds/);
});

test('renderShiftReportMarkdown: includes the operator name when supplied', () => {
  const md = renderShiftReportMarkdown(input({ operator: 'Alice' }));
  assert.match(md, /Shift handoff — Alice/);
});

test('renderShiftReportMarkdown: lists each degraded feed by id + reason', () => {
  const md = renderShiftReportMarkdown(input({
    degradedFeeds: [
      { id: 'usgs', name: 'USGS Earthquakes', reason: 'HTTP 503' },
      { id: 'nws',  name: 'NWS Alerts',       reason: 'stale (4h)' },
    ],
  }));
  assert.match(md, /USGS Earthquakes/);
  assert.match(md, /HTTP 503/);
  assert.match(md, /stale \(4h\)/);
});

test('renderShiftReportMarkdown: friendly empty state when nothing happened', () => {
  const md = renderShiftReportMarkdown(input());
  assert.match(md, /No situations in window/);
  assert.match(md, /No notifications in window/);
  assert.match(md, /All feeds nominal/);
});

test('labelForHistoryDomain maps known domains to human labels', () => {
  assert.equal(labelForHistoryDomain('seismic'), 'Seismic');
  assert.equal(labelForHistoryDomain('wildfire'), 'Wildfire');
  assert.equal(labelForHistoryDomain('unknown'), 'Unknown');
});
