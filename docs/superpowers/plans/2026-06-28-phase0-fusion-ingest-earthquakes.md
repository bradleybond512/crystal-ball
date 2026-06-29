# Phase 0 — Fusion-Ingest Keystone (Earthquakes USGS + EMSC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the already-built-but-dark fusion engine end-to-end on one domain — fuse USGS + EMSC earthquake observations into a per-fact `FusionResult` and a `redundant_agreement` redundancy verdict, surfaced as a "verified by N independent sources" chip.

**Architecture:** A new pure, fixture-tested fusion-ingest layer sits between the (already-existing) USGS and EMSC fetchers and the redundancy/intelligence stack. It (1) matches observations of the *same* real-world quake across providers, (2) calls the existing `fuseObservations()` per matched fact, (3) computes a stable `recentFactFingerprint` per provider so `provider-redundancy.ts` can emit a true `redundant_agreement`. The data-loader wires the two live fetches in; Command Center renders the verdict.

**Tech Stack:** TypeScript (ESM, `.ts`/`.mts`), `node:test` + `node:assert/strict` run via `tsx`, the existing `src/services/providers/` fusion core, the Node sidecar (`local-api-server.mjs`).

**Reference spec:** `docs/superpowers/specs/2026-06-28-redundancy-prediction-enhancement-program-design.md`

