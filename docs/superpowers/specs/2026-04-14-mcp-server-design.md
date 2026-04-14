# Crystal Ball MCP Server — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

An MCP (Model Context Protocol) server that gives Claude CLI full access to Crystal Ball's live data without requiring a separate Claude API key. The server proxies requests to the running sidecar (`127.0.0.1:{port}`) and exposes 19 tools (7 aggregate + 12 granular) plus 4 slash commands for common workflows.

## Architecture

### Approach

Single Node.js MCP server using `@modelcontextprotocol/sdk`, communicating via stdio. Acts as a thin translation layer between Claude CLI and the Crystal Ball sidecar. No data logic duplication — all intelligence comes from the sidecar's existing 85+ endpoints.

### File Structure

| File | Purpose |
|------|---------|
| `tools/mcp-server/package.json` | Dependencies: `@modelcontextprotocol/sdk` |
| `tools/mcp-server/index.mjs` | MCP server entry point, tool/resource registration |
| `tools/mcp-server/sidecar-client.mjs` | HTTP client for sidecar: health check, auth, request helpers |
| `tools/mcp-server/tools/aggregate.mjs` | 7 aggregate tools (sitrep, threats, markets, etc.) |
| `tools/mcp-server/tools/granular.mjs` | 12 granular tools (search, lookup, query) |

### Slash Commands

| File | Trigger |
|------|---------|
| `.claude/commands/sitrep.md` | `/project:sitrep` |
| `.claude/commands/threat-brief.md` | `/project:threat-brief` |
| `.claude/commands/market-pulse.md` | `/project:market-pulse` |
| `.claude/commands/watch.md` | `/project:watch <region>` |

### Registration

