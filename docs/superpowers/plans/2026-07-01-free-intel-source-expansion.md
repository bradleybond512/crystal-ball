# Free-Intel Source Expansion — Verified Build Catalog

**Date:** 2026-07-01
**Grounding:** 10-domain discovery workflow (80 sources surveyed). **Every Batch-1 endpoint below was curl-verified live.** De-duped against the 31 fusion providers + existing sidecar sources.

## Goal

Maximize independent free/public intelligence coverage. Each source = a sidecar route + a `ProviderDefinition` in `src/services/providers/provider-registry.ts` (with `independenceGroup`) + `recordProviderFetchOutcome` wiring, fixture-tested pure parser (no live fetch in tests), each feed its **own** DataSourceId (fail-closed). Non-commercial-only sources must be gated `licenseClass: non-commercial`.

## Batch 1 — build now (keyless, clean, curl-verified) — ~9 routes / 12 sources

| # | Source | Domain | New intel | Endpoint (verified) | Feeds |
|---|--------|--------|-----------|---------------------|-------|
| 1 | **IMF PortWatch** | maritime | chokepoint transit + trade-tons/day | ArcGIS `Daily_Chokepoints_Data/FeatureServer/0/query?where=...&f=json` | ShortageRadar (hard input) |
| 2 | **IODA v2** | internet | country/ASN blackout detection | `api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=&until=` | new modality; corroborates conflict/disaster/grid |
| 3-5 | **abuse.ch Feodo + ThreatFox + URLhaus** | cyber | live C2 IPs / IOCs / malware URLs | `feodotracker.abuse.ch/downloads/ipblocklist.json`, `threatfox.abuse.ch/export/csv/recent/`, `urlhaus.abuse.ch/downloads/csv_recent/` | enrich `lookup_ip`; globe C2 plot. **One `independenceGroup: 'abuse-ch'`** (shared operator — not 3 votes) |
| 6 | **Frankfurter (ECB FX)** | markets | fiat FX (zero coverage today) | `api.frankfurter.dev/v1/latest?base=USD` | new `fx` domain |
| 7 | **SWPC OVATION + Solar Regions** | space wx | aurora/GNSS grid + per-AR flare prob | `services.swpc.noaa.gov/json/ovation_aurora_latest.json`, `.../solar_regions.json` | **extend existing SWPC fan-out** (no new route) |
| 8 | **openFDA Drug Shortages + Enforcement** | health | pharma supply stress + drug/food recalls | `api.fda.gov/drug/shortages.json`, `api.fda.gov/drug/enforcement.json`, `api.fda.gov/food/enforcement.json` | **9th shortage model (pharma)** + personal-impact |
| 9 | **ORNL ODIN** | grid | real-time US county electric outages (GeoJSON) | `ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records` | datacenter/power-posture + personal-impact |
| 10 | **Copernicus EMS** | disaster | satellite-mapped disaster + damage extent | `mapping.emergency.copernicus.eu/activations/api/activations/?format=json` | corroborates GDACS/EONET |
| 11 | **AviationWeather isigmet/airsigmet/gairmet/pirep/tcf** | aviation | airspace hazards + pilot ground-truth | `aviationweather.gov/api/data/{isigmet,airsigmet,gairmet,pirep,tcf}` | **extend existing `aviationweather-gov`** |
| 12 | **FAA NAS Status** | aviation | ground stops/delays + cause | `nasstatus.faa.gov/api/airport-events` | corroborates SIGMET |
| 13 | **BfS ODL radiation** | nuclear | gov gamma-dose grid (GeoJSON) | `imis.bfs.de/ogc/opendata/ows?...odlinfo_odl_1h_latest` | corroborates Safecast |
| 14 | **GLEIF LEI** | entities | corporate identity + parent/child graph | `api.gleif.org/api/v1/lei-records?filter[entity.legalName]=` | lookup service + sanctions/SEC enrichment |
| 15 | **GDELT GKG geojson v1** | OSINT | geocoded media-event points | `api.gdeltproject.org/api/v1/gkg_geojson?QUERY=&TIMESPAN=` | situation-clustering + compound-risk. **NOT the 404'd GEO 2.0** |

