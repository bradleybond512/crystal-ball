# Phase 2: Library + Panel Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the panel-metadata registry, the 8-domain Library overlay, ⌘K v2 (metadata tags + saved-places + system deprioritization), and flip the Home Shell to default-on for the full desktop variant with a classic-view fallback.

**Architecture:** A one-time generator script seeds `src/config/panel-metadata.ts` (hand-curated afterward) mapping all 405 real FULL_PANELS keys to one of 8 Library domains + tags + tier + featured flags. A pure `library-view.ts` view-model composes domain pages; a DOM-built `LibraryOverlay` renders them (HomeShellOverlay pattern, no HTML sinks). ⌘K v2 merges metadata tags into panel-command keywords, adds an optional `weight` to the registry's ranking, and registers saved-place commands. The default flip is a single shared gate helper (`isHomeShellDefaultOn()`), applied last as an independently-revertable commit.

**Tech Stack:** TypeScript, Vite, `node:test` via `tsx --test`, Node ESM generator script. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md` (Phase 2 section). Phase 1 merged as PR #1393.

---

## Verified codebase facts (do not re-derive)

> **Correction (post-implementation):** FULL_PANELS has **406** keys and the phantom count is
> **61** — `panels.ts:80` defines two panels on one physical line, which defeated the
> line-anchored counting used at plan-authoring time. The 405/62 figures below are the
> planning snapshot, preserved as-written; the shipped registry and its validation test use
> the true 406.

- **FULL_PANELS** (`src/config/panels.ts:9-423`) has **405 unique keys**; the 8 full-variant categories in `PANEL_CATEGORY_MAP` (`:1209+`) reference a union of 467 keys — **62 are phantoms** (in categories but not FULL_PANELS, mostly `intelligence`), **24 real keys appear in exactly 2 categories**, and **0 FULL_PANELS keys are uncategorized**. The registry covers the 405; the generator prints the 62 phantoms as warnings.
- **Titles:** `FULL_PANELS[key].name` is authoritative (all 405 have one). The i18n `panels.*` catalog is partial (53/405, camelCase-keyed) — ignore it.
- **Icon/keyword seed:** `src/config/commands.ts` has 96 `panel:<key>` entries with emoji `icon` + `keywords[]`; 49 match FULL_PANELS keys. Reuse those icons/keywords in generation.
- **System-tier seed list** (36 FULL_PANELS keys found by diagnostics/ops scan — Task 1 embeds it; 6 borderline analytical keys are kept OUT of system tier: `evidence-graph`, `entity-registry`, `geospatial-clustering`, `signal-enrichment`, `temporal-anomaly-detector`, `threat-correlation-matrix`).
- **Command registry** (`src/services/command-palette/command-registry.ts`): `PaletteCommand { id, title, subtitle?, keywords[], category: 'panel'|'action'|'navigation'|'search', icon?, action }`; `register` overwrites on id collision (tested); `search` ranks `max(scoreMatch(title|subtitle|each keyword)) + CATEGORY_WEIGHT[category]` — **no per-command weight exists** (Task 5 adds one). Panel keywords come from ONE place: `built-in-commands.ts:64`. `PALETTE_CATEGORY_ORDER` (`command-registry.ts:129`) and `PALETTE_CATEGORY_LABELS` (`:121-126`) drive UI sections.
- **Saved places** (`src/services/saved-places.ts`): `getSavedPlaces(): SavedPlace[]` (`:396`), `subscribeSavedPlaces(listener): () => void` (`:428`). `SavedPlace` label field is **`name`** (not label); has `id`, `lat`, `lon`, `tags`, `primary`.
- **HomeShellOverlay** (`src/components/HomeShellOverlay.ts`): topbar built at `:92-98` with `button(className, action, label)` helper (`:370`); onClick routes on `data-action` (`:292+`, `cmdk` branch dispatches `cb:toggle-cmdk`); `mount/show/hide/toggle/isVisible/destroy`.
- **Overlay wiring precedent** (`panel-layout.ts:1232-1262`): instantiate → `mount(document.body)` → `document.addEventListener('cb:toggle-x', ...)`; home-shell listener is stored on `this._onHomeShellToggle` and removed in `destroy()` (`:786`) — replicate for Library.
- **Flag reads (all of them):** `main.ts:388-399` (`window.homeShell` get/set), `panel-layout.ts:1253` (mount gate), `shortcut-bootstrap.ts:64` (⌘⇧O gate). No SITE_VARIANT or mobile check exists on any of them today.
- **Mobile guard:** `isMobileDevice()` from `src/utils/index.ts:139-142` (`window.innerWidth <= MOBILE_BREAKPOINT_PX` where the breakpoint is 768). Do NOT use `is-desktop-macos` (that's Tauri-only). CLAUDE.md's "(pointer: fine)" description is stale.
- **Variant guard:** `SITE_VARIANT` from `src/config/variant.ts` is a build-time constant; precedent for full-only: `if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'finance' || SITE_VARIANT === 'happy') return;` (`event-handlers.ts:763`).
- **E2E exposure of the flip:** `npm run smoke` never touches the UI (safe). Real-app Playwright specs that would boot into the overlay under `test:e2e:full`: `e2e/gods-vision-mode.spec.ts`, `e2e/a11y-baseline.spec.ts`, `e2e/theme-toggle.spec.ts` (all desktop viewport). `e2e/mobile-map-native.spec.ts` is protected by the mobile guard. Task 7 adds classic opt-outs to the three.
- **Tests:** `node:test` + `tsx --test`, `__tests__/*.test.mts`, inline `Partial<T>` builders, `.ts`-extension relative imports in services, test files NOT typechecked by `typecheck:all`.
- **DOM:** createElement/textContent only (no HTML sinks). CSS: one file per overlay in `src/styles/`, scoped under a single root class, imported in `main.ts`.
- **Colors:** lint:colors ratchet — new CSS must use tokens (`var(--hs-*)` from tokens.css) or `rgba(var(--*-rgb), α)` composition. The `--hs-*` palette already exists in tokens.css (PR #1397).
- Generator scripts: ESM `.mjs`, `#!/usr/bin/env node`, JSDoc header with Output/Run lines, `node:`-prefixed imports, `projectRoot` bootstrap idiom. No precedent writes TS into src/ — emit a `// GENERATED by scripts/generate-panel-metadata.mjs — seeded once, HAND-CURATED since; edit freely.` banner.

## File structure

```
scripts/generate-panel-metadata.mjs                     (new — one-time seeder, kept for re-seed)
src/config/panel-metadata.ts                            (new — generated then hand-curated registry)
src/config/__tests__/panel-metadata.test.mts            (new — structural validation)
src/services/home-shell/library-view.ts                 (new — pure view-model)
src/services/home-shell/__tests__/library-view.test.mts (new)
src/services/home-shell/shell-gate.ts                   (new — single default-on gate, pure)
src/services/home-shell/__tests__/shell-gate.test.mts   (new)
src/components/LibraryOverlay.ts                        (new — DOM-built overlay)
src/styles/library.css                                  (new — scoped .library-overlay, token colors)
src/services/command-palette/place-commands.ts          (new — saved-place palette entries)
src/services/command-palette/command-registry.ts        (modify — optional weight in rank)
src/services/command-palette/built-in-commands.ts       (modify — merge metadata tags, weight for system tier)
src/components/HomeShellOverlay.ts                      (modify — Library topbar button + action branch)
src/app/panel-layout.ts                                 (modify — Library wiring; gate swap)
src/services/keyboard/shortcut-bootstrap.ts             (modify — gate swap)
src/main.ts                                             (modify — css import; classicView console setter)
e2e/gods-vision-mode.spec.ts, e2e/a11y-baseline.spec.ts,
e2e/theme-toggle.spec.ts                                (modify — classic-view opt-out init script)
e2e/home-shell-boot.spec.ts                             (new — default-on boot smoke)
package.json                                            (modify — test:homeshell additions)
CLAUDE.md                                               (modify — Home Shell section update)
```

Work in `/Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2` on branch `claude/phase2-library-metadata` (already created from origin/main). **All git commands must cd into the worktree in the same shell command.**

---

### Task 1: Generator script + seeded `panel-metadata.ts`

**Files:**
- Create: `scripts/generate-panel-metadata.mjs`
- Create: `src/config/panel-metadata.ts` (by running the script)

- [ ] **Step 1: Write the generator**

Create `scripts/generate-panel-metadata.mjs`:

```js
#!/usr/bin/env node
/**
 * generate-panel-metadata.mjs — one-time seeder for the Library metadata
 * registry (Phase 2 of the UI shell re-imagination).
 *
 * Reads FULL_PANELS + PANEL_CATEGORY_MAP out of src/config/panels.ts and
 * icon/keyword seeds out of src/config/commands.ts, then emits
 * src/config/panel-metadata.ts covering every FULL_PANELS key exactly once.
 * Category keys with no FULL_PANELS entry (phantoms) are reported and
 * skipped. The emitted file is HAND-CURATED after seeding — re-running
 * this script overwrites curation; do so only deliberately.
 *
 * Output: src/config/panel-metadata.ts
 * Run:    node scripts/generate-panel-metadata.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parse panels.ts (regex extraction — the file is data-shaped; a TS import
// would drag in the vite alias graph, so we scrape like check-docs-freshness
// does).
// ---------------------------------------------------------------------------

const panelsSrc = fs.readFileSync(path.join(projectRoot, 'src/config/panels.ts'), 'utf8');

// FULL_PANELS block: from "const FULL_PANELS" to the next top-level "const".
const fullBlock = panelsSrc.slice(
  panelsSrc.indexOf('const FULL_PANELS'),
  panelsSrc.indexOf('const FULL_MAP_LAYERS'),
);
const panelEntry = /(?:'([\w-]+)'|^\s{0,2}([\w$]+)):\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'/gmu;
const fullPanels = new Map(); // key -> name
for (const m of fullBlock.matchAll(panelEntry)) {
  const key = m[1] ?? m[2];
  fullPanels.set(key, m[3].replace(/\\'/gu, "'"));
}

// Category → keys (full-variant categories only).
const catBlock = panelsSrc.slice(
  panelsSrc.indexOf('PANEL_CATEGORY_MAP'),
  panelsSrc.indexOf('MONITOR_COLORS'),
);
const categories = {};
for (const m of catBlock.matchAll(/(\w+):\s*\{[^}]*?panelKeys:\s*\[([^\]]*)\]/gsu)) {
  categories[m[1]] = [...m[2].matchAll(/'([\w-]+)'/gu)].map((k) => k[1]);
}
const FULL_VARIANT_CATS = ['core', 'intelligence', 'regionalNews', 'marketsFinance', 'topical', 'dataTracking', 'hazards', 'healthEnv'];

// commands.ts icon/keyword seeds.
const commandsSrc = fs.readFileSync(path.join(projectRoot, 'src/config/commands.ts'), 'utf8');
const seedRe = /id:\s*'panel:([\w-]+)'[^}]*?keywords:\s*\[([^\]]*)\][^}]*?(?:icon:\s*'([^']*)')?/gsu;
const seeds = new Map();
for (const m of commandsSrc.matchAll(seedRe)) {
  seeds.set(m[1], {
    keywords: [...m[2].matchAll(/'([^']*)'/gu)].map((k) => k[1].toLowerCase()),
    icon: m[3],
  });
}

// ---------------------------------------------------------------------------
// Domain assignment: category base + keyword overrides. Order matters —
// first match wins.
// ---------------------------------------------------------------------------

const CATEGORY_TO_DOMAIN = {
  core: 'global-intel',
  intelligence: 'global-intel',
  regionalNews: 'global-intel',
  topical: 'global-intel',
  marketsFinance: 'markets-economy',
  dataTracking: 'cyber-infrastructure',
  hazards: 'hazards-weather',
  healthEnv: 'health-environment',
};

// key-substring → domain overrides (checked against the panel KEY).
const KEY_OVERRIDES = [
  [/space|satellite|orbit|reentry|neo-tracker|aerospace|aviation|air-traffic|faa|spaceflight|launch/u, 'space-aviation'],
  [/cyber|cve|vulners|hibp|phish|urlscan|pulsedive|ioc|stix|dark-web|network|ics-ot|grid|power|internet|infra/u, 'cyber-infrastructure'],
  [/watchlist|saved-places|travel-safety|evacuation|family|offline-maps|comms-plan|local-logistics|personal|resource-inventory|emergency/u, 'personal-safety'],
  [/disease|health|pandemic|air-quality|pollen|water-quality|radiation|humanitarian|food-insecurity|openaq|ecdc/u, 'health-environment'],
  [/market|crypto|econom|finance|debt|fdic|edgar|etf|stablecoin|fuel-price|commodit|trade|supply-chain|shortage/u, 'markets-economy'],
  [/weather|storm|flood|wildfire|fire|earthquake|seismic|volcano|tsunami|cyclone|avalanche|hazmat|gdacs|climate/u, 'hazards-weather'],
];

// Explicit system-tier keys (diagnostics/ops — verified against FULL_PANELS).
const SYSTEM_KEYS = new Set([
  'active-learning', 'ai-governance', 'alert-fatigue-dashboard', 'alert-rules-tuning',
  'alert-trace', 'algo-eval', 'algorithm-diagnostic', 'api-diagnostic', 'backtest',
  'belief-calibration', 'collection-gap', 'comms-health', 'counterfactual-replay',
  'event-store', 'feed-health', 'feed-health-dashboard', 'historical-playback',
  'improvement-scheduler', 'intelligence-quality-debt', 'mission-ledger-bridge',
  'model-governance', 'multi-agent-review', 'operator-mode', 'outcome-ledger',
  'repair-recommendations', 'safety-case', 'scenario-replay', 'self-test',
  'shadow-comparison', 'shadow-mode', 'signal-noise-filter', 'source-confidence',
  'system-diagnostic', 'world-state-comparator',
]);

// Featured seeds per domain — hand-curated starting point; the emitted file
// is the place to refine. Keys not in FULL_PANELS are dropped with a warning.
const FEATURED = {
  'personal-safety': ['watchlist', 'travel-safety', 'evacuation', 'family-tracker', 'offline-maps', 'comms-plan'],
  'global-intel': ['command-center', 'threat-dashboard', 'intel', 'situations', 'global-risk-heatmap', 'strategic-posture'],
  'markets-economy': ['markets', 'economic', 'crypto', 'commodities', 'shortage-radar', 'polymarket'],
  'hazards-weather': ['severe-weather', 'nws-alerts', 'earthquakes', 'wildfire-intel', 'tropical-cyclones', 'flood-monitor'],
  'cyber-infrastructure': ['cyber-threats', 'cve-tracker', 'power-grid', 'internet-disruptions', 'threat-intel-hub', 'ics-ot-dashboard'],
  'space-aviation': ['space-weather', 'air-traffic', 'neo-tracker', 'satellite-intel', 'space-launches', 'aerospace-reentry'],
  'health-environment': ['disease-outbreaks', 'air-quality', 'humanitarian-crisis', 'food-insecurity', 'water-quality', 'radiation-decay'],
  'system-health': ['system-diagnostic', 'command-center', 'feed-health', 'algorithm-diagnostic', 'source-confidence', 'self-test'],
};

// Alias pairs (duplicate-flagging only; never merged).
const ALIASES = { backtest: undefined }; // populated below from name collisions

function assignDomain(key, cats) {
  if (SYSTEM_KEYS.has(key)) return 'system-health';
  for (const [re, domain] of KEY_OVERRIDES) if (re.test(key)) return domain;
  for (const cat of cats) {
    const d = CATEGORY_TO_DOMAIN[cat];
    if (d) return d;
  }
  return 'global-intel';
}

function tagsFor(key, name) {
  const seed = seeds.get(key)?.keywords ?? [];
  const words = new Set([
    ...key.split('-'),
    ...name.toLowerCase().split(/[^a-z0-9]+/u),
    ...seed,
  ]);
  words.delete('');
  words.delete('panel');
  return [...words].sort();
}

// ---------------------------------------------------------------------------
// Build + emit
// ---------------------------------------------------------------------------

const keyToCats = new Map();
for (const cat of FULL_VARIANT_CATS) {
  for (const k of categories[cat] ?? []) {
    if (!keyToCats.has(k)) keyToCats.set(k, []);
    keyToCats.get(k).push(cat);
  }
}

const phantoms = [...keyToCats.keys()].filter((k) => !fullPanels.has(k));
if (phantoms.length > 0) {
  console.warn(`[generate-panel-metadata] ${phantoms.length} category keys have no FULL_PANELS entry (skipped):`);
  console.warn('  ' + phantoms.join(', '));
}

const featuredByKey = new Map();
for (const [domain, keys] of Object.entries(FEATURED)) {
  for (const k of keys) {
    if (!fullPanels.has(k)) {
      console.warn(`[generate-panel-metadata] featured key '${k}' (${domain}) not in FULL_PANELS — dropped`);
      continue;
    }
    featuredByKey.set(k, domain);
  }
}

const lines = [];
for (const [key, name] of [...fullPanels.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const cats = keyToCats.get(key) ?? [];
  const domain = assignDomain(key, cats);
  const tier = SYSTEM_KEYS.has(key) ? 'system' : 'library';
  const featured = featuredByKey.get(key) === domain;
  const icon = seeds.get(key)?.icon;
  const tags = tagsFor(key, name);
  const parts = [
    `domain: '${domain}'`,
    `tags: [${tags.map((t) => `'${t.replace(/'/gu, "\\'")}'`).join(', ')}]`,
    `tier: '${tier}'`,
  ];
  if (featured) parts.push('featured: true');
  if (icon) parts.push(`icon: '${icon}'`);
  lines.push(`  '${key}': { ${parts.join(', ')} },`);
}

const out = `// GENERATED by scripts/generate-panel-metadata.mjs — seeded once,
// HAND-CURATED since; edit freely. Re-running the script OVERWRITES curation.
// Validation: src/config/__tests__/panel-metadata.test.mts

export type LibraryDomain =
  | 'personal-safety'
  | 'global-intel'
  | 'markets-economy'
  | 'hazards-weather'
  | 'cyber-infrastructure'
  | 'space-aviation'
  | 'health-environment'
  | 'system-health';

export interface PanelMeta {
  domain: LibraryDomain;
  /** Extra ⌘K search terms beyond the panel name. Lowercase. */
  tags: readonly string[];
  /** 'system' panels are excluded from Library front pages and deprioritized in ⌘K. */
  tier: 'library' | 'system';
  /** Shown on the domain's curated front page. */
  featured?: boolean;
  /** Emoji glyph for Library cards and ⌘K rows. */
  icon?: string;
  /** Flags a near-duplicate of another panel; never auto-merged. */
  aliasOf?: string;
}