**Invariants (every task honors):** pure service layer (no DOM/fetch/globals in `src/services/providers/`), every score explains itself, contradictions surface (never averaged), stale reduces confidence, every output fixture-testable with no live fetch in unit tests.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/services/providers/provider-registry.ts` | Add `emsc-seismic` provider def (independence group `emsc`). | Modify |
| `src/services/providers/provider-domain-map.ts` | Map a fusable fact-type → the provider ids that feed it + the per-domain numeric tolerance + match config. | Create |
| `src/services/providers/fusion-ingest.ts` | Pure: match observations into facts, fuse each, emit `FusedFact[]` + headline per-provider fingerprints. | Create |
| `src/services/providers/provider-bridge.ts` | Accept an optional fingerprint map so snapshots carry `recentFactFingerprint`. | Modify |
| `src/services/providers/__tests__/provider-domain-map.test.mts` | Tests for the map + tolerance. | Create |
| `src/services/providers/__tests__/fusion-ingest.test.mts` | Fixture tests: agreement, disagreement, single-source, no-match. | Create |
| `src/services/providers/__tests__/provider-bridge.test.mts` | Extend: fingerprint injection. | Modify |
| `package.json` | Add the two new test files to `test:providers`. | Modify |
| `src/app/data-loader.ts` | Fetch USGS + EMSC, adapt to `DomainObservation[]`, run ingest, record outcomes, push enriched snapshots. | Modify |
| `src/services/diagnostics/diagnostics-state.ts` (or insights-state) | Hold the latest earthquake provider snapshots for Command Center. | Modify (TBD-at-exec: pick the existing setter) |
| `src/components/CommandCenterPanel.ts` | Render a "verified by N independent sources" chip from the redundancy report. | Modify |

---

## Task 1: Register EMSC as an earthquake provider

**Files:**
- Modify: `src/services/providers/provider-registry.ts` (the `disasters` block, near the `usgs-earthquakes` entry on line 15)
- Test: `src/services/providers/__tests__/provider-registry.test.mts` (existing — add one case)

**Context:** `usgs-earthquakes` exists with `independenceGroup: 'usgs'`, `fallbackPriority: 2`, `domain: 'disasters'`. The registry test enforces *exactly one* `fallbackPriority === 1` per `ProviderDomain`, so EMSC must NOT be priority 1 in `disasters`. Give it `fallbackPriority: 3` and its own independence group `emsc` (EMSC is a fully independent agency from USGS).

- [ ] **Step 1: Write the failing test** — append to `provider-registry.test.mts`:

```typescript
test('emsc-seismic is registered as an independent earthquake source', () => {
  const emsc = getProviderDefinition('emsc-seismic');
  assert.ok(emsc, 'emsc-seismic must be registered');
  assert.equal(emsc!.domain, 'disasters');
  assert.equal(emsc!.independenceGroup, 'emsc');
  assert.notEqual(emsc!.independenceGroup, getProviderDefinition('usgs-earthquakes')!.independenceGroup);
  // USGS + EMSC must read as 2 independent groups (drives corroboration 0.8).
  assert.equal(independentGroupsFor(['usgs-earthquakes', 'emsc-seismic']).size, 2);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `tsx --test src/services/providers/__tests__/provider-registry.test.mts`
Expected: FAIL — `emsc-seismic must be registered`.

- [ ] **Step 3: Add the provider definition** — in `provider-registry.ts`, directly after the `usgs-earthquakes` entry:

```typescript
  { id: 'emsc-seismic', domain: 'disasters', displayName: 'EMSC Seismic', authType: 'none', baseUrl: 'https://www.seismicportal.eu', rateLimitNote: 'fair-use, no key', freshnessTtlMs: 10 * MIN, reliabilityWeight: 0.9, fallbackPriority: 3, independenceGroup: 'emsc' },
```

- [ ] **Step 4: Run it, verify it passes**

Run: `tsx --test src/services/providers/__tests__/provider-registry.test.mts`
Expected: PASS (all cases, including the existing "exactly one primary per domain").

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/provider-registry.ts src/services/providers/__tests__/provider-registry.test.mts
git commit -m "feat(providers): register EMSC as an independent earthquake source

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Provider-domain map + per-domain fusion config

**Files:**
- Create: `src/services/providers/provider-domain-map.ts`
- Test: `src/services/providers/__tests__/provider-domain-map.test.mts`

**Context:** The fusion engine keys on `ProviderDomain` ('disasters'), but fusion happens at a finer fact-type granularity ('earthquakes'). This map declares, per fusable fact-type: the provider ids that feed it, the numeric tolerance (magnitudes within ±0.5 agree), and the spatiotemporal match window (same quake if ≤50 km and ≤120 s apart — EMSC vs USGS event times can differ ~1–2 min).

- [ ] **Step 1: Write the failing test** — `provider-domain-map.test.mts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUSION_DOMAINS, fusionConfigFor } from '../provider-domain-map.ts';
import { getProviderDefinition } from '../provider-registry.ts';

test('earthquakes domain maps to USGS + EMSC', () => {
  const cfg = fusionConfigFor('earthquakes');
  assert.ok(cfg, 'earthquakes config must exist');
  assert.deepEqual([...cfg!.providerIds].sort(), ['emsc-seismic', 'usgs-earthquakes']);
  assert.equal(cfg!.numericTolerance, 0.5);
  assert.equal(cfg!.match.maxDistanceKm, 50);
  assert.equal(cfg!.match.maxTimeDeltaMs, 120_000);
});

test('every fusion-domain provider id is registered', () => {
  for (const cfg of Object.values(FUSION_DOMAINS)) {
    for (const id of cfg.providerIds) {
      assert.ok(getProviderDefinition(id), `${id} must be in the provider registry`);
    }
  }
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `tsx --test src/services/providers/__tests__/provider-domain-map.test.mts`
Expected: FAIL — cannot find module `../provider-domain-map.ts`.

- [ ] **Step 3: Create the map** — `provider-domain-map.ts`:

```typescript
/**
 * Maps a fusable fact-type (finer than ProviderDomain) to the providers
 * that feed it, the numeric tolerance for agreement, and the
 * spatiotemporal window that decides whether two observations are the
 * same real-world fact. Pure data — no DOM, no fetch, no globals.
 */

export interface FactMatchConfig {
  /** Two observations are the same fact if within this great-circle distance. */
  maxDistanceKm: number;
  /** ...and within this time delta. */
  maxTimeDeltaMs: number;
}

export interface FusionDomainConfig {
  /** Registered provider ids that feed this fact-type. */
  providerIds: readonly string[];
  /** Numeric values within this absolute tolerance agree (passed to fuseObservations). */
  numericTolerance: number;
  match: FactMatchConfig;
}

export type FusionDomainKey = 'earthquakes';

export const FUSION_DOMAINS: Record<FusionDomainKey, FusionDomainConfig> = {
  earthquakes: {
    providerIds: ['usgs-earthquakes', 'emsc-seismic'],
    numericTolerance: 0.5,
    match: { maxDistanceKm: 50, maxTimeDeltaMs: 120_000 },
  },
};

export function fusionConfigFor(key: string): FusionDomainConfig | undefined {
  return (FUSION_DOMAINS as Record<string, FusionDomainConfig>)[key];
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `tsx --test src/services/providers/__tests__/provider-domain-map.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/provider-domain-map.ts src/services/providers/__tests__/provider-domain-map.test.mts
git commit -m "feat(providers): add provider-domain map + per-domain fusion config

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Fusion-ingest — match, fuse, fingerprint

**Files:**
- Create: `src/services/providers/fusion-ingest.ts`
- Test: `src/services/providers/__tests__/fusion-ingest.test.mts`

**Context:** This is the keystone. Input: a fact-type key + a flat list of `DomainObservation` from all providers + the health state + `now`. Output: `FusedFact[]` (one per matched real-world fact) and a headline `providerFingerprints` map for the single most significant fact (highest value among facts ≥2 providers saw; else the highest-value single-source fact). The fingerprint is a stable bucket of the fused value so two agreeing providers share it and a disagreeing provider differs. Uses the existing `fuseObservations()` verbatim.

- [ ] **Step 1: Write the failing tests** — `fusion-ingest.test.mts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestDomain, type DomainObservation } from '../fusion-ingest.ts';
import { recordFetchOutcome, emptyProviderHealthState } from '../provider-health.ts';
import type { ProviderHealthState } from '../provider-health.ts';

const NOW = 1_745_000_000_000;

/** A health state where both quake providers are healthy. */
function healthyBoth(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['usgs-earthquakes', 'emsc-seismic']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: NOW });
  }
  return s;
}

