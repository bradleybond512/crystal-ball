# Prediction & Correlation Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute all 13 PRs of `docs/PREDICTION_UPLIFT_PLAN.md` — wire the dark calibration seams, expand ground truth, evolve the correlation engine under a new CI benchmark, and make kernel weights tunable.

**Architecture:** Four workstreams, one PR per section below, in the spec's mandatory order (`A1→A4 → B1→B2 → D1 → C1→C4 → B3 → D2`; D1 MUST merge before any C PR). Every PR: pure deterministic core + fixture tests + thin wiring, own `claude/*` branch from fresh `origin/main`, isolated worktree, Codex cross-agent review, `typecheck:all` zero, spec Progress Tracker row updated in the same commit.

**Tech Stack:** TypeScript (Vite renderer), `tsx --test` unit tests (`*.test.mts`), no new dependencies anywhere in this plan.

**Verified seam corrections (2026-07-21 audit, worktree @ ba5c100e)** — the spec doc was corrected in the same commit as this plan:
1. `CorrelationMapPanel` does NOT fetch the sidecar — it reads `getCausalChainBuilder().getChains()` in-process and renders causal chains as a list. The real A2 gap: kernel-scored pairs (`correlation-store`) have no surface.
2. `significantEdges()` in `lead-lag.ts` has NO Bonferroni correction (fixed thresholds `lift≥2 && z≥2 && support≥3` only), despite docs claiming otherwise. C1 adds a real correction.
3. `causal-chain.ts` has no "chain candidate" queue — `buildChain` is observation-level. C2 suppresses mediated rules and surfaces triples instead of force-feeding the wrong API.
4. `proxy-outcomes.ts` stores no proxy marker on records — "proxy-marked" in B-PRs means: resolved with a `resolutionNote` beginning `proxy:` (field added in B1).

**Session protocol per PR:** `git -C ~/Developer/crystalball worktree add .worktrees/<feature> -b claude/<feature> origin/main` → implement → `npm run typecheck:all` + relevant `test:*` → update spec tracker row → commit → push → real Codex review (`codex exec --sandbox read-only "<prompt>" < pr.diff`) → PR with honest cross-agent marker.

---

## PR A1: Wire both calibration bridges live

**Files:**
- Create: `src/services/intelligence/calibration-bridge-wiring.ts`
- Create: `src/services/intelligence/__tests__/calibration-bridge-wiring.test.mts`
- Modify: `src/services/cognition/cognition-settings.ts:22` (key union) and `:29` (registry array)
- Modify: `src/components/ShortageRadarPanel.ts:167` (render(), after `computeShortageFullSet`)
- Modify: `src/app/panel-layout.ts` (~line 1107 boot-cadence block; ~line 1135 hourly expiry timer)

- [ ] **Step 1: Add the kill-switch key**

In `cognition-settings.ts`, extend the union at line 22 and the array at line 29:

```ts
export type CognitionSwitchKey =
  | 'evoi-planner' | 'episodic-recall' | 'bocpd' | 'consolidation'
  | 'shadow-algorithms' | 'calibration-bridges';
```
Add `'calibration-bridges'` to `COGNITION_SWITCHES`. Run `npm run test:cognition` — any test asserting the switch list must be updated in the same step.

- [ ] **Step 2: Write failing tests for the wiring module**

`calibration-bridge-wiring.test.mts` — test the module before writing it:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { wireModeForecastCalibration, settleCalibrationBridges }
  from '../calibration-bridge-wiring';

test('wireModeForecastCalibration records then resolves via injected fns', () => {
  const calls: string[] = [];
  wireModeForecastCalibration(
    { advisories: [{ domain: 'finance', pressure: 0.7 } as never] },
    {
      resolveFromObservation: (d, p) => { calls.push(`resolve:${d}:${p}`); return 0; },
      recordPredictions: (a) => { calls.push(`record:${a.length}`); },
      enabled: () => true,
    },
  );
  // resolve BEFORE record so a fresh record can't self-resolve in the same tick
  assert.deepEqual(calls, ['resolve:finance:0.7', 'record:1']);
});

test('disabled switch is a no-op', () => {
  const calls: string[] = [];
  wireModeForecastCalibration({ advisories: [] }, {
    resolveFromObservation: () => { calls.push('r'); return 0; },
    recordPredictions: () => { calls.push('rec'); },
    enabled: () => false,
  });
  assert.equal(calls.length, 0);
});

test('settleCalibrationBridges runs both settlers before generic expiry', () => {
  const order: string[] = [];
  settleCalibrationBridges({
    settleShortage: () => { order.push('shortage'); return 0; },
    settleAdvisory: () => { order.push('advisory'); return 0; },
    expirePending: () => { order.push('expire'); return 0; },
    enabled: () => true,
  });
  assert.deepEqual(order, ['shortage', 'advisory', 'expire']);
});
```

Run: `npx tsx --test src/services/intelligence/__tests__/calibration-bridge-wiring.test.mts` — expect FAIL (module missing).

- [ ] **Step 3: Implement `calibration-bridge-wiring.ts`**

All dependencies injectable with live defaults; the module owns ordering + gating only (the bridges own all semantics):

```ts
import { isCognitionEnabled } from '../cognition/cognition-settings';
import {
  recordAdvisoryPredictions, resolveAdvisoryFromObservation,
  settleExpiredAdvisoryPredictions,
} from './mode-forecast-prediction-bridge';
import { settleExpiredShortagePredictions } from '../shortage/shortage-calibration-bridge';
import { expirePendingPredictions } from './forecast-calibration-adapter';
import type { ModeAdvisory } from '../mode-forecast';

interface ModeWiringDeps {
  resolveFromObservation: typeof resolveAdvisoryFromObservation;
  recordPredictions: typeof recordAdvisoryPredictions;
  enabled: () => boolean;
}

const LIVE_MODE_DEPS: ModeWiringDeps = {
  resolveFromObservation: resolveAdvisoryFromObservation,
  recordPredictions: recordAdvisoryPredictions,
  enabled: () => isCognitionEnabled('calibration-bridges'),
};

export function wireModeForecastCalibration(
  snapshot: { advisories: readonly ModeAdvisory[] },
  deps: ModeWiringDeps = LIVE_MODE_DEPS,
): void {
  if (!deps.enabled()) return;
  for (const a of snapshot.advisories) deps.resolveFromObservation(a.domain, a.pressure);
  deps.recordPredictions(snapshot.advisories);
}

interface SettleDeps {
  settleShortage: () => number;
  settleAdvisory: () => number;
  expirePending: () => number;
  enabled: () => boolean;
}

export function settleCalibrationBridges(deps: SettleDeps = {
  settleShortage: settleExpiredShortagePredictions,
  settleAdvisory: settleExpiredAdvisoryPredictions,
  expirePending: expirePendingPredictions,
  enabled: () => isCognitionEnabled('calibration-bridges'),
}): void {
  if (!deps.enabled()) { deps.expirePending(); return; }
  deps.settleShortage();   // bridges settle their own records FALSE first
  deps.settleAdvisory();   // (their comment mandates running before generic expiry)
  deps.expirePending();
}
```

- [ ] **Step 4: Run tests — expect PASS.** Same command as Step 2.

- [ ] **Step 5: Wire the shortage record/resolve hook in the panel**

In `ShortageRadarPanel.render()` (line 167 area), right where `entries` already flow to `emitShortageAlerts(...)` and `pushToSidecar(entries)`, add (resolve-then-record order, gated, throw-safe):

```ts
try {
  if (isCognitionEnabled('calibration-bridges')) {
    for (const f of entries) resolveShortageFromObservation(f);
    recordShortagePredictions(entries);
  }
} catch { /* calibration must never break the panel */ }
```

Imports: `recordShortagePredictions`, `resolveShortageFromObservation` from `@/services/shortage/shortage-calibration-bridge`; `isCognitionEnabled` from `@/services/cognition/cognition-settings`. The bridge's daily `shortagePredictionId` bucket makes the 5-minute render cadence flood-proof (id dedupe at `shortage-calibration-bridge.ts:141`).

- [ ] **Step 6: Wire mode-forecast + settle in panel-layout**

In the boot-cadence block (near `startOutcomeGradingCadence()` at `panel-layout.ts:1107`), add:

```ts
subscribeModeAdvisory(() => {
  const snap = getForecastSnapshot();
  if (snap) wireModeForecastCalibration(snap);
});
```

(`subscribeModeAdvisory`/`getForecastSnapshot` from `@/services/mode-forecast` — already imported at line 160 area.) The bridge's hourly `advisoryPredictionId` bucket absorbs the 2-minute forecast cadence.

Replace the body of the existing hourly expiry timer (line ~1135, currently calling `expirePendingPredictions()`) with `settleCalibrationBridges()`.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck:all` (expect 0 errors), `npm run test:intelligence`, `npm run test:cognition`, `npm run test:shortage` (all green).

- [ ] **Step 8: Update spec tracker row A1 → 🔄 with branch name; commit**

```bash
git add src/services/intelligence/calibration-bridge-wiring.ts \
  src/services/intelligence/__tests__/calibration-bridge-wiring.test.mts \
  src/services/cognition/cognition-settings.ts src/components/ShortageRadarPanel.ts \
  src/app/panel-layout.ts docs/PREDICTION_UPLIFT_PLAN.md
git commit -m "feat(calibration): wire shortage + mode-forecast bridges live (uplift A1)"
```

---

## PR A2: Live-pair surface on CorrelationMapPanel

**Files:**
- Create: `src/services/correlation/correlation-map-view.ts`
- Create: `src/services/correlation/__tests__/correlation-map-view.test.mts`
- Modify: `src/components/CorrelationMapPanel.ts` (add a "Live correlations" section above the chain list; reuse the existing 30 s `setInterval` at line 73)

- [ ] **Step 1: Write failing view-model tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { buildLivePairRows } from '../correlation-map-view';

const pair = (over: Record<string, unknown> = {}) => ({
  ruleId: 'quake-infra', edgeType: 'causal-candidate',
  eventA: { domain: 'seismic', title: 'M6 quake', entityIds: [], timestamp: 1000 },
  eventB: { domain: 'infrastructure', title: 'outage', entityIds: [], timestamp: 2000 },
  confidence: 0.62,
  confidenceDetail: {
    value: 0.62,
    factors: { base: 0.8, temporal: 0.9, spatial: 1, entity: 1.15, reliability: 1.2, regime: 1.1 },
    explanation: 'reliability ×1.20 (learned from outcomes) · regime ×1.10',
  },
  detectedAt: new Date(60_000),
  ...over,
});

