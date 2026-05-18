import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MissionControlDashboardService,
  resetForTests,
  STORAGE_KEY,
  type MissionControlSources,
  type MissionControlPulseSnapshot,
  type MissionControlSituationSnapshot,
  type MissionControlNarrativeSnapshot,
  type MissionControlFeedSnapshot,
  type MissionControlAnomalySnapshot,
  type MissionControlCalendarEntry,
  type MissionControlSignatureMatch,
  type MissionControlSnapshot,
} from '../../src/services/intelligence/mission-control-dashboard.ts';

const NOW = 1_780_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string): string | null { return data.get(k) ?? null; },
    setItem(k: string, v: string): void { data.set(k, v); },
  };
}

function nullSources(): MissionControlSources {
  return {
    getPulse: () => null,
    getSituations: () => [],
    getNarrative: () => null,
    getFeedHealth: () => null,
    getAnomalySummary: () => null,
    getUpcomingEvents: () => [],
    getRecentSignatureMatches: () => [],
  };
}

function makePulse(score: number, label: string): MissionControlPulseSnapshot {
  return { overallScore: score, label, dominantStressor: 'weather' };
}

function situation(
  id: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  status: 'active' | 'watching' | 'resolved',
  domain = 'weather',
): MissionControlSituationSnapshot {
  return { id, name: `Sit ${id}`, domain, severity, status, summary: `summary ${id}`, confidence: 0.8 };
}

function calendarEntry(id: string, daysOut: number, risk: 'low' | 'medium' | 'high' | 'critical' = 'medium'): MissionControlCalendarEntry {
  return {
    id,
    title: `Event ${id}`,
    type: 'summit',
    scheduledAt: NOW + daysOut * DAY,
    riskLevel: risk,
    country: 'USA',
    region: 'North America',
  };
}

describe('MissionControlDashboardService — basic refresh', () => {
  beforeEach(() => { resetForTests(); });

  it('refresh produces a snapshot even when every source is null/empty', () => {
    const svc = new MissionControlDashboardService({
      sources: nullSources(),
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.civilizationScore, null);
    assert.equal(snap.civilizationLabel, null);
    assert.equal(snap.activeSituationCount, 0);
    assert.equal(snap.criticalSituationCount, 0);
    assert.deepEqual(snap.topSituations, []);
    assert.equal(snap.narrativeHeadline, null);
    assert.equal(snap.narrativeSummary, null);
    assert.equal(snap.feedHealth, null);
    assert.equal(snap.anomalyCount, 0);
    assert.deepEqual(snap.upcomingEvents, []);
    assert.deepEqual(snap.signatureMatches, []);
    assert.equal(snap.systemHealthScore, 100);
    assert.equal(snap.generatedAt, NOW);
    assert.ok(snap.id.startsWith('mc-'));
  });

  it('refresh aggregates all sources into one snapshot', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        getPulse: () => makePulse(62, 'elevated'),
        getSituations: () => [
          situation('a', 'critical', 'active', 'earthquake'),
          situation('b', 'high', 'active', 'weather'),
          situation('c', 'medium', 'watching', 'weather'),
          situation('d', 'low', 'resolved', 'cyber'),
        ],
        getNarrative: () => ({ headline: 'Storm pressure rising', executiveSummary: 'Multiple severe storms tracked across the Midwest.' }),
        getFeedHealth: () => ({ total: 12, healthy: 9, degraded: 2, stale: 1, offline: 0, unacknowledgedAlerts: 3 }),
        getAnomalySummary: () => ({ total: 7, unacknowledged: 4, topDomain: 'osint' }),
        getUpcomingEvents: () => [calendarEntry('e1', 3, 'high'), calendarEntry('e2', 14, 'critical')],
        getRecentSignatureMatches: () => [{ signatureId: 'sig-1', signatureName: 'Tsunami precursor', confidence: 'high', matchScore: 0.91 }],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.civilizationScore, 62);
    assert.equal(snap.civilizationLabel, 'elevated');
    assert.equal(snap.activeSituationCount, 2);
    assert.equal(snap.criticalSituationCount, 1);
    assert.equal(snap.topSituations.length, 4);
    assert.equal(snap.narrativeHeadline, 'Storm pressure rising');
    assert.equal(snap.narrativeSummary, 'Multiple severe storms tracked across the Midwest.');
    assert.deepEqual(snap.feedHealth, { total: 12, healthy: 9, degraded: 2, stale: 1, offline: 0, unacknowledgedAlerts: 3 });
    assert.equal(snap.anomalyCount, 7);
    assert.equal(snap.upcomingEvents.length, 2);
    assert.equal(snap.signatureMatches.length, 1);
    assert.ok(snap.systemHealthScore < 100);
  });
});

