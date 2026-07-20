import assert from 'node:assert/strict';
import test from 'node:test';

import { urgencyFor, deliveryPriorityRank } from '../weather-urgency.ts';
import type { PreviousDelivery } from '../weather-urgency.ts';
import type { PolygonMatchResult } from '../weather-threat-types.ts';

const NOW = 1_745_000_000_000;

function match(overrides: Partial<PolygonMatchResult> = {}): PolygonMatchResult {
  return {
    alertId: 'urn:test',
    placeId: 'home',
    matchKind: 'inside_polygon',
    isInside: true,
    distanceKm: 0,
    hazardKind: 'severe_thunderstorm',
    event: 'Severe Thunderstorm Warning',
    severity: 'severe',
    threatLevel: 'emergency',
    msUntilExpires: 30 * 60 * 1000,
    isUpdate: false,
    isCancellation: false,
    reason: 'Inside warning polygon',
    ...overrides,
  };
}

// ── Priority mapping ─────────────────────────────────────────────────────

test('priority: tornado emergency inside polygon → persistent_critical_with_imessage', () => {
  const r = urgencyFor(match({ hazardKind: 'tornado' }));
  assert.equal(r.priority, 'persistent_critical_with_imessage');
  assert.equal(r.persistentInApp, true);
});

test('priority: flash flood emergency inside polygon → persistent_critical_with_imessage', () => {
  const r = urgencyFor(match({ hazardKind: 'flash_flood', event: 'Flash Flood Warning' }));
  assert.equal(r.priority, 'persistent_critical_with_imessage');
});

test('priority: severe TS emergency inside polygon → persistent_critical (no iMessage)', () => {
  const r = urgencyFor(match());
  assert.equal(r.priority, 'persistent_critical');
});

test('priority: warning inside polygon → persistent_critical', () => {
  const r = urgencyFor(match({ threatLevel: 'warning' }));
  assert.equal(r.priority, 'persistent_critical');
});

test('priority: warning OUTSIDE polygon (near match) → banner', () => {
  const r = urgencyFor(match({
    matchKind: 'near_polygon',
    isInside: false,
    distanceKm: 4,
    threatLevel: 'warning',
  }));
  assert.equal(r.priority, 'banner');
});

test('priority: watch tier → watch_window', () => {
  const r = urgencyFor(match({ threatLevel: 'watch', event: 'Tornado Watch' }));
  assert.equal(r.priority, 'watch_window');
});

test('priority: advisory tier → digest', () => {
  const r = urgencyFor(match({ threatLevel: 'advisory', event: 'Wind Advisory' }));
  assert.equal(r.priority, 'digest');
});

test('priority: cancellation → background regardless of tier', () => {
  const r = urgencyFor(match({ isCancellation: true, threatLevel: 'emergency' }));
  assert.equal(r.priority, 'background');
});

test('priority: threatLevel "none" → background', () => {
  const r = urgencyFor(match({ threatLevel: 'none' }));
  assert.equal(r.priority, 'background');
});

// ── Quiet hours bypass ──────────────────────────────────────────────────

test('quiet hours: tornado warning bypasses by default', () => {
  const r = urgencyFor(match({
    hazardKind: 'tornado',
    threatLevel: 'warning',
    event: 'Tornado Warning',
  }));
  assert.equal(r.bypassQuietHours, true);
});

test('quiet hours: severe TS warning bypasses by default', () => {
  const r = urgencyFor(match({ threatLevel: 'warning' }));
  assert.equal(r.bypassQuietHours, true);
});

test('quiet hours: winter storm warning does NOT bypass by default', () => {
  const r = urgencyFor(match({
    hazardKind: 'winter_storm',
    threatLevel: 'warning',
    event: 'Winter Storm Warning',
  }));
  assert.equal(r.bypassQuietHours, false);
});

test('quiet hours: watch-level severe TS does NOT bypass', () => {
  const r = urgencyFor(match({
    threatLevel: 'watch',
    event: 'Severe Thunderstorm Watch',
  }));
  assert.equal(r.bypassQuietHours, false);
});

test('quiet hours: caller can override bypass for a warning-tier hazard', () => {
  const r = urgencyFor(
    match({ threatLevel: 'warning', event: 'Severe Thunderstorm Warning' }),
    undefined,
    { quietHoursBypassHazards: [] },
  );
  assert.equal(r.bypassQuietHours, false);
});

