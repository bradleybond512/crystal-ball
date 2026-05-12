/**
 * Bootstrap-level integration: confirm that ingesting an event through
 * the observation-store fires runRuleActions on a matching rule and
 * persists the bumped triggerCount.
 *
 * Uses an in-memory localStorage stand-in attached to globalThis so the
 * engine's default-storage path picks it up.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ingest } from '../observation-store.ts';
import { loadRules, saveRules, __resetIdCounter, createRule } from '../rules-engine.ts';
import {
  startRulesEngineBootstrap,
  stopRulesEngineBootstrap,
} from '../rules-bootstrap.ts';
import type { ObservationEvent } from '@/types/intelligence';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

function event(over: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: over.id ?? `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'usgs',
    domain: 'natural',
    timestamp: Date.now(),
    location: { lat: 41.6, lon: -86.7, radiusKm: 30 },
    severity: 'HIGH',
    title: 'M6.0 earthquake',
    raw: { magnitude: 6.0 },
    entityIds: [],
    tags: ['earthquake'],
    ...over,
  };
}

function withStorage(fn: () => void): void {
  const storage = new MemoryStorage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = storage;
  try { fn(); } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  }
}

test('startRulesEngineBootstrap: ingest fires matching rules and bumps triggerCount', () => {
  withStorage(() => {
    stopRulesEngineBootstrap();
    __resetIdCounter();
    const rule = createRule({
      name: 'high-natural',
      enabled: true,
      conditionOperator: 'AND',
      conditions: [
        { field: 'domain', operator: 'equals', value: 'natural' },
        { field: 'severity', operator: 'equals', value: 'HIGH' },
      ],
      actions: [{ type: 'log' }],
    });
    saveRules([rule]);
    startRulesEngineBootstrap();
    ingest(event());
    ingest(event());
    const after = loadRules();
    assert.equal(after.length, 1);
    assert.equal(after[0]?.triggerCount, 2);
    assert.ok(after[0]?.lastTriggered);
    stopRulesEngineBootstrap();
  });
});

test('startRulesEngineBootstrap: non-matching events leave triggerCount alone', () => {
  withStorage(() => {
    stopRulesEngineBootstrap();
    __resetIdCounter();
    const rule = createRule({
      name: 'finance-only',
      enabled: true,
      conditionOperator: 'AND',
      conditions: [{ field: 'domain', operator: 'equals', value: 'finance' }],
      actions: [{ type: 'log' }],
    });
    saveRules([rule]);
    startRulesEngineBootstrap();
    ingest(event({ domain: 'natural' }));
    const after = loadRules();
    assert.equal(after[0]?.triggerCount, 0);
    assert.equal(after[0]?.lastTriggered, undefined);
    stopRulesEngineBootstrap();
  });
});

test('startRulesEngineBootstrap: idempotent — second call is a no-op', () => {
  withStorage(() => {
    stopRulesEngineBootstrap();
    __resetIdCounter();
    const rule = createRule({
      name: 'log-all',
      enabled: true,
      conditionOperator: 'AND',
      conditions: [{ field: 'domain', operator: 'equals', value: 'natural' }],
      actions: [{ type: 'log' }],
    });
    saveRules([rule]);
    startRulesEngineBootstrap();
    startRulesEngineBootstrap(); // second call must not double-subscribe
    ingest(event());
    const after = loadRules();
    assert.equal(after[0]?.triggerCount, 1);
    stopRulesEngineBootstrap();
  });
});
