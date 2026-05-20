# Crystal Ball MCP Pipeline

How Claude Code gathers real-time intelligence from Crystal Ball.

## Overview

Crystal Ball exposes its intelligence feeds to Claude Code through a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server. When you type `/sitrep` or ask Claude about a conflict zone, Claude calls MCP tools that query Crystal Ball's running sidecar, which fans out to dozens of upstream APIs and returns structured intelligence.

The pipeline has four layers:

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code                                            │
│  User types /sitrep or asks a question                  │
│  Claude decides which MCP tools to call                 │
└──────────────┬──────────────────────────────────────────┘
               │ stdio (JSON-RPC)
┌──────────────▼──────────────────────────────────────────┐
│  MCP Server (tools/mcp-server/)                         │
│  41 registered tools across 8 categories                │
│  Discovers sidecar port & token from disk               │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP GET/POST to 127.0.0.1:{port}
               │ Authorization: Bearer {token}
┌──────────────▼──────────────────────────────────────────┐
│  Sidecar (src-tauri/sidecar/local-api-server.mjs)       │
│  Node.js proxy on port 46123                            │
│  Routes requests to upstream APIs, caches responses     │
└──────────────┬──────────────────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────────────────┐
│  Upstream APIs                                          │
│  ACLED, ThreatFox, CISA, FRED, NWS, OpenSanctions,     │
│  ADS-B, AIS, USGS, WHO, SEC EDGAR, NewsAPI, ...        │
└─────────────────────────────────────────────────────────┘
```

## How Claude Code Discovers the Server

The MCP server is registered in `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "crystalball": {
      "type": "stdio",
      "command": "node",
      "args": ["tools/mcp-server/index.mjs"]
    }
  }
}
```

When Claude Code starts a session in this repo, it launches the MCP server as a child process and communicates over stdin/stdout using JSON-RPC. No network ports are opened for this connection.

## Authentication

The sidecar requires a bearer token on every request. The token is generated per-session and never leaves the local machine.

**Token lifecycle:**

1. **Tauri generates token** -- `generate_local_token()` in `src-tauri/src/main.rs` produces a random string at app launch.
2. **Token written to disk** -- saved to `~/Library/Logs/com.bradleybond.crystalball/sidecar.token` with `0o600` permissions (owner-only read/write).
3. **Token passed to sidecar** -- injected as the `LOCAL_API_TOKEN` environment variable when Tauri spawns the sidecar process.
4. **MCP server reads token from disk** -- `sidecar-client.mjs` reads the token file on each request (so it picks up restarts).
5. **Every request includes the token** -- `Authorization: Bearer {token}` header. The sidecar validates with timing-safe comparison.
6. **Token deleted on exit** -- Tauri removes the token file when the app closes.

**Port discovery** follows the same pattern: the sidecar writes its port to `sidecar.port` in the same log directory.

## MCP Tools

The server registers `41` tools across aggregate, granular, foundation, intelligence, stateful, analyst, diagnostic, and help categories.

### Aggregate Tools (broad awareness)

These call multiple sidecar endpoints in parallel and return a combined picture.

| Tool | What it returns | Sidecar endpoints |
|------|----------------|-------------------|
| `get_sitrep` | Top conflicts, market moves, weather alerts, service health | `market-quotes`, `acled-events`, `nws-alerts`, `service-status` |
| `get_threat_landscape` | Active threats across conflict, cyber, and crisis domains | `acled-events`, `threatfox-iocs`, `cisa-kev`, `oref-alerts`, `liveuamap` |
| `get_market_overview` | Indices, crypto, ETF flows, sentiment, macro signals | `market-quotes`, `crypto-quotes`, `btc-etf-flows`, `macro-signals`, `fear-greed`, `wsb-sentiment` |
| `get_cyber_intel` | IOCs, KEVs, phishing, malware URLs, threat pulses | `threatfox-iocs`, `cisa-kev`, `openphish-feed`, `urlhaus`, `otx-pulses` |
| `get_weather_environment` | Conditions for 28 cities, NWS alerts, space weather | `owm-current`, `nws-alerts`, `donki-events`, `space-weather-feeds` |
| `get_infrastructure_status` | Power grid, water quality, radiation, outage alerts | `power-grid`, `grid-alerts`, `epa-sdwis-proxy`, `epa-radnet-proxy`, `usgs-water-proxy` |
| `get_military_posture` | Tracked aircraft, naval vessels, theater posture, ISW analysis | `adsb-military`, `ais-snapshot`, `military/v1/get-theater-posture`, `isw-reports` |

### Granular Tools (targeted lookups)

| Tool | Parameters | Data source |
|------|-----------|-------------|
| `search_conflicts` | region, country, date_from, date_to, event_type | ACLED |
| `search_news` | query, category, country | NewsAPI, NewsData, DoD, NATO |
| `lookup_ip` | ip | GreyNoise + AbuseIPDB + IPinfo |
| `lookup_cve` | query | Vulners |
| `lookup_vessel` | mmsi, name | AIS |
| `lookup_flight` | hex, callsign | ADS-B |
| `get_sanctions` | name, country | OpenSanctions |
| `get_economic_data` | series_ids (e.g., "FEDFUNDS,WALCL") | FRED |
| `get_sec_filings` | query, type | SEC EDGAR |
| `get_earthquakes` | min_magnitude, region | USGS |
| `get_disease_outbreaks` | region | WHO, ReliefWeb |
| `get_region_brief` | place_name, lat, lon | Multi-source regional synthesis |

### Foundation and Intelligence Tools

| Tool | What it does |
|------|--------------|
| `query_raw` | Reads a specific sidecar endpoint with explicit parameters |
| `chain_query` | Runs a sequence of endpoint queries for a multi-step investigation |
| `compare_snapshots` | Compares two structured results for drift or meaningful changes |
| `correlate` | Looks for shared entities, regions, or timing across datasets |
| `trend` | Summarizes directional movement in repeated observations |
| `anomaly_scan` | Highlights outliers or unexpected values in current feed data |

### Stateful, Analyst, and Diagnostic Tools

| Tool | What it does |
|------|--------------|
| `watchlist_manage`, `watchlist_check` | Manage and evaluate local intelligence watchlists |
| `alert_rules_manage`, `alert_check` | Manage alert rules and run them against current feed state |
| `get_analyst_hypotheses`, `get_mode_forecast`, `get_analyst_accuracy` | Inspect analyst-layer predictions, mode forecasts, and measured accuracy |
| `get_hot_entities`, `submit_hypothesis_feedback`, `dismiss_hypothesis`, `run_skeptic_now` | Review important entities, tune hypothesis feedback, and trigger skeptic review |
| `check_feed_health`, `sitrep_bundle`, `get_reasoning_debug_log`, `get_reasoning_metrics`, `help` | Health checks, bundled intelligence, reasoning diagnostics, metrics, and tool help |

### Response Format

Every tool returns the same envelope:

```json
{
  "summary": "Human-readable summary of findings",
  "data": { },
  "sources": ["/api/acled-events", "/api/market-quotes"],
  "warnings": ["threatfox-iocs: timed out"],
  "timestamp": "2026-04-14T12:00:00.000Z",
  "healthy": true
}
```

Partial failures are non-blocking: if one endpoint times out, the remaining data is still returned with the failure noted in `warnings`.

## Slash Commands

Slash commands compose MCP tool calls into intelligence products. These are defined in `.claude/commands/` and include `/sitrep`, `/watch`, `/threat-brief`, `/market-pulse`, `/alerts`, `/correlate`, `/cross-check`, `/sentinel`, and `/watchlist` in Claude Code.

### `/sitrep` -- Daily Intelligence Brief

Calls `get_sitrep` + `get_threat_landscape` + `get_military_posture`. Claude synthesizes results into sections: Conflicts, Markets, Cyber, Military, Weather. Anything at elevated or critical levels is flagged.

### `/watch <location>` -- Regional Brief

Calls `get_region_brief` + `search_conflicts` + `search_news` + `get_weather_environment` for a specific location (e.g., `/watch Strait of Hormuz`). Output: security situation, recent events, infrastructure, weather, outlook.

### `/threat-brief` -- Threat Assessment

Calls `get_threat_landscape` + `get_cyber_intel` + `get_infrastructure_status`. Identifies top 5 threats by severity with trajectory (escalating/stable/de-escalating) and recommended watch items.

### `/market-pulse` -- Markets Snapshot

Calls `get_market_overview` + `get_economic_data` (FEDFUNDS, WALCL, T10Y2Y). Covers major indices, crypto, sentiment, yield curve, Fed balance sheet. Flags significant moves (>2% equity, >5% crypto).

## Sidecar Client

The MCP server talks to the sidecar through `tools/mcp-server/sidecar-client.mjs`:

- **Port discovery**: reads `~/Library/Logs/com.bradleybond.crystalball/sidecar.port`
- **Token discovery**: reads `~/Library/Logs/com.bradleybond.crystalball/sidecar.token`
- **Request timeout**: 15 seconds per request
- **Health check timeout**: 3 seconds
- **Parallel fetching**: `getAll()` uses `Promise.allSettled()` so one slow endpoint doesn't block others
- **Graceful degradation**: if Crystal Ball isn't running, tools return `{ error: "Crystal Ball is not running...", healthy: false }` instead of crashing

## Sidecar Caching

The sidecar caches upstream API responses in memory:

| Endpoint type | Typical TTL |
|--------------|-------------|
| Market quotes | 1 min |
| ACLED conflicts | 5 min |
| Weather | 10 min |
| Cyber IOCs | 15 min |
| Static reference data | 60 min |

Cache entries are evicted when stale or when the cache exceeds 200 entries.

## End-to-End Example

User types `/sitrep` in Claude Code:

1. Claude Code reads `.claude/commands/sitrep.md` and expands the prompt.
2. Claude decides to call three MCP tools: `get_sitrep`, `get_threat_landscape`, `get_military_posture`.
3. The MCP server receives the tool invocations over stdio.
4. For each tool, the sidecar client reads port and token from disk, then fires parallel HTTP GETs to `http://127.0.0.1:46123/api/...` with the bearer token.
5. The sidecar validates the token, routes each request to its handler, which fetches from upstream APIs (ACLED, ThreatFox, ADS-B, etc.) or returns cached data.
6. JSON responses flow back through the sidecar client to the MCP server, which wraps them in MCP text content.
7. Claude receives all three tool results and synthesizes a brief: "SITREP -- 14 Apr 2026 -- Conflicts: ... Markets: ... Cyber: ... Military: ... Weather: ..."
8. The user sees a formatted intelligence brief in their terminal.

