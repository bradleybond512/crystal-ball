# High-Impact Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 missing data sources (RIPE Atlas, UN Comtrade, IMF, CAIDA BGPStream, ENTSO-E) and wire the existing World Bank service into the data-loader — completing the intelligence gaps identified in the data audit.

**Architecture:** Each data source follows Crystal Ball's established pattern: sidecar proxy route (`local-api-server.mjs`) -> frontend service (`src/services/*.ts`) -> panel component (`src/components/*Panel.ts`) -> data-loader wiring (`data-loader.ts`) -> refresh scheduler (`App.ts`). All new APIs are free/no-key except ENTSO-E (requires ENTSO-E security token). RIPE Atlas and BGPStream extend the existing internet infrastructure domain alongside RIPE NCC.

**Tech Stack:** TypeScript (frontend), Node.js (sidecar), Tauri 2 (desktop shell)

**Already Implemented (no work needed):**
- GDELT -- `src/services/gdelt-intel.ts` + sidecar route + panel
- ReliefWeb -- `src/services/reliefweb.ts` + sidecar route + panel
- FEWS NET / Food Insecurity -- `src/services/food-insecurity.ts` (uses rss-proxy + IPC API)
- HDX HAPI -- `src/services/hdx-crisis.ts` + sidecar route + panel
- OpenSanctions -- `src/services/opensanctions.ts` + sidecar routes + panel
- WHO Outbreak -- `src/services/disease-outbreak.ts` + sidecar route + panel

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/services/ripe-atlas.ts` | RIPE Atlas measurement fetch + types |
| `src/services/un-comtrade.ts` | UN Comtrade trade flow fetch + types |
| `src/services/imf-weo.ts` | IMF World Economic Outlook data fetch + types |
| `src/services/bgpstream.ts` | CAIDA BGPStream alert fetch + types |
| `src/services/entso-e.ts` | ENTSO-E power grid data fetch + types |
| `src/components/RipeAtlasPanel.ts` | RIPE Atlas panel UI |
| `src/components/ComtradePanel.ts` | Trade flows panel UI |
| `src/components/ImfPanel.ts` | IMF macro-financial panel UI |
| `src/components/BgpStreamPanel.ts` | BGP routing alerts panel UI |
| `src/components/EntsoePanel.ts` | European power grid panel UI |
| `tests/data-sources-wiring.test.mjs` | Wiring test for all 6 new integrations |

### Modified Files
| File | Changes |
|------|---------|
| `src-tauri/sidecar/local-api-server.mjs` | Add 6 route handlers |
| `src/services/runtime-config.ts` | Add `ENTSOE_API_KEY` to `RuntimeSecretKey`, add 5 feature IDs to `RuntimeFeatureId` |
| `src-tauri/src/main.rs` | Add `ENTSOE_API_KEY` to `SUPPORTED_SECRET_KEYS` |
| `src/services/settings-constants.ts` | Add ENTSO-E key label + signup URL |
| `src/config/panels.ts` | Register 5 new panels in `FULL_PANELS`, add `powerGrid` map layer alias |
| `src/app/panel-layout.ts` | Instantiate 5 new panel components |
| `src/app/data-loader.ts` | Import fetch functions, add 6 load methods |
| `src/App.ts` | Register 6 refresh schedules |

---

### Task 1: Wire World Bank into Data-Loader

The World Bank service (`src/services/world-bank.ts`) already exists and works -- it fetches GDP, population, military spending, and trade data per country. But it's only called on-demand from country intel cards. This task wires it into the periodic data-loader so it pre-fetches profiles for key countries.

**Files:**
- Modify: `src/app/data-loader.ts`
- Modify: `src/App.ts`
- Test: `tests/data-sources-wiring.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/data-sources-wiring.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const dataLoaderSrc = readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8');
const appSrc = readFileSync(resolve(root, 'src/App.ts'), 'utf8');

