import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  WhatChangedV2,
  resetForTests,
  type DeltaType,
  type WorldDelta,
  type WorldSnapshot,
} from '../../src/services/intelligence/what-changed-v2.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type { Situation } from '../../src/types/intelligence.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev',
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit',
    name: 'Test Situation',
    status: 'active',
    severity: 'moderate',
    domain: 'weather',
    startedAt: NOW,
    updatedAt: NOW,
    observationIds: [],
    correlationIds: [],
    summary: 'test',
    tags: [],
    confidence: 0.7,
    ...overrides,
  };
}

function feeds(map: Record<string, 'healthy' | 'degraded' | 'down'>): WorldSnapshot['feedHealthSummary'] {
  return map;
}

// ── Snapshot ──────────────────────────────────────────────────────────

describe('WhatChangedV2.snapshot', () => {
  beforeEach(() => { resetForTests(); });

  it('produces a deterministic snapshot from observations + situations + feeds', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    const snap = wc.snapshot(
      [makeEvent({ id: 'a' }), makeEvent({ id: 'b', severity: 'HIGH' })],
      [makeSituation({ id: 's1' })],
      feeds({ usgs: 'healthy' }),
    );
    assert.equal(snap.observationIds.length, 2);
    assert.equal(snap.activeSituationIds.length, 1);
    assert.equal(snap.severityCount['MEDIUM'], 1);
    assert.equal(snap.severityCount['HIGH'], 1);
    assert.equal(snap.feedHealthSummary['usgs'], 'healthy');
    assert.ok(snap.takenAt instanceof Date);
    assert.ok(snap.id.length > 0);
  });

  it('only counts non-resolved situations as active', () => {
    const wc = new WhatChangedV2();
    const snap = wc.snapshot(
      [],
      [
        makeSituation({ id: 's1', status: 'active' }),
        makeSituation({ id: 's2', status: 'monitoring' }),
        makeSituation({ id: 's3', status: 'resolved' }),
      ],
      {},
    );
    assert.equal(snap.activeSituationIds.length, 2);
    assert.ok(snap.activeSituationIds.includes('s1'));
    assert.ok(snap.activeSituationIds.includes('s2'));
    assert.equal(snap.situationStatuses['s3'], 'resolved');
  });
});

// ── Diff ──────────────────────────────────────────────────────────────

