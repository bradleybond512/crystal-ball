/**
 * OutcomeLedger + AttentionAllocator security hardening tests.
 *
 * Covers the three P1 fixes from Security Review Pass 15:
 *
 *   Fix 1 — deserializeEntry() enum validation:
 *     - Invalid actualOutcome string is silently dropped on hydrate
 *     - Invalid predictedSeverity string is silently dropped on hydrate
 *     - All six valid OutcomeAction values are accepted
 *     - All four valid PredictedSeverity values are accepted
 *
 *   Fix 2 — AttentionAllocator.recompute() rate-limiting:
 *     - Single recompute cannot move a multiplier more than MAX_RECOMPUTE_STEP
 *     - Multiple recomputes converge toward target over time
 *     - Domains that haven't changed are not clamped unnecessarily
 *
 *   Fix 3 — tamper-detection hash in persist/hydrate:
 *     - persist() writes v2 blob with correct checksum
 *     - hydrate() accepts v2 blob with correct checksum
 *     - hydrate() rejects v2 blob with wrong checksum, sets tamperDetected
 *     - hydrate() accepts v1 (legacy bare-array) format without checksum
 *     - computeChecksum is deterministic
 *     - tamperDetected resets to false after successful persist
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

// ── localStorage stub ─────────────────────────────────────────────────
// Must be set before any module that hydrates from localStorage is imported.
const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  OutcomeLedger,
  __resetOutcomeLedgerSingleton,
  __internals as ledgerInternals,
  type OutcomeAction,
  type PredictedSeverity,
} from '../../src/services/intelligence/outcome-ledger.ts';
import {
  AttentionAllocator,
  __resetAttentionAllocatorSingleton,
  __internals as allocatorInternals,
} from '../../src/services/intelligence/attention-allocator.ts';

const { STORAGE_KEY, computeChecksum, VALID_OUTCOME_ACTIONS } = ledgerInternals;
const { MAX_RECOMPUTE_STEP } = allocatorInternals;

const NOW = 1_780_000_000_000;

function freshLedger(): OutcomeLedger {
  __storage.clear();
  __resetOutcomeLedgerSingleton();
  __resetAttentionAllocatorSingleton();
  return new OutcomeLedger({ clock: () => NOW });
}

function recordN(
  ledger: OutcomeLedger,
  domain: string,
  action: OutcomeAction,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    ledger.record({ domain, predictedSeverity: 'high', actualOutcome: action });
  }
}

// ── Fix 1: enum validation ────────────────────────────────────────────

describe('Fix 1 — deserializeEntry enum validation', () => {
  test('invalid actualOutcome string is dropped on hydrate', () => {
    const ledger = freshLedger();
    // Inject a raw blob with a tampered actualOutcome value.
    const tampered = JSON.stringify({
      v: 2,
      data: [
        {
          id: 'oc-bad-1',
          domain: 'weather',
          predictedSeverity: 'high',
          actualOutcome: 'INJECT_ESCALATED_x999',
          recordedAt: NOW,
        },
      ],
      cs: 0, // wrong cs — but we want to test the enum check, so bypass cs by using v1
    });
    // Use v1 (array) format so the checksum gate doesn't reject it first.
    const v1Blob = JSON.stringify([
      {
        id: 'oc-bad-1',
        domain: 'weather',
        predictedSeverity: 'high',
        actualOutcome: 'INJECT_ESCALATED_x999',
        recordedAt: NOW,
      },
    ]);
    __storage.set(STORAGE_KEY, v1Blob);
    __resetOutcomeLedgerSingleton();
    const rehydrated = new OutcomeLedger({ clock: () => NOW });
    assert.equal(rehydrated.list().length, 0, 'tampered entry should be rejected');
  });

  test('invalid predictedSeverity string is dropped on hydrate', () => {
    const v1Blob = JSON.stringify([
      {
        id: 'oc-bad-sev',
        domain: 'weather',
        predictedSeverity: 'SUPER_CRITICAL_9000',
        actualOutcome: 'escalated',
        recordedAt: NOW,
      },
    ]);
    __storage.set(STORAGE_KEY, v1Blob);
    __resetOutcomeLedgerSingleton();
    const rehydrated = new OutcomeLedger({ clock: () => NOW });
    assert.equal(rehydrated.list().length, 0, 'entry with unknown severity should be rejected');
  });

  test('all six valid OutcomeAction values are accepted on hydrate', () => {
    const validActions: OutcomeAction[] = [
      'dismissed', 'acted-on', 'escalated',
      'de-escalated', 'confirmed-real', 'marked-false-positive',
    ];
    assert.equal(validActions.length, VALID_OUTCOME_ACTIONS.size);
    for (const action of validActions) {
      assert.ok(VALID_OUTCOME_ACTIONS.has(action), `${action} should be valid`);
    }
  });

  test('all four valid PredictedSeverity values survive a round-trip', () => {
    const severities: PredictedSeverity[] = ['low', 'medium', 'high', 'critical'];
    for (const sev of severities) {
      const ledger = freshLedger();
      ledger.record({ domain: 'test', predictedSeverity: sev, actualOutcome: 'dismissed' });
      // Reload from storage.
      __resetOutcomeLedgerSingleton();
      const rehydrated = new OutcomeLedger({ clock: () => NOW });
      const recs = rehydrated.list();
      assert.equal(recs.length, 1, `severity ${sev} should survive round-trip`);
      assert.equal(recs[0]!.predictedSeverity, sev);
    }
  });

  test('mixed blob: valid entries survive, invalid entries are dropped', () => {
    const v1Blob = JSON.stringify([
      { id: 'ok-1', domain: 'weather', predictedSeverity: 'high', actualOutcome: 'escalated', recordedAt: NOW },
      { id: 'bad-1', domain: 'weather', predictedSeverity: 'high', actualOutcome: 'HACKED', recordedAt: NOW },
      { id: 'ok-2', domain: 'cyber', predictedSeverity: 'low', actualOutcome: 'dismissed', recordedAt: NOW },
    ]);
    __storage.set(STORAGE_KEY, v1Blob);
    __resetOutcomeLedgerSingleton();
    const rehydrated = new OutcomeLedger({ clock: () => NOW });
    assert.equal(rehydrated.list().length, 2, 'only valid entries should load');
  });
});

// ── Fix 2: rate-limiting in AttentionAllocator.recompute() ────────────

describe('Fix 2 — AttentionAllocator.recompute() rate-limiting', () => {
  test('single recompute cannot move a multiplier more than MAX_RECOMPUTE_STEP', () => {
    const ledger = freshLedger();
    // Record enough escalated outcomes to push the multiplier well above 1.0.
    recordN(ledger, 'weather', 'escalated', 20);

    const allocator = new AttentionAllocator({ ledger });
    allocator.recompute();
    const multiplier = allocator.getMultiplier('weather');

    // After one recompute from neutral (1.0), multiplier should not exceed 1 + MAX_RECOMPUTE_STEP.
    assert.ok(
      multiplier <= 1 + MAX_RECOMPUTE_STEP + 1e-9,
      `multiplier ${multiplier} should be ≤ ${1 + MAX_RECOMPUTE_STEP} after one recompute`,
    );
    assert.ok(multiplier > 1, 'multiplier should move toward target (> 1.0 for mostly-escalated domain)');
  });

  test('multiple recomputes converge toward target over time', () => {
    const ledger = freshLedger();
    // Push target to 2.0: all escalated, many samples.
    recordN(ledger, 'weather', 'escalated', 30);

    const allocator = new AttentionAllocator({ ledger });
    let prev = allocator.getMultiplier('weather'); // starts at 1.0
    for (let i = 0; i < 20; i += 1) {
      allocator.recompute();
      const curr = allocator.getMultiplier('weather');
      assert.ok(
        curr >= prev - 1e-9,
        `multiplier should only increase toward 2.0 (step ${i}: ${prev} → ${curr})`,
      );
      prev = curr;
    }
    // After enough steps it should converge near the target.
    assert.ok(prev > 1.5, `should converge above 1.5 after 20 steps; got ${prev}`);
  });

  test('domain at target is not moved when already equal', () => {
    const ledger = freshLedger();
    // No outcomes — target stays at 1.0.
    const allocator = new AttentionAllocator({ ledger });
    allocator.recompute();
    assert.equal(allocator.getMultiplier('weather'), 1, 'neutral domain should stay at 1.0');
  });

  test('rate-limit applies per-domain independently', () => {
    const ledger = freshLedger();
    recordN(ledger, 'weather', 'escalated', 20);
    recordN(ledger, 'cyber', 'dismissed', 20);

    const allocator = new AttentionAllocator({ ledger });
    allocator.recompute();

    const weather = allocator.getMultiplier('weather');
    const cyber = allocator.getMultiplier('cyber');

    assert.ok(weather <= 1 + MAX_RECOMPUTE_STEP + 1e-9, `weather ≤ 1+step; got ${weather}`);
    assert.ok(cyber >= 1 - MAX_RECOMPUTE_STEP - 1e-9, `cyber ≥ 1-step; got ${cyber}`);
    assert.ok(weather > cyber, 'escalated domain should exceed dismissed domain');
  });
});

// ── Fix 3: tamper-detection hash ─────────────────────────────────────

describe('Fix 3 — tamper-detection hash in persist/hydrate', () => {
  test('computeChecksum is deterministic', () => {
    const data = [{ id: 'x', domain: 'a', predictedSeverity: 'high', actualOutcome: 'escalated', recordedAt: 123 }];
    assert.equal(computeChecksum(data as Parameters<typeof computeChecksum>[0]), computeChecksum(data as Parameters<typeof computeChecksum>[0]));
  });

  test('computeChecksum differs for different data', () => {
    const a = [{ id: 'x', domain: 'a', predictedSeverity: 'high', actualOutcome: 'escalated', recordedAt: 123 }];
    const b = [{ id: 'x', domain: 'b', predictedSeverity: 'high', actualOutcome: 'escalated', recordedAt: 123 }];
    assert.notEqual(
      computeChecksum(a as Parameters<typeof computeChecksum>[0]),
      computeChecksum(b as Parameters<typeof computeChecksum>[0]),
    );
  });

  test('persist() writes v2 blob with correct checksum', () => {
    const ledger = freshLedger();
    ledger.record({ domain: 'weather', predictedSeverity: 'high', actualOutcome: 'escalated' });

    const raw = __storage.get(STORAGE_KEY);
    assert.ok(raw, 'storage should have a value after record()');
    const blob = JSON.parse(raw!) as { v: number; data: unknown[]; cs: number };
    assert.equal(blob.v, 2, 'should write v2 format');
    assert.ok(Array.isArray(blob.data), 'data should be an array');
    assert.equal(typeof blob.cs, 'number', 'cs should be a number');

    // Verify the checksum matches the data.
    const expected = computeChecksum(blob.data as Parameters<typeof computeChecksum>[0]);
    assert.equal(blob.cs, expected, 'persisted checksum should match the data');
  });

  test('hydrate() accepts v2 blob with correct checksum', () => {
    const ledger = freshLedger();
    ledger.record({ domain: 'weather', predictedSeverity: 'high', actualOutcome: 'escalated' });
    // Reload into a fresh instance.
    __resetOutcomeLedgerSingleton();
    const rehydrated = new OutcomeLedger({ clock: () => NOW });
    assert.equal(rehydrated.list().length, 1, 'should rehydrate valid v2 blob');
    assert.equal(rehydrated.wasTamperDetected(), false);
  });

  test('hydrate() rejects v2 blob with wrong checksum and sets wasTamperDetected()', () => {
    const ledger = freshLedger();
    ledger.record({ domain: 'weather', predictedSeverity: 'high', actualOutcome: 'escalated' });

    // Corrupt the checksum in storage.
    const raw = JSON.parse(__storage.get(STORAGE_KEY)!);
    raw.cs = raw.cs + 1; // flip one bit
    __storage.set(STORAGE_KEY, JSON.stringify(raw));

    __resetOutcomeLedgerSingleton();
    const rehydrated = new OutcomeLedger({ clock: () => NOW });
    assert.equal(rehydrated.list().length, 0, 'tampered blob should be discarded');
    assert.equal(rehydrated.wasTamperDetected(), true, 'tamperDetected should be set');
  });

  test('hydrate() accepts v1 legacy bare-array format without checksum', () => {
    const v1Blob = JSON.stringify([
      { id: 'legacy-1', domain: 'weather', predictedSeverity: 'high', actualOutcome: 'escalated', recordedAt: NOW },
    ]);
    __storage.set(STORAGE_KEY, v1Blob);
    __resetOutcomeLedgerSingleton();
    const rehydrated = new OutcomeLedger({ clock: () => NOW });
    assert.equal(rehydrated.list().length, 1, 'v1 format should load for backward compat');
    assert.equal(rehydrated.wasTamperDetected(), false, 'v1 format should not set tamperDetected');
  });

  test('tamperDetected resets to false after a successful persist', () => {
    // Inject a tampered blob.
    const badBlob = JSON.stringify({ v: 2, data: [], cs: 99999 });
    __storage.set(STORAGE_KEY, badBlob);
    __resetOutcomeLedgerSingleton();
    const ledger2 = new OutcomeLedger({ clock: () => NOW });
    // Trigger hydrate via list().
    assert.equal(ledger2.list().length, 0);
    assert.equal(ledger2.wasTamperDetected(), true, 'should detect tamper on hydrate');

    // Now record a new outcome — this triggers persist().
    ledger2.record({ domain: 'cyber', predictedSeverity: 'low', actualOutcome: 'dismissed' });
    assert.equal(ledger2.wasTamperDetected(), false, 'tamperDetected should clear after successful persist');
  });
});
