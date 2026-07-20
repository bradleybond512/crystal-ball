# Phase 1: Home Shell Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the new home surface (map canvas + three briefing bands + pinned panel Deck + status ribbon) behind a `crystalball-home-shell` localStorage flag, with the old sidebar UI unchanged and default.

**Architecture:** A full-screen overlay component (`HomeShellOverlay`) mounts on `document.body` following the app's existing overlay pattern (CommandPalettePanel/TodayView). All composition logic lives in three new pure view-models under `src/services/home-shell/` (house `*-view.ts` pattern: no DOM, no fetch, caller-supplied `now`, fixture unit tests). The overlay reads existing singletons (`insights-state`, `command-center/what-changed`, diagnostics registries) on a 10s `registerRecurringLoop` tick, and reparents the existing live map DOM node into its backdrop slot when shown. The existing ⌘K command palette is reused as-is — it already has one command per panel. **All DOM is built with `createElement`/`textContent` (never HTML-string sinks), matching CommandPalettePanel and the repo's HTML-sink governance policy.**

**Tech Stack:** TypeScript, Vite, `node:test` via `tsx --test` (`.test.mts` in `__tests__/` dirs), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md`

---

## Verified codebase facts (do not re-derive)

- **⌘K palette already exists.** `src/components/CommandPalettePanel.ts`, wired at `panel-layout.ts:1243-1245`, toggled via `document.dispatchEvent(new CustomEvent('cb:toggle-cmdk'))`. `src/services/command-palette/built-in-commands.ts:57-68` already registers one `panel:<key>` command per `DEFAULT_PANELS` entry. **Do not build a palette.**
- **Panel navigation event:** `document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey } }))` — wired at `panel-layout.ts:1246-1255`.
- **What-changed store:** `src/services/command-center/what-changed.ts` — `recordSnapshot(snapshot)`, `getWhatChanged(sinceMs): WhatChangedEvent[]`, `formatDelta(event): string`. (The spec's `what-changed-digest.ts` name is stale; this is the real module, used by CommandCenterPanel.)
- **Insights singletons** (`src/services/insights/insights-state.ts`): `getPersonalImpactReport(): PersonalImpactReport`, `getActiveSituation(): SituationDescriptor | undefined`, `getRecentEvents(): readonly IncomingEvent[]`, `getPersonalProfile(): PersonalProfile`. No subscribe mechanism — poll (CommandCenterPanel polls at 10s).
- **Status ribbon recipe** — copy of `panel-layout.ts:632-649`: `getLiveDiagnosticsSnapshot()` + `contextFromSnapshots(...)` + `getFeatureHealthRegistry().all(ctx)` + `aggregateSystemHealth({...})` → `report.status` / `report.summary`.
- **PanelHealth** (`src/services/diagnostics/system-health-types.ts:88`): `{ panelId, label?, status: HealthStatus, mounted, enabled, visible, lastRenderAt?, lastError?, ... }`. Registry: `getPanelHealthRegistry()` from `diagnostics-state.ts`, exposes `all()`.
- **Recurring loops:** `registerRecurringLoop(name, fn, intervalMs, { priority, runImmediately }): LoopHandle` from `src/services/diagnostics/recurring-loops.ts`; `LoopHandle.cancel()`. Always use this for ticks (HMR-safe, hidden-tab-aware).
- **Storage:** `safeSetItem(key, value)` from `src/utils/safe-storage.ts:119`. `STORAGE_KEYS` in `src/config/panels.ts:1324`. Flag pattern: mirror `window.beta` at `src/main.ts:372-384`.
- **Map:** lives in `<div class="map-container" id="mapContainer">`; owned by MapContainer created at `panel-layout.ts:1290`. MapLibre auto-resizes via ResizeObserver.
- **Tests:** `node:test` flat `test()` + `node:assert/strict`, files `src/services/<mod>/__tests__/<name>.test.mts`, imports with explicit `.ts` extensions, inline `Partial<T>`-override builders, frozen `NOW` constant. Test files are NOT typechecked by `typecheck:all` (excluded) — write test types carefully.
- **Shortcuts:** central registry in `src/services/keyboard/shortcut-registry.ts`; bindings registered in `src/services/keyboard/shortcut-bootstrap.ts:37+` (`installShortcuts`, called from `panel-layout.ts:1259`).
- **DOM construction:** build nodes with `document.createElement` + `textContent` (CommandPalettePanel pattern). Never assign HTML strings to element sinks in new code; `escapeHtml`/`sanitizeHtml` from `@/utils` exist for legacy call sites only.
- Imports in `src/services/**` use relative paths with `.ts` extensions; `src/components/**` and `src/app/**` use `@/` aliases. Match the file you're editing.

## File structure

```
src/services/home-shell/briefing-view.ts        (new — pure view-model, 3 bands)
src/services/home-shell/deck-view.ts            (new — pure pin state + card derivation)
src/services/home-shell/status-ribbon-view.ts   (new — pure ribbon formatter)
src/services/home-shell/__tests__/*.test.mts    (new — fixture tests for the above)
src/components/HomeShellOverlay.ts              (new — DOM composition, poll loop)
src/styles/home-shell.css                       (new — near-black skin, scoped .home-shell)
src/components/Panel.ts                         (modify — add getNarrative())
src/config/panels.ts                            (modify — STORAGE_KEYS.deckPins)
src/main.ts                                     (modify — flag setter + css import)
src/app/panel-layout.ts                         (modify — conditional mount)
src/services/keyboard/shortcut-bootstrap.ts     (modify — ⌘⇧H binding)
package.json                                    (modify — test:homeshell script)
```

Work on the existing branch `claude/ui-shell-reimagination-spec` in `.worktrees/ui-shell-spec` (or a fresh `claude/phase1-home-shell` branch from it). **All `git` commands must run inside the worktree** (`cd` in the same command or `git -C`).

---

### Task 1: `briefing-view.ts` — pure view-model for the three bands

**Files:**
- Create: `src/services/home-shell/briefing-view.ts`
- Test: `src/services/home-shell/__tests__/briefing-view.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/home-shell/__tests__/briefing-view.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBriefingView, CRITICAL_EVENT_FLOOR } from '../briefing-view.ts';
import type { BriefingInput, HighSeverityEvent } from '../briefing-view.ts';
import type { PersonalImpact, PersonalImpactReport } from '../../personal/personal-impact.ts';
import type { WhatChangedEvent } from '../../command-center/what-changed.ts';
import type { SituationDescriptor } from '../../insights/action-briefs.ts';

const NOW = 1_752_000_000_000;

function impact(overrides: Partial<PersonalImpact> = {}): PersonalImpact {
  return {
    eventId: 'evt-1',
    category: 'immediate_risk',
    severity: 'critical',
    description: 'Severe cell approaching HOME',
    exposures: [],
    recommendedAction: 'Move to interior room',
    reason: 'polygon intersects saved place',
    ...overrides,
  };
}

function report(impacts: PersonalImpact[] = []): PersonalImpactReport {
  return {
    generatedAt: NOW,
    impacts,
    summary: impacts.length === 0 ? 'No personal impacts' : `Personal impacts: ${impacts.length}`,
    recommendations: impacts.map((i) => `${i.description}: ${i.recommendedAction}`),
  };
}

function delta(overrides: Partial<WhatChangedEvent> = {}): WhatChangedEvent {
  return {
    id: 'chg-1',
    timestamp: NOW - 60_000,
    domain: 'weather',
    type: 'new-alert',
    summary: 'Severe Thunderstorm Warning',
    ...overrides,
  };
}

function sit(overrides: Partial<SituationDescriptor> = {}): SituationDescriptor {
  return {
    id: 'sit-1',
    title: 'Black Sea corridor escalation',
    category: 'armed_conflict' as SituationDescriptor['category'],
    severityScore: 90,
    confidence: 'high',
    ...overrides,
  };
}

function quiet(): BriefingInput {
  return { personal: report([]), changed: [], monitoredPlacesCount: 3 };
}

test('all quiet collapses to allClear with places count', () => {
  const view = buildBriefingView(quiet(), NOW);
  assert.equal(view.allClear, true);
  assert.ok(view.allClearText.includes('3 places'));
  assert.equal(view.bands.length, 3);
  assert.ok(view.bands.every((b) => b.tone === 'clear'));
  assert.equal(view.generatedAt, NOW);
});

test('critical personal impact drives band tone and lines', () => {
  const view = buildBriefingView({ ...quiet(), personal: report([impact()]) }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.tone, 'critical');
  assert.ok(personal.lines[0]!.includes('Severe cell approaching HOME'));
  assert.equal(view.allClear, false);
});

test('low/none impacts do not break all-clear', () => {
  const view = buildBriefingView(
    { ...quiet(), personal: report([impact({ severity: 'low' }), impact({ severity: 'none' })]) },
    NOW,
  );
  assert.equal(view.bands.find((b) => b.kind === 'personal')!.tone, 'clear');
  assert.equal(view.allClear, true);
});

test('missing personal report renders honest staleness and blocks all-clear', () => {
  const view = buildBriefingView(
    { changed: [], personal: undefined, lastGoodPersonalAt: NOW - 3_600_000 },
    NOW,
  );
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.tone, 'info');
  assert.ok(personal.staleness!.startsWith('unavailable · last good '));
  assert.equal(view.allClear, false);
});

test('changed band counts events, formats lines, escalates tone', () => {
  const view = buildBriefingView(
    { ...quiet(), changed: [delta(), delta({ id: 'chg-2', type: 'escalated', summary: 'Wheat risk tier 2→3' })] },
    NOW,
  );
  const changed = view.bands.find((b) => b.kind === 'changed')!;
  assert.equal(changed.tone, 'elevated');
  assert.ok(changed.headline.startsWith('2 changes'));
  assert.equal(changed.lines.length, 2);
  assert.ok(changed.lines.some((l) => l.includes('Wheat risk tier 2→3')));
});

test('undefined changed digest is stale, not empty', () => {
  const view = buildBriefingView({ ...quiet(), changed: undefined }, NOW);
  const changed = view.bands.find((b) => b.kind === 'changed')!;
  assert.equal(changed.tone, 'info');
  assert.ok(changed.staleness!.startsWith('unavailable'));
});

test('critical band ranks situation + high-severity events, caps at 4 lines', () => {
  const events: HighSeverityEvent[] = [72, 88, 74, 71, 90].map((severity, i) => ({
    eventId: `e${i}`,
    description: `Event ${i}`,
    domain: 'conflict',
    severity,
  }));
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: events }, NOW);
  const critical = view.bands.find((b) => b.kind === 'critical')!;
  assert.equal(critical.tone, 'critical');
  assert.ok(critical.lines.length <= 4);
  assert.ok(critical.lines[0]!.includes('Black Sea corridor escalation'));
  assert.ok(critical.headline.includes('6 situations'));
});

test('sub-floor events stay out of the critical band', () => {
  const view = buildBriefingView(
    { ...quiet(), recentEvents: [{ eventId: 'e', description: 'Minor', domain: 'other', severity: CRITICAL_EVENT_FLOOR - 1 }] },
    NOW,
  );
  assert.equal(view.bands.find((b) => b.kind === 'critical')!.tone, 'clear');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npx tsx --test src/services/home-shell/__tests__/briefing-view.test.mts
```
Expected: FAIL — `Cannot find module '../briefing-view.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/home-shell/briefing-view.ts`:

```ts
/**
 * Briefing view-model — composes the home shell's three bands
 * (personal / what changed / critical worldwide) from inputs the
 * caller has already captured from insights-state and the
 * command-center what-changed store.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` is always
 * caller-supplied so this stays fixture-testable.
 */