describe('WhatChangedV2.diff', () => {
  beforeEach(() => { resetForTests(); });

  it('diff(same, same, ...) → 0 deltas', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    const obs = [makeEvent({ id: 'a' })];
    const sits = [makeSituation({ id: 's1' })];
    const f = feeds({ usgs: 'healthy' });
    const a = wc.snapshot(obs, sits, f);
    const b = wc.snapshot(obs, sits, f);
    assert.equal(wc.diff(a, b, obs, sits).length, 0);
  });

  it('new observation in curr → delta type=new-observation', () => {
    const wc = new WhatChangedV2();
    const prev = wc.snapshot([], [], {});
    const fresh = makeEvent({ id: 'a', severity: 'HIGH', domain: 'weather', title: 'M5.2 quake' });
    const curr = wc.snapshot([fresh], [], {});
    const deltas = wc.diff(prev, curr, [fresh], []);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.type, 'new-observation');
    assert.equal(deltas[0]?.domain, 'weather');
    assert.equal(deltas[0]?.severity, 'high');
  });

  it('severity-escalated: MEDIUM → HIGH for same id → severity-escalated delta', () => {
    const wc = new WhatChangedV2();
    const before = makeEvent({ id: 'a', severity: 'MEDIUM' });
    const after = makeEvent({ id: 'a', severity: 'HIGH' });
    const prev = wc.snapshot([before], [], {});
    const curr = wc.snapshot([after], [], {});
    const deltas = wc.diff(prev, curr, [after], []);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.type, 'severity-escalated');
    assert.equal(deltas[0]?.severity, 'high');
  });

  it('severity-deescalated: HIGH → MEDIUM for same id → severity-deescalated delta', () => {
    const wc = new WhatChangedV2();
    const before = makeEvent({ id: 'a', severity: 'HIGH' });
    const after = makeEvent({ id: 'a', severity: 'MEDIUM' });
    const prev = wc.snapshot([before], [], {});
    const curr = wc.snapshot([after], [], {});
    const deltas = wc.diff(prev, curr, [after], []);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.type, 'severity-deescalated');
  });

  it('situation-opened: situation id appears in curr only', () => {
    const wc = new WhatChangedV2();
    const newSit = makeSituation({ id: 's-new', name: 'Hurricane Milton' });
    const prev = wc.snapshot([], [], {});
    const curr = wc.snapshot([], [newSit], {});
    const deltas = wc.diff(prev, curr, [], [newSit]);
    const opened = deltas.filter((d) => d.type === 'situation-opened');
    assert.equal(opened.length, 1);
    assert.equal(opened[0]?.situationId, 's-new');
    assert.match(opened[0]?.summary ?? '', /Hurricane Milton/);
  });

  it('situation-resolved: status changed to resolved', () => {
    const wc = new WhatChangedV2();
    const active = makeSituation({ id: 's1', status: 'active' });
    const resolved = makeSituation({ id: 's1', status: 'resolved' });
    const prev = wc.snapshot([], [active], {});
    const curr = wc.snapshot([], [resolved], {});
    const deltas = wc.diff(prev, curr, [], [resolved]);
    const closed = deltas.filter((d) => d.type === 'situation-resolved');
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.situationId, 's1');
  });

  it('situation-updated: known situation gained new observations', () => {
    const wc = new WhatChangedV2();
    const before = makeSituation({ id: 's1', observationIds: ['ev-1'] });
    const after = makeSituation({ id: 's1', observationIds: ['ev-1', 'ev-2'] });
    const prev = wc.snapshot([], [before], {});
    const curr = wc.snapshot([], [after], {});
    const deltas = wc.diff(prev, curr, [], [after]);
    const updated = deltas.filter((d) => d.type === 'situation-updated');
    assert.equal(updated.length, 1);
  });

  it('entity-risk-changed: delta > 0.15 in entityRiskScores', () => {
    const wc = new WhatChangedV2();
    const prev: WorldSnapshot = {
      id: 'p', takenAt: new Date(NOW),
      observationIds: [], observationSeverityById: {},
      activeSituationIds: [],
      situationStatuses: {}, situationObservationCounts: {},
      feedHealthSummary: {},
      severityCount: {}, entityRiskScores: { 'AAPL': 0.4 },
    };
    const curr: WorldSnapshot = {
      id: 'c', takenAt: new Date(NOW + 1000),
      observationIds: [], observationSeverityById: {},
      activeSituationIds: [],
      situationStatuses: {}, situationObservationCounts: {},
      feedHealthSummary: {},
      severityCount: {}, entityRiskScores: { 'AAPL': 0.7 },
    };
    const deltas = wc.diff(prev, curr, [], []);
    const risk = deltas.filter((d) => d.type === 'entity-risk-changed');
    assert.equal(risk.length, 1);
    assert.deepEqual(risk[0]?.entityIds, ['AAPL']);
  });

  it('entity-risk-changed: delta ≤ 0.15 is suppressed', () => {
    const wc = new WhatChangedV2();
    const prev: WorldSnapshot = {
      id: 'p', takenAt: new Date(NOW),
      observationIds: [], observationSeverityById: {},
      activeSituationIds: [],
      situationStatuses: {}, situationObservationCounts: {},
      feedHealthSummary: {},
      severityCount: {}, entityRiskScores: { 'AAPL': 0.40 },
    };
    const curr: WorldSnapshot = {
      id: 'c', takenAt: new Date(NOW + 1000),
      observationIds: [], observationSeverityById: {},
      activeSituationIds: [],
      situationStatuses: {}, situationObservationCounts: {},
      feedHealthSummary: {},
      severityCount: {}, entityRiskScores: { 'AAPL': 0.50 },
    };
    const deltas = wc.diff(prev, curr, [], []);
    assert.equal(deltas.filter((d) => d.type === 'entity-risk-changed').length, 0);
  });

  it('feed-recovered: degraded → healthy', () => {
    const wc = new WhatChangedV2();
    const prev = wc.snapshot([], [], feeds({ usgs: 'degraded' }));
    const curr = wc.snapshot([], [], feeds({ usgs: 'healthy' }));
    const deltas = wc.diff(prev, curr, [], []);
    const r = deltas.filter((d) => d.type === 'feed-recovered');
    assert.equal(r.length, 1);
    assert.match(r[0]?.summary ?? '', /usgs/);
  });

  it('feed-degraded: healthy → degraded', () => {
    const wc = new WhatChangedV2();
    const prev = wc.snapshot([], [], feeds({ nws: 'healthy' }));
    const curr = wc.snapshot([], [], feeds({ nws: 'degraded' }));
    const deltas = wc.diff(prev, curr, [], []);
    assert.equal(deltas.filter((d) => d.type === 'feed-degraded').length, 1);
  });

  it('feed-degraded: healthy → down', () => {
    const wc = new WhatChangedV2();
    const prev = wc.snapshot([], [], feeds({ nws: 'healthy' }));
    const curr = wc.snapshot([], [], feeds({ nws: 'down' }));
    const deltas = wc.diff(prev, curr, [], []);
    assert.equal(deltas.filter((d) => d.type === 'feed-degraded').length, 1);
  });

  it('every delta has an id, detectedAt Date, and a summary string', () => {
    const wc = new WhatChangedV2();
    const fresh = makeEvent({ id: 'fresh', severity: 'CRITICAL' });
    const prev = wc.snapshot([], [], {});
    const curr = wc.snapshot([fresh], [], {});
    for (const d of wc.diff(prev, curr, [fresh], [])) {
      assert.ok(d.id.length > 0);
      assert.ok(d.detectedAt instanceof Date);
      assert.ok(d.summary.length > 0);
    }
  });

  it('new observation propagates location and entityIds', () => {
    const wc = new WhatChangedV2();
    const fresh = makeEvent({
      id: 'fresh', location: { lat: 38, lon: 142 }, entityIds: ['JP'],
    });
    const prev = wc.snapshot([], [], {});
    const curr = wc.snapshot([fresh], [], {});
    const d = wc.diff(prev, curr, [fresh], [])[0];
    assert.deepEqual(d?.location, { lat: 38, lon: 142 });
    assert.deepEqual(d?.entityIds, ['JP']);
  });
});

