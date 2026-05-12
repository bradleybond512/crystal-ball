import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMissionState,
  getMissionStateDetail,
  _resetMissionState,
  _setSourcesOverride,
  type MissionState,
  type MissionStateChangedDetail,
} from '../mission-state-service.ts';
import type { DataSourceState } from '@/services/data-freshness';

// ── Document mock (Node.js has no document) ───────────────────────────

function makeMockDocument(events: CustomEvent[]) {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, fn: EventListener) {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event: Event) {
      events.push(event as CustomEvent);
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    },
  };
}

function withMockDocument(mock: ReturnType<typeof makeMockDocument>, fn: () => void): void {
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = mock;
  try { fn(); } finally { g.document = prev; }
}

// ── Helpers ────────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

type PartialSource = Partial<DataSourceState> & Pick<DataSourceState, 'id' | 'status'>;

function src(id: string, status: DataSourceState['status'], name = id): DataSourceState {
  return {
    id: id as DataSourceState['id'],
    name,
    lastUpdate: status === 'fresh' ? new Date(NOW) : null,
    lastError: status === 'error' ? 'err' : null,
    itemCount: 0,
    enabled: status !== 'disabled',
    status,
    requiredForRisk: false,
  } satisfies DataSourceState;
}

function freshSources(count = 20): DataSourceState[] {
  return Array.from({ length: count }, (_, i) => src(`feed-${i}`, 'fresh', `Feed ${i}`));
}

function withCritical(extras: PartialSource[]): DataSourceState[] {
  const base = freshSources(20);
  for (const e of extras) {
    const idx = base.findIndex((s) => s.id === e.id);
    const replacement = { ...src(e.id, e.status, e.name ?? e.id), ...e };
    if (idx >= 0) {
      base[idx] = replacement;
    } else {
      base.push(replacement);
    }
  }
  return base;
}

function setup(sources: DataSourceState[]) {
  _resetMissionState();
  _setSourcesOverride(() => sources);
}

// ── Tests ──────────────────────────────────────────────────────────────

test('NOMINAL when all feeds are fresh', () => {
  setup(freshSources(20));
  assert.equal(getMissionState(), 'NOMINAL');
});

test('NOMINAL when fewer than 5 feeds stale and fewer than 3 critical stale', () => {
  setup(withCritical([
    { id: 'feed-0', status: 'stale' },
    { id: 'feed-1', status: 'error' },
  ]));
  assert.equal(getMissionState(), 'NOMINAL');
});

test('DEGRADED when ≥5 non-critical feeds are stale', () => {
  const sources = freshSources(20).map((s, i) =>
    i < 5 ? { ...s, status: 'stale' as const } : s,
  );
  setup(sources);
  assert.equal(getMissionState(), 'DEGRADED');
});

test('CRITICAL when ≥3 critical feeds are stale', () => {
  setup(withCritical([
    { id: 'usgs', status: 'stale' },
    { id: 'nws-alerts', status: 'error' },
    { id: 'firms', status: 'no_data' },
  ]));
  assert.equal(getMissionState(), 'CRITICAL');
});

test('CRITICAL takes precedence when both ≥3 critical and ≥5 total stale', () => {
  const base = freshSources(20).map((s, i) =>
    i < 6 ? { ...s, status: 'stale' as const } : s,
  );
  setup(withCritical([
    { id: 'usgs', status: 'stale' },
    { id: 'nws-alerts', status: 'error' },
    { id: 'firms', status: 'very_stale' },
    ...base,
  ]));
  assert.equal(getMissionState(), 'CRITICAL');
});

test('getMissionStateDetail returns correct counts for NOMINAL', () => {
  setup(withCritical([{ id: 'feed-0', status: 'stale' }]));
  const detail = getMissionStateDetail();
  assert.equal(detail.state, 'NOMINAL');
  assert.equal(detail.staleFeedCount, 1);
  assert.equal(detail.criticalStaleFeedCount, 0);
  assert.ok(detail.staleFeedNames.includes('feed-0'));
});

