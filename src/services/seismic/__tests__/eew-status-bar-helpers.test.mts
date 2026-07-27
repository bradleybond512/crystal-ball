import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveStatusBarState,
  deriveSWaveCountdownSec,
  formatTimeAgo,
  pickLeadAlert,
  type EewStatusPayload,
} from '../eew-status-bar-helpers.ts';
import type { EewAlert } from '../eew-alert-engine.ts';

const NOW = 1_745_000_000_000;

function alert(overrides: Partial<EewAlert> & { tier: EewAlert['tier']; eventId: string }): EewAlert {
  return {
    eventId: overrides.eventId,
    tier: overrides.tier,
    reason: overrides.reason ?? 'M test',
    triggeredAt: overrides.triggeredAt ?? NOW,
    upgradedFrom: overrides.upgradedFrom,
    imessageStatus: overrides.imessageStatus,
    imessageError: overrides.imessageError,
  };
}

// ── pickLeadAlert ──────────────────────────────────────────────────────

test('pickLeadAlert: empty list returns null', () => {
  assert.equal(pickLeadAlert([]), null);
});

test('pickLeadAlert: single alert is the lead', () => {
  const a = alert({ eventId: 'a', tier: 'TIER_1_INFO' });
  assert.equal(pickLeadAlert([a]), a);
});

test('pickLeadAlert: highest tier wins regardless of triggeredAt', () => {
  const lo = alert({ eventId: 'lo', tier: 'TIER_1_INFO', triggeredAt: NOW + 5000 });
  const hi = alert({ eventId: 'hi', tier: 'TIER_4_SEVERE', triggeredAt: NOW });
  assert.equal(pickLeadAlert([lo, hi])!.eventId, 'hi');
});

test('pickLeadAlert: ties broken by most recent triggeredAt', () => {
  const old = alert({ eventId: 'old', tier: 'TIER_3_WARNING', triggeredAt: NOW });
  const recent = alert({ eventId: 'recent', tier: 'TIER_3_WARNING', triggeredAt: NOW + 1000 });
  assert.equal(pickLeadAlert([old, recent])!.eventId, 'recent');
});

// ── deriveStatusBarState ───────────────────────────────────────────────

test('null payload → ALL CLEAR / gray', () => {
  const state = deriveStatusBarState(null);
  assert.equal(state.allClear, true);
  assert.equal(state.color, 'gray');
  assert.equal(state.label, 'ALL CLEAR');
});

test('empty activeAlerts → ALL CLEAR / gray', () => {
  const payload: EewStatusPayload = {
    activeAlerts: [], highestTier: null, lastEventId: null, asOf: NOW,
  };
  const state = deriveStatusBarState(payload);
  assert.equal(state.allClear, true);
  assert.equal(state.color, 'gray');
});

test('TIER_1 active → blue / not all-clear', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_1_INFO' })],
    highestTier: 'TIER_1_INFO', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.allClear, false);
  assert.equal(state.color, 'blue');
  assert.match(state.label, /TIER 1/);
});

test('TIER_2 → yellow', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_2_WATCH' })],
    highestTier: 'TIER_2_WATCH', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.color, 'yellow');
});

test('TIER_3 → orange', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_3_WARNING' })],
    highestTier: 'TIER_3_WARNING', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.color, 'orange');
});

test('TIER_4 → red', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_4_SEVERE' })],
    highestTier: 'TIER_4_SEVERE', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.color, 'red');
});

test('TIER_5 → crimson', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_5_EXTREME' })],
    highestTier: 'TIER_5_EXTREME', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.color, 'crimson');
});

test('multi-tier: lead alert is the highest', () => {
  const state = deriveStatusBarState({
    activeAlerts: [
      alert({ eventId: 'lo', tier: 'TIER_1_INFO' }),
      alert({ eventId: 'hi', tier: 'TIER_4_SEVERE' }),
      alert({ eventId: 'mid', tier: 'TIER_2_WATCH' }),
    ],
    highestTier: 'TIER_4_SEVERE',
    lastEventId: 'hi',
    asOf: NOW,
  });
  assert.equal(state.lastAlert?.eventId, 'hi');
  assert.equal(state.color, 'red');
});

// ── iMessage badge ─────────────────────────────────────────────────────

test('iMessage badge invisible for non-TIER_5', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_4_SEVERE', imessageStatus: 'sent' })],
    highestTier: 'TIER_4_SEVERE', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.imessage.visible, false);
});

test('TIER_5 + sent → badge visible with sent status', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_5_EXTREME', imessageStatus: 'sent' })],
    highestTier: 'TIER_5_EXTREME', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.imessage.visible, true);
  assert.equal(state.imessage.status, 'sent');
});

