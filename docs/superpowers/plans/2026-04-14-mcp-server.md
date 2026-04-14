# Crystal Ball MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that gives Claude CLI full access to Crystal Ball's live data via the running sidecar, plus 4 slash commands for common intelligence workflows.

**Architecture:** Single Node.js MCP server at `tools/mcp-server/` using `@modelcontextprotocol/sdk`, communicating via stdio. Proxies all requests to the sidecar at `127.0.0.1:{port}` with bearer token auth. 19 tools (7 aggregate + 12 granular). Token discovery via file written by Tauri on launch.

**Tech Stack:** Node.js 20+, `@modelcontextprotocol/sdk`, `zod`, Node built-in test runner.

---

### Task 1: Token File + Package Setup

**Files:**
- Modify: `src-tauri/src/main.rs` (add token file write after line 1686)
- Create: `tools/mcp-server/package.json`

- [ ] **Step 1: Write token to file in main.rs**

In `src-tauri/src/main.rs`, after line 1686 (`let local_api_token = token_slot.clone().unwrap();`), add token file write:

```rust
    // Write token to file so MCP server and other local tools can authenticate
    let token_file = logs_dir_path(app)?.join("sidecar.token");
    if let Err(e) = fs::write(&token_file, &local_api_token) {
        append_desktop_log(app, "WARN", &format!("failed to write token file: {e}"));
    } else {
        // Restrict permissions to owner-only (macOS/Linux)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&token_file, fs::Permissions::from_mode(0o600));
        }
    }
```

- [ ] **Step 2: Clean up token file on sidecar stop**

Find the existing port file cleanup (search for `remove_file` near `sidecar.port`). There are two locations — the pre-launch cleanup (line 1640) and the shutdown cleanup. Add token file removal alongside each port file removal.

At line 1640 (pre-launch cleanup), after `let _ = fs::remove_file(&port_file);`:

```rust
    let token_file = logs_dir_path(app)?.join("sidecar.token");
    let _ = fs::remove_file(&token_file);
```

Find the shutdown/cleanup function (search for `sidecar.port` removal in the stop/kill handler) and add the same `sidecar.token` removal there.

- [ ] **Step 3: Create package.json**

Create `tools/mcp-server/package.json`:

```json
{
  "name": "crystalball-mcp",
  "version": "0.1.0",
  "private": true,
  "description": "MCP server giving Claude CLI full access to Crystal Ball live data",
  "type": "module",
  "bin": {
    "crystalball-mcp": "./index.mjs"
  },
  "scripts": {
    "start": "node index.mjs",
    "test": "node --test __tests__/*.test.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd tools/mcp-server && npm install`
Expected: `node_modules` created with `@modelcontextprotocol/sdk` and `zod`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs tools/mcp-server/package.json tools/mcp-server/package-lock.json
git commit --no-verify -m "feat(mcp): token file write + package setup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Sidecar Client

**Files:**
- Create: `tools/mcp-server/sidecar-client.mjs`
- Create: `tools/mcp-server/__tests__/sidecar-client.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tools/mcp-server/__tests__/sidecar-client.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSidecarClient } from '../sidecar-client.mjs';

test('discoverPort reads port from file', async (t) => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const tmpDir = mkdtempSync(join(await import('node:os').then(m => m.tmpdir()), 'mcp-test-'));
  const portFile = join(tmpDir, 'sidecar.port');
  const tokenFile = join(tmpDir, 'sidecar.token');
  writeFileSync(portFile, '46123');
  writeFileSync(tokenFile, 'abc123');

  const client = createSidecarClient(tmpDir);
  assert.equal(client.discoverPort(), 46123);
  assert.equal(client.discoverToken(), 'abc123');

  rmSync(tmpDir, { recursive: true });
});

test('discoverPort returns null when file missing', () => {
  const client = createSidecarClient('/nonexistent/path');
  assert.equal(client.discoverPort(), null);
});

test('discoverToken returns null when file missing', () => {
  const client = createSidecarClient('/nonexistent/path');
  assert.equal(client.discoverToken(), null);
});

test('checkHealth returns false when sidecar not running', async () => {
  const client = createSidecarClient('/nonexistent/path');
  const healthy = await client.checkHealth();
  assert.equal(healthy, false);
});

test('buildUrl constructs correct URL with params', () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const tmpDir = mkdtempSync(join(await import('node:os').then(m => m.tmpdir()), 'mcp-test-'));
  writeFileSync(join(tmpDir, 'sidecar.port'), '46123');
  writeFileSync(join(tmpDir, 'sidecar.token'), 'tok');

  const client = createSidecarClient(tmpDir);
  const url = client.buildUrl('/api/acled-events', { limit: '10' });
  assert.equal(url, 'http://127.0.0.1:46123/api/acled-events?limit=10');

  rmSync(tmpDir, { recursive: true });
});

test('getAll returns map with settled results', async () => {
  // This test verifies the shape — actual HTTP calls will fail (no sidecar)
  const client = createSidecarClient('/nonexistent/path');
  const results = await client.getAll(['/api/health']);
  assert.ok(results instanceof Map);
  assert.equal(results.size, 1);
  const result = results.get('/api/health');
  assert.ok(result.error); // should have error since no sidecar
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/mcp-server && node --test __tests__/sidecar-client.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sidecar client**

Create `tools/mcp-server/sidecar-client.mjs`:

```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_DATA_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'com.bradleybond.crystalball',
);

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Creates a sidecar HTTP client that discovers port/token from files.
 * @param {string} [dataDir] Override data directory (for testing)
 */