// ── record / getRecent / getByDomain / getByType ─────────────────────

describe('WhatChangedV2.record + accessors', () => {
  beforeEach(() => { resetForTests(); });

  function makeDelta(overrides: Partial<WorldDelta> = {}): WorldDelta {
    return {
      id: 'd-' + Math.random().toString(36).slice(2, 8),
      type: 'new-observation',
      domain: 'weather',
      summary: 'something happened',
      severity: 'medium',
      detectedAt: new Date(NOW),
      ...overrides,
    };
  }

  it('record then getRecent returns it', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    wc.record(makeDelta());
    assert.equal(wc.getRecent().length, 1);
  });

  it('getRecent default window is 60 minutes', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    wc.record(makeDelta({ id: 'old', detectedAt: new Date(NOW - 90 * 60_000) }));
    wc.record(makeDelta({ id: 'fresh', detectedAt: new Date(NOW - 5 * 60_000) }));
    const recent = wc.getRecent();
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.id, 'fresh');
  });

  it('getRecent honors custom sinceMs', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    wc.record(makeDelta({ id: 'a', detectedAt: new Date(NOW - 30 * 60_000) }));
    wc.record(makeDelta({ id: 'b', detectedAt: new Date(NOW - 5 * 60_000) }));
    assert.equal(wc.getRecent(10 * 60_000).length, 1);
    assert.equal(wc.getRecent(60 * 60_000).length, 2);
  });

  it('getByDomain filters', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    wc.record(makeDelta({ id: 'a', domain: 'weather' }));
    wc.record(makeDelta({ id: 'b', domain: 'maritime' }));
    assert.equal(wc.getByDomain('weather').length, 1);
    assert.equal(wc.getByDomain('maritime').length, 1);
    assert.equal(wc.getByDomain('aviation').length, 0);
  });

  it('getByType filters', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    wc.record(makeDelta({ id: 'a', type: 'new-observation' }));
    wc.record(makeDelta({ id: 'b', type: 'situation-opened' }));
    assert.equal(wc.getByType('new-observation').length, 1);
    assert.equal(wc.getByType('situation-opened').length, 1);
    assert.equal(wc.getByType('feed-degraded').length, 0);
  });

  it('record dedups same delta id', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    const d = makeDelta({ id: 'fixed' });
    wc.record(d);
    wc.record(d);
    assert.equal(wc.getRecent().length, 1);
  });

  it('respects ring buffer cap of 500', () => {
    const wc = new WhatChangedV2({ capacity: 5, now: () => NOW });
    for (let i = 0; i < 8; i++) {
      wc.record(makeDelta({ id: `d-${i}` }));
    }
    assert.equal(wc.getRecent(Number.POSITIVE_INFINITY).length, 5);
  });

  it('getSummary returns a non-empty descriptive string', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    wc.record(makeDelta({ id: 'a', type: 'new-observation', severity: 'high' }));
    wc.record(makeDelta({ id: 'b', type: 'new-observation', severity: 'high' }));
    wc.record(makeDelta({ id: 'c', type: 'situation-resolved', severity: 'medium' }));
    wc.record(makeDelta({ id: 'd', type: 'feed-recovered', severity: 'low' }));
    const s = wc.getSummary();
    assert.ok(s.length > 0);
    assert.match(s, /high/i);
  });

  it('getSummary on empty buffer returns "No changes"-style message', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    const s = wc.getSummary();
    assert.ok(s.length > 0);
    assert.match(s, /no/i);
  });
});