test('rows carry learned badge, regime flag, factor chips', () => {
  const rows = buildLivePairRows([pair({ ruleId: 'learned:cyber->markets' }) as never], 120_000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].learned, true);
  assert.equal(rows[0].regimeBoosted, true);
  assert.equal(rows[0].reliabilityLearned, true);
  assert.equal(rows[0].ageMs, 60_000);
  assert.ok(rows[0].factorChips.some((c) => c.key === 'regime' && c.value === 1.1));
});

test('sorted newest-first and capped at 30', () => {
  const pairs = Array.from({ length: 40 }, (_, i) =>
    pair({ detectedAt: new Date(i * 1000) }) as never);
  const rows = buildLivePairRows(pairs, 100_000);
  assert.equal(rows.length, 30);
  assert.ok(rows[0].ageMs <= rows[1].ageMs);
});

test('missing confidenceDetail degrades gracefully', () => {
  const rows = buildLivePairRows([pair({ confidenceDetail: undefined }) as never], 100_000);
  assert.equal(rows[0].factorChips.length, 0);
  assert.equal(rows[0].regimeBoosted, false);
});
```

Run: `npx tsx --test src/services/correlation/__tests__/correlation-map-view.test.mts` — FAIL.

- [ ] **Step 2: Implement `correlation-map-view.ts` (pure)**

```ts
import type { CorrelatedPair } from '../intelligence/correlate-engine';
import { LEARNED_RULE_PREFIX } from './learned-rules';

export interface FactorChip { key: string; value: number }

export interface LivePairRow {
  ruleId: string;
  learned: boolean;
  edgeType: string;
  fromDomain: string;
  toDomain: string;
  fromTitle: string;
  toTitle: string;
  confidence: number;
  ageMs: number;
  regimeBoosted: boolean;
  reliabilityLearned: boolean;
  factorChips: FactorChip[];
  explanation: string;
}

const MAX_ROWS = 30;

export function buildLivePairRows(
  pairs: readonly CorrelatedPair[],
  now: number,
): LivePairRow[] {
  return [...pairs]
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
    .slice(0, MAX_ROWS)
    .map((p) => {
      const f = p.confidenceDetail?.factors;
      const chips: FactorChip[] = f
        ? (Object.entries(f) as [string, number][])
            .filter(([k, v]) => k !== 'base' && Math.abs(v - 1) > 0.001)
            .map(([key, value]) => ({ key, value: Math.round(value * 100) / 100 }))
        : [];
      return {
        ruleId: p.ruleId,
        learned: p.ruleId.startsWith(LEARNED_RULE_PREFIX),
        edgeType: p.edgeType,
        fromDomain: p.eventA.domain, toDomain: p.eventB.domain,
        fromTitle: p.eventA.title, toTitle: p.eventB.title,
        confidence: p.confidence,
        ageMs: Math.max(0, now - p.detectedAt.getTime()),
        regimeBoosted: (f?.regime ?? 1) > 1,
        reliabilityLearned: f != null && Math.abs(f.reliability - 1) > 0.001,
        factorChips: chips,
        explanation: p.confidenceDetail?.explanation ?? '',
      };
    });
}
```

- [ ] **Step 3: Run tests — PASS.**

- [ ] **Step 4: Render the section in `CorrelationMapPanel`**

In `loadAndRender()` (which the 30 s timer at line 73 already drives), read live pairs and prepend a section above the chain list. All text through `escapeHtml` (already imported):

```ts
import { getCorrelationStore } from '@/services/intelligence/correlation-store';
import { buildLivePairRows } from '@/services/correlation/correlation-map-view';
// inside loadAndRender():
const rows = buildLivePairRows(getCorrelationStore().getRecent(24 * 3_600_000), Date.now());
```

HTML per row (follow the panel's existing `.cm2-*` class conventions): domain arrow `fromDomain → toDomain`, confidence % using the panel's existing threshold colors (`:45-50`), a `LEARNED` badge when `row.learned`, a `regime` badge when `row.regimeBoosted`, factor chips as `key×value` spans, `title` attr = `explanation`. Empty state: `"No kernel-scored pairs in the last 24h."`

- [ ] **Step 5: Verify + commit**

`npm run typecheck:all`, `npm run test:correlation` green. Update tracker row A2. Commit:
`feat(correlation): surface live kernel-scored pairs on the map panel (uplift A2)`.

---

## PR A3: Cognition PR 6 leftovers (EVOI chips, report card, recalibration pairs)

**Files:**
- Modify: `src/services/question-suggester.ts` (new ranked variant; `suggestQuestions` at line 87 stays)
- Modify: `src/components/calibration-report-view.ts` (add domain report-card builder)
- Modify: `src/components/BeliefCalibrationPanel.ts:99` (render the card — placement decision resolved: this panel is where the existing report lives)
- Modify: `src/services/intelligence/hypothesis-forecast.ts` (~line 66, after `calibratedP`)
- Test: extend `src/services/__tests__/question-suggester.test.mts` (or create), `src/components/__tests__/calibration-report-view.test.mts`, `src/services/intelligence/__tests__/hypothesis-forecast.test.mts`

- [ ] **Step 1: Failing test — EVOI-ranked chips**

```ts
test('suggestQuestionsRanked appends EVOI actions and sorts by bits', () => {
  const h = { kind: 'escalation', statement: 'X escalates', confidence: 0.6,
              evidence: [], region: 'EU' } as never;
  const ranked = suggestQuestionsRanked(h, {
    heuristics: () => ['chip A', 'chip B'],
    evoiActions: () => [{ label: 'Check ADS-B feed', expectedInfoGainBits: 0.4 }],
  });
  assert.equal(ranked[0].question, 'Check ADS-B feed');   // 0.4 bits beats prior
  assert.equal(ranked[0].bits, 0.4);
  assert.equal(ranked.length, 3);                          // still capped at 3
});
```

- [ ] **Step 2: Implement `suggestQuestionsRanked` in question-suggester.ts**

```ts
import { buildCheckNextItems } from './cognition/evoi-surface';

const HEURISTIC_PRIOR_BITS = 0.1;

export interface RankedQuestion { question: string; bits: number; fromEvoi: boolean }

