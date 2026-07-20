# Smoke & Air PR 1 — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, fixture-tested smoke-conditions engine (`src/services/smoke/`) — AQI categories, safe windows, cleaner-air compass math, activity guidance, clean-room checklist — plus the keyless Open-Meteo fetcher and state singleton.

**Architecture:** Pure modules (no DOM/fetch/globals) compute everything from typed inputs; `smoke-fetch.ts` is the only network file (Open-Meteo air-quality API, keyless, CSP-allowed); `smoke-state.ts` is the singleton surfaces will subscribe to in PR 2–4.

**Tech Stack:** TypeScript, node:test via tsx (fixture tests, no live fetch), Open-Meteo Air Quality API.

**Worktree:** `/Users/bradleybond/Developer/crystalball/.worktrees/smoke-program`, branch `claude/smoke-air-program`. Spec: `docs/superpowers/specs/2026-07-16-smoke-air-program-design.md`.

**Repo invariants that bind this plan:** commit messages carry `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`; pre-commit runs lint/secret-scan/typecheck (fix, never bypass); every score/verdict carries an explanation string; stale data is surfaced, not dropped; each feed gets its OWN `DataSourceId`.

---

### Task 1: Types (`smoke-types.ts`)

**Files:**
- Create: `src/services/smoke/smoke-types.ts`

- [ ] **Step 1: Write the module** (types only — exercised by every later test)

```ts
/**
 * Smoke & Air program — shared contracts.
 * Spec: docs/superpowers/specs/2026-07-16-smoke-air-program-design.md
 * Pure types; no imports from DOM/fetch modules.
 */

export type AqiCategory =
  | 'good'            // 0–50
  | 'moderate'        // 51–100
  | 'usg'             // 101–150 Unhealthy for Sensitive Groups
  | 'unhealthy'       // 151–200
  | 'very_unhealthy'  // 201–300
  | 'hazardous'       // 301+
  | 'unknown';

export interface AqiSample {
  /** ISO timestamp (Open-Meteo hourly time, local to the place). */
  time: string;
  usAqi: number | null;
  pm25: number | null;
}

export interface SafeWindow {
  startIso: string;
  endIso: string;
  /** Worst AQI inside the window. */
  peakAqi: number;
  /** e.g. "7–9 AM" — renderer-friendly, computed from local hours. */
  label: string;
}

export interface DaySummary {
  dateIso: string;         // YYYY-MM-DD
  maxAqi: number;
  category: AqiCategory;
  /** e.g. "Friday: unhealthy most of the day (peak 172)" */
  headline: string;
}

export type CompassDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CompassPoint {
  direction: CompassDirection;
  bearingDeg: number;
  radiusMi: number;
  lat: number;
  lon: number;
}

export interface CompassSample extends CompassPoint {
  /** Mean us_aqi over the next 6 hours at this point; null = no data. */
  avgAqi6h: number | null;
  /** Negative = cleaner than home (improvement). Null when either side missing. */
  deltaPctVsHome: number | null;
  /** Reverse-geocoded locality; optional — renders as bare distance if null. */
  placeName: string | null;
}

export type ActivityId =
  | 'exercise_outdoors'
  | 'kids_outdoors'
  | 'windows_open'
  | 'commute'
  | 'outdoor_work'
  | 'pets_outdoors';

export interface ActivityAdvice {
  activity: ActivityId;
  label: string;
  verdict: 'ok' | 'caution' | 'avoid';
  reason: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  rationale: string;
  /** Relative contribution to the clean-room score. */
  weight: number;
  done: boolean;
}

export interface CleanRoomScore {
  score0to100: number;
  tier: 'unprepared' | 'partial' | 'ready';
}

export interface SmokeSourceStatus {
  id: 'smoke_forecast' | 'airnow' | 'purpleair';
  label: string;
  ok: boolean;
  /** Explanation when not ok — e.g. "AIRNOW_API_KEY not loaded". */
  detail: string | null;
  updatedAt: number | null;
}

export interface SmokeSnapshot {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  current: { usAqi: number | null; pm25: number | null; category: AqiCategory };
  hourly48: AqiSample[];
  safeWindows: SafeWindow[];
  worstWindow: SafeWindow | null;
  days: DaySummary[];
  compass: CompassSample[];
  activities: ActivityAdvice[];
  sources: SmokeSourceStatus[];
  generatedAt: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/bradleybond/Developer/crystalball/.worktrees/smoke-program && npm run typecheck`
Expected: clean (types-only module).

- [ ] **Step 3: Commit**

```bash
git add src/services/smoke/smoke-types.ts
git commit -m "feat(smoke): shared contracts for the smoke & air engine

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: AQI categories (`aqi-category.ts`)

**Files:**
- Create: `src/services/smoke/aqi-category.ts`
- Test: `src/services/smoke/__tests__/aqi-category.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { categorizeUsAqi, AQI_CATEGORY_LABEL, USG_THRESHOLD } from '../aqi-category.ts';

test('EPA breakpoint edges', () => {
  assert.equal(categorizeUsAqi(0), 'good');
  assert.equal(categorizeUsAqi(50), 'good');
  assert.equal(categorizeUsAqi(51), 'moderate');
  assert.equal(categorizeUsAqi(100), 'moderate');
  assert.equal(categorizeUsAqi(101), 'usg');
  assert.equal(categorizeUsAqi(150), 'usg');
  assert.equal(categorizeUsAqi(151), 'unhealthy');
  assert.equal(categorizeUsAqi(200), 'unhealthy');
  assert.equal(categorizeUsAqi(201), 'very_unhealthy');
  assert.equal(categorizeUsAqi(300), 'very_unhealthy');
  assert.equal(categorizeUsAqi(301), 'hazardous');
  assert.equal(categorizeUsAqi(500), 'hazardous');
});