describe('MissionControlDashboardService — derived counts', () => {
  beforeEach(() => { resetForTests(); });

  it('activeSituationCount excludes resolved situations', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getSituations: () => [
          situation('a', 'critical', 'active'),
          situation('b', 'high', 'watching'),
          situation('c', 'low', 'resolved'),
          situation('d', 'medium', 'resolved'),
        ],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.activeSituationCount, 1);
  });

  it('criticalSituationCount counts only critical+active', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getSituations: () => [
          situation('a', 'critical', 'active'),
          situation('b', 'critical', 'watching'),
          situation('c', 'critical', 'resolved'),
          situation('d', 'high', 'active'),
        ],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.criticalSituationCount, 1);
  });

  it('topSituations are sorted by severity then status priority and capped', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getSituations: () => [
          situation('s1', 'low', 'active'),
          situation('s2', 'critical', 'watching'),
          situation('s3', 'high', 'active'),
          situation('s4', 'critical', 'active'),
          situation('s5', 'medium', 'active'),
          situation('s6', 'high', 'watching'),
          situation('s7', 'critical', 'resolved'),
        ],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    // top should be capped at 5 and start with critical+active
    assert.ok(snap.topSituations.length <= 5);
    assert.equal(snap.topSituations[0]?.id, 's4');
    assert.equal(snap.topSituations[1]?.id, 's2');
  });

  it('upcomingEventsCount derives from sources', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getUpcomingEvents: () => [calendarEntry('a', 1), calendarEntry('b', 4), calendarEntry('c', 6)],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.upcomingEventsCount, 3);
    assert.equal(snap.upcomingEvents.length, 3);
    // daysUntil math
    assert.equal(snap.upcomingEvents[0]?.daysUntil, 1);
    assert.equal(snap.upcomingEvents[2]?.daysUntil, 6);
  });

  it('daysUntil computes positive integer offset from generatedAt', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getUpcomingEvents: () => [calendarEntry('z', 9)],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.upcomingEvents[0]?.daysUntil, 9);
  });
});

describe('MissionControlDashboardService — system health', () => {
  beforeEach(() => { resetForTests(); });

  it('systemHealthScore is 100 when nothing is wrong', () => {
    const svc = new MissionControlDashboardService({
      sources: nullSources(),
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.systemHealthScore, 100);
  });

  it('systemHealthScore drops when feeds are stale/offline', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getFeedHealth: () => ({ total: 10, healthy: 5, degraded: 0, stale: 2, offline: 3, unacknowledgedAlerts: 0 }),
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.ok(snap.systemHealthScore < 100);
    assert.ok(snap.systemHealthScore >= 0);
  });

  it('systemHealthScore drops further with critical situations', () => {
    const lowSeverity = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getSituations: () => [situation('a', 'low', 'active')],
      },
      now: () => NOW,
      storage: null,
    });
    const lowSnap = lowSeverity.refresh();
    resetForTests();
    const critical = new MissionControlDashboardService({
      sources: {
        ...nullSources(),
        getSituations: () => [
          situation('a', 'critical', 'active'),
          situation('b', 'critical', 'active'),
        ],
      },
      now: () => NOW,
      storage: null,
    });
    const critSnap = critical.refresh();
    assert.ok(critSnap.systemHealthScore < lowSnap.systemHealthScore);
  });

  it('systemHealthScore is bounded 0..100', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        getPulse: () => makePulse(0, 'critical'),
        getSituations: () => Array.from({ length: 50 }, (_, i) => situation(`s${i}`, 'critical', 'active')),
        getNarrative: () => null,
        getFeedHealth: () => ({ total: 10, healthy: 0, degraded: 0, stale: 0, offline: 10, unacknowledgedAlerts: 50 }),
        getAnomalySummary: () => ({ total: 100, unacknowledged: 100, topDomain: 'cyber' }),
        getUpcomingEvents: () => [],
        getRecentSignatureMatches: () => [],
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.ok(snap.systemHealthScore >= 0);
    assert.ok(snap.systemHealthScore <= 100);
  });
});

