/**
 * Fail-closed guard for the space-weather poller in intel-channels-bridge.
 *
 * The poller is wrapped by tracked(), which records ok:true when the function
 * resolves and ok:false when it throws — that record is what the Source Health
 * overlay shows. The poller used to swallow its own errors in a local
 * try/catch, so it resolved on every tick no matter what SWPC did and the feed
 * read as healthy while the panel was empty.
 *
 * fetchSpaceWeather() closes the other half of that hole: it RESOLVES with an
 * all-null object rather than throwing, so "we got an object back" is not
 * evidence of a working feed either.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { pollSpaceWeather } from '@/services/intel-channels-bridge';

// fetchSpaceWeather caches a usable result for up to five minutes. Advancing a
// stubbed clock past that before each poll keeps one test's payload from being
// silently served to the next, which would make a later assertion pass for the
// wrong reason.
const REAL_NOW = Date.now.bind(Date);
let clockOffsetMs = 0;
Date.now = () => REAL_NOW() + clockOffsetMs;

/** Drives the poller through the real fetch path with a stubbed response. */
async function pollWith(body: unknown): Promise<Error | null> {
  clockOffsetMs += 6 * 60_000;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response)) as typeof globalThis.fetch;
  try {
    await pollSpaceWeather();
    return null;
  } catch (error) {
    return error as Error;
  } finally {
    globalThis.fetch = original;
  }
}

/** Alert stamps are windowed against the real clock, so they must be relative. */
const issuedAt = new Date(Date.now() - 30 * 60_000).toISOString().replace('T', ' ').replace('Z', '');

test('a four-way SWPC outage surfaces as a failure, not a quiet sky', async () => {
  // Every product null: nothing to report, which renders identically to a
  // genuinely calm sun. tracked() must see a throw so this reaches Source Health.
  const error = await pollWith({ kp: null, wind: null, xray: null, alerts: null });
  assert.ok(error, 'the poller must not resolve when nothing parsed');
  assert.match(error.message, /no usable space-weather data/);
});

test('an HTTP 200 carrying empty products is also a failure', async () => {
  // SWPC never returns four simultaneously empty products. Resolving here would
  // record ok:true off a body that told us nothing.
  const error = await pollWith({ kp: [], wind: [], xray: [], alerts: [] });
  assert.ok(error, 'well-shaped emptiness is still not an observation');
});

test('a wrong-shape body is a failure rather than an empty success', async () => {
  // The envelope IS an object keyed by product, so an error payload behind a
  // 200 reaches the parsers looking superficially plausible.
  const error = await pollWith({ error: 'maintenance' });
  assert.ok(error, 'an error envelope must not read as a working feed');
});

test('a live quiet sky resolves — silence with data is not a failure', async () => {
  // The complement, and why the check is narrow: Kp 2, no flare, no bulletins is
  // the normal state most of the time. Throwing here would report a permanent
  // outage on a perfectly healthy feed.
  const error = await pollWith({
    kp: [{ time_tag: '2026-07-30T21:00:00', Kp: 2 }],
    wind: [['time_tag', 'speed', 'density', 'bz'], ['2026-07-30 20:55:00.000', '380', '4.0', '1.2']],
    xray: [{ current_class: 'A9.1' }],
    alerts: [],
  });
  assert.equal(error, null, 'a quiet sky with real readings is a healthy fetch');
});

test('bulletins alone are enough to count as a working feed', async () => {
  // Kp and X-ray can both legitimately fail to parse while alerts.json is fine.
  // Any one product yielding data means SWPC answered.
  //
  // The bulletin is an all-clear on purpose. Summaries are filtered out of the
  // unified-alert list, so this poll emits NOTHING — proving the health verdict
  // keys on what SWPC returned rather than on whether an alert was raised.
  // (It also keeps the DOM-bound notification dispatcher out of a Node test.)
  const error = await pollWith({
    kp: null,
    wind: null,
    xray: null,
    alerts: [{
      product_id: 'ALTK07',
      issue_datetime: issuedAt,
      message: 'Space Weather Message Code: ALTK07\r\n\r\nCANCEL WARNING: Geomagnetic K-index of 7\r\n',
    }],
  });
  assert.equal(error, null);
});
