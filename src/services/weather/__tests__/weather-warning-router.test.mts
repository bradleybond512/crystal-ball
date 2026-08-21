import assert from 'node:assert/strict';
import test from 'node:test';

import { routeWeatherAlert } from '../weather-warning-router.ts';
import {
  matchesWeatherSavedPlaceActionTarget,
  type AlertPolygon,
  type NwsAlertMinimal,
  type SavedPlace,
} from '../weather-threat-types.ts';
import { getAlgorithmEvaluationLedger, resetAlgorithmsState } from '@/services/algorithms/algorithms-state';

const NOW = 1_745_000_000_000;

const HOME: SavedPlace = {
  id: 'home',
  label: 'La Porte, IN',
  lat: 41.610,
  lon: -86.722,
};

const ENVELOPING: AlertPolygon = {
  rings: [[
    [-87.0, 41.50],
    [-86.50, 41.50],
    [-86.50, 41.80],
    [-87.0, 41.80],
    [-87.0, 41.50],
  ]],
};

const FAR: AlertPolygon = {
  rings: [[
    [-83.5, 42.0],
    [-83.0, 42.0],
    [-83.0, 42.5],
    [-83.5, 42.5],
    [-83.5, 42.0],
  ]],
};

function alert(overrides: Partial<NwsAlertMinimal> = {}): NwsAlertMinimal {
  return {
    id: 'urn:test',
    event: 'Severe Thunderstorm Warning',
    polygon: ENVELOPING,
    sent: new Date(NOW - 5 * 60 * 1000).toISOString(),
    expires: new Date(NOW + 30 * 60 * 1000).toISOString(),
    severity: 'severe',
    messageType: 'alert',
    ...overrides,
  };
}

// ── Place selection ─────────────────────────────────────────────────────

test('strongest match: picks the place where alert is inside polygon over a place farther away', () => {
  const office: SavedPlace = { id: 'office', label: 'Office', lat: 0, lon: 0 };
  const decision = routeWeatherAlert(alert(), [office, HOME], { now: NOW });
  assert.equal(decision.matchedPlaceId, 'home');
  assert.ok(matchesWeatherSavedPlaceActionTarget(HOME, decision.matchedPlaceAction));
  assert.equal(matchesWeatherSavedPlaceActionTarget({ ...HOME, lat: HOME.lat + 1 }, decision.matchedPlaceAction), false);
  assert.equal(matchesWeatherSavedPlaceActionTarget({ ...HOME, label: 'Renamed Home' }, decision.matchedPlaceAction), false);
  assert.equal(matchesWeatherSavedPlaceActionTarget(undefined, decision.matchedPlaceAction), false);
  assert.equal(decision.match!.matchKind, 'inside_polygon');
});

test('no places configured → no match, alert flagged for diagnosis', () => {
  const decision = routeWeatherAlert(alert(), [], { now: NOW });
  assert.equal(decision.match, undefined);
  assert.equal(decision.shouldSuppress, true);
  assert.equal(decision.diagnostic.verdict, 'undelivered_pipeline');
});

test('no place is close enough → no_match, suppressed', () => {
  const decision = routeWeatherAlert(alert({ polygon: FAR }), [HOME], { now: NOW });
  assert.equal(decision.match!.matchKind, 'no_match');
  assert.equal(decision.shouldSuppress, true);
});

// ── Dispatch actions per priority ──────────────────────────────────────

test('dispatch: tornado emergency inside polygon → persistent + sound + imessage + ack', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Tornado Warning' }),
    [HOME],
    { now: NOW },
  );
  assert.equal(decision.urgency!.priority, 'persistent_critical_with_imessage');
  assert.ok(decision.dispatchActions.includes('persistent_strip'));
  assert.ok(decision.dispatchActions.includes('imessage'));
  assert.ok(decision.dispatchActions.includes('request_acknowledgment'));
  assert.ok(decision.dispatchActions.includes('wake_app'));
});

test('dispatch: severe-TS warning inside polygon → persistent_critical (no iMessage)', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  assert.equal(decision.urgency!.priority, 'persistent_critical');
  assert.ok(decision.dispatchActions.includes('persistent_strip'));
  assert.ok(!decision.dispatchActions.includes('imessage'));
});