import type { PersonalImpactReport } from '../personal/personal-impact.ts';
import { formatDelta } from '../command-center/what-changed.ts';
import type { WhatChangedEvent } from '../command-center/what-changed.ts';
import type { SituationDescriptor } from '../insights/action-briefs.ts';

export type BandTone = 'clear' | 'info' | 'elevated' | 'critical';

export interface BriefingBandView {
  kind: 'personal' | 'changed' | 'critical';
  label: string;
  tone: BandTone;
  headline: string;
  /** ≤ 4 short lines below the headline. */
  lines: readonly string[];
  /** Honest-staleness line, e.g. "unavailable · last good 14:20". */
  staleness?: string;
}

export interface HighSeverityEvent {
  eventId: string;
  description: string;
  domain: string;
  /** 0–100 */
  severity: number;
}

export interface BriefingInput {
  /** undefined = personal impact could not be computed (stale). */
  personal?: PersonalImpactReport;
  lastGoodPersonalAt?: number;
  monitoredPlacesCount?: number;
  /** undefined = digest unavailable; [] = nothing changed. */
  changed?: readonly WhatChangedEvent[];
  lastGoodChangedAt?: number;
  situation?: SituationDescriptor;
  recentEvents?: readonly HighSeverityEvent[];
}

export interface BriefingView {
  allClear: boolean;
  allClearText: string;
  bands: readonly BriefingBandView[];
  generatedAt: number;
}

/** Events at or above this severity qualify for the critical band. */
export const CRITICAL_EVENT_FLOOR = 70;
/** At or above this severity the critical band turns 'critical'. */
export const CRITICAL_TONE_FLOOR = 85;
const MAX_LINES = 4;

const SEVERITY_GLYPH: Record<string, string> = {
  critical: '●',
  elevated: '▲',
  watch: '○',
};

export function buildBriefingView(input: BriefingInput, now: number): BriefingView {
  const bands: BriefingBandView[] = [
    buildPersonalBand(input),
    buildChangedBand(input),
    buildCriticalBand(input),
  ];
  const allClear = bands.every((b) => b.tone === 'clear');
  const places = input.monitoredPlacesCount ?? 0;
  const allClearText = `All clear · ${places} place${places === 1 ? '' : 's'} monitored · nothing critical worldwide`;
  return { allClear, allClearText, bands, generatedAt: now };
}

