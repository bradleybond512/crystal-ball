# Provider Registry + Fusion Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/services/providers/` — a pure deterministic provider registry, health tracker, fusion scorer, and bridge into the existing provider-redundancy verdict engine — per `docs/superpowers/specs/2026-06-11-provider-registry-fusion-core-design.md`.

**Architecture:** Four pure modules (types+registry, health, fusion, bridge) plus a singleton state module, following the exact pattern of `src/services/datacenter/`. No DOM, no fetch, no timers; callers supply `now`. The bridge emits `ProviderSnapshot` objects that `src/services/diagnostics/provider-redundancy.ts` already consumes, so no UI changes are needed.

**Tech Stack:** TypeScript (strict), `node:test` + `node:assert` via `tsx --test`, test files are `.test.mts` under `__tests__/`. Work in worktree `.worktrees/provider-registry` on branch `claude/provider-registry-fusion-core`. Run all commands from the worktree root.

**Conventions that apply to every task:**
- Import alias `@/` maps to `src/` in app code; **test files (`.mts`) must use relative imports** (e.g. `../provider-registry.ts`) because `tsx --test` does not resolve the alias.
- Commit after each task. The pre-commit hook runs conflict lint, secret scan, markdownlint, and `typecheck:all` — if it fails, fix before proceeding.
- Never touch the macOS keychain. Never push to any remote other than `origin` (and don't push until the final task).

---

### Task 1: Provider types + registry

**Files:**
- Create: `src/services/providers/provider-types.ts`
- Create: `src/services/providers/provider-registry.ts`
- Test: `src/services/providers/__tests__/provider-registry.test.mts`
- Modify: `package.json` (add `test:providers` script)

- [ ] **Step 1: Write the failing test**

Create `src/services/providers/__tests__/provider-registry.test.mts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_DEFINITIONS,
  getProviderDefinition,
  providersForDomain,
  independentGroupsFor,
} from '../provider-registry.ts';

test('all definitions are valid', () => {
  const ids = new Set<string>();
  for (const def of PROVIDER_DEFINITIONS) {
    assert.ok(!ids.has(def.id), `duplicate id ${def.id}`);
    ids.add(def.id);
    assert.ok(def.freshnessTtlMs > 0, `${def.id} ttl must be > 0`);
    assert.ok(def.reliabilityWeight > 0 && def.reliabilityWeight <= 1, `${def.id} weight out of range`);
    assert.ok(def.fallbackPriority >= 1, `${def.id} fallbackPriority must be >= 1`);
    assert.ok(def.independenceGroup.length > 0, `${def.id} needs an independenceGroup`);
    if (def.authType !== 'none') {
      assert.ok(def.requiredSecret, `${def.id} is keyed but has no requiredSecret`);
    }
  }
});

test('getProviderDefinition returns the definition or undefined', () => {
  assert.equal(getProviderDefinition('nws-alerts')?.domain, 'weather');
  assert.equal(getProviderDefinition('nope'), undefined);
});

test('providersForDomain sorts by fallbackPriority', () => {
  const adsb = providersForDomain('adsb');
  assert.ok(adsb.length >= 2, 'adsb should have redundancy');
  for (let i = 1; i < adsb.length; i++) {
    assert.ok(adsb[i].fallbackPriority >= adsb[i - 1].fallbackPriority);
  }
});

test('independentGroupsFor collapses shared-upstream providers', () => {
  // adsb-lol + adsb-fi + airplanes-live share community ADS-B receivers
  const groups = independentGroupsFor(['adsb-lol', 'adsb-fi', 'airplanes-live', 'opensky']);
  assert.equal(groups.size, 2);
});

test('exactly one primary per domain', () => {
  const domains = new Set(PROVIDER_DEFINITIONS.map((d) => d.domain));
  for (const domain of domains) {
    const primaries = providersForDomain(domain).filter((d) => d.fallbackPriority === 1);
    assert.equal(primaries.length, 1, `${domain} must have exactly one primary`);
  }
});
```

- [ ] **Step 2: Add the test script and run to verify failure**

In `package.json` `"scripts"`, next to `"test:datacenter"`, add:

```json
"test:providers": "tsx --test src/services/providers/__tests__/provider-registry.test.mts src/services/providers/__tests__/provider-health.test.mts src/services/providers/__tests__/source-fusion.test.mts src/services/providers/__tests__/provider-bridge.test.mts",
```

For now run only the first file: `npx tsx --test src/services/providers/__tests__/provider-registry.test.mts`
Expected: FAIL (cannot find `../provider-registry.ts`).

- [ ] **Step 3: Write `provider-types.ts`**

```ts
/**
 * Provider Registry + Fusion Core — shared types.
 *
 * See docs/superpowers/specs/2026-06-11-provider-registry-fusion-core-design.md.
 * Pure deterministic layer: no DOM, no fetch, no timers, no globals.
 */

export type ProviderDomain =
  | 'weather'
  | 'disasters'
  | 'adsb'
  | 'aviation'
  | 'commodities'
  | 'food_security'
  | 'conflict'
  | 'cyber'
  | 'markets'
  | 'maritime'
  | 'infrastructure'
  | 'transport'
  | 'space';

export type ProviderAuthType = 'none' | 'free_key' | 'account';

export interface ProviderDefinition {
  id: string;
  domain: ProviderDomain;
  displayName: string;
  authType: ProviderAuthType;
  /** Key name from SUPPORTED_SECRET_KEYS when authType !== 'none'. */
  requiredSecret?: string;
  baseUrl: string;
  /** Human note for the diagnostics display. */
  rateLimitNote: string;
  /** How long a successful fetch counts as fresh. */
  freshnessTtlMs: number;
  /** 0..1 prior reliability. */
  reliabilityWeight: number;
  /** 1 = primary for its domain, 2+ = backups. */
  fallbackPriority: number;
  /** Providers sharing an upstream count as ONE independent source. */
  independenceGroup: string;
}

export interface FetchOutcome {
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  /** ms timestamp of the attempt. */
  at: number;
  errorMessage?: string;
}

export type ProviderStatus = 'healthy' | 'stale' | 'degraded' | 'down' | 'unknown_provider';

export interface ProviderHealth {
  providerId: string;
  status: ProviderStatus;
  /** Rolling success rate 0..1 over the retained window (1 when no data). */
  successRate: number;
  /** Median latency of successful fetches; 0 when none. */
  p50LatencyMs: number;
  /** Recent 429s, or repeated 403s after earlier success. */
  quotaSuspected: boolean;
  lastSuccessAt?: number;
  lastError?: string;
  reason: string;
}

export interface SourceObservation {
  providerId: string;
  value: number | string;
  observedAt: number;
}

export interface FusionComponent {
  score: number;
  reason: string;
}

export interface Disagreement {
  providerIds: readonly string[];
  value: number | string;
  reason: string;
}

export type FusionLabel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

export interface FusionResult {
  confidenceMultiplier: number;
  label: FusionLabel;
  components: {
    freshness: FusionComponent;
    reliability: FusionComponent;
    corroboration: FusionComponent;
  };
  disagreements: readonly Disagreement[];
  independentSourceCount: number;
}
```

- [ ] **Step 4: Write `provider-registry.ts`**

Seed with the currently-live sources (ids must match what `src/services/insights/data-bridge.ts` already maps: `nws-alerts`, `gdacs`, `usgs-earthquakes`, `adsbexchange`, `opensky`, `eia`, `fred`, `fews-net`) plus the P0 batch from `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md` as definitions only:

```ts
/**
 * Static provider catalog. Definitions are cheap — fetcher wiring for the
 * P0 expansion batch lands in later PRs, one domain at a time.
 */

import type { ProviderDefinition, ProviderDomain } from './provider-types.ts';

const HOUR = 3_600_000;
const MIN = 60_000;

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  // ── Currently live ────────────────────────────────────────────────
  { id: 'nws-alerts', domain: 'weather', displayName: 'NWS Alerts', authType: 'none', baseUrl: 'https://api.weather.gov', rateLimitNote: 'unauthenticated, be gentle', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'noaa' },
  { id: 'gdacs', domain: 'disasters', displayName: 'GDACS', authType: 'none', baseUrl: 'https://www.gdacs.org', rateLimitNote: 'no published limit', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'gdacs' },
  { id: 'usgs-earthquakes', domain: 'disasters', displayName: 'USGS Earthquakes', authType: 'none', baseUrl: 'https://earthquake.usgs.gov', rateLimitNote: 'no published limit', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.95, fallbackPriority: 2, independenceGroup: 'usgs' },
  { id: 'adsbexchange', domain: 'adsb', displayName: 'ADSBExchange', authType: 'free_key', requiredSecret: 'ADSBEXCHANGE_API_KEY', baseUrl: 'https://adsbexchange.com', rateLimitNote: 'keyed, per-plan limits', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'adsbx' },
  { id: 'opensky', domain: 'adsb', displayName: 'OpenSky Network', authType: 'none', baseUrl: 'https://opensky-network.org', rateLimitNote: 'anonymous: 100 req/day burst limits', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.7, fallbackPriority: 2, independenceGroup: 'opensky' },
  { id: 'eia', domain: 'commodities', displayName: 'EIA', authType: 'free_key', requiredSecret: 'EIA_API_KEY', baseUrl: 'https://api.eia.gov', rateLimitNote: '5000 req/hour', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'us-gov-energy' },
  { id: 'fred', domain: 'markets', displayName: 'FRED', authType: 'free_key', requiredSecret: 'FRED_API_KEY', baseUrl: 'https://api.stlouisfed.org', rateLimitNote: '120 req/min', freshnessTtlMs: 12 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'us-fed' },
  { id: 'fews-net', domain: 'food_security', displayName: 'FEWS NET', authType: 'none', baseUrl: 'https://fews.net', rateLimitNote: 'no published limit', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.85, fallbackPriority: 1, independenceGroup: 'fews' },
  // ── P0 expansion batch (definitions only; fetchers in later PRs) ──
  { id: 'airplanes-live', domain: 'adsb', displayName: 'Airplanes.live', authType: 'none', baseUrl: 'https://api.airplanes.live', rateLimitNote: '1 req/sec community API', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.7, fallbackPriority: 3, independenceGroup: 'community-adsb' },
  { id: 'adsb-lol', domain: 'adsb', displayName: 'ADSB.lol', authType: 'none', baseUrl: 'https://api.adsb.lol', rateLimitNote: 'community API, be gentle', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.65, fallbackPriority: 4, independenceGroup: 'community-adsb' },
  { id: 'adsb-fi', domain: 'adsb', displayName: 'ADSB.fi', authType: 'none', baseUrl: 'https://opendata.adsb.fi', rateLimitNote: 'community API, be gentle', freshnessTtlMs: 2 * MIN, reliabilityWeight: 0.65, fallbackPriority: 5, independenceGroup: 'community-adsb' },
  { id: 'aviationweather-gov', domain: 'aviation', displayName: 'AviationWeather.gov', authType: 'none', baseUrl: 'https://aviationweather.gov/api', rateLimitNote: 'no key, NOAA', freshnessTtlMs: 15 * MIN, reliabilityWeight: 0.95, fallbackPriority: 1, independenceGroup: 'noaa' },
  { id: 'open-meteo-forecast', domain: 'weather', displayName: 'Open-Meteo Forecast', authType: 'none', baseUrl: 'https://api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: 30 * MIN, reliabilityWeight: 0.85, fallbackPriority: 2, independenceGroup: 'open-meteo' },
  { id: 'open-meteo-flood', domain: 'disasters', displayName: 'Open-Meteo Flood', authType: 'none', baseUrl: 'https://flood-api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: 3 * HOUR, reliabilityWeight: 0.8, fallbackPriority: 3, independenceGroup: 'open-meteo' },
  { id: 'open-meteo-marine', domain: 'maritime', displayName: 'Open-Meteo Marine', authType: 'none', baseUrl: 'https://marine-api.open-meteo.com', rateLimitNote: '10k req/day non-commercial', freshnessTtlMs: HOUR, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'open-meteo' },
  { id: 'nasa-eonet', domain: 'disasters', displayName: 'NASA EONET', authType: 'none', baseUrl: 'https://eonet.gsfc.nasa.gov', rateLimitNote: 'no published limit', freshnessTtlMs: HOUR, reliabilityWeight: 0.85, fallbackPriority: 4, independenceGroup: 'nasa' },
  { id: 'nvd', domain: 'cyber', displayName: 'NVD CVE API', authType: 'none', baseUrl: 'https://services.nvd.nist.gov', rateLimitNote: '5 req/30s without key', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'nist' },
  { id: 'first-epss', domain: 'cyber', displayName: 'FIRST EPSS', authType: 'none', baseUrl: 'https://api.first.org', rateLimitNote: 'no published limit', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 2, independenceGroup: 'first' },
  { id: 'cisa-kev', domain: 'cyber', displayName: 'CISA KEV', authType: 'none', baseUrl: 'https://www.cisa.gov', rateLimitNote: 'static JSON catalog', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 3, independenceGroup: 'cisa' },
  { id: 'sec-edgar', domain: 'markets', displayName: 'SEC EDGAR', authType: 'none', baseUrl: 'https://data.sec.gov', rateLimitNote: '10 req/sec with UA header', freshnessTtlMs: 6 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 2, independenceGroup: 'sec' },
  { id: 'treasury-fiscal', domain: 'markets', displayName: 'Treasury Fiscal Data', authType: 'none', baseUrl: 'https://api.fiscaldata.treasury.gov', rateLimitNote: 'no published limit', freshnessTtlMs: 24 * HOUR, reliabilityWeight: 0.95, fallbackPriority: 3, independenceGroup: 'us-treasury' },
  { id: 'celestrak', domain: 'space', displayName: 'CelesTrak', authType: 'none', baseUrl: 'https://celestrak.org', rateLimitNote: 'cache aggressively', freshnessTtlMs: 12 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 1, independenceGroup: 'celestrak' },
  { id: 'space-track', domain: 'space', displayName: 'Space-Track', authType: 'account', requiredSecret: 'SPACETRACK_PASSWORD', baseUrl: 'https://www.space-track.org', rateLimitNote: '30 req/min, 300/hour', freshnessTtlMs: 12 * HOUR, reliabilityWeight: 0.9, fallbackPriority: 2, independenceGroup: 'us-gov-space' },
  { id: 'wikidata', domain: 'infrastructure', displayName: 'Wikidata SPARQL', authType: 'none', baseUrl: 'https://query.wikidata.org', rateLimitNote: '60s query timeout, be gentle', freshnessTtlMs: 7 * 24 * HOUR, reliabilityWeight: 0.8, fallbackPriority: 1, independenceGroup: 'wikimedia' },
  { id: 'overpass', domain: 'infrastructure', displayName: 'Overpass API', authType: 'none', baseUrl: 'https://overpass-api.de', rateLimitNote: 'fair-use policy, cache results', freshnessTtlMs: 7 * 24 * HOUR, reliabilityWeight: 0.75, fallbackPriority: 2, independenceGroup: 'osm' },
];

const BY_ID = new Map(PROVIDER_DEFINITIONS.map((d) => [d.id, d]));

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return BY_ID.get(id);
}

export function providersForDomain(domain: ProviderDomain): readonly ProviderDefinition[] {
  return PROVIDER_DEFINITIONS
    .filter((d) => d.domain === domain)
    .sort((a, b) => a.fallbackPriority - b.fallbackPriority);
}

/** Distinct independence groups among the given provider ids.
 *  Unknown ids are ignored. */
export function independentGroupsFor(providerIds: readonly string[]): Set<string> {
  const groups = new Set<string>();
  for (const id of providerIds) {
    const def = BY_ID.get(id);
    if (def) groups.add(def.independenceGroup);
  }
  return groups;
}
```

Note: `ADSBEXCHANGE_API_KEY`, `EIA_API_KEY`, `FRED_API_KEY` exist in `SUPPORTED_SECRET_KEYS` (`src-tauri/src/main.rs`). Verify `SPACETRACK_PASSWORD` with `grep -n 'SPACETRACK' src-tauri/src/main.rs`; if absent, change that entry's `requiredSecret` to a key that exists or grep for the closest match (e.g. `SPACE_TRACK_*`). Do NOT edit main.rs in this PR.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/services/providers/__tests__/provider-registry.test.mts`
Expected: all 5 tests PASS. If "exactly one primary per domain" fails, fix `fallbackPriority` collisions in the seed list (each domain needs exactly one entry with priority 1).

- [ ] **Step 6: Commit**

```bash
git add src/services/providers package.json
git commit -m "feat(providers): provider registry + shared types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Provider health

**Files:**
- Create: `src/services/providers/provider-health.ts`
- Test: `src/services/providers/__tests__/provider-health.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProviderHealthState,
  recordFetchOutcome,
  deriveProviderHealth,
  OUTCOME_RING_LIMIT,
} from '../provider-health.ts';