// ── subscribe ────────────────────────────────────────────────────────

describe('WhatChangedV2.subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on record()', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    let calls = 0;
    let lastType: DeltaType | undefined;
    const off = wc.subscribe((d) => { calls++; lastType = d.type; });
    wc.record({
      id: 'x', type: 'new-observation', domain: 'weather',
      summary: '...', severity: 'medium', detectedAt: new Date(NOW),
    });
    assert.equal(calls, 1);
    assert.equal(lastType, 'new-observation');
    off();
    wc.record({
      id: 'y', type: 'new-observation', domain: 'weather',
      summary: '...', severity: 'medium', detectedAt: new Date(NOW),
    });
    assert.equal(calls, 1);
  });

  it('multiple subscribers all fire', () => {
    const wc = new WhatChangedV2({ now: () => NOW });
    let aCalls = 0;
    let bCalls = 0;
    wc.subscribe(() => aCalls++);
    wc.subscribe(() => bCalls++);
    wc.record({
      id: 'x', type: 'new-observation', domain: 'weather',
      summary: '...', severity: 'medium', detectedAt: new Date(NOW),
    });
    assert.equal(aCalls, 1);
    assert.equal(bCalls, 1);
  });
});

// ── persistence ──────────────────────────────────────────────────────

describe('WhatChangedV2 persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new WhatChangedV2({ storage, now: () => NOW });
    a.record({
      id: 'x', type: 'new-observation', domain: 'weather',
      summary: 'persisted', severity: 'high', detectedAt: new Date(NOW),
    });
    const b = new WhatChangedV2({ storage, now: () => NOW });
    assert.equal(b.getRecent(Number.POSITIVE_INFINITY).length, 1);
    assert.equal(b.getRecent(Number.POSITIVE_INFINITY)[0]?.summary, 'persisted');
  });

  it('corrupted storage falls back to empty without throwing', () => {
    const storage = {
      getItem: () => 'not-json{',
      setItem: () => {},
    };
    const wc = new WhatChangedV2({ storage });
    assert.equal(wc.getRecent(Number.POSITIVE_INFINITY).length, 0);
  });
});

// ── backward-compat shim ─────────────────────────────────────────────

describe('what-changed.ts backward-compat shim', () => {
  it('re-exports WhatChangedV2 as WhatChangedService', async () => {
    const mod = await import('../../src/services/intelligence/what-changed.ts');
    assert.equal(typeof (mod as { WhatChangedService?: unknown }).WhatChangedService, 'function');
  });
});