describe('MissionControlDashboardService — history + getLatest', () => {
  beforeEach(() => { resetForTests(); });

  it('getLatest returns null until first refresh', () => {
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage: null });
    assert.equal(svc.getLatest(), null);
    svc.refresh();
    assert.ok(svc.getLatest());
  });

  it('getLatest returns the most recent snapshot', () => {
    let t = NOW;
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage: null });
    svc.refresh();
    t += 1000;
    const second = svc.refresh();
    assert.equal(svc.getLatest()?.id, second.id);
  });

  it('getHistory returns LIFO with most recent first', () => {
    let t = NOW;
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage: null });
    const a = svc.refresh(); t += 1000;
    const b = svc.refresh(); t += 1000;
    const c = svc.refresh();
    const history = svc.getHistory();
    assert.equal(history.length, 3);
    assert.equal(history[0]?.id, c.id);
    assert.equal(history[1]?.id, b.id);
    assert.equal(history[2]?.id, a.id);
  });

  it('getHistory honors limit parameter', () => {
    let t = NOW;
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage: null });
    for (let i = 0; i < 5; i++) { svc.refresh(); t += 1000; }
    assert.equal(svc.getHistory(2).length, 2);
    assert.equal(svc.getHistory(10).length, 5);
  });

  it('ring buffer caps at capacity (default 100)', () => {
    let t = NOW;
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage: null, capacity: 3 });
    svc.refresh(); t += 1000;
    svc.refresh(); t += 1000;
    svc.refresh(); t += 1000;
    svc.refresh(); t += 1000;
    svc.refresh();
    const history = svc.getHistory();
    assert.equal(history.length, 3);
  });

  it('default capacity is 100', () => {
    let t = NOW;
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage: null });
    for (let i = 0; i < 105; i++) { svc.refresh(); t += 1; }
    assert.equal(svc.getHistory().length, 100);
  });
});

describe('MissionControlDashboardService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribers are notified after each refresh', () => {
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage: null });
    const received: MissionControlSnapshot[] = [];
    svc.subscribe((s) => received.push(s));
    svc.refresh();
    svc.refresh();
    assert.equal(received.length, 2);
  });

  it('subscribe returns disposer that stops notifications', () => {
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage: null });
    const received: MissionControlSnapshot[] = [];
    const off = svc.subscribe((s) => received.push(s));
    svc.refresh();
    off();
    svc.refresh();
    assert.equal(received.length, 1);
  });

  it('unsubscribe also removes the listener', () => {
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage: null });
    const received: MissionControlSnapshot[] = [];
    const cb = (s: MissionControlSnapshot) => received.push(s);
    svc.subscribe(cb);
    svc.refresh();
    svc.unsubscribe(cb);
    svc.refresh();
    assert.equal(received.length, 1);
  });
});

describe('MissionControlDashboardService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('snapshots persist to storage and hydrate on construction', () => {
    const storage = memoryStorage();
    let t = NOW;
    const svc1 = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage });
    const a = svc1.refresh(); t += 1000;
    const b = svc1.refresh();

    const svc2 = new MissionControlDashboardService({ sources: nullSources(), now: () => t, storage });
    const hydrated = svc2.getHistory();
    assert.equal(hydrated.length, 2);
    assert.equal(hydrated[0]?.id, b.id);
    assert.equal(hydrated[1]?.id, a.id);
  });

  it('storage key is wm-mission-control', () => {
    assert.equal(STORAGE_KEY, 'wm-mission-control');
  });

  it('null storage means no persistence side effects', () => {
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage: null });
    svc.refresh();
    // No assertions on storage — just ensuring no throw.
    assert.ok(svc.getLatest());
  });

  it('malformed persisted state is recovered gracefully', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not valid json');
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage });
    assert.equal(svc.getLatest(), null);
    // Service still works after malformed hydrate
    const snap = svc.refresh();
    assert.ok(snap);
  });
});

describe('MissionControlDashboardService — source error tolerance', () => {
  beforeEach(() => { resetForTests(); });

  it('throwing sources are caught and treated as null/empty', () => {
    const svc = new MissionControlDashboardService({
      sources: {
        getPulse: () => { throw new Error('pulse down'); },
        getSituations: () => { throw new Error('situ down'); },
        getNarrative: () => { throw new Error('narr down'); },
        getFeedHealth: () => { throw new Error('feed down'); },
        getAnomalySummary: () => { throw new Error('anom down'); },
        getUpcomingEvents: () => { throw new Error('cal down'); },
        getRecentSignatureMatches: () => { throw new Error('sig down'); },
      },
      now: () => NOW,
      storage: null,
    });
    const snap = svc.refresh();
    assert.equal(snap.civilizationScore, null);
    assert.equal(snap.activeSituationCount, 0);
    assert.deepEqual(snap.topSituations, []);
    assert.deepEqual(snap.upcomingEvents, []);
    assert.equal(snap.anomalyCount, 0);
  });
});

describe('MissionControlDashboardService — clear', () => {
  beforeEach(() => { resetForTests(); });

  it('clear empties history and persists empty', () => {
    const storage = memoryStorage();
    const svc = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage });
    svc.refresh();
    svc.refresh();
    assert.equal(svc.getHistory().length, 2);
    svc.clear();
    assert.equal(svc.getHistory().length, 0);

    // Verify persisted state is also empty
    const svc2 = new MissionControlDashboardService({ sources: nullSources(), now: () => NOW, storage });
    assert.equal(svc2.getHistory().length, 0);
  });
});
