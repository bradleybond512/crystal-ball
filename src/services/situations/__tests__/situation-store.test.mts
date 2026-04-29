import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createSituationStore, type SituationStore } from '../situation-store';
import type { Situation } from '../situation-types';

const NOW = 1_745_000_000_000;

function fakeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'test:1',
    domain: 'weather',
    title: 'Test situation',
    summary: 'A test',
    severity: 'elevated',
    confidence: 0.7,
    urgency: 0.6,
    userExposure: 0.5,
    personalImpact: { summary: '', level: 'low', reasons: [] },
    evidence: [],
    sourceAgreement: { agreeing: [], disagreeing: [], independentSourceCount: 0 },
    whatChanged: [],
    expectedNextSignals: [],
    invalidationSignals: [],
    recommendedActions: [],
    timeline: [],
    diagnosticsTrace: {
      createdReason: 'test',
      severityRationale: 'test',
      confidenceRationale: 'test',
      exposureRationale: 'test',
      sourceContributions: {},
      thresholdsCrossed: [],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: NOW,
    lastUpdated: NOW,
    ...overrides,
  };
}

let store: SituationStore;

beforeEach(() => {
  store = createSituationStore({ now: () => NOW });
});

describe('SituationStore.upsert', () => {
  it('inserts a new situation', () => {
    const s = fakeSituation();
    const stored = store.upsert(s);
    assert.equal(stored.id, 'test:1');
    assert.equal(store.get('test:1')?.id, 'test:1');
  });

  it('preserves firstSeen across updates', () => {
    store.upsert(fakeSituation({ firstSeen: NOW }));
    const updated = store.upsert(fakeSituation({ firstSeen: NOW + 60_000, severity: 'critical' }));
    assert.equal(updated.firstSeen, NOW, 'firstSeen must be sticky after first upsert');
    assert.equal(updated.severity, 'critical', 'other fields must update');
  });

  it('merges timelines without duplicates', () => {
    store.upsert(fakeSituation({
      timeline: [{ ts: 100, text: 'a' }, { ts: 200, text: 'b' }],
    }));
    const merged = store.upsert(fakeSituation({
      timeline: [{ ts: 200, text: 'b' }, { ts: 300, text: 'c' }],
    }));
    assert.equal(merged.timeline.length, 3);
    assert.deepEqual(
      merged.timeline.map((t) => t.text),
      ['a', 'b', 'c'],
    );
  });
});

describe('SituationStore.ranked', () => {
  it('returns active situations sorted by composite score', () => {
    store.upsert(fakeSituation({ id: 'low', severity: 'fyi', confidence: 0.5 }));
    store.upsert(fakeSituation({ id: 'mid', severity: 'elevated', confidence: 0.7 }));
    store.upsert(fakeSituation({ id: 'high', severity: 'critical', confidence: 0.9 }));
    const ranked = store.ranked();
    assert.deepEqual(ranked.map((s) => s.id), ['high', 'mid', 'low']);
  });

  it('limit parameter caps the result', () => {
    store.upsert(fakeSituation({ id: 'a', severity: 'critical' }));
    store.upsert(fakeSituation({ id: 'b', severity: 'critical' }));
    store.upsert(fakeSituation({ id: 'c', severity: 'critical' }));
    const top2 = store.ranked(2);
    assert.equal(top2.length, 2);
  });

  it('excludes resolved situations', () => {
    store.upsert(fakeSituation({ id: 'a', severity: 'critical' }));
    store.upsert(fakeSituation({ id: 'b', severity: 'fyi' }));
    store.markResolved('a', 'correct');
    const ranked = store.ranked();
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.id, 'b');
  });
});

describe('SituationStore.markResolved', () => {
  it('moves a situation to resolved phase with verdict', () => {
    store.upsert(fakeSituation());
    const resolved = store.markResolved('test:1', 'correct', 'Caught the storm 42 min before arrival');
    assert.equal(resolved?.phase, 'resolved');
    assert.equal(resolved?.predictionOutcome.verdict, 'correct');
    assert.equal(resolved?.predictionOutcome.notes, 'Caught the storm 42 min before arrival');
  });

  it('returns undefined for missing id', () => {
    assert.equal(store.markResolved('does-not-exist', 'correct'), undefined);
  });
});

describe('SituationStore.subscribe', () => {
  it('notifies on upsert', () => {
    let calls = 0;
    store.subscribe(() => calls++);
    store.upsert(fakeSituation());
    store.upsert(fakeSituation({ id: 'test:2' }));
    assert.equal(calls, 2);
  });

  it('unsubscribe stops further notifications', () => {
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.upsert(fakeSituation());
    off();
    store.upsert(fakeSituation({ id: 'test:2' }));
    assert.equal(calls, 1);
  });

  it('listener errors do not break the store', () => {
    store.subscribe(() => { throw new Error('listener boom'); });
    assert.doesNotThrow(() => store.upsert(fakeSituation()));
  });
});

describe('SituationStore.toJson', () => {
  it('returns a JSON-serializable snapshot', () => {
    store.upsert(fakeSituation({ id: 'a' }));
    store.upsert(fakeSituation({ id: 'b' }));
    const snap = store.toJson();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json) as Situation[];
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.id, 'a');
  });
});

describe('SituationStore.reset', () => {
  it('clears all situations', () => {
    store.upsert(fakeSituation({ id: 'a' }));
    store.upsert(fakeSituation({ id: 'b' }));
    store.reset();
    assert.equal(store.active().length, 0);
  });
});
