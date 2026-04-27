import assert from 'node:assert/strict';
import test from 'node:test';

import { computeDigest } from '../what-changed-digest.ts';
import { createChangeMemoryStore } from '../change-memory.ts';
import type { SituationSnapshot } from '../change-memory.ts';

const NOW = 1_745_000_000_000;

function snap(overrides: Partial<SituationSnapshot> = {}): SituationSnapshot {
  return {
    id: 'sit-1',
    title: 'Iran escalation risk',
    category: 'conflict',
    score: 48,
    tier: 'watch',
    confidence: 'medium',
    recordedAt: NOW,
    sources: ['gdelt', 'acled'],
    ...overrides,
  };
}

// ── change-memory store ─────────────────────────────────────────────────

test('store: record + get + size', () => {
  const s = createChangeMemoryStore();
  s.record(snap());
  assert.equal(s.size(), 1);
  assert.equal(s.get('sit-1')?.title, 'Iran escalation risk');
});

test('store: record overwrites by id', () => {
  const s = createChangeMemoryStore();
  s.record(snap());
  s.record(snap({ score: 71 }));
  assert.equal(s.get('sit-1')?.score, 71);
  assert.equal(s.size(), 1);
});

test('store: forget removes by id', () => {
  const s = createChangeMemoryStore();
  s.record(snap());
  s.forget('sit-1');
  assert.equal(s.get('sit-1'), undefined);
});

test('store: prune drops snapshots older than cutoff', () => {
  const s = createChangeMemoryStore();
  s.record(snap({ id: 'old', recordedAt: NOW - 24 * 60 * 60 * 1000 }));
  s.record(snap({ id: 'new', recordedAt: NOW }));
  const removed = s.prune(NOW - 60 * 60 * 1000); // 1h cutoff
  assert.equal(removed, 1);
  assert.equal(s.get('old'), undefined);
  assert.equal(s.get('new')?.id, 'new');
});

test('store: serialize/load roundtrip', () => {
  const a = createChangeMemoryStore();
  a.record(snap());
  a.record(snap({ id: 'sit-2', title: 'B' }));
  const json = a.toJson();
  const b = createChangeMemoryStore();
  b.loadJson(json);
  assert.equal(b.size(), 2);
  assert.equal(b.get('sit-2')?.title, 'B');
});

test('store: get returns a copy (mutation does not leak)', () => {
  const s = createChangeMemoryStore();
  s.record(snap());
  const got = s.get('sit-1')!;
  got.score = 999;
  assert.equal(s.get('sit-1')?.score, 48);
});

// ── New / cleared situations ────────────────────────────────────────────

test('digest: new situation appears as "new" when not in previous', () => {
  const lines = computeDigest([], [snap()]);
  assert.ok(lines.some((l) => l.kind === 'new'));
});

test('digest: notable cleared situation appears as "cleared"', () => {
  const lines = computeDigest([snap({ tier: 'critical' })], []);
  const cleared = lines.find((l) => l.kind === 'cleared');
  assert.ok(cleared);
  assert.equal(cleared!.polarity, 'better');
});

test('digest: low-tier cleared situations are NOT surfaced (noise filter)', () => {
  const lines = computeDigest([snap({ tier: 'fyi' })], []);
  assert.ok(!lines.some((l) => l.kind === 'cleared'));
});

// ── Score deltas ────────────────────────────────────────────────────────

test('digest: plan example "Iran escalation risk rose from 48 → 71"', () => {
  const before = snap({ score: 48 });
  const after = snap({ score: 71 });
  const lines = computeDigest([before], [after]);
  const rose = lines.find((l) => l.kind === 'score_rose');
  assert.ok(rose);
  assert.equal(rose!.magnitude, 23);
  assert.match(rose!.text, /48.*71/);
  assert.equal(rose!.polarity, 'worse');
});

test('digest: small score changes are filtered out', () => {
  const lines = computeDigest([snap({ score: 48 })], [snap({ score: 53 })]);
  assert.ok(!lines.some((l) => l.kind === 'score_rose'));
});

test('digest: score deltas above threshold appear', () => {
  const lines = computeDigest([snap({ score: 48 })], [snap({ score: 60 })]);
  assert.ok(lines.some((l) => l.kind === 'score_rose'));
});

