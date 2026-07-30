# Free API Fusion Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 15 curl-verified free APIs into the provider-fusion spine so every fused domain has 3+ independent votes, four new fused domains exist (weather temp, FX, radiation, internet outages), and volcano/tsunami/river/launch events flow into the observation store where the CorrelateEngine and lead-lag miner can see them.

**Architecture:** Everything rides the existing fusion spine: sidecar proxy route → fail-closed renderer fetch → pure `DomainObservation[]` adapter → `recordDomainObservations()` → `FUSION_DOMAINS` ingest → redundancy report → `SourceConfidencePanel` (automatic). Correlation edges come from `ingestRaw()` into the intelligence observation store + one new built-in rule. No new scoring math, no new panels — all target panels already exist.

**Tech Stack:** TypeScript (strict, `typecheck:all` at zero), Node sidecar (`local-api-server.mjs`), pure fixture-tested adapters (`.test.mts` via tsx), no new npm deps, no new API keys.

**Verification provenance (2026-07-29, all curl-checked):** GEOFON FDSN text 200 · CoinPaprika 200 · Kraken 200 · Stooq daily CSV 200 (live-quote path 404s — EOD only) · open.er-api.com 200 · MET Norway 200 · NOAA NWPS 200 · Safecast 200 · GVP geoserver WFS 200 (`WeeklyVolcanoGeoJSON.json` 403s — use WFS) · tsunami.gov Atom 200 · Launch Library 2.3 200 · FAO FPMA 200 · Cloudflare Radar alive (401-class without token).

---

## Session protocol (every implementing session)

1. Work in an isolated worktree: `git worktree add .worktrees/api-fusion-batchN origin/main -b claude/api-fusion-batchN` — never on canonical HEAD (~10 sessions share it).
2. `data-loader.ts`, `panel-layout.ts`, `panels.ts`, and `local-api-server.mjs` are conflict magnets — rebase onto fresh `origin/main` immediately before committing.
3. Every PR body must contain the contiguous marker `cross-agent review: Codex` at creation; run a real Codex review (`codex exec --sandbox read-only "<prompt>" < pr.diff`).
4. Auto-merge bot is stalled: after opening each PR run `gh pr merge <N> --auto --squash` yourself, then `gh pr update-branch` the rest after each main-move.
5. Before claiming done: `npm run typecheck:all` (zero errors), `npm run test:providers`, `npm run smoke:offline`, `npm run secrets:scan:staged`.
6. Commits: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`; stage files by name.
7. Update the Progress Tracker below in the same commit as the work.

## Progress tracker

| Batch | PR | Status |
|---|---|---|
| 1 — Third votes for fused domains | #1584 (+ stragglers #1585, #1586) | **DONE 2026-07-29** — earthquakes 3 groups (GEOFON), crypto 4 (CoinPaprika+Kraken), equities 3 (FMP — Stooq bot-walled, see amendment), air_quality 4 (AirNow+PurpleAir, confidence-gated, 100km-capped, 2024 AQI table). Codex cross-reviews recorded on all three PRs; follow-up chips spawned for sidecar route tests, PurpleAir bbox+lastSeen-at-source, EMSC fail-open. |
| 2 — Four new fused domains | — | IN PROGRESS 2026-07-30 — domains: `surface_temp`, `fx_rates`, `space_weather` (**swapped in for `radiation`**, see Task 2.4 AMENDED), `internet_outages`. Opens with Task 2.0 geo-math. Still carried: NowCast/Barkjohn PM2.5 correction for the PurpleAir fusion path (Codex P1-5, deferred pending live disagreement data). |
| 3 — Correlation-edge wiring (volcano/tsunami/river/launch) | — | NOT STARTED |
| 4 — Shortage price corroboration + diagnostics + docs | — | NOT STARTED |

## Invariants (from the fusion spec — hold in every task)

- Fail-closed fetches: a missing key, non-2xx, `degraded:true`, or all-null payload returns `{ ok:false }` and records a **failing** fetch — a dead source must never look healthy-but-empty.
- Independence-group honesty: sources sharing an upstream share a group (they are ONE corroboration vote).
- Registry `providerIds` in `FUSION_DOMAINS` list only providers that actually record observations.
- Stale/absent data reduces confidence; it never silently disappears. Disagreements surface; they are never averaged.
- All adapters are pure (no DOM/fetch/globals) with fixture tests.

---

# Batch 1 — Third votes for the four fused domains (PR 1)

Earthquakes 2→3 groups (GEOFON), crypto 2→4 (CoinPaprika, Kraken), equities 2→3 (Stooq, EOD-honest), air_quality 2→4 (AirNow + PurpleAir — keys already provisioned).

### Task 1.1: GEOFON sidecar route

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (insert next to the EMSC route — find it with `grep -n "'/api/emsc-seismic'" src-tauri/sidecar/local-api-server.mjs`)

- [ ] **Step 1: Add the route.** GEOFON's FDSN event service is pipe-delimited text (JSON is not a supported FDSN format there). Parse it server-side:

```js
  // ── GEOFON (GFZ Potsdam) FDSN event service — 3rd independent seismic
  // network for earthquake fusion (groups: usgs / emsc / gfz). Text format
  // is the stable FDSN contract; parsed here so the renderer gets JSON.
  if (requestUrl.pathname === '/api/geofon-seismic') {
    const _gfCached = getCached('geofon-seismic', 5 * 60 * 1000);
    if (_gfCached) return json(_gfCached);
    try {
      const r = await fetchWithTimeout(
        'https://geofon.gfz-potsdam.de/fdsnws/event/1/query?format=text&limit=50&minmagnitude=4.0',
        { headers: { 'User-Agent': CHROME_UA } },
        12_000,
      );
      if (!r.ok) throw new Error(`GEOFON ${r.status}`);
      const text = await r.text();
      const events = text.split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const c = line.split('|');
          return {
            id: c[0],
            time: c[1],
            lat: Number.parseFloat(c[2]),
            lon: Number.parseFloat(c[3]),
            depthKm: Number.parseFloat(c[4]),
            magnitude: Number.parseFloat(c[10]),
            region: c[12] ?? '',
          };
        })
        .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon) && Number.isFinite(e.magnitude));
      const _gfResult = { events };
      setCached('geofon-seismic', _gfResult, 5 * 60 * 1000);
      return json(_gfResult);
    } catch (error) {
      return json({ events: [], error: String(error.message ?? error) });
    }
  }
