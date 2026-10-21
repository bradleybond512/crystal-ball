# Marketing claims versus the downloadable release

The remote annotated tag `v2.25.147` is `b20cc7c8599bf730d154051ce16aa86310897822`; its peeled source commit is **`bebf98915c1409b37397c2791bb90244129957c7`**. Resolution was checked using `git ls-remote user-fork refs/tags/v2.25.147 'refs/tags/v2.25.147^{}'`. The latest release metadata identifies July 20, 2026. All release-tree file references below mean that peeled commit, not current `main`.

The installed app's identical version string is not release evidence: its October source build and screenshots can contain later features. Source presence does not prove behavior of the published binaries. Current-source implementation evidence remains in `ENRICHMENT-SOURCES.md`, pinned to `78e34040d738c82195162b28280e8ce865c3bb6d`.

## Required qualifications

| Current marketing claim | Release-tree finding | Minimal accurate treatment |
| --- | --- | --- |
| `crystalball doctor --json` | `tools/mcp-server/cli.mjs` and its installable CLI entry are absent. | “Coming in the next release: CLI setup diagnostics.” Keep the installation prerequisite. This is a future-release qualification, not a release-date promise. |
| Default read-only profile; optional analyst profile; current read/analyst counts | `tools/mcp-server/profile.mjs` and `tool-registry.mjs` are absent. `index.mjs` registers tools directly, including mutation tools. | “Coming in the next release: read-only and analyst access profiles.” Do not describe the July release's agent access as read-only by default, including on `/security`. |
| Current panel and tool totals | AST parsing of release `src/config/panels.ts` gives Full 408, Tech 35, Finance 31, Happy 10. Release `tools/mcp-server/index.mjs` has 53 `server.registerTool` calls. Current build counts are different. | Keep current counts build-derived, but identify them as development-source counts rather than the downloadable release's contents. Do not copy these historical counts into another runtime data file. |
| Briefing evidence notes and named source-readiness states | Home Shell exists, but release `briefing-view.ts:24–30` lacks `evidenceNote`; `startup-readiness-view.ts` is absent. | “Coming in the next release: source-readiness checks and briefing evidence notes.” Basic Home Shell/Your Deck/Library need no such label. |
| Calibration error / ECE and resolved-label cohort workbench | Release `BeliefCalibrationPanel.ts:99–168` has reliability curves and Brier comparisons, but no ECE/cohort evaluation workbench. | “Coming in the next release: cohort comparisons and calibration-error metrics.” Existing Brier/reliability views can remain described as released. |
| Disaster Lifelines example in Full edition | Release `src/config/panels.ts:15` calls `local-logistics` **Local Logistics**, not Disaster Lifelines. | Use the released name, or label Disaster Lifelines as coming in the next release. |
| Command palette finds situations | Release `CommandPalette.ts:139–183` indexes panels, saved places, and alerts; direct situations are not listed. | Say “panels, places, and alerts.” Cmd+K itself is already released. |
| Analytics always stay off until explicit opt-in | Release `analytics.ts:90–100` migrates older installations with an installation ID and no recorded choice to consent `true`. New installs remain unconsented (`:87–88`). Current source fixes ambiguous legacy consent. | State “New installs ask before enabling analytics. Some older installs enable analytics during migration without a recorded choice.” Label the stricter consent reset as coming in the next release. Apply this qualification to both overview and `/privacy`; a distant general source disclaimer is insufficient. |
| Screenshots demonstrate the release | Captures show an October source-built installation, including newer readiness/calibration/agent UI. | State once, visibly: screenshots show a development build; downloaded release features differ. Do not equate its version label with the released binary. |

“Coming in the next release” should be used only as the requested product-roadmap label for implemented development-source changes. The audit proves source implementation and release absence, not a promised shipping date or inclusion in any future release.

## Claims already supported by release source

