import assert from 'node:assert/strict';
import test from 'node:test';

import { routeBigEventToLadder, resetNotificationLadderState } from '../notification-ladder.ts';
import type { BigEventInput, BigEventResult } from '../big-event-detector.ts';
import { createNotificationTraceRegistry } from '../../diagnostics/notification-trace.ts';
import {
  ladderQuietHours,
  resetSettings,
  updateDomainSettings,
  updateGlobalSettings,
} from '../../notifications/notification-settings-service.ts';

// Regression for the data-loader weather notification path, which previously
// hardcoded quietHoursActive:false + quietHoursBypassEnabled:true — so real NWS
// alerts ignored the user's quiet-hours setting entirely. R4-BUG-003 moved the
// source of truth to the one canonical window (Notification Settings) plus
// weather's own quiet-hours toggle, read through ladderQuietHours() — the same
// function data-loader calls. A non-safety weather alert is suppressed during
// quiet hours, while safety-critical alerts still override.

const NOW = 1_745_000_000_000;
// A clock hour inside the 22:00–06:00 quiet window, and one outside it.
const DURING_QUIET = new Date(2025, 0, 1, 23, 0, 0);
const OUTSIDE_QUIET = new Date(2025, 0, 1, 12, 0, 0);

function nonSafetyWeather(): BigEventResult {
  return {
    isBigEvent: true, triggers: [], totalScore: 45, confidence: 'medium',
    urgency: 'medium', tier: 'watch', deliveryPriority: 'watch_window', explanation: '',
  };
}
function safetyWeather(): BigEventResult {
  return {
    isBigEvent: true, triggers: [], totalScore: 95, confidence: 'high',
    urgency: 'high', tier: 'emergency', deliveryPriority: 'critical_persistent', explanation: '',
  };
}
function input(): BigEventInput {
  return {
    truthScore: 0.85, userExposure: 80, severity: 90, previousSeverity: 60,
    sources: ['NWS'], domains: ['weather'], potentialImpact: 90,
  };
}

/** Same call as src/app/data-loader.ts: ladderQuietHours('weather'), then route. */
function routeWeatherAsDataLoader(result: BigEventResult, now: Date) {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const { quietHoursActive, quietHoursBypassEnabled } = ladderQuietHours('weather', now);
  const decision = routeBigEventToLadder(reg, result, input(), {
    domain: 'weather',
    quietHoursActive,
    quietHoursBypassEnabled,
    now: () => NOW,
  });
  return { decision, reg };
}

function weatherQuietHours(enabled: boolean): void {
  resetSettings();
  assert.deepEqual(updateGlobalSettings({ quietHoursStart: '22:00', quietHoursEnd: '06:00' }), { ok: true });
  updateDomainSettings('weather', { quietHoursEnabled: enabled });
}

test('non-safety weather alert is SUPPRESSED inside the window when weather quiet hours are on', () => {
  weatherQuietHours(true);
  const { decision, reg } = routeWeatherAsDataLoader(nonSafetyWeather(), DURING_QUIET);
  assert.equal(decision.dispatched, false, 'non-safety alert should be suppressed during quiet hours');
  assert.equal(reg.get(decision.candidateId)!.decisionReason, 'quiet-hours-no-bypass');
});

test('safety-critical weather alert still DISPATCHES during quiet hours (safety override)', () => {
  weatherQuietHours(true);
  const { decision } = routeWeatherAsDataLoader(safetyWeather(), DURING_QUIET);
  assert.equal(decision.dispatched, true, 'safety-critical must never be silenced by quiet hours');
});

test('non-safety weather alert DISPATCHES when weather quiet hours are off', () => {
  weatherQuietHours(false);
  const { decision } = routeWeatherAsDataLoader(nonSafetyWeather(), DURING_QUIET);
  assert.equal(decision.dispatched, true, 'weather quiet hours off should let it through');
});

test('non-safety weather alert DISPATCHES outside quiet hours', () => {
  weatherQuietHours(true);
  const { decision } = routeWeatherAsDataLoader(nonSafetyWeather(), OUTSIDE_QUIET);
  assert.equal(decision.dispatched, true, 'outside the quiet window nothing is suppressed');
});
