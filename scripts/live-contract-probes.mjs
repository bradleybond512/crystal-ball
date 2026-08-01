#!/usr/bin/env node
// Nightly live-contract probes for keyless fusion providers.
//
// No reviewer can catch "this filter matches zero rows in production" — every
// plan-breaking provider defect in the recent program was found by probing
// the live BODY, and each was invisible in the diff. Review-time probes only
// cover review time; APIs drift afterward while HTTP 200 keeps flowing. This
// validates the response SHAPE nightly: fields consumed, row counts, numeric
// ranges. Status codes are never trusted on their own.
//
// Every validator below was written against a live response captured on
// 2026-08-01 (e.g. SWPC returns OBJECT rows {time_tag, Kp}, not the
// array-of-arrays "products" format older docs suggest).
//
// Keyed providers (Finnhub, FMP, AirNow, PurpleAir, Cloudflare) are absent by
// design: CI has no secrets, and a probe that cannot run must not report
// health.
const PROBES = [
  {
    id: 'usgs-earthquakes',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    validate(j) {
      const p = [];
      if (!Array.isArray(j.features)) p.push('features is not an array');
      else if (j.features.length === 0) p.push('zero features in all_day feed (globally implausible)');
      const f = j.features?.[0];
      if (f && typeof f.properties?.mag !== 'number') p.push('features[0].properties.mag is not a number');
      const coords = f?.geometry?.coordinates;
      if (f && (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number')) {
        p.push('features[0].geometry.coordinates malformed');
      }
      return p;
    },
  },
  {
    id: 'emsc-earthquakes',
    url: 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=10&minmag=2',
    validate(j) {
      const p = [];
      if (!Array.isArray(j.features)) return ['features is not an array'];
      if (j.features.length === 0) return ['zero M2+ events (globally implausible)'];
      // Live-probed 2026-08-01: properties carry mag/time/lat/lon directly.
      const f = j.features[0].properties ?? {};
      if (typeof f.mag !== 'number') p.push('features[0].properties.mag is not a number');
      if (typeof f.time !== 'string') p.push('features[0].properties.time is not a string');
      if (typeof f.lat !== 'number' || typeof f.lon !== 'number') p.push('features[0].properties.lat/lon not numeric');
      return p;
    },
  },
  {
    id: 'coingecko-btc',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    validate(j) {
      const usd = j.bitcoin?.usd;
      return typeof usd === 'number' && usd > 100
        ? []
        : [`bitcoin.usd is ${JSON.stringify(usd)} — expected a plausible number`];
    },
  },
  {
    id: 'coinbase-btc',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    validate(j) {
      const amt = Number(j.data?.amount);
      return Number.isFinite(amt) && amt > 100
        ? []
        : [`data.amount is ${JSON.stringify(j.data?.amount)} — expected a numeric string`];
    },
  },
  {
    id: 'frankfurter-usd',
    url: 'https://api.frankfurter.dev/v1/latest?base=USD',
    validate(j) {
      const p = [];
      const n = Object.keys(j.rates ?? {}).length;
      if (n < 20) p.push(`only ${n} rates (probe saw 29)`);
      if (typeof j.rates?.EUR !== 'number') p.push('rates.EUR is not a number');
      return p;
    },
  },
  {
    id: 'open-er-api-usd',
    url: 'https://open.er-api.com/v6/latest/USD',
    validate(j) {
      const p = [];
      if (j.result !== 'success') p.push(`result is ${JSON.stringify(j.result)} — a 200 body can still carry an error`);
      const rates = j.rates;
      if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) return [...p, 'rates is not a plain object'];
      if (Object.keys(rates).length < 100) p.push(`only ${Object.keys(rates).length} rates (probe saw 166)`);
      if (typeof rates.EUR !== 'number') p.push('rates.EUR is not a number');
      return p;
    },
  },
  {
    id: 'swpc-kp',
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    validate(j) {
      const p = [];
      if (!Array.isArray(j) || j.length === 0) return ['not a non-empty array'];
      const row = j.at(-1);
      // Object rows, NOT the array-of-arrays "products" format.
      if (typeof row?.time_tag !== 'string') p.push('rows lack time_tag string');
      if (typeof row?.Kp !== 'number' || row.Kp < 0 || row.Kp > 9) p.push(`Kp is ${JSON.stringify(row?.Kp)} — expected 0..9`);
      return p;
    },
  },
  {
    id: 'open-meteo-air-quality',
    url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=41.61&longitude=-86.72&hourly=us_aqi',
    validate(j) {
      const rows = j.hourly?.us_aqi;
      if (!Array.isArray(rows) || rows.length === 0) return ['hourly.us_aqi missing or empty'];
      return rows.some((v) => typeof v === 'number') ? [] : ['hourly.us_aqi contains no numeric readings'];
    },
  },
];

export function runValidator(probe, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // The bot-challenge case: HTTP 200 serving HTML, not data.
    return [`${probe.id}: body is not JSON (starts: ${body.slice(0, 60).replaceAll('\n', ' ')})`];
  }
  return probe.validate(parsed).map((msg) => `${probe.id}: ${msg}`);
}

async function main() {
  const failures = [];
  for (const probe of PROBES) {
    try {
      const res = await fetch(probe.url, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'user-agent': 'crystal-ball-live-contract-probe (github.com/bradleybond512/crystal-ball)' },
      });
      const body = await res.text();
      const problems = runValidator(probe, body);
      if (!res.ok) problems.push(`${probe.id}: HTTP ${res.status}`);
      if (problems.length > 0) failures.push(...problems);
      else console.log(`[probe] ${probe.id}: OK`);
    } catch (error) {
      failures.push(`${probe.id}: fetch failed — ${error.message}`);
    }
  }
  if (failures.length > 0) {
    console.error('\n[live-contract-probes] DRIFT DETECTED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n[live-contract-probes] all ${PROBES.length} contracts hold.`);
}

export { PROBES };
const isDirectRun = process.argv[1] && import.meta.url.endsWith('live-contract-probes.mjs') && process.argv[1].endsWith('live-contract-probes.mjs');
if (isDirectRun) await main();