```

- [ ] **Step 2: Verify manually** (sidecar must be running; if the sandbox blocks localhost curl, verify with `lsof -iTCP:46123` + defer to the smoke run):

Run: `curl -s "http://127.0.0.1:46123/api/geofon-seismic" | head -c 300`
Expected: `{"events":[{"id":"gfz2026...","time":"2026-...","lat":...`

- [ ] **Step 3: Commit** — `git add src-tauri/sidecar/local-api-server.mjs && git commit -m "feat(sidecar): GEOFON FDSN event proxy for 3rd seismic fusion vote"`

### Task 1.2: GEOFON renderer service + fusion adapter (TDD)

**Files:**
- Create: `src/services/geofon-seismic.ts`
- Modify: `src/services/earthquake/earthquake-fusion-observations.ts`
- Test: `src/services/earthquake/__tests__/earthquake-fusion-observations.test.mts` (extend the existing file)

- [ ] **Step 1: Write the failing test** (append to the existing test file, mirroring the EMSC cases):

```ts
import { geofonEventsToObservations } from '../earthquake-fusion-observations';

test('geofonEventsToObservations maps valid events and drops NaN rows', () => {
  const obs = geofonEventsToObservations([
    { id: 'gfz2026osef', time: '2026-07-29T04:07:23.28Z', lat: -17.595, lon: -178.762, depthKm: 531.4, magnitude: 5.19, region: 'Fiji' },
    { id: 'bad', time: 'not-a-date', lat: 1, lon: 2, depthKm: 10, magnitude: 5, region: 'X' },
    { id: 'bad2', time: '2026-07-29T00:00:00Z', lat: Number.NaN, lon: 2, depthKm: 10, magnitude: 5, region: 'Y' },
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].providerId, 'geofon-seismic');
  assert.equal(obs[0].value, 5.19);
  assert.equal(obs[0].externalId, 'gfz2026osef');
});
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx --test src/services/earthquake/__tests__/earthquake-fusion-observations.test.mts` → FAIL (`geofonEventsToObservations` not exported).

- [ ] **Step 3: Implement.** New service file:

```ts
/**
 * GEOFON (GFZ Potsdam) seismic events via the sidecar proxy. Third
 * independence group for earthquake fusion beside USGS + EMSC.
 */
import { getApiBaseUrl } from '@/services/runtime';

export interface GeofonEvent {
  id: string;
  time: string;
  lat: number;
  lon: number;
  depthKm: number;
  magnitude: number;
  region: string;
}

export async function fetchGeofonSeismic(): Promise<GeofonEvent[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/geofon-seismic`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`geofon-seismic ${res.status}`);
  const data = (await res.json()) as { events?: GeofonEvent[]; error?: string } | null;
  if (!data || data.error || !Array.isArray(data.events)) throw new Error(data?.error ?? 'geofon-seismic malformed');
  return data.events;
}
```

Adapter (append to `earthquake-fusion-observations.ts`):

```ts
import type { GeofonEvent } from '@/services/geofon-seismic';

export function geofonEventsToObservations(events: readonly GeofonEvent[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const e of events) {
    if (!Number.isFinite(e.magnitude) || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    const occurredAt = e.time ? Date.parse(e.time) : Number.NaN;
    if (!Number.isFinite(occurredAt)) continue;
    out.push({ providerId: 'geofon-seismic', value: e.magnitude, lat: e.lat, lon: e.lon, occurredAt, externalId: e.id || undefined });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify PASS**, then commit: `git add src/services/geofon-seismic.ts src/services/earthquake/earthquake-fusion-observations.ts src/services/earthquake/__tests__/earthquake-fusion-observations.test.mts && git commit -m "feat: GEOFON service + fusion adapter"`

### Task 1.3: Register GEOFON + widen the earthquakes fusion domain + loader call

**Files:**
- Modify: `src/services/providers/provider-registry.ts` (after the `emsc-seismic` entry)
- Modify: `src/services/providers/provider-domain-map.ts:35`
- Modify: `src/app/data-loader.ts` (next to `loadEmscSeismic`, ~line 3910)

- [ ] **Step 1: Registry entry:**

```ts
  { id: 'geofon-seismic', domain: 'disasters', displayName: 'GEOFON (GFZ Potsdam)', authType: 'none', baseUrl: 'https://geofon.gfz-potsdam.de', rateLimitNote: 'FDSN event service, fair-use', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.9, fallbackPriority: 6, independenceGroup: 'gfz' },
```

- [ ] **Step 2: Fusion domain:** in `provider-domain-map.ts` change `providerIds: ['usgs-earthquakes', 'emsc-seismic']` → `providerIds: ['usgs-earthquakes', 'emsc-seismic', 'geofon-seismic']`.

- [ ] **Step 3: Loader method** (mirror `loadEmscSeismic` exactly; register it in the same refresh group EMSC uses — find with `grep -n 'loadEmscSeismic' src/app/data-loader.ts`):

```ts
  async loadGeofonSeismic(): Promise<void> {
    try {
      const events = await fetchGeofonSeismic();
      recordDomainObservations('geofon-seismic', geofonEventsToObservations(events), true);
    } catch (error) {
      console.warn('[geofon-seismic] fetch failed', error);
      recordDomainObservations('geofon-seismic', [], false);
    }
  }
```

(No panel update line — GEOFON is fusion-only; the existing earthquakes + emsc-seismic panels keep their sources.)

- [ ] **Step 4: Typecheck + provider tests** — `npm run typecheck:all` (zero) and `npm run test:providers` (green; if a fixture asserts provider counts, update it in the same commit).

- [ ] **Step 5: Commit** — `git commit -m "feat: earthquakes fusion 2→3 independent groups (GEOFON)"`

### Task 1.4: CoinPaprika + Kraken sidecar routes

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (after `/api/crypto-quotes-coinbase`, ~line 10960)

- [ ] **Step 1: Add both routes:**

```js
  // ── CoinPaprika — 3rd crypto fusion group (aggregator, no key).
  if (requestUrl.pathname === '/api/crypto-quotes-coinpaprika') {
    const _cpCached = getCached('crypto-quotes-coinpaprika', 60 * 1000);
    if (_cpCached) return json(_cpCached);
    const CP_IDS = { 'btc-bitcoin': 'BTC', 'eth-ethereum': 'ETH', 'sol-solana': 'SOL', 'xrp-xrp': 'XRP' };
    try {
      const settled = await Promise.allSettled(Object.keys(CP_IDS).map((id) =>
        fetchWithTimeout(`https://api.coinpaprika.com/v1/tickers/${id}?quotes=USD`,
          { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } }, 10_000)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`coinpaprika ${r.status}`))))));
      const quotes = [];
      for (const [i, id] of Object.keys(CP_IDS).entries()) {
        const s = settled[i];
        if (s.status !== 'fulfilled') continue;
        const price = s.value?.quotes?.USD?.price;
        if (Number.isFinite(price) && price > 0) quotes.push({ symbol: CP_IDS[id], price });
      }
      const _cpResult = { quotes };
      setCached('crypto-quotes-coinpaprika', _cpResult, 60 * 1000);
      return json(_cpResult);
    } catch (error) {
      return json({ quotes: [], error: String(error.message ?? error) });
    }
  }

  // ── Kraken public ticker — 4th crypto fusion group (US-reachable exchange).
  if (requestUrl.pathname === '/api/crypto-quotes-kraken') {
    const _krCached = getCached('crypto-quotes-kraken', 60 * 1000);
    if (_krCached) return json(_krCached);
    try {
      const r = await fetchWithTimeout(
        'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,XRPUSD',
        { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } }, 10_000);
      if (!r.ok) throw new Error(`Kraken ${r.status}`);
      const data = await r.json();
      if (data.error?.length) throw new Error(String(data.error[0]));
      // Kraken result keys are exchange-native (XXBTZUSD, XETHZUSD, SOLUSD, XXRPZUSD).
      const SYM = [['XBT', 'BTC'], ['ETH', 'ETH'], ['SOL', 'SOL'], ['XRP', 'XRP']];
      const quotes = [];
      for (const [pair, t] of Object.entries(data.result ?? {})) {
        const hit = SYM.find(([native]) => pair.includes(native));
        const price = Number.parseFloat(t?.c?.[0]);
        if (hit && Number.isFinite(price) && price > 0) quotes.push({ symbol: hit[1], price });
      }
      const _krResult = { quotes };
      setCached('crypto-quotes-kraken', _krResult, 60 * 1000);
      return json(_krResult);
    } catch (error) {
      return json({ quotes: [], error: String(error.message ?? error) });
    }
  }
```

- [ ] **Step 2: Commit** — `git commit -m "feat(sidecar): CoinPaprika + Kraken crypto quote proxies"`

### Task 1.5: CoinPaprika/Kraken fetches + crypto fusion widening (TDD)

**Files:**
- Create: `src/services/market/coinpaprika-fetch.ts`, `src/services/market/kraken-fetch.ts`
- Modify: `src/services/providers/provider-registry.ts`, `src/services/providers/provider-domain-map.ts:51`, `src/app/data-loader.ts:1396-1404`
- Test: `src/services/market/__tests__/crypto-fusion-observations.test.mts` (existing adapter tests already cover the shared `exchangePricesToObservations` path — no new adapter needed)

- [ ] **Step 1: Both fetch files reuse the generic quotes-route shape.** They are structurally `fetchStockRoute` from `stock-fetch.ts`; create each as:

```ts
/**
 * Fail-closed CoinPaprika spot-price fetch — 3rd crypto fusion source.
 * { ok:false } on non-2xx, error payload, or empty quotes (soft failure).
 */
import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

export interface CryptoQuoteFetchResult { ok: boolean; prices: ExchangePrice[] }

export async function fetchCoinpaprikaPrices(): Promise<CryptoQuoteFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/crypto-quotes-coinpaprika`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, prices: [] };
    const data = (await res.json()) as { quotes?: ExchangePrice[]; error?: string } | null;
    if (!data || data.error || !Array.isArray(data.quotes)) return { ok: false, prices: [] };
    const prices = data.quotes.filter((q): q is ExchangePrice => !!q && typeof q.symbol === 'string' && Number.isFinite(q.price) && q.price > 0);
    if (prices.length === 0) return { ok: false, prices: [] };
    return { ok: true, prices };
  } catch {
    return { ok: false, prices: [] };
  }
}
```

`kraken-fetch.ts` is identical except the doc comment, `fetchKrakenPrices` name, and `/api/crypto-quotes-kraken` path. (Two 25-line files beat premature abstraction; if a third copy ever appears, extract a shared `fetchQuotesRoute` then.)

- [ ] **Step 2: Registry entries** (after `coinbase`):

```ts
  { id: 'coinpaprika', domain: 'markets', displayName: 'CoinPaprika', authType: 'none', baseUrl: 'https://api.coinpaprika.com', rateLimitNote: 'free tier, be gentle', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.8, fallbackPriority: 6, independenceGroup: 'coinpaprika' },
  { id: 'kraken', domain: 'markets', displayName: 'Kraken', authType: 'none', baseUrl: 'https://api.kraken.com', rateLimitNote: 'public ticker, no key', freshnessTtlMs: 5 * MIN, reliabilityWeight: 0.85, fallbackPriority: 7, independenceGroup: 'kraken' },
```

- [ ] **Step 3: Fusion domain:** `crypto.providerIds` → `['coingecko', 'coinbase', 'coinpaprika', 'kraken']`.

- [ ] **Step 4: Loader wiring** at `data-loader.ts:1404` (immediately after the coinbase block, same shape):

```ts
    const cp = await fetchCoinpaprikaPrices();
    const cpObservedAt = Date.now();
    recordDomainObservations('coinpaprika', exchangePricesToObservations('coinpaprika', cp.prices, cpObservedAt), cp.ok, cpObservedAt);
    const kr = await fetchKrakenPrices();
    const krObservedAt = Date.now();
    recordDomainObservations('kraken', exchangePricesToObservations('kraken', kr.prices, krObservedAt), kr.ok, krObservedAt);
```

- [ ] **Step 5: Verify + commit** — `npm run typecheck:all` zero, `npm run test:providers` green → `git commit -m "feat: crypto fusion 2→4 independent groups (CoinPaprika, Kraken)"`

### Task 1.6: ~~Stooq~~ → FMP third equities corroborator

> **AMENDED during execution (2026-07-29):** Stooq is fully bot-walled — the daily CSV endpoint returns an HTTP-200 JavaScript proof-of-work challenge page to every non-browser client (verified with multiple UAs; the earlier liveness probe only checked the status code). A Node fetch can never pass it, so Stooq was dropped and replaced with **Financial Modeling Prep** (`FMP_API_KEY` already in both allowlists, `financialmodelingprep.com` already in the sidecar allowed-hosts list, `/api/v3/quote` verified alive). FMP is keyed (Finnhub-pattern: degraded when key absent) with REAL per-quote epoch timestamps — which also eliminates the DST-blind 20:00Z close-stamp problem the Stooq design had. The `STOCK_FUSION_SYMBOLS` extraction survives. Original Stooq task text kept below for the record; do not implement it.