test('TIER_5 + failed → badge visible with error', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({
      eventId: 'a', tier: 'TIER_5_EXTREME',
      imessageStatus: 'failed', imessageError: 'Messages.app rate-limited',
    })],
    highestTier: 'TIER_5_EXTREME', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.imessage.visible, true);
  assert.equal(state.imessage.status, 'failed');
  assert.equal(state.imessage.error, 'Messages.app rate-limited');
});

test('TIER_5 + disabled → badge visible with disabled status', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_5_EXTREME', imessageStatus: 'disabled' })],
    highestTier: 'TIER_5_EXTREME', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.imessage.status, 'disabled');
});

// ── Composite worst-of (safety case + readiness) ───────────────────────

test('composite: all inputs clear → ALL CLEAR / source none', () => {
  const state = deriveStatusBarState(null, {
    safetyCaseSafeToOperate: true,
    readinessStatus: 'healthy',
  });
  assert.equal(state.allClear, true);
  assert.equal(state.source, 'none');
  assert.equal(state.label, 'ALL CLEAR');
  assert.equal(state.color, 'gray');
});

test('composite: safety review alone → red SAFETY REVIEW, not all-clear', () => {
  const state = deriveStatusBarState(null, { safetyCaseSafeToOperate: false });
  assert.equal(state.allClear, false);
  assert.equal(state.color, 'red');
  assert.equal(state.label, 'SAFETY REVIEW');
  assert.equal(state.source, 'safety');
  assert.equal(state.tier, null);
  assert.equal(state.lastAlert, null);
});

test('composite: readiness unsafe alone → red READINESS: CRITICAL', () => {
  const state = deriveStatusBarState(null, { readinessStatus: 'unsafe' });
  assert.equal(state.allClear, false);
  assert.equal(state.color, 'red');
  assert.equal(state.label, 'READINESS: CRITICAL');
  assert.equal(state.source, 'readiness');
});

test('composite: readiness degraded (not unsafe) does not trip the chip', () => {
  const state = deriveStatusBarState(null, { readinessStatus: 'degraded' });
  assert.equal(state.allClear, true);
  assert.equal(state.source, 'none');
});

test('composite: unknown inputs (null) treated as clear', () => {
  const state = deriveStatusBarState(null, {
    safetyCaseSafeToOperate: null,
    readinessStatus: null,
  });
  assert.equal(state.allClear, true);
});

test('composite: TIER_5 EEW outranks safety review + readiness critical', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_5_EXTREME' })],
    highestTier: 'TIER_5_EXTREME', lastEventId: 'a', asOf: NOW,
  }, { safetyCaseSafeToOperate: false, readinessStatus: 'unsafe' });
  assert.equal(state.source, 'eew');
  assert.equal(state.color, 'crimson');
  assert.match(state.label, /TIER 5/);
});

test('composite: EEW TIER_4 ties with safety → EEW wins (live hazard first)', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_4_SEVERE' })],
    highestTier: 'TIER_4_SEVERE', lastEventId: 'a', asOf: NOW,
  }, { safetyCaseSafeToOperate: false });
  assert.equal(state.source, 'eew');
  assert.equal(state.color, 'red');
});

test('composite: safety outranks EEW TIER_2', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_2_WATCH' })],
    highestTier: 'TIER_2_WATCH', lastEventId: 'a', asOf: NOW,
  }, { safetyCaseSafeToOperate: false });
  assert.equal(state.source, 'safety');
  assert.equal(state.label, 'SAFETY REVIEW');
  assert.equal(state.lastAlert, null);
  assert.equal(state.imessage.visible, false);
});

test('composite: readiness unsafe outranks EEW TIER_1', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_1_INFO' })],
    highestTier: 'TIER_1_INFO', lastEventId: 'a', asOf: NOW,
  }, { readinessStatus: 'unsafe' });
  assert.equal(state.source, 'readiness');
  assert.equal(state.label, 'READINESS: CRITICAL');
});

test('composite: safety + readiness both critical → safety wins the tie', () => {
  const state = deriveStatusBarState(null, {
    safetyCaseSafeToOperate: false,
    readinessStatus: 'unsafe',
  });
  assert.equal(state.source, 'safety');
});

test('composite omitted → EEW-only behaviour preserved', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_3_WARNING' })],
    highestTier: 'TIER_3_WARNING', lastEventId: 'a', asOf: NOW,
  });
  assert.equal(state.source, 'eew');
  assert.equal(state.color, 'orange');
  assert.equal(state.allClear, false);
});

// ── Composite worst-of: personal weather ──────────────────────────────
// The visible ALL CLEAR chip historically ignored weather entirely, so it
// asserted "all clear" during an actual storm over the user. A PERSONAL
// weather threat (an Extreme/Severe NWS alert matched to a saved place) now
// feeds the composite. It must sit between EEW and safety in the tie-break
// order: EEW > weather > safety > readiness.

