const SAFE_AGENT_QUERY_ROUTES = new Set([
  '/api/abuseipdb-reports',
  '/api/acled-events',
  '/api/adsb-military',
  '/api/ais-snapshot',
  '/api/aviation-hazards',
  '/api/btc-etf-flows',
  '/api/chokepoint-transits',
  '/api/cisa-kev',
  '/api/crypto-quotes',
  '/api/cyber-c2',
  '/api/cyber-iocs',
  '/api/disease-intel',
  '/api/disease-outbreaks',
  '/api/dod-news',
  '/api/donki-events',
  '/api/edgar-filings',
  '/api/edgar-search',
  '/api/ems-activations',
  '/api/entity-lei',
  '/api/epa-radnet-proxy',
  '/api/epa-sdwis-proxy',
  '/api/faa-nas-status',
  '/api/fear-greed',
  '/api/feeds/health',
  '/api/fred-series',
  '/api/fx-rates',
  '/api/gdelt-geo',
  '/api/geonames-search',
  '/api/greynoise-lookup',
  '/api/grid-alerts',
  '/api/grid-outages',
  '/api/health',
  '/api/internet-outages',
  '/api/ipinfo-lookup',
  '/api/isw-reports',
  '/api/liveuamap',
  '/api/macro-signals',
  '/api/malware-urls',
  '/api/market-quotes',
  '/api/military/v1/get-theater-posture',
  '/api/nato-news',
  '/api/newsapi-headlines',
  '/api/newsdata-feed',
  '/api/nws-alerts',
  '/api/openphish-feed',
  '/api/opensanctions-search',
  '/api/oref-alerts',
  '/api/otx-pulses',
  '/api/owm-current',
  '/api/pharma-shortages',
  '/api/power-grid',
  '/api/radiation-grid',
  '/api/recalls',
  '/api/service-status',
  '/api/sitrep-bundle',
  '/api/space-weather-feeds',
  '/api/spaceweather-extra',
  '/api/threatfox-iocs',
  '/api/urlhaus',
  '/api/usgs-earthquakes',
  '/api/usgs-water-proxy',
  '/api/vulners-search',
  '/api/wsb-sentiment',
]);

export function isAgentQueryRouteAllowed(route) {
  if (typeof route !== 'string') return false;
  if (route.includes('\\') || route.includes('%') || route.includes('..')) return false;
  return SAFE_AGENT_QUERY_ROUTES.has(route);
}

export function validateAgentQueryRoutes(routes) {
  const denied = routes.find((route) => !isAgentQueryRouteAllowed(route));
  return denied
    ? { allowed: false, denied }
    : { allowed: true, denied: null };
}
