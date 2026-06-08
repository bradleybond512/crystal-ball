# Data Center Readiness Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a focused, always-prominent surface that turns external grid + weather signals for one configured data-center site into a small, people-first set of preparedness actions.

**Architecture:** A new pure `src/services/datacenter/` service layer (no DOM, no fetch, no globals — fixture-tested, matching `intelligence/`/`weather/`/`shortage/`) fuses already-fetched external feeds into one `DataCenterPosture` object. Two thin renderers sit on top: a pinned mini-strip docked above the panel grid and a full `Panel`-derived top panel. A singleton (`datacenter-state.ts`) is the single wiring point; `data-loader.ts` and `panel-layout.ts` call its recompute on the existing refresh schedule. Both renderers are pure (zero decision logic) and build DOM with the codebase's safe `h()`/`replaceChildren()` helpers — never `innerHTML` with interpolated data.

**Tech Stack:** TypeScript, Vite, `tsx --test` (node:test) fixtures, the existing `Panel` base class and `src/utils/dom-utils` DOM builder.

---

## Reference: existing assets this plan consumes

Read these before starting — the plan reuses their exact signatures:

- `src/services/weather/weather-threat-types.ts` — `ThreatLevel = 'none'|'watch'|'advisory'|'warning'|'emergency'`, `WeatherHazardKind`, `NwsAlertMinimal`, `classifyHazard()`, `SavedPlace` (weather matcher's own shape: `{ id, label, lat, lon, radiusKm? }`).
- `src/services/weather/nws-polygon-match.ts` — `matchAlertToPlace(alert, place, options): PolygonMatchResult`.
- `src/services/weather/personal-storm-mode.ts` — `buildStormModePayload(match, placeLabel?, options): StormModePayload` (fields `activation`, `arrivalWindow?: { earliestMs, latestMs, label }`, `primaryHazard`, `threatLevel`, …).
- `src/services/power-grid.ts` — `GridStatus { region, utilizationPct, alerts: GridAlert[], … }`, `GridAlert { severity: 'emergency'|'warning'|'watch'|'info', region, title, … }`.
- `src/services/infrastructure/grid-monitor.ts` — `EIA_REGIONS = ['CISO','PJM','MISO','ERCO','NYIS']`, `type EiaRegion`.
- `src/services/saved-places.ts` — store `SavedPlace { id, name, lat, lon, radiusKm, tags: SavedPlaceTag[], priority, … }`, `SavedPlaceTag` union, `getSavedPlaces()`, `subscribeSavedPlaces()`.
- `src/components/Panel.ts` — base class; `getElement()`, `setCount()`, `markFresh()`; uses `replaceChildren(this.content, h(...))` from `src/utils/dom-utils` internally (the safe-DOM idiom this plan follows).
- `src/utils/dom-utils.ts` — `h(tag, props?, ...children)`, `text()`, `replaceChildren(el, ...children)`.

**Naming locked across all tasks** (use these exact identifiers): `DcLevel`, `DataCenterPosture`, `PowerPosture`, `WeatherPosture`, `ReadinessAction`, `SiteConfig`, `ActionAudience`, `ActionUrgency`, `dcLevelRank()`, `mapThreatLevelToDc()`, `computePowerPosture()`, `computeWeatherPosture()`, `buildReadinessActions()`, `computeDatacenterPosture()`, `eiaRegionForLatLon()`, `resolveSiteConfig()`, `getDatacenterPosture()`, `setDatacenterSite()`, `recomputeDatacenterPosture()`, `subscribeDatacenterPosture()`.

---

## Task 1: Core types + level ladder

**Files:**

- Create: `src/services/datacenter/datacenter-types.ts`
- Test: `src/services/datacenter/__tests__/datacenter-types.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/datacenter-types.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dcLevelRank, mapThreatLevelToDc, type DcLevel } from '../datacenter-types';

test('dcLevelRank orders the ladder normal<watch<advisory<warning<critical', () => {
  const order: DcLevel[] = ['normal', 'watch', 'advisory', 'warning', 'critical'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(dcLevelRank(order[i]!) > dcLevelRank(order[i - 1]!));
  }
});

test('mapThreatLevelToDc bridges weather ThreatLevel onto DcLevel', () => {
  assert.equal(mapThreatLevelToDc('none'), 'normal');
  assert.equal(mapThreatLevelToDc('watch'), 'watch');
  assert.equal(mapThreatLevelToDc('advisory'), 'advisory');
  assert.equal(mapThreatLevelToDc('warning'), 'warning');
  assert.equal(mapThreatLevelToDc('emergency'), 'critical');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-types.test.mts`
Expected: FAIL — `Cannot find module '../datacenter-types'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/datacenter-types.ts
import type { GridAlert } from '@/services/power-grid';
import type { EiaRegion } from '@/services/infrastructure/grid-monitor';
import type { ThreatLevel, WeatherHazardKind } from '@/services/weather/weather-threat-types';
import type { StormModePayload } from '@/services/weather/personal-storm-mode';

/** Blended verdict ladder. Mirrors the weather ThreatLevel ordering but is a
 *  distinct type: weather's 'none'/'emergency' map to 'normal'/'critical'. */
export type DcLevel = 'normal' | 'watch' | 'advisory' | 'warning' | 'critical';

const DC_LEVEL_ORDER: readonly DcLevel[] = ['normal', 'watch', 'advisory', 'warning', 'critical'];

export function dcLevelRank(level: DcLevel): number {
  return DC_LEVEL_ORDER.indexOf(level);
}

export function maxDcLevel(a: DcLevel, b: DcLevel): DcLevel {
  return dcLevelRank(a) >= dcLevelRank(b) ? a : b;
}

/** Bump one rung toward critical (clamped). */
export function bumpDcLevel(level: DcLevel): DcLevel {
  const next = Math.min(DC_LEVEL_ORDER.length - 1, dcLevelRank(level) + 1);
  return DC_LEVEL_ORDER[next]!;
}

export function mapThreatLevelToDc(level: ThreatLevel): DcLevel {
  switch (level) {
    case 'none': return 'normal';
    case 'watch': return 'watch';
    case 'advisory': return 'advisory';
    case 'warning': return 'warning';
    case 'emergency': return 'critical';
  }
}

export type ActionAudience = 'onsite_safety' | 'commute_staffing' | 'facility_ops' | 'escalation';
export type ActionUrgency = 'now' | 'soon' | 'be_ready' | 'monitor';

export interface ReadinessAction {
  id: string;
  audience: ActionAudience;
  urgency: ActionUrgency;
  /** Imperative ("Move outdoor/rooftop crews inside"). */
  title: string;
  /** One line: why + the threshold that triggered it. */
  detail: string;
  /** Provenance ("Tornado Warning polygon, ETA 18 min"). */
  trigger: string;
  /** Stale actions auto-drop. null = no expiry. */
  expiresAt: number | null;
}

export interface SiteConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  eiaRegion: EiaRegion;
}

export interface PowerPosture {
  level: DcLevel;
  gridUtilizationPct: number | null;
  gridAlerts: GridAlert[];
  nearbyOutageCount: number | null;
  drivers: string[];
}

export interface WeatherPosture {
  level: DcLevel;
  activeHazards: WeatherHazardKind[];
  stormMode: StormModePayload | null;
  arrivalWindowMins: number | null;
  drivers: string[];
}

export interface DataCenterPosture {
  site: SiteConfig;
  overall: DcLevel;
  headline: string;
  power: PowerPosture;
  weather: WeatherPosture;
  actions: ReadinessAction[];
  updatedAt: number;
  /** Feeds that were stale/missing at compute time — confidence honesty. */
  staleInputs: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-types.test.mts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/datacenter-types.ts src/services/datacenter/__tests__/datacenter-types.test.mts
git commit -m "feat(datacenter): readiness types + DcLevel ladder

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Power posture from external grid signals

**Files:**

- Create: `src/services/datacenter/power-posture.ts`
- Test: `src/services/datacenter/__tests__/power-posture.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/power-posture.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePowerPosture } from '../power-posture';
import type { GridAlert } from '@/services/power-grid';

