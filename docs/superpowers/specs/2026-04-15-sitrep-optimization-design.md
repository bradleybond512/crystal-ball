# Sitrep Optimization Design Spec

**Date**: 2026-04-15
**Goal**: Reduce sitrep token usage from ~100k+ to ~3k in main context while enhancing output quality.

## Architecture: Hybrid Bundle Endpoint + Smart Skill

Three components working together:
1. **Sidecar bundle endpoint** (`/api/sitrep-bundle`) — batches all API calls server-side, computes severity scores, diffs against sentinel, pre-filters by severity
2. **Smart skill** (`.claude/commands/sitrep.md`) — dispatches subagent with enrichment decision tree and profile-driven density rules
3. **Subagent delegation** — isolates all MCP tool results from main context, returns only the finished brief

## Component 1: Sidecar Bundle Endpoint

### Route
`GET /api/sitrep-bundle`

### Internal Endpoints Called (parallel via Promise.allSettled)

| Domain | Endpoints |
|--------|-----------|
| conflicts | `/api/acled-events` |
| markets | `/api/market-quotes` |
| cyber | `/api/threatfox-iocs`, `/api/cisa-kev`, `/api/phishtank` |
| military | `/api/adsb-mil`, `/api/ais-vessels`, `/api/theater-posture` |
| weather | `/api/nws-alerts`, `/api/space-weather` |
| infrastructure | `/api/grid-status`, `/api/water-quality`, `/api/radiation` |
| seismic | `/api/earthquakes` |
| health | `/api/disease-outbreaks` |
| economic | `/api/fred-fallback` |
| sanctions | `/api/opensanctions` |
| news | `/api/news` |

All calls benefit from existing sidecar TTL cache (10-60min per endpoint).

### Severity Scoring

Per-domain score 1-5, computed deterministically server-side:

| Domain | Threshold Logic |
|--------|----------------|
| conflicts | 1=<5 events, 2=5-15, 3=15-30 or fatality events, 4=30+ or escalation, 5=mass casualty |
| markets | Reuse mode-manager thresholds: S&P>=2.5%, BTC>=5%, Oil>=4%, Gold>=2% each add +1 |
| cyber | 1=<5 new IOCs, 2=5-20, 3=20-50 or new KEV, 4=50+ or active campaign, 5=critical infra targeting |
| military | 1=baseline, 2=elevated aircraft/vessel count, 3=exercises detected, 4=force deployments, 5=posture shift |
| weather | 1=no alerts, 2=watches, 3=warnings, 4=severe/tornado, 5=extreme (hurricane, derecho) |
| infrastructure | 1=nominal, 2=minor outage, 3=regional outage, 4=multi-region, 5=widespread |
| seismic | 1=<M4, 2=M4-5.4, 3=M5.5-6.4, 4=M6.5-7.4, 5=M7.5+ or tsunami |
| health | 1=routine, 2=localized outbreak, 3=multi-country, 4=WHO alert, 5=pandemic indicator |
| economic | 1=stable, 2=minor moves, 3=yield curve shift or fed signal, 4=inversion + unemployment spike, 5=recession indicators |
| sanctions | 1=no new entries, 2=minor additions, 3=new designations, 4=major entity/country, 5=sweeping new regime |
| news | Not scored — used for NEWS WIRE section only |

### Sentinel Delta

- Reads `~/.crystal-ball/sentinel/latest-snapshot.json`
- If timestamp < 1hr old: returns `delta_mode: true` with only changed/appeared/disappeared items per domain
- If stale or missing: returns `delta_mode: false` with full data

### Pre-filtering by Severity

| Severity | Data Returned |
|----------|---------------|
| 1 | Count + one-line summary only, raw items stripped |
| 2-3 | Top 5 items |
| 4-5 | Full data, up to 20 items |

### Response Shape

```json
{
  "timestamp": "ISO",
  "delta_mode": true,
  "sentinel_age_min": 22,
  "feed_health": {
    "operational": 18,
    "degraded": 2,
    "missing_keys": 1,
    "degraded_list": ["feed_name"]
  },
  "severity": {
    "conflicts": 2, "markets": 4, "cyber": 1, "military": 2,
    "weather": 1, "infrastructure": 1, "seismic": 1, "health": 1, "economic": 3,
    "sanctions": 1
  },
  "domains": {
    "conflicts": { "summary": "...", "items": [], "delta": {} },
    "markets": { "summary": "...", "items": [], "delta": {} }
  },
  "sources": ["/api/..."],
  "warnings": ["endpoint: error message"]
}
```

## Component 2: Smart Skill

### Operating Modes

