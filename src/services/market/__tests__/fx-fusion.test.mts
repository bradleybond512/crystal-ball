import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchErApiRates, fetchFrankfurterRates, fxRatesToObservations } from '../fx-fusion-fetch.ts';
import { ingestDomain } from '../../providers/fusion-ingest.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../../providers/provider-health.ts';
import type { ProviderHealthState } from '../../providers/provider-health.ts';

interface StubCall { url: string }

function stubFetch(t: { after: (fn: () => void) => void }, payload: unknown, status = 200): StubCall {
  const call: StubCall = { url: '' };
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    call.url = String(input);
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return call;
}

// 2026-07-29T00:00:00Z — the ECB fixing instant Frankfurter's date-only
// `date` field resolves to.
const FIXING_MS = Date.parse('2026-07-29');

function healthyBoth(now: number): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['frankfurter-fx', 'er-api-fx']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: now });
  }
  return s;
}

// ── Pure adapter ────────────────────────────────────────────────────────────

test('fxRatesToObservations maps each currency to a key-matched observation', () => {
  const obs = fxRatesToObservations('frankfurter-fx', { EUR: 0.87873, JPY: 155.94 }, FIXING_MS);
  assert.equal(obs.length, 2);
  assert.deepEqual(obs[0], { providerId: 'frankfurter-fx', key: 'EUR', value: 0.87873, lat: 0, lon: 0, occurredAt: FIXING_MS });
  assert.deepEqual(obs[1], { providerId: 'frankfurter-fx', key: 'JPY', value: 155.94, lat: 0, lon: 0, occurredAt: FIXING_MS });
});

test('fxRatesToObservations drops rows with a missing currency code', () => {
  const obs = fxRatesToObservations('er-api-fx', { '': 0.87, EUR: 0.88 }, FIXING_MS);
  assert.deepEqual(obs.map((o) => o.key), ['EUR']);
});

test("''-keyed rows from both providers would fuse into one bogus corroborated fact", () => {
  // Why the empty-code guard exists: '' is a perfectly good cluster key, so
  // two junk rows agree with each other and the domain reports a 2-vote fact
  // for a currency that does not exist. Feeding the raw rows past the adapter
  // proves the failure mode the guard prevents.
  const junk = ingestDomain('fx_rates', [
    { providerId: 'frankfurter-fx', key: '', value: 0.87, lat: 0, lon: 0, occurredAt: FIXING_MS },
    { providerId: 'er-api-fx', key: '', value: 0.87, lat: 0, lon: 0, occurredAt: FIXING_MS },
  ], healthyBoth(FIXING_MS), FIXING_MS);
  assert.equal(junk.facts.length, 1);
  assert.equal(junk.facts[0]!.providerIds.length, 2, 'two junk rows corroborate each other — exactly what the guard stops');

  const guarded = ingestDomain('fx_rates', [
    ...fxRatesToObservations('frankfurter-fx', { '': 0.87 }, FIXING_MS),
    ...fxRatesToObservations('er-api-fx', { '': 0.87 }, FIXING_MS),
  ], healthyBoth(FIXING_MS), FIXING_MS);
  assert.equal(guarded.facts.length, 0, 'the adapter drops them before they can fuse');
});

test('fxRatesToObservations drops non-finite and non-positive rates', () => {
  const obs = fxRatesToObservations('er-api-fx', {
    EUR: Number.NaN,
    GBP: Number.POSITIVE_INFINITY,
    JPY: 0,
    CHF: -1,
    CAD: 1.37,
  }, FIXING_MS);
  assert.deepEqual(obs.map((o) => o.key), ['CAD']);
});

test('fxRatesToObservations emits nothing for a non-finite or non-positive observedAt', () => {
  // A NaN occurredAt defeats clustering's `Math.abs(delta) > max` guard
  // (NaN > n is false), so a stale quote of the same currency would
  // corroborate no matter how old — the 5-day window stops applying.
  assert.deepEqual(fxRatesToObservations('er-api-fx', { EUR: 0.88 }, Number.NaN), []);
  assert.deepEqual(fxRatesToObservations('er-api-fx', { EUR: 0.88 }, 0), []);
});

test('fxRatesToObservations returns nothing when every row is filtered out', () => {
  assert.deepEqual(fxRatesToObservations('er-api-fx', { EUR: 0, GBP: Number.NaN, JPY: -3 }, FIXING_MS), []);
});

// ── Frankfurter fetch ───────────────────────────────────────────────────────

