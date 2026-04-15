const ENTITY_TYPES = ['countries', 'regions', 'actors', 'dates', 'tickers', 'ips', 'cves'];

function emptyEntities() {
  return Object.fromEntries(ENTITY_TYPES.map(t => [t, new Set()]));
}

function addIfTruthy(set, value) {
  if (value) set.add(value);
}

const extractors = {
  conflicts(data, e) {
    for (const ev of data?.events ?? []) {
      addIfTruthy(e.countries, ev?.country);
      addIfTruthy(e.regions, ev?.region);
      addIfTruthy(e.actors, ev?.actor1);
      addIfTruthy(e.actors, ev?.actor2);
      addIfTruthy(e.dates, ev?.event_date);
    }
  },

  markets(data, e) {
    for (const q of data?.quotes ?? []) {
      addIfTruthy(e.tickers, q?.symbol);
    }
    for (const m of data?.macro ?? []) {
      addIfTruthy(e.countries, m?.country);
    }
  },

  cyber(data, e) {
    for (const ioc of data?.iocs ?? []) {
      if (ioc?.ioc) {
        const ip = ioc.ioc.split(':')[0];
        if (ip) e.ips.add(ip);
      }
    }
    for (const kev of data?.kevs ?? []) {
      addIfTruthy(e.cves, kev?.cveID);
    }
    for (const pulse of data?.pulses ?? []) {
      for (const tag of pulse?.tags ?? []) {
        if (/^[A-Z]{2}$/.test(tag)) e.countries.add(tag);
      }
    }
  },

  weather(data, e) {
    for (const city of data?.cities ?? []) {
      addIfTruthy(e.countries, city?.country);
      addIfTruthy(e.regions, city?.name);
    }
    for (const alert of data?.alerts ?? []) {
      addIfTruthy(e.regions, alert?.senderName);
    }
  },

  military(data, e) {
    for (const a of data?.aircraft ?? []) {
      addIfTruthy(e.countries, a?.country);
    }
    for (const v of data?.vessels ?? []) {
      addIfTruthy(e.countries, v?.flag);
    }
  },

  health(data, e) {
    for (const o of data?.outbreaks ?? []) {
      addIfTruthy(e.countries, o?.country);
    }
    for (const item of data?.items ?? []) {
      addIfTruthy(e.countries, item?.country);
    }
  },
};

export function extractEntities(domain, data) {
  const e = emptyEntities();
  extractors[domain]?.(data, e);
  return e;
}

export function correlate(domainData, domains) {
  const entityCache = {};
  for (const d of domains) {
    entityCache[d] = extractEntities(d, domainData?.[d]);
  }

  const results = [];

  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domains[i];
      const b = domains[j];

      for (const type of ENTITY_TYPES) {
        const setA = entityCache[a][type];
        const setB = entityCache[b][type];
        if (setA.size === 0 || setB.size === 0) continue;

        const shared = [];
        for (const v of setA) {
          if (setB.has(v)) shared.push(v);
        }
        if (shared.length === 0) continue;

        const score = Math.min(1, shared.length / Math.max(setA.size, setB.size, 1));
        results.push({
          domain_a: a,
          domain_b: b,
          entity_type: type,
          shared_entities: shared,
          overlap_count: shared.length,
          score,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