test('composite: weather extreme alone → crimson WEATHER: EXTREME, not all-clear', () => {
  const state = deriveStatusBarState(null, { weatherSeverity: 'extreme' });
  assert.equal(state.allClear, false);
  assert.equal(state.color, 'crimson');
  assert.equal(state.label, 'WEATHER: EXTREME');
  assert.equal(state.source, 'weather');
  assert.equal(state.tier, null);
  assert.equal(state.lastAlert, null);
  assert.equal(state.imessage.visible, false);
});

test('composite: weather severe alone → red SEVERE WEATHER', () => {
  const state = deriveStatusBarState(null, { weatherSeverity: 'severe' });
  assert.equal(state.allClear, false);
  assert.equal(state.color, 'red');
  assert.equal(state.label, 'SEVERE WEATHER');
  assert.equal(state.source, 'weather');
});

test('composite: weather null treated as clear', () => {
  const state = deriveStatusBarState(null, { weatherSeverity: null });
  assert.equal(state.allClear, true);
  assert.equal(state.source, 'none');
});

test('composite: weather extreme outranks EEW TIER_4 (rank 5 > 4)', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_4_SEVERE' })],
    highestTier: 'TIER_4_SEVERE', lastEventId: 'a', asOf: NOW,
  }, { weatherSeverity: 'extreme' });
  assert.equal(state.source, 'weather');
  assert.equal(state.color, 'crimson');
  assert.equal(state.label, 'WEATHER: EXTREME');
});

test('composite: EEW TIER_5 outranks weather extreme (EEW wins the tie)', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_5_EXTREME' })],
    highestTier: 'TIER_5_EXTREME', lastEventId: 'a', asOf: NOW,
  }, { weatherSeverity: 'extreme' });
  assert.equal(state.source, 'eew');
  assert.match(state.label, /TIER 5/);
});

test('composite: EEW TIER_4 ties weather severe → EEW wins (live hazard first)', () => {
  const state = deriveStatusBarState({
    activeAlerts: [alert({ eventId: 'a', tier: 'TIER_4_SEVERE' })],
    highestTier: 'TIER_4_SEVERE', lastEventId: 'a', asOf: NOW,
  }, { weatherSeverity: 'severe' });
  assert.equal(state.source, 'eew');
});

test('composite: weather severe outranks safety review (weather wins the tie)', () => {
  const state = deriveStatusBarState(null, {
    weatherSeverity: 'severe',
    safetyCaseSafeToOperate: false,
  });
  assert.equal(state.source, 'weather');
  assert.equal(state.label, 'SEVERE WEATHER');
});

test('composite: weather severe outranks readiness unsafe', () => {
  const state = deriveStatusBarState(null, {
    weatherSeverity: 'severe',
    readinessStatus: 'unsafe',
  });
  assert.equal(state.source, 'weather');
});

test('composite: weather extreme outranks safety + readiness together', () => {
  const state = deriveStatusBarState(null, {
    weatherSeverity: 'extreme',
    safetyCaseSafeToOperate: false,
    readinessStatus: 'unsafe',
  });
  assert.equal(state.source, 'weather');
  assert.equal(state.color, 'crimson');
});

// ── S-wave countdown ───────────────────────────────────────────────────

test('countdown null when no arrival time', () => {
  const a = alert({ eventId: 'a', tier: 'TIER_3_WARNING' });
  assert.equal(deriveSWaveCountdownSec(a, null, NOW), null);
});

test('countdown returns floor(remaining / 1s)', () => {
  const a = alert({ eventId: 'a', tier: 'TIER_3_WARNING' });
  assert.equal(deriveSWaveCountdownSec(a, NOW + 30_500, NOW), 31);
});

test('countdown clamps to 0 when in the past', () => {
  const a = alert({ eventId: 'a', tier: 'TIER_3_WARNING' });
  assert.equal(deriveSWaveCountdownSec(a, NOW - 10_000, NOW), 0);
});

test('countdown null when no alert', () => {
  assert.equal(deriveSWaveCountdownSec(null, NOW + 30_000, NOW), null);
});

// ── formatTimeAgo ──────────────────────────────────────────────────────

test('formatTimeAgo: <60s → just now', () => {
  assert.equal(formatTimeAgo(NOW - 30_000, NOW), 'just now');
});

test('formatTimeAgo: 5 minutes ago', () => {
  assert.equal(formatTimeAgo(NOW - 5 * 60_000, NOW), '5m ago');
});

test('formatTimeAgo: hours', () => {
  assert.equal(formatTimeAgo(NOW - 3 * 3600_000, NOW), '3h ago');
});

test('formatTimeAgo: future timestamps clamp to just now', () => {
  assert.equal(formatTimeAgo(NOW + 5000, NOW), 'just now');
});