function obs(providerId: string, o: Partial<DomainObservation> = {}): DomainObservation {
  return { providerId, value: 6.0, lat: 35.0, lon: 139.0, occurredAt: NOW, ...o };
}

test('two providers see the same quake → matched, corroborated, agreeing fingerprints', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35.00, lon: 139.00, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.0, lat: 35.10, lon: 139.05, occurredAt: NOW + 30_000 }),
  ], healthyBoth(), NOW);

  assert.equal(r.facts.length, 1, 'same quake collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.providerIds.length, 2);
  assert.equal(f.fusion.independentSourceCount, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  assert.ok(f.fusion.confidenceMultiplier > 0.6, 'corroborated, not disagreement-capped');
  // headline fingerprints agree across both providers
  assert.equal(r.providerFingerprints['usgs-earthquakes'], r.providerFingerprints['emsc-seismic']);
});

test('providers disagree on magnitude beyond tolerance → disagreement, distinct fingerprints, capped', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35.0, lon: 139.0, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 7.4, lat: 35.0, lon: 139.0, occurredAt: NOW }),
  ], healthyBoth(), NOW);

  const f = r.facts[0]!;
  assert.ok(f.fusion.disagreements.length >= 1, 'disagreement surfaces');
  assert.ok(f.fusion.confidenceMultiplier <= 0.6, 'capped at disagreement ceiling');
  assert.notEqual(r.providerFingerprints['usgs-earthquakes'], r.providerFingerprints['emsc-seismic']);
});

test('only one provider sees a quake → single source, no corroboration', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 5.5, lat: 10, lon: 10, occurredAt: NOW }),
  ], healthyBoth(), NOW);

  const f = r.facts[0]!;
  assert.equal(f.fusion.independentSourceCount, 1);
  assert.equal(Object.keys(r.providerFingerprints).length, 1);
});

test('quakes far apart in space do NOT match', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.0, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.0, lat: -35, lon: -70, occurredAt: NOW }),
  ], healthyBoth(), NOW);
  assert.equal(r.facts.length, 2, 'distinct quakes stay distinct');
});