const T0 = 1_750_000_000_000; // fixed epoch base — no Date.now() anywhere
const ok = (at: number, latencyMs = 100) => ({ ok: true, latencyMs, httpStatus: 200, at });
const fail = (at: number, httpStatus = 500) => ({ ok: false, latencyMs: 0, httpStatus, at, errorMessage: `http ${httpStatus}` });

test('healthy after recent successes', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0));
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + 1000, 200));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 2000);
  assert.equal(h.status, 'healthy');
  assert.equal(h.successRate, 1);
  assert.equal(h.p50LatencyMs, 150);
  assert.equal(h.lastSuccessAt, T0 + 1000);
});

test('down after 3 consecutive failures', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0));
  for (let i = 1; i <= 3; i++) s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + i * 1000));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 4000);
  assert.equal(h.status, 'down');
  assert.equal(h.lastError, 'http 500');
});

test('degraded when success rate below 0.7', () => {
  let s = emptyProviderHealthState();
  // alternate so there are never 3 consecutive failures: F ok F ok F → 2/5 = 0.4
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0));
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + 1000));
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + 2000));
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + 3000));
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + 4000));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 5000);
  assert.equal(h.status, 'degraded');
});

test('stale when last success older than provider TTL', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0)); // nws TTL = 10 min
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 11 * 60_000);
  assert.equal(h.status, 'stale');
});

