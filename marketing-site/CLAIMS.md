# Marketing claim checklist

Evidence is pinned to [78e34040d738c82195162b28280e8ce865c3bb6d](https://github.com/bradleybond512/crystal-ball/tree/78e34040d738c82195162b28280e8ce865c3bb6d). File and line references below refer to that revision, not a future moving branch. Counts are derived at build time from the checkout into data/generated.json; templates read that generated file. data/site.json contains human-reviewed copy and canonical URLs only.

This is a source audit, not proof of installed-app performance, feed completeness, forecast accuracy, notification delivery, or released-binary behavior. The latest reviewed public release is v2.25.147, published July 20, 2026. The reviewed source contains later development; a source feature must not be represented as verified in that July download. Release metadata and artifact URLs require separate live verification.

| Section / claim | Source evidence | Qualification |
| --- | --- | --- |
| Hero: intelligence desk for Mac; live global signals | `README.md:8,22`; `src/main.ts:343–347`; `src/config/panels.ts:9` | “Live” describes connected feeds, not guaranteed freshness. No completeness, uptime or accuracy promise. |
| God's Eye: globe with selectable geographic layers | `src/components/GodsVisionView.ts:76–78,140,170`; `src/config/panels.ts` `FULL_MAP_LAYERS` | God's Eye is the requested marketing name; internal class names retain God's Vision. The supplied “See everything” headline is adjusted to “Your world. In view.” to avoid a universal-coverage claim. |
| Intelligence: hypotheses, evidence, alternative views and forecasts | `src/components/AnalystHUD.ts:2–6,20–40,116` | Generated analysis can be wrong. No guaranteed understanding or predictive performance. |
| Home Shell: personal context, changes, worldwide items in a briefing | `src/services/home-shell/briefing-view.ts:1–8,24–32,63–76`; `src/components/HomeShellOverlay.ts` | “Your morning, briefed.” describes a view, not a guaranteed scheduled delivery. Coverage and evidence age can be unverified. |
| Survival posture: organize threats and explain posture | `src/services/survival/survival-posture.ts:13–31,63–93` | No emergency readiness, safe-route or safety guarantee. Retain safety fine print and FAQ. |
| Privacy: no Crystal Ball account needed to open the app | `src/main.ts:343–347` initializes `App` directly | Optional third-party services may need their own accounts and credentials. This does not mean anonymous network use. |
| Privacy: analytics off until explicit opt-in | `src/services/analytics.ts:1–17,40–47,90–114` | Current source resets ambiguous legacy consent. Do not generalize this to “no network traffic” or every historical binary. |
| Privacy: macOS Keychain-backed credential storage | `src-tauri/src/main.rs:776–785` | Also disclose an encrypted local recovery cache: `:399–409,787–803`. Never claim keys exist only in Keychain. |
| Local AI: local Ollama inference | `src/services/summarization.ts:54–58`; `src/services/llm-adapter.ts:81,221–245`; `src-tauri/sidecar/local-api-server.mjs:6867,6913–6923` | Local inference stays on your Mac when Ollama is configured locally. A remotely configured endpoint is not on-device. Local inference does not make live feeds offline. |
| Cloud AI: Groq, Claude and OpenRouter receive submitted content | `src/services/summarization.ts:54–58,242–255`; `api/claude-agent.js:28`; `src/services/llm-adapter.ts:221–252`; `src-tauri/sidecar/local-api-server.mjs:6913–6923` | Some paths fall back to cloud. Avoid a universal “nothing leaves your device” promise. Provider policies apply. |
| Variants: full, tech, finance, happy | `src/config/variant.ts:1–8`; `src/config/panels.ts:1199` | Configured variants are not proof of four published desktop downloads. Desktop workflow input currently offers full, tech and finance. |
| Variants: full 409 panels | `src/config/panels.ts:9` `FULL_PANELS`, counted named entries | Catalog entries, not concurrently active or verified working panels. |
| Variants: tech 35 panels | `src/config/panels.ts:601–637` | Same catalog qualification. |
| Variants: finance 31 panels | `src/config/panels.ts:810–842` | Same catalog qualification. |
| Variants: happy 10 panels | `src/config/panels.ts:1015–1026` | Same catalog qualification. |
| MCP: 61 registered tool definitions | `tools/mcp-server/tool-registry.mjs:82–160,180–192` | Exact audited count is 61, not the requested approximate 63. Registry changes require shared-data refresh. |
| MCP: default read profile, optional analyst profile | `tools/mcp-server/profile.mjs:11–44`; registry overrides `:161–178` | 53 read-only tools; 8 additional tools can change state. These are definitions, not evidence all providers are available. |
| Open source: free, AGPL-3.0 | `package.json:5`; `LICENSE` | Exact package identifier is AGPL-3.0-only. Optional providers may charge separately. No award or popularity claims. |
| macOS primary; Windows/Linux experimental | `README.md:8`; `.github/workflows/build-desktop.yml:107–129` | Owner-requested conservative support statement. Build targets exist; equivalent platform acceptance has not been verified. |
| Apple Silicon / Intel downloads | `.github/workflows/build-desktop.yml:107–114` | Maps to aarch64 and x86_64; each release asset URL must be checked against actual release metadata. |
| Signing and notarization | `docs/RELEASE_PACKAGING.md:128–145`; `.github/workflows/build-desktop.yml:213–262` | Optional: workflow uses ad-hoc signing without Apple credentials and skips notarization without credentials. Released DMG signing/notarization remains unverified unless artifact inspection proves it. Do not promise Gatekeeper acceptance. |
| Sponsor and free availability | `.github/FUNDING.yml:1`; `README.md:439` | Sponsor URL is `https://github.com/sponsors/bradleybond512`. Sponsorship is optional. |
| Contact | Repository GitHub settings, checked separately during review | Discussions is disabled. Use `https://github.com/bradleybond512/crystal-ball/issues`; do not invent an email address. |

## Required presentation checks

- [x] Visible counts are read from one shared data file and match the audited catalog.
- [x] Source features are distinguished from the July release where relevant.
- [x] Hero and FAQ state macOS primary and experimental Windows/Linux support.
- [x] Privacy copy distinguishes local inference, live network feeds, and cloud AI.
- [x] No claim of comprehensive coverage, validated predictive accuracy, emergency suitability, or awards.
- [x] Download links and SHA-256 manifest are verified against actual release assets.
- [x] Signing status is explicitly unverified unless actual artifacts were inspected.
- [x] Fine print appears at page bottom and in FAQ: “Crystal Ball is in early access. Information may be incomplete or delayed. Not for emergency, financial, or safety-critical decisions.”
- [x] Each published screenshot depicts a real product capture; captions preserve its actual capture date.

These boxes are review gates, not claims that visual or runtime verification has already passed.

All presentation boxes were checked against the final build on 2026-10-18. See `review/QA.md`, link results and browser evidence. Signing/notarization remains explicitly unverified.

## Added product detail

| Detail | Implementation evidence | Limit |
| --- | --- | --- |
| Map modes and layers | `src/components/MapContainer.ts`, `src/components/GodsVisionView.ts` | Coverage depends on sources and build. |
| Place search | `src/components/gods-vision/GlobeSearch.ts` | Search availability depends on its provider. |
| Source health and disagreements | `src/components/SourceConfidencePanel.ts` | Health is not proof of accurate reporting. |
| Situation evidence | `src/components/EvidenceGraphPanel.ts` | Interpretation remains uncertain. |
| Forecast review | `src/components/BeliefCalibrationPanel.ts` | Evaluation caveats remain in view. |
| Briefing context, recent changes, critical events | `src/services/home-shell/briefing-view.ts` | No scheduled-delivery promise. |
| Deck and readiness | `src/components/HomeShellOverlay.ts` | Readiness gaps may remain. |
| Saved places | `src/components/SavedPlacesPanel.ts` | Available local context only. |
| Offline basemap downloads | `src/components/OfflineMapPanel.ts` | Not complete offline operation. |
| Route estimates | `src/components/EvacuationPanel.ts` | Current road conditions are unverified; no safe-route guarantee. |
| Build editions | `src/config/variant.ts`, `src/config/panels.ts` | Catalog choice is a build setting; appearance choices may differ. |
| Local generation and cloud fallback | `src/services/llm-adapter.ts`, `src/services/summarization.ts` | Local-only applies to the generation adapter, not live feeds. |
| Read-only and analyst profiles | `tools/mcp-server/profile.mjs`, `tool-registry.mjs`, `index.mjs` | Analyst tools can change state; some actions require confirmation. |
| Platform architectures | `.github/workflows/build-desktop.yml` node_target matrix | OS minimums are not declared; runner versions are not support guarantees. |
| Download sizes and checksums | GitHub latest release API plus matching `release-manifest.json` | Build-time snapshot; failures fall back to latest release page. |
| Data categories | `src/config/panels.ts`, `src/config/feeds.ts`, `src/services/usgs-pager.ts` | Catalog categories do not guarantee live coverage. |

Visible source and license links now follow main, as requested. This checklist retains the audited SHA for reproducible evidence. The generator independently parses current checkout catalogs, so counts cannot silently stay pinned to the old audit. Latest release discovery uses GitHub API and manifest metadata at build time; no runtime API request is needed.
