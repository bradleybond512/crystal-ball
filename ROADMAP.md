# Crystal Ball — Enhancement Roadmap

> Last updated: 2026-05-09 | Current version: v2.13.1

This file is the canonical to-do list across all build sessions. Update status markers as work completes.

## Status

🔲 Pending · 🔄 In progress · ✅ Done · ❌ Blocked

---

## Tier 0 — In progress (completing now)

| Status | Feature | Notes |
|--------|---------|-------|
| 🔄 | `cve-tracker` panel | NVD API + CVSS scoring |
| 🔄 | `vulners-cve` panel | NVD + EPSS exploit probability |
| 🔄 | `hibp-breaches` panel | Have I Been Pwned breach feed |
| 🔄 | `ipinfo-lookup` panel | ipinfo.io IP geolocation/ASN |
| 🔄 | `phishstats-feed` panel | PhishStats phishing URL feed |
| 🔄 | `urlscan-threats` panel | urlscan.io malicious URL feed |
| 🔄 | `pulsedive-intel` panel | Pulsedive threat indicators |
| 🔄 | `bitcoin-abuse` panel | CryptoScamDB scam addresses |
| 🔄 | `reddit-osint` panel | Multi-subreddit threat feed |
| 🔄 | `openaq-monitor` panel | OpenAQ v3 global air quality |
| 🔄 | `mediastack-news` panel | News aggregator on GDELT |

---

## Tier 1 — Quick wins (free APIs, days each)

| Status | Feature | Data Source | Impact |
|--------|---------|-------------|--------|
| 🔲 | NOAA GOES satellite imagery | cdn.star.nesdis.noaa.gov (free) | ★★★★★ |
| 🔲 | Flood monitoring | USGS Water Services + NWS CAP | ★★★★★ |
| 🔲 | Volcano monitoring | USGS VHP API + Smithsonian GVP | ★★★★☆ |
| 🔲 | Tornado / SPC severe weather | NWS SPC outlooks + warnings | ★★★★★ |
| 🔲 | FAA TFRs on 3D globe | FAA TFR GeoJSON (free) | ★★★★☆ |
| 🔲 | USGS ShakeAlert + shake maps | USGS ShakeMap per-event API | ★★★★☆ |
| 🔲 | GDACS / Copernicus alerts | gdacs.org/xml/rss.xml (free) | ★★★★☆ |
| 🔲 | Feed latency audit | Internal — tighten cache TTLs | ★★★☆☆ |

---

## Tier 2 — Medium builds (1–2 weeks each)

| Status | Feature | Notes |
|--------|---------|-------|
| 🔲 | Custom alert rules engine | IF/THEN cross-domain conditional alerts |
| 🔲 | Saved places as first-class filter | Filter every panel by proximity to saved locations |
| 🔲 | Supply chain disruption tracker | AIS + port congestion + Baltic Dry Index |
| 🔲 | Infrastructure risk matrix | Power + BGP + CISA KEV + ACLED infrastructure attacks |
| 🔲 | Feed resilience / fallback sources | Auto-failover when primary feed returns 5xx |
| 🔲 | Cross-domain correlation engine | Earthquake→tsunami, CME→power grid, wildfire→AQI alerts |

---

## Tier 3 — Large builds (months)

| Status | Feature | Notes |
|--------|---------|-------|
| 🔲 | Historical playback / timeline | SQLite snapshots, globe scrubber |
| 🔲 | Mobile / PWA companion | Sidecar-served PWA, responsive UI |
| 🔲 | Dark web / paste OSINT monitoring | Pastebin, Telegram, breach forum monitoring |

---

## Tier 4 — Moonshots

| Status | Feature | Notes |
|--------|---------|-------|
| 🔲 | AI predictive threat modeling | Ollama local inference, probability forecasts |
| 🔲 | Team collaboration mode | Shared watchlists, annotations, sync |
| 🔲 | Voice command interface | Whisper STT + TTS, hands-free monitoring |
| 🔲 | Satellite imagery on demand | Sentinel-2 / Planet Labs optical imagery |

---

## Completed

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
