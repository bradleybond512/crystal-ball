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

export function makeGranularTools(client) {
  async function search_conflicts({ region, country, date_from, date_to, event_type } = {}) {
    const params = {};
    if (region) params.region = region;
    if (country) params.country = country;
    if (date_from) params.date_from = date_from;
    if (date_to) params.date_to = date_to;
    if (event_type) params.event_type = event_type;

    const data = await client.get('/api/acled-events', params);
    const events = data?.events || [];
    return makeResponse(
      `Found ${events.length} conflict events${country ? ` in ${country}` : ''}.`,
      { events },
      ['/api/acled-events'],
    );
  }

  async function search_news({ query, category, country } = {}) {
    const params = {};
    if (query) params.q = query;
    if (category) params.category = category;
    if (country) params.country = country;

    const routes = ['/api/newsapi-headlines', '/api/newsdata-feed', '/api/dod-news', '/api/nato-news'];
    const results = await client.getAll(routes);
    const warnings = [];
    const articles = [];

    for (const [route, data] of results) {
      if (data?.error) { warnings.push(`${route}: ${data.error}`); continue; }
      const items = data?.articles || data?.results || data?.items || (Array.isArray(data) ? data : []);
      articles.push(...items);
    }

    return makeResponse(
      `Found ${articles.length} news articles${query ? ` matching "${query}"` : ''}.`,
      { articles },
      routes.filter(r => !results.get(r)?.error),
      warnings,
    );
  }

  async function lookup_ip({ ip }) {
    const [greynoise, abuseipdb, ipinfo] = await Promise.all([
      client.get('/api/greynoise-lookup', { ip }),
      client.get('/api/abuseipdb-reports', { ip }),
      client.get('/api/ipinfo-lookup', { ip }),
    ]);

    const warnings = [];
    if (greynoise?.error) warnings.push(`greynoise: ${greynoise.error}`);
    if (abuseipdb?.error) warnings.push(`abuseipdb: ${abuseipdb.error}`);
    if (ipinfo?.error) warnings.push(`ipinfo: ${ipinfo.error}`);

    const classification = greynoise?.classification || 'unknown';
    const abuseScore = abuseipdb?.data?.abuseConfidenceScore ?? 'N/A';
    const location = ipinfo?.city ? `${ipinfo.city}, ${ipinfo.country}` : 'unknown';

    return makeResponse(
      `IP ${ip}: ${classification} (abuse score: ${abuseScore}, location: ${location}).`,
      { greynoise, abuseipdb, ipinfo },
      ['/api/greynoise-lookup', '/api/abuseipdb-reports', '/api/ipinfo-lookup'],
      warnings,
    );
  }

  async function lookup_cve({ query }) {
    const data = await client.get('/api/vulners-search', { query });
    const results = data?.data?.search || data?.results || [];
    return makeResponse(
      `Found ${results.length} CVE results for "${query}".`,
      { results },
      ['/api/vulners-search'],
    );
  }

  async function lookup_vessel({ mmsi, name }) {
    const params = {};
    if (mmsi) params.mmsi = mmsi;
    if (name) params.name = name;
    const data = await client.get('/api/ais-snapshot', params);
    const vessels = data?.vessels || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${vessels.length} vessel(s)${name ? ` matching "${name}"` : ''}.`,
      { vessels },
      ['/api/ais-snapshot'],
    );
  }

  async function lookup_flight({ hex, callsign }) {
    const params = {};
    if (hex) params.hex = hex;
    if (callsign) params.callsign = callsign;
    const data = await client.get('/api/adsb-military', params);
    const aircraft = data?.aircraft || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${aircraft.length} military aircraft${callsign ? ` matching "${callsign}"` : ''}.`,
      { aircraft },
      ['/api/adsb-military'],
    );
  }

  async function get_sanctions({ name, country }) {
    const params = {};
    if (name) params.q = name;
    if (country) params.country = country;
    const data = await client.get('/api/opensanctions-search', params);
    const results = data?.results || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${results.length} sanctions matches${name ? ` for "${name}"` : ''}.`,
      { results },
      ['/api/opensanctions-search'],
    );
  }

  async function get_economic_data({ series_ids }) {
    const data = await client.get('/api/fred-series', { ids: series_ids });
    return makeResponse(
      `FRED data for ${series_ids}.`,
      data,
      ['/api/fred-series'],
    );
  }

  async function get_sec_filings({ query, type }) {
    const params = {};
    if (query) params.q = query;
    if (type) params.type = type;
    const route = query ? '/api/edgar-search' : '/api/edgar-filings';
    const data = await client.get(route, params);
    const filings = data?.filings || data?.results || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${filings.length} SEC filings${query ? ` matching "${query}"` : ''}.`,
      { filings },
      [route],
    );
  }

  async function get_earthquakes({ min_magnitude, region }) {
    const params = {};
    if (min_magnitude) params.minmagnitude = min_magnitude;
    if (region) params.region = region;
    const data = await client.get('/api/usgs-earthquakes', params);
    const quakes = data?.features || (Array.isArray(data) ? data : []);
    return makeResponse(
      `Found ${quakes.length} earthquakes${min_magnitude ? ` above M${min_magnitude}` : ''}.`,
      { earthquakes: quakes },
      ['/api/usgs-earthquakes'],
    );
  }

  async function get_disease_outbreaks({ region } = {}) {
    const routes = ['/api/disease-outbreaks', '/api/disease-intel'];
    const results = await client.getAll(routes);
    const warnings = [];
    const outbreaks = [];

    for (const [route, data] of results) {
      if (data?.error) { warnings.push(`${route}: ${data.error}`); continue; }
      const items = data?.outbreaks || data?.events || (Array.isArray(data) ? data : []);
      outbreaks.push(...items);
    }

    return makeResponse(
      `Found ${outbreaks.length} disease outbreak reports${region ? ` for ${region}` : ''}.`,
      { outbreaks },
      routes.filter(r => !results.get(r)?.error),
      warnings,
    );
  }

  async function get_region_brief({ place_name, lat, lon }) {
    let location = { name: place_name, lat, lon };
    if (place_name && (!lat || !lon)) {
      const geo = await client.get('/api/geonames-search', { q: place_name });
      const match = geo?.geonames?.[0];
      if (match) {
        location = { name: match.name, lat: parseFloat(match.lat), lon: parseFloat(match.lng) };
      }
    }

    const results = await client.getAll(['/api/acled-events', '/api/nws-alerts', '/api/owm-current']);
    const warnings = [];
    const conflicts = results.get('/api/acled-events');
    const alerts = results.get('/api/nws-alerts');
    const weather = results.get('/api/owm-current');
    if (conflicts?.error) warnings.push(`conflicts: ${conflicts.error}`);
    if (alerts?.error) warnings.push(`alerts: ${alerts.error}`);
    if (weather?.error) warnings.push(`weather: ${weather.error}`);

    return makeResponse(
      `Regional brief for ${location.name || 'unknown location'}.`,
      {
        location,
        conflicts: conflicts?.events || [],
        alerts: Array.isArray(alerts) ? alerts : [],
        weather: weather?.cities || weather || [],
      },
      ['/api/geonames-search', '/api/acled-events', '/api/nws-alerts', '/api/owm-current'],
      warnings,
    );
  }

  async function check_feed_health() {
    const health = await client.get('/api/health');
    const status = await client.get('/api/service-status');

    const probeRoutes = [
      '/api/acled-events',
      '/api/market-quotes',
      '/api/nws-alerts',
      '/api/threatfox-iocs',
      '/api/cisa-kev',
      '/api/adsb-military',
      '/api/ais-snapshot',
      '/api/isw-reports',
      '/api/owm-current',
      '/api/fear-greed',
    ];
    const results = await client.getAll(probeRoutes);

    const feeds = [];
    let healthy = 0;
    let degraded = 0;
    for (const route of probeRoutes) {
      const data = results.get(route);
      const ok = data && !data.error;
      feeds.push({ route, status: ok ? 'ok' : 'error', error: data?.error || null });
      if (ok) healthy++; else degraded++;
    }

    const sidecarOk = health && !health.error;
    const keyInfo = sidecarOk ? `${health.keys_configured}/${health.keys_total} API keys configured` : 'unknown';
    const missingKeyCount = sidecarOk && health.keys_missing_count ? health.keys_missing_count : 0;

    const summary = `Sidecar ${sidecarOk ? 'up' : 'DOWN'}. Feeds: ${healthy} healthy, ${degraded} degraded out of ${probeRoutes.length}. Keys: ${keyInfo}.${missingKeyCount ? ` Missing keys: ${missingKeyCount}.` : ''}`;

    return makeResponse(summary, {
      sidecar: sidecarOk ? {
        pid: health.pid,
        uptime_ms: health.uptime_ms,
        rss_mb: health.rss_mb,
        ais_connected: health.ais_connected,
        ais_vessels: health.ais_vessels,
        keys_configured: health.keys_configured,
        keys_total: health.keys_total,
        keys_missing_count: missingKeyCount,
      } : { error: health?.error || 'unreachable' },
      serviceStatus: status || {},
      feeds,
    }, ['/api/health', '/api/service-status', ...probeRoutes]);
  }

  return {
    search_conflicts,
    search_news,
    lookup_ip,
    lookup_cve,
    lookup_vessel,
    lookup_flight,
    get_sanctions,
    get_economic_data,
    get_sec_filings,
    get_earthquakes,
    get_disease_outbreaks,
    get_region_brief,
    check_feed_health,
  };
}
