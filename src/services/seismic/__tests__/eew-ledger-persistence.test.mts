import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyLedger, type EewAlertLedger } from '../eew-alert-engine.ts';
import {
  appendRecentAlerts,
  EEW_LEDGER_CACHE_KEY,
  EEW_RECENT_ALERTS_CAP,
  hydrateEewLedger,
  getEewLedgerPersistenceStatus,
  getInMemoryLedger,
  getRecentAlerts,
  persistEewLedger,
  resetEewLedgerPersistence,
  setInMemoryLedger,
  validatePayload,
  type EewLedgerPayload,
} from '../eew-ledger-persistence.ts';

const NOW = 1_745_000_000_000;

function freshPayload(): EewLedgerPayload {
  return {
    schemaVersion: 1,
    ledger: {
      events: {
        'usgs:abc': {
          highestTier: 'TIER_3_WARNING',
          tierFiredAt: { TIER_2_WATCH: NOW - 60_000, TIER_3_WARNING: NOW },
        },
      },
    },
    recentAlerts: [
      { eventId: 'usgs:abc', tier: 'TIER_3_WARNING', reason: 'M6.5', triggeredAt: NOW },
    ],
  };
}

// ── validatePayload ────────────────────────────────────────────────────

test('validatePayload accepts a fresh payload', () => {
  const result = validatePayload(freshPayload());
  assert.equal(result.ok, true);
});

test('validatePayload rejects null / non-object', () => {
  assert.equal(validatePayload(null).ok, false);
  assert.equal(validatePayload('hi').ok, false);
});

test('validatePayload rejects unsupported schemaVersion', () => {
  const bad = { ...freshPayload(), schemaVersion: 2 } as unknown;
  const result = validatePayload(bad);
  assert.equal(result.ok, false);
});

test('validatePayload rejects ledger with bad tier', () => {
  const bad = freshPayload() as unknown as Record<string, unknown>;
  (bad.ledger as { events: Record<string, { highestTier: string; tierFiredAt: object }> }).events['usgs:abc'].highestTier = 'BOGUS';
  const result = validatePayload(bad);
  assert.equal(result.ok, false);
});

test('validatePayload drops malformed recentAlerts but keeps valid ones', () => {
  const payload = freshPayload();
  // @ts-expect-error injecting malformed entry
  payload.recentAlerts.push({ tier: 'BOGUS' });
  const result = validatePayload(payload);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.payload.recentAlerts.length, 1);
});

// ── hydrate / persist round-trip ───────────────────────────────────────

test('hydrate from null cache leaves in-memory ledger empty', async () => {
  resetEewLedgerPersistence();
  await hydrateEewLedger({ read: async () => null, now: () => NOW });
  assert.equal(Object.keys(getInMemoryLedger().events).length, 0);
  const status = getEewLedgerPersistenceStatus();
  assert.equal(status.lastLoadStatus, 'ok');
});

test('hydrate from valid payload populates in-memory ledger', async () => {
  resetEewLedgerPersistence();
  const payload = freshPayload();
  await hydrateEewLedger({ read: async () => payload, now: () => NOW });
  assert.equal(getInMemoryLedger().events['usgs:abc']?.highestTier, 'TIER_3_WARNING');
  assert.equal(getRecentAlerts().length, 1);
});

test('hydrate from corrupt payload fails closed (in-memory ledger left empty)', async () => {
  resetEewLedgerPersistence();
  const corruptPayload = { schemaVersion: 99 } as unknown as EewLedgerPayload;
  await hydrateEewLedger({ read: async () => corruptPayload, now: () => NOW });
  assert.equal(Object.keys(getInMemoryLedger().events).length, 0);
  const status = getEewLedgerPersistenceStatus();
  assert.equal(status.lastLoadStatus, 'error');
  assert.equal(status.rejectedCount, 1);
});

test('hydrate read-throw is caught and surfaced as error status', async () => {
  resetEewLedgerPersistence();
  await hydrateEewLedger({
    read: async () => { throw new Error('disk full'); },
    now: () => NOW,
  });
  const status = getEewLedgerPersistenceStatus();
  assert.equal(status.lastLoadStatus, 'error');
  assert.match(status.lastError ?? '', /disk full/);
});

test('persist serializes the in-memory ledger to the write adapter', async () => {
  resetEewLedgerPersistence();
  setInMemoryLedger({
    events: {
      'a': { highestTier: 'TIER_2_WATCH', tierFiredAt: { TIER_2_WATCH: NOW } },
    },
  });
  let captured: { key: string; payload: EewLedgerPayload } | null = null;
  await persistEewLedger({
    write: async (key, payload) => { captured = { key, payload }; },
    now: () => NOW,
  });
  assert.equal(captured!.key, EEW_LEDGER_CACHE_KEY);
  assert.equal(captured!.payload.schemaVersion, 1);
  assert.equal(captured!.payload.ledger.events.a?.highestTier, 'TIER_2_WATCH');
});

test('persist write-throw is caught and surfaced as error status', async () => {
  resetEewLedgerPersistence();
  setInMemoryLedger(emptyLedger());
  await persistEewLedger({
    write: async () => { throw new Error('write fail'); },
    now: () => NOW,
  });
  const status = getEewLedgerPersistenceStatus();
  assert.equal(status.lastSaveStatus, 'error');
});

test('full round-trip: persist → hydrate yields equal ledger', async () => {
  resetEewLedgerPersistence();
  const original: EewAlertLedger = {
    events: {
      'usgs:rt': {
        highestTier: 'TIER_4_SEVERE',
        tierFiredAt: { TIER_3_WARNING: NOW - 1000, TIER_4_SEVERE: NOW },
      },
    },
  };
  setInMemoryLedger(original);

  let stored: EewLedgerPayload | null = null;
  await persistEewLedger({
    write: async (_key, payload) => { stored = payload; },
    now: () => NOW,
  });

  resetEewLedgerPersistence();
  await hydrateEewLedger({ read: async () => stored, now: () => NOW });

  assert.deepEqual(getInMemoryLedger(), original);
});

// ── recentAlerts cap ───────────────────────────────────────────────────

test('appendRecentAlerts caps at EEW_RECENT_ALERTS_CAP, keeping newest', () => {
  resetEewLedgerPersistence();
  const many = Array.from({ length: EEW_RECENT_ALERTS_CAP + 50 }, (_, i) => ({
    eventId: `e-${i}`,
    tier: 'TIER_1_INFO' as const,
    reason: '',
    triggeredAt: NOW + i,
  }));
  appendRecentAlerts(many);
  const recent = getRecentAlerts();
  assert.equal(recent.length, EEW_RECENT_ALERTS_CAP);
  // Last EEW_RECENT_ALERTS_CAP items kept — first kept eventId should be
  // index 50.
  assert.equal(recent[0]!.eventId, 'e-50');
});

test('appendRecentAlerts no-op on empty input', () => {
  resetEewLedgerPersistence();
  appendRecentAlerts([
    { eventId: 'a', tier: 'TIER_1_INFO', reason: '', triggeredAt: NOW },
  ]);
  const before = getRecentAlerts().length;
  appendRecentAlerts([]);
  assert.equal(getRecentAlerts().length, before);
});
