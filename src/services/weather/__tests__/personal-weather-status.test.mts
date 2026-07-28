import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setPersonalWeatherThreat,
  getPersonalWeatherThreat,
  clearPersonalWeatherThreat,
  selectPersonalWeatherThreat,
  subscribePersonalWeatherThreat,
  resolveThreatExpiryMs,
  decideThreatPublication,
  isWeatherMatchingComplete,
  confirmPersonalWeatherClear,
  revokePersonalWeatherClearConfirmation,
  isPersonalWeatherClearConfirmed,
  PERSONAL_WEATHER_CLEAR_TTL_MS,
  PERSONAL_CHIP_EXPOSURE_FLOOR,
  chipExposureFloor,
  type WeatherThreatCandidate,
} from '../personal-weather-status.ts';

function candidate(o: Partial<WeatherThreatCandidate> = {}): WeatherThreatCandidate {
  return { severity: 'Severe', event: 'Severe Thunderstorm Warning', exposure: 90, expiresAt: 10_000, ...o };
}

// The visible "ALL CLEAR" status chip is driven by a worst-of composite that
// historically ignored weather. This singleton carries the user's CURRENT
// PERSONAL weather threat (an Extreme/Severe alert matched to a saved place)
// so the chip can stop asserting "all clear" during a storm — without pulling
// in the national alert firehose (there is always severe weather SOMEWHERE).

test('set then get returns the active threat', () => {
  clearPersonalWeatherThreat();
  setPersonalWeatherThreat({ severity: 'severe', label: 'Tornado Warning', expiresAt: 10_000 });
  const t = getPersonalWeatherThreat(5_000);
  assert.equal(t?.severity, 'severe');
  assert.equal(t?.label, 'Tornado Warning');
});

test('the threat self-clears once its expiry passes', () => {
  clearPersonalWeatherThreat();
  setPersonalWeatherThreat({ severity: 'extreme', label: 'Tornado Warning', expiresAt: 10_000 });
  // At/after expiry the chip must not keep showing a stale storm.
  assert.equal(getPersonalWeatherThreat(10_000), null);
  // ...and the clear is sticky (state was wiped, not just filtered this call).
  assert.equal(getPersonalWeatherThreat(9_000), null);
});

test('the threat is still live before expiry', () => {
  clearPersonalWeatherThreat();
  setPersonalWeatherThreat({ severity: 'severe', label: 'Severe Thunderstorm Warning', expiresAt: 10_000 });
  assert.equal(getPersonalWeatherThreat(9_999)?.severity, 'severe');
});

test('clearPersonalWeatherThreat resets to null', () => {
  setPersonalWeatherThreat({ severity: 'extreme', label: 'x', expiresAt: Number.MAX_SAFE_INTEGER });
  clearPersonalWeatherThreat();
  assert.equal(getPersonalWeatherThreat(0), null);
});

test('setPersonalWeatherThreat(null) clears the current threat', () => {
  setPersonalWeatherThreat({ severity: 'severe', label: 'x', expiresAt: Number.MAX_SAFE_INTEGER });
  setPersonalWeatherThreat(null);
  assert.equal(getPersonalWeatherThreat(0), null);
});

// ── subscribePersonalWeatherThreat ───────────────────────────────────────
// The status chip is refreshed on subscription events, not just its 30s poll.
// Without a notify hook, a Tornado Warning matched between polls could leave
// "ALL CLEAR" on screen for up to 30 seconds — unacceptable for a safety chip.
// setPersonalWeatherThreat is the single live writer, so it must notify.

test('setPersonalWeatherThreat notifies subscribers immediately', () => {
  clearPersonalWeatherThreat();
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  setPersonalWeatherThreat({ severity: 'severe', label: 'Tornado Warning', expiresAt: 10_000 });
  assert.equal(hits, 1, 'a set must fire the subscriber so the chip refreshes now, not on the next poll');
  unsub();
});

test('setPersonalWeatherThreat(null) also notifies (the chip must clear promptly)', () => {
  clearPersonalWeatherThreat();
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  setPersonalWeatherThreat(null);
  assert.equal(hits, 1);
  unsub();
});