**Delta mode** (`delta_mode: true`): Brief framed as "changes since last sweep." Only elevated or changed domains get detail. BLUF focuses on what shifted.

**Full mode** (`delta_mode: false`): Full scan, all domains reported. Morning brief behavior.

### Tool Call Flow

Baseline: 2 MCP calls (bundle + region brief).

Enrichment decision tree:
```
For each domain where severity >= 3:
  If domain has named entities (CVE IDs, IPs, callsigns, MMSIs):
    Call appropriate lookup tool (max 2 enrichment calls)

If 2+ domains severity >= 3:
  Call correlate({ domains: [elevated_domains] })

If watchlists configured: call watchlist_check
If alert rules configured: call alert_check
```

Cap: max 4 enrichment calls beyond bundle + region. Quiet day = 2 calls. Active day = up to 6.

### Profile-Driven Output Density

- **Interest domains** (from profile): full paragraphs, entity details, forward analysis
- **Military posture**: always minimum short paragraph (user requirement — critical domain)
- **Non-interest at severity 1-2**: one line
- **Non-interest at severity 3+**: short paragraph (can't ignore elevation)
- `★ PERSONAL:` prefix on items matching interests regardless of severity

### Profile Fields

Read from `~/.claude/projects/-Users-bradleybond-Developer-crystalball/memory/user_sitrep_profile.md`:
- `home_location` — for region brief + local conditions
- `platforms` — for cyber relevance filtering (Apple/macOS/iOS/WebKit)
- `watchlist_tickers` — for market personalization
- `interests` — for density weighting

## Component 3: Subagent Delegation

### Flow

```
Main context (Opus)              Subagent (Sonnet)
───────────────────              ─────────────────
Read user profile (~200 tokens)
Dispatch subagent ──────────────► query_raw("/api/sitrep-bundle")
                                  get_region_brief(home_location)
                                  Parse severity, run enrichment tree
                                  Synthesize brief
◄── Return brief (~2k tokens) ──┘
Output to user
```

### Token Budget

| Component | Tokens |
|-----------|--------|
| Main context: skill prompt + profile + dispatch | ~1k |
| Main context: returned brief | ~2k |
| **Main context total** | **~3k** |
| Subagent: prompt + tool results + synthesis | ~15-30k (isolated) |

### Subagent Model

Sonnet — fast, cheap, sufficient for structured synthesis.

## Output Format

### Header with Severity Scores

```
╔══════════════════════════════════════════════════════╗
║  CRYSTAL BALL — DAILY SITUATIONAL REPORT             ║
║  [date] [time] [timezone]                            ║
╠──────────────────────────────────────────────────────╣
║  SEC 2 │ CYB 1 │ MKT 4 │ MIL 2 │ WX 1 │ INF 1     ║
║  SEI 1 │ HTH 1 │ ECO 3                              ║
╚══════════════════════════════════════════════════════╝
```

### Section Structure

```
SOURCE STATUS
  [operational/degraded/missing counts]
  Mode: DELTA (sentinel Xmin ago) | FULL SCAN

LOCAL CONDITIONS — [home city]

BOTTOM LINE UP FRONT

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
```

### Changes from Previous Format

- **Added**: Per-domain severity indicators in header
- **Added**: Delta/full mode indicator in source status
- **Added**: FORWARD WATCH section (24-48hr lookahead items)
- **Removed**: Separate THREAT LANDSCAPE section (absorbed into CONFLICTS + CYBER)

### Narrative Rules

1. Analyst voice. Declarative. No hedging or filler.
2. Quiet sections = one line. Elevated sections get full detail.
3. `★ PERSONAL:` prefix for items matching user profile interests.
4. `⚠ DATA DEGRADED — [feed]` inline for degraded sources.
5. Cross-reference linked domains with `— see SECTION`.
6. No emojis except `⚠` and `★`. User's local timezone throughout.
7. Military posture always gets at least a short paragraph.
8. NEXUS: only genuine cross-domain correlations. "No significant cross-domain convergence." when nothing links.
9. FORWARD WATCH: 2-3 forward-looking flags from trends/elevated domains. Skip if nothing warrants it.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src-tauri/sidecar/local-api-server.mjs` | Add `/api/sitrep-bundle` route |
| `.claude/commands/sitrep.md` | Rewrite skill with subagent + enrichment tree |
| `~/.claude/projects/.../memory/user_sitrep_profile.md` | No changes needed |

## Reusability

The `/api/sitrep-bundle` endpoint is designed to be useful beyond just the sitrep skill. Other skills (sentinel, threat-brief, market-pulse) could call it with query parameters to request only specific domain subsets in the future.
