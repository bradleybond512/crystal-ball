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

export function makeIntelExpansionTools(client) {
  async function get_cyber_threats({ kind = 'all' } = {}) {
    const routes = [];
    if (kind === 'all' || kind === 'c2') routes.push('/api/cyber-c2');
    if (kind === 'all' || kind === 'iocs') routes.push('/api/cyber-iocs');
    if (kind === 'all' || kind === 'urls') routes.push('/api/malware-urls');

    const results = await client.getAll(routes);
    const warnings = [];
    const c2 = kind === 'all' || kind === 'c2' ? results.get('/api/cyber-c2') : null;
    const iocs = kind === 'all' || kind === 'iocs' ? results.get('/api/cyber-iocs') : null;
    const urls = kind === 'all' || kind === 'urls' ? results.get('/api/malware-urls') : null;

    if (c2?.error) warnings.push(`cyber-c2: ${c2.error}`);
    if (iocs?.error) warnings.push(`cyber-iocs: ${iocs.error}`);
    if (urls?.error) warnings.push(`malware-urls: ${urls.error}`);

    const c2List = c2?.error ? [] : (c2?.servers || c2?.results || (Array.isArray(c2) ? c2 : []));
    const iocList = iocs?.error ? [] : (iocs?.iocs || iocs?.results || (Array.isArray(iocs) ? iocs : []));
    const urlList = urls?.error ? [] : (urls?.urls || urls?.results || (Array.isArray(urls) ? urls : []));

    const parts = [];
    if (c2List.length) parts.push(`${c2List.length} C2 servers`);
    if (iocList.length) parts.push(`${iocList.length} IOCs`);
    if (urlList.length) parts.push(`${urlList.length} malware URLs`);

    return makeResponse(
      parts.length ? `Cyber threats: ${parts.join(', ')}.` : 'No cyber threat data available.',
      {
        c2_servers: c2List.slice(0, 20),
        iocs: iocList.slice(0, 20),
        malware_urls: urlList.slice(0, 20),
      },
      routes.filter(r => !results.get(r)?.error),
      warnings,
    );
  }

  async function get_chokepoint_status() {
    const data = await client.get('/api/chokepoint-transits');
    const transits = data?.transits || data?.chokepoints || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    const summary = transits.length
      ? `${transits.length} chokepoint(s) reporting: ${transits.map(t => t.name || t.chokepoint || 'unknown').slice(0, 5).join(', ')}.`
      : 'No chokepoint transit data available.';

    return makeResponse(summary, { transits }, ['/api/chokepoint-transits'], warnings);
  }

  async function get_internet_outages({ hours = 24 } = {}) {
    const data = await client.get('/api/internet-outages', { hours });
    const alerts = data?.alerts || data?.outages || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    return makeResponse(
      `Found ${alerts.length} internet outage alert(s) in the past ${hours}h.`,
      { alerts: alerts.slice(0, 20) },
      ['/api/internet-outages'],
      warnings,
    );
  }

  async function get_space_weather_extra() {
    const data = await client.get('/api/spaceweather-extra');
    const warnings = data?.error ? [data.error] : [];

    const auroraMax = data?.aurora_max_pct ?? data?.aurora?.max_pct ?? null;
    const highLat = data?.high_lat_flag ?? data?.aurora?.high_lat ?? false;
    const regions = data?.flare_probability_regions || data?.flare_regions || [];

    const parts = [];
    if (auroraMax != null) parts.push(`aurora max ${auroraMax}%`);
    if (highLat) parts.push('high-latitude activity flagged');
    if (regions.length) parts.push(`${regions.length} flare-probability region(s)`);

    return makeResponse(
      parts.length ? `Space weather: ${parts.join(', ')}.` : 'No extended space weather data available.',
      {
        aurora_max_pct: auroraMax,
        high_lat_flag: highLat,
        flare_probability_regions: regions.slice(0, 10),
      },
      ['/api/spaceweather-extra'],
      warnings,
    );
  }

  async function get_pharma_supply() {
    const routes = ['/api/pharma-shortages', '/api/recalls'];
    const [shortagesData, recallsData] = await Promise.all([
      client.get('/api/pharma-shortages'),
      client.get('/api/recalls', { type: 'drug' }),
    ]);

    const warnings = [];
    if (shortagesData?.error) warnings.push(`pharma-shortages: ${shortagesData.error}`);
    if (recallsData?.error) warnings.push(`recalls: ${recallsData.error}`);

    const shortages = shortagesData?.error ? [] : (shortagesData?.shortages || shortagesData?.results || (Array.isArray(shortagesData) ? shortagesData : []));
    const recalls = recallsData?.error ? [] : (recallsData?.recalls || recallsData?.results || (Array.isArray(recallsData) ? recallsData : []));

    return makeResponse(
      `Pharma supply: ${shortages.length} shortage(s), ${recalls.length} drug recall(s).`,
      {
        shortages: shortages.slice(0, 20),
        recalls: recalls.slice(0, 20),
      },
      routes.filter((_, i) => ![shortagesData, recallsData][i]?.error),
      warnings,
    );
  }

  async function get_grid_outages() {
    const data = await client.get('/api/grid-outages');
    const counties = data?.counties || data?.outages || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    const sorted = [...counties].sort((a, b) => (b.metersAffected ?? b.customers ?? 0) - (a.metersAffected ?? a.customers ?? 0));
    const totalMeters = counties.reduce((s, c) => s + (c.metersAffected ?? c.customers ?? 0), 0);

    return makeResponse(
      `Grid outages: ${counties.length} county/region(s) reporting, ~${totalMeters.toLocaleString()} meters affected.`,
      { counties: sorted.slice(0, 20) },
      ['/api/grid-outages'],
      warnings,
    );
  }

  async function get_disaster_activations() {
    const data = await client.get('/api/ems-activations');
    const activations = data?.activations || data?.events || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    return makeResponse(
      `Copernicus EMS: ${activations.length} disaster activation(s).`,
      { activations: activations.slice(0, 20) },
      ['/api/ems-activations'],
      warnings,
    );
  }

  async function lookup_entity({ name }) {
    const data = await client.get('/api/entity-lei', { name });
    const results = data?.data || data?.results || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    return makeResponse(
      `GLEIF LEI lookup for "${name}": ${results.length} result(s).`,
      { results: results.slice(0, 20) },
      ['/api/entity-lei'],
      warnings,
    );
  }

  async function get_aviation_hazards() {
    const [hazardsData, nasData] = await Promise.all([
      client.get('/api/aviation-hazards'),
      client.get('/api/faa-nas-status'),
    ]);

    const warnings = [];
    if (hazardsData?.error) warnings.push(`aviation-hazards: ${hazardsData.error}`);
    if (nasData?.error) warnings.push(`faa-nas-status: ${nasData.error}`);

    const sigmets = hazardsData?.error ? [] : (hazardsData?.sigmets || hazardsData?.results || (Array.isArray(hazardsData) ? hazardsData : []));
    const groundStops = nasData?.error ? [] : (nasData?.ground_stops || nasData?.programs || nasData?.results || (Array.isArray(nasData) ? nasData : []));

    return makeResponse(
      `Aviation: ${sigmets.length} SIGMET(s), ${groundStops.length} FAA NAS program(s).`,
      {
        sigmets: sigmets.slice(0, 20),
        ground_stops: groundStops.slice(0, 20),
      },
      ['/api/aviation-hazards', '/api/faa-nas-status'].filter((_, i) => ![hazardsData, nasData][i]?.error),
      warnings,
    );
  }

  async function get_fx_rates({ base = 'USD', symbols } = {}) {
    const params = { base };
    if (symbols) params.symbols = symbols;
    const data = await client.get('/api/fx-rates', params);
    const rates = data?.rates || {};
    const warnings = data?.error ? [data.error] : [];

    const rateCount = Object.keys(rates).length;
    const symbolsDesc = symbols ? ` (${symbols})` : '';

    return makeResponse(
      `FX rates vs ${base}${symbolsDesc}: ${rateCount} currency pair(s).`,
      { base: data?.base || base, date: data?.date, rates },
      ['/api/fx-rates'],
      warnings,
    );
  }

  async function get_geo_events({ query, timespan = 60 }) {
    const data = await client.get('/api/gdelt-geo', { query, timespan });
    const events = data?.events || data?.features || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    return makeResponse(
      `GDELT geo-events for "${query}" (${timespan}min): ${events.length} result(s).`,
      { events: events.slice(0, 20) },
      ['/api/gdelt-geo'],
      warnings,
    );
  }

  async function get_radiation() {
    const data = await client.get('/api/radiation-grid');
    const stations = data?.stations || data?.measurements || (Array.isArray(data) ? data : []);
    const warnings = data?.error ? [data.error] : [];

    const maxDose = stations.reduce((m, s) => Math.max(m, s.gamma_dose ?? s.dose ?? 0), 0);

    return makeResponse(
      `BfS radiation grid: ${stations.length} station(s), max gamma dose ${maxDose} nSv/h.`,
      { stations: stations.slice(0, 20) },
      ['/api/radiation-grid'],
      warnings,
    );
  }

  return {
    get_cyber_threats,
    get_chokepoint_status,
    get_internet_outages,
    get_space_weather_extra,
    get_pharma_supply,
    get_grid_outages,
    get_disaster_activations,
    lookup_entity,
    get_aviation_hazards,
    get_fx_rates,
    get_geo_events,
    get_radiation,
  };
}