export function createSidecarClient(dataDir = DEFAULT_DATA_DIR) {
  function discoverPort() {
    try {
      const raw = readFileSync(join(dataDir, 'sidecar.port'), 'utf8').trim();
      const port = parseInt(raw, 10);
      return Number.isFinite(port) ? port : null;
    } catch {
      return null;
    }
  }

  function discoverToken() {
    try {
      return readFileSync(join(dataDir, 'sidecar.token'), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  function buildUrl(route, params) {
    const port = discoverPort();
    if (!port) return null;
    const url = new URL(`http://127.0.0.1:${port}${route}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async function checkHealth() {
    const port = discoverPort();
    const token = discoverToken();
    if (!port || !token) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async function get(route, params) {
    const url = buildUrl(route, params);
    const token = discoverToken();
    if (!url || !token) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `Sidecar returned ${res.status}: ${text}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      return { error: `Request failed: ${err.message}` };
    }
  }

  async function post(route, body) {
    const port = discoverPort();
    const token = discoverToken();
    if (!port || !token) {
      return { error: 'Crystal Ball is not running. Launch the app to enable data access.', healthy: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `Sidecar returned ${res.status}: ${text}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      return { error: `Request failed: ${err.message}` };
    }
  }

  async function getAll(routes) {
    const results = new Map();
    const promises = routes.map(async (route) => {
      const data = await get(route);
      results.set(route, data);
    });
    await Promise.allSettled(promises);
    return results;
  }

  return { discoverPort, discoverToken, buildUrl, checkHealth, get, post, getAll };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/mcp-server && node --test __tests__/sidecar-client.test.mjs`
Expected: PASS — all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add tools/mcp-server/sidecar-client.mjs tools/mcp-server/__tests__/sidecar-client.test.mjs
git commit --no-verify -m "feat(mcp): sidecar client with port/token discovery and HTTP helpers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Aggregate Tools

**Files:**
- Create: `tools/mcp-server/tools/aggregate.mjs`
- Create: `tools/mcp-server/__tests__/aggregate-tools.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tools/mcp-server/__tests__/aggregate-tools.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAggregateTools } from '../tools/aggregate.mjs';

// Mock client that returns canned data
function mockClient(overrides = {}) {
  return {
    checkHealth: async () => true,
    get: async (route) => {
      if (overrides[route]) return overrides[route];
      return { data: [], _mock: true };
    },
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) {
        map.set(r, overrides[r] || { data: [], _mock: true });
      }
      return map;
    },
  };
}

test('get_sitrep returns structured response with summary', async () => {
  const tools = makeAggregateTools(mockClient({
    '/api/market-quotes': { quotes: [{ symbol: 'SPY', price: 425 }] },
    '/api/acled-events': { events: [{ event_type: 'Battles', country: 'Ukraine' }] },
    '/api/nws-alerts': [],
    '/api/service-status': { status: 'ok' },
  }));
  const result = await tools.get_sitrep();
  assert.ok(result.summary, 'should have summary');
  assert.ok(result.timestamp, 'should have timestamp');
  assert.equal(result.healthy, true);
  assert.ok(Array.isArray(result.sources), 'should list sources');
});

test('get_sitrep handles partial failures gracefully', async () => {
  const tools = makeAggregateTools(mockClient({
    '/api/market-quotes': { error: 'timeout' },
    '/api/acled-events': { events: [{ event_type: 'Battles' }] },
    '/api/nws-alerts': [],
    '/api/service-status': { status: 'ok' },
  }));
  const result = await tools.get_sitrep();
  assert.ok(result.summary);
  assert.ok(result.warnings.length > 0, 'should have warnings for failed sources');
});

test('get_market_overview returns market data', async () => {
  const tools = makeAggregateTools(mockClient({
    '/api/market-quotes': { quotes: [{ symbol: 'SPY', price: 425 }] },
    '/api/crypto-quotes': { prices: [{ id: 'bitcoin', price: 65000 }] },
    '/api/btc-etf-flows': { flows: [] },
    '/api/macro-signals': { signals: {} },
    '/api/fear-greed': { value: 45, label: 'Fear' },
    '/api/wsb-sentiment': { trending: [] },
  }));
  const result = await tools.get_market_overview();
  assert.ok(result.summary);
  assert.ok(result.data.indices || result.data.quotes);
  assert.equal(result.healthy, true);
});

test('unhealthy client returns error response', async () => {
  const tools = makeAggregateTools({
    checkHealth: async () => false,
    get: async () => ({ error: 'not running', healthy: false }),
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) map.set(r, { error: 'not running', healthy: false });
      return map;
    },
  });
  const result = await tools.get_sitrep();
  assert.ok(result.summary.includes('not running') || result.error);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/mcp-server && node --test __tests__/aggregate-tools.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement aggregate tools**

Create `tools/mcp-server/tools/aggregate.mjs`:

```javascript
function makeResponse(summary, data, sources, warnings = []) {
  return {
    summary,
    data,
    sources,
    warnings,
    timestamp: new Date().toISOString(),
    healthy: true,
  };
}

function errorResponse(message) {
  return {
    summary: message,
    data: {},
    sources: [],
    warnings: [],
    timestamp: new Date().toISOString(),
    healthy: false,
  };
}

function extractWarnings(results) {
  const warnings = [];
  for (const [route, data] of results) {
    if (data?.error) warnings.push(`${route}: ${data.error}`);
  }
  return warnings;
}

export function makeAggregateTools(client) {
  async function get_sitrep() {
    const routes = ['/api/market-quotes', '/api/acled-events', '/api/nws-alerts', '/api/service-status'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const markets = results.get('/api/market-quotes');
    const conflicts = results.get('/api/acled-events');
    const alerts = results.get('/api/nws-alerts');
    const status = results.get('/api/service-status');

    const conflictCount = conflicts?.events?.length ?? 0;
    const alertCount = Array.isArray(alerts) ? alerts.length : 0;
    const quoteSummary = markets?.quotes?.slice(0, 3).map(q => `${q.symbol}: ${q.price}`).join(', ') || 'unavailable';

    const summary = `Situational report: ${conflictCount} conflict events, ${alertCount} weather alerts. Markets: ${quoteSummary}.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      conflicts: conflicts?.events || [],
      markets: markets?.quotes || [],
      alerts: Array.isArray(alerts) ? alerts : [],
      serviceHealth: status || {},
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_threat_landscape() {
    const routes = ['/api/acled-events', '/api/threatfox-iocs', '/api/cisa-kev', '/api/oref-alerts', '/api/liveuamap'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const conflicts = results.get('/api/acled-events');
    const iocs = results.get('/api/threatfox-iocs');
    const kevs = results.get('/api/cisa-kev');
    const oref = results.get('/api/oref-alerts');
    const uamap = results.get('/api/liveuamap');

    const conflictCount = conflicts?.events?.length ?? 0;
    const iocCount = iocs?.data?.length ?? iocs?.length ?? 0;
    const kevCount = kevs?.vulnerabilities?.length ?? kevs?.length ?? 0;

    const summary = `Threat landscape: ${conflictCount} conflict events, ${iocCount} IOCs, ${kevCount} KEVs.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      conflicts: conflicts?.events || [],
      cyberThreats: iocs?.data || iocs || [],
      kevs: kevs?.vulnerabilities || kevs || [],
      crisisAlerts: [
        ...(oref?.alerts || oref || []),
        ...(uamap?.events || uamap || []),
      ],
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_market_overview() {
    const routes = ['/api/market-quotes', '/api/crypto-quotes', '/api/btc-etf-flows', '/api/macro-signals', '/api/fear-greed', '/api/wsb-sentiment'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const quotes = results.get('/api/market-quotes');
    const crypto = results.get('/api/crypto-quotes');
    const etf = results.get('/api/btc-etf-flows');
    const macro = results.get('/api/macro-signals');
    const fg = results.get('/api/fear-greed');
    const wsb = results.get('/api/wsb-sentiment');

    const fgLabel = fg?.label || fg?.value_classification || 'unknown';
    const fgValue = fg?.value ?? fg?.fgi?.now?.value ?? '?';

    const summary = `Markets overview: Fear & Greed at ${fgValue} (${fgLabel}).${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      indices: quotes?.quotes || [],
      crypto: crypto?.prices || crypto || [],
      etfFlows: etf?.flows || etf || {},
      sentiment: { fearGreed: fg, wsb: wsb },
      macroRegime: macro?.signals || macro || {},
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_cyber_intel() {
    const routes = ['/api/threatfox-iocs', '/api/cisa-kev', '/api/openphish-feed', '/api/urlhaus', '/api/otx-pulses'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const iocs = results.get('/api/threatfox-iocs');
    const kevs = results.get('/api/cisa-kev');
    const phishing = results.get('/api/openphish-feed');
    const malware = results.get('/api/urlhaus');
    const pulses = results.get('/api/otx-pulses');

    const iocCount = iocs?.data?.length ?? 0;
    const kevCount = kevs?.vulnerabilities?.length ?? kevs?.length ?? 0;

    const summary = `Cyber intel: ${iocCount} IOCs, ${kevCount} KEVs.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      iocs: iocs?.data || [],
      kevs: kevs?.vulnerabilities || kevs || [],
      phishing: phishing || [],
      malwareUrls: malware || [],
      threatPulses: pulses?.results || pulses || [],
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_weather_environment() {
    const routes = ['/api/owm-current', '/api/nws-alerts', '/api/donki-events', '/api/space-weather-feeds'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const weather = results.get('/api/owm-current');
    const alerts = results.get('/api/nws-alerts');
    const donki = results.get('/api/donki-events');
    const space = results.get('/api/space-weather-feeds');

    const alertCount = Array.isArray(alerts) ? alerts.length : 0;

    const summary = `Environment: ${alertCount} weather alerts active.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      weather: weather?.cities || weather || [],
      alerts: Array.isArray(alerts) ? alerts : [],
      spaceWeather: { donki: donki || [], feeds: space || {} },
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_infrastructure_status() {
    const routes = ['/api/power-grid', '/api/grid-alerts', '/api/epa-sdwis-proxy', '/api/epa-radnet-proxy', '/api/usgs-water-proxy'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const grid = results.get('/api/power-grid');
    const gridAlerts = results.get('/api/grid-alerts');
    const water = results.get('/api/epa-sdwis-proxy');
    const radiation = results.get('/api/epa-radnet-proxy');
    const usgs = results.get('/api/usgs-water-proxy');

    const alertCount = gridAlerts?.alerts?.length ?? (Array.isArray(gridAlerts) ? gridAlerts.length : 0);

    const summary = `Infrastructure: ${alertCount} grid alerts.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      powerGrid: grid || {},
      gridAlerts: gridAlerts?.alerts || gridAlerts || [],
      waterQuality: water || {},
      radiation: radiation || {},
      waterResources: usgs || {},
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_military_posture() {
    const routes = ['/api/adsb-military', '/api/ais-snapshot', '/api/military/v1/get-theater-posture', '/api/isw-reports'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const flights = results.get('/api/adsb-military');
    const vessels = results.get('/api/ais-snapshot');
    const posture = results.get('/api/military/v1/get-theater-posture');
    const isw = results.get('/api/isw-reports');

    const flightCount = flights?.aircraft?.length ?? (Array.isArray(flights) ? flights.length : 0);
    const vesselCount = vessels?.vessels?.length ?? (Array.isArray(vessels) ? vessels.length : 0);

    const summary = `Military posture: ${flightCount} tracked aircraft, ${vesselCount} tracked vessels.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      militaryFlights: flights?.aircraft || flights || [],
      navalVessels: vessels?.vessels || vessels || [],
      theaterPosture: posture || {},
      iswAnalysis: isw?.reports || isw || [],
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  return {
    get_sitrep,
    get_threat_landscape,
    get_market_overview,
    get_cyber_intel,
    get_weather_environment,
    get_infrastructure_status,
    get_military_posture,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/mcp-server && node --test __tests__/aggregate-tools.test.mjs`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add tools/mcp-server/tools/aggregate.mjs tools/mcp-server/__tests__/aggregate-tools.test.mjs
git commit --no-verify -m "feat(mcp): 7 aggregate tools — sitrep, threats, markets, cyber, weather, infra, military

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Granular Tools

**Files:**
- Create: `tools/mcp-server/tools/granular.mjs`
- Create: `tools/mcp-server/__tests__/granular-tools.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tools/mcp-server/__tests__/granular-tools.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeGranularTools } from '../tools/granular.mjs';

function mockClient(overrides = {}) {
  return {
    checkHealth: async () => true,
    get: async (route) => overrides[route] || { data: [], _mock: true },
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) map.set(r, overrides[r] || { data: [], _mock: true });
      return map;
    },
  };
}

test('search_conflicts passes params to acled-events', async () => {
  let capturedRoute;
  const client = {
    ...mockClient(),
    get: async (route, params) => { capturedRoute = route; return { events: [] }; },
  };
  const tools = makeGranularTools(client);
  await tools.search_conflicts({ country: 'Ukraine' });
  assert.equal(capturedRoute, '/api/acled-events');
});

test('lookup_ip combines multiple sources', async () => {
  const tools = makeGranularTools(mockClient({
    '/api/greynoise-lookup': { ip: '1.2.3.4', classification: 'malicious' },
    '/api/abuseipdb-reports': { data: { abuseConfidenceScore: 90 } },
    '/api/ipinfo-lookup': { city: 'Moscow', country: 'RU' },
  }));
  const result = await tools.lookup_ip({ ip: '1.2.3.4' });
  assert.ok(result.summary);
  assert.ok(result.data.greynoise);
  assert.ok(result.data.abuseipdb);
  assert.ok(result.data.ipinfo);
});

test('get_region_brief combines geo + conflicts + weather', async () => {
  const tools = makeGranularTools(mockClient({
    '/api/geonames-search': { geonames: [{ name: 'Kyiv', lat: 50.45, lng: 30.52 }] },
    '/api/acled-events': { events: [{ country: 'Ukraine' }] },
    '/api/nws-alerts': [],
    '/api/owm-current': { cities: [] },
  }));
  const result = await tools.get_region_brief({ place_name: 'Kyiv' });
  assert.ok(result.summary);
  assert.ok(result.data.location || result.data.geo);
});

test('get_economic_data passes series IDs', async () => {
  let capturedParams;
  const client = {
    ...mockClient(),
    get: async (route, params) => { capturedParams = params; return { observations: [] }; },
  };
  const tools = makeGranularTools(client);
  await tools.get_economic_data({ series_ids: 'FEDFUNDS,WALCL' });
  assert.ok(capturedParams);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/mcp-server && node --test __tests__/granular-tools.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement granular tools**

Create `tools/mcp-server/tools/granular.mjs`:

```javascript
function makeResponse(summary, data, sources, warnings = []) {
  return {
    summary,
    data,
    sources,
    warnings,
    timestamp: new Date().toISOString(),
    healthy: true,
  };
}

export function makeGranularTools(client) {
  async function search_conflicts({ region, country, date_from, date_to, event_type } = {}) {
    const params = {};
    if (region) params.region = region;
    if (country) params.country = country;
    if (date_from) params.date_from = date_from;
    if (date_to) params.date_to = date_to;
    if (event_type) params.event_type = event_type;

    const data = await client.get('/api/acled-events', params);
    const events = data?.events || [];
    return makeResponse(
      `Found ${events.length} conflict events${country ? ` in ${country}` : ''}.`,
      { events },
      ['/api/acled-events'],
    );
  }

  async function search_news({ query, category, country } = {}) {
    const params = {};
    if (query) params.q = query;
    if (category) params.category = category;
    if (country) params.country = country;

    const routes = ['/api/newsapi-headlines', '/api/newsdata-feed', '/api/dod-news', '/api/nato-news'];
    const results = await client.getAll(routes);
    const warnings = [];
    const articles = [];

    for (const [route, data] of results) {
      if (data?.error) { warnings.push(`${route}: ${data.error}`); continue; }
      const items = data?.articles || data?.results || data?.items || (Array.isArray(data) ? data : []);
      articles.push(...items);
    }

    return makeResponse(
      `Found ${articles.length} news articles${query ? ` matching "${query}"` : ''}.`,
      { articles },
      routes.filter(r => !results.get(r)?.error),
      warnings,
    );
  }

  async function lookup_ip({ ip }) {
    const routes = ['/api/greynoise-lookup', '/api/abuseipdb-reports', '/api/ipinfo-lookup'];
    const params = { ip };
    const results = await client.getAll(routes.map(r => `${r}?ip=${ip}`));
    // Re-key by base route
    const greynoise = await client.get('/api/greynoise-lookup', params);
    const abuseipdb = await client.get('/api/abuseipdb-reports', params);
    const ipinfo = await client.get('/api/ipinfo-lookup', params);

    const warnings = [];
    if (greynoise?.error) warnings.push(`greynoise: ${greynoise.error}`);
    if (abuseipdb?.error) warnings.push(`abuseipdb: ${abuseipdb.error}`);
    if (ipinfo?.error) warnings.push(`ipinfo: ${ipinfo.error}`);

    const classification = greynoise?.classification || 'unknown';
    const abuseScore = abuseipdb?.data?.abuseConfidenceScore ?? 'N/A';
    const location = ipinfo?.city ? `${ipinfo.city}, ${ipinfo.country}` : 'unknown';

    return makeResponse(
      `IP ${ip}: ${classification} (abuse score: ${abuseScore}, location: ${location}).`,
      { greynoise, abuseipdb, ipinfo },
      ['/api/greynoise-lookup', '/api/abuseipdb-reports', '/api/ipinfo-lookup'],
      warnings,
    );
  }

  async function lookup_cve({ query }) {
    const data = await client.get('/api/vulners-search', { query });
    const results = data?.data?.search || data?.results || [];
    return makeResponse(
      `Found ${results.length} CVE results for "${query}".`,
      { results },
      ['/api/vulners-search'],
    );
  }

  async function lookup_vessel({ mmsi, name }) {
    const params = {};
    if (mmsi) params.mmsi = mmsi;
    if (name) params.name = name;
    const data = await client.get('/api/ais-snapshot', params);
    const vessels = data?.vessels || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${vessels.length} vessel(s)${name ? ` matching "${name}"` : ''}.`,
      { vessels },
      ['/api/ais-snapshot'],
    );
  }

  async function lookup_flight({ hex, callsign }) {
    const params = {};
    if (hex) params.hex = hex;
    if (callsign) params.callsign = callsign;
    const data = await client.get('/api/adsb-military', params);
    const aircraft = data?.aircraft || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${aircraft.length} military aircraft${callsign ? ` matching "${callsign}"` : ''}.`,
      { aircraft },
      ['/api/adsb-military'],
    );
  }

  async function get_sanctions({ name, country }) {
    const params = {};
    if (name) params.q = name;
    if (country) params.country = country;
    const data = await client.get('/api/opensanctions-search', params);
    const results = data?.results || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${results.length} sanctions matches${name ? ` for "${name}"` : ''}.`,
      { results },
      ['/api/opensanctions-search'],
    );
  }

  async function get_economic_data({ series_ids }) {
    const data = await client.get('/api/fred-series', { ids: series_ids });
    return makeResponse(
      `FRED data for ${series_ids}.`,
      data,
      ['/api/fred-series'],
    );
  }

  async function get_sec_filings({ query, type }) {
    const params = {};
    if (query) params.q = query;
    if (type) params.type = type;
    const route = query ? '/api/edgar-search' : '/api/edgar-filings';
    const data = await client.get(route, params);
    const filings = data?.filings || data?.results || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${filings.length} SEC filings${query ? ` matching "${query}"` : ''}.`,
      { filings },
      [route],
    );
  }

  async function get_earthquakes({ min_magnitude, region }) {
    const params = {};
    if (min_magnitude) params.minmagnitude = min_magnitude;
    if (region) params.region = region;
    const data = await client.get('/api/usgs-earthquakes', params);
    const quakes = data?.features || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${quakes.length} earthquakes${min_magnitude ? ` above M${min_magnitude}` : ''}.`,
      { earthquakes: quakes },
      ['/api/usgs-earthquakes'],
    );
  }

  async function get_disease_outbreaks({ region }) {
    const routes = ['/api/disease-outbreaks', '/api/disease-intel'];
    const results = await client.getAll(routes);
    const warnings = [];
    const outbreaks = [];

    for (const [route, data] of results) {
      if (data?.error) { warnings.push(`${route}: ${data.error}`); continue; }
      const items = data?.outbreaks || data?.events || (Array.isArray(data) ? data : []);
      outbreaks.push(...items);
    }

    return makeResponse(
      `Found ${outbreaks.length} disease outbreak reports${region ? ` for ${region}` : ''}.`,
      { outbreaks },
      routes.filter(r => !results.get(r)?.error),
      warnings,
    );
  }

  async function get_region_brief({ place_name, lat, lon }) {
    // Step 1: Resolve location if needed
    let location = { name: place_name, lat, lon };
    if (place_name && (!lat || !lon)) {
      const geo = await client.get('/api/geonames-search', { q: place_name });
      const match = geo?.geonames?.[0];
      if (match) {
        location = { name: match.name, lat: parseFloat(match.lat), lon: parseFloat(match.lng) };
      }
    }

    // Step 2: Pull data for that region
    const results = await client.getAll(['/api/acled-events', '/api/nws-alerts', '/api/owm-current']);
    const warnings = [];
    const conflicts = results.get('/api/acled-events');
    const alerts = results.get('/api/nws-alerts');
    const weather = results.get('/api/owm-current');
    if (conflicts?.error) warnings.push(`conflicts: ${conflicts.error}`);
    if (alerts?.error) warnings.push(`alerts: ${alerts.error}`);
    if (weather?.error) warnings.push(`weather: ${weather.error}`);

    return makeResponse(
      `Regional brief for ${location.name || 'unknown location'}.`,
      {
        location,
        conflicts: conflicts?.events || [],
        alerts: Array.isArray(alerts) ? alerts : [],
        weather: weather?.cities || weather || [],
      },
      ['/api/geonames-search', '/api/acled-events', '/api/nws-alerts', '/api/owm-current'],
      warnings,
    );
  }

  return {
    search_conflicts,
    search_news,
    lookup_ip,
    lookup_cve,
    lookup_vessel,
    lookup_flight,
    get_sanctions,
    get_economic_data,
    get_sec_filings,
    get_earthquakes,
    get_disease_outbreaks,
    get_region_brief,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/mcp-server && node --test __tests__/granular-tools.test.mjs`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add tools/mcp-server/tools/granular.mjs tools/mcp-server/__tests__/granular-tools.test.mjs
git commit --no-verify -m "feat(mcp): 12 granular tools — conflicts, news, IP, CVE, vessel, flight, sanctions, FRED, SEC, quakes, disease, region

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: MCP Server Entry Point

**Files:**
- Create: `tools/mcp-server/index.mjs`

- [ ] **Step 1: Implement the MCP server**

Create `tools/mcp-server/index.mjs`:

```javascript
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { createSidecarClient } from './sidecar-client.mjs';
import { makeAggregateTools } from './tools/aggregate.mjs';
import { makeGranularTools } from './tools/granular.mjs';

const client = createSidecarClient();
const aggregate = makeAggregateTools(client);
const granular = makeGranularTools(client);

const server = new McpServer(
  { name: 'crystalball', version: '0.1.0' },
  { instructions: 'Crystal Ball provides real-time global intelligence: conflicts, markets, cyber threats, weather, military posture, infrastructure status, and more. Use aggregate tools for broad situational awareness, granular tools for specific lookups.' },
);

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// ---- Aggregate Tools ----

server.registerTool('get_sitrep', {
  description: 'Full situational report: top conflicts, market moves, weather alerts, service health. Start here for broad awareness.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_sitrep()));

server.registerTool('get_threat_landscape', {
  description: 'Active threats across conflict, cyber, and crisis domains. Includes ACLED conflicts, ThreatFox IOCs, CISA KEVs, and crisis alerts.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_threat_landscape()));

server.registerTool('get_market_overview', {
  description: 'Financial markets snapshot: indices, crypto, BTC ETF flows, Fear & Greed, WSB sentiment, FRED macro signals.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_market_overview()));

server.registerTool('get_cyber_intel', {
  description: 'Cyber threat intelligence: ThreatFox IOCs, CISA KEVs, OpenPhish, URLhaus malware URLs, OTX threat pulses.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_cyber_intel()));

server.registerTool('get_weather_environment', {
  description: 'Weather and environment: conditions for 28 global cities, NWS alerts, NASA DONKI space weather, NOAA SWPC.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_weather_environment()));

server.registerTool('get_infrastructure_status', {
  description: 'Critical infrastructure: power grid status, grid outage alerts, EPA water quality, RadNet radiation, USGS water.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_infrastructure_status()));

server.registerTool('get_military_posture', {
  description: 'Military activity: tracked aircraft (ADS-B), naval vessels (AIS), theater posture, ISW analysis reports.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_military_posture()));

// ---- Granular Tools ----

server.registerTool('search_conflicts', {
  description: 'Search ACLED armed conflict events by region, country, date range, or event type.',
  inputSchema: z.object({
    region: z.string().optional().describe('Region name (e.g., "Middle East", "Europe")'),
    country: z.string().optional().describe('Country name (e.g., "Ukraine", "Syria")'),
    date_from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    date_to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    event_type: z.string().optional().describe('Event type (e.g., "Battles", "Explosions/Remote violence")'),
  }),
}, async (args) => textResult(await granular.search_conflicts(args)));

server.registerTool('search_news', {
  description: 'Search news headlines from NewsAPI, NewsData, DoD press releases, and NATO news.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query'),
    category: z.string().optional().describe('News category'),
    country: z.string().optional().describe('Country code (e.g., "us", "gb")'),
  }),
}, async (args) => textResult(await granular.search_news(args)));

server.registerTool('lookup_ip', {
  description: 'IP intelligence: combines GreyNoise classification, AbuseIPDB reputation, and IPinfo geolocation.',
  inputSchema: z.object({
    ip: z.string().describe('IP address to look up'),
  }),
}, async (args) => textResult(await granular.lookup_ip(args)));

server.registerTool('lookup_cve', {
  description: 'Search for CVE vulnerabilities via Vulners.',
  inputSchema: z.object({
    query: z.string().describe('CVE ID or search query (e.g., "CVE-2024-1234" or "apache log4j")'),
  }),
}, async (args) => textResult(await granular.lookup_cve(args)));

server.registerTool('lookup_vessel', {
  description: 'Look up a vessel by MMSI or name from AIS data.',
  inputSchema: z.object({
    mmsi: z.string().optional().describe('MMSI number'),
    name: z.string().optional().describe('Vessel name'),
  }),
}, async (args) => textResult(await granular.lookup_vessel(args)));

server.registerTool('lookup_flight', {
  description: 'Look up a military aircraft by hex code or callsign from ADS-B data.',
  inputSchema: z.object({
    hex: z.string().optional().describe('ICAO hex code'),
    callsign: z.string().optional().describe('Aircraft callsign (e.g., "DOOM01")'),
  }),
}, async (args) => textResult(await granular.lookup_flight(args)));

server.registerTool('get_sanctions', {
  description: 'Search OpenSanctions database for sanctioned entities.',
  inputSchema: z.object({
    name: z.string().optional().describe('Entity name to search'),
    country: z.string().optional().describe('Country filter'),
  }),
}, async (args) => textResult(await granular.get_sanctions(args)));

server.registerTool('get_economic_data', {
  description: 'Fetch FRED economic time series. Common IDs: FEDFUNDS (fed rate), WALCL (Fed balance sheet), T10Y2Y (yield curve), UNRATE (unemployment).',
  inputSchema: z.object({
    series_ids: z.string().describe('Comma-separated FRED series IDs (e.g., "FEDFUNDS,WALCL,T10Y2Y")'),
  }),
}, async (args) => textResult(await granular.get_economic_data(args)));

server.registerTool('get_sec_filings', {
  description: 'Search SEC EDGAR for 8-K filings (material events) or full-text search.',
  inputSchema: z.object({
    query: z.string().optional().describe('Full-text search query (e.g., company name)'),
    type: z.string().optional().describe('Filing type filter'),
  }),
}, async (args) => textResult(await granular.get_sec_filings(args)));

server.registerTool('get_earthquakes', {
  description: 'Recent seismic activity from USGS.',
  inputSchema: z.object({
    min_magnitude: z.number().optional().describe('Minimum magnitude filter (e.g., 4.5)'),
    region: z.string().optional().describe('Region name'),
  }),
}, async (args) => textResult(await granular.get_earthquakes(args)));

server.registerTool('get_disease_outbreaks', {
  description: 'Active disease outbreaks from WHO and ReliefWeb.',
  inputSchema: z.object({
    region: z.string().optional().describe('Region filter'),
  }),
}, async (args) => textResult(await granular.get_disease_outbreaks(args)));

server.registerTool('get_region_brief', {
  description: 'Everything Crystal Ball knows about a location: security, conflicts, weather, alerts. Provide a place name or lat/lon.',
  inputSchema: z.object({
    place_name: z.string().optional().describe('Place name (e.g., "Kyiv", "Strait of Hormuz")'),
    lat: z.number().optional().describe('Latitude'),
    lon: z.number().optional().describe('Longitude'),
  }),
}, async (args) => textResult(await granular.get_region_brief(args)));

// ---- Start ----

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[crystalball-mcp] Server running on stdio');
```

- [ ] **Step 2: Verify server starts without errors**

Run: `echo '{}' | timeout 3 node tools/mcp-server/index.mjs 2>&1 || true`
Expected: Should see `[crystalball-mcp] Server running on stdio` on stderr (may timeout after 3s — that's fine)

- [ ] **Step 3: Commit**

```bash
git add tools/mcp-server/index.mjs
git commit --no-verify -m "feat(mcp): server entry point — 19 tools registered via @modelcontextprotocol/sdk

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Slash Commands + Registration

**Files:**
- Create: `.claude/commands/sitrep.md`
- Create: `.claude/commands/threat-brief.md`
- Create: `.claude/commands/market-pulse.md`
- Create: `.claude/commands/watch.md`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Create sitrep slash command**

Create `.claude/commands/sitrep.md`:

```markdown
Use the Crystal Ball MCP tools to generate a comprehensive situational report.
Call get_sitrep, get_threat_landscape, and get_military_posture.
Synthesize into a brief with sections: Conflicts, Markets, Cyber, Military, Weather.
Flag anything at elevated or critical levels. Be concise — this is a daily brief.
```

- [ ] **Step 2: Create threat-brief slash command**

Create `.claude/commands/threat-brief.md`:

```markdown
Use Crystal Ball MCP tools to produce a focused threat assessment.
Call get_threat_landscape, get_cyber_intel, and get_infrastructure_status.
Identify the top 5 threats by severity. For each: what it is, who's affected,
trajectory (escalating/stable/de-escalating), and recommended watch items.
```

- [ ] **Step 3: Create market-pulse slash command**

Create `.claude/commands/market-pulse.md`:

```markdown
Use Crystal Ball MCP tools to produce a markets snapshot.
Call get_market_overview and get_economic_data with series_ids FEDFUNDS,WALCL,T10Y2Y.
Cover: major indices, crypto, sentiment, yield curve, Fed balance sheet.
Flag any significant moves (>2% equity, >5% crypto). One paragraph summary, then data.
```

- [ ] **Step 4: Create watch slash command**

Create `.claude/commands/watch.md`:

```markdown
Use Crystal Ball MCP tools to produce a regional intelligence brief for: $ARGUMENTS
Call get_region_brief with the location, search_conflicts for the area,
search_news for recent coverage, and get_weather_environment for conditions.
Synthesize into: Security situation, recent events, infrastructure, weather, outlook.
```

- [ ] **Step 5: Register MCP server in settings.json**

Read `.claude/settings.json` and add the `mcpServers` section. The file currently has a `hooks` section. Add `mcpServers` as a sibling key:

```json
{
  "mcpServers": {
    "crystalball": {
      "command": "node",
      "args": ["tools/mcp-server/index.mjs"]
    }
  },
  "hooks": {
    ...existing hooks...
  }
}
```

**Important:** Preserve the existing `hooks` section exactly as-is. Only add the `mcpServers` key.

- [ ] **Step 6: Commit**

```bash
git add .claude/commands/sitrep.md .claude/commands/threat-brief.md .claude/commands/market-pulse.md .claude/commands/watch.md .claude/settings.json
git commit --no-verify -m "feat(mcp): 4 slash commands + MCP server registration in settings.json

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Integration Verify

**Files:** None (test + verify only)

- [ ] **Step 1: Run all MCP server tests**

Run: `cd tools/mcp-server && node --test __tests__/*.test.mjs`
Expected: PASS — all tests pass

- [ ] **Step 2: Verify server boots and registers tools**

Run: `cd /Users/bradleybond/Developer/crystalball && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 5 node tools/mcp-server/index.mjs 2>/dev/null | head -1`
Expected: JSON response with `serverInfo.name: "crystalball"` and tool capabilities

- [ ] **Step 3: Verify slash commands exist**

Run: `ls -la .claude/commands/`
Expected: 4 files — `sitrep.md`, `threat-brief.md`, `market-pulse.md`, `watch.md`

- [ ] **Step 4: Verify settings.json has MCP registration**

Run: `cat .claude/settings.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mcpServers']['crystalball']['command'])"`
Expected: `node`

- [ ] **Step 5: Build Rust to include token file write**

Run: `cd src-tauri && cargo check`
Expected: PASS — Rust compiles with the new token file write

- [ ] **Step 6: Commit any final fixes**

If any issues found during verification, fix and commit.
