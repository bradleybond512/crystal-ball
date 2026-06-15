# Storm Posture Engine Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the testable, pure-deterministic engine core of the Grand-Strategy Survival OS vertical slice (E1): a local-first World Snapshot that projects severe-weather alerts into a multi-axis Survival Posture, offers survival Moves with modeled effects, and lets a committed plan visibly improve posture — the full game loop, minus UI.

**Architecture:** Six new pure modules under `src/services/survival/`, mirroring the established `src/services/datacenter/` idiom (level-ladder helpers, `drivers[]`/`staleInputs[]`, `ConfidenceBreakdown` + `AlgorithmExplanation` on every score). The threat projection reuses `matchAlertToPlace` + `buildStormModePayload`; moves reuse `actionsForHazard`. Everything is input→output pure (no DOM, no fetch, no globals) and fixture-tested with `tsx --test`.

**Tech Stack:** TypeScript (strict), `node:test` + `node:assert/strict` run via `tsx`, ESM imports with explicit `.ts` extensions (datacenter convention).

---

## Scope (read before starting)

This plan is the **engine core** of spec Part III ([2026-06-14-grand-strategy-survival-os-design.md](../specs/2026-06-14-grand-strategy-survival-os-design.md)). Two pieces of E1 are **deliberately deferred to a follow-up plan**, with rationale so this is not a hidden gap:

1. **`StormPosturePanel.ts` (UI) + the God's Vision board overlay (Layer 2).** DOM-heavy, not unit-test-friendly, and the spec already scoped the board "modest." The engine here exposes a pure `projectView()` the panel will render.
2. **`snapshot-store.ts` IDB adapter + the `MissionRecord`-based replay-harness fixture.** The grid-down guarantee is proven *at the engine level* by a serialize → deserialize → re-project round-trip test (no live inputs needed). Physical IDB persistence and the `MissionRecord` replay bridge belong with the UI wiring and the E7 closed-loop epic respectively — coupling the posture engine to the mission abstraction now would be premature.

What ships here is independently valuable and fully tested: the snapshot spine, posture model, threat projection, move model, and the commit→improve loop — the reusable template every later domain copies.

## Invariants (honor in every module — from CLAUDE.md)

- Pure: no DOM, no `fetch`, no globals, no `Date.now()` inside logic — callers pass `now`.
- Every axis score carries a `ConfidenceBreakdown` **and** an `AlgorithmExplanation`.
- Stale inputs are surfaced in `staleInputs[]`, never silently dropped.
- Deterministic: same inputs → same output; fixtures only, no live fetch in tests.

## File Structure

All new, under `src/services/survival/`:

| File | Responsibility | Depends on |
|---|---|---|
| `survival-types.ts` | Shared contract: axes, band ladder + helpers, `PostureThreat`, `AxisState`, `SurvivalMove`, `PostureDelta`, `SurvivalPlan`, `SurvivalPosture`, `WorldSnapshot`; pure helpers (`bandForLevel`, `threatLevelToSeverity`, `axisLabel`). | weather + intelligence types only |
| `threat-projection.ts` | `projectWeatherThreats(alerts, places, {now})` → `PostureThreat[]`. | `nws-polygon-match`, `personal-storm-mode`, types |
| `survival-posture.ts` | `computePosture(input, {now})` → `SurvivalPosture`. physical_safety from threats; other 7 axes flat-secure. | `threat-projection`, types |
| `survival-moves.ts` | `availableMoves(posture, snapshot, {now})` + `projectMoveEffect(move, posture)`. | `preparedness-actions`, `weather-threat-types`, types |
| `survival-plan.ts` | `emptyPlan`, `commitMove`, `moveStatus`, `applyPlanToPosture` (the loop). | types |
| `world-snapshot.ts` | `buildSnapshot`, `serializeSnapshot`, `deserializeSnapshot`, `projectView` (grid-down projection). | `survival-plan`, `survival-posture`, types |

Tests live in `src/services/survival/__tests__/<name>.test.mts`.

---

## Task 1: Shared contract — `survival-types.ts`

**Files:**

- Create: `src/services/survival/survival-types.ts`
- Test: `src/services/survival/__tests__/survival-types.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/survival/__tests__/survival-types.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVIVAL_AXES,
  bandForLevel,
  threatLevelToSeverity,
  axisLabel,
} from '../survival-types.ts';

test('there are 8 survival axes including physical_safety', () => {
  assert.equal(SURVIVAL_AXES.length, 8);
  assert.ok(SURVIVAL_AXES.includes('physical_safety'));
});

test('bandForLevel maps numeric level to the 5-band ladder', () => {
  assert.equal(bandForLevel(0), 'secure');
  assert.equal(bandForLevel(19), 'secure');
  assert.equal(bandForLevel(20), 'guarded');
  assert.equal(bandForLevel(40), 'elevated');
  assert.equal(bandForLevel(60), 'high');
  assert.equal(bandForLevel(80), 'critical');
  assert.equal(bandForLevel(100), 'critical');
});

test('threatLevelToSeverity escalates monotonically', () => {
  assert.equal(threatLevelToSeverity('none'), 0);
  assert.ok(threatLevelToSeverity('watch') < threatLevelToSeverity('warning'));
  assert.equal(threatLevelToSeverity('emergency'), 95);
});

test('axisLabel returns a human label', () => {
  assert.equal(axisLabel('physical_safety'), 'Physical safety');
  assert.equal(axisLabel('energy_water'), 'Energy & water');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival/__tests__/survival-types.test.mts`
