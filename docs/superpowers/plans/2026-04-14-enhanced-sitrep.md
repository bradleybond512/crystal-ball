# Enhanced Sitrep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-line `/sitrep` skill with a full-spectrum presidential-style daily intelligence brief using all 20 Crystal Ball MCP tools, personalized to the user's location and platform interests.

**Architecture:** Single skill file (`.claude/commands/sitrep.md`) containing a 3-phase intelligence cycle: parallel collection, triage & enrichment, synthesis. User profile already exists in memory. No code changes — this is prompt engineering.

**Tech Stack:** Claude Code custom commands (markdown skill files), Crystal Ball MCP tools

---

### Task 1: Write the Enhanced Sitrep Skill

**Files:**
- Modify: `.claude/commands/sitrep.md` (replace contents entirely)

**Spec reference:** `docs/superpowers/specs/2026-04-14-enhanced-sitrep-design.md`

- [ ] **Step 1: Read the current sitrep skill to confirm its contents**

Run: review `.claude/commands/sitrep.md` — currently 4 lines calling 3 MCP tools.

- [ ] **Step 2: Read the user profile memory file**

Read `~/.claude/projects/-Users-bradleybond-Developer-crystalball/memory/user_sitrep_profile.md` to confirm the personalization data is in place:
- home_location: "La Porte, Indiana"
- platforms: Apple (macOS, iOS, iPadOS, watchOS), WebKit / Safari
- watchlist_tickers: AAPL
- interests: Apple supply chain, Great Lakes weather, Midwest severe weather

- [ ] **Step 3: Replace sitrep.md with the enhanced 3-phase skill**

Overwrite `.claude/commands/sitrep.md` with the full enhanced skill. The file must contain these sections in order:

**A. Title & overview** — one-line description of what this produces

**B. User Profile loading** — instruction to read `~/.claude/projects/-Users-bradleybond-Developer-crystalball/memory/user_sitrep_profile.md` for personalization data (home location, platforms, tickers, interests). If the file doesn't exist, skip personalization and run as a generic global brief.

**C. Phase 1 — Collection** — call all 16 MCP tools in parallel with `summary_only: true`:

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
get_region_brief        (place_name from user profile, e.g. "La Porte, Indiana")
search_news             (limit: 10)
get_sec_filings         (limit: 5)
```

**D. Phase 2 — Triage & Enrichment** — two layers:

Layer 1: For any aggregate tool that returned elevated/critical indicators, re-call with `limit: 20` (no `summary_only`) to get full detail.

Layer 2: When Phase 1 names specific entities, enrich with granular lookups:
- Military aircraft → `lookup_flight` (callsign/hex)
- Naval vessels → `lookup_vessel` (MMSI/name)
- CVEs → `lookup_cve` (CVE ID)
- Suspicious IPs → `lookup_ip` (IP address)
- Sanctions entities → `get_sanctions` (entity search)
- Regional conflict escalation → `search_conflicts` (country/date filter)
- Market-moving company → `get_sec_filings` (filtered search)

Quiet domains skip Phase 2 entirely.

**E. Phase 3 — Synthesis** — write the brief in this fixed structure:

```
╔══════════════════════════════════════════════════════╗
║  CRYSTAL BALL — DAILY SITUATIONAL REPORT             ║
║  [date] [time] [timezone]                            ║
╚══════════════════════════════════════════════════════╝

SOURCE STATUS
LOCAL CONDITIONS — [home city]
BOTTOM LINE UP FRONT
── SECURITY ───────────────────────────────────────────
  CONFLICTS & SECURITY
  MILITARY POSTURE
  THREAT LANDSCAPE
  CYBER
── ECONOMY ────────────────────────────────────────────
  MARKETS & ECONOMY
  SANCTIONS
── ENVIRONMENT ────────────────────────────────────────
  WEATHER & SPACE WEATHER
  SEISMIC
  INFRASTRUCTURE
  HEALTH
── SIGNALS ────────────────────────────────────────────
  NEWS WIRE
── SYNTHESIS ──────────────────────────────────────────
  NEXUS
```

**F. Narrative rules** embedded in the skill:
- Analyst voice: declarative, connecting dots, no hedging
- Signal-proportional density: quiet sections compress to one line, never omit
- Inline cross-references: `↳ Note:` or `— see SECTION`
- Degraded feeds: `⚠ DATA DEGRADED — [feed name]` inline on affected sections
- Personal relevance: `★ PERSONAL:` prefix on items matching user profile (Apple CVEs, AAPL filings, Midwest weather, La Porte area)
- SOURCE STATUS at top: count operational vs degraded feeds, list missing API keys
- LOCAL CONDITIONS: filter weather, grid (MISO), seismic, NWS alerts, cyber/health for home location. Compress to "All local indicators nominal" on quiet days.
- BLUF: 2-3 sentences — most important development, overnight shift, forward watch item
- NEXUS: cross-domain correlations when genuine, "No significant cross-domain convergence detected" when quiet
- No emojis. Timestamps in user's local timezone.

- [ ] **Step 4: Review the written skill for completeness**

Check that the skill file:
1. References all 20 MCP tools (16 in Phase 1 + 7 enrichment triggers in Phase 2)
2. Includes the user profile loading step with fallback
3. Has all 11 brief sections in the correct order
4. Includes all narrative rules
5. Specifies parallel execution for Phase 1 calls

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/sitrep.md
git commit -m "feat: enhanced sitrep — full-spectrum presidential-style daily brief

3-phase intelligence cycle (collection, triage, synthesis) using all 20
Crystal Ball MCP tools. Personalized to user's home location, platforms,
and interests. Analyst narrative voice with cross-domain correlation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2: Smoke Test

- [ ] **Step 1: Run the enhanced sitrep**

Invoke `/sitrep` and verify:
- Phase 1 fires all 16 MCP tools in parallel
- Phase 2 triggers deep-dives only on elevated sections
- Phase 3 produces the correct brief structure with all 11 sections
- LOCAL CONDITIONS shows La Porte, IN weather and regional data
- Personal items (Apple CVEs, AAPL) get `★ PERSONAL:` flag if present in the data
- Degraded feeds show `⚠ DATA DEGRADED` markers
- SOURCE STATUS accurately reflects feed health
- NEXUS section present (either with correlations or "no convergence" message)

- [ ] **Step 2: Verify quiet section compression**

Confirm that sections with no elevated signal compress to a single line rather than being omitted entirely.

- [ ] **Step 3: Verify degraded feed handling**

Check that SOURCE STATUS at top lists degraded feeds, and affected sections show inline `⚠ DATA DEGRADED` markers.
