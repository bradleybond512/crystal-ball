# Crystal Ball — API Keys & Data Sources

Crystal Ball reads API credentials from two authoritative surfaces:

1. **`SUPPORTED_SECRET_KEYS`** in [`src-tauri/src/main.rs`](../src-tauri/src/main.rs) — the
   **73-key allowlist** the desktop runtime will accept, store in the macOS Keychain
   (service `crystal-ball`), and inject into the sidecar. Anything not on this list
   **cannot be saved via Settings → API Keys.**
2. **`process.env.*` reads** inside [`src-tauri/sidecar/`](../src-tauri/sidecar/) — the
   env vars the Node sidecar actually consumes at runtime.

This document is reconciled against both as of the current `main`. **No key is required
to launch the app** — every credential below is optional and unlocks a feed, raises a
rate limit, or enables a feature. Keys are entered via **Settings (gear icon) → API Keys**
in the desktop and web builds.

> Each field in the in-app Settings overlay also shows a one-line description, free-vs-paid,
> and a "Get key" link.

## Where keys are stored

- **Desktop (Tauri)** — keys live in the macOS Keychain under service `crystal-ball`.
  The renderer never sees them; they are injected into the Node sidecar at startup and
  proxied through a bearer-authenticated localhost port.
- **Web (browser)** — keys live in a passphrase-encrypted IndexedDB vault. AES-GCM-256
  over PBKDF2-SHA-256 (600,000 iterations); ciphertext only. Auto-locks after 15 min of
  the tab being hidden.

---

## Keys consumed by the Node sidecar

Every row below is read via `process.env.<KEY>` in `src-tauri/sidecar/`. Rows marked
**⚠ not in allowlist** are read by the sidecar but are **absent from
`SUPPORTED_SECRET_KEYS`**, so they can only be supplied through the raw environment or a
`.env.local` fallback — they will **not** appear in Settings → API Keys until added to the
Rust allowlist.

