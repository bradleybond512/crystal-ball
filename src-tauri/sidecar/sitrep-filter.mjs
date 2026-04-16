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
