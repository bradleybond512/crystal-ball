# Crystal Ball — Enhancement Roadmap

> Last updated: 2026-07-26 | Current version: v2.25.x

This file is the canonical to-do list across all build sessions. Update status markers as work completes.

## Status

🔲 Pending · 🔄 In progress / partial · ✅ Done · ❌ Blocked

> Reconciled against the codebase on 2026-06-01 via a full audit. Tiers 0–2 are
> fully shipped; remaining open work is concentrated in Tier 3 (partial) and
> Tier 4 (moonshots).

---

## Tier 0 — Threat-intel panels (shipped ✅)

| Status | Feature | Notes |
|--------|---------|-------|
| ✅ | `cve-tracker` panel | NVD API + CVSS scoring — `CveTrackerPanel.ts` |
| ✅ | `vulners-cve` panel | NVD + EPSS exploit probability — `VulnersCvePanel.ts` |
| ✅ | `hibp-breaches` panel | Have I Been Pwned — `HibpBreachesPanel.ts`, `api/hibp-breaches.js` |
| ✅ | `ipinfo-lookup` panel | ipinfo.io geolocation/ASN — `IpInfoPanel.ts`, `api/ipinfo-lookup.js` |
| ✅ | `phishstats-feed` panel | PhishStats — `PhishstatsFeedPanel.ts` |
| ✅ | `urlscan-threats` panel | urlscan.io — `UrlscanThreatsPanel.ts` |
| ✅ | `pulsedive-intel` panel | Pulsedive indicators — `PulsediveIntelPanel.ts` |
| ✅ | `bitcoin-abuse` panel | scam addresses — `BitcoinAbusePanel.ts` + `crypto/bitcoin-abuse-service.ts` |
| ✅ | `reddit-osint` panel | multi-subreddit — `RedditOsintPanel.ts` + `osint/reddit-service.ts` |
| ✅ | `openaq-monitor` panel | OpenAQ air quality — `OpenaqMonitorPanel.ts`, `api/openaq-readings.js` |
| ✅ | `mediastack-news` panel | news aggregator — `MediastackNewsPanel.ts`, `api/mediastack-news.js` |

---

## Tier 1 — Quick wins (shipped ✅)

| Status | Feature | Data Source | Notes |
|--------|---------|-------------|-------|
| ✅ | NOAA GOES satellite imagery | cdn.star.nesdis.noaa.gov | `GoesSatellitePanel.ts`, `imagery/goes-catalog.ts`, `api/satellite/goes*.js` |
| ✅ | Flood monitoring | USGS Water Services + NWS CAP | `FloodMonitorPanel.ts`, `api/floods/{gauges,warnings}.js` |
| ✅ | Volcano monitoring | USGS VHP + Smithsonian GVP | `VolcanoMonitorPanel.ts` + `VolcanoAlertsPanel.ts`, `/api/volcano-alerts` |
| ✅ | Tornado / SPC severe weather | NWS SPC | `SevereWeatherPanel.ts`, `spc-outlook.ts`, `spc-mesoscale.ts` |
| ✅ | FAA TFRs on 3D globe | FAA TFR GeoJSON | `FaaTfrsPanel.ts`, `sidecar/faa-tfrs.mjs` |
| ✅ | USGS ShakeAlert + shake maps | USGS ShakeMap | `ShakeAlertPanel.ts`, `shakealert.ts`, `seismic/shaking-estimator.ts` |
| ✅ | GDACS / Copernicus alerts | gdacs.org RSS | `GDACSAlertsPanel.ts`, `api/gdacs.js`, `sidecar/gdacs-rss.mjs`, `copernicus-cems.ts` |
| ✅ | Feed latency audit | Internal | `sidecar/feed-latency-config.mjs`, surfaced in `FeedHealthDashboardPanel.ts` |

---

## Tier 2 — Medium builds (shipped ✅)

| Status | Feature | Notes |
|--------|---------|-------|
| ✅ | Custom alert rules engine | `alert-rules-engine.ts`, `intelligence/rules-engine.ts`, `alert-rules.ts` |
| ✅ | Saved places as first-class filter | `personal/personal-impact.ts`, `threat-aggregator.ts`, `resilience-model.ts` |
| ✅ | Supply chain disruption tracker | `SupplyChainDisruptionPanel.ts` — AIS + canal queue + Baltic Dry Index |
| ✅ | Infrastructure risk matrix | `InfraRiskMatrixPanel.ts`, `infrarisks/infra-risk-service.ts` |
| ✅ | Feed resilience / fallback sources | `sidecar/feed-resilience.mjs` |
| ✅ | Cross-domain correlation engine | `synthesis/correlation-engine.ts` + `alert-correlator.ts` — quake→tsunami, CME→grid, wildfire→AQI |