export function suggestQuestionsRanked(
  h: Hypothesis,
  deps: {
    heuristics?: (h: Hypothesis) => string[];
    evoiActions?: (h: Hypothesis) => readonly { label: string; expectedInfoGainBits: number }[];
  } = {},
): RankedQuestion[] {
  const heuristic = (deps.heuristics ?? suggestQuestions)(h)
    .map((q) => ({ question: q, bits: HEURISTIC_PRIOR_BITS, fromEvoi: false }));
  const evoi = (deps.evoiActions ?? ((hh: Hypothesis) => buildCheckNextItems([
    { kind: hh.kind, statement: hh.statement, probability: hh.confidence },
  ])))(h).map((a) => ({ question: a.label, bits: a.expectedInfoGainBits, fromEvoi: true }));
  const seen = new Set<string>();
  return [...evoi, ...heuristic]
    .filter((r) => { const k = r.question.toLowerCase();
      if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.bits - a.bits)
    .slice(0, 3);
}
```

`buildCheckNextItems` already gates on the `evoi-planner` kill-switch (returns `[]` when off → pure heuristic fallback, no extra gating needed). Switch the AnalystHUD chip render call site from `suggestQuestions(h)` to `suggestQuestionsRanked(h)` (find it: `grep -n "suggestQuestions" src/components/AnalystHUD.ts`), showing a `+0.4 bits` suffix on `fromEvoi` chips.

- [ ] **Step 3: Failing test — domain report card**

```ts
test('buildDomainReportCard aggregates per-domain n/brier/multiplier', () => {
  const records = [
    rec({ domain: 'weather', probability: 0.8, status: 'resolved_true' }),
    rec({ domain: 'weather', probability: 0.3, status: 'resolved_false' }),
    rec({ domain: 'cyber', probability: 0.6, status: 'pending' }),
  ];
  const card = buildDomainReportCard(records);
  const weather = card.rows.find((r) => r.domain === 'weather');
  assert.equal(weather?.resolved, 2);
  assert.ok(weather!.brier < 0.1);              // both well-calibrated
  assert.equal(card.rows.find((r) => r.domain === 'cyber')?.resolved, 0);
});
```

- [ ] **Step 4: Implement `buildDomainReportCard` in calibration-report-view.ts**

```ts
import { brierScore } from '@/services/intelligence/forecast-calibration';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';

export interface DomainReportRow {
  domain: string; total: number; resolved: number; brier: number | null;
}
export interface DomainReportCard { rows: DomainReportRow[] }

export function buildDomainReportCard(records: readonly PredictionRecord[]): DomainReportCard {
  const byDomain = new Map<string, PredictionRecord[]>();
  for (const r of records) {
    const list = byDomain.get(r.domain) ?? [];
    list.push(r); byDomain.set(r.domain, list);
  }
  const rows = [...byDomain.entries()].map(([domain, list]) => {
    const resolved = list.filter((r) => r.status === 'resolved_true' || r.status === 'resolved_false');
    return {
      domain, total: list.length, resolved: resolved.length,
      brier: resolved.length >= 5 ? Math.round(brierScore(resolved).score * 10_000) / 10_000 : null,
    };
  }).sort((a, b) => b.resolved - a.resolved);
  return { rows };
}
```

(If `brierScore` isn't exported from `forecast-calibration.ts`, export it — it exists at line ~65.) Render as a second table in `BeliefCalibrationPanel.buildCalibrationReportSection()` (line 99): columns Domain / Predictions / Resolved / Brier, `—` for null Brier with `title="needs ≥5 resolved"`.

- [ ] **Step 5: Wire `pushRecalibrationPair` with flood control**

In `hypothesis-forecast.ts`, immediately after `calibratedP` is computed (~line 66). **Deliberate deviation from the spec's original "push at resolution time" (Codex P2, accepted):** the hypothesis prediction bridge stores a single probability per record, so at grade time only one leg survives — forecast-compute time is the only point where BOTH legacy and recalibrated legs exist without stamping extra state onto `PendingHypothesis`. This matches the superforecast-state push-at-compute precedent (`superforecast-state.ts:106-113`); the per-signature hourly cap bounds shadow-ledger churn. The spec was amended to match.

```ts
const RECAL_PUSH_INTERVAL_MS = 3_600_000;
const lastRecalPush = new Map<string, number>();

function maybePushRecalibrationPair(sig: string, recalibrated: number, legacy: number, now: number): void {
  const last = lastRecalPush.get(sig) ?? 0;
  if (now - last < RECAL_PUSH_INTERVAL_MS) return;
  lastRecalPush.set(sig, now);
  if (lastRecalPush.size > 500) {
    const oldest = [...lastRecalPush.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) lastRecalPush.delete(oldest[0]);
  }
  try { pushRecalibrationPair(sig, recalibrated, legacy); } catch { /* shadow only */ }
}
```

Call: `maybePushRecalibrationPair(signature, calibratedP, rawProbability, Date.now())` (derive `signature` the same way the file already keys the hypothesis; orientation per `shadow-rollout.ts:223-236` — live=recalibrated, shadow=legacy). Export a `_resetRecalPushForTests()` clearing the map.

Test: two pushes within an hour for one signature → shadow `compare` spy called once; different signatures → both push; after `_reset` → pushes again.

- [ ] **Step 6: Verify + commit**

`npm run typecheck:all`, `npm run test:cognition`, `npm run test:intelligence`, plus the two component/service test files. Update tracker rows A3 **and** the spec's PR 6 note (leftovers closed). Commit: `feat(cognition): close PR6 leftovers — EVOI chips, domain report card, recal shadow pairs (uplift A3)`.

---

## PR A4: Entity vocabulary alignment

**Files:**
- Create: `src/services/intelligence/entity-slug.ts`
- Create: `src/services/intelligence/__tests__/entity-slug.test.mts`
- Modify: `src/services/analyst-loop.ts:399` (`entities: []` → extracted slugs)
- Modify: `src/services/cognition/episodic-memory.ts` (`contradictEpisodesForRefutation` — slugify both sides at compare time)
- Test: extend `src/services/cognition/__tests__/episodic-memory.test.mts`

- [ ] **Step 1: Failing slug tests**

```ts
import { slugifyEntity } from '../entity-slug';
test('slug table', () => {
  assert.equal(slugifyEntity('Suez Canal'), 'suez-canal');
  assert.equal(slugifyEntity('AAPL'), 'aapl');
  assert.equal(slugifyEntity('CVE-2026-1234'), 'cve-2026-1234');
  assert.equal(slugifyEntity('  Fukushima  Daiichi  '), 'fukushima-daiichi');
  assert.equal(slugifyEntity('Ürümqi'), 'urumqi');
  assert.equal(slugifyEntity(''), '');
});
```

- [ ] **Step 2: Implement `entity-slug.ts`**

```ts
/** Shared normalizer converging the episode-entity and situation-entityId
 *  vocabularies (they evolved independently; see PR 14 contradiction bridge). */
export function slugifyEntity(raw: string): string {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

Run tests — PASS.

- [ ] **Step 3: Fill the episode producer**

`analyst-loop.ts:399` (inside the `recordEpisode` loop, lines 391-417):

```ts
entities: [...new Set(entitiesFromHypothesis(h).map((m) => slugifyEntity(m.entity)))]
  .filter(Boolean).slice(0, 10),
```

Import `entitiesFromHypothesis` from `@/services/hypothesis-entities` (cache-free variant, line 180) and `slugifyEntity`.

- [ ] **Step 4: Slug-normalize the contradiction matcher**

In `episodic-memory.ts` `contradictEpisodesForRefutation`, replace the case-insensitive equality on entity overlap with slug equality: `slugifyEntity(a) === slugifyEntity(b)` on both the incoming `ctx.entityIds` and stored `episode.entities`. (Situation-side vocab stays untouched — no store churn.)

- [ ] **Step 5: End-to-end regression test**

In `episodic-memory.test.mts`: record an episode with `entities: ['suez-canal']` (as the producer now writes), fire `contradictEpisodesForRefutation({ entityIds: ['Suez Canal'], ... })` (situation-style raw form) → episode is marked contradicted. Also the reverse (raw stored, slug incoming).

- [ ] **Step 6: Verify + commit**

`npm run typecheck:all`, `npm run test:cognition`, `npm run test:intelligence`, and the analyst-loop suite if present in `test:renderer` scope. Tracker row A4. Commit: `feat(intelligence): converge entity vocabularies so contradiction hygiene fires (uplift A4)`.

---

## PR B1: Outcome-resolver framework + market-move resolver

**Files:**
- Modify: `src/services/intelligence/forecast-calibration.ts` (PredictionRecord + resolve note)
- Modify: `src/services/intelligence/forecast-calibration-adapter.ts` (pass-through note)
- Create: `src/services/intelligence/outcome-resolvers.ts`
- Create: `src/services/market/market-spot-store.ts`
- Modify: `src/app/data-loader.ts:1364-1366` (feed spot store from Yahoo/Finnhub results)
- Modify: `src/services/intelligence/hypothesis-prediction-bridge.ts` (criteria stamping in `recordHypothesisPredictions`)
- Modify: `src/services/cognition/cognition-settings.ts` (add `'outcome-resolvers'` switch)
- Modify: `src/app/panel-layout.ts` (15-min `registerRecurringLoop` for the dispatch)
- Tests: `src/services/intelligence/__tests__/outcome-resolvers.test.mts`, `src/services/market/__tests__/market-spot-store.test.mts`, extend `hypothesis-prediction-bridge` tests

- [ ] **Step 1: Extend the record type (backward-compatible)**

In `forecast-calibration.ts`, add to `PredictionRecord` (line 27 block):

```ts
/** Machine-evaluable resolution criteria, stamped at emit time (B-workstream).
 *  Absent on legacy records — resolvers skip records without criteria. */
criteria?: ResolutionCriteria;
/** Set by whichever resolver resolved this record; 'proxy:'-prefixed notes
 *  mark indirect-evidence resolutions. */
resolutionNote?: string;
```

New exported union in the same file:

```ts
export interface MarketMoveCriteria {
  kind: 'market_move';
  symbol: string;
  direction: 'up' | 'down';
  minAbsPct: number;
  basisPrice: number;
}
export interface EventOccurrenceCriteria {
  kind: 'event_occurrence';
  domains: readonly string[];
  entitySlugs: readonly string[];
  region?: string;
  minEvidence: number;
}
export interface WarningVerificationCriteria {
  kind: 'warning_verification';
  polygon: { rings: readonly (readonly [number, number])[][] };
  reportTypes: readonly string[];
  sentAt: number;
}
export type ResolutionCriteria =
  | MarketMoveCriteria | EventOccurrenceCriteria | WarningVerificationCriteria;
```

Extend `resolve(id, outcome, when?)` on the store with an optional 4th param `note?: string` that sets `resolutionNote` on the record; thread it through the adapter's `resolvePrediction`. Existing callers unaffected.

- [ ] **Step 2: Failing spot-store tests, then implement**

```ts
// market-spot-store.test.mts
test('update + read + unknown symbol', () => {
  updateSpotPrices([{ symbol: 'AAPL', price: 210.5 } as never], 1000);
  assert.deepEqual(getSpotPrice('AAPL'), { price: 210.5, at: 1000 });
  assert.equal(getSpotPrice('MSFT'), null);
});
test('later update wins; symbols case-insensitive', () => {
  updateSpotPrices([{ symbol: 'aapl', price: 211 } as never], 2000);
  assert.equal(getSpotPrice('AAPL')?.price, 211);
});
```

```ts
// market-spot-store.ts
import type { ExchangePrice } from './crypto-fusion-observations';

const spots = new Map<string, { price: number; at: number }>();

export function updateSpotPrices(prices: readonly ExchangePrice[], at: number = Date.now()): void {
  for (const p of prices) {
    if (typeof p.symbol === 'string' && Number.isFinite(p.price)) {
      spots.set(p.symbol.toUpperCase(), { price: p.price, at });
    }
  }
}
export function getSpotPrice(symbol: string): { price: number; at: number } | null {
  return spots.get(symbol.toUpperCase()) ?? null;
}
export function _resetSpotStoreForTests(): void { spots.clear(); }
```

Wire at `data-loader.ts:1364-1366`: after each successful fetch, `if (yahoo.ok) updateSpotPrices(yahoo.prices);` and same for `finnhub`.

- [ ] **Step 3: Failing resolver-framework tests**

```ts
// outcome-resolvers.test.mts — market resolver behavior matrix
const mk = (over: Partial<MarketMoveCriteria> = {}): PredictionRecord => ({
  id: 'hyp:x:1', sourceId: 'analyst-loop', domain: 'markets', claim: 'AAPL rallies',
  probability: 0.6, predictedAt: 0, resolveBy: 86_400_000, status: 'pending',
  criteria: { kind: 'market_move', symbol: 'AAPL', direction: 'up',
              minAbsPct: 3, basisPrice: 100, ...over },
});
const ctx = (price: number | null, now: number) => ({
  now,
  spotPriceFor: () => (price === null ? null : { price, at: now }),
  queryObservations: () => [],
});

test('threshold cross in predicted direction → resolved_true', () => {
  const v = marketMoveResolver.resolve(mk(), ctx(103.5, 1000));
  assert.deepEqual(v, { outcome: true, note: 'market_move: AAPL +3.50% vs basis 100 (threshold 3%)' });
});
test('threshold cross AGAINST direction → resolved_false', () => {
  const v = marketMoveResolver.resolve(mk(), ctx(96.5, 1000));
  assert.equal(v?.outcome, false);
});
test('no cross before deadline → null (stays pending)', () => {
  assert.equal(marketMoveResolver.resolve(mk(), ctx(101, 1000)), null);
});
test('no cross AT deadline → resolved_false (fizzled)', () => {
  const v = marketMoveResolver.resolve(mk(), ctx(101, 86_400_001));
  assert.equal(v?.outcome, false);
});
test('no spot price → null', () => {
  assert.equal(marketMoveResolver.resolve(mk(), ctx(null, 1000)), null);
});

test('runOutcomeResolvers walks pending-with-criteria and writes note', () => {
  const store = createForecastCalibrationStore();
  store.record(mk());
  store.record({ ...mk(), id: 'legacy', criteria: undefined });
  const n = runOutcomeResolvers(store, ctx(104, 1000), [marketMoveResolver]);
  assert.equal(n, 1);
  assert.equal(store.get('hyp:x:1')?.status, 'resolved_true');
  assert.match(store.get('hyp:x:1')?.resolutionNote ?? '', /market_move/);
  assert.equal(store.get('legacy')?.status, 'pending');
});
```

- [ ] **Step 4: Implement `outcome-resolvers.ts`**

```ts
import type { ForecastCalibrationStore, PredictionRecord } from './forecast-calibration';
import type { ObservationEvent } from '@/types/intelligence';

export interface ResolverContext {
  now: number;
  spotPriceFor(symbol: string): { price: number; at: number } | null;
  queryObservations(q: { domain?: string; since?: number; until?: number; limit?: number }): ObservationEvent[];
  stormReports?: () => readonly unknown[];   // narrowed by the B2 resolver
}
export interface ResolverVerdict { outcome: boolean; note: string }
export interface OutcomeResolver {
  id: string;
  canResolve(r: PredictionRecord): boolean;
  resolve(r: PredictionRecord, ctx: ResolverContext): ResolverVerdict | null;
}

export const marketMoveResolver: OutcomeResolver = {
  id: 'market-move',
  canResolve: (r) => r.criteria?.kind === 'market_move',
  resolve(r, ctx) {
    const c = r.criteria;
    if (c?.kind !== 'market_move') return null;
    const spot = ctx.spotPriceFor(c.symbol);
    if (!spot || !Number.isFinite(c.basisPrice) || c.basisPrice <= 0) return null;
    const pct = ((spot.price - c.basisPrice) / c.basisPrice) * 100;
    const crossed = Math.abs(pct) >= c.minAbsPct;
    if (crossed) {
      const inDirection = (c.direction === 'up') === (pct > 0);
      return { outcome: inDirection,
        note: `market_move: ${c.symbol} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% vs basis ${c.basisPrice} (threshold ${c.minAbsPct}%)` };
    }
    if (ctx.now > r.resolveBy) {
      return { outcome: false,
        note: `market_move: ${c.symbol} never moved ${c.minAbsPct}% by deadline` };
    }
    return null;
  },
};

/** Walk pending records that declare criteria; first resolver that can handle
 *  a record and returns a verdict wins. Returns count resolved. */
export function runOutcomeResolvers(
  store: Pick<ForecastCalibrationStore, 'all' | 'resolve'>,
  ctx: ResolverContext,
  resolvers: readonly OutcomeResolver[],
): number {
  let resolved = 0;
  for (const r of store.all()) {
    if (r.status !== 'pending' || !r.criteria) continue;
    for (const resolver of resolvers) {
      if (!resolver.canResolve(r)) continue;
      const verdict = resolver.resolve(r, ctx);
      if (verdict && store.resolve(r.id, verdict.outcome, ctx.now, verdict.note)) resolved += 1;
      break;   // one resolver per record per pass, verdict or not
    }
  }
  return resolved;
}
```

Run tests — PASS.

- [ ] **Step 5: Criteria stamping in the hypothesis bridge**

In `recordHypothesisPredictions` (`hypothesis-prediction-bridge.ts:40-59`), before `recordPrediction`, build optional criteria:

```ts
const UP_CUES = ['rally', 'rallies', 'surge', 'spike', 'soar', 'rebound', 'jump'];
const DOWN_CUES = ['drop', 'fall', 'sell-off', 'selloff', 'crash', 'plunge', 'slump', 'decline'];
const DEFAULT_MIN_ABS_PCT = 3;

export function marketCriteriaFor(
  h: Hypothesis,
  spotFor: (symbol: string) => { price: number; at: number } | null = getSpotPrice,
): MarketMoveCriteria | undefined {
  const tickers = entitiesFromHypothesis(h).filter((m) => m.kind === 'ticker');
  if (tickers.length !== 1) return undefined;   // ambiguous → no criteria
  const s = h.statement.toLowerCase();
  const up = UP_CUES.some((c) => s.includes(c));
  const down = DOWN_CUES.some((c) => s.includes(c));
  if (up === down) return undefined;            // none or both → no criteria
  const spot = spotFor(tickers[0].entity);
  if (!spot) return undefined;
  return { kind: 'market_move', symbol: tickers[0].entity.toUpperCase(),
           direction: up ? 'up' : 'down', minAbsPct: DEFAULT_MIN_ABS_PCT,
           basisPrice: spot.price };
}
```

Add `criteria: marketCriteriaFor(h)` to the record literal. Tests: one-ticker+up-cue stamps criteria with basis from spy spot store; two tickers → undefined; both cue directions → undefined; no spot → undefined.

> **Operator decision point (spec §Operator decision points #1):** `DEFAULT_MIN_ABS_PCT = 3` and the cue lists set the volume/noise trade-off. Bradley — tune these two constants when reviewing this PR.

- [ ] **Step 6: Kill-switch + dispatch cadence**

Add `'outcome-resolvers'` to the cognition switch union/array. In panel-layout's boot block, register:

```ts
registerRecurringLoop('outcome-resolvers', () => {
  if (!isCognitionEnabled('outcome-resolvers')) return;
  runOutcomeResolvers(getCalibrationStore(), {
    now: Date.now(),
    spotPriceFor: getSpotPrice,
    queryObservations: (q) => query(q),
  }, [marketMoveResolver]);
}, 15 * 60_000, { priority: 'low', runImmediately: false });
```

(`query` from `@/services/intelligence/observation-store`; follow the exact `registerRecurringLoop` idiom at `panel-layout.ts:2241-2253`.)

- [ ] **Step 7: Verify + commit**

`npm run typecheck:all`, `npm run test:intelligence`, new market test file, `npm run test:cognition`. Tracker row B1. Commit: `feat(intelligence): outcome-resolver framework + market-move resolver (uplift B1)`.

---

## PR B2: Weather warning verification resolver

**Files:**
- Create: `src/services/weather/warning-verification-bridge.ts`
- Create: `src/services/weather/__tests__/warning-verification-bridge.test.mts`
- Modify: `src/services/intelligence/outcome-resolvers.ts` (add `warningVerificationResolver`)
- Modify: `src/app/data-loader.ts:2620-2640` (`loadNWSAlerts` — record warnings + stash storm reports)
- Modify: panel-layout resolver loop (add the new resolver + `stormReports` ctx member)

- [ ] **Step 1: Failing bridge tests**

Cover: (a) only warning-class events recorded (`Tornado Warning`, `Severe Thunderstorm Warning`, `Flash Flood Warning`); (b) id `nwswarn:<alert.id>` dedupes re-ingest; (c) polygon simplified to ≤32 points per ring (localStorage-quota protection — the shared store persists to `crystalball-forecast-calibration-v1`); (d) `resolveBy = expires + 30min`; (e) alerts without polygons are skipped; (f) recording stops at `MAX_OPEN_WARNING_RECORDS = 50` open pending warning records (Codex P2 — nationwide volume must not evict other predictions from the 500-cap store).

```ts
test('records a tornado warning with simplified polygon and grace window', () => {
  const store = createForecastCalibrationStore();
  const ring = Array.from({ length: 200 }, (_, i) => [i / 100, i / 100] as const);
  recordWarningPredictions([{
    id: 'NWS-1', event: 'Tornado Warning', sent: '2026-07-21T00:00:00Z',
    expires: '2026-07-21T01:00:00Z', polygon: { rings: [ring] },
  } as never], Date.parse('2026-07-21T00:05:00Z'),
  { get: (id) => store.get(id), record: (p) => store.record(p),
    openWarningCount: () => 0 });
  const rec = store.get('nwswarn:NWS-1');
  assert.ok(rec);
  assert.equal(rec.criteria?.kind, 'warning_verification');
  assert.ok((rec.criteria as WarningVerificationCriteria).polygon.rings[0].length <= 32);
  assert.equal(rec.resolveBy, Date.parse('2026-07-21T01:30:00Z'));
});
```

- [ ] **Step 2: Implement the bridge**

```ts
// warning-verification-bridge.ts
import type { NwsAlertMinimal, AlertPolygon } from './weather-threat-types';
import type { StormReport } from '../spc-outlook';
import { getCalibrationStore, recordPrediction } from '../intelligence/forecast-calibration-adapter';
import type { ForecastCalibrationStore } from '../intelligence/forecast-calibration';

export const VERIFIABLE_EVENTS: Record<string, readonly StormReport['type'][]> = {
  'Tornado Warning': ['tornado'],
  'Severe Thunderstorm Warning': ['hail', 'wind'],
  'Flash Flood Warning': ['flooding'],
};
const GRACE_MS = 30 * 60_000;
const WARNING_BASE_P = 0.7;   // short-fuse warnings verify roughly this often
const MAX_RING_POINTS = 32;
// Codex P2: nationwide warning volume must not evict higher-value predictions
// from the 500-cap shared store or bloat crystalball-forecast-calibration-v1.
const MAX_OPEN_WARNING_RECORDS = 50;

export function simplifyPolygon(polygon: AlertPolygon): AlertPolygon {
  return { rings: polygon.rings.map((ring) => {
    if (ring.length <= MAX_RING_POINTS) return ring;
    const step = Math.ceil(ring.length / MAX_RING_POINTS);
    return ring.filter((_, i) => i % step === 0);
  }) };
}

interface WarningRecordDeps {
  get: ForecastCalibrationStore['get'];
  record: (p: PredictionRecord) => void;
  /** Count of currently-pending nwswarn: records (for the open cap). */
  openWarningCount: () => number;
}
// Default deps hit the live singleton; tests inject a local store's get/record
// so assertions and writes target the SAME store.
const liveWarningDeps = (): WarningRecordDeps => ({
  get: (id) => getCalibrationStore().get(id),
  record: recordPrediction,
  openWarningCount: () => getCalibrationStore().all()
    .filter((r) => r.id.startsWith('nwswarn:') && r.status === 'pending').length,
});

export function recordWarningPredictions(
  alerts: readonly NwsAlertMinimal[],
  now: number = Date.now(),
  deps: WarningRecordDeps = liveWarningDeps(),
): number {
  let recorded = 0;
  let open = deps.openWarningCount();
  for (const a of alerts) {
    if (open >= MAX_OPEN_WARNING_RECORDS) break;
    const types = VERIFIABLE_EVENTS[a.event];
    if (!types || !a.polygon) continue;
    const id = `nwswarn:${a.id}`;
    if (deps.get(id)) continue;
    const expires = Date.parse(a.expires);
    if (!Number.isFinite(expires)) continue;
    deps.record({
      id, sourceId: 'nws-warning', domain: 'weather',
      claim: `${a.event} verifies inside polygon`, probability: WARNING_BASE_P,
      predictedAt: now, resolveBy: expires + GRACE_MS, status: 'pending',
      criteria: { kind: 'warning_verification', polygon: simplifyPolygon(a.polygon),
                  reportTypes: types, sentAt: Date.parse(a.sent) || now },
    });
    recorded += 1;
    open += 1;
  }
  return recorded;
}

// Module stash so the resolver ctx can read the latest LSR batch.
let latestReports: readonly StormReport[] = [];
export function setLatestStormReports(reports: readonly StormReport[]): void { latestReports = reports; }
export function getLatestStormReports(): readonly StormReport[] { return latestReports; }
```

- [ ] **Step 3: Failing resolver tests, then implement `warningVerificationResolver`**

Tests: report of matching type inside polygon within `[sentAt, resolveBy]` → `outcome: true`, note names the report; matching type OUTSIDE polygon → null before deadline; past deadline with no match → `outcome: false`, note starts `proxy:` (absence evidence is weaker); wrong report type inside polygon → no verify.

```ts
export const warningVerificationResolver: OutcomeResolver = {
  id: 'warning-verification',
  canResolve: (r) => r.criteria?.kind === 'warning_verification',
  resolve(r, ctx) {
    const c = r.criteria;
    if (c?.kind !== 'warning_verification') return null;
    const reports = (ctx.stormReports?.() ?? []) as readonly StormReport[];
    const hit = reports.find((rep) =>
      c.reportTypes.includes(rep.type)
      && rep.reportedAt.getTime() >= c.sentAt
      && rep.reportedAt.getTime() <= r.resolveBy
      && pointInPolygon([rep.lon, rep.lat], c.polygon as AlertPolygon));
    if (hit) return { outcome: true,
      note: `warning_verification: ${hit.type} LSR at ${hit.location ?? `${hit.lat},${hit.lon}`}` };
    if (ctx.now > r.resolveBy) return { outcome: false,
      note: 'proxy: no matching LSR inside polygon by expiry+grace' };
    return null;
  },
};
```

(`pointInPolygon` from `@/services/weather/nws-polygon-match` — exported at line 235, takes `([lon, lat], AlertPolygon)`.)

- [ ] **Step 4: Wire into `loadNWSAlerts`**

In `data-loader.ts` after the ingest at line 2640: `recordWarningPredictions(normalizedAlerts)` (build the `NwsAlertMinimal[]` from the same normalized batch — `normalizeNWSAlert` output already carries id/event/sent/expires/polygon; adapt field names to whatever the normalized shape exposes, keeping the bridge's input type). After `fetchSpcSummary()` resolves at line 2631: `setLatestStormReports(spcSummary.reports)`. Add `warningVerificationResolver` and `stormReports: getLatestStormReports` to the panel-layout dispatch from B1.

- [ ] **Step 5: Verify + commit**

`npm run typecheck:all`, `npm run test:weather`, `npm run test:intelligence`. Tracker row B2. Commit: `feat(weather): warning-verification outcome resolver from LSR reports (uplift B2)`.

---

## PR D1: Correlation benchmark + CI gate  ⚠ MERGES BEFORE ANY C PR

**Files:**
- Create: `src/services/correlation/__bench__/golden-streams.ts`
- Create: `src/services/correlation/bench-correlation.ts`
- Create: `src/services/correlation/bench-corr-baseline.ts`
- Create: `src/services/correlation/bench-baseline.json`
- Create: `src/services/correlation/__tests__/bench-correlation.test.mts` (auto-picked by the `test:correlation` glob)
- Create: `scripts/correlation-benchmark.mts`
- Modify: `package.json:104` area (add `"bench:correlation": "tsx scripts/correlation-benchmark.mts"`)
- Modify: `.github/workflows/smoke.yml:39` area (add `- run: npm run bench:correlation` after the cognition gate)

- [ ] **Step 1: Build the frozen stream corpus**

`golden-streams.ts` — pure data + one `mulberry32(seed)` PRNG (copy the exact helper from `cognition/__bench__/golden-windows.ts:52-63`). Types and the 8 streams:

```ts
export interface GoldenStream {
  id: string;
  description: string;
  events: readonly DomainEvent[];          // for the lead-lag miner
  plantedPairs: readonly { from: string; to: string }[];      // true causal
  plantedAbsent: readonly { from: string; to: string }[];     // must NOT be mined
  kind: 'causal' | 'independent' | 'bursty-confounder' | 'inhibitory' | 'mediated';
}
```

Stream generator helpers (all seeded, all timestamps relative to a fixed `T0 = 1_750_000_000_000`):

```ts
function causalStream(rng: () => number, from: string, to: string,
    n: number, lagMs: number, jitterMs: number, noiseDomains: string[]): DomainEvent[] {
  const events: DomainEvent[] = [];
  let t = T0;
  for (let i = 0; i < n; i++) {
    t += 4 * HOUR_MS + rng() * 2 * HOUR_MS;
    events.push({ domain: from, at: t });
    events.push({ domain: to, at: t + lagMs + rng() * jitterMs });
  }
  for (const d of noiseDomains) {
    let nt = T0;
    for (let i = 0; i < n; i++) { nt += 5 * HOUR_MS + rng() * 3 * HOUR_MS; events.push({ domain: d, at: nt }); }
  }
  return events.sort((a, b) => a.at - b.at);
}
```

The 8 streams (exact ids so the baseline is stable):
1. `causal-tight` — 20 A→B pairs, lag 30 min, jitter 15 min, 1 noise domain.
2. `causal-slow` — 15 A→B, lag 12 h, jitter 4 h, 2 noise domains.
3. `causal-weak` — 8 A→B, lag 1 h, jitter 1 h, 3 noise domains (near the support floor).
4. `independent` — two domains, independent seeded arrivals, `plantedAbsent: [{from:'ind-a',to:'ind-b'}]`.
5. `independent-dense` — same but 3× event density (stress the base rate).
6. `bursty-confounder` — both domains emit in coincident bursts (5-event clusters, cluster gap 24 h) with NO lag structure; `plantedAbsent` the pair. **Today's Poisson base rate is expected to false-positive here — the baseline RECORDS that honestly; C3's acceptance is reducing it.**
7. `inhibitory` — A regular every 2 h; B regular every 3 h EXCEPT suppressed for 6 h after each A. `plantedPairs: []` — carries `kind: 'inhibitory'` for C1's future metric; contributes nothing to precision/recall today.
8. `mediated` — A→B (lag 1 h) and B→C (lag 1 h) planted; `plantedPairs` lists both; `plantedAbsent: [{from:'med-a',to:'med-c'}]`. **Today's pairwise miner will also mine A→C — recorded as a baseline false positive; C2's acceptance is removing it.**

- [ ] **Step 2: Write the benchmark runner test FIRST**

`bench-correlation.test.mts` asserts: one result per stream; run-to-run determinism (two runs → deep-equal reports); metric bounds (`0 ≤ precision,recall ≤ 1`); the hand-verified baseline facts — `bursty-confounder` contributes ≥1 false edge and `mediated` contributes the A→C false edge under the current miner (these pin the honest baseline); injectable custom streams work; no-hang timing (`< 2000 ms`).

- [ ] **Step 3: Implement `bench-correlation.ts`**

```ts
export interface CorrBenchReport {
  generatedAt: number;
  streamCount: number;
  minedEdgeCount: number;
  pairPrecision: number;     // mined∩planted / mined  (over streams' union)
  pairRecall: number;        // mined∩planted / planted
  falsePositiveCount: number; // mined edges present in any plantedAbsent
  confidenceSeparation: number; // mean strength(true mined) − mean strength(false mined); 0 if either empty
  results: StreamBenchResult[];
}

export function runCorrelationBenchmark(opts: {
  streams?: readonly GoldenStream[];
  now?: number;
} = {}): CorrBenchReport {
  const streams = opts.streams ?? GOLDEN_STREAMS;
  // per stream: mineLeadLag(events) → significantEdges(...) with production defaults,
  // classify each mined (from,to) against plantedPairs / plantedAbsent,
  // aggregate precision/recall/FP/separation across streams; round 4dp.
}
```

Use the REAL `mineLeadLag` + `significantEdges` with production defaults — zero test doubles.

**Kernel-scoring stage (Codex P1 — the gate must protect what D2 tunes).** `confidenceSeparation` comes from the real `CorrelateEngine`, not miner `strength`. Add to `golden-streams.ts`:

```ts
export interface ScoringFixture {
  id: string;
  truePair: boolean;           // planted-genuine vs planted-noise pairing
  rule: { id: string; domains: [string, string]; timeWindowMs: number };
  obsA: ObservationEvent;      // controlled gap / distance / shared entities
  obsB: ObservationEvent;
}
export const SCORING_FIXTURES: readonly ScoringFixture[];  // 12 fixtures:
// 6 true pairs (tight gap ≤ half-window, distance ≤ 100km, ≥1 shared entity)
// 6 noise pairs (gap near window edge, distance ≥ 600km, 0 shared entities)
```

Bench stage: for each fixture, construct `new CorrelateEngine()` (neutral providers), `registerRule({ ...fixture.rule, matchFn: () => true, edgeType: 'causal-candidate', name: fixture.id, description: '' })`, run `correlate([obsA, obsB])`, take `pairs[0].confidence`. `confidenceSeparation = mean(conf | truePair) − mean(conf | !truePair)`. A bad D2 knob excursion (e.g. `valueFloor` → 0.3, `spatialDecayKm` → 800) collapses the separation and fails the gate — this is the backstop the spec requires.

- [ ] **Step 4: Baseline comparison + committed JSON**

`bench-corr-baseline.ts` mirrors `cognition/bench-baseline.ts` exactly:

```ts
export interface CorrBenchBaseline {
  streamCount: number; pairPrecision: number; pairRecall: number;
  falsePositiveCount: number; confidenceSeparation: number;
}
export const PRECISION_DROP_TOLERANCE = 0.05;
export const RECALL_DROP_TOLERANCE = 0.05;
export const SEPARATION_DROP_TOLERANCE = 0.05;   // guards the D2 kernel knobs
export function compareCorrBenchToBaseline(
  report: CorrBenchReport, baseline: CorrBenchBaseline,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (report.streamCount !== baseline.streamCount)
    reasons.push(`stream count drift ${report.streamCount} vs ${baseline.streamCount}`);
  if (baseline.pairPrecision - report.pairPrecision > PRECISION_DROP_TOLERANCE)
    reasons.push(`precision regression ${report.pairPrecision} vs ${baseline.pairPrecision}`);
  if (baseline.pairRecall - report.pairRecall > RECALL_DROP_TOLERANCE)
    reasons.push(`recall regression ${report.pairRecall} vs ${baseline.pairRecall}`);
  if (report.falsePositiveCount > baseline.falsePositiveCount)
    reasons.push(`false positives rose ${report.falsePositiveCount} vs ${baseline.falsePositiveCount}`);
  if (baseline.confidenceSeparation - report.confidenceSeparation > SEPARATION_DROP_TOLERANCE)
    reasons.push(`kernel separation regression ${report.confidenceSeparation} vs ${baseline.confidenceSeparation}`);
  return { ok: reasons.length === 0, reasons };
}
```

Generate `bench-baseline.json` by running the benchmark once and committing the ACTUAL numbers (including the honest bursty/mediated false positives). An improvement (C2/C3 removing FPs) requires a deliberate reviewed baseline update — same discipline as the cognition gate.

> **Operator decision point (spec #2):** the two tolerance constants are the CI strictness dial — Bradley reviews them in this PR.

- [ ] **Step 5: CLI + CI wiring**

`scripts/correlation-benchmark.mts`: copy `scripts/cognition-benchmark.mts` structure verbatim (shebang, `--json` flag, baseline path resolution via `fileURLToPath`, exit 1 on regression / 2 on harness error), pointing at the correlation modules. Add the package.json script next to `bench:cognition` (line 104). Add the smoke.yml step directly after `- run: npm run bench:cognition` (line 39) with a 3-line comment mirroring the cognition one.

- [ ] **Step 6: Verify + commit**

`npm run test:correlation` (new test picked up by glob), `npm run bench:correlation` (prints PASS against its own committed baseline), `npm run typecheck:all`. Tracker row D1. Commit: `feat(correlation): frozen-stream benchmark + CI gate (uplift D1 — gates all C PRs)`.

---

## PR C1: Inhibitory edge mining (+ real multiple-comparison correction)

**Files:**
- Modify: `src/services/correlation/lead-lag.ts` (inhibitory miner + Bonferroni-style z floor)
- Create: `src/services/correlation/inhibition.ts` (dampener provider)
- Modify: `src/services/intelligence/cascade-registration.ts:37` area (mine + publish inhibitory edges on the same hourly refresh)
- Modify: `src/services/correlation/compound-risk-cadence.ts` (consume the dampener)
- Tests: extend `src/services/correlation/__tests__/lead-lag.test.mts`; create `__tests__/inhibition.test.mts`
- Modify: `src/services/correlation/__bench__/golden-streams.ts` + baseline (activate the `inhibitory` stream's metric — deliberate baseline update in this PR)

- [ ] **Step 1: Failing tests for the corrected significance floor**

```ts
test('bonferroniZ grows with comparison count and floors at the default', () => {
  assert.equal(bonferroniZ(1), 2);                    // never below the legacy floor
  assert.ok(bonferroniZ(50) > bonferroniZ(10));
  assert.ok(bonferroniZ(100) > 3);                    // sqrt(2·ln(2·100/0.05)) ≈ 4.07
});
test('significantEdges applies the corrected floor when comparisons passed', () => {
  const edges = [edgeWith({ zScore: 2.5, lift: 3, support: 5 })];
  assert.equal(significantEdges(edges).length, 1);                       // legacy path unchanged
  assert.equal(significantEdges(edges, { comparisons: 200 }).length, 0); // corrected floor ≈ 4.2
});
```

- [ ] **Step 2: Implement the correction in `lead-lag.ts`**

```ts
/** Conservative union-bound z floor: P(Z>z) ≤ exp(−z²/2), so z ≥ √(2·ln(2m/α))
 *  bounds the family-wise error at α across m two-sided tests. Deterministic,
 *  no inverse-normal approximation needed. */
export function bonferroniZ(comparisons: number, alpha = 0.05): number {
  if (!Number.isFinite(comparisons) || comparisons <= 1) return 2;
  return Math.max(2, Math.sqrt(2 * Math.log((2 * comparisons) / alpha)));
}
```

Extend `SignificanceOptions` with `comparisons?: number`; in `significantEdges` use `minZ = Math.max(options.minZ ?? 2, options.comparisons ? bonferroniZ(options.comparisons) : 0)`. In `cascade-registration.ts`, pass `comparisons = orderedDomainPairCount × DEFAULT_WINDOWS_MS.length` (compute ordered pair count from the distinct domains in the event history). This makes the docs' "Bonferroni-corrected" claim TRUE — note it in the PR body.

- [ ] **Step 3: Failing tests for the inhibitory miner**

```ts
test('detects suppression: B under-follows A vs its base rate', () => {
  // A every 2h; B every 3h EXCEPT skipped for 6h after each A (build explicitly)
  const edges = mineInhibitoryEdges(events, { windowMs: 6 * HOUR_MS });
  const e = edges.find((x) => x.from === 'a' && x.to === 'b');
  assert.ok(e);
  assert.ok(e.lift <= 0.5);
  assert.ok(e.zScore <= -2);
});
test('uninformative base rate yields nothing', () => {
  // B so rare that expectedRate < 0.2 → absence proves nothing
  assert.equal(mineInhibitoryEdges(sparseEvents, {}).length, 0);
});
test('positive-causal fixture yields no inhibitory edge', () => {
  assert.equal(mineInhibitoryEdges(causalFixture, {}).length, 0);
});
```

- [ ] **Step 4: Implement `mineInhibitoryEdges`**

Reuse `minePair`'s trial construction (extract its per-pair core into a shared helper if needed — pure refactor, no behavior change to the positive path, existing tests must stay green):

```ts
export interface InhibitoryOptions {
  windowMs?: number;            // single window (default 6h) — suppression is short-range
  minAntecedents?: number;      // default 5
  minExpectedRate?: number;     // default 0.2 — absence is only informative
                                // when B was actually LIKELY in the window
  maxLift?: number;             // default 0.5
  maxZ?: number;                // default -2
  comparisons?: number;         // same union-bound floor, mirrored negative
}

export function mineInhibitoryEdges(
  events: readonly DomainEvent[], options: InhibitoryOptions = {},
): LeadLagEdge[]
```

Per ordered pair: same `followRate`/`expectedRate`/`lift`/`z` math as `minePair`; compute `const zFloor = Math.max(2, options.comparisons ? bonferroniZ(options.comparisons) : 2)` and keep the edge iff `antecedents >= 5 && expectedRate >= 0.2 && lift <= 0.5 && z <= -zFloor` (note the sign: the z must be at or BELOW the negated floor — Codex P1 caught an inverted formulation of this gate in an earlier draft). `explanation` states the suppression plainly ("b follows a at 0.10 vs expected 0.45").

- [ ] **Step 5: Dampener provider + wiring (`inhibition.ts`)**

```ts
const INHIBITION_FACTOR = 0.85;
const INHIBITION_FLOOR = 0.7;

let activeInhibitions: ReadonlyMap<string, LeadLagEdge> = new Map();

export function publishInhibitoryEdges(edges: readonly LeadLagEdge[]): void {
  activeInhibitions = new Map(edges.map((e) => [`${e.from}->${e.to}`, e]));
}

/** Multiplies compound-risk contributions for domain pairs with a mined
 *  suppression edge. Clamped [0.7, 1] — may soften a compound score, must
 *  NEVER touch delivery-rung / urgency decisions (asserted in tests). */
export function inhibitionFactorFor(domainA: string, domainB: string): number {
  const hit = activeInhibitions.get(`${domainA}->${domainB}`)
    ?? activeInhibitions.get(`${domainB}->${domainA}`);
  return hit ? Math.max(INHIBITION_FLOOR, INHIBITION_FACTOR) : 1;
}
```

Hourly refresh: in `cascade-registration.ts` alongside `refreshLearnedCascades`, mine + `publishInhibitoryEdges(...)`. Consume: in `compound-risk-cadence.ts`, multiply the pair contribution by `inhibitionFactorFor(a.domain, b.domain)` at the site where pairs feed `trackedComputeCompoundRisk` inputs. Test asserts: with an inhibition active, compound score decreases; no import of `weather-urgency`/notification modules from `inhibition.ts` (grep assertion in the test).

- [ ] **Step 6: Activate the benchmark's inhibitory metric**

Add `inhibitoryDetected: number` to `CorrBenchReport` (mined inhibitory edges matching planted `kind:'inhibitory'` streams); expected value 1 after this PR. Update `bench-baseline.json` in a REVIEWED diff (the PR body must show before/after). Comparison fn: fail if `inhibitoryDetected < baseline.inhibitoryDetected`.

- [ ] **Step 7: Verify + commit**

`npm run test:correlation`, `npm run bench:correlation` (PASS against updated baseline), `npm run typecheck:all`, `npm run test:intelligence`. Tracker row C1. Commit: `feat(correlation): inhibitory edge mining + real multiple-comparison floor (uplift C1)`.

---

## PR C2: Mediation filtering (multi-hop confounder control)

**Files:**
- Create: `src/services/correlation/mediation.ts`
- Create: `src/services/correlation/__tests__/mediation.test.mts`
- Modify: `src/services/intelligence/cascade-registration.ts` (filter before `learnedRulesFromEdges`)
- Modify: `src/services/correlation/correlation-map-view.ts` + `CorrelationMapPanel` (surface "A→C explained by B" rows)
- Modify: benchmark baseline (mediated A→C false positive disappears — reviewed update)

- [ ] **Step 1: Failing mediation tests**

```ts
test('A→C suppressed when B mediates (conditional lift collapses)', () => {
  // build: A at t, B at t+1h, C at t+2h, 20 reps + noise; all three pairwise edges significant
  const { direct, mediated } = filterMediatedEdges(allEdges, events, {});
  assert.ok(direct.some((e) => e.from === 'a' && e.to === 'b'));
  assert.ok(direct.some((e) => e.from === 'b' && e.to === 'c'));
  assert.ok(!direct.some((e) => e.from === 'a' && e.to === 'c'));
  assert.equal(mediated[0]?.via, 'b');
});
test('genuine direct A→C survives when it also fires WITHOUT B', () => {
  // interleave A→C occurrences with no interposed B → lift|¬B stays ≥ 2
  const { direct } = filterMediatedEdges(allEdges, eventsWithDirectPath, {});
  assert.ok(direct.some((e) => e.from === 'a' && e.to === 'c'));
});
test('no triple → passthrough', () => {
  const { direct, mediated } = filterMediatedEdges(pairOnlyEdges, events, {});
  assert.equal(mediated.length, 0);
  assert.equal(direct.length, pairOnlyEdges.length);
});
```

- [ ] **Step 2: Implement `mediation.ts`**

```ts
export interface MediatedEdge { from: string; to: string; via: string; liftWithoutVia: number }

export interface MediationOptions { minDirectLift?: number /* default 2 */ }

/** For every triple where A→B, B→C, A→C are all significant: re-test A→C on
 *  the subset of A-trials with NO interposed B. If the conditional lift
 *  collapses below minDirectLift, A→C is mediated — drop it from the rule
 *  set and report the triple. Deterministic; reuses the miner's trial
 *  construction on the raw event history. */
export function filterMediatedEdges(
  edges: readonly LeadLagEdge[],
  events: readonly DomainEvent[],
  options: MediationOptions = {},
): { direct: LeadLagEdge[]; mediated: MediatedEdge[] }
```

Core: group events by domain (same helper as `lead-lag.ts`); for each candidate triple, walk A antecedents; a trial is "without via" when no B event falls in `(a, a + edgeAC.windowMs)`; compute `followRate_noB` over those trials against the SAME `expectedRate` as the full A→C edge; `liftWithoutVia = followRate_noB / expectedRate`. Mediated iff `liftWithoutVia < (options.minDirectLift ?? 2)` AND the no-B trial count ≥ 3 (below that, insufficient evidence → keep the direct edge, never silently drop on thin data — record `liftWithoutVia` either way).

- [ ] **Step 3: Wire into the hourly refresh**

`cascade-registration.ts`: between `significantEdges(...)` and `learnedRulesFromEdges(...)`, insert `const { direct, mediated } = filterMediatedEdges(edges, history)`; sync rules from `direct` only; export `getMediatedTriples(): readonly MediatedEdge[]` (module state, refreshed each pass) for the panel. **Spec deviation note for the PR body:** the spec said "feed a chain candidate into causal-chain.ts", but `CausalChainBuilder.buildChain` is observation-level (no domain-level candidate queue exists) — suppression + surfacing is the honest fit; the A→B/B→C rules still compose into chains naturally at the pair level.

- [ ] **Step 4: Surface mediated triples**

`correlation-map-view.ts`: `buildMediatedRows(triples)` → `"a → c explained by b (lift 1.1 without b)"`; render as a small collapsed section under the live-pairs list in `CorrelationMapPanel`.

- [ ] **Step 5: Benchmark + verify + commit**

`bench:correlation`: the `mediated` stream's A→C false positive disappears → `falsePositiveCount` drops; update `bench-baseline.json` in a reviewed diff showing the improvement. `npm run test:correlation`, `npm run typecheck:all`. Tracker row C2. Commit: `feat(correlation): mediation filtering — suppress confounded A→C rules (uplift C2)`.

---

## PR C3: Dispersion-corrected significance (Hawkes-lite)

**Files:**
- Modify: `src/services/correlation/lead-lag.ts` (dispersion estimate + z correction)
- Tests: extend `src/services/correlation/__tests__/lead-lag.test.mts`
- Modify: benchmark baseline (bursty-confounder false positive disappears — reviewed update)

- [ ] **Step 1: Failing dispersion tests**

```ts
test('dispersionIndex ≈ 1 for regular/Poisson-like arrivals', () => {
  const times = Array.from({ length: 48 }, (_, i) => T0 + i * HOUR_MS);
  const d = dispersionIndex(times, HOUR_MS * 6);
  assert.ok(d >= 0.5 && d <= 1.5);
});
test('dispersionIndex >> 1 for clustered arrivals', () => {
  // 10 clusters of 5 events 1min apart, clusters 24h apart
  assert.ok(dispersionIndex(clustered, HOUR_MS * 6) > 2);
});
test('bursty consequents no longer clear the corrected z gate', () => {
  const edges = significantEdges(mineLeadLag(burstyConfounderEvents), {});
  // pre-C3 this fixture produced a false edge (pinned by the D1 baseline)
  assert.equal(edges.filter((e) => e.from === 'burst-a' && e.to === 'burst-b').length, 0);
});
test('genuine causal edges retain significance under correction', () => {
  const edges = significantEdges(mineLeadLag(causalTightEvents), {});
  assert.ok(edges.some((e) => e.from === 'ct-a' && e.to === 'ct-b'));
});
```

- [ ] **Step 2: Implement dispersion correction**

The bursty failure mode: clustered (self-exciting) consequents violate the Poisson variance assumption, inflating `z`. Classical quasi-Poisson fix — scale z by the dispersion index:

```ts
/** Variance-to-mean ratio of consequent counts over window-sized bins.
 *  1 for Poisson; >1 for clustered (self-exciting) streams. This is the
 *  "Hawkes-lite" correction: instead of fitting a full Hawkes process we
 *  measure overdispersion and deflate the z-statistic (quasi-likelihood). */
export function dispersionIndex(times: readonly number[], binMs: number): number {
  if (times.length < 4) return 1;
  const span = times[times.length - 1] - times[0];
  const bins = Math.max(4, Math.floor(span / binMs));
  const counts = new Array(bins).fill(0);
  for (const t of times) {
    const i = Math.min(bins - 1, Math.floor(((t - times[0]) / span) * bins));
    counts[i] += 1;
  }
  const mean = times.length / bins;
  if (mean === 0) return 1;
  const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / bins;
  return Math.max(1, variance / mean);
}
```

In `minePair`, after computing `z`: `const d = dispersionIndex(consequentTimes, windowMs); const zAdj = z / Math.sqrt(d);` — store `zAdj` as the edge's `zScore` and append `dispersion ${d.toFixed(1)}` to the explanation when `d > 1.5`. Apply identically in `mineInhibitoryEdges` (a suppression signal in a bursty stream is equally suspect). `strength` recomputes from the adjusted z automatically (it reads `zScore`).

- [ ] **Step 3: Benchmark + verify + commit**

`bench:correlation`: `bursty-confounder` false positive gone, `causal-*` recall unchanged → reviewed baseline update showing precision up. `npm run test:correlation`, `npm run typecheck:all`. Tracker row C3. Commit: `feat(correlation): dispersion-corrected z (Hawkes-lite) kills bursty false edges (uplift C3)`.

---

## PR C4: Per-regime rule reliability

**Files:**
- Modify: `src/services/correlation/correlation-calibration.ts` (regime-tagged source buckets + regime-aware provider)
- Tests: extend `src/services/correlation/__tests__/correlation-calibration.test.mts`

- [ ] **Step 1: Failing tests**

```ts
test('pair predictions recorded during a regime shift land in the @shifted bucket', () => {
  recordPairPredictionForTest(pair, { regimeActive: true });
  const sources = store.bySource().map((s) => s.sourceId);
  assert.ok(sources.includes('corr-rule:quake-infra@shifted'));
});
test('reliabilityForRule prefers the shifted bucket when regime active AND n>=20', () => {
  seedResolved('corr-rule:r1', 30, /*goodBrier*/ 0.05);
  seedResolved('corr-rule:r1@shifted', 25, /*badBrier*/ 0.4);
  assert.ok(reliabilityForRule('r1', { regimeActive: true }) < 1);   // shifted bucket wins
  assert.ok(reliabilityForRule('r1', { regimeActive: false }) > 1);  // base bucket
});
test('thin shifted bucket (n<20) falls back to overall', () => {
  seedResolved('corr-rule:r2', 30, 0.05);
  seedResolved('corr-rule:r2@shifted', 5, 0.4);
  assert.equal(reliabilityForRule('r2', { regimeActive: true }),
               reliabilityForRule('r2', { regimeActive: false }));
});
```

- [ ] **Step 2: Implement**

In `correlation-calibration.ts`:
- Constant `REGIME_SUFFIX = '@shifted'`, `REGIME_MIN_RESOLVED = 20`.
- The pair-listener record path (line ~199) checks regime state once per batch: `const regimeActive = hasActiveRegimeShift()` where `hasActiveRegimeShift()` wraps `Object.keys(getActiveRegimeShifts()).length > 0` (import from `../cognition/regime-monitor` — same source the coupling bridge uses; try/catch → false). When active, the record's `sourceId` becomes `` `${CORR_RULE_SOURCE_PREFIX}${ruleId}${REGIME_SUFFIX}` ``.
- `reliabilityForRule(ruleId, opts: { regimeActive?: boolean } = {})`: when `opts.regimeActive` (default: live `hasActiveRegimeShift()`), look up the shifted bucket first; use it iff its `resolvedCount >= REGIME_MIN_RESOLVED`; else the plain bucket. Cache key includes the regime flag (the 60 s TTL cache at line ~32 keys per `(ruleId, shifted)` now).
- The provider closure installed in `startCorrelationCalibration` (line 198) needs no signature change — it calls the new default-live path. Laplace-equivalent shrinkage is inherited from `perSourceMultipliers`' existing `minResolved` floor.

- [ ] **Step 3: Verify + commit**

`npm run test:correlation`, `npm run bench:correlation` (no baseline change expected — miner untouched), `npm run typecheck:all`. Tracker row C4. Commit: `feat(correlation): regime-conditional per-rule reliability (uplift C4)`.

---

## PR B3: Conflict/geo event confirmation resolver

**Files:**
- Modify: `src/services/intelligence/outcome-resolvers.ts` (add `eventOccurrenceResolver`)
- Modify: `src/services/intelligence/hypothesis-prediction-bridge.ts` (stamp `event_occurrence` criteria for conflict-kind hypotheses)
- Tests: extend `outcome-resolvers.test.mts` + bridge tests

- [ ] **Step 1: Failing resolver tests**

```ts
test('two entity-matching conflict observations inside horizon → proxy resolved_true', () => {
  const r = recWith({ criteria: { kind: 'event_occurrence', domains: ['conflict'],
    entitySlugs: ['donbas'], minEvidence: 2 } });
  const obs = [obsWith({ domain: 'conflict', entityIds: ['Donbas'], timestamp: 500 }),
               obsWith({ domain: 'conflict', entityIds: ['donbas-front'], timestamp: 600 })];
  const v = eventOccurrenceResolver.resolve(r, ctxWithObs(obs, 1000));
  assert.equal(v?.outcome, true);
  assert.match(v.note, /^proxy: 2 corroborating/);
});
test('one observation < minEvidence → null (conservative)', () => { /* ... */ });
test('past deadline with no evidence → null — record expires, never guessed false', () => {
  const v = eventOccurrenceResolver.resolve(staleRec, ctxWithObs([], 999_999_999));
  assert.equal(v, null);
});
test('entity match is slug-normalized both sides', () => { /* 'Suez Canal' vs 'suez-canal' */ });
```

Note the asymmetry vs the market resolver: absence of ingested conflict events is weak evidence (feed gaps exist), so fizzles are NEVER resolved false here — the record ages out to `'expired'` via the standard expiry (excluded from Brier), exactly as the spec's "misses stay unresolved rather than guessing".

- [ ] **Step 2: Implement `eventOccurrenceResolver`**

```ts
export const eventOccurrenceResolver: OutcomeResolver = {
  id: 'event-occurrence',
  canResolve: (r) => r.criteria?.kind === 'event_occurrence',
  resolve(r, ctx) {
    const c = r.criteria;
    if (c?.kind !== 'event_occurrence') return null;
    const wanted = new Set(c.entitySlugs.map(slugifyEntity));
    const matches: ObservationEvent[] = [];
    for (const domain of c.domains) {
      for (const o of ctx.queryObservations({ domain, since: r.predictedAt,
          until: Math.min(ctx.now, r.resolveBy), limit: 200 })) {
        const slugs = o.entityIds.map(slugifyEntity);
        if (slugs.some((s) => wanted.has(s)
            || [...wanted].some((w) => s.startsWith(w) || w.startsWith(s)))) {
          matches.push(o);
        }
      }
    }
    if (matches.length >= c.minEvidence) {
      return { outcome: true,
        note: `proxy: ${matches.length} corroborating ${c.domains.join('/')} observations (${matches.slice(0, 3).map((m) => m.id).join(', ')})` };
    }
    return null;   // conservative: never resolves false
  },
};
```

(`slugifyEntity` from A4's `entity-slug.ts` — B3 depends on A4 being merged.)

- [ ] **Step 3: Criteria stamping for conflict hypotheses**

In `recordHypothesisPredictions`, alongside `marketCriteriaFor`:

```ts
const CONFLICT_KINDS = new Set(['escalation', 'conflict', 'military']);

export function conflictCriteriaFor(h: Hypothesis): EventOccurrenceCriteria | undefined {
  if (!CONFLICT_KINDS.has(h.kind)) return undefined;
  const slugs = [...new Set(entitiesFromHypothesis(h)
    .filter((m) => m.kind === 'country' || m.kind === 'region')
    .map((m) => slugifyEntity(m.entity)))].filter(Boolean);
  if (slugs.length === 0) return undefined;
  return { kind: 'event_occurrence',
           domains: ['conflict', 'military', 'security'],
           entitySlugs: slugs.slice(0, 5),
           region: h.region, minEvidence: 2 };
}
```

Verify the actual `Hypothesis['kind']` union members at implementation time (`grep -n "kind" src/services/analyst-loop.ts | head`) and use the real conflict-ish literals in `CONFLICT_KINDS` — the set above is the intent, the union is the authority. Stamp `criteria: marketCriteriaFor(h) ?? conflictCriteriaFor(h)`. Register `eventOccurrenceResolver` in the panel-layout dispatch.

- [ ] **Step 4: Verify + commit**

`npm run test:intelligence`, `npm run typecheck:all`. Tracker row B3. Commit: `feat(intelligence): conflict event-occurrence resolver (uplift B3)`.

---

## PR D2: Tunable kernel weights + safety fixtures (LAST PR)

**Files:**
- Modify: `src/services/algorithms/tunable-params-store.ts` (4 declarations)
- Modify: `src/services/correlation/edge-confidence.ts` (read tuned values)
- Modify: `src/services/algorithms/algorithm-registry.ts` (register `correlation-edge`)
- Modify: `src/services/correlation/correlation-calibration.ts` (grade `correlation-edge` on each resolution pass)
- Modify: `src/services/algorithms/tuning-safety-fixtures.ts` (one real suite; three fail-closed)
- Tests: extend `src/services/algorithms/__tests__/` suites + `edge-confidence.test.mts`

- [ ] **Step 1: Declarations (defaults = current hardcoded values — empty store is byte-identical)**

Append to `DECLARATIONS` (`tunable-params-store.ts:42-267`), all `affectsNotifications: false`:

```ts
{ algorithmId: 'correlation-edge', parameterId: 'spatialDecayKm',
  default: 400, min: 200, max: 800, step: 50, fixDirection: 'decrease',
  description: 'e-folding distance for the spatial kernel factor' },
{ algorithmId: 'correlation-edge', parameterId: 'spatialFloor',
  default: 0.5, min: 0.3, max: 0.7, step: 0.05, fixDirection: 'increase',
  description: 'minimum spatial factor for distant pairs' },
{ algorithmId: 'correlation-edge', parameterId: 'entityBoostPerShared',
  default: 0.15, min: 0.05, max: 0.25, step: 0.05, fixDirection: 'decrease',
  description: 'confidence boost per shared entity (max 2 counted)' },
{ algorithmId: 'correlation-edge', parameterId: 'valueFloor',
  default: 0.2, min: 0.1, max: 0.3, step: 0.05, fixDirection: 'increase',
  description: 'floor on final edge confidence' },
```

- [ ] **Step 2: Tuned reads in `edge-confidence.ts`**

Replace the four const usages (lines 59-65) with `getTunedParam('correlation-edge', 'spatialDecayKm', SPATIAL_DECAY_KM)` etc. at the point of use inside `spatialFactor`/`entityFactor`/the kernel clamp (getTunedParam has its own 5 s memo — safe on this hot path, proven by the PR 12 precedent). Keep the consts exported as the declared defaults. Test: `_resetTunedParamsForTests()` → identical output to pre-change fixtures (byte-identical guarantee); `setTunedParam('correlation-edge','valueFloor',0.3)` → floor honored.

- [ ] **Step 3: Registry + grading**

Registry entry (append to `REGISTRY_INITIAL`, mirroring `correlation-feedback` at `:221-231`):

```ts
{ id: 'correlation-edge', label: 'Correlation edge confidence', version: '1.0.0',
  domain: 'correlation', healthDomain: 'reasoning_hypothesis', ownerFeature: 'intelligence',
  dependencies: { sources: [], providers: [], services: [] },
  outputs: ['risk_score'], criticality: 'medium' },
```

Grading: in `correlation-calibration.ts`'s throttled resolution pass (line ~203-208), after resolving, compute the aggregate over `bySource()` corr-rule buckets and record one evaluation per pass:

```ts
recordAlgorithmEvaluation('correlation-edge', {
  durationMs: passDurationMs,
  score: clamp01(1 - 2 * meanBrierAcrossCorrRuleBuckets),   // 0.5 brier → 0
  notes: `rules=${bucketCount} resolved=${totalResolved}`,
});
```

(Guard: skip when no bucket has ≥5 resolved. Update the expected-registry test lists in `test:algorithms`.)

- [ ] **Step 4: Safety suite for `spatialDecayKm` (the one real suite)**

In `tuning-safety-fixtures.ts`, following the `episodic-analog:minSim` pattern exactly (`:361-436`): labeled cases calling the REAL `computeEdgeConfidence` with explicit inputs, `elevated = value >= 0.5`:

```ts
const EDGE_CASES = [
  // T1 blocks decreases below ~300: a genuine 350km cross-border pair must stay elevated
  { id: 'T1-cross-border-pair', input: { gapMs: 600_000, timeWindowMs: 3_600_000,
      distanceKm: 350, sharedEntityCount: 1 }, expectElevated: true },
  // T2 blocks increases above ~600: an 800km coincidence must NOT be elevated
  { id: 'F1-continental-coincidence', input: { gapMs: 1_800_000, timeWindowMs: 3_600_000,
      distanceKm: 800, sharedEntityCount: 0 }, expectElevated: false },
  // N1 sanity: tight local pair elevated at any in-range decay
  { id: 'N1-local-pair', input: { gapMs: 60_000, timeWindowMs: 3_600_000,
      distanceKm: 5, sharedEntityCount: 2 }, expectElevated: true },
  // F2 blocks the far-decay end interacting with the floor
  { id: 'F2-floor-interaction', input: { gapMs: 3_000_000, timeWindowMs: 3_600_000,
      distanceKm: 700, sharedEntityCount: 0 }, expectElevated: false },
];
```

Scorer `scoreCorrelationEdgeSpatialDecay(candidateKm)` sets the tuned value via an explicit-override path (add an `opts` param to the internal `spatialFactor` or set/reset the tuned param inside the scorer with try/finally), runs the cases, returns `TuningSafetyScore`. Register in `SCORERS` under `'correlation-edge:spatialDecayKm'`. Tune the case inputs until the suite genuinely discriminates (blocks ≤300 and ≥600, allows 400±50) — verify by hand-running the scorer at 250/400/650 in the test. The other three knobs: no suite → `proposeTuningSafety` fail-closes → `held_for_approval` (add the pinning test, mirroring the PR 12 `analogBlendK` precedent).

- [ ] **Step 5: Verify + commit**

`npm run test:algorithms`, `npm run test:correlation`, `npm run bench:correlation` (backstop — must still PASS), `npm run typecheck:all`. Tracker row D2 → program complete; flip the spec's Status header to COMPLETE in the same commit. Commit: `feat(algorithms): correlation kernel weights join the tuning loop (uplift D2 — program complete)`.

---

## Cross-PR verification checklist (every PR)

- [ ] `npm run typecheck:all` — 0 errors
- [ ] Relevant `test:*` scripts green; `npm run test:renderer` before merge on PRs touching shared types (`forecast-calibration.ts` in B1 fans out widest)
- [ ] `npm run bench:cognition` + (post-D1) `npm run bench:correlation` — PASS; baseline updates only as deliberate reviewed diffs
- [ ] Spec tracker row updated in the same commit
- [ ] Real Codex cross-agent review; honest marker in the PR body
- [ ] No new timers where a `registerRecurringLoop` / existing cadence can host the work