test('digest: scoreDeltaThreshold option is honored', () => {
  const lines = computeDigest(
    [snap({ score: 48 })],
    [snap({ score: 53 })],
    { scoreDeltaThreshold: 3 },
  );
  assert.ok(lines.some((l) => l.kind === 'score_rose'));
});

test('digest: score falling has "better" polarity', () => {
  const lines = computeDigest([snap({ score: 80 })], [snap({ score: 50 })]);
  const fell = lines.find((l) => l.kind === 'score_fell');
  assert.equal(fell!.polarity, 'better');
});

// ── Tier deltas ─────────────────────────────────────────────────────────

test('digest: plan example "Diesel stress risk rose from Watch → Elevated"', () => {
  const before = snap({ id: 'diesel', title: 'Diesel stress risk', tier: 'watch' });
  const after = snap({ id: 'diesel', title: 'Diesel stress risk', tier: 'elevated' });
  const lines = computeDigest([before], [after]);
  const escalated = lines.find((l) => l.kind === 'tier_escalated');
  assert.ok(escalated);
  assert.match(escalated!.text, /watch.*elevated/i);
  assert.equal(escalated!.polarity, 'worse');
});

test('digest: tier de-escalation has better polarity', () => {
  const before = snap({ tier: 'critical' });
  const after = snap({ tier: 'watch' });
  const lines = computeDigest([before], [after]);
  const de = lines.find((l) => l.kind === 'tier_de_escalated');
  assert.ok(de);
  assert.equal(de!.polarity, 'better');
});

test('digest: same tier produces no tier line', () => {
  const lines = computeDigest([snap({ tier: 'watch' })], [snap({ tier: 'watch' })]);
  assert.ok(!lines.some((l) => l.kind === 'tier_escalated' || l.kind === 'tier_de_escalated'));
});

test('digest: caller can override tier order', () => {
  const before = snap({ tier: 'green' });
  const after = snap({ tier: 'red' });
  const lines = computeDigest([before], [after], {
    tierOrder: ['green', 'yellow', 'red'],
  });
  assert.ok(lines.some((l) => l.kind === 'tier_escalated'));
});

// ── Source deltas ───────────────────────────────────────────────────────

test('digest: plan example "Two sources now confirm the port closure"', () => {
  const before = snap({ id: 'port', title: 'Port closure', sources: ['initial'] });
  const after = snap({ id: 'port', title: 'Port closure', sources: ['initial', 'reuters', 'maritime-tracker'] });
  const lines = computeDigest([before], [after]);
  const conf = lines.find((l) => l.kind === 'sources_confirming');
  assert.ok(conf);
  assert.equal(conf!.magnitude, 2);
  assert.match(conf!.text, /2 new sources confirming/i);
});

test('digest: lost sources reported separately', () => {
  const before = snap({ sources: ['a', 'b', 'c'] });
  const after = snap({ sources: ['a'] });
  const lines = computeDigest([before], [after]);
  assert.ok(lines.some((l) => l.kind === 'sources_lost' && l.magnitude === 2));
});

// ── Meta deltas ─────────────────────────────────────────────────────────

test('digest: plan example "Hurricane track shifted ~150 km"', () => {
  const before = snap({
    id: 'hurricane',
    title: 'Hurricane track',
    meta: { centroid: { lat: 28.0, lon: -80.0 } },
  });
  const after = snap({
    id: 'hurricane',
    title: 'Hurricane track',
    // ~155 km west
    meta: { centroid: { lat: 28.0, lon: -81.5 } },
  });
  const lines = computeDigest([before], [after]);
  const meta = lines.find((l) => l.kind === 'meta_changed' && /centroid/.test(l.text));
  assert.ok(meta);
  assert.ok(meta!.magnitude! > 100);
});

test('digest: small centroid shifts are filtered', () => {
  const before = snap({ meta: { centroid: { lat: 28.0, lon: -80.0 } } });
  const after = snap({ meta: { centroid: { lat: 28.05, lon: -80.05 } } });
  const lines = computeDigest([before], [after]);
  assert.ok(!lines.some((l) => l.kind === 'meta_changed'));
});