## Batch 2 — free-key / medium effort

UN SC XML + OFAC SDN_ADVANCED XML (primary sanctions, commercial-safe) · OONI + RIPEstat (censorship + BGP, pairs with IODA) · NOAA CO-OPS datagetter (surge residual) · WHO FluNet (drop `$format`; avian AH5) + CDC RESP-NET · NASA POWER (climatology baseline for shortage models) · Copernicus Sentinel-1 OData + NASA FIRMS multi-sensor (reuse existing `NASA_FIRMS_API_KEY`, parameterize the hardcoded VIIRS route) · World Bank Indicators v2 · Tor exit list + Spamhaus DROP · free-key set: UCDP GED, EU FSF, USDA NASS, ReliefWeb v2, HDX HAPI ⚠️NC, Cloudflare Radar ⚠️NC, ransomware.live ⚠️NC.

## Batch 3 — websocket / scrape / gated

Wikimedia EventStreams (SSE edit-velocity) · AISStream.io (WS AIS, new key) · Global Fishing Watch ⚠️NC · NDBC DART + buoys (fixed-width parser) · NOAA Tsunami CAP/Atom · ENTSO-E (email key + XML) · FAA NOTAM (manual onboarding) · GOES-GLM lightning · USACE locks · EPA RadNet · PDC/SIPRI/TeleGeography/Comtrade context.

## Dropped (dup / non-viable)

OpenSky historical (dup + OAuth-gated) · SWPC planetary-K (already ingested) · EURDEP (per-provider license) · OpenNEM (deprecating) · Alpha Vantage (25 req/**day**) · gridstatus (dup EIA) · AISHub/aprs.fi (receiver-required / no-cache ToS) · HealthMap (re-aggregates ProMED) · GDELT GEO 2.0 (**404 confirmed**).

## Licensing flags (user-owned repo OK; gate `licenseClass: non-commercial`)

Cloudflare Radar (CC BY-NC) · Global Fishing Watch (NC) · ransomware.live (NC) · HDX HAPI/ACLED-derived (NC) · UCDP GED (CC BY, attribution) · UN Comtrade (soft) · attribution-required: PDC, SIPRI, TeleGeography, IODA/RIPEstat academic TOS.

## Batch 1 route shapes (mirror existing patterns)

Each: sidecar route → `ProviderDefinition` (`{ id, domain, displayName, authType:'none', baseUrl, rateLimitNote, freshnessTtlMs, reliabilityWeight, fallbackPriority, independenceGroup }`) → `recordProviderFetchOutcome`. See the synthesis in the run transcript for per-route detail. Key notes: abuse.ch trio share ONE independence group; Frankfurter uses a NEW `fx` domain (avoid fingerprint collision); SWPC pair extends `fetchSpaceweatherStatusSidecar` (no new route); AviationWeather set extends the existing provider; openFDA feeds a new `src/services/shortage/` pharma model.

## Top 5 intelligence gains

1. **IMF PortWatch** — measured chokepoint throughput replaces static Bosphorus/Suez/Hormuz assumptions in the shortage models.
2. **Internet-health triad (IODA + RIPEstat + OONI)** — a modality with zero current coverage; independent early corroborator for conflict/coup/disaster/grid.
3. **abuse.ch cyber trio** — first live-threat modality (app has only static vuln posture); geolocatable C2.
4. **openFDA → pharma shortage model** — extends the shortage engine into meds; personal-impact relevant.
5. **GLEIF + primary sanctions (UN SC + OFAC)** — entity backbone linking sanctions ↔ SEC ↔ vessel/flight lookups; enables divergence detection.