Stooq's live-quote endpoint is gone (404 verified); the daily CSV survives ~~(WRONG — see amendment)~~. **Honesty rule:** `occurredAt` = the CSV row's session close (20:00 UTC), so Stooq only corroborates Yahoo/Finnhub inside the 3-minute match window around close — the rest of the day it is a health-monitored warm spare, not a fake live vote.

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (after the `/api/stocks-yahoo` route — `grep -n "'/api/stocks-yahoo'"`; copy that route's symbol list verbatim, appending `.us` per symbol)
- Create: `src/services/market/stooq-fetch.ts`
- Modify: `provider-registry.ts`, `provider-domain-map.ts:60`, `data-loader.ts:1412`

- [ ] **Step 1: Sidecar route:**

```js
  // ── Stooq EOD stock quotes — 3rd equities group. Daily CSV only (the
  // live-quote path 404s since 2026); timestamps pinned to session close
  // so fusion never mistakes EOD data for a live tick.
  if (requestUrl.pathname === '/api/stocks-stooq') {
    const _sqCached = getCached('stocks-stooq', 30 * 60 * 1000);
    if (_sqCached) return json(_sqCached);
    try {
      const SYMBOLS = STOCK_FUSION_SYMBOLS; // shared const introduced beside the yahoo route's list
      const settled = await Promise.allSettled(SYMBOLS.map((s) =>
        fetchWithTimeout(`https://stooq.com/q/d/l/?s=${s.toLowerCase()}.us&i=d`,
          { headers: { 'User-Agent': CHROME_UA } }, 12_000).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`stooq ${r.status}`))))));
      const quotes = [];
      for (const [i, s] of SYMBOLS.entries()) {
        const res = settled[i];
        if (res.status !== 'fulfilled') continue;
        const rows = res.value.trim().split('\n');
        const last = rows[rows.length - 1]?.split(',');   // Date,Open,High,Low,Close,Volume
        const close = Number.parseFloat(last?.[4]);
        const dateMs = Date.parse(`${last?.[0]}T20:00:00Z`);
        if (Number.isFinite(close) && close > 0 && Number.isFinite(dateMs)) quotes.push({ symbol: s, price: close, observedAt: dateMs });
      }
      const _sqResult = { quotes };
      setCached('stocks-stooq', _sqResult, 30 * 60 * 1000);
      return json(_sqResult);
    } catch (error) {
      return json({ quotes: [], error: String(error.message ?? error) });
    }
  }
```

Also extract the yahoo route's inline symbol array into a top-level `const STOCK_FUSION_SYMBOLS = [...]` used by both routes (single source of truth for the fused ticker set).

- [ ] **Step 2: `stooq-fetch.ts`** — same fail-closed shape as Task 1.5 but the payload rows carry `observedAt`:

```ts
import { getApiBaseUrl } from '@/services/runtime';

export interface StooqQuote { symbol: string; price: number; observedAt: number }
export interface StooqFetchResult { ok: boolean; quotes: StooqQuote[] }

export async function fetchStooqPrices(): Promise<StooqFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/stocks-stooq`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, quotes: [] };
    const data = (await res.json()) as { quotes?: StooqQuote[]; error?: string } | null;
    if (!data || data.error || !Array.isArray(data.quotes)) return { ok: false, quotes: [] };
    const quotes = data.quotes.filter((q): q is StooqQuote =>
      !!q && typeof q.symbol === 'string' && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.observedAt));
    if (quotes.length === 0) return { ok: false, quotes: [] };
    return { ok: true, quotes };
  } catch {
    return { ok: false, quotes: [] };
  }
}
```

- [ ] **Step 3: Registry + domain + loader.** Registry: `{ id: 'stooq', domain: 'equities', displayName: 'Stooq (EOD)', authType: 'none', baseUrl: 'https://stooq.com', rateLimitNote: 'daily CSV, cache 30m', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.7, fallbackPriority: 3, independenceGroup: 'stooq' }`. Domain: `stocks.providerIds` → `['yahoo-finance', 'finnhub', 'stooq']`. Loader (after the finnhub block at `data-loader.ts:1412`) — note the per-row timestamps:

```ts
    const stooq = await fetchStooqPrices();
    recordDomainObservations('stooq',
      stooq.quotes.map((q) => ({ providerId: 'stooq', key: q.symbol.toUpperCase(), value: q.price, lat: 0, lon: 0, occurredAt: q.observedAt })),
      stooq.ok);
```

- [ ] **Step 4: Verify + commit** — typecheck zero, provider tests green → `git commit -m "feat: equities fusion gains Stooq EOD corroborator (honest close-time stamps)"`

### Task 1.7: AirNow + PurpleAir into air-quality fusion (keys already provisioned)

`AIRNOW_API_KEY` + `PURPLEAIR_API_KEY` are already in both allowlists and the sidecar already talks to both (`/api/airnow/forecast`, `/api/airquality/purpleair`) — this task adds *current-observation* fusion feeds. Missing key ⇒ route returns `degraded:true` ⇒ fetch records failure (the Finnhub-established pattern for optional keyed providers).

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (new `/api/airnow/current` route beside `/api/airnow/forecast` at ~13265; reuse the existing PurpleAir route as-is)
- Create: `src/services/airquality/airnow-fusion-fetch.ts`, `src/services/airquality/purpleair-fusion-fetch.ts`
- Modify: `src/services/airquality/airquality-fusion-observations.ts` (two new adapters), `provider-registry.ts`, `provider-domain-map.ts:43`, `data-loader.ts:2482-2514`
- Test: `src/services/airquality/__tests__/airquality-fusion-observations.test.mts` (extend)

- [ ] **Step 1: Failing tests first** (append; mirror the existing openaq cases):

```ts
import { airnowToObservations, purpleairToObservations } from '../airquality-fusion-observations';

test('airnowToObservations takes worst AQI per site and drops invalid rows', () => {
  const obs = airnowToObservations([
    { lat: 41.6, lon: -86.7, aqi: 62, parameter: 'PM2.5', observedAt: 1_753_800_000_000 },
    { lat: 41.6, lon: -86.7, aqi: 41, parameter: 'O3', observedAt: 1_753_800_000_000 },
    { lat: 10, lon: 10, aqi: Number.NaN, parameter: 'PM2.5', observedAt: 1_753_800_000_000 },
  ]);
  assert.equal(obs.length, 1);           // same site collapses to worst reading
  assert.equal(obs[0].value, 62);
  assert.equal(obs[0].providerId, 'airnow');
});

test('purpleairToObservations converts PM2.5 to AQI via EPA breakpoints', () => {
  const obs = purpleairToObservations([{ lat: 41.6, lon: -86.7, pm25: 35.5, observedAt: 1_753_800_000_000 }]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 101);       // 35.5 µg/m³ = AQI 101 boundary
});
```

- [ ] **Step 2: Run → FAIL**, then implement the adapters (append to `airquality-fusion-observations.ts`):

```ts
export interface AirnowReading { lat: number; lon: number; aqi: number; parameter: string; observedAt: number }
export interface PurpleairReading { lat: number; lon: number; pm25: number; observedAt: number }

export function airnowToObservations(readings: readonly AirnowReading[]): DomainObservation[] {
  const bySite = new Map<string, DomainObservation>();
  for (const r of readings) {
    if (!Number.isFinite(r.aqi) || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.observedAt)) continue;
    const site = `${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
    const prev = bySite.get(site);
    if (!prev || r.aqi > prev.value) {
      bySite.set(site, { providerId: 'airnow', value: r.aqi, lat: r.lat, lon: r.lon, occurredAt: r.observedAt });
    }
  }
  return [...bySite.values()];
}

// EPA PM2.5 (24h) AQI breakpoints — self-contained so the adapter stays pure.
const PM25_BREAKPOINTS: readonly [number, number, number, number][] = [
  [0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500],
];

export function pm25ToAqi(pm25: number): number | undefined {
  for (const [cLo, cHi, aLo, aHi] of PM25_BREAKPOINTS) {
    if (pm25 >= cLo && pm25 <= cHi) return Math.round(((aHi - aLo) / (cHi - cLo)) * (pm25 - cLo) + aLo);
  }
  return undefined;
}