export const LIBRARY_DOMAIN_LABELS: Record<LibraryDomain, string> = {
  'personal-safety': 'Personal Safety',
  'global-intel': 'Global Intel',
  'markets-economy': 'Markets & Economy',
  'hazards-weather': 'Hazards & Weather',
  'cyber-infrastructure': 'Cyber & Infrastructure',
  'space-aviation': 'Space & Aviation',
  'health-environment': 'Health & Environment',
  'system-health': 'System Health',
};

export const PANEL_METADATA: Record<string, PanelMeta> = {
${lines.join('\n')}
};
`;

fs.writeFileSync(path.join(projectRoot, 'src/config/panel-metadata.ts'), out);
console.log(`[generate-panel-metadata] wrote ${fullPanels.size} entries (${phantoms.length} phantoms skipped)`);
```

- [ ] **Step 2: Run it**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && node scripts/generate-panel-metadata.mjs
```
Expected: `wrote 405 entries (62 phantoms skipped)` plus warnings listing phantoms and any dropped featured keys. If a FEATURED key was dropped, replace it in the script with a real key from the same domain (search FULL_PANELS by name) and re-run until each domain has ≥4 surviving featured keys.

- [ ] **Step 3: Typecheck the generated file**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npm run typecheck
```
Expected: zero errors. If the regex scrape produced a malformed entry (unescaped quote etc.), fix the generator, not the output, and re-run.