function alert(severity: GridAlert['severity']): GridAlert {
  return { id: `a-${severity}`, severity, title: `${severity} event`, description: '', region: 'PJM', timestamp: 0 };
}

test('normal when load is low and no alerts', () => {
  const p = computePowerPosture({ gridUtilizationPct: 60, gridAlerts: [], nearbyOutageCount: 0 });
  assert.equal(p.level, 'normal');
  assert.deepEqual(p.drivers, []);
});

test('warning at 92% utilization boundary', () => {
  const p = computePowerPosture({ gridUtilizationPct: 92, gridAlerts: [], nearbyOutageCount: null });
  assert.equal(p.level, 'warning');
  assert.ok(p.drivers.some((d) => d.includes('92')));
});

test('advisory just below the warning threshold', () => {
  const p = computePowerPosture({ gridUtilizationPct: 86, gridAlerts: [], nearbyOutageCount: null });
  assert.equal(p.level, 'advisory');
});

test('grid emergency alert is critical', () => {
  const p = computePowerPosture({ gridUtilizationPct: 50, gridAlerts: [alert('emergency')], nearbyOutageCount: 0 });
  assert.equal(p.level, 'critical');
});

test('grid warning alert is warning even at low load', () => {
  const p = computePowerPosture({ gridUtilizationPct: 50, gridAlerts: [alert('warning')], nearbyOutageCount: 0 });
  assert.equal(p.level, 'warning');
});

test('major nearby outage is critical', () => {
  const p = computePowerPosture({ gridUtilizationPct: 50, gridAlerts: [], nearbyOutageCount: 8000 });
  assert.equal(p.level, 'critical');
  assert.ok(p.drivers.some((d) => d.includes('8')));
});

