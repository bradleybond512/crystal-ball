import assert from 'node:assert/strict';
import test from 'node:test';

import { routeBigEventToLadder, resetNotificationLadderState } from '../notification-ladder.ts';
import type { BigEventInput, BigEventResult } from '../big-event-detector.ts';
import { createNotificationTraceRegistry } from '../../diagnostics/notification-trace.ts';
import {
  createNotificationPreferencesService,
  type NotificationPreferencesService,
  type StorageLike,
} from '../../notifications/notification-preferences.ts';

// Regression for the data-loader weather notification path, which previously
// hardcoded quietHoursActive:false + quietHoursBypassEnabled:true — so real NWS
// alerts ignored the user's quiet-hours setting entirely. This proves that when
// the values are derived from the canonical notification-preferences service
// (isQuietHour() + the weather domain's quietHoursOverride), a non-safety
// weather alert is suppressed during quiet hours, while safety-critical alerts
// still override.

const NOW = 1_745_000_000_000;
// A clock hour inside the 22:00–06:00 quiet window, and one outside it.
const DURING_QUIET = new Date(2025, 0, 1, 23, 0, 0);
const OUTSIDE_QUIET = new Date(2025, 0, 1, 12, 0, 0);

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

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

/** Mirrors src/app/data-loader.ts: derive quietHoursActive + the weather
 *  domain's quietHoursOverride from the canonical prefs service, then route. */
function routeWeatherAsDataLoader(
  svc: NotificationPreferencesService,
  result: BigEventResult,
  now: Date,
) {
  resetNotificationLadderState();
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  const quietHoursActive = svc.isQuietHour(now);
  const bypass = svc.getPreferences().domains.find((d) => d.domain === 'weather')?.quietHoursOverride ?? false;
  const decision = routeBigEventToLadder(reg, result, input(), {
    domain: 'weather',
    quietHoursActive,
    quietHoursBypassEnabled: bypass,
    now: () => NOW,
  });
  return { decision, reg };
}

test('non-safety weather alert is SUPPRESSED when quiet hours active + bypass disabled', () => {
  const svc = createNotificationPreferencesService(memStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  // weather domain quietHoursOverride defaults to false (no bypass).
  const { decision, reg } = routeWeatherAsDataLoader(svc, nonSafetyWeather(), DURING_QUIET);
  assert.equal(decision.dispatched, false, 'non-safety alert should be suppressed during quiet hours');
  assert.equal(reg.get(decision.candidateId)!.decisionReason, 'quiet-hours-no-bypass');
});

test('safety-critical weather alert still DISPATCHES during quiet hours (safety override)', () => {
  const svc = createNotificationPreferencesService(memStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  const { decision } = routeWeatherAsDataLoader(svc, safetyWeather(), DURING_QUIET);
  assert.equal(decision.dispatched, true, 'safety-critical must never be silenced by quiet hours');
});

test('non-safety weather alert DISPATCHES when the user enables the weather quiet-hours bypass', () => {
  const svc = createNotificationPreferencesService(memStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  svc.setDomainPreference('weather', { quietHoursOverride: true });
  const { decision } = routeWeatherAsDataLoader(svc, nonSafetyWeather(), DURING_QUIET);
  assert.equal(decision.dispatched, true, 'user-enabled bypass should let it through');
});

test('non-safety weather alert DISPATCHES outside quiet hours', () => {
  const svc = createNotificationPreferencesService(memStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  const { decision } = routeWeatherAsDataLoader(svc, nonSafetyWeather(), OUTSIDE_QUIET);
  assert.equal(decision.dispatched, true, 'outside the quiet window nothing is suppressed');
});