test('the returned unsubscribe stops further notifications', () => {
  clearPersonalWeatherThreat();
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  unsub();
  setPersonalWeatherThreat({ severity: 'extreme', label: 'x', expiresAt: 10_000 });
  assert.equal(hits, 0, 'a removed subscriber must not fire');
});

test('a throwing subscriber does not break the notify loop', () => {
  clearPersonalWeatherThreat();
  let good = 0;
  const unsubBoom = subscribePersonalWeatherThreat(() => { throw new Error('listener boom'); });
  const unsubGood = subscribePersonalWeatherThreat(() => { good += 1; });
  assert.doesNotThrow(() =>
    setPersonalWeatherThreat({ severity: 'severe', label: 'x', expiresAt: 10_000 }),
  );
  assert.equal(good, 1, 'a well-behaved subscriber still fires after another one throws');
  unsubBoom();
  unsubGood();
});

// ── selectPersonalWeatherThreat ──────────────────────────────────────────
// Pure selector the data-loader notification path uses to pick the WORST
// personal weather threat (Extreme/Severe alert matched to a saved place,
// i.e. exposure ≥ the Big Event exposure floor) to feed the status chip.

test('selectPersonalWeatherThreat: no candidates → null', () => {
  assert.equal(selectPersonalWeatherThreat([], 70), null);
});

test('selectPersonalWeatherThreat: everything below the exposure floor → null', () => {
  assert.equal(selectPersonalWeatherThreat([candidate({ exposure: 55 })], 70), null);
});

test('selectPersonalWeatherThreat: a matched Severe alert becomes a severe threat', () => {
  const t = selectPersonalWeatherThreat([candidate({ event: 'Tornado Warning', exposure: 88 })], 70, 0);
  assert.equal(t?.severity, 'severe');
  assert.equal(t?.label, 'Tornado Warning');
  assert.equal(t?.expiresAt, 10_000);
});

test('selectPersonalWeatherThreat: Extreme outranks Severe regardless of order', () => {
  const t = selectPersonalWeatherThreat([
    candidate({ severity: 'Severe', event: 'svr' }),
    candidate({ severity: 'Extreme', event: 'xtr' }),
  ], 70, 0);
  assert.equal(t?.severity, 'extreme');
  assert.equal(t?.label, 'xtr');
});

test('selectPersonalWeatherThreat: same severity keeps the later-expiring alert', () => {
  const t = selectPersonalWeatherThreat([
    candidate({ event: 'early', expiresAt: 5_000 }),
    candidate({ event: 'late', expiresAt: 20_000 }),
  ], 70, 0);
  assert.equal(t?.label, 'late');
  assert.equal(t?.expiresAt, 20_000);
});

test('selectPersonalWeatherThreat: non-Extreme/Severe severities are ignored', () => {
  assert.equal(selectPersonalWeatherThreat([candidate({ severity: 'Moderate', exposure: 99 })], 70), null);
});

test('selectPersonalWeatherThreat: exposure exactly at the floor counts', () => {
  const t = selectPersonalWeatherThreat([candidate({ exposure: 70 })], 70, 0);
  assert.equal(t?.severity, 'severe');
});

// P0 (Codex): an already-EXPIRED candidate must be excluded before ranking.
// Otherwise an expired matched Extreme outranks a still-active matched Severe,
// wins selection, then self-clears the instant getPersonalWeatherThreat sees it
// past expiry — silently dropping the genuine Severe warning over the user. The
// selector evaluates expiry as of `now` (default Date.now()), matching the
// getPersonalWeatherThreat self-clear boundary (at/after expiry is not live).
test('selectPersonalWeatherThreat: an expired candidate never shadows an active one', () => {
  const t = selectPersonalWeatherThreat([
    candidate({ severity: 'Extreme', event: 'expired xtr', expiresAt: 5_000 }),
    candidate({ severity: 'Severe', event: 'active svr', expiresAt: 20_000 }),
  ], 70, 10_000);
  assert.equal(t?.severity, 'severe');
  assert.equal(t?.label, 'active svr');
});

test('selectPersonalWeatherThreat: all candidates expired → null (nothing live to publish)', () => {
  assert.equal(selectPersonalWeatherThreat([
    candidate({ severity: 'Extreme', expiresAt: 5_000 }),
    candidate({ severity: 'Severe', expiresAt: 9_999 }),
  ], 70, 10_000), null);
});