test('dispatch: watch-tier produces toast but no banner', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Severe Thunderstorm Watch', severity: 'moderate' }),
    [HOME],
    { now: NOW },
  );
  assert.equal(decision.urgency!.priority, 'watch_window');
  assert.ok(decision.dispatchActions.includes('toast'));
  assert.ok(!decision.dispatchActions.includes('banner'));
});

test('dispatch: advisory tier → digest only', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Wind Advisory', severity: 'minor' }),
    [HOME],
    { now: NOW },
  );
  assert.equal(decision.urgency!.priority, 'digest');
  assert.ok(decision.dispatchActions.includes('digest'));
  assert.ok(!decision.dispatchActions.includes('banner'));
});

// ── Quiet hours behavior ───────────────────────────────────────────────

test('quiet hours: bypass-eligible hazard breaks through even when DND is on', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Tornado Warning' }),
    [HOME],
    {
      now: NOW,
      quietHoursActive: true,
      quietHoursBypassEnabled: false,
    },
  );
  // Tornado is a bypass-eligible hazard (urgency.bypassQuietHours = true)
  // → shouldSuppress is false.
  assert.equal(decision.shouldSuppress, false);
  assert.ok(decision.dispatchActions.includes('banner'));
});

test('quiet hours: non-bypass hazard suppressed when DND on and bypass off', () => {
  const decision = routeWeatherAlert(
    alert({
      event: 'Winter Storm Warning',
      severity: 'moderate',
    }),
    [HOME],
    {
      now: NOW,
      quietHoursActive: true,
      quietHoursBypassEnabled: false,
    },
  );
  assert.equal(decision.shouldSuppress, true);
  // Suppressed alerts still update badge + inbox.
  assert.deepEqual(decision.dispatchActions, ['badge', 'inbox']);
  assert.match(decision.reason, /quiet hours/i);
});

test('quiet hours: bypass setting allows non-bypass hazard through', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Winter Storm Warning' }),
    [HOME],
    {
      now: NOW,
      quietHoursActive: true,
      quietHoursBypassEnabled: true,
    },
  );
  assert.equal(decision.shouldSuppress, false);
});

// ── Diagnostic always present ──────────────────────────────────────────

test('diagnostic: delivered alert still produces a "delivered" verdict', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  assert.equal(decision.diagnostic.verdict, 'delivered');
});

test('diagnostic: quiet-hours suppression yields "suppressed" verdict + remediation', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Winter Storm Warning' }),
    [HOME],
    { now: NOW, quietHoursActive: true, quietHoursBypassEnabled: false },
  );
  assert.equal(decision.diagnostic.verdict, 'suppressed');
  assert.match(decision.diagnostic.remediation.join(' '), /Bypass quiet hours/i);
});

test('diagnostic: no-match alert produces "undelivered_no_match" verdict', () => {
  const decision = routeWeatherAlert(
    alert({ polygon: FAR }),
    [HOME],
    { now: NOW },
  );
  assert.equal(decision.diagnostic.verdict, 'undelivered_no_match');
});

// ── Storm Mode payload only when banner+ ──────────────────────────────

test('payload: banner+ priority produces a Storm Mode payload', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  assert.ok(decision.payload);
  assert.equal(decision.payload!.primaryHazard, 'severe_thunderstorm');
});

test('payload: digest tier does NOT produce a Storm Mode payload', () => {
  const decision = routeWeatherAlert(
    alert({ event: 'Wind Advisory', severity: 'minor' }),
    [HOME],
    { now: NOW },
  );
  assert.equal(decision.payload, undefined);
});

test('payload: storm motion produces an arrival window for outside-polygon matches', () => {
  // Place sits outside an envelope-style polygon but still within the 10-km buffer
  // for severe_thunderstorm (high-risk hazard always-near).
  const NEARBY: AlertPolygon = {
    rings: [[
      [-87.00, 41.40],
      [-86.78, 41.40],
      [-86.78, 41.80],
      [-87.00, 41.80],
      [-87.00, 41.40],
    ]],
  };
  const decision = routeWeatherAlert(
    alert({ polygon: NEARBY }),
    [HOME],
    {
      now: NOW,
      stormMode: {
        stormMotion: { headingDeg: 90, speedKmh: 50 },
        bearingFromPlaceDeg: 270, // storm is W of home; heading 90° = approaching
      },
    },
  );
  assert.equal(decision.match!.matchKind, 'near_polygon');
  assert.ok(decision.payload);
  assert.ok(decision.payload!.arrivalWindow);
});

