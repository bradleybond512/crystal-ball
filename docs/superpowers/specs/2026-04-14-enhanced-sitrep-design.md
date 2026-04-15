# Enhanced Sitrep — Design Spec

**Date:** 2026-04-14
**Scope:** Redesign the `/sitrep` Claude Code skill from a basic data dump into a full-spectrum presidential-style daily intelligence brief with analyst narrative voice.

## Vision

Morning weather report meets grand strategy battlefield briefing. A single terminal-native markdown brief that gives the user complete situational awareness — local conditions at home, global security posture, economic signals, infrastructure status, and cross-domain correlation — every morning.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Delivery | Terminal-native markdown | Scan fast, no context switch |
| Voice | Analyst — declarative, connecting dots | "Senior analyst wrote this" feel |
| Quiet sections | Compress to one line, never omit | Eye learns the shape |
| Cross-domain correlation | Inline notes + closing Nexus section | Maximum situational awareness |
| Data sources | All 20 MCP tools utilized | Full-spectrum intelligence |
| Local conditions | Filtered from global data via home location | Personal relevance |
| Degraded data | Source status block + inline markers | Full transparency |
| Home location | Read from memory file, passed to `get_region_brief` | Works outside browser context |

## Brief Structure

```
╔══════════════════════════════════════════════════════╗
║  CRYSTAL BALL — DAILY SITUATIONAL REPORT             ║
║  2026-04-14 0730 EDT                                 ║
╚══════════════════════════════════════════════════════╝

SOURCE STATUS
  17/19 feeds operational · 2 degraded (AIS, FRED)
  ⚠ Missing API keys: VULNERS

LOCAL CONDITIONS — La Porte, IN
  54°F · Overcast · Wind NW 12mph · Humidity 68%
  ⚠ NWS: Lake Effect Snow Advisory until 1800 EST
  Grid: MISO nominal · No EPA advisories
  Nearest seismic: none within 500km
  No local cyber or health advisories.

BOTTOM LINE UP FRONT
  Two-to-three declarative sentences. The single most important
  development, what shifted overnight, and one forward-looking
  watch item.

── SECURITY ───────────────────────────────────────────

CONFLICTS & SECURITY
  [Analyst narrative on active conflicts from get_sitrep +
   search_conflicts. Elevated regions get detail, quiet
   theaters get one line.]

MILITARY POSTURE
  [Tracked aircraft, naval movements, theater assessments
   from get_military_posture. Named assets enriched via
   lookup_flight / lookup_vessel in Phase 2.]

THREAT LANDSCAPE
  [ACLED + OREF + LiveUAMap convergence from
   get_threat_landscape.]

CYBER
  [IOCs, CISA KEVs, phishing/malware trends, OTX pulses
   from get_cyber_intel. Specific CVEs enriched via
   lookup_cve, suspicious IPs via lookup_ip.]
  ★ PERSONAL: CVE-2026-XXXX — WebKit use-after-free,
    actively exploited. Patch available in iOS 19.4.1.
  ↳ Note: inline cross-reference when cyber connects to
    another domain (e.g., ICS targeting → INFRASTRUCTURE)

── ECONOMY ────────────────────────────────────────────

MARKETS & ECONOMY
  [Indices, crypto, ETF flows, Fear & Greed, WSB sentiment
   from get_market_overview. Fed funds rate, yield curve,
   unemployment from get_economic_data. Notable 8-Ks from
   get_sec_filings.]

SANCTIONS
  [Recent sanctions activity from get_sanctions. Specific
   entities enriched on signal.]

── ENVIRONMENT ────────────────────────────────────────

WEATHER & SPACE WEATHER
  [Global conditions for 28 cities, NWS alerts, DONKI solar
   events, NOAA space weather from get_weather_environment.]

SEISMIC
  [Significant quakes from get_earthquakes. M5.5+ noted,
   M6.5+ highlighted. Proximity to home location noted.]

INFRASTRUCTURE
  [Power grid status, grid alerts, EPA water quality,
   radiation monitors, USGS water from
   get_infrastructure_status.]
  ⚠ DATA DEGRADED — [feed name] if applicable

HEALTH
  [Active WHO outbreaks, ReliefWeb situation reports from
   get_disease_outbreaks.]

── SIGNALS ────────────────────────────────────────────

NEWS WIRE
  [Top 5-10 headlines from search_news — DoD, NATO,
   NewsAPI, NewsData. Sourced and timestamped.]

── SYNTHESIS ──────────────────────────────────────────

NEXUS
  Cross-domain correlations when they exist. Examples:
  - Oil spike + Gulf military movement = supply chain risk
  - Cyber IOCs targeting energy + grid alerts = infrastructure convergence
  - Earthquake in chip region + market moves = supply disruption

  When no correlations: "No significant cross-domain
  convergence detected."
```

## Execution Phases

### Phase 1 — Collection (parallel fan-out)

All 16 calls fire simultaneously with `summary_only: true` where supported:

```
check_feed_health
get_sitrep              (summary_only: true)
get_threat_landscape    (summary_only: true)
get_military_posture    (summary_only: true)
get_cyber_intel         (summary_only: true)
get_market_overview     (summary_only: true)
get_economic_data       (series: fed_funds, yield_curve, unemployment)
get_weather_environment (summary_only: true)
get_earthquakes         (summary_only: true)
get_infrastructure_status (summary_only: true)
get_disease_outbreaks   (summary_only: true)
get_sanctions           (summary_only: true)
search_conflicts        (summary_only: true)
get_region_brief        (place_name: "La Porte, Indiana")
search_news             (limit: 10)
get_sec_filings         (limit: 5)
```