test('selectPersonalWeatherThreat: a candidate expiring exactly at now is treated as expired', () => {
  assert.equal(selectPersonalWeatherThreat([candidate({ expiresAt: 10_000 })], 70, 10_000), null);
});

// ── chipExposureFloor ────────────────────────────────────────────────────
// P0 (Codex): the Big Event `exposureFloor` is auto-tunable (default 70, up to
// 90). The chip selector shared that tuned floor, so the moment the tuner
// tightened the detector to 90 a Severe alert whose personal exposure was
// 70-89 stopped lighting the chip — a genuine severe threat over the user
// reading as ALL CLEAR. The chip floor is capped at PERSONAL_CHIP_EXPOSURE_FLOOR
// (70) so raising the detector can never blind the chip, while still following
// the detector DOWN when it is more sensitive (never LESS sensitive than the
// detector — fail-closed in both directions).
test('chipExposureFloor: caps the chip floor at 70 when the tuner raised the detector floor', () => {
  assert.equal(chipExposureFloor(90), 70);
  assert.equal(chipExposureFloor(75), 70);
  assert.equal(chipExposureFloor(PERSONAL_CHIP_EXPOSURE_FLOOR), 70);
});

test('chipExposureFloor: follows the detector DOWN when it is below 70 (stays at least as sensitive)', () => {
  assert.equal(chipExposureFloor(50), 50);
  assert.equal(chipExposureFloor(70), 70);
});

test('a Severe alert at exposure 80 still lights the chip when the tuner raised the detector floor to 90', () => {
  const t = selectPersonalWeatherThreat([candidate({ exposure: 80 })], chipExposureFloor(90), 0);
  assert.equal(t?.severity, 'severe');
});

// ── resolveThreatExpiryMs ────────────────────────────────────────────────
// The weather-alert offline cache JSON round-trips each alert, so a `Date`
// expiry hydrates back as an ISO STRING. The chip-threat builder used
// `expires instanceof Date ? … : NaN`, so on every cache hit the real expiry
// was discarded and replaced with a blanket now+1h — a matched storm could
// linger an arbitrary extra hour, or an already-expired alert could relight
// the chip. Parse Date, ISO string, and epoch-number forms alike; only fall
// back to the bounded window when the value is truly unusable.

test('resolveThreatExpiryMs: a real Date expiry is used as-is', () => {
  const d = new Date('2026-07-27T18:00:00Z');
  assert.equal(resolveThreatExpiryMs(d, 1_000, 60_000), d.getTime());
});

test('resolveThreatExpiryMs: a cache-hydrated ISO string is parsed (not the fallback)', () => {
  const iso = '2026-07-27T18:00:00Z';
  assert.equal(resolveThreatExpiryMs(iso, 1_000, 60_000), Date.parse(iso));
});

test('resolveThreatExpiryMs: an epoch-ms number is used as-is', () => {
  assert.equal(resolveThreatExpiryMs(1_753_640_000_000, 1_000, 60_000), 1_753_640_000_000);
});

test('resolveThreatExpiryMs: an unparseable value falls back to now + window', () => {
  assert.equal(resolveThreatExpiryMs('not a date', 1_000, 60_000), 61_000);
  assert.equal(resolveThreatExpiryMs(undefined, 1_000, 60_000), 61_000);
  assert.equal(resolveThreatExpiryMs(null, 1_000, 60_000), 61_000);
  assert.equal(resolveThreatExpiryMs(new Date('nope'), 1_000, 60_000), 61_000);
});

// ── decideThreatPublication ──────────────────────────────────────────────
// The data-loader derives the chip threat from whatever weather snapshot it
// has this tick — which may be a STALE offline-cache fallback when NWS is
// unreachable. A stale snapshot that predates a new storm yields an empty
// candidate set; naively publishing that would call setPersonalWeatherThreat(
// null) and assert "ALL CLEAR" over a live warning (the reported bug, on the
// offline path). This pure decision gates the publish across THREE inputs —
// the selected threat, whether the feed was a fresh live read, and whether the
// match pipeline ran to completion (no degraded zone lookup / no crashed
// exposure match). It returns one of three actions:
//   publish             — a real match; always wins, even on a stale/degraded feed
//   confirm_clear       — fresh feed + complete matching proved no threat
//   revoke_confirmation — a feed we could NOT trust for a clear: stale/unavailable
//                         OR fresh-but-degraded matching. Any prior confirmed clear
//                         drops to neutral rather than ride a feed we can't read /
//                         assert an all-clear we never actually evaluated.

