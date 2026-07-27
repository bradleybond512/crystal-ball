import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setPersonalWeatherThreat,
  getPersonalWeatherThreat,
  clearPersonalWeatherThreat,
  selectPersonalWeatherThreat,
  subscribePersonalWeatherThreat,
  resolveThreatExpiryMs,
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
  const t = selectPersonalWeatherThreat([candidate({ event: 'Tornado Warning', exposure: 88 })], 70);
  assert.equal(t?.severity, 'severe');
  assert.equal(t?.label, 'Tornado Warning');
  assert.equal(t?.expiresAt, 10_000);
});

test('selectPersonalWeatherThreat: Extreme outranks Severe regardless of order', () => {
  const t = selectPersonalWeatherThreat([
    candidate({ severity: 'Severe', event: 'svr' }),
    candidate({ severity: 'Extreme', event: 'xtr' }),
  ], 70);
  assert.equal(t?.severity, 'extreme');
  assert.equal(t?.label, 'xtr');
});

test('selectPersonalWeatherThreat: same severity keeps the later-expiring alert', () => {
  const t = selectPersonalWeatherThreat([
    candidate({ event: 'early', expiresAt: 5_000 }),
    candidate({ event: 'late', expiresAt: 20_000 }),
  ], 70);
  assert.equal(t?.label, 'late');
  assert.equal(t?.expiresAt, 20_000);
});

test('selectPersonalWeatherThreat: non-Extreme/Severe severities are ignored', () => {
  assert.equal(selectPersonalWeatherThreat([candidate({ severity: 'Moderate', exposure: 99 })], 70), null);
});

test('selectPersonalWeatherThreat: exposure exactly at the floor counts', () => {
  const t = selectPersonalWeatherThreat([candidate({ exposure: 70 })], 70);
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