### Phase 2 — Triage & Enrichment

Two-layer deep dive on signal only:

**Layer 1 — Aggregate re-call:** For any aggregate tool that returned elevated/critical indicators, re-call with `limit: 20` and no `summary_only` to get full detail.

**Layer 2 — Granular enrichment:** When Phase 1 names specific entities, drill down:

| Phase 1 signal | Enrichment tool |
|---|---|
| Military aircraft flagged | `lookup_flight` (callsign/hex) |
| Naval vessel movement | `lookup_vessel` (MMSI/name) |
| New CVEs surfaced | `lookup_cve` (CVE ID) |
| Suspicious IPs in IOCs | `lookup_ip` (IP address) |
| Sanctions entity named | `get_sanctions` (entity search) |
| Regional conflict escalation | `search_conflicts` (country/date filter) |
| Market move tied to company | `get_sec_filings` (filtered search) |

Quiet domains skip Phase 2 entirely — their Phase 1 summary is sufficient.

### Phase 3 — Synthesis

Write the brief following these rules:

1. **SOURCE STATUS** — from `check_feed_health`. Count operational vs degraded feeds. List missing API keys.
2. **LOCAL CONDITIONS** — filter global data through home location coordinates returned by `get_region_brief`:
   - Weather from `get_weather_environment` nearest to home coords
   - NWS alerts for the area
   - Grid status for the local operator (MISO for La Porte, IN)
   - Nearest seismic activity from `get_earthquakes` within ~500km
   - Relevant cyber/health advisories if any target the region
   - Compress to "All local indicators nominal" on quiet days
3. **BLUF** — 2-3 sentences: most important development, overnight shift, forward watch item
4. **Section writing:**
   - Lead with status assessment, then analyst narrative if warranted
   - Quiet sections: single line (e.g., "Markets: steady, no significant moves")
   - Active sections: analyst paragraph connecting the data
   - Inline cross-references: `↳ Note:` or `— see SECTION` when domains connect
   - Degraded sections: `⚠ DATA DEGRADED — [feed name]` inline
5. **NEWS WIRE** — top 5-10 headlines, sourced, no editorializing
6. **NEXUS** — explicit cross-domain correlations grounded in the data. Only when genuine connections exist. "No significant cross-domain convergence detected" when quiet.

## Narrative Rules

- **Analyst voice:** Declarative sentences connecting data points. No hedging, no filler. "Baltic naval activity elevated for the third day" not "It appears that there may be increased activity."
- **Signal-proportional density:** Sections expand and contract based on what's happening. A calm day might be 40 lines. A crisis day could be 150.
- **Honest uncertainty:** If data is degraded or a correlation is speculative, say so. Never invent connections.
- **Personal relevance:** Items matching the user profile get a `★ PERSONAL:` prefix to stand out. These are elevated even in otherwise quiet sections.
- **No emojis.** Section headers use ASCII box-drawing and Unicode symbols for warnings (⚠) and personal flags (★) only.
- **Timestamps** in the user's local timezone.

## User Profile

Stored in Claude memory file at:
`~/.claude/projects/-Users-bradleybond-Developer-crystalball/memory/user_sitrep_profile.md`

Contains personalization data the analyst voice uses to filter and prioritize:

```yaml
home_location: "La Porte, Indiana"
platforms:
  - Apple (macOS, iOS, iPadOS, watchOS)
  - WebKit / Safari
watchlist_tickers:
  - AAPL
interests:
  - Apple supply chain (TSMC, Foxconn, rare earth minerals)
  - Great Lakes region weather and infrastructure
  - Indiana/Midwest severe weather patterns
```

**How personalization applies per section:**

| Section | Personalization |
|---|---|
| LOCAL CONDITIONS | Home location weather, grid (MISO), nearby seismic/conflicts |
| CYBER | Flag CVEs/KEVs/IOCs targeting Apple, macOS, iOS, WebKit. Elevate these even if the section is otherwise quiet. |
| MARKETS & ECONOMY | Surface AAPL 8-Ks and any market moves affecting Apple. Note Apple supply chain disruptions (TSMC, Foxconn, rare earths). |
| INFRASTRUCTURE | Note Apple service outages if detected. Midwest grid and water status. |
| WEATHER | Great Lakes / Midwest severe weather highlighted. |
| NEXUS | Correlations involving Apple ecosystem or La Porte area get priority. |

Fallback: if memory file doesn't exist, skip personalization — run the brief as a generic global report.

## Tool Utilization Map

```
Phase 1 (sweep):       7 aggregate + 1 diagnostic + 8 granular = 16 parallel calls
Phase 2 (deep-dive):   aggregates re-called on elevated signal
Phase 2 (enrichment):  lookup_flight, lookup_vessel, lookup_ip, lookup_cve,
                       get_sanctions, search_conflicts, get_sec_filings
                       — triggered by entities found in Phase 1
Phase 3 (local):       get_region_brief coords filter earthquakes, weather,
                       infrastructure, conflicts for LOCAL CONDITIONS

All 20 Crystal Ball MCP tools have a defined role.
```

## File Changes

| File | Change |
|------|--------|
| `.claude/commands/sitrep.md` | Replace current 14-line skill with enhanced 3-phase brief |
| `~/.claude/projects/.../memory/user_sitrep_profile.md` | New — stores home location, platforms, tickers, interests |