test('fetchFrankfurterRates requests USD base with the fusable symbol set', async (t) => {
  const call = stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: 0.87873 } });
  await fetchFrankfurterRates();
  // getApiBaseUrl() is origin-relative in bare Node — resolve against a dummy base.
  const url = new URL(call.url, 'http://sidecar.test');
  assert.equal(url.pathname, '/api/fx-rates');
  assert.equal(url.searchParams.get('base'), 'USD');
  assert.equal(url.searchParams.get('symbols'), 'EUR,GBP,JPY,CHF,CAD,AUD,CNY');
});

test('fetchFrankfurterRates stamps the ECB fixing date, not the fetch time', async (t) => {
  stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: 0.87873 } });
  const r = await fetchFrankfurterRates();
  assert.equal(r.ok, true);
  assert.equal(r.observedAt, FIXING_MS, 'date-only ISO resolves to UTC midnight — the honest fixing instant');
  assert.deepEqual(r.rates, { EUR: 0.87873 });
});

test('fetchFrankfurterRates keeps only the fusable currencies', async (t) => {
  stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: 0.87, SEK: 9.5, EUROPE: 1 } });
  const r = await fetchFrankfurterRates();
  assert.deepEqual(Object.keys(r.rates), ['EUR'], 'codes outside the verified intersection would fuse as permanent singletons');
});

test('fetchFrankfurterRates fails closed on non-2xx, degraded, missing date, and zero rows', async (t) => {
  const empty = { ok: false, rates: {}, observedAt: 0 };

  stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: 0.87 } }, 502);
  assert.deepEqual(await fetchFrankfurterRates(), empty, 'non-2xx');

  // Otherwise fully valid — `degraded` must be the sole reason this fails, or
  // the assertion passes for a reason that has nothing to do with the flag.
  stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: 0.87 }, degraded: true });
  assert.deepEqual(await fetchFrankfurterRates(), empty, 'degraded flag');

  stubFetch(t, { base: 'USD', rates: { EUR: 0.87 } });
  assert.deepEqual(await fetchFrankfurterRates(), empty, 'missing date');

  stubFetch(t, { base: 'USD', date: 'not-a-date', rates: { EUR: 0.87 } });
  assert.deepEqual(await fetchFrankfurterRates(), empty, 'unparseable date');

  stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: Number.NaN } });
  assert.deepEqual(await fetchFrankfurterRates(), empty, 'no valid row is a failure, not a healthy-but-empty success');

  // A negative rate must fail the whole fetch, not pass the freshness gate and
  // then get dropped by the adapter — that would record ok:true with zero
  // observations, a provider reading healthy while contributing nothing.
  stubFetch(t, { base: 'USD', date: '2026-07-29', rates: { EUR: -1 } });
  assert.deepEqual(await fetchFrankfurterRates(), empty, 'non-positive rate');
});

// ── open.er-api fetch ───────────────────────────────────────────────────────

test('fetchErApiRates converts time_last_update_unix from epoch seconds to ms', async (t) => {
  const call = stubFetch(t, { rates: { EUR: 0.875576 }, time_last_update_unix: 1_785_369_751 });
  const r = await fetchErApiRates();
  assert.equal(new URL(call.url, 'http://sidecar.test').pathname, '/api/fx-rates-erapi');
  assert.equal(r.ok, true);
  assert.equal(r.observedAt, 1_785_369_751_000);
});

test('fetchErApiRates keeps only the fusable currencies, not the full 166', async (t) => {
  stubFetch(t, {
    rates: { EUR: 0.875, GBP: 0.744, KRW: 1390, INR: 88.2, XCD: 2.7 },
    time_last_update_unix: 1_785_369_751,
  });
  const r = await fetchErApiRates();
  assert.deepEqual(Object.keys(r.rates).sort(), ['EUR', 'GBP']);
});

test('fetchErApiRates fails closed on non-2xx, degraded, bad timestamp, and zero rows', async (t) => {
  const empty = { ok: false, rates: {}, observedAt: 0 };

  stubFetch(t, { rates: { EUR: 0.875 }, time_last_update_unix: 1_785_369_751 }, 502);
  assert.deepEqual(await fetchErApiRates(), empty, 'non-2xx');

  // Otherwise fully valid — `degraded` must be the sole reason this fails.
  stubFetch(t, { rates: { EUR: 0.875 }, time_last_update_unix: 1_785_369_751, degraded: true });
  assert.deepEqual(await fetchErApiRates(), empty, 'degraded flag');

  stubFetch(t, { rates: { EUR: 0.875 } });
  assert.deepEqual(await fetchErApiRates(), empty, 'missing timestamp');

  stubFetch(t, { rates: { EUR: 0.875 }, time_last_update_unix: 0 });
  assert.deepEqual(await fetchErApiRates(), empty, 'non-positive timestamp');

  stubFetch(t, { rates: { ZZZ: 1 }, time_last_update_unix: 1_785_369_751 });
  assert.deepEqual(await fetchErApiRates(), empty, 'no fusable row is a failure, not a healthy-but-empty success');

  stubFetch(t, { rates: { EUR: -1 }, time_last_update_unix: 1_785_369_751 });
  assert.deepEqual(await fetchErApiRates(), empty, 'non-positive rate — never ok:true with zero observations');
});