## Prerequisites

- **Crystal Ball must be running.** The MCP server reads port/token files that only exist while the app is open. If the app is closed, tools return a clear error message.
- **API keys must be configured.** The sidecar proxies requests to upstream APIs using keys stored in the macOS Keychain. Missing keys cause individual endpoints to return empty data (noted in `warnings`), but don't block the overall response.
- **Node.js >= 20** is required by the MCP server.

## File Reference

| File | Role |
|------|------|
| `.mcp.json` | Registers the MCP server with Claude Code |
| `tools/mcp-server/index.mjs` | Server entry point, 41 tool registrations |
| `tools/mcp-server/sidecar-client.mjs` | Port/token discovery, HTTP client |
| `tools/mcp-server/tools/aggregate.mjs` | 7 aggregate tool implementations |
| `tools/mcp-server/tools/granular.mjs` | 12 granular tool implementations |
| `tools/mcp-server/tools/foundation.mjs` | Raw querying, chaining, and snapshot comparison |
| `tools/mcp-server/tools/intelligence.mjs` | Correlation, trend, and anomaly helpers |
| `tools/mcp-server/tools/stateful.mjs` | Watchlist and alert-rule tools |
| `tools/mcp-server/tools/analyst.mjs` | Analyst hypothesis, forecast, and feedback tools |
| `tools/mcp-server/tools/help.mjs` | Tool help and usage guidance |
| `src-tauri/sidecar/local-api-server.mjs` | Node.js sidecar, API proxy |
| `src-tauri/src/main.rs` | Token generation, sidecar launch |
| `.claude/commands/sitrep.md` | `/sitrep` slash command definition |
| `.claude/commands/watch.md` | `/watch` slash command definition |
| `.claude/commands/threat-brief.md` | `/threat-brief` slash command definition |
| `.claude/commands/market-pulse.md` | `/market-pulse` slash command definition |