---

## Tier 3 — Large builds

| Status | Feature | Notes |
|--------|---------|-------|
| ✅ | Mobile / PWA companion | VitePWA + workbox in `vite.config.ts` (manifest, runtime caching, autoUpdate) |
| 🔄 | Historical playback / timeline | UI + logic shipped (`HistoricalPlaybackPanel.ts`, `TimelineScrubberPanel.ts`, `timeline-scrubber.ts`). **Open:** persistence is in-memory snapshot rings + IDB, not the spec'd SQLite store |
| 🔄 | Dark web / paste OSINT monitoring | Telegram feed + `DarkWebPanel.ts` + `osint/dark-web.ts` (HIBP + Tor relay metrics) shipped. **Open:** Pastebin + breach-forum monitoring |

---

## Tier 4 — Moonshots

| Status | Feature | Notes |
|--------|---------|-------|
| 🔄 | AI predictive threat modeling | Active execution and measurable completion criteria: `docs/PREDICTION_ACCURACY_ROADMAP.md`. Current focus is authoritative outcomes, evaluation baselines, and champion/challenger promotion before complex models. |
| 🔲 | Satellite imagery on demand | Sentinel-2 / Planet Labs optical imagery. Zero implementation (only a "not done" note in `satellite-change.ts`) |
| 🔲 | Voice command interface | Whisper STT + TTS, hands-free. Zero implementation |
| 🔲 | Team collaboration mode | Shared watchlists, annotations, sync. Local annotation primitives exist (`alert-annotations.ts`); no shared/sync layer |

---

## Completed

### v2.14–v2.25 (2026-05 → 2026-06)

- ✅ Tier 0 threat-intel panels — all 11 shipped (CVE, Vulners, HIBP, IPinfo, PhishStats, urlscan, Pulsedive, BitcoinAbuse, Reddit, OpenAQ, MediaStack)
- ✅ Tier 1 hazard suite — GOES imagery, floods, volcano, SPC/tornado, FAA TFRs, ShakeAlert, GDACS/Copernicus, feed-latency audit
- ✅ Tier 2 — alert-rules engine, saved-places filter, supply-chain tracker, infra risk matrix, feed resilience, cross-domain correlation
- ✅ Markets/Commodities/Crypto news panels wired (finance variant) (PR #958)
- ✅ Sidecar correctness: bundle SMS modules (prod-boot crash) + `req.json()`→`readBody()` on 3 POST routes (PR #961)
- ✅ Dead-UI cleanup: wired RIPE NCC BGP panel, removed dead `rfCoverage`/`entityGraph` globe toggles (PR #962)

### v2.13.x (2026-05-09)

- ✅ Unified threat dashboard — 11 domains, 56 tests (PR #368)
- ✅ Globe heatmap renderer + timeline cursor opacity — 36 tests (PR #369)
- ✅ Enhanced PDF intelligence brief — 35 tests (PR #370)
- ✅ Solar imagery tab (SDO + LASCO) — 22 tests (PR #371)
- ✅ Notification producers (NWS/SWPC/NIFC/NHC) — 97 tests (PR #372)
- ✅ OFAC sanctions + AIS cross-reference — 27 tests (PR #373)
- ✅ CDC NWSS wastewater genomics — 31 tests (PR #374)
- ✅ Configurable thresholds + feed health panel — 76 tests (PR #375)
- ✅ Commercial flights + emergency squawk detection — 48 tests (PR #376)
- ✅ Sidecar bundle completeness fix (PR #378)
- ✅ Diagnostic fixes: vessels 500, ESLint, panel pruning (PR #381)

### v2.12.x and earlier

- ✅ AIS vessel tracking (aisstream.io WebSocket + globe layer)
- ✅ PurpleAir AQI (EPA NowCast, independent globe toggle)
- ✅ AI intelligence brief (30-min TTL, llm-adapter routing)
- ✅ Space weather aurora overlay (Cesium polylines, Kp-derived latitude)
- ✅ War risk zone polygons (Red Sea, Hormuz, Black Sea, SCS)
- ✅ Infrastructure overlay (outage choropleth + RadNet pulsing dots)
- ✅ Keychain timeout fix (3s per-key, spawn_blocking)
- ✅ Encrypted key backup scripts (age/gpg/openssl, npm run backup-keys)
- ✅ .env.local fallback loader (env-local-loader.mjs)
