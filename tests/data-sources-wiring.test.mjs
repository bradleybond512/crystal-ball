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
    // Substituted rather than returned outright: entries of the form
    // `REFRESH_INTERVALS.markets * 2` must keep their multiplier, and an
    // early return on the table lookup would silently halve the modeled cycle.
    // When intervalMs is the LAST property the capture runs to the entry's
    // closing brace (`REFRESH_INTERVALS.markets }`), so trim that off before
    // parsing. The comma that bounds the capture is then the list separator.
    const expr = m[1].trim().replace(/\s*\}\s*$/, '').replace(/REFRESH_INTERVALS\.(\w+)/g, (_, key) => {
      const baseSrc = readFileSync(resolve(root, 'src/config/variants/base.ts'), 'utf8');
      const entry = baseSrc.match(new RegExp(`\\b${key}:\\s*([^,]+),`));
      assert.ok(entry, `REFRESH_INTERVALS.${key} is not defined in variants/base.ts`);
      return String(product(entry[1]));
    });
    return product(expr);
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

  const fetchTimeoutsMs = (relPath) => {
    const src = readFileSync(resolve(root, relPath), 'utf8');
    const all = [...src.matchAll(/AbortSignal\.timeout\(([0-9_]+)\)/g)].map((m) => Number(m[1].replace(/_/g, '')));
    assert.ok(all.length > 0, `${relPath} declares no fetch timeout, so no budget over it can be exact`);
    return all;
  };

  /** Reads the single `AbortSignal.timeout(N)` out of a one-fetch service module. */
  const soleFetchTimeoutMs = (relPath) => {
    const all = fetchTimeoutsMs(relPath);
    assert.equal(all.length, 1, `${relPath} must have exactly one fetch timeout for this budget to be exact`);
    return all[0];
  };

  /** Longest deadline in a module whose fetches run concurrently. */
  const maxFetchTimeoutMs = (relPath) => Math.max(...fetchTimeoutsMs(relPath));

  for (const [task, provider, fetchPath] of [
    ['emscSeismic', 'emsc-seismic', 'src/services/emsc-seismic.ts'],
    ['geofonSeismic', 'geofon-seismic', 'src/services/geofon-seismic.ts'],
    ['usgsSeismic', 'usgs-earthquakes', 'src/services/earthquake/usgs-fusion-fetch.ts'],
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

  /** Body of a `async name()` method on DataLoader, up to the next sibling method. */
  const dataLoaderMethod = (name) => {
    const start = dataLoaderSrc.indexOf(`async ${name}(`);
    assert.ok(start > 0, `could not locate ${name} in data-loader.ts`);
    const end = dataLoaderSrc.indexOf('\n  async ', start + 1);
    assert.ok(end > start, `could not locate the method after ${name}`);
    return dataLoaderSrc.slice(start, end);
  };

  // Quote style and line breaks are formatter territory, so the negative guard
  // below must not be evadable by either. A literal substring check was: the
  // record could come back as "usgs-earthquakes" or wrapped across lines and
  // the assertion would still pass.
  const RECORDS_USGS = /recordDomainObservations\(\s*['"]usgs-earthquakes['"]/;

  it('the usgs-earthquakes vote is recorded on its own loader, from live rows', () => {
    const body = dataLoaderMethod('loadUsgsSeismic');
    // Split at the catch so the SUCCESS path is what gets asserted. Matching the
    // whole method would have been satisfied by the catch-path
    // `recordDomainObservations('usgs-earthquakes', [], false)` alone — i.e. a
    // loader that never records a healthy vote would still have passed.
    const catchAt = body.indexOf('} catch');
    assert.ok(catchAt > 0, 'loadUsgsSeismic is expected to record a failure in a catch');
    const tryBody = body.slice(0, catchAt);
    assert.match(tryBody, RECORDS_USGS, 'loadUsgsSeismic must record the usgs-earthquakes vote on its success path');
    assert.match(
      tryBody,
      /recordDomainObservations\(\s*['"]usgs-earthquakes['"],\s*observations,\s*observations\.length > 0\s*\)/,
      'the ok flag must derive from the ADAPTER output: a 200 whose rows the adapter all drops is a ' +
      'format change, and recording it healthy puts a phantom vote behind the corroboration count',
    );
    assert.match(body.slice(catchAt), /recordDomainObservations\(\s*['"]usgs-earthquakes['"],\s*\[\],\s*false\s*\)/,
      'a failed fetch must record a failing outcome, not go silent');
    // ...and `observations` has to come from the adapter. Without this, swapping
    // the adapter call for `const observations = []` satisfies every regex above
    // while recording a permanent failure — the checks would be pinning names.
    assert.match(
      tryBody,
      /const observations = usgsEventsToObservations\(/,
      'observations must be the adapter output, not a literal',
    );
    // The fusion vote must NOT ride on `natural`: that task is hourly and gated
    // on a map layer, so recording there made a MAP TOGGLE silently remove a
    // provider. Pinned so the record cannot drift back.
    assert.doesNotMatch(
      dataLoaderMethod('loadNatural'),
      RECORDS_USGS,
      'loadNatural must not record usgs-earthquakes: it reads through a 1-hour offline cache, ' +
      'so recording there stamps a fresh lastSuccessAt onto hour-old rows',
    );
  });

  it('the usgs-earthquakes vote reaches every variant that ships the map layer', () => {
    // Both halves of round one's second blocking bug. `natural` is on in full,
    // tech and finance, and loadNatural used to carry this provider's record for
    // all three — so gating the replacement on the full variant, at EITHER the
    // boot task or the scheduler entry, silently retires the earthquakes
    // domain's only vote in the other two. Neither is caught by an interval
    // budget, so both are pinned here.
    // Anchored on the boot-task LINE and read backwards to the statement start,
    // so the capture is the gate that actually guards this push. A lazy
    // `SITE_VARIANT...usgsSeismic` match instead captured the bare identifier
    // and asserted nothing — restoring the full-only gate left it green.
    const bootLine = dataLoaderSrc.split('\n').find((l) => l.includes("name: 'usgsSeismic'"));
    assert.ok(bootLine, 'could not find the usgsSeismic boot task in data-loader.ts');
    const gate = bootLine.slice(0, bootLine.indexOf('tasks.push'));
    assert.match(gate, /SITE_VARIANT/, 'the usgsSeismic boot task is expected to carry a variant gate');
    assert.doesNotMatch(
      gate,
      /SITE_VARIANT === 'full'/,
      'the usgsSeismic boot task must not be full-only: tech and finance ship the natural layer too',
    );
    const entry = appSrc.match(/name: 'usgsSeismic'[^\n]*/);
    assert.ok(entry, 'usgsSeismic is not registered with the refresh scheduler in App.ts');
    assert.doesNotMatch(
      entry[0],
      /condition:/,
      'the usgsSeismic scheduler entry must stay unconditional; a variant or map-layer condition ' +
      'reintroduces the boot-only staleness this task exists to fix',
    );
  });

  it('the usgs fusion fetch rejects cache replays but accepts the live fallback feed', () => {
    // Executed, not name-matched: the allowlist regex is pulled out of the
    // module and run against the exact `source` values the two implementations
    // emit. Widening it to admit 'cached' — the last-good REPLAY that
    // feed-resilience serves when every upstream fails — fails here, because
    // recording a replay as a fresh success is the phantom healthy vote.
    const src = readFileSync(resolve(root, 'src/services/earthquake/usgs-fusion-fetch.ts'), 'utf8');
    const m = src.match(/const LIVE_SOURCES = (\/.+\/);/);
    assert.ok(m, 'could not read the live-source allowlist out of usgs-fusion-fetch.ts');
    // eslint-disable-next-line no-eval
    const allow = eval(m[1]);
    assert.ok(!allow.test('cached'), "'cached' is a last-good replay and must never count as live");
    assert.ok(!allow.test(''), 'an empty source must not pass');
    for (const live of ['primary', 'fallback-0', 'fallback-1', 'usgs.gov']) {
      assert.ok(allow.test(live), `${live} is a live fetch and must be accepted`);
    }
    // The check has to be REACHED, too — an allowlist nothing calls is inert.
    assert.match(src, /LIVE_SOURCES\.test\(data\.source\)/, 'the allowlist must gate the returned rows');
    // Both payload shapes have to survive the adapter. The web edge function
    // sends raw GeoJSON features; parseUsgsEvents reads flat rows, so without
    // normalization the web build records a permanent failure instead of a vote.
    assert.match(src, /'geometry' in row && 'properties' in row/, 'raw GeoJSON features must be normalized');
  });

  it('markets refreshes inside every price provider freshness TTL', () => {
    const interval = schedulerIntervalMs('markets');
    const priceProviders = ['coingecko', 'coinbase', 'coinpaprika', 'kraken', 'yahoo-finance', 'finnhub', 'fmp'];
    // The binding contract is the TIGHTEST TTL across the fused set, since one
    // stale provider is enough to cost the domain a vote.
    const binding = Math.min(...priceProviders.map(registryTtlMs));
    // The panel phases that run BEFORE the fusion block contain deliberate
    // fixed-length retry sleeps, so they are part of every cycle that retries
    // and have to be paid for out of the budget. Parsed from the loader rather
    // than hardcoded, so lengthening a sleep fails HERE instead of silently
    // pushing the price providers past their TTL in production.
    const marketsBody = dataLoaderMethod('loadMarkets');
    // EXECUTIONS, not call sites. The commodities sleep sits inside a bounded
    // retry loop and can run once per retry, so summing the literals undercounts
    // the worst cycle — which is the only cycle this budget is about.
    const retryLoop = marketsBody.match(/for \(let attempt = 0; attempt < (\d+)/);
    assert.ok(retryLoop, 'expected loadMarkets to still retry commodities in a bounded loop');
    const loopStart = marketsBody.indexOf('{', marketsBody.indexOf(retryLoop[0]));
    let depth = 0, loopEnd = loopStart;
    while (loopEnd < marketsBody.length) {
      if (marketsBody[loopEnd] === '{') depth++;
      else if (marketsBody[loopEnd] === '}' && --depth === 0) break;
      loopEnd++;
    }
    assert.ok(depth === 0 && loopEnd > loopStart, 'could not brace-match the commodities retry loop');
    const sleepMs = [...marketsBody.matchAll(/setTimeout\(r,\s*([0-9_]+)\)/g)].reduce((sum, m) => {
      // The loop sleeps on every attempt after the first, hence N-1.
      const runs = m.index > loopStart && m.index < loopEnd ? Number(retryLoop[1]) - 1 : 1;
      return sum + Number(m[1].replace(/_/g, '')) * runs;
    }, 0);
    assert.ok(sleepMs > 0, 'expected loadMarkets to still contain its retry sleeps');
    // The seven price fetches are AWAITED ONE AT A TIME, so their abort
    // deadlines add up rather than overlapping, and that sum dominates the
    // interval — it is the reason the TTL is 20 min and not 12. Parsed from the
    // fetch modules so raising any one deadline fails HERE. Five of the seven
    // share quotes-route-fetch, so its single timeout is counted once per
    // provider that routes through it.
    const priceFetchDeadlines = [
      ['src/services/market/coingecko-fetch.ts', 1],
      ['src/services/market/fmp-fetch.ts', 1],
      ['src/services/market/quotes-route-fetch.ts', 5],
    ].reduce((sum, [relPath, calls]) => sum + soleFetchTimeoutMs(relPath) * calls, 0)
      // Frankfurter + open.er-api are the fx module's two fetches, but they run
      // under one Promise.all, so the pair costs the LONGER of the two, not the
      // sum — which is why this one cannot go through soleFetchTimeoutMs.
      + maxFetchTimeoutMs('src/services/market/fx-fusion-fetch.ts');
    const modeledCycleMs = interval * JITTER + sleepMs + priceFetchDeadlines;
    //
    // This is a FLOOR on the cycle, not a bound. The panel phases that run
    // before the fusion block — three fetchMultipleStocks calls plus up to two
    // retries, and up to two fetchCrypto calls — go through a circuit breaker
    // and the generated client, neither of which declares a deadline, so there
    // is no source-visible number for them and no honest way to compute the
    // worst case. Headroom is the only protection available against that
    // unmodeled tail, so this asserts a headroom RATIO. The ratio is a declared
    // policy, not a derivation: it is what makes the difference between a TTL
    // chosen to fit the measurable work and one chosen with room for the work
    // that cannot be measured. A TTL merely larger than the floor would satisfy
    // an assertion and protect nothing.
    const HEADROOM = 1.5;
    assert.ok(
      modeledCycleMs * HEADROOM < binding,
      `markets runs every ${interval / 60000} min; the measurable floor is ${modeledCycleMs / 60000} min ` +
      `(jitter + ${sleepMs / 1000}s of retry sleeps + ${priceFetchDeadlines / 1000}s of sequential fetch ` +
      `deadlines), which needs a TTL of at least ${(modeledCycleMs * HEADROOM) / 60000} min to leave room ` +
      `for the undeadlined panel phases, but the tightest price TTL is ${binding / 60000} min`,
    );
  });

  it('airQuality refreshes inside every air-quality provider freshness TTL', () => {
    const interval = schedulerIntervalMs('airQuality');
    const aqProviders = ['open-meteo-aqi', 'openaq-v3', 'airnow', 'purpleair'];
    const binding = Math.min(...aqProviders.map(registryTtlMs));
    // All four are recorded from evaluateCompoundThreats, which loadAirQuality
    // reaches through a trailing debounce. The interval budget below is only
    // meaningful while that chain is intact, so pin both links: without these,
    // deleting the debounce callback from loadAirQuality would leave the four
    // providers recorded at boot only and this test would still pass.
    assert.match(
      dataLoaderMethod('loadAirQuality'),
      /scheduleCompoundThreatEvaluation\(\)/,
      'loadAirQuality must trigger the compound-threat pass; that pass is where the four ' +
      'air-quality providers record their fusion votes',
    );
    const compoundBody = dataLoaderMethod('evaluateCompoundThreats');
    for (const provider of aqProviders) {
      // The second argument must be an ADAPTER CALL, not a literal. Each of
      // these providers has a rejected-branch `recordDomainObservations(id, [],
      // false)` beside its success call, so merely matching the provider id
      // stayed green with every success path deleted — four providers recording
      // nothing but failures forever, under a passing cadence test.
      assert.match(
        compoundBody,
        new RegExp(`recordDomainObservations\\(\\s*['"]${provider}['"],\\s*\\w+\\(`),
        `${provider} must record a vote built from its adapter, not just a failure row`,
      );
    }
    // Debounce parsed from source rather than hardcoded, so lengthening it fails
    // HERE rather than pushing the domain past its TTL in production.
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