test('quota suspected on recent 429', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'nws-alerts', ok(T0));
  s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + 1000, 429));
  const h = deriveProviderHealth(s, 'nws-alerts', T0 + 2000);
  assert.equal(h.quotaSuspected, true);
});

test('ring buffer is bounded', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < OUTCOME_RING_LIMIT + 25; i++) {
    s = recordFetchOutcome(s, 'nws-alerts', ok(T0 + i * 1000));
  }
  assert.equal(s.outcomes['nws-alerts'].length, OUTCOME_RING_LIMIT);
});

test('unknown provider: derive returns unknown_provider, record is a no-op', () => {
  const s0 = emptyProviderHealthState();
  const s1 = recordFetchOutcome(s0, 'made-up', ok(T0));
  assert.deepEqual(s1.outcomes, {});
  assert.equal(deriveProviderHealth(s1, 'made-up', T0).status, 'unknown_provider');
});

test('no outcomes yet: stale with explanation', () => {
  const h = deriveProviderHealth(emptyProviderHealthState(), 'nws-alerts', T0);
  assert.equal(h.status, 'stale');
  assert.match(h.reason, /no fetch outcomes/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test src/services/providers/__tests__/provider-health.test.mts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `provider-health.ts`**

```ts
/**
 * Provider health: pure record/derive over a per-provider ring buffer of
 * fetch outcomes. Callers report outcomes; this module derives status.
 * No timers, no Date.now() — `now` is always caller-supplied.
 */

import type { FetchOutcome, ProviderHealth } from './provider-types.ts';
import { getProviderDefinition } from './provider-registry.ts';

export const OUTCOME_RING_LIMIT = 50;
export const DOWN_CONSECUTIVE_FAILURES = 3;
export const DEGRADED_SUCCESS_RATE = 0.7;
const QUOTA_LOOKBACK = 10;

export interface ProviderHealthState {
  /** providerId → outcomes, oldest first, bounded to OUTCOME_RING_LIMIT. */
  readonly outcomes: Readonly<Record<string, readonly FetchOutcome[]>>;
}

export function emptyProviderHealthState(): ProviderHealthState {
  return { outcomes: {} };
}

export function recordFetchOutcome(
  state: ProviderHealthState,
  providerId: string,
  outcome: FetchOutcome,
): ProviderHealthState {
  if (!getProviderDefinition(providerId)) return state; // unknown provider: no-op
  const prev = state.outcomes[providerId] ?? [];
  const next = [...prev, outcome].slice(-OUTCOME_RING_LIMIT);
  return { outcomes: { ...state.outcomes, [providerId]: next } };
}

export function deriveProviderHealth(
  state: ProviderHealthState,
  providerId: string,
  now: number,
): ProviderHealth {
  const def = getProviderDefinition(providerId);
  if (!def) {
    return {
      providerId, status: 'unknown_provider', successRate: 0, p50LatencyMs: 0,
      quotaSuspected: false, reason: `Provider '${providerId}' is not in the registry.`,
    };
  }
  const outcomes = state.outcomes[providerId] ?? [];
  if (outcomes.length === 0) {
    return {
      providerId, status: 'stale', successRate: 1, p50LatencyMs: 0,
      quotaSuspected: false, reason: 'No fetch outcomes recorded yet.',
    };
  }

  const successes = outcomes.filter((o) => o.ok);
  const successRate = successes.length / outcomes.length;
  const lastSuccessAt = successes.length > 0 ? successes[successes.length - 1].at : undefined;
  const lastFailure = [...outcomes].reverse().find((o) => !o.ok);

  let consecutiveFailures = 0;
  for (let i = outcomes.length - 1; i >= 0 && !outcomes[i].ok; i--) consecutiveFailures += 1;

  const recent = outcomes.slice(-QUOTA_LOOKBACK);
  const has429 = recent.some((o) => o.httpStatus === 429);
  const forbidden = recent.filter((o) => o.httpStatus === 403).length;
  const quotaSuspected = has429 || (forbidden >= 2 && successes.length > 0);

  let status: ProviderHealth['status'];
  let reason: string;
  if (consecutiveFailures >= DOWN_CONSECUTIVE_FAILURES) {
    status = 'down';
    reason = `${consecutiveFailures} consecutive failures.`;
  } else if (successRate < DEGRADED_SUCCESS_RATE) {
    status = 'degraded';
    reason = `Success rate ${Math.round(successRate * 100)}% over last ${outcomes.length} fetches.`;
  } else if (lastSuccessAt === undefined || now - lastSuccessAt > def.freshnessTtlMs) {
    status = 'stale';
    reason = `Last success ${lastSuccessAt === undefined ? 'never' : `${Math.round((now - lastSuccessAt) / 60_000)} min ago`}; TTL ${Math.round(def.freshnessTtlMs / 60_000)} min.`;
  } else {
    status = 'healthy';
    reason = `Success rate ${Math.round(successRate * 100)}%, fresh within TTL.`;
  }

  return {
    providerId, status, successRate,
    p50LatencyMs: median(successes.map((o) => o.latencyMs)),
    quotaSuspected, lastSuccessAt,
    lastError: lastFailure?.errorMessage,
    reason,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/providers/__tests__/provider-health.test.mts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers
git commit -m "feat(providers): health derivation over fetch-outcome ring buffer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Source fusion

**Files:**
- Create: `src/services/providers/source-fusion.ts`
- Test: `src/services/providers/__tests__/source-fusion.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseObservations } from '../source-fusion.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../provider-health.ts';

const T0 = 1_750_000_000_000;
const obs = (providerId: string, value: number | string, observedAt = T0) => ({ providerId, value, observedAt });

function healthyState(ids: string[]) {
  let s = emptyProviderHealthState();
  for (const id of ids) s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, httpStatus: 200, at: T0 });
  return s;
}

