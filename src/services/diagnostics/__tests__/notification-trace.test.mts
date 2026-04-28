import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNotificationTraceRegistry,
  defaultSurfaceForRung,
  type NotificationCandidate,
} from '../notification-trace.ts';

const NOW = 1_745_000_000_000;

function makeRegistry(now: number = NOW) {
  let t = now;
  const reg = createNotificationTraceRegistry({ now: () => t });
  return {
    reg,
    advance(ms: number) {
      t += ms;
    },
    setTime(ms: number) {
      t = ms;
    },
  };
}

function tornadoCandidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return {
    candidateId: 'wx-1',
    situationId: 'NWS-2026-001',
    domain: 'weather',
    urgency: 'critical',
    confidence: 0.95,
    userRelevance: 0.9,
    safetyCritical: true,
    createdAt: NOW,
    headline: 'Tornado warning at home',
    ...overrides,
  };
}

function cyberCandidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return {
    candidateId: 'cy-1',
    situationId: 'CVE-2026-0001',
    domain: 'cyber',
    urgency: 'high',
    confidence: 0.7,
    safetyCritical: false,
    createdAt: NOW,
    ...overrides,
  };
}

// ── Registration ───────────────────────────────────────────────────────

test('register: creates entry with a single created event and pending decision', () => {
  const { reg } = makeRegistry();
  const e = reg.register(tornadoCandidate());
  assert.equal(e.decision, 'pending');
  assert.equal(e.events.length, 1);
  assert.equal(e.events[0]?.kind, 'created');
  assert.match(e.events[0]?.reason ?? '', /critical/);
});

test('register: throws on duplicate candidate id', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  assert.throws(() => reg.register(tornadoCandidate()), /already registered/);
});

// ── Event recording ────────────────────────────────────────────────────

test('recordEvent: appends with auto-assigned id and timestamp', () => {
  const { reg, advance } = makeRegistry();
  reg.register(tornadoCandidate());
  advance(500);
  const ev = reg.recordEvent('wx-1', {
    kind: 'urgency_check',
    reason: 'Critical urgency clears the gate.',
  });
  assert.match(ev.id, /^nt-/);
  assert.equal(ev.at, NOW + 500);
  const entry = reg.get('wx-1');
  assert.equal(entry?.events.length, 2);
});

test('recordEvent: caller-supplied id and timestamp pass through', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  const ev = reg.recordEvent('wx-1', {
    id: 'custom-event',
    at: NOW + 1000,
    kind: 'relevance_check',
    reason: 'Saved place 1 km away.',
  });
  assert.equal(ev.id, 'custom-event');
  assert.equal(ev.at, NOW + 1000);
});

test('recordEvent: throws when candidate is not registered', () => {
  const { reg } = makeRegistry();
  assert.throws(() => reg.recordEvent('missing', { kind: 'urgency_check', reason: 'x' }), /not registered/);
});

// ── Decisions ──────────────────────────────────────────────────────────

test('dispatch: locks rung and decision', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  const e = reg.dispatch('wx-1', 'critical');
  assert.equal(e.decision, 'dispatched');
  assert.equal(e.rung, 'critical');
  assert.match(e.events.at(-1)?.reason ?? '', /Dispatched at rung "critical"/);
});

test('suppress: records suppressed event and decision reason', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate({ safetyCritical: false }));
  const e = reg.suppress('wx-1', 'duplicate-of:wx-0');
  assert.equal(e.decision, 'suppressed');
  assert.equal(e.decisionReason, 'duplicate-of:wx-0');
  assert.equal(e.events.at(-1)?.kind, 'suppressed');
});

test('expire: records expired event and decision', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate({ safetyCritical: false }));
  const e = reg.expire('wx-1', 'aged-out');
  assert.equal(e.decision, 'expired');
  assert.equal(e.events.at(-1)?.kind, 'expired');
});

// ── Native result + user action ────────────────────────────────────────

test('recordNativeResult: stored on entry and as event', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.dispatch('wx-1', 'critical');
  const e = reg.recordNativeResult('wx-1', {
    delivered: true,
    surface: 'critical',
    at: NOW + 100,
  });
  assert.equal(e.nativeResult?.delivered, true);
  assert.equal(e.nativeResult?.surface, 'critical');
  assert.equal(e.events.at(-1)?.kind, 'native_result');
});

test('recordNativeResult: failed delivery includes error in event reason', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.dispatch('wx-1', 'critical');
  const e = reg.recordNativeResult('wx-1', {
    delivered: false,
    surface: 'failed',
    error: 'permissions denied',
  });
  assert.match(e.events.at(-1)?.reason ?? '', /permissions denied/);
});

test('recordUserAction: stored and reflected in events', () => {
  const { reg, advance } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.dispatch('wx-1', 'critical');
  reg.recordNativeResult('wx-1', { delivered: true, surface: 'critical' });
  advance(2000);
  const e = reg.recordUserAction('wx-1', { kind: 'opened' });
  assert.equal(e.userAction?.kind, 'opened');
  assert.equal(e.userAction?.at, NOW + 2000);
  assert.equal(e.events.at(-1)?.kind, 'user_action');
});

// ── Filter helpers ─────────────────────────────────────────────────────

test('byDomain / bySituation: filter correctly', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.register(cyberCandidate());
  reg.register(tornadoCandidate({ candidateId: 'wx-2', situationId: 'NWS-2026-002' }));
  assert.deepEqual(reg.byDomain('weather').map((e) => e.candidate.candidateId), ['wx-1', 'wx-2']);
  assert.deepEqual(reg.byDomain('cyber').map((e) => e.candidate.candidateId), ['cy-1']);
  assert.deepEqual(
    reg.bySituation('NWS-2026-001').map((e) => e.candidate.candidateId),
    ['wx-1'],
  );
});