// ── Fusion ──────────────────────────────────────────────────────────────────

test('EUR quoted 0.9200 and 0.9210 fuses into one fact with two votes and no disagreement', () => {
  const r = ingestDomain('fx_rates', [
    ...fxRatesToObservations('frankfurter-fx', { EUR: 0.9200 }, FIXING_MS),
    ...fxRatesToObservations('er-api-fx', { EUR: 0.9210 }, FIXING_MS),
  ], healthyBoth(FIXING_MS), FIXING_MS);

  assert.equal(r.facts.length, 1, 'same currency collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.key, 'EUR');
  assert.equal(f.providerIds.length, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  // Pin to a concrete value first: `undefined === undefined` would pass this
  // vacuously if the fact never formed.
  assert.equal(typeof r.providerFingerprints['frankfurter-fx'], 'string');
  assert.equal(r.providerFingerprints['frankfurter-fx'], r.providerFingerprints['er-api-fx']);
});

test('EUR quoted 0.92 and 0.98 surfaces a disagreement naming both providers', () => {
  const r = ingestDomain('fx_rates', [
    ...fxRatesToObservations('frankfurter-fx', { EUR: 0.92 }, FIXING_MS),
    ...fxRatesToObservations('er-api-fx', { EUR: 0.98 }, FIXING_MS),
  ], healthyBoth(FIXING_MS), FIXING_MS);

  const f = r.facts[0]!;
  assert.ok(f.fusion.disagreements.length >= 1, 'disagreement surfaces');
  assert.ok(f.fusion.confidenceMultiplier <= 0.6, 'capped at the disagreement ceiling');
  assert.ok('frankfurter-fx' in f.fingerprints, 'fingerprint map names frankfurter-fx');
  assert.ok('er-api-fx' in f.fingerprints, 'fingerprint map names er-api-fx');
  assert.notEqual(f.fingerprints['frankfurter-fx'], f.fingerprints['er-api-fx']);
  assert.notEqual(r.providerFingerprints['frankfurter-fx'], r.providerFingerprints['er-api-fx']);
});

test('the observed steady-state gap between the two sources is not a disagreement', () => {
  // Live side-by-side probe, same minute (2026-07-30): EUR 0.87873 (ECB
  // fixing) vs 0.875576 (aggregator) = 0.36% apart; GBP 0.24%; JPY 0.09%.
  // A tolerance that flags these would be a permanent false positive.
  const r = ingestDomain('fx_rates', [
    ...fxRatesToObservations('frankfurter-fx', { EUR: 0.87873, GBP: 0.74586, JPY: 155.9364 }, FIXING_MS),
    ...fxRatesToObservations('er-api-fx', { EUR: 0.875576, GBP: 0.744054, JPY: 156.0764 }, FIXING_MS),
  ], healthyBoth(FIXING_MS), FIXING_MS);

  assert.equal(r.facts.length, 3, 'one fact per currency');
  for (const f of r.facts) {
    assert.equal(f.providerIds.length, 2, `${f.key} must corroborate`);
    assert.equal(f.fusion.disagreements.length, 0, `${f.key} steady-state gap must not read as disagreement`);
  }
});

test('a weekend-stale ECB fixing still corroborates against a same-day aggregator quote', () => {
  // The ECB does not publish on weekends: a Monday-morning query returns
  // Friday's fixing, ~72h behind er-api's continuously updated timestamp.
  // If the match window were tighter the pair would silently read as two
  // single-source SPOFs for ~2 days in 7.
  const monday = FIXING_MS + 3 * 24 * 60 * 60_000;
  const r = ingestDomain('fx_rates', [
    ...fxRatesToObservations('frankfurter-fx', { EUR: 0.87873 }, FIXING_MS),
    ...fxRatesToObservations('er-api-fx', { EUR: 0.875576 }, monday),
  ], healthyBoth(monday), monday);

  assert.equal(r.facts.length, 1, '72h-apart quotes of the same currency are still the same fact');
  assert.equal(r.facts[0]!.providerIds.length, 2);
  assert.equal(r.facts[0]!.fusion.disagreements.length, 0);
});
