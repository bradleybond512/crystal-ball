Generate a full-spectrum presidential-style daily intelligence brief using all Crystal Ball MCP tools, personalized to the user's profile.

---

## Phase 0 — User Profile

Read `~/.claude/projects/-Users-bradleybond-Developer-crystalball/memory/user_sitrep_profile.md` to load:

- **home_location** (e.g., "La Porte, Indiana")
- **platforms** (e.g., Apple macOS/iOS/iPadOS/watchOS, WebKit/Safari)
- **watchlist_tickers** (e.g., AAPL)
- **interests** (e.g., Apple supply chain, Great Lakes weather, Midwest severe weather)

If the file does not exist, skip personalization and run as a generic global brief.

---

## Phase 1 — Collection

Call all 16 aggregate MCP tools **in parallel**, using `summary_only: true` where supported:

| Tool | Parameters |
|------|------------|
| `check_feed_health` | _(none)_ |
| `get_sitrep` | `summary_only: true` |
| `get_threat_landscape` | `summary_only: true` |
| `get_military_posture` | `summary_only: true` |
| `get_cyber_intel` | `summary_only: true` |
| `get_market_overview` | `summary_only: true` |
| `get_economic_data` | `series: fed_funds, yield_curve, unemployment` |
| `get_weather_environment` | `summary_only: true` |
| `get_earthquakes` | `summary_only: true` |
| `get_infrastructure_status` | `summary_only: true` |
| `get_disease_outbreaks` | `summary_only: true` |
| `get_sanctions` | `summary_only: true` |
| `search_conflicts` | `summary_only: true` |
| `get_region_brief` | `place_name:` _(from user profile home_location)_ |
| `search_news` | `limit: 10` |
| `get_sec_filings` | `limit: 5` |

---

## Phase 2 — Triage & Enrichment

### Layer 1 — Escalation Drill-Down

For any aggregate tool that returned **elevated or critical** indicators in Phase 1, re-call that tool with `limit: 20` and **without** `summary_only` to get full detail. Quiet domains skip this layer entirely.

### Layer 2 — Entity Enrichment

When Phase 1 or Layer 1 names specific entities, enrich with granular lookup tools:

| Signal | Tool | Key Parameter |
|--------|------|---------------|
| Military aircraft | `lookup_flight` | callsign or hex |
| Naval vessels | `lookup_vessel` | MMSI or name |
| CVEs | `lookup_cve` | CVE ID |
| Suspicious IPs | `lookup_ip` | IP address |
| Sanctions entities | `get_sanctions` | entity search |
| Regional conflict escalation | `search_conflicts` | country/date filter |
| Market-moving company | `get_sec_filings` | filtered search |

Only enrich entities that are actually named in the data. Do not fabricate lookups.

---

## Phase 3 — Synthesis

Write the brief using this exact fixed structure. Never omit a section — compress quiet sections to one line instead.

```
╔══════════════════════════════════════════════════════╗
║  CRYSTAL BALL — DAILY SITUATIONAL REPORT             ║
║  [date] [time] [timezone]                            ║
╚══════════════════════════════════════════════════════╝

SOURCE STATUS
  [count] feeds operational, [count] degraded, [count] missing API keys
  Degraded: [list if any]

LOCAL CONDITIONS — [home city from profile]
  [Weather, grid status (MISO for La Porte IN), seismic within ~500km,
   NWS alerts, local cyber/health relevance. Compress to
   "All local indicators nominal." on quiet days.]

BOTTOM LINE UP FRONT
  [2-3 sentences: most important development, overnight shift direction,
   forward watch item.]

── SECURITY ───────────────────────────────────────────
  CONFLICTS & SECURITY
  [Active conflicts, escalation/de-escalation, casualty events,
   peace talks, territorial changes.]

  MILITARY POSTURE
  [Force movements, exercises, deployments, strategic signaling.
   Include lookup_flight / lookup_vessel results if enriched.]

  THREAT LANDSCAPE
  [Terrorism, WMD, hybrid warfare, state-sponsored activity.]

  CYBER
  [Active campaigns, CVEs, IOCs, ransomware, APT activity.
   Include lookup_cve / lookup_ip results if enriched.]

── ECONOMY ────────────────────────────────────────────
  MARKETS & ECONOMY
  [Indices, commodities, crypto, FX, yield curve, fed funds,
   unemployment, SEC filings. Watchlist tickers called out.]

  SANCTIONS
  [New designations, enforcement actions, evasion patterns.]

── ENVIRONMENT ────────────────────────────────────────
  WEATHER & SPACE WEATHER
  [Severe weather, tropical systems, space weather (Kp, solar flares),
   seasonal outlook.]

  SEISMIC
  [Significant earthquakes (M5+), tsunami alerts, volcanic activity.]

  INFRASTRUCTURE
  [Power grid, internet, transport disruptions, NOTAM clusters.]

  HEALTH
  [Disease outbreaks, WHO alerts, pandemic indicators.]

── SIGNALS ────────────────────────────────────────────
  NEWS WIRE
  [Top stories from search_news not covered above.
   Brief bullets, source attributed.]

── SYNTHESIS ──────────────────────────────────────────
  NEXUS
  [Explicit cross-domain correlations where genuine connections exist.
   Examples: oil spike + Gulf military movement = supply chain risk;
   cyber IOCs targeting energy + grid alerts = infrastructure convergence.
   "No significant cross-domain convergence detected." when quiet.]
```

---

## Narrative Rules

Follow these rules strictly when writing the brief:

1. **Analyst voice.** Declarative sentences. Connect dots. No hedging, no filler, no "it remains to be seen."
2. **Signal-proportional density.** Quiet sections compress to one line (e.g., "Sanctions: no new designations or enforcement actions."). Never omit a section.
3. **Inline cross-references.** Use `↳ Note:` or `— see SECTION` when domains connect (e.g., a cyber campaign targeting energy infrastructure cross-references both CYBER and INFRASTRUCTURE).
4. **Degraded feeds.** Mark affected sections with `⚠ DATA DEGRADED — [feed name]` inline. Do not silently omit data.
5. **Personal relevance.** Prefix items matching the user profile with `★ PERSONAL:` — Apple CVEs, watchlist ticker filings, Midwest severe weather, home-area items. Elevate these even in otherwise quiet sections.
6. **SOURCE STATUS.** Count operational vs degraded feeds from `check_feed_health`. List any missing API keys.
7. **LOCAL CONDITIONS.** Filter weather, grid (use MISO for La Porte, IN), seismic (within ~500km), NWS alerts, local cyber/health relevance for the home location. Compress to "All local indicators nominal." on quiet days.
8. **BLUF.** Exactly 2-3 sentences: the single most important development, the overnight shift direction, and one forward watch item.
9. **NEXUS.** Only surface genuine cross-domain correlations. Do not force connections. State "No significant cross-domain convergence detected." when nothing links.
10. **No emojis.** Only `⚠` for warnings and `★` for personal flags.
11. **Timestamps.** Use the user's local timezone throughout.