// ── Summary ────────────────────────────────────────────────────────────

test('summary: counts candidates, dispatched, and suppressedByReason', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.register(cyberCandidate());
  reg.register(tornadoCandidate({ candidateId: 'wx-2', safetyCritical: false }));
  reg.dispatch('wx-1', 'critical');
  reg.suppress('cy-1', 'duplicate-of:cy-0');
  reg.suppress('wx-2', 'duplicate-of:cy-0');
  const s = reg.summary();
  assert.equal(s.candidates, 3);
  assert.equal(s.dispatched, 1);
  assert.equal(s.suppressedByReason['duplicate-of:cy-0'], 2);
});

test('summary: unsafeSuppressions records safety-critical suppressions only', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());                        // critical + safety
  reg.register(cyberCandidate());                          // not safety-critical
  reg.suppress('wx-1', 'quiet-hours-no-bypass');
  reg.suppress('cy-1', 'duplicate');
  const s = reg.summary();
  assert.equal(s.unsafeSuppressions.length, 1);
  assert.equal(s.unsafeSuppressions[0]?.candidateId, 'wx-1');
  assert.equal(s.unsafeSuppressions[0]?.reason, 'quiet-hours-no-bypass');
});

test('summary: window filter includes only recent candidates', () => {
  const { reg, advance } = makeRegistry();
  reg.register(tornadoCandidate({ candidateId: 'old', createdAt: NOW - 60 * 60 * 1000 }));
  reg.register(tornadoCandidate({ candidateId: 'new' }));
  advance(0);
  const s = reg.summary(10 * 60 * 1000);
  assert.equal(s.candidates, 1);
});

// ── trim + clear ───────────────────────────────────────────────────────

test('trim: drops oldest entries down to the cap', () => {
  const { reg } = makeRegistry();
  for (let i = 0; i < 5; i += 1) {
    reg.register(tornadoCandidate({ candidateId: `wx-${i}`, situationId: `SIT-${i}` }));
  }
  const removed = reg.trim(3);
  assert.equal(removed, 2);
  const ids = reg.all().map((e) => e.candidate.candidateId);
  assert.deepEqual(ids, ['wx-2', 'wx-3', 'wx-4']);
});

test('clear: empties registry and resets event ids', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.recordEvent('wx-1', { kind: 'urgency_check', reason: 'x' });
  reg.clear();
  reg.register(tornadoCandidate());
  const entry = reg.get('wx-1');
  assert.equal(entry?.events[0]?.id, 'nt-1');
});

// ── defaultSurfaceForRung ──────────────────────────────────────────────

test('defaultSurfaceForRung maps every rung deterministically', () => {
  assert.equal(defaultSurfaceForRung('silent'), 'in_app');
  assert.equal(defaultSurfaceForRung('in_app'), 'in_app');
  assert.equal(defaultSurfaceForRung('banner'), 'banner');
  assert.equal(defaultSurfaceForRung('banner_sound'), 'banner');
  assert.equal(defaultSurfaceForRung('critical'), 'critical');
  assert.equal(defaultSurfaceForRung('announcement'), 'critical_sound');
});

// ── End-to-end weather example ─────────────────────────────────────────

test('full pipeline: tornado warning delivered with user opening', () => {
  const { reg, advance } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.recordEvent('wx-1', { kind: 'urgency_check', reason: 'Critical clears.' });
  reg.recordEvent('wx-1', {
    kind: 'relevance_check',
    reason: 'Saved place inside polygon.',
    detail: { distanceKm: 0 },
  });
  reg.recordEvent('wx-1', { kind: 'dedupe_check', reason: 'No prior dispatch in 5 min.' });
  reg.recordEvent('wx-1', { kind: 'quiet_hours_check', reason: 'Quiet hours bypassed.' });
  advance(50);
  reg.dispatch('wx-1', 'critical');
  reg.recordNativeResult('wx-1', { delivered: true, surface: 'critical', at: NOW + 60 });
  advance(3000);
  reg.recordUserAction('wx-1', { kind: 'opened' });

  const entry = reg.get('wx-1')!;
  assert.equal(entry.decision, 'dispatched');
  assert.equal(entry.rung, 'critical');
  assert.equal(entry.nativeResult?.delivered, true);
  assert.equal(entry.userAction?.kind, 'opened');
  // Expected event sequence
  assert.deepEqual(
    entry.events.map((e) => e.kind),
    [
      'created',
      'urgency_check',
      'relevance_check',
      'dedupe_check',
      'quiet_hours_check',
      'rung_selected',
      'native_result',
      'user_action',
    ],
  );

  const summary = reg.summary();
  assert.equal(summary.candidates, 1);
  assert.equal(summary.dispatched, 1);
  assert.equal(summary.unsafeSuppressions.length, 0);
});

test('full pipeline: tornado warning suppressed by quiet hours surfaces unsafe', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.recordEvent('wx-1', { kind: 'quiet_hours_check', reason: 'Quiet hours active, bypass off.' });
  reg.suppress('wx-1', 'quiet-hours-no-bypass');
  const summary = reg.summary();
  assert.equal(summary.dispatched, 0);
  assert.equal(summary.unsafeSuppressions.length, 1);
  assert.equal(summary.unsafeSuppressions[0]?.reason, 'quiet-hours-no-bypass');
});

// ── JSON serializability ───────────────────────────────────────────────

test('entries and summary are JSON-serializable', () => {
  const { reg } = makeRegistry();
  reg.register(tornadoCandidate());
  reg.dispatch('wx-1', 'critical');
  const json = JSON.stringify({ entries: reg.all(), summary: reg.summary() });
  const parsed = JSON.parse(json) as { entries: unknown[]; summary: { candidates: number } };
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.summary.candidates, 1);
});
