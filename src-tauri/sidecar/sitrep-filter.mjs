// src-tauri/sidecar/sitrep-filter.mjs

const MILITARY_CALLSIGN_PREFIXES = [
  'RCH', 'ZEUS', 'KYOTE', 'BOMR', 'ENT', 'OTIS', 'MUSEL', 'WATTS',
  'CARGO', 'VVHK', 'SCHNR', 'DOOM', 'EVAC', 'TOPCAT', 'JAKE', 'NCHO',
  'TEAL', 'GORDO', 'RAIDR', 'HAVOC', 'KNIFE',
];

function itemLimit(severity) {
  if (severity <= 1) return 0;
  if (severity <= 3) return 5;
  return 20;
}

function stripGeometry(alert) {
  const copy = { ...alert };
  delete copy.geometry;
  return copy;
}

function isMilitaryCallsign(callsign) {
  if (!callsign) return false;
  return MILITARY_CALLSIGN_PREFIXES.some(p => callsign.startsWith(p));
}

const extractors = {
  conflicts(raw) { return raw?.events ?? (Array.isArray(raw) ? raw : []); },
  markets(raw) { return raw?.quotes ?? (Array.isArray(raw) ? raw : []); },
  weather(raw) { return Array.isArray(raw) ? raw : raw?.alerts ?? []; },
  seismic(raw) { return raw?.earthquakes ?? raw?.features ?? (Array.isArray(raw) ? raw : []); },
  health(raw) { return raw?.outbreaks ?? (Array.isArray(raw) ? raw : []); },
  sanctions(raw) { return raw?.results ?? (Array.isArray(raw) ? raw : []); },
  news(raw) { return raw?.articles ?? (Array.isArray(raw) ? raw : []); },
  cyber(raw) { return { iocs: raw?.iocs ?? [], kevs: raw?.kevs ?? raw?.vulnerabilities ?? [] }; },
  military(raw) {
    const aircraft = raw?.aircraft ?? (Array.isArray(raw?.militaryFlights) ? raw.militaryFlights : []);
    const milAircraft = aircraft.filter(a => a.military === true || isMilitaryCallsign(a.callsign));
    return { aircraft: milAircraft, vessels: raw?.vessels ?? raw?.navalVessels ?? [], posture: raw?.posture ?? raw?.theaterPosture ?? {} };
  },
  infrastructure(raw) { return raw?.gridAlerts ?? []; },
  economic(raw) { return raw; },
};

export function filterDomain(domain, severity, raw) {
  const limit = itemLimit(severity);
  const extracted = (extractors[domain] ?? (r => r))(raw);

  if (domain === 'military') {
    const { aircraft, vessels, posture } = extracted;
    const count = aircraft.length + vessels.length;
    if (limit === 0) {
      return { summary: `${aircraft.length} military aircraft, ${vessels.length} vessels tracked`, count };
    }
    return {
      summary: `${aircraft.length} military aircraft, ${vessels.length} vessels tracked`,
      count,
      items: aircraft.slice(0, limit),
      vessels: vessels.slice(0, limit),
      posture,
    };
  }

  if (domain === 'cyber') {
    const { iocs, kevs } = extracted;
    const count = iocs.length + kevs.length;
    if (limit === 0) {
      return { summary: `${iocs.length} IOCs, ${kevs.length} KEVs`, count };
    }
    return {
      summary: `${iocs.length} IOCs, ${kevs.length} KEVs`,
      count,
      iocs: iocs.slice(0, limit),
      kevs: kevs.slice(0, limit),
    };
  }

  if (domain === 'economic') {
    return { summary: extracted?.error ? 'unavailable' : 'available', data: limit > 0 ? extracted : undefined };
  }

  const items = Array.isArray(extracted) ? extracted : [];
  const count = items.length;

  if (limit === 0) {
    return { summary: `${count} items`, count };
  }

  let sliced = items.slice(0, limit);
  if (domain === 'weather') {
    sliced = sliced.map(a => stripGeometry(a));
  }

  return { summary: `${count} items`, count, items: sliced };
}

