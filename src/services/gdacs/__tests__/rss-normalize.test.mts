import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGdacsRssEnvelope } from '../rss-normalize';

describe('normalizeGdacsRssEnvelope', () => {
  it('returns a safe empty envelope for completely missing payload', () => {
    const env = normalizeGdacsRssEnvelope(null);
    assert.deepEqual(env.events, []);
    assert.equal(env.degraded, true);
    assert.equal(env.reason, 'invalid envelope');
  });

  it('coerces an envelope without an `events` field to []', () => {
    // The shape the panel-smoke harness fetch mock returned, which crashed
    // the renderer before this fix.
    const env = normalizeGdacsRssEnvelope({ ok: true, items: [], data: [] });
    assert.deepEqual(env.events, []);
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /missing events array/);
  });

  it('coerces a non-array `events` field to []', () => {
    const env = normalizeGdacsRssEnvelope({ events: 'oops', count: 9 });
    assert.deepEqual(env.events, []);
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /missing events array/);
  });

  it('passes through a valid envelope unchanged', () => {
    const raw = {
      events: [{
        id: 'a',
        eventType: 'EQ',
        name: 'Test quake',
        alertLevel: 'Orange',
        score: 1.5,
        country: 'TR',
        coordinates: [29, 41],
        fromDate: '2026-05-12T00:00:00Z',
        severity: 'M6.0',
        url: 'https://example/',
      }],
      count: 1,
      fetchedAt: 1_700_000_000_000,
      degraded: false,
      reason: undefined,
    };
    const env = normalizeGdacsRssEnvelope(raw);
    assert.equal(env.events.length, 1);
    assert.equal(env.events[0]!.id, 'a');
    assert.equal(env.degraded, false);
    assert.equal(env.fetchedAt, 1_700_000_000_000);
  });

  it('reading events.length never throws on a malformed envelope', () => {
    const env = normalizeGdacsRssEnvelope({});
    assert.equal(env.events.length, 0);
    assert.doesNotThrow(() => env.events.map((e) => e.id));
  });

  it('preserves caller-supplied degraded=true even when events is present', () => {
    const env = normalizeGdacsRssEnvelope({ events: [], degraded: true, reason: 'upstream 5xx' });
    assert.equal(env.degraded, true);
    assert.equal(env.reason, 'upstream 5xx');
  });
});
