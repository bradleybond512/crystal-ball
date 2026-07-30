import assert from 'node:assert/strict';
import test from 'node:test';

import { ingestDomain } from '../../providers/fusion-ingest.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../../providers/provider-health.ts';
import type { ProviderHealthState } from '../../providers/provider-types.ts';
import { fetchGfzKp, fetchSwpcKp } from '../gfz-kp-fetch.ts';
import { KP_BIN_MS, kpToObservations } from '../kp-fusion-observations.ts';

const NOW = Date.parse('2026-07-30T15:21:00Z');
const BIN_12Z = Date.parse('2026-07-30T12:00:00Z');

function healthyBoth(now: number): ProviderHealthState {
  let state = emptyProviderHealthState();
  for (const id of ['swpc-kp', 'gfz-kp']) {
    state = recordFetchOutcome(state, id, { at: now, ok: true, latencyMs: 120, itemCount: 16 });
  }
  return state;
}

test('a Kp sample keys on its 3-hour bin start, not its raw timestamp', () => {
  const obs = kpToObservations('swpc-kp', [{ observedAt: BIN_12Z, kp: 1.67 }]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.key, '2026-07-30T12:00:00.000Z');
  assert.equal(obs[0]!.value, 1.67);
  // occurredAt stays the real observation instant so the clustering time
  // window still measures actual staleness between the two sources.
  assert.equal(obs[0]!.occurredAt, BIN_12Z);
  assert.equal(obs[0]!.lat, 0);
  assert.equal(obs[0]!.lon, 0);
});

test('a mid-bin timestamp floors into the bin it belongs to', () => {
  const [obs] = kpToObservations('gfz-kp', [{ observedAt: BIN_12Z + 97 * 60_000, kp: 2 }]);
  assert.equal(obs!.key, '2026-07-30T12:00:00.000Z');
  assert.equal(KP_BIN_MS, 3 * 60 * 60 * 1000);
});

test('a suffix-less NOAA tag and a Z-suffixed GFZ tag land in the SAME bin', () => {
  // SWPC's products/noaa-planetary-k-index.json stamps "2026-07-30T00:00:00"
  // with no zone; GFZ stamps "2026-07-30T00:00:00Z". If the naïve tag were
  // parsed host-locally the two would key different bins on any non-UTC
  // machine and the domain would show two permanent 1-vote facts instead of
  // one corroborated 2-vote fact — the sidecar normalizer stamps the Z so
  // both sides arrive here as the same instant.
  const noaaMs = Date.parse('2026-07-30T00:00:00Z');
  const gfzMs = Date.parse('2026-07-30T00:00:00Z');
  const noaa = kpToObservations('swpc-kp', [{ observedAt: noaaMs, kp: 2 }]);
  const gfz = kpToObservations('gfz-kp', [{ observedAt: gfzMs, kp: 1.667 }]);
  assert.equal(noaa[0]!.key, gfz[0]!.key);

  const result = ingestDomain('space_weather', [...noaa, ...gfz], healthyBoth(noaaMs), noaaMs);
  assert.equal(result.facts.length, 1, 'same bin ⇒ one fused fact, not two singletons');
  assert.equal(result.facts[0]!.providerIds.length, 2);
});

test('routine cross-source spread does NOT read as disagreement', () => {
  // Live 2026-07-30T12:00Z: SWPC 1.67 (8-station estimate) vs GFZ 0.667
  // (13-observatory definitive-track). A 1.003 delta on a quiet day is the
  // NORMAL gap between the two algorithms — flagging it would train the user
  // to ignore the flag.
  const obs = [
    ...kpToObservations('swpc-kp', [{ observedAt: BIN_12Z, kp: 1.67 }]),
    ...kpToObservations('gfz-kp', [{ observedAt: BIN_12Z, kp: 0.667 }]),
  ];
  const { facts } = ingestDomain('space_weather', obs, healthyBoth(NOW), NOW);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.fusion.disagreements.length, 0, '1.003 apart is inside the measured p95 spread');
  assert.ok(facts[0]!.fusion.confidenceMultiplier > 0.6);
});

