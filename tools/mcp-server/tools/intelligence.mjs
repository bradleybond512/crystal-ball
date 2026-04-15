import { z } from 'zod';
import { extractEntities, correlate as correlateData } from '../correlation.mjs';

const DOMAIN_ROUTES = {
  conflicts: ['/api/acled-events'],
  markets: ['/api/market-quotes', '/api/crypto-quotes'],
  cyber: ['/api/threatfox-iocs', '/api/cisa-kev'],
  weather: ['/api/owm-current', '/api/nws-alerts'],
  military: ['/api/adsb-military', '/api/ais-snapshot'],
  health: ['/api/disease-outbreaks'],
};

const ALL_DOMAINS = Object.keys(DOMAIN_ROUTES);

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

function parseWindow(window = '7d') {
  const m = window.match(/^(\d+)([dhm])$/);
  if (!m) return 7 * 86400000;
  const val = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === 'd') return val * 86400000;
  if (unit === 'h') return val * 3600000;
  if (unit === 'm') return val * 60000;
  return 7 * 86400000;
}

function parseFilenameDate(filename) {
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.json$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
}

function extractMetrics(domain, snapshot) {
  const metrics = {};
  const data = snapshot?.[domain];
  if (!data) return metrics;

  if (domain === 'markets') {
    for (const q of data.quotes ?? []) {
      if (q?.symbol && q?.price != null) {
        metrics[`${q.symbol.toLowerCase()}_price`] = q.price;
      }
    }
  } else if (domain === 'conflicts') {
    const events = data.events ?? [];
    metrics.event_count = events.length;
    const byCountry = {};
    for (const ev of events) {
      if (ev?.country) {
        const key = `${ev.country.toLowerCase().replace(/\s+/g, '_')}_events`;
        byCountry[key] = (byCountry[key] || 0) + 1;
      }
    }
    Object.assign(metrics, byCountry);
  } else if (domain === 'cyber') {
    metrics.ioc_count = (data.iocs ?? []).length;
    metrics.kev_count = (data.kevs ?? []).length;
  }

  return metrics;
}

function computeStats(values) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return { min, max, mean, stddev };
}

export const schemas = {
  correlate: {
    description: 'Cross-domain correlation: finds shared entities (countries, IPs, actors) across 2+ intelligence domains.',
    inputSchema: z.object({
      domains: z.array(z.enum(['conflicts', 'markets', 'cyber', 'weather', 'military', 'health'])).min(2).describe('Domains to correlate (minimum 2)'),
      region: z.string().optional().describe('Geographic filter (country or region name)'),
      timeframe: z.string().optional().describe('Time range, e.g. "7d", "30d", "2026-04-01/2026-04-14"'),
    }),
  },
  trend: {
    description: 'Time-series trend analysis from sentinel history snapshots. Shows direction, rate of change, and anomaly flags.',
    inputSchema: z.object({
      source: z.string().describe('Domain or metric source, e.g. "markets", "conflicts"'),
      metric: z.string().optional().describe('Specific metric to track, e.g. "spy_price", "event_count"'),
      window: z.string().optional().describe('Time window, e.g. "7d", "30d" (default: "7d")'),
    }),
  },
  anomaly_scan: {
    description: 'Broad anomaly detection across all domains. Compares current values to historical baselines and flags deviations.',
    inputSchema: z.object({
      sensitivity: z.number().optional().describe('Standard deviations threshold (default: 2.0)'),
      domains: z.array(z.string()).optional().describe('Limit scan to specific domains (default: all)'),
    }),
  },
};