- [ ] **Step 4: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && git add scripts/generate-panel-metadata.mjs src/config/panel-metadata.ts && git commit -m "feat(library): panel-metadata registry seeded from category map

405 panels mapped to 8 Library domains with tags/tier/featured;
62 phantom category keys reported and skipped.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Registry validation test

**Files:**
- Test: `src/config/__tests__/panel-metadata.test.mts`

- [ ] **Step 1: Write the test**

Create `src/config/__tests__/panel-metadata.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIBRARY_DOMAIN_LABELS,
  PANEL_METADATA,
} from '../panel-metadata.ts';
import { DEFAULT_PANELS } from '../panels.ts';
import { DEFAULT_DECK_PINS } from '../../services/home-shell/deck-view.ts';

const DOMAINS = Object.keys(LIBRARY_DOMAIN_LABELS);

test('every FULL_PANELS key has exactly one metadata entry and vice versa', () => {
  const metaKeys = Object.keys(PANEL_METADATA).sort();
  const panelKeys = Object.keys(DEFAULT_PANELS).sort();
  assert.deepEqual(metaKeys, panelKeys);
});

test('every entry has a known domain and lowercase non-empty tags', () => {
  for (const [key, meta] of Object.entries(PANEL_METADATA)) {
    assert.ok(DOMAINS.includes(meta.domain), `${key}: unknown domain ${meta.domain}`);
    assert.ok(meta.tags.length > 0, `${key}: no tags`);
    for (const t of meta.tags) {
      assert.equal(t, t.toLowerCase(), `${key}: tag '${t}' not lowercase`);
      assert.ok(t.trim().length > 0, `${key}: empty tag`);
    }
  }
});

test('system tier is populated and system panels are never featured', () => {
  const system = Object.entries(PANEL_METADATA).filter(([, m]) => m.tier === 'system');
  assert.ok(system.length >= 25, `expected >=25 system panels, got ${system.length}`);
  for (const [key, meta] of system) {
    if (key === 'system-diagnostic' || meta.domain === 'system-health') continue;
    assert.equal(meta.domain, 'system-health', `${key}: system tier outside system-health domain`);
  }
});

test('every domain has at least 4 featured library-tier panels (system-health exempt from tier rule)', () => {
  for (const domain of DOMAINS) {
    const featured = Object.entries(PANEL_METADATA).filter(
      ([, m]) => m.domain === domain && m.featured,
    );
    assert.ok(featured.length >= 4, `${domain}: only ${featured.length} featured`);
  }
});

test('aliasOf targets exist', () => {
  for (const [key, meta] of Object.entries(PANEL_METADATA)) {
    if (meta.aliasOf) {
      assert.ok(PANEL_METADATA[meta.aliasOf], `${key}: aliasOf '${meta.aliasOf}' missing`);
    }
  }
});

test('deck defaults are covered by the registry', () => {
  for (const pin of DEFAULT_DECK_PINS) {
    assert.ok(PANEL_METADATA[pin], `deck default '${pin}' missing from registry`);
  }
});
```

- [ ] **Step 2: Run it**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npx tsx --test src/config/__tests__/panel-metadata.test.mts
```
Expected: PASS (6 tests). Failures here mean the generator seeds need adjusting (e.g. a domain short on featured entries, or a system key landing outside system-health). Fix by hand-editing `src/config/panel-metadata.ts` (that IS the workflow — it's hand-curated now) OR adjusting the generator + re-running; keep the test green either way.

- [ ] **Step 3: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && git add src/config/__tests__/panel-metadata.test.mts src/config/panel-metadata.ts scripts/generate-panel-metadata.mjs && git commit -m "test(library): structural validation for panel metadata

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
(Include the registry/generator in the add in case Step 2 required curation.)

---

### Task 3: `library-view.ts` — pure view-model

**Files:**
- Create: `src/services/home-shell/library-view.ts`
- Test: `src/services/home-shell/__tests__/library-view.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/home-shell/__tests__/library-view.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibraryView } from '../library-view.ts';
import type { LibraryInputs } from '../library-view.ts';
import type { PanelMeta } from '../../../config/panel-metadata.ts';