function buildPersonalBand(input: BriefingInput): BriefingBandView {
  const { personal } = input;
  if (!personal) {
    return {
      kind: 'personal',
      label: 'PERSONAL',
      tone: 'info',
      headline: 'Personal status unavailable',
      lines: [],
      staleness: staleLine(input.lastGoodPersonalAt),
    };
  }
  const active = personal.impacts.filter((i) => i.severity !== 'none' && i.severity !== 'low');
  const tone: BandTone = active.some((i) => i.severity === 'critical')
    ? 'critical'
    : active.some((i) => i.severity === 'elevated')
      ? 'elevated'
      : active.length > 0
        ? 'info'
        : 'clear';
  const headline = active.length === 0 ? 'All clear near your places' : personal.summary;
  const lines = active
    .slice(0, MAX_LINES)
    .map((i) => `${SEVERITY_GLYPH[i.severity] ?? '○'} ${i.description} — ${i.recommendedAction}`);
  return { kind: 'personal', label: 'PERSONAL', tone, headline, lines };
}

function buildChangedBand(input: BriefingInput): BriefingBandView {
  const { changed } = input;
  if (!changed) {
    return {
      kind: 'changed',
      label: 'WHAT CHANGED',
      tone: 'info',
      headline: 'Change digest unavailable',
      lines: [],
      staleness: staleLine(input.lastGoodChangedAt),
    };
  }
  if (changed.length === 0) {
    return {
      kind: 'changed',
      label: 'WHAT CHANGED',
      tone: 'clear',
      headline: 'Nothing changed recently',
      lines: [],
    };
  }
  const tone: BandTone = changed.some((e) => e.type === 'escalated' || e.type === 'feed-degraded')
    ? 'elevated'
    : 'info';
  const headline = `${changed.length} change${changed.length === 1 ? '' : 's'} since last check`;
  const lines = changed.slice(0, MAX_LINES).map((e) => formatDelta(e));
  return { kind: 'changed', label: 'WHAT CHANGED', tone, headline, lines };
}

function buildCriticalBand(input: BriefingInput): BriefingBandView {
  const events = (input.recentEvents ?? [])
    .filter((e) => e.severity >= CRITICAL_EVENT_FLOOR)
    .slice()
    .sort((a, b) => b.severity - a.severity);
  const lines: string[] = [];
  if (input.situation) {
    lines.push(`● ${input.situation.title} (${input.situation.severityScore})`);
  }
  for (const e of events) {
    if (lines.length >= MAX_LINES) break;
    lines.push(`${e.severity >= CRITICAL_TONE_FLOOR ? '●' : '▲'} ${e.description} (${e.severity})`);
  }
  const worst = Math.max(input.situation?.severityScore ?? 0, events[0]?.severity ?? 0);
  const tone: BandTone = lines.length === 0 ? 'clear' : worst >= CRITICAL_TONE_FLOOR ? 'critical' : 'elevated';
  const count = (input.situation ? 1 : 0) + events.length;
  const headline = count === 0 ? 'Nothing critical worldwide' : `${count} situation${count === 1 ? '' : 's'} worldwide`;
  return { kind: 'critical', label: 'CRITICAL WORLDWIDE', tone, headline, lines };
}

function staleLine(lastGoodAt: number | undefined): string {
  if (lastGoodAt === undefined) return 'unavailable · no successful update yet';
  return `unavailable · last good ${formatClock(lastGoodAt)}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

Note: tests assert `staleness.startsWith('unavailable · last good ')` — never the exact clock string (local-timezone dependent).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npx tsx --test src/services/home-shell/__tests__/briefing-view.test.mts
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run typecheck && git add src/services/home-shell/briefing-view.ts src/services/home-shell/__tests__/briefing-view.test.mts && git commit -m "feat(home-shell): briefing view-model for the three home bands

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
Expected: typecheck zero errors; commit created.

---

### Task 2: `deck-view.ts` — pin state + adapter card derivation

**Files:**
- Create: `src/services/home-shell/deck-view.ts`
- Test: `src/services/home-shell/__tests__/deck-view.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/home-shell/__tests__/deck-view.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DECK_PINS,
  buildDeckCards,
  formatAge,
  movePin,
  parseDeckPins,
  serializeDeckPins,
  togglePin,
} from '../deck-view.ts';
import type { PanelHealthLike } from '../deck-view.ts';

const NOW = 1_752_000_000_000;
const VALID = new Set(['markets', 'nws-alerts', 'live-news', ...DEFAULT_DECK_PINS]);

function health(overrides: Partial<PanelHealthLike> = {}): PanelHealthLike {
  return { panelId: 'markets', status: 'healthy', lastRenderAt: NOW - 32_000, ...overrides };
}

test('parseDeckPins round-trips valid pins', () => {
  const pins = parseDeckPins(serializeDeckPins(['markets', 'nws-alerts']), VALID);
  assert.deepEqual(pins, ['markets', 'nws-alerts']);
});

test('parseDeckPins falls back to defaults on garbage, null, or empty', () => {
  for (const raw of [null, '', 'not json', '{"a":1}', '[]', '[42]', '["unknown-panel"]']) {
    assert.deepEqual(parseDeckPins(raw, VALID), DEFAULT_DECK_PINS.filter((id) => VALID.has(id)));
  }
});

test('parseDeckPins drops unknown ids and dedupes', () => {
  const raw = JSON.stringify(['markets', 'ghost-panel', 'markets', 'live-news']);
  assert.deepEqual(parseDeckPins(raw, VALID), ['markets', 'live-news']);
});

test('togglePin adds then removes', () => {
  const added = togglePin(['markets'], 'live-news');
  assert.deepEqual(added, ['markets', 'live-news']);
  assert.deepEqual(togglePin(added, 'markets'), ['live-news']);
});