test('digest: distance shrinking emits "moved closer" with worse polarity', () => {
  const before = snap({ meta: { distanceKm: 30 } });
  const after = snap({ meta: { distanceKm: 12 } });
  const lines = computeDigest([before], [after]);
  const closer = lines.find((l) => /closer/.test(l.text));
  assert.ok(closer);
  assert.equal(closer!.polarity, 'worse');
  assert.equal(closer!.magnitude, 18);
});

test('digest: distance growing emits "moved farther" with better polarity', () => {
  const before = snap({ meta: { distanceKm: 12 } });
  const after = snap({ meta: { distanceKm: 30 } });
  const lines = computeDigest([before], [after]);
  const farther = lines.find((l) => /farther/.test(l.text));
  assert.ok(farther);
  assert.equal(farther!.polarity, 'better');
});

// ── Sorting + truncation ────────────────────────────────────────────────

test('sort: weight-1 changes (rises + escalations) appear before weight-4+ (falls + clears)', () => {
  const before: SituationSnapshot[] = [
    snap({ id: 'big-rise', score: 30, tier: 'watch' }),
    snap({ id: 'cleared', score: 60, tier: 'critical' }),
    snap({ id: 'big-fall', score: 90, tier: 'critical' }),
  ];
  const after: SituationSnapshot[] = [
    snap({ id: 'big-rise', score: 80, tier: 'critical' }),
    snap({ id: 'big-fall', score: 30, tier: 'watch' }),
  ];
  const lines = computeDigest(before, after);
  // Weight-1 lines (score_rose / tier_escalated) come before weight-4+
  // lines (score_fell / cleared / tier_de_escalated).
  assert.equal(lines[0]!.weight, 1);
  // The last few should be the worse-than-watch_window lines.
  const last = lines[lines.length - 1]!;
  assert.ok(last.weight >= 4, `expected weight ≥4 at end, got ${last.weight}`);
});

test('truncation: maxLines is honored', () => {
  const previous: SituationSnapshot[] = [];
  const current: SituationSnapshot[] = [];
  for (let i = 0; i < 30; i += 1) {
    current.push(snap({ id: `s-${i}`, title: `S${i}` }));
  }
  const lines = computeDigest(previous, current, { maxLines: 5 });
  assert.equal(lines.length, 5);
});

// ── No-change baseline ──────────────────────────────────────────────────

test('digest: identical snapshots produce no lines', () => {
  const lines = computeDigest([snap()], [snap()]);
  assert.equal(lines.length, 0);
});

// ── Plan example end-to-end ─────────────────────────────────────────────

test('integration: plan example digest with all 5 lines surfaced', () => {
  const before: SituationSnapshot[] = [
    snap({ id: 'iran', title: 'Iran escalation risk', score: 48, category: 'conflict' }),
    snap({ id: 'diesel', title: 'Diesel stress risk', tier: 'watch', category: 'energy' }),
    snap({
      id: 'hurricane',
      title: 'Hurricane track',
      category: 'weather',
      meta: { centroid: { lat: 28.0, lon: -80.0 } },
    }),
    snap({
      id: 'port',
      title: 'Port closure',
      category: 'maritime',
      sources: ['initial'],
    }),
    snap({
      id: 'tsunami-risk',
      title: 'Tsunami cascade risk',
      score: 60,
      tier: 'elevated',
      category: 'space',
    }),
  ];
  const after: SituationSnapshot[] = [
    snap({ id: 'iran', title: 'Iran escalation risk', score: 71, category: 'conflict' }),
    snap({
      id: 'diesel',
      title: 'Diesel stress risk',
      tier: 'elevated',
      category: 'energy',
    }),
    snap({
      id: 'hurricane',
      title: 'Hurricane track',
      category: 'weather',
      meta: { centroid: { lat: 28.0, lon: -81.5 } },
    }),
    snap({
      id: 'port',
      title: 'Port closure',
      category: 'maritime',
      sources: ['initial', 'reuters', 'maritime-tracker'],
    }),
    snap({
      id: 'tsunami-risk',
      title: 'Tsunami cascade risk',
      score: 30,
      tier: 'watch',
      category: 'space',
    }),
  ];
  const lines = computeDigest(before, after);
  // Should produce at least one line per situation pair (5 different changes).
  const ids = new Set(lines.map((l) => l.id));
  assert.equal(ids.size, 5);
});
