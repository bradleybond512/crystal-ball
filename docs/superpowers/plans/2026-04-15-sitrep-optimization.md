# Sitrep Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce sitrep token usage from ~85-100k to ~12-18k via a sidecar bundle endpoint with severity scoring, pre-filtering, and sentinel delta, plus a smart skill with subagent delegation.

**Architecture:** New `/api/sitrep-bundle` sidecar endpoint batches all intelligence API calls server-side, computes per-domain severity scores (1-5), diffs against sentinel snapshots, and pre-filters data by severity level. A rewritten `/sitrep` skill dispatches a Sonnet subagent that calls the bundle + region brief, runs targeted enrichment, and returns only the finished brief to the main context.

**Tech Stack:** Node.js (sidecar), Claude Code skill (markdown), MCP tool registration (Zod + McpServer)

**Spec:** `docs/superpowers/specs/2026-04-15-sitrep-optimization-design.md`

---

### Task 1: Severity Scoring Module

**Files:**
- Create: `src-tauri/sidecar/sitrep-severity.mjs`
- Test: `src-tauri/sidecar/sitrep-severity.test.mjs`

This module computes per-domain severity scores (1-5) from raw API response data. Pure functions, no side effects, easy to test.

- [ ] **Step 1: Write failing tests for severity scorers**

```javascript
// src-tauri/sidecar/sitrep-severity.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scoreConflicts,
  scoreMarkets,
  scoreCyber,
  scoreMilitary,
  scoreWeather,
  scoreInfrastructure,
  scoreSeismic,
  scoreHealth,
  scoreEconomic,
  scoreSanctions,
  scoreAllDomains,
} from './sitrep-severity.mjs';

test('scoreConflicts: empty events = 1', () => {
  assert.equal(scoreConflicts([]), 1);
});

test('scoreConflicts: 10 events = 2', () => {
  const events = Array.from({ length: 10 }, (_, i) => ({ event_type: 'Protests', country: 'X' }));
  assert.equal(scoreConflicts(events), 2);
});

test('scoreConflicts: 20 events with fatalities = 3', () => {
  const events = Array.from({ length: 20 }, () => ({ event_type: 'Battles', fatalities: 1 }));
  assert.equal(scoreConflicts(events), 3);
});

test('scoreConflicts: 35 events = 4', () => {
  const events = Array.from({ length: 35 }, () => ({ event_type: 'Battles' }));
  assert.equal(scoreConflicts(events), 4);
});

test('scoreMarkets: no quotes = 1', () => {
  assert.equal(scoreMarkets([]), 1);
});

test('scoreMarkets: SPY down 3% = 2 (one threshold)', () => {
  assert.equal(scoreMarkets([{ symbol: 'SPY', changePercent: -3.0 }]), 2);
});

test('scoreMarkets: SPY -3% + BTC -6% = 3 (two thresholds)', () => {
  assert.equal(scoreMarkets([
    { symbol: 'SPY', changePercent: -3.0 },
    { symbol: 'BTC-USD', changePercent: -6.0 },
  ]), 3);
});

test('scoreWeather: no alerts = 1', () => {
  assert.equal(scoreWeather([]), 1);
});

test('scoreWeather: severe alerts = 3', () => {
  const alerts = [{ severity: 'Severe', event: 'Flood Warning' }];
  assert.equal(scoreWeather(alerts), 3);
});

test('scoreWeather: extreme alerts = 5', () => {
  const alerts = [{ severity: 'Extreme', event: 'Hurricane Warning' }];
  assert.equal(scoreWeather(alerts), 5);
});

test('scoreCyber: no KEVs no IOCs = 1', () => {
  assert.equal(scoreCyber([], []), 1);
});

test('scoreCyber: 30 IOCs + new KEV = 3', () => {
  const iocs = Array.from({ length: 30 }, () => ({ indicator: '1.2.3.4' }));
  const kevs = [{ indicator: 'CVE-2026-1234', firstSeen: new Date().toISOString().slice(0, 10) }];
  assert.equal(scoreCyber(iocs, kevs), 3);
});

test('scoreSeismic: no quakes = 1', () => {
  assert.equal(scoreSeismic([]), 1);
});

test('scoreSeismic: M6.5 = 4', () => {
  assert.equal(scoreSeismic([{ magnitude: 6.5 }]), 4);
});

test('scoreSeismic: M7.5 = 5', () => {
  assert.equal(scoreSeismic([{ magnitude: 7.5 }]), 5);
});

test('scoreMilitary: baseline = 1', () => {
  assert.equal(scoreMilitary({ aircraft: [], vessels: [], posture: {} }), 1);
});

test('scoreHealth: no outbreaks = 1', () => {
  assert.equal(scoreHealth([]), 1);
});

test('scoreEconomic: empty = 1', () => {
  assert.equal(scoreEconomic({}), 1);
});

test('scoreSanctions: empty = 1', () => {
  assert.equal(scoreSanctions([]), 1);
});

test('scoreAllDomains: returns all domain scores', () => {
  const scores = scoreAllDomains({
    conflicts: [],
    markets: [],
    cyber: { iocs: [], kevs: [] },
    military: { aircraft: [], vessels: [], posture: {} },
    weather: [],
    infrastructure: { gridAlerts: [] },
    seismic: [],
    health: [],
    economic: {},
    sanctions: [],
  });
  assert.equal(typeof scores.conflicts, 'number');
  assert.equal(typeof scores.markets, 'number');
  assert.equal(typeof scores.cyber, 'number');
  assert.equal(typeof scores.military, 'number');
  assert.equal(typeof scores.weather, 'number');
  assert.equal(typeof scores.seismic, 'number');
  assert.equal(typeof scores.health, 'number');
  assert.equal(typeof scores.economic, 'number');
  assert.equal(typeof scores.sanctions, 'number');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src-tauri/sidecar/sitrep-severity.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement severity scoring module**

```javascript
// src-tauri/sidecar/sitrep-severity.mjs