function meta(overrides: Partial<PanelMeta> = {}): PanelMeta {
  return { domain: 'hazards-weather', tags: ['weather'], tier: 'library', ...overrides };
}

function inputs(): LibraryInputs {
  return {
    metadata: {
      'severe-weather': meta({ featured: true, icon: '⛈️' }),
      earthquakes: meta({ tags: ['seismic', 'usgs'] }),
      markets: meta({ domain: 'markets-economy', featured: true }),
      'self-test': meta({ domain: 'system-health', tier: 'system' }),
    },
    names: {
      'severe-weather': { name: 'Severe Weather' },
      earthquakes: { name: 'Earthquakes' },
      markets: { name: 'Markets' },
      'self-test': { name: 'Self-Test' },
    },
    domainLabels: {
      'personal-safety': 'Personal Safety',
      'global-intel': 'Global Intel',
      'markets-economy': 'Markets & Economy',
      'hazards-weather': 'Hazards & Weather',
      'cyber-infrastructure': 'Cyber & Infrastructure',
      'space-aviation': 'Space & Aviation',
      'health-environment': 'Health & Environment',
      'system-health': 'System Health',
    },
  };
}

test('groups panels into 8 domains with featured first and counts', () => {
  const view = buildLibraryView(inputs(), '');
  assert.equal(view.domains.length, 8);
  const hazards = view.domains.find((d) => d.domain === 'hazards-weather')!;
  assert.equal(hazards.label, 'Hazards & Weather');
  assert.equal(hazards.totalCount, 2);
  assert.deepEqual(hazards.featured.map((p) => p.panelId), ['severe-weather']);
  assert.deepEqual(hazards.rest.map((p) => p.panelId), ['earthquakes']);
  assert.equal(hazards.featured[0]!.icon, '⛈️');
});

test('system-health domain is ordered last', () => {
  const view = buildLibraryView(inputs(), '');
  assert.equal(view.domains[view.domains.length - 1]!.domain, 'system-health');
});

test('query filters by name and tags across all domains, case-insensitive', () => {
  const byTag = buildLibraryView(inputs(), 'USGS');
  const hazards = byTag.domains.find((d) => d.domain === 'hazards-weather')!;
  assert.deepEqual(hazards.rest.map((p) => p.panelId), ['earthquakes']);
  assert.equal(hazards.featured.length, 0);
  assert.equal(byTag.matchCount, 1);
  const byName = buildLibraryView(inputs(), 'market');
  assert.equal(byName.matchCount, 1);
  assert.deepEqual(byName.domains.find((d) => d.domain === 'markets-economy')!.featured.map((p) => p.panelId), ['markets']);
});

test('empty domains are kept (with zero counts) so the nav rail is stable', () => {
  const view = buildLibraryView(inputs(), 'zzz-no-match');
  assert.equal(view.domains.length, 8);
  assert.equal(view.matchCount, 0);
  assert.ok(view.domains.every((d) => d.featured.length === 0 && d.rest.length === 0));
});

test('panels sort alphabetically by title within featured and rest', () => {
  const two = inputs();
  two.metadata['zeta-weather'] = meta();
  two.names['zeta-weather'] = { name: 'Zeta Weather' };
  two.metadata['alpha-weather'] = meta();
  two.names['alpha-weather'] = { name: 'Alpha Weather' };
  const hazards = buildLibraryView(two, '').domains.find((d) => d.domain === 'hazards-weather')!;
  assert.deepEqual(hazards.rest.map((p) => p.title), ['Alpha Weather', 'Earthquakes', 'Zeta Weather']);
});
```

- [ ] **Step 2: Run to verify FAIL** (`Cannot find module '../library-view.ts'`)

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npx tsx --test src/services/home-shell/__tests__/library-view.test.mts
```

- [ ] **Step 3: Implement**

Create `src/services/home-shell/library-view.ts`:

```ts
/**
 * Library view-model — groups the panel-metadata registry into the 8
 * Library domains with featured-first ordering and query filtering.
 *
 * Pure deterministic: no DOM, no fetch, no globals.
 */

import type { LibraryDomain, PanelMeta } from '../../config/panel-metadata.ts';

export interface LibraryPanelView {
  panelId: string;
  title: string;
  icon?: string;
  tier: 'library' | 'system';
}

export interface LibraryDomainView {
  domain: LibraryDomain;
  label: string;
  featured: readonly LibraryPanelView[];
  rest: readonly LibraryPanelView[];
  totalCount: number;
}

export interface LibraryView {
  domains: readonly LibraryDomainView[];
  matchCount: number;
}

export interface LibraryInputs {
  metadata: Readonly<Record<string, PanelMeta>>;
  /** DEFAULT_PANELS-shaped name lookup. */
  names: Readonly<Record<string, { name: string } | undefined>>;
  domainLabels: Readonly<Record<LibraryDomain, string>>;
}

/** Nav-rail order; system-health always last. */
const DOMAIN_ORDER: readonly LibraryDomain[] = [
  'personal-safety',
  'global-intel',
  'markets-economy',
  'hazards-weather',
  'cyber-infrastructure',
  'space-aviation',
  'health-environment',
  'system-health',
];

export function buildLibraryView(inputs: LibraryInputs, query: string): LibraryView {
  const q = query.trim().toLowerCase();
  const byDomain = new Map<LibraryDomain, { featured: LibraryPanelView[]; rest: LibraryPanelView[] }>();
  for (const domain of DOMAIN_ORDER) byDomain.set(domain, { featured: [], rest: [] });

  let matchCount = 0;
  for (const [panelId, meta] of Object.entries(inputs.metadata)) {
    const title = inputs.names[panelId]?.name ?? panelId;
    if (q && !matches(q, title, panelId, meta)) continue;
    matchCount += 1;
    const bucket = byDomain.get(meta.domain);
    if (!bucket) continue;
    const view: LibraryPanelView = { panelId, title, icon: meta.icon, tier: meta.tier };
    if (meta.featured) bucket.featured.push(view);
    else bucket.rest.push(view);
  }

  const domains = DOMAIN_ORDER.map((domain) => {
    const bucket = byDomain.get(domain)!;
    bucket.featured.sort(byTitle);
    bucket.rest.sort(byTitle);
    return {
      domain,
      label: inputs.domainLabels[domain],
      featured: bucket.featured,
      rest: bucket.rest,
      totalCount: bucket.featured.length + bucket.rest.length,
    };
  });

  return { domains, matchCount };
}

function matches(q: string, title: string, panelId: string, meta: PanelMeta): boolean {
  if (title.toLowerCase().includes(q)) return true;
  if (panelId.includes(q)) return true;
  return meta.tags.some((t) => t.includes(q));
}

function byTitle(a: LibraryPanelView, b: LibraryPanelView): number {
  return a.title.localeCompare(b.title);
}
```

- [ ] **Step 4: Run to verify PASS** (5 tests), then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && git add src/services/home-shell/library-view.ts src/services/home-shell/__tests__/library-view.test.mts && git commit -m "feat(library): pure library view-model

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: `LibraryOverlay` component + stylesheet + wiring

**Files:**
- Create: `src/components/LibraryOverlay.ts`
- Create: `src/styles/library.css`
- Modify: `src/main.ts` (css import block)
- Modify: `src/components/HomeShellOverlay.ts` (topbar button + action branch)
- Modify: `src/app/panel-layout.ts` (mount + tracked listener)

All DOM via createElement/textContent — no HTML sinks. All colors via `--hs-*` tokens (already in tokens.css) — lint:colors must stay green.

- [ ] **Step 1: Create the stylesheet**

Create `src/styles/library.css`:

```css
/* Library — Phase 2 of the UI shell re-imagination.
   Browsable 8-domain panel catalog. Scoped under .library-overlay.
   Palette: --hs-* tokens (tokens.css, Home Shell section). */

.library-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001; /* above home shell (10000), below cmdk (10005) */
  background: var(--hs-bg-base);
  color: var(--hs-fg);
  font-family: ui-monospace, Menlo, Monaco, monospace;
  display: flex;
  flex-direction: column;
}

.library-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--hs-white-rgb), 0.08);
}

.library-title { font-size: 13px; font-weight: 600; }

.library-search {
  flex: 1;
  max-width: 420px;
  background: var(--hs-bg-card);
  border: 1px solid rgba(var(--hs-white-rgb), 0.14);
  border-radius: 8px;
  color: var(--hs-fg);
  font: inherit;
  font-size: 11px;
  padding: 5px 12px;
}

.library-close {
  margin-left: auto;
  border: 1px solid rgba(var(--hs-white-rgb), 0.14);
  border-radius: 6px;
  background: transparent;
  color: var(--hs-fg-muted);
  font: inherit;
  font-size: 10px;
  padding: 4px 10px;
  cursor: pointer;
}

.library-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.library-nav {
  width: 200px;
  border-right: 1px solid rgba(var(--hs-white-rgb), 0.08);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.library-nav button {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--hs-fg-muted);
  font: inherit;
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
}

.library-nav button.active {
  background: rgba(var(--hs-white-rgb), 0.08);
  color: var(--hs-fg);
}

.library-nav .lib-count { color: var(--hs-fg-dim); font-size: 10px; }

.library-content {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
}

.lib-section-label {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--hs-fg-muted);
  margin: 10px 0 8px;
}

.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.lib-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--hs-bg-card);
  border: 1px solid rgba(var(--hs-white-rgb), 0.09);
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 11px;
  color: var(--hs-fg);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.lib-card:hover { border-color: rgba(var(--hs-white-rgb), 0.25); }
.lib-card .lib-icon { font-size: 13px; }
.lib-card.lib-system { color: var(--hs-fg-muted); }

.lib-more {
  margin: 8px 0 4px;
  background: transparent;
  border: 1px dashed rgba(var(--hs-white-rgb), 0.2);
  border-radius: 6px;
  color: var(--hs-fg-faint);
  font: inherit;
  font-size: 10px;
  padding: 5px 10px;
  cursor: pointer;
}

.lib-empty { color: var(--hs-fg-dim); font-size: 11px; padding: 20px 0; }
```

- [ ] **Step 2: Create the component**

Create `src/components/LibraryOverlay.ts`:

```ts
/**
 * Library — Phase 2 of the UI shell re-imagination
 * (docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md).
 *
 * Browsable catalog of every panel, grouped into 8 domains with curated
 * featured rows and a collapsed long tail. Composition logic lives in the
 * pure view-model src/services/home-shell/library-view.ts. All DOM built
 * with createElement/textContent — no HTML-string sinks.
 */

import { DEFAULT_PANELS } from '@/config/panels';
import { LIBRARY_DOMAIN_LABELS, PANEL_METADATA } from '@/config/panel-metadata';
import type { LibraryDomain } from '@/config/panel-metadata';
import { buildLibraryView } from '@/services/home-shell/library-view';
import type { LibraryDomainView, LibraryPanelView } from '@/services/home-shell/library-view';

export class LibraryOverlay {
  private root: HTMLElement | null = null;
  private navEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private searchEl: HTMLInputElement | null = null;
  private visible = false;
  private activeDomain: LibraryDomain = 'personal-safety';
  private query = '';
  private expanded = new Set<LibraryDomain>();

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented && this.visible) this.hide();
  };

  mount(parent: HTMLElement): void {
    if (this.root) return;
    const root = el('div', 'library-overlay');
    root.hidden = true;

    const topbar = el('header', 'library-topbar');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'library-search';
    search.placeholder = 'Filter panels by name or tag…';
    this.searchEl = search;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'library-close';
    close.dataset.action = 'close';
    close.textContent = 'Close ⎋';
    topbar.append(el('span', 'library-title', '📚 Library'), search, close);

    const body = el('div', 'library-body');
    this.navEl = el('nav', 'library-nav');
    this.contentEl = el('div', 'library-content');
    body.append(this.navEl, this.contentEl);
    root.append(topbar, body);

    root.addEventListener('click', (e) => this.onClick(e));
    search.addEventListener('input', () => {
      this.query = search.value;
      this.render();
    });
    parent.append(root);
    this.root = root;
  }

  show(): void {
    if (!this.root || this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    document.addEventListener('keydown', this.onKeydown);
    this.render();
    this.searchEl?.focus();
  }

  hide(): void {
    if (!this.root || !this.visible) return;
    this.visible = false;
    this.root.hidden = true;
    document.removeEventListener('keydown', this.onKeydown);
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

  // ── Render ────────────────────────────────────────────────────────

  private render(): void {
    if (!this.navEl || !this.contentEl) return;
    const view = buildLibraryView(
      { metadata: PANEL_METADATA, names: DEFAULT_PANELS, domainLabels: LIBRARY_DOMAIN_LABELS },
      this.query,
    );

    this.navEl.replaceChildren(
      ...view.domains.map((d) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.domain = d.domain;
        if (d.domain === this.activeDomain) b.classList.add('active');
        b.append(el('span', undefined, d.label), el('span', 'lib-count', String(d.totalCount)));
        return b;
      }),
    );

    const active = view.domains.find((d) => d.domain === this.activeDomain);
    if (!active || active.totalCount === 0) {
      this.contentEl.replaceChildren(
        el('div', 'lib-empty', this.query ? `No panels match “${this.query}” in ${active?.label ?? 'this domain'}.` : 'Nothing here.'),
      );
      return;
    }
    this.contentEl.replaceChildren(...this.renderDomain(active));
  }

  private renderDomain(d: LibraryDomainView): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (d.featured.length > 0) {
      out.push(el('div', 'lib-section-label', 'FEATURED'));
      out.push(grid(d.featured));
    }
    if (d.rest.length > 0) {
      const showAll = this.expanded.has(d.domain) || this.query.trim().length > 0 || d.featured.length === 0;
      if (showAll) {
        out.push(el('div', 'lib-section-label', `ALL ${d.totalCount} PANELS`));
        out.push(grid(d.rest));
      } else {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'lib-more';
        more.dataset.action = 'expand';
        more.dataset.domain = d.domain;
        more.textContent = `all ${d.totalCount} panels →`;
        out.push(more);
      }
    }
    return out;
  }

  // ── Interactions ──────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') {
      this.hide();
      return;
    }
    if (action === 'expand') {
      const domain = target.closest<HTMLElement>('[data-domain]')?.dataset.domain as LibraryDomain | undefined;
      if (domain) {
        this.expanded.add(domain);
        this.render();
      }
      return;
    }
    const navDomain = target.closest<HTMLElement>('.library-nav button')?.dataset.domain as LibraryDomain | undefined;
    if (navDomain) {
      this.activeDomain = navDomain;
      this.render();
      return;
    }
    const panelKey = target.closest<HTMLElement>('[data-panel-key]')?.dataset.panelKey;
    if (panelKey) {
      this.hide();
      document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey } }));
    }
  }
}

// ── Module-private helpers ──────────────────────────────────────────

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function grid(panels: readonly LibraryPanelView[]): HTMLElement {
  const g = el('div', 'lib-grid');
  g.append(
    ...panels.map((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = p.tier === 'system' ? 'lib-card lib-system' : 'lib-card';
      card.dataset.panelKey = p.panelId;
      if (p.icon) card.append(el('span', 'lib-icon', p.icon));
      card.append(el('span', undefined, p.title));
      return card;
    }),
  );
  return g;
}
```

- [ ] **Step 3: Wire it up**

1. `src/main.ts` CSS block (lines 2-7): add `import './styles/library.css';`
2. `src/components/HomeShellOverlay.ts` topbar (`:92-98`): add a Library button between the spacer and the exit button:
```ts
      button('home-shell-library', 'library', '📚 Library'),
```
   and in `onClick`, after the `cmdk` branch:
```ts
    if (action === 'library') {
      document.dispatchEvent(new CustomEvent('cb:toggle-library'));
      return;
    }
```
   Add a `.home-shell-library` rule to `src/styles/home-shell.css` cloned from `.home-shell-exit` (same border/color/font, `font-size: 11px; padding: 5px 12px;`).
3. `src/app/panel-layout.ts`: import `LibraryOverlay`; add fields
```ts
  private libraryOverlay: LibraryOverlay | null = null;
  private _onLibraryToggle: (() => void) | null = null;
```
   directly after the cmdk wiring block (~`:1249`, BEFORE the home-shell gate — the Library must exist for classic users too):
```ts
    // Library (Phase 2 UI re-imagination) — browsable panel catalog.
    this.libraryOverlay = new LibraryOverlay();
    this.libraryOverlay.mount(document.body);
    this._onLibraryToggle = () => this.libraryOverlay?.toggle();
    document.addEventListener('cb:toggle-library', this._onLibraryToggle);
```
   and in `destroy()` next to the home-shell teardown (`:784-786` area):
```ts
 if (this.libraryOverlay) { this.libraryOverlay.destroy(); this.libraryOverlay = null; }
 if (this._onLibraryToggle) { document.removeEventListener('cb:toggle-library', this._onLibraryToggle); this._onLibraryToggle = null; }
```

- [ ] **Step 4: Verify + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npm run typecheck:all && node scripts/lint-colors.mjs src/styles/library.css && npm run test:homeshell && git add src/components/LibraryOverlay.ts src/styles/library.css src/styles/home-shell.css src/components/HomeShellOverlay.ts src/app/panel-layout.ts src/main.ts && git commit -m "feat(library): 8-domain Library overlay + shell/classic wiring

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
Expected: zero type errors, lint:colors 0 offenders, 28 home-shell tests pass.

---

### Task 5: ⌘K v2 — weight in ranking, metadata tags, place commands

**Files:**
- Modify: `src/services/command-palette/command-registry.ts` (add `weight?`)
- Modify: `src/services/command-palette/built-in-commands.ts` (tags + system weight + Library command)
- Create: `src/services/command-palette/place-commands.ts`
- Test: `src/services/command-palette/__tests__/place-commands.test.mts`
- Modify (extend): existing `src/services/command-palette/__tests__/command-registry.test.mts`

- [ ] **Step 1: Add `weight` to the registry (test first)**

Append to the EXISTING `src/services/command-palette/__tests__/command-registry.test.mts` (read its builder/imports first and match style):

```ts
test('negative weight demotes a command below an otherwise-equal match', () => {
  const reg = createCommandRegistry();
  reg.register({ id: 'panel:a', title: 'Alpha Feed', keywords: ['feed'], category: 'panel', action: () => {} });
  reg.register({ id: 'panel:b', title: 'Alpha Feed Diagnostics', keywords: ['feed'], category: 'panel', weight: -1.5, action: () => {} });
  const results = reg.search('feed', 8);
  const ids = results.map((r) => r.command.id);
  assert.ok(ids.indexOf('panel:a') < ids.indexOf('panel:b'), `expected a before b, got ${ids.join(',')}`);
});
```

(If the test file constructs the registry differently — e.g. via `getCommandRegistry()` with `clear()` — mirror that pattern instead of `createCommandRegistry()`; read the file first.)

Run it: FAIL (weight not a known property / ordering wrong).

Then in `command-registry.ts`:
- Add to `PaletteCommand`:
```ts
  /** Additive rank bias. Negative demotes (e.g. system-tier panels). Default 0. */
  weight?: number;
```
- In `rank()` (both the empty-query and scored paths), add `+ (cmd.weight ?? 0)` to the returned score.

Run the test again: PASS. Run the whole existing registry test file: all pass.

- [ ] **Step 2: Merge metadata tags + demote system panels in built-in commands**

In `src/services/command-palette/built-in-commands.ts`, import the registry:

```ts
import { PANEL_METADATA } from '../../config/panel-metadata';
```

(match the file's existing import style — check whether it uses `@/` or relative; it's a service, likely relative or `@/config/...` — mirror neighbors.)

Replace the panel-command loop body (`:58-68`) keywords/weight portion:

```ts
  for (const [panelKey, cfg] of Object.entries(panels)) {
    if (!cfg) continue;
    const meta = PANEL_METADATA[panelKey];
    out.push({
      id: `panel:${panelKey}`,
      title: `Open ${cfg.name}`,
      subtitle: panelKey,
      keywords: [
        panelKey.replace(/-/g, ' '),
        cfg.name.toLowerCase(),
        'panel',
        'open',
        ...(meta?.tags ?? []),
      ],
      category: 'panel',
      icon: meta?.icon,
      weight: meta?.tier === 'system' ? -1.5 : 0,
      action: () => deps.dispatch('cb:navigate-panel', { panelKey }),
    });
  }
```

Also add ONE navigation command for the Library (near the existing navigation commands, matching their shape):

```ts
  out.push({
    id: 'navigation:library',
    title: 'Open Library',
    keywords: ['library', 'catalog', 'browse', 'panels', 'domains'],
    category: 'navigation',
    icon: '📚',
    action: () => deps.dispatch('cb:toggle-library'),
  });
```

(`deps.dispatch` with no detail — check the dispatch signature at `panel-layout.ts:1244-1246`: it accepts `(name, detail?)`.)

- [ ] **Step 3: Place commands (test first)**

Create `src/services/command-palette/__tests__/place-commands.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlaceCommands } from '../place-commands.ts';
import type { PlaceLike } from '../place-commands.ts';

function place(overrides: Partial<PlaceLike> = {}): PlaceLike {
  return { id: 'p1', name: 'Home', lat: 41.6, lon: -86.7, primary: true, ...overrides };
}

test('builds one navigation command per place with stable ids', () => {
  const dispatched: Array<{ name: string; detail?: unknown }> = [];
  const cmds = buildPlaceCommands([place(), place({ id: 'p2', name: 'Work', primary: false })], (name, detail) =>
    dispatched.push({ name, detail }),
  );
  assert.deepEqual(cmds.map((c) => c.id), ['place:p1', 'place:p2']);
  assert.equal(cmds[0]!.title, 'Go to Home');
  assert.equal(cmds[0]!.category, 'navigation');
  assert.ok(cmds[0]!.keywords.includes('home'));
  assert.ok(cmds[0]!.keywords.includes('place'));
  cmds[1]!.action();
  assert.deepEqual(dispatched, [{ name: 'cb:focus-place', detail: { placeId: 'p2', lat: 41.6, lon: -86.7 } }]);
});

test('primary place gets a small positive weight', () => {
  const cmds = buildPlaceCommands([place(), place({ id: 'p2', primary: false })], () => {});
  assert.ok((cmds[0]!.weight ?? 0) > (cmds[1]!.weight ?? 0));
});
```

Run: FAIL (module missing). Then create `src/services/command-palette/place-commands.ts`:

```ts
/**
 * Saved-place palette commands (⌘K v2). Pure builder + a small installer
 * that keeps the registry in sync with the saved-places store.
 */

import type { CommandRegistry, PaletteCommand } from './command-registry';

export interface PlaceLike {
  id: string;
  name: string;
  lat: number;
  lon: number;
  primary: boolean;
}

export type DispatchFn = (name: string, detail?: unknown) => void;

export function buildPlaceCommands(places: readonly PlaceLike[], dispatch: DispatchFn): PaletteCommand[] {
  return places.map((p) => ({
    id: `place:${p.id}`,
    title: `Go to ${p.name}`,
    subtitle: 'saved place',
    keywords: [p.name.toLowerCase(), 'place', 'saved', 'go to', 'fly'],
    category: 'navigation',
    icon: '📍',
    weight: p.primary ? 0.5 : 0,
    action: () => dispatch('cb:focus-place', { placeId: p.id, lat: p.lat, lon: p.lon }),
  }));
}

/**
 * Registers place commands now and re-syncs on every saved-places change.
 * Returns an uninstall thunk.
 */
export function installPlaceCommands(
  registry: CommandRegistry,
  deps: {
    getPlaces: () => readonly PlaceLike[];
    subscribe: (listener: () => void) => () => void;
    dispatch: DispatchFn;
  },
): () => void {
  let currentIds: string[] = [];
  const sync = (): void => {
    for (const id of currentIds) registry.unregister(id);
    const cmds = buildPlaceCommands(deps.getPlaces(), deps.dispatch);
    for (const c of cmds) registry.register(c);
    currentIds = cmds.map((c) => c.id);
  };
  sync();
  const unsubscribe = deps.subscribe(sync);
  return () => {
    unsubscribe();
    for (const id of currentIds) registry.unregister(id);
    currentIds = [];
  };
}
```