test('movePin reorders and clamps at edges', () => {
  assert.deepEqual(movePin(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(movePin(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(movePin(['a', 'b', 'c'], 'missing', 1), ['a', 'b', 'c']);
});

test('buildDeckCards maps health to tones and labels', () => {
  const cards = buildDeckCards(
    ['markets', 'nws-alerts', 'live-news'],
    {
      names: { markets: { name: 'Markets' }, 'nws-alerts': { name: 'NWS Alerts' } },
      health: [
        health(),
        health({ panelId: 'nws-alerts', status: 'failing', lastError: 'feed unreachable' }),
      ],
      narratives: { markets: 'S&P −0.4 · AAPL +1.2' },
    },
    NOW,
  );
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.tone),
    ['ok', 'error', 'unknown'],
  );
  assert.equal(cards[0]!.title, 'Markets');
  assert.equal(cards[0]!.statusLabel, 'live · 32s');
  assert.equal(cards[0]!.narrative, 'S&P −0.4 · AAPL +1.2');
  assert.ok(cards[1]!.statusLabel.includes('feed unreachable'));
  assert.equal(cards[2]!.title, 'live-news'); // no name entry → id fallback
  assert.equal(cards[2]!.statusLabel, 'not loaded');
});

test('stale statuses render as stale tone with age', () => {
  const cards = buildDeckCards(
    ['markets'],
    { names: {}, health: [health({ status: 'stale', lastRenderAt: NOW - 6 * 60_000 })], narratives: {} },
    NOW,
  );
  assert.equal(cards[0]!.tone, 'stale');
  assert.equal(cards[0]!.statusLabel, 'stale · 6m');
});

test('formatAge buckets seconds, minutes, hours', () => {
  assert.equal(formatAge(5_000), '5s');
  assert.equal(formatAge(6 * 60_000), '6m');
  assert.equal(formatAge(3 * 3_600_000), '3h');
  assert.equal(formatAge(-50), '0s');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npx tsx --test src/services/home-shell/__tests__/deck-view.test.mts
```
Expected: FAIL — `Cannot find module '../deck-view.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/home-shell/deck-view.ts`:

```ts
/**
 * Deck view-model — pure pin-list operations + adapter card
 * derivation for the home shell's pinned panel grid.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` is always
 * caller-supplied so this stays fixture-testable.
 */

export const DEFAULT_DECK_PINS: readonly string[] = [
  'live-news',
  'markets',
  'nws-alerts',
  'shortage-radar',
  'air-quality',
  'cyber-threats',
  'space-weather',
  'earthquakes',
  'crypto',
  'economic',
  'command-center',
  'watchlist',
];

export function parseDeckPins(raw: string | null | undefined, validIds: ReadonlySet<string>): string[] {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const pins = parsed.filter((p): p is string => typeof p === 'string' && validIds.has(p));
        const deduped = [...new Set(pins)];
        if (deduped.length > 0) return deduped;
      }
    } catch {
      // corrupt storage → defaults
    }
  }
  return DEFAULT_DECK_PINS.filter((id) => validIds.has(id));
}

export function serializeDeckPins(pins: readonly string[]): string {
  return JSON.stringify(pins);
}

export function togglePin(pins: readonly string[], panelId: string): string[] {
  return pins.includes(panelId) ? pins.filter((p) => p !== panelId) : [...pins, panelId];
}

export function movePin(pins: readonly string[], panelId: string, direction: -1 | 1): string[] {
  const from = pins.indexOf(panelId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= pins.length) return [...pins];
  const next = [...pins];
  next.splice(from, 1);
  next.splice(to, 0, panelId);
  return next;
}

export type DeckCardTone = 'ok' | 'stale' | 'error' | 'unknown';

export interface DeckCardView {
  panelId: string;
  title: string;
  tone: DeckCardTone;
  statusLabel: string;
  narrative?: string;
}

/**
 * Structural subset of diagnostics' PanelHealth — keeps this module
 * decoupled from the registry's full type.
 */
export interface PanelHealthLike {
  panelId: string;
  status: string;
  lastRenderAt?: number;
  lastError?: string;
}

export interface DeckCardInputs {
  /** DEFAULT_PANELS-shaped name lookup. */
  names: Readonly<Record<string, { name: string } | undefined>>;
  health: readonly PanelHealthLike[];
  narratives: Readonly<Record<string, string | undefined>>;
}

export function buildDeckCards(pins: readonly string[], inputs: DeckCardInputs, now: number): DeckCardView[] {
  const healthById = new Map(inputs.health.map((h) => [h.panelId, h]));
  return pins.map((panelId) => {
    const title = inputs.names[panelId]?.name ?? panelId;
    const narrative = inputs.narratives[panelId] || undefined;
    const h = healthById.get(panelId);
    if (!h || h.lastRenderAt === undefined) {
      return { panelId, title, tone: 'unknown' as const, statusLabel: 'not loaded', narrative };
    }
    const age = formatAge(now - h.lastRenderAt);
    if (h.status === 'failing' || h.status === 'unsafe') {
      const detail = h.lastError ? `error · ${h.lastError}` : `error · ${age}`;
      return { panelId, title, tone: 'error' as const, statusLabel: detail, narrative };
    }
    if (h.status === 'healthy') {
      return { panelId, title, tone: 'ok' as const, statusLabel: `live · ${age}`, narrative };
    }
    return { panelId, title, tone: 'stale' as const, statusLabel: `${h.status} · ${age}`, narrative };
  });
}

export function formatAge(ms: number): string {
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npx tsx --test src/services/home-shell/__tests__/deck-view.test.mts
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run typecheck && git add src/services/home-shell/deck-view.ts src/services/home-shell/__tests__/deck-view.test.mts && git commit -m "feat(home-shell): deck pin state + adapter card view-model

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: `status-ribbon-view.ts` — one-line system health

**Files:**
- Create: `src/services/home-shell/status-ribbon-view.ts`
- Test: `src/services/home-shell/__tests__/status-ribbon-view.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/home-shell/__tests__/status-ribbon-view.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStatusRibbon } from '../status-ribbon-view.ts';

const NOW = 1_752_000_000_000;

test('healthy system renders ok tone with sweep age', () => {
  const view = buildStatusRibbon(
    { systemStatus: 'healthy', summary: '61/63 feeds healthy', lastSweepAt: NOW - 32_000 },
    NOW,
  );
  assert.equal(view.tone, 'ok');
  assert.equal(view.text, '61/63 feeds healthy · updated 32s ago');
});

test('degraded and stale map to warn', () => {
  for (const status of ['degraded', 'stale', 'unknown']) {
    assert.equal(buildStatusRibbon({ systemStatus: status, summary: 's' }, NOW).tone, 'warn');
  }
});

test('failing, blind, unsafe map to bad', () => {
  for (const status of ['failing', 'blind', 'unsafe']) {
    assert.equal(buildStatusRibbon({ systemStatus: status, summary: 's' }, NOW).tone, 'bad');
  }
});

test('missing sweep timestamp omits the suffix', () => {
  const view = buildStatusRibbon({ systemStatus: 'healthy', summary: 'all good' }, NOW);
  assert.equal(view.text, 'all good');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npx tsx --test src/services/home-shell/__tests__/status-ribbon-view.test.mts
```
Expected: FAIL — `Cannot find module '../status-ribbon-view.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/home-shell/status-ribbon-view.ts`:

```ts
/**
 * Status ribbon view-model — one-line system health for the home
 * shell footer. Pure; `now` caller-supplied.
 */

import { formatAge } from './deck-view.ts';

export type RibbonTone = 'ok' | 'warn' | 'bad';

export interface StatusRibbonInputs {
  /** SystemHealthReport.status */
  systemStatus: string;
  /** SystemHealthReport.summary */
  summary: string;
  lastSweepAt?: number;
}

export interface StatusRibbonView {
  tone: RibbonTone;
  text: string;
}

const BAD_STATUSES = new Set(['failing', 'blind', 'unsafe']);

export function buildStatusRibbon(inputs: StatusRibbonInputs, now: number): StatusRibbonView {
  const tone: RibbonTone =
    inputs.systemStatus === 'healthy' ? 'ok' : BAD_STATUSES.has(inputs.systemStatus) ? 'bad' : 'warn';
  const sweep = inputs.lastSweepAt === undefined ? '' : ` · updated ${formatAge(now - inputs.lastSweepAt)} ago`;
  return { tone, text: `${inputs.summary}${sweep}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npx tsx --test src/services/home-shell/__tests__/status-ribbon-view.test.mts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run typecheck && git add src/services/home-shell/status-ribbon-view.ts src/services/home-shell/__tests__/status-ribbon-view.test.mts && git commit -m "feat(home-shell): status ribbon view-model

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: `Panel.getNarrative()` — expose the one-line summary

**Files:**
- Modify: `src/components/Panel.ts` (add one method near `getContentElement()`, ~line 189)

- [ ] **Step 1: Add the accessor**

In `src/components/Panel.ts`, find `getContentElement()` (~line 189) and add directly below it:

```ts
  /** Current one-line narrative text (set via setNarrative). Read by
   *  the home-shell deck to enrich adapter cards. */
  getNarrative(): string {
    return this.narrativeEl?.textContent?.trim() ?? '';
  }
```

(`narrativeEl: HTMLElement | null` is an existing protected field — verified.)

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run typecheck && git add src/components/Panel.ts && git commit -m "feat(home-shell): expose Panel narrative for deck adapter cards

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: `HomeShellOverlay` component + near-black skin

**Files:**
- Create: `src/components/HomeShellOverlay.ts`
- Create: `src/styles/home-shell.css`
- Modify: `src/config/panels.ts:1324` (STORAGE_KEYS)

All DOM in this component is built with `createElement` + `textContent` (CommandPalettePanel pattern) — no HTML-string sinks, so no escaping is ever needed.

- [ ] **Step 1: Add the deck-pins storage key**

In `src/config/panels.ts`, extend `STORAGE_KEYS` (line ~1324):

```ts
export const STORAGE_KEYS = {
  panels: 'crystalball-panels',
  monitors: 'crystalball-monitors',
  mapLayers: 'crystalball-layers',
  disabledFeeds: 'crystalball-disabled-feeds',
  deckPins: 'crystalball-deck-pins',
} as const;
```

- [ ] **Step 2: Create the stylesheet**

Create `src/styles/home-shell.css`:

```css
/* Home Shell — Phase 1 of the UI shell re-imagination.
   Near-black professional skin. Scoped entirely under .home-shell. */

.home-shell {
  position: fixed;
  inset: 0;
  z-index: 10000; /* below cmdk overlay (10005) so ⌘K opens on top */
  background: #05070a;
  color: #e8eef4;
  font-family: ui-monospace, Menlo, Monaco, monospace;
}

body.home-shell-active {
  overflow: hidden;
}

.home-shell-map {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 65% 40%, #16222e 0%, #0a1017 70%);
}

.home-shell-map .map-container {
  width: 100%;
  height: 100%;
}

.home-shell-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.home-shell-viewport {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  pointer-events: none; /* let map interactions through the empty area */
}

.home-shell-viewport > * {
  pointer-events: auto;
}

.home-shell-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(rgba(5, 7, 10, 0.9), transparent);
}

.home-shell-brand {
  font-size: 13px;
  font-weight: 600;
}

.home-shell-cmdk {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(11, 15, 20, 0.8);
  color: #8b98a5;
  font: inherit;
  font-size: 11px;
  padding: 5px 12px;
  cursor: pointer;
}

.home-shell-cmdk:hover { color: #e8eef4; }

.home-shell-topbar-spacer { flex: 1; }

.home-shell-exit {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: transparent;
  color: #8b98a5;
  font: inherit;
  font-size: 10px;
  padding: 4px 10px;
  cursor: pointer;
}

.home-shell-briefing {
  width: 340px;
  margin: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hs-band {
  background: rgba(11, 15, 20, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  padding: 10px 12px;
  backdrop-filter: blur(6px);
}

.hs-tone-critical { border-color: rgba(208, 90, 90, 0.5); }
.hs-tone-elevated { border-color: rgba(208, 160, 60, 0.5); }
.hs-tone-clear { border-color: rgba(76, 175, 125, 0.4); }

.hs-band-label {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: #8b98a5;
  margin-bottom: 4px;
}

.hs-tone-critical .hs-band-label { color: #d05a5a; }
.hs-tone-elevated .hs-band-label { color: #d0a03c; }
.hs-tone-clear .hs-band-label { color: #4caf7d; }

.hs-band-headline { font-size: 12px; margin-bottom: 4px; }
.hs-band-line { font-size: 10px; color: #aeb9c4; line-height: 1.6; }
.hs-band-stale { font-size: 9px; color: #d0a03c; margin-top: 4px; }

.home-shell-deck-hint {
  margin: auto auto 12px;
  font-size: 11px;
  color: #9fb0c0;
  background: rgba(11, 15, 20, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 4px 14px;
}

.home-shell-deck {
  position: relative;
  background: #0d141c;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 14px 16px 20px;
  min-height: 40vh;
}

.hs-deck-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
}

.hs-deck-sub { font-size: 10px; font-weight: 400; color: #7a8a99; }

.hs-deck-add {
  margin-left: auto;
  background: #0b0f14;
  color: #8b98a5;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  font: inherit;
  font-size: 10px;
  padding: 3px 6px;
}

.hs-deck-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.hs-card {
  position: relative;
  background: #0b0f14;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  padding: 10px 12px;
  min-height: 74px;
  cursor: pointer;
}

.hs-card:hover { border-color: rgba(255, 255, 255, 0.25); }
.hs-card-error { border-color: rgba(208, 90, 90, 0.5); }
.hs-card-stale { border-color: rgba(208, 160, 60, 0.4); }

.hs-card-title { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.hs-card-narrative { font-size: 10px; color: #8b98a5; line-height: 1.5; margin-bottom: 4px; }
.hs-card-status { font-size: 9px; color: #5c6873; }
.hs-card-error .hs-card-status { color: #d05a5a; }

.hs-card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  gap: 2px;
}

.hs-card:hover .hs-card-actions { display: flex; }

.hs-card-actions button {
  background: rgba(255, 255, 255, 0.06);
  border: none;
  border-radius: 4px;
  color: #8b98a5;
  font: inherit;
  font-size: 10px;
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.home-shell-ribbon {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 10px;
  color: #7a8a99;
  background: #090d12;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.hs-ribbon-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.hs-ribbon-ok { background: #4caf7d; }
.hs-ribbon-warn { background: #d0a03c; }
.hs-ribbon-bad { background: #d05a5a; }

@media (prefers-reduced-motion: reduce) {
  .home-shell * { transition: none !important; }
}
```

- [ ] **Step 3: Create the component**

> **Amendment (review round 1):** the shell is a READ-ONLY consumer of the what-changed store — CommandCenterPanel is the single snapshot writer. recordChangeSnapshot was removed. Escape guards on defaultPrevented; deck re-render skips while focus is in the deck; loop priority is 'low'; releaseMap always clears the placeholder.

Create `src/components/HomeShellOverlay.ts`:

```ts
/**
 * Home Shell — Phase 1 of the UI shell re-imagination
 * (docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md).
 *
 * Full-screen overlay: map canvas backdrop + three briefing bands +
 * pinned panel deck + status ribbon. Feature-flagged via localStorage
 * 'crystalball-home-shell'. Composition logic lives in the pure
 * view-models under src/services/home-shell/. All DOM is built with
 * createElement/textContent — no HTML-string sinks.
 */

import { DEFAULT_PANELS, STORAGE_KEYS } from '@/config/panels';
import {
  getActiveSituation,
  getPersonalImpactReport,
  getPersonalProfile,
  getRecentEvents,
} from '@/services/insights/insights-state';
import { getWhatChanged, recordSnapshot } from '@/services/command-center/what-changed';
import type {
  AlertSeverityLike,
  ChangeDomain,
  WhatChangedEvent,
} from '@/services/command-center/what-changed';
import {
  getFeatureHealthRegistry,
  getPanelHealthRegistry,
} from '@/services/diagnostics/diagnostics-state';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { aggregateSystemHealth, contextFromSnapshots } from '@/services/diagnostics/system-health';
import { registerRecurringLoop } from '@/services/diagnostics/recurring-loops';
import type { LoopHandle } from '@/services/diagnostics/recurring-loops';
import { buildBriefingView } from '@/services/home-shell/briefing-view';
import type { BriefingBandView, BriefingView } from '@/services/home-shell/briefing-view';
import {
  buildDeckCards,
  movePin,
  parseDeckPins,
  serializeDeckPins,
  togglePin,
} from '@/services/home-shell/deck-view';
import type { DeckCardView } from '@/services/home-shell/deck-view';
import { buildStatusRibbon } from '@/services/home-shell/status-ribbon-view';
import type { StatusRibbonView } from '@/services/home-shell/status-ribbon-view';
import { safeSetItem } from '@/utils/safe-storage';

const DECK_PINS_KEY = STORAGE_KEYS.deckPins;
const CHANGED_WINDOW_MS = 60 * 60 * 1000;
const REFRESH_MS = 10_000;
const KNOWN_DOMAINS: readonly ChangeDomain[] = [
  'weather', 'cyber', 'finance', 'conflict', 'seismic', 'energy', 'system',
];

interface NarrativeSource {
  getNarrative(): string;
}

export interface HomeShellOptions {
  getPanel: (panelId: string) => NarrativeSource | undefined;
}

export class HomeShellOverlay {
  private root: HTMLElement | null = null;
  private mapSlot: HTMLElement | null = null;
  private briefingEl: HTMLElement | null = null;
  private deckEl: HTMLElement | null = null;
  private ribbonEl: HTMLElement | null = null;
  private mapHome: Comment | null = null;
  private loop: LoopHandle | null = null;
  private pins: string[] = [];
  private visible = false;
  private lastGoodPersonalAt: number | undefined;
  private lastGoodChangedAt: number | undefined;
  private readonly getPanel: HomeShellOptions['getPanel'];

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.visible) this.hide();
  };

  constructor(options: HomeShellOptions) {
    this.getPanel = options.getPanel;
  }

  mount(parent: HTMLElement): void {
    if (this.root) return;
    this.pins = parseDeckPins(
      localStorage.getItem(DECK_PINS_KEY),
      new Set(Object.keys(DEFAULT_PANELS)),
    );

    const root = el('div', 'home-shell');
    root.hidden = true;

    this.mapSlot = el('div', 'home-shell-map');

    const scroll = el('div', 'home-shell-scroll');
    const viewport = el('section', 'home-shell-viewport');

    const topbar = el('header', 'home-shell-topbar');
    topbar.append(
      el('span', 'home-shell-brand', '🔮 Crystal Ball'),
      button('home-shell-cmdk', 'cmdk', '⌘K — panels, places, situations…'),
      el('span', 'home-shell-topbar-spacer'),
      button('home-shell-exit', 'exit', 'Classic view ⎋'),
    );

    this.briefingEl = el('div', 'home-shell-briefing');
    viewport.append(topbar, this.briefingEl, el('div', 'home-shell-deck-hint', '▼ Your Deck'));

    this.deckEl = el('section', 'home-shell-deck');
    this.ribbonEl = el('footer', 'home-shell-ribbon');
    scroll.append(viewport, this.deckEl, this.ribbonEl);
    root.append(this.mapSlot, scroll);

    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    parent.append(root);
    this.root = root;
  }

  show(): void {
    if (!this.root || this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    document.body.classList.add('home-shell-active');
    document.addEventListener('keydown', this.onKeydown);
    this.adoptMap();
    this.loop = registerRecurringLoop('home-shell-refresh', () => this.refresh(), REFRESH_MS, {
      priority: 'normal',
      runImmediately: true,
    });
  }

  hide(): void {
    if (!this.root || !this.visible) return;
    this.visible = false;
    this.loop?.cancel();
    this.loop = null;
    document.removeEventListener('keydown', this.onKeydown);
    this.releaseMap();
    this.root.hidden = true;
    document.body.classList.remove('home-shell-active');
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.hide();
    this.root?.remove();
    this.root = null;
  }

  // ── Data + render ─────────────────────────────────────────────────

  private refresh(): void {
    const now = Date.now();
    this.recordChangeSnapshot(now);

    let personal;
    try {
      personal = getPersonalImpactReport();
      this.lastGoodPersonalAt = now;
    } catch {
      personal = undefined;
    }

    let changed: WhatChangedEvent[] | undefined;
    try {
      changed = getWhatChanged(now - CHANGED_WINDOW_MS);
      this.lastGoodChangedAt = now;
    } catch {
      changed = undefined;
    }

    const briefing = buildBriefingView(
      {
        personal,
        lastGoodPersonalAt: this.lastGoodPersonalAt,
        monitoredPlacesCount: getPersonalProfile().savedPlaces.length,
        changed,
        lastGoodChangedAt: this.lastGoodChangedAt,
        situation: getActiveSituation(),
        recentEvents: getRecentEvents().map((e) => ({
          eventId: e.eventId,
          description: e.description,
          domain: e.domain,
          severity: e.severity,
        })),
      },
      now,
    );
    this.renderBriefing(briefing);
    this.renderDeck(now);
    this.renderRibbon(now);
  }

  private recordChangeSnapshot(now: number): void {
    const situation = getActiveSituation();
    recordSnapshot({
      takenAt: now,
      alerts: getRecentEvents().map((e) => ({
        id: e.eventId,
        domain: toChangeDomain(e.domain),
        severity: toAlertSeverity(e.severity),
        summary: e.description,
      })),
      situations: situation ? [{ id: situation.id, domain: 'other', title: situation.title }] : [],
      feeds: [],
    });
  }

  private renderBriefing(view: BriefingView): void {
    if (!this.briefingEl) return;
    if (view.allClear) {
      const band = el('div', 'hs-band hs-tone-clear');
      band.append(el('div', 'hs-band-headline', view.allClearText));
      this.briefingEl.replaceChildren(band);
      return;
    }
    this.briefingEl.replaceChildren(...view.bands.map(renderBand));
  }

  private renderDeck(now: number): void {
    if (!this.deckEl) return;
    const narratives: Record<string, string | undefined> = {};
    for (const id of this.pins) {
      narratives[id] = this.getPanel(id)?.getNarrative() || undefined;
    }
    const cards = buildDeckCards(
      this.pins,
      { names: DEFAULT_PANELS, health: getPanelHealthRegistry().all(), narratives },
      now,
    );

    const header = el('div', 'hs-deck-header');
    header.append(
      el('span', undefined, 'THE DECK'),
      el('span', 'hs-deck-sub', `${cards.length} pinned · click a card to open`),
      this.buildPinSelect(),
    );

    const grid = el('div', 'hs-deck-grid');
    grid.append(...cards.map(renderDeckCard));
    this.deckEl.replaceChildren(header, grid);
  }

  private buildPinSelect(): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'hs-deck-add';
    select.dataset.action = 'pin-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '+ pin a panel…';
    select.append(placeholder);
    Object.entries(DEFAULT_PANELS)
      .filter(([key]) => !this.pins.includes(key))
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .forEach(([key, cfg]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = cfg.name;
        select.append(opt);
      });
    return select;
  }

  private renderRibbon(now: number): void {
    if (!this.ribbonEl) return;
    let view: StatusRibbonView;
    try {
      const snapshot = getLiveDiagnosticsSnapshot();
      const ctx = contextFromSnapshots({
        panels: snapshot.panels,
        sources: snapshot.sources,
        providers: snapshot.providers,
      });
      const report = aggregateSystemHealth({
        panels: snapshot.panels,
        features: getFeatureHealthRegistry().all(ctx),
        sources: snapshot.sources,
        providers: snapshot.providers,
        notifications: snapshot.notificationSummary,
        sidecar: snapshot.sidecar,
      });
      view = buildStatusRibbon(
        { systemStatus: report.status, summary: report.summary, lastSweepAt: now },
        now,
      );
    } catch {
      view = { tone: 'warn', text: 'diagnostics unavailable' };
    }
    const dot = el('span', `hs-ribbon-dot hs-ribbon-${view.tone}`);
    this.ribbonEl.replaceChildren(dot, document.createTextNode(view.text));
  }

  // ── Interactions ──────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'cmdk') {
      document.dispatchEvent(new CustomEvent('cb:toggle-cmdk'));
      return;
    }
    if (action === 'exit') {
      this.hide();
      return;
    }
    const key = target.closest<HTMLElement>('[data-panel-key]')?.dataset.panelKey;
    if (!key) return;
    if (action === 'unpin') {
      this.setPins(togglePin(this.pins, key));
      return;
    }
    if (action === 'move-left') {
      this.setPins(movePin(this.pins, key, -1));
      return;
    }
    if (action === 'move-right') {
      this.setPins(movePin(this.pins, key, 1));
      return;
    }
    // Plain card click → open the panel in the classic view.
    this.hide();
    document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey: key } }));
  }

  private onChange(e: Event): void {
    const sel = e.target as HTMLSelectElement;
    if (sel.dataset.action === 'pin-select' && sel.value) {
      this.setPins(togglePin(this.pins, sel.value));
    }
  }

  private setPins(pins: string[]): void {
    this.pins = pins;
    safeSetItem(DECK_PINS_KEY, serializeDeckPins(pins));
    this.renderDeck(Date.now());
  }

  // ── Map adoption ──────────────────────────────────────────────────

  private adoptMap(): void {
    const mapEl = document.getElementById('mapContainer');
    if (!mapEl || !this.mapSlot || this.mapHome) return;
    this.mapHome = document.createComment('home-shell-map-home');
    mapEl.before(this.mapHome);
    this.mapSlot.append(mapEl);
    window.dispatchEvent(new Event('resize'));
  }

  private releaseMap(): void {
    const mapEl = document.getElementById('mapContainer');
    if (!mapEl || !this.mapHome || !this.mapSlot?.contains(mapEl)) return;
    this.mapHome.replaceWith(mapEl);
    this.mapHome = null;
    window.dispatchEvent(new Event('resize'));
  }
}

// ── Module-private helpers ──────────────────────────────────────────

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, action: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (className) b.className = className;
  b.dataset.action = action;
  b.textContent = label;
  return b;
}

function renderBand(b: BriefingBandView): HTMLElement {
  const band = el('div', `hs-band hs-tone-${b.tone}`);
  band.append(el('div', 'hs-band-label', b.label), el('div', 'hs-band-headline', b.headline));
  for (const line of b.lines) band.append(el('div', 'hs-band-line', line));
  if (b.staleness) band.append(el('div', 'hs-band-stale', b.staleness));
  return band;
}

function renderDeckCard(c: DeckCardView): HTMLElement {
  const card = el('div', `hs-card hs-card-${c.tone}`);
  card.dataset.panelKey = c.panelId;
  card.append(el('div', 'hs-card-title', c.title));
  if (c.narrative) card.append(el('div', 'hs-card-narrative', c.narrative));
  card.append(el('div', 'hs-card-status', c.statusLabel));

  const actions = el('div', 'hs-card-actions');
  const controls: ReadonlyArray<readonly [string, string, string]> = [
    ['move-left', '‹', 'Move left'],
    ['move-right', '›', 'Move right'],
    ['unpin', '×', 'Unpin'],
  ];
  for (const [action, glyph, title] of controls) {
    const b = button('', action, glyph);
    b.title = title;
    b.dataset.panelKey = c.panelId;
    actions.append(b);
  }
  card.append(actions);
  return card;
}

function toChangeDomain(domain: string): ChangeDomain {
  return (KNOWN_DOMAINS as readonly string[]).includes(domain) ? (domain as ChangeDomain) : 'other';
}

function toAlertSeverity(severity: number): AlertSeverityLike {
  if (severity >= 85) return 'CRITICAL';
  if (severity >= 70) return 'HIGH';
  if (severity >= 40) return 'MODERATE';
  if (severity >= 15) return 'LOW';
  return 'INFO';
}
```

**Adjustments the implementer may need** (verify while wiring, all low-risk):
- If `getPanelHealthRegistry().all()` requires an argument, check its signature in `src/services/diagnostics/panel-health-registry.ts` and pass what it needs (it derives status itself).
- If `DEFAULT_PANELS`'s type doesn't structurally match `DeckCardInputs['names']`, pass `DEFAULT_PANELS as DeckCardInputs['names']` — the shape (`Record<string, { name: string }>`) is verified.

- [ ] **Step 4: Typecheck and commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run typecheck && git add src/components/HomeShellOverlay.ts src/styles/home-shell.css src/config/panels.ts && git commit -m "feat(home-shell): HomeShellOverlay component with near-black skin

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Boot wiring — flag, mount, shortcut, CSS import

**Files:**
- Modify: `src/main.ts` (~line 6 CSS imports; ~line 384 after the `window.beta` block)
- Modify: `src/app/panel-layout.ts` (~line 1245, after the CommandPalettePanel block)
- Modify: `src/services/keyboard/shortcut-bootstrap.ts` (~line 62, after the cmd-slash binding)

- [ ] **Step 1: Import the stylesheet**

In `src/main.ts`, add to the existing CSS import block (lines 2-6):

```ts
import './styles/home-shell.css';
```

- [ ] **Step 2: Add the console flag setter**

In `src/main.ts`, directly below the `window.beta` `Object.defineProperty` block (ends ~line 384), add:

```ts
// Home Shell (Phase 1 UI re-imagination): type `homeShell=true` / `homeShell=false` in console
Object.defineProperty(window, 'homeShell', {
  get() {
    const on = localStorage.getItem('crystalball-home-shell') === '1';
    console.log(`[HomeShell] ${on ? 'ON' : 'OFF'}`);
    return on;
  },
  set(v: boolean) {
    if (v) localStorage.setItem('crystalball-home-shell', '1');
    else localStorage.removeItem('crystalball-home-shell');
    location.reload();
  },
});
```

- [ ] **Step 3: Mount behind the flag in panel-layout**

In `src/app/panel-layout.ts`:

1. Add the import at the top with the other component imports:

```ts
import { HomeShellOverlay } from '@/components/HomeShellOverlay';
```

2. Add a private field on `PanelLayoutManager` near the other overlay fields:

```ts
private homeShell: HomeShellOverlay | null = null;
```

3. In `createPanels()`, directly after the CommandPalettePanel wiring block (`document.addEventListener('cb:toggle-cmdk', ...)`, ~line 1245), add:

```ts
    // Home Shell (Phase 1 UI re-imagination) — feature-flagged opening surface.
    if (localStorage.getItem('crystalball-home-shell') === '1') {
      this.homeShell = new HomeShellOverlay({
        getPanel: (id) => this.ctx.panels[id],
      });
      this.homeShell.mount(document.body);
      document.addEventListener('cb:toggle-home-shell', () => this.homeShell?.toggle());
      this.homeShell.show();
    }
```

`Panel` instances satisfy the `{ getNarrative(): string }` option type structurally — Task 4 must land before this compiles.

- [ ] **Step 4: Register the ⌘⇧H shortcut**

First read the existing registrations in `src/services/keyboard/shortcut-bootstrap.ts` (~lines 37-83) and check whether `parseChord` supports a `Shift` modifier. If yes, add after the `cmd-slash` registration:

```ts
  reg.register({
    id: 'cmd-shift-h',
    label: 'Toggle Home Shell',
    group: 'Navigation',
    display: '⌘⇧H',
    chord: parseChord('Cmd+Shift+H'),
    run: () => document.dispatchEvent(new CustomEvent('cb:toggle-home-shell')),
  });
```

If `parseChord` does NOT support Shift, follow the ad-hoc listener pattern from `panel-layout.ts:1165-1171` instead: register a `keydown` listener checking `(e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h'` that calls `e.preventDefault()` and dispatches `cb:toggle-home-shell` (add it inside the Task 6 Step 3 block so it only exists when the flag is on).

> **Amendment (review round 1):** ⌘⇧H was already bound to briefing-export (panel-layout.ts:1173); the shell toggle ships as ⌘⇧O instead.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run typecheck:all && git add src/main.ts src/app/panel-layout.ts src/services/keyboard/shortcut-bootstrap.ts && git commit -m "feat(home-shell): flag-gated boot wiring + cmd-shift-h toggle

Home shell mounts only when crystalball-home-shell=1; classic
sidebar UI remains the default surface.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
Expected: zero type errors in both tsconfig passes.

---

### Task 7: Test script, docs, full verification

**Files:**
- Modify: `package.json` (scripts block, next to `test:insights`)
- Modify: `CLAUDE.md` (Orchestration Layer section)

- [ ] **Step 1: Add the test script**

In `package.json`, next to the other `test:*` scripts:

```json
"test:homeshell": "tsx --test src/services/home-shell/__tests__/briefing-view.test.mts src/services/home-shell/__tests__/deck-view.test.mts src/services/home-shell/__tests__/status-ribbon-view.test.mts",
```

- [ ] **Step 2: Run the suite and typecheck**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run test:homeshell && npm run typecheck:all
```
Expected: 20 tests pass, zero type errors.

- [ ] **Step 3: Document in CLAUDE.md**

In `CLAUDE.md`, at the end of the "Orchestration Layer (UI + Wiring)" section, add:

```markdown
### Home Shell (Phase 1 of the UI re-imagination — see docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md)

`src/components/HomeShellOverlay.ts` — feature-flagged (`localStorage crystalball-home-shell=1`,
console: `homeShell=true`) full-screen opening surface: reparented map canvas + three briefing
bands + pinned panel Deck + status ribbon. ⌘⇧H toggles; Esc exits to classic view. Pure
view-models in `src/services/home-shell/` (`briefing-view`, `deck-view`, `status-ribbon-view`),
tested via `npm run test:homeshell`. Deck pins persist at `crystalball-deck-pins`.
```

- [ ] **Step 4: Manual smoke test**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && npm run dev
```

In the browser at the dev URL, open the console and run `homeShell = true`. After reload verify:
1. Home shell covers the app; map renders as backdrop (or dark gradient if map absent).
2. Three briefing bands render (likely "unavailable"/quiet states on a cold dev boot — that's the honest-staleness path working).
3. Scrolling down reveals THE DECK with 12 default cards; most read "not loaded" (panels not yet rendered) — expected.
4. Clicking a card exits the shell and navigates/flashes the classic panel.
5. `⌘K` button and keyboard shortcut open the existing command palette **above** the shell.
6. `⌘⇧H` and `Esc` toggle the shell; the unpin `×` and the "+ pin a panel…" select mutate the deck and survive reload.
7. `homeShell = false` → classic UI boots with no overlay, no console errors.

Fix anything broken before committing (typical suspects: import-path aliases, `all()` signature, z-index vs. cmdk).

- [ ] **Step 5: Commit and push**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-spec && git add package.json CLAUDE.md && git commit -m "chore(home-shell): test script + CLAUDE.md docs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" && git push origin claude/ui-shell-reimagination-spec
```

Then open a PR (`claude/*` branch → requires a Codex cross-agent review before merge; run a real `codex exec --sandbox read-only` review per repo convention).

---

## Self-review notes

- **Spec coverage (Phase 1 scope):** map canvas home (Task 5 map adoption + Task 6 wiring), three briefing bands (Tasks 1, 5), status ribbon (Tasks 3, 5), Deck with adapter S-cards + persistence (Tasks 2, 4, 5), ⌘K v1 (reused existing palette — wired via topbar button; command registry already covers all panels), old sidebar default (flag defaults off). Situation views, Library, panel-metadata registry are Phases 2-3 — intentionally absent.
- **Type consistency:** `formatAge` defined in Task 2, imported by Task 3 and used in labels asserted by both test files. `BriefingBandView`/`DeckCardView`/`StatusRibbonView` names match between view-models (Tasks 1-3) and component imports (Task 5). `PanelHealthLike` is structural so `PanelHealth` from diagnostics satisfies it.
- **HTML-sink governance:** the component builds all DOM with `createElement`/`textContent` (CommandPalettePanel pattern) — no HTML-string sinks anywhere in new code.
- **Known judgment calls:** what-changed snapshots are recorded by both CommandCenterPanel and the home shell — consecutive identical snapshots produce zero deltas, so double-recording is harmless. The Escape key may collide with cmdk's own Esc handling; cmdk is above (z-index) and typically stops propagation — verify in smoke step.
