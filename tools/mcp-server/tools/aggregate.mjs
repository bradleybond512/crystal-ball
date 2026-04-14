function makeResponse(summary, data, sources, warnings = []) {
  return {
    summary,
    data,
    sources,
    warnings,
    timestamp: new Date().toISOString(),
    healthy: true,
  };
}

function extractWarnings(results) {
  const warnings = [];
  for (const [route, data] of results) {
    if (data?.error) warnings.push(`${route}: ${data.error}`);
  }
  return warnings;
}

export function makeAggregateTools(client) {
  async function get_sitrep() {
    const routes = ['/api/market-quotes', '/api/acled-events', '/api/nws-alerts', '/api/service-status'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const markets = results.get('/api/market-quotes');
    const conflicts = results.get('/api/acled-events');
    const alerts = results.get('/api/nws-alerts');
    const status = results.get('/api/service-status');

    const conflictCount = conflicts?.events?.length ?? 0;
    const alertCount = Array.isArray(alerts) ? alerts.length : 0;
    const quoteSummary = markets?.quotes?.slice(0, 3).map(q => `${q.symbol}: ${q.price}`).join(', ') || 'unavailable';

    const summary = `Situational report: ${conflictCount} conflict events, ${alertCount} weather alerts. Markets: ${quoteSummary}.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      conflicts: conflicts?.events || [],
      markets: markets?.quotes || [],
      alerts: Array.isArray(alerts) ? alerts : [],
      serviceHealth: status || {},
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_threat_landscape() {
    const routes = ['/api/acled-events', '/api/threatfox-iocs', '/api/cisa-kev', '/api/oref-alerts', '/api/liveuamap'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const conflicts = results.get('/api/acled-events');
    const iocs = results.get('/api/threatfox-iocs');
    const kevs = results.get('/api/cisa-kev');
    const oref = results.get('/api/oref-alerts');
    const uamap = results.get('/api/liveuamap');

    const conflictCount = conflicts?.events?.length ?? 0;
    const iocCount = iocs?.data?.length ?? iocs?.length ?? 0;
    const kevCount = kevs?.vulnerabilities?.length ?? kevs?.length ?? 0;

    const summary = `Threat landscape: ${conflictCount} conflict events, ${iocCount} IOCs, ${kevCount} KEVs.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      conflicts: conflicts?.events || [],
      cyberThreats: iocs?.data || iocs || [],
      kevs: kevs?.vulnerabilities || kevs || [],
      crisisAlerts: [
        ...(oref?.alerts || oref || []),
        ...(uamap?.events || uamap || []),
      ],
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_market_overview() {
    const routes = ['/api/market-quotes', '/api/crypto-quotes', '/api/btc-etf-flows', '/api/macro-signals', '/api/fear-greed', '/api/wsb-sentiment'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const quotes = results.get('/api/market-quotes');
    const crypto = results.get('/api/crypto-quotes');
    const etf = results.get('/api/btc-etf-flows');
    const macro = results.get('/api/macro-signals');
    const fg = results.get('/api/fear-greed');
    const wsb = results.get('/api/wsb-sentiment');

    const fgLabel = fg?.label || fg?.value_classification || 'unknown';
    const fgValue = fg?.value ?? fg?.fgi?.now?.value ?? '?';

    const summary = `Markets overview: Fear & Greed at ${fgValue} (${fgLabel}).${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      indices: quotes?.quotes || [],
      crypto: crypto?.prices || crypto || [],
      etfFlows: etf?.flows || etf || {},
      sentiment: { fearGreed: fg, wsb: wsb },
      macroRegime: macro?.signals || macro || {},
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_cyber_intel() {
    const routes = ['/api/threatfox-iocs', '/api/cisa-kev', '/api/openphish-feed', '/api/urlhaus', '/api/otx-pulses'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const iocs = results.get('/api/threatfox-iocs');
    const kevs = results.get('/api/cisa-kev');
    const phishing = results.get('/api/openphish-feed');
    const malware = results.get('/api/urlhaus');
    const pulses = results.get('/api/otx-pulses');

    const iocCount = iocs?.data?.length ?? 0;
    const kevCount = kevs?.vulnerabilities?.length ?? kevs?.length ?? 0;

    const summary = `Cyber intel: ${iocCount} IOCs, ${kevCount} KEVs.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      iocs: iocs?.data || [],
      kevs: kevs?.vulnerabilities || kevs || [],
      phishing: phishing || [],
      malwareUrls: malware || [],
      threatPulses: pulses?.results || pulses || [],
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_weather_environment() {
    const routes = ['/api/owm-current', '/api/nws-alerts', '/api/donki-events', '/api/space-weather-feeds'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const weather = results.get('/api/owm-current');
    const alerts = results.get('/api/nws-alerts');
    const donki = results.get('/api/donki-events');
    const space = results.get('/api/space-weather-feeds');

    const alertCount = Array.isArray(alerts) ? alerts.length : 0;

    const summary = `Environment: ${alertCount} weather alerts active.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      weather: weather?.cities || weather || [],
      alerts: Array.isArray(alerts) ? alerts : [],
      spaceWeather: { donki: donki || [], feeds: space || {} },
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_infrastructure_status() {
    const routes = ['/api/power-grid', '/api/grid-alerts', '/api/epa-sdwis-proxy', '/api/epa-radnet-proxy', '/api/usgs-water-proxy'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const grid = results.get('/api/power-grid');
    const gridAlerts = results.get('/api/grid-alerts');
    const water = results.get('/api/epa-sdwis-proxy');
    const radiation = results.get('/api/epa-radnet-proxy');
    const usgs = results.get('/api/usgs-water-proxy');

    const alertCount = gridAlerts?.alerts?.length ?? (Array.isArray(gridAlerts) ? gridAlerts.length : 0);

    const summary = `Infrastructure: ${alertCount} grid alerts.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      powerGrid: grid || {},
      gridAlerts: gridAlerts?.alerts || gridAlerts || [],
      waterQuality: water || {},
      radiation: radiation || {},
      waterResources: usgs || {},
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  async function get_military_posture() {
    const routes = ['/api/adsb-military', '/api/ais-snapshot', '/api/military/v1/get-theater-posture', '/api/isw-reports'];
    const results = await client.getAll(routes);
    const warnings = extractWarnings(results);

    const flights = results.get('/api/adsb-military');
    const vessels = results.get('/api/ais-snapshot');
    const posture = results.get('/api/military/v1/get-theater-posture');
    const isw = results.get('/api/isw-reports');

    const flightCount = flights?.aircraft?.length ?? (Array.isArray(flights) ? flights.length : 0);
    const vesselCount = vessels?.vessels?.length ?? (Array.isArray(vessels) ? vessels.length : 0);

    const summary = `Military posture: ${flightCount} tracked aircraft, ${vesselCount} tracked vessels.${warnings.length ? ` (${warnings.length} source(s) unavailable)` : ''}`;

    return makeResponse(summary, {
      militaryFlights: flights?.aircraft || flights || [],
      navalVessels: vessels?.vessels || vessels || [],
      theaterPosture: posture || {},
      iswAnalysis: isw?.reports || isw || [],
    }, routes.filter(r => !results.get(r)?.error), warnings);
  }

  return {
    get_sitrep,
    get_threat_landscape,
    get_market_overview,
    get_cyber_intel,
    get_weather_environment,
    get_infrastructure_status,
    get_military_posture,
  };
}