export function purpleairToObservations(readings: readonly PurpleairReading[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const r of readings) {
    if (!Number.isFinite(r.pm25) || r.pm25 < 0 || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.observedAt)) continue;
    const aqi = pm25ToAqi(r.pm25);
    if (aqi === undefined) continue;
    out.push({ providerId: 'purpleair', value: aqi, lat: r.lat, lon: r.lon, occurredAt: r.observedAt });
  }
  return out;
}
```

- [ ] **Step 3: Sidecar `/api/airnow/current`** (beside the forecast route; same key handling it uses — copy its `AIRNOW_API_KEY` guard, returning `{ degraded: true }` when absent):

```js
  if (requestUrl.pathname === '/api/airnow/current') {
    const key = process.env.AIRNOW_API_KEY;
    if (!key) return json({ degraded: true, readings: [] });
    const lat = Number.parseFloat(requestUrl.searchParams.get('lat') ?? '');
    const lon = Number.parseFloat(requestUrl.searchParams.get('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'lat/lon required', readings: [] }, 400);
    const _anCacheKey = `airnow-current:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const _anCached = getCached(_anCacheKey, 30 * 60 * 1000);
    if (_anCached) return json(_anCached);
    try {
      const r = await fetchWithTimeout(
        `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lon}&distance=75&API_KEY=${key}`,
        { headers: { 'User-Agent': CHROME_UA } }, 12_000);
      if (!r.ok) throw new Error(`AirNow ${r.status}`);
      const rows = await r.json();
      const readings = (Array.isArray(rows) ? rows : [])
        .map((o) => ({
          lat: o.Latitude, lon: o.Longitude, aqi: o.AQI, parameter: o.ParameterName,
          observedAt: Date.parse(`${o.DateObserved?.trim()}T${String(o.HourObserved ?? 0).padStart(2, '0')}:00:00${o.LocalTimeZone ? '' : 'Z'}`),
        }))
        .filter((o) => Number.isFinite(o.aqi) && Number.isFinite(o.observedAt));
      const _anResult = { readings };
      setCached(_anCacheKey, _anResult, 30 * 60 * 1000);
      return json(_anResult);
    } catch (error) {
      return json({ readings: [], error: String(error.message ?? error) });
    }
  }
```

- [ ] **Step 4: Fail-closed fetches.** `airnow-fusion-fetch.ts` calls `/api/airnow/current?lat=..&lon=..` for the same coordinates the Open-Meteo AQ path uses (read them from the same saved-place source `data-loader.ts:2507` context uses) and returns `{ ok, readings: AirnowReading[] }` with the standard `degraded/error/empty ⇒ ok:false` ladder. `purpleair-fusion-fetch.ts` calls the existing `/api/airquality/purpleair`, maps sensor rows to `PurpleairReading` (`{ lat: s.latitude, lon: s.longitude, pm25: s['pm2.5_10minute'] ?? s.pm25, observedAt: (s.last_seen ?? nowSec) * 1000 }` — confirm exact field names against the live route response before finalizing the mapper), same ladder.

- [ ] **Step 5: Registry + domain + loader.** Registry entries:

```ts
  { id: 'airnow', domain: 'air_quality', displayName: 'AirNow (EPA)', authType: 'free_key', requiredSecret: 'AIRNOW_API_KEY', baseUrl: 'https://www.airnowapi.org', rateLimitNote: '500 req/hr keyed', freshnessTtlMs: HOUR, reliabilityWeight: 0.9, fallbackPriority: 3, independenceGroup: 'epa-airnow' },
  { id: 'purpleair', domain: 'air_quality', displayName: 'PurpleAir', authType: 'free_key', requiredSecret: 'PURPLEAIR_API_KEY', baseUrl: 'https://api.purpleair.com', rateLimitNote: 'keyed, point-based', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.75, fallbackPriority: 4, independenceGroup: 'purpleair' },
```

Domain: `air_quality.providerIds` → `['open-meteo-aqi', 'openaq-v3', 'airnow', 'purpleair']`. (Group honesty note: AirNow stations feed OpenAQ too, but AirNow-direct vs OpenAQ-aggregated differ in latency and QC; keep separate groups and let live disagreement data justify a merge later.) Loader: two new `recordDomainObservations` blocks in the air-quality section (`data-loader.ts:2482-2514`), same fail-closed shape as the openaq block.

- [ ] **Step 6: Verify + commit** — adapter tests, `typecheck:all` zero, `test:providers` green → `git commit -m "feat: air-quality fusion 2→4 groups (AirNow + PurpleAir current observations)"`

### Task 1.8: Batch 1 PR

- [ ] Rebase onto fresh `origin/main` (data-loader/sidecar conflict magnets), re-run `npm run typecheck:all && npm run test:providers && npm run smoke:offline && npm run secrets:scan`.
- [ ] Push `claude/api-fusion-batch1`; open PR titled "Fusion expansion batch 1: 3rd+ votes for all four fused domains" with body containing `cross-agent review: Codex`; run the real Codex review; `gh pr merge <N> --auto --squash`.

---

# Batch 2 — Four new fused domains (PR 2)

`FusionDomainKey` grows: `'surface_temp' | 'fx_rates' | 'radiation' | 'internet_outages'`. Each follows the exact Batch-1 recipe (route → fail-closed fetch → pure adapter → registry → `FUSION_DOMAINS` → loader), so tasks below specify only the domain-specific deltas — the step sequence (failing test → implement → typecheck → commit) is identical per task.

### Task 2.0 (added from Batch-1 review findings): shared pure geo-math module

Open Batch 2 with `src/services/geo/geo-math.ts`: exported pure `haversineKm` + generic `filterNearby<T extends {lat: number; lon: number}>(items, lat, lon, radiusKm)`. Migrate the two fusion-layer copies (`fusion-ingest.ts` private helper, `airquality-fusion-observations.ts` local copy from the Batch-1 PurpleAir cap) and use it for every new spatial domain in this batch (radiation) and Batch 3 (volcano). The five legacy private haversine copies (`proximity-cascade`, `emergency-broadcast`, `forecast-engine`, `custom-geofence`, `proximity-filter`) migrate opportunistically, not in this program. Also carried from Batch-1 review: a separate coordinated follow-up task (NOT in this program's PRs) should fix `sidecarParseV1Sensors`' lastSeen-in-seconds bug at source and remove the ×1000 compensation in `purpleair-fusion-fetch.ts` (which now carries a plausibility guard).

### Task 2.1: Extend the fusion key union

**Files:** Modify `src/services/providers/provider-domain-map.ts:31`

- [ ] **Step 1:**

```ts
export type FusionDomainKey =
  | 'earthquakes' | 'air_quality' | 'crypto' | 'stocks'
  | 'surface_temp' | 'fx_rates' | 'space_weather' | 'internet_outages';
```

(`'space_weather'` replaces the originally-planned `'radiation'` — see Task 2.4 AMENDED. Do NOT add a `'radiation'` key; the domain is deferred, and an unconfigured key would make `FUSION_DOMAINS` non-exhaustive.)

Add the four configs (each detailed in its own task below), typecheck, commit per-domain as each lands.

### Task 2.2: Surface temperature — Open-Meteo + MET Norway

Distinct groups: `open-meteo` (model ensemble) vs `met-norway` (national met institute). NWS observations can join later as a third group.

**Re-probed 2026-07-30 (body, not status):** 200 with the identifying UA; `properties.meta.units.air_temperature === 'celsius'` (assert this rather than assuming — the adapter must not silently ingest Fahrenheit if MET ever changes it), `properties.timeseries[0].data.instant.details.air_temperature = 19.1`, `time = '2026-07-30T03:00:00Z'` (explicit `Z`, so no UTC-coercion trap here — unlike NOAA Kp in Task 2.4). **Gotcha:** `timeseries[0].time` is the next *hour boundary at or after* the model run, so it can be up to ~1h in the **future** relative to `now`. `fuseObservations` clamps future timestamps to zero age (`age = max(0, now − min(observedAt, now))`), so a future stamp reads as maximally fresh rather than erroring — acceptable, but the 90-min match window is what absorbs the offset against Open-Meteo's now-stamped `current`. Do not tighten `maxTimeDeltaMs` below 90 min or the pair will intermittently stop matching.

**SECOND timezone trap, found 2026-07-30 — this one is on the Open-Meteo side.** The existing `/api/weather/local-forecast` route calls Open-Meteo with `timezone=auto`, and Open-Meteo then returns **offset-less LOCAL wall-clock** times: live probe for La Porte IN gave `current: { time: '2026-07-29T23:00', temperature_2m: 17.7 }` with `utc_offset_seconds: -18000`, `timezone: 'America/Chicago'`. `Date.parse('2026-07-29T23:00')` parses that as the *browser's* local zone — accidentally correct only when the saved place happens to share the user's timezone, and silently hours wrong otherwise, which blows the 90-min match window exactly like the GEOFON/AirNow/NOAA-Kp traps. Convert in the **sidecar route** (fix it once, server-side, so the renderer adapter stays pure and dumb):

```js
const observedAt = Date.parse(`${data.current.time}Z`) - (data.utc_offset_seconds ?? 0) * 1000;
```

Verified against the live pair: Open-Meteo 23:00 local → 04:00Z Jul 30; MET Norway's first entry is 03:00:00Z Jul 30 — **1 h apart**, comfortably inside the 90-min window and useless outside it. Do NOT switch the shared route to `timezone=UTC` to dodge this; `weather-forecast-adapter.ts` consumes the same route's `hourly` block and its local-time semantics are load-bearing there.

**Files:**
- Modify: `local-api-server.mjs` — new route `/api/met-norway-temp?lat=&lon=` proxying `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=..&lon=..`; **MET Norway TOS requires an identifying User-Agent** — use `'CrystalBall/1.0 github.com/bradleybond512/crystal-ball'`, NOT `CHROME_UA`. Response value: `properties.timeseries[0].data.instant.details.air_temperature` + the entry's `time` as `observedAt`. Cache 30 min per rounded coord.
- Create: `src/services/weather/weather-fusion-observations.ts` — pure adapter `tempToObservations(providerId, readings: {lat,lon,tempC,observedAt}[])` → `DomainObservation[]` (value = °C), plus `src/services/weather/met-norway-fetch.ts` + an Open-Meteo current-temp fail-closed fetch `src/services/weather/open-meteo-temp-fetch.ts` (Open-Meteo `current=temperature_2m` for the same saved-place coords; direct Open-Meteo calls already flow through the sidecar's existing open-meteo plumbing — reuse whichever `/api/` route `grep -n 'open-meteo' src-tauri/sidecar/local-api-server.mjs` shows serves forecasts, adding `current=temperature_2m` support if absent).
- Modify: registry (+`met-norway`, and confirm `open-meteo-forecast` already registered — it is, `provider-registry.ts:28`), domain map, data-loader (weather refresh section).
- Test: `src/services/weather/__tests__/weather-fusion-observations.test.mts`.

- [ ] Registry: `{ id: 'met-norway', domain: 'weather', displayName: 'MET Norway', authType: 'none', baseUrl: 'https://api.met.no', rateLimitNote: 'no key; identifying User-Agent REQUIRED by TOS', freshnessTtlMs: HOUR, reliabilityWeight: 0.9, fallbackPriority: 3, independenceGroup: 'met-norway' }`
- [ ] Domain config:

```ts
  // Same-place same-hour temps from independent models should agree within
  // ~2.5°C; larger gaps are real forecast disagreement worth surfacing.
  surface_temp: {
    providerIds: ['open-meteo-forecast', 'met-norway'],
    numericTolerance: 2.5,
    match: { maxDistanceKm: 25, maxTimeDeltaMs: 90 * 60_000 },
  },
```

- [ ] Fixture test: two readings 1°C apart at the same coord → 1 fused fact, no disagreement; 5°C apart → disagreement surfaces (assert via `ingestDomain('surface_temp', ...)` like the existing `fusion-ingest` tests — copy the earthquake test's structure).

### Task 2.3: FX rates — Frankfurter (ECB) + open.er-api.com

**Files:**
- Modify: `local-api-server.mjs` — new route `/api/fx-rates-erapi` proxying `https://open.er-api.com/v6/latest/USD` (cache 6h; forward `{ rates, time_last_update_unix }`; treat `result !== 'success'` as error).
- Create: `src/services/market/fx-fusion-fetch.ts` — two fail-closed fetches (`fetchFrankfurterRates` reading the existing `/api/fx-rates?base=USD&symbols=EUR,GBP,JPY,CHF,CAD,AUD,CNY`, `fetchErApiRates` reading the new route) + pure `fxRatesToObservations(providerId, rates: Record<string,number>, observedAt)` → key-matched observations (`key` = currency code, `value` = units per USD, `lat/lon` = 0).
- Modify: registry (+`er-api-fx`), domain map, data-loader.
- Test: `src/services/market/__tests__/fx-fusion.test.mts`.

- [ ] Registry: `{ id: 'er-api-fx', domain: 'fx', displayName: 'ExchangeRate-API (open)', authType: 'none', baseUrl: 'https://open.er-api.com', rateLimitNote: 'free endpoint, daily refresh', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.8, fallbackPriority: 2, independenceGroup: 'er-api' }`
- [ ] Domain config (both sources refresh ~daily — window must span a day):

```ts
  fx_rates: {
    providerIds: ['frankfurter-fx', 'er-api-fx'],
    toleranceMode: 'relative',
    numericTolerance: 0.005,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 26 * 60 * 60_000 },
  },
```

- [ ] Fixture test: EUR at 0.9200 vs 0.9210 → agree; EUR 0.92 vs 0.98 → disagreement row names both providers.

**AMENDED 2026-07-30 — widen `numericTolerance` to `0.01` (1%).** Live side-by-side probe of the two upstreams (same minute): EUR 0.87873 (Frankfurter/ECB) vs 0.875576 (er-api) = **0.36% apart**; GBP 0.24% apart; JPY 0.09% apart. The specced 0.005 (0.5%) leaves only 0.14% of headroom above the *observed steady-state* gap, so EUR would flip to "disagreement" on any ordinary day the ECB fixing and er-api's snapshot drift slightly further apart. That is a permanent false-positive, which trains the user to ignore the disagreement flag — the opposite of the invariant's intent. 1% still catches a genuinely broken feed (a stale-by-days rate or a wrong base currency moves far more than 1%). Comment the observed 0.36% baseline next to the constant so the number is not mistaken for a guess. The two sources differ structurally — ECB daily reference fixing vs a continuously-updated aggregator — so a small persistent gap is expected, not a defect.

**AMENDED 2026-07-30 (second probe) — `maxTimeDeltaMs` MUST widen from 26 h to 5 days, or this domain silently stops fusing every weekend.**

Live probe of both upstreams on 2026-07-30:

| | timestamp field | resolved instant |
|---|---|---|
| Frankfurter | `date: "2026-07-29"` (date-only) | `2026-07-29T00:00:00.000Z` |
| open.er-api | `time_last_update_unix: 1785369751` (epoch **seconds**, ×1000) | `2026-07-30T00:02:31.000Z` |

That is a **24.04-hour gap on an ordinary weekday** — the specced 26 h window clears it by less than two hours.

It does not clear a weekend. Frankfurter is ECB reference data and the ECB does not publish on weekends or TARGET holidays. Verified directly: querying `https://api.frankfurter.dev/v1/2026-07-26` (a Sunday) returns `date: "2026-07-24"` — **Friday's** fixing. So:

- Sunday: Frankfurter stamped Friday 00:00Z vs er-api Sunday 00:02Z ⇒ **~48 h**
- Monday before the ~16:00 CET fixing: Frankfurter still Friday vs er-api Monday ⇒ **~72 h**
- Christmas / Easter TARGET closures run longer still

At 26 h the pair simply never matches on those days, `fx_rates` reports a single source, and the UI quietly shows a SPOF instead of corroboration — for roughly 2 days in 7. A silent 29%-of-the-time outage is precisely the failure this program exists to eliminate, and it would read as "working fine" from the outside.

```ts
  fx_rates: {
    providerIds: ['frankfurter-fx', 'er-api-fx'],
    toleranceMode: 'relative',
    numericTolerance: 0.01,
    // 5 days, NOT the minutes-scale window the spatial domains use. Frankfurter
    // stamps observations with the ECB *fixing date* (UTC midnight) and the ECB
    // does not publish on weekends or TARGET holidays — a Sunday query returns
    // Friday's fixing, so the two sources sit ~48 h apart every weekend and ~72 h
    // apart on Monday morning. Anything tighter makes this domain stop
    // corroborating for 2 days in 7 without any visible error. Do not "tidy" this
    // number down.
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 5 * 24 * 60 * 60_000 },
  },
```

**Do NOT "fix" this by stamping Frankfurter observations with the fetch time.** That would hide genuine staleness — a Frankfurter serving a three-week-old fixing would look perfectly fresh. Keep `observedAt` honest and let freshness decay do its job (below).

**Corollary — do NOT change `frankfurter-fx.freshnessTtlMs` (currently 12 h).** With honest fixing-date stamping, Frankfurter's freshness score in `source-fusion.ts` (`max(0, 1 - age/ttl)`) will sit at **0** essentially always, since the latest fixing is ≥24 h old by construction. That is acceptable and should be left alone:

- Freshness carries weight 0.25 while corroboration carries 0.5, so a corroborated pair still scores well; the mean across the two providers lands near 0.5 on freshness.
- `freshnessTtlMs` has **two consumers on different time bases**: `source-fusion.ts:59` measures against `observedAt` (the fixing date — stale by design), while `provider-health.ts:76` measures against `lastSuccessAt` (the fetch time — minutes old, healthy). Raising the TTL to flatter the fusion score would simultaneously blind health detection, letting a genuinely dead Frankfurter go unflagged for days.
- `provider-registry.test.mts:96` pins the 12 h value, so changing it breaks an existing test for no benefit.

**Other probe findings for the implementer:**

- **Host migration is already handled.** `api.frankfurter.app` now 301-redirects to `api.frankfurter.dev/v1`, and the existing `/api/fx-rates` route (`local-api-server.mjs:17588`) already points at the new host. No change needed — just do not "restore" the old domain.
- **`toleranceMode: 'relative'` is load-bearing, not a style choice.** Absolute 0.01 would pass for EUR/GBP/CHF (values ~0.75–0.88) and fail permanently for every high-magnitude pair — measured absolute gaps: JPY 0.149, KRW 3.36, SEK 0.028, MXN 0.013, INR 0.106. All are ≤0.36% relative. Relative mode makes one constant work across the whole basket.
- **Currency sets differ: Frankfurter exposes 29, er-api 166.** Only the intersection can ever fuse. Keep the existing route's `symbols=EUR,GBP,JPY,CHF,CAD,AUD,CNY` — all seven verified present in both. Do not attempt to fuse er-api's full 166.
- **`api.frankfurter.dev` returned a transient Cloudflare 522** during probing, then three consecutive 200s at ~85 ms. The fail-closed ladder must treat 5xx as `ok: false` (it will) and the degraded response must be returned **uncached**, or one unlucky 522 pins the domain dark for the whole 6 h cache TTL.

### Task 2.4 AMENDED (2026-07-30): Radiation is DEFERRED — `space_weather` (Kp index) takes its slot

**Why radiation was cut.** Re-probing the bodies (the Batch-1 Stooq lesson) showed the
BfS+Safecast pair is *structurally incapable* of corroborating anything:

1. Safecast's `order=captured_at+desc` **is silently ignored** — the API returns
   oldest-first regardless. The working recency param is `captured_after=<ISO date>`.
   The originally-specced "drop rows older than 24h" filter would therefore have
   discarded 100% of every page and left Safecast permanently fail-closed.
2. Safecast's live coverage is one fixed station in Surrey, England
   (51.108658, −0.218624). Near Munich — BfS ODL's heartland, 1,679 stations — the
   newest Safecast reading is 2026-03-13 (4.5 months stale). Near the user's home
   (La Porte, IN) it is **2015**.
3. BfS ODL is Germany-only. So the specced 30 km / 3 h match window can never fire
   for any user, and the domain would ship a permanently single-source card.

Building it would add a redundancy metric that is honest-but-useless at best. Radiation
stays a single-source feed until a genuinely live second source is found (EURDEP needs
registration; EPA RadNet publishes no open JSON API — both re-checked 2026-07-30).

**What replaces it: `space_weather` — NOAA SWPC Kp vs GFZ Potsdam Kp.** A clean fusable
pair: identical scalar (planetary K index), identical 3-hour bins, global (no spatial
constraint), both no-key, both live and fresh. Verified 2026-07-30:

- NOAA SWPC `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` → 200,
  array-of-objects `{time_tag, Kp, a_running, station_count}`; latest `2026-07-30T00:00:00` Kp=1.
  **`time_tag` carries NO timezone suffix** — this is the exact GEOFON/AirNow trap; append `Z`
  before `Date.parse` or it parses as LOCAL and blows the match window.
- GFZ `https://kp.gfz.de/app/json/?start=<ISO>&end=<ISO>&index=Kp` → 200 (note: `kp.gfz-potsdam.de`
  301-redirects to `kp.gfz.de` — pin the new host, and `curl -L` when probing).
  Column-oriented `{Kp:[], datetime:[], status:[], meta}`; `datetime` IS `Z`-suffixed;
  `status` is `'def'` (definitive) or `'pre'` (preliminary).
- Live agreement check at `2026-07-30T00:00:00Z`: NOAA Kp=1 vs GFZ Kp=0.667 — a real 0.333
  delta. Two institutions, two algorithms, genuinely different answers: exactly the signal
  fusion exists to surface.

**Independence honesty (must be commented in the registry entry):** SWPC's *estimated* Kp
and GFZ's *definitive* Kp draw on partially overlapping magnetometer observatories (8 vs 13
stations). Different institutions, different algorithms, independently published — so they
earn separate independence groups — but the input overlap is partial, not zero. Do not
describe them as fully independent anywhere in code or UI.

**Files:**
- Modify: `local-api-server.mjs` — new route `/api/spaceweather-kp-gfz` proxying the GFZ URL
  above with a rolling 48h window (`start` = now−48h, `end` = now, both `toISOString()`),
  cache 30 min, `Accept: application/json`. Fail like the BfS route: non-2xx →
  `{ samples: [], degraded: true, reason: 'gfz-kp upstream <status>' }` at 502. Zero valid
  samples → also `degraded: true`, returned **uncached** so the next poll retries (the
  CoinPaprika/Kraken convention from Batch 1). Transpose the column arrays into
  `{ observedAt: <ms>, kp: <number>, status: 'def'|'pre' }` rows in a named exported parser
  (`parseGfzKp`) so the Task-2.6 route contract tests can reach it.
- Create: `src/services/spaceweather/kp-fusion-observations.ts` — pure
  `kpToObservations(providerId, samples: {observedAt:number; kp:number}[])` → `DomainObservation[]`
  (`matchBy:'key'`, `key` = the 3-hour bin start as an ISO string so the two sources align on
  bin rather than on wall-clock proximity; `value` = Kp; `lat/lon` = 0). Drop non-finite Kp,
  Kp outside 0..9, and rows whose `observedAt` is not a finite positive number.
  Plus `src/services/spaceweather/gfz-kp-fetch.ts` (fail-closed, 15s timeout — above the
  sidecar's 12s) and a NOAA-side mapper over the **existing** `normalizeKpPoints` output
  (`local-api-server.mjs:~3010` already fetches the NOAA Kp product for
  `/api/spaceweather/status`; reuse that, do NOT add a second NOAA fetch).
- Modify: registry (+`gfz-kp`), domain map, data-loader (space-weather refresh section).
- Test: `src/services/spaceweather/__tests__/kp-fusion-observations.test.mts`.

- [ ] Registry: `{ id: 'gfz-kp', domain: 'space_weather', displayName: 'GFZ Potsdam Kp', authType: 'none', baseUrl: 'https://kp.gfz.de', rateLimitNote: 'no key; definitive/preliminary Kp, 3h bins', freshnessTtlMs: 3 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 2, independenceGroup: 'gfz' }` — reliability 0.95: GFZ publishes *the* IAGA-endorsed Kp. `freshnessTtlMs` is 3h because the product itself only advances every 3h; a tighter TTL would flag a healthy feed as stale. Group `'gfz'` is correct and intentional — same institution as `geofon-seismic`; within `space_weather` it is the only `gfz` member, so it still earns its own vote.
- [ ] Domain config:

```ts
  // Same 3-hour bin, two institutions, two algorithms. Kp is quantized to
  // thirds, so ±0.5 accepts one quantization step of honest methodological
  // difference (observed live: 1 vs 0.667) while still surfacing the ≥1-step
  // gaps that mean the two networks genuinely disagree about storm level.
  space_weather: {
    providerIds: ['swpc-kp', 'gfz-kp'],
    numericTolerance: 0.5,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 3 * 60 * 60_000 },
  },
```

- [ ] Registry also needs a `swpc-kp` entry (the existing `swpc-ovation` / `swpc-solar-regions` rows are different products and must NOT be reused as the Kp voter): same shape as `gfz-kp` but `displayName: 'SWPC Planetary Kp (estimated)'`, `baseUrl: 'https://services.swpc.noaa.gov'`, `reliabilityWeight: 0.9`, `fallbackPriority: 1`, `independenceGroup: 'noaa-swpc'`.
- [ ] Fixture test: same bin, Kp 1.0 vs 0.667 → 1 fused fact, **no** disagreement; Kp 1.0 vs 4.0 → disagreement row naming both providers. Plus a suffix-less-`time_tag` case proving UTC coercion (a `'2026-07-30T00:00:00'` NOAA tag and a `'2026-07-30T00:00:00Z'` GFZ tag must land in the SAME bin — this is the regression that would silently kill the domain).

#### AMENDED 2026-07-30 (second probe): `numericTolerance` MUST be 1.5, not 0.5 — and never filter on `status`

The `0.5` above was calibrated from **one** sample (`1 vs 0.667`), which turns out to be the
*median* case, not a typical worst case. Re-probed by aligning every overlapping 3-hour bin
across the full 7.5-day SWPC window (60 matched bins, 2026-07-23 → 2026-07-30):

| statistic | \|SWPC − GFZ\| |
|---|---|
| median | 0.333 |
| p90 | 0.670 |
| p95 / max | 1.003 |
| bins > 0.5 | **16 / 60 (26.7 %)** |
| bins > 1.0 | 3 / 60 (5 %) |
| bins > 1.5 | **0 / 60** |

At `0.5` this domain would report a **disagreement in more than one bin in four** on an
ordinary, storm-free week — capping `confidenceMultiplier` at 0.6 and painting the
Source Confidence card as "sources disagree" a quarter of the time for no real reason.
That is worse than not fusing at all: it trains the user to ignore the disagreement flag.

Root cause: SWPC's *estimated* Kp is quantized to thirds just like GFZ's, and the two
networks (8 vs 13 observatories, different algorithms) routinely land **two** steps apart
(0.667) and sometimes **three** (1.003). A `0.5` tolerance admits only ONE step.

```ts
  // 60 overlapping bins measured 2026-07-23..2026-07-30: median 0.333, p95 1.003,
  // max 1.003, and ZERO bins above 1.5. SWPC-estimated and GFZ-definitive Kp are
  // both quantized to thirds and routinely sit 2-3 quantization steps apart, so
  // anything at or below 1.0 false-flags a quiet week as a disagreement (0.5 does
  // it in 26.7% of bins). 1.5 clears the measured max with headroom while still
  // catching the >=2-unit gaps that mean the networks genuinely disagree about
  // storm level (Kp 2 "quiet" vs Kp 5 "G1 storm" is a 3.0 delta). Do NOT tighten
  // this without re-running the bin-alignment measurement.
  space_weather: {
    providerIds: ['swpc-kp', 'gfz-kp'],
    numericTolerance: 1.5,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 3 * 60 * 60_000 },
  },
```

Adjust the fixture test accordingly: `1.0 vs 0.667` → no disagreement (unchanged intent),
and the disagreement case must move from `1.0 vs 4.0` to a gap that clears 1.5 — use
**`2.0 vs 5.0`** (quiet-vs-G1-storm), which is the disagreement this domain actually exists
to surface. Add a regression case at **`2.0 vs 1.333`** (a real measured pair) asserting
**no** disagreement — that is the exact false-positive the 0.5 tolerance produced.

**`status` is `'pre'` for all live data — never require `'def'`.** The description above is
literally true but operationally misleading. Probed: 2026-03-01 → `["def"]`; 2026-07-15 and
2026-07-29 → `["pre"]`. Definitive Kp is only certified months in arrears, so **100 % of the
rows fusion will ever see are `'pre'`**. A `status === 'def'` filter (or a preference that
drops `'pre'`) would leave GFZ permanently fail-closed — the identical defect class to
Safecast's silently-ignored `order=` param that killed the radiation domain. Carry `status`
through to the parsed row for provenance, but **do not filter on it**.

**GFZ requires both `start` and `end`.** `https://kp.gfz.de/app/json/?index=Kp` with no window
returns **HTTP 500**, not a default range. The rolling-48h window specced in the route is
mandatory, not a nicety. `end` is **inclusive** (a 48 h window returns 17 bins, not 16).

**Do not use `services.swpc.noaa.gov/json/planetary_k_index_1m.json`.** It is a different
product: 1-minute cadence (~358 rows/28 KB per fetch) with a different field set
(`kp_index` int, `estimated_kp` float, `kp` string like `"0P"`). Fusing it would require
binning hundreds of rows per tick and would compare a 1-minute estimate against a 3-hour
index. The `products/noaa-planetary-k-index.json` endpoint specced above is correct —
re-verified 2026-07-30: array-of-objects, 60 rows, exactly `{time_tag, Kp, a_running,
station_count}`, `time_tag` suffix-less as described.

<details>
<summary>Superseded original Task 2.4 (Radiation — BfS ODL + Safecast) — kept for the record</summary>

**Files:**
- Modify: `local-api-server.mjs` — new route `/api/radiation-safecast?lat=&lon=` proxying `https://api.safecast.org/measurements.json?latitude=..&longitude=..&distance=100000&unit=cpm&order=captured_at+desc` (cache 60 min). Convert CPM → µSv/h **in the pure adapter, not the route** (÷334, the LND-7317 pancake convention; approximate by design — comment it).
- Create: `src/services/radiation/radiation-fusion-observations.ts` (pure: `bfsToObservations`, `safecastToObservations` — filter `captured_at` older than 24h) + `src/services/radiation/safecast-fetch.ts` (fail-closed). BfS already flows through `/api/radiation-grid`; add `bfsToObservations` against that route's row shape (`grep -n 'radiation-grid' src-tauri/sidecar/local-api-server.mjs` and mirror the emitted fields).
- Modify: registry (+`safecast`; `bfs-odl` already registered), domain map, data-loader.
- Test: `src/services/radiation/__tests__/radiation-fusion-observations.test.mts` — include a CPM→µSv/h conversion case (334 CPM → 1.0) and a stale-measurement drop case.

- [ ] Registry: `{ id: 'safecast', domain: 'nuclear', displayName: 'Safecast', authType: 'none', baseUrl: 'https://api.safecast.org', rateLimitNote: 'no key, citizen network, sparse coverage', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.6, fallbackPriority: 2, independenceGroup: 'safecast' }` — reliability 0.6 is deliberate: citizen sensors + unit conversion.
- [ ] Domain config:

```ts
  // Background radiation is spatially smooth; independent sensors within
  // 30 km should agree within ±50% (device + conversion variance).
  radiation: {
    providerIds: ['bfs-odl', 'safecast'],
    toleranceMode: 'relative',
    numericTolerance: 0.5,
    match: { maxDistanceKm: 30, maxTimeDeltaMs: 3 * 60 * 60_000 },
  },
```

</details>

### Task 2.5: Internet outages — IODA + Cloudflare Radar

`CLOUDFLARE_API_TOKEN` is already in both allowlists and used by two existing routes — zero new key plumbing.

**Re-probed 2026-07-30.** Cloudflare endpoint confirmed present (400 `code: 9106` "Missing X-Auth-Key, X-Auth-Email or Authorization headers" — an auth error, not a 404, so the path is right). IODA upstream live; `parseIodaAlerts` (`local-api-server.mjs:18265`) already emits exactly what the adapter needs: `entityType`, `entityCode`, `level`, `condition`, `from` (unix **seconds** — multiply by 1000).

**CRITICAL correctness note the original task missed:** IODA's `/outages/alerts` returns **normal-level rows too**, not just outages — the first live row sampled was `{entity: {code:'BF', type:'country'}, level:'normal', condition:'normal', value:150, historyValue:182}`. A naive "count events in the last 6h" therefore counts *healthy* observations as outages and would report a fabricated global outage storm. The adapter MUST:
- keep only `entityType === 'country'` (drop region/ASN entities — their `code` is not an ISO2 and would collide with country keys), and
- exclude rows whose `level`/`condition` indicate normal operation; count only genuine alert levels.

Assert both filters in the fixture test: a payload of three `normal` rows plus one real alert for `BF` must yield `BF → 1`, not `4`. Also assert a region/ASN row is dropped rather than keyed.

**Files:**
- Modify: `local-api-server.mjs` — new route `/api/internet-outages-cf` calling `https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=1d&limit=100&format=json` with `Authorization: Bearer ${process.env.CLOUDFLARE_API_TOKEN}`; `{ degraded: true }` when the token is absent (Finnhub pattern); cache 15 min. Emit `{ outages: [{ country: <ISO2>, startedAt: <ms> }] }` from `result.annotations[].locations[]` (one row per location).
- Create: `src/services/netwatch/outage-fusion-observations.ts` — pure `outageCountsToObservations(providerId, events: {country,startedAt}[], now)` → one key-matched observation per country: `key` = ISO2, `value` = count of events started in the last 6h, `occurredAt` = now. Plus `src/services/netwatch/cloudflare-radar-fetch.ts` (fail-closed) and an IODA-side mapper reading the existing `/api/internet-outages` response (`grep -n "internet-outages" src-tauri/sidecar/local-api-server.mjs` for its emitted shape; map entity code → ISO2, dropping non-country entities).
- Modify: registry (+`cloudflare-radar`; `ioda` already registered), domain map, data-loader.
- Test: `src/services/netwatch/__tests__/outage-fusion-observations.test.mts`.

- [ ] Registry: `{ id: 'cloudflare-radar', domain: 'internet_health', displayName: 'Cloudflare Radar', authType: 'free_key', requiredSecret: 'CLOUDFLARE_API_TOKEN', baseUrl: 'https://api.cloudflare.com', rateLimitNote: 'keyed, generous free quota', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.85, fallbackPriority: 2, independenceGroup: 'cloudflare' }`
- [ ] Domain config (methodologies differ — BGP/active-probing vs traffic drop — so disagreements are *informative*, tolerance stays loose):

```ts
  internet_outages: {
    providerIds: ['ioda', 'cloudflare-radar'],
    numericTolerance: 3,
    match: { matchBy: 'key', maxDistanceKm: 0, maxTimeDeltaMs: 6 * 60 * 60_000 },
  },
```

### Task 2.6: Batch 2 PR

- [ ] Same close-out as Task 1.8; branch `claude/api-fusion-batch2`, PR body marker, Codex review, auto-squash. Also assert in the PR description which of the 8 fused domains are live and which are key-gated (cloudflare-radar, airnow, purpleair activate only when their keys are present — the SourceConfidencePanel will honestly show them down otherwise).

---

# Batch 3 — Correlation-edge wiring: volcano, tsunami, river gauges (PR 3)

This batch feeds the **intelligence observation store** (`src/services/intelligence/observation-store.ts`) so the CorrelateEngine's built-in rules and the lead-lag miner can see these event families. Pattern: register an adapter in `createDefaultRegistry()` (`observation-adapters.ts:465`) with a `sourceId`, then call `ingestRaw(sourceId, raws)` from the data-loader where the feed already lands. Note the two stores are different layers: `recordDomainObservations` → provider fusion/redundancy; `ingestRaw` → correlation. Volcano gets both; tsunami/river get `ingestRaw` + provider health only (no numeric fact to corroborate yet).

### Task 3.1: GVP second volcano source + `volcanic_activity` fusion

The existing `/api/volcano-alerts` route is USGS-only (`volcanoes.usgs.gov`, US coverage). Smithsonian GVP is a second independence group with global coverage.

**Files:**
- Modify: `local-api-server.mjs` — route `/api/volcano-gvp` querying the **verified** geoserver WFS: `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:E3WebApp_Eruptions1960&outputFormat=application/json&count=200&sortBy=StartDate+D`. Keep only features with no `EndDate` (ongoing eruptions). Cache 6h. **First step of this task: curl that exact URL and confirm the `E3WebApp_Eruptions1960` layer + property names (`VolcanoName`, `Latitude`, `Longitude`, `StartDate`, `EndDate`) — the sibling `Smithsonian_VOTW_Holocene_Volcanoes` layer was verified 200 on 2026-07-29; if the eruptions layer 400s, list layers via `request=GetCapabilities` and pin the correct typeName before writing the route.**
- Create: `src/services/volcano/volcano-fusion-observations.ts` — pure adapters:
  - `usgsVolcanoesToObservations(rows)` — value = alert rank (`ADVISORY`=1, `WATCH`=2, `WARNING`=3; drop `NORMAL`), from the existing `/api/volcano-alerts` response shape.
  - `gvpEruptionsToObservations(rows)` — value = 2 (erupting), lat/lon from the feature, `occurredAt` = `Date.parse(StartDate)` clamped to ≤now.
- Modify: registry (+`usgs-volcanoes`, +`gvp-volcanoes`), `FusionDomainKey` + config, data-loader (the existing volcano load path — `grep -n 'volcano-alerts' src/app/data-loader.ts`).
- Test: `src/services/volcano/__tests__/volcano-fusion-observations.test.mts`.

- [ ] Registry:

```ts
  { id: 'usgs-volcanoes', domain: 'disasters', displayName: 'USGS Volcano Hazards', authType: 'none', baseUrl: 'https://volcanoes.usgs.gov', rateLimitNote: 'no key, US volcanoes', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.95, fallbackPriority: 6, independenceGroup: 'usgs' },
  { id: 'gvp-volcanoes', domain: 'disasters', displayName: 'Smithsonian GVP', authType: 'none', baseUrl: 'https://webservices.volcano.si.edu', rateLimitNote: 'WFS, cache 6h', freshnessTtlMs: 12 * HOUR, reliabilityWeight: 0.85, fallbackPriority: 7, independenceGroup: 'smithsonian' },
```

- [ ] Fusion config — coarse activity corroboration, not magnitude math:

```ts
  // "Both networks say this volcano is active." Values are activity ranks
  // (1-3); tolerance 1.5 means ADVISORY vs erupting still corroborates,
  // and the 50 km radius keeps distinct volcanoes distinct.
  volcanic_activity: {
    providerIds: ['usgs-volcanoes', 'gvp-volcanoes'],
    numericTolerance: 1.5,
    match: { maxDistanceKm: 50, maxTimeDeltaMs: 7 * 24 * 60 * 60_000 },
  },
```

(Also extend `FusionDomainKey` with `'volcanic_activity'`.)

### Task 3.2: Volcano + tsunami + river-gauge observation adapters for the CorrelateEngine

**Files:**
- Modify: `src/services/intelligence/observation-adapters.ts` — three new adapters registered in `createDefaultRegistry()` (mirror the `gdacs-alerts` adapter's structure at `observation-adapters.ts:397`):
  - `sourceId: 'volcano-activity'`, `domain: 'disasters'`, tags `['volcano']` (+ `'eruption'` when rank ≥2); severity from rank; entity = volcano name.
  - `sourceId: 'tsunami-alerts'`, `domain: 'disasters'`, tags `['tsunami']`; raws are the existing `/api/tsunami-status` alert rows (grep `data-loader.ts` for `tsunami-status` to find where they land; that's the `ingestRaw` call site). **This immediately arms the already-built `earthquakeTsunamiRule` (`built-in-correlation-rules.ts`) with live tsunami observations for the first time.**
  - `sourceId: 'river-gauges'`, `domain: 'weather'`, tags `['flood']`; only ingest gauges at/above action stage so the ring buffer isn't flooded (pun intended) with normal readings.
- Modify: `src/app/data-loader.ts` — `ingestRaw(...)` calls where each feed already lands (volcano + tsunami), and the new NWPS loader (Task 3.3).
- Test: extend `src/services/intelligence/__tests__/observation-adapters.test.mts` with one fixture per adapter asserting domain/tags/severity mapping and that garbage rows adapt to zero events.

- [ ] TDD each adapter (failing fixture → implement → pass → commit per adapter).

### Task 3.3: NOAA NWPS river gauges (new provider + feed)

**Files:**
- Modify: `local-api-server.mjs` — route `/api/river-gauges?lat=&lon=` proxying `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=..&bbox.ymin=..&bbox.xmax=..&bbox.ymax=..` (±0.75° box around the query point; cache 30 min; verified 200 + clean JSON on 2026-07-29). Emit `{ gauges: [{ id, name, lat, lon, status: <observed category>, stageFt, floodStageFt }] }` — map from the NWPS payload's per-gauge `status.observed.floodCategory` and stage values; confirm exact field paths against a live gauge (the verified probe returned `{"gauges": []}` for an empty box — re-probe with a bbox around a real gauge, e.g. the Kankakee River near La Porte).
- Create: `src/services/weather/river-gauges-fetch.ts` (fail-closed, `{ ok, gauges }`).
- Modify: registry (+`noaa-nwps`), data-loader (new load method, saved-place coords, calls both `recordProviderFetchOutcome`-via-`recordDomainObservations('noaa-nwps', [], ok)` for health and `ingestRaw('river-gauges', gauges)` for correlation).
- Test: fetch-shape test is covered by the adapter fixtures in Task 3.2; add a registry assertion in `test:providers` if it counts providers.

- [ ] Registry: `{ id: 'noaa-nwps', domain: 'disasters', displayName: 'NOAA NWPS River Gauges', authType: 'none', baseUrl: 'https://api.water.noaa.gov', rateLimitNote: 'no key, NOAA', freshnessTtlMs: HOUR, reliabilityWeight: 0.95, fallbackPriority: 8, independenceGroup: 'noaa' }` — group `noaa` (shared with NWS alerts: same agency upstream, honest single vote).

### Task 3.4: Volcano→aviation built-in correlation rule (TDD)

**Files:**
- Modify: `src/services/intelligence/built-in-correlation-rules.ts` (new rule + append to the aggregate export at :209)
- Test: the existing rules test file (`grep -rln 'builtInCorrelationRules' src/services/intelligence/__tests__/`)

- [ ] **Step 1: Failing test** — volcano observation (tag `eruption`, lat 61.3 lon -152.2) + aviation SIGMET observation within 500 km / 24 h → rule matches; same pair 2000 km apart → no match.
- [ ] **Step 2: Implement** (mirror `weatherAviationRule`'s structure and the file's `fromSource`/`hasTag`/distance helpers):

```ts
const volcanoAviationRule: CorrelationRule = {
  id: 'volcano-aviation-hazard',
  description: 'Erupting volcano and an aviation hazard notice within 500km and 24h — ash disrupts airspace.',
  domains: ['disasters', 'aviation'],
  timeWindowMs: 24 * 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => {
    const volcano = hasTag(a, 'eruption') || fromSource(a, 'volcano-activity');
    const aviation = b.domain === 'aviation';
    if (!volcano || !aviation) return false;
    return withinKm(a, b, 500);
  },
};
```

(Use the file's actual distance helper name — check the imports at the top of `built-in-correlation-rules.ts`; if none exists, add `withinKm` beside the other helpers using the haversine already available in the codebase — `grep -rn 'haversine\|greatCircle' src/services/intelligence/`.)

- [ ] **Step 3: Register + launches provider.** Append `volcanoAviationRule` to `builtInCorrelationRules`. Also register the already-live Launch Library feed as a provider so its health is tracked: `{ id: 'launch-library-2', domain: 'space', displayName: 'Launch Library 2', authType: 'none', baseUrl: 'https://ll.thespacedevs.com', rateLimitNote: '15 req/hr anonymous — cache hard', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.85, fallbackPriority: 2, independenceGroup: 'thespacedevs' }` + a `recordDomainObservations('launch-library-2', [], ok)` health call in the existing space-launches load path (`src/services/space-launches.ts` callers — grep `data-loader.ts` for `space-launches`).

### Task 3.5: Batch 3 PR

- [ ] Same close-out ritual; branch `claude/api-fusion-batch3`. In the PR body, note the observable win: tsunami observations now flow to `earthquakeTsunamiRule`, and volcanic eruptions can form `causal-candidate` edges with SIGMET traffic.

---

# Batch 4 — Shortage price corroboration, diagnostics, docs (PR 4)

### Task 4.1: FAO FPMA food-price signal into shortage models

**Files:**
- Modify: `local-api-server.mjs` — route `/api/food-prices-fpma` proxying `https://fpma.fao.org/giews/v4/price_module/api/v1/FpmaSerieInternational` (follows a 307 — verified 200 after redirect; `fetchWithTimeout` must allow redirects, which Node fetch does by default). Cache 12h. Emit `{ series: [{ commodity, market, latestPrice, pctChange3m, currency }] }` filtered to wheat/maize/rice rows — inspect the live payload's field names first (`curl -sL ... | head -c 2000`) and pin the mapping in the route.
- Create: `src/services/shortage/fpma-price-fetch.ts` (fail-closed) + pure `src/services/shortage/fpma-price-adapter.ts`: `fpmaToPriceInputs(series) → Partial<Record<'wheat'|'corn'|'rice', ShortageInput[]>>` producing `price`-bucket `ShortageInput` rows (provenance: `source: 'fao-fpma'`) — follow `shortage-types.ts` for the exact `ShortageInput` fields and reuse the freshness conventions the 8 models already expect.
- Modify: `src/app/panel-layout.ts:2175` region — merge FPMA rows into the `ShortageInputBag` built for `radarPanel.setInputs(bag)`, and registry (+`fao-fpma`, domain `food_security`, group `fao`).
- Test: `src/services/shortage/__tests__/fpma-price-adapter.test.mts` — fixture with a wheat price spike → produces a `price` driver input with positive contribution; empty/garbage series → `{}`.

- [ ] TDD as usual. The correlation payoff: FEWS NET stops being the only food-security voice, and the wheat/corn/rice models get a real price driver instead of a data gap.

### Task 4.2: Source-confidence + redundancy regression fixtures

**Files:**
- Test: extend `src/services/diagnostics/__tests__/source-confidence-view.test.mts` (or the existing equivalent — `grep -rln 'source-confidence-view' src/services/diagnostics/__tests__/`)

- [ ] Fixture: registry + FUSION_DOMAINS as shipped → assert the view reports 8 fused domains (`earthquakes`, `air_quality`, `crypto`, `stocks`, `surface_temp`, `fx_rates`, `radiation`, `internet_outages`, `volcanic_activity` — 9 with volcano) and that a domain whose second provider has never fetched shows `redundant_unverified`, not FUSED. This is the honesty regression net for the whole program.
- [ ] Fixture: provider-redundancy multiplier — two agreeing groups → 1.0; disagreement → capped 0.6 (existing math, new domains' provider ids).

### Task 4.3: Docs + tracker close-out

**Files:**
- Modify: `CLAUDE.md` — update the fused-domains comment line (currently "Fused domains: earthquakes + air_quality + crypto + stocks") to the final list; update the §Phase-1 note about Workstream B partial closure.
- Modify: `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md` — append a "Round 2 (2026-07-29, curl-verified)" section listing the 15 sources with verification dates and the two dead-endpoint warnings (Stooq live-quote 404, GVP WeeklyVolcanoGeoJSON 403).
- Modify: `docs/superpowers/specs/2026-06-28-redundancy-prediction-enhancement-program-design.md` — mark the closed SPOF rows in §12.
- This plan's Progress Tracker → all batches DONE.

- [ ] `npm run docs:check` green; commit; PR `claude/api-fusion-batch4` with the standard ritual.

---

## Deliberately excluded (and why)

- **Stooq** (added during execution) — daily CSV endpoint is behind a JavaScript proof-of-work anti-bot wall (HTTP 200 + challenge page for all non-browser clients); permanently undeliverable for a Node fetch. Replaced by FMP in Task 1.6.
- **WAQI** — needs a new key (dual-allowlist + 3 Records) *and* shares the government-monitor upstream with OpenAQ; AirNow+PurpleAir deliver the same widening with keys already provisioned. Revisit only if OpenAQ dies.
- **ransomware.live** — root URL is alive but every documented v2 endpoint 404'd on verification; do not wire until a working endpoint is confirmed.
- **Tsunami second source** — PTWC + IOC fallback both already flow through `/api/tsunami-status`; a true second *independence group* (JMA) is future work, not this program.
- **NWS observation stations as surface_temp 3rd vote** — needs station-lookup plumbing; deferred until the 2-vote domain proves itself.

## Self-review notes

- Every fused-domain widening lists provider ids consistently across registry, `FUSION_DOMAINS`, and loader call sites (grep each id once per batch before PR).
- `FusionDomainKey` gains exactly five members across Batches 2-3: `surface_temp`, `fx_rates`, `radiation`, `internet_outages`, `volcanic_activity`.
- No new ProviderDomain union members are needed — all 16 providers map onto existing domains.
- No new secret keys anywhere; the three keyed providers (airnow, purpleair, cloudflare-radar) use keys already present in `SUPPORTED_SECRET_KEYS` and the sidecar allowlist (verified at lines 320-321, 1281, 1284).
- Two payload-shape confirmations are flagged inline as first steps of their tasks (GVP eruptions layer, NWPS gauge fields) because the 2026-07-29 probes verified liveness but not full schemas.