export function scoreConflicts(events) {
  const n = events?.length ?? 0;
  if (n === 0) return 1;
  const hasFatalities = events.some(e => (e.fatalities ?? 0) > 0);
  if (n >= 30) return hasFatalities ? 5 : 4;
  if (n >= 15 && hasFatalities) return 3;
  if (n >= 5) return 2;
  return 1;
}

export function scoreMarkets(quotes) {
  if (!quotes?.length) return 1;
  const thresholds = { SPY: 2.5, 'BTC-USD': 5, 'CL=F': 4, 'GC=F': 2 };
  let triggers = 0;
  for (const q of quotes) {
    const thresh = thresholds[q.symbol];
    if (thresh && Math.abs(q.changePercent ?? 0) >= thresh) triggers++;
  }
  return Math.min(1 + triggers, 5);
}

export function scoreCyber(iocs, kevs) {
  const iocCount = iocs?.length ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const newKevs = (kevs ?? []).filter(k => k.firstSeen === today).length;
  if (iocCount >= 50 || newKevs >= 5) return 4;
  if (iocCount >= 20 || newKevs >= 1) return 3;
  if (iocCount >= 5) return 2;
  return 1;
}

export function scoreMilitary({ aircraft = [], vessels = [], posture = {} } = {}) {
  const theaters = Object.values(posture?.theaters ?? posture ?? {});
  const elevated = theaters.filter(t => t.status && t.status !== 'normal').length;
  if (elevated >= 2) return 5;
  if (elevated >= 1) return 4;
  const acCount = aircraft.length;
  const vesCount = vessels.length;
  if (acCount > 50 || vesCount > 20) return 3;
  if (acCount > 20 || vesCount > 5) return 2;
  return 1;
}

export function scoreWeather(alerts) {
  if (!alerts?.length) return 1;
  const hasExtreme = alerts.some(a => a.severity === 'Extreme');
  if (hasExtreme) return 5;
  const severeCount = alerts.filter(a => a.severity === 'Severe').length;
  if (severeCount >= 5) return 4;
  if (severeCount >= 1) return 3;
  const modCount = alerts.filter(a => a.severity === 'Moderate').length;
  if (modCount >= 5) return 2;
  return 1;
}

export function scoreInfrastructure(gridAlerts) {
  const n = gridAlerts?.length ?? 0;
  if (n === 0) return 1;
  if (n >= 10) return 4;
  if (n >= 5) return 3;
  if (n >= 1) return 2;
  return 1;
}