test('a routine 0.667 spread does not disagree either (0.5 tolerance would false-flag 27% of bins)', () => {
  const obs = [
    ...kpToObservations('swpc-kp', [{ observedAt: BIN_12Z, kp: 2 }]),
    ...kpToObservations('gfz-kp', [{ observedAt: BIN_12Z, kp: 1.333 }]),
  ];
  const { facts } = ingestDomain('space_weather', obs, healthyBoth(NOW), NOW);
  assert.equal(facts[0]!.fusion.disagreements.length, 0);
});

test('a real storm-scale split IS surfaced, with both providers fingerprinted', () => {
  // Kp 2 (quiet) vs Kp 5 (G1 storm) is a 3-step split — one source would have
  // the user chasing aurora while the other says nothing is happening.
  const obs = [
    ...kpToObservations('swpc-kp', [{ observedAt: BIN_12Z, kp: 2 }]),
    ...kpToObservations('gfz-kp', [{ observedAt: BIN_12Z, kp: 5 }]),
  ];
  const { facts } = ingestDomain('space_weather', obs, healthyBoth(NOW), NOW);
  assert.equal(facts.length, 1);
  const fact = facts[0]!;
  assert.ok(fact.fusion.disagreements.length >= 1, 'a 3.0 split must surface');
  assert.ok(fact.fusion.confidenceMultiplier <= 0.6, 'disagreement caps confidence');
  // fuseObservations names only the OUTLIER in `disagreements`, so the proof
  // that the drill-down can attribute BOTH readings is the fingerprint map.
  assert.deepEqual(Object.keys(fact.fingerprints).sort(), ['gfz-kp', 'swpc-kp']);
  assert.notEqual(fact.fingerprints['swpc-kp'], fact.fingerprints['gfz-kp'], 'the drill-down must show WHICH value each source reported');
});

test('unusable rows are dropped rather than keyed on garbage', () => {
  const obs = kpToObservations('gfz-kp', [
    { observedAt: Number.NaN, kp: 3 },
    { observedAt: 0, kp: 3 },
    { observedAt: -1, kp: 3 },
    { observedAt: BIN_12Z, kp: Number.NaN },
    { observedAt: BIN_12Z, kp: -0.5 },
    { observedAt: BIN_12Z, kp: 9.5 },
    { observedAt: BIN_12Z, kp: 4 },
  ]);
  // A row with an unparseable timestamp cannot produce a bin key. Under
  // matchBy:'key' a keyless row is a permanent singleton, and an EMPTY-string
  // key from both providers would cluster their junk into one bogus 2-vote
  // "fact" — so the row is dropped at the adapter instead.
  assert.deepEqual(obs.map((o) => o.value), [4]);
  assert.ok(obs.every((o) => typeof o.key === 'string' && o.key.length > 0));
});

test('Kp 0 and Kp 9 are real readings, not falsy junk', () => {
  const obs = kpToObservations('swpc-kp', [
    { observedAt: BIN_12Z, kp: 0 },
    { observedAt: BIN_12Z + KP_BIN_MS, kp: 9 },
  ]);
  assert.deepEqual(obs.map((o) => o.value), [0, 9]);
});

test('an empty sample set yields no observations (the caller reports ok:false, not an empty success)', () => {
  assert.deepEqual(kpToObservations('gfz-kp', []), []);
});

// ── Fail-closed fetches ─────────────────────────────────────────────────────
// A provider that returns nothing must record ok:false. Recording ok:true with
// an empty sample list would leave its health green while it contributes no
// votes — the domain silently drops to one source with nothing to show for it.

