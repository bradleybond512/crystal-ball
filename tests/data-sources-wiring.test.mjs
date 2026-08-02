import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const panelsSrc = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const panelLayoutSrc = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
const dataLoaderSrc = readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8');
const appSrc = readFileSync(resolve(root, 'src/App.ts'), 'utf8');

describe('RIPE Atlas wiring', () => {
  it('sidecar has /api/ripe-atlas route', () => {
    assert.match(sidecarSrc, /\/api\/ripe-atlas/);
    assert.match(sidecarSrc, /atlas\.ripe\.net/);
  });

  it('ripe-atlas panel is registered', () => {
    assert.match(panelsSrc, /'ripe-atlas':\s*\{/);
  });

  it('RipeAtlasPanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new RipeAtlasPanel\(/);
  });

  it('data-loader has loadRipeAtlas method', () => {
    assert.match(dataLoaderSrc, /async loadRipeAtlas\(\): Promise<void>/);
  });

  it('App.ts scheduler includes ripeAtlas', () => {
    assert.match(appSrc, /ripeAtlas/);
    assert.match(appSrc, /loadRipeAtlas/);
  });
});

// The surface_temp fusion block in loadWeatherAlerts. Scoped deliberately: the
// hourly-forecast block ~30 lines ABOVE it is a separate, pre-existing
// fire-and-forget IIFE with its own `!place.lat || !place.lon` test, and an
// unscoped regex over the whole file would match that one instead.
const surfaceTempBlock = (() => {
  const start = dataLoaderSrc.indexOf('// surface_temp fusion: Open-Meteo + MET Norway per saved place.');
  assert.notEqual(start, -1, 'surface_temp fusion block must exist in data-loader');
  const end = dataLoaderSrc.indexOf("recordDomainObservations('met-norway'", start);
  assert.notEqual(end, -1, 'surface_temp block must record met-norway');
  return dataLoaderSrc.slice(start, end + 200);
})();

