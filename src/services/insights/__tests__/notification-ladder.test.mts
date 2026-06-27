import assert from 'node:assert/strict';
import test from 'node:test';

import {
  routeBigEventToLadder,
  resetNotificationLadderState,
} from '../notification-ladder.ts';
import type { BigEventInput, BigEventResult } from '../big-event-detector.ts';
import { createNotificationTraceRegistry } from '../../diagnostics/notification-trace.ts';

const NOW = 1_745_000_000_000;

function critical(): BigEventResult {
  return {
    isBigEvent: true,
    triggers: [],
    totalScore: 95,
    confidence: 'high',
    urgency: 'high',
    tier: 'emergency',
    deliveryPriority: 'critical_persistent',
    explanation: '',
  };
}

function watch(): BigEventResult {
  return {
    isBigEvent: true,
    triggers: [],
    totalScore: 45,
    confidence: 'medium',
    urgency: 'medium',
    tier: 'watch',
    deliveryPriority: 'watch_window',
    explanation: '',
  };
}

function input(overrides: Partial<BigEventInput> = {}): BigEventInput {
  return {
    truthScore: 0.85,
    userExposure: 80,
    severity: 90,
    previousSeverity: 60,
    sources: ['NWS', 'radar'],
    domains: ['weather'],
    potentialImpact: 90,
    ...overrides,
  };
}

// ── Dispatch path ──────────────────────────────────────────────────────

test('emergency tier → announcement rung, dispatched, registry sees full lifecycle', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const decision = routeBigEventToLadder(reg, critical(), input(), {
    domain: 'weather',
    headline: 'Tornado warning at home',
    now: () => NOW,
  });
  assert.equal(decision.dispatched, true);
  assert.equal(decision.rung, 'announcement');
  const entry = reg.get(decision.candidateId)!;
  assert.equal(entry.decision, 'dispatched');
  // Expect kinds: created, urgency_check, relevance_check, dedupe_check, quiet_hours_check, rung_selected
  const kinds = entry.events.map((e) => e.kind);
  assert.ok(kinds.includes('urgency_check'));
  assert.ok(kinds.includes('relevance_check'));
  assert.ok(kinds.includes('dedupe_check'));
  assert.ok(kinds.includes('quiet_hours_check'));
  assert.ok(kinds.includes('rung_selected'));
});

test('watch tier → banner rung', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const decision = routeBigEventToLadder(reg, watch(), input(), {
    domain: 'cyber',
    now: () => NOW,
  });
  assert.equal(decision.rung, 'banner');
});

// ── Dedupe ─────────────────────────────────────────────────────────────

test('dedupeMatch true → suppressed-as-duplicate, no dispatch', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const decision = routeBigEventToLadder(reg, critical(), input(), {
    domain: 'weather',
    dedupeMatch: true,
    now: () => NOW,
  });
  assert.equal(decision.dispatched, false);
  assert.match(decision.reason, /duplicate/);
  const entry = reg.get(decision.candidateId)!;
  assert.equal(entry.decision, 'suppressed');
  assert.equal(entry.decisionReason, 'duplicate-of-recent');
});

// ── Quiet hours ────────────────────────────────────────────────────────

test('quiet hours active + non-safety event → suppressed', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const decision = routeBigEventToLadder(reg, watch(), input(), {
    domain: 'market',
    quietHoursActive: true,
    quietHoursBypassEnabled: false,
    now: () => NOW,
  });
  assert.equal(decision.dispatched, false);
  const entry = reg.get(decision.candidateId)!;
  assert.equal(entry.decision, 'suppressed');
  assert.equal(entry.decisionReason, 'quiet-hours-no-bypass');
});

test('quiet hours active + safety-critical event → dispatched anyway (safety override)', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const decision = routeBigEventToLadder(reg, critical(), input(), {
    domain: 'weather',
    quietHoursActive: true,
    quietHoursBypassEnabled: false,
    now: () => NOW,
  });
  assert.equal(decision.dispatched, true);
  assert.equal(decision.rung, 'announcement');
});

test('quiet hours active + bypass enabled → dispatched normally', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const decision = routeBigEventToLadder(reg, watch(), input(), {
    domain: 'weather',
    quietHoursActive: true,
    quietHoursBypassEnabled: true,
    now: () => NOW,
  });
  assert.equal(decision.dispatched, true);
});

// ── Safety-critical flag flows into the registry summary ───────────────

test('safety-critical suppression (impossible by design) does not corrupt summary', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  // Critical tier but flagged dedupeMatch — gets suppressed for being
  // a duplicate. That's not an unsafe suppression because the user
  // already saw the prior alert.
  routeBigEventToLadder(reg, critical(), input(), {
    domain: 'weather',
    dedupeMatch: true,
    now: () => NOW,
  });
  const summary = reg.summary();
  assert.equal(summary.candidates, 1);
  assert.equal(summary.dispatched, 0);
  assert.equal(summary.unsafeSuppressions.length, 1); // safetyCritical=true was suppressed
});

// ── Safety-critical rung escalation (round-3 audit #2) ─────────────────────────
// The confidence×urgency matrix tops out at 'notify_now' — nothing ever produces
// 'critical_persistent' — so a REAL emergency reaches the ladder with
// deliveryPriority 'notify_now'. It must still escalate to a loud DND-bypassing
// rung, not the same 'banner_sound' as an ordinary notification. The other
// fixtures hand-set 'critical_persistent', which hid this production gap.

test('emergency tier with PRODUCTION deliveryPriority (notify_now) → loud DND-bypass rung', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const emergencyNotifyNow: BigEventResult = {
    isBigEvent: true, triggers: [], totalScore: 95, confidence: 'high',
    urgency: 'high', tier: 'emergency', deliveryPriority: 'notify_now', explanation: '',
  };
  const decision = routeBigEventToLadder(reg, emergencyNotifyNow, input(), {
    domain: 'weather', headline: 'Tornado warning at home', now: () => NOW,
  });
  assert.equal(decision.dispatched, true);
  assert.equal(decision.rung, 'critical', 'a real emergency must reach the DND-bypassing rung, not banner_sound');
  assert.notEqual(decision.rung, 'banner_sound');
});

test('non-safety notify_now stays at banner_sound (no over-escalation)', () => {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const ordinary: BigEventResult = {
    isBigEvent: true, triggers: [], totalScore: 60, confidence: 'high',
    urgency: 'high', tier: 'watch', deliveryPriority: 'notify_now', explanation: '',
  };
  const decision = routeBigEventToLadder(reg, ordinary, input(), { domain: 'market', now: () => NOW });
  assert.equal(decision.rung, 'banner_sound');
});
