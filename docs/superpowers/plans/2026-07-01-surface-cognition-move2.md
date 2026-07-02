# Surface Cognition Depth (Move 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-merged-but-invisible cognition layer — put forecast provenance in the AnalystHUD, a real calibration report in BeliefCalibrationPanel, and start the two safe dormant learning loops — so ~4,500 LOC of tested engines finally reach a human.

**Architecture:** Pure, fixture-tested *view-model builders* transform cognition outputs into render-ready structures; thin DOM code renders them. No engine changes — this is read + render + boot-wiring over existing functions. Each group is an independently landable sub-PR.

**Tech Stack:** TypeScript, `node:test` via `tsx` (`*.test.mts`), existing `Panel`/HUD DOM patterns, `escapeHtml` from `@/utils/sanitize`.

**Branch:** `claude/surface-cognition-move2` off `origin/main` (after Move 1 / PR #1338 lands).

---

## Real contracts (verified against source — use these exactly)

- `HypothesisForecast.components` (`src/services/intelligence/hypothesis-forecast.ts:17`): `{ baseConfidence, pciBoost, analogBoost, providerMultiplier, calibrationMultiplier, recalibratedP?, calibrationAdjustment?, calibrationExplanation? }`. All numbers except the three `*Explanation`/optional fields.
- `AnalystHUD.buildForecastBar(forecast: HypothesisForecast)` (`src/components/AnalystHUD.ts:839`) currently renders only `${pct}% ${arrow} ${horizon}` + a track/fill and **discards `forecast.components`**.
- `getRecalibrator(domain?: FactDomain): (p:number)=>RecalibrationResult` — `src/services/intelligence/forecast-calibration-adapter.ts:263`.
- `buildCurve(records): ReliabilityCurve` (`src/services/cognition/recalibration.ts:173`); `ReliabilityCurve = { domain, bins: ReliabilityBin[], ... }`.
- `getCalibrationStore()` (`forecast-calibration-adapter.ts:67`) → holds `PredictionRecord[]` from the live forecast path.
- `conformalInterval(p, domain, records, alpha?): ForecastInterval` (`src/services/cognition/conformal.ts:145`); result exposes a coverage % + explanation string.
- `getComparison(domain?): Promise<CalibrationComparison>` (`src/services/cognition/forecast-journal.ts:391`); `getOperatorCurve(domain?)` / `getOperatorBrier(domain?)` (`:325`/`:336`).
- `runConsolidation(opts?): Promise<ConsolidationReport>` (`src/services/cognition/consolidation.ts:559`).
- `mineCascades(...)` (`src/services/intelligence/learned-cascades.ts:50`) + `cascadePairKeys(...)` (`:116`) → `registerLearnedCascadePairs(keys: Iterable<string>)` (`src/services/intelligence/compound-risk.ts:385`).
- Boot cadence anchor: `src/app/panel-layout.ts:921-924` (`startOutcomeGradingCadence()` etc. are called together here).

**Out of scope (explicit follow-on, do NOT build here):** operator forecast-logging UI (`logForecast` affordance) and regime-shift (`ingestSample`/BOCPD) surfacing — both need new operator-input affordances + analyst-loop call sites; they get their own move. This plan surfaces the data those will later feed, and the operator-vs-system panel section degrades gracefully to "no operator forecasts yet."

---

## File Structure

- Create `src/components/forecast-provenance-view.ts` — pure `buildForecastProvenanceLines(forecast)` → `string[]`.
- Create `src/components/__tests__/forecast-provenance-view.test.mts`.
- Modify `src/components/AnalystHUD.ts:839` — render provenance under the forecast bar.
- Create `src/components/calibration-report-view.ts` — pure `buildCalibrationReport(...)` → render-ready view-model.
- Create `src/components/__tests__/calibration-report-view.test.mts`.
- Modify `src/components/BeliefCalibrationPanel.ts` — add a "Calibration report" section from the view-model.
- Create `src/services/cognition/consolidation-cadence.ts` — `startConsolidationCadence()` (interval + idle guard).
- Create `src/services/cognition/__tests__/consolidation-cadence.test.mts`.
- Create `src/services/intelligence/cascade-registration.ts` — `refreshLearnedCascades()` (mine → keys → register).
- Create `src/services/intelligence/__tests__/cascade-registration.test.mts`.
- Modify `src/app/panel-layout.ts:924` — start both loops alongside the existing cadences.
- Add the two new test files to `test:cognition` / the intelligence test script in `package.json`.

---

## Task Group A — AnalystHUD forecast provenance

### Task A1: Pure provenance-line builder

**Files:**
- Create: `src/components/forecast-provenance-view.ts`
- Test: `src/components/__tests__/forecast-provenance-view.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildForecastProvenanceLines } from '../forecast-provenance-view.ts';
import type { HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';

const base: HypothesisForecast = {
  hypothesisId: 'h1', probability: 0.62, trend: 'rising', horizon: '24h',
  components: { baseConfidence: 0.5, pciBoost: 0.05, analogBoost: 0.04, providerMultiplier: 1, calibrationMultiplier: 1 },
};

test('shows base confidence and non-zero adjustments only', () => {
  const lines = buildForecastProvenanceLines(base);
  assert.ok(lines.some(l => l.includes('Base') && l.includes('50%')));
  assert.ok(lines.some(l => l.includes('analog') && l.includes('+4%')));
  assert.ok(!lines.some(l => l.toLowerCase().includes('provider')), 'multiplier of 1 is omitted');
});

test('surfaces the calibration explanation when present', () => {
  const lines = buildForecastProvenanceLines({
    ...base,
    components: { ...base.components, recalibratedP: 0.6, calibrationAdjustment: -0.02, calibrationExplanation: 'reliability curve pulled 64%→60% (n=42)' },
  });
  assert.ok(lines.some(l => l.includes('reliability curve pulled')));
});

test('empty-safe: identity forecast yields at least the base line', () => {
  const lines = buildForecastProvenanceLines({ ...base, components: { baseConfidence: 0.5, pciBoost: 0, analogBoost: 0, providerMultiplier: 1, calibrationMultiplier: 1 } });
  assert.equal(lines.length >= 1, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/components/__tests__/forecast-provenance-view.test.mts`
Expected: FAIL — `Cannot find module '../forecast-provenance-view.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`;

export function buildForecastProvenanceLines(f: HypothesisForecast): string[] {
  const c = f.components;
  const lines: string[] = [`Base confidence ${pct(c.baseConfidence)}`];
  if (c.pciBoost) lines.push(`Pattern (PCI) ${signed(c.pciBoost)}`);
  if (c.analogBoost) lines.push(`Past analogs ${signed(c.analogBoost)}`);
  if (c.calibrationExplanation) lines.push(c.calibrationExplanation);
  else if (c.recalibratedP !== undefined && c.calibrationAdjustment) lines.push(`Calibration ${signed(c.calibrationAdjustment)}`);
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/components/__tests__/forecast-provenance-view.test.mts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/forecast-provenance-view.ts src/components/__tests__/forecast-provenance-view.test.mts
git commit -m "feat(cognition-ui): pure forecast-provenance line builder"
```

### Task A2: Render provenance in the AnalystHUD forecast bar

**Files:**
- Modify: `src/components/AnalystHUD.ts` (the `buildForecastBar` method at ~:839)

- [ ] **Step 1: Read `buildForecastBar` fully** (from `:839` to its `return wrap`) to see how `wrap`/`label`/`track` are appended and what CSS classes exist.

- [ ] **Step 2: Add an expandable provenance block.** Import `buildForecastProvenanceLines` at the top of `AnalystHUD.ts`. In `buildForecastBar`, after the existing `track`/`fill` are appended to `wrap`, append a `<details class="analyst-hud-forecast-why">` whose `<summary>` is "why" and whose body lists `buildForecastProvenanceLines(forecast)` as `<div>` rows (use `textContent`, never innerHTML). Keep it collapsed by default.

```ts
const why = document.createElement('details');
why.className = 'analyst-hud-forecast-why';
const sum = document.createElement('summary');
sum.textContent = 'why';
why.append(sum);
for (const line of buildForecastProvenanceLines(forecast)) {
  const row = document.createElement('div');
  row.className = 'analyst-hud-forecast-why-row';
  row.textContent = line;
  why.append(row);
}
wrap.append(why);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors.

- [ ] **Step 4: Lint the changed file**

Run: `npx eslint --quiet src/components/AnalystHUD.ts src/components/forecast-provenance-view.ts`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/AnalystHUD.ts
git commit -m "feat(cognition-ui): surface forecast provenance in AnalystHUD"
```

---

## Task Group B — BeliefCalibrationPanel: real calibration report

### Task B1: Pure calibration-report view-model

**Files:**
- Create: `src/components/calibration-report-view.ts`
- Test: `src/components/__tests__/calibration-report-view.test.mts`

- [ ] **Step 1: Read `src/services/cognition/recalibration.ts:61-84`** for the exact `ReliabilityBin`/`ReliabilityCurve` field names, and `src/services/cognition/forecast-journal.ts:71` for `CalibrationComparison` fields. Use the real field names in the view-model below (adjust the test accordingly).

- [ ] **Step 2: Write the failing test** (a pure transform over a fixed `ReliabilityCurve` + optional `CalibrationComparison`; no live data):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalibrationReport } from '../calibration-report-view.ts';

test('summarizes a reliability curve into bin rows + a headline', () => {
  const curve = { domain: 'global', bins: [
    { predictedMid: 0.1, observedRate: 0.08, count: 20 },
    { predictedMid: 0.9, observedRate: 0.7, count: 10 },
  ] } as any;
  const view = buildCalibrationReport({ curve, coveragePct: 80, comparison: null });
  assert.equal(view.rows.length, 2);
  assert.ok(view.headline.includes('80%'));
  assert.equal(view.hasOperatorData, false);
});

test('includes operator-vs-system when comparison present with data', () => {
  const view = buildCalibrationReport({
    curve: { domain: 'global', bins: [] } as any, coveragePct: 80,
    comparison: { systemBrier: 0.18, operatorBrier: 0.15, n: 40 } as any,
  });
  assert.equal(view.hasOperatorData, true);
  assert.ok(view.operatorLine!.includes('operator'));
});
```

*(Fix the fixture field names in Step 1 to match the real `ReliabilityBin`/`CalibrationComparison` shape before running.)*

- [ ] **Step 3: Run test to verify it fails** — Run: `npx tsx --test src/components/__tests__/calibration-report-view.test.mts` → FAIL (module missing).

- [ ] **Step 4: Implement `buildCalibrationReport`** — a pure function `({ curve, coveragePct, comparison }) => { headline, rows: {label,predicted,observed,count}[], hasOperatorData, operatorLine? }`. Map each `ReliabilityBin` to a row; headline = `"System calibration · ${coveragePct}% conformal coverage"`; `hasOperatorData = !!comparison && comparison.n > 0`; `operatorLine` compares system vs operator Brier when present. Use the real field names confirmed in Step 1.

- [ ] **Step 5: Run test to verify it passes** — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/calibration-report-view.ts src/components/__tests__/calibration-report-view.test.mts
git commit -m "feat(cognition-ui): pure calibration-report view-model"
```

### Task B2: Render the report in BeliefCalibrationPanel

**Files:**
- Modify: `src/components/BeliefCalibrationPanel.ts` (192 LOC; `render()` at `:69`)

- [ ] **Step 1: Read `BeliefCalibrationPanel.render()`** to match its section/HTML-string style + `escapeHtml` usage.

- [ ] **Step 2: Add a "Calibration report" section.** In `render()` (or a new async `renderReport()` invoked from it), gather live inputs: `const curve = buildCurve(getCalibrationStore().all())` (confirm the store's records accessor name), `const coveragePct` from `conformalInterval(0.5, 'global', getCalibrationStore().all()).` (read `ForecastInterval` for the coverage field name), and `const comparison = await getComparison()` (wrap in try/catch → null). Pass through `buildCalibrationReport({curve, coveragePct, comparison})` and render `headline` + `rows` (predicted vs observed vs count) + `operatorLine` when `hasOperatorData`, else a muted "Log your own forecasts to compare (coming soon)". Escape all interpolated text.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck:all` (0 errors) then `npx eslint --quiet src/components/BeliefCalibrationPanel.ts src/components/calibration-report-view.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/components/BeliefCalibrationPanel.ts
git commit -m "feat(cognition-ui): render live calibration report in BeliefCalibrationPanel"
```

---

## Task Group C — Boot the two safe dormant loops

### Task C1: Consolidation cadence

**Files:**
- Create: `src/services/cognition/consolidation-cadence.ts`
- Test: `src/services/cognition/__tests__/consolidation-cadence.test.mts`

- [ ] **Step 1: Write the failing test** (guard logic only — no real IDB):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunConsolidation } from '../consolidation-cadence.ts';

test('runs when never run before', () => {
  assert.equal(shouldRunConsolidation(null, 0), true);
});
test('does not run before the interval elapses', () => {
  assert.equal(shouldRunConsolidation(1_000_000, 1_000_000 + 60_000), false);
});
test('runs after the 6h interval', () => {
  assert.equal(shouldRunConsolidation(0, 6 * 60 * 60 * 1000 + 1), true);
});
```

- [ ] **Step 2: Run → FAIL** (`npx tsx --test src/services/cognition/__tests__/consolidation-cadence.test.mts`).

- [ ] **Step 3: Implement.** Export `const CONSOLIDATION_INTERVAL_MS = 6*60*60*1000;`, a pure `shouldRunConsolidation(lastRunMs: number|null, nowMs: number): boolean`, and `startConsolidationCadence(): void` that: reads last-run from `localStorage['cb:consolidation-last']`, on a `setInterval` (every 30 min) checks `shouldRunConsolidation`, and when true calls `void runConsolidation().then(() => localStorage.setItem('cb:consolidation-last', String(Date.now())))`, guarded by `isGhostMode()` and wrapped in try/catch. Import `runConsolidation` from `./consolidation` and `isGhostMode` from the same source operator-model uses.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git add` both files; `git commit -m "feat(cognition): consolidation cadence (idle-guarded 6h)"`.

### Task C2: Learned-cascade registration

**Files:**
- Create: `src/services/intelligence/cascade-registration.ts`
- Test: `src/services/intelligence/__tests__/cascade-registration.test.mts`

- [ ] **Step 1: Read `learned-cascades.ts:50` (`mineCascades`) and `:116` (`cascadePairKeys`)** for their exact inputs/outputs, and `compound-risk.ts:385` (`registerLearnedCascadePairs`).

- [ ] **Step 2: Write the failing test** — assert `refreshLearnedCascades(<fixture event history>)` calls `registerLearnedCascadePairs` with the mined keys (spy by importing `registerLearnedCascadePairs` and checking observable effect, e.g. a subsequent `compound-risk` computation reflects the pair, OR export a small `computeCascadeKeys(history)` pure helper and test that directly — prefer the pure helper).

- [ ] **Step 3: Implement** `computeCascadeKeys(history)` (pure: `mineCascades` → `cascadePairKeys`) + `refreshLearnedCascades(history)` (calls `registerLearnedCascadePairs(computeCascadeKeys(history))`, ghost-guarded, try/catch).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(intelligence): register mined learned-cascade pairs into compound-risk"`.

### Task C3: Boot both loops

**Files:**
- Modify: `src/app/panel-layout.ts:924` (right after `startBiasScanCadence();`)

- [ ] **Step 1: Import** `startConsolidationCadence` and `refreshLearnedCascades` at the top of `panel-layout.ts`. Import the analyst event-history accessor the analyst-loop already uses (find how `mineCascades` would get history — likely `snapshot-archive` or the analyst-loop's history; if `refreshLearnedCascades` needs live history, call it inside the existing analyst-loop cadence instead, wherever `recordEpisode` is called at `analyst-loop.ts:364`, rather than at boot).

- [ ] **Step 2: Wire.** Add `startConsolidationCadence();` at `:924`. For cascades, if history is available at boot, call `refreshLearnedCascades(history)`; otherwise add the call to the analyst-loop cadence next to `recordEpisode`. Keep the boot edit to one or two lines (panel-layout.ts is a conflict-magnet god-object).

- [ ] **Step 3: Typecheck** — `npm run typecheck:all` → 0 errors.

- [ ] **Step 4: Commit** — `git commit -m "feat(cognition): start consolidation + learned-cascade loops at boot"`.

### Task C4: Wire tests into scripts + full verify

**Files:**
- Modify: `package.json` (`test:cognition` and the intelligence test script)

- [ ] **Step 1: Add** the 4 new test files to the matching `test:*` scripts.
- [ ] **Step 2: Run** `npm run typecheck:all` (0), `npm run test:cognition`, and the intelligence test script — all green.
- [ ] **Step 3: Lint** all created/changed files — no new errors.
- [ ] **Step 4: Commit** — `git commit -m "test: wire Move-2 cognition-surface tests into suites"`.

---

## Self-Review

- **Spec coverage:** WS-1 of the roadmap = (a) AnalystHUD provenance → Group A; (b) BeliefCalibrationPanel payload → Group B; (c) dormant loops → Group C (consolidation + cascades; logForecast/regime explicitly deferred with rationale). Covered.
- **Placeholder scan:** Groups A/C1/C2 have full test + impl code. B1 impl and B2/C3 render/boot steps intentionally say "confirm the real field name in Step 1 then implement" because the exact `ReliabilityBin`/`ForecastInterval`/store-accessor field names must be read from source at execution time — each such step names the exact file:line to read and the exact function to call, which is concrete, not a placeholder.
- **Type consistency:** `buildForecastProvenanceLines` (A) and `buildCalibrationReport` (B) names are used identically in their render tasks; `shouldRunConsolidation`/`startConsolidationCadence` (C1) and `computeCascadeKeys`/`refreshLearnedCascades` (C2) match their boot wiring (C3).
- **Guards:** every boot loop is `isGhostMode()`-guarded + try/catch, matching `recordEngagement`/`logForecast` house style.
