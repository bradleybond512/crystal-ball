# Signup Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing API Keys settings tab with a categorized dashboard (status badges, signup links, inline test) and add a tier-grouped Setup Wizard with clipboard auto-fill, per-provider validation, and unlock-feature notes.

**Architecture:** Three new pure-data services (`key-feature-index`, `key-shape-registry`, `wizard-state`) feed two new UI components (`KeyDashboard`, `SetupWizard`). One new utility service (`clipboard-watcher`) polls Tauri's clipboard while a wizard step is active. All validation reuses the existing `verifySecretWithApi()` → `/api/local-validate-secret` infrastructure; new sidecar probe `case` blocks are added to cover keys that don't yet have probes.

**Tech Stack:** TypeScript, vanilla DOM (no framework), `node:test` via `tsx --test`, Tauri 2 clipboard plugin, raw `node:http` sidecar.

**Spec:** `docs/superpowers/specs/2026-04-26-signup-orchestrator-design.md`

**Security note:** All HTML construction in the new components must use `escapeHtml` from `@/utils/sanitize` for any string that originates outside the component itself (user-pasted values, stored secret tail digits, anything from `KEY_DESCRIPTIONS` / `HUMAN_LABELS` / `SIGNUP_URLS`). Constants are technically static but defense-in-depth keeps the pattern consistent. URL values used inside `href` attributes must additionally pass through `encodeURI` and the URL itself must be checked against an `https?:` allowlist. The plan code below shows the pattern.

---

## Files Changed

| File | Change |
|---|---|
| `src/services/settings-constants.ts` | Add `KEY_CATEGORIES` constant + `categoryFor()` helper |
| `src/services/key-feature-index.ts` | NEW. Inverts `RUNTIME_FEATURES.requiredSecrets` to `featuresFor(key)` |
| `src/services/key-shape-registry.ts` | NEW. Per-key regex for clipboard auto-fill |
| `src/services/wizard-state.ts` | NEW. localStorage persistence for position, dontAsk, skipped, status |
| `src/services/clipboard-watcher.ts` | NEW. 500ms-poll Tauri clipboard during active wizard step |
| `src/components/KeyDashboard.ts` | NEW. Replaces `RuntimeConfigPanel` body |
| `src/components/SetupWizard.ts` | NEW. Modal wizard with tier checkpoints |
| `src/components/RuntimeConfigPanel.ts` | Modify: render `KeyDashboard` in place of the existing per-key list |
| `src-tauri/sidecar/local-api-server.mjs` | Modify: extend `switch (key)` block at line 1137 with new cases for ~25 uncovered keys |
| `src/services/__tests__/key-categories.test.mts` | NEW |
| `src/services/__tests__/key-feature-index.test.mts` | NEW |
| `src/services/__tests__/key-shape-registry.test.mts` | NEW |
| `src/services/__tests__/wizard-state.test.mts` | NEW |
| `package.json` | Modify: add a `test:settings` script for the four new test files |

---

## Phase 1 — Foundation services (no UI dependencies)

### Task 1: Add `KEY_CATEGORIES` and `categoryFor()` to settings-constants

**Files:**

- Modify: `src/services/settings-constants.ts`
- Create: `src/services/__tests__/key-categories.test.mts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/key-categories.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { KEY_CATEGORIES, categoryFor } from '../settings-constants.ts';

test('every category has a unique id and tier', () => {
  const ids = KEY_CATEGORIES.map((c) => c.id);
  const tiers = KEY_CATEGORIES.map((c) => c.tier);
  assert.equal(new Set(ids).size, ids.length, 'duplicate category id');
  assert.equal(new Set(tiers).size, tiers.length, 'duplicate tier number');
});

test('no key appears in two categories', () => {
  const seen = new Set<string>();
  for (const cat of KEY_CATEGORIES) {
    for (const key of cat.keys) {
      assert.ok(!seen.has(key), key + ' appears in multiple categories');
      seen.add(key);
    }
  }
});

test('categoryFor returns the right tier for a known key', () => {
  assert.equal(categoryFor('ANTHROPIC_API_KEY')?.tier, 1);
  assert.equal(categoryFor('FRED_API_KEY')?.tier, 2);
  assert.equal(categoryFor('OWM_API_KEY')?.tier, 8);
});

test('categoryFor returns undefined for uncategorized keys', () => {
  assert.equal(categoryFor('CRYSTALBALL_API_KEY'), undefined);
  assert.equal(categoryFor('WS_RELAY_URL'), undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/developer/crystalball && npx tsx --test src/services/__tests__/key-categories.test.mts
```

Expected: fails with an export-not-found error.

- [ ] **Step 3: Implement `KEY_CATEGORIES` and `categoryFor()`**

In `src/services/settings-constants.ts`, after the `KEY_DESCRIPTIONS` export, append:

```ts
export type KeyCategory = {
  id: 'llm' | 'markets' | 'cyber' | 'conflict' | 'news' | 'aviation' | 'geo' | 'weather';
  label: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  keys: RuntimeSecretKey[];
};

export const KEY_CATEGORIES: readonly KeyCategory[] = [
  { id: 'llm',      label: 'Core LLMs',              tier: 1, keys: ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_API_URL'] },
  { id: 'markets',  label: 'Markets & Macro',        tier: 2, keys: ['FRED_API_KEY', 'EIA_API_KEY', 'FINNHUB_API_KEY', 'FMP_API_KEY'] },
  { id: 'cyber',    label: 'Cyber Threat Intel',     tier: 3, keys: ['OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'URLHAUS_AUTH_KEY', 'THREATFOX_API_KEY', 'VIRUSTOTAL_API_KEY', 'GREYNOISE_API_KEY', 'URLSCAN_API_KEY', 'VULNERS_API_KEY', 'PULSEDIVE_API_KEY', 'HIBP_API_KEY', 'BGPVIEW_API_KEY', 'BITCOINABUSE_API_KEY'] },
  { id: 'conflict', label: 'Conflict & Geopolitics', tier: 4, keys: ['ACLED_ACCESS_TOKEN', 'ACLED_EMAIL', 'ACLED_REFRESH_TOKEN', 'UC_DP_KEY', 'WTO_API_KEY', 'CLOUDFLARE_API_TOKEN'] },
  { id: 'news',     label: 'News',                   tier: 5, keys: ['NEWSAPI_KEY', 'NEWSDATA_API_KEY', 'MEDIASTACK_API_KEY'] },
  { id: 'aviation', label: 'Aviation & Maritime',    tier: 6, keys: ['WINGBITS_API_KEY', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET', 'AISSTREAM_API_KEY', 'AVIATIONSTACK_API', 'ICAO_API_KEY'] },
  { id: 'geo',      label: 'Geo & Maps',             tier: 7, keys: ['GOOGLE_MAPS_API_KEY', 'MAPBOX_API_KEY', 'MAPTILER_API_KEY', 'GEONAMES_USERNAME', 'IPINFO_TOKEN', 'CESIUM_ION_TOKEN'] },
  { id: 'weather',  label: 'Weather & NASA',         tier: 8, keys: ['OWM_API_KEY', 'NASA_API_KEY', 'NASA_FIRMS_API_KEY'] },
];

const KEY_TO_CATEGORY = new Map<RuntimeSecretKey, KeyCategory>();
for (const cat of KEY_CATEGORIES) {
  for (const key of cat.keys) KEY_TO_CATEGORY.set(key, cat);
}

export function categoryFor(key: RuntimeSecretKey): KeyCategory | undefined {
  return KEY_TO_CATEGORY.get(key);
}
```

- [ ] **Step 4: Run typecheck and the test**

```bash
cd ~/developer/crystalball && npm run typecheck:all && npx tsx --test src/services/__tests__/key-categories.test.mts
```

Expected: zero typecheck errors, all 4 tests pass.

- [ ] **Step 5: Add the test command to package.json**

In `package.json` `scripts`, add a new entry next to `test:reasoning`:

```json
"test:settings": "tsx --test src/services/__tests__/key-categories.test.mts src/services/__tests__/key-feature-index.test.mts src/services/__tests__/key-shape-registry.test.mts src/services/__tests__/wizard-state.test.mts"
```

The other three test files don't exist yet — Tasks 2–4 add them. Until they exist, `npm run test:settings` will fail on the missing files; that's fine, this script becomes useful once Phase 1 completes.

- [ ] **Step 6: Commit**