test('unknown fact-type returns empty', () => {
  const r = ingestDomain('nope', [obs('usgs-earthquakes')], healthyBoth(), NOW);
  assert.equal(r.facts.length, 0);
  assert.deepEqual(r.providerFingerprints, {});
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `tsx --test src/services/providers/__tests__/fusion-ingest.test.mts`
Expected: FAIL — cannot find module `../fusion-ingest.ts`.

- [ ] **Step 3: Implement** — `fusion-ingest.ts`:

```typescript
/**
 * Fusion ingest: turn per-provider observations of a fact-type into
 * matched, fused facts with per-provider fingerprints. The keystone that
 * activates source-fusion.ts on live data.
 *
 * Pure: no DOM, no fetch, no globals. The data-loader adapts live
 * responses into DomainObservation[] and calls ingestDomain().
 */

import type { FusionResult, SourceObservation } from './provider-types.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { fuseObservations } from './source-fusion.ts';
import { fusionConfigFor, type FactMatchConfig } from './provider-domain-map.ts';

export interface DomainObservation {
  providerId: string;
  /** The numeric value to corroborate (e.g. earthquake magnitude). */
  value: number;
  lat: number;
  lon: number;
  /** When the fact occurred (ms). */
  occurredAt: number;
  /** Optional provider-native id, for debugging. */
  externalId?: string;
}

export interface FusedFact {
  providerIds: string[];
  value: number;
  lat: number;
  lon: number;
  occurredAt: number;
  fusion: FusionResult;
  /** Per-provider fingerprint for this fact (agree → equal, disagree → differ). */
  fingerprints: Record<string, string>;
}

export interface IngestResult {
  facts: FusedFact[];
  /** Headline per-provider fingerprints (most significant fact) for the
   *  domain-level provider-redundancy snapshot. */
  providerFingerprints: Record<string, string>;
}

const EARTH_RADIUS_KM = 6371;

export function ingestDomain(
  key: string,
  observations: readonly DomainObservation[],
  healthState: ProviderHealthState,
  now: number,
): IngestResult {
  const cfg = fusionConfigFor(key);
  if (!cfg) return { facts: [], providerFingerprints: {} };

  const allowed = new Set(cfg.providerIds);
  const relevant = observations.filter((o) => allowed.has(o.providerId));
  const clusters = clusterObservations(relevant, cfg.match);

  const facts: FusedFact[] = clusters.map((cluster) => {
    const sourceObs: SourceObservation[] = cluster.map((o) => ({
      providerId: o.providerId,
      value: o.value,
      observedAt: o.occurredAt,
    }));
    const fusion = fuseObservations({
      observations: sourceObs,
      healthState,
      now,
      numericTolerance: cfg.numericTolerance,
    });
    // Fingerprint = tolerance-bucketed value so agreeing providers collide.
    const fingerprints: Record<string, string> = {};
    for (const o of cluster) {
      fingerprints[o.providerId] = bucket(o.value, cfg.numericTolerance);
    }
    const rep = cluster[0]!;
    return {
      providerIds: cluster.map((o) => o.providerId),
      value: rep.value,
      lat: rep.lat,
      lon: rep.lon,
      occurredAt: rep.occurredAt,
      fusion,
      fingerprints,
    };
  });

  return { facts, providerFingerprints: headlineFingerprints(facts) };
}

/** Greedy single-link clustering: an observation joins the first cluster
 *  whose seed is within the match window; otherwise it seeds a new one. */
function clusterObservations(
  observations: readonly DomainObservation[],
  match: FactMatchConfig,
): DomainObservation[][] {
  const clusters: DomainObservation[][] = [];
  for (const o of observations) {
    const home = clusters.find((c) => sameFact(c[0]!, o, match));
    if (home) home.push(o);
    else clusters.push([o]);
  }
  return clusters;
}

function sameFact(a: DomainObservation, b: DomainObservation, match: FactMatchConfig): boolean {
  if (Math.abs(a.occurredAt - b.occurredAt) > match.maxTimeDeltaMs) return false;
  return haversineKm(a.lat, a.lon, b.lat, b.lon) <= match.maxDistanceKm;
}

/** Pick the fact with the most independent providers, breaking ties by value. */
function headlineFingerprints(facts: readonly FusedFact[]): Record<string, string> {
  if (facts.length === 0) return {};
  const headline = [...facts].sort((a, b) => {
    if (b.providerIds.length !== a.providerIds.length) return b.providerIds.length - a.providerIds.length;
    return b.value - a.value;
  })[0]!;
  return { ...headline.fingerprints };
}

function bucket(value: number, tolerance: number): string {
  const size = tolerance > 0 ? tolerance : 1;
  return `v:${Math.round(value / size)}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
```

> Note on the disagreement test: USGS 6.1 and EMSC 7.4 are within 50 km / same time, so they cluster as one fact; `fuseObservations` then splits them into consensus + disagreement (|6.1−7.4|=1.3 > tolerance 0.5), caps the multiplier at 0.6, and their buckets differ (`v:12` vs `v:15`). Agreement test: 6.1 and 6.0 bucket identically (`v:12`).

- [ ] **Step 4: Run it, verify it passes**

Run: `tsx --test src/services/providers/__tests__/fusion-ingest.test.mts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/fusion-ingest.ts src/services/providers/__tests__/fusion-ingest.test.mts
git commit -m "feat(providers): fusion-ingest matcher — fuse same-fact observations across providers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Bridge fingerprints into provider snapshots

**Files:**
- Modify: `src/services/providers/provider-bridge.ts`
- Test: `src/services/providers/__tests__/provider-bridge.test.mts` (existing — add one case)

**Context:** `snapshotsFromRegistry()` currently never sets `recentFactFingerprint`, which is exactly why `provider-redundancy.ts` always returns `redundant_unverified`. Add an optional fingerprint map; when a provider has a fingerprint, attach it so the verdict engine can emit `redundant_agreement` / `redundant_disagreement`.

- [ ] **Step 1: Write the failing test** — append to `provider-bridge.test.mts`:

```typescript
test('snapshotsFromRegistry attaches fingerprints when provided', () => {
  let s = emptyProviderHealthState();
  for (const id of ['usgs-earthquakes', 'emsc-seismic']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 50, at: NOW });
  }
  const snaps = snapshotsFromRegistry(s, NOW, 'disasters', {
    'usgs-earthquakes': 'v:12',
    'emsc-seismic': 'v:12',
  });
  const usgs = snaps.find((x) => x.providerId === 'usgs-earthquakes');
  const emsc = snaps.find((x) => x.providerId === 'emsc-seismic');
  assert.equal(usgs?.recentFactFingerprint, 'v:12');
  assert.equal(emsc?.recentFactFingerprint, 'v:12');
});
```

> If `NOW`, `emptyProviderHealthState`, or `recordFetchOutcome` aren't already imported in this test file, add them: `import { emptyProviderHealthState, recordFetchOutcome } from '../provider-health.ts';` and `const NOW = 1_745_000_000_000;`.

- [ ] **Step 2: Run it, verify it fails**

Run: `tsx --test src/services/providers/__tests__/provider-bridge.test.mts`
Expected: FAIL — `snapshotsFromRegistry` takes 3 args / fingerprint undefined.

- [ ] **Step 3: Implement** — change the `snapshotsFromRegistry` signature + body in `provider-bridge.ts`:

```typescript
export function snapshotsFromRegistry(
  state: ProviderHealthState,
  now: number,
  domain?: ProviderDomain,
  fingerprints?: Readonly<Record<string, string>>,
): ProviderSnapshot[] {
  const defs = domain ? PROVIDER_DEFINITIONS.filter((d) => d.domain === domain) : PROVIDER_DEFINITIONS;
  return defs.map((def) => {
    const health = deriveProviderHealth(state, def.id, now);
    const fp = fingerprints?.[def.id];
    return {
      providerId: def.id,
      domain: def.domain,
      label: def.displayName,
      primary: def.fallbackPriority === 1,
      level: STATUS_TO_LEVEL[health.status],
      lastSuccessAt: health.lastSuccessAt,
      successRate: health.successRate,
      lastError: health.lastError,
      ...(fp ? { recentFactFingerprint: fp } : {}),
    };
  });
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `tsx --test src/services/providers/__tests__/provider-bridge.test.mts`
Expected: PASS (existing cases + new).

- [ ] **Step 5: Wire the two new test files into the npm script** — in `package.json`, extend `test:providers` to include `provider-domain-map.test.mts` and `fusion-ingest.test.mts`. Then run the full suite:

Run: `npm run test:providers`
Expected: PASS (all provider tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/providers/provider-bridge.ts src/services/providers/__tests__/provider-bridge.test.mts package.json
git commit -m "feat(providers): bridge fact fingerprints into snapshots → unlocks redundant_agreement

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Integration test — ingest → redundancy verdict

**Files:**
- Test: `src/services/providers/__tests__/fusion-ingest.test.mts` (add an end-to-end case)

**Context:** Prove the whole pure chain: ingest → fingerprints → `snapshotsFromRegistry` → `assessProviderRedundancy` emits `redundant_agreement` (and `redundant_disagreement` when they differ). This is the deterministic acceptance test for the keystone — no live fetch.

- [ ] **Step 1: Write the failing test** — append to `fusion-ingest.test.mts`:

```typescript
import { snapshotsFromRegistry } from '../provider-bridge.ts';
import { assessProviderRedundancy } from '../../diagnostics/provider-redundancy.ts';

test('end to end: agreeing quakes → redundant_agreement for disasters', () => {
  const health = healthyBoth();
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.0, lat: 35.05, lon: 139.02, occurredAt: NOW + 20_000 }),
  ], health, NOW);

  const snaps = snapshotsFromRegistry(health, NOW, 'disasters', r.providerFingerprints);
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  const disasters = report.domains.find((d) => d.domain === 'disasters')!;
  assert.equal(disasters.verdict, 'redundant_agreement');
  assert.equal(disasters.confidenceMultiplier, 1);
});