test('null / NaN → unknown', () => {
  assert.equal(categorizeUsAqi(null), 'unknown');
  assert.equal(categorizeUsAqi(Number.NaN), 'unknown');
});

test('labels cover every category; USG threshold exported for callout logic', () => {
  assert.equal(AQI_CATEGORY_LABEL.usg, 'Unhealthy for Sensitive Groups');
  assert.equal(USG_THRESHOLD, 101);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/services/smoke/__tests__/aqi-category.test.mts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** EPA US-AQI category boundaries — single source of truth for thresholds. */
import type { AqiCategory } from './smoke-types';

/** Callout/alert boundary: 101 = start of Unhealthy for Sensitive Groups. */
export const USG_THRESHOLD = 101;

export function categorizeUsAqi(usAqi: number | null): AqiCategory {
  if (usAqi === null || Number.isNaN(usAqi)) return 'unknown';
  if (usAqi <= 50) return 'good';
  if (usAqi <= 100) return 'moderate';
  if (usAqi <= 150) return 'usg';
  if (usAqi <= 200) return 'unhealthy';
  if (usAqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}

export const AQI_CATEGORY_LABEL: Record<AqiCategory, string> = {
  good: 'Good',
  moderate: 'Moderate',
  usg: 'Unhealthy for Sensitive Groups',
  unhealthy: 'Unhealthy',
  very_unhealthy: 'Very Unhealthy',
  hazardous: 'Hazardous',
  unknown: 'Unknown',
};

/** Design-token key per category (renderers resolve to CSS). */
export const AQI_CATEGORY_TONE: Record<AqiCategory, 'ok' | 'warn' | 'bad' | 'critical' | 'muted'> = {
  good: 'ok',
  moderate: 'warn',
  usg: 'warn',
  unhealthy: 'bad',
  very_unhealthy: 'critical',
  hazardous: 'critical',
  unknown: 'muted',
};
```

- [ ] **Step 4: Run to verify pass** — same command, expect 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/aqi-category.ts src/services/smoke/__tests__/aqi-category.test.mts
git commit -m "feat(smoke): EPA US-AQI categorization (single threshold source)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Safe windows (`safe-windows.ts`)

**Files:**
- Create: `src/services/smoke/safe-windows.ts`
- Test: `src/services/smoke/__tests__/safe-windows.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { computeSafeWindows, computeDaySummaries } from '../safe-windows.ts';
import type { AqiSample } from '../smoke-types.ts';

function hours(startIso: string, aqis: (number | null)[]): AqiSample[] {
  const start = new Date(startIso).getTime();
  return aqis.map((usAqi, i) => ({
    time: new Date(start + i * 3_600_000).toISOString(),
    usAqi,
    pm25: null,
  }));
}

test('finds contiguous safe windows below the threshold and the worst window', () => {
  // 6 hours: 80,90 (safe) | 160,170,150 (bad) | 95 (safe)
  const samples = hours('2026-07-17T06:00:00Z', [80, 90, 160, 170, 150, 95]);
  const { safeWindows, worstWindow } = computeSafeWindows(samples, 100);
  assert.equal(safeWindows.length, 2);
  assert.equal(safeWindows[0]!.peakAqi, 90);
  assert.equal(worstWindow?.peakAqi, 170);
});

test('all-bad day → no safe windows; all-good day → one window, no worst', () => {
  const bad = computeSafeWindows(hours('2026-07-17T00:00:00Z', [160, 180, 200]), 100);
  assert.equal(bad.safeWindows.length, 0);
  assert.equal(bad.worstWindow?.peakAqi, 200);
  const good = computeSafeWindows(hours('2026-07-17T00:00:00Z', [40, 50, 60]), 100);
  assert.equal(good.safeWindows.length, 1);
  assert.equal(good.worstWindow, null);
});

test('null samples break windows (no data ≠ safe)', () => {
  const { safeWindows } = computeSafeWindows(hours('2026-07-17T00:00:00Z', [40, null, 40]), 100);
  assert.equal(safeWindows.length, 2);
});

test('day summaries group by date with max + headline', () => {
  const samples = [
    ...hours('2026-07-17T20:00:00Z', [90, 120]),
    ...hours('2026-07-18T10:00:00Z', [170, 160]),
  ];
  const days = computeDaySummaries(samples);
  assert.equal(days.length, 2);
  assert.equal(days[1]!.maxAqi, 170);
  assert.equal(days[1]!.category, 'unhealthy');
  assert.match(days[1]!.headline, /unhealthy/i);
  assert.match(days[1]!.headline, /170/);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx --test src/services/smoke/__tests__/safe-windows.test.mts` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Safe-window detection over hourly AQI samples.
 * "Safe" = contiguous run with usAqi < threshold (default 100). A null
 * sample is NOT safe — no data must never read as good air.
 */
import type { AqiSample, SafeWindow, DaySummary } from './smoke-types';
import { categorizeUsAqi, AQI_CATEGORY_LABEL } from './aqi-category';

const HOUR_MS = 3_600_000;

function hourLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${ampm}`;
}

function toWindow(run: AqiSample[]): SafeWindow {
  const startIso = run[0]!.time;
  // Window covers through the END of the last sampled hour.
  const endIso = new Date(new Date(run.at(-1)!.time).getTime() + HOUR_MS).toISOString();
  const peakAqi = Math.max(...run.map((s) => s.usAqi ?? 0));
  return { startIso, endIso, peakAqi, label: `${hourLabel(startIso)}–${hourLabel(endIso)}` };
}

export function computeSafeWindows(
  samples: AqiSample[],
  threshold = 100,
): { safeWindows: SafeWindow[]; worstWindow: SafeWindow | null } {
  const safeWindows: SafeWindow[] = [];
  let unsafeRuns: AqiSample[][] = [];
  let safeRun: AqiSample[] = [];
  let unsafeRun: AqiSample[] = [];

  const flushSafe = () => { if (safeRun.length > 0) safeWindows.push(toWindow(safeRun)); safeRun = []; };
  const flushUnsafe = () => { if (unsafeRun.length > 0) unsafeRuns.push(unsafeRun); unsafeRun = []; };

  for (const s of samples) {
    const safe = s.usAqi !== null && s.usAqi < threshold;
    if (safe) { flushUnsafe(); safeRun.push(s); }
    else { flushSafe(); if (s.usAqi !== null) unsafeRun.push(s); else flushUnsafe(); }
  }
  flushSafe();
  flushUnsafe();

  unsafeRuns = unsafeRuns.filter((r) => r.length > 0);
  const worstWindow = unsafeRuns.length === 0
    ? null
    : toWindow(unsafeRuns.reduce((worst, run) => {
        const peak = (r: AqiSample[]) => Math.max(...r.map((s) => s.usAqi ?? 0));
        return peak(run) > peak(worst) ? run : worst;
      }));
  return { safeWindows, worstWindow };
}

export function computeDaySummaries(samples: AqiSample[]): DaySummary[] {
  const byDate = new Map<string, number>();
  for (const s of samples) {
    if (s.usAqi === null) continue;
    const dateIso = s.time.slice(0, 10);
    byDate.set(dateIso, Math.max(byDate.get(dateIso) ?? 0, s.usAqi));
  }
  return [...byDate.entries()].map(([dateIso, maxAqi]) => {
    const category = categorizeUsAqi(maxAqi);
    const weekday = new Date(`${dateIso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return {
      dateIso,
      maxAqi,
      category,
      headline: `${weekday}: ${AQI_CATEGORY_LABEL[category].toLowerCase()} (peak ${maxAqi})`,
    };
  });
}
```

- [ ] **Step 4: Run to verify pass** — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/safe-windows.ts src/services/smoke/__tests__/safe-windows.test.mts
git commit -m "feat(smoke): safe-window + day-summary detection over hourly AQI

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Cleaner-air compass math (`clean-air-compass.ts`)

**Files:**
- Create: `src/services/smoke/clean-air-compass.ts`
- Test: `src/services/smoke/__tests__/clean-air-compass.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { compassPoints, rankCompass, describeCompass } from '../clean-air-compass.ts';
import type { CompassSample } from '../smoke-types.ts';

test('generates 8 directions × given radii with plausible offsets', () => {
  const pts = compassPoints(41.6, -86.7, [30, 60]);
  assert.equal(pts.length, 16);
  const north30 = pts.find((p) => p.direction === 'N' && p.radiusMi === 30)!;
  // 30 mi ≈ 0.434° latitude
  assert.ok(Math.abs(north30.lat - (41.6 + 0.434)) < 0.01, `lat ${north30.lat}`);
  assert.ok(Math.abs(north30.lon - -86.7) < 0.001);
  const east30 = pts.find((p) => p.direction === 'E' && p.radiusMi === 30)!;
  // longitude offset scales by cos(lat): 0.434 / cos(41.6°) ≈ 0.581
  assert.ok(Math.abs(east30.lon - (-86.7 + 0.581)) < 0.01, `lon ${east30.lon}`);
});

function sample(direction: CompassSample['direction'], radiusMi: number, avg: number | null): CompassSample {
  return { direction, bearingDeg: 0, radiusMi, lat: 0, lon: 0, avgAqi6h: avg, deltaPctVsHome: null, placeName: null };
}

test('ranking: cleaner first, deltas vs home, null data last', () => {
  const ranked = rankCompass([sample('S', 60, 60), sample('N', 60, 140), sample('W', 60, null)], 100);
  assert.equal(ranked[0]!.direction, 'S');
  assert.equal(ranked[0]!.deltaPctVsHome, -40);
  assert.equal(ranked[1]!.deltaPctVsHome, 40);
  assert.equal(ranked.at(-1)!.avgAqi6h, null);
});

test('describe: names the best direction or reports unavailable', () => {
  const good = describeCompass([{ ...sample('S', 60, 60), deltaPctVsHome: -40, placeName: 'Lafayette' }], 100);
  assert.match(good, /40% cleaner/);
  assert.match(good, /60 mi S/);
  assert.match(good, /Lafayette/);
  assert.match(describeCompass([sample('W', 60, null)], 100), /unavailable/i);
  // Nowhere better:
  assert.match(describeCompass([{ ...sample('N', 30, 150), deltaPctVsHome: 25 }], 100), /no cleaner air/i);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
/**
 * Cleaner-air compass — pure math half. Sampling coordinates use an
 * equirectangular offset (fine at ≤100 mi scale); fetching AQI at those
 * points and reverse-geocoding names happens in smoke-fetch.ts.
 */
import type { CompassDirection, CompassPoint, CompassSample } from './smoke-types';

const DIRECTIONS: { direction: CompassDirection; bearingDeg: number }[] = [
  { direction: 'N', bearingDeg: 0 }, { direction: 'NE', bearingDeg: 45 },
  { direction: 'E', bearingDeg: 90 }, { direction: 'SE', bearingDeg: 135 },
  { direction: 'S', bearingDeg: 180 }, { direction: 'SW', bearingDeg: 225 },
  { direction: 'W', bearingDeg: 270 }, { direction: 'NW', bearingDeg: 315 },
];

const MI_PER_DEG_LAT = 69.09;

export function compassPoints(lat: number, lon: number, radiiMi: number[]): CompassPoint[] {
  const out: CompassPoint[] = [];
  const latRad = (lat * Math.PI) / 180;
  for (const { direction, bearingDeg } of DIRECTIONS) {
    const theta = (bearingDeg * Math.PI) / 180;
    for (const radiusMi of radiiMi) {
      const dLat = (radiusMi * Math.cos(theta)) / MI_PER_DEG_LAT;
      const dLon = (radiusMi * Math.sin(theta)) / (MI_PER_DEG_LAT * Math.cos(latRad));
      out.push({ direction, bearingDeg, radiusMi, lat: lat + dLat, lon: lon + dLon });
    }
  }
  return out;
}

/** Attach deltas vs home and sort: cleanest first, no-data last. */
export function rankCompass(samples: CompassSample[], homeAqi: number | null): CompassSample[] {
  const withDelta = samples.map((s) => ({
    ...s,
    deltaPctVsHome:
      s.avgAqi6h === null || homeAqi === null || homeAqi === 0
        ? null
        : Math.round(((s.avgAqi6h - homeAqi) / homeAqi) * 100),
  }));
  return withDelta.sort((a, b) => {
    if (a.avgAqi6h === null && b.avgAqi6h === null) return 0;
    if (a.avgAqi6h === null) return 1;
    if (b.avgAqi6h === null) return -1;
    return a.avgAqi6h - b.avgAqi6h;
  });
}

/** One-line human statement for the best escape direction. */
export function describeCompass(ranked: CompassSample[], homeAqi: number | null): string {
  const usable = ranked.filter((s) => s.avgAqi6h !== null);
  if (usable.length === 0 || usable.length < ranked.length / 2) {
    return 'Cleaner-air scan unavailable (insufficient forecast data).';
  }
  const best = usable[0]!;
  if (best.deltaPctVsHome === null || best.deltaPctVsHome >= -10 || homeAqi === null) {
    return 'No cleaner air within 100 mi — conditions are regional. Best strategy is indoor air + safe windows.';
  }
  const where = best.placeName
    ? `${best.radiusMi} mi ${best.direction} near ${best.placeName}`
    : `${best.radiusMi} mi ${best.direction}`;
  return `Air is ${Math.abs(best.deltaPctVsHome)}% cleaner ${where} (AQI ~${Math.round(best.avgAqi6h!)} vs ${Math.round(homeAqi)} at home).`;
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/clean-air-compass.ts src/services/smoke/__tests__/clean-air-compass.test.mts
git commit -m "feat(smoke): cleaner-air compass math (points, ranking, narration)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Activity guidance (`activity-guidance.ts`)

**Files:**
- Create: `src/services/smoke/activity-guidance.ts`
- Test: `src/services/smoke/__tests__/activity-guidance.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { adviseActivities, ACTIVITY_LABELS } from '../activity-guidance.ts';

test('every activity gets a verdict + reason for every category × sensitivity', () => {
  const cats = ['good', 'moderate', 'usg', 'unhealthy', 'very_unhealthy', 'hazardous', 'unknown'] as const;
  for (const cat of cats) {
    for (const sensitive of [false, true]) {
      const advice = adviseActivities(cat, sensitive);
      assert.equal(advice.length, Object.keys(ACTIVITY_LABELS).length, `${cat}/${sensitive}`);
      for (const a of advice) {
        assert.ok(['ok', 'caution', 'avoid'].includes(a.verdict));
        assert.ok(a.reason.length > 0, `${cat}/${sensitive}/${a.activity} needs a reason`);
      }
    }
  }
});

test('sensitivity escalates: sensitive verdicts are never more permissive', () => {
  const rank = { ok: 0, caution: 1, avoid: 2 } as const;
  for (const cat of ['moderate', 'usg', 'unhealthy'] as const) {
    const normal = adviseActivities(cat, false);
    const sensitive = adviseActivities(cat, true);
    for (const [i, a] of normal.entries()) {
      assert.ok(rank[sensitive[i]!.verdict] >= rank[a.verdict], `${cat}/${a.activity}`);
    }
  }
});

test('spot checks match EPA guidance shape', () => {
  const usgSensitive = adviseActivities('usg', true);
  assert.equal(usgSensitive.find((a) => a.activity === 'exercise_outdoors')!.verdict, 'avoid');
  const good = adviseActivities('good', false);
  assert.ok(good.every((a) => a.verdict === 'ok'));
  const unknown = adviseActivities('unknown', false);
  assert.ok(unknown.every((a) => a.verdict === 'caution'));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
/**
 * Per-activity guidance from EPA AQI category guidance. Verdicts follow the
 * EPA activity tables (no invented medicine); `sensitive` = children,
 * older adults, heart/lung conditions — escalates one step where EPA does.
 */
import type { AqiCategory, ActivityId, ActivityAdvice } from './smoke-types';

export const ACTIVITY_LABELS: Record<ActivityId, string> = {
  exercise_outdoors: 'Exercise / run outdoors',
  kids_outdoors: 'Kids playing outside',
  windows_open: 'Windows open',
  commute: 'Commute / errands',
  outdoor_work: 'Extended outdoor work',
  pets_outdoors: 'Pets outside',
};

type Verdict = ActivityAdvice['verdict'];

// Base verdict by category for the general population.
const BASE: Record<AqiCategory, Record<ActivityId, Verdict>> = {
  good: { exercise_outdoors: 'ok', kids_outdoors: 'ok', windows_open: 'ok', commute: 'ok', outdoor_work: 'ok', pets_outdoors: 'ok' },
  moderate: { exercise_outdoors: 'ok', kids_outdoors: 'ok', windows_open: 'ok', commute: 'ok', outdoor_work: 'ok', pets_outdoors: 'ok' },
  usg: { exercise_outdoors: 'caution', kids_outdoors: 'caution', windows_open: 'caution', commute: 'ok', outdoor_work: 'caution', pets_outdoors: 'caution' },
  unhealthy: { exercise_outdoors: 'avoid', kids_outdoors: 'avoid', windows_open: 'avoid', commute: 'caution', outdoor_work: 'avoid', pets_outdoors: 'caution' },
  very_unhealthy: { exercise_outdoors: 'avoid', kids_outdoors: 'avoid', windows_open: 'avoid', commute: 'caution', outdoor_work: 'avoid', pets_outdoors: 'avoid' },
  hazardous: { exercise_outdoors: 'avoid', kids_outdoors: 'avoid', windows_open: 'avoid', commute: 'avoid', outdoor_work: 'avoid', pets_outdoors: 'avoid' },
  unknown: { exercise_outdoors: 'caution', kids_outdoors: 'caution', windows_open: 'caution', commute: 'caution', outdoor_work: 'caution', pets_outdoors: 'caution' },
};

const REASONS: Record<Verdict, Record<AqiCategory, string>> = {
  ok: {
    good: 'Air quality is good — no restrictions.',
    moderate: 'Acceptable for most people.',
    usg: 'Short, low-exertion exposure is acceptable for the general population.',
    unhealthy: '', very_unhealthy: '', hazardous: '',
    unknown: '',
  },
  caution: {
    good: '', moderate: 'Unusually sensitive people should watch for symptoms.',
    usg: 'Reduce prolonged or heavy exertion; take more breaks.',
    unhealthy: 'Keep it brief; N95 recommended if prolonged.',
    very_unhealthy: 'Only if necessary; keep exposure minimal, N95 strongly recommended.',
    hazardous: '', unknown: 'Air data unavailable — treat conditions as degraded until data returns.',
  },
  avoid: {
    good: '', moderate: '',
    usg: 'Sensitive groups should move activity indoors or reschedule.',
    unhealthy: 'Everyone should avoid prolonged outdoor exposure.',
    very_unhealthy: 'Health-alert conditions — stay indoors with filtered air.',
    hazardous: 'Emergency conditions — remain indoors; seal and filter your air.',
    unknown: '',
  },
};

const ESCALATE: Record<Verdict, Verdict> = { ok: 'caution', caution: 'avoid', avoid: 'avoid' };

export function adviseActivities(category: AqiCategory, sensitive: boolean): ActivityAdvice[] {
  return (Object.keys(ACTIVITY_LABELS) as ActivityId[]).map((activity) => {
    const base = BASE[category][activity];
    // EPA escalates for sensitive groups from 'moderate' upward; good stays ok.
    const verdict = sensitive && category !== 'good' ? ESCALATE[base] : base;
    const reason = REASONS[verdict][category] || REASONS[base][category] ||
      'Follow the stricter of local guidance and this category advice.';
    return { activity, label: ACTIVITY_LABELS[activity], verdict, reason };
  });
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/activity-guidance.ts src/services/smoke/__tests__/activity-guidance.test.mts
git commit -m "feat(smoke): EPA-based per-activity guidance with sensitivity escalation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Clean-room checklist (`clean-room-checklist.ts`)

**Files:**
- Create: `src/services/smoke/clean-room-checklist.ts`
- Test: `src/services/smoke/__tests__/clean-room-checklist.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { CLEAN_ROOM_ITEMS, scoreCleanRoom, applyDoneState } from '../clean-room-checklist.ts';

test('score 0 when nothing done, 100 when all done, tiers at 40/80', () => {
  assert.deepEqual(scoreCleanRoom([]), { score0to100: 0, tier: 'unprepared' });
  const all = CLEAN_ROOM_ITEMS.map((i) => i.id);
  assert.deepEqual(scoreCleanRoom(all), { score0to100: 100, tier: 'ready' });
});

test('partial credit is weight-proportional and monotone', () => {
  const one = scoreCleanRoom([CLEAN_ROOM_ITEMS[0]!.id]).score0to100;
  const two = scoreCleanRoom([CLEAN_ROOM_ITEMS[0]!.id, CLEAN_ROOM_ITEMS[1]!.id]).score0to100;
  assert.ok(one > 0 && two > one && two < 100);
});

test('applyDoneState marks items and ignores unknown ids', () => {
  const items = applyDoneState(['hvac-recirculate', 'not-a-real-id']);
  assert.equal(items.find((i) => i.id === 'hvac-recirculate')!.done, true);
  assert.equal(items.filter((i) => i.done).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
/**
 * Clean-room readiness checklist. Pure: done-state comes in as an id list;
 * persistence (localStorage `cb-smoke-checklist`) is the caller's concern
 * (smoke-state.ts) so this stays fixture-testable.
 */
import type { ChecklistItem, CleanRoomScore } from './smoke-types';

export const CLEAN_ROOM_ITEMS: Omit<ChecklistItem, 'done'>[] = [
  { id: 'hvac-recirculate', label: 'HVAC/AC set to recirculate', rationale: 'Stops pulling smoky outside air through the system.', weight: 3 },
  { id: 'filter-running', label: 'HEPA purifier or box-fan filter running', rationale: 'A HEPA or MERV-13 filter removes most PM2.5 indoors.', weight: 3 },
  { id: 'room-sealed', label: 'One room with windows/doors sealed', rationale: 'A designated clean room concentrates filtration where you sleep.', weight: 2 },
  { id: 'n95-on-hand', label: 'N95/KN95 masks on hand', rationale: 'For unavoidable trips outside during unhealthy air.', weight: 1 },
  { id: 'meds-stocked', label: 'Inhalers / heart-lung meds stocked', rationale: 'Smoke aggravates asthma and cardiovascular conditions.', weight: 1 },
];

const TOTAL_WEIGHT = CLEAN_ROOM_ITEMS.reduce((sum, i) => sum + i.weight, 0);

export function applyDoneState(doneIds: string[]): ChecklistItem[] {
  const done = new Set(doneIds);
  return CLEAN_ROOM_ITEMS.map((i) => ({ ...i, done: done.has(i.id) }));
}

export function scoreCleanRoom(doneIds: string[]): CleanRoomScore {
  const done = new Set(doneIds);
  const earned = CLEAN_ROOM_ITEMS.filter((i) => done.has(i.id)).reduce((s, i) => s + i.weight, 0);
  const score0to100 = Math.round((earned / TOTAL_WEIGHT) * 100);
  const tier = score0to100 >= 80 ? 'ready' : score0to100 >= 40 ? 'partial' : 'unprepared';
  return { score0to100, tier };
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/clean-room-checklist.ts src/services/smoke/__tests__/clean-room-checklist.test.mts
git commit -m "feat(smoke): scored clean-room readiness checklist

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Fetcher (`smoke-fetch.ts`) + DataSourceId

**Files:**
- Modify: `src/services/data-freshness.ts` (add `'smoke_forecast'` to the `DataSourceId` union, alphabetized near `'climate'`; add its display entry if the file's registry map requires one — grep `climate` inside the file and mirror every place it appears)
- Create: `src/services/smoke/smoke-fetch.ts`
- Test: `src/services/smoke/__tests__/smoke-fetch.test.mts` (parse function only — no live fetch)

- [ ] **Step 1: Write the failing parse test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenMeteoAq, avgNext6h } from '../smoke-fetch.ts';

const FIXTURE = {
  latitude: 41.6, longitude: -86.7,
  current: { time: '2026-07-16T14:00', us_aqi: 156, pm2_5: 62.1 },
  hourly: {
    time: ['2026-07-16T14:00', '2026-07-16T15:00', '2026-07-16T16:00'],
    us_aqi: [156, 148, null],
    pm2_5: [62.1, 58.0, null],
  },
};

test('parses current + hourly samples, preserving nulls', () => {
  const parsed = parseOpenMeteoAq(FIXTURE);
  assert.equal(parsed.current.usAqi, 156);
  assert.equal(parsed.current.pm25, 62.1);
  assert.equal(parsed.hourly.length, 3);
  assert.equal(parsed.hourly[2]!.usAqi, null);
});

test('malformed payload → null current, empty hourly (never throws)', () => {
  const parsed = parseOpenMeteoAq({});
  assert.equal(parsed.current.usAqi, null);
  assert.deepEqual(parsed.hourly, []);
});

test('avgNext6h averages available leading samples, null when none', () => {
  assert.equal(avgNext6h([{ time: 't', usAqi: 100, pm25: null }, { time: 't', usAqi: 200, pm25: null }]), 150);
  assert.equal(avgNext6h([{ time: 't', usAqi: null, pm25: null }]), null);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the fetcher**

```ts
/**
 * Open-Meteo Air Quality fetcher — the keyless backbone of the smoke engine.
 * Docs: https://open-meteo.com/en/docs/air-quality-api
 * Direct renderer fetch (CSP already allows https://*.open-meteo.com, same
 * as pollen.ts / air-quality.ts). Every call records freshness under the
 * dedicated 'smoke_forecast' source id (fail-closed pattern).
 */
import { dataFreshness } from '@/services/data-freshness';
import type { AqiSample } from './smoke-types';

const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export interface ParsedAq {
  current: { usAqi: number | null; pm25: number | null };
  hourly: AqiSample[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseOpenMeteoAq(raw: unknown): ParsedAq {
  const r = raw as {
    current?: { us_aqi?: unknown; pm2_5?: unknown };
    hourly?: { time?: unknown[]; us_aqi?: unknown[]; pm2_5?: unknown[] };
  } | null;
  const times = Array.isArray(r?.hourly?.time) ? r.hourly.time : [];
  const aqis = Array.isArray(r?.hourly?.us_aqi) ? r.hourly.us_aqi : [];
  const pms = Array.isArray(r?.hourly?.pm2_5) ? r.hourly.pm2_5 : [];
  const hourly: AqiSample[] = times.map((t, i) => ({
    time: String(t),
    usAqi: num(aqis[i]),
    pm25: num(pms[i]),
  }));
  return {
    current: { usAqi: num(r?.current?.us_aqi), pm25: num(r?.current?.pm2_5) },
    hourly,
  };
}

/** Mean us_aqi of the first ≤6 samples with data; null if none have data. */
export function avgNext6h(hourly: AqiSample[]): number | null {
  const vals = hourly.slice(0, 6).map((s) => s.usAqi).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Fetch current + hourly forecast for one coordinate. */
export async function fetchAqForPoint(lat: number, lon: number, forecastDays = 3): Promise<ParsedAq> {
  const url = `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&current=us_aqi,pm2_5&hourly=us_aqi,pm2_5&forecast_days=${forecastDays}&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`open-meteo AQ ${res.status}`);
  return parseOpenMeteoAq(await res.json());
}

/**
 * Batch fetch for many coordinates (compass ring). Open-Meteo accepts
 * comma-separated latitude/longitude lists and returns an array of
 * responses in the same order. Falls back to null entries on failure.
 */
export async function fetchAqForPoints(points: { lat: number; lon: number }[]): Promise<(ParsedAq | null)[]> {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat.toFixed(4)).join(',');
  const lons = points.map((p) => p.lon.toFixed(4)).join(',');
  const url = `${BASE}?latitude=${lats}&longitude=${lons}`
    + `&hourly=us_aqi,pm2_5&forecast_days=1&timezone=auto`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`open-meteo AQ batch ${res.status}`);
    const body = await res.json();
    const arr = Array.isArray(body) ? body : [body];
    const out = points.map((_, i) => (arr[i] ? parseOpenMeteoAq(arr[i]) : null));
    dataFreshness.recordUpdate('smoke_forecast', out.filter(Boolean).length);
    return out;
  } catch (error) {
    dataFreshness.recordError('smoke_forecast', String(error));
    return points.map(() => null);
  }
}
```

Also modify `src/services/data-freshness.ts`: add to the union (near `'climate'`):

```ts
  | 'smoke_forecast' // Open-Meteo air-quality forecast (smoke engine)
```

and mirror `'climate'` in any display-name/interval registry inside the same file (grep `'climate'` there; copy the row with label `Smoke forecast (Open-Meteo)`).

- [ ] **Step 4: Run parse tests + typecheck** — both clean. (Note: importing `@/services/data-freshness` under tsx works — air-quality tests already do the equivalent; if the tsx alias chain complains, move `parseOpenMeteoAq`/`avgNext6h` into `smoke-parse.ts` with zero imports and re-export from smoke-fetch — decide by running, not guessing.)

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/smoke-fetch.ts src/services/smoke/__tests__/smoke-fetch.test.mts src/services/data-freshness.ts
git commit -m "feat(smoke): keyless Open-Meteo AQ fetcher (point + compass batch)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: State singleton (`smoke-state.ts`)

**Files:**
- Create: `src/services/smoke/smoke-state.ts`
- Test: `src/services/smoke/__tests__/smoke-state.test.mts` (injected fetcher — no network, no localStorage)

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSnapshot } from '../smoke-state.ts';
import type { ParsedAq } from '../smoke-fetch.ts';

const HOME: ParsedAq = {
  current: { usAqi: 156, pm25: 62 },
  hourly: Array.from({ length: 12 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 6, 16, 14 + i)).toISOString(),
    usAqi: i < 6 ? 150 - i * 10 : 80,
    pm25: null,
  })),
};

test('buildSnapshot composes current, windows, days, compass, activities', () => {
  const snap = buildSnapshot({
    place: { id: 'home', name: 'Home', lat: 41.6, lon: -86.7 },
    home: HOME,
    compassParsed: [
      { point: { direction: 'S', bearingDeg: 180, radiusMi: 60, lat: 40.7, lon: -86.7 },
        parsed: { current: { usAqi: null, pm25: null }, hourly: [{ time: 't', usAqi: 60, pm25: null }] } },
      { point: { direction: 'N', bearingDeg: 0, radiusMi: 60, lat: 42.5, lon: -86.7 }, parsed: null },
    ],
    doneChecklistIds: ['hvac-recirculate'],
    sensitiveGroup: false,
    now: Date.UTC(2026, 6, 16, 14),
  });
  assert.equal(snap.current.category, 'unhealthy');
  assert.ok(snap.safeWindows.length >= 1);       // the 80s tail
  assert.ok(snap.days.length >= 1);
  assert.equal(snap.compass[0]!.direction, 'S'); // cleaner ranks first
  assert.equal(snap.compass.at(-1)!.avgAqi6h, null);
  assert.equal(snap.activities.length, 6);
  assert.equal(snap.sources[0]!.id, 'smoke_forecast');
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
/**
 * Smoke engine singleton — composes the pure modules into SmokeSnapshots
 * for saved places and lets surfaces subscribe. Fetch + persistence live
 * here; buildSnapshot stays pure/injectable for tests.
 */
import { getSavedPlaces } from '@/services/saved-places';
import type { CompassPoint, SmokeSnapshot } from './smoke-types';
import { categorizeUsAqi } from './aqi-category';
import { computeSafeWindows, computeDaySummaries } from './safe-windows';
import { compassPoints, rankCompass } from './clean-air-compass';
import { adviseActivities } from './activity-guidance';
import { fetchAqForPoint, fetchAqForPoints, avgNext6h, type ParsedAq } from './smoke-fetch';

const CHECKLIST_KEY = 'cb-smoke-checklist';
const SENSITIVE_KEY = 'cb-smoke-sensitive';
export const COMPASS_RADII_MI = [30, 60, 100];

export interface BuildInputs {
  place: { id: string; name: string; lat: number; lon: number };
  home: ParsedAq;
  compassParsed: { point: CompassPoint; parsed: ParsedAq | null }[];
  doneChecklistIds: string[];
  sensitiveGroup: boolean;
  now: number;
}

export function buildSnapshot(inputs: BuildInputs): SmokeSnapshot {
  const { place, home, compassParsed, sensitiveGroup, now } = inputs;
  const category = categorizeUsAqi(home.current.usAqi);
  const hourly48 = home.hourly.slice(0, 48);
  const { safeWindows, worstWindow } = computeSafeWindows(hourly48);
  const compassSamples = compassParsed.map(({ point, parsed }) => ({
    ...point,
    avgAqi6h: parsed ? avgNext6h(parsed.hourly) : null,
    deltaPctVsHome: null,
    placeName: null,
  }));
  return {
    placeId: place.id,
    placeName: place.name,
    lat: place.lat,
    lon: place.lon,
    current: { ...home.current, category },
    hourly48,
    safeWindows,
    worstWindow,
    days: computeDaySummaries(home.hourly),
    compass: rankCompass(compassSamples, home.current.usAqi),
    activities: adviseActivities(category, sensitiveGroup),
    sources: [{
      id: 'smoke_forecast',
      label: 'Open-Meteo air quality (satellite/model)',
      ok: home.hourly.length > 0,
      detail: home.hourly.length > 0 ? null : 'No forecast data returned',
      updatedAt: now,
    }],
    generatedAt: now,
  };
}

// ── Singleton runtime (not unit-tested; exercised live in PR 2) ─────────

let snapshots: SmokeSnapshot[] = [];
const listeners = new Set<(s: SmokeSnapshot[]) => void>();

function readIds(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { return []; }
}

export function getSmokeSnapshots(): SmokeSnapshot[] { return snapshots; }
export function getDoneChecklistIds(): string[] { return readIds(CHECKLIST_KEY); }
export function setChecklistDone(ids: string[]): void {
  try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(ids)); } catch { /* quota */ }
  void refreshSmokeConditions(false);
}
export function getSensitiveGroup(): boolean {
  try { return localStorage.getItem(SENSITIVE_KEY) === '1'; } catch { return false; }
}
export function setSensitiveGroup(v: boolean): void {
  try { localStorage.setItem(SENSITIVE_KEY, v ? '1' : '0'); } catch { /* quota */ }
  void refreshSmokeConditions(false);
}
export function subscribeSmoke(fn: (s: SmokeSnapshot[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let lastFetch: { home: ParsedAq; compass: { point: CompassPoint; parsed: ParsedAq | null }[]; placeId: string } | null = null;

/** Refresh snapshots. withNetwork=false recomputes from cached fetches
 *  (checklist/sensitivity toggles shouldn't refetch). */
export async function refreshSmokeConditions(withNetwork = true): Promise<void> {
  const places = getSavedPlaces();
  const primary = places.find((p) => p.primary) ?? places[0];
  if (!primary) { snapshots = []; for (const l of listeners) l(snapshots); return; }

  if (withNetwork || !lastFetch || lastFetch.placeId !== primary.id) {
    try {
      const points = compassPoints(primary.lat, primary.lon, COMPASS_RADII_MI);
      const [home, ring] = await Promise.all([
        fetchAqForPoint(primary.lat, primary.lon),
        fetchAqForPoints(points),
      ]);
      lastFetch = {
        home,
        compass: points.map((point, i) => ({ point, parsed: ring[i] ?? null })),
        placeId: primary.id,
      };
    } catch {
      // Keep last snapshot — staleness shows via generatedAt + freshness feed.
      if (!lastFetch) return;
    }
  }

  snapshots = [buildSnapshot({
    place: { id: primary.id, name: primary.name, lat: primary.lat, lon: primary.lon },
    home: lastFetch.home,
    compassParsed: lastFetch.compass,
    doneChecklistIds: getDoneChecklistIds(),
    sensitiveGroup: getSensitiveGroup(),
    now: Date.now(),
  })];
  for (const l of listeners) l(snapshots);
}
```

- [ ] **Step 4: Run to verify pass** — if the `@/services/saved-places` import breaks tsx (Vite alias chain), split the pure `buildSnapshot` into `smoke-snapshot.ts` (no `@/` imports) and keep the singleton runtime in `smoke-state.ts`; run again. (`saved-places` itself imports Vite-only utils — check before fighting it.)

- [ ] **Step 5: Commit**

```bash
git add src/services/smoke/smoke-state.ts src/services/smoke/__tests__/smoke-state.test.mts
git commit -m "feat(smoke): snapshot composer + engine state singleton

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Test script, live verify, PR

**Files:**
- Modify: `package.json` (scripts block, next to `test:weather`)

- [ ] **Step 1: Add the script**

```json
"test:smoke-engine": "tsx --test src/services/smoke/__tests__/aqi-category.test.mts src/services/smoke/__tests__/safe-windows.test.mts src/services/smoke/__tests__/clean-air-compass.test.mts src/services/smoke/__tests__/activity-guidance.test.mts src/services/smoke/__tests__/clean-room-checklist.test.mts src/services/smoke/__tests__/smoke-fetch.test.mts src/services/smoke/__tests__/smoke-state.test.mts",
```

(Name is `test:smoke-engine`, NOT `test:smoke` — `npm run smoke` already exists for the replay smoke test; avoid confusion.)

- [ ] **Step 2: Full suite + typecheck + lint**

Run: `npm run test:smoke-engine && npm run typecheck:all && npx eslint --quiet src/services/smoke/`
Expected: all pass, zero errors.

- [ ] **Step 3: Live curl proof (the fetcher's real URL shape)**

```bash
curl -s "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=41.6106&longitude=-86.7225&current=us_aqi,pm2_5&hourly=us_aqi,pm2_5&forecast_days=3&timezone=auto" | head -c 400
```
Expected: JSON with `current.us_aqi` + `hourly.us_aqi` arrays (La Porte, IN).
Also verify the batch shape returns an array for 2+ points.

- [ ] **Step 4: Commit, push, Codex review, PR**

```bash
git add package.json
git commit -m "feat(smoke): test:smoke-engine suite

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push -u origin claude/smoke-air-program
# Codex review (read-only, diff on stdin), then:
gh pr create --title "feat(smoke): smoke & air engine (PR 1 of 4)" \
  --body "…summary + test plan + 'cross-agent review: Codex (…)' marker…"
gh pr merge --auto --squash --delete-branch
```

PR body must include the honest `cross-agent review: Codex` marker with real rounds, the spec link, and note that PR 2 (panel), PR 3 (callout), PR 4 (map) follow.

---

## Follow-up plans (separate docs, after PR 1 merges)

- PR 2: `AirSmokePanel` (+ panels.ts/panel-metadata.ts/panel-layout.ts registration — see feedback_panel_wiring_audit)
- PR 3: `smoke-headline.ts` + Command Center/Home Shell + notification ladder wiring
- PR 4: map "Smoke & Air" toggle

## Self-review notes

- Spec coverage (PR 1 scope): types ✓ categories ✓ windows/day summaries ✓ compass math ✓ activities ✓ checklist ✓ fetcher+freshness ✓ singleton+persistence ✓ tests ✓. Reverse-geocode naming (`placeName`) intentionally lands with PR 2 (fetch-side enhancement, compass renders without names per spec's error handling).
- Type consistency: `ParsedAq`, `AqiSample`, `CompassPoint/Sample`, verdicts checked across tasks.
- No placeholders; two decide-by-running notes are explicit contingencies with concrete alternatives, not TBDs.
