# Provider Registry + Fusion Core — Design

Date: 2026-06-11
Status: approved design, pre-implementation

## Goal

A single deterministic layer, `src/services/providers/`, through which every
data source — existing feeds and the ~99 candidates in
`docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md` — is declared, health-tracked, and
fusion-scored. It feeds the existing provider-redundancy verdict engine and the
intelligence layer's confidence math, so adding a new API becomes a cheap,
uniform operation instead of bespoke wiring.

This batch builds the core only. Fetcher wiring for new APIs, sidecar routes,
and UI changes land in later batches (one domain per PR).

## Invariants (inherited from the foundation layers)

- Pure deterministic functions: no DOM, no fetch, no timers, no globals.
- Every score includes an explanation.
- Stale data reduces confidence; it never silently disappears.
- Contradictions surface separately; they are never averaged away.
- Everything is testable with static fixtures.

## Components

### 1. Provider Registry — `provider-types.ts`, `provider-registry.ts`

A static, typed catalog. Each `ProviderDefinition`:

| Field | Meaning |
|---|---|
| `id` | stable slug, e.g. `airplanes-live` |
| `domain` | `weather \| disasters \| adsb \| aviation \| commodities \| food_security \| conflict \| cyber \| markets \| maritime \| infrastructure \| transport \| space` |
| `displayName` | human label |
| `authType` | `none \| free_key \| account` |
| `requiredSecret` | key name from `SUPPORTED_SECRET_KEYS`, when keyed |
| `baseUrl` | reference base URL |
| `rateLimitNote` | human note for diagnostics display |
| `freshnessTtlMs` | how long a successful fetch counts as fresh |
| `reliabilityWeight` | 0–1 prior reliability |
| `fallbackPriority` | 1 = primary, 2+ = backups within a domain |
| `independenceGroup` | shared-upstream group key; providers in the same group count as ONE independent source for corroboration (mirrors the evidence graph's derivedFrom-aware counting) |

Seeding order: current live sources first, then the P0 batch from the
expansion doc as definitions only.

Accessors: `getProviderDefinition(id)`, `providersForDomain(domain)`,
`independentGroupsFor(providerIds)`.

### 2. Provider Health — `provider-health.ts`

Pure record/derive, caller-supplied clock:

- `recordFetchOutcome(state, providerId, {ok, latencyMs, httpStatus, at})` →
  new state with a bounded ring buffer per provider (default 50 outcomes).
- `deriveProviderHealth(state, providerId, now)` →
  `{ status: 'healthy' | 'stale' | 'degraded' | 'down', successRate, p50LatencyMs, quotaSuspected, lastSuccessAt, lastError }`.

Status rules:

- `down`: N consecutive failures (default 3).
- `degraded`: rolling success rate below threshold (default < 0.7).
- `stale`: last success older than the provider's `freshnessTtlMs`.
- `quotaSuspected`: recent 429s, or repeated 403s after prior successes.

Callers (data-loader, sidecar fetch wrappers) only report outcomes; this layer
derives everything. State lives in a singleton module
(`providers-state.ts`) following the `diagnostics-state.ts` pattern.

### 3. Fusion Scoring — `source-fusion.ts`

Input: a set of `SourceObservation`s of the same fact —
`{ providerId, value, observedAt }` with `value` numeric or categorical.

Scores, each 0–1 with a reason string:

- **freshness** — linear decay of each observation against its provider's TTL.
- **reliability** — registry prior × observed success rate from health state.
- **corroboration** — count of agreeing *independent* groups (via
  `independenceGroup`), not raw provider count.
- **disagreement** — numeric values outside a caller-supplied tolerance, or
  categorical mismatch, produce explicit `Disagreement` entries in the output.
  Disagreeing observations are excluded from corroboration but reported, never
  averaged.

Output `FusionResult`:

```ts
{
  confidenceMultiplier: number;      // 0–1, for downstream scoring
  label: 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
  components: { freshness; reliability; corroboration };  // each {score, reason}
  disagreements: Disagreement[];
  independentSourceCount: number;
}
```

Shape is designed to slot into the intelligence layer's
`ConfidenceBreakdown` without adaptation.

### 4. Bridge — `provider-bridge.ts`

- `snapshotsFromRegistry(state, now, domain?)` emits the `ProviderSnapshot`
  shape `src/services/diagnostics/provider-redundancy.ts` already consumes, so
  Command Center and the diagnostics panel keep working unchanged.
- The registry-driven path is the primary path for registered sources.
  `bridgeSourcesToProviderRedundancy()` in `src/services/insights/data-bridge.ts`
  is **kept as a fallback** for unregistered source ids (e.g. legacy diagnostic
  ids not yet in the registry); it is not removed.
- The SystemDiagnosticPanel Feeds tab reading registry health is **deferred** to
  a later batch (out of scope for this PR).

## Data Flow

```
fetch sites (data-loader / sidecar wrappers)
      │ recordFetchOutcome()
      ▼
providers-state (singleton)
      │ deriveProviderHealth()          │ snapshotsFromRegistry()
      ▼                                 ▼
source-fusion (per-fact)        provider-redundancy verdicts
      │                                 │
      ▼                                 ▼
ConfidenceBreakdown inputs      Command Center / SystemDiagnosticPanel
```

## Error Handling

- Unknown `providerId` in record/derive calls: derive returns a typed
  `unknown_provider` result rather than throwing; record is a no-op with a
  diagnostics-event emission.
- Empty observation sets to fusion: `very_low` label,
  `independentSourceCount: 0`, reason "no observations".
- Clock skew (observation `observedAt` in the future): clamp to `now` for
  freshness; never produce scores above 1.

## Testing

Fixture-only suite, `npm run test:providers`:

- registry: definitions validate (unique ids, TTL > 0, weights in range,
  keyed providers reference real secret names).
- health: synthetic outcome sequences → assert each status transition,
  quota detection, ring-buffer bounding.
- fusion: independence-group collapsing (3 same-group providers → 1
  independent source), disagreement surfacing, freshness decay edges,
  empty-set behavior.
- bridge: emitted snapshots satisfy provider-redundancy's input contract and
  reproduce its existing verdicts on a known fixture.

## Out of Scope

- Fetcher implementations for new APIs (batch 2+, one domain per PR).
- New sidecar routes.
- UI changes beyond what the bridge feeds automatically.
- Persisting health state across restarts (in-memory only for this batch).
- SystemDiagnosticPanel Feeds tab reading registry health (deferred to a later batch).