test('null utilization does not throw and yields normal absent other signals', () => {
  const p = computePowerPosture({ gridUtilizationPct: null, gridAlerts: [], nearbyOutageCount: null });
  assert.equal(p.level, 'normal');
  assert.equal(p.gridUtilizationPct, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/power-posture.test.mts`
Expected: FAIL — `Cannot find module '../power-posture'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/power-posture.ts
import type { GridAlert } from '@/services/power-grid';
import type { DcLevel, PowerPosture } from './datacenter-types';
import { dcLevelRank } from './datacenter-types';

/** Tunable thresholds — named so they change without touching logic. */
export const POWER_UTIL_WARNING_PCT = 92;
export const POWER_UTIL_ADVISORY_PCT = 85;
export const NEARBY_OUTAGE_CRITICAL = 5000;
export const NEARBY_OUTAGE_WARNING = 1000;

export interface PowerPostureInput {
  gridUtilizationPct: number | null;
  gridAlerts: GridAlert[];
  nearbyOutageCount: number | null;
}

function levelForAlert(severity: GridAlert['severity']): DcLevel {
  switch (severity) {
    case 'emergency': return 'critical';
    case 'warning': return 'warning';
    case 'watch': return 'watch';
    default: return 'normal';
  }
}

function levelForUtil(pct: number | null): DcLevel {
  if (pct === null) return 'normal';
  if (pct >= POWER_UTIL_WARNING_PCT) return 'warning';
  if (pct >= POWER_UTIL_ADVISORY_PCT) return 'advisory';
  return 'normal';
}

function levelForOutage(count: number | null): DcLevel {
  if (count === null) return 'normal';
  if (count >= NEARBY_OUTAGE_CRITICAL) return 'critical';
  if (count >= NEARBY_OUTAGE_WARNING) return 'warning';
  return 'normal';
}

export function computePowerPosture(input: PowerPostureInput): PowerPosture {
  const candidates: DcLevel[] = [
    levelForUtil(input.gridUtilizationPct),
    levelForOutage(input.nearbyOutageCount),
    ...input.gridAlerts.map((a) => levelForAlert(a.severity)),
  ];
  const level = candidates.reduce<DcLevel>(
    (acc, c) => (dcLevelRank(c) > dcLevelRank(acc) ? c : acc),
    'normal',
  );

  const drivers: string[] = [];
  if (input.gridUtilizationPct !== null && input.gridUtilizationPct >= POWER_UTIL_ADVISORY_PCT) {
    drivers.push(`Grid at ${input.gridUtilizationPct}% of capacity`);
  }
  if (input.nearbyOutageCount !== null && input.nearbyOutageCount >= NEARBY_OUTAGE_WARNING) {
    drivers.push(`${(input.nearbyOutageCount / 1000).toFixed(1)}k customers out nearby`);
  }
  for (const a of input.gridAlerts) {
    if (levelForAlert(a.severity) !== 'normal') drivers.push(`${a.severity} grid alert: ${a.title}`);
  }

  return {
    level,
    gridUtilizationPct: input.gridUtilizationPct,
    gridAlerts: input.gridAlerts,
    nearbyOutageCount: input.nearbyOutageCount,
    drivers,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/power-posture.test.mts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/power-posture.ts src/services/datacenter/__tests__/power-posture.test.mts
git commit -m "feat(datacenter): power posture from grid load/alerts/outages

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Weather posture from NWS polygon match + Storm Mode

**Files:**

- Create: `src/services/datacenter/weather-posture.ts`
- Test: `src/services/datacenter/__tests__/weather-posture.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/weather-posture.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeatherPosture } from '../weather-posture';
import type { SiteConfig } from '../datacenter-types';
import type { NwsAlertMinimal, AlertPolygon } from '@/services/weather/weather-threat-types';

const SITE: SiteConfig = { id: 's1', name: 'DC1', lat: 41.6, lon: -86.7, radiusKm: 25, eiaRegion: 'MISO' };
const NOW = 1_700_000_000_000;

// A square polygon around the site (so point-in-polygon is true).
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}

function alert(event: string, polygon: AlertPolygon | undefined): NwsAlertMinimal {
  return { id: `al-${event}`, event, polygon, sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}

test('no alerts -> normal, no hazards', () => {
  const p = computeWeatherPosture(SITE, [], { now: NOW });
  assert.equal(p.level, 'normal');
  assert.deepEqual(p.activeHazards, []);
  assert.equal(p.stormMode, null);
});

test('tornado warning over the site -> critical with storm mode payload', () => {
  const p = computeWeatherPosture(SITE, [alert('Tornado Warning', around(SITE.lat, SITE.lon))], { now: NOW });
  assert.equal(p.level, 'critical');
  assert.ok(p.activeHazards.includes('tornado'));
  assert.notEqual(p.stormMode, null);
});

test('severe thunderstorm warning over the site -> warning or higher', () => {
  const p = computeWeatherPosture(SITE, [alert('Severe Thunderstorm Warning', around(SITE.lat, SITE.lon))], { now: NOW });
  assert.ok(['warning', 'critical'].includes(p.level));
  assert.ok(p.activeHazards.includes('severe_thunderstorm'));
});

test('an expired/cancelled-less alert far away does not match', () => {
  const p = computeWeatherPosture(SITE, [alert('Tornado Warning', around(10, 10))], { now: NOW });
  assert.equal(p.level, 'normal');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/weather-posture.test.mts`
Expected: FAIL — `Cannot find module '../weather-posture'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/weather-posture.ts
import type { NwsAlertMinimal, WeatherHazardKind } from '@/services/weather/weather-threat-types';
import type { SavedPlace as WeatherPlace } from '@/services/weather/weather-threat-types';
import { matchAlertToPlace } from '@/services/weather/nws-polygon-match';
import { buildStormModePayload } from '@/services/weather/personal-storm-mode';
import type { DcLevel, SiteConfig, WeatherPosture } from './datacenter-types';
import { dcLevelRank, mapThreatLevelToDc } from './datacenter-types';

export interface WeatherPostureOptions {
  now?: number;
}

export function computeWeatherPosture(
  site: SiteConfig,
  alerts: readonly NwsAlertMinimal[],
  options: WeatherPostureOptions = {},
): WeatherPosture {
  const now = options.now ?? Date.now();
  const place: WeatherPlace = { id: site.id, label: site.name, lat: site.lat, lon: site.lon, radiusKm: site.radiusKm };

  let level: DcLevel = 'normal';
  const hazards = new Set<WeatherHazardKind>();
  const drivers: string[] = [];
  let bestStormMode: WeatherPosture['stormMode'] = null;
  let bestStormRank = -1;
  let arrivalWindowMins: number | null = null;

  for (const alert of alerts) {
    const match = matchAlertToPlace(alert, place, { now });
    if (match.matchKind === 'no_match' || match.isCancellation) continue;

    const dc = mapThreatLevelToDc(match.threatLevel);
    if (dcLevelRank(dc) > dcLevelRank(level)) level = dc;
    hazards.add(match.hazardKind);
    drivers.push(`${match.event} — ${match.reason}`);

    // Build a Storm Mode payload for inside-polygon matches; keep the worst.
    if (match.matchKind === 'inside_polygon' || match.matchKind === 'near_polygon') {
      const payload = buildStormModePayload(match, site.name, { now });
      const rank = dcLevelRank(mapThreatLevelToDc(payload.threatLevel));
      if (rank > bestStormRank) {
        bestStormRank = rank;
        bestStormMode = payload;
        arrivalWindowMins = payload.arrivalWindow
          ? Math.max(0, Math.round((payload.arrivalWindow.earliestMs - now) / 60_000))
          : null;
      }
    }
  }

  return {
    level,
    activeHazards: [...hazards],
    stormMode: bestStormMode,
    arrivalWindowMins,
    drivers,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/weather-posture.test.mts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/weather-posture.ts src/services/datacenter/__tests__/weather-posture.test.mts
git commit -m "feat(datacenter): weather posture via NWS polygon match + storm mode

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Readiness action playbook (pure, pre-sorted)

**Files:**

- Create: `src/services/datacenter/readiness-actions.ts`
- Test: `src/services/datacenter/__tests__/readiness-actions.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/readiness-actions.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessActions } from '../readiness-actions';
import type { PowerPosture, WeatherPosture } from '../datacenter-types';

const NOW = 1_700_000_000_000;

function power(over: Partial<PowerPosture> = {}): PowerPosture {
  return { level: 'normal', gridUtilizationPct: 60, gridAlerts: [], nearbyOutageCount: 0, drivers: [], ...over };
}
function weather(over: Partial<WeatherPosture> = {}): WeatherPosture {
  return { level: 'normal', activeHazards: [], stormMode: null, arrivalWindowMins: null, drivers: [], ...over };
}

test('all-clear yields no actions', () => {
  const actions = buildReadinessActions(power(), weather(), { now: NOW, overall: 'normal' });
  assert.equal(actions.length, 0);
});

test('tornado over site produces a now-urgency onsite_safety shelter action, sorted first', () => {
  const actions = buildReadinessActions(
    power(),
    weather({ level: 'critical', activeHazards: ['tornado'], arrivalWindowMins: 18 }),
    { now: NOW, overall: 'critical' },
  );
  assert.ok(actions.length > 0);
  assert.equal(actions[0]!.audience, 'onsite_safety');
  assert.equal(actions[0]!.urgency, 'now');
  assert.match(actions[0]!.title, /shelter|interior/i);
});

test('safety sorts above staffing above facility ops', () => {
  const actions = buildReadinessActions(
    power({ level: 'warning', gridUtilizationPct: 94, drivers: ['Grid at 94% of capacity'] }),
    weather({ level: 'warning', activeHazards: ['ice_storm'], arrivalWindowMins: 30 }),
    { now: NOW, overall: 'warning' },
  );
  const audiences = actions.map((a) => a.audience);
  const idxSafety = audiences.indexOf('onsite_safety');
  const idxStaffing = audiences.indexOf('commute_staffing');
  const idxOps = audiences.indexOf('facility_ops');
  if (idxSafety >= 0 && idxStaffing >= 0) assert.ok(idxSafety < idxStaffing);
  if (idxStaffing >= 0 && idxOps >= 0) assert.ok(idxStaffing < idxOps);
});

test('escalation action only appears at warning or above', () => {
  const calm = buildReadinessActions(power({ level: 'advisory' }), weather({ level: 'advisory' }), { now: NOW, overall: 'advisory' });
  assert.ok(!calm.some((a) => a.audience === 'escalation'));
  const hot = buildReadinessActions(power({ level: 'warning', gridUtilizationPct: 94 }), weather(), { now: NOW, overall: 'warning' });
  assert.ok(hot.some((a) => a.audience === 'escalation'));
});

test('heat alert produces a facility_ops pre-cool be_ready action', () => {
  const actions = buildReadinessActions(power(), weather({ level: 'advisory', activeHazards: ['extreme_heat'] }), { now: NOW, overall: 'advisory' });
  const op = actions.find((a) => a.audience === 'facility_ops' && /pre-cool|hvac/i.test(a.title));
  assert.ok(op);
  assert.equal(op!.urgency, 'be_ready');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/readiness-actions.test.mts`
Expected: FAIL — `Cannot find module '../readiness-actions'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/readiness-actions.ts
import type { DcLevel, PowerPosture, ReadinessAction, WeatherPosture, ActionUrgency, ActionAudience } from './datacenter-types';
import { dcLevelRank } from './datacenter-types';
import type { WeatherHazardKind } from '@/services/weather/weather-threat-types';

export interface ReadinessContext {
  now: number;
  overall: DcLevel;
}

const AUDIENCE_RANK: Record<ActionAudience, number> = {
  onsite_safety: 0, commute_staffing: 1, facility_ops: 2, escalation: 3,
};
const URGENCY_RANK: Record<ActionUrgency, number> = {
  now: 0, soon: 1, be_ready: 2, monitor: 3,
};

const SAFETY_NOW_HAZARDS: readonly WeatherHazardKind[] = ['tornado', 'high_wind', 'tropical', 'storm_surge'];
const OUTDOOR_STOP_HAZARDS: readonly WeatherHazardKind[] = ['severe_thunderstorm', 'flash_flood', 'fire_weather', 'dust_storm'];
const COMMUTE_HAZARDS: readonly WeatherHazardKind[] = ['ice_storm', 'winter_storm', 'blizzard', 'flood', 'flash_flood'];

/** Map arrival window to urgency. Inside/imminent -> now; soon if within an
 *  hour; otherwise be_ready. */
function urgencyForArrival(mins: number | null): ActionUrgency {
  if (mins === null) return 'be_ready';
  if (mins <= 20) return 'now';
  if (mins <= 60) return 'soon';
  return 'be_ready';
}

export function buildReadinessActions(
  power: PowerPosture,
  weather: WeatherPosture,
  ctx: ReadinessContext,
): ReadinessAction[] {
  const out: ReadinessAction[] = [];
  const arrival = weather.arrivalWindowMins;
  const arrivalTrigger = arrival === null ? '' : `, ETA ${arrival} min`;

  // ── On-site personal safety ─────────────────────────────────────────────
  if (weather.activeHazards.some((h) => SAFETY_NOW_HAZARDS.includes(h))) {
    out.push({
      id: 'safety-shelter',
      audience: 'onsite_safety',
      urgency: 'now',
      title: 'Move staff to interior shelter, away from windows',
      detail: 'Destructive-wind or tornado threat over the site.',
      trigger: `${weather.activeHazards.find((h) => SAFETY_NOW_HAZARDS.includes(h))} warning polygon${arrivalTrigger}`,
      expiresAt: null,
    });
  }
  if (weather.activeHazards.some((h) => OUTDOOR_STOP_HAZARDS.includes(h))) {
    out.push({
      id: 'safety-outdoor-stop',
      audience: 'onsite_safety',
      urgency: urgencyForArrival(arrival),
      title: 'Stop all rooftop and outdoor work',
      detail: 'Lightning / severe weather risk to anyone working outside.',
      trigger: `${weather.activeHazards.find((h) => OUTDOOR_STOP_HAZARDS.includes(h))} threat near the site${arrivalTrigger}`,
      expiresAt: null,
    });
  }

  // ── Commute & staffing ──────────────────────────────────────────────────
  if (weather.activeHazards.some((h) => COMMUTE_HAZARDS.includes(h))) {
    out.push({
      id: 'staffing-travel',
      audience: 'commute_staffing',
      urgency: urgencyForArrival(arrival),
      title: 'Hold incoming shift / delay non-essential travel',
      detail: 'Ice, snow, or flooding will make the commute hazardous.',
      trigger: `${weather.activeHazards.find((h) => COMMUTE_HAZARDS.includes(h))} in the area${arrivalTrigger}`,
      expiresAt: null,
    });
  }

  // ── Facility ops readiness ──────────────────────────────────────────────
  if (weather.activeHazards.includes('extreme_heat')) {
    out.push({
      id: 'ops-precool',
      audience: 'facility_ops',
      urgency: 'be_ready',
      title: 'Pre-cool / verify HVAC headroom ahead of peak cooling load',
      detail: 'Active heat alert will push cooling demand up.',
      trigger: 'Heat alert over the site',
      expiresAt: null,
    });
  }
  const multiDaySevere = weather.activeHazards.some((h) => ['winter_storm', 'blizzard', 'ice_storm', 'tropical'].includes(h));
  if (dcLevelRank(power.level) >= dcLevelRank('advisory') || multiDaySevere) {
    out.push({
      id: 'ops-fuel',
      audience: 'facility_ops',
      urgency: 'soon',
      title: 'Confirm generator fuel; schedule refuel before the window',
      detail: power.drivers[0] ?? 'Sustained grid stress or a multi-day severe event.',
      trigger: power.drivers[0] ?? 'Multi-day severe weather window',
      expiresAt: null,
    });
  }
  if (power.gridAlerts.some((a) => a.severity === 'emergency')) {
    out.push({
      id: 'ops-transfer',
      audience: 'facility_ops',
      urgency: 'soon',
      title: 'Verify clean transfer to backup is ready',
      detail: 'A grid emergency alert is active for the region.',
      trigger: 'Grid emergency alert',
      expiresAt: null,
    });
  }

  // ── Escalation (only when overall >= warning) ───────────────────────────
  if (dcLevelRank(ctx.overall) >= dcLevelRank('warning')) {
    out.push({
      id: 'escalation-notify',
      audience: 'escalation',
      urgency: 'now',
      title: 'Notify facilities manager / on-call now',
      detail: 'Combined posture has reached warning — get a human in the loop.',
      trigger: `Overall posture: ${ctx.overall}`,
      expiresAt: null,
    });
  }

  return sortActions(out);
}

function sortActions(actions: ReadinessAction[]): ReadinessAction[] {
  return [...actions].sort((a, b) => {
    if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    return AUDIENCE_RANK[a.audience] - AUDIENCE_RANK[b.audience];
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/readiness-actions.test.mts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/readiness-actions.ts src/services/datacenter/__tests__/readiness-actions.test.mts
git commit -m "feat(datacenter): people-first readiness playbook with stable sort

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Posture orchestrator (blend + headline + stale honesty)

**Files:**

- Create: `src/services/datacenter/datacenter-posture.ts`
- Test: `src/services/datacenter/__tests__/datacenter-posture.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/datacenter-posture.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDatacenterPosture } from '../datacenter-posture';
import type { SiteConfig } from '../datacenter-types';
import type { NwsAlertMinimal, AlertPolygon } from '@/services/weather/weather-threat-types';
import type { GridStatus } from '@/services/power-grid';

const SITE: SiteConfig = { id: 's1', name: 'DC1', lat: 41.6, lon: -86.7, radiusKm: 25, eiaRegion: 'MISO' };
const NOW = 1_700_000_000_000;

function gridStatus(util: number): GridStatus {
  return { region: 'MISO', demand: util, capacity: 100, utilizationPct: util, alerts: [], lastUpdate: NOW };
}
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function alert(event: string): NwsAlertMinimal {
  return { id: event, event, polygon: around(SITE.lat, SITE.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}

test('all clear: overall normal, headline mentions monitoring, no actions', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(55), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(p.overall, 'normal');
  assert.equal(p.actions.length, 0);
  assert.match(p.headline, /monitor/i);
});

test('grid-only stress: overall follows power level', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(94), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(p.overall, 'warning');
});

test('weather-only warning: overall follows weather level', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(55), weatherAlerts: [alert('Severe Thunderstorm Warning')], nearbyOutageCount: 0, now: NOW });
  assert.ok(['warning', 'critical'].includes(p.overall));
});

test('both elevated bumps one rung above the higher input (amplifier)', () => {
  // power advisory (88%) + weather advisory (winter weather advisory) -> warning
  const winterAdvisory: NwsAlertMinimal = { id: 'wx', event: 'Winter Weather Advisory', polygon: around(SITE.lat, SITE.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(88), weatherAlerts: [winterAdvisory], nearbyOutageCount: 0, now: NOW });
  assert.equal(p.power.level, 'advisory');
  assert.equal(p.weather.level, 'advisory');
  assert.equal(p.overall, 'warning'); // bumped from advisory
});

test('stale/missing grid feed is reported in staleInputs, not hidden', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: null, weatherAlerts: [], nearbyOutageCount: null, now: NOW });
  assert.ok(p.staleInputs.includes('grid'));
  assert.equal(p.power.gridUtilizationPct, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-posture.test.mts`
Expected: FAIL — `Cannot find module '../datacenter-posture'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/datacenter-posture.ts
import type { GridStatus } from '@/services/power-grid';
import type { NwsAlertMinimal } from '@/services/weather/weather-threat-types';
import type { DataCenterPosture, DcLevel, SiteConfig } from './datacenter-types';
import { bumpDcLevel, dcLevelRank, maxDcLevel } from './datacenter-types';
import { computePowerPosture } from './power-posture';
import { computeWeatherPosture } from './weather-posture';
import { buildReadinessActions } from './readiness-actions';

export interface PostureInput {
  site: SiteConfig;
  /** Grid status for the site's region, or null when the feed is stale/missing. */
  gridStatus: GridStatus | null;
  weatherAlerts: readonly NwsAlertMinimal[];
  /** Customers out within the site radius, or null until the rollup is wired. */
  nearbyOutageCount: number | null;
  now?: number;
}

function blendOverall(power: DcLevel, weather: DcLevel): DcLevel {
  const higher = maxDcLevel(power, weather);
  const bothElevated = dcLevelRank(power) >= dcLevelRank('advisory') && dcLevelRank(weather) >= dcLevelRank('advisory');
  return bothElevated ? bumpDcLevel(higher) : higher;
}

function buildHeadline(overall: DcLevel, weather: ReturnType<typeof computeWeatherPosture>, power: ReturnType<typeof computePowerPosture>): string {
  if (overall === 'normal') return 'No power or weather action needed — monitoring';
  const parts: string[] = [];
  if (weather.stormMode) {
    const mins = weather.arrivalWindowMins;
    parts.push(mins !== null ? `${weather.stormMode.mainThreatLabel} ~${mins} min out` : weather.stormMode.mainThreatLabel);
  } else if (weather.activeHazards.length > 0) {
    parts.push(`${weather.activeHazards[0]} nearby`);
  }
  parts.push(power.level === 'normal' ? 'grid normal' : `grid ${power.level}`);
  return parts.join(' · ');
}

export function computeDatacenterPosture(input: PostureInput): DataCenterPosture {
  const now = input.now ?? Date.now();
  const staleInputs: string[] = [];
  if (!input.gridStatus) staleInputs.push('grid');
  if (input.nearbyOutageCount === null) staleInputs.push('outages');

  const power = computePowerPosture({
    gridUtilizationPct: input.gridStatus ? input.gridStatus.utilizationPct : null,
    gridAlerts: input.gridStatus ? input.gridStatus.alerts : [],
    nearbyOutageCount: input.nearbyOutageCount,
  });
  const weather = computeWeatherPosture(input.site, input.weatherAlerts, { now });
  const overall = blendOverall(power.level, weather.level);
  const actions = buildReadinessActions(power, weather, { now, overall });

  return {
    site: input.site,
    overall,
    headline: buildHeadline(overall, weather, power),
    power,
    weather,
    actions,
    updatedAt: now,
    staleInputs,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-posture.test.mts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/datacenter-posture.ts src/services/datacenter/__tests__/datacenter-posture.test.mts
git commit -m "feat(datacenter): posture orchestrator with compound amplifier + stale honesty

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Site resolution + `data_center` saved-place tag

**Files:**

- Modify: `src/services/saved-places.ts:4` (add `data_center` to `SavedPlaceTag`) and `src/services/saved-places.ts:46` (add it to `VALID_TAGS`)
- Create: `src/services/datacenter/site-resolver.ts`
- Test: `src/services/datacenter/__tests__/site-resolver.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/site-resolver.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eiaRegionForLatLon, resolveSiteConfig } from '../site-resolver';
import type { SavedPlace } from '@/services/saved-places';

function place(over: Partial<SavedPlace>): SavedPlace {
  return {
    id: 'p1', name: 'Site', lat: 41.6, lon: -86.7, radiusKm: 25, tags: ['data_center'],
    priority: 0, notes: '', offlinePinned: false, primary: false, source: 'manual',
    sortIndex: 0, createdAt: 0, updatedAt: 0, ...over,
  };
}

test('eiaRegionForLatLon maps Texas to ERCO and California to CISO', () => {
  assert.equal(eiaRegionForLatLon(31.0, -99.0), 'ERCO');   // central Texas
  assert.equal(eiaRegionForLatLon(37.0, -120.0), 'CISO');  // central California
});

test('eiaRegionForLatLon falls back to MISO for the central US', () => {
  assert.equal(eiaRegionForLatLon(41.6, -86.7), 'MISO');   // northern Indiana
});

test('resolveSiteConfig picks the data_center-tagged place', () => {
  const places = [place({ id: 'home', tags: ['home'] }), place({ id: 'dc', name: 'DC1', tags: ['data_center'] })];
  const site = resolveSiteConfig(places);
  assert.equal(site?.id, 'dc');
  assert.equal(site?.name, 'DC1');
  assert.equal(site?.eiaRegion, 'MISO');
});

test('resolveSiteConfig returns null when no place is tagged', () => {
  assert.equal(resolveSiteConfig([place({ tags: ['home'] })]), null);
});

test('resolveSiteConfig breaks ties by highest priority', () => {
  const places = [place({ id: 'a', priority: 1 }), place({ id: 'b', priority: 5 })];
  assert.equal(resolveSiteConfig(places)?.id, 'b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/site-resolver.test.mts`
Expected: FAIL — `Cannot find module '../site-resolver'` and a type error on `'data_center'`.

- [ ] **Step 3a: Add the tag to the saved-places union and validator**

In `src/services/saved-places.ts:4`, change the union to include `'data_center'`:

```ts
export type SavedPlaceTag = 'home' | 'work' | 'family' | 'bugout' | 'travel' | 'medical' | 'supply' | 'concern' | 'school' | 'shelter' | 'critical' | 'data_center';
```

In `src/services/saved-places.ts:46`, add `'data_center'` to the `VALID_TAGS` set:

```ts
const VALID_TAGS = new Set<SavedPlaceTag>(['home', 'work', 'family', 'bugout', 'travel', 'medical', 'supply', 'concern', 'school', 'shelter', 'critical', 'data_center']);
```

- [ ] **Step 3b: Write the resolver**

```ts
// src/services/datacenter/site-resolver.ts
import type { SavedPlace } from '@/services/saved-places';
import { EIA_REGIONS, type EiaRegion } from '@/services/infrastructure/grid-monitor';
import type { SiteConfig } from './datacenter-types';

/** Static, deterministic US lat/lon -> EIA balancing-authority lookup. Covers
 *  the five regions grid-monitor tracks; everything else falls back to MISO
 *  (the largest central-US authority). A manual override lives in the editor
 *  for edge cases (handled at the UI layer, not here). */
export function eiaRegionForLatLon(lat: number, lon: number): EiaRegion {
  // Texas (ERCOT) — roughly the state bounding box.
  if (lat >= 25.8 && lat <= 36.6 && lon >= -106.7 && lon <= -93.5) return 'ERCO';
  // California (CAISO).
  if (lat >= 32.5 && lat <= 42.1 && lon >= -124.5 && lon <= -114.1) return 'CISO';
  // New York (NYISO).
  if (lat >= 40.4 && lat <= 45.1 && lon >= -79.8 && lon <= -71.8) return 'NYIS';
  // PJM — Mid-Atlantic / Ohio Valley.
  if (lat >= 36.5 && lat <= 42.5 && lon >= -85.0 && lon <= -74.0) return 'PJM';
  return 'MISO';
}

export function resolveSiteConfig(places: readonly SavedPlace[]): SiteConfig | null {
  const tagged = places.filter((p) => p.tags.includes('data_center'));
  if (tagged.length === 0) return null;
  const chosen = [...tagged].sort((a, b) => b.priority - a.priority || a.sortIndex - b.sortIndex)[0]!;
  return {
    id: chosen.id,
    name: chosen.name,
    lat: chosen.lat,
    lon: chosen.lon,
    radiusKm: chosen.radiusKm,
    eiaRegion: eiaRegionForLatLon(chosen.lat, chosen.lon),
  };
}

/** Exposed for the override editor. */
export const SUPPORTED_EIA_REGIONS: readonly EiaRegion[] = EIA_REGIONS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/site-resolver.test.mts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/saved-places.ts src/services/datacenter/site-resolver.ts src/services/datacenter/__tests__/site-resolver.test.mts
git commit -m "feat(datacenter): data_center tag + site resolution with EIA region lookup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: State singleton (recompute + subscribe)

**Files:**

- Create: `src/services/datacenter/datacenter-state.ts`
- Test: `src/services/datacenter/__tests__/datacenter-state.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/datacenter-state.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setDatacenterSite, getDatacenterPosture, recomputeDatacenterPosture,
  subscribeDatacenterPosture, __resetDatacenterStateForTests,
} from '../datacenter-state';
import type { SiteConfig } from '../datacenter-types';
import type { GridStatus } from '@/services/power-grid';

const SITE: SiteConfig = { id: 's1', name: 'DC1', lat: 41.6, lon: -86.7, radiusKm: 25, eiaRegion: 'MISO' };
const NOW = 1_700_000_000_000;
function gridStatus(util: number): GridStatus {
  return { region: 'MISO', demand: util, capacity: 100, utilizationPct: util, alerts: [], lastUpdate: NOW };
}

test('posture is null until a site is set', () => {
  __resetDatacenterStateForTests();
  assert.equal(getDatacenterPosture(), null);
});

test('recompute produces a posture and notifies subscribers', () => {
  __resetDatacenterStateForTests();
  setDatacenterSite(SITE);
  let notified = 0;
  const unsub = subscribeDatacenterPosture(() => { notified += 1; });
  recomputeDatacenterPosture({ gridStatus: gridStatus(94), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(getDatacenterPosture()?.overall, 'warning');
  assert.ok(notified >= 1);
  unsub();
});

test('recompute is a no-op (returns null) when no site is configured', () => {
  __resetDatacenterStateForTests();
  const result = recomputeDatacenterPosture({ gridStatus: gridStatus(94), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(result, null);
  assert.equal(getDatacenterPosture(), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-state.test.mts`
Expected: FAIL — `Cannot find module '../datacenter-state'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/datacenter-state.ts
import type { GridStatus } from '@/services/power-grid';
import type { NwsAlertMinimal } from '@/services/weather/weather-threat-types';
import type { DataCenterPosture, SiteConfig } from './datacenter-types';
import { computeDatacenterPosture } from './datacenter-posture';

type Listener = (posture: DataCenterPosture | null) => void;

let site: SiteConfig | null = null;
let posture: DataCenterPosture | null = null;
const listeners = new Set<Listener>();

export function setDatacenterSite(next: SiteConfig | null): void {
  site = next;
  if (next === null) {
    posture = null;
    emit();
  }
}

export function getDatacenterSite(): SiteConfig | null {
  return site;
}

export function getDatacenterPosture(): DataCenterPosture | null {
  return posture;
}

export interface RecomputeInput {
  gridStatus: GridStatus | null;
  weatherAlerts: readonly NwsAlertMinimal[];
  nearbyOutageCount: number | null;
  now?: number;
}

export function recomputeDatacenterPosture(input: RecomputeInput): DataCenterPosture | null {
  if (!site) return null;
  posture = computeDatacenterPosture({ site, ...input });
  emit();
  return posture;
}

export function subscribeDatacenterPosture(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const l of listeners) l(posture);
}

/** Test-only reset. */
export function __resetDatacenterStateForTests(): void {
  site = null;
  posture = null;
  listeners.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-state.test.mts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/datacenter-state.ts src/services/datacenter/__tests__/datacenter-state.test.mts
git commit -m "feat(datacenter): state singleton with recompute + subscribe

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: View helpers (pure formatting for both surfaces)

**Files:**

- Create: `src/services/datacenter/datacenter-view.ts`
- Test: `src/services/datacenter/__tests__/datacenter-view.test.mts`

These pure helpers keep all string/label/color logic out of the DOM renderers (Tasks 9–10), so they're unit-testable without a DOM.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/datacenter/__tests__/datacenter-view.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelLabel, levelColor, levelDotClass, stripSummary, actionsNowCount } from '../datacenter-view';
import type { DataCenterPosture } from '../datacenter-types';

const BASE: DataCenterPosture = {
  site: { id: 's', name: 'DC1', lat: 0, lon: 0, radiusKm: 25, eiaRegion: 'MISO' },
  overall: 'warning',
  headline: 'Severe storm ~30 min out · grid normal',
  power: { level: 'normal', gridUtilizationPct: 60, gridAlerts: [], nearbyOutageCount: 0, drivers: [] },
  weather: { level: 'warning', activeHazards: ['severe_thunderstorm'], stormMode: null, arrivalWindowMins: 30, drivers: [] },
  actions: [
    { id: 'a', audience: 'onsite_safety', urgency: 'now', title: 'Shelter', detail: '', trigger: '', expiresAt: null },
    { id: 'b', audience: 'facility_ops', urgency: 'soon', title: 'Fuel', detail: '', trigger: '', expiresAt: null },
  ],
  updatedAt: 0,
  staleInputs: [],
};

test('levelLabel renders human text', () => {
  assert.equal(levelLabel('normal'), 'All clear');
  assert.equal(levelLabel('critical'), 'Critical');
});

test('levelColor + levelDotClass return distinct values per level', () => {
  assert.notEqual(levelColor('normal'), levelColor('critical'));
  assert.match(levelDotClass('warning'), /warning/);
});

test('actionsNowCount counts only now-urgency actions', () => {
  assert.equal(actionsNowCount(BASE), 1);
});

test('stripSummary is a single line with name, level, headline, and now-count', () => {
  const s = stripSummary(BASE);
  assert.match(s, /DC1/);
  assert.match(s, /Severe storm/);
  assert.match(s, /1 action/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-view.test.mts`
Expected: FAIL — `Cannot find module '../datacenter-view'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/datacenter/datacenter-view.ts
import type { DataCenterPosture, DcLevel } from './datacenter-types';

const LEVEL_LABELS: Record<DcLevel, string> = {
  normal: 'All clear', watch: 'Watch', advisory: 'Advisory', warning: 'Warning', critical: 'Critical',
};
const LEVEL_COLORS: Record<DcLevel, string> = {
  normal: '#22c55e', watch: '#eab308', advisory: '#f59e0b', warning: '#f97316', critical: '#ef4444',
};

export function levelLabel(level: DcLevel): string {
  return LEVEL_LABELS[level];
}
export function levelColor(level: DcLevel): string {
  return LEVEL_COLORS[level];
}
export function levelDotClass(level: DcLevel): string {
  return `dc-dot dc-dot--${level}`;
}
export function actionsNowCount(posture: DataCenterPosture): number {
  return posture.actions.filter((a) => a.urgency === 'now').length;
}
export function stripSummary(posture: DataCenterPosture): string {
  const n = actionsNowCount(posture);
  const actionPart = n === 1 ? '1 action now' : `${n} actions now`;
  return `${posture.site.name} · ${levelLabel(posture.overall)} · ${posture.headline} · ${actionPart}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/datacenter/__tests__/datacenter-view.test.mts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/datacenter/datacenter-view.ts src/services/datacenter/__tests__/datacenter-view.test.mts
git commit -m "feat(datacenter): pure view helpers for strip + panel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Full panel (`DataCenterReadinessPanel`)

**Files:**

- Create: `src/components/DataCenterReadinessPanel.ts`
- Test: `src/services/datacenter/__tests__/datacenter-view.test.mts` already covers the formatting logic; the panel itself is a thin renderer with no decision logic, so it is exercised by the smoke harness (Task 11). No new unit test — the renderer holds no branchable logic beyond delegating to view helpers.

> **Renderer rule (applies to Tasks 9 & 10):** build DOM with `h()` / `replaceChildren()` from `src/utils/dom-utils` and set text via `textContent` / `h(tag, props, stringChild)` (which appends a text node). Do **not** assign `innerHTML` with interpolated data. This matches `Panel.ts`'s own internal style and keeps user/site/headline strings inert.

- [ ] **Step 1: Write the panel**

```ts
// src/components/DataCenterReadinessPanel.ts
import { Panel } from './Panel';
import { h, replaceChildren } from '../utils/dom-utils';
import {
  getDatacenterPosture, subscribeDatacenterPosture,
} from '../services/datacenter/datacenter-state';
import { levelLabel, levelColor } from '../services/datacenter/datacenter-view';
import type { DataCenterPosture, ReadinessAction } from '../services/datacenter/datacenter-types';

const URGENCY_LABEL: Record<ReadinessAction['urgency'], string> = {
  now: 'NOW', soon: 'SOON', be_ready: 'BE READY', monitor: 'MONITOR',
};
const AUDIENCE_LABEL: Record<ReadinessAction['audience'], string> = {
  onsite_safety: 'On-site safety', commute_staffing: 'Commute & staffing',
  facility_ops: 'Facility ops', escalation: 'Escalation',
};

export class DataCenterReadinessPanel extends Panel {
  private unsub: (() => void) | null = null;

  constructor() {
    super({ id: 'datacenter-readiness', title: 'Data Center Readiness', showCount: true });
    this.unsub = subscribeDatacenterPosture((p) => this.render(p));
    this.render(getDatacenterPosture());
  }

  private render(posture: DataCenterPosture | null): void {
    if (!posture) {
      replaceChildren(this.content,
        h('div', { className: 'dc-empty' }, 'Set your data center location (tag a saved place “data_center”) to activate this panel.'),
      );
      this.setCount(0);
      return;
    }

    this.setCount(posture.actions.filter((a) => a.urgency === 'now').length);

    const header = h('div', { className: 'dc-status-header' },
      this.gauge('Power', posture.power.level, posture.power.drivers[0] ?? '—'),
      this.gauge(
        'Weather',
        posture.weather.level,
        posture.weather.arrivalWindowMins !== null ? `ETA ${posture.weather.arrivalWindowMins} min` : (posture.weather.drivers[0] ?? '—'),
      ),
    );

    const actionList = posture.actions.length === 0
      ? h('div', { className: 'dc-allclear' }, 'No power or weather action needed — monitoring.')
      : h('div', { className: 'dc-actions' }, ...posture.actions.map((a) => this.actionRow(a)));

    const footerParts: string[] = [];
    if (posture.staleInputs.length > 0) footerParts.push(`Stale/missing: ${posture.staleInputs.join(', ')}`);
    const footer = h('div', { className: 'dc-footer' }, footerParts.join(' · ') || 'All feeds current');

    replaceChildren(this.content, header, actionList, footer);
    this.markFresh();
  }

  private gauge(label: string, level: DataCenterPosture['overall'], detail: string): HTMLElement {
    const dot = h('span', { className: 'dc-gauge-dot' });
    dot.style.background = levelColor(level);
    return h('div', { className: 'dc-gauge' },
      h('div', { className: 'dc-gauge-top' }, dot, h('span', { className: 'dc-gauge-label' }, label), h('span', { className: 'dc-gauge-level' }, levelLabel(level))),
      h('div', { className: 'dc-gauge-detail' }, detail),
    );
  }

  private actionRow(a: ReadinessAction): HTMLElement {
    const badge = h('span', { className: `dc-urgency dc-urgency--${a.urgency}` }, URGENCY_LABEL[a.urgency]);
    return h('div', { className: `dc-action dc-action--${a.audience}` },
      h('div', { className: 'dc-action-head' }, badge, h('span', { className: 'dc-action-aud' }, AUDIENCE_LABEL[a.audience])),
      h('div', { className: 'dc-action-title' }, a.title),
      a.detail ? h('div', { className: 'dc-action-detail' }, a.detail) : null,
      a.trigger ? h('div', { className: 'dc-action-trigger' }, a.trigger) : null,
    );
  }

  public destroy(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    super.destroy();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck:all`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DataCenterReadinessPanel.ts
git commit -m "feat(datacenter): full readiness panel (safe-DOM renderer)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Pinned mini-strip (`DataCenterPinnedStrip`)

**Files:**

- Create: `src/components/DataCenterPinnedStrip.ts`

- [ ] **Step 1: Write the strip**

```ts
// src/components/DataCenterPinnedStrip.ts
import { h, replaceChildren } from '../utils/dom-utils';
import {
  getDatacenterPosture, getDatacenterSite, subscribeDatacenterPosture,
} from '../services/datacenter/datacenter-state';
import { levelColor, stripSummary } from '../services/datacenter/datacenter-view';
import type { DataCenterPosture } from '../services/datacenter/datacenter-types';
import { dcLevelRank } from '../services/datacenter/datacenter-types';

/**
 * Thin always-visible strip docked above the panel grid (outside the scroll
 * region). Pure renderer — reads the singleton, never decides anything.
 * Pulses only at warning+; respects prefers-reduced-motion via CSS.
 */
export class DataCenterPinnedStrip {
  private readonly el: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(private readonly onExpand?: () => void) {
    this.el = h('div', { className: 'dc-strip', role: 'status', 'aria-live': 'polite' });
    this.el.addEventListener('click', () => this.onExpand?.());
    this.unsub = subscribeDatacenterPosture((p) => this.render(p));
    this.render(getDatacenterPosture());
  }

  public getElement(): HTMLElement {
    return this.el;
  }

  private render(posture: DataCenterPosture | null): void {
    // No site configured → discoverable CTA, never a fake all-clear.
    if (!getDatacenterSite()) {
      this.el.className = 'dc-strip dc-strip--cta';
      replaceChildren(this.el, h('span', { className: 'dc-strip-text' }, 'Set your data center location'));
      return;
    }
    if (!posture) {
      this.el.className = 'dc-strip dc-strip--cta';
      replaceChildren(this.el, h('span', { className: 'dc-strip-text' }, 'Data center readiness — awaiting data'));
      return;
    }

    const elevated = dcLevelRank(posture.overall) >= dcLevelRank('warning');
    this.el.className = `dc-strip dc-strip--${posture.overall}${elevated ? ' dc-strip--pulse' : ''}`;

    const dot = h('span', { className: 'dc-strip-dot' });
    dot.style.background = levelColor(posture.overall);
    replaceChildren(this.el,
      dot,
      h('span', { className: 'dc-strip-text' }, stripSummary(posture)),
    );
  }

  public destroy(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.el.remove();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck:all`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DataCenterPinnedStrip.ts
git commit -m "feat(datacenter): pinned readiness mini-strip (safe-DOM renderer)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Wiring — register panel, mount strip, feed recompute

**Files:**

- Modify: `src/config/panels.ts` (register the panel)
- Modify: `src/app/panel-layout.ts` (instantiate the panel + mount the strip + boot site resolution)
- Modify: `src/app/data-loader.ts` (call `recomputeDatacenterPosture` after weather/grid refresh)

Read each file's existing structure first; follow the local pattern. The exact anchor lines below were verified against the current source — confirm they still match before editing.

- [ ] **Step 1: Register the panel in `config/panels.ts`**

In the `FULL_PANELS` record (starts `src/config/panels.ts:9`), add a top-priority entry near the other `priority: 1` panels:

```ts
  'datacenter-readiness': { name: 'Data Center Readiness', enabled: true, priority: 1 },
```

If the file also maintains a `PANEL_CATEGORY_MAP`, add `'datacenter-readiness'` to the most fitting existing category (e.g. the infrastructure/risk group) following the surrounding entries.

- [ ] **Step 2: Instantiate panel + strip + resolve site in `panel-layout.ts`**

Near where other panels are constructed (e.g. around `src/app/panel-layout.ts:1043`), add:

```ts
import { DataCenterReadinessPanel } from '@/components/DataCenterReadinessPanel';
import { DataCenterPinnedStrip } from '@/components/DataCenterPinnedStrip';
import { resolveSiteConfig } from '@/services/datacenter/site-resolver';
import { setDatacenterSite } from '@/services/datacenter/datacenter-state';
import { getSavedPlaces, subscribeSavedPlaces } from '@/services/saved-places';

// ...inside the bootstrap/instantiation block:
setDatacenterSite(resolveSiteConfig(getSavedPlaces()));
subscribeSavedPlaces((places) => setDatacenterSite(resolveSiteConfig(places)));

const datacenterPanel = new DataCenterReadinessPanel();
this.ctx.panels['datacenter-readiness'] = datacenterPanel;
// register in the panel grid the same way sibling panels are registered

// Pinned strip — mount above the panel grid, outside the scroll region.
const dcStrip = new DataCenterPinnedStrip(() => {
  datacenterPanel.getElement().scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const gridContainer = document.querySelector('.panels-grid');
gridContainer?.parentElement?.insertBefore(dcStrip.getElement(), gridContainer);
```

Match the surrounding registration idiom (how the file pushes panels into its grid / `this.ctx.panels`). The strip mount target is whatever element directly wraps `.panels-grid`; if the layout uses a named chrome container, prefer that.

- [ ] **Step 3: Feed recompute from `data-loader.ts`**

`loadWeatherAlerts()` (around `src/app/data-loader.ts:1419`) already lands `NwsAlertMinimal`-shaped alerts and calls `updateStormPreparednessContext({ weatherAlerts: alerts })` at line 1427. Immediately after that call, recompute the datacenter posture from the freshest grid + weather data:

```ts
import { recomputeDatacenterPosture } from '@/services/datacenter/datacenter-state';
import { fetchGridStatus } from '@/services/power-grid';
import { getDatacenterSite } from '@/services/datacenter/datacenter-state';

// ...after updateStormPreparednessContext({ weatherAlerts: alerts }); in loadWeatherAlerts():
if (getDatacenterSite()) {
  const site = getDatacenterSite()!;
  const grid = await fetchGridStatus().catch(() => null);
  const gridStatus = grid?.find((g) => g.region === site.eiaRegion) ?? null;
  recomputeDatacenterPosture({
    gridStatus,
    weatherAlerts: alerts as unknown as import('@/services/weather/weather-threat-types').NwsAlertMinimal[],
    nearbyOutageCount: null, // v1: county-radius outage rollup not yet wired (honest gap, see spec)
  });
}
```

If `fetchWeatherAlerts()` returns a shape that isn't exactly `NwsAlertMinimal`, add a small local adapter mapping `{ id, event, polygon, sent, expires }` rather than an `as` cast — confirm the alert object's fields when implementing.

- [ ] **Step 4: Type-check + run the new suite**

Run:

```bash
npm run typecheck:all
npx tsx --test src/services/datacenter/__tests__/*.test.mts
```

Expected: zero type errors; all datacenter tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts
git commit -m "feat(datacenter): wire panel + pinned strip into layout and refresh loop

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Test script, docs freshness, and final verification

**Files:**

- Modify: `package.json` (add `test:datacenter`)
- Modify: `CLAUDE.md` and/or `README` panel-count references as `npm run docs:check` requires
- Modify: `docs/superpowers/specs/2026-06-07-datacenter-readiness-panel-design.md` only if an implementation detail diverged (keep spec and code consistent)

- [ ] **Step 1: Add the test script**

In `package.json`, alongside the other `test:*` scripts, add:

```json
    "test:datacenter": "tsx --test src/services/datacenter/__tests__/datacenter-types.test.mts src/services/datacenter/__tests__/power-posture.test.mts src/services/datacenter/__tests__/weather-posture.test.mts src/services/datacenter/__tests__/readiness-actions.test.mts src/services/datacenter/__tests__/datacenter-posture.test.mts src/services/datacenter/__tests__/site-resolver.test.mts src/services/datacenter/__tests__/datacenter-state.test.mts src/services/datacenter/__tests__/datacenter-view.test.mts",
```

- [ ] **Step 2: Run the full datacenter suite via the new script**

Run: `npm run test:datacenter`
Expected: PASS — all eight test files green.

- [ ] **Step 3: Update docs for the new panel + tag**

Add the `src/services/datacenter/` layer to the architecture section of `CLAUDE.md` (one bullet per module, matching the existing service-layer descriptions) and note the new `data_center` SavedPlaceTag and the `datacenter-readiness` panel.

- [ ] **Step 4: Run docs freshness + typecheck**

Run:

```bash
npm run docs:check
npm run typecheck:all
```

Expected: `docs:check` passes (bump any panel-count assertion it flags); zero type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json CLAUDE.md
git commit -m "chore(datacenter): test:datacenter script + docs freshness

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-review notes (author checklist — already applied)

- **Spec coverage:** external-only inputs (T2/T3/T5), one configured site (T6 tag + resolver), people-first sort (T4 + test), pinned strip + full panel (T9/T10), blend amplifier (T5 test), stale honesty (T5 test), all-clear collapse (T9 + T5 headline), site CTA when unconfigured (T10), `test:datacenter` (T12) — all mapped.
- **Type consistency:** `DcLevel`, `mapThreatLevelToDc`, `computePowerPosture`, `computeWeatherPosture`, `buildReadinessActions`, `computeDatacenterPosture`, `recomputeDatacenterPosture` names are identical across every task that references them. `SavedPlace` is used as the *store* shape in T6/T11 and the *weather matcher* shape (`WeatherPlace`) is built inline in T3 — kept deliberately distinct.
- **Security hook:** every renderer (T9/T10) uses `h()`/`replaceChildren()` + `textContent`-style children, never `innerHTML` with interpolated data — matching `Panel.ts`.
- **Known v1 gap (honest, not silent):** `nearbyOutageCount` is `null` until a county-radius outage rollup is wired; surfaced via `staleInputs`/`drivers`, documented in T11 Step 3.