test('quiet hours: emergency tier ALWAYS bypasses, even for a hazard off the list', () => {
  // Safety (round-1 audit #16): a blizzard / ice storm at emergency level must
  // never be silenced by quiet hours just because winter_storm isn't on the
  // per-hazard bypass list — independent of the caller's config.
  const blizzard = urgencyFor(
    match({ threatLevel: 'emergency', hazardKind: 'winter_storm', event: 'Blizzard Warning' }),
    undefined,
    { quietHoursBypassHazards: [] },
  );
  assert.equal(blizzard.bypassQuietHours, true);
});

// ── Acknowledgment escalation ───────────────────────────────────────────

test('acknowledgment: tornado emergency requires acknowledgment', () => {
  const r = urgencyFor(match({ hazardKind: 'tornado', event: 'Tornado Warning' }));
  assert.equal(r.requiresAcknowledgment, true);
  assert.equal(typeof r.acknowledgmentDeadlineMs, 'number');
  assert.ok(r.acknowledgmentDeadlineMs! > 0);
});

test('acknowledgment: flash flood emergency requires acknowledgment', () => {
  const r = urgencyFor(match({ hazardKind: 'flash_flood', event: 'Flash Flood Warning' }));
  assert.equal(r.requiresAcknowledgment, true);
});

test('acknowledgment: severe TS emergency does NOT require acknowledgment', () => {
  // Severe TS is loud (persistent_critical) but the plan calls out
  // tornado + flash_flood specifically for escalation behavior.
  const r = urgencyFor(match());
  assert.equal(r.requiresAcknowledgment, false);
  assert.equal(r.acknowledgmentDeadlineMs, undefined);
});

test('acknowledgment: warning tier never requires acknowledgment', () => {
  const r = urgencyFor(match({ threatLevel: 'warning', hazardKind: 'tornado' }));
  assert.equal(r.requiresAcknowledgment, false);
});

// ── Repeat suppression ──────────────────────────────────────────────────

test('repeat: emergency without prior delivery uses 10-min interval', () => {
  const r = urgencyFor(match());
  assert.equal(r.minRepeatIntervalMs, 10 * 60 * 1000);
});

test('repeat: warning without prior delivery uses 30-min interval', () => {
  const r = urgencyFor(match({ threatLevel: 'warning' }));
  assert.equal(r.minRepeatIntervalMs, 30 * 60 * 1000);
});

test('repeat: escalation from warning → emergency zeroes the cooldown', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'warning',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: true,
  };
  const r = urgencyFor(match(), previous);
  assert.equal(r.minRepeatIntervalMs, 0);
});

test('repeat: outside → inside polygon zeroes the cooldown', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'warning',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: false,
    previousDistanceKm: 8,
  };
  const r = urgencyFor(match({ threatLevel: 'warning' }), previous);
  assert.equal(r.minRepeatIntervalMs, 0);
});

test('repeat: distance shrinking by ≥5 km zeroes the cooldown', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'warning',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: false,
    previousDistanceKm: 12,
  };
  const r = urgencyFor(
    match({ matchKind: 'near_polygon', isInside: false, distanceKm: 5, threatLevel: 'warning' }),
    previous,
  );
  assert.equal(r.minRepeatIntervalMs, 0);
});

test('repeat: same threat tier with no proximity change uses base interval', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'warning',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: true,
  };
  const r = urgencyFor(match({ threatLevel: 'warning' }), previous);
  assert.equal(r.minRepeatIntervalMs, 30 * 60 * 1000);
});

test('repeat: de-escalation does NOT zero the cooldown', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'emergency',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: true,
  };
  const r = urgencyFor(match({ threatLevel: 'warning' }), previous);
  assert.equal(r.minRepeatIntervalMs, 30 * 60 * 1000);
});

// ── Reason strings ──────────────────────────────────────────────────────

test('reason: cancellation says canceled', () => {
  const r = urgencyFor(match({ isCancellation: true }));
  assert.match(r.reason, /canceled/i);
});

test('reason: escalation mentions previous tier', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'watch',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: true,
  };
  const r = urgencyFor(match(), previous);
  assert.match(r.reason, /escalated/i);
  assert.match(r.reason, /WATCH/i);
});

test('reason: place crossed into polygon mentions transition', () => {
  const previous: PreviousDelivery = {
    previousThreatLevel: 'warning',
    lastDeliveredAt: NOW - 60 * 1000,
    previouslyInside: false,
    previousDistanceKm: 5,
  };
  const r = urgencyFor(match({ threatLevel: 'warning' }), previous);
  assert.match(r.reason, /now inside/i);
});