test('end to end: disagreeing quakes → redundant_disagreement for disasters', () => {
  const health = healthyBoth();
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 7.6, lat: 35, lon: 139, occurredAt: NOW }),
  ], health, NOW);
  const snaps = snapshotsFromRegistry(health, NOW, 'disasters', r.providerFingerprints);
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  const disasters = report.domains.find((d) => d.domain === 'disasters')!;
  assert.equal(disasters.verdict, 'redundant_disagreement');
});
```

> The `disasters` domain may contain other providers (landslides, etc.) that are `silent` with no fingerprint. The verdict engine only inspects *up* providers; if other disasters providers read `silent`, they're ignored. If a second healthy disasters provider exists without a fingerprint, the test must record only USGS+EMSC as healthy — which `healthyBoth()` does (others stay `unknown_provider`/`silent`). Confirm at exec; if needed, assert on a dedicated test that filters snapshots to the two quake providers.

- [ ] **Step 2: Run it, verify it fails then passes**

Run: `npm run test:providers`
Expected: the two new cases drive the chain; PASS once Tasks 1–4 are in.

- [ ] **Step 3: Commit**

```bash
git add src/services/providers/__tests__/fusion-ingest.test.mts
git commit -m "test(providers): end-to-end ingest → redundant_agreement/disagreement

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Wire the live earthquake path

