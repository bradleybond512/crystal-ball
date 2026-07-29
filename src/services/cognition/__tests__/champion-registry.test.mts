/**
 * Tests for src/services/cognition/champion-registry.ts — ACC-402.
 *
 * Coverage:
 *   1. setInitial installs a first champion; refuses a second.
 *   2. promote refuses a 'hold' decision (gate cannot be bypassed).
 *   3. promote activates the challenger with evidence attached.
 *   4. promote refuses re-promoting the already-active model.
 *   5. rollback restores the previous distinct model in one call.
 *   6. rollback refuses with no earlier champion.
 *   7. Persistence round-trip through injected storage.
 *   8. Corrupt persisted payload hydrates to empty.
 *   9. History cap keeps the newest entries.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ChampionRegistry, CHAMPION_STORAGE_KEY } from '../champion-registry.js';
import type { StorageLike } from '../champion-registry.js';
import type { PromotionDecision } from '../promotion-gate.js';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

function makeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

function decision(
  challengerId: string,
  recommendation: 'promote' | 'hold',
  incumbentId = 'incumbent-v1',
): PromotionDecision {
  return {
    challengerId,
    incumbentId,
    recommendation,
    gates: recommendation === 'promote'
      ? [{ id: 'min-pairs-overall', pass: true, detail: 'ok' }]
      : [{ id: 'safety-replay', pass: false, detail: 'recall miss' }],
    pairCount: 240,
    perDomainCounts: { markets: 240 },
    proxyShare: 0,
    evaluatedAt: T0,
  };
}

describe('champion-registry', () => {
  let storage: ReturnType<typeof makeStorage>;
  let registry: ChampionRegistry;
  let now: number;

  beforeEach(() => {
    storage = makeStorage();
    now = T0;
    registry = new ChampionRegistry({ storage, clock: () => now });
  });

  it('setInitial installs the first champion and refuses a second', () => {
    const first = registry.setInitial('forecast-primary', 'incumbent-v1', '1.0.0');
    assert.equal(first.ok, true);
    assert.equal(registry.getActiveChampion('forecast-primary')!.modelId, 'incumbent-v1');
    const second = registry.setInitial('forecast-primary', 'other-model');
    assert.equal(second.ok, false);
    assert.match(second.reason, /already has a champion/);
  });

  it('promote refuses a hold decision and names the failing gates', () => {
    registry.setInitial('forecast-primary', 'incumbent-v1');
    const result = registry.promote('forecast-primary', decision('challenger-v2', 'hold'));
    assert.equal(result.ok, false);
    assert.match(result.reason, /safety-replay/);
    assert.equal(registry.getActiveChampion('forecast-primary')!.modelId, 'incumbent-v1');
  });

  it('promote activates the challenger and keeps the decision evidence', () => {
    registry.setInitial('forecast-primary', 'incumbent-v1');
    now = T0 + 1000;
    const result = registry.promote('forecast-primary', decision('challenger-v2', 'promote'));
    assert.equal(result.ok, true);
    const active = registry.getActiveChampion('forecast-primary')!;
    assert.equal(active.modelId, 'challenger-v2');
    assert.equal(active.reason, 'promotion');
    assert.equal(active.activatedAt, T0 + 1000);
    assert.equal(active.decision!.pairCount, 240, 'promotion keeps its gate evidence for audit');
  });

  it('promote refuses re-promoting the already-active model', () => {
    registry.setInitial('forecast-primary', 'incumbent-v1');
    registry.promote('forecast-primary', decision('challenger-v2', 'promote'));
    const again = registry.promote('forecast-primary', decision('challenger-v2', 'promote'));
    assert.equal(again.ok, false);
    assert.match(again.reason, /already the active champion/);
  });

  it('rollback restores the previous distinct model in one call', () => {
    registry.setInitial('forecast-primary', 'incumbent-v1', '1.0.0');
    registry.promote('forecast-primary', decision('challenger-v2', 'promote'));
    now = T0 + 5000;
    const result = registry.rollback('forecast-primary');
    assert.equal(result.ok, true);
    const active = registry.getActiveChampion('forecast-primary')!;
    assert.equal(active.modelId, 'incumbent-v1');
    assert.equal(active.version, '1.0.0', 'rollback restores the previous version too');
    assert.equal(active.reason, 'rollback');
  });

  it('rollback refuses when there is no earlier champion', () => {
    const empty = registry.rollback('forecast-primary');
    assert.equal(empty.ok, false);
    registry.setInitial('forecast-primary', 'incumbent-v1');
    const onlyOne = registry.rollback('forecast-primary');
    assert.equal(onlyOne.ok, false);
    assert.match(onlyOne.reason, /no earlier champion/);
  });

  it('state round-trips through storage into a fresh registry', () => {
    registry.setInitial('forecast-primary', 'incumbent-v1');
    registry.promote('forecast-primary', decision('challenger-v2', 'promote'));
    const rehydrated = new ChampionRegistry({ storage, clock: () => now });
    assert.equal(rehydrated.getActiveChampion('forecast-primary')!.modelId, 'challenger-v2');
    assert.equal(rehydrated.getHistory('forecast-primary').length, 2);
    assert.deepEqual(rehydrated.getSlots(), ['forecast-primary']);
    // Rollback works across the rehydration boundary — the "one click"
    // survives a restart.
    assert.equal(rehydrated.rollback('forecast-primary').ok, true);
  });

  it('corrupt persisted payload hydrates to an empty registry', () => {
    storage.data.set(CHAMPION_STORAGE_KEY, '{not json');
    const fresh = new ChampionRegistry({ storage, clock: () => now });
    assert.equal(fresh.getActiveChampion('forecast-primary'), undefined);
    assert.deepEqual(fresh.getSlots(), []);
  });

  it('history is capped but the active entry survives', () => {
    registry.setInitial('slot', 'model-0');
    for (let i = 1; i <= 30; i += 1) {
      const result = registry.promote('slot', decision(`model-${i}`, 'promote', `model-${i - 1}`));
      assert.equal(result.ok, true);
    }
    const history = registry.getHistory('slot');
    assert.equal(history.length, 20, 'capped at MAX_HISTORY_PER_SLOT');
    assert.equal(registry.getActiveChampion('slot')!.modelId, 'model-30');
    assert.equal(history.at(-1)!.modelId, 'model-30');
  });
});