Expected: FAIL — `Cannot find module '../survival-types.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/survival/survival-types.ts
import type { ThreatLevel, WeatherHazardKind, NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import type { ConfidenceBreakdown, AlgorithmExplanation } from '../intelligence/types.ts';

// ── Axes ──────────────────────────────────────────────────────────────────
export type SurvivalAxis =
  | 'physical_safety' | 'supply' | 'financial' | 'mobility'
  | 'comms' | 'health' | 'energy_water' | 'security';

export const SURVIVAL_AXES: readonly SurvivalAxis[] = [
  'physical_safety', 'supply', 'financial', 'mobility',
  'comms', 'health', 'energy_water', 'security',
];

const AXIS_LABELS: Record<SurvivalAxis, string> = {
  physical_safety: 'Physical safety',
  supply: 'Supply',
  financial: 'Financial',
  mobility: 'Mobility',
  comms: 'Comms',
  health: 'Health',
  energy_water: 'Energy & water',
  security: 'Security',
};

export function axisLabel(axis: SurvivalAxis): string {
  return AXIS_LABELS[axis];
}

// ── Band ladder ─────────────────────────────────────────────────────────────
export type SurvivalBand = 'secure' | 'guarded' | 'elevated' | 'high' | 'critical';
const BAND_ORDER: readonly SurvivalBand[] = ['secure', 'guarded', 'elevated', 'high', 'critical'];

export function bandRank(b: SurvivalBand): number {
  return BAND_ORDER.indexOf(b);
}

export function bandForLevel(level: number): SurvivalBand {
  if (level >= 80) return 'critical';
  if (level >= 60) return 'high';
  if (level >= 40) return 'elevated';
  if (level >= 20) return 'guarded';
  return 'secure';
}

export function threatLevelToSeverity(level: ThreatLevel): number {
  switch (level) {
    case 'none': return 0;
    case 'watch': return 30;
    case 'advisory': return 50;
    case 'warning': return 75;
    case 'emergency': return 95;
  }
}

// ── Posture data ────────────────────────────────────────────────────────────
export interface PostureThreat {
  /** Alert id this threat came from. */
  sourceEventId: string;
  axis: SurvivalAxis;
  /** 0–100, higher = more threatened. */
  severity: number;
  threatLevel: ThreatLevel;
  hazardKind: WeatherHazardKind;
  /** NWS event string, e.g. "Tornado Warning". */
  hazardLabel: string;
  /** Minutes until earliest plausible impact; null if unknown. */
  timeToImpactMins: number | null;
  /** Pre-formatted arrival label ("35-55 min") or null. */
  arrivalLabel: string | null;
  /** Plain-language reason from the matcher. */
  why: string;
  confidenceLabel: 'low' | 'medium' | 'high';
}

export interface AxisState {
  axis: SurvivalAxis;
  /** 0–100, higher = worse. */
  level: number;
  band: SurvivalBand;
  trend: 'improving' | 'steady' | 'worsening';
  threats: PostureThreat[];
  confidence: ConfidenceBreakdown;
  explanation: AlgorithmExplanation;
  drivers: string[];
}

export type MoveCost = 'free' | 'low' | 'medium' | 'high';

export interface PostureDelta {
  axis: SurvivalAxis;
  /** Signed change to axis level. Negative = improves posture. */
  deltaLevel: number;
  rationale: string;
}

export interface SurvivalMove {
  id: string;
  label: string;
  detail: string;
  affects: SurvivalAxis[];
  cost: MoveCost;
  leadTimeMins: number;
  /** Why this move is being offered. */
  trigger: string;
  /** Modeled effect on posture if committed. */
  effect: PostureDelta[];
  /** Pointer to the source preparedness action id. */
  playbookRef?: string;
}

export interface CommittedMove {
  moveId: string;
  committedAtMs: number;
  status: 'planned' | 'in_progress' | 'done' | 'skipped';
}

export interface SurvivalPlan {
  committed: CommittedMove[];
}

export interface SurvivalPosture {
  axes: AxisState[];
  overallLevel: number;
  overallBand: SurvivalBand;
  worstAxis: SurvivalAxis;
  headline: string;
  capturedAtMs: number;
  staleInputs: string[];
}

// ── Snapshot (the save file) ──────────────────────────────────────────────
export type SnapshotDomain = 'weather';

export interface DomainFreshness {
  domain: SnapshotDomain;
  fetchedAtMs: number;
  ageMs: number;
  ok: boolean;
}

export interface WorldSnapshot {
  version: number;
  capturedAtMs: number;
  freshness: DomainFreshness[];
  weatherAlerts: NwsAlertMinimal[];
  savedPlaces: SavedPlace[];
  posture: SurvivalPosture;
  plan: SurvivalPlan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival/__tests__/survival-types.test.mts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/survival-types.ts src/services/survival/__tests__/survival-types.test.mts
git commit -m "feat(survival): shared posture/snapshot contract + band helpers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Threat projection — `threat-projection.ts`

**Files:**

- Create: `src/services/survival/threat-projection.ts`
- Test: `src/services/survival/__tests__/threat-projection.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/survival/__tests__/threat-projection.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectWeatherThreats } from '../threat-projection.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function alert(event: string, polygon: AlertPolygon | undefined): NwsAlertMinimal {
  return { id: `al-${event}`, event, polygon, sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}