**Files:**
- Modify: `src/app/data-loader.ts` (earthquake load path)
- Modify: the existing diagnostics/insights state setter that Command Center reads provider snapshots from (identify exact function at exec — candidates: `src/services/insights/data-bridge.ts` `bridgeSourcesToProviderRedundancy`, or `src/services/diagnostics/diagnostics-state.ts`).

**Context:** The pure core is proven. Now feed it live data. The sidecar already serves USGS at `/api/earthquakes` and EMSC at `/api/emsc-seismic`. Adapt both responses into `DomainObservation[]`, run `ingestDomain('earthquakes', …, getProviderHealthState(), Date.now())`, record a fetch outcome per provider via `recordProviderFetchOutcome`, then publish `snapshotsFromRegistry(getProviderHealthState(), Date.now(), 'disasters', result.providerFingerprints)` into the state Command Center reads.

- [ ] **Step 1 (exec discovery):** Read `src/app/data-loader.ts` around the earthquake fetch and the EMSC fetch; read the chosen state setter's signature. Record exact symbols before editing.

- [ ] **Step 2:** Add an adapter (in `data-loader.ts` or a small `src/services/earthquake/earthquake-observations.ts`) converting a USGS event `{magnitude, lat, lon, time}` and an EMSC event `{mag, lat, lon, time}` into `DomainObservation` (filter null magnitudes; `occurredAt` from the event time in ms). Keep it pure + add a fixture test if it lives in `src/services/`.

