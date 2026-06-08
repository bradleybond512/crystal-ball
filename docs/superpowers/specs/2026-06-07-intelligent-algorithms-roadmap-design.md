# Intelligent Algorithms & AI Features Roadmap — Design Spec

**Date:** 2026-06-07
**Goal:** Wire dormant prediction engines into the live app, then layer autonomous forecast scores and Claude-as-analyst capabilities on top, closing with a visible self-improvement loop. Four PRs in dependency order.

---

## Overview

Crystal Ball has ~150 intelligence services built under `src/services/intelligence/`. Many are never started at boot — their panels render empty. This roadmap closes the gap in two waves:

**Wave 1 (PRs 1–2):** Wire what exists. Boot dormant engines. Surface autonomous probability forecasts on every hypothesis card.

**Wave 2 (PRs 3–4):** Build what's new. Claude-as-analyst with live intelligence context. A visible self-improvement loop tied to outcome grading.

### Invariants

- Ghost Mode suppresses all new UI surfaces (forecast bars, accuracy sparkline, auto-analysis)
- All new services degrade gracefully when upstream data is unavailable
- No new API keys required
- New services are input-output pure where possible (no DOM, no fetch in computation functions)
- All new hypothesis kinds and forecast scores degrade to empty state when source services are unavailable

---

## PR 1 — Wire Dormant Prediction Engines

### What

Four computation engines are built but never called at boot. Their panels exist and render empty. This PR adds the missing start calls.

| Service | Panel | What it computes |
|---|---|---|
| `predictive-crisis-index.ts` | HUD header badge | Composite crisis probability index 0–100 |
| `crisis-trajectory.ts` | `CrisisTrajectoryPanel` | 7/14/30d projected escalation path |
| `active-learning-queue.ts` | `ActiveLearningQueuePanel` | Hypotheses needing human confirmation |
| `analog-monitor.ts` | HUD analog cards | Historical analog matching (written in analyst-surface-hidden PR, needs boot call) |

### Architecture

**`src/services/predictive-crisis-index.ts`:**

- Add a `startPredictiveCrisisIndex()` export that subscribes to `cb:analyst-hypotheses`, calls `computePCI()` on each snapshot, and emits `cb:pci-updated` with the `PCIScore` result
- Existing `pciToAlert()` already handles unified alert injection — call it inside the listener
- Cadence: runs every analyst cycle (5 min), no independent timer needed

**`src/services/crisis-trajectory.ts`:**

- Add `startCrisisTrajectory()` export that subscribes to `cb:analyst-hypotheses`, instantiates `CrisisTrajectoryProjector` with the top-ranked hypothesis, and emits `cb:crisis-trajectory` with the projection
- `CrisisTrajectoryPanel` already listens for this event — zero panel changes needed

**`src/services/active-learning-queue.ts`:**

- Add `startActiveLearningQueue()` export that subscribes to `cb:analyst-hypotheses` and routes low-confidence hypotheses (confidence < 0.5, risk ≥ moderate) into the queue
- `ActiveLearningQueuePanel` already renders queue items

**`src/services/historical-analogs/analog-monitor.ts`:**

- `startAnalogMonitor()` already exported — just needs to be called in `panel-layout.ts`
- Pass a getter wrapping `getAnalystSnapshot()?.hypotheses` mapped to `SituationForScoring`

**`src/app/panel-layout.ts`:**

- Import and call all four start functions after `startAnalystLoop()` in the boot sequence

### Files Changed

| File | Change |
|---|---|
| `src/services/predictive-crisis-index.ts` | Add `startPredictiveCrisisIndex()` + `cb:pci-updated` emission |
| `src/services/crisis-trajectory.ts` | Add `startCrisisTrajectory()` + `cb:crisis-trajectory` emission |
| `src/services/active-learning-queue.ts` | Add `startActiveLearningQueue()` |
| `src/app/panel-layout.ts` | Import + call 4 start functions after `startAnalystLoop()` |

### Tests

- `predictive-crisis-index`: `startPredictiveCrisisIndex()` emits `cb:pci-updated` when `cb:analyst-hypotheses` fires with ≥1 hypothesis
- `crisis-trajectory`: `startCrisisTrajectory()` emits `cb:crisis-trajectory` with a projection containing 7/14/30d horizons
- `active-learning-queue`: routes hypothesis with confidence < 0.5 into the queue; skips confidence ≥ 0.5

---

## PR 2 — Autonomous Forecast Scores

### What

Every hypothesis card in the Analyst HUD gets a probability bar and horizon badge, always visible. Example: `▲ 68% · 14d` in amber. Synthesized from PCI, analog matches, and base hypothesis confidence.

### Architecture

**New service: `src/services/hypothesis-forecast.ts`**

