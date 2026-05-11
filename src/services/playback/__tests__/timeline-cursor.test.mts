import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FADE_MS,
  checkpoints,
  countByType,
  visibleAt,
} from '../timeline-cursor.ts';
import type { TimelineEvent } from '../../timeline-scrubber.ts';

const NOW = Date.parse('2026-05-07T12:00:00Z');

function ev(overrides: Partial<TimelineEvent> & { id: string; timestamp: number }): TimelineEvent {
  return {
    id: overrides.id,
    type: overrides.type ?? 'earthquake',
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    timestamp: overrides.timestamp,
    title: overrides.title ?? 'event',
    severity: overrides.severity ?? 'medium',
    source: overrides.source ?? 'fixture',
  };
}

// ── visibleAt ─────────────────────────────────────────────────────────

test('visibleAt: future events are hidden', () => {
  const out = visibleAt([ev({ id: 'a', timestamp: NOW + 60_000 })], { currentMs: NOW });
  assert.equal(out.length, 0);
});

test('visibleAt: event at cursor → opacity 1', () => {
  const out = visibleAt([ev({ id: 'a', timestamp: NOW, type: 'earthquake' })], { currentMs: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.opacity, 1);
});

test('visibleAt: event halfway through fade → opacity ~0.5', () => {
  const fade = DEFAULT_FADE_MS.earthquake;
  const halfPast = NOW - fade / 2;
  const out = visibleAt([ev({ id: 'a', timestamp: halfPast, type: 'earthquake' })], { currentMs: NOW });
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0]!.opacity - 0.5) < 1e-9);
});

test('visibleAt: event past full fade → hidden', () => {
  const fade = DEFAULT_FADE_MS.earthquake;
  const out = visibleAt([ev({ id: 'a', timestamp: NOW - fade - 1, type: 'earthquake' })], { currentMs: NOW });
  assert.equal(out.length, 0);
});

test('visibleAt: respects custom window cutoff', () => {
  // Event is 4h old. Fade for earthquake is 4h. Default window is 6h
  // → would normally clip the fade window edge. Custom window 1h means
  // event is outside the look-back regardless of fade.
  const out = visibleAt([ev({ id: 'a', timestamp: NOW - 4 * 3600_000, type: 'earthquake' })], {
    currentMs: NOW,
    windowMs: 1 * 3600_000,
  });
  assert.equal(out.length, 0);
});

test('visibleAt: per-type fade override applied', () => {
  // Earthquake default fade is 4h; override to 30 minutes. An event
  // 1h old with a 30-minute fade is aged out.
  const out = visibleAt([ev({ id: 'a', timestamp: NOW - 3600_000, type: 'earthquake' })], {
    currentMs: NOW,
    fadeMs: { earthquake: 30 * 60_000 },
  });
  assert.equal(out.length, 0);
});

test('visibleAt: result sorted newest-first', () => {
  const out = visibleAt(
    [
      ev({ id: 'old', timestamp: NOW - 3000_000, type: 'earthquake' }),
      ev({ id: 'new', timestamp: NOW - 60_000, type: 'earthquake' }),
      ev({ id: 'mid', timestamp: NOW - 1500_000, type: 'earthquake' }),
    ],
    { currentMs: NOW },
  );
  assert.deepEqual(out.map((v) => v.event.id), ['new', 'mid', 'old']);
});

test('visibleAt: different types use different fade durations', () => {
  // 5h old fire (24h fade): should be visible.
  // 5h old earthquake (4h fade): should be hidden.
  const out = visibleAt(
    [
      ev({ id: 'fire', timestamp: NOW - 5 * 3600_000, type: 'fire' }),
      ev({ id: 'quake', timestamp: NOW - 5 * 3600_000, type: 'earthquake' }),
    ],
    { currentMs: NOW, windowMs: 24 * 3600_000 },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.event.id, 'fire');
});

// ── countByType ───────────────────────────────────────────────────────

test('countByType: tallies visible per category', () => {
  const visible = visibleAt(
    [
      ev({ id: 'q1', timestamp: NOW - 60_000, type: 'earthquake' }),
      ev({ id: 'q2', timestamp: NOW - 120_000, type: 'earthquake' }),
      ev({ id: 'f1', timestamp: NOW - 60_000, type: 'fire' }),
      ev({ id: 'c1', timestamp: NOW - 60_000, type: 'cyber' }),
    ],
    { currentMs: NOW },
  );
  const counts = countByType(visible);
  assert.equal(counts.earthquake, 2);
  assert.equal(counts.fire, 1);
  assert.equal(counts.cyber, 1);
  assert.equal(counts.protest, 0);
});

test('countByType: empty → all zeros', () => {
  const counts = countByType([]);
  for (const v of Object.values(counts)) assert.equal(v, 0);
});

// ── checkpoints ───────────────────────────────────────────────────────

test('checkpoints: returns sorted unique timestamps in window', () => {
  const events: TimelineEvent[] = [
    ev({ id: 'a', timestamp: NOW - 3600_000, type: 'earthquake' }),
    ev({ id: 'b', timestamp: NOW - 1800_000, type: 'earthquake' }),
    ev({ id: 'c', timestamp: NOW - 60_000, type: 'fire' }),
  ];
  const cps = checkpoints(events, { startMs: NOW - 7200_000, endMs: NOW });
  // Sorted ascending
  for (let i = 1; i < cps.length; i += 1) {
    assert.ok(cps[i]! > cps[i - 1]!);
  }
  // Includes each event's timestamp
  for (const e of events) {
    assert.ok(cps.includes(e.timestamp), `missing checkpoint for ${e.id}`);
  }
});

test('checkpoints: includes fade-out timestamps when within window', () => {
  const events: TimelineEvent[] = [
    ev({ id: 'a', timestamp: NOW - 3600_000, type: 'earthquake' }),
  ];
  const cps = checkpoints(events, { startMs: NOW - 7200_000, endMs: NOW + 4 * 3600_000 });
  assert.ok(cps.includes(NOW - 3600_000));                            // origin
  assert.ok(cps.includes(NOW - 3600_000 + DEFAULT_FADE_MS.earthquake)); // fade-out
});

test('checkpoints: events outside window are excluded', () => {
  const events: TimelineEvent[] = [
    ev({ id: 'a', timestamp: NOW - 24 * 3600_000, type: 'earthquake' }),
  ];
  const cps = checkpoints(events, { startMs: NOW - 3600_000, endMs: NOW });
  assert.deepEqual(cps, []);
});

// ── JSON serializability ────────────────────────────────────────────

test('VisibleTimelineEvent[] is JSON-serializable', () => {
  const out = visibleAt([ev({ id: 'a', timestamp: NOW, type: 'earthquake' })], { currentMs: NOW });
  const round = structuredClone(out);
  assert.equal(round[0]?.event.id, 'a');
});