test('reason: inside polygon describes severity', () => {
  const r = urgencyFor(match({ severity: 'extreme' }));
  assert.match(r.reason, /extreme severity/i);
});

test('reason: near_polygon includes distance', () => {
  const r = urgencyFor(match({
    matchKind: 'near_polygon',
    isInside: false,
    distanceKm: 7.3,
    threatLevel: 'warning',
  }));
  assert.match(r.reason, /7\.3 km/);
});

// ── Watch windows ───────────────────────────────────────────────────────

test('watch window: tornado has 30-minute window with rotation signature signal', () => {
  const r = urgencyFor(match({ hazardKind: 'tornado', event: 'Tornado Warning' }));
  assert.ok(r.watchWindow);
  assert.equal(r.watchWindow!.durationMinutes, 30);
  assert.ok(r.watchWindow!.confirming.some((c) => /rotation/i.test(c)));
});

test('watch window: severe TS includes plan example signals', () => {
  // Plan section 5 example: NWS warning expansion, higher lightning
  // density, stronger radar core, power outage reports.
  const r = urgencyFor(match());
  const conf = r.watchWindow!.confirming;
  assert.ok(conf.some((c) => /lightning/i.test(c)));
  assert.ok(conf.some((c) => /power outage/i.test(c)));
  assert.ok(conf.some((c) => /radar core/i.test(c)));
});

test('watch window: flash flood has gauge + low-water-crossing signals', () => {
  const r = urgencyFor(match({
    hazardKind: 'flash_flood',
    event: 'Flash Flood Warning',
  }));
  const conf = r.watchWindow!.confirming;
  assert.ok(conf.some((c) => /gauge/i.test(c)));
  assert.ok(conf.some((c) => /low-water/i.test(c)));
});

test('watch window: tropical / storm surge has track + tide signals', () => {
  const r = urgencyFor(match({
    hazardKind: 'tropical',
    event: 'Hurricane Warning',
  }));
  const conf = r.watchWindow!.confirming;
  assert.ok(conf.some((c) => /track/i.test(c)));
  assert.ok(conf.some((c) => /tide/i.test(c) || /surge/i.test(c)));
});

test('watch window: threatLevel "none" produces no watch window', () => {
  const r = urgencyFor(match({ threatLevel: 'none' }));
  assert.equal(r.watchWindow, undefined);
});

test('watch window: cancellation has no watch window', () => {
  const r = urgencyFor(match({ isCancellation: true }));
  assert.equal(r.watchWindow, undefined);
});

// ── Determinism ─────────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const a = urgencyFor(match());
  const b = urgencyFor(match());
  assert.deepEqual(a, b);
});

// ── End-to-end plan example ─────────────────────────────────────────────

test('integration: plan section-1 example "Severe Weather Near Home"', () => {
  // Plan's headline scenario: a severe weather threat near home should
  // produce a persistent critical alert with a watch window that lists
  // what to look for next.
  const r = urgencyFor(match({
    hazardKind: 'severe_thunderstorm',
    event: 'Severe Thunderstorm Warning',
    threatLevel: 'warning',
    matchKind: 'inside_polygon',
    severity: 'severe',
  }));
  assert.equal(r.priority, 'persistent_critical');
  assert.equal(r.persistentInApp, true);
  assert.equal(r.bypassQuietHours, true);
  assert.ok(r.watchWindow);
  assert.match(r.reason, /WARNING/);
});

// deliveryPriorityRank — the data-loader storm-decision selection ranks through
// this instead of comparing the priority strings directly. The ranking MUST be
// monotonic in urgency (string `>` is not: 'banner' < 'digest' lexicographically
// yet 'banner' is the more urgent delivery).
test('deliveryPriorityRank: strictly increasing with urgency', () => {
  const order = ['background', 'digest', 'watch_window', 'banner', 'persistent_critical', 'persistent_critical_with_imessage'] as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(deliveryPriorityRank(order[i]) > deliveryPriorityRank(order[i - 1]),
      `${order[i]} should outrank ${order[i - 1]}`);
  }
});

test('deliveryPriorityRank: a critical alert outranks a less-severe one (the storm-decision bug)', () => {
  // The bug: 'persistent_critical' must win over 'banner'/'watch_window'/'digest'.
  assert.ok(deliveryPriorityRank('persistent_critical') > deliveryPriorityRank('banner'));
  assert.ok(deliveryPriorityRank('persistent_critical_with_imessage') > deliveryPriorityRank('persistent_critical'));
  assert.ok(deliveryPriorityRank('banner') > deliveryPriorityRank('digest'));
});