```typescript
export interface HypothesisForecast {
  hypothesisId: string;
  /** Synthesized probability 0–1. */
  probability: number;
  /** Best available horizon in days. */
  horizon: 7 | 14 | 30;
  /** Derived from confidence trajectory over the last 3 cycles. */
  trend: 'rising' | 'stable' | 'falling';
  /** Which signals contributed to this score. */
  sources: ('hypothesis' | 'pci' | 'analog')[];
}

export type ForecastMap = Map<string, HypothesisForecast>;

export function startHypothesisForecast(): void
export function getLatestForecasts(): ForecastMap

```

**Synthesis logic:**

1. Base: hypothesis `confidence` (always available)
2. PCI weight: if `cb:pci-updated` has fired, blend PCI index/100 as a 20% prior
3. Analog weight: if `cb:analog-match` contains a match for this hypothesis's region/kind, blend the analog's top outcome confidence as a 15% prior
4. Formula: `probability = base * 0.65 + pci_contribution * 0.20 + analog_contribution * 0.15`
5. Horizon: use crisis trajectory horizon if available, else analog horizon, else default 14d
6. Trend: compare current probability to the previous two cycles stored in a 3-entry ring per hypothesis

Emits `cb:hypothesis-forecasts` with a `ForecastMap` after every `cb:analyst-hypotheses` cycle.

**`AnalystHUD.ts` integration:**

- Subscribe to `cb:hypothesis-forecasts` in `mount()`
- `buildHypForecastBar(forecast: HypothesisForecast): HTMLElement` — renders a small row:

  - Trend arrow: ▲ (rising) / ▼ (falling) / → (stable)
  - Probability: `68%` colored green ≤40%, amber 40–70%, red >70%
  - Horizon badge: `· 14d`

- Appended below the hypothesis statement in `buildHypothesisRow()`
- Suppressed when Ghost Mode is active

### Data Flow

```

cb:analyst-hypotheses
cb:pci-updated          →  hypothesis-forecast.ts  →  cb:hypothesis-forecasts  →  AnalystHUD
cb:analog-match

```

### Files Changed

| File | Change |
|---|---|
| `src/services/hypothesis-forecast.ts` | New — ~100 lines |
| `src/components/AnalystHUD.ts` | Subscribe to forecasts, add `buildHypForecastBar()`, render in rows |
| `src/app/panel-layout.ts` | Boot `startHypothesisForecast()` |

### Tests

- Synthesis uses only hypothesis confidence when PCI/analog unavailable
- PCI and analog contributions blend correctly when both present
- Trend is `rising` when probability increased over last 2 cycles
- `buildHypForecastBar()` renders correct probability text from fixture forecast

---

## PR 3 — Claude-as-Analyst Upgrade

### What

Two surfaces:

1. **Live context injection** — every question in `AskCrystalBallPanel` is automatically grounded in: current PCI level, top hypothesis + forecast, active analog matches, hot entities. No user action needed.

2. **"Project this forward" button** — hypothesis card header gets a `→` button. Click opens `AskCrystalBallPanel` pre-seeded with a structured projection prompt for that hypothesis, asking Claude to reason about probability intervals, scenario branches, and what would change the forecast.

### Architecture

**New service: `src/services/analyst-context-builder.ts`**

```typescript
export function buildAnalystContext(): string

```

Pure function. Assembles a ~500-token system context string from:

- PCI level + index from `getLatestPCI()` (new export from `predictive-crisis-index.ts`)
- Top 3 hypotheses from `getAnalystSnapshot()` with their forecast probabilities from `getLatestForecasts()`
- Active analog match names from the analog monitor's last emission
- Hot entities from `getHotEntities()` (already exported from `hypothesis-entities.ts`)
- Current posture advisory from `getModeForecastSnapshot()` (already exported from `mode-forecast.ts`)

Format: a concise bullet list the LLM can use as a factual prior.

**`AskCrystalBallPanel.ts` changes:**

- Before every `sendMessage()` call, prepend `buildAnalystContext()` as a system context block
- Listen for `cb:project-hypothesis` — when received, open the panel (if not already open) and populate the input field with the projection prompt, then auto-send

**Projection prompt builder:**

```typescript
function buildProjectionPrompt(h: Hypothesis, forecast: HypothesisForecast, analogs: AnalogMatch[]): string

```

Produces: *"Analyze this intelligence situation: [statement]. Current forecast: [probability]% probability of escalation in [horizon] days, trend [trend]. Closest historical analog: [analog name] ([score]% similarity). Provide: (1) your probability estimate with confidence interval, (2) the 3 primary drivers, (3) base/upside/downside scenario branches, (4) what signals would change this forecast."*

**`AnalystHUD.ts` changes:**

- Add `→` button to hypothesis card header (right of the `⚡` challenge button)
- `onclick`: collect hypothesis + its forecast + analog matches, dispatch `cb:project-hypothesis`
- Suppressed when Ghost Mode is active

**`predictive-crisis-index.ts`:**

- Add `getLatestPCI(): PCIScore | null` export (reads from module-level cache set by `startPredictiveCrisisIndex()`)

### Files Changed