test('decideThreatPublication: a real match publishes even when the feed is stale/degraded', () => {
  const threat = { severity: 'severe' as const, label: 'Tornado Warning', expiresAt: 10_000 };
  assert.deepEqual(decideThreatPublication(threat, false, false), { action: 'publish', value: threat });
});

test('decideThreatPublication: a real match publishes on a fresh feed', () => {
  const threat = { severity: 'extreme' as const, label: 'PDS Tornado', expiresAt: 1 };
  assert.deepEqual(decideThreatPublication(threat, true, true), { action: 'publish', value: threat });
});

test('decideThreatPublication: a clear IS confirmed on a fresh feed with complete matching (storm passed)', () => {
  assert.deepEqual(decideThreatPublication(null, true, true), { action: 'confirm_clear' });
});

// P0 (Codex): a STALE/unavailable feed must not let a prior confirmed clear
// stand. `isWeatherFeedFresh` returns false the moment the NWS breaker goes
// `unavailable`, so "leave" would keep a green ALL CLEAR chip riding a feed we
// can no longer read (up to the 30-min clear TTL) — a fail-open. A stale feed is
// unevaluable, so it must REVOKE any standing clear to neutral (CHECKING).
test('decideThreatPublication: a stale feed revokes a standing clear (never ride an unreadable feed)', () => {
  assert.deepEqual(decideThreatPublication(null, false, true), { action: 'revoke_confirmation' });
});

test('decideThreatPublication: a stale feed WITH degraded matching also revokes (both unevaluable)', () => {
  assert.deepEqual(decideThreatPublication(null, false, false), { action: 'revoke_confirmation' });
});

// P0: a FRESH feed whose match pipeline was degraded (an unresolved UGC zone or
// a crashed exposure match) yields no candidate — but that "no match" is NOT
// trustworthy: a zone-only severe warning could be hiding behind the failed
// lookup. Confirming a clear here, or leaving a PRIOR confirmed clear standing,
// asserts an all-clear over a feed we could not actually evaluate. The honest
// action is to REVOKE the confirmation so the chip falls back to neutral.
test('decideThreatPublication: a fresh feed with DEGRADED matching revokes the clear (never assert an unevaluated all-clear)', () => {
  assert.deepEqual(decideThreatPublication(null, true, false), { action: 'revoke_confirmation' });
});

// ── isWeatherMatchingComplete: the `matchingComplete` gate the data-loader feeds
// into decideThreatPublication. `matchingComplete: false` is what turns a fresh
// empty feed's confirm_clear into a revoke, so this gate is the honest boundary
// between "proved clear" and "could not fully evaluate — go neutral". Two real
// fail-open cases (both a false ALL CLEAR under a live severe alert) motivate it:
//   • no saved places at all: exposure stays the "unknown" sentinel below the
//     Big-Event floor, so the selector finds no threat and NOTHING flags the tick
//     degraded — yet a severe alert is genuinely on the feed and unplaceable.
//   • a degraded zone lookup while a zone-only severe alert (no usable polygon)
//     is on the feed: that alert could only have matched via the zone fallback
//     that just failed, so its "no match" is not trustworthy.
// It must NOT over-block: an all-clear feed (no severe alerts) proves clear even
// with no places or a degraded zone lookup — nothing severe anywhere to miss.
function mc(o: Partial<Parameters<typeof isWeatherMatchingComplete>[0]> = {}) {
  return {
    severeAlertCount: 0,
    savedPlaceCount: 1,
    zonesDegraded: false,
    zoneOnlySevereAlertCount: 0,
    matchDegraded: false,
    placesChangedDuringEval: false,
    ...o,
  };
}

