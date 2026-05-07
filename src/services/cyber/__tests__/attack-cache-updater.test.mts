import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTACK_CACHE_TTL_MS,
  ATTACK_CACHE_URL,
  ATTACK_CACHE_FILENAME,
  buildAttackCacheStatus,
  filterUsableGroups,
  isAttackCacheStale,
  isStixBundle,
} from '../attack-cache-updater.ts';
import type { AptGroup } from '../apt-tracker.ts';

const NOW = 1_745_000_000_000;

// ── isAttackCacheStale ─────────────────────────────────────────────────

test('isAttackCacheStale: missing cache → stale', () => {
  assert.equal(isAttackCacheStale({ lastFetchedAt: null, nowMs: NOW }), true);
});

test('isAttackCacheStale: just-fetched → fresh', () => {
  assert.equal(isAttackCacheStale({ lastFetchedAt: NOW - 60_000, nowMs: NOW }), false);
});

test('isAttackCacheStale: older than 7d default → stale', () => {
  assert.equal(isAttackCacheStale({
    lastFetchedAt: NOW - ATTACK_CACHE_TTL_MS - 1,
    nowMs: NOW,
  }), true);
});

test('isAttackCacheStale: exactly 7d old → fresh (boundary)', () => {
  assert.equal(isAttackCacheStale({
    lastFetchedAt: NOW - ATTACK_CACHE_TTL_MS,
    nowMs: NOW,
  }), false);
});

test('isAttackCacheStale: custom ttlMs override', () => {
  // 1-day TTL: 2 days old → stale
  assert.equal(isAttackCacheStale({
    lastFetchedAt: NOW - 2 * 24 * 60 * 60 * 1000,
    nowMs: NOW,
    ttlMs: 24 * 60 * 60 * 1000,
  }), true);
});

// ── buildAttackCacheStatus ─────────────────────────────────────────────

test('buildAttackCacheStatus: missing cache', () => {
  const s = buildAttackCacheStatus({
    cacheExists: false, lastFetchedAt: null, nowMs: NOW,
    groupCount: 0, lastError: null,
  });
  assert.equal(s.cacheExists, false);
  assert.equal(s.ageMs, null);
  assert.equal(s.isStale, true);
});

test('buildAttackCacheStatus: fresh cache reports ageMs', () => {
  const s = buildAttackCacheStatus({
    cacheExists: true, lastFetchedAt: NOW - 60_000, nowMs: NOW,
    groupCount: 150, lastError: null,
  });
  assert.equal(s.ageMs, 60_000);
  assert.equal(s.isStale, false);
  assert.equal(s.groupCount, 150);
});

test('buildAttackCacheStatus: lastError surfaced', () => {
  const s = buildAttackCacheStatus({
    cacheExists: false, lastFetchedAt: null, nowMs: NOW,
    groupCount: 0, lastError: 'HTTP 503',
  });
  assert.equal(s.lastError, 'HTTP 503');
});

// ── isStixBundle ───────────────────────────────────────────────────────

test('isStixBundle: rejects null / non-object', () => {
  assert.equal(isStixBundle(null), false);
  assert.equal(isStixBundle('string'), false);
  assert.equal(isStixBundle(42), false);
});

test('isStixBundle: rejects wrong type', () => {
  assert.equal(isStixBundle({ type: 'object', objects: [] }), false);
});

test('isStixBundle: requires objects array', () => {
  assert.equal(isStixBundle({ type: 'bundle' }), false);
  assert.equal(isStixBundle({ type: 'bundle', objects: 'not-array' }), false);
});

test('isStixBundle: accepts minimal valid bundle', () => {
  assert.equal(isStixBundle({ type: 'bundle', objects: [] }), true);
});

// ── filterUsableGroups ─────────────────────────────────────────────────

function group(overrides: Partial<AptGroup> & { id: string; name: string }): AptGroup {
  return {
    id: overrides.id, name: overrides.name,
    aliases: overrides.aliases ?? [],
    country: overrides.country ?? 'XX',
    targetSectors: overrides.targetSectors ?? [],
    recentTechniques: overrides.recentTechniques ?? [],
    activityScore: overrides.activityScore ?? 0,
  };
}

test('filterUsableGroups: drops empty id', () => {
  const groups = [group({ id: '', name: 'A' }), group({ id: 'G1', name: 'B' })];
  const out = filterUsableGroups(groups);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'G1');
});

test('filterUsableGroups: drops empty name', () => {
  const groups = [group({ id: 'G1', name: '' }), group({ id: 'G2', name: 'B' })];
  const out = filterUsableGroups(groups);
  assert.deepEqual(out.map((g) => g.id), ['G2']);
});

test('filterUsableGroups: keeps all-valid input', () => {
  const groups = [group({ id: 'G1', name: 'A' }), group({ id: 'G2', name: 'B' })];
  assert.equal(filterUsableGroups(groups).length, 2);
});

// ── Constants ──────────────────────────────────────────────────────────

test('ATTACK_CACHE_URL points at the master enterprise bundle', () => {
  assert.match(ATTACK_CACHE_URL, /mitre\/cti\/master\/enterprise-attack/);
});

test('ATTACK_CACHE_FILENAME is the spec filename', () => {
  assert.equal(ATTACK_CACHE_FILENAME, 'attack-cache.json');
});

test('ATTACK_CACHE_TTL_MS is 7 days', () => {
  assert.equal(ATTACK_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});