describe('surface_temp fusion data-loader wiring', () => {
  it('the block is awaited, not fire-and-forget', () => {
    // recordDomainObservations REPLACES per provider. Unawaited, the tick's
    // in-flight guard releases while these requests are still running, so a
    // retry can start a second tick whose newer observations are then
    // overwritten by the older, slower one landing last.
    assert.match(surfaceTempBlock, /await Promise\.allSettled\(places\.map\(/);
    assert.doesNotMatch(surfaceTempBlock, /void \(async \(\)/, 'surface_temp fetches must not be fire-and-forget');
  });

  it('coordinates are range-checked, never truthiness-tested', () => {
    // `!place.lat || !place.lon` skips longitude 0 (London, Accra) and
    // latitude 0 — after which both providers are recorded empty for that place.
    assert.match(surfaceTempBlock, /isUsableLatLon\(place\.lat, place\.lon\)/);
    assert.doesNotMatch(surfaceTempBlock, /!place\.lat \|\| !place\.lon/);
  });

  it('the health verdict comes from the adapter output, not the raw readings', () => {
    // Recording ok from `readings.length > 0` greens a provider whose rows the
    // adapter drops — a phantom vote toward "verified by N independent sources".
    assert.match(surfaceTempBlock, /tempVote\('open-meteo-forecast', openMeteoReadings\)/);
    assert.match(surfaceTempBlock, /tempVote\('met-norway', metNorwayReadings\)/);
    assert.match(surfaceTempBlock, /recordDomainObservations\('open-meteo-forecast', omVote\.observations, omVote\.ok\)/);
    assert.match(surfaceTempBlock, /recordDomainObservations\('met-norway', mnVote\.observations, mnVote\.ok\)/);
    assert.doesNotMatch(surfaceTempBlock, /readings\.length > 0/, 'ok must never be derived from the raw readings array');
  });
});

describe('World Bank data-loader wiring', () => {
  it('data-loader imports fetchWorldBankProfile', () => {
    assert.match(dataLoaderSrc, /fetchWorldBankProfile/);
  });

  it('data-loader has loadWorldBankBaselines method', () => {
    assert.match(dataLoaderSrc, /async loadWorldBankBaselines\(\): Promise<void>/);
  });

  it('App.ts scheduler includes worldBankBaselines', () => {
    assert.match(appSrc, /worldBankBaselines/);
    assert.match(appSrc, /loadWorldBankBaselines/);
  });
});

describe('fused-domain loaders stay inside their freshness contracts', () => {
  // A fused domain whose loader only runs at boot goes stale inside its own
  // declared TTL and silently decays toward single-source — no upstream fault,
  // no error, just a corroboration count quietly dropping to 1. Asserting the
  // NAME appears in App.ts is not enough to catch that: these three loaders
  // were always named there (via loadAllData), just never scheduled. So this
  // reads the interval back and checks it against the contract it must honor.
  const registrySrc = readFileSync(resolve(root, 'src/services/providers/provider-registry.ts'), 'utf8');
  const outagesSrc = readFileSync(resolve(root, 'src/services/internet-outages.ts'), 'utf8');

  /** Multiplies out the `N * 60 * 1000` literals these files use. */
  const product = (expr) => expr.trim().split('*').reduce((acc, part) => {
    const n = Number(part.trim().replace(/_/g, ''));
    assert.ok(Number.isFinite(n), `unparseable interval factor '${part}' in '${expr}'`);
    return acc * n;
  }, 1);

  const schedulerIntervalMs = (taskName) => {
    // No `s` flag: the match must stay on one line, so it cannot run past this
    // entry and pick up a later entry's intervalMs.
    const m = appSrc.match(new RegExp(`name: '${taskName}'.*?intervalMs:\\s*([^,]+),`));
    assert.ok(m, `${taskName} is not registered with the refresh scheduler in App.ts`);
    // Some entries point at the shared REFRESH_INTERVALS table rather than an
    // inline literal; resolve through it so the guard reads the real number.
    const shared = m[1].trim().match(/^REFRESH_INTERVALS\.(\w+)/);
    if (shared) {
      const baseSrc = readFileSync(resolve(root, 'src/config/variants/base.ts'), 'utf8');
      const entry = baseSrc.match(new RegExp(`\\b${shared[1]}:\\s*([^,]+),`));
      assert.ok(entry, `REFRESH_INTERVALS.${shared[1]} is not defined in variants/base.ts`);
      return product(entry[1]);
    }
    return product(m[1]);
  };

  const registryTtlMs = (providerId) => {
    const m = registrySrc.match(new RegExp(`id: '${providerId}'.*?freshnessTtlMs:\\s*([^,]+),`));
    assert.ok(m, `${providerId} has no freshnessTtlMs in the provider registry`);
    return product(m[1].replace(/\bMIN\b/g, '60000').replace(/\bHOUR\b/g, '3600000'));
  };

  // scheduleRefresh jitters +/-10% (refresh-scheduler.ts JITTER_FRACTION), so an
  // interval set EQUAL to the TTL lands over it on roughly half its ticks and
  // the provider flaps healthy/stale, so every budget below carries it.
  //
  // SCOPE: jitter is the only factor modeled here. computeDelay also multiplies
  // by the ghost (x5), context (x2/x4) and hidden (x10) factors, under which
  // every interval below exceeds its contract — deliberately, since those modes
  // trade freshness for battery (see the App.ts comments). Asserting against
  // them would encode a budget no interval can satisfy. What these guards pin is
  // the DEFAULT path, which is where the boot-only bug actually lived.
  const JITTER = 1.1;

  /** Reads the single `AbortSignal.timeout(N)` out of a one-fetch service module. */
  const soleFetchTimeoutMs = (relPath) => {
    const src = readFileSync(resolve(root, relPath), 'utf8');
    const all = [...src.matchAll(/AbortSignal\.timeout\(([0-9_]+)\)/g)];
    assert.equal(all.length, 1, `${relPath} must have exactly one fetch timeout for this budget to be exact`);
    return Number(all[0][1].replace(/_/g, ''));
  };

  for (const [task, provider, fetchPath] of [
    ['emscSeismic', 'emsc-seismic', 'src/services/emsc-seismic.ts'],
    ['geofonSeismic', 'geofon-seismic', 'src/services/geofon-seismic.ts'],
  ]) {
    it(`${task} refreshes inside the ${provider} freshness TTL`, () => {
      const interval = schedulerIntervalMs(task);
      const ttl = registryTtlMs(provider);
      // Same execution-aware budget as internetOutages below: the scheduler arms
      // the next timer AFTER `await fn()`, so a cycle costs the loader's runtime
      // on top of the interval. These loaders each await exactly one fetch, so
      // their runtime is dominated by that fetch's own abort timeout — parsed
      // from source rather than hardcoded, so raising a timeout fails HERE
      // instead of silently pushing the domain past its TTL in production.
      // Same caveat as internetOutages below: the timeout bounds the network
      // wait, not the parse/normalize work after it.
      const modeledCycleMs = interval * JITTER + soleFetchTimeoutMs(fetchPath);
      assert.ok(
        // Strict, for the same reason as internetOutages below: the parse and
        // normalize work sits outside the fetch timeout, so an equality case
        // would be a cycle that really does exceed the TTL.
        modeledCycleMs < ttl,
        `${task} runs every ${interval / 60000} min but ${provider} declares a ${ttl / 60000} min TTL; ` +
        `with jitter and a full-length fetch that cycle reaches ${modeledCycleMs / 60000} min ` +
        `and the earthquakes domain drops a vote`,
      );
    });
  }

  it('usgsSeismic refreshes inside the usgs-earthquakes freshness TTL', () => {
    // Separate from the loop above because this loader has no source-visible
    // fetch timeout to add: fetchEarthquakes goes through the generated client
    // and a circuit breaker, so there is no `AbortSignal.timeout(N)` literal to
    // parse. The budget therefore models the jittered interval ONLY, and the
    // remaining slack is what covers the request itself — which is why the
    // assertion below is strict and why the interval is 8 min against a 10 min
    // TTL rather than something closer.
    const interval = schedulerIntervalMs('usgsSeismic');
    const ttl = registryTtlMs('usgs-earthquakes');
    assert.ok(
      interval * JITTER < ttl,
      `usgsSeismic runs every ${interval / 60000} min (${(interval * JITTER) / 60000} min jittered) ` +
      `against a ${ttl / 60000} min TTL, leaving nothing for the fetch itself`,
    );
    // The fusion vote must NOT ride on `natural`: that task is hourly and gated
    // on a map layer, so recording there made a MAP TOGGLE silently remove a
    // provider. Pinned so the record cannot drift back.
    assert.match(
      dataLoaderSrc,
      /async loadUsgsSeismic\(\)[\s\S]*?recordDomainObservations\('usgs-earthquakes'/,
      'loadUsgsSeismic must own the usgs-earthquakes fusion record',
    );
    const naturalStart = dataLoaderSrc.indexOf('async loadNatural()');
    assert.ok(naturalStart > 0, 'could not locate loadNatural');
    const nextMethod = dataLoaderSrc.indexOf('\n  async ', naturalStart + 1);
    assert.ok(nextMethod > naturalStart, 'could not locate the method after loadNatural');
    const naturalBody = dataLoaderSrc.slice(naturalStart, nextMethod);
    assert.ok(
      !naturalBody.includes("recordDomainObservations('usgs-earthquakes'"),
      'loadNatural must not record usgs-earthquakes: it reads through a 1-hour offline cache, ' +
      'so recording there stamps a fresh lastSuccessAt onto hour-old rows',
    );
  });

  it('markets refreshes inside every price provider freshness TTL', () => {
    const interval = schedulerIntervalMs('markets');
    const priceProviders = ['coingecko', 'coinbase', 'coinpaprika', 'kraken', 'yahoo-finance', 'finnhub', 'fmp'];
    // The binding contract is the TIGHTEST TTL across the fused set, since one
    // stale provider is enough to cost the domain a vote.
    const binding = Math.min(...priceProviders.map(registryTtlMs));
    // Modeled as the jittered interval only. loadMarkets runs its panel phases
    // before the fusion block, including up to 60 s of deliberate retry sleeps,
    // so the real cycle is longer — the margin between this figure and the TTL
    // is what absorbs that, and it is why the TTL is 12 min rather than 10.
    // The cadence cannot be tightened instead: FMP's free tier is 250 req/day
    // and 8 min already spends 180.
    const modeledCycleMs = interval * JITTER;
    assert.ok(
      modeledCycleMs + 60_000 < binding,
      `markets runs every ${interval / 60000} min (${modeledCycleMs / 60000} min jittered, plus up to ` +
      `1 min of in-loader retry sleeps) against a ${binding / 60000} min tightest TTL`,
    );
  });

  it('airQuality refreshes inside every air-quality provider freshness TTL', () => {
    const interval = schedulerIntervalMs('airQuality');
    const aqProviders = ['open-meteo-aqi', 'openaq-v3', 'airnow', 'purpleair'];
    const binding = Math.min(...aqProviders.map(registryTtlMs));
    // All four are recorded from evaluateCompoundThreats, which loadAirQuality
    // reaches through a trailing debounce — parsed from source rather than
    // hardcoded, so lengthening the debounce fails HERE rather than pushing the
    // domain past its TTL in production.
    const debounceMatch = dataLoaderSrc.match(/private scheduleCompoundThreatEvaluation\(\)[\s\S]*?\}, ([0-9_]+)\);/);
    assert.ok(debounceMatch, 'could not read the compound-threat debounce out of data-loader.ts');
    const debounceMs = Number(debounceMatch[1].replace(/_/g, ''));
    const modeledCycleMs = interval * JITTER + debounceMs;
    assert.ok(
      modeledCycleMs < binding,
      `airQuality runs every ${interval / 60000} min; with jitter and the ${debounceMs / 1000}s debounce ` +
      `that cycle reaches ${modeledCycleMs / 60000} min against a ${binding / 60000} min tightest TTL`,
    );
  });

  it('internetOutages refreshes inside the TIGHTER of its two contracts', () => {
    const interval = schedulerIntervalMs('internetOutages');
    // The registry TTL is the LOOSER contract. The binding one is the comms
    // axis's synchronous getter, which returns [] past its own window — see
    // survival/comms-contributor.ts.
    const commsWindow = product(outagesSrc.match(/const CACHE_TTL_MS = ([^;]+);/)[1]);
    const binding = Math.min(registryTtlMs('ioda'), commsWindow);
    assert.equal(binding, commsWindow, 'the comms getter is expected to be the tighter contract');
    assert.ok(
      interval * JITTER <= binding,
      `internetOutages runs every ${interval / 60000} min against a ${binding / 60000} min window`,
    );
    // fetchIodaOutages refetches LAZILY — on the first tick that finds the cache
    // already expired, not on expiry itself. So the axis is blind from the
    // moment the cache turns 10 min old until the next tick, and no interval
    // closes that gap; it only bounds it at one jittered tick. Picking an exact
    // divisor does NOT help: it lines up only at zero jitter, and real ticks at
    // 4.5/9.0 min push the refetch out to 14.5 with a 5 min interval.
    // The gap is NOT just the jittered delay. refresh-scheduler arms the next
    // timer in a `finally` AFTER `await fn()` resolves, so a cycle costs the
    // loader's own runtime on top of the interval. loadInternetOutages awaits
    // the comms fetch, then a Promise.all of the two fusion fetches — so the
    // dominant term is one comms timeout plus the slower of the parallel pair,
    // both read back from source here rather than assumed.
    //
    // This is a bound in NEITHER direction, just a deliberately conservative
    // estimate. It overshoots on the network term — real fetches usually
    // return in well under their abort timeout, and charging every one the
    // full timeout is the pessimistic choice — while omitting JSON parsing,
    // adaptation, ingestion and event-loop delay, which sit outside those
    // timeouts entirely. Both errors are small against a ~66s margin, and they
    // point opposite ways, so the guard is sound in practice. What would break
    // it is a future change that makes the loader's synchronous work
    // expensive: that term is not modeled here and would have to be added.
    const fetchSrc = readFileSync(resolve(root, 'src/services/netwatch/cloudflare-radar-fetch.ts'), 'utf8');
    const timeoutMs = (src, name) => {
      const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
      assert.ok(m, `${name} not found; the execution budget below would silently under-count`);
      return Number(m[1].replace(/_/g, ''));
    };
    const commsTimeout = product(outagesSrc.match(/AbortSignal\.timeout\(([0-9_]+)\)/)[1]);
    const modeledExecMs = commsTimeout + Math.max(
      timeoutMs(fetchSrc, 'IODA_RENDERER_TIMEOUT_MS'),
      timeoutMs(fetchSrc, 'CLOUDFLARE_RENDERER_TIMEOUT_MS'),
    );
    // Strict `<`, not `<=`: at a 4 min interval the sum lands on exactly
    // binding/2, and a bound met with zero margin is not a bound. (The parsed
    // timeouts themselves are covered either way — raising one raises
    // modeledExecMs and fails this assertion. What the strictness rejects is the
    // exact-equality case, where the budget is satisfied only because nothing
    // outside the two terms below costs a single millisecond.)
    const modeledBlindMs = interval * JITTER + modeledExecMs;
    assert.ok(
      modeledBlindMs < binding / 2,
      `modeled blind window is ${modeledBlindMs / 60000} min (${interval / 60000} min interval ` +
      `x${JITTER} jitter + ${modeledExecMs / 1000}s execution) out of the ${binding / 60000} min ` +
      `it protects; keep it under half so the axis has data for most of each cycle`,
    );
  });

  it('the IODA fusion window is snapped so scheduled ticks share a cache key', () => {
    // The sidecar cache key carries from/until at second resolution, so an
    // unsnapped `now` makes every tick a fresh limit=5000 request against a
    // keyless fair-use API — the cache is provably never hit.
    const fetchSrc = readFileSync(resolve(root, 'src/services/netwatch/cloudflare-radar-fetch.ts'), 'utf8');
    assert.match(fetchSrc, /IODA_WINDOW_QUANTUM_MS/, 'the fusion window must be quantized');
    // Ceil, not floor: a floored `until` ends before the caller instant and
    // truncates onsets IODA has already published, which drops a country to a
    // single vote because the adapter emits nothing for a zero-row country.
    assert.match(
      fetchSrc,
      /Math\.ceil\(now \/ IODA_WINDOW_QUANTUM_MS\)/,
      'until must derive from the snapped instant, snapped UP',
    );
  });
});