test('isWeatherMatchingComplete: a clean fully-evaluated tick is complete', () => {
  assert.equal(isWeatherMatchingComplete(mc()), true);
});

test('isWeatherMatchingComplete: a crashed/unevaluable exposure match is incomplete', () => {
  assert.equal(isWeatherMatchingComplete(mc({ matchDegraded: true })), false);
});

test('isWeatherMatchingComplete: places changed mid-evaluation is incomplete', () => {
  assert.equal(isWeatherMatchingComplete(mc({ placesChangedDuringEval: true })), false);
});

// finding 2: a severe alert with NO saved places is unplaceable — the exposure
// sentinel keeps the selector silent, so the tick reads clean; withhold the clear.
test('isWeatherMatchingComplete: a severe alert with zero saved places is incomplete (unplaceable)', () => {
  assert.equal(isWeatherMatchingComplete(mc({ severeAlertCount: 1, savedPlaceCount: 0 })), false);
});

test('isWeatherMatchingComplete: no severe alerts and no saved places still proves clear', () => {
  assert.equal(isWeatherMatchingComplete(mc({ severeAlertCount: 0, savedPlaceCount: 0 })), true);
});

test('isWeatherMatchingComplete: a severe alert WITH a saved place (clean) is complete', () => {
  assert.equal(isWeatherMatchingComplete(mc({ severeAlertCount: 1, savedPlaceCount: 2 })), true);
});

// finding 3: a degraded zone lookup only endangers alerts that can ONLY match via
// the zone fallback (no usable polygon). Block for those, but do NOT freeze the
// chip when the degraded lookup coexists with an otherwise-clear feed.
test('isWeatherMatchingComplete: zonesDegraded with a zone-only severe alert is incomplete', () => {
  assert.equal(isWeatherMatchingComplete(mc({ zonesDegraded: true, zoneOnlySevereAlertCount: 1 })), false);
});

test('isWeatherMatchingComplete: zonesDegraded with NO zone-only severe alert still proves clear', () => {
  assert.equal(isWeatherMatchingComplete(mc({ zonesDegraded: true, zoneOnlySevereAlertCount: 0 })), true);
});

test('isWeatherMatchingComplete: a polygon-covered severe alert is unaffected by a degraded zone lookup', () => {
  // severe alert present, but it has a usable polygon (zoneOnlySevereAlertCount 0),
  // so the zone-lookup failure cannot have hidden it.
  assert.equal(
    isWeatherMatchingComplete(mc({ severeAlertCount: 1, savedPlaceCount: 1, zonesDegraded: true, zoneOnlySevereAlertCount: 0 })),
    true,
  );
});

// ── clear / expiry must notify (P2) ──────────────────────────────────────
// setPersonalWeatherThreat notifies, but the OTHER two state transitions —
// an explicit clearPersonalWeatherThreat() and the read-time expiry self-heal —
// mutated `current` without firing subscribers. A subscribed status chip would
// then keep a passed storm on screen until its next 30s poll happened to read.

test('clearPersonalWeatherThreat notifies subscribers so the chip clears now', () => {
  setPersonalWeatherThreat({ severity: 'extreme', label: 'x', expiresAt: Number.MAX_SAFE_INTEGER });
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  clearPersonalWeatherThreat();
  assert.equal(hits, 1, 'an explicit clear must fire subscribers, not wait for the next poll');
  unsub();
});

test('clearPersonalWeatherThreat does NOT notify when already clear (no churn)', () => {
  clearPersonalWeatherThreat();
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  clearPersonalWeatherThreat();
  assert.equal(hits, 0, 'a redundant clear must not fire subscribers');
  unsub();
});

test('an expired threat notifies subscribers when it self-clears on read', () => {
  clearPersonalWeatherThreat();
  setPersonalWeatherThreat({ severity: 'severe', label: 'x', expiresAt: 10_000 });
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  assert.equal(getPersonalWeatherThreat(10_000), null, 'at/after expiry the read reports null');
  assert.equal(hits, 1, 'expiry self-clear must notify so the chip drops the stale storm');
  // A second read after the clear must not re-notify (state already null).
  assert.equal(getPersonalWeatherThreat(11_000), null);
  assert.equal(hits, 1, 'no repeat notify once already cleared');
  unsub();
});

