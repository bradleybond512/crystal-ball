import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectLiveQualityDebt,
  getActiveQualityDebt,
  resetQualityDebtForTests,
} from '../quality-debt-state';

const NOW = 1_745_000_000_000;

beforeEach(() => {
  resetQualityDebtForTests();
});

describe('collectLiveQualityDebt', () => {
  it('returns empty when given no inputs', () => {
    const active = collectLiveQualityDebt({ now: () => NOW });
    assert.equal(active.length, 0);
  });

  it('records seeds from smoke outcomes', () => {
    const active = collectLiveQualityDebt({
      smokeOutcomes: [
        { panelId: 'foo', state: 'silent', reason: 'no content' },
        { panelId: 'bar', state: 'errored', reason: 'TypeError' },
        { panelId: 'baz', state: 'degraded', reason: 'banner shown' }, // skipped
      ],
      now: () => NOW,
    });
    assert.ok(active.length >= 2);
    assert.ok(active.some((d) => d.id.includes('foo')));
    assert.ok(active.some((d) => d.id.includes('bar')));
    assert.ok(!active.some((d) => d.id.includes('baz')));
  });

  it('is idempotent — running twice with the same inputs does not duplicate', () => {
    const args = {
      smokeOutcomes: [{ panelId: 'foo', state: 'silent' as const, reason: 'no content' }],
      now: () => NOW,
    };
    collectLiveQualityDebt(args);
    const sizeAfterFirst = getActiveQualityDebt().length;
    collectLiveQualityDebt(args);
    const sizeAfterSecond = getActiveQualityDebt().length;
    assert.equal(sizeAfterFirst, sizeAfterSecond);
  });

  it('sorts active debt by impact descending', () => {
    collectLiveQualityDebt({
      smokeOutcomes: [
        { panelId: 'low', state: 'silent', reason: 'low' },
        { panelId: 'high', state: 'errored', reason: 'high' }, // errored → high severity
      ],
      now: () => NOW,
    });
    const active = getActiveQualityDebt();
    // Higher severity comes first (errored=high > silent=medium).
    assert.ok(active.length >= 2);
    assert.equal(active[0]?.severity, 'high');
  });

  it('supports running multiple adapters in one call', () => {
    const active = collectLiveQualityDebt({
      smokeOutcomes: [{ panelId: 'foo', state: 'silent', reason: 'r' }],
      providerSnapshots: [
        {
          providerId: 'p1',
          domain: 'weather',
          level: 'silent',
          lastUpdateAt: NOW - 60_000,
        },
      ],
      now: () => NOW,
    });
    // We expect at least one seed from each adapter.
    assert.ok(active.some((d) => d.id.includes('panel-smoke')));
    assert.ok(active.some((d) => d.id.includes('provider')));
  });
});

describe('getActiveQualityDebt', () => {
  it('returns the singleton registry active list', () => {
    collectLiveQualityDebt({
      smokeOutcomes: [{ panelId: 'foo', state: 'silent', reason: 'r' }],
      now: () => NOW,
    });
    const direct = getActiveQualityDebt();
    assert.ok(direct.length >= 1);
  });
});