test('empty observations → very_low with zero independent sources', () => {
  const r = fuseObservations({ observations: [], healthState: emptyProviderHealthState(), now: T0 });
  assert.equal(r.label, 'very_low');
  assert.equal(r.independentSourceCount, 0);
  assert.match(r.components.corroboration.reason, /no observations/i);
});

test('same independence group counts as one source', () => {
  const state = healthyState(['adsb-lol', 'adsb-fi', 'airplanes-live']);
  const r = fuseObservations({
    observations: [obs('adsb-lol', 42), obs('adsb-fi', 42), obs('airplanes-live', 42)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.independentSourceCount, 1);
});

test('independent agreement raises corroboration and label', () => {
  const state = healthyState(['adsbexchange', 'opensky', 'airplanes-live']);
  const r = fuseObservations({
    observations: [obs('adsbexchange', 42), obs('opensky', 42), obs('airplanes-live', 42)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.independentSourceCount, 3);
  assert.ok(r.confidenceMultiplier > 0.8, `expected > 0.8, got ${r.confidenceMultiplier}`);
  assert.equal(r.label, 'very_high');
});

test('disagreement surfaces and caps the multiplier', () => {
  const state = healthyState(['adsbexchange', 'opensky']);
  const r = fuseObservations({
    observations: [obs('adsbexchange', 42), obs('opensky', 99)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.disagreements.length, 1);
  assert.equal(r.disagreements[0].value, 99);
  assert.ok(r.confidenceMultiplier <= 0.6, `disagreement must cap at 0.6, got ${r.confidenceMultiplier}`);
});

test('categorical disagreement detected without tolerance', () => {
  const state = healthyState(['nws-alerts', 'open-meteo-forecast']);
  const r = fuseObservations({
    observations: [obs('nws-alerts', 'tornado_warning'), obs('open-meteo-forecast', 'clear')],
    healthState: state, now: T0,
  });
  assert.equal(r.disagreements.length, 1);
});

test('freshness decays linearly against provider TTL', () => {
  const state = healthyState(['nws-alerts']); // TTL 10 min
  const fresh = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: state, now: T0 });
  const half = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: state, now: T0 + 5 * 60_000 });
  const dead = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: state, now: T0 + 20 * 60_000 });
  assert.equal(fresh.components.freshness.score, 1);
  assert.ok(Math.abs(half.components.freshness.score - 0.5) < 0.01);
  assert.equal(dead.components.freshness.score, 0);
});