| File | Change |
|---|---|
| `src/services/analyst-context-builder.ts` | New — ~80 lines |
| `src/services/predictive-crisis-index.ts` | Add `getLatestPCI()` export |
| `src/components/AskCrystalBallPanel.ts` | Inject context on send, handle `cb:project-hypothesis` |
| `src/components/AnalystHUD.ts` | Add `→` Project button to hypothesis header |

### Tests

- `buildAnalystContext()` includes PCI level text when PCI is available
- `buildAnalystContext()` degrades gracefully to empty string when no snapshot exists
- `buildProjectionPrompt()` includes hypothesis statement, probability, and horizon
- `AskCrystalBallPanel`: receiving `cb:project-hypothesis` populates and sends the projection prompt

---

## PR 4 — Self-Improvement Visibility

### What

The outcome grading loop (`startOutcomeGradingCadence`) and tuning loop (`startTuningApplyCadence`) run invisibly. This PR surfaces their output:

1. **Prediction Accuracy tab** in `AlgorithmDiagnosticPanel` — per-kind hit rate, trend, tuning status
2. **Outcome reporting** on hypothesis cards — ✓ / ✗ controls on resolved hypotheses
3. **Accuracy sparkline** in HUD footer — 7-day rolling accuracy across all hypothesis kinds

### Architecture

**`AlgorithmDiagnosticPanel.ts` — new "Prediction Accuracy" tab:**

Reads from `getAlgoEvalLedger()` (already exported from `algo-eval-ledger.ts`). For each hypothesis kind with ≥3 graded outcomes, renders:

- Kind label + sample count
- Hit rate bar (green/amber/red thresholds: >70% / 50–70% / <50%)
- Weighted hit rate (recency-weighted)
- Trend arrow (comparing last 7 vs prior 7 outcomes)
- Tuning status chip: `auto-applied` / `at_bound` / `manual_review` / `no_tunable`

Auto-refreshes every 30s.

**Outcome reporting in `AnalystHUD.ts`:**

When a hypothesis is dismissed via the existing dismiss flow, show a one-time inline prompt: *"Was this correct? [✓ Yes] [✗ No] [Skip]"*. Clicking Yes/No calls `recordOutcome(h, correct)` from `hypothesis-accuracy.ts` (already exported). Skip dismisses without recording.

The prompt only appears for hypotheses that have been live for ≥2 analyst cycles (tracked via `hypothesis-threads.ts` `cycleCount`).

**Accuracy sparkline in HUD footer:**

`buildAccuracySparkline(): SVGSVGElement | null` — reuses `buildSparklinePath()` helper (already in `AnalystHUD.ts`). Reads the last 14 accuracy data points from `getAlgoEvalLedger()`. Width 80px, height 10px. Rendered in the HUD footer next to the existing error counter. Suppressed when Ghost Mode is active or fewer than 3 data points exist.

### Files Changed

| File | Change |
|---|---|
| `src/components/AlgorithmDiagnosticPanel.ts` | Add Prediction Accuracy tab |
| `src/components/AnalystHUD.ts` | Outcome reporting prompt on dismiss, accuracy sparkline in footer |

### Tests

- `AlgorithmDiagnosticPanel`: Prediction Accuracy tab renders per-kind rows when ledger has ≥3 samples
- `AnalystHUD`: outcome prompt appears only for hypotheses with `cycleCount ≥ 2`
- `AnalystHUD`: `buildAccuracySparkline()` returns null when fewer than 3 data points

---

## Execution Order

| PR | Branch | Estimated scope |
|----|--------|-----------------|
| PR 1 | `claude/wire-prediction-engines` | ~80 lines changed |
| PR 2 | `claude/autonomous-forecast-scores` | ~120 lines new |
| PR 3 | `claude/claude-as-analyst` | ~200 lines new |
| PR 4 | `claude/self-improvement-visibility` | ~150 lines changed |

PRs 1 → 2 → 3 are in dependency order (each builds on the previous). PR 4 has no dependency on PR 3 and can be worked in parallel if desired.

---

## Data Flow Summary

```

Analyst Loop (5-min cadence)
    ↓ cb:analyst-hypotheses
    ├── predictive-crisis-index  →  cb:pci-updated
    ├── crisis-trajectory        →  cb:crisis-trajectory  →  CrisisTrajectoryPanel
    ├── active-learning-queue    →  ActiveLearningQueuePanel
    ├── analog-monitor           →  cb:analog-match        →  HUD analog cards
    └── hypothesis-forecast      ←  (all above)
            ↓ cb:hypothesis-forecasts
            └── AnalystHUD (forecast bars)

User clicks "→" on hypothesis
    ↓ cb:project-hypothesis
    └── AskCrystalBallPanel (context-injected projection prompt → Claude)

Hypothesis dismissed
    ↓ recordOutcome()
    └── AlgoEvalLedger → tuning-apply-runner (existing cadence)
            ↓
            AlgorithmDiagnosticPanel (Prediction Accuracy tab)
            AnalystHUD footer (accuracy sparkline)

```