export function filterAllDomains(severity, raw) {
  const result = {};
  for (const [domain, score] of Object.entries(severity)) {
    if (raw[domain] !== undefined) {
      result[domain] = filterDomain(domain, score, raw[domain]);
    }
  }
  return result;
}

// ── Citations ─────────────────────────────────────────────────────────────────
// Stable short keys the subagent can reference inline, e.g. [wx-1].
// Each citation maps to a panel so the client can deep-link back.

const DOMAIN_PANEL = {
  conflicts: 'conflicts',
  markets: 'markets',
  weather: 'weather-alerts',
  seismic: 'earthquakes',
  health: 'disease-outbreaks',
  sanctions: 'opensanctions',
  news: 'breaking-news',
  cyber: 'cyber-threats',
  military: 'military-tracker',
  infrastructure: 'grid-alerts',
};

const DOMAIN_PREFIX = {
  conflicts: 'con',
  markets: 'mkt',
  weather: 'wx',
  seismic: 'sei',
  health: 'hlt',
  sanctions: 'san',
  news: 'nws',
  cyber: 'cyb',
  military: 'mil',
  infrastructure: 'inf',
};

function itemIdentity(item, fallback) {
  if (!item || typeof item !== 'object') return String(fallback);
  return (
    item.id ?? item.alertId ?? item.eventId ?? item.cve_id ?? item.cveID ??
    item.symbol ?? item.callsign ?? item.mmsi ?? item.url ?? String(fallback)
  );
}

function itemLabel(domain, item) {
  if (!item || typeof item !== 'object') return '';
  if (domain === 'markets') {
    const sym = item.symbol ?? '?';
    const pct = typeof item.changePercent === 'number' ? ` ${item.changePercent.toFixed(2)}%` : '';
    return `${sym}${pct}`;
  }
  if (domain === 'seismic') {
    const mag = item.properties?.mag ?? item.mag ?? '?';
    const place = item.properties?.place ?? item.place ?? '';
    return `M${mag} ${place}`;
  }
  if (domain === 'weather') {
    return item.event ?? item.headline ?? item.title ?? 'alert';
  }
  if (domain === 'cyber') {
    return item.cve_id ?? item.cveID ?? item.ioc ?? item.value ?? 'ioc';
  }
  if (domain === 'military') {
    return item.callsign ?? item.name ?? item.mmsi ?? 'unit';
  }
  return item.title ?? item.name ?? item.headline ?? item.event ?? '';
}

function collectDomainItems(data) {
  const arrays = [];
  if (Array.isArray(data.items)) arrays.push(data.items);
  if (Array.isArray(data.iocs)) arrays.push(data.iocs);
  if (Array.isArray(data.kevs)) arrays.push(data.kevs);
  if (Array.isArray(data.vessels)) arrays.push(data.vessels);
  return arrays.flat().slice(0, 10);
}

function citationsForDomain(domain, data) {
  if (!data || typeof data !== 'object') return [];
  const prefix = DOMAIN_PREFIX[domain] ?? domain.slice(0, 3);
  const panel = DOMAIN_PANEL[domain] ?? domain;
  return collectDomainItems(data).map((item, i) => {
    const idx = i + 1;
    return {
      key: `${prefix}-${idx}`,
      domain,
      panel,
      id: String(itemIdentity(item, idx)),
      label: String(itemLabel(domain, item) ?? '').slice(0, 120),
    };
  });
}

/**
 * Build a compact list of citation keys across the filtered bundle so the
 * subagent can reference items inline (e.g. "magnitude 6.1 quake [sei-2]")
 * and the main-context client can deep-link each citation to its panel.
 *
 * Returns { citations: [{ key, domain, panel, id, label }], byKey: {...} }.
 */
export function buildCitations(domains) {
  const citations = [];
  const byKey = {};
  for (const [domain, data] of Object.entries(domains)) {
    for (const c of citationsForDomain(domain, data)) {
      citations.push(c);
      byKey[c.key] = c;
    }
  }
  return { citations, byKey };
}