test('future observedAt is clamped, never scores above 1', () => {
  const state = healthyState(['nws-alerts']);
  const r = fuseObservations({ observations: [obs('nws-alerts', 1, T0 + 60_000)], healthState: state, now: T0 });
  assert.equal(r.components.freshness.score, 1);
});

test('observations from unknown providers are dropped with a reason', () => {
  const r = fuseObservations({ observations: [obs('made-up', 1)], healthState: emptyProviderHealthState(), now: T0 });
  assert.equal(r.independentSourceCount, 0);
  assert.equal(r.label, 'very_low');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test src/services/providers/__tests__/source-fusion.test.mts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `source-fusion.ts`**

```ts
/**
 * Source fusion: score a set of observations of the same fact from
 * multiple providers. Disagreements surface explicitly and are never
 * averaged away (plan invariant). Output slots into ConfidenceBreakdown.
 */

import type { Disagreement, FusionLabel, FusionResult, SourceObservation } from './provider-types.ts';
import { getProviderDefinition, independentGroupsFor } from './provider-registry.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { deriveProviderHealth } from './provider-health.ts';

export interface FuseInput {
  observations: readonly SourceObservation[];
  healthState: ProviderHealthState;
  now: number;
  /** Numeric values within this absolute tolerance of the consensus agree.
   *  Ignored for string values (those must match exactly). Default 0. */
  numericTolerance?: number;
}

const DISAGREEMENT_CAP = 0.6; // mirrors redundant_disagreement in provider-redundancy.ts
const WEIGHTS = { freshness: 0.25, reliability: 0.25, corroboration: 0.5 };

export function fuseObservations(input: FuseInput): FusionResult {
  const known = input.observations.filter((o) => getProviderDefinition(o.providerId));
  const droppedCount = input.observations.length - known.length;

  if (known.length === 0) {
    const why = droppedCount > 0
      ? `No observations from registered providers (${droppedCount} dropped as unknown).`
      : 'No observations.';
    return {
      confidenceMultiplier: 0,
      label: 'very_low',
      components: {
        freshness: { score: 0, reason: why },
        reliability: { score: 0, reason: why },
        corroboration: { score: 0, reason: why },
      },
      disagreements: [],
      independentSourceCount: 0,
    };
  }

  const { consensus, disagreements } = splitConsensus(known, input.numericTolerance ?? 0);

  // Freshness: mean linear decay of consensus observations vs provider TTL.
  const freshnessScores = consensus.map((o) => {
    const ttl = getProviderDefinition(o.providerId)!.freshnessTtlMs;
    const age = Math.max(0, input.now - Math.min(o.observedAt, input.now));
    return Math.max(0, 1 - age / ttl);
  });
  const freshness = mean(freshnessScores);

  // Reliability: registry prior × observed success rate.
  const reliabilityScores = consensus.map((o) => {
    const def = getProviderDefinition(o.providerId)!;
    const health = deriveProviderHealth(input.healthState, o.providerId, input.now);
    return def.reliabilityWeight * health.successRate;
  });
  const reliability = mean(reliabilityScores);

  // Corroboration: independent groups in consensus, not raw provider count.
  const groups = independentGroupsFor(consensus.map((o) => o.providerId));
  const independentSourceCount = groups.size;
  const corroboration = independentSourceCount >= 3 ? 0.95 : independentSourceCount === 2 ? 0.8 : independentSourceCount === 1 ? 0.5 : 0;

  let multiplier = freshness * WEIGHTS.freshness + reliability * WEIGHTS.reliability + corroboration * WEIGHTS.corroboration;
  if (disagreements.length > 0) multiplier = Math.min(multiplier, DISAGREEMENT_CAP);
  multiplier = clamp01(multiplier);

  return {
    confidenceMultiplier: multiplier,
    label: labelFor(multiplier),
    components: {
      freshness: { score: freshness, reason: `Mean freshness ${freshness.toFixed(2)} across ${consensus.length} consensus observation(s).` },
      reliability: { score: reliability, reason: `Mean prior×observed reliability ${reliability.toFixed(2)}.` },
      corroboration: { score: corroboration, reason: `${independentSourceCount} independent source group(s) agree${droppedCount > 0 ? `; ${droppedCount} unknown-provider observation(s) dropped` : ''}.` },
    },
    disagreements,
    independentSourceCount,
  };
}

/** Consensus = the largest agreement cluster; everything else disagrees. */
function splitConsensus(
  observations: readonly SourceObservation[],
  tolerance: number,
): { consensus: SourceObservation[]; disagreements: Disagreement[] } {
  const clusters: SourceObservation[][] = [];
  for (const o of observations) {
    const home = clusters.find((c) => agrees(c[0].value, o.value, tolerance));
    if (home) home.push(o);
    else clusters.push([o]);
  }
  clusters.sort((a, b) => b.length - a.length);
  const [consensus = [], ...rest] = clusters;
  const disagreements = rest.map((c) => ({
    providerIds: c.map((o) => o.providerId),
    value: c[0].value,
    reason: `Differs from consensus value ${String(consensus[0]?.value)}.`,
  }));
  return { consensus, disagreements };
}

function agrees(a: number | string, b: number | string, tolerance: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tolerance;
  return a === b;
}

function labelFor(m: number): FusionLabel {
  if (m < 0.2) return 'very_low';
  if (m < 0.4) return 'low';
  if (m < 0.6) return 'moderate';
  if (m < 0.8) return 'high';
  return 'very_high';
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/providers/__tests__/source-fusion.test.mts`
Expected: all 8 tests PASS. If the `very_high` assertion fails, check the math: 3 healthy independent sources at T0 give freshness 1, reliability ≈ mean(0.85, 0.7, 0.7) ≈ 0.75, corroboration 0.95 → multiplier ≈ 0.25 + 0.19 + 0.475 ≈ 0.91.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers
git commit -m "feat(providers): fusion scoring with independence-aware corroboration

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Bridge + singleton state

**Files:**
- Create: `src/services/providers/provider-bridge.ts`
- Create: `src/services/providers/providers-state.ts`
- Test: `src/services/providers/__tests__/provider-bridge.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotsFromRegistry } from '../provider-bridge.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../provider-health.ts';
import { assessProviderRedundancy } from '../../diagnostics/provider-redundancy.ts';
import {
  getProviderHealthState,
  recordProviderFetchOutcome,
  resetProvidersStateForTest,
} from '../providers-state.ts';

const T0 = 1_750_000_000_000;
const ok = (at: number) => ({ ok: true, latencyMs: 100, httpStatus: 200, at });
const fail = (at: number) => ({ ok: false, latencyMs: 0, httpStatus: 500, at, errorMessage: 'http 500' });

test('snapshots satisfy the provider-redundancy contract', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'adsbexchange', ok(T0));
  s = recordFetchOutcome(s, 'opensky', ok(T0));
  const snapshots = snapshotsFromRegistry(s, T0 + 1000, 'adsb');
  const report = assessProviderRedundancy({ generatedAt: T0 + 1000, snapshots });
  const adsb = report.domains.find((d) => d.domain === 'adsb');
  assert.ok(adsb);
  assert.equal(adsb.verdict, 'redundant_agreement');
});

test('primary down with healthy backup maps to the right verdict', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < 3; i++) s = recordFetchOutcome(s, 'adsbexchange', fail(T0 + i)); // primary down
  s = recordFetchOutcome(s, 'opensky', ok(T0));
  // only the two providers with data, so backups without outcomes don't dilute the verdict
  const snapshots = snapshotsFromRegistry(s, T0 + 1000, 'adsb').filter(
    (snap) => snap.providerId === 'adsbexchange' || snap.providerId === 'opensky',
  );
  const report = assessProviderRedundancy({ generatedAt: T0 + 1000, snapshots });
  assert.equal(report.domains[0].verdict, 'primary_down_with_backup');
});

test('status maps to ProviderHealthLevel: down→failing, stale→silent', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < 3; i++) s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + i));
  s = recordFetchOutcome(s, 'gdacs', ok(T0)); // gdacs TTL 30 min
  const all = snapshotsFromRegistry(s, T0 + 60 * 60_000);
  assert.equal(all.find((p) => p.providerId === 'nws-alerts')?.level, 'failing');
  assert.equal(all.find((p) => p.providerId === 'gdacs')?.level, 'silent');
});

test('primary flag comes from fallbackPriority === 1', () => {
  const all = snapshotsFromRegistry(emptyProviderHealthState(), T0, 'adsb');
  assert.equal(all.find((p) => p.providerId === 'adsbexchange')?.primary, true);
  assert.equal(all.find((p) => p.providerId === 'opensky')?.primary, false);
});

test('singleton state records and resets', () => {
  resetProvidersStateForTest();
  recordProviderFetchOutcome('nws-alerts', ok(T0));
  assert.equal(getProviderHealthState().outcomes['nws-alerts']?.length, 1);
  resetProvidersStateForTest();
  assert.deepEqual(getProviderHealthState().outcomes, {});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test src/services/providers/__tests__/provider-bridge.test.mts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `provider-bridge.ts`**

```ts
/**
 * Bridge: emit the ProviderSnapshot shape that
 * src/services/diagnostics/provider-redundancy.ts already consumes, so
 * Command Center and SystemDiagnosticPanel keep working unchanged.
 */

import type { ProviderHealthLevel, ProviderSnapshot } from '../diagnostics/provider-redundancy.ts';
import type { ProviderDomain, ProviderStatus } from './provider-types.ts';
import { PROVIDER_DEFINITIONS } from './provider-registry.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { deriveProviderHealth } from './provider-health.ts';

const STATUS_TO_LEVEL: Record<ProviderStatus, ProviderHealthLevel> = {
  healthy: 'healthy',
  degraded: 'degraded',
  down: 'failing',
  stale: 'silent',
  unknown_provider: 'unknown',
};

export function snapshotsFromRegistry(
  state: ProviderHealthState,
  now: number,
  domain?: ProviderDomain,
): ProviderSnapshot[] {
  const defs = domain ? PROVIDER_DEFINITIONS.filter((d) => d.domain === domain) : PROVIDER_DEFINITIONS;
  return defs.map((def) => {
    const health = deriveProviderHealth(state, def.id, now);
    return {
      providerId: def.id,
      domain: def.domain,
      label: def.displayName,
      primary: def.fallbackPriority === 1,
      level: STATUS_TO_LEVEL[health.status],
      lastSuccessAt: health.lastSuccessAt,
      successRate: health.successRate,
      lastError: health.lastError,
    };
  });
}
```

- [ ] **Step 4: Write `providers-state.ts`**

Follows the `diagnostics-state.ts` singleton pattern:

```ts
/**
 * Singleton provider-health state. Fetch sites call
 * recordProviderFetchOutcome(); readers derive via the pure modules.
 * In-memory only for this batch (no persistence across restarts).
 */

import type { FetchOutcome } from './provider-types.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { emptyProviderHealthState, recordFetchOutcome } from './provider-health.ts';

let state: ProviderHealthState = emptyProviderHealthState();

export function recordProviderFetchOutcome(providerId: string, outcome: FetchOutcome): void {
  state = recordFetchOutcome(state, providerId, outcome);
}

export function getProviderHealthState(): ProviderHealthState {
  return state;
}

export function resetProvidersStateForTest(): void {
  state = emptyProviderHealthState();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/services/providers/__tests__/provider-bridge.test.mts`
Expected: all 5 tests PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run test:providers` — expected: all 4 files PASS.
Run: `npm run typecheck:all` — expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/providers
git commit -m "feat(providers): redundancy bridge + singleton health state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Supersede the legacy data-bridge translation

**Files:**
- Modify: `src/services/insights/data-bridge.ts:151-198` (the `KNOWN_DOMAIN_BY_SOURCE` / `KNOWN_PRIMARIES` / `bridgeSourcesToProviderRedundancy` block)
- Test: `src/services/providers/__tests__/data-bridge-supersession.test.mts`
- Modify: `package.json` (append the new test file to `test:providers`)

The existing `bridgeSourcesToProviderRedundancy(sources)` hand-translates `SourceDiagnosticLike[]` into snapshots using hardcoded domain/primary maps. Replace its body so registry-known sources flow through the registry (diagnostic status recorded as a synthetic fetch outcome, snapshot derived from registry health) while sources NOT in the registry keep the legacy translation. The function signature does not change, so the caller at `src/app/panel-layout.ts:1873` needs no edit.

- [ ] **Step 1: Write the failing test**

Create `src/services/providers/__tests__/data-bridge-supersession.test.mts`:

```ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeSourcesToProviderRedundancy } from '../../insights/data-bridge.ts';
import { resetProvidersStateForTest, getProviderHealthState } from '../providers-state.ts';

beforeEach(() => resetProvidersStateForTest());

test('registry-known source gets registry metadata, not the legacy map', () => {
  const snapshots = bridgeSourcesToProviderRedundancy([
    { id: 'nws-alerts', name: 'whatever the caller said', status: 'healthy', lastUpdateMs: 1_750_000_000_000 },
  ]);
  const nws = snapshots.find((s) => s.providerId === 'nws-alerts');
  assert.ok(nws);
  assert.equal(nws.label, 'NWS Alerts');       // displayName from registry
  assert.equal(nws.domain, 'weather');
  assert.equal(nws.primary, true);              // fallbackPriority === 1
});

test('registry-known source records a fetch outcome into providers-state', () => {
  bridgeSourcesToProviderRedundancy([
    { id: 'nws-alerts', name: 'NWS', status: 'healthy', lastUpdateMs: 1_750_000_000_000 },
  ]);
  assert.equal(getProviderHealthState().outcomes['nws-alerts']?.length, 1);
});

test('unregistered source falls back to the legacy translation', () => {
  const snapshots = bridgeSourcesToProviderRedundancy([
    { id: 'some-legacy-feed', name: 'Legacy Feed', status: 'degraded' },
  ]);
  const legacy = snapshots.find((s) => s.providerId === 'some-legacy-feed');
  assert.ok(legacy);
  assert.equal(legacy.label, 'Legacy Feed');
  assert.equal(legacy.level, 'degraded');
});
```

Append the file to the `test:providers` script in `package.json`.

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test src/services/providers/__tests__/data-bridge-supersession.test.mts`
Expected: FAIL — the first test gets `label: 'whatever the caller said'` from the legacy path.

- [ ] **Step 3: Rewrite `bridgeSourcesToProviderRedundancy` in `data-bridge.ts`**

Read the file first (other sessions may have changed it — re-read immediately before editing). Keep `KNOWN_DOMAIN_BY_SOURCE`, `KNOWN_PRIMARIES`, and `STATUS_TO_LEVEL` (still used for unregistered sources). Replace the function body:

```ts
import { getProviderDefinition } from '../providers/provider-registry';
import { snapshotsFromRegistry } from '../providers/provider-bridge';
import { recordProviderFetchOutcome, getProviderHealthState } from '../providers/providers-state';

/** Translate api-diagnostic SourceDiagnostic[] into ProviderSnapshot[]
 *  and push them through the singleton. Registry-known sources flow
 *  through the provider registry (richer health + fusion); unregistered
 *  sources keep the legacy translation. */
export function bridgeSourcesToProviderRedundancy(
  sources: readonly SourceDiagnosticLike[],
): readonly ProviderSnapshot[] {
  const now = Date.now();
  const registryIds = new Set<string>();
  const legacy: ProviderSnapshot[] = [];

  for (const s of sources) {
    if (getProviderDefinition(s.id)) {
      registryIds.add(s.id);
      const okStatus = s.status === 'healthy' || s.status === 'degraded';
      recordProviderFetchOutcome(s.id, {
        ok: okStatus,
        latencyMs: 0,
        at: s.lastUpdateMs ?? now,
        errorMessage: okStatus ? undefined : `diagnostic status: ${s.status}`,
      });
    } else {
      legacy.push({
        providerId: s.id,
        domain: s.domain ?? KNOWN_DOMAIN_BY_SOURCE[s.id] ?? s.id,
        label: s.name,
        primary: s.primary ?? KNOWN_PRIMARIES.has(s.id),
        level: STATUS_TO_LEVEL[s.status] ?? 'unknown',
        lastSuccessAt: s.lastUpdateMs ?? undefined,
      });
    }
  }

  const fromRegistry = snapshotsFromRegistry(getProviderHealthState(), now)
    .filter((snap) => registryIds.has(snap.providerId));
  const snapshots = [...fromRegistry, ...legacy];
  setProviderSnapshots(snapshots);
  return snapshots;
}
```

Note the filter to `registryIds`: only providers the diagnostics actually reported get snapshots, so the 17 not-yet-wired P0 definitions don't flood the redundancy report as permanently-stale domains.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:providers`
Expected: all 5 files PASS. Also run the existing insights suites that cover data-bridge: `grep -l 'data-bridge' src/services/insights/__tests__/*.mts | xargs npx tsx --test` — expected PASS (fix regressions if the legacy path behavior changed for unregistered ids; it must not).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck:all` — zero errors.

```bash
git add src/services/insights/data-bridge.ts src/services/providers package.json
git commit -m "feat(providers): route registry-known sources through provider registry

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Docs, final verification, push, PR

**Files:**
- Modify: `CLAUDE.md` (Architecture section + test scripts list)

- [ ] **Step 1: Document the new layer in `CLAUDE.md`**

In the Architecture tree under `src/services/`, after the datacenter block, add:

```text
    # ── Provider registry + fusion core (see docs/superpowers/specs/2026-06-11-provider-registry-fusion-core-design.md) ──
    providers/provider-types.ts              # ProviderDefinition, FetchOutcome, ProviderHealth, SourceObservation, FusionResult
    providers/provider-registry.ts           # static catalog (live sources + P0 expansion batch), independence groups
    providers/provider-health.ts             # pure record/derive: ring buffer → healthy/stale/degraded/down + quota detection
    providers/source-fusion.ts               # freshness × reliability × independence-aware corroboration; disagreements surface, capped at 0.6
    providers/provider-bridge.ts             # snapshotsFromRegistry → provider-redundancy ProviderSnapshot contract
    providers/providers-state.ts             # singleton: recordProviderFetchOutcome / getProviderHealthState
```

In the "Test scripts" line of the Foundation Intelligence Layers section, add `test:providers`.

- [ ] **Step 2: Full verification**

```bash
npm run test:providers
npm run typecheck:all
npm run docs:check
```

Expected: all pass. If `docs:check` flags a count drift, fix the flagged doc line.

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: document provider registry + fusion core layer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin claude/provider-registry-fusion-core
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --repo bradleybond512/crystal-ball \
  --title "Provider registry + fusion core" \
  --body "Implements docs/superpowers/specs/2026-06-11-provider-registry-fusion-core-design.md: static provider catalog (live sources + P0 expansion definitions), pure health derivation, independence-aware fusion scoring, and a bridge into the existing provider-redundancy verdicts. Registry-known sources in data-bridge now flow through the registry. Fixture-tested (npm run test:providers); typecheck:all clean."
```

Note: `claude/*` branches require a cross-agent (Codex) review before merge — run `npm run cross-check` and follow its instructions; do not self-attest.