describe('World Bank data-loader wiring', () => {
  it('data-loader imports fetchWorldBankProfile', () => {
    assert.match(dataLoaderSrc, /fetchWorldBankProfile/);
  });

  it('data-loader has loadWorldBankBaselines method', () => {
    assert.match(dataLoaderSrc, /async loadWorldBankBaselines\(\): Promise<void>/);
  });

  it('App.ts scheduler includes worldBankBaselines', () => {
    assert.match(appSrc, /worldBankBaselines/);
    assert.match(appSrc, /loadWorldBankBaselines/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: FAIL -- `loadWorldBankBaselines` not found in data-loader or App.ts

- [ ] **Step 3: Add World Bank import and load method to data-loader**

In `src/app/data-loader.ts`, add the import near other service imports:

```typescript
import { fetchWorldBankProfile } from '@/services/world-bank';
```

Add the load method (near other load methods, around line 3150+):

```typescript
  async loadWorldBankBaselines(): Promise<void> {
    try {
      const keyCodes = ['USA', 'CHN', 'RUS', 'IND', 'DEU', 'GBR', 'FRA', 'JPN', 'BRA', 'SAU', 'IRN', 'UKR', 'ISR', 'TWN', 'KOR'];
      await Promise.allSettled(keyCodes.map(iso => fetchWorldBankProfile(iso)));
    } catch (error) {
      console.error('[App] World Bank baselines fetch failed:', error);
    }
  }
```

Note: `fetchWorldBankProfile` already has a 1-hour in-memory cache, so this pre-warms the cache for the 15 most geopolitically relevant countries. Other modules (country intel cards, situation engine) benefit from the warm cache.

- [ ] **Step 4: Register refresh schedule in App.ts**

In `src/App.ts`, add to the refresh registrations array (near line 617, after `foodInsecurity`):

```typescript
      { name: 'worldBankBaselines', fn: () => this.dataLoader.loadWorldBankBaselines(), intervalMs: 6 * 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

6-hour interval -- World Bank data updates annually, so this just keeps the cache warm.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck:all`
Expected: zero errors

- [ ] **Step 7: Commit**

```bash
git add src/app/data-loader.ts src/App.ts tests/data-sources-wiring.test.mjs
git commit -m "feat: wire World Bank service into periodic data-loader

Pre-fetches economic baselines for 15 key countries on a 6-hour cycle,
warming the cache for country intel cards and the situation engine.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: RIPE Atlas -- Internet Connectivity Measurements

RIPE Atlas provides real-time internet measurement data from 12,000+ probes worldwide. Unlike the existing RIPE NCC integration (which queries RIPEstat for AS overviews), Atlas gives actual latency, packet loss, and DNS resolution measurements -- confirming real-world outages rather than theoretical routing data.

**API:** `https://atlas.ripe.net/api/v2/` -- free, no API key needed for public measurements, rate-limited to 100 req/day for anonymous access.

**Files:**
- Create: `src/services/ripe-atlas.ts`
- Create: `src/components/RipeAtlasPanel.ts`
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/ripe-atlas` route)
- Modify: `src/services/runtime-config.ts` (add `ripeAtlasMeasurements` feature ID)
- Modify: `src/config/panels.ts` (register panel)
- Modify: `src/app/panel-layout.ts` (instantiate panel)
- Modify: `src/app/data-loader.ts` (add load method)
- Modify: `src/App.ts` (add refresh schedule)
- Modify: `tests/data-sources-wiring.test.mjs` (add wiring test)

- [ ] **Step 1: Add wiring tests for RIPE Atlas**

Append to `tests/data-sources-wiring.test.mjs`:

```javascript
const panelsSrc = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const panelLayoutSrc = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');

describe('RIPE Atlas wiring', () => {
  it('sidecar has /api/ripe-atlas route', () => {
    assert.match(sidecarSrc, /\/api\/ripe-atlas/);
    assert.match(sidecarSrc, /atlas\.ripe\.net/);
  });

  it('ripe-atlas panel is registered', () => {
    assert.match(panelsSrc, /'ripe-atlas':\s*\{/);
  });

  it('RipeAtlasPanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new RipeAtlasPanel\(/);
  });

  it('data-loader has loadRipeAtlas method', () => {
    assert.match(dataLoaderSrc, /async loadRipeAtlas\(\): Promise<void>/);
  });

  it('App.ts scheduler includes ripeAtlas', () => {
    assert.match(appSrc, /ripeAtlas/);
    assert.match(appSrc, /loadRipeAtlas/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: FAIL -- no RIPE Atlas references found

- [ ] **Step 3: Add sidecar route**

In `src-tauri/sidecar/local-api-server.mjs`, add near the existing RIPE NCC route (after line ~4022):

```javascript
  // -- RIPE Atlas -- real internet connectivity measurements ----------------
  if (requestUrl.pathname === '/api/ripe-atlas') {
    const type = requestUrl.searchParams.get('type') ?? 'status';
    const cacheKey = `ripe-atlas-${type}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      let endpoint;
      if (type === 'anchors') {
        // Anchoring measurements -- regional connectivity health
        endpoint = 'https://atlas.ripe.net/api/v2/anchors/?format=json&page_size=100&is_disabled=false';
      } else {
        // Global status -- probe connectivity summary
        endpoint = 'https://atlas.ripe.net/api/v2/probes/?format=json&status=1&page_size=1&fields=id';
      }
      const r = await fetchWithTimeout(endpoint, { headers: { Accept: 'application/json' } }, 12000);
      if (!r.ok) throw new Error(`RIPE Atlas ${r.status}`);
      const data = await r.json();
      const result = type === 'anchors'
        ? { anchors: (data.results ?? []).map(a => ({ id: a.id, fqdn: a.fqdn, country: a.country, is_ipv4_only: a.is_ipv4_only, geometry: a.geometry })), count: data.count ?? 0 }
        : { totalConnectedProbes: data.count ?? 0 };
      setCached(cacheKey, result, 10 * 60 * 1000);
      return json(result);
    } catch (error) {
      return json({ error: `ripe-atlas error: ${error.message ?? error}` }, 502);
    }
  }
```

- [ ] **Step 4: Add feature ID to runtime-config.ts**

In `src/services/runtime-config.ts`, add `'ripeAtlasMeasurements'` to the `RuntimeFeatureId` union (after `'ripeNccData'`, around line 104):

```typescript
  | 'ripeAtlasMeasurements'
```

And in the `defaultToggles` object, add:

```typescript
  ripeAtlasMeasurements: true,
```

Also add to the `FEATURES` array:

```typescript
  {
    id: 'ripeAtlasMeasurements',
    name: 'RIPE Atlas Measurements',
    description: 'Real internet connectivity measurements from global probe network',
    requiredSecrets: [],
    fallback: 'Internet infrastructure monitoring disabled',
  },
```

- [ ] **Step 5: Create service file**

Create `src/services/ripe-atlas.ts`:

```typescript
import { getApiBaseUrl } from '@/services/runtime';

export interface RipeAtlasAnchor {
  id: number;
  fqdn: string;
  country: string;
  is_ipv4_only: boolean;
  geometry: { type: string; coordinates: [number, number] } | null;
}

export interface RipeAtlasStatus {
  totalConnectedProbes: number;
  anchors: RipeAtlasAnchor[];
}

let cache: { data: RipeAtlasStatus; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchRipeAtlasStatus(): Promise<RipeAtlasStatus> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const base = getApiBaseUrl();
  const [statusRes, anchorsRes] = await Promise.allSettled([
    fetch(`${base}/api/ripe-atlas?type=status`, { signal: AbortSignal.timeout(12_000) }),
    fetch(`${base}/api/ripe-atlas?type=anchors`, { signal: AbortSignal.timeout(12_000) }),
  ]);

  const statusData = statusRes.status === 'fulfilled' && statusRes.value.ok
    ? await statusRes.value.json() as { totalConnectedProbes: number }
    : { totalConnectedProbes: 0 };

  const anchorsData = anchorsRes.status === 'fulfilled' && anchorsRes.value.ok
    ? await anchorsRes.value.json() as { anchors: RipeAtlasAnchor[]; count: number }
    : { anchors: [] as RipeAtlasAnchor[], count: 0 };

  const result: RipeAtlasStatus = {
    totalConnectedProbes: statusData.totalConnectedProbes,
    anchors: anchorsData.anchors,
  };

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}
```

- [ ] **Step 6: Create panel component**

Create `src/components/RipeAtlasPanel.ts`:

```typescript
import { Panel } from '@/components/Panel';
import type { RipeAtlasStatus } from '@/services/ripe-atlas';

export class RipeAtlasPanel extends Panel {
  private data: RipeAtlasStatus | null = null;

  constructor() {
    super('ripe-atlas', 'RIPE Atlas');
  }

  update(data: RipeAtlasStatus): void {
    this.data = data;
    this.render();
  }

  protected renderContent(): string {
    if (!this.data) return '<div class="panel-empty">Loading RIPE Atlas data...</div>';

    const { totalConnectedProbes, anchors } = this.data;
    const countrySet = new Set(anchors.map(a => a.country));

    const rows = anchors.slice(0, 20).map(a =>
      `<tr><td>${this.esc(a.fqdn)}</td><td>${this.esc(a.country)}</td></tr>`
    ).join('');

    return `
      <div class="panel-summary">
        <span class="stat">${totalConnectedProbes.toLocaleString()} connected probes</span>
        <span class="stat">${anchors.length} anchors in ${countrySet.size} countries</span>
      </div>
      <table class="panel-table">
        <thead><tr><th>Anchor</th><th>Country</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}
```

- [ ] **Step 7: Register panel in panels.ts**

In `src/config/panels.ts`, add to `FULL_PANELS`:

```typescript
  'ripe-atlas': { name: 'RIPE Atlas', enabled: true, priority: 2 },
```

- [ ] **Step 8: Instantiate panel in panel-layout.ts**

In `src/app/panel-layout.ts`, add the import:

```typescript
import { RipeAtlasPanel } from '@/components/RipeAtlasPanel';
```

Add instantiation in the appropriate section (near other infrastructure panels):

```typescript
    this.ctx.panels['ripe-atlas'] = new RipeAtlasPanel();
```

- [ ] **Step 9: Wire into data-loader**

In `src/app/data-loader.ts`, add the import:

```typescript
import { fetchRipeAtlasStatus } from '@/services/ripe-atlas';
```

Add the load method:

```typescript
  async loadRipeAtlas(): Promise<void> {
    try {
      const data = await fetchRipeAtlasStatus();
      (this.ctx.panels['ripe-atlas'] as RipeAtlasPanel | undefined)?.update(data);
    } catch (error) {
      console.error('[App] RIPE Atlas fetch failed:', error);
    }
  }
```

Add the `RipeAtlasPanel` import at the top of data-loader.ts:

```typescript
import type { RipeAtlasPanel } from '@/components/RipeAtlasPanel';
```

- [ ] **Step 10: Register refresh schedule in App.ts**

In `src/App.ts`, add to the refresh registrations:

```typescript
      { name: 'ripeAtlas', fn: () => this.dataLoader.loadRipeAtlas(), intervalMs: 10 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

- [ ] **Step 11: Run tests and typecheck**

Run: `node --test tests/data-sources-wiring.test.mjs && npm run typecheck:all`
Expected: all pass, zero type errors

- [ ] **Step 12: Commit**

```bash
git add src/services/ripe-atlas.ts src/components/RipeAtlasPanel.ts src-tauri/sidecar/local-api-server.mjs src/services/runtime-config.ts src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts src/App.ts tests/data-sources-wiring.test.mjs
git commit -m "feat: add RIPE Atlas internet connectivity measurements

Real internet measurement data from 12,000+ global probes.
Complements existing RIPE NCC integration with actual connectivity
measurements rather than routing theory.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: UN Comtrade -- Global Trade Flows

UN Comtrade provides import/export data by country and commodity. Free tier allows 500 requests/day with no API key. Detects sanctions impact, supply shortages, and trade rerouting.

**API:** `https://comtradeapi.un.org/public/v1/preview/C/A/HS` -- free, no key for preview endpoint.

**Files:**
- Create: `src/services/un-comtrade.ts`
- Create: `src/components/ComtradePanel.ts`
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/comtrade` route)
- Modify: `src/services/runtime-config.ts` (add `comtradeTrade` feature ID)
- Modify: `src/config/panels.ts` (register panel)
- Modify: `src/app/panel-layout.ts` (instantiate panel)
- Modify: `src/app/data-loader.ts` (add load method)
- Modify: `src/App.ts` (add refresh schedule)
- Modify: `tests/data-sources-wiring.test.mjs` (add wiring test)

- [ ] **Step 1: Add wiring tests for Comtrade**

Append to `tests/data-sources-wiring.test.mjs`:

```javascript
describe('UN Comtrade wiring', () => {
  it('sidecar has /api/comtrade route', () => {
    assert.match(sidecarSrc, /\/api\/comtrade/);
    assert.match(sidecarSrc, /comtradeapi\.un\.org/);
  });

  it('comtrade panel is registered', () => {
    assert.match(panelsSrc, /'comtrade':\s*\{/);
  });

  it('ComtradePanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new ComtradePanel\(/);
  });

  it('data-loader has loadComtrade method', () => {
    assert.match(dataLoaderSrc, /async loadComtrade\(\): Promise<void>/);
  });

  it('App.ts scheduler includes comtrade', () => {
    assert.match(appSrc, /comtrade/);
    assert.match(appSrc, /loadComtrade/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: FAIL -- no Comtrade references found

- [ ] **Step 3: Add sidecar route**

In `src-tauri/sidecar/local-api-server.mjs`, add:

```javascript
  // -- UN Comtrade -- global trade flows ------------------------------------
  if (requestUrl.pathname === '/api/comtrade') {
    const reporter = requestUrl.searchParams.get('reporter') ?? '';
    const partner = requestUrl.searchParams.get('partner') ?? '0'; // 0 = World
    const period = requestUrl.searchParams.get('period') ?? '2023';
    const cacheKey = `comtrade-${reporter}-${partner}-${period}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=${reporter}&partnerCode=${partner}&period=${period}&motCode=0&flowCode=M,X`;
      const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 15000);
      if (!r.ok) throw new Error(`Comtrade ${r.status}`);
      const data = await r.json();
      const records = (data.data ?? []).slice(0, 100).map(r => ({
        reporter: r.reporterDesc ?? r.reporterCode,
        partner: r.partnerDesc ?? r.partnerCode,
        flow: r.flowDesc ?? r.flowCode,
        commodity: r.cmdDesc ?? r.cmdCode,
        value: r.primaryValue ?? 0,
        period: r.period,
      }));
      const result = { records, totalCount: data.count ?? records.length };
      setCached(cacheKey, result, 24 * 60 * 60 * 1000); // 24h -- annual data
      return json(result);
    } catch (error) {
      return json({ error: `comtrade error: ${error.message ?? error}` }, 502);
    }
  }
```

- [ ] **Step 4: Add feature ID to runtime-config.ts**

Add `'comtradeTrade'` to `RuntimeFeatureId` union and `defaultToggles`:

```typescript
  | 'comtradeTrade'
```

```typescript
  comtradeTrade: true,
```

Also add to `FEATURES` array:

```typescript
  {
    id: 'comtradeTrade',
    name: 'UN Comtrade Trade Flows',
    description: 'Global import/export data by country and commodity',
    requiredSecrets: [],
    fallback: 'Trade flow intelligence disabled',
  },
```

- [ ] **Step 5: Create service file**

Create `src/services/un-comtrade.ts`:

```typescript
import { getApiBaseUrl } from '@/services/runtime';

export interface ComtradeRecord {
  reporter: string;
  partner: string;
  flow: string;
  commodity: string;
  value: number;
  period: string;
}

export interface ComtradeData {
  records: ComtradeRecord[];
  totalCount: number;
}

let cache: { data: ComtradeData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const KEY_REPORTERS = ['842', '156', '643', '276', '826']; // USA, CHN, RUS, DEU, GBR

export async function fetchComtradeOverview(): Promise<ComtradeData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const base = getApiBaseUrl();
  const results = await Promise.allSettled(
    KEY_REPORTERS.map(code =>
      fetch(`${base}/api/comtrade?reporter=${code}`, { signal: AbortSignal.timeout(15_000) })
        .then(r => r.ok ? r.json() as Promise<ComtradeData> : { records: [], totalCount: 0 })
    )
  );

  const allRecords: ComtradeRecord[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allRecords.push(...r.value.records);
  }

  allRecords.sort((a, b) => b.value - a.value);
  const data: ComtradeData = { records: allRecords.slice(0, 200), totalCount: allRecords.length };
  cache = { data, fetchedAt: Date.now() };
  return data;
}

export function formatTradeValue(usd: number): string {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(1)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${Math.round(usd).toLocaleString()}`;
}
```

- [ ] **Step 6: Create panel component**

Create `src/components/ComtradePanel.ts`:

```typescript
import { Panel } from '@/components/Panel';
import type { ComtradeData } from '@/services/un-comtrade';
import { formatTradeValue } from '@/services/un-comtrade';

export class ComtradePanel extends Panel {
  private data: ComtradeData | null = null;

  constructor() {
    super('comtrade', 'Trade Flows');
  }

  update(data: ComtradeData): void {
    this.data = data;
    this.render();
  }

  protected renderContent(): string {
    if (!this.data) return '<div class="panel-empty">Loading trade data...</div>';

    const rows = this.data.records.slice(0, 25).map(r =>
      `<tr>
        <td>${this.esc(r.reporter)}</td>
        <td>${this.esc(r.partner)}</td>
        <td>${this.esc(r.flow)}</td>
        <td>${this.esc(r.commodity)}</td>
        <td class="text-right">${formatTradeValue(r.value)}</td>
      </tr>`
    ).join('');

    return `
      <div class="panel-summary">
        <span class="stat">${this.data.totalCount} trade records</span>
      </div>
      <table class="panel-table">
        <thead><tr><th>Reporter</th><th>Partner</th><th>Flow</th><th>Commodity</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}
```

- [ ] **Step 7: Register panel in panels.ts**

In `src/config/panels.ts`, add to `FULL_PANELS`:

```typescript
  'comtrade': { name: 'Trade Flows', enabled: true, priority: 2 },
```

- [ ] **Step 8: Instantiate panel in panel-layout.ts**

In `src/app/panel-layout.ts`, add:

```typescript
import { ComtradePanel } from '@/components/ComtradePanel';
```

```typescript
    this.ctx.panels['comtrade'] = new ComtradePanel();
```

- [ ] **Step 9: Wire into data-loader**

In `src/app/data-loader.ts`, add:

```typescript
import { fetchComtradeOverview } from '@/services/un-comtrade';
import type { ComtradePanel } from '@/components/ComtradePanel';
```

```typescript
  async loadComtrade(): Promise<void> {
    try {
      const data = await fetchComtradeOverview();
      (this.ctx.panels['comtrade'] as ComtradePanel | undefined)?.update(data);
    } catch (error) {
      console.error('[App] UN Comtrade fetch failed:', error);
    }
  }
```

- [ ] **Step 10: Register refresh schedule in App.ts**

```typescript
      { name: 'comtrade', fn: () => this.dataLoader.loadComtrade(), intervalMs: 12 * 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

12-hour interval -- trade data updates annually/quarterly.

- [ ] **Step 11: Run tests and typecheck**

Run: `node --test tests/data-sources-wiring.test.mjs && npm run typecheck:all`
Expected: all pass, zero type errors

- [ ] **Step 12: Commit**

```bash
git add src/services/un-comtrade.ts src/components/ComtradePanel.ts src-tauri/sidecar/local-api-server.mjs src/services/runtime-config.ts src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts src/App.ts tests/data-sources-wiring.test.mjs
git commit -m "feat: add UN Comtrade global trade flow intelligence

Fetches import/export data for key economies. Enables detection of
sanctions impact, supply shortages, and trade rerouting patterns.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: IMF World Economic Outlook

IMF provides macro-financial intelligence: sovereign debt, FX reserves, GDP forecasts, and monetary indicators. Free JSON API, no key required.

**API:** `https://www.imf.org/external/datamapper/api/v1/` -- free, no authentication.

**Files:**
- Create: `src/services/imf-weo.ts`
- Create: `src/components/ImfPanel.ts`
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/imf-weo` route)
- Modify: `src/services/runtime-config.ts` (add `imfMacroFinancial` feature ID)
- Modify: `src/config/panels.ts` (register panel)
- Modify: `src/app/panel-layout.ts` (instantiate panel)
- Modify: `src/app/data-loader.ts` (add load method)
- Modify: `src/App.ts` (add refresh schedule)
- Modify: `tests/data-sources-wiring.test.mjs` (add wiring test)

- [ ] **Step 1: Add wiring tests for IMF**

Append to `tests/data-sources-wiring.test.mjs`:

```javascript
describe('IMF WEO wiring', () => {
  it('sidecar has /api/imf-weo route', () => {
    assert.match(sidecarSrc, /\/api\/imf-weo/);
    assert.match(sidecarSrc, /imf\.org/);
  });

  it('imf-weo panel is registered', () => {
    assert.match(panelsSrc, /'imf-weo':\s*\{/);
  });

  it('ImfPanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new ImfPanel\(/);
  });

  it('data-loader has loadImfWeo method', () => {
    assert.match(dataLoaderSrc, /async loadImfWeo\(\): Promise<void>/);
  });

  it('App.ts scheduler includes imfWeo', () => {
    assert.match(appSrc, /imfWeo/);
    assert.match(appSrc, /loadImfWeo/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: FAIL

- [ ] **Step 3: Add sidecar route**

In `src-tauri/sidecar/local-api-server.mjs`, add:

```javascript
  // -- IMF World Economic Outlook -- macro-financial intelligence -----------
  if (requestUrl.pathname === '/api/imf-weo') {
    const indicator = requestUrl.searchParams.get('indicator') ?? 'NGDPD'; // Nominal GDP
    const countries = requestUrl.searchParams.get('countries') ?? '';
    const cacheKey = `imf-weo-${indicator}-${countries}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      const url = countries
        ? `https://www.imf.org/external/datamapper/api/v1/${indicator}/${countries}`
        : `https://www.imf.org/external/datamapper/api/v1/${indicator}`;
      const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 15000);
      if (!r.ok) throw new Error(`IMF WEO ${r.status}`);
      const data = await r.json();
      const values = data.values?.[indicator] ?? {};
      setCached(cacheKey, { indicator, values }, 12 * 60 * 60 * 1000);
      return json({ indicator, values });
    } catch (error) {
      return json({ error: `imf-weo error: ${error.message ?? error}` }, 502);
    }
  }
```

- [ ] **Step 4: Add feature ID to runtime-config.ts**

Add `'imfMacroFinancial'` to `RuntimeFeatureId` union and `defaultToggles`:

```typescript
  | 'imfMacroFinancial'
```

```typescript
  imfMacroFinancial: true,
```

Also add to `FEATURES` array:

```typescript
  {
    id: 'imfMacroFinancial',
    name: 'IMF Macro-Financial Data',
    description: 'Sovereign debt, FX reserves, and GDP forecasts from IMF World Economic Outlook',
    requiredSecrets: [],
    fallback: 'IMF macro-financial intelligence disabled',
  },
```

- [ ] **Step 5: Create service file**

Create `src/services/imf-weo.ts`:

```typescript
import { getApiBaseUrl } from '@/services/runtime';

export interface ImfCountryData {
  [year: string]: number | null;
}

export interface ImfIndicatorData {
  indicator: string;
  values: Record<string, ImfCountryData>;
}

export interface ImfSnapshot {
  gdp: ImfIndicatorData;
  debt: ImfIndicatorData;
  inflation: ImfIndicatorData;
}

const INDICATORS = {
  gdp: 'NGDPD',        // Nominal GDP (billions USD)
  debt: 'GGXWDG_NGDP', // Government gross debt (% GDP)
  inflation: 'PCPIPCH', // Inflation rate (% change)
} as const;

const KEY_COUNTRIES = 'USA,CHN,RUS,IND,DEU,GBR,FRA,JPN,BRA,SAU,IRN,UKR,ISR,TWN,KOR';

let cache: { data: ImfSnapshot; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function fetchIndicator(indicator: string): Promise<ImfIndicatorData> {
  const res = await fetch(
    `${getApiBaseUrl()}/api/imf-weo?indicator=${indicator}&countries=${KEY_COUNTRIES}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) return { indicator, values: {} };
  return await res.json() as ImfIndicatorData;
}

export async function fetchImfSnapshot(): Promise<ImfSnapshot> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const [gdpRes, debtRes, inflRes] = await Promise.allSettled([
    fetchIndicator(INDICATORS.gdp),
    fetchIndicator(INDICATORS.debt),
    fetchIndicator(INDICATORS.inflation),
  ]);

  const snapshot: ImfSnapshot = {
    gdp: gdpRes.status === 'fulfilled' ? gdpRes.value : { indicator: INDICATORS.gdp, values: {} },
    debt: debtRes.status === 'fulfilled' ? debtRes.value : { indicator: INDICATORS.debt, values: {} },
    inflation: inflRes.status === 'fulfilled' ? inflRes.value : { indicator: INDICATORS.inflation, values: {} },
  };

  cache = { data: snapshot, fetchedAt: Date.now() };
  return snapshot;
}

export function getLatestValue(countryData: ImfCountryData | undefined): number | null {
  if (!countryData) return null;
  const years = Object.keys(countryData).sort().reverse();
  for (const yr of years) {
    if (countryData[yr] != null) return countryData[yr];
  }
  return null;
}
```

- [ ] **Step 6: Create panel component**

Create `src/components/ImfPanel.ts`:

```typescript
import { Panel } from '@/components/Panel';
import type { ImfSnapshot } from '@/services/imf-weo';
import { getLatestValue } from '@/services/imf-weo';

export class ImfPanel extends Panel {
  private data: ImfSnapshot | null = null;

  constructor() {
    super('imf-weo', 'IMF Economy');
  }

  update(data: ImfSnapshot): void {
    this.data = data;
    this.render();
  }

  protected renderContent(): string {
    if (!this.data) return '<div class="panel-empty">Loading IMF data...</div>';

    const countries = Object.keys(this.data.gdp.values).slice(0, 15);
    const rows = countries.map(iso => {
      const gdp = getLatestValue(this.data!.gdp.values[iso]);
      const debt = getLatestValue(this.data!.debt.values[iso]);
      const infl = getLatestValue(this.data!.inflation.values[iso]);

      const debtClass = debt != null && debt > 100 ? 'text-danger' : '';
      const inflClass = infl != null && infl > 10 ? 'text-danger' : infl != null && infl > 5 ? 'text-warning' : '';

      return `<tr>
        <td>${this.esc(iso)}</td>
        <td class="text-right">${gdp != null ? `$${gdp.toFixed(0)}B` : '\u2014'}</td>
        <td class="text-right ${debtClass}">${debt != null ? `${debt.toFixed(1)}%` : '\u2014'}</td>
        <td class="text-right ${inflClass}">${infl != null ? `${infl.toFixed(1)}%` : '\u2014'}</td>
      </tr>`;
    }).join('');

    return `
      <table class="panel-table">
        <thead><tr><th>Country</th><th>GDP ($B)</th><th>Debt/GDP</th><th>Inflation</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}
```

- [ ] **Step 7: Register panel in panels.ts**

```typescript
  'imf-weo': { name: 'IMF Economy', enabled: true, priority: 2 },
```

- [ ] **Step 8: Instantiate panel in panel-layout.ts**

```typescript
import { ImfPanel } from '@/components/ImfPanel';
```

```typescript
    this.ctx.panels['imf-weo'] = new ImfPanel();
```

- [ ] **Step 9: Wire into data-loader**

```typescript
import { fetchImfSnapshot } from '@/services/imf-weo';
import type { ImfPanel } from '@/components/ImfPanel';
```

```typescript
  async loadImfWeo(): Promise<void> {
    try {
      const data = await fetchImfSnapshot();
      (this.ctx.panels['imf-weo'] as ImfPanel | undefined)?.update(data);
    } catch (error) {
      console.error('[App] IMF WEO fetch failed:', error);
    }
  }
```

- [ ] **Step 10: Register refresh schedule in App.ts**

```typescript
      { name: 'imfWeo', fn: () => this.dataLoader.loadImfWeo(), intervalMs: 12 * 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

- [ ] **Step 11: Run tests and typecheck**

Run: `node --test tests/data-sources-wiring.test.mjs && npm run typecheck:all`
Expected: all pass

- [ ] **Step 12: Commit**

```bash
git add src/services/imf-weo.ts src/components/ImfPanel.ts src-tauri/sidecar/local-api-server.mjs src/services/runtime-config.ts src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts src/App.ts tests/data-sources-wiring.test.mjs
git commit -m "feat: add IMF World Economic Outlook macro-financial intelligence

Tracks GDP, sovereign debt-to-GDP ratio, and inflation for 15 key
countries. Enables sovereign instability detection and financial
stress layer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: CAIDA BGPStream -- BGP Routing Intelligence

BGPStream provides real-time BGP hijack, route leak, and outage detection. The public API is free via the BGPStream web API (different from the C library). Enhances existing BGPView integration with active alerting.

**API:** `https://bgpstream.crosswork.cisco.com/api/` (formerly CAIDA) -- free, no key.

**Files:**
- Create: `src/services/bgpstream.ts`
- Create: `src/components/BgpStreamPanel.ts`
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/bgpstream` route)
- Modify: `src/services/runtime-config.ts` (add `bgpStreamAlerts` feature ID)
- Modify: `src/config/panels.ts` (register panel)
- Modify: `src/app/panel-layout.ts` (instantiate panel)
- Modify: `src/app/data-loader.ts` (add load method)
- Modify: `src/App.ts` (add refresh schedule)
- Modify: `tests/data-sources-wiring.test.mjs` (add wiring test)

- [ ] **Step 1: Add wiring tests for BGPStream**

Append to `tests/data-sources-wiring.test.mjs`:

```javascript
describe('BGPStream wiring', () => {
  it('sidecar has /api/bgpstream route', () => {
    assert.match(sidecarSrc, /\/api\/bgpstream/);
  });

  it('bgpstream panel is registered', () => {
    assert.match(panelsSrc, /'bgpstream':\s*\{/);
  });

  it('BgpStreamPanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new BgpStreamPanel\(/);
  });

  it('data-loader has loadBgpStream method', () => {
    assert.match(dataLoaderSrc, /async loadBgpStream\(\): Promise<void>/);
  });

  it('App.ts scheduler includes bgpStream', () => {
    assert.match(appSrc, /bgpStream/);
    assert.match(appSrc, /loadBgpStream/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: FAIL

- [ ] **Step 3: Add sidecar route**

In `src-tauri/sidecar/local-api-server.mjs`, add:

```javascript
  // -- BGPStream -- BGP routing intelligence (hijacks, leaks, outages) ------
  if (requestUrl.pathname === '/api/bgpstream') {
    const eventType = requestUrl.searchParams.get('type') ?? ''; // bgp-hijack, moas, outage
    const cacheKey = `bgpstream-${eventType || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      const params = new URLSearchParams({ length: '50', format: 'json' });
      if (eventType) params.set('type', eventType);
      const url = `https://bgpstream.crosswork.cisco.com/api/events?${params}`;
      const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
      if (!r.ok) throw new Error(`BGPStream ${r.status}`);
      const data = await r.json();
      const events = (data.events ?? data.data ?? data ?? []).slice(0, 50).map(e => ({
        id: e.id ?? e.event_id,
        type: e.event_type ?? e.type,
        country: e.country ?? e.country_code ?? '',
        asn: e.asn ?? e.as_number,
        asName: e.as_name ?? '',
        prefixes: e.prefixes ?? [],
        startTime: e.start_time ?? e.startTime,
        duration: e.duration,
        severity: e.severity ?? 'unknown',
        summary: e.summary ?? e.description ?? '',
      }));
      const result = { events, totalCount: data.total ?? events.length };
      setCached(cacheKey, result, 5 * 60 * 1000);
      return json(result);
    } catch (error) {
      return json({ error: `bgpstream error: ${error.message ?? error}` }, 502);
    }
  }
```

- [ ] **Step 4: Add feature ID to runtime-config.ts**

Add `'bgpStreamAlerts'` to `RuntimeFeatureId` union and `defaultToggles`:

```typescript
  | 'bgpStreamAlerts'
```

```typescript
  bgpStreamAlerts: true,
```

Also add to `FEATURES` array:

```typescript
  {
    id: 'bgpStreamAlerts',
    name: 'BGPStream Routing Alerts',
    description: 'Real-time BGP hijack, route leak, and outage detection',
    requiredSecrets: [],
    fallback: 'BGP routing intelligence disabled',
  },
```

- [ ] **Step 5: Create service file**

Create `src/services/bgpstream.ts`:

```typescript
import { getApiBaseUrl } from '@/services/runtime';

export interface BgpStreamEvent {
  id: string;
  type: string;
  country: string;
  asn: number | null;
  asName: string;
  prefixes: string[];
  startTime: string;
  duration: number | null;
  severity: string;
  summary: string;
}

export interface BgpStreamData {
  events: BgpStreamEvent[];
  totalCount: number;
}

let cache: { data: BgpStreamData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchBgpStreamEvents(): Promise<BgpStreamData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const res = await fetch(`${getApiBaseUrl()}/api/bgpstream`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return { events: [], totalCount: 0 };

  const data = await res.json() as BgpStreamData;
  cache = { data, fetchedAt: Date.now() };
  return data;
}

export function bgpEventSeverityClass(severity: string): string {
  switch (severity) {
    case 'critical': case 'high': return 'eq-row eq-major';
    case 'medium': return 'eq-row eq-moderate';
    default: return 'eq-row';
  }
}
```

- [ ] **Step 6: Create panel component**

Create `src/components/BgpStreamPanel.ts`:

```typescript
import { Panel } from '@/components/Panel';
import type { BgpStreamData } from '@/services/bgpstream';

export class BgpStreamPanel extends Panel {
  private data: BgpStreamData | null = null;

  constructor() {
    super('bgpstream', 'BGP Routing');
  }

  update(data: BgpStreamData): void {
    this.data = data;
    this.render();
  }

  protected renderContent(): string {
    if (!this.data) return '<div class="panel-empty">Loading BGP data...</div>';

    const rows = this.data.events.slice(0, 20).map(e => {
      const typeClass = e.type === 'bgp-hijack' ? 'text-danger' : e.type === 'outage' ? 'text-warning' : '';
      return `<tr>
        <td class="${typeClass}">${this.esc(e.type)}</td>
        <td>${this.esc(e.country)}</td>
        <td>${this.esc(e.asName || String(e.asn ?? ''))}</td>
        <td>${this.esc(e.summary).slice(0, 80)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="panel-summary">
        <span class="stat">${this.data.totalCount} routing events</span>
      </div>
      <table class="panel-table">
        <thead><tr><th>Type</th><th>Country</th><th>AS</th><th>Summary</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}
```

- [ ] **Step 7: Register panel in panels.ts**

```typescript
  'bgpstream': { name: 'BGP Routing', enabled: true, priority: 2 },
```

- [ ] **Step 8: Instantiate panel in panel-layout.ts**

```typescript
import { BgpStreamPanel } from '@/components/BgpStreamPanel';
```

```typescript
    this.ctx.panels['bgpstream'] = new BgpStreamPanel();
```

- [ ] **Step 9: Wire into data-loader**

```typescript
import { fetchBgpStreamEvents } from '@/services/bgpstream';
import type { BgpStreamPanel } from '@/components/BgpStreamPanel';
```

```typescript
  async loadBgpStream(): Promise<void> {
    try {
      const data = await fetchBgpStreamEvents();
      (this.ctx.panels['bgpstream'] as BgpStreamPanel | undefined)?.update(data);
    } catch (error) {
      console.error('[App] BGPStream fetch failed:', error);
    }
  }
```

- [ ] **Step 10: Register refresh schedule in App.ts**

```typescript
      { name: 'bgpStream', fn: () => this.dataLoader.loadBgpStream(), intervalMs: 5 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

5-minute interval -- BGP events are time-sensitive.

- [ ] **Step 11: Run tests and typecheck**

Run: `node --test tests/data-sources-wiring.test.mjs && npm run typecheck:all`
Expected: all pass

- [ ] **Step 12: Commit**

```bash
git add src/services/bgpstream.ts src/components/BgpStreamPanel.ts src-tauri/sidecar/local-api-server.mjs src/services/runtime-config.ts src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts src/App.ts tests/data-sources-wiring.test.mjs
git commit -m "feat: add BGPStream BGP routing intelligence

Real-time BGP hijack, route leak, and outage detection. Complements
existing BGPView integration with active event alerting for cyber
and infrastructure disruption.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: ENTSO-E -- European Power Grid Intelligence

ENTSO-E provides real-time European power generation, grid load, and transmission data. Requires a free API security token (register at transparency.entsoe.eu).

**API:** `https://web-api.tp.entsoe.eu/api` -- free, requires security token.

**Files:**
- Create: `src/services/entso-e.ts`
- Create: `src/components/EntsoePanel.ts`
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/entsoe` route)
- Modify: `src/services/runtime-config.ts` (add `ENTSOE_API_KEY` + `entsoeGrid` feature ID)
- Modify: `src-tauri/src/main.rs` (add `ENTSOE_API_KEY` to `SUPPORTED_SECRET_KEYS`)
- Modify: `src/services/settings-constants.ts` (add key label + signup URL)
- Modify: `src/config/panels.ts` (register panel)
- Modify: `src/app/panel-layout.ts` (instantiate panel)
- Modify: `src/app/data-loader.ts` (add load method)
- Modify: `src/App.ts` (add refresh schedule)
- Modify: `tests/data-sources-wiring.test.mjs` (add wiring test)

- [ ] **Step 1: Add wiring tests for ENTSO-E**

Append to `tests/data-sources-wiring.test.mjs`:

```javascript
const runtimeConfigSrc = readFileSync(resolve(root, 'src/services/runtime-config.ts'), 'utf8');

describe('ENTSO-E wiring', () => {
  it('sidecar has /api/entsoe route', () => {
    assert.match(sidecarSrc, /\/api\/entsoe/);
    assert.match(sidecarSrc, /entsoe\.eu/);
  });

  it('ENTSOE_API_KEY is in runtime-config', () => {
    assert.match(runtimeConfigSrc, /ENTSOE_API_KEY/);
  });

  it('entsoe panel is registered', () => {
    assert.match(panelsSrc, /'entsoe':\s*\{/);
  });

  it('EntsoePanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new EntsoePanel\(/);
  });

  it('data-loader has loadEntsoe method', () => {
    assert.match(dataLoaderSrc, /async loadEntsoe\(\): Promise<void>/);
  });

  it('App.ts scheduler includes entsoe', () => {
    assert.match(appSrc, /entsoe/);
    assert.match(appSrc, /loadEntsoe/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-sources-wiring.test.mjs`
Expected: FAIL

- [ ] **Step 3: Add API key to runtime-config.ts**

In `src/services/runtime-config.ts`, add to `RuntimeSecretKey` union:

```typescript
  | 'ENTSOE_API_KEY'
```

Add `'entsoeGrid'` to `RuntimeFeatureId` union:

```typescript
  | 'entsoeGrid'
```

Add to `defaultToggles`:

```typescript
  entsoeGrid: true,
```

Add to `FEATURES` array:

```typescript
  {
    id: 'entsoeGrid',
    name: 'ENTSO-E Power Grid',
    description: 'European power generation, grid load, and transmission stress data',
    requiredSecrets: ['ENTSOE_API_KEY'],
    fallback: 'European power grid intelligence disabled -- add ENTSO-E API key',
  },
```

- [ ] **Step 4: Add API key to Tauri keychain support**

In `src-tauri/src/main.rs`, add `"ENTSOE_API_KEY"` to the `SUPPORTED_SECRET_KEYS` array.

- [ ] **Step 5: Add settings label**

In `src/services/settings-constants.ts`, add to `HUMAN_LABELS`:

```typescript
  ENTSOE_API_KEY: 'ENTSO-E Security Token',
```

And to `SIGNUP_URLS`:

```typescript
  ENTSOE_API_KEY: 'https://transparency.entsoe.eu/',
```

- [ ] **Step 6: Add sidecar route**

In `src-tauri/sidecar/local-api-server.mjs`, add:

```javascript
  // -- ENTSO-E -- European power grid intelligence --------------------------
  if (requestUrl.pathname === '/api/entsoe') {
    const token = process.env.ENTSOE_API_KEY ?? '';
    if (!token) return json({ error: 'ENTSOE_API_KEY not configured' }, 403);
    const area = requestUrl.searchParams.get('area') ?? '10Y1001A1001A83F'; // DE (Germany)
    const cacheKey = `entsoe-load-${area}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fmt = d => d.toISOString().replace(/[-:]/g, '').slice(0, 12) + '00';
      const url = `https://web-api.tp.entsoe.eu/api?securityToken=${token}&documentType=A65&processType=A16&outBiddingZone_Domain=${area}&periodStart=${fmt(start)}&periodEnd=${fmt(now)}`;
      const r = await fetchWithTimeout(url, { headers: { Accept: 'application/xml' } }, 15000);
      if (!r.ok) throw new Error(`ENTSO-E ${r.status}`);
      const xml = await r.text();
      // Extract load values from XML -- ENTSO-E returns XML, not JSON
      const points = [];
      const pointRegex = /<position>(\d+)<\/position>\s*<quantity>([.\d]+)<\/quantity>/g;
      let match;
      while ((match = pointRegex.exec(xml)) !== null) {
        points.push({ position: parseInt(match[1]), mw: parseFloat(match[2]) });
      }
      const result = { area, points, latestMw: points.length > 0 ? points[points.length - 1].mw : null };
      setCached(cacheKey, result, 15 * 60 * 1000);
      return json(result);
    } catch (error) {
      return json({ error: `entsoe error: ${error.message ?? error}` }, 502);
    }
  }
```

- [ ] **Step 7: Create service file**

Create `src/services/entso-e.ts`:

```typescript
import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface EntsoeLoadPoint {
  position: number;
  mw: number;
}

export interface EntsoeAreaLoad {
  area: string;
  areaName: string;
  points: EntsoeLoadPoint[];
  latestMw: number | null;
}

export interface EntsoeSnapshot {
  areas: EntsoeAreaLoad[];
}

const AREAS: Record<string, string> = {
  '10Y1001A1001A83F': 'Germany',
  '10YFR-RTE------C': 'France',
  '10YGB----------A': 'Great Britain',
  '10YES-REE------0': 'Spain',
  '10YIT-GRTN-----B': 'Italy',
  '10YPL-AREA-----S': 'Poland',
};

let cache: { data: EntsoeSnapshot; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function fetchEntsoeSnapshot(): Promise<EntsoeSnapshot> {
  if (!isFeatureAvailable('entsoeGrid')) return { areas: [] };
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const base = getApiBaseUrl();
  const results = await Promise.allSettled(
    Object.entries(AREAS).map(async ([code, name]) => {
      const res = await fetch(`${base}/api/entsoe?area=${code}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { area: code, areaName: name, points: [], latestMw: null };
      const data = await res.json() as { area: string; points: EntsoeLoadPoint[]; latestMw: number | null };
      return { ...data, areaName: name };
    })
  );

  const areas: EntsoeAreaLoad[] = results
    .filter((r): r is PromiseFulfilledResult<EntsoeAreaLoad> => r.status === 'fulfilled')
    .map(r => r.value);

  const snapshot: EntsoeSnapshot = { areas };
  cache = { data: snapshot, fetchedAt: Date.now() };
  return snapshot;
}
```

- [ ] **Step 8: Create panel component**

Create `src/components/EntsoePanel.ts`:

```typescript
import { Panel } from '@/components/Panel';
import type { EntsoeSnapshot } from '@/services/entso-e';

export class EntsoePanel extends Panel {
  private data: EntsoeSnapshot | null = null;

  constructor() {
    super('entsoe', 'Power Grid (EU)');
  }

  update(data: EntsoeSnapshot): void {
    this.data = data;
    this.render();
  }

  protected renderContent(): string {
    if (!this.data || this.data.areas.length === 0) {
      return '<div class="panel-empty">No ENTSO-E data -- check API key</div>';
    }

    const rows = this.data.areas.map(a => {
      const load = a.latestMw != null ? `${(a.latestMw / 1000).toFixed(1)} GW` : '\u2014';
      const peak = a.points.length > 0 ? Math.max(...a.points.map(p => p.mw)) : 0;
      const peakStr = peak > 0 ? `${(peak / 1000).toFixed(1)} GW` : '\u2014';
      const ratio = a.latestMw != null && peak > 0 ? (a.latestMw / peak * 100).toFixed(0) : '\u2014';
      const ratioClass = a.latestMw != null && peak > 0 && a.latestMw / peak > 0.9 ? 'text-danger' : '';

      return `<tr>
        <td>${this.esc(a.areaName)}</td>
        <td class="text-right">${load}</td>
        <td class="text-right">${peakStr}</td>
        <td class="text-right ${ratioClass}">${ratio}%</td>
      </tr>`;
    }).join('');

    return `
      <table class="panel-table">
        <thead><tr><th>Area</th><th>Current</th><th>24h Peak</th><th>Load %</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}
```

- [ ] **Step 9: Register panel in panels.ts**

```typescript
  'entsoe': { name: 'Power Grid (EU)', enabled: true, priority: 2 },
```

- [ ] **Step 10: Instantiate panel in panel-layout.ts**

```typescript
import { EntsoePanel } from '@/components/EntsoePanel';
```

```typescript
    this.ctx.panels['entsoe'] = new EntsoePanel();
```

- [ ] **Step 11: Wire into data-loader**

```typescript
import { fetchEntsoeSnapshot } from '@/services/entso-e';
import type { EntsoePanel } from '@/components/EntsoePanel';
```

```typescript
  async loadEntsoe(): Promise<void> {
    try {
      const data = await fetchEntsoeSnapshot();
      (this.ctx.panels['entsoe'] as EntsoePanel | undefined)?.update(data);
    } catch (error) {
      console.error('[App] ENTSO-E fetch failed:', error);
    }
  }
```

- [ ] **Step 12: Register refresh schedule in App.ts**

```typescript
      { name: 'entsoe', fn: () => this.dataLoader.loadEntsoe(), intervalMs: 15 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

15-minute interval -- grid load data updates every 15 minutes.

- [ ] **Step 13: Run tests and typecheck**

Run: `node --test tests/data-sources-wiring.test.mjs && npm run typecheck:all`
Expected: all pass

- [ ] **Step 14: Commit**

```bash
git add src/services/entso-e.ts src/components/EntsoePanel.ts src-tauri/sidecar/local-api-server.mjs src/services/runtime-config.ts src-tauri/src/main.rs src/services/settings-constants.ts src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts src/App.ts tests/data-sources-wiring.test.mjs
git commit -m "feat: add ENTSO-E European power grid intelligence

Tracks real-time power generation and grid load across 6 European
zones. Requires free ENTSO-E security token. High load ratios (>90%)
flag potential grid stress -- an early infrastructure instability signal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | Source | Type | API Key | Refresh |
|------|--------|------|---------|---------|
| 1 | World Bank | Wire existing | None | 6 hours |
| 2 | RIPE Atlas | New | None | 10 min |
| 3 | UN Comtrade | New | None | 12 hours |
| 4 | IMF WEO | New | None | 12 hours |
| 5 | BGPStream | New | None | 5 min |
| 6 | ENTSO-E | New | `ENTSOE_API_KEY` | 15 min |

**New files:** 10 (5 services + 5 panels)
**Modified files:** 8 (sidecar, runtime-config, main.rs, settings-constants, panels.ts, panel-layout.ts, data-loader.ts, App.ts)
**Test file:** 1 (shared wiring test)

**Already complete (no work needed):** GDELT, ReliefWeb, FEWS NET, HDX HAPI, OpenSanctions, WHO Outbreak