Added to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "crystalball": {
      "command": "node",
      "args": ["tools/mcp-server/index.mjs"]
    }
  }
}
```

### Port & Token Discovery

The sidecar writes its port to a known file path (`LOCAL_API_PORT_FILE`). The MCP server reads this file on startup and on each request (in case the sidecar restarted). The bearer token is passed via `LOCAL_API_TOKEN` environment variable, or read from the macOS keychain (`crystal-ball` service).

Discovery sequence:
1. Read port from `~/Library/Application Support/com.bradleybond.crystalball/.api-port`
2. Read token from `LOCAL_API_TOKEN` env var, falling back to keychain lookup
3. Verify sidecar is reachable via `GET /api/health`
4. If unreachable, all tools return a clear error message

## Tools

### Aggregate Tools (7)

These combine multiple sidecar endpoints into high-level situational views.

#### `get_sitrep`

**Purpose:** Full situational snapshot — the "what's happening right now" tool.

**Sidecar routes:** `market-quotes`, `acled-events`, `nws-alerts`, `gdelt-intel`, `service-status`

**Returns:**
```typescript
{
  summary: string;          // 2-3 sentence overview
  appMode: string;          // current mode (peace/finance/war/disaster/ghost)
  conflicts: object[];      // top active conflicts
  markets: object;          // major index + crypto prices
  alerts: object[];         // active weather/hazard alerts
  serviceHealth: object;    // which data sources are up/down
}
```

#### `get_threat_landscape`

**Purpose:** Active threats across conflict, cyber, and crisis domains.

**Sidecar routes:** `acled-events`, `threatfox-iocs`, `cisa-kev`, `oref-alerts`, `liveuamap`

**Returns:**
```typescript
{
  summary: string;
  conflicts: object[];      // active armed conflicts with severity
  cyberThreats: object[];   // recent IOCs and KEVs
  crisisAlerts: object[];   // active crisis/alert feeds
}
```

#### `get_market_overview`

**Purpose:** Financial markets, sentiment, and macro signals.

**Sidecar routes:** `market-quotes`, `crypto-quotes`, `btc-etf-flows`, `macro-signals`, `fear-greed`, `wsb-sentiment`

**Returns:**
```typescript
{
  summary: string;
  indices: object;          // S&P 500, DJIA, NASDAQ, etc.
  crypto: object;           // BTC, ETH, major alts
  etfFlows: object;         // BTC ETF inflows/outflows
  sentiment: object;        // Fear & Greed, WSB sentiment
  macroRegime: object;      // FRED macro signals
}
```

#### `get_cyber_intel`

**Purpose:** Cyber threat intelligence roll-up.

**Sidecar routes:** `threatfox-iocs`, `cisa-kev`, `openphish-feed`, `urlhaus`, `otx-pulses`

**Returns:**
```typescript
{
  summary: string;
  iocs: object[];           // recent indicators of compromise
  kevs: object[];           // known exploited vulnerabilities
  phishing: object[];       // active phishing campaigns
  malwareUrls: object[];    // URLhaus hosting feeds
  threatPulses: object[];   // OTX community intel
}
```

#### `get_weather_environment`

**Purpose:** Weather, air quality, and space weather conditions.

**Sidecar routes:** `owm-current`, `nws-alerts`, `air-quality-proxy`, `donki-events`, `space-weather-feeds`

**Returns:**
```typescript
{
  summary: string;
  weather: object[];        // conditions for 28 global cities
  alerts: object[];         // NWS active alerts
  airQuality: object;       // AQI readings
  spaceWeather: object;     // solar flares, CMEs, Kp index
}
```

#### `get_infrastructure_status`

**Purpose:** Critical infrastructure health.

**Sidecar routes:** `power-grid`, `grid-alerts`, `epa-sdwis-proxy`, `epa-radnet-proxy`, `usgs-water-proxy`

**Returns:**
```typescript
{
  summary: string;
  powerGrid: object;        // grid status overview
  gridAlerts: object[];     // active outage alerts
  waterQuality: object;     // EPA SDWIS data
  radiation: object;        // RadNet monitoring
  waterResources: object;   // USGS gauges
}
```

#### `get_military_posture`

**Purpose:** Military activity across air, sea, and analysis domains.

**Sidecar routes:** `adsb-military`, `ais-snapshot`, `military/v1/get-theater-posture`, `isw-reports`

**Returns:**
```typescript
{
  summary: string;
  militaryFlights: object[];  // tracked military aircraft
  navalVessels: object[];     // AIS military vessel positions
  theaterPosture: object;     // combatant command posture
  iswAnalysis: object[];      // ISW latest reports
}
```

### Granular Tools (12)

These target specific data sources for focused lookups.

| Tool | Input | Sidecar Route | Returns |
|------|-------|---------------|---------|
| `search_conflicts` | `{ region?, country?, date_from?, date_to?, event_type? }` | `acled-events` | Filtered ACLED conflict events |
| `search_news` | `{ query?, category?, country? }` | `newsapi-headlines`, `newsdata-feed`, `dod-news`, `nato-news` | Combined news results |
| `lookup_ip` | `{ ip }` | `greynoise-lookup`, `abuseipdb-reports`, `ipinfo-lookup` | IP reputation + geolocation |
| `lookup_cve` | `{ query }` | `vulners-search` | CVE details and severity |
| `lookup_vessel` | `{ mmsi?, name? }` | `ais-snapshot` | Vessel position and details |
| `lookup_flight` | `{ hex?, callsign? }` | `adsb-military` | Military aircraft position |
| `get_sanctions` | `{ name?, country? }` | `opensanctions-search` | Sanctioned entities matching query |
| `get_economic_data` | `{ series_ids }` | `fred-series` | FRED economic time series |
| `get_sec_filings` | `{ query?, type? }` | `edgar-filings`, `edgar-search` | SEC EDGAR filings |
| `get_earthquakes` | `{ min_magnitude?, region? }` | Proxied USGS feed | Recent seismic events |
| `get_disease_outbreaks` | `{ region? }` | `disease-outbreaks`, `disease-intel` | Active disease events |
| `get_region_brief` | `{ place_name?, lat?, lon? }` | `geonames-search`, `acled-events`, `nws-alerts`, `owm-current` | Everything known about a location |

### Tool Response Format

Every tool returns a consistent shape:

```typescript
{
  summary: string;        // Human-readable overview (1-3 sentences)
  data: object;           // Structured data from sidecar
  sources: string[];      // Which sidecar routes contributed
  warnings?: string[];    // Sources that failed or were unavailable
  timestamp: string;      // ISO 8601 response time
  healthy: boolean;       // Whether sidecar was reachable
}
```

## Slash Commands

### `/project:sitrep` — Full Situational Report

```markdown
Use the Crystal Ball MCP tools to generate a comprehensive situational report.
Call get_sitrep, get_threat_landscape, and get_military_posture.
Synthesize into a brief with sections: Conflicts, Markets, Cyber, Military, Weather.
Flag anything at elevated or critical levels. Be concise — this is a daily brief.
```

### `/project:threat-brief` — Focused Threat Assessment

```markdown
Use Crystal Ball MCP tools to produce a focused threat assessment.
Call get_threat_landscape, get_cyber_intel, and get_infrastructure_status.
Identify the top 5 threats by severity. For each: what it is, who's affected,
trajectory (escalating/stable/de-escalating), and recommended watch items.
```

### `/project:market-pulse` — Markets Snapshot

```markdown
Use Crystal Ball MCP tools to produce a markets snapshot.
Call get_market_overview and get_economic_data with series_ids FEDFUNDS,WALCL,T10Y2Y.
Cover: major indices, crypto, sentiment, yield curve, Fed balance sheet.
Flag any significant moves (>2% equity, >5% crypto). One paragraph summary, then data.
```

### `/project:watch <region>` — Region-Focused Brief

```markdown
Use Crystal Ball MCP tools to produce a regional intelligence brief for: $ARGUMENTS
Call get_region_brief with the location, search_conflicts for the area,
search_news for recent coverage, and get_weather_environment for conditions.
Synthesize into: Security situation, recent events, infrastructure, weather, outlook.
```

## Error Handling

### Sidecar Not Running

Every tool checks sidecar health before making requests. If unreachable:

```typescript
{
  summary: "Crystal Ball is not running. Launch the app to enable data access.",
  data: {},
  sources: [],
  healthy: false,
  timestamp: "..."
}
```

### Partial Failures

Aggregate tools fire requests in parallel via `Promise.allSettled`. If some sources fail:
- Return data from successful sources
- Add failed sources to `warnings` array
- `summary` notes which sources were unavailable
- Never fail the entire tool because one feed is down

### Missing API Keys

When a sidecar route returns 403 (key not configured), the tool includes:

```typescript
// In the warnings array:
"virustotal: API key not configured — set VIRUSTOTAL_API_KEY in Crystal Ball settings"
```

### Rate Limiting

No additional rate limiting in the MCP server. The sidecar already enforces rate limits and circuit breakers on all upstream APIs. The MCP server trusts these protections.

### Timeouts

15-second timeout per sidecar HTTP request. Aggregate tools run requests in parallel so one slow source doesn't block the rest.

## Sidecar Client

### `sidecar-client.mjs`

Thin HTTP client wrapping `fetch`:

```typescript
// Core methods
async function checkHealth(): Promise<boolean>
async function get(route: string, params?: object): Promise<object>
async function post(route: string, body?: object): Promise<object>

// Port/token discovery
function discoverPort(): number      // reads from port file
function discoverToken(): string     // env var or keychain

// Parallel fetch helper
async function getAll(routes: string[]): Promise<Map<string, object>>
```

All requests include:
- `Authorization: Bearer {token}` header
- 15-second `AbortController` timeout
- JSON response parsing with error wrapping

## Testing

Tests use Node built-in test runner (`node:test`):

| Test File | Coverage |
|-----------|----------|
| `tools/mcp-server/__tests__/sidecar-client.test.mjs` | Port discovery, health check, auth header, timeout, error wrapping |
| `tools/mcp-server/__tests__/aggregate-tools.test.mjs` | Partial failure handling, response shape, summary generation |
| `tools/mcp-server/__tests__/granular-tools.test.mjs` | Input validation, parameter mapping, response shape |

Tests mock `fetch` to simulate sidecar responses without needing the app running.

## Out of Scope

- Writing data back to Crystal Ball (read-only for v1)
- MCP resources (dynamic resource URIs) — tools are simpler and sufficient
- Streaming/subscriptions — Claude CLI doesn't support MCP streaming yet
- Custom MCP prompts — slash commands serve this purpose
- Standalone mode (direct service imports without sidecar)
