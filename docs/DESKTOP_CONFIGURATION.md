# Desktop Runtime Configuration

Crystal Ball desktop uses a runtime configuration schema with per-feature toggles and secret-backed credentials.

## Supported Secret Keys

The desktop vault schema is defined by Rust `SUPPORTED_SECRET_KEYS` in `src-tauri/src/main.rs`. It currently supports 77 keys. For a complete list with signup URLs and free/paid status, see [API_KEYS.md](API_KEYS.md).

**AI & Cloud:** `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_API_URL`, `OLLAMA_MODEL`, `CRYSTALBALL_API_KEY`

**Intelligence & Tracking:** `ACLED_ACCESS_TOKEN`, `ACLED_EMAIL`, `ACLED_REFRESH_TOKEN`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `VITE_OPENSKY_RELAY_URL`, `AISSTREAM_API_KEY`, `WINGBITS_API_KEY`, `NASA_FIRMS_API_KEY`, `AVIATIONSTACK_API`, `ICAO_API_KEY`, `WS_RELAY_URL`, `VITE_WS_RELAY_URL`

**Cyber:** `THREATFOX_API_KEY`, `URLHAUS_AUTH_KEY`, `OTX_API_KEY`, `ABUSEIPDB_API_KEY`, `VIRUSTOTAL_API_KEY`, `SHODAN_API_KEY`, `URLSCAN_API_KEY`, `BITCOINABUSE_API_KEY`, `VULNERS_API_KEY`, `PULSEDIVE_API_KEY`, `GREYNOISE_API_KEY`, `HIBP_API_KEY`

**Markets & Economics:** `FINNHUB_API_KEY`, `FMP_API_KEY`, `FRED_API_KEY`, `EIA_API_KEY`, `WTO_API_KEY`

**News:** `NEWSAPI_KEY`, `NEWSDATA_API_KEY`, `MEDIASTACK_API_KEY`

**Geo & Infrastructure:** `GEONAMES_USERNAME`, `IPINFO_TOKEN`, `BGPVIEW_API_KEY`, `CLOUDFLARE_API_TOKEN`, `NASA_API_KEY`, `UC_DP_KEY`

**Mapping:** `CESIUM_ION_TOKEN`, `OWM_API_KEY`, `GOOGLE_MAPS_API_KEY`

## Feature Availability Model

Each runtime feature exposes:

- `id`: stable feature identifier
- `requiredSecrets`: keys that must be present and valid
- `enabled`: user toggle state from the runtime settings UI
- `available`: computed availability after validation
- `fallback`: user-facing degraded behavior description

## Secret Storage

Desktop builds persist secrets through Tauri command bindings backed by OS credential storage.

- Service namespace: `crystal-ball`
- Storage backend: consolidated `secrets-vault` entry in the OS keychain
- Frontend behavior: secrets are not written to plaintext config files

## Expected Degradation

When secrets are missing or disabled, the desktop app degrades feature-by-feature instead of failing globally:

- AI summarization: cloud providers narrow to whatever is configured and validated; local Ollama and browser fallback can still be used when available.
- Economic and market enrichment: `FRED_API_KEY`, `EIA_API_KEY`, and `FINNHUB_API_KEY` gate economic charts, oil analytics, and some market panels.
- Conflict and outage feeds: `ACLED_ACCESS_TOKEN`, `ACLED_EMAIL`, and `CLOUDFLARE_API_TOKEN` gate conflict and outage-backed panels.
- Cyber threat feeds: `URLHAUS_AUTH_KEY`, `OTX_API_KEY`, `ABUSEIPDB_API_KEY`, and `THREATFOX_API_KEY` gate parts of the cyber layer.
- Fire and climate overlays: `NASA_FIRMS_API_KEY` gates FIRMS-backed fire detection.
- Aviation and live tracking: `WINGBITS_API_KEY`, `AVIATIONSTACK_API`, `ICAO_API_KEY`, `AISSTREAM_API_KEY`, `WS_RELAY_URL`, `VITE_WS_RELAY_URL`, `VITE_OPENSKY_RELAY_URL`, `OPENSKY_CLIENT_ID`, and `OPENSKY_CLIENT_SECRET` gate enrichment and relay-backed transport features.
- Trade and institutional data: `WTO_API_KEY` gates WTO-backed trade policy enrichment.
- Weather map tile overlays: `OWM_API_KEY` gates OpenWeatherMap temperature, precipitation, cloud, wind, and pressure tile layers. Free weather features (radar, lightning, satellite imagery, forecasts, tides, pollen, red flag warnings) work without any key.

## 3D Feature Degradation

The 3D immersive features degrade gracefully based on available keys:

**3D Buildings**

| Tier | Requirement | Behavior |
|------|-------------|----------|
| 1 | `GOOGLE_MAPS_API_KEY` | Photorealistic 3D building tiles on God's Vision globe |
| 2 | `CESIUM_ION_TOKEN` (no Google key) | Cesium OSM Buildings on God's Vision globe |
| 3 | Neither key | 2D map building extrusions only (zoom 14+) |
| 4 | Extrusions disabled | Flat map, no building geometry |

**3D Aircraft**

No API key required. Aircraft are rendered as 3D meshes using locally bundled GLTF models on both the 2D DeckGL map and the God's Vision globe. Mesh rendering is limited to 200 aircraft instances for performance.

**Satellite Tracking**

No API key required. TLE data is fetched from CelesTrak (free, no registration). SGP4 propagation runs in a Web Worker. At low zoom levels, rendering is limited to notable satellites (~200) to maintain frame rate. At high zoom, all tracked satellites are visible.

## Related Docs

- [API_KEYS.md](API_KEYS.md)
- [API_KEY_DEPLOYMENT.md](API_KEY_DEPLOYMENT.md)
- [RELAY_PARAMETERS.md](RELAY_PARAMETERS.md)
- [RELEASE_PACKAGING.md](RELEASE_PACKAGING.md)