| Rendered area / named feature | Release evidence | Limits retained |
| --- | --- | --- |
| Globe and flat map | `GodsVisionView.ts:138` constructs Cesium; `DeckGLMap.ts:144,190–191` defines flat/3d interaction modes. | Distinct views; not a universal switching-control promise. |
| Weather, economic, waterways, outages, cyber threats, military layers | `src/config/panels.ts:426–447` | Coverage depends on feeds, credentials, and build. |
| Place search and fly-to | `src/components/gods-vision/GlobeSearch.ts:4–7,69–80`, identical to reviewed main source | Search provider availability applies. |
| Source Confidence: disagreement, single-source, offline providers, confidence detail | `src/components/SourceConfidencePanel.ts:139–142,146–170`, identical to reviewed main source | Provider agreement is not verified truth. |
| Evidence Graph: confirming, contradicting, missing, stale | `src/components/EvidenceGraphPanel.ts:52,137–140`, identical to reviewed main source | Selected-situation evidence; no comprehensive-coverage promise. |
| Existing Brier comparison and reliability curve | `src/components/BeliefCalibrationPanel.ts:99–168`; `src/components/calibration-report-view.ts:32–36` | Distinguish these existing metrics from the newer workbench and ECE. |
| Home Shell Personal / What changed / Critical worldwide bands | `src/services/home-shell/briefing-view.ts:25,93–110,132–154,181` | New evidence-note/readiness UI is separately qualified. |
| Your Deck and Library | `src/components/HomeShellOverlay.ts:114,132,362` | User-selected panels, not scheduled brief delivery. |
| Saved Places tags and notes | `src/services/saved-places.ts` `SavedPlace` interface | User-authored context, not verified safety information. |
| Tactical Comms copied check-ins and fallback steps | `src/components/CommsPlanPanel.ts` `copyStatus` and fallback rendering | Copies messages; does not guarantee delivery. |
| Family Tracker imported location codes | `src/components/FamilyTrackerPanel.ts:219–245,266–294`, identical to reviewed main source | Manual exchange/import; no continuous tracking promise. |
| Offline basemap caching | `src/components/OfflineMapPanel.ts:29–33`, identical to reviewed main source | Cached basemap only, not live feeds offline. |
| Evacuation route estimates and cached directions | `src/components/EvacuationPanel.ts:35,128,153–154` | Road conditions and route safety remain unverified regardless of older tooltip wording. |
| Keychain-backed credentials and encrypted recovery cache | `src-tauri/src/main.rs:728–743` and shadow-vault read/write helpers | Cache exists as well as Keychain; do not claim keys exist only in Keychain. |
| Analytics privacy setting | `src/components/UnifiedSettings.ts:489,859` calls the consent setter and renders the toggle | A control exists, but the migration exception above still applies. |
| Local Ollama and optional Groq / OpenRouter / Claude | `src/services/summarization.ts:55–57`; `src/services/llm-adapter.ts:18,81,196–201` | Provider calls receive submitted content; configured remote Ollama is not on-device. |
| Local-model-only toggle and adapter gate | `src/components/AnalystHUD.ts:769`; `src/services/llm-adapter.ts:81,196–201` (adapter identical to reviewed main) | Toggle is in Analyst HUD settings; it does not stop external live-data requests. |
| MCP over stdio | `tools/mcp-server/index.mjs:2,314` | Requires separately configured runtime/client; release has no new profile enforcement. |
| Example requests: situation brief, market overview, feed health, region brief | `tools/mcp-server/index.mjs:42,52,79,179` | Example questions, not live responses or complete-coverage guarantees. |
| Hypothesis-feedback tool | `tools/mcp-server/index.mjs:224` | Tool exists; current analyst-profile restriction does not exist in release. |
| Cmd+K command palette | `src/services/keyboard/shortcut-bootstrap.ts:49–54` | Released; use panels/places/alerts wording for release compatibility. |
| Four editions and named panel examples | `src/config/variant.ts`; `src/config/panels.ts`: Full `10–17`; Tech `599,601,603,609,614`; Finance `810,812–814,818`; Happy `1010–1011,1014,1016–1017` | Every named example exists except Disaster Lifelines. Build variants are not an in-app switch or guarantee of four published desktop assets. |
| Interface languages with English fallback | `src/services/i18n.ts:7,84` | Interface translations, not automatic translation of feeds. |
| Check for updates / manual download fallback | `src/app/desktop-updater.ts:116–183,251` | Do not imply every installation supports verified unattended updates. |
| No account needed, license, platform targets | Release app bootstrap, `LICENSE`, and `.github/workflows/build-desktop.yml` | Third-party accounts may be needed; Windows/Linux remain experimental. |
| Illustrative map/intelligence chips and example-day workflow | Underlying map, evidence, briefing, MCP, saved-place, and cache features above | Examples must remain labeled. Newer readiness/ECE imagery and terminology require their specific development-build qualifications. |

This audit did not install or execute a release binary, verify signing/notarization, or test provider availability. It inspected the exact tagged source and compared named claims with the current renderer.
