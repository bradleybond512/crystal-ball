# Crystal Ball Free API Source Expansion

Use this as a Claude-ready planning prompt for expanding Crystal Ball's free and free-tier API coverage.

```md
Crystal Ball API expansion task: find free or free-tier API/data sources we can add for redundancy, corroboration, and richer intelligence. Prioritize sources that are no-key, free-key, public-sector, academic, or open-data. Avoid paid-only unless uniquely valuable.

Goal: build a provider-fusion roadmap where each domain has multiple independent sources, source health, freshness, confidence scoring, and graceful fallback.

## P0: Highest-Value Free / Free-Tier Additions

### Aviation / ADS-B / Airports
1. Airplanes.live - free/community ADS-B REST API. OpenSky fallback. https://airplanes.live/api-docs/
2. ADSB.lol - community ADS-B API. Backup ADS-B source. https://api.adsb.lol/docs
3. ADSB.fi - community ADS-B network/API. Backup ADS-B source. https://www.adsb.fi/
4. AviationWeather.gov - NOAA METAR, TAF, PIREP, SIGMET/AIRMET. No key. https://aviationweather.gov/data/api/
5. AviationAPI - FAA airports, charts, weather, NOTAM-style aviation data. Public/no-key for many endpoints. https://docs.aviationapi.com/
6. OpenAIP - worldwide aviation database: airspaces, navaids, airports. Free developer API. https://www.openaip.net/
7. OurAirports - free airport/runway/navaid CSV data. https://ourairports.com/data/
8. ADSBDB - aircraft metadata by ICAO/registration/type. https://www.adsbdb.com/

### Weather / Hazards
9. NWS API - official US alerts, forecasts, gridpoints, observations. No key. https://www.weather.gov/documentation/services-web-api
10. Open-Meteo Forecast API - global forecast, no key for non-commercial use. https://open-meteo.com/en/docs
11. Open-Meteo Air Quality API - PM2.5, ozone, dust, UV, pollen. https://open-meteo.com/en/docs/air-quality-api
12. Open-Meteo Marine API - waves, swell, sea surface data. https://open-meteo.com/en/docs/marine-weather-api
13. Open-Meteo Flood API - river discharge/flood risk. https://open-meteo.com/en/docs/flood-api
14. NASA EONET v3 - global natural events: fires, storms, volcanoes, dust, sea/lake ice. https://eonet.gsfc.nasa.gov/docs/v3
15. GDACS API - global disaster alerts, free GeoJSON API. https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf
16. USGS Water Data APIs - real-time river gauges, water levels, discharge. https://www.usgs.gov/tools/usgs-water-data-apis
17. NOAA NDBC - buoy observations, marine weather. https://www.ndbc.noaa.gov/
18. NOAA CO-OPS - tides, currents, water levels. https://api.tidesandcurrents.noaa.gov/api/prod/
19. NOAA SWPC - space weather alerts/products. https://services.swpc.noaa.gov/
20. NASA DONKI - CME, flares, geomagnetic storms, space weather. https://api.nasa.gov/
21. RainViewer - radar tiles/API. https://www.rainviewer.com/api.html
22. OpenAQ - air quality observations. https://docs.openaq.org/
23. InciWeb - US wildfire incident data. https://inciweb.wildfire.gov/
24. NASA FIRMS - satellite fire detections. Already supported, expand use. https://firms.modaps.eosdis.nasa.gov/api/

### Conflict / Humanitarian / Disaster
25. UCDP API - conflict events, public academic source. https://ucdp.uu.se/apidocs/
26. GDELT 2.0 - global news/events/GKG/geocoding. https://www.gdeltproject.org/
27. ReliefWeb API - humanitarian reports, disasters, updates. https://apidoc.reliefweb.int/
28. HDX HAPI - humanitarian indicators, operational presence, food/security/population. https://hapi.humdata.org/
29. WHO Disease Outbreak News API - disease outbreak notices. https://www.who.int/api/emergencies/diseaseoutbreaknews/sfhelp
30. CDC Content Services API - CDC articles, updates, public health content. https://tools.cdc.gov/api/docs/info.aspx
31. UNHCR Refugee Data API - displacement/population data. https://api.unhcr.org/docs/
32. IOM DTM - displacement tracking datasets. https://dtm.iom.int/
33. WorldPop - gridded population exposure. https://www.worldpop.org/
34. World Bank API - macro, development, population, agriculture, health. https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information

### Cyber / Threat Intelligence
35. CISA KEV Catalog - exploited vulnerabilities. https://www.cisa.gov/known-exploited-vulnerabilities-catalog
36. NVD API 2.0 - CVEs/CPEs/CVSS. https://nvd.nist.gov/developers
37. FIRST EPSS - exploit probability scores. https://www.first.org/epss/
38. CIRCL CVE API - CVE lookup fallback. https://cve.circl.lu/
39. URLhaus - malicious URL feed/API. https://urlhaus.abuse.ch/api/
40. ThreatFox - malware IOC feed/API. https://threatfox.abuse.ch/api/
41. Feodo Tracker - botnet C2 blocklists. https://feodotracker.abuse.ch/
42. SSLBL - malicious SSL cert/IP lists. https://sslbl.abuse.ch/
43. AlienVault OTX - free API key threat pulses. https://otx.alienvault.com/api/
44. MISP CIRCL OSINT feeds - free MISP threat feeds. https://www.circl.lu/doc/misp/feed-osint/
45. Shodan InternetDB - free no-key IP exposure lookup. https://internetdb.shodan.io/
46. crt.sh - certificate transparency search, no key. https://crt.sh/
47. Team Cymru Bogon / Fullbogon feeds - routing hygiene. https://team-cymru.org/community-services/bogon-reference/
48. Spamhaus DROP/EDROP - free IP drop lists. https://www.spamhaus.org/drop/

### Markets / Macro / Finance
49. SEC EDGAR APIs - filings/company facts. https://www.sec.gov/search-filings/edgar-application-programming-interfaces
50. Treasury Fiscal Data API - debt, auctions, receipts, spending. https://fiscaldata.treasury.gov/api-documentation/
51. BLS Public Data API - CPI, jobs, inflation, labor. https://www.bls.gov/developers/
52. BEA API - GDP, income, trade, regional economics. https://apps.bea.gov/API/
53. Census API - population/economic/demographic data. https://www.census.gov/data/developers.html
54. IMF Data API / SDMX - macro, reserves, financial indicators. https://data.imf.org/
55. OECD Data API / SDMX - country indicators. https://data-explorer.oecd.org/
56. ECB Data Portal API - rates, FX, euro area indicators. https://data.ecb.europa.eu/help/api/overview
57. BIS statistics - policy rates, credit, FX, banking. Already partly supported; expand. https://www.bis.org/statistics/
58. Stooq - free market CSV quotes. https://stooq.com/db/
59. Alpha Vantage - free key market/fx/crypto fallback. https://www.alphavantage.co/documentation/
60. Nasdaq Data Link - many free datasets. https://docs.data.nasdaq.com/
61. CoinGecko - crypto/stablecoin fallback. https://docs.coingecko.com/
62. DefiLlama - DeFi TVL/stablecoins/yields, no key. https://defillama.com/docs/api
63. CoinCap - crypto prices, free tier. https://docs.coincap.io/
64. Binance public API - crypto spot/futures reference. https://developers.binance.com/docs/binance-spot-api-docs/rest-api
65. Coinbase Exchange API - crypto price/orderbook fallback. https://docs.cdp.coinbase.com/exchange/reference

### Maritime / Supply Chain
66. AISStream - current source; keep as primary free live AIS. https://aisstream.io/
67. AISHub - AIS sharing network; useful if we can feed/share. https://www.aishub.net/
68. MarineCadastre AIS - US historical AIS downloads. https://marinecadastre.gov/ais/
69. NGA Maritime Safety Information - nav warnings. Current source; expand parsing. https://msi.nga.mil/
70. NOAA nowCOAST - marine/weather/ocean map services. https://nowcoast.noaa.gov/
71. NOAA ERDDAP - ocean/climate datasets. https://coastwatch.pfeg.noaa.gov/erddap/
72. UN Comtrade API - trade flows. https://comtradeapi.un.org/
73. WTO API - trade indicators, current key support. https://apiportal.wto.org/
74. World Port Index / NGA - ports reference data. https://msi.nga.mil/Publications/WPI

### Infrastructure / Internet / Geo
75. RIPEstat API - ASN, BGP, routing, prefix data. https://stat.ripe.net/docs/
76. RIPE Atlas API - network probes/measurements. https://atlas.ripe.net/docs/apis/
77. PeeringDB API - networks, IXPs, facilities. https://www.peeringdb.com/apidocs/
78. BGPView API - ASN/prefix lookup. Current key exists; expand redundancy. https://bgpview.io/
79. ipapi.is - IP hosting/VPN/ASN/security signals, free daily limit. https://ipapi.is/
80. IPinfo Lite/Free - IP geo/ASN. Current key support. https://ipinfo.io/developers
81. Overpass API - OSM infrastructure/geofence/query enrichment. https://wiki.openstreetmap.org/wiki/Overpass_API
82. Nominatim - OSM geocoding, use carefully under usage policy. https://nominatim.org/release-docs/latest/api/Overview/
83. Wikidata SPARQL - entity enrichment, facilities, orgs, locations. https://query.wikidata.org/
84. Wikipedia REST API - article/summary context. https://www.mediawiki.org/wiki/API:REST_API
85. Natural Earth - public domain basemap/vector data. https://www.naturalearthdata.com/
86. GADM - admin boundaries. https://gadm.org/
87. GeoNames - place names/geocoding, free username. https://www.geonames.org/export/web-services.html

### Transport / Roads / Rail
88. GTFS Schedule + GTFS Realtime feeds - transit disruptions by agency. https://gtfs.org/
89. 511.org Open Data - Bay Area transit/traffic GTFS/SIRI. https://511.org/open-data/transit
90. Road511 - free key, normalized US/Canada traffic/closures/cameras. https://road511.com/
91. US DOT BTS TranStats - aviation/transport statistics. https://www.transtats.bts.gov/
92. WZDx feeds - road work zones/closures from DOTs. https://www.transportation.gov/av/data/wzdx
93. Amtrak status feeds - current Crystal Ball source; expand route/event normalization. https://www.amtrak.com/

### Space / Satellite
94. CelesTrak GP/TLE API - satellites, debris, weather sats. https://celestrak.org/NORAD/documentation/gp-data-formats.php
95. Space-Track - free account, orbital catalog/conjunction data. https://www.space-track.org/documentation
96. NASA NeoWs - near-earth objects. https://api.nasa.gov/
97. NASA CMR / Earthdata Search API - earth observation metadata. https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html
98. Copernicus Data Space - Sentinel imagery/data access. https://documentation.dataspace.copernicus.eu/
99. USGS Landsat APIs - Landsat metadata/download. https://m2m.cr.usgs.gov/api/docs/json/

## Implementation Ask

Please create a ranked implementation plan for Crystal Ball:

1. Build a generic provider registry:
   - provider id
   - domain
   - auth type
   - base URL
   - rate limit notes
   - freshness TTL
   - confidence weight
   - fallback priority
   - feature flags
   - required/optional API key

2. Add provider health:
   - last success
   - last error
   - latency
   - stale/healthy/degraded/down
   - quota/rate-limit detection

3. Add source fusion scoring:
   - freshness score
   - provider reliability score
   - corroboration score
   - conflict/disagreement detection
   - final confidence label

4. First implementation batch:
   - Airplanes.live ADS-B fallback
   - AviationWeather.gov METAR/TAF/PIREP enrichment
   - Open-Meteo Flood + Marine expansion
   - FIRST EPSS + NVD enrichment for CVEs
   - SEC EDGAR + Treasury Fiscal Data for market/institutional intelligence
   - Overpass/Wikidata entity enrichment
   - CelesTrak/Space-Track expansion for satellite/debris risk

5. For each API, produce:
   - service file name
   - panel or fusion target
   - sidecar route if needed
   - caching TTL
   - failure behavior
   - tests to add
   - docs/API_KEYS.md update if a key is needed

Bias toward free/no-key sources first. Do not add paid-only sources unless they are optional premium fallbacks.
```

## Notes For Claude

Several sources above are already partially present in Crystal Ball. Treat those as opportunities for deeper integration, source health, fallback routing, or corroboration rather than duplicate panels.

Highest-signal first batch:

- Airplanes.live
- AviationWeather.gov
- Open-Meteo Flood + Marine
- NVD + FIRST EPSS
- SEC EDGAR + Treasury Fiscal Data
- Overpass + Wikidata
- CelesTrak + Space-Track