- [ ] **Step 3:** In the earthquake refresh, after both fetches resolve: record outcomes, call `ingestDomain`, publish snapshots. On a failed fetch, record `{ ok: false, … }` so health degrades and the verdict can drop to `primary_down_with_backup` — never silently drop (fail-closed pattern).

- [ ] **Step 4 (verify):** Run the app dev server (`npm run dev`) per the preview workflow; confirm via preview console/logs that the earthquake refresh runs without errors and the redundancy report includes `disasters` with a non-`unknown` verdict.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(data-loader): fuse live USGS + EMSC earthquakes into the redundancy report

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Command Center "verified by N sources" chip

**Files:**
- Modify: `src/components/CommandCenterPanel.ts` (`renderTopRow`, line ~428, where the status `<span>` is rendered)

**Context:** Surface the redundancy verdict the user now has. Render a small chip — "✓ 2 sources" for `redundant_agreement`, "⚠ sources disagree" for `redundant_disagreement`, "1 source" for `single_source` — next to the existing status badge, reading the per-domain verdict from the redundancy report.

- [ ] **Step 1 (exec discovery):** Confirm how Command Center accesses the redundancy report (via `aggregateSystemHealth()` / a getter). Identify where a domain verdict is available at render time; if not currently passed in, thread the `ProviderRedundancyReport` through the panel's data source.

- [ ] **Step 2:** Add a pure helper `redundancyChip(verdict: RedundancyVerdict): string` returning the chip HTML (use existing inline-style + `escapeHtml` conventions; colors from `--accent` / a warning color). Unit-test the helper in a small `.test.mts` (verdict → label/symbol) since it's pure.

- [ ] **Step 3:** Render the chip inside `renderTopRow` next to the status span when a verdict is available for that row's domain.

- [ ] **Step 4 (verify):** `npm run dev`; preview-screenshot Command Center showing the chip. Resize check not needed (text chip).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(command-center): show source-corroboration chip from redundancy verdict

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification (run before opening the PR)

- [ ] `npm run test:providers` — all provider tests pass.
- [ ] `npm run typecheck:all` — zero errors (both tsconfigs).
- [ ] `npm run smoke:offline` — replay baseline + pipeline invariants green.
- [ ] `npm run docs:check` — no doc-freshness regressions (panel/secret counts).
- [ ] Update `CLAUDE.md` provider section to note `fusion-ingest.ts` + `provider-domain-map.ts` and that earthquakes is the first fused domain.
- [ ] Push branch, open PR, run cross-agent review (Claude → Codex; if Codex CLI is down per project memory, fall back to a Workflow adversarial review and note it honestly — never fabricate the marker).

## Self-Review notes

- **Spec coverage:** Phase 0 scope from the spec (fusion-ingest + provider-domain-map + observation matcher + fingerprint + tolerance config + Command Center chip on earthquakes) → Tasks 1–7. Provider-weighted consensus is already implemented upstream (not re-done). Persistent IDB health ledger + ADS-B degradation propagation are explicitly deferred to Phase 1.
- **Type consistency:** `DomainObservation`, `FusedFact`, `IngestResult`, `FusionDomainConfig`, `FactMatchConfig` defined in Tasks 2–3 and reused consistently; `ingestDomain` signature stable across Tasks 3/5/6; `snapshotsFromRegistry` 4th param added in Task 4 and used in Tasks 5/6.
- **Placeholder honesty:** Tasks 1–5 are fully specified (pure, complete code). Tasks 6–7 carry explicit `(exec discovery)` steps because they touch live wiring/UI whose exact setter/getter symbols must be read at execution time — these are real integration points, not vague TODOs.
