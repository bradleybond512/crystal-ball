# Crystal Ball — API Keys & Data Sources

Crystal Ball integrates with 40+ external data sources. Most features work out of the box with free public APIs, but some layers require API keys for full functionality. Keys are entered via **Settings (gear icon) > API Keys** and stored securely in your macOS keychain.

## Quick Start — Essential Free Keys

These keys unlock the most impactful features and are free with simple registration:

| Key | What It Unlocks | Signup |
|-----|----------------|--------|
| `GOOGLE_MAPS_API_KEY` | Photorealistic 3D building tiles on the God's Eye globe | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| `CESIUM_ION_TOKEN` | God's Eye 3D globe with Bing satellite imagery | [ion.cesium.com](https://ion.cesium.com/signup/) |
| `NASA_FIRMS_API_KEY` | 7,000+ satellite fire detections worldwide | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/) |
| `OWM_API_KEY` | Weather map tiles (temperature, precipitation, clouds, wind, pressure) | [openweathermap.org](https://openweathermap.org/api) |
| `FINNHUB_API_KEY` | Real-time stock market data | [finnhub.io](https://finnhub.io/register) |
| `NEWSAPI_KEY` | 150k+ news sources for headline aggregation | [newsapi.org](https://newsapi.org/register) |

---

## All Supported Keys by Category

### Intelligence & Tracking

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `ACLED_ACCESS_TOKEN` | ACLED Access Token | Registration | Conflict events, battles, explosions | [developer.acleddata.com](https://developer.acleddata.com/) |
| `ACLED_EMAIL` | ACLED Email | — | Paired with ACLED token for airstrike data | Same as above |
| `OPENSKY_CLIENT_ID` | OpenSky Client ID | Free | Military flight tracking (OAuth pair) | [opensky-network.org](https://opensky-network.org/login?view=registration) |
| `OPENSKY_CLIENT_SECRET` | OpenSky Client Secret | Free | Military flight tracking (OAuth pair) | Same as above |
| `VITE_OPENSKY_RELAY_URL` | OpenSky Relay URL | — | Relay server URL for OpenSky data | Self-hosted |
| `AISSTREAM_API_KEY` | AISStream API Key | Free | Military vessel & dark ship tracking | [aisstream.io](https://aisstream.io/authenticate) |
| `WINGBITS_API_KEY` | Wingbits API Key | Paid | Aircraft metadata enrichment | [wingbits.com](https://wingbits.com/register) |
| `NASA_FIRMS_API_KEY` | NASA FIRMS Key | Free | Satellite fire detections (FIRMS) | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/) |
| `ICAO_API_KEY` | ICAO NOTAM Key | Paid | Airport closure NOTAMs | [dataservices.icao.int](https://dataservices.icao.int/) |
| `AVIATIONSTACK_API` | AviationStack Key | Free | Airport delay data | [aviationstack.com](https://aviationstack.com/signup/free) |

### Cyber Threat Intelligence

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `THREATFOX_API_KEY` | ThreatFox Key | Free | C2 servers, malware IOCs | [auth.abuse.ch](https://auth.abuse.ch/) |
| `URLHAUS_AUTH_KEY` | URLhaus Auth Key | Free | Malicious URL indicators | [auth.abuse.ch](https://auth.abuse.ch/) |
| `OTX_API_KEY` | AlienVault OTX Key | Free | Community threat intelligence | [otx.alienvault.com](https://otx.alienvault.com/) |
| `ABUSEIPDB_API_KEY` | AbuseIPDB Key | Free (limited) | IP reputation scoring | [abuseipdb.com](https://www.abuseipdb.com/login) |
| `VIRUSTOTAL_API_KEY` | VirusTotal Key | Free (limited) | IOC reputation lookups | [virustotal.com](https://www.virustotal.com/gui/join-us) |
| `SHODAN_API_KEY` | Shodan Key | Paid | ICS/SCADA exposure scanning | [account.shodan.io](https://account.shodan.io/) |
| `URLSCAN_API_KEY` | URLScan.io Key | Free | URL scanner results | [urlscan.io](https://urlscan.io/user/signup) |
| `BITCOINABUSE_API_KEY` | Bitcoin Abuse Key | Free | Ransomware address tracker | [bitcoinabuse.com](https://www.bitcoinabuse.com/api-docs) |
| `VULNERS_API_KEY` | Vulners Key | Free (limited) | CVE & exploit intelligence | [vulners.com](https://vulners.com/docs/api/) |
| `PULSEDIVE_API_KEY` | Pulsedive Key | Free (limited) | Threat indicator scoring | [pulsedive.com](https://pulsedive.com/api/) |
| `GREYNOISE_API_KEY` | GreyNoise Key | Free (50/day) | Internet noise classification | [greynoise.io](https://www.greynoise.io/plans/community) |
| `HIBP_API_KEY` | HIBP Key | Free/Paid | Data breach lookups | [haveibeenpwned.com](https://haveibeenpwned.com/API/Key) |

### Economics & Markets

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `FINNHUB_API_KEY` | Finnhub Key | Free (limited) | Real-time stock & crypto data | [finnhub.io](https://finnhub.io/register) |
| `FMP_API_KEY` | Financial Modeling Prep Key | Free (250 req/day) | Market data fallback | [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs) |
| `FRED_API_KEY` | FRED Key | Free | Federal Reserve economic data + supply chain | [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `EIA_API_KEY` | EIA Key | Free | US energy production & pricing | [eia.gov](https://www.eia.gov/opendata/register.php) |
| `WTO_API_KEY` | WTO Key | Free | International trade data | [apiportal.wto.org](https://apiportal.wto.org/) |

### News & Media

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `NEWSAPI_KEY` | NewsAPI Key | Free (limited) | 150k+ news sources | [newsapi.org](https://newsapi.org/register) |
| `NEWSDATA_API_KEY` | NewsData Key | Free (limited) | 95k+ news sources | [newsdata.io](https://newsdata.io/register) |
| `MEDIASTACK_API_KEY` | MediaStack Key | Free (500 req/mo) | 7,500+ news sources | [mediastack.com](https://mediastack.com/signup/free) |

### Geolocation & Infrastructure

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `GEONAMES_USERNAME` | GeoNames Username | Free | Place name lookups | [geonames.org](https://www.geonames.org/login) |
| `IPINFO_TOKEN` | IPInfo Token | Free (50k/mo) | IP geolocation | [ipinfo.io](https://ipinfo.io/signup) |
| `BGPVIEW_API_KEY` | BGPView Key | Free | ASN/BGP routing data | [bgpview.io](https://bgpview.io/) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Token | Paid | Internet outage detection | [cloudflare.com](https://dash.cloudflare.com/profile/api-tokens) |
| `NASA_API_KEY` | NASA API Key | Free | Boosts DONKI rate limits | [api.nasa.gov](https://api.nasa.gov/#signUp) |

### Mapping & Visualization

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `GOOGLE_MAPS_API_KEY` | Google Maps Key | Free tier ($200/mo credit, ~28,500 session loads/mo) | Photorealistic 3D building tiles on the God's Eye globe. Enable "Map Tiles API" in Google Cloud Console. Without this key, falls back to Cesium OSM Buildings (needs `CESIUM_ION_TOKEN`), then no 3D buildings. 2D map building extrusions work without any key. | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| `CESIUM_ION_TOKEN` | Cesium Ion Token | Free | God's Eye 3D globe (Bing satellite tiles); also used as fallback for 3D buildings when `GOOGLE_MAPS_API_KEY` is absent | [ion.cesium.com](https://ion.cesium.com/signup/) |
| `OWM_API_KEY` | OpenWeatherMap Key | Free (limited) | Weather map tiles (temperature, precipitation, clouds, wind, pressure) | [openweathermap.org](https://openweathermap.org/api) |

### AI Summarization

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `GROQ_API_KEY` | Groq Key | Paid | Fast LLM summarization | [console.groq.com](https://console.groq.com/keys) |
| `ANTHROPIC_API_KEY` | Anthropic Key | Paid | Claude AI summaries | [anthropic.com](https://console.anthropic.com/) |
| `OPENROUTER_API_KEY` | OpenRouter Key | Paid | LLM routing fallback | [openrouter.ai](https://openrouter.ai/settings/keys) |
| `OLLAMA_API_URL` | Ollama Server URL | Free (self-hosted) | Local LLM inference | [ollama.com](https://ollama.com/download) |
| `OLLAMA_MODEL` | Ollama Model Name | Free | Model selection (e.g. `llama3`) | [ollama.com/library](https://ollama.com/library) |

### Cloud & Platform

| Key | Label | Free? | What It Enables | Signup |
|-----|-------|-------|-----------------|--------|
| `CRYSTALBALL_API_KEY` | Cloud API Key | Paid | Cloud fallback when sidecar is down | [crystalball.app](https://crystalball.app) |

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
- Air quality (OpenAQ)

---

## How to Add Keys

1. Open Crystal Ball
2. Click the **gear icon** (Settings)
3. Navigate to **API Keys**
4. Paste your key into the corresponding field
5. Keys are stored in your macOS keychain (`crystal-ball` service)

Keys take effect immediately — no restart required for most features.