// ── confirmed-clear tri-state (P0 #2/#5) ─────────────────────────────────
// `getPersonalWeatherThreat() === null` is AMBIGUOUS: it means both "no storm
// (proven clear by a fresh feed)" AND "we have not evaluated weather yet".
// The status chip painted BOTH as a green "ALL CLEAR", so at boot — before the
// first weather read — the chip asserted safety it had not verified. This
// tri-state separates the two: a clear is only "confirmed" once a fresh feed
// actually proved no matched threat. Until then the chip must stay neutral.

test('a fresh threat means the clear is NOT confirmed', () => {
  // A non-null set forces the un-confirmed state regardless of prior test order.
  setPersonalWeatherThreat({ severity: 'severe', label: 'x', expiresAt: Number.MAX_SAFE_INTEGER });
  assert.equal(isPersonalWeatherClearConfirmed(0), false, 'an active threat is never a confirmed clear');
});

test('confirmPersonalWeatherClear drops any active threat and confirms the clear', () => {
  setPersonalWeatherThreat({ severity: 'extreme', label: 'x', expiresAt: Number.MAX_SAFE_INTEGER });
  confirmPersonalWeatherClear(5_000);
  assert.equal(getPersonalWeatherThreat(6_000), null, 'a confirmed clear drops the active threat');
  assert.equal(isPersonalWeatherClearConfirmed(6_000), true, 'and marks the clear as proven');
});

test('confirmPersonalWeatherClear notifies subscribers so the chip repaints now', () => {
  setPersonalWeatherThreat({ severity: 'severe', label: 'x', expiresAt: Number.MAX_SAFE_INTEGER });
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  confirmPersonalWeatherClear(1_000);
  assert.equal(hits, 1, 'proving a clear must fire subscribers so the chip leaves CHECKING');
  unsub();
});

test('a new matched threat un-confirms a prior confirmed clear', () => {
  confirmPersonalWeatherClear(1_000);
  assert.equal(isPersonalWeatherClearConfirmed(2_000), true);
  setPersonalWeatherThreat({ severity: 'severe', label: 'storm', expiresAt: Number.MAX_SAFE_INTEGER });
  assert.equal(isPersonalWeatherClearConfirmed(2_000), false, 'a new storm resets confirmed-clear to unknown');
});

test('a self-expired threat is NOT a confirmed clear (expiry ≠ proof)', () => {
  setPersonalWeatherThreat({ severity: 'severe', label: 'x', expiresAt: 10_000 });
  // The threat lapses on its own timer; no fresh feed re-proved the area clear.
  assert.equal(isPersonalWeatherClearConfirmed(10_000), false, 'a lapsed threat leaves the clear unconfirmed');
  assert.equal(getPersonalWeatherThreat(10_000), null, 'the lapsed threat is gone from state');
});

// ── confirmed-clear self-expiry (P0: unbounded stale proof) ──────────────
// The status chip trusts `isPersonalWeatherClearConfirmed()` as its ONLY
// freshness signal (it no longer re-reads the shared NWS breaker timestamp,
// which any unrelated re-fetch — e.g. the Air & Smoke panel — can advance
// without the matcher ever re-running). So the confirmed-clear must carry its
// OWN staleness bound: once the loader has not re-proved clear for the feed
// TTL, the proof lapses and the chip falls back to neutral instead of asserting
// an all-clear the loader can no longer vouch for (the app slept, the weather
// task stalled, NWS went unreachable). The TTL equals the weather-feed TTL.

test('a confirmed clear self-expires after the clear TTL (proof goes stale → neutral)', () => {
  confirmPersonalWeatherClear(1_000);
  assert.equal(isPersonalWeatherClearConfirmed(1_000 + PERSONAL_WEATHER_CLEAR_TTL_MS - 1), true,
    'still within the TTL: the clear is still proven');
  assert.equal(isPersonalWeatherClearConfirmed(1_000 + PERSONAL_WEATHER_CLEAR_TTL_MS), false,
    'at/after the TTL the proof lapses and the chip must stop asserting all-clear');
});