function stubFetch(
  t: { after: (fn: () => void) => void },
  payload: unknown,
  status = 200,
): { url: string } {
  const call = { url: '' };
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

function freshTag(offsetBins: number): string {
  return new Date(Math.floor(Date.now() / KP_BIN_MS) * KP_BIN_MS - offsetBins * KP_BIN_MS).toISOString();
}

test('fetchSwpcKp reads kpPoints off the already-cached status payload', async (t) => {
  const call = stubFetch(t, { geomag: { kp: 1.67 }, kpPoints: [{ time_tag: freshTag(1), kp: 2 }, { time_tag: freshTag(0), kp: 1.67 }] });
  const result = await fetchSwpcKp();
  assert.equal(result.ok, true);
  assert.deepEqual(result.samples.map((s) => s.kp), [2, 1.67]);
  // One shared route with the geomag panel — NOT a second hit on the same
  // upstream SWPC product.
  assert.match(call.url, /\/api\/spaceweather\/status$/);
});

test('fetchSwpcKp trims to the shared 48h window so the two bin sets align', async (t) => {
  // NOAA publishes ~7 days of bins against GFZ's 48h. Untrimmed, every older
  // NOAA bin fuses as a permanent single-vote fact.
  stubFetch(t, { kpPoints: [{ time_tag: freshTag(40), kp: 3 }, { time_tag: freshTag(1), kp: 2 }] });
  const result = await fetchSwpcKp();
  assert.deepEqual(result.samples.map((s) => s.kp), [2]);
});

test('fetchSwpcKp fails closed on non-2xx, degraded, malformed, and empty payloads', async (t) => {
  for (const [label, payload, status] of [
    ['non-2xx', { kpPoints: [{ time_tag: freshTag(0), kp: 2 }] }, 502],
    ['degraded flag', { degraded: true, kpPoints: [{ time_tag: freshTag(0), kp: 2 }] }, 200],
    ['kpPoints missing', { geomag: null }, 200],
    ['kpPoints not an array', { kpPoints: { kp: 2 } }, 200],
    ['no usable rows', { kpPoints: [{ time_tag: 'not-a-date', kp: 2 }, { time_tag: freshTag(0), kp: null }] }, 200],
    ['all rows stale', { kpPoints: [{ time_tag: freshTag(99), kp: 2 }] }, 200],
  ] as const) {
    stubFetch(t, payload, status);
    assert.deepEqual(await fetchSwpcKp(), { ok: false, samples: [] }, label);
  }
});

test('fetchGfzKp forwards fresh samples', async (t) => {
  const observedAt = Date.now() - KP_BIN_MS;
  const call = stubFetch(t, { degraded: false, samples: [{ observedAt, kp: 0.667, status: 'pre' }] });
  const result = await fetchGfzKp();
  assert.deepEqual(result, { ok: true, samples: [{ observedAt, kp: 0.667 }] });
  assert.match(call.url, /\/api\/spaceweather-kp-gfz$/);
});

test('fetchGfzKp fails closed on non-2xx, degraded, malformed, and empty payloads', async (t) => {
  const fresh = Date.now() - KP_BIN_MS;
  for (const [label, payload, status] of [
    ['non-2xx', { samples: [{ observedAt: fresh, kp: 1 }] }, 502],
    ['degraded flag', { degraded: true, samples: [{ observedAt: fresh, kp: 1 }] }, 200],
    ['samples missing', {}, 200],
    ['samples not an array', { samples: { kp: 1 } }, 200],
    ['no usable rows', { samples: [{ observedAt: 'x', kp: 1 }, { observedAt: fresh, kp: null }] }, 200],
    ['all rows stale', { samples: [{ observedAt: fresh - 99 * KP_BIN_MS, kp: 1 }] }, 200],
  ] as const) {
    stubFetch(t, payload, status);
    assert.deepEqual(await fetchGfzKp(), { ok: false, samples: [] }, label);
  }
});

test('a thrown fetch (offline sidecar) fails closed rather than propagating', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  assert.deepEqual(await fetchSwpcKp(), { ok: false, samples: [] });
  assert.deepEqual(await fetchGfzKp(), { ok: false, samples: [] });
});