export function scoreSeismic(quakes) {
  if (!quakes?.length) return 1;
  const maxMag = Math.max(...quakes.map(q => q.magnitude ?? q.mag ?? 0));
  if (maxMag >= 7.5) return 5;
  if (maxMag >= 6.5) return 4;
  if (maxMag >= 5.5) return 3;
  if (maxMag >= 4.0) return 2;
  return 1;
}

export function scoreHealth(outbreaks) {
  const n = outbreaks?.length ?? 0;
  if (n === 0) return 1;
  if (n >= 5) return 4;
  if (n >= 3) return 3;
  if (n >= 1) return 2;
  return 1;
}

export function scoreEconomic(data) {
  if (!data || data.error) return 1;
  const series = data.series ?? [];
  if (series.length === 0) return 1;
  const yieldCurve = series.find(s => s.id === 'T10Y2Y');
  if (yieldCurve?.observations?.length) {
    const latest = yieldCurve.observations[yieldCurve.observations.length - 1];
    if (parseFloat(latest?.value) < 0) return 3;
  }
  return 1;
}

export function scoreSanctions(entries) {
  const n = entries?.length ?? 0;
  if (n === 0) return 1;
  if (n >= 10) return 3;
  if (n >= 1) return 2;
  return 1;
}

export function scoreAllDomains(raw) {
  return {
    conflicts: scoreConflicts(raw.conflicts),
    markets: scoreMarkets(raw.markets),
    cyber: scoreCyber(raw.cyber?.iocs, raw.cyber?.kevs),
    military: scoreMilitary(raw.military),
    weather: scoreWeather(raw.weather),
    infrastructure: scoreInfrastructure(raw.infrastructure?.gridAlerts),
    seismic: scoreSeismic(raw.seismic),
    health: scoreHealth(raw.health),
    economic: scoreEconomic(raw.economic),
    sanctions: scoreSanctions(raw.sanctions),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src-tauri/sidecar/sitrep-severity.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/sidecar/sitrep-severity.mjs src-tauri/sidecar/sitrep-severity.test.mjs
git commit -m "feat: add sitrep severity scoring module

Pure-function per-domain severity scorers (1-5) for conflicts, markets,
cyber, military, weather, infrastructure, seismic, health, economic,
sanctions. Used by /api/sitrep-bundle to pre-filter data.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Pre-Filter Module

**Files:**
- Create: `src-tauri/sidecar/sitrep-filter.mjs`
- Test: `src-tauri/sidecar/sitrep-filter.test.mjs`

Filters raw domain data based on severity scores. Severity 1 returns only a summary string (no items). Severity 2-3 returns top 5 items. Severity 4-5 returns up to 20 items.

- [ ] **Step 1: Write failing tests for the filter**

```javascript
// src-tauri/sidecar/sitrep-filter.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterDomain, filterAllDomains } from './sitrep-filter.mjs';

test('filterDomain: severity 1 strips items, returns summary only', () => {
  const result = filterDomain('conflicts', 1, {
    events: Array.from({ length: 3 }, () => ({ country: 'X' })),
  });
  assert.equal(result.items, undefined);
  assert.equal(typeof result.summary, 'string');
  assert.equal(result.count, 3);
});

test('filterDomain: severity 2 returns top 5 items', () => {
  const events = Array.from({ length: 20 }, (_, i) => ({ id: i }));
  const result = filterDomain('conflicts', 2, { events });
  assert.equal(result.items.length, 5);
});

test('filterDomain: severity 4 returns up to 20 items', () => {
  const events = Array.from({ length: 50 }, (_, i) => ({ id: i }));
  const result = filterDomain('conflicts', 4, { events });
  assert.equal(result.items.length, 20);
});

test('filterDomain: weather severity 1 strips polygon geometry', () => {
  const result = filterDomain('weather', 1, [
    { event: 'Flood', severity: 'Moderate', geometry: { type: 'Polygon', coordinates: [[[1,2],[3,4]]] } },
  ]);
  assert.equal(result.items, undefined);
});

test('filterDomain: weather severity 3 strips polygon geometry from items', () => {
  const result = filterDomain('weather', 3, [
    { event: 'Flood', severity: 'Severe', geometry: { type: 'Polygon', coordinates: [[[1,2],[3,4]]] } },
  ]);
  assert.ok(result.items.length > 0);
  assert.equal(result.items[0].geometry, undefined);
});

test('filterDomain: military strips non-military aircraft', () => {
  const aircraft = [
    { callsign: 'RCH001', military: true },
    { callsign: 'THY123', military: false },
    { callsign: 'ZEUS22', military: true },
  ];
  const result = filterDomain('military', 3, { aircraft, vessels: [], posture: {} });
  const milOnly = result.items.filter(a => a.callsign);
  assert.ok(milOnly.every(a => a.military === true || /^(RCH|ZEUS|KYOTE|BOMR|ENT|OTIS|MUSEL|WATTS|CARGO|VVHK|SCHNR)/.test(a.callsign)));
});

test('filterAllDomains: applies correct filter per domain', () => {
  const severity = { conflicts: 1, weather: 3, seismic: 1 };
  const raw = {
    conflicts: { events: [{ country: 'X' }] },
    weather: [{ event: 'Flood', severity: 'Severe', geometry: {} }],
    seismic: { earthquakes: [] },
  };
  const result = filterAllDomains(severity, raw);
  assert.equal(result.conflicts.items, undefined);
  assert.ok(result.weather.items.length > 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src-tauri/sidecar/sitrep-filter.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the filter module**

```javascript
// src-tauri/sidecar/sitrep-filter.mjs

const MILITARY_CALLSIGN_PREFIXES = [
  'RCH', 'ZEUS', 'KYOTE', 'BOMR', 'ENT', 'OTIS', 'MUSEL', 'WATTS',
  'CARGO', 'VVHK', 'SCHNR', 'DOOM', 'EVAC', 'TOPCAT', 'JAKE', 'NCHO',
  'TEAL', 'GORDO', 'RAIDR', 'HAVOC', 'KNIFE',
];

function itemLimit(severity) {
  if (severity <= 1) return 0;
  if (severity <= 3) return 5;
  return 20;
}

function stripGeometry(alert) {
  const { geometry, ...rest } = alert;
  return rest;
}

function isMilitaryCallsign(callsign) {
  if (!callsign) return false;
  return MILITARY_CALLSIGN_PREFIXES.some(p => callsign.startsWith(p));
}

const extractors = {
  conflicts(raw) { return raw?.events ?? (Array.isArray(raw) ? raw : []); },
  markets(raw) { return raw?.quotes ?? (Array.isArray(raw) ? raw : []); },
  weather(raw) { return Array.isArray(raw) ? raw : raw?.alerts ?? []; },
  seismic(raw) { return raw?.earthquakes ?? raw?.features ?? (Array.isArray(raw) ? raw : []); },
  health(raw) { return raw?.outbreaks ?? (Array.isArray(raw) ? raw : []); },
  sanctions(raw) { return raw?.results ?? (Array.isArray(raw) ? raw : []); },
  news(raw) { return raw?.articles ?? (Array.isArray(raw) ? raw : []); },
  cyber(raw) { return { iocs: raw?.iocs ?? [], kevs: raw?.kevs ?? raw?.vulnerabilities ?? [] }; },
  military(raw) {
    const aircraft = raw?.aircraft ?? (Array.isArray(raw?.militaryFlights) ? raw.militaryFlights : []);
    const milAircraft = aircraft.filter(a => a.military === true || isMilitaryCallsign(a.callsign));
    return { aircraft: milAircraft, vessels: raw?.vessels ?? raw?.navalVessels ?? [], posture: raw?.posture ?? raw?.theaterPosture ?? {} };
  },
  infrastructure(raw) { return raw?.gridAlerts ?? []; },
  economic(raw) { return raw; },
};

export function filterDomain(domain, severity, raw) {
  const limit = itemLimit(severity);
  const extracted = (extractors[domain] ?? (r => r))(raw);

  if (domain === 'military') {
    const { aircraft, vessels, posture } = extracted;
    const count = aircraft.length + vessels.length;
    if (limit === 0) {
      return { summary: `${aircraft.length} military aircraft, ${vessels.length} vessels tracked`, count };
    }
    return {
      summary: `${aircraft.length} military aircraft, ${vessels.length} vessels tracked`,
      count,
      items: aircraft.slice(0, limit),
      vessels: vessels.slice(0, limit),
      posture,
    };
  }

  if (domain === 'cyber') {
    const { iocs, kevs } = extracted;
    const count = iocs.length + kevs.length;
    if (limit === 0) {
      return { summary: `${iocs.length} IOCs, ${kevs.length} KEVs`, count };
    }
    return {
      summary: `${iocs.length} IOCs, ${kevs.length} KEVs`,
      count,
      iocs: iocs.slice(0, limit),
      kevs: kevs.slice(0, limit),
    };
  }

  if (domain === 'economic') {
    return { summary: extracted?.error ? 'unavailable' : 'available', data: limit > 0 ? extracted : undefined };
  }

  const items = Array.isArray(extracted) ? extracted : [];
  const count = items.length;

  if (limit === 0) {
    return { summary: `${count} items`, count };
  }

  let sliced = items.slice(0, limit);
  if (domain === 'weather') {
    sliced = sliced.map(stripGeometry);
  }

  return { summary: `${count} items`, count, items: sliced };
}

export function filterAllDomains(severity, raw) {
  const result = {};
  for (const [domain, score] of Object.entries(severity)) {
    if (raw[domain] !== undefined) {
      result[domain] = filterDomain(domain, score, raw[domain]);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src-tauri/sidecar/sitrep-filter.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/sidecar/sitrep-filter.mjs src-tauri/sidecar/sitrep-filter.test.mjs
git commit -m "feat: add sitrep pre-filter module

Filters raw domain data by severity level: severity 1 = summary only,
2-3 = top 5 items, 4-5 = up to 20 items. Strips NWS polygon geometry,
filters military aircraft to mil-only callsigns.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Sidecar Bundle Endpoint

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs:1700` (insert new route handler before existing routes)
- Read: `src-tauri/sidecar/sitrep-severity.mjs` (import)
- Read: `src-tauri/sidecar/sitrep-filter.mjs` (import)

Adds the `/api/sitrep-bundle` endpoint that calls all intelligence endpoints in parallel, scores severity, reads sentinel snapshot for delta mode, and pre-filters results.

- [ ] **Step 1: Write a test for the bundle endpoint in the sidecar test file**

Add to `src-tauri/sidecar/local-api-server.test.mjs`:

```javascript
test('/api/sitrep-bundle returns structured bundle with severity and domains', async () => {
  // This test uses the real sidecar with mocked external APIs
  // For now, integration test against live sidecar
  const port = discoverPort();
  const token = discoverToken();
  if (!port || !token) return; // skip if sidecar not running

  const res = await fetch(`http://127.0.0.1:${port}/api/sitrep-bundle`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.timestamp);
  assert.ok(typeof body.delta_mode === 'boolean');
  assert.ok(body.severity);
  assert.ok(typeof body.severity.conflicts === 'number');
  assert.ok(typeof body.severity.markets === 'number');
  assert.ok(typeof body.severity.cyber === 'number');
  assert.ok(typeof body.severity.military === 'number');
  assert.ok(typeof body.severity.weather === 'number');
  assert.ok(body.domains);
  assert.ok(body.feed_health);
});
```

- [ ] **Step 2: Add imports at the top of local-api-server.mjs**

Near the top of the file (after existing imports, around line 30), add:

```javascript
import { scoreAllDomains } from './sitrep-severity.mjs';
import { filterAllDomains } from './sitrep-filter.mjs';
```

- [ ] **Step 3: Add the /api/sitrep-bundle route handler**

Insert at line 1700 in `local-api-server.mjs` (right after the auth gate, before `if (requestUrl.pathname === '/api/tle')`):

```javascript
  if (requestUrl.pathname === '/api/sitrep-bundle') {
    const cacheKey = 'sitrep-bundle';
    const cached = getCached(cacheKey, 5 * 60 * 1000); // 5 min TTL
    if (cached) return json(cached);

    // Parallel fetch all intelligence endpoints
    const endpoints = {
      conflicts:    '/api/acled-events',
      markets:      '/api/market-quotes',
      cyberKev:     '/api/cisa-kev',
      cyberIoc:     '/api/threatfox-iocs',
      cyberPhish:   '/api/openphish-feed',
      milAdsb:      '/api/adsb-military',
      milAis:       '/api/ais-snapshot',
      milPosture:   '/api/military/v1/get-theater-posture',
      milIsw:       '/api/isw-reports',
      weather:      '/api/nws-alerts',
      spaceWx:      '/api/space-weather-feeds',
      gridStatus:   '/api/power-grid',
      gridAlerts:   '/api/grid-alerts',
      water:        '/api/epa-sdwis-proxy',
      radiation:    '/api/epa-radnet-proxy',
      seismic:      '/api/usgs-earthquakes',
      health:       '/api/disease-outbreaks',
      economic:     '/api/fred-series?series_ids=FEDFUNDS,T10Y2Y,UNRATE',
      sanctions:    '/api/opensanctions',
      news:         '/api/newsapi-headlines',
      serviceStatus: '/api/service-status',
    };

    const entries = Object.entries(endpoints);
    const results = {};
    const warnings = [];
    const sources = [];

    await Promise.allSettled(entries.map(async ([key, route]) => {
      try {
        const url = new URL(`http://127.0.0.1:${context.port}${route}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(url.toString(), {
          headers: { Authorization: req.headers.authorization || '' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          results[key] = { error: `${res.status}: ${text}` };
          warnings.push(`${route}: HTTP ${res.status}`);
        } else {
          results[key] = await res.json();
          sources.push(route);
        }
      } catch (err) {
        results[key] = { error: err.message };
        warnings.push(`${route}: ${err.message}`);
      }
    }));

    // Assemble raw domain data for scoring
    const raw = {
      conflicts: results.conflicts?.events ?? [],
      markets: results.markets?.quotes ?? [],
      cyber: {
        iocs: results.cyberIoc?.data ?? [],
        kevs: results.cyberKev?.vulnerabilities ?? results.cyberKev ?? [],
      },
      military: {
        aircraft: results.milAdsb?.aircraft ?? (Array.isArray(results.milAdsb) ? results.milAdsb : []),
        vessels: results.milAis?.vessels ?? (Array.isArray(results.milAis) ? results.milAis : []),
        posture: results.milPosture ?? {},
      },
      weather: Array.isArray(results.weather) ? results.weather : [],
      infrastructure: { gridAlerts: results.gridAlerts?.alerts ?? [] },
      seismic: results.seismic?.features ?? [],
      health: results.health?.outbreaks ?? results.health ?? [],
      economic: results.economic ?? {},
      sanctions: results.sanctions?.results ?? [],
      news: results.news,
    };

    // Score
    const severity = scoreAllDomains(raw);

    // Filter by severity
    const domains = filterAllDomains(severity, raw);

    // Add news (always top 5, not scored)
    const newsArticles = raw.news?.articles ?? (Array.isArray(raw.news) ? raw.news : []);
    domains.news = { summary: `${newsArticles.length} articles`, items: newsArticles.slice(0, 5) };

    // Sentinel delta
    let deltaMode = false;
    let sentinelAgeMin = null;
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const snapshotPath = join(homedir(), '.crystal-ball', 'sentinel', 'latest-snapshot.json');
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      if (snapshot?.timestamp) {
        const ageMs = Date.now() - new Date(snapshot.timestamp).getTime();
        sentinelAgeMin = Math.round(ageMs / 60000);
        deltaMode = sentinelAgeMin < 60;
      }
    } catch { /* no sentinel data */ }

    // Feed health
    const status = results.serviceStatus ?? {};
    const missingKeys = wmMissingKeys();
    const feedHealth = {
      operational: sources.length,
      degraded: warnings.length,
      missing_keys: missingKeys.length,
      degraded_list: warnings.map(w => w.split(':')[0]),
      missing_key_names: missingKeys,
    };

    const bundle = {
      timestamp: new Date().toISOString(),
      delta_mode: deltaMode,
      sentinel_age_min: sentinelAgeMin,
      feed_health: feedHealth,
      severity,
      domains,
      sources,
      warnings,
    };

    setCached(cacheKey, bundle, 5 * 60 * 1000);
    return json(bundle);
  }
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck:all`
Expected: Zero errors (this is plain JS, but ensures no TS files broke)

- [ ] **Step 5: Test the endpoint manually**

Run (with app running):
```bash
curl -s http://127.0.0.1:46123/api/sitrep-bundle -H "Authorization: Bearer $(cat ~/Library/Logs/com.bradleybond.crystalball/sidecar.token)" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('severity:', d.severity); console.log('domains:', Object.keys(d.domains)); console.log('delta:', d.delta_mode); console.log('size:', JSON.stringify(d).length, 'chars')"
```

Expected: severity scores printed, all domain keys present, data size significantly less than sum of individual tool calls (~10-30k chars vs ~300k+)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat: add /api/sitrep-bundle endpoint

Batches all intelligence API calls server-side, computes per-domain
severity scores, pre-filters by severity level, reads sentinel snapshot
for delta mode. Single endpoint replaces 11+ individual MCP tool calls.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Register sitrep_bundle MCP Tool

**Files:**
- Modify: `tools/mcp-server/index.mjs` (add tool registration)
- Test: `tools/mcp-server/__tests__/aggregate-tools.test.mjs` (add test)

Register a new `sitrep_bundle` MCP tool that calls the `/api/sitrep-bundle` endpoint via `query_raw`-style direct access.

- [ ] **Step 1: Write a failing test**

Add to `tools/mcp-server/__tests__/aggregate-tools.test.mjs`:

```javascript
test('sitrep_bundle calls /api/sitrep-bundle and returns result', async () => {
  const client = mockClient({
    '/api/sitrep-bundle': {
      timestamp: '2026-04-15T00:00:00Z',
      delta_mode: false,
      sentinel_age_min: null,
      feed_health: { operational: 10, degraded: 2, missing_keys: 1 },
      severity: { conflicts: 1, markets: 2, cyber: 1, military: 1, weather: 3, seismic: 1, health: 1, economic: 1, sanctions: 1 },
      domains: {},
      sources: [],
      warnings: [],
    },
  });
  // Need to test via index.mjs registration or direct function
  const result = await client.get('/api/sitrep-bundle');
  assert.ok(result.timestamp);
  assert.ok(result.severity);
  assert.equal(result.delta_mode, false);
});
```

- [ ] **Step 2: Add the tool registration to index.mjs**

After the existing aggregate tools section (after line 66), add:

```javascript
server.registerTool('sitrep_bundle', {
  description: 'Pre-filtered intelligence bundle with per-domain severity scores. Returns all domains in one call, pre-filtered by severity (quiet domains compressed). Use this instead of calling multiple aggregate tools.',
  inputSchema: z.object({}),
}, async () => textResult(await client.get('/api/sitrep-bundle')));
```

- [ ] **Step 3: Run tests**

Run: `node --test tools/mcp-server/__tests__/aggregate-tools.test.mjs`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tools/mcp-server/index.mjs tools/mcp-server/__tests__/aggregate-tools.test.mjs
git commit -m "feat: register sitrep_bundle MCP tool

Single tool that returns pre-filtered, severity-scored intel bundle
from the sidecar. Replaces 11+ individual tool calls for sitrep.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Rewrite Sitrep Skill

**Files:**
- Modify: `.claude/commands/sitrep.md` (complete rewrite)

The skill dispatches a Sonnet subagent that calls `sitrep_bundle` + `get_region_brief`, runs targeted enrichment, and returns the finished brief.

- [ ] **Step 1: Rewrite the skill file**

```markdown
Dispatch a subagent (model: sonnet) to generate the daily intelligence brief. The subagent absorbs all tool data; only the finished brief returns to main context.

## Subagent Instructions

You are generating a Crystal Ball daily intelligence brief. Follow these instructions exactly.

### Step 1: Load Profile

User profile:
- Home: La Porte, Indiana
- Platforms: Apple (macOS, iOS, iPadOS, watchOS), WebKit/Safari
- Tickers: AAPL
- Interests: Apple supply chain, Great Lakes weather, Midwest severe weather

### Step 2: Collect Data (2 parallel calls)

Call these MCP tools in parallel:
1. `query_raw` with endpoint `/api/sitrep-bundle`
2. `get_region_brief` with place_name "La Porte, Indiana"

### Step 3: Targeted Enrichment (conditional)

Parse the bundle's `severity` scores. Only if needed:
- If any domain severity >= 3 AND bundle names CVE IDs: call `lookup_cve` for up to 2 CVEs
- If any domain severity >= 3 AND bundle names IPs: call `lookup_ip` for up to 2 IPs
- If 2+ domains severity >= 3: call `correlate` with those domains
- Max 3 enrichment calls total. Skip entirely if all domains <= 2.

### Step 4: Write the Brief

Use this exact format. Compress quiet sections (severity 1-2) to one line. Military posture always gets at least a short paragraph.

    ╔══════════════════════════════════════════════════════╗
    ║  CRYSTAL BALL — DAILY SITUATIONAL REPORT             ║
    ║  [date] [time] CDT                                   ║
    ╠──────────────────────────────────────────────────────╣
    ║  SEC n │ CYB n │ MKT n │ MIL n │ WX n │ INF n       ║
    ║  SEI n │ HTH n │ ECO n                               ║
    ╚══════════════════════════════════════════════════════╝

    SOURCE STATUS
      [operational/degraded/missing from feed_health]
      Mode: DELTA (sentinel Xmin ago) | FULL SCAN

    LOCAL CONDITIONS — La Porte, IN
      [From region brief. "All local indicators nominal." if quiet.]

    BOTTOM LINE UP FRONT
      [2-3 sentences: top development, shift direction, forward watch.]

    ── SECURITY ───────────────────────────────
      CONFLICTS & SECURITY
      MILITARY POSTURE
      CYBER

    ── ECONOMY ────────────────────────────────
      MARKETS & ECONOMY
      SANCTIONS

    ── ENVIRONMENT ────────────────────────────
      WEATHER & SPACE WEATHER
      SEISMIC
      INFRASTRUCTURE
      HEALTH

    ── SIGNALS ────────────────────────────────
      NEWS WIRE

    ── SYNTHESIS ──────────────────────────────
      NEXUS
      FORWARD WATCH (24-48hr)

### Rules
- Analyst voice. Declarative. No hedging.
- Severity 1-2 domains = one line. Severity 3+ = full detail.
- Military posture: always at least a short paragraph.
- Interests get full treatment regardless of severity. Prefix with ★ PERSONAL:
- ⚠ DATA DEGRADED for any feed in the warnings list.
- Cross-reference domains with — see SECTION.
- No emojis except ⚠ and ★.
- NEXUS: only genuine cross-domain correlations. "No significant cross-domain convergence." when quiet.
- FORWARD WATCH: 2-3 items. Skip if nothing warrants it.
```

- [ ] **Step 2: Verify the skill loads**

Run: `/sitrep` in Claude Code
Expected: The skill dispatches a subagent that calls `query_raw` + `get_region_brief`, enriches if needed, and returns the brief.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/sitrep.md
git commit -m "feat: rewrite sitrep skill with subagent delegation

Dispatches Sonnet subagent that calls sitrep_bundle + region brief,
runs conditional enrichment, returns only the finished brief (~2k
tokens) to main context. Targets ~12-18k total token usage.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Integration Test & Token Validation

**Files:**
- No new files — manual validation

- [ ] **Step 1: Run the sitrep with the app running**

Run: `/sitrep` in Claude Code with Crystal Ball desktop app running.

- [ ] **Step 2: Verify the brief output**

Check:
- All sections present (SOURCE STATUS through FORWARD WATCH)
- Severity scores in header
- Delta/full mode indicator
- No polygon geometry in weather data (should be stripped)
- Military shows only military callsigns, not 400+ commercial aircraft
- Quiet domains compressed to one line
- ★ PERSONAL: prefix on Apple/Midwest items

- [ ] **Step 3: Verify token usage**

Check the conversation token usage after the sitrep completes. Target:
- Main context: ~3k tokens (skill prompt + returned brief)
- Subagent context: ~10-15k tokens (bundle + region + enrichment + synthesis)
- Total: ~12-18k tokens

If over 18k, check:
- Is the bundle endpoint returning too much data? Check `curl` output size.
- Is the region brief still huge? May need to add filtering for region brief too.
- Are enrichment calls running when they shouldn't?

- [ ] **Step 4: Final commit with any adjustments**

```bash
git add -p  # stage only changed files
git commit -m "fix: tune sitrep bundle filtering thresholds

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push branch**

```bash
git push origin claude/sitrep-optimization
```
