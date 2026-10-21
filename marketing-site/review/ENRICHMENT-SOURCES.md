# Enrichment claim sources

Product evidence below refers to source revision `78e34040d738c82195162b28280e8ce865c3bb6d`. File paths are relative to the repository root. These are implementation claims, not verification of feed availability, released binaries, forecast accuracy, or emergency suitability. Counts continue to come from the build-generated shared data; this document is not another count source.

| Area | Verified claim or proposed copy | Source | Required limit |
| --- | --- | --- | --- |
| Map layers | Choose weather, internet outages, cyber threats, and military activity layers. | `src/config/panels.ts:439–447` | Catalog configuration does not prove active coverage. |
| Map views | Explore a globe or a flat map. | `src/components/GodsVisionView.ts:140–144`; `src/components/DeckGLMap.ts:165,212` | Separate implemented views; do not promise a universal mode switch. |
| Place search | Search a place and fly to its location. | `src/components/gods-vision/GlobeSearch.ts:4–7,69–80` | Provider availability applies. |
| Source health | See where sources disagree, depend on one provider, or go offline. | `src/components/SourceConfidencePanel.ts:128–142` | Source agreement is not proof that a report is correct. |
| Source detail | Inspect provider details behind a domain's confidence. | `src/components/SourceConfidencePanel.ts:146–170` | Confidence is a computed indicator. |
| Calibration | Compare resolved forecasts using Brier scores and calibration error. | `src/components/BeliefCalibrationPanel.ts:336–349` | Aggregate metrics use direct/manual labels; insufficient samples remain explicit (`:267–270,409–412`). |
| Briefing structure | Separate personal situations, recorded changes, and critical worldwide events. | `src/services/home-shell/briefing-view.ts:24–32,116,160,194` | Available reports only; coverage and evidence age can be unverified (`:63–64`). |
| Source readiness | Check USGS, GDACS, Open-Meteo, and GDELT source readiness. | `src/services/home-shell/startup-readiness-view.ts:40–44` | A successful fresh update is required before “working now” (`:71–86`). |
| Freshness | See when a refresh fails or the last successful update is stale. | `src/services/home-shell/startup-readiness-view.ts:97–109` | Zero returned items are not an all-clear (`:79–80`). |
| Saved places | Save places with tags, notes, and an area of interest. | `src/services/saved-places.ts:7–18` | User-provided context, not verified local safety. |
| Offline maps | Cache basemap tiles around saved places for offline viewing. | `src/components/OfflineMapPanel.ts:29–33` | CartoDB dark basemap and browser Cache API; not complete offline operation. |
| Route planning | Compare driving-route estimates and keep cached directions. | `src/components/EvacuationPanel.ts:48–52`; `src/services/evacuation-router.ts:28–36` | Current road conditions are unverified. Use official emergency guidance. |
| Family communications | Copy check-in templates, review fallback steps, and import family location codes. | `src/components/CommsPlanPanel.ts:122–132,181–191`; `src/components/FamilyTrackerPanel.ts:219–245,266–294` | Manual copying/exchange/import; no automatic delivery or continuous tracking claim. |
| Preparedness catalog | Emergency Readiness, Tactical Comms, Offline Maps, Evacuation Routes, Family Tracker, and Resource Inventory are registered panels. | `src/config/panels.ts:16–17,143–147` | Registration does not prove operational readiness. |
| Local-only control | Analyst HUD settings include “Local model only (disable cloud LLM fallback)”. | `src/components/AnalystHUD.ts:731–754` | Do not imply this control lives in general Settings or is enabled by default. |
| Local-only behavior | The generation adapter respects the local-only setting and sends the localOnly flag to the sidecar. | `src/services/llm-adapter.ts:81,196–204` | Local inference does not stop live feeds contacting external sources. |

## Illustrative examples

Every example must be visibly labeled **Example** and distinguished from live data. Example values do not establish actual system health, current events, or measured performance. Prefer source-defined categorical labels over invented numbers or timestamps.

| Example content or data shape | Source | Presentation limit |
| --- | --- | --- |
| Layers: Weather / Internet outages / Cyber threats | `src/config/panels.ts:439–443` | Labels illustrate selectable categories, not current incidents. |
| Source state: Single-source / Disagreeing / Down | `src/components/SourceConfidencePanel.ts:139–142` | Do not attach an invented confidence percentage. |
| Forecast: “No resolved forecasts in this cohort.” | `src/components/BeliefCalibrationPanel.ts:473` | Real empty-state wording; no fabricated calibration result. |
| USGS Earthquakes: “degraded · latest refresh failed” | `src/services/home-shell/startup-readiness-view.ts:41,97–104` | An illustrative source/status combination, not a live USGS outage report. |
| Briefing card fields: kind, label, tone, headline, entries, evidenceNote | `src/services/home-shell/briefing-view.ts:24–32` | Do not invent evidence freshness; the source explicitly allows unknown evidence age (`:63`). |
| Saved place fields: name, latitude, longitude, radius, tags, priority, notes, offlinePinned | `src/services/saved-places.ts:7–18` | “Home” is a supported tag (`:5`), not the user's actual location. |
| Route fields: from/to labels, distanceKm, durationMinutes, steps, cachedAt | `src/services/evacuation-router.ts:23–36` | Prefer “Route estimate / Cached directions / Road conditions unverified” to invented measurements. |
| Communications fields: status, fallback steps, check-in windows, contacts, notes | `src/services/comms-plan.ts:4–44` | Planning and copied templates do not prove delivery. |