### AI summarization & local LLM

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | Optional | [console.anthropic.com](https://console.anthropic.com/) | Falls back to local Ollama; no cloud summaries |
| `GROQ_API_KEY` | Groq | Optional | [console.groq.com](https://console.groq.com/keys) | Cloud summarization skipped |
| `OLLAMA_API_URL` | Ollama (self-hosted) | Optional | [ollama.com](https://ollama.com/download) | Local LLM inference disabled |
| `OLLAMA_MODEL` | Ollama | Optional | [ollama.com/library](https://ollama.com/library) | Adapter default model used |

### News & media

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `NEWSAPI_KEY` | NewsAPI.org | Optional | [newsapi.org](https://newsapi.org/register) | That news source skipped |
| `NEWSDATA_API_KEY` | NewsData.io | Optional | [newsdata.io](https://newsdata.io/register) | That news source skipped |
| `MEDIASTACK_API_KEY` | mediastack | Optional | [mediastack.com](https://mediastack.com/signup/free) | That news source skipped |

### Economics & markets

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `FINNHUB_API_KEY` | Finnhub | Optional | [finnhub.io](https://finnhub.io/register) | Real-time market data feed disabled |
| `FRED_API_KEY` | FRED (St. Louis Fed) | Optional | [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) | Macro / supply-chain series disabled |
| `EIA_API_KEY` | US EIA | Optional | [eia.gov](https://www.eia.gov/opendata/register.php) | Energy production/pricing feed disabled |

### Cyber threat intelligence

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `THREATFOX_API_KEY` | ThreatFox (abuse.ch) | Optional | [auth.abuse.ch](https://auth.abuse.ch/) | Feed disabled |
| `OTX_API_KEY` | AlienVault OTX | Optional | [otx.alienvault.com](https://otx.alienvault.com/) | Feed disabled |
| `ABUSEIPDB_API_KEY` | AbuseIPDB | Optional | [abuseipdb.com](https://www.abuseipdb.com/login) | IP reputation lookup disabled |
| `VIRUSTOTAL_API_KEY` | VirusTotal | Optional | [virustotal.com](https://www.virustotal.com/gui/join-us) | IOC reputation lookup disabled |
| `URLSCAN_API_KEY` | urlscan.io | Optional | [urlscan.io](https://urlscan.io/user/signup) | Authenticated scans disabled (public still works) |
| `BITCOINABUSE_API_KEY` | BitcoinAbuse / Chainabuse | Optional | [bitcoinabuse.com](https://www.bitcoinabuse.com/api-docs) | Ransomware address lookup disabled |
| `VULNERS_API_KEY` | Vulners | Optional | [vulners.com](https://vulners.com/docs/api/) | CVE/exploit enrichment disabled |
| `PULSEDIVE_API_KEY` | Pulsedive | Optional | [pulsedive.com](https://pulsedive.com/api/) | Falls back to free tier |
| `GREYNOISE_API_KEY` | GreyNoise | Optional | [greynoise.io](https://www.greynoise.io/plans/community) | Internet-noise classification disabled |
| `HIBP_API_KEY` | Have I Been Pwned | Optional | [haveibeenpwned.com](https://haveibeenpwned.com/API/Key) | Breach lookup disabled |
| `CENSYS_API_ID` | Censys | Optional | [search.censys.io](https://search.censys.io/account/api) | Censys host/cert lookup disabled |
| `CENSYS_API_SECRET` | Censys | Optional | Same as above | Paired with `CENSYS_API_ID` |
| `SECURITYTRAILS_API_KEY` | SecurityTrails | Optional | [securitytrails.com](https://securitytrails.com/app/account/credentials) | DNS/domain history disabled |
| `WHOISXML_API_KEY` | WhoisXML API | Optional | [whoisxmlapi.com](https://whois.whoisxmlapi.com/) | WHOIS enrichment disabled |
| `MISP_URL` | MISP (self-hosted) | Optional | Self-hosted | MISP feed disabled |
| `MISP_API_KEY` | MISP (self-hosted) | Optional | Self-hosted instance | Paired with `MISP_URL` |
| `OPENCTI_URL` | OpenCTI (self-hosted) | Optional | Self-hosted | OpenCTI feed disabled |
| `OPENCTI_API_KEY` | OpenCTI (self-hosted) | Optional | Self-hosted instance | Paired with `OPENCTI_URL` |

### Aviation, maritime & flight tracking

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `OPENSKY_CLIENT_ID` | OpenSky Network | Optional | [opensky-network.org](https://opensky-network.org/login?view=registration) | Anonymous OpenSky rate limits |
| `OPENSKY_CLIENT_SECRET` | OpenSky Network | Optional | Same as above | Paired with `OPENSKY_CLIENT_ID` |
| `AISSTREAM_API_KEY` | aisstream.io | Optional | [aisstream.io](https://aisstream.io/authenticate) | Vessel / dark-ship tracking disabled |
| `AVIATIONSTACK_API` | aviationstack | Optional | [aviationstack.com](https://aviationstack.com/signup/free) | Airport delay data disabled |

### Weather, air quality & environment

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `OWM_API_KEY` | OpenWeatherMap | Optional | [openweathermap.org](https://openweathermap.org/api) | Weather tiles hidden (Open-Meteo base weather still works) |
| `NASA_FIRMS_API_KEY` | NASA FIRMS | Optional | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/area/) | Satellite fire detections disabled |
| `NASA_API_KEY` | NASA (api.nasa.gov) | Optional | [api.nasa.gov](https://api.nasa.gov/#signUp) | DONKI uses shared `DEMO_KEY` rate limit |
| `AIRNOW_API_KEY` | EPA AirNow | Optional | [docs.airnowapi.org](https://docs.airnowapi.org/) | US particulate readings disabled |
| `PURPLEAIR_API_KEY` | PurpleAir | Optional | [develop.purpleair.com](https://develop.purpleair.com/) | Community PM2.5 sensors disabled |
| `OPENAQ_API_KEY` ⚠ **not in allowlist** | OpenAQ | Optional | [docs.openaq.org](https://docs.openaq.org/) | Air-quality feed unavailable when OpenAQ requires a key |
| `WINDY_WEBCAMS_API_KEY` ⚠ **not in allowlist** | Windy Webcams | Optional | [api.windy.com](https://api.windy.com/) | Webcam layer disabled |
| `NPS_API_KEY` ⚠ **not in allowlist** | US National Park Service | Optional | [nps.gov/subjects/developer](https://www.nps.gov/subjects/developer/get-started.htm) | NPS data disabled |

### Geolocation & infrastructure

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `GEONAMES_USERNAME` | GeoNames | Optional | [geonames.org](https://www.geonames.org/login) | Place-name lookups disabled |
| `IPINFO_TOKEN` | ipinfo.io | Optional | [ipinfo.io](https://ipinfo.io/signup) | IP geolocation uses keyless fallback |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Radar | Optional | [dash.cloudflare.com](https://dash.cloudflare.com/profile/api-tokens) | Internet-outage detection disabled |

### Traffic & highway cameras

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `NSW_API_KEY` | Transport for NSW (AU) | Optional | [opendata.transport.nsw.gov.au](https://opendata.transport.nsw.gov.au/) | NSW transport feed disabled |
| `UK_HIGHWAYS_API_KEY` | National Highways (UK) | Optional | [webtris.nationalhighways.co.uk](https://webtris.nationalhighways.co.uk/) | UK DATEX-II feed disabled |
| `ROAD511_API_KEY` | 511.org | Optional | [511.org](https://511.org/) | 511 camera roll-up disabled |

### Server-to-server bridges (S2U / TAK)

Outbound bridges from the desktop runtime to collaboration or tactical SA servers. Not
consumed by any panel directly.

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `S2U_XMPP_JID` | XMPP bridge (self-hosted) | Optional | Self-hosted | XMPP bridge off |
| `S2U_XMPP_SECRET` | XMPP bridge (self-hosted) | Optional | Self-hosted | Paired with `S2U_XMPP_JID` |
| `S2U_TAK_URL` | TAK server (self-hosted) | Optional | Self-hosted | TAK bridge off |
| `S2U_TAK_USERNAME` | TAK server (self-hosted) | Optional | Self-hosted | Paired with `S2U_TAK_URL` |
| `S2U_TAK_SECRET` | TAK server (self-hosted) | Optional | Self-hosted | Paired with `S2U_TAK_URL` |
| `S2U_TLS_INSECURE_OPT_IN` | (flag) | Optional | N/A | TLS verification stays on (recommended) |

### Comms & notifications

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `TWILIO_AUTH_TOKEN` ⚠ **not in allowlist** | Twilio | Optional | [twilio.com/console](https://www.twilio.com/console) | SMS-command webhook falls back to phone-number-only validation |

### Patreon (membership / audio)

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `PATREON_OAUTH_CLIENT_ID` | Patreon | Optional | [patreon.com/portal](https://www.patreon.com/portal/registration/register-clients) | Patreon integration off |
| `PATREON_OAUTH_CLIENT_SECRET` | Patreon | Optional | Same as above | Paired with client ID |
| `PATREON_ACCESS_TOKEN` | Patreon | Optional | Same as above | Patreon integration off |
| `PATREON_REFRESH_TOKEN` | Patreon | Optional | Same as above | Token refresh disabled |
| `PATREON_AUDIO_RSS_URL` | Patreon (audio RSS) | Optional | Patreon creator RSS | Audio feed off |

### Platform & relay

| Key | Service | Required/Optional | Where to get it | Default if absent |
|-----|---------|-------------------|-----------------|-------------------|
| `CRYSTALBALL_API_KEY` | Crystal Ball cloud | Optional | [crystalball.app](https://crystalball.app) | Cloud fallback when sidecar is down disabled |
| `WS_RELAY_URL` | Generic websocket relay (self-hosted) | Optional | Self-hosted | Relay disabled |
| `CONVEX_URL` ⚠ **not in allowlist** | Convex backend | Optional | [convex.dev](https://www.convex.dev/) | Convex-backed sync disabled |

---

## Reconciliation notes

### A. Sidecar reads these but they are **not** in `SUPPORTED_SECRET_KEYS`

These five are consumed by the sidecar via `process.env` yet are missing from the Rust
allowlist, so they cannot be entered in Settings → API Keys and are only honored when
present in the raw environment or `.env.local`:

- `TWILIO_AUTH_TOKEN`
- `WINDY_WEBCAMS_API_KEY`
- `OPENAQ_API_KEY`
- `NPS_API_KEY`
- `CONVEX_URL`

**Action item:** add these to `SUPPORTED_SECRET_KEYS` (and bump the array length) if they
should be user-configurable through the Keychain/vault; otherwise document them as
deploy-time-only env vars.

### B. Allowlist keys **not** read directly by the sidecar

These are on the 73-key allowlist but are not read via `process.env` in
`src-tauri/sidecar/` — they are consumed by the **frontend/Vite build** or the **Rust
host**, or are not yet wired into a sidecar route:

`OPENROUTER_API_KEY`, `ACLED_REFRESH_TOKEN`, `URLHAUS_AUTH_KEY`, `WINGBITS_API_KEY`,
`VITE_OPENSKY_RELAY_URL`, `VITE_WS_RELAY_URL`, `WTO_API_KEY`, `ICAO_API_KEY`,
`SHODAN_API_KEY`, `UCDP_API_TOKEN`, `FMP_API_KEY`, `CESIUM_ION_TOKEN`,
`GOOGLE_MAPS_API_KEY`, `MAPBOX_API_KEY`, `MAPTILER_API_KEY`.

(`VITE_`-prefixed and the mapping/Cesium keys are inherently renderer-side; the rest are
either Rust-side or awaiting a sidecar consumer.)

---

## Non-credential runtime/config env vars

The sidecar also reads these operational env vars. They are **not** API keys and are
**not** on the allowlist; they are set by the app, the build, or a deploy environment.

| Var | Purpose | Default if absent |
|-----|---------|-------------------|
| `LOCAL_API_PORT` | Sidecar listen port | `46123` |
| `SIDECAR_PORT` | Alternate sidecar port var | `46123` |
| `LOCAL_API_PORT_FILE` | File the chosen port is written to | unset (no file written) |
| `LOCAL_API_MODE` | Runtime mode | `desktop-sidecar` |
| `LOCAL_API_CLOUD_FALLBACK` | Enable cloud fallback | `false` |
| `LOCAL_API_REMOTE_BASE` | Cloud fallback base URL | `https://crystalball.app` |
| `LOCAL_API_DATA_DIR` | Writable data dir (events.db, logs) | platform default |
| `LOCAL_API_RESOURCE_DIR` | Bundled resource dir | platform default |
| `LOCAL_API_TOKEN` | Bearer token for localhost auth | injected by host at spawn |
| `EVENT_STORE_RETENTION_MONTHS` | events.db retention window | see code default |
| `CB_SIDECAR_FILE_LOG` | File logging toggle | on unless set to `0` |
| `WM_TRACE` | Verbose trace logging | off unless `1` |
| `WM_BUILD_TAG` | Build identifier stamp | unset |
| `WM_TEST_UPSTREAM` | Test-only upstream override | unset |
| `CORS_ALLOW_ALL` | Dev-only: allow all CORS origins | off |
| `ALLOW_ALL_ORIGINS` | Dev-only: allow all origins | off |
| `RELAY_SHARED_SECRET` | Shared secret for self-hosted relay auth (sensitive) | relay auth off |
| `RELAY_AUTH_HEADER` | Header name carrying the relay secret | default header |
| `LITTLE_SNITCH_BASELINE_PATH` | Little Snitch baseline export path | integration off |
| `LITTLE_SNITCH_EXPORT_PATH` | Little Snitch current export path | integration off |

> `RELAY_SHARED_SECRET` / `RELAY_AUTH_HEADER` carry a secret but are supplied via the
> deploy environment for a self-hosted relay, not through the Keychain allowlist.

---

## Features that work without any keys

Earthquakes (USGS), GDACS disaster alerts, volcano alerts (USGS/Smithsonian), tropical
cyclones (NOAA), nuclear facilities, military bases, undersea cables, strategic waterways,
spaceports, critical minerals, intel hotspots, space weather (NOAA SWPC), CISA KEV, open
sanctions lists, Reddit OSINT, ISW reports, travel warnings (UK FCDO / AU DFAT / CA GAC),
global weather + 7-day forecast (Open-Meteo), weather radar (RainViewer), lightning
(Blitzortung), satellite imagery (NOAA GOES/Himawari), tide predictions (NOAA CO-OPS),
pollen (Open-Meteo Air Quality), Red Flag / fire-weather warnings (NWS/SPC), BGPView.

---

## How to add keys

1. Open Crystal Ball → **gear icon** (Settings) → **API Keys**.
2. Paste your key into the matching field. Desktop stores it in the macOS Keychain
   (`crystal-ball` service); web stores it in the encrypted vault.
3. Keys take effect immediately — no restart for most features.

Keys flagged **⚠ not in allowlist** above cannot be added this way until they are added to
`SUPPORTED_SECRET_KEYS` in `src-tauri/src/main.rs`.
