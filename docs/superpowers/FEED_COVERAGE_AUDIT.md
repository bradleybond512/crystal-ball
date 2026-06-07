# Feed Coverage Audit (C1)

> Generated 2026-06-07 as part of Workstream C. Cross-referenced
> `src-tauri/sidecar/local-api-server.mjs` against
> `docs/API_SOURCE_EXPANSION_FREE_OPTIONS.md`.

## No-key feeds status

| Source | Domain | Wired? | Route | Notes |
|--------|--------|--------|-------|-------|
| USGS Earthquakes | Geology | ✅ Yes | `/api/earthquakes` | |
| NWS Weather Alerts | Weather | ✅ Yes | `/api/nws-alerts` | |
| GDACS Disasters | Disasters | ✅ Yes | `/api/disasters/gdacs` | |
| NASA EONET | Natural events | ✅ Sidecar-less* | `fetchNaturalEvents()` | *Direct browser fetch. Intelligence layer gap closed in C3 PR. |
| NASA FIRMS Fires | Wildfire | ✅ Yes | `/api/nasa-firms` | Keyed; no-key fallbacks via `/api/wildfire/perimeters` + `/api/inpe-fires` |
| NOAA SWPC Space Weather | Space | ✅ Yes | `/api/spaceweather/status`, `/api/spaceweather/alerts` | |
| Open-Meteo Forecast | Weather | ✅ Yes | `/api/owm-current` | Global cities only; saved-place hourly gap below |
| Open-Meteo Air Quality | Air | ✅ Yes | `/api/air-quality-proxy` | |
| NOAA CO-OPS Tides | Flood | ⚠️ Partial | `/api/floods/gauges` | Endpoint exists but source is third-party |
| NASA EONET (sidecar route) | Natural events | ❌ Missing | `/api/eonet-events` | Low priority: browser fetch works; add if CORS issues arise |

## Highest-value gaps (prioritised)

### P1 — Open-Meteo saved-place hourly forecast

**What's missing:** The current `/api/owm-current` only fetches current conditions
for 28 fixed global cities. Users with saved places (La Porte IN, etc.) get no
hourly arrival-window forecasts (precipitation, wind gusts, UV). The weather-urgency
pipeline needs this to produce Storm Mode arrival windows.

**Add:** Sidecar route `/api/weather/local-forecast?lat=&lon=` proxying
`https://api.open-meteo.com/v1/forecast?latitude=&longitude=&hourly=precipitation,wind_gusts_10m,uv_index,weather_code&forecast_days=7`.
No key. Wire in `loadNatural()` for each saved place.

### P2 — NOAA CO-OPS flood gauges

**What's missing:** `/api/floods/gauges` exists but the underlying data source
is not the free NOAA CO-OPS API. NOAA CO-OPS provides real-time water levels
for 1,000+ US stations at no cost, with an easily-cacheable JSON API.

**Add:** Replace or supplement the existing `/api/floods/gauges` fetch with
`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&...`
for the nearest stations to saved places.

### P3 — EONET sidecar route (low priority)

**What's missing:** NASA EONET is fetched directly from the browser without going
through the sidecar. This means: (a) CORS may block it in the web build; (b) the
sidecar's feed-health tracker doesn't record EONET health. The C3 PR closes the
intelligence-layer gap (EONET now ingests into unifiedAlertStore). The sidecar
route would add resilience and health tracking.

**Add:** `/api/eonet-events` route in the sidecar proxying
`https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7&limit=200` with
15-minute cache. Update `fetchNaturalEvents()` in `src/services/eonet.ts` to use
the sidecar route instead of the direct fetch.

## What already works at 0 keys

The following feeds produce signal with zero API keys loaded:

- USGS earthquakes (public REST)
- NWS weather alerts (US, public REST)
- GDACS disasters (public RSS/JSON)
- NASA EONET (public REST → now ingested into intelligence layer)
- NOAA SWPC space weather (public JSON)
- Open-Meteo current weather (no-key, non-commercial)
- Open-Meteo air quality (no-key)
- INPE fires (no-key fallback for FIRMS)

At 0 keys, the intelligence layer has access to ~7 active no-key feeds.
The primary bottleneck is the analyst-loop's LLM grader (requires Anthropic/Groq key)
and the structured-data panels (markets, aviation, cyber). These degrade gracefully
to empty rather than crashing.