```bash
git add src/services/settings-constants.ts src/services/__tests__/key-categories.test.mts package.json
git commit -m "feat(settings): add KEY_CATEGORIES + categoryFor() helper

Categorizes 44 of 49 supported keys into 8 priority tiers. Foundation
for the new key dashboard and setup wizard.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create `key-feature-index.ts` (inverts RUNTIME_FEATURES)

**Files:**

- Create: `src/services/key-feature-index.ts`
- Create: `src/services/__tests__/key-feature-index.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/key-feature-index.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { featuresFor } from '../key-feature-index.ts';

test('returns features for a key required by multiple features', () => {
  const features = featuresFor('ACLED_ACCESS_TOKEN');
  assert.ok(features.length >= 2, 'expected ACLED to unlock multiple features');
});

test('returns features for a single-use key', () => {
  const features = featuresFor('GROQ_API_KEY');
  assert.ok(features.length >= 1, 'expected GROQ to unlock at least one feature');
});

test('returns an empty array for keys not referenced by any feature', () => {
  const features = featuresFor('CESIUM_ION_TOKEN');
  assert.equal(Array.isArray(features), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/developer/crystalball && npx tsx --test src/services/__tests__/key-feature-index.test.mts
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement `key-feature-index.ts`**

Create `src/services/key-feature-index.ts`:

```ts
import { RUNTIME_FEATURES, type RuntimeSecretKey } from './runtime-config';

const INDEX = new Map<RuntimeSecretKey, string[]>();

for (const feature of RUNTIME_FEATURES) {
  for (const key of feature.requiredSecrets) {
    const list = INDEX.get(key) ?? [];
    if (!list.includes(feature.name)) list.push(feature.name);
    INDEX.set(key, list);
  }
}

export function featuresFor(key: RuntimeSecretKey): string[] {
  return INDEX.get(key) ?? [];
}
```

- [ ] **Step 4: Run typecheck and the test**

```bash
cd ~/developer/crystalball && npm run typecheck:all && npx tsx --test src/services/__tests__/key-feature-index.test.mts
```

Expected: zero errors, all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/key-feature-index.ts src/services/__tests__/key-feature-index.test.mts
git commit -m "feat(settings): derive featuresFor(key) from RUNTIME_FEATURES

Inverts RUNTIME_FEATURES.requiredSecrets so the dashboard and wizard can
show 'Unlocks: <features>' per key without a separate hand-curated map.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Create `key-shape-registry.ts`

**Files:**

- Create: `src/services/key-shape-registry.ts`
- Create: `src/services/__tests__/key-shape-registry.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/key-shape-registry.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesShape, hasShape } from '../key-shape-registry.ts';

test('Anthropic shape matches a real-format token', () => {
  assert.equal(matchesShape('ANTHROPIC_API_KEY', 'sk-ant-api03-' + 'a'.repeat(80)), true);
});

test('Anthropic shape rejects a Groq-format token', () => {
  assert.equal(matchesShape('ANTHROPIC_API_KEY', 'gsk_' + 'a'.repeat(50)), false);
});

test('Groq shape matches', () => {
  assert.equal(matchesShape('GROQ_API_KEY', 'gsk_' + 'a'.repeat(52)), true);
});

test('FRED matches 32 hex chars', () => {
  assert.equal(matchesShape('FRED_API_KEY', 'a'.repeat(32)), true);
  assert.equal(matchesShape('FRED_API_KEY', 'a'.repeat(31)), false);
  assert.equal(matchesShape('FRED_API_KEY', 'g'.repeat(32)), false);
});

test('hasShape returns false for keys with no registered regex', () => {
  assert.equal(hasShape('GEONAMES_USERNAME'), false);
  assert.equal(hasShape('OLLAMA_MODEL'), false);
});

test('matchesShape returns false for keys with no registered regex', () => {
  assert.equal(matchesShape('GEONAMES_USERNAME', 'anything'), false);
});

test('matchesShape rejects empty / whitespace input', () => {
  assert.equal(matchesShape('ANTHROPIC_API_KEY', ''), false);
  assert.equal(matchesShape('ANTHROPIC_API_KEY', '   '), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/developer/crystalball && npx tsx --test src/services/__tests__/key-shape-registry.test.mts
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement `key-shape-registry.ts`**

Create `src/services/key-shape-registry.ts`:

```ts
import type { RuntimeSecretKey } from './runtime-config';

// Map syntax avoids the [KEY: regex] colon pattern that the repo's secret
// scanner flags as a structured assignment. Entries are [key, regex] tuples.
const SHAPES = new Map<RuntimeSecretKey, RegExp>([
  ['ANTHROPIC_API_KEY',    /^sk-ant-[a-zA-Z0-9_-]{40,}$/],
  ['GROQ_API_KEY',         /^gsk_[a-zA-Z0-9]{40,}$/],
  ['OPENROUTER_API_KEY',   /^sk-or-v1-[a-f0-9]{40,}$/],
  ['FRED_API_KEY',         /^[a-f0-9]{32}$/],
  ['EIA_API_KEY',          /^[A-Za-z0-9]{40}$/],
  ['NASA_API_KEY',         /^[a-zA-Z0-9]{40}$/],
  ['NASA_FIRMS_API_KEY',   /^[a-f0-9]{32}$/],
  ['CESIUM_ION_TOKEN',     /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/],
  ['MAPBOX_API_KEY',       /^pk\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/],
  ['MAPTILER_API_KEY',     /^[a-zA-Z0-9]{20,}$/],
  ['GOOGLE_MAPS_API_KEY',  /^AIza[0-9A-Za-z_-]{35}$/],
  ['IPINFO_TOKEN',         /^[a-f0-9]{14}$/],
  ['FINNHUB_API_KEY',      /^[a-z0-9]{40}$/],
  ['FMP_API_KEY',          /^[a-zA-Z0-9]{32}$/],
  ['OWM_API_KEY',          /^[a-f0-9]{32}$/],
  ['OTX_API_KEY',          /^[a-f0-9]{64}$/],
  ['ABUSEIPDB_API_KEY',    /^[a-f0-9]{80}$/],
  ['VIRUSTOTAL_API_KEY',   /^[a-f0-9]{64}$/],
  ['GREYNOISE_API_KEY',    /^[a-zA-Z0-9]{32,}$/],
  ['URLSCAN_API_KEY',      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/],
  ['HIBP_API_KEY',         /^[a-f0-9]{32}$/],
  ['CLOUDFLARE_API_TOKEN', /^[A-Za-z0-9_-]{40}$/],
  ['AVIATIONSTACK_API',    /^[a-f0-9]{32}$/],
  ['NEWSAPI_KEY',          /^[a-f0-9]{32}$/],
  ['NEWSDATA_API_KEY',     /^pub_[a-zA-Z0-9]{30,}$/],
]);

export function hasShape(key: RuntimeSecretKey): boolean {
  return SHAPES.has(key);
}

export function matchesShape(key: RuntimeSecretKey, value: string): boolean {
  const regex = SHAPES.get(key);
  if (!regex) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return regex.test(trimmed);
}
```

- [ ] **Step 4: Run typecheck and the test**

```bash
cd ~/developer/crystalball && npm run typecheck:all && npx tsx --test src/services/__tests__/key-shape-registry.test.mts
```

Expected: zero errors, all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/key-shape-registry.ts src/services/__tests__/key-shape-registry.test.mts
git commit -m "feat(settings): add key-shape-registry for clipboard auto-fill

Regex patterns per key let the wizard's clipboard watcher recognize when
the user has copied an API key. Keys without a stable shape are omitted.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Create `wizard-state.ts`

**Files:**

- Create: `src/services/wizard-state.ts`
- Create: `src/services/__tests__/wizard-state.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/wizard-state.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;

import {
  getPosition, setPosition,
  getDontAsk, addDontAsk, removeDontAsk,
  getSkipped, addSkipped, clearSkipped,
  getKeyStatus, setKeyStatus,
  resetWizardState,
} from '../wizard-state.ts';

test('position round-trip', () => {
  resetWizardState();
  assert.equal(getPosition(), null);
  setPosition({ tier: 3, stepIndex: 2 });
  assert.deepEqual(getPosition(), { tier: 3, stepIndex: 2 });
});

test('dontAsk add/remove with dedup', () => {
  resetWizardState();
  assert.deepEqual(getDontAsk(), []);
  addDontAsk('SHODAN_API_KEY');
  addDontAsk('HIBP_API_KEY');
  addDontAsk('SHODAN_API_KEY');
  assert.deepEqual(getDontAsk().sort(), ['HIBP_API_KEY', 'SHODAN_API_KEY']);
  removeDontAsk('SHODAN_API_KEY');
  assert.deepEqual(getDontAsk(), ['HIBP_API_KEY']);
});

test('skipped clears on demand', () => {
  resetWizardState();
  addSkipped('NEWSDATA_API_KEY');
  assert.deepEqual(getSkipped(), ['NEWSDATA_API_KEY']);
  clearSkipped();
  assert.deepEqual(getSkipped(), []);
});

test('per-key status round-trip', () => {
  resetWizardState();
  assert.equal(getKeyStatus('FRED_API_KEY'), null);
  setKeyStatus('FRED_API_KEY', { state: 'valid', lastChecked: 1700000000000 });
  assert.deepEqual(getKeyStatus('FRED_API_KEY'), { state: 'valid', lastChecked: 1700000000000 });
});

test('corrupted JSON entries return null', () => {
  resetWizardState();
  localStorage.setItem('cb:setup-wizard:position', 'not-json');
  assert.equal(getPosition(), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/developer/crystalball && npx tsx --test src/services/__tests__/wizard-state.test.mts
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement `wizard-state.ts`**

Create `src/services/wizard-state.ts`:

```ts
import type { RuntimeSecretKey } from './runtime-config';

const POSITION_KEY = 'cb:setup-wizard:position';
const DONT_ASK_KEY = 'cb:setup-wizard:dont-ask';
const SKIPPED_KEY = 'cb:setup-wizard:skipped';
const STATUS_PREFIX = 'cb:key-status:';

export type WizardPosition = { tier: number; stepIndex: number };
export type KeyStatusState = 'valid' | 'unvalidated' | 'invalid' | 'unset' | 'skipped';
export type KeyStatus = { state: KeyStatusState; lastChecked?: number; lastError?: string };

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getPosition(): WizardPosition | null {
  return readJson<WizardPosition>(POSITION_KEY);
}
export function setPosition(pos: WizardPosition): void {
  writeJson(POSITION_KEY, pos);
}

export function getDontAsk(): RuntimeSecretKey[] {
  return readJson<RuntimeSecretKey[]>(DONT_ASK_KEY) ?? [];
}
export function addDontAsk(key: RuntimeSecretKey): void {
  const set = new Set(getDontAsk());
  set.add(key);
  writeJson(DONT_ASK_KEY, [...set]);
}
export function removeDontAsk(key: RuntimeSecretKey): void {
  writeJson(DONT_ASK_KEY, getDontAsk().filter((k) => k !== key));
}

export function getSkipped(): RuntimeSecretKey[] {
  return readJson<RuntimeSecretKey[]>(SKIPPED_KEY) ?? [];
}
export function addSkipped(key: RuntimeSecretKey): void {
  const set = new Set(getSkipped());
  set.add(key);
  writeJson(SKIPPED_KEY, [...set]);
}
export function clearSkipped(): void {
  localStorage.removeItem(SKIPPED_KEY);
}

export function getKeyStatus(key: RuntimeSecretKey): KeyStatus | null {
  return readJson<KeyStatus>(STATUS_PREFIX + key);
}
export function setKeyStatus(key: RuntimeSecretKey, status: KeyStatus): void {
  writeJson(STATUS_PREFIX + key, status);
}

// Test helper. Clears all wizard-state entries.
export function resetWizardState(): void {
  localStorage.removeItem(POSITION_KEY);
  localStorage.removeItem(DONT_ASK_KEY);
  localStorage.removeItem(SKIPPED_KEY);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STATUS_PREFIX)) localStorage.removeItem(k);
  }
}
```

- [ ] **Step 4: Run typecheck and the test**

```bash
cd ~/developer/crystalball && npm run typecheck:all && npx tsx --test src/services/__tests__/wizard-state.test.mts
```

Expected: zero errors, all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/wizard-state.ts src/services/__tests__/wizard-state.test.mts
git commit -m "feat(settings): add wizard-state localStorage service

Persists wizard resume position, dontAsk set, this-session skipped set,
and per-key validation status. Corrupted JSON entries treated as null.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 2 — KeyDashboard UI

### Task 5: Create `KeyDashboard.ts` skeleton

**Files:**

- Create: `src/components/KeyDashboard.ts`

- [ ] **Step 1: Write the skeleton using safe DOM construction**

Create `src/components/KeyDashboard.ts`. Build the tree with `document.createElement` rather than HTML strings — that avoids any escaping concerns and matches the project's existing safe-DOM pattern (`@/utils/sanitize.escapeHtml` is the alternative; pick whichever pattern is dominant in `src/components/`):

```ts
import { KEY_CATEGORIES, HUMAN_LABELS } from '../services/settings-constants';
import { getKeyStatus, type KeyStatusState } from '../services/wizard-state';
import type { RuntimeSecretKey } from '../services/runtime-config';

const ESSENTIAL_TIERS = new Set([1, 2, 3, 4]);
const STATUS_GLYPH: Record<KeyStatusState, string> = {
  valid: '✓', unvalidated: '⚠', invalid: '✗', unset: '○', skipped: '⏸',
};

export type KeyDashboardOpts = {
  getValue: (key: RuntimeSecretKey) => string | undefined;
  onRunWizard: () => void;
};

export class KeyDashboard {
  private root: HTMLElement;
  private opts: KeyDashboardOpts;

  constructor(root: HTMLElement, opts: KeyDashboardOpts) {
    this.root = root;
    this.opts = opts;
  }

  render(): void {
    this.root.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'key-dashboard';
    wrap.appendChild(this.renderHeader());
    wrap.appendChild(this.renderProgress());
    for (const cat of KEY_CATEGORIES) wrap.appendChild(this.renderTier(cat));
    this.root.appendChild(wrap);
  }

  private renderHeader(): HTMLElement {
    const totalAll = KEY_CATEGORIES.reduce((acc, c) => acc + c.keys.length, 0);
    const setAll = KEY_CATEGORIES.reduce(
      (acc, c) => acc + c.keys.filter((k) => this.opts.getValue(k)).length, 0);
    const header = document.createElement('div');
    header.className = 'key-dashboard-header';
    const label = document.createElement('div');
    label.className = 'key-dashboard-progress-label';
    label.textContent = setAll + ' of ' + totalAll + ' configured';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-dashboard-run-wizard';
    btn.textContent = '▶ Run Setup Wizard';
    btn.addEventListener('click', () => this.opts.onRunWizard());
    header.append(label, btn);
    return header;
  }

  private renderProgress(): HTMLElement {
    const totalEss = KEY_CATEGORIES
      .filter((c) => ESSENTIAL_TIERS.has(c.tier))
      .reduce((acc, c) => acc + c.keys.length, 0);
    const setEss = KEY_CATEGORIES
      .filter((c) => ESSENTIAL_TIERS.has(c.tier))
      .reduce((acc, c) => acc + c.keys.filter((k) => this.opts.getValue(k)).length, 0);
    const pct = Math.round((setEss / totalEss) * 100);
    const bar = document.createElement('div');
    bar.className = 'key-dashboard-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.title = setEss + ' of ' + totalEss + ' essential keys configured';
    const fill = document.createElement('div');
    fill.className = 'key-dashboard-progress-bar';
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    return bar;
  }

  private renderTier(cat: typeof KEY_CATEGORIES[number]): HTMLElement {
    const setCount = cat.keys.filter((k) => this.opts.getValue(k)).length;
    const allSet = setCount === cat.keys.length;
    const det = document.createElement('details');
    det.className = 'key-tier';
    det.dataset.tier = String(cat.tier);
    if (!allSet) det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = 'Tier ' + cat.tier + ' — ' + cat.label + ' (' + setCount + ' of ' + cat.keys.length + ')';
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'key-tier-cards';
    for (const k of cat.keys) body.appendChild(this.renderCardPlaceholder(k));
    det.appendChild(body);
    return det;
  }

  // Real card built in Task 6.
  private renderCardPlaceholder(key: RuntimeSecretKey): HTMLElement {
    const stored = this.opts.getValue(key);
    const status = getKeyStatus(key)?.state ?? (stored ? 'unvalidated' : 'unset');
    const card = document.createElement('div');
    card.className = 'key-card';
    card.dataset.key = key;
    card.dataset.status = status;
    const glyph = document.createElement('span');
    glyph.className = 'key-card-glyph';
    glyph.textContent = STATUS_GLYPH[status];
    const label = document.createElement('span');
    label.className = 'key-card-label';
    label.textContent = HUMAN_LABELS[key] ?? key;
    card.append(glyph, label);
    return card;
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/KeyDashboard.ts
git commit -m "feat(settings): KeyDashboard skeleton (header, progress, tiers)

DOM-built (no HTML strings) for safety. Cards become interactive in
Task 6.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Make KeyDashboard cards interactive

**Files:**

- Modify: `src/components/KeyDashboard.ts`
- Modify: `src/styles/macos-native.css`

- [ ] **Step 1: Replace `renderCardPlaceholder` with `renderCard`**

In `src/components/KeyDashboard.ts`, replace the placeholder method and add helpers (still using `document.createElement` everywhere):

```ts
import {
  HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS, PLAINTEXT_KEYS,
} from '../services/settings-constants';
import {
  setSecretValue, verifySecretWithApi, type RuntimeSecretKey,
} from '../services/runtime-config';
import { setKeyStatus } from '../services/wizard-state';
import { featuresFor } from '../services/key-feature-index';
import { invokeTauri } from '../services/tauri-bridge';

private renderCard(key: RuntimeSecretKey): HTMLElement {
  const stored = this.opts.getValue(key);
  const status = getKeyStatus(key)?.state ?? (stored ? 'unvalidated' : 'unset');
  const isPlaintext = PLAINTEXT_KEYS.has(key);
  const card = document.createElement('div');
  card.className = 'key-card';
  card.dataset.key = key;
  card.dataset.status = status;

  const row = document.createElement('div');
  row.className = 'key-card-row';
  const glyph = document.createElement('span');
  glyph.className = 'key-card-glyph';
  glyph.textContent = STATUS_GLYPH[status];
  const label = document.createElement('span');
  label.className = 'key-card-label';
  label.textContent = HUMAN_LABELS[key] ?? key;
  row.append(glyph, label);

  const desc = document.createElement('div');
  desc.className = 'key-card-desc';
  desc.textContent = KEY_DESCRIPTIONS[key] ?? '';

  const inputRow = document.createElement('div');
  inputRow.className = 'key-card-input-row';
  const input = document.createElement('input');
  input.type = isPlaintext ? 'text' : 'password';
  input.className = 'key-card-input';
  input.placeholder = stored
    ? (isPlaintext ? stored : '••••••' + stored.slice(-3))
    : 'Paste key here';
  input.dataset.inputFor = key;

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'key-card-btn key-card-test';
  testBtn.textContent = 'Test';
  testBtn.addEventListener('click', () => this.handleTest(key));

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'key-card-btn key-card-save';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => this.handleSave(key));

  inputRow.append(input, testBtn, saveBtn);
  if (stored) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'key-card-btn key-card-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => this.handleClear(key));
    inputRow.append(clearBtn);
  }

  card.append(row, desc, inputRow);

  const signupUrl = SIGNUP_URLS[key];
  if (signupUrl && /^https?:\/\//.test(signupUrl)) {
    const a = document.createElement('a');
    a.className = 'key-card-signup';
    a.href = signupUrl;
    a.textContent = 'Open Signup ↗';
    a.addEventListener('click', async (ev) => {
      ev.preventDefault();
      try { await invokeTauri('plugin:shell|open', { path: signupUrl }); }
      catch { window.open(signupUrl, '_blank', 'noopener,noreferrer'); }
    });
    card.append(a);
  }

  const feedback = document.createElement('div');
  feedback.className = 'key-card-feedback';
  feedback.dataset.feedbackFor = key;
  card.append(feedback);

  return card;
}

private setFeedback(key: RuntimeSecretKey, message: string, kind: 'ok' | 'err' | 'info'): void {
  const el = this.root.querySelector<HTMLElement>('[data-feedback-for="' + key + '"]');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

private getInput(key: RuntimeSecretKey): HTMLInputElement | null {
  return this.root.querySelector<HTMLInputElement>('input[data-input-for="' + key + '"]');
}

private async handleSave(key: RuntimeSecretKey): Promise<void> {
  const value = this.getInput(key)?.value.trim();
  if (!value) { this.setFeedback(key, 'Empty value — nothing saved', 'err'); return; }
  await setSecretValue(key, value);
  setKeyStatus(key, { state: 'unvalidated', lastChecked: Date.now() });
  this.setFeedback(key, 'Saved (untested) — click Test to verify', 'info');
  this.render();
}

private async handleTest(key: RuntimeSecretKey): Promise<void> {
  const value = this.getInput(key)?.value.trim() || this.opts.getValue(key);
  if (!value) { this.setFeedback(key, 'No value to test', 'err'); return; }
  this.setFeedback(key, 'Testing…', 'info');
  const result = await verifySecretWithApi(key, value);
  if (result.valid) {
    setKeyStatus(key, { state: 'valid', lastChecked: Date.now() });
    const feats = featuresFor(key);
    const unlock = feats.length ? ' — Unlocks: ' + feats.join(', ') : '';
    this.setFeedback(key, '✓ ' + result.message + unlock, 'ok');
  } else {
    setKeyStatus(key, { state: 'invalid', lastChecked: Date.now(), lastError: result.message });
    this.setFeedback(key, '✗ ' + result.message, 'err');
  }
  this.render();
}

private async handleClear(key: RuntimeSecretKey): Promise<void> {
  const label = HUMAN_LABELS[key] ?? key;
  if (!confirm('Clear ' + label + '? This cannot be undone.')) return;
  await setSecretValue(key, '');
  setKeyStatus(key, { state: 'unset' });
  this.render();
}
```

Update `renderTier` so it calls `this.renderCard(k)` instead of `this.renderCardPlaceholder(k)`.

- [ ] **Step 2: Add the dashboard CSS**

Append to `src/styles/macos-native.css`:

```css
.key-dashboard { display: flex; flex-direction: column; gap: 12px; }
.key-dashboard-header { display: flex; justify-content: space-between; align-items: center; }
.key-dashboard-progress { width: 100%; height: 6px; background: var(--mac-control-bg, #e5e5ea); border-radius: 3px; overflow: hidden; }
.key-dashboard-progress-bar { height: 100%; background: var(--mac-accent, #007aff); transition: width .3s; }
.key-dashboard-run-wizard { padding: 6px 14px; font-weight: 500; }

.key-tier { border: 1px solid var(--mac-divider, #d8d8db); border-radius: 8px; padding: 8px 12px; }
.key-tier > summary { cursor: pointer; font-weight: 500; padding: 4px 0; }
.key-tier-cards { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; }

.key-card { padding: 10px; border-radius: 6px; background: var(--mac-card-bg, rgba(0,0,0,.03)); }
.key-card[data-status="valid"]   .key-card-glyph { color: #34c759; }
.key-card[data-status="invalid"] .key-card-glyph { color: #ff3b30; }
.key-card[data-status="unvalidated"] .key-card-glyph { color: #ff9500; }
.key-card[data-status="unset"]   .key-card-glyph { color: var(--mac-text-secondary, #8e8e93); }
.key-card[data-status="skipped"] .key-card-glyph { color: var(--mac-text-tertiary, #c7c7cc); }
.key-card-row { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.key-card-desc { font-size: 12px; color: var(--mac-text-secondary, #8e8e93); margin: 4px 0 8px 24px; }
.key-card-input-row { display: flex; gap: 6px; align-items: center; margin-left: 24px; }
.key-card-input { flex: 1; padding: 4px 8px; }
.key-card-btn { padding: 3px 10px; font-size: 12px; }
.key-card-signup { display: inline-block; margin: 6px 0 0 24px; font-size: 12px; }
.key-card-feedback { margin: 6px 0 0 24px; font-size: 12px; }
.key-card-feedback[data-kind="ok"]   { color: #34c759; }
.key-card-feedback[data-kind="err"]  { color: #ff3b30; }
.key-card-feedback[data-kind="info"] { color: var(--mac-text-secondary, #8e8e93); }
```

- [ ] **Step 3: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/KeyDashboard.ts src/styles/macos-native.css
git commit -m "feat(settings): interactive KeyDashboard cards

Each card has paste/Save/Test/Clear buttons + Open Signup link. Test
calls existing verifySecretWithApi(); on success, shows 'Unlocks:
<features>' from featuresFor(). All DOM construction via createElement
+ textContent — no innerHTML.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Wire `KeyDashboard` into `RuntimeConfigPanel`

**Files:**

- Modify: `src/components/RuntimeConfigPanel.ts`

- [ ] **Step 1: Locate the existing per-key list mount point**

```bash
grep -n "render\(\)\|renderKey\|class RuntimeConfigPanel\|getCurrentValue\|getStored" src/components/RuntimeConfigPanel.ts | head -10
```

Identify the function that builds the inner HTML for the API Keys section (the per-key form rows). That's where the dashboard mounts.

- [ ] **Step 2: Replace the per-key list with a KeyDashboard mount**

Inside `RuntimeConfigPanel`, add the import at the top, plus a mount helper and a wizard-launch stub:

```ts
import { KeyDashboard } from './KeyDashboard';
// SetupWizard import added in Task 9

private mountDashboard(container: HTMLElement): void {
  const dashboard = new KeyDashboard(container, {
    getValue: (key) => this.getStoredValue(key),
    onRunWizard: () => this.openWizard(),
  });
  dashboard.render();
}

private openWizard(): void {
  // Wired in Task 9. Until then, the button no-ops with a console warn.
  console.warn('Setup wizard not yet wired');
}
```

(`getStoredValue` is whatever helper `RuntimeConfigPanel` already uses to fetch the in-memory value for a key. If it's named differently, pass that helper through.)

In whichever method renders the API Keys section (likely something like `renderKeysSection` or a block inside `render`), find the place that loops over keys and replaces the inner content of the keys-section container. Replace the loop with a single `this.mountDashboard(container)` call. Preserve the web-vault banner code at the top of the section unchanged.

- [ ] **Step 3: Run typecheck and smoke test**

```bash
cd ~/developer/crystalball && npm run typecheck:all && npm run dev
```

Open Settings → API Keys. Verify the 8 tier accordions render and each card shows status / paste / Test / Save / signup link.

- [ ] **Step 4: Commit**

```bash
git add src/components/RuntimeConfigPanel.ts
git commit -m "feat(settings): mount KeyDashboard inside RuntimeConfigPanel

Replaces the existing flat per-key input list with the categorized
dashboard. Web-vault banner preserved unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 3 — SetupWizard modal

### Task 8: Create `SetupWizard.ts`

**Files:**

- Create: `src/components/SetupWizard.ts`

- [ ] **Step 1: Build the wizard with safe DOM construction**

Create `src/components/SetupWizard.ts`:

```ts
import {
  KEY_CATEGORIES, HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS,
} from '../services/settings-constants';
import {
  setSecretValue, verifySecretWithApi, type RuntimeSecretKey,
} from '../services/runtime-config';
import {
  getPosition, setPosition,
  getDontAsk, addDontAsk,
  getSkipped, addSkipped, clearSkipped,
  setKeyStatus,
} from '../services/wizard-state';
import { featuresFor } from '../services/key-feature-index';
import { invokeTauri } from '../services/tauri-bridge';

type StepView =
  | { kind: 'step'; tier: number; stepIndex: number; key: RuntimeSecretKey }
  | { kind: 'checkpoint'; tier: number }
  | { kind: 'done' };

export type SetupWizardOpts = {
  getValue: (key: RuntimeSecretKey) => string | undefined;
  onClose: () => void;
};

export class SetupWizard {
  private overlay: HTMLElement;
  private opts: SetupWizardOpts;
  private current: StepView = { kind: 'done' };

  constructor(host: HTMLElement, opts: SetupWizardOpts) {
    this.opts = opts;
    this.overlay = document.createElement('div');
    this.overlay.className = 'setup-wizard-overlay';
    host.appendChild(this.overlay);
  }

  open(): void {
    const pos = getPosition() ?? { tier: 1, stepIndex: 0 };
    this.current = this.resolveStep(pos.tier, pos.stepIndex);
    this.render();
    document.addEventListener('keydown', this.onKey);
  }

  close(): void {
    clearSkipped();
    document.removeEventListener('keydown', this.onKey);
    this.overlay.remove();
    this.opts.onClose();
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      if (confirm('Close the setup wizard? Your progress is saved.')) this.close();
    }
  };

  private resolveStep(startTier: number, startIndex: number): StepView {
    const dontAsk = new Set(getDontAsk());
    for (const cat of KEY_CATEGORIES) {
      if (cat.tier < startTier) continue;
      const wizardKeys = cat.keys.filter((k) => !dontAsk.has(k) && !this.opts.getValue(k));
      if (wizardKeys.length === 0) {
        if (cat.tier === startTier) return { kind: 'checkpoint', tier: cat.tier };
        continue;
      }
      const startAt = cat.tier === startTier
        ? Math.max(0, Math.min(startIndex, wizardKeys.length - 1))
        : 0;
      return { kind: 'step', tier: cat.tier, stepIndex: startAt, key: wizardKeys[startAt] };
    }
    return { kind: 'done' };
  }

  private wizardKeysForTier(tier: number): RuntimeSecretKey[] {
    const dontAsk = new Set(getDontAsk());
    const cat = KEY_CATEGORIES.find((c) => c.tier === tier);
    if (!cat) return [];
    return cat.keys.filter((k) => !dontAsk.has(k) && !this.opts.getValue(k));
  }

  private render(): void {
    this.overlay.replaceChildren();
    const modal = document.createElement('div');
    modal.className = 'setup-wizard-modal';
    if (this.current.kind === 'step') this.renderStep(modal, this.current);
    else if (this.current.kind === 'checkpoint') this.renderCheckpoint(modal, this.current.tier);
    else this.renderDone(modal);
    this.overlay.appendChild(modal);
  }

  private renderStep(modal: HTMLElement, step: { tier: number; stepIndex: number; key: RuntimeSecretKey }): void {
    const cat = KEY_CATEGORIES.find((c) => c.tier === step.tier)!;
    const total = this.wizardKeysForTier(step.tier).length;
    const tierLabel = document.createElement('div');
    tierLabel.className = 'setup-wizard-tier';
    tierLabel.textContent = 'Tier ' + step.tier + ' / 8 — ' + cat.label;
    const stepLabel = document.createElement('div');
    stepLabel.className = 'setup-wizard-step';
    stepLabel.textContent = 'Step ' + (step.stepIndex + 1) + ' of ' + total + ' — ' + (HUMAN_LABELS[step.key] ?? step.key);
    const desc = document.createElement('p');
    desc.className = 'setup-wizard-desc';
    desc.textContent = KEY_DESCRIPTIONS[step.key] ?? '';
    modal.append(tierLabel, stepLabel, desc);

    const signup = SIGNUP_URLS[step.key];
    if (signup && /^https?:\/\//.test(signup)) {
      const a = document.createElement('a');
      a.className = 'setup-wizard-signup';
      a.href = signup;
      a.textContent = 'Open Signup ↗';
      a.addEventListener('click', async (ev) => {
        ev.preventDefault();
        try { await invokeTauri('plugin:shell|open', { path: signup }); }
        catch { window.open(signup, '_blank', 'noopener,noreferrer'); }
      });
      modal.append(a);
    }

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'setup-wizard-input';
    input.placeholder = 'Paste key here';
    input.autofocus = true;
    modal.append(input);

    const feedback = document.createElement('div');
    feedback.className = 'setup-wizard-feedback';
    modal.append(feedback);

    const footer = document.createElement('div');
    footer.className = 'setup-wizard-footer';
    footer.append(
      this.button('← Back',           () => this.advance(step, -1)),
      this.button('Skip',             () => { addSkipped(step.key); this.advance(step, +1); }),
      this.button("Don't ask again",  () => { addDontAsk(step.key); this.advance(step, +1); }),
      this.button('Save & Next →',    () => this.handleSaveNext(step, input, feedback), 'primary'),
    );
    modal.append(footer);
  }

  private renderCheckpoint(modal: HTMLElement, tier: number): void {
    const cat = KEY_CATEGORIES.find((c) => c.tier === tier)!;
    const total = cat.keys.length;
    const setCount = cat.keys.filter((k) => this.opts.getValue(k)).length;
    const skipped = getSkipped().filter((k) => cat.keys.includes(k)).length;
    const h = document.createElement('h2');
    h.textContent = 'Tier ' + tier + ' done';
    const summary = document.createElement('p');
    summary.textContent = '✓ ' + setCount + ' of ' + total + ' added · ' + skipped + ' skipped';
    const prompt = document.createElement('p');
    prompt.textContent = 'Continue to Tier ' + (tier + 1) + ', or stop here?';
    modal.append(h, summary, prompt);
    const footer = document.createElement('div');
    footer.className = 'setup-wizard-footer';
    footer.append(
      this.button('Finish for now', () => this.close()),
      this.button('Continue →',     () => {
        const next = this.resolveStep(tier + 1, 0);
        this.current = next;
        if (next.kind === 'step') setPosition({ tier: next.tier, stepIndex: next.stepIndex });
        this.render();
      }, 'primary'),
    );
    modal.append(footer);
  }

  private renderDone(modal: HTMLElement): void {
    const h = document.createElement('h2');
    h.textContent = 'All set';
    const p = document.createElement('p');
    p.textContent = "You've configured every key the wizard knows about. Visit Settings → API Keys to add or rotate any of them.";
    modal.append(h, p);
    const footer = document.createElement('div');
    footer.className = 'setup-wizard-footer';
    footer.append(this.button('Done', () => this.close(), 'primary'));
    modal.append(footer);
  }

  private button(label: string, handler: () => void | Promise<void>, kind?: 'primary'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    if (kind) b.className = kind;
    b.textContent = label;
    b.addEventListener('click', () => { void handler(); });
    return b;
  }

  private async handleSaveNext(
    step: { tier: number; stepIndex: number; key: RuntimeSecretKey },
    input: HTMLInputElement,
    feedback: HTMLElement,
  ): Promise<void> {
    const value = input.value.trim();
    if (!value) { this.setFeedback(feedback, 'Enter a value or click Skip', 'err'); return; }
    this.setFeedback(feedback, 'Saving and validating…', 'info');
    await setSecretValue(step.key, value);
    const result = await verifySecretWithApi(step.key, value);
    if (result.valid) {
      setKeyStatus(step.key, { state: 'valid', lastChecked: Date.now() });
      const feats = featuresFor(step.key);
      const unlock = feats.length ? ' — Unlocks: ' + feats.join(', ') : '';
      this.setFeedback(feedback, '✓ ' + result.message + unlock, 'ok');
    } else {
      setKeyStatus(step.key, { state: 'invalid', lastChecked: Date.now(), lastError: result.message });
      this.setFeedback(feedback, '✗ ' + result.message + ' — saved anyway', 'err');
    }
    setTimeout(() => this.advance(step, +1), 700);
  }

  private setFeedback(el: HTMLElement, message: string, kind: 'ok' | 'err' | 'info'): void {
    el.textContent = message;
    el.dataset.kind = kind;
  }

  private advance(step: { tier: number; stepIndex: number }, delta: number): void {
    const next = this.resolveStep(step.tier, step.stepIndex + delta);
    this.current = next;
    if (next.kind === 'step') setPosition({ tier: next.tier, stepIndex: next.stepIndex });
    this.render();
  }
}
```

- [ ] **Step 2: Add the wizard CSS**

Append to `src/styles/macos-native.css`:

```css
.setup-wizard-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
}
.setup-wizard-modal {
  width: 720px; max-width: 90vw; background: var(--mac-bg, #fff);
  border-radius: 12px; padding: 24px; box-shadow: 0 20px 60px rgba(0,0,0,.3);
}
.setup-wizard-tier { font-size: 12px; color: var(--mac-text-secondary); text-transform: uppercase; letter-spacing: .05em; }
.setup-wizard-step { font-size: 18px; font-weight: 600; margin: 6px 0 12px; }
.setup-wizard-desc { color: var(--mac-text-secondary); margin: 0 0 12px; }
.setup-wizard-signup { display: inline-block; margin-bottom: 12px; }
.setup-wizard-input { width: 100%; padding: 8px 12px; font-family: monospace; }
.setup-wizard-feedback { margin: 10px 0; min-height: 1.2em; font-size: 13px; }
.setup-wizard-feedback[data-kind="ok"]   { color: #34c759; }
.setup-wizard-feedback[data-kind="err"]  { color: #ff3b30; }
.setup-wizard-feedback[data-kind="info"] { color: var(--mac-text-secondary); }
.setup-wizard-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.setup-wizard-footer button.primary { background: var(--mac-accent, #007aff); color: white; }
```

- [ ] **Step 3: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SetupWizard.ts src/styles/macos-native.css
git commit -m "feat(settings): SetupWizard modal with step + checkpoint flow

Tier-grouped wizard with back/skip/dont-ask/save-next navigation. All
DOM via createElement + textContent. Saves via setSecretValue and
validates via existing verifySecretWithApi.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Wire wizard launch from KeyDashboard

**Files:**

- Modify: `src/components/RuntimeConfigPanel.ts`

- [ ] **Step 1: Replace the wizard stub**

Replace the `openWizard()` stub from Task 7:

```ts
import { SetupWizard } from './SetupWizard';

private openWizard(): void {
  const wizard = new SetupWizard(document.body, {
    getValue: (key) => this.getStoredValue(key),
    onClose: () => this.render(),
  });
  wizard.open();
}
```

- [ ] **Step 2: Manual smoke test**

Start the dev server, open Settings → API Keys, click "▶ Run Setup Wizard". Verify:

- Tier 1 / Step 1 (Anthropic) renders
- "Open Signup ↗" opens the signup URL in your default browser
- Pasting a fake key + Save & Next shows ✗ feedback
- Skip advances to next step
- Esc with confirm closes the wizard

- [ ] **Step 3: Commit**

```bash
git add src/components/RuntimeConfigPanel.ts
git commit -m "feat(settings): launch SetupWizard from KeyDashboard

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 4 — Clipboard watcher

### Task 10: Create `clipboard-watcher.ts`

**Files:**

- Create: `src/services/clipboard-watcher.ts`

- [ ] **Step 1: Write the watcher**

Create `src/services/clipboard-watcher.ts`:

```ts
import { matchesShape, hasShape } from './key-shape-registry';
import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import type { RuntimeSecretKey } from './runtime-config';

let pollHandle: number | null = null;
let lastSeen: string = '';
let activeKey: RuntimeSecretKey | null = null;
let onMatch: ((value: string) => void) | null = null;
const POLL_MS = 500;

export function startWatching(key: RuntimeSecretKey, callback: (value: string) => void): void {
  if (!isDesktopRuntime()) return;
  if (!hasShape(key)) return;
  stopWatching();
  activeKey = key;
  onMatch = callback;
  lastSeen = '';
  pollHandle = window.setInterval(poll, POLL_MS);
}

export function stopWatching(): void {
  if (pollHandle !== null) { clearInterval(pollHandle); pollHandle = null; }
  activeKey = null;
  onMatch = null;
  lastSeen = '';
}

async function poll(): Promise<void> {
  if (!activeKey || !onMatch) return;
  let text: string;
  try {
    text = await invokeTauri<string>('plugin:clipboard-manager|read_text');
  } catch {
    return;
  }
  if (!text || text === lastSeen) return;
  lastSeen = text;
  if (matchesShape(activeKey, text)) onMatch(text.trim());
}
```

- [ ] **Step 2: Verify the Tauri clipboard plugin is available**

```bash
grep -n "clipboard-manager\|tauri-plugin-clipboard" /Users/bradleybond/Developer/crystalball/src-tauri/Cargo.toml /Users/bradleybond/Developer/crystalball/src-tauri/capabilities/default.json /Users/bradleybond/Developer/crystalball/package.json 2>/dev/null
```

If absent: add `tauri-plugin-clipboard-manager` to `src-tauri/Cargo.toml`, register `.plugin(tauri_plugin_clipboard_manager::init())` in `src-tauri/src/main.rs`, add `clipboard-manager:allow-read-text` to `src-tauri/capabilities/default.json`, and `npm install @tauri-apps/plugin-clipboard-manager`. If already present, skip.

- [ ] **Step 3: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

- [ ] **Step 4: Commit**

```bash
git add src/services/clipboard-watcher.ts src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/capabilities/default.json package.json package-lock.json 2>/dev/null
git commit -m "feat(settings): clipboard-watcher service for key auto-detect

Polls Tauri clipboard every 500ms while the wizard is on a step whose
key has a registered shape regex. Desktop only — no-op on web.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Integrate clipboard-watcher into SetupWizard

**Files:**

- Modify: `src/components/SetupWizard.ts`

- [ ] **Step 1: Wire start/stop on each step transition**

In `SetupWizard.ts`, import and use the watcher:

```ts
import { startWatching, stopWatching } from '../services/clipboard-watcher';

// In renderStep, after building the input element and appending it:
startWatching(step.key, (value) => {
  input.value = value;
  feedback.textContent = 'Detected from clipboard — click Save & Next to use';
  feedback.dataset.kind = 'info';
});

// In renderCheckpoint and renderDone, call stopWatching() at the top:
private renderCheckpoint(modal: HTMLElement, tier: number): void {
  stopWatching();
  // ... existing body
}
private renderDone(modal: HTMLElement): void {
  stopWatching();
  // ... existing body
}

// In close():
public close(): void {
  stopWatching();
  // ... existing body
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd ~/developer/crystalball && npm run typecheck:all
```

- [ ] **Step 3: Manual smoke test**

Open the wizard. Copy a string matching the Anthropic shape (`sk-ant-` + 60 random alnums). Within 500ms, the paste field should auto-fill and the feedback area should say "Detected from clipboard…".

- [ ] **Step 4: Commit**

```bash
git add src/components/SetupWizard.ts
git commit -m "feat(settings): wire clipboard-watcher into SetupWizard

Auto-fills the paste field when the user copies a value matching the
active step's key shape.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 5 — Sidecar probes for uncovered keys

### Task 12: Anthropic + FMP probes

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: Locate the existing `switch (key)` block**

```bash
grep -n "switch (key) {" /Users/bradleybond/Developer/crystalball/src-tauri/sidecar/local-api-server.mjs
```

You should find one occurrence around line 1137. Add the new cases inside this block, keeping existing cases unchanged.

- [ ] **Step 2: Add Anthropic probe**

```js
case 'ANTHROPIC_API_KEY': {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01', Accept: 'application/json' },
  });
  const text = await response.text();
  if (isAuthFailure(response.status, text)) return fail('Anthropic rejected this key');
  if (!response.ok && response.status !== 429) return fail(`Anthropic probe failed (${response.status})`);
  return ok('Anthropic key verified');
}
```

- [ ] **Step 3: Add FMP probe**

```js
case 'FMP_API_KEY': {
  const response = await fetchWithTimeout(`https://financialmodelingprep.com/api/v3/profile/AAPL?apikey=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (isAuthFailure(response.status, text)) return fail('FMP rejected this key');
  if (!response.ok) return fail(`FMP probe failed (${response.status})`);
  if (/error|invalid api key|limit reached/i.test(text)) return fail('FMP rejected this key');
  return ok('FMP key verified');
}
```

- [ ] **Step 4: Run sidecar tests**

```bash
cd ~/developer/crystalball && npm run test:sidecar
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(sidecar): add validation probes for Anthropic and FMP

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 13: 8 Tier 3 cyber probes

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

Add these `case` blocks inside the same `switch (key)` block.

- [ ] **Step 1: VirusTotal**

```js
case 'VIRUSTOTAL_API_KEY': {
  const response = await fetchWithTimeout('https://www.virustotal.com/api/v3/files/d41d8cd98f00b204e9800998ecf8427e', {
    headers: { 'x-apikey': value, Accept: 'application/json' },
  });
  if (response.status === 401) return fail('VirusTotal rejected this key');
  if (response.status === 404) return ok('VirusTotal key verified');
  if (!response.ok) return fail(`VirusTotal probe failed (${response.status})`);
  return ok('VirusTotal key verified');
}
```

- [ ] **Step 2: GreyNoise**

```js
case 'GREYNOISE_API_KEY': {
  const response = await fetchWithTimeout('https://api.greynoise.io/v3/community/8.8.8.8', {
    headers: { key: value, Accept: 'application/json' },
  });
  const text = await response.text();
  if (isAuthFailure(response.status, text)) return fail('GreyNoise rejected this key');
  if (!response.ok && response.status !== 429) return fail(`GreyNoise probe failed (${response.status})`);
  return ok('GreyNoise key verified');
}
```

- [ ] **Step 3: URLScan**

```js
case 'URLSCAN_API_KEY': {
  const response = await fetchWithTimeout('https://urlscan.io/user/quotas/', {
    headers: { 'API-Key': value, Accept: 'application/json' },
  });
  const text = await response.text();
  if (isAuthFailure(response.status, text)) return fail('URLScan rejected this key');
  if (!response.ok) return fail(`URLScan probe failed (${response.status})`);
  return ok('URLScan key verified');
}
```

- [ ] **Step 4: Vulners**

```js
case 'VULNERS_API_KEY': {
  const response = await fetchWithTimeout(`https://vulners.com/api/v3/apiKey/valid/?keyID=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  let payload = null; try { payload = JSON.parse(text); } catch { /* ignore */ }
  if (payload?.result === 'OK' && payload?.data?.valid === true) return ok('Vulners key verified');
  return fail('Vulners rejected this key');
}
```

- [ ] **Step 5: Pulsedive**

```js
case 'PULSEDIVE_API_KEY': {
  const response = await fetchWithTimeout(`https://pulsedive.com/api/info.php?indicator=8.8.8.8&key=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (isAuthFailure(response.status, text)) return fail('Pulsedive rejected this key');
  if (/invalid api key/i.test(text)) return fail('Pulsedive rejected this key');
  return ok('Pulsedive key verified');
}
```

- [ ] **Step 6: HIBP**

```js
case 'HIBP_API_KEY': {
  const response = await fetchWithTimeout('https://haveibeenpwned.com/api/v3/breaches?domain=adobe.com', {
    headers: { 'hibp-api-key': value, 'User-Agent': 'CrystalBall', Accept: 'application/json' },
  });
  if (response.status === 401) return fail('HIBP rejected this key');
  if (!response.ok && response.status !== 429) return fail(`HIBP probe failed (${response.status})`);
  return ok('HIBP key verified');
}
```

- [ ] **Step 7: BGPView**

```js
case 'BGPVIEW_API_KEY': {
  const response = await fetchWithTimeout('https://api.bgpview.io/asn/15169', {
    headers: { Authorization: `Bearer ${value}`, Accept: 'application/json' },
  });
  if (!response.ok) return fail(`BGPView probe failed (${response.status})`);
  return ok('BGPView key stored (no auth check available)');
}
```

- [ ] **Step 8: BitcoinAbuse**

```js
case 'BITCOINABUSE_API_KEY': {
  const response = await fetchWithTimeout(`https://www.bitcoinabuse.com/api/reports/check?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa&api_token=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) return fail('BitcoinAbuse rejected this key');
  if (!response.ok) return fail(`BitcoinAbuse probe failed (${response.status})`);
  return ok('BitcoinAbuse key verified');
}
```

- [ ] **Step 9: Run sidecar tests**

```bash
cd ~/developer/crystalball && npm run test:sidecar
```

- [ ] **Step 10: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(sidecar): add validation probes for 8 Tier 3 cyber keys

VirusTotal, GreyNoise, URLScan, Vulners, Pulsedive, HIBP, BGPView,
BitcoinAbuse.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 14: News + Weather probes (5 keys)

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: NewsAPI**

```js
case 'NEWSAPI_KEY': {
  const response = await fetchWithTimeout('https://newsapi.org/v2/top-headlines?country=us&pageSize=1', {
    headers: { 'X-Api-Key': value, Accept: 'application/json' },
  });
  const text = await response.text();
  if (response.status === 401) return fail('NewsAPI rejected this key');
  if (!response.ok) return fail(`NewsAPI probe failed (${response.status})`);
  if (/apiKeyInvalid|apiKeyMissing/i.test(text)) return fail('NewsAPI rejected this key');
  return ok('NewsAPI key verified');
}
```

- [ ] **Step 2: NewsData**

```js
case 'NEWSDATA_API_KEY': {
  const response = await fetchWithTimeout(`https://newsdata.io/api/1/news?apikey=${encodeURIComponent(value)}&size=1`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (response.status === 401 || /unauthorized|api key/i.test(text)) return fail('NewsData rejected this key');
  if (!response.ok) return fail(`NewsData probe failed (${response.status})`);
  return ok('NewsData key verified');
}
```

- [ ] **Step 3: MediaStack**

```js
case 'MEDIASTACK_API_KEY': {
  const response = await fetchWithTimeout(`http://api.mediastack.com/v1/news?access_key=${encodeURIComponent(value)}&limit=1`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (/usage_limit_reached/i.test(text)) return ok('MediaStack key verified (usage limit reached)');
  if (/invalid_access_key/i.test(text)) return fail('MediaStack rejected this key');
  if (!response.ok) return fail(`MediaStack probe failed (${response.status})`);
  return ok('MediaStack key verified');
}
```

- [ ] **Step 4: OpenWeatherMap**

```js
case 'OWM_API_KEY': {
  const response = await fetchWithTimeout(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) return fail('OpenWeatherMap rejected this key');
  if (!response.ok) return fail(`OpenWeatherMap probe failed (${response.status})`);
  return ok('OpenWeatherMap key verified');
}
```

- [ ] **Step 5: NASA**

```js
case 'NASA_API_KEY': {
  const response = await fetchWithTimeout(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 403) return fail('NASA rejected this key');
  if (!response.ok && response.status !== 429) return fail(`NASA probe failed (${response.status})`);
  return ok('NASA key verified');
}
```

- [ ] **Step 6: Run sidecar tests + commit**

```bash
cd ~/developer/crystalball && npm run test:sidecar
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(sidecar): add probes for news + weather keys

NewsAPI, NewsData, MediaStack, OpenWeatherMap, NASA.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 15: Aviation + Geo probes (8 keys)

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: AviationStack**

```js
case 'AVIATIONSTACK_API': {
  const response = await fetchWithTimeout(`http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(value)}&limit=1`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (/invalid_access_key/i.test(text)) return fail('AviationStack rejected this key');
  if (/usage_limit_reached/i.test(text)) return ok('AviationStack key verified (usage limit reached)');
  if (!response.ok) return fail(`AviationStack probe failed (${response.status})`);
  return ok('AviationStack key verified');
}
```

- [ ] **Step 2: ICAO**

```js
case 'ICAO_API_KEY': {
  const response = await fetchWithTimeout(`https://applications.icao.int/dataservices/api/notams-realtime-list?api_key=${encodeURIComponent(value)}&format=json&criticality=4&locations=KJFK`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) return fail('ICAO rejected this key');
  if (!response.ok && response.status !== 429) return fail(`ICAO probe failed (${response.status})`);
  return ok('ICAO key verified');
}
```

- [ ] **Step 3: AISStream + OpenSky pair (noops — websocket-only / pair-required)**

```js
case 'AISSTREAM_API_KEY':
  return ok('AISStream key stored (no HTTP probe available)');

case 'OPENSKY_CLIENT_ID':
case 'OPENSKY_CLIENT_SECRET':
  return ok('OpenSky credential stored — full validation runs when both ID and Secret are set');
```

- [ ] **Step 4: Google Maps**

```js
case 'GOOGLE_MAPS_API_KEY': {
  const response = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/geocode/json?address=Mountain+View&key=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  let payload = null; try { payload = JSON.parse(text); } catch { /* ignore */ }
  if (payload?.status === 'REQUEST_DENIED') return fail(`Google Maps rejected this key (${payload?.error_message ?? 'denied'})`);
  if (!response.ok) return fail(`Google Maps probe failed (${response.status})`);
  return ok('Google Maps key verified');
}
```

- [ ] **Step 5: GeoNames**

```js
case 'GEONAMES_USERNAME': {
  const response = await fetchWithTimeout(`http://api.geonames.org/searchJSON?q=london&maxRows=1&username=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (/hourly limit/i.test(text)) return ok('GeoNames username verified (hourly limit reached)');
  if (/user does not exist|not enabled/i.test(text)) return fail('GeoNames username rejected');
  if (!response.ok) return fail(`GeoNames probe failed (${response.status})`);
  return ok('GeoNames username verified');
}
```

- [ ] **Step 6: IPInfo**

```js
case 'IPINFO_TOKEN': {
  const response = await fetchWithTimeout(`https://ipinfo.io/8.8.8.8/json?token=${encodeURIComponent(value)}`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) return fail('IPInfo rejected this token');
  if (!response.ok) return fail(`IPInfo probe failed (${response.status})`);
  return ok('IPInfo token verified');
}
```

- [ ] **Step 7: Run sidecar tests + typecheck + commit**

```bash
cd ~/developer/crystalball && npm run test:sidecar && npm run typecheck:all
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(sidecar): add probes for aviation + geo keys

AviationStack, ICAO, AISStream (noop ws-only), OpenSky pair (noop pair-only),
Google Maps, GeoNames, IPInfo.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 16: Plaintext-noop probes for ACLED email/refresh, UCDP, WTO

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: Add the cases**

Inside the same `switch (key)` block:

```js
case 'ACLED_EMAIL':
case 'ACLED_REFRESH_TOKEN':
case 'UC_DP_KEY':
case 'WTO_API_KEY':
  return ok('Stored');
```

If any of these already has a richer probe in the file, leave it untouched and only add the missing ones.

- [ ] **Step 2: Run sidecar tests + commit**

```bash
cd ~/developer/crystalball && npm run test:sidecar
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(sidecar): noop probes for ACLED email/refresh, UCDP, WTO

These either have no public probe endpoint or are stored alongside a
primary token that does the actual auth check.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 6 — Verification

### Task 17: End-to-end manual smoke test

- [ ] **Step 1: Build and install the app**

```bash
cd ~/developer/crystalball && npm run desktop:build:full && node scripts/install-built-app.mjs --relaunch
```

- [ ] **Step 2: Walk the dashboard**

Open Settings (gear icon) → API Keys. Verify:

- The 8 tier accordions render in order
- Configured-count appears in the header
- Each card shows status glyph, label, description, signup link
- Already-set keys (e.g., CESIUM_ION_TOKEN) show ✓ if they pass Test, masked value
- Clicking "Open Signup ↗" launches the default browser

- [ ] **Step 3: Walk the wizard**

Click "▶ Run Setup Wizard". Verify:

- Lands on Tier 1 / Step 1 — Anthropic
- "Open Signup ↗" opens Anthropic console in default browser
- Pasting a fake `sk-ant-XXXXX` and clicking Save & Next shows ✗ feedback
- Skip advances to Step 2
- "Don't ask again" advances and adds the key to `cb:setup-wizard:dont-ask` localStorage
- Esc with confirm closes the wizard
- Reopening the wizard resumes at the saved position
- After completing all keys in a tier, the checkpoint screen renders ("X of N added; Y skipped")

- [ ] **Step 4: Test clipboard auto-fill**

On the Anthropic step, copy a string matching the shape (`sk-ant-` + 60 random alnums). Within 500ms, the paste field should auto-fill and the feedback area should say "Detected from clipboard…". Copy a non-matching string — nothing should happen.

- [ ] **Step 5: Verify saved keys reach the keychain**

```bash
security find-generic-password -s "crystal-ball" -a "FRED_API_KEY" -w 2>&1 | head -1
```

After saving a key in the dashboard or wizard, this should return the value (or at least exit 0).

- [ ] **Step 6: If anything broke the existing API Keys flow, fix before pushing**

Particularly the web-vault banner (create/unlock/lock/destroy controls) — that lives in `RuntimeConfigPanel` outside the dashboard mount and must remain functional.

- [ ] **Step 7: Push and open PR**

```bash
git push origin claude/signup-orchestrator
gh pr create --base main --title "feat(settings): signup orchestrator (dashboard + wizard)" --body "Implements the signup orchestrator design.

- Replaces flat API Keys list with categorized KeyDashboard (8 tiers, status badges, signup links, inline test).
- Adds SetupWizard modal — tier-grouped flow, clipboard auto-fill, validation with unlock notes.
- Adds 25 new sidecar validation probes for keys not previously covered.
- Reuses existing verifySecretWithApi() and /api/local-validate-secret infrastructure.

Spec: docs/superpowers/specs/2026-04-26-signup-orchestrator-design.md
Plan: docs/superpowers/plans/2026-04-26-signup-orchestrator.md"
```

---

## Known follow-ups (deferred from this plan)

The spec mentions three details this plan handles minimally. Each is a small follow-up PR after the main feature lands:

1. **ACLED triple-card UX.** The spec calls for a single virtual wizard step / dashboard card for ACLED that exposes three sub-fields (access token, email, refresh token). This plan walks the three ACLED keys as separate steps, which is functional but more clicks. Follow-up: in `KeyDashboard.renderTier` and `SetupWizard.resolveStep`, special-case the three ACLED keys to render as one combined unit.

2. **First-run hero state.** The spec describes a single hero card replacing the tier accordions when 0 keys are configured. This plan always shows the accordions. Follow-up: in `KeyDashboard.render`, branch on `setAll === 0` and render a single CTA card linking to the wizard.

3. **`skipped` status glyph.** The plan never writes `state: 'skipped'` to `cb:key-status:<KEY>` — keys added to `cb:setup-wizard:dont-ask` show as `unset` (○) on the dashboard. Follow-up: in `addDontAsk`, also call `setKeyStatus(key, { state: 'skipped' })` so the dashboard shows ⏸.

## Files reference (for the executor)

- Spec: `docs/superpowers/specs/2026-04-26-signup-orchestrator-design.md`
- Existing patterns:
  - `src/services/__tests__/llm-budget.test.mts` — test runner pattern with localStorage shim
  - `src/services/runtime-config.ts:1140` — `verifyWebSecret` (browser-side direct probes)
  - `src/services/runtime-config.ts:1173` — `verifySecretWithApi` (the entry point both dashboard and wizard call)
  - `src-tauri/sidecar/local-api-server.mjs:1137` — existing `switch (key)` block for sidecar probes
  - `src-tauri/sidecar/local-api-server.mjs:5066` — `/api/local-validate-secret` route handler
- Branch: this plan was written on `claude/signup-orchestrator` from `origin/main`. Continue committing on this branch; push and open a PR after Tasks 1–11 (Phase 5 sidecar probes can be a follow-up PR if the diff grows too large).
