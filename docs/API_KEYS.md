# Crystal Ball — API Keys & Data Sources

Crystal Ball supports **77 secret keys** wired through the Tauri desktop runtime
(see [`src-tauri/src/main.rs`](../src-tauri/src/main.rs) — `SUPPORTED_SECRET_KEYS`). Most
features work out of the box with free public APIs; the keys below unlock additional
sources or higher rate limits. Keys are entered via **Settings (gear icon) → API Keys**
in both the desktop and web builds.

> **Each field in the in-app Settings overlay also shows a one-line description of what
> the key does, free vs paid, and a "Get key" link** — added in the v2.11 release as
> part of the documentation refresh.

## Where keys are stored

- **Desktop (Tauri)** — keys live in the macOS Keychain under service name
  `crystal-ball`. The renderer never sees them; they're injected into the Node.js
  sidecar at startup and proxied through a bearer-authenticated localhost port.
- **Web (browser)** — keys live in a passphrase-encrypted vault in IndexedDB.
  AES-GCM-256 over PBKDF2-SHA-256 (600,000 iterations); ciphertext only, derived
  key + plaintext map held in module closure for the duration of the session.
  Auto-locks after 15 min of the tab being hidden.

## Quick Start — Essential Free Keys

These keys unlock the most impactful features and are free with simple registration:

| Key | What It Unlocks | Signup |
|-----|----------------|--------|
| `GOOGLE_MAPS_API_KEY` | Photorealistic 3D building tiles on the God's Vision globe | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| `CESIUM_ION_TOKEN` | God's Vision 3D globe with Bing satellite imagery | [ion.cesium.com](https://ion.cesium.com/signup/) |
| `NASA_FIRMS_API_KEY` | 7,000+ satellite fire detections worldwide | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/) |
| `OWM_API_KEY` | Weather map tiles (temperature, precipitation, clouds, wind, pressure) | [openweathermap.org](https://openweathermap.org/api) |
| `FINNHUB_API_KEY` | Real-time stock market data | [finnhub.io](https://finnhub.io/register) |
| `NEWSAPI_KEY` | 150k+ news sources for headline aggregation | [newsapi.org](https://newsapi.org/register) |

---

## All Supported Keys by Category

### Intelligence & Tracking

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `ACLED_ACCESS_TOKEN` | Registration | Conflict events, battles, explosions | [developer.acleddata.com](https://developer.acleddata.com/) |
| `ACLED_EMAIL` | — | Paired with ACLED token | Same as above |
| `ACLED_REFRESH_TOKEN` | — | Long-lived refresh for ACLED OAuth | Same as above |
| `OPENSKY_CLIENT_ID` | Free | Military flight tracking (OAuth pair) | [opensky-network.org](https://opensky-network.org/login?view=registration) |
| `OPENSKY_CLIENT_SECRET` | Free | Military flight tracking (OAuth pair) | Same as above |
| `VITE_OPENSKY_RELAY_URL` | — | Relay URL for OpenSky data (self-hosted) | Self-hosted |
| `WS_RELAY_URL` | — | Generic websocket relay endpoint | Self-hosted |
| `VITE_WS_RELAY_URL` | — | Browser-side websocket relay URL | Self-hosted |
| `AISSTREAM_API_KEY` | Free | Military vessel & dark ship tracking | [aisstream.io](https://aisstream.io/authenticate) |
| `WINGBITS_API_KEY` | Paid | Aircraft metadata enrichment | [wingbits.com](https://wingbits.com/register) |
| `NASA_FIRMS_API_KEY` | Free | Satellite fire detections (FIRMS) | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/) |
| `ICAO_API_KEY` | Paid | Airport closure NOTAMs | [dataservices.icao.int](https://dataservices.icao.int/) |
| `AVIATIONSTACK_API` | Free | Airport delay data | [aviationstack.com](https://aviationstack.com/signup/free) |
| `UCDP_API_TOKEN` | Free | Uppsala Conflict Data Program events | [ucdp.uu.se](https://ucdp.uu.se/) |

### Cyber Threat Intelligence

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `THREATFOX_API_KEY` | Free | C2 servers, malware IOCs | [auth.abuse.ch](https://auth.abuse.ch/) |
| `URLHAUS_AUTH_KEY` | Free | Malicious URL indicators | [auth.abuse.ch](https://auth.abuse.ch/) |
| `OTX_API_KEY` | Free | Community threat intelligence | [otx.alienvault.com](https://otx.alienvault.com/) |
| `ABUSEIPDB_API_KEY` | Free (limited) | IP reputation scoring | [abuseipdb.com](https://www.abuseipdb.com/login) |
| `VIRUSTOTAL_API_KEY` | Free (limited) | IOC reputation lookups | [virustotal.com](https://www.virustotal.com/gui/join-us) |
| `SHODAN_API_KEY` | Paid | ICS/SCADA exposure scanning | [account.shodan.io](https://account.shodan.io/) |
| `URLSCAN_API_KEY` | Free | URL scanner results | [urlscan.io](https://urlscan.io/user/signup) |
| `BITCOINABUSE_API_KEY` | Free | Ransomware address tracker | [bitcoinabuse.com](https://www.bitcoinabuse.com/api-docs) |
| `VULNERS_API_KEY` | Free (limited) | CVE & exploit intelligence | [vulners.com](https://vulners.com/docs/api/) |
| `PULSEDIVE_API_KEY` | Free (limited) | Threat indicator scoring | [pulsedive.com](https://pulsedive.com/api/) |
| `GREYNOISE_API_KEY` | Free (50/day) | Internet noise classification | [greynoise.io](https://www.greynoise.io/plans/community) |
| `HIBP_API_KEY` | Free/Paid | Data breach lookups | [haveibeenpwned.com](https://haveibeenpwned.com/API/Key) |

### Economics & Markets

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `FINNHUB_API_KEY` | Free (limited) | Real-time stock & crypto data | [finnhub.io](https://finnhub.io/register) |
| `FMP_API_KEY` | Free (250 req/day) | Market data fallback | [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs) |
| `FRED_API_KEY` | Free | Federal Reserve economic data + supply chain | [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `EIA_API_KEY` | Free | US energy production & pricing | [eia.gov](https://www.eia.gov/opendata/register.php) |
| `WTO_API_KEY` | Free | International trade data | [apiportal.wto.org](https://apiportal.wto.org/) |

### News & Media

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `NEWSAPI_KEY` | Free (limited) | 150k+ news sources | [newsapi.org](https://newsapi.org/register) |
| `NEWSDATA_API_KEY` | Free (limited) | 95k+ news sources | [newsdata.io](https://newsdata.io/register) |
| `MEDIASTACK_API_KEY` | Free (500 req/mo) | 7,500+ news sources | [mediastack.com](https://mediastack.com/signup/free) |

### Geolocation, Air Quality & Infrastructure

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `GEONAMES_USERNAME` | Free | Place name lookups | [geonames.org](https://www.geonames.org/login) |
| `IPINFO_TOKEN` | Free (50k/mo) | IP geolocation | [ipinfo.io](https://ipinfo.io/signup) |
| `CLOUDFLARE_API_TOKEN` | Paid | Internet outage detection | [cloudflare.com](https://dash.cloudflare.com/profile/api-tokens) |
| `NASA_API_KEY` | Free | Boosts DONKI rate limits | [api.nasa.gov](https://api.nasa.gov/#signUp) |
| `AIRNOW_API_KEY` | Free | EPA AirNow particulate readings (US) | [docs.airnowapi.org](https://docs.airnowapi.org/) |
| `PURPLEAIR_API_KEY` | Free | PurpleAir community PM2.5 sensors | [develop.purpleair.com](https://develop.purpleair.com/) |
| `OPENAQ_API_KEY` | Free | OpenAQ air quality (PM2.5, PM10, NO2, O3) from 10,000+ global stations — OpenAQ now requires a key | [explore.openaq.org](https://explore.openaq.org/register) |
| `WINDY_WEBCAMS_API_KEY` | Free tier | Live/recent webcam imagery near a location (Windy Webcams) | [api.windy.com](https://api.windy.com/keys) |
| `NPS_API_KEY` | Free | US National Park Service park webcams & visitor data | [nps.gov/subjects/developer](https://www.nps.gov/subjects/developer/get-started.htm) |

### Traffic & Highway Cameras

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `NSW_API_KEY` | Free (registration) | NSW (Australia) transport open data | [opendata.transport.nsw.gov.au](https://opendata.transport.nsw.gov.au/) |
| `UK_HIGHWAYS_API_KEY` | Free | National Highways (UK) DATEX-II | [webtris.nationalhighways.co.uk](https://webtris.nationalhighways.co.uk/) |
| `ROAD511_API_KEY` | Paid | 511 multi-state highway camera roll-up | [511.org](https://511.org/) |

### Mapping & Visualization

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `GOOGLE_MAPS_API_KEY` | Free tier ($200/mo credit, ~28,500 session loads/mo) | Photorealistic 3D building tiles | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| `CESIUM_ION_TOKEN` | Free | God's Vision 3D globe (Bing satellite tiles); 3D buildings fallback | [ion.cesium.com](https://ion.cesium.com/signup/) |
| `OWM_API_KEY` | Free (limited) | Weather map tiles | [openweathermap.org](https://openweathermap.org/api) |
| `MAPBOX_API_KEY` | Free (50k loads/mo) | Mapbox basemap tiles + geocoding | [account.mapbox.com](https://account.mapbox.com/) |
| `MAPTILER_API_KEY` | Free (100k tiles/mo) | MapTiler vector tile basemaps | [maptiler.com](https://www.maptiler.com/cloud/) |

### AI Summarization & Local LLM

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `GROQ_API_KEY` | Paid | Fast LLM summarization | [console.groq.com](https://console.groq.com/keys) |
| `ANTHROPIC_API_KEY` | Paid | Claude AI summaries | [console.anthropic.com](https://console.anthropic.com/) |
| `OPENROUTER_API_KEY` | Paid | LLM routing fallback | [openrouter.ai](https://openrouter.ai/settings/keys) |
| `OLLAMA_API_URL` | Free (self-hosted) | Local LLM inference | [ollama.com](https://ollama.com/download) |
| `OLLAMA_MODEL` | Free | Model selection (e.g. `llama3`) | [ollama.com/library](https://ollama.com/library) |

### Server-to-Server Bridges (S2U / TAK)

These keys configure outbound bridges from the desktop runtime to upstream collaboration
or tactical situational-awareness servers. They are not consumed by any panel directly.

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `S2U_XMPP_JID` | Self-hosted | XMPP bridge identity (jabber JID) | Self-hosted |
| `S2U_XMPP_SECRET` | Self-hosted | XMPP bridge password | Self-hosted |
| `S2U_TAK_URL` | Self-hosted | TAK server base URL | Self-hosted |
| `S2U_TAK_USERNAME` | Self-hosted | TAK server username | Self-hosted |
| `S2U_TAK_SECRET` | Self-hosted | TAK server password / token | Self-hosted |
| `S2U_TLS_INSECURE_OPT_IN` | — | Explicit opt-in to skip TLS verification for the S2U bridges (dev / lab only) | — |

### Cloud & Platform

| Key | Free? | What It Enables | Signup |
|-----|-------|-----------------|--------|
| `CRYSTALBALL_API_KEY` | Paid | Cloud fallback when sidecar is down | [crystalball.app](https://crystalball.app) |

### Deploy-time-only environment variables

These env vars are **not** in `SUPPORTED_SECRET_KEYS` and are intentionally not
surfaced in Settings → API Keys. They configure infrastructure or signing, not
per-user data sources, so they are injected through the process environment
(`.env.local` for development, the deploy environment in production) rather than
the keychain / web vault.

| Env var | Purpose | Where to set |
|---------|---------|--------------|
| `CONVEX_URL` | Convex backend URL for the registration DB | Deploy environment / `.env.local` |
| `TWILIO_AUTH_TOKEN` | Twilio `X-Twilio-Signature` validation for the SMS-command webhook | Deploy environment / `.env.local` |

> `TWILIO_AUTH_TOKEN` gates a server-side webhook signature check; it is a secret
> the *sidecar host* holds, not something an end user enters, so a Settings field
> would be a dangling no-op. `CONVEX_URL` is an endpoint, not a credential.

---

## Features That Work Without Any Keys

These data sources are free and require no registration:

- Earthquakes (USGS)
- GDACS disaster alerts
- Volcano alerts (USGS/Smithsonian)
- Tropical cyclones (NOAA)
- Nuclear facilities database
- Military bases database
- Undersea cables map
- Strategic waterways/chokepoints
- Spaceports & launch sites
- Critical minerals database
- Intel hotspots with escalation scores
- Space weather (NOAA SWPC)
- CISA Known Exploited Vulnerabilities
- Open sanctions lists
- Reddit OSINT feeds
- ISW situation reports
- Travel warnings (UK FCDO, Australia DFAT, Canada GAC)
- Global weather (Open-Meteo)
- 7-day extended forecast (Open-Meteo)
- Weather radar (RainViewer — global radar composite)
- Lightning detection (Blitzortung)
- Satellite weather imagery (NOAA GOES/Himawari)
- Tide predictions (NOAA CO-OPS — US coastal stations)
- Pollen & allergy data (Open-Meteo Air Quality)
- Red Flag / fire weather warnings (NWS/SPC)
- PhishStats, urlscan.io public, Pulsedive free tier
- BGPView (no key required)

---

## How to Add Keys

1. Open Crystal Ball
2. Click the **gear icon** (Settings)
3. Navigate to **API Keys**
4. Paste your key into the corresponding field
5. Keys are stored in your macOS keychain (`crystal-ball` service)

Keys take effect immediately — no restart required for most features.