Run tests: PASS.

- [ ] **Step 4: Wire place commands + the focus-place listener**

In `src/app/panel-layout.ts`, directly after `registerBuiltinCommands(...)` (`:1243-1247`):

```ts
    installPlaceCommands(getCommandRegistry(), {
      getPlaces: () => getSavedPlaces().map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, primary: p.primary })),
      subscribe: (listener) => subscribeSavedPlaces(() => listener()),
      dispatch: (name, detail) => {
        document.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
      },
    });
    document.addEventListener('cb:focus-place', (e) => {
      const detail = (e as CustomEvent<{ lat?: number; lon?: number }>).detail;
      void this.navigateToPanel('map');
      if (detail?.lat !== undefined && detail?.lon !== undefined) {
        this.ctx.map?.setCenter?.(detail.lat, detail.lon, 8);
      }
    });
```

Imports: `installPlaceCommands` from `@/services/command-palette/place-commands`; `getSavedPlaces`/`subscribeSavedPlaces` are already imported at `panel-layout.ts:539` (verify; import if not). **Verify `this.ctx.map`'s type**: it's the MapContainer wrapper — check whether it exposes `setCenter(lat, lon, zoom?)` (DeckGLMap does at `DeckGLMap.ts:4788`; the wrapper may forward it or expose the map instance). If the wrapper lacks it, use whatever accessor it has (e.g. `this.ctx.map?.getMap?.()?.setCenter(...)`) — read `src/components/MapContainer.ts` first and use the real API; use optional chaining so a missing map never throws.

- [ ] **Step 5: Verify + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npm run typecheck:all && npx tsx --test src/services/command-palette/__tests__/command-registry.test.mts src/services/command-palette/__tests__/place-commands.test.mts && git add src/services/command-palette/command-registry.ts src/services/command-palette/built-in-commands.ts src/services/command-palette/place-commands.ts src/services/command-palette/__tests__/place-commands.test.mts src/services/command-palette/__tests__/command-registry.test.mts src/app/panel-layout.ts && git commit -m "feat(palette): metadata tags, weighted ranking, saved-place commands

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: `shell-gate.ts` — the single default-on gate

**Files:**
- Create: `src/services/home-shell/shell-gate.ts`
- Test: `src/services/home-shell/__tests__/shell-gate.test.mts`

- [ ] **Step 1: Failing test**

Create `src/services/home-shell/__tests__/shell-gate.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { computeShellGate } from '../shell-gate.ts';

const BASE = { variant: 'full', viewportWidth: 1280, classicFlag: null as string | null, legacyOptIn: null as string | null };

test('default-on for full variant on desktop width', () => {
  assert.equal(computeShellGate(BASE), true);
});

test('classic-view flag opts out', () => {
  assert.equal(computeShellGate({ ...BASE, classicFlag: '1' }), false);
});

test('non-full variants stay classic even with legacy opt-in', () => {
  for (const variant of ['tech', 'finance', 'happy']) {
    assert.equal(computeShellGate({ ...BASE, variant }), false);
    assert.equal(computeShellGate({ ...BASE, variant, legacyOptIn: '1' }), false);
  }
});

test('mobile viewport stays classic', () => {
  assert.equal(computeShellGate({ ...BASE, viewportWidth: 768 }), false);
  assert.equal(computeShellGate({ ...BASE, viewportWidth: 769 }), true);
});

test('legacy opt-in key is ignored when classic flag set (classic wins)', () => {
  assert.equal(computeShellGate({ ...BASE, legacyOptIn: '1', classicFlag: '1' }), false);
});
```

Run: FAIL (module missing).

- [ ] **Step 2: Implement**

Create `src/services/home-shell/shell-gate.ts`:

```ts
/**
 * Single source of truth for "does the Home Shell boot as the opening
 * surface?" — Phase 2 flipped the default ON for the full desktop
 * variant. Pure core (computeShellGate) + a thin environment reader
 * (isHomeShellDefaultOn) used by panel-layout and shortcut-bootstrap.
 *
 * Keys:
 *   crystalball-classic-view = '1'  → user opted back to the classic UI
 *   crystalball-home-shell   = '1'  → legacy Phase-1 opt-in (still honored
 *                                     as ON for full/desktop, but classic
 *                                     flag wins; ignored on other variants)
 */

import { SITE_VARIANT } from '../../config/variant';
import { MOBILE_BREAKPOINT_PX } from '../../utils';

export const CLASSIC_VIEW_KEY = 'crystalball-classic-view';
export const LEGACY_OPT_IN_KEY = 'crystalball-home-shell';

export interface ShellGateInputs {
  variant: string;
  viewportWidth: number;
  classicFlag: string | null;
  legacyOptIn: string | null;
}

/** Pure decision core — fixture-testable. */
export function computeShellGate(inputs: ShellGateInputs): boolean {
  if (inputs.variant !== 'full') return false;
  if (inputs.viewportWidth <= MOBILE_BREAKPOINT_PX) return false;
  if (inputs.classicFlag === '1') return false;
  return true;
}

/** Environment reader used at boot. */
export function isHomeShellDefaultOn(): boolean {
  return computeShellGate({
    variant: SITE_VARIANT,
    viewportWidth: window.innerWidth,
    classicFlag: localStorage.getItem(CLASSIC_VIEW_KEY),
    legacyOptIn: localStorage.getItem(LEGACY_OPT_IN_KEY),
  });
}
```

Note: `legacyOptIn` is accepted in the inputs (and read) so the console setter migration in Task 7 can reason about it, but the decision no longer depends on it — default is ON. Check `src/utils/index.ts` exports `MOBILE_BREAKPOINT_PX` (verified at `:136`); if the barrel doesn't re-export it, import from the concrete module.

- [ ] **Step 3: Run tests (5 pass), typecheck, commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npx tsx --test src/services/home-shell/__tests__/shell-gate.test.mts && npm run typecheck && git add src/services/home-shell/shell-gate.ts src/services/home-shell/__tests__/shell-gate.test.mts && git commit -m "feat(home-shell): shell-gate — single default-on decision core

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: The flip — apply the gate, console setters, e2e opt-outs

This is the LAST behavioral commit — independently revertable.

**Files:**
- Modify: `src/app/panel-layout.ts:1253` (gate swap)
- Modify: `src/services/keyboard/shortcut-bootstrap.ts:64` (gate swap)
- Modify: `src/main.ts:388-399` (console setters)
- Modify: `e2e/gods-vision-mode.spec.ts`, `e2e/a11y-baseline.spec.ts`, `e2e/theme-toggle.spec.ts` (classic opt-out)
- Create: `e2e/home-shell-boot.spec.ts`

- [ ] **Step 1: Swap the two gates**

`panel-layout.ts:1253`: replace `if (localStorage.getItem('crystalball-home-shell') === '1') {` with:

```ts
    if (isHomeShellDefaultOn()) {
```

(import `isHomeShellDefaultOn` from `@/services/home-shell/shell-gate`).

`shortcut-bootstrap.ts:64`: replace the same condition with `isHomeShellDefaultOn()` (import likewise; update the comment above it to say the shortcut registers whenever the shell can appear).

- [ ] **Step 2: Console setters in main.ts**

Replace the `window.homeShell` block (`:388-399`) with:

```ts
// Home Shell (default-on since Phase 2): `homeShell=false` opts back to the
// classic UI (persisted); `homeShell=true` clears the opt-out. `classicView`
// is the inverse alias.
Object.defineProperty(window, 'homeShell', {
  get() {
    const off = localStorage.getItem('crystalball-classic-view') === '1';
    console.log(`[HomeShell] ${off ? 'OFF (classic view)' : 'ON (default)'}`);
    return !off;
  },
  set(v: boolean) {
    if (v) localStorage.removeItem('crystalball-classic-view');
    else localStorage.setItem('crystalball-classic-view', '1');
    location.reload();
  },
});
Object.defineProperty(window, 'classicView', {
  get() {
    return localStorage.getItem('crystalball-classic-view') === '1';
  },
  set(v: boolean) {
    if (v) localStorage.setItem('crystalball-classic-view', '1');
    else localStorage.removeItem('crystalball-classic-view');
    location.reload();
  },
});
```

- [ ] **Step 3: E2E opt-outs + new boot spec**

In EACH of `e2e/gods-vision-mode.spec.ts`, `e2e/a11y-baseline.spec.ts`, `e2e/theme-toggle.spec.ts`: read the file first; add near the top (before `page.goto('/')`, matching each file's beforeEach/addInitScript style):

```ts
test.beforeEach(async ({ page }) => {
  // These specs exercise the classic UI — opt out of the default-on Home Shell.
  await page.addInitScript(() => localStorage.setItem('crystalball-classic-view', '1'));
});
```

(If a spec already has a `beforeEach` with `addInitScript`, add the localStorage line inside the existing init script rather than a second hook.)

Create `e2e/home-shell-boot.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// Phase 2: the Home Shell is the default opening surface (full variant, desktop).
test.describe('home shell default boot', () => {
  test('boots into the shell and Escape returns to classic', async ({ page }) => {
    await page.goto('/');
    const shell = page.locator('.home-shell');
    await expect(shell).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).toHaveClass(/home-shell-active/);
    await page.keyboard.press('Escape');
    await expect(shell).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/home-shell-active/);
  });

  test('classic-view flag boots classic with no shell in DOM', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('crystalball-classic-view', '1'));
    await page.goto('/');
    await expect(page.locator('.mac-sidebar, .header').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.home-shell')).toHaveCount(0);
  });
});
```

(Check how existing real-app specs wait for boot — `gods-vision-mode.spec.ts:6` waits for `.mac-sidebar, .header` — and mirror timeouts/conventions.)

- [ ] **Step 4: Verify + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npm run typecheck:all && npm run test:homeshell && npx tsx --test src/services/home-shell/__tests__/shell-gate.test.mts
```

Then run the full-variant e2e if the environment allows (`npm run test:e2e:full -- home-shell-boot` at minimum; the three opted-out specs if time permits). If Playwright cannot run in this environment, note it in the commit body and flag for CI.

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && git add src/app/panel-layout.ts src/services/keyboard/shortcut-bootstrap.ts src/main.ts e2e/gods-vision-mode.spec.ts e2e/a11y-baseline.spec.ts e2e/theme-toggle.spec.ts e2e/home-shell-boot.spec.ts && git commit -m "feat(home-shell)!: default-on for full desktop variant

crystalball-classic-view=1 (console: classicView=true) opts back to
the classic UI. Non-full variants and mobile viewports stay classic.
Classic-dependent e2e specs opt out via init script.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Finalize — test scripts, docs, smoke, PR

**Files:**
- Modify: `package.json` (`test:homeshell` — add library-view, shell-gate, panel-metadata, place-commands test files)
- Modify: `CLAUDE.md` (Home Shell section)
- Modify: `docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md` (Phase 2 status note)

- [ ] **Step 1: Extend the test script**

In `package.json`, extend `test:homeshell` to:

```json
"test:homeshell": "tsx --test src/services/home-shell/__tests__/briefing-view.test.mts src/services/home-shell/__tests__/deck-view.test.mts src/services/home-shell/__tests__/status-ribbon-view.test.mts src/services/home-shell/__tests__/library-view.test.mts src/services/home-shell/__tests__/shell-gate.test.mts src/config/__tests__/panel-metadata.test.mts src/services/command-palette/__tests__/place-commands.test.mts",
```

Run it: expect 28 + 5 + 5 + 6 + 2 = 46 tests pass (adjust the count to actual; all pass, 0 fail).

- [ ] **Step 2: Update CLAUDE.md**

Replace the last two sentences of the "Home Shell" section with:

```markdown
DEFAULT-ON since Phase 2 for the full desktop variant (gate: `src/services/home-shell/shell-gate.ts`;
opt out with `classicView=true` in console → `crystalball-classic-view=1`; non-full variants and
≤768px viewports always classic). Phase 2 added `src/config/panel-metadata.ts` (405 panels → 8
Library domains, seeded by `scripts/generate-panel-metadata.mjs`, hand-curated since),
`src/components/LibraryOverlay.ts` (`cb:toggle-library`, 📚 topbar button, available in classic
too), and ⌘K v2 (metadata tags, weighted ranking, `place:<id>` commands via
`src/services/command-palette/place-commands.ts`). Deck pins persist at `crystalball-deck-pins`.
```

- [ ] **Step 3: Spec status note**

In the spec's Phasing section, change the Phase 2 line to append: `**[SHIPPED — see docs/superpowers/plans/2026-07-13-phase2-library-metadata.md; ⌘K entities deferred to Phase 3 (entity dossiers own that surface).]**`

- [ ] **Step 4: Full verification**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && npm run test:homeshell && npm run typecheck:all && node scripts/lint-colors.mjs && npm run smoke:offline
```
All green. Manual browser smoke (coordinator runs this via the preview tools): flag-less boot → shell appears; 📚 button opens Library; domain nav + featured grids + "all N" expansion + search filter; card click lands on the classic panel; ⌘K shows tags/places and system panels rank below content panels; `classicView=true` → classic boot, Library still reachable? (No — Library button lives in the shell; classic users reach it via ⌘K "Open Library". Verify that path.)

- [ ] **Step 5: Commit, push, PR**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase2 && git add package.json CLAUDE.md docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md && git commit -m "chore(home-shell): phase 2 test script, docs, spec status

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" && git push origin claude/phase2-library-metadata
```

Then: real Codex cross-agent review over the full branch diff (read-only sandbox, stdin), fix any P1s, PR with the honest `cross-agent review: Codex` marker. Auto-merge lands it (~4 min after checks); verify merged SHA vs branch tip afterward.

---

## Self-review notes

- **Spec coverage (Phase 2):** metadata registry (Tasks 1-2), Library with curated fronts + long tail (Tasks 3-4), ⌘K v2 tags/places + system deprioritization (Task 5), System-tier separation (system-health domain last in nav, demoted in ⌘K, excluded from featured — Tasks 1/3/5), default flip with fallback (Tasks 6-7). **Deliberate deviation:** ⌘K "entities" deferred to Phase 3 (entity dossiers own that surface) — recorded in the spec status note (Task 8 Step 3). Status-ribbon → System entry point is Phase 3 polish.
- **Type consistency:** `PanelMeta`/`LibraryDomain` (Task 1) consumed by Tasks 3-5; `LibraryPanelView`/`LibraryDomainView` (Task 3) consumed by Task 4; `PlaceLike`/`buildPlaceCommands`/`installPlaceCommands` (Task 5) self-contained; `computeShellGate`/`isHomeShellDefaultOn` (Task 6) consumed by Task 7. `weight?` added in Task 5 Step 1 before place-commands uses it.
- **Known verify-while-wiring points (flagged in-task):** registry test file's construction pattern (Task 5 Step 1), `ctx.map` fly-to API (Task 5 Step 4), `MOBILE_BREAKPOINT_PX` barrel export (Task 6), each e2e spec's init-script style (Task 7 Step 3).
- **Ordering:** the flip is last and self-contained; everything before it is inert-by-default (Library reachable but opt-in via button/⌘K).