## Edition examples, assistant requests, and setup details

These entries incorporate the separate repository analyst's source audit. Panel examples are enabled catalog entries, not live-feed guarantees. Assistant prompts are illustrative requests mapped to registered tools, not promises of complete answers.

| Claim or example | Source | Required limit |
| --- | --- | --- |
| Full: Threat Dashboard, Global Map, Saved Places, Disaster Lifelines, Alert Inbox | `src/config/panels.ts:10–18` | Build edition; coverage depends on connected sources. |
| Tech: Global Tech Map, AI Regulation Dashboard, AI/ML News, Startups & VC, Cybersecurity | `src/config/panels.ts:602,604,606,612,617` | Build edition; not an in-app switch. |
| Finance: Live Markets, Forex & Currencies, Fixed Income, Commodities & Futures, Central Bank Watch | `src/config/panels.ts:815,817–819,823` | Not financial advice or guaranteed real-time pricing. |
| Happy: Good News Feed, Human Progress, Breakthroughs, Conservation Wins, Renewable Energy | `src/config/panels.ts:1017–1018,1021,1023–1024` | Build catalog, not proof of a published desktop asset for every edition. |
| “Give me a global situation brief.” → `get_sitrep` | `tools/mcp-server/tool-registry.mjs:98` | Example request; connected assistant/runtime and available feeds required. |
| “Brief me on Japan.” → `get_region_brief` | `tools/mcp-server/tool-registry.mjs:120` | Example region; not a live report. |
| “Which feeds need attention?” → `check_feed_health` | `tools/mcp-server/tool-registry.mjs:105` | Reports available runtime diagnostics, not universal feed health. |
| “Summarize market signals.” → `get_market_overview` | `tools/mcp-server/tool-registry.mjs:100` | Example request; no freshness or investment-outcome promise. |
| `crystalball doctor --json` and `crystalball capabilities --json` | `tools/mcp-server/cli.mjs:19–24`; `tools/mcp-server/package.json:7–8` | CLI must be installed/linked; repository equivalent is `node tools/mcp-server/cli.mjs doctor --json`. |
| Repository diagnostics: `npm run doctor -- --deep --json` | `scripts/doctor.mjs:27–35`; `package.json:12` | Repository command, not an assumed installed-app binary. |
| Command palette: Cmd+K; keyboard help: Cmd+/ | `src/services/keyboard/shortcut-bootstrap.ts:49–63` | Ctrl substitution on non-Mac platforms: `src/services/keyboard/shortcut-registry.ts:158–168`. |
| Cmd+1 through Cmd+9 navigate the current sidebar order | `src/services/keyboard/shortcut-registry.ts:235–245` | Do not promise a fixed destination for each number. |
| Home Shell shortcut: Cmd+Shift+O | `src/services/keyboard/shortcut-bootstrap.ts:69–76`; `src/services/home-shell/shell-gate.ts:30–37` | Conditional on full edition and wide viewport. |
| Configured interface languages: en, fr, de, el, es, it, pl, pt, nl, sv, ru, ar, zh, ja, ko, tr, th, vi | `src/services/i18n.ts:7` | Interface language support, not translated feeds or completeness; English fallback at `:90`. Avoid a separate hardcoded language count. |
| Minimum OS row omitted when no explicit minimum is configured | `src-tauri/tauri.conf.json:88–92`; `marketing-site/scripts/generate-site-data.mjs:43–58` | Build-runner versions are not minimum supported operating systems. |
| Desktop checks for updates and can apply a ready update on quit/reopen | `src/app/desktop-updater.ts:138–148,205–217` | GitHub latest-release lookup and browser fallback for unsupported/unverified cases: `src-tauri/src/main.rs:2305,2311–2343`. No universal automatic/signed update promise. |

| Additional rendered claim | Source | Limit |
| --- | --- | --- |
| Evidence Graph shows confirming, contradicting, missing, and stale evidence | `src/components/EvidenceGraphPanel.ts:47–52` | One selected active situation; not proof of truth. |
| PostHog analytics requires opt-in | `src/services/analytics.ts:4–17,309–314` | Capture shows this installation’s opt-in enabled; no setting changed for capture. |
| Local MCP server uses stdio | `tools/mcp-server/index.mjs:3,375–378` | Compatible client and local runtime required. |

The Map example is a hypothetical setup: flat view, three named layers, and a Tokyo place search. It makes no claim about current events or live search results. The Intelligence example lists supported status/metric fields, not measured values. Day timestamps describe a self-directed illustrative routine, not scheduling features.