test('no alerts -> no threats', () => {
  assert.deepEqual(projectWeatherThreats([], [HOME], { now: NOW }), []);
});

test('tornado warning over home -> a physical_safety threat', () => {
  const threats = projectWeatherThreats([alert('Tornado Warning', around(HOME.lat, HOME.lon))], [HOME], { now: NOW });
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.axis, 'physical_safety');
  assert.equal(threats[0]!.hazardKind, 'tornado');
  assert.equal(threats[0]!.threatLevel, 'emergency');
  assert.ok(threats[0]!.severity >= 75);
  assert.equal(threats[0]!.sourceEventId, 'al-Tornado Warning');
});

test('alert far from home -> no threat', () => {
  const threats = projectWeatherThreats([alert('Tornado Warning', around(10, 10))], [HOME], { now: NOW });
  assert.deepEqual(threats, []);
});

test('threats are sorted strongest first', () => {
  const threats = projectWeatherThreats(
    [alert('Flood Watch', around(HOME.lat, HOME.lon)), alert('Tornado Warning', around(HOME.lat, HOME.lon))],
    [HOME],
    { now: NOW },
  );
  assert.ok(threats.length >= 2);
  assert.ok(threats[0]!.severity >= threats[1]!.severity);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival/__tests__/threat-projection.test.mts`
Expected: FAIL — `Cannot find module '../threat-projection.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/survival/threat-projection.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import { matchAlertToPlace } from '../weather/nws-polygon-match.ts';
import { buildStormModePayload } from '../weather/personal-storm-mode.ts';
import type { PostureThreat } from './survival-types.ts';
import { threatLevelToSeverity } from './survival-types.ts';

export interface ThreatProjectionOptions {
  now?: number;
}

/** Project NWS alerts near saved places into physical-safety posture threats. */
export function projectWeatherThreats(
  alerts: readonly NwsAlertMinimal[],
  places: readonly SavedPlace[],
  options: ThreatProjectionOptions = {},
): PostureThreat[] {
  const now = options.now ?? Date.now();
  const threats: PostureThreat[] = [];

  for (const place of places) {
    for (const alert of alerts) {
      const match = matchAlertToPlace(alert, place, { now });
      if (match.matchKind === 'no_match' || match.isCancellation || match.threatLevel === 'none') continue;

      const payload = buildStormModePayload(match, place.label, { now });
      const timeToImpactMins = payload.arrivalWindow
        ? Math.max(0, Math.round((payload.arrivalWindow.earliestMs - now) / 60_000))
        : null;

      threats.push({
        sourceEventId: alert.id,
        axis: 'physical_safety',
        severity: threatLevelToSeverity(match.threatLevel),
        threatLevel: match.threatLevel,
        hazardKind: match.hazardKind,
        hazardLabel: match.event,
        timeToImpactMins,
        arrivalLabel: payload.arrivalWindow?.label ?? null,
        why: match.reason,
        confidenceLabel: payload.confidenceLabel,
      });
    }
  }

  return threats.sort((a, b) => b.severity - a.severity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival/__tests__/threat-projection.test.mts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/threat-projection.ts src/services/survival/__tests__/threat-projection.test.mts
git commit -m "feat(survival): project NWS alerts into physical-safety threats

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Posture engine — `survival-posture.ts`

**Files:**

- Create: `src/services/survival/survival-posture.ts`
- Test: `src/services/survival/__tests__/survival-posture.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/survival/__tests__/survival-posture.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosture } from '../survival-posture.ts';
import type { PostureInput } from '../survival-posture.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function alert(event: string, polygon: AlertPolygon): NwsAlertMinimal {
  return { id: `al-${event}`, event, polygon, sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}
function input(alerts: NwsAlertMinimal[], ok = true): PostureInput {
  return {
    weatherAlerts: alerts,
    savedPlaces: [HOME],
    freshness: [{ domain: 'weather', fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok }],
    capturedAtMs: NOW,
  };
}

test('quiet world -> all 8 axes secure, overall secure', () => {
  const p = computePosture(input([]), { now: NOW });
  assert.equal(p.axes.length, 8);
  assert.ok(p.axes.every((a) => a.band === 'secure'));
  assert.equal(p.overallBand, 'secure');
});

test('tornado over home -> physical_safety critical, others still secure', () => {
  const p = computePosture(input([alert('Tornado Warning', around(HOME.lat, HOME.lon))]), { now: NOW });
  const phys = p.axes.find((a) => a.axis === 'physical_safety')!;
  assert.equal(phys.band, 'critical');
  assert.equal(phys.threats.length, 1);
  assert.equal(p.worstAxis, 'physical_safety');
  assert.equal(p.overallBand, 'critical');
  const supply = p.axes.find((a) => a.axis === 'supply')!;
  assert.equal(supply.band, 'secure');
});

test('every axis carries a confidence breakdown and explanation', () => {
  const p = computePosture(input([alert('Tornado Warning', around(HOME.lat, HOME.lon))]), { now: NOW });
  for (const a of p.axes) {
    assert.equal(a.confidence.max, 100);
    assert.ok(a.confidence.items.length >= 1);
    assert.ok(typeof a.explanation.headline === 'string');
  }
});

test('a stale weather feed is surfaced, never dropped', () => {
  const p = computePosture(input([alert('Tornado Warning', around(HOME.lat, HOME.lon))], false), { now: NOW });
  assert.ok(p.staleInputs.some((s) => s.includes('weather')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival/__tests__/survival-posture.test.mts`
Expected: FAIL — `Cannot find module '../survival-posture.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/survival/survival-posture.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import type { ConfidenceBreakdown, AlgorithmExplanation } from '../intelligence/types.ts';
import type {
  AxisState, DomainFreshness, PostureThreat, SurvivalAxis, SurvivalPosture,
} from './survival-types.ts';
import { SURVIVAL_AXES, axisLabel, bandForLevel } from './survival-types.ts';
import { projectWeatherThreats } from './threat-projection.ts';

/** Structural subset of WorldSnapshot that posture computation needs.
 *  A full WorldSnapshot satisfies this. */
export interface PostureInput {
  weatherAlerts: readonly NwsAlertMinimal[];
  savedPlaces: readonly SavedPlace[];
  freshness: readonly DomainFreshness[];
  capturedAtMs: number;
}

export interface PostureOptions {
  now?: number;
}

export function computePosture(inputData: PostureInput, options: PostureOptions = {}): SurvivalPosture {
  const now = options.now ?? inputData.capturedAtMs;
  const threats = projectWeatherThreats(inputData.weatherAlerts, inputData.savedPlaces, { now });

  const byAxis = new Map<SurvivalAxis, PostureThreat[]>();
  for (const t of threats) {
    const arr = byAxis.get(t.axis) ?? [];
    arr.push(t);
    byAxis.set(t.axis, arr);
  }

  const staleInputs = inputData.freshness
    .filter((f) => !f.ok)
    .map((f) => `${f.domain} feed stale (${Math.round(f.ageMs / 60_000)} min old)`);

  const axes = SURVIVAL_AXES.map((axis) => buildAxisState(axis, byAxis.get(axis) ?? [], staleInputs));
  const worst = axes.reduce((w, a) => (a.level > w.level ? a : w), axes[0]!);

  return {
    axes,
    overallLevel: worst.level,
    overallBand: bandForLevel(worst.level),
    worstAxis: worst.axis,
    headline: buildHeadline(worst),
    capturedAtMs: now,
    staleInputs,
  };
}

function buildAxisState(axis: SurvivalAxis, threats: PostureThreat[], staleInputs: string[]): AxisState {
  const level = threats.reduce((m, t) => Math.max(m, t.severity), 0);
  const band = bandForLevel(level);
  const drivers = threats.map((t) => `${t.hazardLabel} — ${t.why}`);

  const confidence: ConfidenceBreakdown = {
    total: level,
    max: 100,
    items: threats.length
      ? threats.map((t) => ({ label: t.hazardLabel, value: t.severity, max: 100, polarity: 'negative' as const }))
      : [{ label: 'No active threats', value: 0, max: 100, polarity: 'positive' as const }],
  };

  const explanation: AlgorithmExplanation = {
    headline: threats.length ? `${axisLabel(axis)}: ${band}` : `${axisLabel(axis)}: secure`,
    lines: threats.map((t) => ({
      text: `${t.hazardLabel} (${t.why})`,
      polarity: 'negative' as const,
      weight: t.severity,
    })),
    missingConfirmation: staleInputs,
  };

  return { axis, level, band, trend: 'steady', threats, confidence, explanation, drivers };
}

function buildHeadline(worst: AxisState): string {
  if (worst.level === 0) return 'All clear — survival posture secure across all domains.';
  return `${axisLabel(worst.axis)} at ${worst.band} — ${worst.drivers[0] ?? 'active threat'}.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival/__tests__/survival-posture.test.mts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/survival-posture.ts src/services/survival/__tests__/survival-posture.test.mts
git commit -m "feat(survival): multi-axis posture engine with explanations

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Moves + effect modeling — `survival-moves.ts`

**Files:**

- Create: `src/services/survival/survival-moves.ts`
- Test: `src/services/survival/__tests__/survival-moves.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/survival/__tests__/survival-moves.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableMoves, projectMoveEffect } from '../survival-moves.ts';
import { computePosture } from '../survival-posture.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';
import type { WorldSnapshot } from '../survival-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function tornadoSnapshot(): WorldSnapshot {
  const alerts: NwsAlertMinimal[] = [{ id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() }];
  const freshness = [{ domain: 'weather' as const, fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok: true }];
  const posture = computePosture({ weatherAlerts: alerts, savedPlaces: [HOME], freshness, capturedAtMs: NOW }, { now: NOW });
  return { version: 1, capturedAtMs: NOW, freshness, weatherAlerts: alerts, savedPlaces: [HOME], posture, plan: { committed: [] } };
}

test('no threats -> no moves', () => {
  const snap = tornadoSnapshot();
  const calm = { ...snap, posture: { ...snap.posture, axes: snap.posture.axes.map((a) => ({ ...a, threats: [], level: 0, band: 'secure' as const })) } };
  assert.deepEqual(availableMoves(calm.posture, calm, { now: NOW }), []);
});

test('tornado threat -> moves that affect physical_safety with negative (improving) effect', () => {
  const snap = tornadoSnapshot();
  const moves = availableMoves(snap.posture, snap, { now: NOW });
  assert.ok(moves.length >= 1);
  assert.ok(moves.every((m) => m.affects.includes('physical_safety')));
  const top = moves[0]!;
  const effect = projectMoveEffect(top, snap.posture);
  assert.ok(effect.some((d) => d.axis === 'physical_safety' && d.deltaLevel < 0));
  assert.ok(top.playbookRef);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival/__tests__/survival-moves.test.mts`
Expected: FAIL — `Cannot find module '../survival-moves.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/survival/survival-moves.ts
import { actionsForHazard } from '../weather/preparedness-actions.ts';
import type {
  MoveCost, PostureDelta, SurvivalAxis, SurvivalMove, SurvivalPosture, WorldSnapshot,
} from './survival-types.ts';

export interface MovesOptions {
  now?: number;
  maxMoves?: number;
}

/** Map preparedness priority (1 = critical) to a modeled posture reduction. */
function reductionForPriority(priority: number): number {
  if (priority <= 1) return 25;
  if (priority === 2) return 15;
  if (priority === 3) return 10;
  return 5;
}

function costForMinutes(mins: number): MoveCost {
  if (mins <= 1) return 'free';
  if (mins <= 5) return 'low';
  if (mins <= 15) return 'medium';
  return 'high';
}

export function availableMoves(
  posture: SurvivalPosture,
  _snapshot: WorldSnapshot,
  options: MovesOptions = {},
): SurvivalMove[] {
  const max = options.maxMoves ?? 6;
  const physical = posture.axes.find((a) => a.axis === 'physical_safety');
  if (!physical || physical.threats.length === 0) return [];

  const top = physical.threats[0]!;
  const actions = actionsForHazard(top.hazardKind, { max });

  return actions.map((a) => {
    const effect: PostureDelta[] = [{
      axis: 'physical_safety',
      deltaLevel: -reductionForPriority(a.priority),
      rationale: `${a.label} reduces exposure to ${top.hazardLabel}`,
    }];
    return {
      id: `move-${a.id}`,
      label: a.label,
      detail: a.rationale ?? a.label,
      affects: ['physical_safety'] as SurvivalAxis[],
      cost: costForMinutes(a.estimatedMinutes),
      leadTimeMins: a.estimatedMinutes,
      trigger: `${top.hazardLabel} threatening ${physical.axis}`,
      effect,
      playbookRef: a.id,
    };
  });
}

export function projectMoveEffect(move: SurvivalMove, _posture: SurvivalPosture): PostureDelta[] {
  return move.effect;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival/__tests__/survival-moves.test.mts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/survival-moves.ts src/services/survival/__tests__/survival-moves.test.mts
git commit -m "feat(survival): hazard-aware moves with modeled posture effects

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Plan + the commit→improve loop — `survival-plan.ts`

**Files:**

- Create: `src/services/survival/survival-plan.ts`
- Test: `src/services/survival/__tests__/survival-plan.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/survival/__tests__/survival-plan.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, commitMove, moveStatus, applyPlanToPosture } from '../survival-plan.ts';
import type { SurvivalMove, SurvivalPosture, AxisState } from '../survival-types.ts';

const NOW = 1_700_000_000_000;

function axis(over: Partial<AxisState> & { axis: AxisState['axis'] }): AxisState {
  return {
    axis: over.axis, level: over.level ?? 0, band: over.band ?? 'secure', trend: over.trend ?? 'steady',
    threats: over.threats ?? [], drivers: over.drivers ?? [],
    confidence: over.confidence ?? { total: over.level ?? 0, max: 100, items: [] },
    explanation: over.explanation ?? { headline: '', lines: [], missingConfirmation: [] },
  };
}
function postureWithPhysical(level: number): SurvivalPosture {
  const phys = axis({ axis: 'physical_safety', level, band: level >= 80 ? 'critical' : 'secure' });
  return { axes: [phys], overallLevel: level, overallBand: phys.band, worstAxis: 'physical_safety', headline: '', capturedAtMs: NOW, staleInputs: [] };
}
const SHELTER: SurvivalMove = {
  id: 'move-shelter', label: 'Shelter', detail: '', affects: ['physical_safety'], cost: 'free', leadTimeMins: 1,
  trigger: '', effect: [{ axis: 'physical_safety', deltaLevel: -30, rationale: 'shelter' }],
};

test('emptyPlan has no committed moves', () => {
  assert.deepEqual(emptyPlan().committed, []);
});

test('commitMove records a planned move; moveStatus reflects it; double-commit is idempotent', () => {
  const p1 = commitMove(emptyPlan(), SHELTER, NOW);
  assert.equal(p1.committed.length, 1);
  assert.equal(moveStatus(p1, 'move-shelter'), 'planned');
  assert.equal(moveStatus(p1, 'nope'), 'none');
  const p2 = commitMove(p1, SHELTER, NOW);
  assert.equal(p2.committed.length, 1);
});

test('applyPlanToPosture lowers the affected axis level and marks it improving', () => {
  const posture = postureWithPhysical(90);
  const plan = commitMove(emptyPlan(), SHELTER, NOW);
  const improved = applyPlanToPosture(posture, plan, [SHELTER]);
  const phys = improved.axes.find((a) => a.axis === 'physical_safety')!;
  assert.equal(phys.level, 60);
  assert.equal(phys.trend, 'improving');
  assert.equal(improved.overallLevel, 60);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival/__tests__/survival-plan.test.mts`
Expected: FAIL — `Cannot find module '../survival-plan.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/survival/survival-plan.ts
import type {
  AxisState, CommittedMove, SurvivalAxis, SurvivalMove, SurvivalPlan, SurvivalPosture,
} from './survival-types.ts';
import { bandForLevel } from './survival-types.ts';

export function emptyPlan(): SurvivalPlan {
  return { committed: [] };
}

export function commitMove(plan: SurvivalPlan, move: SurvivalMove, now: number): SurvivalPlan {
  if (plan.committed.some((c) => c.moveId === move.id)) return plan;
  return { committed: [...plan.committed, { moveId: move.id, committedAtMs: now, status: 'planned' }] };
}

export function moveStatus(plan: SurvivalPlan, moveId: string): CommittedMove['status'] | 'none' {
  return plan.committed.find((c) => c.moveId === moveId)?.status ?? 'none';
}

/** Re-project posture with committed move effects applied. This closes the
 *  loop: world threatens → you commit moves → posture responds. */
export function applyPlanToPosture(
  posture: SurvivalPosture,
  plan: SurvivalPlan,
  moves: readonly SurvivalMove[],
): SurvivalPosture {
  const deltaByAxis = new Map<SurvivalAxis, number>();
  for (const c of plan.committed) {
    const move = moves.find((m) => m.id === c.moveId);
    if (!move) continue;
    for (const d of move.effect) {
      deltaByAxis.set(d.axis, (deltaByAxis.get(d.axis) ?? 0) + d.deltaLevel);
    }
  }

  const axes: AxisState[] = posture.axes.map((a) => {
    const delta = deltaByAxis.get(a.axis) ?? 0;
    if (delta === 0) return a;
    const level = Math.max(0, Math.min(100, a.level + delta));
    return {
      ...a,
      level,
      band: bandForLevel(level),
      trend: level < a.level ? 'improving' : a.trend,
      drivers: [...a.drivers, `Planned moves change exposure by ${delta}`],
    };
  });

  const worst = axes.reduce((w, a) => (a.level > w.level ? a : w), axes[0]!);
  return {
    ...posture,
    axes,
    overallLevel: worst.level,
    overallBand: bandForLevel(worst.level),
    worstAxis: worst.axis,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival/__tests__/survival-plan.test.mts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/survival-plan.ts src/services/survival/__tests__/survival-plan.test.mts
git commit -m "feat(survival): plan commit + apply-to-posture loop

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Snapshot spine + grid-down projection — `world-snapshot.ts`

**Files:**

- Create: `src/services/survival/world-snapshot.ts`
- Test: `src/services/survival/__tests__/world-snapshot.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/survival/__tests__/world-snapshot.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, serializeSnapshot, deserializeSnapshot, projectView, SNAPSHOT_VERSION } from '../world-snapshot.ts';
import { computePosture } from '../survival-posture.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
const ALERTS: NwsAlertMinimal[] = [{ id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() }];

test('buildSnapshot computes posture and stamps version + freshness', () => {
  const snap = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.posture.worstAxis, 'physical_safety');
  assert.equal(snap.posture.overallBand, 'critical');
  assert.equal(snap.freshness[0]!.ok, true);
});

test('GRID-DOWN: serialize -> deserialize -> project yields full posture with no live inputs', () => {
  const online = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  const bytes = serializeSnapshot(online);
  // Simulate cold start hours later with NO network: only the bytes survive.
  const offline = deserializeSnapshot(bytes);
  const view = projectView(offline, { now: NOW + 3 * 3_600_000 });
  assert.equal(view.posture.overallBand, 'critical');
  assert.equal(view.posture.worstAxis, 'physical_safety');
  assert.equal(view.isStale, true); // 3h old > 15min threshold
  assert.ok(view.weatherAgeMs >= 3 * 3_600_000);
});

test('recomputing posture from the deserialized snapshot equals the stored posture', () => {
  const online = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  const offline = deserializeSnapshot(serializeSnapshot(online));
  const recomputed = computePosture(offline, { now: NOW });
  assert.equal(recomputed.overallLevel, online.posture.overallLevel);
  assert.equal(recomputed.worstAxis, online.posture.worstAxis);
});

test('deserialize rejects an unknown version', () => {
  assert.throws(() => deserializeSnapshot(JSON.stringify({ version: 999 })), /Unsupported snapshot version/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival/__tests__/world-snapshot.test.mts`
Expected: FAIL — `Cannot find module '../world-snapshot.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/survival/world-snapshot.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import type { DomainFreshness, SurvivalPlan, SurvivalPosture, WorldSnapshot } from './survival-types.ts';
import { emptyPlan } from './survival-plan.ts';
import { computePosture } from './survival-posture.ts';

export const SNAPSHOT_VERSION = 1;
const DEFAULT_STALE_AFTER_MS = 15 * 60_000;

export interface SnapshotInputs {
  weatherAlerts: readonly NwsAlertMinimal[];
  savedPlaces: readonly SavedPlace[];
  weatherFetchedAtMs: number;
  plan?: SurvivalPlan;
}

export interface SnapshotOptions {
  now?: number;
  staleAfterMs?: number;
}

export function buildSnapshot(inputs: SnapshotInputs, options: SnapshotOptions = {}): WorldSnapshot {
  const now = options.now ?? Date.now();
  const staleAfter = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const ageMs = now - inputs.weatherFetchedAtMs;
  const freshness: DomainFreshness[] = [{
    domain: 'weather',
    fetchedAtMs: inputs.weatherFetchedAtMs,
    ageMs,
    ok: ageMs <= staleAfter,
  }];

  const weatherAlerts = [...inputs.weatherAlerts];
  const savedPlaces = [...inputs.savedPlaces];
  const posture: SurvivalPosture = computePosture({ weatherAlerts, savedPlaces, freshness, capturedAtMs: now }, { now });

  return {
    version: SNAPSHOT_VERSION,
    capturedAtMs: now,
    freshness,
    weatherAlerts,
    savedPlaces,
    posture,
    plan: inputs.plan ?? emptyPlan(),
  };
}

export function serializeSnapshot(snapshot: WorldSnapshot): string {
  return JSON.stringify(snapshot);
}

export function deserializeSnapshot(json: string): WorldSnapshot {
  const parsed = JSON.parse(json) as WorldSnapshot;
  if (parsed.version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version ${parsed.version}`);
  }
  return parsed;
}

export interface StormPostureView {
  posture: SurvivalPosture;
  weatherAgeMs: number;
  isStale: boolean;
  worstAxisLabel: string;
}

/** Project a (possibly offline / stale) snapshot into the view the UI renders.
 *  Needs no live inputs — this is the grid-down guarantee. */
export function projectView(snapshot: WorldSnapshot, options: { now?: number } = {}): StormPostureView {
  const now = options.now ?? snapshot.capturedAtMs;
  const weather = snapshot.freshness.find((f) => f.domain === 'weather');
  const weatherAgeMs = weather ? now - weather.fetchedAtMs : 0;
  return {
    posture: snapshot.posture,
    weatherAgeMs,
    isStale: weather ? weatherAgeMs > DEFAULT_STALE_AFTER_MS : true,
    worstAxisLabel: snapshot.posture.worstAxis,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival/__tests__/world-snapshot.test.mts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/world-snapshot.ts src/services/survival/__tests__/world-snapshot.test.mts
git commit -m "feat(survival): local-first snapshot spine + grid-down projection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: End-to-end loop proof + test script + typecheck

**Files:**

- Create: `src/services/survival/__tests__/survival-loop.test.mts`
- Modify: `package.json` (add `test:survival` script next to the other `test:*` scripts)

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// src/services/survival/__tests__/survival-loop.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../world-snapshot.ts';
import { availableMoves } from '../survival-moves.ts';
import { commitMove, applyPlanToPosture } from '../survival-plan.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}

test('FULL LOOP: tornado threatens posture -> committing moves improves it', () => {
  const alerts: NwsAlertMinimal[] = [{ id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() }];
  const snapshot = buildSnapshot({ weatherAlerts: alerts, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });

  // World threatens.
  assert.equal(snapshot.posture.overallBand, 'critical');
  const startLevel = snapshot.posture.overallLevel;

  // You plan and commit the top two moves.
  const moves = availableMoves(snapshot.posture, snapshot, { now: NOW });
  assert.ok(moves.length >= 2);
  let plan = snapshot.plan;
  plan = commitMove(plan, moves[0]!, NOW);
  plan = commitMove(plan, moves[1]!, NOW);

  // Posture responds.
  const improved = applyPlanToPosture(snapshot.posture, plan, moves);
  assert.ok(improved.overallLevel < startLevel, 'committing moves should lower threat exposure');
  const phys = improved.axes.find((a) => a.axis === 'physical_safety')!;
  assert.equal(phys.trend, 'improving');
});
```

- [ ] **Step 2: Run test to verify it passes** (all dependencies already exist from Tasks 1–6)

Run: `npx tsx --test src/services/survival/__tests__/survival-loop.test.mts`
Expected: PASS — 1 test. (If it fails because fewer than 2 moves are offered, the tornado action set in `preparedness-actions.ts` has ≥5 entries, so `availableMoves` returns ≥2 by default `maxMoves: 6` — confirm Task 4 passed first.)

- [ ] **Step 3: Add the `test:survival` npm script**

In `package.json`, locate the `"test:datacenter": ...` line and add directly after it:

```json
    "test:survival": "tsx --test src/services/survival/__tests__/survival-types.test.mts src/services/survival/__tests__/threat-projection.test.mts src/services/survival/__tests__/survival-posture.test.mts src/services/survival/__tests__/survival-moves.test.mts src/services/survival/__tests__/survival-plan.test.mts src/services/survival/__tests__/world-snapshot.test.mts src/services/survival/__tests__/survival-loop.test.mts",
```

- [ ] **Step 4: Run the full survival suite + typecheck**

Run: `npm run test:survival`
Expected: PASS — all 7 files, ~18 tests, 0 failures.

Run: `npm run typecheck:all`
Expected: 0 errors (both `tsconfig.json` and `tsconfig.api.json`).

- [ ] **Step 5: Commit**

```bash
git add src/services/survival/__tests__/survival-loop.test.mts package.json
git commit -m "test(survival): end-to-end posture loop proof + test:survival script

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Part III engine pieces):**

- World Snapshot (Layer 0 spine) → Task 6. ✓
- Threat projection (Layer 1) → Task 2. ✓
- Survival posture, multi-axis, explainable (Layer 3) → Task 3. ✓
- Moves + modeled effect (Layer 3) → Task 4. ✓
- Plan commit + posture response (the loop) → Task 5 + Task 7. ✓
- Grid-down guarantee → Task 6 (serialize→deserialize→project round-trip). ✓
- Deferred with rationale (Scope section): `StormPosturePanel` + board overlay (UI follow-up); `snapshot-store` IDB adapter + `MissionRecord` replay fixture (UI wiring / E7). Noted, not hidden.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows real assertions. ✓

**Type consistency:** `WorldSnapshot`, `SurvivalPosture` (with `overallLevel`/`overallBand`/`worstAxis`), `AxisState`, `PostureThreat` (`hazardKind` + `hazardLabel`), `SurvivalMove.effect: PostureDelta[]`, `SurvivalPlan.committed: CommittedMove[]` are defined once in Task 1 and used consistently in Tasks 2–7. `computePosture` takes `PostureInput` (structural subset of `WorldSnapshot`) so both `buildSnapshot` and tests pass it cleanly. `projectWeatherThreats(alerts, places, {now})`, `availableMoves(posture, snapshot, {now})`, `applyPlanToPosture(posture, plan, moves)` signatures match across definition and call sites. ✓