test('getMissionStateDetail counts only critical-feed-id stale sources', () => {
  setup(withCritical([
    { id: 'usgs', status: 'error', name: 'USGS Earthquakes' },
    { id: 'ais', status: 'stale', name: 'AIS' },
  ]));
  const detail = getMissionStateDetail();
  assert.equal(detail.criticalStaleFeedCount, 2);
  assert.ok(detail.staleFeedNames.includes('USGS Earthquakes'));
});

test('disabled feeds are excluded from stale count', () => {
  const sources = freshSources(20).map((s, i) =>
    i < 8 ? { ...s, status: 'disabled' as const } : s,
  );
  setup(sources);
  const detail = getMissionStateDetail();
  assert.equal(detail.staleFeedCount, 0);
  assert.equal(detail.state, 'NOMINAL');
});

test('no event dispatched on first call (no previous state)', () => {
  const events: CustomEvent[] = [];
  const mockDoc = makeMockDocument(events);
  withMockDocument(mockDoc, () => {
    _resetMissionState();
    _setSourcesOverride(() => freshSources());
    getMissionStateDetail();
  });
  assert.equal(events.length, 0);
});

test('event dispatched on state transition', () => {
  const events: CustomEvent[] = [];
  const mockDoc = makeMockDocument(events);
  withMockDocument(mockDoc, () => {
    // First call: NOMINAL (sets lastState = NOMINAL, no event)
    _resetMissionState();
    _setSourcesOverride(() => freshSources());
    getMissionStateDetail();

    // Second call: DEGRADED (transition → event)
    _setSourcesOverride(() =>
      freshSources(20).map((s, i) => (i < 5 ? { ...s, status: 'stale' as const } : s)),
    );
    getMissionStateDetail();
  });

  assert.equal(events.length, 1);
  const detail = (events[0] as CustomEvent<MissionStateChangedDetail>).detail;
  assert.equal(detail.state, 'DEGRADED');
  assert.equal(detail.previous, 'NOMINAL');
});

test('no event when state unchanged across calls', () => {
  const events: CustomEvent[] = [];
  const mockDoc = makeMockDocument(events);
  withMockDocument(mockDoc, () => {
    _resetMissionState();
    _setSourcesOverride(() => freshSources());
    getMissionStateDetail(); // sets NOMINAL
    getMissionStateDetail(); // still NOMINAL, no event
    getMissionStateDetail(); // still NOMINAL, no event
  });
  assert.equal(events.length, 0);
});

test('CRITICAL requires exactly 3 or more critical feeds stale, not fewer', () => {
  // Only 2 critical feeds stale → not CRITICAL
  setup(withCritical([
    { id: 'usgs', status: 'stale' },
    { id: 'nws-alerts', status: 'error' },
  ]));
  assert.notEqual(getMissionState(), 'CRITICAL');
});

test('very_stale counts as stale for critical-feed threshold', () => {
  setup(withCritical([
    { id: 'usgs', status: 'very_stale' },
    { id: 'nws-alerts', status: 'very_stale' },
    { id: 'space-weather', status: 'very_stale' },
  ]));
  assert.equal(getMissionState(), 'CRITICAL');
});

test('getMissionState() is a shortcut for getMissionStateDetail().state', () => {
  setup(freshSources());
  _resetMissionState();
  _setSourcesOverride(() => freshSources());
  const fromDetail = getMissionStateDetail().state;
  _resetMissionState();
  _setSourcesOverride(() => freshSources());
  const fromShortcut = getMissionState();
  assert.equal(fromShortcut, fromDetail);
});

test('staleFeedNames array matches stale source names', () => {
  setup(withCritical([
    { id: 'feed-3', status: 'error', name: 'Alpha Feed' },
    { id: 'feed-4', status: 'stale', name: 'Beta Feed' },
  ]));
  const { staleFeedNames } = getMissionStateDetail();
  assert.ok(staleFeedNames.includes('Alpha Feed'), 'should include Alpha Feed');
  assert.ok(staleFeedNames.includes('Beta Feed'), 'should include Beta Feed');
  assert.equal(staleFeedNames.length, 2);
});