test('a fresh confirm re-proves the clear and restarts the TTL', () => {
  confirmPersonalWeatherClear(1_000);
  assert.equal(isPersonalWeatherClearConfirmed(1_000 + PERSONAL_WEATHER_CLEAR_TTL_MS), false, 'lapsed');
  confirmPersonalWeatherClear(1_000 + PERSONAL_WEATHER_CLEAR_TTL_MS);
  assert.equal(isPersonalWeatherClearConfirmed(1_000 + PERSONAL_WEATHER_CLEAR_TTL_MS + 1), true,
    'a fresh clear proof restarts the TTL window');
});

// ── confirmed-clear fails closed on a BACKWARD clock jump (negative age) ──────
// The self-expiry compares `now - clearConfirmedAt` against the TTL. If the
// clear was stamped at a FUTURE-skewed instant and the system clock is then
// corrected BACKWARD (NTP step, manual set) while the weather task is stalled,
// the age goes NEGATIVE — below the TTL — so a naive `>= TTL` check keeps the
// clear "proven" indefinitely: a false ALL CLEAR that never lapses. A proof
// stamped in the future cannot be trusted; the chip must fail closed to neutral.
test('a confirmed clear stamped in the future fails closed once the clock rolls back', () => {
  confirmPersonalWeatherClear(1_000_000);
  assert.equal(
    isPersonalWeatherClearConfirmed(400_000),
    false,
    'now < clearConfirmedAt (clock rolled back): an untrustworthy future-stamped proof lapses to neutral',
  );
});

test('a future-stamped clear is discarded, not merely hidden, and only a fresh confirm re-proves it', () => {
  confirmPersonalWeatherClear(1_000_000);
  assert.equal(isPersonalWeatherClearConfirmed(400_000), false);
  // The future stamp was nulled, so a later read at the corrected real time
  // still sees no proof rather than the stale future stamp resurfacing.
  assert.equal(isPersonalWeatherClearConfirmed(401_000), false, 'still neutral until re-proved');
  confirmPersonalWeatherClear(402_000);
  assert.equal(isPersonalWeatherClearConfirmed(402_000), true, 'a fresh confirm at real time re-proves clear');
});

// ── revokePersonalWeatherClearConfirmation (P0: degraded tick must un-prove) ──
// When the loader gets a fresh feed it could NOT fully evaluate (a degraded zone
// lookup or a crashed exposure match), a prior confirmed clear is no longer
// trustworthy — a zone-only warning could be hiding behind the failure. Revoke
// drops the confirmation to neutral WITHOUT fabricating a threat, and without
// disturbing an active threat (there is never one to disturb: a confirmed clear
// and an active threat are mutually exclusive).

test('revokePersonalWeatherClearConfirmation drops a prior confirmed clear to neutral', () => {
  confirmPersonalWeatherClear(1_000);
  assert.equal(isPersonalWeatherClearConfirmed(2_000), true);
  revokePersonalWeatherClearConfirmation();
  assert.equal(isPersonalWeatherClearConfirmed(2_000), false, 'a revoked clear is no longer proven');
});

test('revokePersonalWeatherClearConfirmation notifies only when it actually changed', () => {
  confirmPersonalWeatherClear(1_000);
  let hits = 0;
  const unsub = subscribePersonalWeatherThreat(() => { hits += 1; });
  revokePersonalWeatherClearConfirmation();
  assert.equal(hits, 1, 'un-proving a standing clear must repaint the chip now');
  revokePersonalWeatherClearConfirmation();
  assert.equal(hits, 1, 'a redundant revoke (already unproven) must not churn the chip');
  unsub();
});

test('revokePersonalWeatherClearConfirmation leaves an active threat untouched', () => {
  // A confirmed clear and an active threat are mutually exclusive; setting a
  // threat already nulls the confirmation, so revoke must be a no-op that never
  // clobbers the live threat.
  setPersonalWeatherThreat({ severity: 'extreme', label: 'Tornado Warning', expiresAt: Number.MAX_SAFE_INTEGER });
  revokePersonalWeatherClearConfirmation();
  assert.equal(getPersonalWeatherThreat(0)?.label, 'Tornado Warning', 'the live threat survives a revoke');
  assert.equal(isPersonalWeatherClearConfirmed(0), false);
});