// ── Reason strings ─────────────────────────────────────────────────────

test('reason: notified case mentions "Inside warning polygon"', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  assert.match(decision.reason, /Inside warning polygon|EMERGENCY|WARNING/i);
});

test('reason: no places configured says "no saved-place match"', () => {
  const decision = routeWeatherAlert(alert(), [], { now: NOW });
  assert.match(decision.reason, /No saved-place match/i);
});

// ── Repeat suppression via previous-delivery ──────────────────────────

test('repeat: same threat tier passes urgency.minRepeatIntervalMs through', () => {
  const decision = routeWeatherAlert(alert(), [HOME], {
    now: NOW,
    previousDelivery: {
      previousThreatLevel: 'emergency',
      lastDeliveredAt: NOW - 5 * 60 * 1000,
      previouslyInside: true,
    },
  });
  // Same tier as previous → use base interval, not 0.
  assert.equal(decision.urgency!.minRepeatIntervalMs, 10 * 60 * 1000);
});

test('repeat: escalation zeroes the cooldown', () => {
  const decision = routeWeatherAlert(alert(), [HOME], {
    now: NOW,
    previousDelivery: {
      previousThreatLevel: 'watch',
      lastDeliveredAt: NOW - 60 * 1000,
      previouslyInside: true,
    },
  });
  assert.equal(decision.urgency!.minRepeatIntervalMs, 0);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same inputs → same decision', () => {
  const a = routeWeatherAlert(alert(), [HOME], { now: NOW });
  const b = routeWeatherAlert(alert(), [HOME], { now: NOW });
  assert.deepEqual(a, b);
});

// ── End-to-end plan example ─────────────────────────────────────────────

test('integration: tornado warning inside polygon during quiet hours bypasses + escalates', () => {
  // Plan section 7 example: tornado warning inside polygon should
  // bypass quiet hours + require acknowledgment + persist.
  const decision = routeWeatherAlert(
    alert({ event: 'Tornado Warning', severity: 'extreme' }),
    [HOME],
    {
      now: NOW,
      quietHoursActive: true,
      quietHoursBypassEnabled: false, // not enabled, but tornado is auto-bypass
    },
  );
  assert.equal(decision.shouldSuppress, false);
  assert.equal(decision.urgency!.priority, 'persistent_critical_with_imessage');
  assert.ok(decision.dispatchActions.includes('imessage'));
  assert.ok(decision.dispatchActions.includes('request_acknowledgment'));
  assert.equal(decision.diagnostic.verdict, 'delivered');
});

// ── Ledger wiring (closed-loop algorithm plan PR 2) ─────────────────────

test('ledger wiring: routing a matched alert records one weather-urgency evaluation', () => {
  resetAlgorithmsState();
  const ledger = getAlgorithmEvaluationLedger();
  routeWeatherAlert(alert(), [HOME], { now: NOW });
  const records = ledger.byAlgorithm('weather-urgency');
  assert.equal(records.length, 1);
  const r = records[0]!;
  assert.equal(r.label, 'persistent_critical', 'records the urgency priority as the label');
  assert.equal(r.detail?.matchKind, 'inside_polygon');
  assert.equal(typeof r.detail?.threatLevel, 'string');
  assert.equal(typeof r.detail?.persistentInApp, 'boolean');
});

test('ledger wiring: no_match alerts do NOT emit a weather-urgency record', () => {
  resetAlgorithmsState();
  const ledger = getAlgorithmEvaluationLedger();
  routeWeatherAlert(alert({ polygon: FAR }), [HOME], { now: NOW });
  // Skipping urgency for no_match keeps the ledger noise-free; the
  // diagnostic trace already explains why nothing fired.
  assert.equal(ledger.byAlgorithm('weather-urgency').length, 0);
});