export function makeIntelligenceTools(client, storage) {
  async function correlate({ domains, region, timeframe }) {
    const allRoutes = [];
    for (const d of domains) {
      allRoutes.push(...(DOMAIN_ROUTES[d] || []));
    }

    const results = await client.getAll(allRoutes);
    const warnings = [];

    const domainData = {};
    for (const d of domains) {
      const routes = DOMAIN_ROUTES[d] || [];
      const merged = {};
      for (const r of routes) {
        const resp = results.get(r) || {};
        if (resp?.error) warnings.push(`${r}: ${resp.error}`);
        Object.assign(merged, resp);
      }
      domainData[d] = merged;
    }

    const correlations = correlateData(domainData, domains);

    const summary = correlations.length > 0
      ? `Found ${correlations.length} correlation(s) across ${domains.join(', ')}.`
      : `No correlations found across ${domains.join(', ')}.`;

    return makeResponse(summary, { correlations, domains }, allRoutes, warnings);
  }

  async function trend({ source, metric, window }) {
    const windowMs = parseWindow(window);
    const cutoff = Date.now() - windowMs;

    const files = storage.listFiles('sentinel/history', '*.json');
    const snapshots = [];

    for (const f of files) {
      const ts = parseFilenameDate(f);
      if (!ts || ts.getTime() < cutoff) continue;
      const data = storage.readJSON(`sentinel/history/${f}`);
      if (!data) continue;
      const metrics = extractMetrics(source, data);
      snapshots.push({ file: f, timestamp: ts.toISOString(), metrics });
    }

    snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (snapshots.length < 2) {
      return makeResponse(
        `Insufficient history for trend analysis on ${source}.`,
        { datapoints: snapshots, direction: 'unknown', stats: null },
        ['sentinel/history'],
        snapshots.length === 0 ? ['No snapshots found in time window'] : ['Need at least 2 snapshots for trend'],
      );
    }

    const targetMetric = metric || Object.keys(snapshots[0].metrics)[0];
    const values = snapshots.map(s => s.metrics[targetMetric]).filter(v => v != null);
    const datapoints = snapshots.map(s => ({ timestamp: s.timestamp, value: s.metrics[targetMetric] }));

    if (values.length < 2) {
      return makeResponse(
        `Metric "${targetMetric}" not found in enough snapshots.`,
        { datapoints, direction: 'unknown', stats: null },
        ['sentinel/history'],
        [`Metric "${targetMetric}" found in ${values.length} snapshot(s)`],
      );
    }

    const stats = computeStats(values);
    const first = values[0];
    const last = values[values.length - 1];
    const rateOfChange = (last - first) / first;

    let direction;
    if (Math.abs(rateOfChange) < 0.005) direction = 'stable';
    else if (rateOfChange > 0) direction = 'rising';
    else direction = 'falling';

    const anomalyFlags = values
      .map((v, i) => Math.abs(v - stats.mean) > 2 * stats.stddev ? i : -1)
      .filter(i => i >= 0);

    const summary = `${source}/${targetMetric}: ${direction} (${(rateOfChange * 100).toFixed(1)}% change over ${snapshots.length} snapshots). Range: ${stats.min}–${stats.max}, mean: ${stats.mean.toFixed(2)}.`;

    return makeResponse(summary, {
      datapoints,
      direction,
      rate_of_change: rateOfChange,
      stats,
      anomaly_indices: anomalyFlags,
    }, ['sentinel/history']);
  }

  async function anomaly_scan({ sensitivity, domains: scanDomains } = {}) {
    const threshold = sensitivity ?? 2.0;
    const domainsToScan = scanDomains?.length ? scanDomains : ALL_DOMAINS;

    const files = storage.listFiles('sentinel/history', '*.json');
    if (files.length < 3) {
      return makeResponse(
        'Insufficient history for anomaly detection (need >= 3 snapshots).',
        { anomalies: [], threshold, snapshots_available: files.length },
        [],
        ['Need at least 3 historical snapshots for baseline'],
      );
    }

    const history = [];
    for (const f of files) {
      const data = storage.readJSON(`sentinel/history/${f}`);
      if (data) history.push(data);
    }

    const baselines = {};
    for (const domain of domainsToScan) {
      const allMetrics = history.map(snap => extractMetrics(domain, snap));
      const metricKeys = new Set(allMetrics.flatMap(m => Object.keys(m)));
      for (const key of metricKeys) {
        const values = allMetrics.map(m => m[key]).filter(v => v != null);
        if (values.length < 3) continue;
        const stats = computeStats(values);
        baselines[`${domain}.${key}`] = stats;
      }
    }

    const allRoutes = [];
    for (const d of domainsToScan) {
      allRoutes.push(...(DOMAIN_ROUTES[d] || []));
    }

    const results = await client.getAll(allRoutes);
    const warnings = [];

    const currentData = {};
    for (const d of domainsToScan) {
      const routes = DOMAIN_ROUTES[d] || [];
      const merged = {};
      for (const r of routes) {
        const resp = results.get(r) || {};
        if (resp?.error) warnings.push(`${r}: ${resp.error}`);
        Object.assign(merged, resp);
      }
      currentData[d] = merged;
    }

    const anomalies = [];
    for (const domain of domainsToScan) {
      const current = extractMetrics(domain, { [domain]: currentData[domain] });
      for (const [key, value] of Object.entries(current)) {
        const baselineKey = `${domain}.${key}`;
        const stats = baselines[baselineKey];
        if (!stats || stats.stddev === 0) continue;
        const deviation = Math.abs(value - stats.mean) / stats.stddev;
        if (deviation > threshold) {
          anomalies.push({
            domain,
            metric: key,
            current_value: value,
            baseline_mean: stats.mean,
            baseline_stddev: stats.stddev,
            deviation,
            direction: value > stats.mean ? 'above' : 'below',
          });
        }
      }
    }

    anomalies.sort((a, b) => b.deviation - a.deviation);

    const summary = anomalies.length > 0
      ? `Found ${anomalies.length} anomaly/anomalies exceeding ${threshold}σ threshold.`
      : `No anomalies detected at ${threshold}σ threshold.`;

    return makeResponse(summary, { anomalies, threshold }, allRoutes, warnings);
  }

  return { correlate, trend, anomaly_scan };
}
