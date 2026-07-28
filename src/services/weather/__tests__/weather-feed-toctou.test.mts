import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchWeatherAlerts,
  fetchWeatherAlertsWithFeedState,
  isWeatherFeedFresh,
} from '../../weather.ts';

// ── P0 (Codex R4): the clear decision must read currency bound to ITS OWN fetch ─
// The data-loader awaited its own fetchWeatherAlerts(), then read feed currency
// from the shared circuit breaker via getWeatherAlertsFeedState() — a read in a
// LATER microtask than the one that produced its alerts. A concurrent consumer
// (AirSmokePanel.ts calls fetchWeatherAlerts() directly, bypassing the offline
// coalescer) could resolve in between and flip the breaker's single-slot
// lastDataState to `live`. The loader would then certify ALL CLEAR off its OWN
// empty/failed alert array using the unrelated consumer's fresh timestamp.
//
// fetchWeatherAlertsWithFeedState returns { alerts, feedState } captured
// atomically inside the breaker (executeTracked), so the loader never consults
// the mutable global for the decision. A failed loader fetch carries its own
// `unavailable` currency even while a concurrent success flips the global.

const realFetch = globalThis.fetch;

function response(init: { ok: boolean; status: number; json: () => Promise<unknown> }): Response {
  return init as unknown as Response;
}

test('a failed loader fetch keeps its own unavailable currency despite a concurrent success', async () => {
  // fetch #1 (the loader's own) rejects; fetch #2 (a concurrent consumer's)
  // resolves one microtask later and flips the shared breaker to `live`.
  let n = 0;
  globalThis.fetch = (async () => {
    n += 1;
    if (n === 1) throw new Error('HTTP 503');            // loader's fetch fails
    await Promise.resolve();                              // concurrent success lands later
    return response({ ok: true, status: 200, json: async () => ({ features: [] }) });
  }) as unknown as typeof globalThis.fetch;
  try {
    const loader = fetchWeatherAlertsWithFeedState();     // call #1 (the loader)
    const consumer = fetchWeatherAlerts();                // call #2 (flips the global)
    const [{ alerts, feedState }] = await Promise.all([loader, consumer]);

    assert.deepEqual(alerts, [], 'the loader saw its own empty/failed alert array');
    assert.equal(
      feedState.mode, 'unavailable',
      'currency is bound to the failed fetch, not the concurrent success',
    );
    assert.equal(
      isWeatherFeedFresh(feedState), false,
      'a failed feed must read not-fresh — the clear is withheld, not certified',
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a valid empty feed returns fresh currency that still proves clear (no fail-stuck)', async () => {
  // The competing failure mode: over-correcting into fail-stuck. A genuinely
  // fresh, valid, empty feed must still read fresh so the chip can return to
  // clear. (`mode` may be `live` on a cold breaker or `cached` when a prior
  // fetch this run seeded the cache — both are current; `isWeatherFeedFresh` is
  // the invariant, not the mode.)
  globalThis.fetch = (async () => response({
    ok: true,
    status: 200,
    json: async () => ({ features: [] }),
  })) as unknown as typeof globalThis.fetch;
  try {
    const { alerts, feedState } = await fetchWeatherAlertsWithFeedState();
    assert.deepEqual(alerts, [], 'a valid empty feed yields an empty array');
    assert.ok(Number.isFinite(feedState.timestamp), 'a fresh feed carries a finite data timestamp');
    assert.equal(
      isWeatherFeedFresh(feedState), true,
      'a genuinely fresh empty feed can still prove clear (no fail-stuck)',
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
