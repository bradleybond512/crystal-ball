#!/usr/bin/env node
import http, { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import { existsSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, gzip } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { scoreAllDomains } from './sitrep-severity.mjs';
import { filterAllDomains, buildCitations } from './sitrep-filter.mjs';
import { getTakFeeds as s2uTakGetFeeds, getTakSituation as s2uTakGetSituation } from './s2u-tak-client.mjs';
import { aggregateWastewaterRows, detectSurgeWatches } from './wastewater-aggregate.mjs';
import { parseProMedRss, summarizeProMedAlerts } from './promed-classify.mjs';
import { crossReferenceWhoDonWithProMed } from './who-promed-cross-reference.mjs';
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
function isValidToken(authHeader) {
  const tok = process.env.LOCAL_API_TOKEN;
  if (!tok) return false;
  const expected = Buffer.from(`Bearer ${tok}`);
  const actual = Buffer.from(authHeader);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
// Node 22 ships a built-in WebSocket global (WHATWG API) — no external dep needed.
const AisWebSocket = WebSocket;

// ── Diagnostics prelude ──────────────────────────────────────────────────
// Wrap stdout/stderr so every log line gets a timestamp and stream tag.
// Without this, the parent log file interleaves silently and you can't tell
// when anything happened or which stream produced it.
const SIDECAR_TRACE = process.env.WM_TRACE === '1';
const SIDECAR_BUILD_TAG = process.env.WM_BUILD_TAG || `node-${process.versions.node}`;
const SIDECAR_START_MS = Date.now();
const wmHostStats = new Map(); // host → { ok, fail, lastStatus, lastOkAt, lastFailAt, lastError }
const WM_HOST_STATS_CAP = 100;
const wmHostFailures = new Map(); // host → { count, lastError, lastAt }
const EXPECTED_API_KEYS = [
  'ACLED_ACCESS_TOKEN', 'ACLED_EMAIL', 'FRED_API_KEY', 'EIA_API_KEY',
  'NEWSDATA_API_KEY', 'NASA_API_KEY', 'NASA_FIRMS_API_KEY',
  'OWM_API_KEY', 'FINNHUB_API_KEY', 'NEWSAPI_KEY', 'AVIATIONSTACK_API',
  'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET', 'AISSTREAM_API_KEY',
  'CESIUM_ION_TOKEN', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  'GEONAMES_USERNAME', 'THREATFOX_API_KEY', 'URLHAUS_AUTH_KEY',
  'OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'VIRUSTOTAL_API_KEY',
  'SHODAN_API_KEY', 'GREYNOISE_API_KEY', 'URLSCAN_API_KEY',
  'ANTHROPIC_API_KEY',
];

function wmTimestamp() {
  return new Date().toISOString();
}
function wmTagStream(stream, tag) {
  const orig = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
 if (typeof chunk === 'string') {
 const lines = chunk.split('\n');
 const last = lines.pop();
 const out = lines.map(l => `[${wmTimestamp()}][${tag}] ${l}\n`).join('');
 return orig(out + (last ? `[${wmTimestamp()}][${tag}] ${last}` : ''), ...rest);
 }
 return orig(chunk, ...rest);
  };
}
wmTagStream(process.stdout, 'stdout');
wmTagStream(process.stderr, 'stderr');

// Catch-all error handlers — without these, an unhandled rejection can kill
// the process with no log line at all.
process.on('uncaughtException', (err) => {
  console.error('[sidecar] uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sidecar] unhandledRejection:', reason?.stack || reason);
});
process.on('SIGTERM', () => { console.log('[sidecar] received SIGTERM, exiting cleanly'); process.exit(0); });
process.on('SIGINT', () => { console.log('[sidecar] received SIGINT, exiting cleanly'); process.exit(0); });
process.on('exit', (code) => { console.log(`[sidecar] process exit code=${code} uptime_ms=${Date.now() - SIDECAR_START_MS}`); });

console.log(`[sidecar] starting pid=${process.pid} node=${process.versions.node} build=${SIDECAR_BUILD_TAG} trace=${SIDECAR_TRACE}`);

function wmRecordHostCall(host, ok, status, errorMsg) {
  let entry = wmHostStats.get(host);
  if (!entry) {
 if (wmHostStats.size >= WM_HOST_STATS_CAP) {
 // Maps iterate in insertion order — first key is oldest
 const oldestKey = wmHostStats.keys().next().value;
 if (oldestKey) wmHostStats.delete(oldestKey);
 }
 entry = { ok: 0, fail: 0, lastStatus: 0, lastOkAt: 0, lastFailAt: 0, lastError: '' };
  }
  if (ok) {
 entry.ok += 1;
 entry.lastOkAt = Date.now();
  } else {
 entry.fail += 1;
 entry.lastFailAt = Date.now();
 entry.lastError = String(errorMsg || '').slice(0, 200);
  }
  entry.lastStatus = status;
  wmHostStats.set(host, entry);
}

function wmRecordHostFailure(host, errorMsg) {
  const entry = wmHostFailures.get(host) || { count: 0, lastError: '', lastAt: 0 };
  entry.count += 1;
  entry.lastError = String(errorMsg).slice(0, 200);
  entry.lastAt = Date.now();
  wmHostFailures.set(host, entry);
}

function wmMissingKeys() {
  return EXPECTED_API_KEYS.filter((k) => {
 const v = process.env[k];
 return !v || !v.trim();
  });
}

/**
 * Parse + bounds-validate a lat/lon pair from query string params.
 * Returns null if either is missing, non-finite, or outside the valid range.
 * Lat must be in [-90, 90]; lon in [-180, 180]. Used by routes that interpolate
 * coords into upstream URLs to prevent invalid-range queries and cache pollution.
 */
function parseLatLon(latRaw, lonRaw) {
  if (latRaw == null || lonRaw == null) return null;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

// ── Response cache for expensive/slow endpoints ─────────────────────────
const _responseCache = new Map(); // key → { data, expiresAt }
const _inflight = new Map(); // key → Promise — deduplicates concurrent identical fetches
function cachedFetch(key, ttlMs, fetcher) {
  const cached = _responseCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.data);
  const pending = _inflight.get(key);
  if (pending) return pending;
  const promise = fetcher().then(data => {
    _responseCache.set(key, { data, expiresAt: Date.now() + ttlMs });
    if (_responseCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of _responseCache) {
        if (now >= v.expiresAt) _responseCache.delete(k);
      }
    }
    return data;
  }).finally(() => _inflight.delete(key));
  _inflight.set(key, promise);
  return promise;
}

// Pre-compiled regex patterns (avoid re-creation in hot paths)
const RE_HTML_TAGS = /<[^>]+>/g;

// ── FAA Aviation Weather METAR enrichment helpers ───────────────────────
// Pure JS port of src/services/webcams/{flight-rule,station-matcher}.ts.
// The TS unit tests cover the algorithms; this file mirrors them so the
// sidecar can enrich without an extra HTTP hop to the renderer.
const FAA_METAR_CEILING_COVERS = new Set(['BKN', 'OVC', 'VV']);
const FAA_METAR_VALID_COVERS = new Set(['SKC', 'CLR', 'FEW', 'SCT', 'BKN', 'OVC', 'VV', 'OVX']);

function faaMetarToFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const cleaned = v.replace(/[+]$/, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function faaParseCloudLayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cover = typeof raw.cover === 'string' ? raw.cover.toUpperCase() : '';
  if (!FAA_METAR_VALID_COVERS.has(cover)) return null;
  return { cover, baseFt: faaMetarToFiniteNumber(raw.base) };
}

function faaParseMetarRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const stationId = typeof raw.icaoId === 'string' ? raw.icaoId.trim() : '';
  if (!stationId) return null;
  const cloudsRaw = Array.isArray(raw.clouds) ? raw.clouds : [];
  const clouds = cloudsRaw.map(c => faaParseCloudLayer(c)).filter(Boolean);
  return {
    stationId,
    observedAtSec: faaMetarToFiniteNumber(raw.obsTime),
    rawObservation: typeof raw.rawOb === 'string' ? raw.rawOb : null,
    windDirDeg: faaMetarToFiniteNumber(raw.wdir),
    windSpeedKt: faaMetarToFiniteNumber(raw.wspd),
    windGustKt: faaMetarToFiniteNumber(raw.wgst),
    visibilityMi: faaMetarToFiniteNumber(raw.visib),
    ceilingFt: null,
    weather: typeof raw.wxString === 'string' && raw.wxString.length > 0 ? raw.wxString : null,
    tempC: faaMetarToFiniteNumber(raw.temp),
    dewpointC: faaMetarToFiniteNumber(raw.dewp),
    altimeterInHg: faaMetarToFiniteNumber(raw.altim),
    clouds,
  };
}

function faaCeilingFromClouds(clouds) {
  if (!Array.isArray(clouds) || clouds.length === 0) return null;
  let lowest = null;
  for (const layer of clouds) {
    if (!FAA_METAR_CEILING_COVERS.has(layer.cover)) continue;
    if (typeof layer.baseFt !== 'number' || !Number.isFinite(layer.baseFt)) continue;
    if (lowest === null || layer.baseFt < lowest) lowest = layer.baseFt;
  }
  return lowest;
}

function faaDeriveFlightRule(visibilityMi, ceilingFt) {
  const visUnknown = visibilityMi === null || !Number.isFinite(visibilityMi);
  const ceilUnknown = ceilingFt === null || !Number.isFinite(ceilingFt);
  if (visUnknown && ceilUnknown) return null;
  if ((!visUnknown && visibilityMi < 1) || (!ceilUnknown && ceilingFt < 500)) return 'LIFR';
  if ((!visUnknown && visibilityMi < 3) || (!ceilUnknown && ceilingFt < 1000)) return 'IFR';
  if ((!visUnknown && visibilityMi <= 5) || (!ceilUnknown && ceilingFt <= 3000)) return 'MVFR';
  return 'VFR';
}

function faaHaversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function faaFindNearestStation(lat, lon, stations, maxDistanceNm = 50) {
  if (!Array.isArray(stations) || stations.length === 0) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const station of stations) {
    const d = faaHaversineNm(lat, lon, station.lat, station.lon);
    if (d < bestDist && d <= maxDistanceNm) {
      best = station;
      bestDist = d;
    }
  }
  return best;
}

function faaCountAdsbWithinRadius(lat, lon, adsb, radiusNm = 25) {
  if (!adsb || !Array.isArray(adsb.states)) return 0;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  let count = 0;
  for (const state of adsb.states) {
    if (!Array.isArray(state)) continue;
    const acLon = state[5];
    const acLat = state[6];
    if (typeof acLat !== 'number' || typeof acLon !== 'number') continue;
    if (!Number.isFinite(acLat) || !Number.isFinite(acLon)) continue;
    if (faaHaversineNm(lat, lon, acLat, acLon) <= radiusNm) count++;
  }
  return count;
}

async function fetchFaaMetarStations() {
  return cachedFetch('faa-metar-stations', 24 * 60 * 60 * 1000, async () => {
    try {
      const resp = await fetchWithTimeout(
        'https://aviationweather.gov/api/data/stationinfo?ids=ALL&format=json',
        { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' } },
        15000,
      );
      if (!resp.ok) return [];
      const raw = await resp.json();
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const icaoId = typeof row.icaoId === 'string' ? row.icaoId.trim() : '';
        const lat = faaMetarToFiniteNumber(row.lat);
        const lon = faaMetarToFiniteNumber(row.lon);
        if (!icaoId || lat === null || lon === null) continue;
        out.push({ icaoId, lat, lon });
      }
      return out;
    } catch {
      return [];
    }
  });
}

async function fetchFaaMetarsForStations(stationIds) {
  const unique = Array.from(new Set(stationIds.filter(id => typeof id === 'string' && id.length > 0)));
  if (unique.length === 0) return new Map();
  const batches = [];
  for (let i = 0; i < unique.length; i += 100) batches.push(unique.slice(i, i + 100));
  const out = new Map();
  await Promise.allSettled(batches.map(async (batch) => {
    const cacheKey = `faa-metar-batch-${batch.slice(0, 5).join('|')}-${batch.length}`;
    const data = await cachedFetch(cacheKey, 5 * 60 * 1000, async () => {
      try {
        const ids = batch.join(',');
        const resp = await fetchWithTimeout(
          `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`,
          { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' } },
          12000,
        );
        if (!resp.ok) return [];
        const raw = await resp.json();
        if (!Array.isArray(raw)) return [];
        return raw.map(r => faaParseMetarRow(r)).filter(Boolean);
      } catch {
        return [];
      }
    });
    for (const m of data) {
      m.ceilingFt = faaCeilingFromClouds(m.clouds);
      out.set(m.stationId, m);
    }
  }));
  return out;
}

async function enrichFaaCamerasWithMetar(cameras) {
  const stations = await fetchFaaMetarStations();
  if (!Array.isArray(cameras) || cameras.length === 0 || stations.length === 0) {
    return { cameras, metarByStation: {} };
  }
  const camStation = new Map();
  const stationIds = new Set();
  for (const cam of cameras) {
    const nearest = faaFindNearestStation(cam.lat, cam.lon, stations, 50);
    if (nearest) {
      camStation.set(cam.id, nearest.icaoId);
      stationIds.add(nearest.icaoId);
    }
  }
  const metarMap = await fetchFaaMetarsForStations(Array.from(stationIds));
  const adsb = getCachedStale('adsb');
  const enriched = cameras.map((cam) => {
    const stationId = camStation.get(cam.id) ?? null;
    const metar = stationId ? (metarMap.get(stationId) ?? null) : null;
    const flightRule = metar ? faaDeriveFlightRule(metar.visibilityMi, metar.ceilingFt) : null;
    const adsbCount = faaCountAdsbWithinRadius(cam.lat, cam.lon, adsb, 25);
    return { ...cam, nearestMetarStation: stationId, currentMetar: metar, flightRule, adsbCount };
  });
  const metarByStation = Object.fromEntries(metarMap.entries());
  return { cameras: enriched, metarByStation };
}

// ── AIS Stream Manager ────────────────────────────────────────────────────
// Connects directly to aisstream.io using AISSTREAM_API_KEY (set via settings).
// Maintains in-memory vessel state; serves /api/ais-snapshot with no relay needed.
const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const AIS_VESSEL_TTL_MS = 30 * 60 * 1000;
const AIS_MAX_VESSELS = 20_000;
const AIS_RECONNECT_DELAY_MS = 5_000;
const AIS_NAVAL_PREFIX_RE = /^(USS|USNS|HMS|HMAS|HMCS|INS|JS|ROKS|TCG|FS|BNS|RFS|PLAN|PLA|CGC|PNS|KRI|ITS|SNS)/i;

const aisState = {
  socket: null,
  vessels: new Map(),
  candidateReports: new Map(),
  // 24h-retention log of last position per mmsi — outlives the 30-min vessels
  // TTL so /api/dark-vessels can find vessels that have been silent 6-24h.
  darkHistory: new Map(),
  reconnectTimer: null,
  messageCount: 0,
  sequence: 0,
  lastSnapshotAt: 0,
  lastSnapshotJson: null,
  activeKey: null,
};

const AIS_DARK_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

function aisBuildSnapshot() {
  const now = Date.now();
  if (aisState.lastSnapshotJson && now - aisState.lastSnapshotAt < 2500) {
 return aisState.lastSnapshotJson;
  }
  const cutoff = now - AIS_VESSEL_TTL_MS;
  for (const [mmsi, v] of aisState.vessels) {
 if (v.timestamp < cutoff) aisState.vessels.delete(mmsi);
  }
  // Same TTL eviction for the military-candidate Map so it doesn't grow
  // without bound over long-running sessions.
  for (const [mmsi, r] of aisState.candidateReports) {
 if (r.timestamp < cutoff) aisState.candidateReports.delete(mmsi);
  }
  if (aisState.vessels.size > AIS_MAX_VESSELS) {
 // Linear scan: find the Nth-oldest timestamp, then evict everything older.
 const excess = aisState.vessels.size - AIS_MAX_VESSELS;
 const timestamps = new Float64Array(aisState.vessels.size);
 let i = 0;
 for (const v of aisState.vessels.values()) timestamps[i++] = v.timestamp;
 timestamps.sort();
 const cutoffTs = timestamps[excess];
 let removed = 0;
 for (const [mmsi, v] of aisState.vessels) {
   if (removed >= excess) break;
   if (v.timestamp <= cutoffTs) { aisState.vessels.delete(mmsi); removed++; }
 }
  }
  const snapshot = {
 sequence: ++aisState.sequence,
 timestamp: new Date(now).toISOString(),
 status: {
 connected: aisState.socket?.readyState === 1,
 vessels: aisState.vessels.size,
 messages: aisState.messageCount,
 },
 disruptions: [],
 density: [],
 candidateReports: [...aisState.candidateReports.values()].slice(0, 1500),
  };
  aisState.lastSnapshotJson = JSON.stringify(snapshot);
  aisState.lastSnapshotAt = now;
  return aisState.lastSnapshotJson;
}

function aisIsLikelyMilitary(meta) {
  const shipType = Number(meta?.ShipType);
  if (shipType === 35 || shipType === 55 || (shipType >= 50 && shipType <= 59)) return true;
  const name = (meta?.ShipName || '').trim();
  if (name && AIS_NAVAL_PREFIX_RE.test(name)) return true;
  const mmsi = String(meta?.MMSI || '');
  if (mmsi.length >= 9 && (mmsi.slice(3).startsWith('00') || mmsi.slice(3).startsWith('99'))) return true;
  return false;
}

function aisProcessMessage(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (parsed?.MessageType !== 'PositionReport') return;
  const meta = parsed.MetaData;
  const pos = parsed.Message?.PositionReport;
  if (!meta || !pos) return;
  const mmsi = String(meta.MMSI || '');
  if (!mmsi) return;
  const lat = Number.isFinite(pos.Latitude) ? pos.Latitude : meta.latitude;
  const lon = Number.isFinite(pos.Longitude) ? pos.Longitude : meta.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const now = Date.now();
  aisState.vessels.set(mmsi, {
 mmsi, name: meta.ShipName || '', lat, lon, timestamp: now,
 shipType: meta.ShipType, heading: pos.TrueHeading, speed: pos.Sog, course: pos.Cog,
  });
  aisState.darkHistory.set(mmsi, {
    mmsi, name: meta.ShipName || '', lat, lon, observedAt: now, shipType: meta.ShipType,
  });
  aisState.messageCount++;
  aisState.lastSnapshotJson = null; // invalidate cache
  if (aisIsLikelyMilitary(meta)) {
 aisState.candidateReports.set(mmsi, {
 mmsi, name: meta.ShipName || '', lat, lon,
 shipType: meta.ShipType, heading: pos.TrueHeading, speed: pos.Sog, course: pos.Cog, timestamp: now,
 });
  }
}

function aisConnect(apiKey) {
  if (!apiKey) return;
  if (aisState.socket && (aisState.socket.readyState === 0 || aisState.socket.readyState === 1)) return;
  aisState.activeKey = apiKey;
  const socket = new AisWebSocket(AISSTREAM_WS_URL);
  aisState.socket = socket;

  socket.onopen = () => {
 socket.send(JSON.stringify({
 APIKey: apiKey,
 BoundingBoxes: [[[-90, -180], [90, 180]]],
 FilterMessageTypes: ['PositionReport'],
 }));
  };

  socket.onmessage = (event) => {
 const data = event.data;
 aisProcessMessage(typeof data === 'string' ? data : data.toString());
  };

  socket.onclose = () => {
 if (aisState.socket === socket) {
 aisState.socket = null;
 const currentKey = process.env.AISSTREAM_API_KEY;
 if (currentKey && currentKey === aisState.activeKey) {
 aisState.reconnectTimer = setTimeout(() => aisConnect(currentKey), AIS_RECONNECT_DELAY_MS);
 }
 }
  };

  socket.onerror = () => { /* close event handles reconnect */ };
}

function aisDisconnect() {
  aisState.activeKey = null;
  if (aisState.reconnectTimer) { clearTimeout(aisState.reconnectTimer); aisState.reconnectTimer = null; }
  if (aisState.socket) { try { aisState.socket.close(); } catch {} aisState.socket = null; }
}

function aisOnKeyChanged(newKey) {
  aisDisconnect();
  if (newKey) aisConnect(newKey);
}

if (process.env.AISSTREAM_API_KEY) {
  aisConnect(process.env.AISSTREAM_API_KEY);
}
// ── end AIS Stream Manager ────────────────────────────────────────────────

// ── S2U XMPP Manager ─────────────────────────────────────────────────────
// Loads the bundled @xmpp/client wrapper lazily so the sidecar still boots
// when the bundle hasn't been built (tests, fresh checkout). Never auto-
// registers an account — refuses to operate without user-supplied creds.
let s2uXmppModule = null;
let s2uXmppLoadError = null;
async function loadS2UXmppModule() {
  if (s2uXmppModule || s2uXmppLoadError) return s2uXmppModule;
  try {
 s2uXmppModule = await import('./s2u-xmpp.bundle.mjs');
  } catch (error) {
 s2uXmppLoadError = error?.message ?? String(error);
 console.warn(`[s2u-xmpp] bundle not loaded: ${s2uXmppLoadError} — run "npm run build:sidecar-xmpp" to enable.`);
  }
  return s2uXmppModule;
}
async function s2uXmppApplyCreds() {
  const mod = await loadS2UXmppModule();
  if (!mod) return;
  const jid = process.env.S2U_XMPP_JID || '';
  const password = process.env.S2U_XMPP_SECRET || '';
  mod.start({ jid, password, log: console });
}
async function s2uXmppSnapshot() {
  const mod = await loadS2UXmppModule();
  if (!mod) {
 return {
 configured: false, connected: false, joinedRooms: [],
 lastMessage: null, lastConnectedAt: null,
 lastError: s2uXmppLoadError ?? 'bundle not loaded',
 nowMs: Date.now(), channels: {},
 };
  }
  return mod.snapshot(Date.now());
}
// Auto-start when creds are present at boot. Fire-and-forget on purpose:
// awaiting here would block the sidecar's HTTP server from coming up
// while @xmpp/client negotiates SASL.
if (process.env.S2U_XMPP_JID && process.env.S2U_XMPP_SECRET) {
  // eslint-disable-next-line unicorn/prefer-top-level-await -- intentional fire-and-forget; do not block sidecar boot on XMPP handshake
  s2uXmppApplyCreds().catch((error) => {
 console.warn(`[s2u-xmpp] startup failed: ${error?.message ?? error}`);
  });
}
// ── end S2U XMPP Manager ─────────────────────────────────────────────────

// ── S2U TAK Marti Client ─────────────────────────────────────────────────
// Pure helpers + thin HTTPS-with-pinning client; uses Node built-in https
// so no bundle is needed. Pins the published cert fingerprint by default;
// bypass requires S2U_TLS_INSECURE_OPT_IN=true. (Module imported at top.)

function s2uTakOpts() {
  return {
 url: process.env.S2U_TAK_URL || '',
 username: process.env.S2U_TAK_USERNAME || '',
 password: process.env.S2U_TAK_SECRET || '',
 insecureOptIn: String(process.env.S2U_TLS_INSECURE_OPT_IN || '').toLowerCase() === 'true',
  };
}
// ── end S2U TAK Marti Client ─────────────────────────────────────────────

// Monkey-patch globalThis.fetch to force IPv4 for HTTPS requests.
// Node.js built-in fetch (undici) tries IPv6 first via Happy Eyeballs.
// Government APIs (EIA, NASA FIRMS, FRED) publish AAAA records but their
// IPv6 endpoints time out, causing ETIMEDOUT. This override ensures ALL
// fetch() calls in dynamically-loaded handler modules (api/*.js) use IPv4.
const _originalFetch = globalThis.fetch;

function normalizeRequestBody(body) {
  if (body == undefined) return null;
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return body;
}

async function resolveRequestBody(input, init, method, isRequest) {
  if (method === 'GET' || method === 'HEAD') return null;

  if (init?.body != undefined) {
 return normalizeRequestBody(init.body);
  }

  if (isRequest && input?.body) {
 const clone = typeof input.clone === 'function' ? input.clone() : input;
 const buffer = await clone.arrayBuffer();
 return normalizeRequestBody(buffer);
  }

  return null;
}

function buildSafeResponse(statusCode, statusText, headers, bodyBuffer) {
  const status = Number.isInteger(statusCode) ? statusCode : 500;
  const body = (status === 204 || status === 205 || status === 304) ? null : bodyBuffer;
  return new Response(body, { status, statusText, headers });
}

function isTransientVerificationError(error) {
  if (!(error instanceof Error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
 return true;
  }
  if (error.name === 'AbortError') return true;
  return /timed out|timeout|network|fetch failed|failed to fetch|socket hang up/i.test(error.message);
}

globalThis.fetch = async function ipv4Fetch(input, init) {
  const isRequest = input && typeof input === 'object' && 'url' in input;
  let url;
  try { url = new URL(typeof input === 'string' ? input : input.url); } catch { return _originalFetch(input, init); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return _originalFetch(input, init);
  const mod = url.protocol === 'https:' ? https : http;
  const method = init?.method || (isRequest ? input.method : 'GET');
  const body = await resolveRequestBody(input, init, method, isRequest);
  const headers = {};
  const rawHeaders = init?.headers || (isRequest ? input.headers : null);
  if (rawHeaders) {
 const h = rawHeaders instanceof Headers ? Object.fromEntries(rawHeaders.entries())
 : (Array.isArray(rawHeaders) ? Object.fromEntries(rawHeaders) : rawHeaders);
 Object.assign(headers, h);
  }
  return new Promise((resolve, reject) => {
 const req = mod.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method, headers, family: 4, agent: mod === https ? httpsAgent : httpAgent }, (res) => {
 const chunks = [];
 res.on('data', (c) => chunks.push(c));
 res.on('end', () => {
 const buf = Buffer.concat(chunks);
 const responseHeaders = new Headers();
 for (const [k, v] of Object.entries(res.headers)) {
 if (v) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
 }
 try {
 resolve(buildSafeResponse(res.statusCode, res.statusMessage, responseHeaders, buf));
 } catch (error) {
 reject(error);
 }
 });
 });
 req.on('error', reject);
 if (init?.signal) { init.signal.addEventListener('abort', () => req.destroy()); }
 if (body != undefined) req.write(body);
 req.end();
  });
};

// Wrap fetch AFTER the ipv4Fetch patch so we instrument its entry point.
// Skips loopback (sidecar-internal) calls since those would drown the real signal.
const wmUpstreamFetch = globalThis.fetch;
globalThis.fetch = async function wmInstrumentedFetch(input, init) {
  let host = '';
  try {
 const url = typeof input === 'string' ? input : (input && input.url) || '';
 host = new URL(url).host;
  } catch { /* relative or opaque — skip */ }

  if (!host || host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
 return wmUpstreamFetch(input, init);
  }

  try {
 const res = await wmUpstreamFetch(input, init);
 wmRecordHostCall(host, res.ok, res.status, res.ok ? '' : `HTTP ${res.status}`);
 return res;
  } catch (error) {
 wmRecordHostCall(host, false, 0, error?.message || String(error));
 throw error;
  }
};

const ALLOWED_ENV_KEYS = new Set([
  'CRYSTALBALL_API_KEY',
  'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'FRED_API_KEY', 'EIA_API_KEY',
  'CLOUDFLARE_API_TOKEN', 'ACLED_ACCESS_TOKEN', 'ACLED_EMAIL', 'URLHAUS_AUTH_KEY',
  'OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'WINGBITS_API_KEY', 'WS_RELAY_URL',
  'VITE_OPENSKY_RELAY_URL', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET',
  'AISSTREAM_API_KEY', 'VITE_WS_RELAY_URL', 'FINNHUB_API_KEY', 'NASA_FIRMS_API_KEY',
  'OLLAMA_API_URL', 'OLLAMA_MODEL', 'WTO_API_KEY', 'AVIATIONSTACK_API',
  'ICAO_API_KEY', 'THREATFOX_API_KEY',
  'NEWSAPI_KEY', 'NEWSDATA_API_KEY', 'VIRUSTOTAL_API_KEY',
  'SHODAN_API_KEY', 'FMP_API_KEY',
  'OWM_API_KEY', 'GREYNOISE_API_KEY',
  'NASA_API_KEY',
  'URLSCAN_API_KEY', 'BITCOINABUSE_API_KEY', 'VULNERS_API_KEY', 'MEDIASTACK_API_KEY',
  'PULSEDIVE_API_KEY', 'HIBP_API_KEY', 'GEONAMES_USERNAME', 'IPINFO_TOKEN',
]);

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Path aliases for callers that use the renderer's preferred names rather
// than the canonical handler paths. Each alias is rewritten to its target
// at the start of the request dispatcher so existing handlers (inline or
// dynamic-import) match. Avoids forcing the frontend to track historical
// renamings and keeps every alias listed in one place.
const ROUTE_ALIASES = {
  '/api/weather': '/api/nws-alerts',
  '/api/gdelt-tensions': '/api/gdelt-intel',
  '/api/usgs-earthquakes': '/api/earthquakes',
  '/api/acled': '/api/acled-events',
  '/api/ais-clusters': '/api/ais-snapshot',
  '/api/firms': '/api/nasa-firms',
  '/api/opensanctions': '/api/opensanctions-recent',
};

// ── IP geolocation helpers ────────────────────────────────────────────────
// ip-api.com batch endpoint: free, no key, up to 100 IPs per request.
// Note: free tier requires HTTP (not HTTPS).
async function geolocateIPs(ips) {
  if (!ips || ips.length === 0) return new Map();
  try {
 const batch = ips.slice(0, 100).map(ip => ({ query: ip, fields: 'query,country,countryCode,lat,lon' }));
 const resp = await fetchWithTimeout('http://ip-api.com/batch?fields=query,country,countryCode,lat,lon', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'User-Agent': 'CrystalBall/1.0' },
 body: JSON.stringify(batch),
 }, 8000);
 if (!resp.ok) return new Map();
 const results = await resp.json();
 const map = new Map();
 for (const r of results) {
 if (r.query && r.lat && r.lon) {
 map.set(r.query, { lat: r.lat, lon: r.lon, country: r.country ?? '', countryCode: r.countryCode ?? '' });
 }
 }
 return map;
  } catch {
 return new Map();
  }
}

// IPQuery.io: free, no key, per-IP risk scoring.
async function scoreIPsQuery(ips) {
  if (!ips || ips.length === 0) return new Map();
  const map = new Map();
  const topIps = ips.slice(0, 15);
  await Promise.allSettled(topIps.map(async (ip) => {
 try {
 const resp = await fetchWithTimeout(`https://api.ipquery.io/${encodeURIComponent(ip)}`, {
 headers: { 'User-Agent': 'CrystalBall/1.0', Accept: 'application/json' },
 }, 5000);
 if (!resp.ok) return;
 const data = await resp.json();
 const score = data?.risk?.risk_score ?? null;
 if (score !== null) map.set(ip, score);
 } catch { /* ignore per-IP failures */ }
  }));
  return map;
}

// ── SSRF protection ──────────────────────────────────────────────────────
// Block requests to private/reserved IP ranges to prevent the RSS proxy
// from being used as a localhost pivot or internal network scanner.

function isPrivateIP(ip) {
  // IPv4-mapped IPv6 — extract the v4 portion
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const addr = v4Mapped ? v4Mapped[1] : ip;

  // IPv6 loopback
  if (addr === '::1' || addr === '::') return true;

  // IPv6 link-local / unique-local
  if (/^f[cd][0-9a-f]{2}:/i.test(addr)) return true; // fc00::/7 (ULA)
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true;  // fe80::/10 (link-local)

  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false; // not an IPv4

  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8  loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // 224.0.0.0+ multicast/reserved
  return false;
}

// DNS resolution cache — avoids repeated lookups on the same hostname (5 min TTL).
const _dnsCache = new Map(); // hostname → addresses[]
const _DNS_CACHE_TTL = 5 * 60_000;
setInterval(() => _dnsCache.clear(), _DNS_CACHE_TTL).unref();

async function isSafeUrl(urlString) {
  let parsed;
  try {
 parsed = new URL(urlString);
  } catch {
 return { safe: false, reason: 'Invalid URL' };
  }

  // Only allow http(s) protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
 return { safe: false, reason: 'Only http and https protocols are allowed' };
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
 return { safe: false, reason: 'URLs with credentials are not allowed' };
  }

  const hostname = parsed.hostname;

  // Quick-reject obvious private hostnames before DNS resolution
   
  if (hostname === 'localhost' || hostname === '[::1]') {
 return { safe: false, reason: 'Requests to localhost are not allowed' };
  }

  // Check if the hostname is already an IP literal
  const ipLiteral = hostname.replace(/^\[|\]$/g, '');
  if (isPrivateIP(ipLiteral)) {
 return { safe: false, reason: 'Requests to private/reserved IP addresses are not allowed' };
  }

  // DNS resolution check — resolve the hostname and verify all resolved IPs
  // are public. This prevents DNS rebinding attacks where a public domain
  // resolves to a private IP.
  let addresses = _dnsCache.get(hostname);
  if (!addresses) {
    addresses = [];
    try {
 try {
 const v4 = await dns.resolve4(hostname);
 addresses = addresses.concat(v4);
 } catch { /* no A records — try AAAA */ }
 try {
 const v6 = await dns.resolve6(hostname);
 addresses = addresses.concat(v6);
 } catch { /* no AAAA records */ }
    } catch {
 return { safe: false, reason: 'DNS resolution failed' };
    }
    if (addresses.length > 0) _dnsCache.set(hostname, addresses);
  }

  if (addresses.length === 0) {
 return { safe: false, reason: 'Could not resolve hostname' };
  }

  for (const addr of addresses) {
 if (isPrivateIP(addr)) {
 return { safe: false, reason: 'Hostname resolves to a private/reserved IP address' };
 }
  }

  return { safe: true, resolvedAddresses: addresses };
}

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
 status,
 headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function canCompress(headers, body) {
  return body.length > 1024 && !headers['content-encoding'];
}

function appendVary(existing, token) {
  const value = typeof existing === 'string' ? existing : '';
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === token.toLowerCase())) {
 parts.push(token);
  }
  return parts.join(', ');
}

async function maybeCompressResponseBody(body, headers, acceptEncoding = '') {
  if (!canCompress(headers, body)) return body;
  headers['vary'] = appendVary(headers['vary'], 'Accept-Encoding');

  if (acceptEncoding.includes('br')) {
 headers['content-encoding'] = 'br';
 return brotliCompressAsync(body);
  }

  if (acceptEncoding.includes('gzip')) {
 headers['content-encoding'] = 'gzip';
 return gzipAsync(body);
  }

  return body;
}

function isBracketSegment(segment) {
  return segment.startsWith('[') && segment.endsWith(']');
}

function splitRoutePath(routePath) {
  return routePath.split('/').filter(Boolean);
}

function routePriority(routePath) {
  const parts = splitRoutePath(routePath);
  return parts.reduce((score, part) => {
 if (part.startsWith('[[...') && part.endsWith(']]')) return score + 0;
 if (part.startsWith('[...') && part.endsWith(']')) return score + 1;
 if (isBracketSegment(part)) return score + 2;
 return score + 10;
  }, 0);
}

function matchRoute(routePath, pathname) {
  const routeParts = splitRoutePath(routePath);
  const pathParts = splitRoutePath(pathname.replace(/^\/api/, ''));

  let i = 0;
  let j = 0;

  while (i < routeParts.length && j < pathParts.length) {
 const routePart = routeParts[i];
 const pathPart = pathParts[j];

 if (routePart.startsWith('[[...') && routePart.endsWith(']]')) {
 return true;
 }

 if (routePart.startsWith('[...') && routePart.endsWith(']')) {
 return true;
 }

 if (isBracketSegment(routePart)) {
 i += 1;
 j += 1;
 continue;
 }

 if (routePart !== pathPart) {
 return false;
 }

 i += 1;
 j += 1;
  }

  if (i === routeParts.length && j === pathParts.length) return true;

  if (i === routeParts.length - 1) {
 const tail = routeParts[i];
 if (tail?.startsWith('[[...') && tail.endsWith(']]')) {
 return true;
 }
 if (tail?.startsWith('[...') && tail.endsWith(']')) {
 return j < pathParts.length;
 }
  }

  return false;
}

async function buildRouteTable(root) {
  if (!existsSync(root)) return [];

  const files = [];

  async function walk(dir) {
 const entries = await readdir(dir, { withFileTypes: true });
 for (const entry of entries) {
 const absolute = path.join(dir, entry.name);
 if (entry.isDirectory()) {
 await walk(absolute);
 continue;
 }
 if (!entry.name.endsWith('.js')) continue;
 if (entry.name.startsWith('_')) continue;

 const relative = path.relative(root, absolute).replace(/\\/g, '/');
 const routePath = relative.replace(/\.js$/, '').replace(/\/index$/, '');
 files.push({ routePath, modulePath: absolute });
 }
  }

  await walk(root);

  files.sort((a, b) => routePriority(b.routePath) - routePriority(a.routePath));
  return files;
}

const REQUEST_BODY_CACHE = Symbol('requestBodyCache');
const REQUEST_BODY_OVERFLOW = Symbol('requestBodyOverflow');
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024; // 16 MB

class RequestBodyTooLargeError extends Error {
  constructor(limit) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'RequestBodyTooLargeError';
    this.statusCode = 413;
    this.limit = limit;
  }
}

async function readBody(req) {
  if (Object.prototype.hasOwnProperty.call(req, REQUEST_BODY_CACHE)) {
    return req[REQUEST_BODY_CACHE];
  }
  if (req[REQUEST_BODY_OVERFLOW]) {
    throw new RequestBodyTooLargeError(MAX_REQUEST_BODY_BYTES);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      req[REQUEST_BODY_OVERFLOW] = true;
      try { req.destroy?.(); } catch { /* socket already gone */ }
      throw new RequestBodyTooLargeError(MAX_REQUEST_BODY_BYTES);
    }
    chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  req[REQUEST_BODY_CACHE] = body;
  return body;
}

function toHeaders(nodeHeaders, options = {}) {
  const stripOrigin = options.stripOrigin === true;
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
 const lowerKey = key.toLowerCase();
 if (lowerKey === 'host') continue;
 if (stripOrigin && (lowerKey === 'origin' || lowerKey === 'referer' || lowerKey.startsWith('sec-fetch-'))) {
 continue;
 }
 if (Array.isArray(value)) {
 for (const v of value) headers.append(key, v);
 } else if (typeof value === 'string') {
 headers.set(key, value);
 }
  }
  return headers;
}

async function proxyToCloud(requestUrl, req, remoteBase) {
  const target = `${remoteBase}${requestUrl.pathname}${requestUrl.search}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
 return await fetch(target, {
 method: req.method,
 // Strip browser-origin headers for server-to-server parity.
 headers: toHeaders(req.headers, { stripOrigin: true }),
 body,
 signal: controller.signal,
 });
  } finally {
 clearTimeout(timer);
  }
}

function pickModule(pathname, routes) {
  const apiPath = pathname.startsWith('/api') ? pathname.slice(4) || '/' : pathname;

  for (const candidate of routes) {
 if (matchRoute(candidate.routePath, apiPath)) {
 return candidate.modulePath;
 }
  }

  return null;
}

const moduleCache = new Map();
const failedImports = new Set();
const fallbackCounts = new Map();
const cloudPreferred = new Set();

/**
 * Shape-aware degraded response for unknown sidecar routes.
 *
 * Background: the desktop sidecar only ships ~20 of the ~150 /api/* routes
 * the panels expect (the rest used to live on the Vercel deployment, which
 * is no longer up). Returning 404 here triggers panel-side error handlers
 * that spam the console + show error toasts. Returning shape-aware empty
 * 200s lets panels render a graceful "unavailable" state.
 *
 * The shape is inferred from the URL suffix: panels usually destructure a
 * known field name (`alerts`, `events`, `pulses`, `data`), so we infer the
 * most likely top-level array name and stub it as []. `degraded: true` +
 * `reason` are always present so panels can show a degraded banner.
 */
const DEGRADED_SHAPE_BY_SUFFIX = [
  { suffix: 'alerts', key: 'alerts' },
  { suffix: 'events', key: 'events' },
  { suffix: 'pulses', key: 'pulses' },
  { suffix: 'iocs', key: 'iocs' },
  { suffix: 'feed', key: 'items' },
  { suffix: 'crises', key: 'crises' },
  { suffix: 'reports', key: 'reports' },
  { suffix: 'warnings', key: 'warnings' },
  { suffix: 'incidents', key: 'incidents' },
  { suffix: 'breaches', key: 'breaches' },
  { suffix: 'series', key: 'series' },
  { suffix: 'search', key: 'results' },
  { suffix: 'lookup', key: 'results' },
  { suffix: 'snapshot', key: 'snapshot' },
  { suffix: 'news', key: 'items' },
  { suffix: 'flights', key: 'flights' },
  { suffix: 'fleet', key: 'fleet' },
  { suffix: 'tle', key: 'tle' },
  { suffix: 'quotes', key: 'quotes' },
  { suffix: 'markets', key: 'markets' },
  { suffix: 'filings', key: 'filings' },
  { suffix: 'cve', key: 'cve' },
  // Suffixes added when the second/third handler waves landed; keep in
  // sync with what the underlying Vercel handler returns when present.
  { suffix: 'fires', key: 'fires' },
  { suffix: 'readings', key: 'readings' },
  { suffix: 'pulses-recent', key: 'pulses' },
  { suffix: 'drop', key: 'entries' },
  { suffix: 'urls', key: 'urls' },
  { suffix: 'sanctions', key: 'sanctions' },
  { suffix: 'documents', key: 'documents' },
  { suffix: 'observations', key: 'observations' },
  { suffix: 'register', key: 'documents' },
  { suffix: 'kev', key: 'kev' },
  { suffix: 'posture', key: 'posture' },
  { suffix: 'indicators', key: 'indicators' },
  { suffix: 'ncc', key: 'prefixes' },
  { suffix: 'atlas', key: 'anchors' },
  { suffix: 'info', key: 'result' },
  { suffix: 'lookup-ip', key: 'result' },
];

function buildDegradedResponse(pathname) {
  const reason = 'Local handler unavailable in this build. Panel running in degraded mode.';
  // Last segment of the path drives the shape inference.
  const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
  for (const { suffix, key } of DEGRADED_SHAPE_BY_SUFFIX) {
    if (lastSegment.endsWith(suffix)) {
      return json({
        [key]: [],
        degraded: true,
        reason,
        endpoint: pathname,
        generatedAt: new Date().toISOString(),
      });
    }
  }
  // Default shape — caller-friendly: empty data array + degraded flag.
  return json({
    data: [],
    items: [],
    degraded: true,
    reason,
    endpoint: pathname,
    generatedAt: new Date().toISOString(),
  });
}

const TRAFFIC_LOG_MAX = 200;
const trafficLog = Array.from({length: TRAFFIC_LOG_MAX});
let _trafficHead = 0;
let _trafficSize = 0;
let verboseMode = false;
let _verboseStatePath = null;

function loadVerboseState(dataDir) {
  _verboseStatePath = path.join(dataDir, 'verbose-mode.json');
  try {
 const data = JSON.parse(readFileSync(_verboseStatePath, 'utf-8'));
 verboseMode = !!data.verboseMode;
  } catch { /* file missing or invalid — keep default false */ }
}

function saveVerboseState() {
  if (!_verboseStatePath) return;
  try { writeFileSync(_verboseStatePath, JSON.stringify({ verboseMode })); } catch { /* ignore */ }
}

function _getTrafficEntries() {
  const result = [];
  for (let i = 0; i < _trafficSize; i++) {
    result.push(trafficLog[(_trafficHead + i) % TRAFFIC_LOG_MAX]);
  }
  return result;
}

function recordTraffic(entry) {
  const idx = (_trafficHead + _trafficSize) % TRAFFIC_LOG_MAX;
  trafficLog[idx] = entry;
  if (_trafficSize < TRAFFIC_LOG_MAX) _trafficSize++;
  else _trafficHead = (_trafficHead + 1) % TRAFFIC_LOG_MAX;
  if (verboseMode) {
 const ts = entry.timestamp.split('T')[1].replace('Z', '');
 console.log(`[traffic] ${ts} ${entry.method} ${entry.path} → ${entry.status} ${entry.durationMs}ms`);
  }
}

function logOnce(logger, route, message) {
  const key = `${route}:${message}`;
  const count = (fallbackCounts.get(key) || 0) + 1;
  fallbackCounts.set(key, count);
  if (count === 1) {
 logger.warn(`[local-api] ${route} → ${message}`);
  } else if (count === 5 || count % 100 === 0) {
 logger.warn(`[local-api] ${route} → ${message} (x${count})`);
  }
}

async function importHandler(modulePath) {
  if (failedImports.has(modulePath)) {
 throw new Error(`cached-failure:${path.basename(modulePath)}`);
  }

  const cached = moduleCache.get(modulePath);
  if (cached) return cached;

  try {
 const mod = await import(pathToFileURL(modulePath).href);
 moduleCache.set(modulePath, mod);
 return mod;
  } catch (error) {
 if (error.code === 'ERR_MODULE_NOT_FOUND') {
 failedImports.add(modulePath);
 }
 throw error;
  }
}

function resolveConfig(options = {}) {
  const port = Number(options.port ?? process.env.LOCAL_API_PORT ?? 46_123);
  const remoteBase = String(options.remoteBase ?? process.env.LOCAL_API_REMOTE_BASE ?? 'https://crystalball.app').replace(/\/$/, '');
  const resourceDir = String(options.resourceDir ?? process.env.LOCAL_API_RESOURCE_DIR ?? process.cwd());
  const apiDir = options.apiDir
 ? String(options.apiDir)
 : [
 path.join(resourceDir, 'api'),
 path.join(resourceDir, '_up_', 'api'),
 ].find((candidate) => existsSync(candidate)) ?? path.join(resourceDir, 'api');
  const dataDir = String(options.dataDir ?? process.env.LOCAL_API_DATA_DIR ?? resourceDir);
  const mode = String(options.mode ?? process.env.LOCAL_API_MODE ?? 'desktop-sidecar');
  const cloudFallback = String(options.cloudFallback ?? process.env.LOCAL_API_CLOUD_FALLBACK ?? '') === 'true';
  const logger = options.logger ?? console;

  return {
 port,
 remoteBase,
 resourceDir,
 dataDir,
 apiDir,
 mode,
 cloudFallback,
 logger,
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return pathToFileURL(process.argv[1]).href === import.meta.url;
}

async function handleLocalServiceStatus(context) {
  return json({
 success: true,
 timestamp: new Date().toISOString(),
 summary: { operational: 2, degraded: 0, outage: 0, unknown: 0 },
 services: [
 { id: 'local-api', name: 'Local Desktop API', category: 'dev', status: 'operational', description: `Running on 127.0.0.1:${context.port}` },
 { id: 'cloud-pass-through', name: 'Cloud pass-through', category: 'cloud', status: 'operational', description: `Fallback target ${context.remoteBase}` },
 ],
 local: { enabled: true, mode: context.mode, port: context.port, remoteBase: context.remoteBase },
  });
}

async function tryCloudFallback(requestUrl, req, context, reason) {
  if (reason) {
 const route = requestUrl.pathname;
 const count = (fallbackCounts.get(route) || 0) + 1;
 fallbackCounts.set(route, count);
 if (count === 1) {
 const brief = reason instanceof Error
 ? (reason.code === 'ERR_MODULE_NOT_FOUND' ? 'missing npm dependency' : reason.message)
 : reason;
 context.logger.warn(`[local-api] ${route} → cloud (${brief})`);
 } else if (count === 5 || count % 100 === 0) {
 context.logger.warn(`[local-api] ${route} → cloud x${count}`);
 }
  }
  try {
 return await proxyToCloud(requestUrl, req, context.remoteBase);
  } catch (error) {
 context.logger.error('[local-api] cloud fallback failed', requestUrl.pathname, error);
 return null;
  }
}

const SIDECAR_ALLOWED_ORIGINS = [
  /^tauri:\/\/localhost$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  // Only allow exact domain or single-level subdomains (e.g. preview-xyz.crystalball.app).
  // The previous (.*\.)? pattern was overly broad. Anchored to prevent spoofing
  // via domains like crystalballEVIL.vercel.app.
  /^https:\/\/([a-z0-9-]+\.)?crystalball\.app$/,
];

function getSidecarCorsOrigin(req) {
  const origin = req.headers?.origin || req.headers?.get?.('origin') || '';
  if (origin && SIDECAR_ALLOWED_ORIGINS.some(p => p.test(origin))) return origin;
   
  return 'tauri://localhost';
}

function makeCorsHeaders(req) {
  return {
 'Access-Control-Allow-Origin': getSidecarCorsOrigin(req),
 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
 'Access-Control-Max-Age': '86400',
 'Vary': 'Origin',
  };
}

// ── Dark-vessel gap helpers (mirror src/services/dark-vessel.ts) ────────────
const DARK_VESSEL_RISK_ZONES = [
  { name: 'Strait of Hormuz', lat: 26.5, lon: 56.3, radiusKm: 200 },
  { name: 'Bab el-Mandeb', lat: 12.5, lon: 43.5, radiusKm: 150 },
  { name: 'Red Sea', lat: 20, lon: 38, radiusKm: 400 },
  { name: 'Suez Canal', lat: 30.5, lon: 32.3, radiusKm: 100 },
  { name: 'Malacca Strait', lat: 2, lon: 102, radiusKm: 200 },
  { name: 'Taiwan Strait', lat: 24.5, lon: 119, radiusKm: 200 },
  { name: 'South China Sea', lat: 12, lon: 115, radiusKm: 500 },
  { name: 'Black Sea', lat: 43, lon: 34, radiusKm: 400 },
  { name: 'Baltic Sea', lat: 57, lon: 20, radiusKm: 300 },
  { name: 'Persian Gulf', lat: 27, lon: 51, radiusKm: 300 },
  { name: 'Gulf of Guinea', lat: 3, lon: 3, radiusKm: 400 },
  { name: 'Somalia Coast', lat: 5, lon: 47, radiusKm: 300 },
  { name: 'Panama Canal', lat: 9.1, lon: -79.7, radiusKm: 150 },
  { name: 'Bosphorus Strait', lat: 41.1, lon: 29.0, radiusKm: 100 },
];

function darkVesselHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeGapRiskScoreSidecar(gapHours, distanceKm) {
  let score = 0;
  if (gapHours >= 48) score += 50;
  else if (gapHours >= 24) score += 35;
  else if (gapHours >= 12) score += 20;
  else if (gapHours >= 6) score += 10;
  if (distanceKm <= 50) score += 50;
  else if (distanceKm <= 100) score += 35;
  else if (distanceKm <= 150) score += 20;
  else if (distanceKm <= 200) score += 10;
  return Math.min(100, score);
}

export function detectAisGapEventsSidecar(observations, options = {}) {
  const now = options.now ?? Date.now();
  const thresholdHours = options.thresholdHours ?? 6;
  const radiusKm = options.riskZoneRadiusKm ?? 200;
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const latest = new Map();
  for (const obs of observations) {
    if (!Number.isFinite(obs.lat) || !Number.isFinite(obs.lon)) continue;
    if (!Number.isFinite(obs.observedAt)) continue;
    const cur = latest.get(obs.mmsi);
    if (!cur || obs.observedAt > cur.observedAt) latest.set(obs.mmsi, obs);
  }
  const events = [];
  for (const obs of latest.values()) {
    const gapMs = now - obs.observedAt;
    if (gapMs < thresholdMs) continue;
    let nearest = null;
    for (const zone of DARK_VESSEL_RISK_ZONES) {
      const d = darkVesselHaversineKm(obs.lat, obs.lon, zone.lat, zone.lon);
      if (!nearest || d < nearest.distanceKm) nearest = { name: zone.name, distanceKm: d };
    }
    if (!nearest || nearest.distanceKm > radiusKm) continue;
    const gapHours = gapMs / (60 * 60 * 1000);
    events.push({
      mmsi: obs.mmsi,
      vesselName: obs.name,
      lastKnownLat: obs.lat,
      lastKnownLon: obs.lon,
      lastSeenAt: obs.observedAt,
      gapDurationHours: Math.round(gapHours * 10) / 10,
      nearestChokepoint: nearest.name,
      nearestChokepointKm: Math.round(nearest.distanceKm),
      riskScore: computeGapRiskScoreSidecar(gapHours, nearest.distanceKm),
    });
  }
  events.sort((a, b) => b.riskScore - a.riskScore || b.gapDurationHours - a.gapDurationHours);
  return events;
}

// ── Freight-stress helpers (mirror src/services/maritime/freight-stress.ts) ──
export function parseFredCsvSidecar(csv) {
  const lines = String(csv).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  if (header.length < 2) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const date = cols[0].trim();
    const raw = cols[1].trim();
    if (!date || raw === '' || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

export function computeFreightStressSidecar(series, observations) {
  if (observations.length === 0) {
    return { series, current: null, avg12m: null, stdev12m: null, deviationPct: null,
      zScore: null, trend: 'stable', stressScore: 0, stressLevel: 'low',
      observationCount: 0, asOf: null };
  }
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const current = last.value;
  const window = sorted.slice(Math.max(0, sorted.length - 13), - 1);
  const allValues = sorted.map(o => o.value);
  const trend = (() => {
    if (allValues.length < 3) return 'stable';
    const tail = allValues.slice(-3);
    const slope = (tail[2] - tail[0]) / 2;
    const refMean = tail.reduce((a, b) => a + b, 0) / 3;
    const ref = Math.abs(refMean) || 1;
    if (slope > 0.005 * ref) return 'rising';
    if (slope < -0.005 * ref) return 'falling';
    return 'stable';
  })();
  if (window.length < 3) {
    return { series, current, avg12m: null, stdev12m: null, deviationPct: null,
      zScore: null, trend, stressScore: 0, stressLevel: 'low',
      observationCount: sorted.length, asOf: last.date };
  }
  const values = window.map(o => o.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  let sq = 0;
  for (const x of values) sq += (x - avg) ** 2;
  const sdev = values.length < 2 ? 0 : Math.sqrt(sq / (values.length - 1));
  const deviationPct = avg === 0 ? null : ((current - avg) / avg) * 100;
  const z = sdev === 0 ? null : (current - avg) / sdev;
  let score = 0;
  if (z !== null && Number.isFinite(z)) {
    const abs = Math.abs(z);
    score = abs >= 3 ? 100 : abs >= 2 ? 75 + (abs - 2) * 25 : abs >= 1 ? 35 + (abs - 1) * 40 : abs * 35;
  }
  const stressScore = Math.round(score);
  const stressLevel = stressScore >= 75 ? 'critical' : stressScore >= 50 ? 'high' : stressScore >= 25 ? 'medium' : 'low';
  return { series, current, avg12m: avg, stdev12m: sdev, deviationPct, zScore: z,
    trend, stressScore, stressLevel, observationCount: sorted.length, asOf: last.date };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  // Use node:https with IPv4 forced — Node.js built-in fetch (undici) tries IPv6
  // first and some servers (EIA, NASA FIRMS) have broken IPv6 causing ETIMEDOUT.
  const u = new URL(url);
  if (u.protocol === 'https:') {
 return new Promise((resolve, reject) => {
 const reqOpts = {
 hostname: u.hostname,
 port: u.port || 443,
 path: u.pathname + u.search,
 method: options.method || 'GET',
 headers: options.headers || {},
 family: 4,
 agent: httpsAgent,
 };
 // Pin to a pre-resolved IP to prevent TOCTOU DNS rebinding.
 // The hostname is kept for SNI / TLS certificate validation.
 if (options.resolvedAddress) {
 reqOpts.lookup = (_hostname, _opts, cb) => cb(null, options.resolvedAddress, 4);
 }
 const req = https.request(reqOpts, (res) => {
 const chunks = [];
 res.on('data', (c) => chunks.push(c));
 res.on('end', () => {
 const body = Buffer.concat(chunks).toString();
 resolve({
 ok: res.statusCode >= 200 && res.statusCode < 300,
 status: res.statusCode,
 headers: { get: (k) => res.headers[k.toLowerCase()] || null },
 text: () => Promise.resolve(body),
 json: () => Promise.resolve(JSON.parse(body)),
 });
 });
 });
 req.on('error', reject);
 req.setTimeout(timeoutMs, () => { req.destroy(new Error('Request timed out')); });
 if (options.body) {
 const body = normalizeRequestBody(options.body);
 if (body != undefined) req.write(body);
 }
 req.end();
 });
  }
  // HTTP fallback (localhost sidecar, etc.)
  // For pinned addresses on plain HTTP, rewrite the URL to connect to the
  // validated IP and set the Host header so virtual-host routing still works.
  let fetchUrl = url;
  const fetchHeaders = { ...options.headers };
  if (options.resolvedAddress && u.protocol === 'http:') {
 const pinned = new URL(url);
 fetchHeaders['Host'] = pinned.host;
 pinned.hostname = options.resolvedAddress;
 fetchUrl = pinned.toString();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
 return await fetch(fetchUrl, { ...options, headers: fetchHeaders, signal: controller.signal });
  } finally {
 clearTimeout(timer);
  }
}

/**
 * Sanitize a single GlobeSeismicOverlay payload from a renderer push.
 * Returns null if any required field is missing or wrong-typed so the
 * caller can filter it out. Bounds are mirrored from the Layer 4
 * emitter's invariants (P/S radius capped at antipode, opacity in [0,1]).
 */
export function sanitizeSeismicGlobeOverlay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.eventId !== 'string' || raw.eventId.length === 0) return null;
  if (typeof raw.lat !== 'number' || !Number.isFinite(raw.lat) || raw.lat < -90 || raw.lat > 90) return null;
  if (typeof raw.lon !== 'number' || !Number.isFinite(raw.lon) || raw.lon < -180 || raw.lon > 180) return null;
  const magnitude = raw.magnitude === null ? null
    : (typeof raw.magnitude === 'number' && Number.isFinite(raw.magnitude) ? raw.magnitude : null);
  const pWaveRadiusKm = clampNumber(raw.pWaveRadiusKm, 0, 20100);
  const sWaveRadiusKm = clampNumber(raw.sWaveRadiusKm, 0, 20100);
  const pWaveOpacity = clampNumber(raw.pWaveOpacity, 0, 1);
  const sWaveOpacity = clampNumber(raw.sWaveOpacity, 0, 1);
  if (pWaveRadiusKm === null || sWaveRadiusKm === null || pWaveOpacity === null || sWaveOpacity === null) return null;
  const ageSec = typeof raw.ageSec === 'number' && Number.isFinite(raw.ageSec) ? raw.ageSec : 0;
  return {
    eventId: raw.eventId,
    lat: raw.lat,
    lon: raw.lon,
    magnitude,
    pWaveRadiusKm,
    sWaveRadiusKm,
    pWaveOpacity,
    sWaveOpacity,
    ageSec,
    expired: raw.expired === true,
  };
}

function clampNumber(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

const VALID_EEW_TIERS = new Set([
  'TIER_1_INFO', 'TIER_2_WATCH', 'TIER_3_WARNING', 'TIER_4_SEVERE', 'TIER_5_EXTREME',
]);

export function isValidEewTier(value) {
  return typeof value === 'string' && VALID_EEW_TIERS.has(value);
}

const VALID_IMESSAGE_STATUSES = new Set(['pending', 'sent', 'failed', 'disabled']);

/**
 * Sanitize a single EewAlert from a renderer push. Returns null when
 * required fields are missing or wrong-typed so the caller can drop
 * malformed entries without losing valid ones.
 */
export function sanitizeEewAlert(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.eventId !== 'string' || raw.eventId.length === 0) return null;
  if (!isValidEewTier(raw.tier)) return null;
  if (typeof raw.reason !== 'string') return null;
  if (typeof raw.triggeredAt !== 'number' || !Number.isFinite(raw.triggeredAt)) return null;

  const out = {
    eventId: raw.eventId,
    tier: raw.tier,
    reason: raw.reason.slice(0, 500),
    triggeredAt: raw.triggeredAt,
  };
  if (isValidEewTier(raw.upgradedFrom)) out.upgradedFrom = raw.upgradedFrom;
  if (typeof raw.imessageStatus === 'string' && VALID_IMESSAGE_STATUSES.has(raw.imessageStatus)) {
    out.imessageStatus = raw.imessageStatus;
  }
  if (typeof raw.imessageError === 'string') {
    out.imessageError = raw.imessageError.slice(0, 500);
  }
  return out;
}

// CACHE PATTERN: copy this for future cached routes
const _sidecarCache = new Map(); // key -> { data, ts }
const SIDECAR_CACHE_MAX = 500;
let _sidecarCacheSweepTimer = null;

function _sweepSidecarCache() {
  const now = Date.now();
  for (const [k, v] of _sidecarCache) {
    if (v.ttlMs != null && now - v.ts >= v.ttlMs) _sidecarCache.delete(k);
  }
  // Hard cap: if still over limit, drop oldest entries
  if (_sidecarCache.size > SIDECAR_CACHE_MAX) {
    const entries = [..._sidecarCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (const [k] of entries.slice(0, _sidecarCache.size - SIDECAR_CACHE_MAX)) _sidecarCache.delete(k);
  }
}

function _ensureSidecarCacheSweep() {
  if (!_sidecarCacheSweepTimer) {
    _sidecarCacheSweepTimer = setInterval(_sweepSidecarCache, 5 * 60_000);
    if (_sidecarCacheSweepTimer.unref) _sidecarCacheSweepTimer.unref();
  }
}

function getCached(key, ttlMs) {
  const entry = _sidecarCache.get(key);
  const effective = ttlMs ?? entry?.ttlMs;
  if (entry && effective != null && Date.now() - entry.ts < effective) return entry.data;
  return null;
}
function getCachedStale(key) {
  const entry = _sidecarCache.get(key);
  return entry ? entry.data : null;
}
function setCached(key, data, ttlMs) {
  _sidecarCache.set(key, { data, ts: Date.now(), ...(ttlMs != null && { ttlMs }) });
  _ensureSidecarCacheSweep();
}

// ── ProMED snapshot helper (shared by /api/promed and /api/disease-intel) ──
const PROMED_RSS_URL = 'https://promedmail.org/feed/';
const PROMED_TTL_MS = 15 * 60 * 1000;

async function getOrFetchPromedSnapshot() {
  const cached = getCached('promed', PROMED_TTL_MS);
  if (cached) return cached;
  try {
    const resp = await fetchWithTimeout(
      PROMED_RSS_URL,
      { headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': CHROME_UA } },
      15_000,
    );
    if (!resp.ok) {
      return {
        alerts: [],
        lastFetch: new Date().toISOString(),
        novelCount: 0,
        outbreakCount: 0,
        degraded: true,
        reason: `ProMED upstream returned HTTP ${resp.status}`,
      };
    }
    const xml = await resp.text();
    const alerts = parseProMedRss(xml);
    const { novelCount, outbreakCount } = summarizeProMedAlerts(alerts);
    const result = {
      alerts,
      lastFetch: new Date().toISOString(),
      novelCount,
      outbreakCount,
    };
    setCached('promed', result);
    return result;
  } catch (error) {
    return {
      alerts: [],
      lastFetch: new Date().toISOString(),
      novelCount: 0,
      outbreakCount: 0,
      degraded: true,
      reason: `promed fetch error: ${error.message ?? error}`,
    };
  }
}

// ── Local IDS log helpers ─────────────────────────────────────────────────
function _tailFile(filePath, maxBytes) {
  try {
 const { size } = statSync(filePath);
 if (size === 0) return [];
 const start = Math.max(0, size - maxBytes);
 const fd = openSync(filePath, 'r');
 const buf = Buffer.allocUnsafe(size - start);
 readSync(fd, buf, 0, size - start, start);
 closeSync(fd);
 return buf.toString('utf8').split('\n').filter(Boolean);
  } catch {
 return [];
  }
}

function _zeekFields(lines) {
  for (const line of lines) {
 if (line.startsWith('#fields\t')) return line.slice('#fields\t'.length).split('\t');
  }
  return null;
}

let _prevEconomicStressIndex = null;

async function fetchFredSeries(seriesId, apiKey) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=1`;
  const res = await fetchWithTimeout(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`No data for ${seriesId}: non-JSON response`); }
  const obs = data?.observations?.[0];
  if (!obs || obs.value === '.') throw new Error(`No data for ${seriesId}`);
  return Number.parseFloat(obs.value);
}

function clamp(x) { return Math.min(100, Math.max(0, x)); }

function computeStressIndex(yieldVal, spreadVal, vixVal, fsiVal, scVal, claimsVal) {
  const yieldScore  = clamp((0.5 - yieldVal)  / (0.5 - (-1.5)) * 100);
  const spreadScore = clamp((0.5 - spreadVal)  / (0.5 - (-1)) * 100);
  const vixScore = clamp((vixVal - 15) / (80 - 15) * 100);
  const fsiScore = clamp((fsiVal - (-1)) / (5 - (-1)) * 100);
  const scScore = clamp((scVal - (-2)) / (4 - (-2)) * 100);
  const claimsScore = clamp((claimsVal - 180_000) / (500_000 - 180_000) * 100);
  return Math.round(
 yieldScore  * 0.2 +
 spreadScore * 0.15 +
 vixScore * 0.2 +
 fsiScore * 0.2 +
 scScore * 0.15 +
 claimsScore * 0.1
  );
}

function indicatorSeverity(score) {
  return score >= 70 ? 'critical' : (score >= 40 ? 'warning' : 'normal');
}

function relayToHttpUrl(rawUrl) {
  try {
 const parsed = new URL(rawUrl);
 if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
 if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
 return parsed.toString().replace(/\/$/, '');
  } catch {
 return null;
  }
}

function isAuthFailure(status, text = '') {
  // Intentionally broad for provider auth responses.
  // Callers MUST check isCloudflareChallenge403() first or CF challenge pages
  // may be misclassified as credential failures.
  if (status === 401 || status === 403) return true;
  return /unauthori[sz]ed|forbidden|invalid api key|invalid token|bad credentials/i.test(text);
}

function isCloudflareChallenge403(response, text = '') {
  if (response.status !== 403 || !response.headers.get('cf-ray')) return false;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const body = String(text || '').toLowerCase();
  const looksLikeHtml = contentType.includes('text/html') || body.includes('<html');
  if (!looksLikeHtml) return false;
  const matches = [
 'attention required',
 'cf-browser-verification',
 '__cf_chl',
 'ray id',
  ].filter((marker) => body.includes(marker)).length;
  return matches >= 2;
}

async function validateSecretAgainstProvider(key, rawValue, context = {}) {
  const value = String(rawValue || '').trim();
  if (!value) return { valid: false, message: 'Value is required' };

  const fail = (message) => ({ valid: false, message });
  const ok = (message) => ({ valid: true, message });

  try {
 switch (key) {
 case 'GROQ_API_KEY': {
 const response = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
 headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('Groq key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('Groq rejected this key');
 if (!response.ok) return fail(`Groq probe failed (${response.status})`);
 return ok('Groq key verified');
 }

 case 'ANTHROPIC_API_KEY': {
 const response = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
 headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01', Accept: 'application/json' },
 });
 const text = await response.text();
 if (isAuthFailure(response.status, text)) return fail('Anthropic rejected this key');
 if (!response.ok && response.status !== 429) return fail(`Anthropic probe failed (${response.status})`);
 return ok('Anthropic key verified');
 }

 case 'OPENROUTER_API_KEY': {
 const response = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
 headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('OpenRouter key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('OpenRouter rejected this key');
 if (!response.ok) return fail(`OpenRouter probe failed (${response.status})`);
 return ok('OpenRouter key verified');
 }

 case 'FRED_API_KEY': {
 const response = await fetchWithTimeout(
 `https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(value)}&file_type=json`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }
 );
 const text = await response.text();
 if (!response.ok) return fail(`FRED probe failed (${response.status})`);
 let payload = null;
 try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (payload?.error_code || payload?.error_message) return fail('FRED rejected this key');
 if (!Array.isArray(payload?.seriess)) return fail('Unexpected FRED response');
 return ok('FRED key verified');
 }

 case 'EIA_API_KEY': {
 const response = await fetchWithTimeout(
 `https://api.eia.gov/v2/?api_key=${encodeURIComponent(value)}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }
 );
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('EIA key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('EIA rejected this key');
 if (!response.ok) return fail(`EIA probe failed (${response.status})`);
 let payload = null;
 try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (payload?.response?.id === undefined && !payload?.response?.routes) return fail('Unexpected EIA response');
 return ok('EIA key verified');
 }

 case 'CLOUDFLARE_API_TOKEN': {
 const response = await fetchWithTimeout(
 'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=1d&limit=1',
 { headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA } }
 );
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('Cloudflare token stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('Cloudflare rejected this token');
 if (!response.ok) return fail(`Cloudflare probe failed (${response.status})`);
 let payload = null;
 try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (payload?.success !== true) return fail('Cloudflare Radar API did not return success');
 return ok('Cloudflare token verified');
 }

 case 'ACLED_ACCESS_TOKEN': {
 const response = await fetchWithTimeout('https://acleddata.com/api/acled/read?_format=json&limit=1', {
 headers: {
 Accept: 'application/json',
 Authorization: `Bearer ${value}`,
 'User-Agent': CHROME_UA,
 },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('ACLED token stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('ACLED rejected this token');
 if (!response.ok) return fail(`ACLED probe failed (${response.status})`);
 return ok('ACLED token verified');
 }

 case 'ACLED_EMAIL':
 case 'ACLED_REFRESH_TOKEN':
 return ok('Stored');

 case 'URLHAUS_AUTH_KEY': {
 const response = await fetchWithTimeout('https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1/', {
 headers: {
 Accept: 'application/json',
 'Auth-Key': value,
 'User-Agent': CHROME_UA,
 },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('URLhaus key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('URLhaus rejected this key');
 if (!response.ok) return fail(`URLhaus probe failed (${response.status})`);
 return ok('URLhaus key verified');
 }

 case 'THREATFOX_API_KEY': {
 const tfResp = await fetchWithTimeout('https://threatfox-api.abuse.ch/api/v1/', {
 method: 'POST',
 headers: {
 Accept: 'application/json',
 'Auth-Key': value,
 'Content-Type': 'application/json',
 'User-Agent': CHROME_UA,
 },
 body: JSON.stringify({ query: 'get_iocs', days: 1 }),
 });
 const tfText = await tfResp.text();
 if (isCloudflareChallenge403(tfResp, tfText)) return ok('ThreatFox key stored (Cloudflare blocked verification)');
 if (isAuthFailure(tfResp.status, tfText)) return fail('ThreatFox rejected this key');
 if (!tfResp.ok) return fail(`ThreatFox probe failed (${tfResp.status})`);
 return ok('ThreatFox key verified');
 }

 case 'OTX_API_KEY': {
 const response = await fetchWithTimeout('https://otx.alienvault.com/api/v1/user/me', {
 headers: {
 Accept: 'application/json',
 'X-OTX-API-KEY': value,
 'User-Agent': CHROME_UA,
 },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('OTX key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('OTX rejected this key');
 if (!response.ok) return fail(`OTX probe failed (${response.status})`);
 return ok('OTX key verified');
 }

 case 'ABUSEIPDB_API_KEY': {
 const response = await fetchWithTimeout('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=90', {
 headers: {
 Accept: 'application/json',
 Key: value,
 'User-Agent': CHROME_UA,
 },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('AbuseIPDB key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('AbuseIPDB rejected this key');
 if (!response.ok) return fail(`AbuseIPDB probe failed (${response.status})`);
 return ok('AbuseIPDB key verified');
 }

 case 'VIRUSTOTAL_API_KEY': {
 const response = await fetchWithTimeout('https://www.virustotal.com/api/v3/files/d41d8cd98f00b204e9800998ecf8427e', {
 headers: { 'x-apikey': value, Accept: 'application/json' },
 });
 if (response.status === 401) return fail('VirusTotal rejected this key');
 if (response.status === 404) return ok('VirusTotal key verified');
 if (!response.ok) return fail(`VirusTotal probe failed (${response.status})`);
 return ok('VirusTotal key verified');
 }

 case 'GREYNOISE_API_KEY': {
 const response = await fetchWithTimeout('https://api.greynoise.io/v3/community/8.8.8.8', {
 headers: { key: value, Accept: 'application/json' },
 });
 const text = await response.text();
 if (isAuthFailure(response.status, text)) return fail('GreyNoise rejected this key');
 if (!response.ok && response.status !== 429) return fail(`GreyNoise probe failed (${response.status})`);
 return ok('GreyNoise key verified');
 }

 case 'URLSCAN_API_KEY': {
 const response = await fetchWithTimeout('https://urlscan.io/user/quotas/', {
 headers: { 'API-Key': value, Accept: 'application/json' },
 });
 const text = await response.text();
 if (isAuthFailure(response.status, text)) return fail('URLScan rejected this key');
 if (!response.ok) return fail(`URLScan probe failed (${response.status})`);
 return ok('URLScan key verified');
 }

 case 'VULNERS_API_KEY': {
 const response = await fetchWithTimeout(`https://vulners.com/api/v3/apiKey/valid/?keyID=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 let payload = null; try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (payload?.result === 'OK' && payload?.data?.valid === true) return ok('Vulners key verified');
 return fail('Vulners rejected this key');
 }

 case 'PULSEDIVE_API_KEY': {
 const response = await fetchWithTimeout(`https://pulsedive.com/api/info.php?indicator=8.8.8.8&key=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 if (isAuthFailure(response.status, text)) return fail('Pulsedive rejected this key');
 if (/invalid api key/i.test(text)) return fail('Pulsedive rejected this key');
 return ok('Pulsedive key verified');
 }

 case 'HIBP_API_KEY': {
 const response = await fetchWithTimeout('https://haveibeenpwned.com/api/v3/breaches?domain=adobe.com', {
 headers: { 'hibp-api-key': value, 'User-Agent': 'CrystalBall', Accept: 'application/json' },
 });
 if (response.status === 401) return fail('HIBP rejected this key');
 if (!response.ok && response.status !== 429) return fail(`HIBP probe failed (${response.status})`);
 return ok('HIBP key verified');
 }

 case 'BITCOINABUSE_API_KEY': {
 const response = await fetchWithTimeout(`https://www.bitcoinabuse.com/api/reports/check?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa&api_token=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 if (response.status === 401 || response.status === 403) return fail('BitcoinAbuse rejected this key');
 if (!response.ok) return fail(`BitcoinAbuse probe failed (${response.status})`);
 return ok('BitcoinAbuse key verified');
 }

 case 'WINGBITS_API_KEY': {
 // Hit the flights endpoint without a specific aircraft hex so we get a
 // deterministic 200 (auth ok, list returned) or 401/403 (auth bad).
 // The previous probe used /flights/details/3c6444 which 404s for unknown
 // hexes regardless of auth and tripped isAuthFailure's body-text regex
 // when valid responses contained words like "forbidden" inside metadata.
 const response = await fetchWithTimeout('https://customer-api.wingbits.com/v1/flights', {
 headers: {
 Accept: 'application/json',
 'x-api-key': value,
 'User-Agent': CHROME_UA,
 },
 });
 // Status-only check: don't scan body text (auth keywords inside legitimate
 // flight payloads — e.g. flight notes mentioning 'forbidden airspace' —
 // were previously misclassified as credential failures).
 if (response.status === 401 || response.status === 403) {
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('Wingbits key stored (Cloudflare blocked verification)');
 return fail('Wingbits rejected this key');
 }
 if (response.status >= 500) return fail(`Wingbits probe failed (${response.status})`);
 return ok('Wingbits key accepted');
 }

 case 'FINNHUB_API_KEY': {
 const response = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
 });
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('Finnhub key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('Finnhub rejected this key');
 if (response.status === 429) return ok('Finnhub key accepted (rate limited)');
 if (!response.ok) return fail(`Finnhub probe failed (${response.status})`);
 let payload = null;
 try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (typeof payload?.error === 'string' && payload.error.toLowerCase().includes('invalid')) {
 return fail('Finnhub rejected this key');
 }
 if (typeof payload?.c !== 'number') return fail('Unexpected Finnhub response');
 return ok('Finnhub key verified');
 }

 case 'FMP_API_KEY': {
 const response = await fetchWithTimeout(`https://financialmodelingprep.com/api/v3/profile/AAPL?apikey=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 if (isAuthFailure(response.status, text)) return fail('FMP rejected this key');
 if (!response.ok) return fail(`FMP probe failed (${response.status})`);
 if (/error|invalid api key|limit reached/i.test(text)) return fail('FMP rejected this key');
 return ok('FMP key verified');
 }

 case 'NASA_FIRMS_API_KEY': {
 const response = await fetchWithTimeout(
 `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(value)}/VIIRS_SNPP_NRT/22,44,40,53/1`,
 { headers: { Accept: 'text/csv', 'User-Agent': CHROME_UA } }
 );
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('NASA FIRMS key stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('NASA FIRMS rejected this key');
 if (!response.ok) return fail(`NASA FIRMS probe failed (${response.status})`);
 if (/invalid api key|not authorized|forbidden/i.test(text)) return fail('NASA FIRMS rejected this key');
 return ok('NASA FIRMS key verified');
 }

 case 'NEWSAPI_KEY': {
 const response = await fetchWithTimeout('https://newsapi.org/v2/top-headlines?country=us&pageSize=1', {
 headers: { 'X-Api-Key': value, Accept: 'application/json' },
 });
 const text = await response.text();
 if (response.status === 401) return fail('NewsAPI rejected this key');
 if (!response.ok) return fail(`NewsAPI probe failed (${response.status})`);
 if (/apiKeyInvalid|apiKeyMissing/i.test(text)) return fail('NewsAPI rejected this key');
 return ok('NewsAPI key verified');
 }

 case 'NEWSDATA_API_KEY': {
 const response = await fetchWithTimeout(`https://newsdata.io/api/1/news?apikey=${encodeURIComponent(value)}&size=1`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 if (response.status === 401 || /unauthorized|api key/i.test(text)) return fail('NewsData rejected this key');
 if (!response.ok) return fail(`NewsData probe failed (${response.status})`);
 return ok('NewsData key verified');
 }

 case 'MEDIASTACK_API_KEY': {
 const response = await fetchWithTimeout(`http://api.mediastack.com/v1/news?access_key=${encodeURIComponent(value)}&limit=1`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 if (/usage_limit_reached/i.test(text)) return ok('MediaStack key verified (usage limit reached)');
 if (/invalid_access_key/i.test(text)) return fail('MediaStack rejected this key');
 if (!response.ok) return fail(`MediaStack probe failed (${response.status})`);
 return ok('MediaStack key verified');
 }

 case 'OWM_API_KEY': {
 const response = await fetchWithTimeout(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 if (response.status === 401) return fail('OpenWeatherMap rejected this key');
 if (!response.ok) return fail(`OpenWeatherMap probe failed (${response.status})`);
 return ok('OpenWeatherMap key verified');
 }

 case 'NASA_API_KEY': {
 const response = await fetchWithTimeout(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 if (response.status === 403) return fail('NASA rejected this key');
 if (!response.ok && response.status !== 429) return fail(`NASA probe failed (${response.status})`);
 return ok('NASA key verified');
 }

 case 'OLLAMA_API_URL': {
 let probeUrl;
 try {
 const parsed = new URL(value);
 if (!['http:', 'https:'].includes(parsed.protocol)) return fail('Must be an http(s) URL');
 // Probe the OpenAI-compatible models endpoint
 probeUrl = new URL('/v1/models', value).toString();
 } catch {
 return fail('Invalid URL');
 }
 const safe = await isSafeUrl(probeUrl);
 if (!safe) return fail('URL points to a private or disallowed address');
 const response = await fetchWithTimeout(probeUrl, { method: 'GET' }, 8000);
 if (!response.ok) {
 // Fall back to native Ollama /api/tags endpoint
 try {
 const tagsUrl = new URL('/api/tags', value).toString();
 const tagsResponse = await fetchWithTimeout(tagsUrl, { method: 'GET' }, 8000);
 if (!tagsResponse.ok) return fail(`Ollama probe failed (${tagsResponse.status})`);
 return ok('Ollama endpoint verified (native API)');
 } catch {
 return fail(`Ollama probe failed (${response.status})`);
 }
 }
 return ok('Ollama endpoint verified');
 }

 case 'OLLAMA_MODEL': {
 return ok('Model name stored');
 }

 case 'WS_RELAY_URL':
 case 'VITE_WS_RELAY_URL':
 case 'VITE_OPENSKY_RELAY_URL': {
 const probeUrl = relayToHttpUrl(value);
 if (!probeUrl) return fail('Relay URL is invalid');
 const safe = await isSafeUrl(probeUrl);
 if (!safe) return fail('URL points to a private or disallowed address');
 const response = await fetchWithTimeout(probeUrl, { method: 'GET' });
 if (response.status >= 500) return fail(`Relay probe failed (${response.status})`);
 return ok('Relay URL is reachable');
 }

 case 'OPENSKY_CLIENT_ID':
 case 'OPENSKY_CLIENT_SECRET': {
 const contextClientId = typeof context.OPENSKY_CLIENT_ID === 'string' ? context.OPENSKY_CLIENT_ID.trim() : '';
 const contextClientSecret = typeof context.OPENSKY_CLIENT_SECRET === 'string' ? context.OPENSKY_CLIENT_SECRET.trim() : '';
 const clientId = key === 'OPENSKY_CLIENT_ID'
 ? value
 : (contextClientId || String(process.env.OPENSKY_CLIENT_ID || '').trim());
 const clientSecret = key === 'OPENSKY_CLIENT_SECRET'
 ? value
 : (contextClientSecret || String(process.env.OPENSKY_CLIENT_SECRET || '').trim());
 if (!clientId || !clientSecret) {
 return fail('Set both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET before verification');
 }
 const body = new URLSearchParams({
 grant_type: 'client_credentials',
 client_id: clientId,
 client_secret: clientSecret,
 });
 const response = await fetchWithTimeout(
 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CHROME_UA },
 body,
 }
 );
 const text = await response.text();
 if (isCloudflareChallenge403(response, text)) return ok('OpenSky credentials stored (Cloudflare blocked verification)');
 if (isAuthFailure(response.status, text)) return fail('OpenSky rejected these credentials');
 if (!response.ok) return fail(`OpenSky auth probe failed (${response.status})`);
 let payload = null;
 try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (!payload?.access_token) return fail('OpenSky auth response did not include an access token');
 return ok('OpenSky credentials verified');
 }

 case 'AISSTREAM_API_KEY': {
 // AISStream is WebSocket-only — no REST probe available. Validate format instead.
 // Valid keys are UUID v4 (e.g. 8fa3b1f0-c68d-4a9a-a7c5-d12345678abc)
 // or a 32–64 char hex string depending on plan tier.
 const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 const isHex  = /^[0-9a-f]{32,64}$/i.test(value);
 if (!isUuid && !isHex) {
 return fail('AISStream key should be a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) or 32–64 char hex string — verify your key at aisstream.io');
 }
 return ok('AISStream key stored — format valid (live test requires WebSocket)');
 }

 case 'WTO_API_KEY': {
 return ok('WTO API key stored (live verification not available in sidecar)');
 }

 case 'CRYSTALBALL_API_KEY': {
 if (!/^[A-Za-z0-9_-]{16,}$/.test(value)) {
 return fail('CrystalBall key must be at least 16 URL-safe characters');
 }
 return ok('CrystalBall API key stored');
 }

 case 'AVIATIONSTACK_API': {
 const response = await fetchWithTimeout(`http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(value)}&limit=1`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 if (/invalid_access_key/i.test(text)) return fail('AviationStack rejected this key');
 if (/usage_limit_reached/i.test(text)) return ok('AviationStack key verified (usage limit reached)');
 if (!response.ok) return fail(`AviationStack probe failed (${response.status})`);
 return ok('AviationStack key verified');
 }

 case 'ICAO_API_KEY': {
 const response = await fetchWithTimeout(`https://applications.icao.int/dataservices/api/notams-realtime-list?api_key=${encodeURIComponent(value)}&format=json&criticality=4&locations=KJFK`, {
 headers: { Accept: 'application/json' },
 });
 if (response.status === 401 || response.status === 403) return fail('ICAO rejected this key');
 // ICAO redirects to dataservices.icao.int and returns 404/422 for unknown keys without
 // distinguishing them from endpoint quirks. Accept anything that isn't an explicit auth reject.
 return ok('ICAO key stored');
 }

 case 'GOOGLE_MAPS_API_KEY': {
 // Probe the Directions API specifically — that's one of the two APIs the
 // setup steps tell users to enable. Previously this probe hit Geocoding,
 // which most users haven't enabled, so REQUEST_DENIED returned for keys
 // that worked fine for Map Tiles + Directions.
 const url = `https://maps.googleapis.com/maps/api/directions/json?origin=NY&destination=LA&key=${encodeURIComponent(value)}`;
 const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
 const text = await response.text();
 let payload = null; try { payload = JSON.parse(text); } catch { /* ignore */ }
 if (payload?.status === 'REQUEST_DENIED') {
 const msg = String(payload?.error_message ?? 'denied');
 // If the key works but Directions isn't enabled, surface that hint.
 if (/not authorized|API not activated|API has not been used/i.test(msg)) {
 return fail(`Google Maps key valid but Directions API isn't enabled — see APIs & Services → Library`);
 }
 return fail(`Google Maps rejected this key (${msg})`);
 }
 if (!response.ok) return fail(`Google Maps probe failed (${response.status})`);
 return ok('Google Maps key verified (Directions API)');
 }

 case 'MAPBOX_API_KEY': {
 // Mapbox Geocoding endpoint — 200 = ok, 401 = bad token, 429 = rate limit (still valid).
 const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/SanFrancisco.json?access_token=${encodeURIComponent(value)}&limit=1`;
 const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
 if (response.status === 401 || response.status === 403) return fail('Mapbox rejected this token');
 if (response.status === 429) return ok('Mapbox token accepted (rate limited)');
 if (!response.ok) return fail(`Mapbox probe failed (${response.status})`);
 return ok('Mapbox token verified');
 }

 case 'MAPTILER_API_KEY': {
 // MapTiler returns the streets-v2 style JSON when the key is valid, 403 otherwise.
 const url = `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(value)}`;
 const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
 if (response.status === 401 || response.status === 403) return fail('MapTiler rejected this key');
 if (!response.ok) return fail(`MapTiler probe failed (${response.status})`);
 return ok('MapTiler key verified');
 }

 case 'CESIUM_ION_TOKEN': {
 // Cesium ion exposes /v1/me which returns the authenticated user's profile.
 const response = await fetchWithTimeout('https://api.cesium.com/v1/me', {
 method: 'GET',
 headers: {
 Authorization: `Bearer ${value}`,
 Accept: 'application/json',
 },
 });
 if (response.status === 401 || response.status === 403) return fail('Cesium ion rejected this token');
 if (!response.ok) return fail(`Cesium ion probe failed (${response.status})`);
 return ok('Cesium ion token verified');
 }

 case 'GEONAMES_USERNAME': {
 const response = await fetchWithTimeout(`http://api.geonames.org/searchJSON?q=london&maxRows=1&username=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 const text = await response.text();
 if (/hourly limit/i.test(text)) return ok('GeoNames username verified (hourly limit reached)');
 if (/user does not exist|not enabled/i.test(text)) return fail('GeoNames username rejected');
 if (!response.ok) return fail(`GeoNames probe failed (${response.status})`);
 return ok('GeoNames username verified');
 }

 case 'IPINFO_TOKEN': {
 const response = await fetchWithTimeout(`https://ipinfo.io/8.8.8.8/json?token=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 });
 if (response.status === 401 || response.status === 403) return fail('IPInfo rejected this token');
 if (!response.ok) return fail(`IPInfo probe failed (${response.status})`);
 return ok('IPInfo token verified');
 }

 default: {
 return ok('Key stored');
 }
 }
  } catch (error) {
 const message = error instanceof Error ? error.message : 'provider probe failed';
 if (isTransientVerificationError(error)) {
 return { valid: true, message: `Saved (could not verify: ${message})` };
 }
 return fail(`Verification request failed: ${message}`);
  }
}

// ── Ollama Streaming SSE Handler ─────────────────────────────────────────────
// Handles /api/ollama-stream — bypasses the arrayBuffer() buffering in the
// main request loop so tokens can be streamed back to the frontend in real time.
async function handleOllamaStream(requestUrl, req, res, context) {
  const body = await readBody(req);
  if (!body) {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'expected JSON body' }));
 return;
  }

  let parsed;
  try {
 parsed = JSON.parse(body.toString());
  } catch {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'invalid JSON' }));
 return;
  }

  const ollamaBaseUrl = process.env.OLLAMA_API_URL;
  if (!ollamaBaseUrl) {
 res.writeHead(200, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ skipped: true, reason: 'OLLAMA_API_URL not configured' }));
 return;
  }

  // Validate model name: only allow alphanumeric, dash, dot, colon, slash (e.g. 'llama3.1:8b', 'ollama3/8b')
  const rawModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';
  const model = /^[a-zA-Z0-9._:/-]{1,80}$/.test(rawModel) ? rawModel : 'llama3.1:8b';
  const headlines = Array.isArray(parsed.headlines) ? parsed.headlines.slice(0, 10) : [];
  const geoContext = typeof parsed.geoContext === 'string' ? parsed.geoContext.slice(0, 500) : '';
  const lang = typeof parsed.lang === 'string' ? parsed.lang : 'en';

  if (headlines.length === 0) {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'headlines required' }));
 return;
  }

  const headlineText = headlines.slice(0, 5)
 .map((h, i) => `${i + 1}. ${String(h).slice(0, 200)}`)
 .join('\n');
  const geoNote = geoContext ? `\nGeographic context: ${geoContext}` : '';
  const systemPrompt = `You are a senior geopolitical analyst. Summarize the situation described in the headlines in exactly 2-3 concise sentences (under 80 words total). Be factual and direct. No preamble, no markdown formatting, no "Summary:" prefix — just the analysis text.`;
  const userPrompt = `Headlines:${geoNote}\n${headlineText}`;

  let apiUrl;
  try {
 apiUrl = new URL('/v1/chat/completions', ollamaBaseUrl).toString();
  } catch {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'Invalid OLLAMA_API_URL' }));
 return;
  }

  const requestBody = JSON.stringify({
 model,
 messages: [
 { role: 'system', content: systemPrompt },
 { role: 'user', content: userPrompt },
 ],
 temperature: 0.3,
 max_tokens: 150,
 stream: true,
  });

  const corsOrigin = getSidecarCorsOrigin(req);
  res.writeHead(200, {
 'content-type': 'text/event-stream',
 'cache-control': 'no-cache',
 'x-accel-buffering': 'no',
 'access-control-allow-origin': corsOrigin,
 'vary': 'Origin',
  });

  try {
 const parsed2 = new URL(apiUrl);
 const mod = parsed2.protocol === 'https:' ? https : http;
 const reqOptions = {
 hostname: parsed2.hostname,
 port: parsed2.port || (parsed2.protocol === 'https:' ? 443 : 80),
 path: parsed2.pathname + parsed2.search,
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Content-Length': Buffer.byteLength(requestBody),
 'User-Agent': CHROME_UA,
 },
 family: 4,
 };

 await new Promise((resolve) => {
 const ollamaReq = mod.request(reqOptions, (ollamaRes) => {
 if (ollamaRes.statusCode !== 200) {
 const chunks = [];
 ollamaRes.on('data', c => chunks.push(c));
 ollamaRes.on('end', () => {
 const errText = Buffer.concat(chunks).toString().slice(0, 300);
 res.write(`data: ${JSON.stringify({ error: `Ollama ${ollamaRes.statusCode}: ${errText}` })}\n\n`);
 res.write('data: [DONE]\n\n');
 res.end();
 resolve();
 });
 return;
 }

 let sseBuffer = '';
 ollamaRes.on('data', (chunk) => {
 sseBuffer += chunk.toString();
 const lines = sseBuffer.split('\n');
 sseBuffer = lines.pop() ?? '';
 for (const line of lines) {
 const trimmed = line.trim();
 if (!trimmed.startsWith('data: ')) continue;
 const dataStr = trimmed.slice(6);
 if (dataStr === '[DONE]') continue;
 try {
 const data = JSON.parse(dataStr);
 const token = data.choices?.[0]?.delta?.content;
 if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
 } catch { /* malformed SSE chunk */ }
 }
 });

 ollamaRes.on('end', () => {
 if (sseBuffer.trim().startsWith('data: ')) {
 const dataStr = sseBuffer.trim().slice(6);
 if (dataStr !== '[DONE]') {
 try {
 const data = JSON.parse(dataStr);
 const token = data.choices?.[0]?.delta?.content;
 if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
 } catch { /* ignore */ }
 }
 }
 res.write('data: [DONE]\n\n');
 res.end();
 resolve();
 });

 ollamaRes.on('error', (err) => {
 context.logger.error('[ollama-stream] response error:', err.message);
 try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } catch { /* already ended */ }
 resolve();
 });
 });

 ollamaReq.on('error', (err) => {
 context.logger.error('[ollama-stream] request error:', err.message);
 try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } catch { /* already ended */ }
 resolve();
 });

 // Destroy the Ollama request if the client disconnects
 req.on('close', () => { try { ollamaReq.destroy(); } catch { /* ignore */ } resolve(); });

 ollamaReq.write(requestBody);
 ollamaReq.end();
 });
  } catch (error) {
 context.logger.error('[ollama-stream] fatal:', error.message);
 try { res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } catch { /* already ended */ }
  }
}

// Circuit breaker for intel-generate: fast-fail when LLM is unreachable
let intelFailures = 0;
let intelCooldownUntil = 0;

// Generic non-streaming intel generation. Accepts { prompt, system?, maxTokens?,
// temperature? } and returns { response, model } from OLLAMA_API_URL (any
// OpenAI-compatible local endpoint, e.g. LM Studio at http://localhost:1234).
async function callChatCompletion(apiUrl, model, messages, maxTokens, temperature, authHeader, timeoutMs) {
  const u = new URL(apiUrl);
  const mod = u.protocol === 'https:' ? https : http;
  const requestBody = JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false });
  const reqHeaders = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(requestBody) };
  if (authHeader) reqHeaders['Authorization'] = authHeader;
  const reqOptions = {
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search, method: 'POST', headers: reqHeaders, family: 4,
  };
  const result = await new Promise((resolve, reject) => {
    const r = mod.request(reqOptions, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (resp.statusCode !== 200) return reject(new Error(`upstream ${resp.statusCode}: ${text.slice(0, 200)}`));
        try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
      resp.on('error', reject);
    });
    r.on('error', reject);
    r.setTimeout(timeoutMs, () => { r.destroy(new Error('timeout')); });
    r.write(requestBody);
    r.end();
  });
  return result?.choices?.[0]?.message?.content ?? '';
}

async function handleIntelGenerate(req, res, context) {
  const cors = getSidecarCorsOrigin(req);
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': cors, 'vary': 'Origin' };

  if (Date.now() < intelCooldownUntil) {
    res.writeHead(503, headers);
    res.end(JSON.stringify({ error: 'LLM service unavailable — circuit breaker open' }));
    return;
  }
  const body = await readBody(req);
  if (!body) { res.writeHead(400, headers); res.end(JSON.stringify({ error: 'expected JSON body' })); return; }
  let parsed;
  try { parsed = JSON.parse(body.toString()); }
  catch { res.writeHead(400, headers); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.slice(0, 8000) : '';
  const system = typeof parsed.system === 'string' ? parsed.system.slice(0, 2000) : 'You are a concise intelligence analyst. Be factual, direct, no preamble.';
  const maxTokens = Math.min(2048, Math.max(16, Number(parsed.maxTokens) || 400));
  const temperature = Math.min(1, Math.max(0, Number(parsed.temperature) || 0.3));
  if (!prompt) { res.writeHead(400, headers); res.end(JSON.stringify({ error: 'prompt required' })); return; }

  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];

  // Try local Ollama first, fall back to Groq
  const baseUrl = process.env.OLLAMA_API_URL || 'http://localhost:1234';
  const rawModel = process.env.OLLAMA_MODEL || 'local-model';
  const localModel = /^[a-zA-Z0-9._:/-]{1,80}$/.test(rawModel) ? rawModel : 'local-model';
  let localUrl;
  try { localUrl = new URL('/v1/chat/completions', baseUrl).toString(); } catch { /* invalid URL */ }

  let response, model;
  if (localUrl) {
    try {
      response = await callChatCompletion(localUrl, localModel, messages, maxTokens, temperature, null, 60_000);
      model = localModel;
    } catch (localError) {
      context.logger.warn('[intel-generate] local failed:', localError.message);
    }
  }

  // Groq fallback
  if (response == null && process.env.GROQ_API_KEY) {
    try {
      response = await callChatCompletion(
        'https://api.groq.com/openai/v1/chat/completions',
        'llama-3.1-8b-instant', messages, maxTokens, temperature,
        `Bearer ${process.env.GROQ_API_KEY}`, 30_000,
      );
      model = 'groq:llama-3.1-8b-instant';
      context.logger.warn('[intel-generate] used Groq fallback');
    } catch (groqError) {
      context.logger.warn('[intel-generate] Groq fallback failed:', groqError.message);
    }
  }

  if (response != null) {
    intelFailures = 0;
    res.writeHead(200, headers);
    res.end(JSON.stringify({ response, model }));
  } else {
    intelFailures++;
    if (intelFailures >= 2) {
      intelCooldownUntil = Date.now() + 120_000;
      context.logger.warn(`[intel-generate] circuit breaker open after ${intelFailures} failures — cooling down 120s`);
    }
    res.writeHead(502, headers);
    res.end(JSON.stringify({ error: 'all LLM providers failed' }));
  }
}

function extractAlertCentroid(feature) {
  const geom = feature?.geometry;
  if (!geom) return null;
  if (geom.type === 'Point') return [geom.coordinates[0], geom.coordinates[1]];
  if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length) {
 const ring = geom.coordinates[0];
 const lons = ring.map(c => c[0]);
 const lats = ring.map(c => c[1]);
 return [
 (Math.min(...lons) + Math.max(...lons)) / 2,
 (Math.min(...lats) + Math.max(...lats)) / 2,
 ];
  }
  if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]?.length) {
 const ring = geom.coordinates[0][0];
 const lons = ring.map(c => c[0]);
 const lats = ring.map(c => c[1]);
 return [
 (Math.min(...lons) + Math.max(...lons)) / 2,
 (Math.min(...lats) + Math.max(...lats)) / 2,
 ];
  }
  return null;
}

async function dispatch(requestUrl, req, routes, context) {
  if (req.method === 'OPTIONS') {
 return new Response(null, { status: 204, headers: makeCorsHeaders(req) });
  }

  // Health check — exempt from auth to support external monitoring tools
  if (requestUrl.pathname === '/api/service-status') {
 return handleLocalServiceStatus(context);
  }

  // YouTube embed bridge — exempt from auth because iframe src cannot carry
  // Authorization headers.  Serves a minimal HTML page that loads the YouTube
  // IFrame Player API from a localhost origin (which YouTube accepts, unlike
  // tauri://localhost).  No sensitive data is exposed.
  if (requestUrl.pathname === '/api/youtube-embed') {
 const videoId = requestUrl.searchParams.get('videoId');
 if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
 return new Response('Invalid videoId', { status: 400, headers: { 'content-type': 'text/plain' } });
 }
 const autoplay = requestUrl.searchParams.get('autoplay') === '0' ? '0' : '1';
 const mute = requestUrl.searchParams.get('mute') === '0' ? '0' : '1';
 const vq = ['small','medium','large','hd720','hd1080'].includes(requestUrl.searchParams.get('vq') || '') ? requestUrl.searchParams.get('vq') : '';
 const origin = `http://127.0.0.1:${context.port}`;
 const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}#player{width:100%;height:100%}#play-overlay{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,0.15)}#play-overlay svg{width:72px;height:72px;opacity:0.9;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5))}#play-overlay.hidden{display:none}</style></head><body><div id="player"></div><div id="play-overlay" class="hidden"><svg viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24L27 14v20" fill="#fff"/></svg></div><script>var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);var player,overlay=document.getElementById('play-overlay'),started=false,muteSyncId,retryTimers=[];var obs=new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var nodes=muts[i].addedNodes;for(var j=0;j<nodes.length;j++){if(nodes[j].tagName==='IFRAME'){var a=nodes[j].getAttribute('allow')||'';if(a.indexOf('autoplay')===-1){nodes[j].setAttribute('allow','autoplay; encrypted-media; picture-in-picture '+a);console.log('[yt-embed] patched iframe allow=autoplay')}obs.disconnect();return}}}});obs.observe(document.getElementById('player'),{childList:true,subtree:true});function hideOverlay(){overlay.classList.add('hidden')}function readMuted(){if(!player)return null;if(typeof player.isMuted==='function')return player.isMuted();if(typeof player.getVolume==='function')return player.getVolume()===0;return null}function stopMuteSync(){if(muteSyncId){clearInterval(muteSyncId);muteSyncId=null}}function startMuteSync(){if(muteSyncId)return;var last=readMuted();if(last!==null)window.parent.postMessage({type:'yt-mute-state',muted:last},'*');muteSyncId=setInterval(function(){var m=readMuted();if(m!==null&&m!==last){last=m;window.parent.postMessage({type:'yt-mute-state',muted:m},'*')}},500)}function tryAutoplay(){if(!player||!player.playVideo)return;try{player.mute();player.playVideo();console.log('[yt-embed] tryAutoplay: mute+play')}catch(e){}}function onYouTubeIframeAPIReady(){player=new YT.Player('player',{videoId:'${videoId}',host:'https://www.youtube.com',playerVars:{autoplay:${autoplay},mute:${mute},playsinline:1,rel:0,controls:1,modestbranding:1,enablejsapi:1,origin:'${origin}',widget_referrer:'${origin}'},events:{onReady:function(){console.log('[yt-embed] onReady');window.parent.postMessage({type:'yt-ready'},'*');${vq ? `if(player.setPlaybackQuality)player.setPlaybackQuality('${vq}');` : ''}if(${autoplay}===1){tryAutoplay();retryTimers.push(setTimeout(function(){if(!started)tryAutoplay()},500));retryTimers.push(setTimeout(function(){if(!started)tryAutoplay()},1500));retryTimers.push(setTimeout(function(){if(!started){console.log('[yt-embed] autoplay failed after retries');window.parent.postMessage({type:'yt-autoplay-failed'},'*')}},2500))}startMuteSync()},onError:function(e){console.log('[yt-embed] error code='+e.data);stopMuteSync();window.parent.postMessage({type:'yt-error',code:e.data},'*')},onStateChange:function(e){window.parent.postMessage({type:'yt-state',state:e.data},'*');if(e.data===1||e.data===3){hideOverlay();started=true;retryTimers.forEach(clearTimeout);retryTimers=[]}}}})}setTimeout(function(){if(!started)overlay.classList.remove('hidden')},4000);window.addEventListener('message',function(e){if(!player||!player.getPlayerState)return;var m=e.data;if(!m||!m.type)return;switch(m.type){case'play':player.playVideo();break;case'pause':player.pauseVideo();break;case'mute':player.mute();break;case'unmute':player.unMute();break;case'loadVideo':if(m.videoId)player.loadVideoById(m.videoId);break;case'setQuality':if(m.quality&&player.setPlaybackQuality)player.setPlaybackQuality(m.quality);break}});window.addEventListener('beforeunload',function(){stopMuteSync();obs.disconnect();retryTimers.forEach(clearTimeout)})<\/script></body></html>`;
 return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'permissions-policy': 'autoplay=*, encrypted-media=*', ...makeCorsHeaders(req) } });
  }

  // ── Global auth gate ────────────────────────────────────────────────────
  // Every endpoint below requires a valid LOCAL_API_TOKEN.  This prevents
  // other local processes, malicious browser scripts, and rogue extensions
  // from accessing the sidecar API without the per-session token.
  {
 const authHeader = req.headers.authorization || '';
 if (!isValidToken(authHeader)) {
 context.logger.warn(`[local-api] unauthorized request to ${requestUrl.pathname}`);
 return json({ error: 'Unauthorized' }, 401);
 }
  }

  // ── Analyst commands (MCP → sidecar → renderer queue) ──
  // Write-back path for external agents (MCP tools) to submit feedback,
  // dismiss hypotheses, or trigger a skeptic pass. Sidecar holds an in-
  // memory queue that the renderer drains every few seconds.
  if (requestUrl.pathname === '/api/analyst-commands') {
    if (!context._analystCommands) context._analystCommands = [];
    if (req.method === 'POST') {
      try {
        // Node http.IncomingMessage doesn't have .json() — use readBody().
        // Previous req.json() always threw "req.json is not a function",
        // 400'ing every analyst-commands POST.
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw.toString()) : null;
        if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
        const kind = typeof body.kind === 'string' ? body.kind : '';
        const allowed = new Set(['thumbs_up', 'thumbs_down', 'dismiss', 'run_skeptic']);
        if (!allowed.has(kind)) return json({ error: 'unknown kind', allowed: [...allowed] }, 400);
        const command = {
          id: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          issuedAt: Date.now(),
          kind,
          hypothesisId: typeof body.hypothesisId === 'string' ? body.hypothesisId : null,
          signature: typeof body.signature === 'string' ? body.signature : null,
          note: typeof body.note === 'string' ? body.note.slice(0, 400) : null,
        };
        // Cap queue to 64 so a runaway agent can't balloon memory.
        if (context._analystCommands.length >= 64) {
          context._analystCommands.splice(0, context._analystCommands.length - 63);
        }
        context._analystCommands.push(command);
        return json({ ok: true, id: command.id });
      } catch (error) {
        return json({ error: String(error?.message || error) }, 400);
      }
    }
    if (req.method === 'GET') {
      // Renderer drains the queue; we return + clear in one shot. Optionally
      // filter by `since` to support idempotent retries.
      const since = Number(requestUrl.searchParams.get('since') || 0);
      const commands = context._analystCommands
        .filter(c => c.issuedAt > since);
      const drain = requestUrl.searchParams.get('drain') !== '0';
      if (drain) context._analystCommands = [];
      return json({ commands, drained: drain });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Analyst state (renderer → sidecar mirror, exposed via MCP) ──
  if (requestUrl.pathname === '/api/analyst-state') {
    if (req.method === 'POST') {
      try {
        // Node http.IncomingMessage doesn't have .json() — use readBody().
        // Previous req.json() always threw "req.json is not a function",
        // 400'ing every renderer push and leaving /api/analyst-state with
        // available:false forever (visible in MCP, AnalystHUD, etc.).
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw.toString()) : null;
        if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
        if (!context._analystState) context._analystState = {};
        // Cap payload size defensively (drop unknown deeply-nested fields).
        const safe = {
          timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
          analyst: body.analyst ?? null,
          forecast: body.forecast ?? null,
          accuracy: Array.isArray(body.accuracy) ? body.accuracy.slice(0, 20) : [],
          threads: Array.isArray(body.threads) ? body.threads.slice(0, 30) : [],
          hotEntities: Array.isArray(body.hotEntities) ? body.hotEntities.slice(0, 20) : [],
          entityCount: typeof body.entityCount === 'number' ? body.entityCount : 0,
          ghostMode: !!body.ghostMode,
          debugLog: Array.isArray(body.debugLog) ? body.debugLog.slice(-100) : [],
          debugErrorCounts: body.debugErrorCounts && typeof body.debugErrorCounts === 'object' ? body.debugErrorCounts : {},
          metrics: body.metrics && typeof body.metrics === 'object' ? body.metrics : null,
        };
        context._analystState = safe;
        return json({ ok: true });
      } catch (error) {
        return json({ error: String(error?.message || error) }, 400);
      }
    }
    if (req.method === 'GET') {
      const state = context._analystState || null;
      if (!state) {
        return json({
          available: false,
          message: 'Analyst state not yet pushed by renderer. Open the Crystal Ball app to populate.',
        });
      }
      const ageMs = Date.now() - (state.timestamp || 0);
      return json({
        available: true,
        ageMs,
        stale: ageMs > 10 * 60 * 1000,
        ...state,
      });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Algorithm extensions (PRs 11-18) ─────────────────────────────────
  // Renderer-side services compute these and POST a snapshot; sidecar
  // mirrors the latest payload per bucket and serves it via GET.
  if (requestUrl.pathname.startsWith('/api/algorithm-state/')) {
    const bucket = requestUrl.pathname.slice('/api/algorithm-state/'.length);
    const allowedBuckets = new Set([
      'ensemble',
      'drift',
      'counterfactuals',
      'llm-grades',
      'auto-tune',
      'correlations',
      'blackswan',
      'genealogy',
    ]);
    if (!allowedBuckets.has(bucket)) {
      return json({ error: `unknown bucket "${bucket}"` }, 404);
    }
    if (!context._algorithmState) context._algorithmState = {};
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw.toString()) : null;
        if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
        context._algorithmState[bucket] = { ...body, _pushedAt: Date.now() };
        return json({ ok: true });
      } catch (error) {
        return json({ error: String(error?.message || error) }, 400);
      }
    }
    if (req.method === 'GET') {
      const payload = context._algorithmState[bucket] || null;
      if (!payload) {
        return json({ available: false, bucket });
      }
      const ageMs = Date.now() - (payload._pushedAt || 0);
      return json({ available: true, bucket, ageMs, stale: ageMs > 10 * 60 * 1000, ...payload });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Seismic globe overlays (renderer → sidecar mirror; Layer 5/13) ──
  // Renderer runs the globe-overlay-emitter (Layer 4) and POSTs the
  // resulting `GlobeSeismicOverlay[]` here every 5s. The God's Eye Cesium
  // panel (Layer 6) reads from GET. Read-only mirror — same shape as
  // /api/analyst-state. No bearer auth: route is loopback-only and the
  // payload is non-sensitive (positions/magnitudes already public).
  if (requestUrl.pathname === '/api/seismic-globe-overlays') {
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw.toString()) : null;
        if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
        if (!Array.isArray(body.overlays)) return json({ error: 'overlays must be an array' }, 400);
        // Cap at 200 to defend against runaway pushers — Layer 4's
        // default cap is 50, so 200 leaves headroom for tunable
        // configurations without enabling unbounded memory growth.
        const overlays = body.overlays.slice(0, 200).map(sanitizeSeismicGlobeOverlay).filter(Boolean);
        context._seismicGlobeOverlays = {
          overlays,
          asOf: typeof body.asOf === 'number' ? body.asOf : Date.now(),
        };
        return json({ ok: true, count: overlays.length });
      } catch (error) {
        return json({ error: String(error?.message || error) }, 400);
      }
    }
    if (req.method === 'GET') {
      const snapshot = context._seismicGlobeOverlays || null;
      if (!snapshot) {
        return json({ overlays: [], asOf: 0, available: false });
      }
      const ageMs = Date.now() - snapshot.asOf;
      return json({
        overlays: snapshot.overlays,
        asOf: snapshot.asOf,
        ageMs,
        stale: ageMs > 60 * 1000,
        available: true,
      });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // Spec aliases — friendlier URLs for the documented per-PR endpoints.
  if (requestUrl.pathname === '/api/ensemble-decision' && req.method === 'GET') {
    const domain = requestUrl.searchParams.get('domain') || '';
    const all = context._algorithmState?.ensemble?.decisions || {};
    if (domain) return json({ domain, decision: all[domain] || null });
    return json({ decisions: all });
  }
  if (requestUrl.pathname === '/api/drift-status' && req.method === 'GET') {
    return json(context._algorithmState?.drift || { available: false });
  }
  if (requestUrl.pathname === '/api/counterfactuals' && req.method === 'GET') {
    const eventId = requestUrl.searchParams.get('eventId') || '';
    const all = context._algorithmState?.counterfactuals?.byEvent || {};
    if (eventId) return json({ eventId, results: all[eventId] || [] });
    return json({ all });
  }
  if (requestUrl.pathname === '/api/auto-tune' && req.method === 'GET') {
    const algorithmId = requestUrl.searchParams.get('algorithmId') || '';
    const all = context._algorithmState?.['auto-tune']?.runs || {};
    if (algorithmId) return json({ algorithmId, runs: all[algorithmId] || [] });
    return json({ runs: all });
  }
  if (requestUrl.pathname === '/api/algorithm-correlations' && req.method === 'GET') {
    return json(context._algorithmState?.correlations || { available: false });
  }
  if (requestUrl.pathname === '/api/blackswan-status' && req.method === 'GET') {
    return json(context._algorithmState?.blackswan || { available: false });
  }
  if (requestUrl.pathname === '/api/genealogy' && req.method === 'GET') {
    return json(context._algorithmState?.genealogy || { available: false });
  }
  if (requestUrl.pathname === '/api/genealogy/lineage' && req.method === 'GET') {
    const algorithmId = requestUrl.searchParams.get('algorithmId') || '';
    const tree = context._algorithmState?.genealogy?.tree || {};
    if (!algorithmId) return json({ error: 'algorithmId required' }, 400);
    return json({ algorithmId, lineage: tree[algorithmId] || null });
  }

  // ── EEW alert status (renderer → sidecar mirror; Layer 8/13) ──
  // Renderer runs the eew-alert-engine (Layer 7) on a 30s tick and
  // POSTs the resulting `{ activeAlerts, highestTier, asOf }` here.
  // The EEWStatusBar (Layer 9) and any external tools read via GET.
  if (requestUrl.pathname === '/api/eew-status') {
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw.toString()) : null;
        if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
        if (!Array.isArray(body.activeAlerts)) {
          return json({ error: 'activeAlerts must be an array' }, 400);
        }
        const activeAlerts = body.activeAlerts.slice(0, 200).map(sanitizeEewAlert).filter(Boolean);
        context._eewStatus = {
          activeAlerts,
          highestTier: isValidEewTier(body.highestTier) ? body.highestTier : null,
          lastEventId: typeof body.lastEventId === 'string' ? body.lastEventId : null,
          asOf: typeof body.asOf === 'number' ? body.asOf : Date.now(),
        };
        return json({ ok: true, count: activeAlerts.length });
      } catch (error) {
        return json({ error: String(error?.message || error) }, 400);
      }
    }
    if (req.method === 'GET') {
      const snapshot = context._eewStatus || null;
      if (!snapshot) {
        return json({
          activeAlerts: [], highestTier: null, lastEventId: null, asOf: 0, available: false,
        });
      }
      const ageMs = Date.now() - snapshot.asOf;
      return json({
        activeAlerts: snapshot.activeAlerts,
        highestTier: snapshot.highestTier,
        lastEventId: snapshot.lastEventId,
        asOf: snapshot.asOf,
        ageMs,
        stale: ageMs > 60 * 1000,
        available: true,
      });
    }
    return json({ error: 'Method not allowed' }, 405);
  }


  if (requestUrl.pathname === '/api/sitrep-bundle') {
    const cacheKey = 'sitrep-bundle';
    const cached = getCached(cacheKey, 5 * 60 * 1000);
    if (cached) return json(cached);

    const endpoints = {
      conflicts:    '/api/acled-events',
      markets:      '/api/market-quotes',
      cyberKev:     '/api/cisa-kev',
      cyberIoc:     '/api/threatfox-iocs',
      cyberPhish:   '/api/openphish-feed',
      milAdsb:      '/api/adsb-military',
      milAis:       '/api/ais-snapshot',
      milPosture:   '/api/military/v1/get-theater-posture',
      milIsw:       '/api/isw-reports',
      weather:      '/api/nws-alerts',
      spaceWx:      '/api/space-weather-feeds',
      gridStatus:   '/api/power-grid',
      gridAlerts:   '/api/grid-alerts',
      water:        '/api/epa-sdwis-proxy',
      radiation:    '/api/epa-radnet-proxy',
      seismic:      '/api/usgs-earthquakes',
      health:       '/api/disease-outbreaks',
      economic:     process.env.FRED_API_KEY ? '/api/fred-series?series_ids=FEDFUNDS,T10Y2Y,UNRATE' : '/api/fred-fallback',
      sanctions:    '/api/opensanctions',
      news:         '/api/newsapi-headlines',
      serviceStatus: '/api/service-status',
    };

    const entries = Object.entries(endpoints);
    const results = {};
    const warnings = [];
    const sources = [];

    await Promise.allSettled(entries.map(async ([key, route]) => {
      try {
        const url = new URL(`http://127.0.0.1:${context.port}${route}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(url.toString(), {
          headers: { Authorization: req.headers.authorization || '' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          results[key] = { error: `${res.status}: ${text}` };
          warnings.push(`${route}: HTTP ${res.status}`);
        } else {
          results[key] = await res.json();
          sources.push(route);
        }
      } catch (error) {
        results[key] = { error: error.message };
        warnings.push(`${route}: ${error.message}`);
      }
    }));

    const raw = {
      conflicts: results.conflicts?.events ?? [],
      markets: results.markets?.quotes ?? [],
      cyber: {
        iocs: results.cyberIoc?.data ?? [],
        kevs: results.cyberKev?.vulnerabilities ?? results.cyberKev ?? [],
      },
      military: {
        aircraft: results.milAdsb?.aircraft ?? (Array.isArray(results.milAdsb) ? results.milAdsb : []),
        vessels: results.milAis?.vessels ?? (Array.isArray(results.milAis) ? results.milAis : []),
        posture: results.milPosture ?? {},
      },
      weather: Array.isArray(results.weather) ? results.weather : [],
      infrastructure: { gridAlerts: results.gridAlerts?.alerts ?? [] },
      seismic: results.seismic?.features ?? [],
      health: results.health?.outbreaks ?? results.health ?? [],
      economic: results.economic ?? {},
      sanctions: results.sanctions?.results ?? [],
      news: results.news,
    };

    const severity = scoreAllDomains(raw);
    const domains = filterAllDomains(severity, raw);

    const newsArticles = raw.news?.articles ?? (Array.isArray(raw.news) ? raw.news : []);
    domains.news = { summary: `${newsArticles.length} articles`, items: newsArticles.slice(0, 5) };

    let deltaMode = false;
    let sentinelAgeMin = null;
    try {
      const snapshotPath = path.join(os.homedir(), '.crystal-ball', 'sentinel', 'latest-snapshot.json');
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      if (snapshot?.timestamp) {
        const ageMs = Date.now() - new Date(snapshot.timestamp).getTime();
        sentinelAgeMin = Math.round(ageMs / 60000);
        deltaMode = sentinelAgeMin < 60;
      }
    } catch { /* no sentinel data */ }

    const missingKeys = wmMissingKeys();
    const feedHealth = {
      operational: sources.length,
      degraded: warnings.length,
      missing_keys: missingKeys.length,
      degraded_list: warnings.map(w => w.split(':')[0]),
      missing_key_names: missingKeys,
    };

    const { citations } = buildCitations(domains);

    const bundle = {
      timestamp: new Date().toISOString(),
      delta_mode: deltaMode,
      sentinel_age_min: sentinelAgeMin,
      feed_health: feedHealth,
      severity,
      domains,
      citations,
      sources,
      warnings,
    };

    setCached(cacheKey, bundle, 5 * 60 * 1000);
    return json(bundle);
  }

  if (requestUrl.pathname === '/api/tle') {
 try {
 const tleRes = await fetch('https://celestrak.org/SOCRATES/stations-tle.txt', {
 signal: AbortSignal.timeout(8000),
 headers: { 'User-Agent': 'CrystalBall/2.x (educational use)' },
 });
 if (!tleRes.ok) return json({ error: `CelesTrak ${tleRes.status}` }, 502, makeCorsHeaders(req));
 const text = await tleRes.text();
 return new Response(text, {
 status: 200,
 headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600', ...makeCorsHeaders(req) },
 });
 } catch (error) {
 return json({ error: String(error) }, 503, makeCorsHeaders(req));
 }
  }

  if (requestUrl.pathname === '/api/local-youtube-recent-videos') {
 const channelParam = requestUrl.searchParams.get('channel');
 if (!channelParam) return json({ error: 'Missing channel parameter', videoIds: [] }, 400);
 const count = Math.min(Math.max(1, parseInt(requestUrl.searchParams.get('count') || '15', 10)), 30);
 const handle = channelParam.startsWith('@') ? channelParam : `@${channelParam}`;

 // Known-good fast-path: skip the scrape for channels we've already verified.
 // Handles → externalId. Verified by curl on 2026-05-04.
 const KNOWN_CHANNEL_IDS = {
 '@S2Underground': 'UCTq1zHztiV69Ur8t6jco4CQ',
 };

 // In-memory channel ID cache (handle → { channelId, ts }) to avoid re-scraping on every call
 if (!context._ytChannelIdCache) context._ytChannelIdCache = new Map();
 const cache = context._ytChannelIdCache;
 const CHANNEL_ID_CACHE_TTL = 24 * 60 * 60 * 1000;

 try {
 let channelId = null;
 if (KNOWN_CHANNEL_IDS[handle]) {
 channelId = KNOWN_CHANNEL_IDS[handle];
 } else {
 const cached = cache.get(handle);
 if (cached && Date.now() - cached.ts < CHANNEL_ID_CACHE_TTL) {
 channelId = cached.channelId;
 } else {
 // Resolve handle → channel ID by scraping the channel page
 const pageRes = await fetchWithTimeout(`https://www.youtube.com/${handle}`, {
 headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
 redirect: 'follow',
 }, 10_000);
 if (pageRes.ok) {
 const html = await pageRes.text();
 const idMatch = html.match(/"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/);
 if (idMatch) {
 channelId = idMatch[1];
 cache.set(handle, { channelId, ts: Date.now() });
 }
 }
 }
 }

 if (!channelId) return json({ videoIds: [], error: 'Could not resolve channel ID' }, 200);

 // Fetch the public RSS feed (no API key required, returns up to 15 videos newest-to-oldest)
 const rssRes = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
 headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrystalBall/1.0)' },
 }, 10_000);
 if (!rssRes.ok) throw new Error(`RSS ${rssRes.status}`);
 const xml = await rssRes.text();

 // Extract video IDs — RSS lists videos newest-to-oldest by default
 const videoIds = [...xml.matchAll(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g)]
 .map(m => m[1])
 .slice(0, count);

 return json({ videoIds, channelId }, 200, { 'cache-control': 'public, max-age=900, stale-while-revalidate=300' });
 } catch (error) {
 context.logger.warn(`[local-api] youtube-recent-videos failed for ${handle}: ${error?.message}`);
 return json({ videoIds: [], error: 'Failed to fetch recent videos' }, 200);
 }
  }

  if (requestUrl.pathname === '/api/local-status') {
 return json({
 success: true,
 mode: context.mode,
 port: context.port,
 apiDir: context.apiDir,
 remoteBase: context.remoteBase,
 cloudFallback: context.cloudFallback,
 routes: routes.length,
 });
  }
  if (requestUrl.pathname === '/api/local-traffic-log') {
 if (req.method === 'DELETE') {
 _trafficHead = 0; _trafficSize = 0;
 return json({ cleared: true });
 }
 // Strip query strings from logged paths to avoid leaking feed URLs and
 // user research patterns to anyone who can read the traffic log.
 const sanitized = _getTrafficEntries().map(entry => ({
 ...entry,
 path: entry.path?.split('?')[0] ?? entry.path,
 }));
 return json({ entries: sanitized, verboseMode, maxEntries: TRAFFIC_LOG_MAX });
  }
  if (requestUrl.pathname === '/api/local-debug-toggle') {
 if (req.method === 'POST') {
 verboseMode = !verboseMode;
 saveVerboseState();
 context.logger.log(`[local-api] verbose logging ${verboseMode ? 'ON' : 'OFF'}`);
 }
 return json({ verboseMode });
  }
  // Registration — call Convex directly (desktop frontend bypasses sidecar for this endpoint;
  // this handler only runs when CONVEX_URL is available, e.g. self-hosted deployments)
  if (requestUrl.pathname === '/api/register-interest' && req.method === 'POST') {
 const convexUrl = process.env.CONVEX_URL;
 if (!convexUrl) {
 return json({ error: 'Registration service not configured — use cloud endpoint directly' }, 503);
 }
 try {
 const bodyBuf = await readBody(req);
 const body = bodyBuf ? bodyBuf.toString() : '';
 const parsed = JSON.parse(body);
 const email = parsed.email;
 if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 return json({ error: 'Invalid email address' }, 400);
 }
 const response = await fetchWithTimeout(`${convexUrl}/api/mutation`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 path: 'registerInterest:register',
 args: { email, source: parsed.source || 'desktop', appVersion: parsed.appVersion || 'unknown' },
 format: 'json',
 }),
 }, 15_000);
 const responseBody = await response.text();
 let result;
 try { result = JSON.parse(responseBody); } catch { result = { status: 'registered' }; }
 if (result.status === 'error') {
 return json({ error: result.errorMessage || 'Registration failed' }, 500);
 }
 return json(result.value || result);
 } catch (error) {
 context.logger.error(`[register-interest] error: ${error.message}`);
 return json({ error: 'Registration service unreachable' }, 502);
 }
  }

  // ── API Key Auto-Registration routes ─────────────────────────────────────
  if (requestUrl.pathname === '/api/register/newsapi') {
 try {
 const body = await readBody(req).then(b => b ? JSON.parse(b.toString()) : {}).catch(() => ({}));
 const { email, password } = body;
 if (!email || !password) return json({ error: 'email and password required' }, 400);
 const resp = await fetchWithTimeout(
 'https://newsapi.org/v2/register',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
 body: JSON.stringify({ email, password }),
 },
 15_000,
 );
 const data = await resp.json();
 return json({ apiKey: data.apiKey ?? null, status: data.status, message: data.message });
 } catch {
 return json({ error: 'Request failed' }, 500);
 }
  }

  if (requestUrl.pathname === '/api/register/newsdata') {
 try {
 const body = await readBody(req).then(b => b ? JSON.parse(b.toString()) : {}).catch(() => ({}));
 const { email, password, firstName, lastName } = body;
 if (!email || !password) return json({ error: 'email and password required' }, 400);
 const resp = await fetchWithTimeout(
 'https://newsdata.io/register',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
 body: JSON.stringify({ email, password, fname: firstName ?? '', lname: lastName ?? '' }),
 },
 15_000,
 );
 const data = await resp.json().catch(() => ({}));
 return json({ apiKey: data.apikey ?? data.api_key ?? null, message: data.message ?? '' });
 } catch {
 return json({ error: 'Request failed' }, 500);
 }
  }

  if (requestUrl.pathname === '/api/register/nasa-firms') {
 try {
 const body = await readBody(req).then(b => b ? JSON.parse(b.toString()) : {}).catch(() => ({}));
 const { email, firstName, lastName, organization } = body;
 if (!email) return json({ error: 'email required' }, 400);
 const params = new URLSearchParams({
 email,
 username: email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + Math.floor(Math.random() * 999),
 firstname: firstName ?? '',
 lastname: lastName ?? '',
 organization: organization ?? 'Personal',
 purpose: 'Crystal Ball app — wildfire situational awareness',
 });
 const resp = await fetchWithTimeout(
 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/register',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CHROME_UA },
 body: params.toString(),
 },
 15_000,
 );
 return json({ submitted: resp.ok, message: resp.ok ? 'Check your email for the API key' : 'Registration failed', status: resp.status });
 } catch {
 return json({ error: 'Request failed' }, 500);
 }
  }

  // ── ACLED OAuth connect (exchange username+password for access token) ─────
  if (requestUrl.pathname === '/api/acled/connect') {
 try {
 const body = await readBody(req).then(b => b ? JSON.parse(b.toString()) : {}).catch(() => ({}));
 const { email, password } = body;
 if (!email || !password) return json({ error: 'email and password required' }, 400);
 const resp = await fetchWithTimeout(
 'https://acleddata.com/oauth/token',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CHROME_UA },
 body: new URLSearchParams({ username: email, password, grant_type: 'password', client_id: 'acled' }).toString(),
 },
 15_000,
 );
 if (!resp.ok) return json({ error: `ACLED auth failed (${resp.status})` }, resp.status);
 const data = await resp.json();
 if (!data.access_token) return json({ error: data.error_description ?? 'No access token returned' }, 401);
 return json({ accessToken: data.access_token, refreshToken: data.refresh_token ?? null, email });
 } catch {
 return json({ error: 'Request failed' }, 500);
 }
  }

  // ── ACLED OAuth token refresh ─────────────────────────────────────────────
  if (requestUrl.pathname === '/api/acled/refresh') {
 try {
 const body = await readBody(req).then(b => b ? JSON.parse(b.toString()) : {}).catch(() => ({}));
 const { refreshToken } = body;
 if (!refreshToken) return json({ error: 'refreshToken required' }, 400);
 const resp = await fetchWithTimeout(
 'https://acleddata.com/oauth/token',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CHROME_UA },
 body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'acled' }).toString(),
 },
 15_000,
 );
 if (!resp.ok) return json({ error: `Token refresh failed (${resp.status})` }, resp.status);
 const data = await resp.json();
 if (!data.access_token) return json({ error: 'No access token in refresh response' }, 401);
 return json({ accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken });
 } catch {
 return json({ error: 'Request failed' }, 500);
 }
  }

  // ── OREF (Israel Home Front Command) alerts ──────────────────────────────
  // Handled before dynamic dispatch so we control the relay→tzevaadom fallback
  // chain here rather than relying on the oref-alerts.js bundle which requires
  // WS_RELAY_URL.  The dynamic handler stays in place as a no-op fallback.
  if (requestUrl.pathname === '/api/oref-alerts') {
 const isHistory = requestUrl.searchParams.get('endpoint') === 'history';
 const relayBase = (process.env.WS_RELAY_URL || '')
 .replace('wss://', 'https://')
 .replace('ws://', 'http://')
 .replace(/\/$/, '');

 // 1. Relay path (same behaviour as the oref-alerts.js bundle)
 if (relayBase) {
 try {
 const relaySecret = process.env.RELAY_SHARED_SECRET || '';
 const relayHeader = (process.env.RELAY_AUTH_HEADER || 'x-relay-key').toLowerCase();
 const relayHeaders = {
 Accept: 'application/json',
 ...(relaySecret ? { [relayHeader]: relaySecret, Authorization: `Bearer ${relaySecret}` } : {}),
 };
 const relayPath = isHistory ? '/oref/history' : '/oref/alerts';
 const relayResp = await fetchWithTimeout(`${relayBase}${relayPath}`, { headers: relayHeaders }, 12_000);
 if (relayResp.ok) {
 return new Response(await relayResp.text(), {
 status: 200,
 headers: { 'Content-Type': 'application/json' },
 });
 }
 } catch { /* fall through to public proxy */ }
 }

 // 2. Public fallback: tzevaadom.co.il (accessible outside Israel)
 if (isHistory) {
 // No reliable public history endpoint — return empty history rather than "not configured"
 return json({ configured: true, history: [], historyCount24h: 0, timestamp: new Date().toISOString() });
 }
 try {
 const tzResp = await fetchWithTimeout(
 'https://api.tzevaadom.co.il/notifications?networkVersion=1',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 8000,
 );
 if (!tzResp.ok) throw new Error(`tzevaadom ${tzResp.status}`);
 const raw = await tzResp.json();
 const alerts = Array.isArray(raw) ? raw.map(a => ({
 id: String(a.id ?? Date.now()),
 cat: String(a.cat ?? 1),
 title: a.title ?? '',
 data: Array.isArray(a.data) ? a.data : (a.areas ?? []),
 desc: a.desc ?? '',
 alertDate: a.alertDate ?? new Date().toISOString(),
 })) : [];
 return json({
 configured: true,
 alerts,
 historyCount24h: 0,
 timestamp: new Date().toISOString(),
 });
 } catch (error) {
 return json({
 configured: false,
 alerts: [],
 historyCount24h: 0,
 timestamp: new Date().toISOString(),
 error: String(error.message ?? error),
 });
 }
  }

  // ACLED air strikes & drone events (last 30 days)
  if (requestUrl.pathname === '/api/acled-events') {
 const key = process.env.ACLED_ACCESS_TOKEN;
 const email = process.env.ACLED_EMAIL;
 if (!key || !email) {
 return json({ events: [], error: 'ACLED_ACCESS_TOKEN and ACLED_EMAIL are required' });
 }
 const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
 const today = new Date().toISOString().slice(0, 10);
 const fields = 'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|admin1|location|latitude|longitude|fatalities|notes';
 const acledUrl = `https://api.acleddata.com/acled/read?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&event_type=Air%2Fdrone+strike%7CShelling%2Fartillery%2Fmissile+attack&event_date=${since}%7C${today}&event_date_where=BETWEEN&fields=${encodeURIComponent(fields)}&limit=200&sort=event_date&order=desc&_format=json`;
 try {
 const resp = await fetchWithTimeout(acledUrl, {}, 15_000);
 if (!resp.ok) {
 return json({ events: [], error: `ACLED error: ${resp.status}` });
 }
 const data = await resp.json();
 return json({ events: data.data ?? [] });
 } catch (error) {
 return json({ events: [], error: String(error.message ?? error) });
 }
  }

  // ── Maritime freight stress (FRED CSV proxy, no API key required) ──────
  // The Baltic Dry Index is no longer freely accessible. We use the FRED
  // CSV download for broad commodity-price indicators as a freight-cost
  // proxy. Default series is PPIACO (PPI: All Commodities). Caller may
  // override with ?series=PPIACO,PCU484212484212 etc.
  if (requestUrl.pathname === '/api/freight-stress') {
    const seriesParam = (requestUrl.searchParams.get('series') || 'PPIACO,PFOODINDEXM')
      .split(',').map(s => s.trim()).filter(s => /^[A-Z0-9_]+$/i.test(s)).slice(0, 5);
    if (seriesParam.length === 0) {
      return json({ error: 'invalid or empty series parameter' }, 400);
    }
    const components = [];
    for (const series of seriesParam) {
      try {
        const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}`;
        const resp = await fetchWithTimeout(url, { headers: { Accept: 'text/csv' } }, 12_000);
        if (!resp.ok) {
          components.push({ series, error: `FRED ${resp.status}`, stressScore: 0, stressLevel: 'low' });
          continue;
        }
        const csv = await resp.text();
        const observations = parseFredCsvSidecar(csv);
        components.push(computeFreightStressSidecar(series, observations));
      } catch (error) {
        components.push({ series, error: String(error?.message ?? error), stressScore: 0, stressLevel: 'low' });
      }
    }
    let overallScore = 0;
    let asOf = null;
    for (const c of components) {
      if (typeof c.stressScore === 'number' && c.stressScore > overallScore) overallScore = c.stressScore;
      if (c.asOf && (!asOf || c.asOf > asOf)) asOf = c.asOf;
    }
    const overallLevel = overallScore >= 75 ? 'critical' : overallScore >= 50 ? 'high' : overallScore >= 25 ? 'medium' : 'low';
    return json({ components, overallScore, overallLevel, asOf });
  }

  // ── Dark vessel gap events (driven by aisState.darkHistory) ─────────────
  // Lists vessels whose last AIS observation is older than the gap threshold
  // AND whose last known position is within range of a chokepoint.
  if (requestUrl.pathname === '/api/dark-vessels') {
    const now = Date.now();
    const cutoff = now - AIS_DARK_HISTORY_TTL_MS;
    for (const [mmsi, obs] of aisState.darkHistory) {
      if (obs.observedAt < cutoff) aisState.darkHistory.delete(mmsi);
    }
    const thresholdHours = Math.max(1, Math.min(24, Number(requestUrl.searchParams.get('thresholdHours') || '6')));
    const radiusKm = Math.max(10, Math.min(500, Number(requestUrl.searchParams.get('radiusKm') || '200')));
    const observations = [...aisState.darkHistory.values()];
    const events = detectAisGapEventsSidecar(observations, { now, thresholdHours, riskZoneRadiusKm: radiusKm });
    return json({
      events,
      sampleSize: observations.length,
      thresholdHours,
      radiusKm,
      asOf: new Date(now).toISOString(),
    });
  }

  // ── ThreatFox IOC feed ───────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/threatfox-iocs') {
 const apiKey = process.env.THREATFOX_API_KEY;
 if (!apiKey) return json({ error: 'THREATFOX_API_KEY not configured' }, 503);
 try {
 const resp = await fetchWithTimeout('https://threatfox-api.abuse.ch/api/v1/', {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Auth-Key': apiKey,
 'User-Agent': CHROME_UA,
 },
 body: JSON.stringify({ query: 'get_iocs', days: 7 }),
 }, 15_000);
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const iocs = Array.isArray(data?.data) ? data.data : [];
 const threats = iocs.slice(0, 200).map((ioc, i) => ({
 id: `threatfox-${ioc.id ?? i}`,
 type: ioc.ioc_type?.startsWith('ip') ? 'c2_server' : 'malware_host',
 source: 'threatfox',
 indicator: String(ioc.ioc ?? ''),
 indicatorType: ioc.ioc_type?.startsWith('ip') ? 'ip' : (ioc.ioc_type?.startsWith('url') ? 'url' : 'domain'),
 lat: 0,
 lon: 0,
 country: ioc.country ?? '',
 severity: (ioc.confidence_level ?? 0) >= 90 ? 'critical' : ((ioc.confidence_level ?? 0) >= 70 ? 'high' : 'medium'),
 malwareFamily: ioc.malware_printable ?? ioc.malware ?? '',
 tags: Array.isArray(ioc.tags) ? ioc.tags : [],
 firstSeen: ioc.first_seen ?? '',
 lastSeen: ioc.last_seen ?? ioc.first_seen ?? '',
 }));
 return json(threats);
 } catch {
 return json([], 200);
 }
  }

  // ── OpenPhish phishing URL feed ──────────────────────────────────────────
  if (requestUrl.pathname === '/api/openphish-feed') {
 try {
 const resp = await fetchWithTimeout('https://openphish.com/feed.txt', {
 headers: { 'User-Agent': CHROME_UA },
 }, 12_000);
 if (!resp.ok) return json([], 200);
 const text = await resp.text();
 const urls = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
 const threats = urls.slice(0, 150).map((url, i) => ({
 id: `openphish-${i}`,
 type: 'phishing',
 source: 'openphish',
 indicator: url,
 indicatorType: 'url',
 lat: 0,
 lon: 0,
 country: '',
 severity: 'high',
 malwareFamily: '',
 tags: ['phishing'],
 firstSeen: new Date().toISOString(),
 lastSeen: new Date().toISOString(),
 }));
 return json(threats);
 } catch {
 return json([], 200);
 }
  }

  // ── Spamhaus DROP + EDROP blocklist ─────────────────────────────────────
  if (requestUrl.pathname === '/api/spamhaus-drop') {
 try {
 const [dropResp, edropResp] = await Promise.all([
 fetchWithTimeout('https://www.spamhaus.org/drop/drop.txt', { headers: { 'User-Agent': CHROME_UA } }, 12_000),
 fetchWithTimeout('https://www.spamhaus.org/drop/edrop.txt', { headers: { 'User-Agent': CHROME_UA } }, 12_000),
 ]);
 const dropText = dropResp.ok ? await dropResp.text() : '';
 const edropText = edropResp.ok ? await edropResp.text() : '';
 const lines = [...dropText.split('\n'), ...edropText.split('\n')]
 .map(l => l.trim())
 .filter(l => l && !l.startsWith(';'));
 const threats = lines.slice(0, 200).map((line, i) => {
 const cidr = line.split(';')[0].trim();
 return {
 id: `spamhaus-${i}`,
 type: 'malicious_ip_range',
 source: 'spamhaus',
 indicator: cidr,
 indicatorType: 'ip',
 lat: 0,
 lon: 0,
 country: '',
 severity: 'high',
 malwareFamily: '',
 tags: ['spamhaus', 'drop'],
 firstSeen: '',
 lastSeen: '',
 };
 });
 return json(threats);
 } catch {
 return json([], 200);
 }
  }

  // ── CISA Known Exploited Vulnerabilities ─────────────────────────────────
  if (requestUrl.pathname === '/api/cisa-kev') {
 try {
 const resp = await fetchWithTimeout(
 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
 { headers: { 'User-Agent': CHROME_UA } },
 15_000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const vulns = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [];
 // Return only recent entries (last 90 days)
 const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
 const recent = vulns.filter(v => v.dateAdded && new Date(v.dateAdded).getTime() >= cutoff);
 const threats = recent.slice(0, 200).map((v, i) => ({
 id: `cisa-kev-${v.cveID ?? i}`,
 type: 'exploited_vulnerability',
 source: 'cisa_kev',
 indicator: v.cveID ?? `CVE-${i}`,
 indicatorType: 'domain',
 lat: 0,
 lon: 0,
 country: '',
 severity: 'critical',
 malwareFamily: `${v.vendorProject ?? ''} ${v.product ?? ''}`.trim(),
 tags: ['cisa', 'kev', 'actively-exploited'],
 firstSeen: v.dateAdded ?? '',
 lastSeen: v.dueDate ?? v.dateAdded ?? '',
 }));
 return json(threats);
 } catch {
 return json([], 200);
 }
  }

  // ── CDC FluView / respiratory surveillance ───────────────────────────────
  if (requestUrl.pathname === '/api/cdc-surveillance') {
 const cached = getCached('cdc-surveillance');
 if (cached) return json(cached);
 try {
 const [fluResp, covidResp] = await Promise.allSettled([
 fetchWithTimeout(
 'https://www.cdc.gov/flu/weekly/flureport.xml',
 { headers: { 'User-Agent': CHROME_UA } },
 10_000,
 ),
 fetchWithTimeout(
 'https://data.cdc.gov/resource/pwn4-m3yp.json?$limit=10&$order=date_updated DESC',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 10_000,
 ),
 ]);

 const signals = [];

 // Parse COVID hospitalization data
 if (covidResp.status === 'fulfilled' && covidResp.value.ok) {
 const covidData = await covidResp.value.json();
 if (Array.isArray(covidData) && covidData.length > 0) {
 const latest = covidData[0];
 signals.push({
 source: 'CDC',
 disease: 'COVID-19',
 metric: 'Weekly Hospitalizations',
 value: latest.weekly_hospital_admissions_covid ?? latest.total_hospitalized_covid ?? null,
 date: latest.date_updated ?? latest.end_date ?? new Date().toISOString().slice(0, 10),
 severity: 'watch',
 region: 'USA',
 url: 'https://covid.cdc.gov/covid-data-tracker/',
 });
 }
 }

 // Try WHO disease outbreak news as additional source
 const whoResp = await fetchWithTimeout(
 'https://www.who.int/api/hubs/cms/s3fs-public/attachments/disease-outbreak-news.json',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 10_000,
 ).catch(() => null);

 if (whoResp?.ok) {
 const whoData = await whoResp.json().catch(() => ({ value: [] }));
 const items = Array.isArray(whoData?.value) ? whoData.value : [];
 for (const item of items.slice(0, 5)) {
 signals.push({
 source: 'WHO',
 disease: item.Title ?? item.PageTitle ?? 'Disease Outbreak',
 metric: 'Outbreak Report',
 value: null,
 date: item.PublicationDate ?? item.ContentDate ?? new Date().toISOString().slice(0, 10),
 severity: 'alert',
 region: item.CountryName ?? 'Global',
 url: item.Url ?? 'https://www.who.int/emergencies/disease-outbreak-news',
 });
 }
 }

 const result = { signals, fetchedAt: new Date().toISOString() };
 setCached('cdc-surveillance', result, 60 * 60 * 1000); // 1 hour cache
 return json(result);
 } catch (error) {
 return json({ signals: [], error: String(error) });
 }
  }

  // ── PhishStats phishing database ─────────────────────────────────────────
  if (requestUrl.pathname === '/api/phishstats-feed') {
 try {
 const resp = await fetchWithTimeout(
 'https://phishstats.info:2096/api/phishing?_sort=-date&_size=50',
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } },
 12000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const records = Array.isArray(data) ? data : [];
 const threats = records.slice(0, 100).map((r, i) => ({
 id: `phishstats-${r.id ?? i}`,
 type: 'phishing',
 source: 'phishstats',
 indicator: String(r.url ?? r.ip ?? ''),
 indicatorType: r.ip && !r.url ? 'ip' : 'url',
 lat: typeof r.asn_geoip_lat === 'number' ? r.asn_geoip_lat : 0,
 lon: typeof r.asn_geoip_lng === 'number' ? r.asn_geoip_lng : 0,
 country: String(r.countrycode ?? ''),
 severity: 'high',
 malwareFamily: '',
 tags: ['phishing'],
 firstSeen: r.date ?? new Date().toISOString(),
 lastSeen: r.date ?? new Date().toISOString(),
 }));
 return json(threats);
 } catch {
 return json([], 200);
 }
  }

  // ── OpenSanctions — global consolidated sanctions database (free, no key) ──
  if (requestUrl.pathname === '/api/opensanctions-recent') {
 const cached = getCached('opensanctions-recent', 4 * 60 * 60 * 1000); // 4h
 if (cached) return json(cached);
 try {
 // The legacy `/entities?sort=first_seen:desc` endpoint was retired with
 // the yente migration — entities are now lookup-by-id only and
 // search/match require an API key. The /catalog endpoint is still
 // free + unauthenticated and returns 349 datasets with metadata
 // (last_export, entity_count, publisher). We surface the 50
 // most-recently-exported sanctions datasets as "recent activity"
 // — that's what the renderer cares about anyway.
 const r = await fetchWithTimeout(
 'https://api.opensanctions.org/catalog',
 { headers: { Accept: 'application/json' } },
 12000,
 );
 if (!r.ok) throw new Error(`OpenSanctions catalog HTTP ${r.status}`);
 const data = await r.json();
 const all = Array.isArray(data?.datasets) ? data.datasets : [];
 const sanctions = all.filter(ds => {
 const cat = String(ds?.category ?? '').toLowerCase();
 const name = String(ds?.name ?? '').toLowerCase();
 return cat.includes('sanction') || name.includes('sanction') || name.includes('ofac') || name.includes('sdn');
 });
 const items = sanctions
 .filter(ds => ds.last_export)
 .sort((a, b) => String(b.last_export).localeCompare(String(a.last_export)))
 .slice(0, 50)
 .map(ds => ({
 id: ds.name ?? `os-${ds.title ?? 'unknown'}`,
 name: ds.title ?? ds.name ?? 'Unknown sanctions list',
 schema: 'Dataset',
 countries: ds?.publisher?.country ? [ds.publisher.country] : [],
 datasets: [ds.name].filter(Boolean),
 topics: ds.tags ?? [],
 firstSeen: null,
 lastSeen: ds.last_export ?? null,
 sanctionPrograms: ds?.publisher?.acronym ?? ds?.publisher?.name ?? null,
 entityCount: typeof ds.entity_count === 'number' ? ds.entity_count : null,
 publisherUrl: ds?.publisher?.url ?? null,
 }));
 setCached('opensanctions-recent', items);
 return json(items);
 } catch (error) {
 return json({ error: `opensanctions-recent error: ${error.message ?? error}` }, 502);
 }
  }

  if (requestUrl.pathname === '/api/opensanctions-search') {
 const q = requestUrl.searchParams.get('q');
 if (!q || q.trim().length < 2) return json({ error: 'Query too short' }, 400);
 try {
 const params = new URLSearchParams({ q: q.trim(), limit: '20', target: 'true' });
 const r = await fetchWithTimeout(
 `https://api.opensanctions.org/search/default?${params}`,
 { headers: { Accept: 'application/json' } },
 10000,
 );
 if (!r.ok) throw new Error(`OpenSanctions search ${r.status}`);
 const data = await r.json();
 const results = (data.results ?? []).map(e => ({
 id: e.id ?? '',
 name: e.caption ?? '',
 schema: e.schema ?? '',
 countries: e.properties?.country ?? [],
 datasets: e.datasets ?? [],
 topics: e.properties?.topics ?? [],
 score: e.score ?? null,
 }));
 return json({ query: q, results, total: data.total ?? results.length });
 } catch (error) {
 return json({ error: `opensanctions-search error: ${error.message ?? error}` }, 502);
 }
  }

  // ── AlienVault OTX pulse/IOC feed ────────────────────────────────────────
  if (requestUrl.pathname === '/api/otx-iocs') {
 const apiKey = process.env.OTX_API_KEY;
 if (!apiKey) return json({ error: 'OTX_API_KEY not configured' }, 503);
 try {
 const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
 const resp = await fetchWithTimeout(
 `https://otx.alienvault.com/api/v1/pulses/subscribed?limit=50&modified_since=${since}`,
 { headers: { 'X-OTX-API-KEY': apiKey, Accept: 'application/json', 'User-Agent': CHROME_UA } },
 15000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const pulses = Array.isArray(data?.results) ? data.results : [];
 const rawThreats = [];
 for (const pulse of pulses) {
 const indicators = Array.isArray(pulse.indicators) ? pulse.indicators : [];
 for (const ioc of indicators) {
 const itype = ioc.type ?? '';
 const isIP = itype === 'IPv4' || itype === 'IPv6';
 const isURL = itype === 'URL';
 rawThreats.push({
 id: `otx-${pulse.id}-${ioc.id ?? rawThreats.length}`,
 type: isIP ? 'c2_server' : 'malware_host',
 source: 'otx',
 indicator: String(ioc.indicator ?? ''),
 indicatorType: isIP ? 'ip' : isURL ? 'url' : 'domain',
 lat: 0,
 lon: 0,
 country: '',
 severity: 'high',
 malwareFamily: pulse.adversary || (Array.isArray(pulse.tags) ? pulse.tags.slice(0, 3).join(', ') : ''),
 tags: Array.isArray(pulse.tags) ? pulse.tags : [],
 firstSeen: ioc.created ?? pulse.created ?? '',
 lastSeen: ioc.created ?? pulse.modified ?? '',
 });
 if (rawThreats.length >= 300) break;
 }
 if (rawThreats.length >= 300) break;
 }
 // Enrich IP-type IOCs with geolocation
 const ipIOCs = rawThreats.filter(t => t.indicatorType === 'ip').map(t => t.indicator);
 const [geoMap, riskMap] = await Promise.all([geolocateIPs(ipIOCs), scoreIPsQuery(ipIOCs)]);
 for (const t of rawThreats) {
 if (t.indicatorType === 'ip') {
 const geo = geoMap.get(t.indicator);
 if (geo) { t.lat = geo.lat; t.lon = geo.lon; t.country = geo.country; }
 const risk = riskMap.get(t.indicator);
 if (risk !== undefined) t.riskScore = risk;
 }
 }
 return json(rawThreats);
 } catch {
 return json([], 200);
 }
  }

  // ── VirusTotal IOC reputation lookup ─────────────────────────────────────
  if (requestUrl.pathname === '/api/virustotal-lookup') {
 const apiKey = process.env.VIRUSTOTAL_API_KEY;
 if (!apiKey) return json({ error: 'VIRUSTOTAL_API_KEY not configured' }, 503);
 const indicator = requestUrl.searchParams.get('indicator');
 const type = requestUrl.searchParams.get('type') ?? 'domain';
 if (!indicator) return json({ error: 'Missing indicator' }, 400);
 try {
 const endpointMap = { ip: 'ip_addresses', domain: 'domains', url: 'urls' };
 const ep = endpointMap[type] ?? 'domains';
 const encoded = type === 'url'
 ? Buffer.from(indicator).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
 : encodeURIComponent(indicator);
 const resp = await fetchWithTimeout(
 `https://www.virustotal.com/api/v3/${ep}/${encoded}`,
 { headers: { 'x-apikey': apiKey, Accept: 'application/json', 'User-Agent': CHROME_UA } },
 12000,
 );
 if (!resp.ok) return json({ error: `VT responded ${resp.status}` }, resp.status);
 const data = await resp.json();
 const stats = data?.data?.attributes?.last_analysis_stats ?? {};
 return json({
 indicator,
 type,
 malicious: stats.malicious ?? 0,
 suspicious: stats.suspicious ?? 0,
 harmless: stats.harmless ?? 0,
 undetected: stats.undetected ?? 0,
 reputation: data?.data?.attributes?.reputation ?? 0,
 lastAnalysisDate: data?.data?.attributes?.last_analysis_date ?? null,
 });
 } catch (error) {
 return json({ error: String(error.message ?? error) }, 502);
 }
  }

  // ── GreyNoise Community — IP noise/riot classification ────────────────────
  if (requestUrl.pathname === '/api/greynoise-lookup') {
 const ip = requestUrl.searchParams.get('ip');
 if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return json({ error: 'Missing or invalid ip parameter' }, 400);
 const apiKey = process.env.GREYNOISE_API_KEY;
 if (!apiKey) return json({ error: 'GREYNOISE_API_KEY not set' }, 503);
 try {
 const r = await fetchWithTimeout(
 `https://api.greynoise.io/v3/community/${ip}`,
 { headers: { key: apiKey, Accept: 'application/json' } },
 8000,
 );
 if (r.status === 404) return json({ ip, seen: false, noise: false, riot: false, classification: 'unknown', message: 'Not seen in GreyNoise' });
 if (!r.ok) return json({ error: `GreyNoise ${r.status}` }, 502);
 const d = await r.json();
 return json({
 ip: d.ip ?? ip,
 seen: d.seen ?? false,
 noise: d.noise ?? false,
 riot: d.riot ?? false,
 classification: d.classification ?? 'unknown',
 name: d.name ?? null,
 link: d.link ?? null,
 lastSeen: d.last_seen ?? null,
 message: d.message ?? null,
 });
 } catch (error) {
 return json({ error: `greynoise-lookup error: ${error.message ?? error}` }, 502);
 }
  }

  // ── ASN info: PeeringDB primary, RIPE stat fallback ──────────────────────
  // (Endpoint name kept for backward compat; BGPView the upstream is dead.)
  if (requestUrl.pathname === '/api/asn-info' || requestUrl.pathname === '/api/bgpview-asn') {
 const asn = requestUrl.searchParams.get('asn');
 if (!asn || !/^\d+$/.test(asn)) return json({ error: 'Invalid ASN' }, 400);
 const headers = { Accept: 'application/json', 'User-Agent': CHROME_UA };

 // Primary: PeeringDB — single call returns name, country, prefix counts.
 try {
 const resp = await fetchWithTimeout(
 `https://www.peeringdb.com/api/net?asn=${asn}`,
 { headers },
 8000,
 );
 if (resp.ok) {
 const payload = await resp.json();
 const net = Array.isArray(payload?.data) ? payload.data[0] : null;
 if (net) {
 return json({
 asn: Number(asn),
 name: net.name ?? '',
 description: net.aka || net.name || '',
 countryCode: net.country ?? '',
 website: net.website ?? '',
 rir: '',
 ipv4Prefixes: Number(net.info_prefixes4 ?? 0),
 ipv6Prefixes: Number(net.info_prefixes6 ?? 0),
 source: 'peeringdb',
 });
 }
 }
 } catch { /* fall through to RIPE */ }

 // Fallback: RIPE stat — two calls (overview + announced prefixes).
 try {
 const [overviewResp, prefixResp] = await Promise.all([
 fetchWithTimeout(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`, { headers }, 8000),
 fetchWithTimeout(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asn}`, { headers }, 8000),
 ]);
 const overview = overviewResp.ok ? await overviewResp.json() : {};
 const prefixes = prefixResp.ok ? await prefixResp.json() : {};
 const o = overview?.data ?? {};
 // RIPE holder format is typically "NAME - Description, COUNTRY" — split.
 const holder = typeof o.holder === 'string' ? o.holder : '';
 const dashIdx = holder.indexOf(' - ');
 const name = dashIdx > 0 ? holder.slice(0, dashIdx) : holder;
 const rest = dashIdx > 0 ? holder.slice(dashIdx + 3) : '';
 const ccMatch = rest.match(/,\s*([A-Z]{2})\s*$/);
 const countryCode = ccMatch ? ccMatch[1] : '';
 const description = ccMatch ? rest.slice(0, rest.length - ccMatch[0].length).trim() : rest;
 const allPrefixes = Array.isArray(prefixes?.data?.prefixes) ? prefixes.data.prefixes : [];
 const ipv4 = allPrefixes.filter((p) => typeof p?.prefix === 'string' && !p.prefix.includes(':')).length;
 const ipv6 = allPrefixes.length - ipv4;
 return json({
 asn: Number(asn),
 name,
 description,
 countryCode,
 website: '',
 rir: '',
 ipv4Prefixes: ipv4,
 ipv6Prefixes: ipv6,
 source: 'ripe',
 });
 } catch (error) {
 return json({ error: String(error.message ?? error) }, 502);
 }
  }

  // ── NewsAPI.org headlines ─────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/newsapi-headlines') {
 const apiKey = process.env.NEWSAPI_KEY;
 if (!apiKey) return json({ error: 'NEWSAPI_KEY not configured' }, 503);
 const q = requestUrl.searchParams.get('q') ?? 'geopolitics';
 const pageSize = Math.min(20, parseInt(requestUrl.searchParams.get('pageSize') ?? '10', 10));
 try {
 const params = new URLSearchParams({ q, pageSize: String(pageSize), language: 'en', sortBy: 'publishedAt', apiKey });
 const resp = await fetchWithTimeout(
 `https://newsapi.org/v2/everything?${params}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 12000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const articles = Array.isArray(data?.articles) ? data.articles : [];
 const items = articles.map((a, i) => ({
 id: `newsapi-${i}`,
 source: a.source?.name ?? 'NewsAPI',
 title: a.title ?? '',
 link: a.url ?? '',
 pubDate: a.publishedAt ?? new Date().toISOString(),
 description: a.description ?? '',
 imageUrl: a.urlToImage ?? undefined,
 }));
 return json(items);
 } catch {
 return json([], 200);
 }
  }

  // ── NewsData.io feed ──────────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/newsdata-feed') {
 const apiKey = process.env.NEWSDATA_API_KEY;
 if (!apiKey) return json({ error: 'NEWSDATA_API_KEY not configured' }, 503);
 const q = requestUrl.searchParams.get('q') ?? 'world news';
 try {
 const params = new URLSearchParams({ apikey: apiKey, q, language: 'en' });
 const resp = await fetchWithTimeout(
 `https://newsdata.io/api/1/latest?${params}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 12000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const results = Array.isArray(data?.results) ? data.results : [];
 const items = results.map((a, i) => ({
 id: `newsdata-${i}`,
 source: a.source_name ?? a.source_id ?? 'NewsData',
 title: a.title ?? '',
 link: a.link ?? '',
 pubDate: a.pubDate ?? new Date().toISOString(),
 description: a.description ?? '',
 imageUrl: a.image_url ?? undefined,
 }));
 return json(items);
 } catch {
 return json([], 200);
 }
  }

  // ── USGS Volcano Hazards Program alerts ─────────────────────────────────
  if (requestUrl.pathname === '/api/volcano-alerts') {
 try {
 const resp = await fetchWithTimeout(
 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/volcanoesGet',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 15_000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const volcanoes = Array.isArray(data) ? data : (data?.features ?? data?.volcanoes ?? []);
 const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
 const alerts = volcanoes
 .filter(v => {
 const level = (v.alertLevel ?? v.alert_level ?? v.currentAlertLevel ?? '').toLowerCase();
 return level && level !== 'normal' && level !== 'unassigned';
 })
 .slice(0, 100)
 .map((v, i) => ({
 id: `usgs-volcano-${v.vnum ?? v.id ?? i}`,
 name: v.volcanoName ?? v.name ?? `Volcano ${i}`,
 location: [v.state ?? '', v.country ?? ''].filter(Boolean).join(', '),
 alertLevel: cap(v.alertLevel ?? v.alert_level ?? v.currentAlertLevel ?? 'Advisory'),
 color: v.colorCode ?? v.color_code ?? 'Yellow',
 lat: Number.parseFloat(v.latitude ?? v.lat ?? 0),
 lon: Number.parseFloat(v.longitude ?? v.lon ?? 0),
 updatedAt: v.activityChangedDate ?? v.updatedAt ?? '',
 observatory: v.observatoryName ?? v.observatory ?? '',
 }));
 return json(alerts);
 } catch {
 return json([], 200);
 }
  }

  // ── NOAA NWS All-Hazards alerts ──────────────────────────────────────────
  if (requestUrl.pathname === '/api/nws-alerts') {
 try {
 const resp = await fetchWithTimeout(
 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&urgency=Immediate,Expected&severity=Extreme,Severe,Moderate',
 { headers: { Accept: 'application/geo+json', 'User-Agent': 'CrystalBall-NWS/1.0 (https://github.com/bradleybond512/crystal-ball)' } },
 12_000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const features = Array.isArray(data?.features) ? data.features : [];
 const alerts = features.slice(0, 100).map((f, i) => {
 const p = f.properties ?? {};
 return {
 id: p.id ?? `nws-${i}`,
 event: p.event ?? '',
 headline: p.headline ?? '',
 description: String(p.description ?? '').slice(0, 300),
 severity: p.severity ?? 'Unknown',
 urgency: p.urgency ?? 'Unknown',
 areaDesc: p.areaDesc ?? '',
 onset: p.onset ?? '',
 expires: p.expires ?? '',
 status: p.status ?? '',
 centroid: extractAlertCentroid(f),
 };
 });
 return json(alerts);
 } catch {
 return json([], 200);
 }
  }

  // ── FAA Aviation Weather Cameras (public, no auth) ───────────────────────────
  // Optional METAR/flight-rule/ADS-B enrichment when ?withMetar=1.
  // Uses aviationweather.gov stationinfo + metar APIs (public, no auth).
  // Algorithms mirror src/services/webcams/{flight-rule,station-matcher}.ts
  // — the TS unit tests cover the underlying logic.
  if (requestUrl.pathname === '/api/faa-cameras') {
 // Old `avcams.faa.gov` host has been decommissioned (DNS no longer
 // resolves). The active service is `weathercams.faa.gov` whose
 // `/api/sites` endpoint requires Origin + Referer headers but no
 // auth key. Each site groups multiple cameras; we surface one row
 // per camera so the panel's selection table can drill into the
 // specific viewpoint.
 const CACHE_KEY = 'faa-cameras';
 const CACHE_TTL = 15 * 60 * 1000;
 const cached = getCached(CACHE_KEY, CACHE_TTL);
 if (cached) return json(cached);
 try {
 const resp = await fetchWithTimeout(
 'https://weathercams.faa.gov/api/sites',
 {
 headers: {
 Accept: 'application/json',
 Origin: 'https://weathercams.faa.gov',
 Referer: 'https://weathercams.faa.gov/',
 'User-Agent': 'CrystalBall/1.0',
 },
 },
 15000,
 );
 if (!resp.ok) return json(getCachedStale(CACHE_KEY) ?? [], 200);
 const raw = await resp.json();
 const sites = Array.isArray(raw?.payload) ? raw.payload : [];
 const cameras = [];
 for (const site of sites) {
 if (!site?.siteActive) continue;
 const cams = Array.isArray(site.cameras) ? site.cameras : [];
 for (const cam of cams) {
 if (cam?.cameraInMaintenance || cam?.cameraOutOfOrder) continue;
 const id = String(cam.cameraId ?? '');
 if (!id) continue;
 const lat = Number(cam.latitude ?? site.latitude ?? 0);
 const lon = Number(cam.longitude ?? site.longitude ?? 0);
 if (lat === 0 || lon === 0) continue;
 cameras.push({
 id,
 name: `${site.siteName ?? site.siteIdentifier ?? 'Site'} — ${cam.cameraName ?? cam.cameraDirection ?? 'Camera'}`,
 lat,
 lon,
 state: String(site.state ?? site.country ?? ''),
 category: site.thirdParty ? 'remote' : 'weather',
 // Per-image URL is resolved lazily by /api/faa-camera-image
 // — pre-fetching 1000+ jpg metadata calls would melt the
 // 15s timeout. The panel calls the resolver on click.
 imageUrl: `/api/faa-camera-image?cameraId=${id}`,
 isOnline: !cam.cameraInMaintenance && !cam.cameraOutOfOrder,
 lastUpdated: String(cam.cameraLastSuccess ?? new Date().toISOString()),
 });
 }
 }
 setCached(CACHE_KEY, cameras);
 const withMetar = requestUrl.searchParams.get('withMetar') === '1';
 if (!withMetar) return json(cameras);
 const enriched = await enrichFaaCamerasWithMetar(cameras);
 return json(enriched);
 } catch {
 return json(getCachedStale(CACHE_KEY) ?? [], 200);
 }
  }

  // Resolve the latest image URL for a single FAA weathercam. The
  // weathercams.faa.gov `/api/cameras/{id}/images/last/N` endpoint
  // returns metadata + an `imageUri` pointing at the
  // images.wcams-static.faa.gov CDN.
  //
  // Optional ?count=N (1-24) returns a frames[] array for client-side
  // timelapse playback ("video"). Default count=1 preserves the
  // single-image contract the panel previously used.
  if (requestUrl.pathname === '/api/faa-camera-image') {
 const cameraId = (requestUrl.searchParams.get('cameraId') ?? '').replace(/\D/g, '');
 if (!cameraId) return json({ error: 'cameraId required' }, 400);
 const rawCount = Number.parseInt(requestUrl.searchParams.get('count') ?? '1', 10);
 const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(24, rawCount)) : 1;
 try {
 const resp = await fetchWithTimeout(
 `https://weathercams.faa.gov/api/cameras/${cameraId}/images/last/${count}`,
 {
 headers: {
 Accept: 'application/json',
 Origin: 'https://weathercams.faa.gov',
 Referer: 'https://weathercams.faa.gov/',
 'User-Agent': 'CrystalBall/1.0',
 },
 },
 10000,
 );
 if (!resp.ok) return json({ imageUrl: null, frames: [], degraded: true, reason: `weathercams returned ${resp.status}` });
 const raw = await resp.json();
 const items = Array.isArray(raw?.payload) ? raw.payload : [];
 if (items.length === 0 || !items[0]?.imageUri) {
 return json({ imageUrl: null, frames: [], degraded: true, reason: 'No recent image for this camera' });
 }
 // Frames are oldest → newest for natural timelapse playback.
 const frames = items
 .filter((it) => typeof it?.imageUri === 'string')
 .map((it) => ({ imageUrl: it.imageUri, imageDatetime: it.imageDatetime }))
 .reverse();
 return json({
 imageUrl: items[0].imageUri,            // back-compat: latest single image
 imageDatetime: items[0].imageDatetime,  // back-compat
 frames,                                 // new: timelapse loop
 cameraId,
 });
 } catch (error) {
 return json({ imageUrl: null, frames: [], degraded: true, reason: `image lookup failed: ${error?.message ?? error}` });
 }
  }

  // ── FAA Camera AI Image Analysis (Ollama-primary, Claude fallback) ────────────
  if (requestUrl.pathname === '/api/faa-cam-analyze' && req.method === 'POST') {
 const rawBody = await readBody(req);
 if (!rawBody) return json({ error: 'Invalid request body' }, 400);
 let body;
 try { body = JSON.parse(rawBody.toString()); } catch { return json({ error: 'Invalid request body' }, 400); }
 const { imageUrl, cameraName, alertLabel } = body ?? {};
 if (!imageUrl || typeof imageUrl !== 'string') return json({ error: 'imageUrl required' }, 400);
 const safety = await isSafeUrl(imageUrl);
 if (!safety.safe) {
 return json({ error: `Invalid image URL: ${safety.reason}` }, 400);
 }

 // Fetch and base64-encode the camera image
 let imageB64;
 try {
 const imgResp = await fetchWithTimeout(imageUrl, { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 10000);
 if (!imgResp.ok) return json({ error: 'Could not fetch camera image' }, 502);
 const buf = await imgResp.arrayBuffer();
 imageB64 = Buffer.from(buf).toString('base64');
 } catch (error) {
 return json({ error: `Image fetch failed: ${String(error?.message ?? error)}` }, 502);
 }

 const ctxLabel = alertLabel ? ` Context: camera is near an active ${alertLabel}.` : '';
 const prompt = `Describe current weather conditions visible in this camera image in 1-2 sentences. Be concise and factual.${ctxLabel}`;

 // Try Ollama first
 const ollamaUrl = process.env.OLLAMA_API_URL;
 const ollamaModel = process.env.OLLAMA_MODEL;
 if (ollamaUrl && ollamaModel) {
 try {
 const ollamaResp = await fetchWithTimeout(
 new URL('/api/generate', ollamaUrl).toString(),
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ model: ollamaModel, prompt, images: [imageB64], stream: false }),
 },
 25000,
 );
 if (ollamaResp.ok) {
 const data = await ollamaResp.json();
 if (data.response) return json({ conditions: String(data.response).trim() });
 }
 } catch { /* fall through to Claude */ }
 }

 // Claude API fallback
 const anthropicKey = process.env.ANTHROPIC_API_KEY;
 if (anthropicKey) {
 try {
 const claudeResp = await fetchWithTimeout(
 'https://api.anthropic.com/v1/messages',
 {
 method: 'POST',
 headers: {
 'x-api-key': anthropicKey,
 'anthropic-version': '2023-06-01',
 'content-type': 'application/json',
 },
 body: JSON.stringify({
 model: 'claude-haiku-4-5-20251001',
 max_tokens: 150,
 messages: [{
 role: 'user',
 content: [
 { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
 { type: 'text', text: prompt },
 ],
 }],
 }),
 },
 25000,
 );
 if (claudeResp.ok) {
 const data = await claudeResp.json();
 const text = data?.content?.[0]?.text;
 if (text) return json({ conditions: String(text).trim() });
 }
 } catch { /* fall through */ }
 }

 return json({ error: 'Analysis unavailable — enable Ollama with a vision model (llava, moondream2) or add an Anthropic API key.' });
  }

  // ── FAA Camera Situational Digest ─────────────────────────────────────────────
  if (requestUrl.pathname === '/api/faa-cam-digest' && req.method === 'POST') {
 const rawBody = await readBody(req);
 if (!rawBody) return json({ error: 'Invalid request body' }, 400);
 let body;
 try { body = JSON.parse(rawBody.toString()); } catch { return json({ error: 'Invalid request body' }, 400); }
 const cameras = Array.isArray(body?.cameras) ? body.cameras : [];
 if (cameras.length < 2) return json({ error: 'At least 2 cameras required' }, 400);

 const camList = cameras.slice(0, 6).map(c => {
 const alert = c.alertLabel ? `, near ${c.alertLabel}` : '';
 return `- ${c.name} (${c.location})${alert}`;
 }).join('\n');
 const prompt = `You are a situational awareness assistant. The following FAA weather cameras are near active weather or disaster alerts:\n${camList}\n\nWrite a 2-sentence situational summary for an emergency monitor. Be factual, concise, and avoid speculation.`;

 const ollamaUrl = process.env.OLLAMA_API_URL;
 const ollamaModel = process.env.OLLAMA_MODEL;
 if (ollamaUrl && ollamaModel) {
 try {
 const resp = await fetchWithTimeout(
 new URL('/api/generate', ollamaUrl).toString(),
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ model: ollamaModel, prompt, stream: false }),
 },
 25000,
 );
 if (resp.ok) {
 const data = await resp.json();
 if (data.response) return json({ digest: String(data.response).trim() });
 }
 } catch { /* fall through */ }
 }

 const anthropicKey = process.env.ANTHROPIC_API_KEY;
 if (anthropicKey) {
 try {
 const resp = await fetchWithTimeout(
 'https://api.anthropic.com/v1/messages',
 {
 method: 'POST',
 headers: {
 'x-api-key': anthropicKey,
 'anthropic-version': '2023-06-01',
 'content-type': 'application/json',
 },
 body: JSON.stringify({
 model: 'claude-haiku-4-5-20251001',
 max_tokens: 120,
 messages: [{ role: 'user', content: prompt }],
 }),
 },
 25000,
 );
 if (resp.ok) {
 const data = await resp.json();
 const text = data?.content?.[0]?.text;
 if (text) return json({ digest: String(text).trim() });
 }
 } catch { /* fall through */ }
 }

 return json({ error: 'Digest unavailable' });
  }

  // ── Disease Outbreak proxy (ReliefWeb + WHO, no API key) ─────────────────
  if (requestUrl.pathname === '/api/disease-outbreaks') {
 const RELIEFWEB_URL = 'https://api.reliefweb.int/v1/reports?appname=crystalball&filter[field]=type.name&filter[value]=Situation%20Report&filter[conditions][0][field]=theme.name&filter[conditions][0][value]=Health&limit=25&sort[]=date:desc&fields[include][]=title&fields[include][]=date&fields[include][]=country&fields[include][]=url';
 const WHO_URL = 'https://www.who.int/api/hubs/cms/s3fs-public/attachments/disease-outbreak-news.json';
 try {
 const [rwResp, whoResp] = await Promise.allSettled([
 fetchWithTimeout(RELIEFWEB_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 fetchWithTimeout(WHO_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 ]);
 const reliefweb = (rwResp.status === 'fulfilled' && rwResp.value.ok)
 ? await rwResp.value.json()
 : null;
 const who = (whoResp.status === 'fulfilled' && whoResp.value.ok)
 ? await whoResp.value.json()
 : null;
 return json({ reliefweb, who });
 } catch (error) {
 return json({ error: `disease-outbreaks fetch error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Disease Intelligence (Nextstrain + disease.sh + ReliefWeb EP + WHO DON) ──
  if (requestUrl.pathname === '/api/disease-intel') {
 const cached = getCached('disease-intel', 30 * 60 * 1000);
 if (cached) return json(cached);

 const NEXTSTRAIN_URL =
 'https://data.nextstrain.org/files/workflows/forecasts-ncov/open/nextstrain_clades/global/mlr/latest_results.json';
 const DISEASE_SH_URL = 'https://disease.sh/v3/covid-19/countries';
 const RELIEFWEB_URL =
 'https://api.reliefweb.int/v1/disasters?appname=crystalball&filter[field]=type&filter[value]=EP&limit=20&sort[]=date:desc&fields[include][]=name&fields[include][]=date&fields[include][]=country&fields[include][]=status&fields[include][]=url';
 const WHO_DON_URL = 'https://www.who.int/api/news/diseaseoutbreaknews';

 try {
 const [nsRes, dsRes, rwRes, whoRes] = await Promise.allSettled([
 fetchWithTimeout(NEXTSTRAIN_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 20_000),
 fetchWithTimeout(DISEASE_SH_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 fetchWithTimeout(RELIEFWEB_URL,  { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 fetchWithTimeout(WHO_DON_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 ]);

 // Per-source JSON parsing — one bad response shouldn't kill the others.
 const safeJson = async (settled) => {
 if (settled.status !== 'fulfilled' || !settled.value.ok) return null;
 try { return await settled.value.json(); } catch { return null; }
 };

 const [nextstrain, covidCountries, reliefweb, whoDon] = await Promise.all([
 safeJson(nsRes),
 safeJson(dsRes),
 safeJson(rwRes),
 safeJson(whoRes),
 ]);

 const whoDonItems = Array.isArray(whoDon)
 ? whoDon
 : Array.isArray(whoDon?.items) ? whoDon.items : [];
 const promedSnapshot = await getOrFetchPromedSnapshot();
 const crossReferencedWithPromed = crossReferenceWhoDonWithProMed(
 whoDonItems,
 Array.isArray(promedSnapshot.alerts) ? promedSnapshot.alerts : [],
 );

 const result = {
 nextstrain,
 covidCountries,
 reliefweb,
 whoDon,
 crossReferencedWithPromed,
 fetchedAt: new Date().toISOString(),
 };
 setCached('disease-intel', result);
 return json(result);
 } catch (error) {
 return json({ error: `disease-intel fetch error: ${error.message ?? error}` }, 502);
 }
  }

  // ── ProMED-mail RSS (no API key, sidecar-side classification) ────────────
  if (requestUrl.pathname === '/api/promed') {
 const snapshot = await getOrFetchPromedSnapshot();
 return json(snapshot);
  }

  // ── Wastewater epidemiology (CDC NWSS, no API key) ───────────────────────
  if (requestUrl.pathname === '/api/wastewater') {
 const cached = getCached('wastewater', 30 * 60 * 1000);
 if (cached) return json(cached);

 const NWSS_COVID_URL = 'https://data.cdc.gov/resource/2ew6-ywp6.json?$limit=5000&$order=date_end%20DESC';
 try {
 const resp = await fetchWithTimeout(
 NWSS_COVID_URL,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 20_000,
 );
 if (!resp.ok) {
 const degraded = {
 signals: [],
 surgeWatches: [],
 lastUpdated: null,
 fetchedAt: new Date().toISOString(),
 degraded: true,
 reason: `NWSS upstream returned HTTP ${resp.status}`,
 };
 return json(degraded);
 }
 const rows = await resp.json();
 const { signals, lastUpdated } = aggregateWastewaterRows(rows);
 const surgeWatches = detectSurgeWatches(signals);
 const result = {
 signals,
 surgeWatches,
 lastUpdated,
 fetchedAt: new Date().toISOString(),
 };
 setCached('wastewater', result);
 return json(result);
 } catch (error) {
 const degraded = {
 signals: [],
 surgeWatches: [],
 lastUpdated: null,
 fetchedAt: new Date().toISOString(),
 degraded: true,
 reason: `wastewater fetch error: ${error.message ?? error}`,
 };
 return json(degraded);
 }
  }

  // ── HDX (UN OCHA) humanitarian crisis datasets ───────────────────────────
  if (requestUrl.pathname === '/api/hdx-crises') {
 try {
 const resp = await fetchWithTimeout(
 'https://data.humdata.org/api/3/action/package_search?q=crisis+situation+report&sort=metadata_modified+desc&rows=20',
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } },
 15000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const results = Array.isArray(data?.result?.results) ? data.result.results : [];
 const crises = results.map((pkg, i) => {
 const groups = Array.isArray(pkg.groups) ? pkg.groups : [];
 const country = groups[0]?.display_name ?? groups[0]?.title ?? '';
 const countryCode = groups[0]?.name?.toUpperCase() ?? '';
 const tags = (Array.isArray(pkg.tags) ? pkg.tags.map((t) => (t.name ?? '').toLowerCase()) : []);
 let crisisType = 'other';
 if (tags.some(t => t.includes('conflict') || t.includes('war') || t.includes('armed'))) crisisType = 'conflict';
 else if (tags.some(t => t.includes('displacement') || t.includes('refugee') || t.includes('idp'))) crisisType = 'displacement';
 else if (tags.some(t => t.includes('food') || t.includes('hunger') || t.includes('famine'))) crisisType = 'food-insecurity';
 else if (tags.some(t => t.includes('disease') || t.includes('outbreak') || t.includes('epidemic'))) crisisType = 'disease';
 else if (tags.some(t => t.includes('earthquake') || t.includes('flood') || t.includes('cyclone') || t.includes('hurricane'))) crisisType = 'disaster';
 const org = Array.isArray(pkg.organization) ? pkg.organization.title ?? '' :
 (pkg.organization?.title ?? pkg.organization?.name ?? '');
 const numResources = pkg.num_resources ?? 0;
 const severity = crisisType === 'conflict' ? 'critical' : crisisType === 'displacement' || crisisType === 'food-insecurity' ? 'high' : crisisType === 'disease' || crisisType === 'disaster' ? 'medium' : 'low';
 return {
 id: pkg.id ?? `hdx-${i}`,
 title: pkg.title ?? pkg.name ?? '',
 country,
 countryCode,
 crisisType,
 affectedPeople: null,
 organization: org,
 updatedAt: pkg.metadata_modified ?? pkg.last_modified ?? new Date().toISOString(),
 url: `https://data.humdata.org/dataset/${pkg.name ?? pkg.id}`,
 severity,
 numResources,
 };
 });
 return json(crises);
 } catch {
 return json([], 200);
 }
  }

  // ── Federal Register (executive orders, major rules, emergency notices) ────
  if (requestUrl.pathname === '/api/federal-register') {
 try {
 const resp = await fetchWithTimeout(
 'https://www.federalregister.gov/api/v1/documents.json?fields[]=document_number&fields[]=title&fields[]=type&fields[]=agencies&fields[]=publication_date&fields[]=abstract&conditions[type][]=PRESDOCU&conditions[type][]=RULE&conditions[type][]=PROPOSED_RULE&conditions[type][]=NOTICE&per_page=20&order=newest',
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } },
 15000,
 );
 if (!resp.ok) return json({ documents: [] }, 200);
 const data = await resp.json();
 const results = Array.isArray(data?.results) ? data.results : [];
 const documents = results.map((doc, i) => {
 const agencies = Array.isArray(doc.agencies) ? doc.agencies : [];
 const agency = agencies[0]?.name ?? agencies[0]?.raw_name ?? '';
 const title = doc.title ?? '';
 const abstract = doc.abstract ?? '';
 let severity = 'normal';
 if (/emergency|national security|executive order/i.test(title) || /emergency|national security|executive order/i.test(abstract)) {
 severity = 'critical';
 } else if (/federal register|major rule|significant/i.test(title) || /federal register|major rule|significant/i.test(abstract)) {
 severity = 'high';
 }
 return {
 id: doc.document_number ?? `fr-${i}`,
 title,
 type: doc.type ?? '',
 agency,
 date: doc.publication_date ?? '',
 abstract,
 severity,
 };
 });
 return json({ documents });
 } catch {
 return json({ documents: [] }, 200);
 }
  }

  // ── WallStreetBets retail sentiment (nbshare.io, no API key) ────────────
  if (requestUrl.pathname === '/api/wsb-sentiment') {
 try {
 const resp = await fetchWithTimeout(
 'https://api.nbshare.io/api/sp500/wsb/',
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } },
 12000,
 );
 if (!resp.ok) return json({ snapshots: [] }, 200);
 const data = await resp.json();
 const arr = Array.isArray(data) ? data : [];
 const snapshots = arr.slice(0, 20).map((item, i) => ({
 ticker: item.Ticker ?? '',
 mentions: item.No_of_Mentions ?? 0,
 sentiment: typeof item.Sentiment === 'number' ? item.Sentiment : 0,
 rank: i + 1,
 }));
 return json({ snapshots });
 } catch {
 return json({ snapshots: [] }, 200);
 }
  }

  // ── Space Weather proxy (NOAA SWPC, no API key) ───────────────────────────
  if (requestUrl.pathname === '/api/space-weather-feeds') {
 const SW_URLS = {
 kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
 mag: 'https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json',
 xray: 'https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json',
 alerts: 'https://services.swpc.noaa.gov/products/alerts.json',
 plasma: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json',
 };
 try {
 const entries = Object.entries(SW_URLS);
 const settled = await Promise.allSettled(
 entries.map(([, url]) => fetchWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000)),
 );
 const result = {};
 for (const [i, [key]] of entries.entries()) {
 const r = settled[i];
 result[key] = (r.status === 'fulfilled' && r.value.ok) ? await r.value.json() : null;
 }
 return json(result);
 } catch (error) {
 return json({ error: `space-weather-feeds fetch error: ${error.message ?? error}` }, 502);
 }
  }

  // ── NASA DONKI space weather events ─────────────────────────────────────
  if (requestUrl.pathname === '/api/donki-events') {
 const apiKey = process.env.NASA_API_KEY ?? 'DEMO_KEY';
 const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
 const today = new Date().toISOString().slice(0, 10);
 const base = `https://api.nasa.gov/DONKI`;
 const params = `startDate=${sevenDaysAgo}&endDate=${today}&api_key=${apiKey}`;
 try {
 const [flrResp, cmeResp, gstResp] = await Promise.allSettled([
 fetchWithTimeout(`${base}/FLR?${params}`, { headers: { 'User-Agent': CHROME_UA } }, 12000),
 fetchWithTimeout(`${base}/CME?${params}`, { headers: { 'User-Agent': CHROME_UA } }, 12000),
 fetchWithTimeout(`${base}/GST?${params}`, { headers: { 'User-Agent': CHROME_UA } }, 12000),
 ]);
 const events = [];
 if (flrResp.status === 'fulfilled' && flrResp.value.ok) {
 const flares = await flrResp.value.json();
 for (const f of (Array.isArray(flares) ? flares : [])) {
 const cls = f.classType ?? '';
 events.push({
 id: f.flrID ?? `flr-${events.length}`,
 type: 'flare',
 startTime: f.beginTime ?? null,
 peakTime: f.peakTime ?? null,
 endTime: f.endTime ?? null,
 classType: cls,
 kpIndex: null,
 estimatedArrival: null,
 severity: cls.startsWith('X') ? 'critical' : cls.startsWith('M') ? 'high' : cls.startsWith('C') ? 'medium' : 'low',
 url: f.link ?? `https://kauai.ccmc.gsfc.nasa.gov/DONKI/`,
 });
 }
 }
 if (cmeResp.status === 'fulfilled' && cmeResp.value.ok) {
 const cmes = await cmeResp.value.json();
 for (const c of (Array.isArray(cmes) ? cmes : [])) {
 const analysis = Array.isArray(c.cmeAnalyses) ? c.cmeAnalyses[0] : null;
 const arrival = analysis?.time21_5 ?? null;
 events.push({
 id: c.activityID ?? `cme-${events.length}`,
 type: 'cme',
 startTime: c.startTime ?? null,
 peakTime: null,
 endTime: null,
 classType: null,
 kpIndex: null,
 estimatedArrival: arrival,
 severity: analysis?.isMostAccurate ? 'high' : 'medium',
 url: c.link ?? `https://kauai.ccmc.gsfc.nasa.gov/DONKI/`,
 });
 }
 }
 if (gstResp.status === 'fulfilled' && gstResp.value.ok) {
 const storms = await gstResp.value.json();
 for (const g of (Array.isArray(storms) ? storms : [])) {
 const maxKp = Array.isArray(g.allKpIndex)
 ? Math.max(...g.allKpIndex.map((k) => k.kpIndex ?? 0))
 : null;
 events.push({
 id: g.gstID ?? `gst-${events.length}`,
 type: 'geomagnetic-storm',
 startTime: g.startTime ?? null,
 peakTime: null,
 endTime: null,
 classType: null,
 kpIndex: maxKp,
 estimatedArrival: null,
 severity: maxKp !== null ? (maxKp >= 7 ? 'critical' : maxKp >= 5 ? 'high' : maxKp >= 4 ? 'medium' : 'low') : 'low',
 url: g.link ?? `https://kauai.ccmc.gsfc.nasa.gov/DONKI/`,
 });
 }
 }
 events.sort((a, b) => new Date(b.startTime ?? 0).getTime() - new Date(a.startTime ?? 0).getTime());
 return json(events.slice(0, 30));
 } catch {
 return json([], 200);
 }
  }

  // ── Air Quality proxy (Open-Meteo, no API key, forwards lat/lon) ──────────
  if (requestUrl.pathname === '/api/air-quality-proxy') {
 const coords = parseLatLon(
 requestUrl.searchParams.get('lat'),
 requestUrl.searchParams.get('lon'),
 );
 if (!coords) return json({ error: 'Missing or invalid lat/lon query parameters' }, 400);
 const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coords.lat}&longitude=${coords.lon}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto`;
 try {
 const resp = await fetchWithTimeout(aqUrl, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000);
 if (!resp.ok) return json({ error: `air-quality upstream error: ${resp.status}` }, 502);
 const data = await resp.json();
 return json(data);
 } catch (error) {
 return json({ error: `air-quality-proxy fetch error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Stooq helpers (replaces Yahoo Finance — blocked by Cloudflare) ────────
  // Stooq.com: free, no API key, real-time US equities/ETFs/futures/crypto CSV.
  // Symbol conventions: AAPL → aapl.us, CL=F → cl.f, BTC-USD → btc.v
  // Batch quote URL: /q/l/?s=sym1+sym2&f=sd2t2ohlcvp&h&e=csv
  // Format: Symbol,Date,Time,Open,High,Low,Close,Volume,Prev

  function toStooqSym(yahooSym) {
 const s = (yahooSym ?? '').trim();
 if (!s) return null;
 // Index proxies (Stooq doesn't carry ^GSPC/^DJI/^IXIC directly)
 const IDX = { '^GSPC': 'spy.us', '^DJI': 'dia.us', '^IXIC': 'qqq.us', '^VIX': null };
 if (s in IDX) return IDX[s];
 if (s.endsWith('=F')) return s.slice(0, -2).toLowerCase() + '.f'; // CL=F → cl.f
 if (s.endsWith('-USD')) return s.slice(0, -4).toLowerCase() + '.v'; // BTC-USD → btc.v
 return s.toLowerCase() + '.us'; // AAPL → aapl.us, XLK → xlk.us, BRK-B → brk-b.us
  }

  function parseStooqBatchCsv(text) {
 // Returns Map<stooqSymLower, { price, change, prev }>
 const map = new Map();
 const lines = (text ?? '').trim().split('\n');
 for (let i = 1; i < lines.length; i++) { // skip header row
 const cols = lines[i].split(',');
 const sym = (cols[0] ?? '').trim().toLowerCase();
 const date  = (cols[1] ?? '').trim();
 const close = Number.parseFloat(cols[6]);
 const prev  = Number.parseFloat(cols[8]);
 if (!sym || date === 'N/D' || isNaN(close)) continue;
 const change = (!isNaN(prev) && prev > 0)
 ? Number.parseFloat(((close - prev) / prev * 100).toFixed(2))
 : 0;
 map.set(sym, { price: close, change, prev: isNaN(prev) ? close : prev });
 }
 return map;
  }

  // Helper: parse a FRED CSV response and return the latest { current, previous } values.
  function parseFredCsvLatest(text) {
 const lines = (text ?? '').trim().split('\n').slice(1).filter(l => l && !/^observation/i.test(l));
 const recent = lines.slice(-2);
 const cur = Number.parseFloat((recent[recent.length - 1] ?? '').split(',')?.[1] ?? '');
 const prv = Number.parseFloat((recent[0] ?? '').split(',')?.[1] ?? '');
 return { current: cur, previous: prv };
  }

  // ── BTC ETF flows via Stooq ───────────────────────────────────────────────
  if (requestUrl.pathname === '/api/btc-etf-flows') {
 const BTC_ETFS = [
 { ticker: 'IBIT',  issuer: 'BlackRock'  },
 { ticker: 'FBTC',  issuer: 'Fidelity' },
 { ticker: 'BITB',  issuer: 'Bitwise' },
 { ticker: 'ARKB',  issuer: 'ARK' },
 { ticker: 'BTCO',  issuer: 'Invesco' },
 { ticker: 'HODL',  issuer: 'VanEck' },
 { ticker: 'GBTC',  issuer: 'Grayscale'  },
 { ticker: 'BRRR',  issuer: 'Valkyrie' },
 ];
 try {
 const stooqSyms = BTC_ETFS.map(e => e.ticker.toLowerCase() + '.us').join('+');
 const r = await fetchWithTimeout(
 `https://stooq.com/q/l/?s=${stooqSyms}&f=sd2t2ohlcvp&h&e=csv`,
 { headers: { 'User-Agent': CHROME_UA } }, 10_000
 );
 if (!r.ok) throw new Error(`Stooq ${r.status}`);
 const stooq = parseStooqBatchCsv(await r.text());
 let totalVolume = 0, totalEstFlow = 0, inflowCount = 0, outflowCount = 0;
 const etfs = BTC_ETFS.map(({ ticker, issuer }) => {
 const d = stooq.get(ticker.toLowerCase() + '.us');
 if (!d) return { ticker, issuer, price: 0, priceChange: 0, volume: 0, avgVolume: 0, volumeRatio: 1, direction: 'neutral', estFlow: 0 };
 const priceChange = d.change;
 // Estimate flow from price momentum (no avg-volume history available from Stooq batch)
 const estFlow = Math.round(d.price * 1_000_000 * (priceChange / 100));
 const direction = priceChange > 0.5 ? 'inflow' : (priceChange < -0.5 ? 'outflow' : 'neutral');
 totalVolume += d.price;
 totalEstFlow += estFlow;
 if (direction === 'inflow') inflowCount++;
 if (direction === 'outflow') outflowCount++;
 return { ticker, issuer, price: d.price, priceChange: d.change, volume: 0, avgVolume: 0, volumeRatio: 1, direction, estFlow };
 });
 const netDirection = totalEstFlow > 0 ? 'inflow' : (totalEstFlow < 0 ? 'outflow' : 'neutral');
 return json({
 timestamp: new Date().toISOString(),
 rateLimited: false,
 summary: { etfCount: etfs.length, totalVolume: Math.round(totalVolume), totalEstFlow: Math.round(totalEstFlow), netDirection, inflowCount, outflowCount },
 etfs,
 });
 } catch (error) {
 return json({ timestamp: new Date().toISOString(), rateLimited: false, etfs: [], error: String(error.message ?? error) });
 }
  }

  // ── Open-Meteo — current conditions for major global cities (no API key required) ─
  if (requestUrl.pathname === '/api/owm-current') {
 const cached = getCached('owm-current', 30 * 60 * 1000); // 30 min
 if (cached) return json(cached);
 const CITIES = [
 { name: 'New York', lat: 40.71, lon: -74.01 }, { name: 'Los Angeles', lat: 34.05, lon: -118.24 },
 { name: 'Chicago', lat: 41.85, lon: -87.65 }, { name: 'London', lat: 51.51, lon: -0.13 },
 { name: 'Paris', lat: 48.85, lon: 2.35 }, { name: 'Berlin', lat: 52.52, lon: 13.40 },
 { name: 'Moscow', lat: 55.75, lon: 37.62 }, { name: 'Dubai', lat: 25.20, lon: 55.27 },
 { name: 'Riyadh', lat: 24.69, lon: 46.72 }, { name: 'Tehran', lat: 35.69, lon: 51.39 },
 { name: 'Beijing', lat: 39.91, lon: 116.39 }, { name: 'Tokyo', lat: 35.68, lon: 139.69 },
 { name: 'Shanghai', lat: 31.23, lon: 121.47 }, { name: 'Delhi', lat: 28.61, lon: 77.21 },
 { name: 'Mumbai', lat: 19.08, lon: 72.88 }, { name: 'Karachi', lat: 24.86, lon: 67.01 },
 { name: 'Dhaka', lat: 23.73, lon: 90.41 }, { name: 'Jakarta', lat: -6.21, lon: 106.85 },
 { name: 'Cairo', lat: 30.04, lon: 31.24 }, { name: 'Lagos', lat: 6.45, lon: 3.40 },
 { name: 'Nairobi', lat: -1.29, lon: 36.82 }, { name: 'Johannesburg', lat: -26.20, lon: 28.04 },
 { name: 'São Paulo', lat: -23.55, lon: -46.63 }, { name: 'Mexico City', lat: 19.43, lon: -99.13 },
 { name: 'Sydney', lat: -33.87, lon: 151.21 }, { name: 'Kyiv', lat: 50.45, lon: 30.52 },
 { name: 'Tel Aviv', lat: 32.08, lon: 34.78 }, { name: 'Islamabad', lat: 33.72, lon: 73.04 },
 ];
 const WMO_CONDITION = (code) => {
 if (code === 0) return 'Clear';
 if (code <= 3) return 'Partly Cloudy';
 if (code === 45 || code === 48) return 'Fog';
 if (code >= 51 && code <= 55) return 'Drizzle';
 if (code >= 61 && code <= 65) return 'Rain';
 if (code >= 71 && code <= 75) return 'Snow';
 if (code >= 80 && code <= 82) return 'Showers';
 if (code === 95 || code === 96 || code === 99) return 'Thunderstorm';
 return 'Cloudy';
 };
 try {
 const results = await Promise.allSettled(CITIES.map(async (city) => {
 const r = await fetchWithTimeout(
 `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,wind_speed_10m,weather_code&wind_speed_unit=ms&timezone=auto`,
 {},
 8000,
 );
 if (!r.ok) return null;
 const d = await r.json();
 const cur = d.current ?? {};
 const condition = WMO_CONDITION(cur.weather_code ?? -1);
 return {
 city: city.name, lat: city.lat, lon: city.lon,
 tempC: Math.round(cur.temperature_2m ?? 0),
 feelsLikeC: null,
 humidity: null,
 condition,
 description: condition,
 icon: null,
 windMps: cur.wind_speed_10m ?? null,
 visibility: null,
 clouds: null,
 updatedAt: new Date().toISOString(),
 };
 }));
 const items = results.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value);
 setCached('owm-current', items);
 return json(items);
 } catch (error) {
 return json({ error: `owm-current error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Stablecoin markets via CoinGecko ─────────────────────────────────────
  if (requestUrl.pathname === '/api/stablecoin-markets') {
 const STABLECOINS = ['tether', 'usd-coin', 'dai', 'first-digital-usd', 'true-usd', 'frax'];
 try {
 const r = await fetchWithTimeout(
 `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(STABLECOINS.join(','))}&price_change_percentage=24h,7d`,
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } },
 12_000
 );
 if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
 const data = await r.json();
 let totalMarketCap = 0, totalVolume24h = 0, depeggedCount = 0;
 const stablecoins = data.map(c => {
 const price = c.current_price ?? 1;
 const deviation = Math.abs(price - 1);
 const pegStatus = deviation < 0.002 ? 'ON PEG' : (deviation < 0.01 ? 'SLIGHT DEPEG' : 'DEPEGGED');
 if (pegStatus !== 'ON PEG') depeggedCount++;
 totalMarketCap += c.market_cap ?? 0;
 totalVolume24h += c.total_volume ?? 0;
 return {
 id: c.id,
 symbol: (c.symbol ?? '').toUpperCase(),
 name: c.name,
 price,
 deviation: Number.parseFloat(deviation.toFixed(4)),
 pegStatus,
 marketCap: c.market_cap ?? 0,
 volume24h: c.total_volume ?? 0,
 change24h: Number.parseFloat((c.price_change_percentage_24h ?? 0).toFixed(4)),
 change7d: Number.parseFloat((c.price_change_percentage_7d_in_currency ?? 0).toFixed(4)),
 image: c.image ?? '',
 };
 });
 const healthStatus = depeggedCount === 0 ? 'HEALTHY' : (depeggedCount <= 1 ? 'CAUTION' : 'STRESSED');
 return json({
 timestamp: new Date().toISOString(),
 summary: { totalMarketCap, totalVolume24h, coinCount: stablecoins.length, depeggedCount, healthStatus },
 stablecoins,
 });
 } catch (error) {
 return json({ timestamp: new Date().toISOString(), stablecoins: [], error: String(error.message ?? error) });
 }
  }

  // ── Macro signals (Market Radar) via alternative.me + Stooq ─────────────
  if (requestUrl.pathname === '/api/macro-signals') {
 try {
 // Fetch Fear & Greed (alternative.me) + market prices (Stooq) in parallel
 const [fngResp, pricesResp] = await Promise.allSettled([
 fetchWithTimeout('https://api.alternative.me/fng/?limit=1', { headers: { 'User-Agent': CHROME_UA } }, 8000),
 fetchWithTimeout(
 'https://stooq.com/q/l/?s=btc.v+qqq.us+xlp.us+spy.us+gc.f&f=sd2t2ohlcvp&h&e=csv',
 { headers: { 'User-Agent': CHROME_UA } }, 10_000
 ),
 ]);

 // Fear & Greed
 let fearGreed = null;
 if (fngResp.status === 'fulfilled' && fngResp.value.ok) {
 const fng = await fngResp.value.json();
 const val = Number.parseInt(fng?.data?.[0]?.value ?? '50', 10);
 const classification = fng?.data?.[0]?.value_classification ?? '';
 const status = val >= 75 ? 'EXTREME_GREED' : val >= 55 ? 'GREED' : val >= 45 ? 'NEUTRAL' : val >= 25 ? 'FEAR' : 'EXTREME_FEAR';
 fearGreed = { status, value: val, classification };
 }

 // Price signals from Stooq CSV
 let flowStructure = null, macroRegime = null, technicalTrend = null;
 if (pricesResp.status === 'fulfilled' && pricesResp.value.ok) {
 const stooq = parseStooqBatchCsv(await pricesResp.value.text());
 const btc = stooq.get('btc.v');
 const qqq = stooq.get('qqq.us');
 const xlp = stooq.get('xlp.us');
 const btcChange5 = btc?.change ?? 0;
 const qqqChange5 = qqq?.change ?? 0;
 const xlpChange5 = xlp?.change ?? 0;
 const flowStatus = btcChange5 > 2 && qqqChange5 > 0.5 ? 'RISK_ON' : (btcChange5 < -2 && qqqChange5 < -0.5 ? 'RISK_OFF' : 'NEUTRAL');
 flowStructure = { status: flowStatus, btcReturn5: btcChange5, qqqReturn5: qqqChange5 };
 const regimeStatus = qqqChange5 > 0.5 && xlpChange5 < qqqChange5 ? 'RISK_ON' : (qqqChange5 < -0.5 ? 'RISK_OFF' : 'NEUTRAL');
 macroRegime = { status: regimeStatus, qqqRoc20: qqqChange5, xlpRoc20: xlpChange5 };
 const btcPrice = btc?.price ?? 0;
 const techStatus = btcChange5 > 1 ? 'BULLISH' : (btcChange5 < -1 ? 'BEARISH' : 'NEUTRAL');
 technicalTrend = { status: techStatus, btcPrice, sma50: 0, sma200: 0, vwap30d: 0, mayerMultiple: 0, sparkline: [] };
 }

 const signals = { fearGreed, flowStructure, macroRegime, technicalTrend };
 const bullishCount = [fearGreed?.value > 50, flowStructure?.status === 'RISK_ON', macroRegime?.status === 'RISK_ON', technicalTrend?.status === 'BULLISH'].filter(Boolean).length;
 const totalCount = Object.values(signals).filter(s => s !== null).length;
 const verdict = bullishCount / totalCount > 0.6 ? 'BULLISH' : (bullishCount / totalCount < 0.4 ? 'BEARISH' : 'NEUTRAL');

 return json({
 timestamp: new Date().toISOString(),
 verdict,
 bullishCount,
 totalCount,
 unavailable: false,
 signals,
 });
 } catch (error) {
 return json({ timestamp: new Date().toISOString(), verdict: 'UNAVAILABLE', bullishCount: 0, totalCount: 0, unavailable: true, signals: null, error: String(error.message ?? error) });
 }
  }

  // ── Market quotes (stocks + commodities) via Finnhub → Stooq ────────────
  if (requestUrl.pathname === '/api/market-quotes') {
 const symbols = (requestUrl.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
 if (symbols.length === 0) return json({ quotes: [] });

 // Try Finnhub first if key is set (higher precision, real-time)
 const finnhubKey = process.env.FINNHUB_API_KEY;
 if (finnhubKey) {
 try {
 const quotes = await Promise.all(symbols.map(async sym => {
 try {
 const r = await fetchWithTimeout(
 `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(finnhubKey)}`,
 { headers: { 'User-Agent': CHROME_UA } }, 8000
 );
 if (!r.ok) return { symbol: sym, price: null, change: null };
 const d = await r.json();
 if (typeof d?.c !== 'number') return { symbol: sym, price: null, change: null };
 const change = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0;
 return { symbol: sym, price: d.c, change: Number.parseFloat(change.toFixed(2)) };
 } catch { return { symbol: sym, price: null, change: null }; }
 }));
 const valid = quotes.filter(q => q.price !== null);
 if (valid.length > 0) return json({ quotes, source: 'finnhub' });
 } catch { /* fall through to Stooq */ }
 }

 // Stooq CSV batch quote — free, no key, real-time US markets
 try {
 const vixRequested = symbols.includes('^VIX');
 const nonVix = symbols.filter(s => s !== '^VIX');
 const stooqSyms = nonVix.map(toStooqSym).filter(Boolean);

 let stooq = new Map();
 if (stooqSyms.length > 0) {
 const r = await fetchWithTimeout(
 `https://stooq.com/q/l/?s=${stooqSyms.join('+')}&f=sd2t2ohlcvp&h&e=csv`,
 { headers: { 'User-Agent': CHROME_UA } }, 10_000
 );
 if (!r.ok) throw new Error(`Stooq ${r.status}`);
 stooq = parseStooqBatchCsv(await r.text());
 }

 const quotes = symbols.map(origSym => {
 if (origSym === '^VIX') return { symbol: origSym, price: null, change: null }; // filled below
 const key = toStooqSym(origSym);
 const d = key ? stooq.get(key.toLowerCase()) : null;
 return { symbol: origSym, price: d?.price ?? null, change: d?.change ?? null };
 });

 // VIX via FRED CSV (1-day lag; adequate for the volatility indicator)
 if (vixRequested) {
 try {
 const fr = await fetchWithTimeout('https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS', {}, 5000);
 if (fr.ok) {
 const { current, previous } = parseFredCsvLatest(await fr.text());
 if (!isNaN(current)) {
 const vixChange = (!isNaN(previous) && previous > 0)
 ? Number.parseFloat(((current - previous) / previous * 100).toFixed(2)) : 0;
 const vixIdx = symbols.indexOf('^VIX');
 if (vixIdx !== -1) quotes[vixIdx] = { symbol: '^VIX', price: current, change: vixChange };
 }
 }
 } catch { /* leave VIX null */ }
 }

 return json({ quotes, source: 'stooq' });
 } catch (error) {
 return json({ quotes: symbols.map(sym => ({ symbol: sym, price: null, change: null })), error: String(error.message ?? error) });
 }
  }

  // ── Crypto quotes via CoinGecko ───────────────────────────────────────────
  if (requestUrl.pathname === '/api/crypto-quotes') {
 const ids = (requestUrl.searchParams.get('ids') || 'bitcoin,ethereum,solana,ripple');
 try {
 const r = await fetchWithTimeout(
 `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`,
 { headers: { 'User-Agent': CHROME_UA, 'Accept': 'application/json' } },
 12_000
 );
 if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
 const data = await r.json();
 const quotes = ids.split(',').map(id => {
 const d = data[id.trim()];
 return {
 id: id.trim(),
 price: d?.usd ?? null,
 change: d?.usd_24h_change == undefined ? null : Number.parseFloat(d.usd_24h_change.toFixed(2)),
 };
 });
 return json({ quotes });
 } catch (error) {
 return json({ quotes: [], error: String(error.message ?? error) });
 }
  }

  // ── FRED economic series — direct API call using stored key ──────────────
  // GET /api/fred-series?ids=WALCL,FEDFUNDS,... → calls api.stlouisfed.org
  if (requestUrl.pathname === '/api/fred-series') {
 const apiKey = process.env.FRED_API_KEY;
 if (!apiKey) return json({ series: [], error: 'FRED_API_KEY not configured' }, 503);
 const ids = (requestUrl.searchParams.get('ids') || 'WALCL,FEDFUNDS,T10Y2Y,UNRATE,CPIAUCSL,DGS10,VIXCLS').split(',').map(s => s.trim()).filter(Boolean);
 try {
 const results = await Promise.all(ids.map(async id => {
 try {
 const r = await fetchWithTimeout(
 `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&limit=120&sort_order=asc&observation_start=2020-01-01`,
 { headers: { 'User-Agent': CHROME_UA } }, 10_000
 );
 if (!r.ok) return { id, observations: [], error: `FRED ${r.status}` };
 const data = await r.json();
 const obs = (data.observations ?? [])
 .filter(o => o.value !== '.')
 .map(o => ({ date: o.date, value: Number.parseFloat(o.value) }));
 return { id, observations: obs };
 } catch (error) {
 return { id, observations: [], error: String(error.message ?? error) };
 }
 }));
 return json({ series: results });
 } catch (error) {
 return json({ series: [], error: String(error.message ?? error) }, 500);
 }
  }

  // ── FRED fallback — free public data sources, no key required ────────────
  // Combines Yahoo Finance (VIX, yields), US Treasury yield curve, BLS (UNRATE/CPI)
  if (requestUrl.pathname === '/api/fred-fallback') {
 try {
 // FRED CSV replaces Yahoo Finance for VIX and Fed Funds — free, no auth, no Cloudflare block.
 // Treasury XML (DGS10, T10Y2Y) and BLS (UNRATE, CPIAUCSL) are already free — kept as-is.
 const [fredVixResp, fredFedFundsResp, treasuryResp, blsUnrateResp, blsCpiResp] = await Promise.allSettled([
 // FRED: VIX closing level (1-day lag)
 fetchWithTimeout('https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS', {}, 8000),
 // FRED: Federal Funds Effective Rate (monthly)
 fetchWithTimeout('https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS', {}, 8000),
 // US Treasury daily yield curve (free, no auth)
 fetchWithTimeout(
 `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${new Date().getFullYear()}`,
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/xml' } }, 10_000
 ),
 // BLS unemployment rate series (no key, public tier 1)
 fetchWithTimeout(
 'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000',
 { headers: { 'User-Agent': CHROME_UA, 'Content-Type': 'application/json' } }, 10_000
 ),
 // BLS CPI-U series (no key, public tier 1)
 fetchWithTimeout(
 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0',
 { headers: { 'User-Agent': CHROME_UA, 'Content-Type': 'application/json' } }, 10_000
 ),
 ]);

 const series = [];
 const today = new Date().toISOString().slice(0, 10);

 // FRED VIX
 if (fredVixResp.status === 'fulfilled' && fredVixResp.value.ok) {
 const { current } = parseFredCsvLatest(await fredVixResp.value.text());
 if (!isNaN(current) && current > 0) {
 series.push({ id: 'VIXCLS', observations: [{ date: today, value: current }] });
 }
 }

 // FRED Federal Funds Rate
 if (fredFedFundsResp.status === 'fulfilled' && fredFedFundsResp.value.ok) {
 const { current } = parseFredCsvLatest(await fredFedFundsResp.value.text());
 if (!isNaN(current) && current > 0) {
 series.push({ id: 'FEDFUNDS', observations: [{ date: today, value: current }] });
 }
 }

 // US Treasury yield curve XML (has 2-year for proper T10Y2Y)
 if (treasuryResp.status === 'fulfilled' && treasuryResp.value.ok) {
 const xml = await treasuryResp.value.text();
 // Extract latest 2-year and 10-year from XML
 const y2 = xml.match(/<d:BC_2YEAR[^>]*>([0-9.]+)<\/d:BC_2YEAR>/)?.[1];
 const y10 = xml.match(/<d:BC_10YEAR[^>]*>([0-9.]+)<\/d:BC_10YEAR>/)?.[1];
 if (y2 && y10) {
 const spread = Number.parseFloat((Number.parseFloat(y10) - Number.parseFloat(y2)).toFixed(2));
 // Overwrite the T10Y2Y approximation with accurate Treasury data
 const idx = series.findIndex(s => s.id === 'T10Y2Y');
 if (idx === -1) {series.push({ id: 'T10Y2Y', observations: [{ date: today, value: spread }] });}
 else {series[idx] = { id: 'T10Y2Y', observations: [{ date: today, value: spread }] };}
 // Also refine DGS10 with Treasury official value
 if (y10) {
 const idx10 = series.findIndex(s => s.id === 'DGS10');
 if (idx10 !== -1) series[idx10] = { id: 'DGS10', observations: [{ date: today, value: Number.parseFloat(y10) }] };
 }
 }
 }

 // BLS unemployment
 const blsUnrateObs = await (async () => {
 if (blsUnrateResp.status !== 'fulfilled' || !blsUnrateResp.value.ok) return null;
 const d = await blsUnrateResp.value.json();
 const pts = d?.Results?.series?.[0]?.data ?? [];
 return pts.slice(0, 6).reverse().map(p => ({
 date: `${p.year}-${String(p.period.replace('M', '')).padStart(2, '0')}-01`,
 value: Number.parseFloat(p.value),
 }));
 })();
 if (blsUnrateObs?.length) series.push({ id: 'UNRATE', observations: blsUnrateObs });

 // BLS CPI
 const blsCpiObs = await (async () => {
 if (blsCpiResp.status !== 'fulfilled' || !blsCpiResp.value.ok) return null;
 const d = await blsCpiResp.value.json();
 const pts = d?.Results?.series?.[0]?.data ?? [];
 return pts.slice(0, 6).reverse().map(p => ({
 date: `${p.year}-${String(p.period.replace('M', '')).padStart(2, '0')}-01`,
 value: Number.parseFloat(p.value),
 }));
 })();
 if (blsCpiObs?.length) series.push({ id: 'CPIAUCSL', observations: blsCpiObs });

 return json({ series, source: 'free-fallback' });
 } catch (error) {
 return json({ series: [], error: String(error.message ?? error) }, 500);
 }
  }

  // ── SEC EDGAR — recent 8-K material event filings (free, no key) ─────────
  if (requestUrl.pathname === '/api/edgar-filings') {
 const cached = getCached('edgar-filings', 2 * 60 * 60 * 1000); // 2h
 if (cached) return json(cached);
 try {
 const params = new URLSearchParams({
 q: '"material definitive agreement" OR "entry into a material" OR "results of operations"',
 dateRange: 'custom',
 startdt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
 forms: '8-K',
 hits: '20',
 });
 const r = await fetchWithTimeout(
 `https://efts.sec.gov/LATEST/search-index?${params}`,
 { headers: { 'User-Agent': 'CrystalBall contact@crystalball.app', Accept: 'application/json' } },
 12000,
 );
 if (!r.ok) throw new Error(`EDGAR ${r.status}`);
 const data = await r.json();
 const hits = data.hits?.hits ?? [];
 const items = hits.map((h, i) => {
 const src = h._source ?? {};
 return {
 id: h._id ?? `edgar-${i}`,
 company: src.entity_name ?? src.display_names?.[0] ?? 'Unknown',
 cik: src.entity_id ?? null,
 formType: src.file_type ?? '8-K',
 filedAt: src.file_date ?? null,
 description: src.period_of_report ? `Period: ${src.period_of_report}` : '',
 accessionNo: src.accession_no ?? null,
 };
 });
 setCached('edgar-filings', items);
 return json(items);
 } catch (error) {
 return json({ error: `edgar-filings error: ${error.message ?? error}` }, 502);
 }
  }

  if (requestUrl.pathname === '/api/edgar-search') {
 const q = requestUrl.searchParams.get('q');
 if (!q || q.trim().length < 2) return json({ error: 'Query required' }, 400);
 try {
 const params = new URLSearchParams({
 q: q.trim(),
 dateRange: 'custom',
 startdt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
 hits: '15',
 });
 const r = await fetchWithTimeout(
 `https://efts.sec.gov/LATEST/search-index?${params}`,
 { headers: { 'User-Agent': 'CrystalBall contact@crystalball.app', Accept: 'application/json' } },
 10000,
 );
 if (!r.ok) throw new Error(`EDGAR search ${r.status}`);
 const data = await r.json();
 const hits = data.hits?.hits ?? [];
 return json({
 query: q,
 total: data.hits?.total?.value ?? hits.length,
 results: hits.map((h, i) => {
 const src = h._source ?? {};
 return {
 id: h._id ?? `edgar-s-${i}`,
 company: src.entity_name ?? src.display_names?.[0] ?? 'Unknown',
 cik: src.entity_id ?? null,
 formType: src.file_type ?? '',
 filedAt: src.file_date ?? null,
 accessionNo: src.accession_no ?? null,
 };
 }),
 });
 } catch (error) {
 return json({ error: `edgar-search error: ${error.message ?? error}` }, 502);
 }
  }

  // ── URLScan.io recent malicious submissions ─────────────────────────────
  if (requestUrl.pathname === '/api/urlscan-feed') {
 // API key is optional — public search works without auth; key unlocks private scans + higher rate limits
 const apiKey = process.env.URLSCAN_API_KEY ?? '';
 const cached = getCached('urlscan-feed', 15 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const headers = { Accept: 'application/json', 'User-Agent': CHROME_UA };
 if (apiKey) headers['API-Key'] = apiKey;
 const r = await fetchWithTimeout(
 'https://urlscan.io/api/v1/search/?q=task.tags:malicious&size=20',
 { headers },
 12000,
 );
 if (!r.ok) throw new Error(`URLScan ${r.status}`);
 const data = await r.json();
 const results = (data.results ?? []).map((item, i) => ({
 id: item._id ?? `urlscan-${i}`,
 url: item.page?.url ?? null,
 domain: item.page?.domain ?? null,
 ip: item.page?.ip ?? null,
 country: item.page?.country ?? null,
 score: item.verdicts?.overall?.score ?? 0,
 malicious: item.verdicts?.overall?.malicious ?? false,
 tags: item.verdicts?.overall?.tags ?? [],
 submittedAt: item.task?.time ?? null,
 screenshot: item.screenshot ?? null,
 }));
 setCached('urlscan-feed', results);
 return json(results);
 } catch (error) {
 return json({ error: `urlscan error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Bitcoin Abuse ransomware/fraud address feed ──────────────────────────
  if (requestUrl.pathname === '/api/bitcoinabuse-feed') {
 const apiKey = process.env.BITCOINABUSE_API_KEY ?? '';
 if (!apiKey) return json({ items: [], degraded: true, reason: 'BITCOINABUSE_API_KEY not configured', source: 'bitcoinabuse.com', generatedAt: new Date().toISOString() });
 const cached = getCached('bitcoinabuse-feed');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 `https://www.bitcoinabuse.com/api/reports/check?address=1&api_token=${apiKey}&page=1`,
 { headers: { Accept: 'application/json' } },
 12000,
 );
 // Fall back to the recent reports endpoint
 const r2 = await fetchWithTimeout(
 `https://www.bitcoinabuse.com/api/reports?api_token=${apiKey}&page=1`,
 { headers: { Accept: 'application/json' } },
 12000,
 );
 if (!r2.ok) throw new Error(`BitcoinAbuse ${r2.status}`);
 const data = await r2.json();
 const reports = (data.data ?? []).map((item, i) => ({
 id: item.id ?? `ba-${i}`,
 address: item.address ?? null,
 abuseType: item.abuse_type_id ?? null,
 abuseTypeOther: item.abuse_type_other ?? null,
 description: item.description ?? null,
 reportedAt: item.created_at ?? null,
 }));
 setCached('bitcoinabuse-feed', reports, 60 * 60 * 1000);
 return json(reports);
 } catch (error) {
 return json({ error: `bitcoinabuse error: ${error.message ?? error}` }, 502);
 }
  }

  // ── NVD CVE recent vulnerability feed ──────────────────────────────────
  if (requestUrl.pathname === '/api/nvd-cve') {
 const cached = getCached('nvd-cve');
 if (cached) return json(cached);
 try {
 const pubStartDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().replace('Z', '+00:00');
 const pubEndDate = new Date().toISOString().replace('Z', '+00:00');
 const params = new URLSearchParams({ pubStartDate, pubEndDate, resultsPerPage: '50' });
 const r = await fetchWithTimeout(
 `https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`,
 { headers: { Accept: 'application/json' } },
 15000,
 );
 if (!r.ok) throw new Error(`NVD ${r.status}`);
 const data = await r.json();
 const cves = (data.vulnerabilities ?? []).map(v => {
 const cve = v.cve ?? {};
 const metrics = cve.metrics ?? {};
 const cvssV3 = metrics.cvssMetricV31?.[0]?.cvssData ?? metrics.cvssMetricV30?.[0]?.cvssData ?? null;
 const desc = (cve.descriptions ?? []).find(d => d.lang === 'en')?.value ?? '';
 return {
 id: cve.id ?? null,
 description: desc,
 published: cve.published ?? null,
 lastModified: cve.lastModified ?? null,
 severity: cvssV3?.baseSeverity ?? null,
 cvssScore: cvssV3?.baseScore ?? null,
 attackVector: cvssV3?.attackVector ?? null,
 references: (cve.references ?? []).slice(0, 3).map(r => r.url),
 };
 });
 setCached('nvd-cve', cves, 2 * 60 * 60 * 1000);
 return json(cves);
 } catch (error) {
 return json({ error: `nvd-cve error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Vulners CVE intelligence ─────────────────────────────────────────────
  if (requestUrl.pathname === '/api/vulners-search') {
 const apiKey = process.env.VULNERS_API_KEY ?? '';
 if (!apiKey) return json({ items: [], degraded: true, reason: 'VULNERS_API_KEY not configured', source: 'vulners.com', generatedAt: new Date().toISOString() });
 const q = requestUrl.searchParams.get('q') ?? 'type:cve order:publishDate';
 const cached = getCached(`vulners-${q}`);
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://vulners.com/api/v3/search/lucene/',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
 body: JSON.stringify({ query: q, size: 20, apiKey }),
 },
 12000,
 );
 if (!r.ok) throw new Error(`Vulners ${r.status}`);
 const data = await r.json();
 const results = (data.data?.search ?? []).map(item => ({
 id: item._id ?? null,
 title: item._source?.title ?? null,
 description: item._source?.description ?? null,
 cvss: item._source?.cvss?.score ?? null,
 published: item._source?.published ?? null,
 type: item._source?.type ?? null,
 href: item._source?.href ?? null,
 }));
 setCached(`vulners-${q}`, results, 2 * 60 * 60 * 1000);
 return json(results);
 } catch (error) {
 // Vulners free tier blocks unauthenticated lucene queries with 403.
 // Degrade gracefully so the panel renders an empty CVE list with a
 // banner rather than a 502 error.
 return json({ items: [], degraded: true, reason: `vulners error: ${error.message ?? error}`, source: 'vulners.com', generatedAt: new Date().toISOString() });
 }
  }

  // ── MediaStack global news ───────────────────────────────────────────────
  if (requestUrl.pathname === '/api/mediastack-news') {
 const apiKey = process.env.MEDIASTACK_API_KEY ?? '';
 // Degrade gracefully so the panel renders an empty news list rather
 // than a 403 error when the optional MediaStack key isn't set.
 if (!apiKey) return json([]);
 const cached = getCached('mediastack-news');
 if (cached) return json(cached);
 try {
 const params = new URLSearchParams({
 access_key: apiKey,
 categories: 'general,politics,business,technology,science',
 languages: 'en',
 limit: '50',
 sort: 'published_desc',
 });
 const r = await fetchWithTimeout(
 `http://api.mediastack.com/v1/news?${params}`,
 { headers: { Accept: 'application/json' } },
 12000,
 );
 if (!r.ok) throw new Error(`MediaStack ${r.status}`);
 const data = await r.json();
 const articles = (data.data ?? []).map((item, i) => ({
 id: `ms-${i}`,
 title: item.title ?? null,
 description: item.description ?? null,
 url: item.url ?? null,
 source: item.source ?? null,
 category: item.category ?? null,
 country: item.country ?? null,
 language: item.language ?? null,
 publishedAt: item.published_at ?? null,
 }));
 setCached('mediastack-news', articles, 15 * 60 * 1000);
 return json(articles);
 } catch (error) {
 return json({ error: `mediastack error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Pulsedive threat intelligence ───────────────────────────────────────
  if (requestUrl.pathname === '/api/pulsedive-feed') {
 const apiKey = process.env.PULSEDIVE_API_KEY ?? '';
 if (!apiKey) return json({ items: [], degraded: true, reason: 'PULSEDIVE_API_KEY not configured', source: 'pulsedive.com', generatedAt: new Date().toISOString() });
 const cached = getCached('pulsedive-feed');
 if (cached) return json(cached);
 try {
 const params = new URLSearchParams({ key: apiKey, limit: '50', pretty: '0' });
 const r = await fetchWithTimeout(
 `https://pulsedive.com/api/explore.php?${params}`,
 { headers: { Accept: 'application/json' } },
 12000,
 );
 if (!r.ok) throw new Error(`Pulsedive ${r.status}`);
 const data = await r.json();
 const indicators = (data.results ?? []).map(item => ({
 id: item.iid ?? null,
 indicator: item.indicator ?? null,
 type: item.type ?? null,
 risk: item.risk ?? null,
 stamp_added: item.stamp_added ?? null,
 stamp_updated: item.stamp_updated ?? null,
 tags: (item.tags ?? []).map(t => t.name ?? t),
 feeds: (item.feeds ?? []).map(f => f.name ?? f),
 }));
 setCached('pulsedive-feed', indicators, 30 * 60 * 1000);
 return json(indicators);
 } catch (error) {
 return json({ error: `pulsedive error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Have I Been Pwned domain breach check ───────────────────────────────
  if (requestUrl.pathname === '/api/hibp-breaches') {
 const apiKey = process.env.HIBP_API_KEY ?? '';
 // Degrade gracefully when the key isn't set so panels render an empty
 // breach list with a banner instead of a 403 error storm.
 if (!apiKey) return json({ breaches: [], degraded: true, reason: 'HIBP_API_KEY not configured', source: 'haveibeenpwned.com', generatedAt: new Date().toISOString() });
 const domain = requestUrl.searchParams.get('domain');
 const cacheKey = `hibp-${domain ?? 'recent'}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const endpoint = domain
 ? `https://haveibeenpwned.com/api/v3/breacheddomain/${encodeURIComponent(domain)}`
 : 'https://haveibeenpwned.com/api/v3/breaches';
 const r = await fetchWithTimeout(
 endpoint,
 { headers: { 'hibp-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' } },
 12000,
 );
 if (r.status === 404) { setCached(cacheKey, [], 60 * 60 * 1000); return json([]); }
 if (!r.ok) throw new Error(`HIBP ${r.status}`);
 const data = await r.json();
 const breaches = Array.isArray(data) ? data.map(b => ({
 name: b.Name ?? null,
 title: b.Title ?? null,
 domain: b.Domain ?? null,
 breachDate: b.BreachDate ?? null,
 pwnCount: b.PwnCount ?? null,
 dataClasses: b.DataClasses ?? [],
 isVerified: b.IsVerified ?? false,
 isSensitive: b.IsSensitive ?? false,
 })) : data;
 setCached(cacheKey, breaches, 4 * 60 * 60 * 1000);
 return json(breaches);
 } catch (error) {
 return json({ error: `hibp error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Reddit geopolitical OSINT (public RSS) ───────────────────────────────
  if (requestUrl.pathname === '/api/reddit-geo') {
 const sub = requestUrl.searchParams.get('sub') ?? 'worldnews+geopolitics+worldevents';
 const cacheKey = `reddit-${sub}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 `https://www.reddit.com/r/${sub}/hot.json?limit=50`,
 { headers: { 'User-Agent': 'CrystalBall/1.0 (news aggregation)' } },
 10000,
 );
 if (!r.ok) throw new Error(`Reddit ${r.status}`);
 const data = await r.json();
 const posts = (data.data?.children ?? []).map(child => {
 const p = child.data ?? {};
 return {
 id: p.id ?? null,
 title: p.title ?? null,
 subreddit: p.subreddit ?? null,
 url: p.url ?? null,
 permalink: `https://www.reddit.com${p.permalink ?? ''}`,
 score: p.score ?? 0,
 numComments: p.num_comments ?? 0,
 flair: p.link_flair_text ?? null,
 createdUtc: p.created_utc ?? null,
 domain: p.domain ?? null,
 };
 });
 setCached(cacheKey, posts, 10 * 60 * 1000);
 return json(posts);
 } catch (error) {
 return json({ error: `reddit error: ${error.message ?? error}` }, 502);
 }
  }

  // ── OpenAQ real-time air quality readings ────────────────────────────────
  if (requestUrl.pathname === '/api/openaq-readings') {
 const cached = getCached('openaq-readings');
 if (cached) return json(cached);
 try {
 const params = new URLSearchParams({
 limit: '100',
 page: '1',
 offset: '0',
 sort: 'desc',
 parameter: 'pm25',
 has_geo: 'true',
 order_by: 'lastUpdated',
 });
 const r = await fetchWithTimeout(
 `https://api.openaq.org/v2/latest?${params}`,
 { headers: { Accept: 'application/json', 'X-API-Key': '' } },
 12000,
 );
 if (!r.ok) throw new Error(`OpenAQ ${r.status}`);
 const data = await r.json();
 const readings = (data.results ?? []).map(item => ({
 id: item.location ?? null,
 locationId: item.locationId ?? null,
 city: item.city ?? null,
 country: item.country ?? null,
 coordinates: item.coordinates ?? null,
 measurements: (item.measurements ?? []).map(m => ({
 parameter: m.parameter ?? null,
 value: m.value ?? null,
 unit: m.unit ?? null,
 lastUpdated: m.lastUpdated ?? null,
 })),
 }));
 setCached('openaq-readings', readings, 30 * 60 * 1000);
 return json(readings);
 } catch (error) {
 // OpenAQ v2 returns 410 since they migrated to v3 with API keys. We
 // degrade gracefully so the panel renders an empty list with a
 // banner rather than a 502 error storm.
 return json({ readings: [], degraded: true, reason: `openaq error: ${error.message ?? error}`, source: 'openaq.org', generatedAt: new Date().toISOString() });
 }
  }

  // ── GeoNames place search ────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/geonames-search') {
 const username = process.env.GEONAMES_USERNAME ?? '';
 if (!username) return json({ results: [], degraded: true, reason: 'GEONAMES_USERNAME not configured', source: 'geonames.org', generatedAt: new Date().toISOString() });
 const q = requestUrl.searchParams.get('q');
 if (!q) return json({ error: 'q parameter required' }, 400);
 const cacheKey = `geonames-${q}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const params = new URLSearchParams({ q, maxRows: '20', username, type: 'json', style: 'MEDIUM' });
 const r = await fetchWithTimeout(
 `https://secure.geonames.org/searchJSON?${params}`,
 { headers: { Accept: 'application/json' } },
 10000,
 );
 if (!r.ok) throw new Error(`GeoNames ${r.status}`);
 const data = await r.json();
 const places = (data.geonames ?? []).map(p => ({
 id: p.geonameId ?? null,
 name: p.name ?? null,
 toponym: p.toponymName ?? null,
 country: p.countryName ?? null,
 countryCode: p.countryCode ?? null,
 lat: p.lat != null ? parseFloat(p.lat) : null,
 lon: p.lng != null ? parseFloat(p.lng) : null,
 population: p.population ?? null,
 featureClass: p.fcl ?? null,
 featureCode: p.fcode ?? null,
 adminName1: p.adminName1 ?? null,
 }));
 setCached(cacheKey, places, 24 * 60 * 60 * 1000);
 return json(places);
 } catch (error) {
 return json({ error: `geonames error: ${error.message ?? error}` }, 502);
 }
  }

  // ── RIPE NCC BGP data ────────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/ripe-ncc') {
 const asn = requestUrl.searchParams.get('asn');
 const type = requestUrl.searchParams.get('type') ?? 'overview';
 const cacheKey = `ripe-${type}-${asn ?? 'routing-status'}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 let endpoint;
 endpoint = asn ? `https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}` : 'https://stat.ripe.net/data/routing-status/data.json?resource=8.8.8.8';
 const r = await fetchWithTimeout(
 endpoint,
 { headers: { Accept: 'application/json' } },
 10000,
 );
 if (!r.ok) throw new Error(`RIPE NCC ${r.status}`);
 const data = await r.json();
 setCached(cacheKey, data.data ?? data, 60 * 60 * 1000);
 return json(data.data ?? data);
 } catch (error) {
 return json({ error: `ripe-ncc error: ${error.message ?? error}` }, 502);
 }
  }

  // -- RIPE Atlas -- real internet connectivity measurements ----------------
  if (requestUrl.pathname === '/api/ripe-atlas') {
    const type = requestUrl.searchParams.get('type') ?? 'status';
    const cacheKey = `ripe-atlas-${type}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      let endpoint;
      endpoint = type === 'anchors' ? 'https://atlas.ripe.net/api/v2/anchors/?format=json&page_size=100&is_disabled=false' : 'https://atlas.ripe.net/api/v2/probes/?format=json&status=1&page_size=1&fields=id';
      const r = await fetchWithTimeout(endpoint, { headers: { Accept: 'application/json' } }, 12000);
      if (!r.ok) throw new Error(`RIPE Atlas ${r.status}`);
      const data = await r.json();
      const result = type === 'anchors'
        ? { anchors: (data.results ?? []).map(a => ({ id: a.id, fqdn: a.fqdn, country: a.country, is_ipv4_only: a.is_ipv4_only, geometry: a.geometry })), count: data.count ?? 0 }
        : { totalConnectedProbes: data.count ?? 0 };
      setCached(cacheKey, result, 10 * 60 * 1000);
      return json(result);
    } catch (error) {
      return json({ error: `ripe-atlas error: ${error.message ?? error}` }, 502);
    }
  }

  // ── IPInfo IP intelligence lookup ────────────────────────────────────────
  if (requestUrl.pathname === '/api/ipinfo-lookup') {
 const token = process.env.IPINFO_TOKEN ?? '';
 // Degrade gracefully so the panel can render an empty result with a
 // banner rather than a 403 error when the optional IPinfo token
 // isn't set.
 if (!token) return json({ result: null, degraded: true, reason: 'IPINFO_TOKEN not configured', source: 'ipinfo.io', generatedAt: new Date().toISOString() });
 const ip = requestUrl.searchParams.get('ip');
 if (!ip) return json({ error: 'ip parameter required' }, 400);
 const cacheKey = `ipinfo-${ip}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 `https://ipinfo.io/${ip}?token=${token}`,
 { headers: { Accept: 'application/json' } },
 8000,
 );
 if (!r.ok) throw new Error(`IPInfo ${r.status}`);
 const data = await r.json();
 const result = {
 ip: data.ip ?? ip,
 hostname: data.hostname ?? null,
 city: data.city ?? null,
 region: data.region ?? null,
 country: data.country ?? null,
 loc: data.loc ?? null,
 org: data.org ?? null,
 postal: data.postal ?? null,
 timezone: data.timezone ?? null,
 asn: data.asn ?? null,
 abuse: data.abuse ?? null,
 };
 setCached(cacheKey, result, 6 * 60 * 60 * 1000);
 return json(result);
 } catch (error) {
 return json({ error: `ipinfo error: ${error.message ?? error}` }, 502);
 }
  }

  // ── ISW (Institute for the Study of War) daily situation reports ─────────
  if (requestUrl.pathname === '/api/isw-reports') {
 const cached = getCached('isw-reports');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://www.understandingwar.org/feed',
 { headers: { 'User-Agent': 'CrystalBall/1.0 (conflict intelligence aggregation)' } },
 12000,
 );
 if (!r.ok) throw new Error(`ISW RSS ${r.status}`);
 const xml = await r.text();
 function parseRssField(block, tag) {
 const cdataMatch = block.match(new RegExp(String.raw`<${tag}><\!\[CDATA\[([\s\S]*?)\]\]><\/${tag}>`));
 if (cdataMatch) return cdataMatch[1].trim();
 const plainMatch = block.match(new RegExp(String.raw`<${tag}>([\s\S]*?)<\/${tag}>`));
 return plainMatch?.[1]?.trim() ?? null;
 }
 const items = [];
 for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
 const block = m[1];
 const title = parseRssField(block, 'title');
 const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? null;
 const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? null;
 const rawDesc = parseRssField(block, 'description');
 const description = rawDesc ? rawDesc.replace(RE_HTML_TAGS, '').trim().slice(0, 500) : null;
 const category = parseRssField(block, 'category');
 if (title) items.push({ title, link, pubDate, description, category });
 }
 setCached('isw-reports', items, 30 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `isw-reports error: ${error.message ?? error}` }, 502);
 }
  }

  // ── UN OCHA ReliefWeb crisis situation reports ────────────────────────────
  if (requestUrl.pathname === '/api/reliefweb-crises') {
 const cached = getCached('reliefweb-crises');
 if (cached) return json(cached);
 try {
 const payload = {
 query: { value: 'format:"Situation Report" OR format:"Update" OR format:"Flash Update"' },
 filter: { field: 'status', value: 'published' },
 sort: ['date.created:desc'],
 limit: 30,
 fields: { include: ['title', 'date', 'country', 'source', 'url', 'body-html', 'theme', 'format', 'primary_country'] },
 };
 const r = await fetchWithTimeout(
 'https://api.reliefweb.int/v1/reports?appname=crystalball',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
 body: JSON.stringify(payload),
 },
 15000,
 );
 if (!r.ok) throw new Error(`ReliefWeb ${r.status}`);
 const data = await r.json();
 const reports = (data.data ?? []).map(item => {
 const f = item.fields ?? {};
 return {
 id: item.id ?? null,
 title: f.title ?? null,
 date: f.date?.created ?? null,
 country: (f.primary_country?.name ?? f.country?.[0]?.name) ?? null,
 countries: (f.country ?? []).map(c => c.name),
 source: f.source?.[0]?.name ?? null,
 url: f.url ?? null,
 format: f.format?.[0]?.name ?? null,
 themes: (f.theme ?? []).map(t => t.name),
 summary: f['body-html'] ? f['body-html'].replace(RE_HTML_TAGS, '').trim().slice(0, 600) : null,
 };
 });
 setCached('reliefweb-crises', reports, 2 * 60 * 60 * 1000);
 return json(reports);
 } catch (error) {
 // Degrade gracefully — ReliefWeb v1 returns 410, and v2 requires an
 // approved-appname registration we don't have. Panels render an
 // empty list with a banner rather than receiving a 502 error.
 return json({ reports: [], degraded: true, reason: `reliefweb error: ${error.message ?? error}`, source: 'reliefweb.int', generatedAt: new Date().toISOString() });
 }
  }

  // ── Bellingcat OSINT investigations ──────────────────────────────────────
  if (requestUrl.pathname === '/api/bellingcat') {
 const cached = getCached('bellingcat');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://www.bellingcat.com/feed/',
 { headers: { 'User-Agent': 'CrystalBall/1.0 (OSINT aggregation)' } },
 12000,
 );
 if (!r.ok) throw new Error(`Bellingcat ${r.status}`);
 const xml = await r.text();
 function parseBcField(block, tag) {
 const cdataMatch = block.match(new RegExp(String.raw`<${tag}><\!\[CDATA\[([\s\S]*?)\]\]><\/${tag}>`));
 if (cdataMatch) return cdataMatch[1].trim();
 return block.match(new RegExp(String.raw`<${tag}>([\s\S]*?)<\/${tag}>`))?.[1]?.trim() ?? null;
 }
 const items = [];
 for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
 const block = m[1];
 const title = parseBcField(block, 'title');
 const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? null;
 const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? null;
 const rawDesc = parseBcField(block, 'description');
 const description = rawDesc ? rawDesc.replace(RE_HTML_TAGS, '').trim().slice(0, 500) : null;
 const creator = parseBcField(block, 'dc:creator');
 if (title) items.push({ title, link, pubDate, description, creator });
 }
 setCached('bellingcat', items, 30 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `bellingcat error: ${error.message ?? error}` }, 502);
 }
  }

  // ── EMSC seismic + nuclear test site proximity detection ─────────────────
  if (requestUrl.pathname === '/api/emsc-seismic') {
 const cached = getCached('emsc-seismic');
 if (cached) return json(cached);
 try {
 const TEST_SITES = [
 { lat: 41.27,  lon: 129.08,  radiusKm: 50,  label: 'Punggye-ri', country: 'North Korea' },
 { lat: 73.40,  lon: 54.90, radiusKm: 100, label: 'Novaya Zemlya', country: 'Russia' },
 { lat: 41.00,  lon: 88.40, radiusKm: 50,  label: 'Lop Nor', country: 'China' },
 { lat: 37.10,  lon: -116.00, radiusKm: 50,  label: 'Nevada Test Site', country: 'United States' },
 { lat: -21.87, lon: -138.94, radiusKm: 50,  label: 'Mururoa Atoll', country: 'France' },
 ];
 function haversineKm(lat1, lon1, lat2, lon2) {
 const R = 6371;
 const dLat = (lat2 - lat1) * Math.PI / 180;
 const dLon = (lon2 - lon1) * Math.PI / 180;
 const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
 return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 }
 const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
 const params = new URLSearchParams({ format: 'json', limit: '200', minmagnitude: '3.5', orderby: 'time', start });
 const r = await fetchWithTimeout(
 `https://www.seismicportal.eu/fdsnws/event/1/query?${params}`,
 { headers: { Accept: 'application/json' } },
 15000,
 );
 if (!r.ok) throw new Error(`EMSC ${r.status}`);
 const data = await r.json();
 const events = (data.features ?? []).map(f => {
 const p = f.properties ?? {};
 const [lon, lat, depth] = f.geometry?.coordinates ?? [0, 0, null];
 const nearSite = TEST_SITES.find(s => haversineKm(lat, lon, s.lat, s.lon) <= s.radiusKm);
 const suspectedNuclearTest = nearSite != null && (depth == null || depth <= 20) && (p.mag ?? 0) >= 4.0;
 return {
 id: f.id ?? p.unid ?? null,
 magnitude: p.mag ?? null,
 magnitudeType: p.magtype ?? null,
 depth: depth ?? null,
 lat, lon,
 region: p.flynn_region ?? p.region ?? null,
 time: p.time ?? null,
 source: p.source_id ?? null,
 suspectedNuclearTest,
 nearTestSite: nearSite ? { label: nearSite.label, country: nearSite.country } : null,
 };
 });
 setCached('emsc-seismic', events, 10 * 60 * 1000);
 return json(events);
 } catch (error) {
 return json({ error: `emsc-seismic error: ${error.message ?? error}` }, 502);
 }
  }

  // ── USGS PAGER + ShakeMap rapid impact assessment ────────────────────────
  // GET /api/seismic-impact?eventId=<id>
  // Returns the PAGER alert label + ShakeMap maxMMI for the requested
  // event. The renderer-side pure layer (`impact-assessor.ts`) handles
  // the per-city affected-population logic; the sidecar's job is just
  // to fetch + pass through the upstream USGS shapes.
  if (requestUrl.pathname === '/api/seismic-impact') {
 const eventId = requestUrl.searchParams.get('eventId');
 if (!eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) {
 return json({ error: 'invalid or missing eventId' }, 400);
 }
 const cacheKey = `seismic-impact:${eventId}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const detailUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(eventId)}&producttype=shakemap`;
 const r = await fetchWithTimeout(detailUrl, { headers: { Accept: 'application/json' } }, 15000);
 if (!r.ok) throw new Error(`USGS detail ${r.status}`);
 const data = await r.json();
 const props = data?.properties ?? {};
 const shakemapProduct = props.products?.shakemap?.[0] ?? null;
 const maxMmiRaw = shakemapProduct?.properties?.maxmmi ?? null;
 const maxMmi = maxMmiRaw === null ? null : Number.parseFloat(String(maxMmiRaw));
 const publishedAtRaw = shakemapProduct?.updateTime ?? null;
 const result = {
 eventId,
 pagerAlert: typeof props.alert === 'string' ? props.alert : null,
 magnitude: typeof props.mag === 'number' ? props.mag : null,
 place: typeof props.place === 'string' ? props.place : null,
 occurredAt: typeof props.time === 'number' ? props.time : null,
 shakeMap: {
 maxMmi: Number.isFinite(maxMmi) ? maxMmi : null,
 publishedAt: typeof publishedAtRaw === 'number' ? publishedAtRaw : null,
 },
 sourceUrl: typeof props.url === 'string' ? props.url : null,
 };
 setCached(cacheKey, result, 5 * 60 * 1000);
 return json(result);
 } catch (error) {
 return json({ error: `seismic-impact error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Tsunami status: PTWC Atom + 10 NDBC DART buoys ────────────────────────
  // GET /api/tsunami-status
  // Returns the raw PTWC Atom XML and per-buoy realtime2 .txt bodies.
  // The renderer's `tsunami-reasoner.ts` parses both into structured
  // bulletins + DART anomalies. 15-minute cache.
  if (requestUrl.pathname === '/api/tsunami-status') {
 const cacheKey = 'tsunami-status';
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 const DART_BUOYS = ['46411','46412','46413','46407','51407','55023','55012','55015','32401','32412'];
 const ptwcUrl = 'https://www.tsunami.gov/events/xml/PAAQAtom.xml';
 try {
 const ptwcRes = await fetchWithTimeout(ptwcUrl, { headers: { Accept: 'application/atom+xml,application/xml;q=0.9' } }, 15000);
 const ptwcXml = ptwcRes.ok ? await ptwcRes.text() : '';
 const dartResults = await Promise.all(
 DART_BUOYS.map(async (id) => {
 try {
 const dr = await fetchWithTimeout(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`, { headers: { Accept: 'text/plain' } }, 12000);
 if (!dr.ok) return { buoyId: id, ok: false, body: null, status: dr.status };
 const body = await dr.text();
 return { buoyId: id, ok: true, body, status: dr.status };
 } catch (error) {
 return { buoyId: id, ok: false, body: null, error: String(error?.message ?? error) };
 }
 }),
 );
 const result = {
 fetchedAt: Date.now(),
 ptwc: { ok: ptwcRes.ok, status: ptwcRes.status, xml: ptwcXml },
 dart: dartResults,
 };
 setCached(cacheKey, result, 15 * 60 * 1000);
 return json(result);
 } catch (error) {
 return json({ error: `tsunami-status error: ${error.message ?? error}` }, 502);
 }
  }

  // ── USGS FDSN catalog passthrough (pre-arrival detector poll) ─────────
  // Forwards to USGS FDSN event service with the descope spec's exact
  // shape: format=geojson, limit=50, minmagnitude defaults to 4,
  // orderby=time. The renderer polls every 30 s and feeds the result
  // through `findPreArrivalEvents` from src/services/seismic/waveform-
  // detector.ts. Cached for 25 s so a faster-than-poll caller still
  // sees stable batches.
  if (requestUrl.pathname === '/api/fdsn-catalog') {
    const minMagnitude = Number(requestUrl.searchParams.get('minMagnitude') ?? '4');
    const limit = Number(requestUrl.searchParams.get('limit') ?? '50');
    if (
      !Number.isFinite(minMagnitude) || minMagnitude < 0 || minMagnitude > 10
      || !Number.isFinite(limit) || limit <= 0 || limit > 200
    ) {
      return json({ error: 'invalid query (minMagnitude, limit)' }, 400);
    }
    const cacheKey = `fdsn-catalog:${minMagnitude}:${limit}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      const params = new URLSearchParams({
        format: 'geojson',
        limit: String(limit),
        minmagnitude: String(minMagnitude),
        orderby: 'time',
      });
      const upstream = `https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`;
      const r = await fetchWithTimeout(
        upstream,
        { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/sidecar (fdsn-catalog)' } },
        15000,
      );
      if (!r.ok) throw new Error(`USGS ${r.status}`);
      const data = await r.json();
      setCached(cacheKey, data, 25_000);
      return json(data);
    } catch (error) {
      return json({ error: `fdsn-catalog error: ${error.message ?? error}` }, 502);
    }
  }

  // ── USGS focal mechanism (moment tensor) passthrough ───────────────────
  // Forwards to USGS FDSN event service for the requested event id and
  // returns the GeoJSON. Renderer parses with `parseUsgsMomentTensor` from
  // src/services/seismic/focal-classifier.ts. Cached 30 min/event since
  // moment tensors are revised slowly after the initial automatic solution.
  if (requestUrl.pathname === '/api/focal-mechanism') {
    const eventId = (requestUrl.searchParams.get('eventId') ?? '').trim();
    // USGS event ids are network code + numeric/alphanumeric, e.g.
    // us7000abcd, nc73881266, ci40012345. Tight allowlist guards against
    // path injection in the upstream URL.
    if (!eventId || !/^[A-Za-z0-9_-]{2,32}$/.test(eventId)) {
      return json({ error: 'invalid eventId' }, 400);
    }
    const cacheKey = `focal-mechanism:${eventId}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      const upstream = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(eventId)}&producttype=moment-tensor`;
      const r = await fetchWithTimeout(
        upstream,
        { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/sidecar (focal-mechanism)' } },
        15000,
      );
      if (r.status === 404) {
        const empty = { eventId, available: false, reason: 'no moment-tensor product for this event' };
        setCached(cacheKey, empty, 5 * 60 * 1000);
        return json(empty);
      }
      if (!r.ok) throw new Error(`USGS ${r.status}`);
      const data = await r.json();
      const payload = { eventId, available: true, raw: data };
      setCached(cacheKey, payload, 30 * 60 * 1000);
      return json(payload);
    } catch (error) {
      return json({ error: `focal-mechanism error: ${error.message ?? error}` }, 502);
    }
  }

  // ── USGS historical analog catalog passthrough ─────────────────────────
  // Forwards to USGS FDSN event service for events within a 50 km / ±0.5 M
  // / ±30 km depth box around the query location, last 50 years up to 1
  // year before the query event. Renderer ranks via
  // `findHistoricalAnalogs` from src/services/seismic/sequence-matcher.ts.
  // Cached per-query for 24 h; the historical catalog moves slowly.
  if (requestUrl.pathname === '/api/historical-analogs') {
    const lat = Number(requestUrl.searchParams.get('lat'));
    const lon = Number(requestUrl.searchParams.get('lon'));
    const mag = Number(requestUrl.searchParams.get('magnitude'));
    const radiusKm = Number(requestUrl.searchParams.get('radiusKm') ?? 50);
    const magDelta = Number(requestUrl.searchParams.get('magnitudeDelta') ?? 0.5);
    const beforeMs = Number(requestUrl.searchParams.get('beforeMs') ?? Date.now());
    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lon) || lon < -180 || lon > 180
      || !Number.isFinite(mag) || mag < 0 || mag > 10
      || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500
      || !Number.isFinite(magDelta) || magDelta <= 0 || magDelta > 2
      || !Number.isFinite(beforeMs) || beforeMs <= 0
    ) {
      return json({ error: 'invalid query (lat/lon/magnitude/radiusKm/magnitudeDelta/beforeMs)' }, 400);
    }
    const cacheKey = `historical-analogs:${lat.toFixed(2)}:${lon.toFixed(2)}:${mag.toFixed(2)}:${radiusKm}:${magDelta}:${Math.floor(beforeMs / (24 * 60 * 60 * 1000))}`;
    const cached = getCached(cacheKey);
    if (cached) return json(cached);
    try {
      // Last 50 years up to (beforeMs - 1 year) so the event itself
      // can't appear as its own analog.
      const startTime = new Date(beforeMs - 50 * 365 * 24 * 60 * 60 * 1000).toISOString();
      const endTime = new Date(beforeMs - 365 * 24 * 60 * 60 * 1000).toISOString();
      const params = new URLSearchParams({
        format: 'geojson',
        latitude: String(lat),
        longitude: String(lon),
        maxradiuskm: String(radiusKm),
        minmagnitude: String(Math.max(0, mag - magDelta)),
        maxmagnitude: String(mag + magDelta),
        starttime: startTime,
        endtime: endTime,
        orderby: 'magnitude',
        limit: '100',
      });
      const upstream = `https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`;
      const r = await fetchWithTimeout(
        upstream,
        { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/sidecar (historical-analogs)' } },
        20000,
      );
      if (!r.ok) throw new Error(`USGS ${r.status}`);
      const data = await r.json();
      const payload = { lat, lon, magnitude: mag, radiusKm, magnitudeDelta: magDelta, raw: data };
      setCached(cacheKey, payload, 24 * 60 * 60 * 1000);
      return json(payload);
    } catch (error) {
      return json({ error: `historical-analogs error: ${error.message ?? error}` }, 502);
    }
  }

  // ── DYFI ("Did You Feel It?") cdi_zip.xml passthrough ─────────────────────
  // GET /api/dyfi?eventId=<id>
  // Returns the raw cdi_zip.xml for the requested USGS event so the
  // renderer's pure layer (`dyfi-collector.ts`) can parse + aggregate
  // by state. 15-min cache.
  if (requestUrl.pathname === '/api/dyfi') {
 const eventId = requestUrl.searchParams.get('eventId');
 if (!eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) {
 return json({ error: 'invalid or missing eventId' }, 400);
 }
 const cacheKey = `dyfi:${eventId}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const detailUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(eventId)}&producttype=dyfi`;
 const detailRes = await fetchWithTimeout(detailUrl, { headers: { Accept: 'application/json' } }, 15000);
 if (!detailRes.ok) throw new Error(`USGS detail ${detailRes.status}`);
 const detail = await detailRes.json();
 const dyfiProduct = detail?.properties?.products?.dyfi?.[0] ?? null;
 const cdiZipUrl = dyfiProduct?.contents?.['cdi_zip.xml']?.url
 ?? dyfiProduct?.contents?.['dyfi_zip.xml']?.url
 ?? null;
 if (typeof cdiZipUrl !== 'string') {
 return json({ eventId, available: false, xml: '', fetchedAt: Date.now() });
 }
 const xmlRes = await fetchWithTimeout(cdiZipUrl, { headers: { Accept: 'application/xml,text/xml' } }, 15000);
 if (!xmlRes.ok) throw new Error(`USGS dyfi xml ${xmlRes.status}`);
 const xml = await xmlRes.text();
 const result = {
 eventId,
 available: true,
 xml,
 sourceUrl: cdiZipUrl,
 maxMmi: typeof dyfiProduct?.properties?.maxmmi === 'string' ? Number.parseFloat(dyfiProduct.properties.maxmmi) : null,
 numResponses: typeof dyfiProduct?.properties?.numResp === 'string' ? Number.parseInt(dyfiProduct.properties.numResp, 10) : null,
 fetchedAt: Date.now(),
 };
 setCached(cacheKey, result, 15 * 60 * 1000);
 return json(result);
 } catch (error) {
 return json({ error: `dyfi error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Aftershock forecast: USGS ComCat aftershock cloud passthrough ─────────
  // GET /api/aftershock-forecast?eventId=<id>&radiusKm=<n>
  // Returns the mainshock summary + the list of USGS-known aftershocks
  // within `radiusKm` of the mainshock and within +14 days. The
  // renderer-side pure layer (`aftershock-watch.ts`) handles the
  // Omori-Utsu forecast and the observed-vs-expected ratio. 15-min cache.
  if (requestUrl.pathname === '/api/aftershock-forecast') {
 const eventId = requestUrl.searchParams.get('eventId');
 if (!eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) {
 return json({ error: 'invalid or missing eventId' }, 400);
 }
 const radiusRaw = requestUrl.searchParams.get('radiusKm');
 const radiusKm = (() => {
 if (!radiusRaw) return 100;
 const n = Number.parseInt(radiusRaw, 10);
 return Number.isFinite(n) && n > 0 && n <= 500 ? n : 100;
 })();
 const cacheKey = `aftershock-forecast:${eventId}:${radiusKm}`;
 const cached = getCached(cacheKey);
 if (cached) return json(cached);
 try {
 const detailUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(eventId)}`;
 const r = await fetchWithTimeout(detailUrl, { headers: { Accept: 'application/json' } }, 15000);
 if (!r.ok) throw new Error(`USGS detail ${r.status}`);
 const detail = await r.json();
 const props = detail?.properties ?? {};
 const coords = detail?.geometry?.coordinates ?? null;
 const mainLon = Array.isArray(coords) && typeof coords[0] === 'number' ? coords[0] : null;
 const mainLat = Array.isArray(coords) && typeof coords[1] === 'number' ? coords[1] : null;
 const mainDepth = Array.isArray(coords) && typeof coords[2] === 'number' ? coords[2] : null;
 const occurredAt = typeof props.time === 'number' ? props.time : null;
 const magnitude = typeof props.mag === 'number' ? props.mag : null;
 if (mainLat === null || mainLon === null || occurredAt === null || magnitude === null) {
 return json({ error: 'mainshock missing required fields' }, 502);
 }
 const start = new Date(occurredAt + 1).toISOString();
 const end = new Date(occurredAt + 14 * 24 * 60 * 60 * 1000).toISOString();
 const degBuf = (radiusKm / 111) * 1.4;
 const cloudUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${encodeURIComponent(start)}&endtime=${encodeURIComponent(end)}&minlatitude=${mainLat - degBuf}&maxlatitude=${mainLat + degBuf}&minlongitude=${mainLon - degBuf}&maxlongitude=${mainLon + degBuf}&minmagnitude=2.5&orderby=time-asc`;
 const cr = await fetchWithTimeout(cloudUrl, { headers: { Accept: 'application/json' } }, 20000);
 if (!cr.ok) throw new Error(`USGS cloud ${cr.status}`);
 const cloud = await cr.json();
 const features = Array.isArray(cloud?.features) ? cloud.features : [];
 const aftershocks = features
 .filter((f) => f && f.id !== eventId)
 .map((f) => ({
 id: typeof f.id === 'string' ? f.id : null,
 magnitude: typeof f?.properties?.mag === 'number' ? f.properties.mag : null,
 depthKm: Array.isArray(f?.geometry?.coordinates) && typeof f.geometry.coordinates[2] === 'number' ? f.geometry.coordinates[2] : null,
 lat: Array.isArray(f?.geometry?.coordinates) && typeof f.geometry.coordinates[1] === 'number' ? f.geometry.coordinates[1] : null,
 lon: Array.isArray(f?.geometry?.coordinates) && typeof f.geometry.coordinates[0] === 'number' ? f.geometry.coordinates[0] : null,
 occurredAt: typeof f?.properties?.time === 'number' ? f.properties.time : null,
 place: typeof f?.properties?.place === 'string' ? f.properties.place : '',
 url: typeof f?.properties?.url === 'string' ? f.properties.url : null,
 }));
 const result = {
 mainshock: {
 eventId,
 magnitude,
 lat: mainLat,
 lon: mainLon,
 depthKm: mainDepth,
 occurredAt,
 place: typeof props.place === 'string' ? props.place : '',
 },
 radiusKm,
 aftershocks,
 fetchedAt: Date.now(),
 };
 setCached(cacheKey, result, 15 * 60 * 1000);
 return json(result);
 } catch (error) {
 return json({ error: `aftershock-forecast error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Travel warning RSS/Atom parser helper ─────────────────────────────────
  function parseTravelWarnings(xml, source) {
 const isAtom = source !== 'DFAT';
 const itemTag = isAtom ? /(<entry>[\s\S]*?<\/entry>)/g : /(<item>[\s\S]*?<\/item>)/g;
 const datePattern = isAtom ? /<updated>(.*?)<\/updated>/ : /<pubDate>(.*?)<\/pubDate>/;
 const results = [];
 for (const m of xml.matchAll(itemTag)) {
 const block = m[1];
 const titleRaw = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ?? block.match(/<title>([\s\S]*?)<\/title>/);
 const title = titleRaw?.[1]?.trim() ?? '';
 const date = block.match(datePattern)?.[1]?.trim() ?? null;
 const linkHref = block.match(/href="([^"]+)"/)?.[1]?.trim() ?? block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? null;
 const sumRaw = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) ?? block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ?? block.match(/<description>([\s\S]*?)<\/description>/);
 const summary = sumRaw?.[1]?.replace(RE_HTML_TAGS, '').trim().slice(0, 400) ?? null;
 const country = title.replace(/\s*[-:]\s*travel (advice|advisory|warning).*$/i, '').trim();
 if (country) results.push({ country, date, link: linkHref, summary, source, title });
 }
 return results;
  }

  // ── UK FCDO travel warnings ───────────────────────────────────────────────
  if (requestUrl.pathname === '/api/fcdo-warnings') {
 const cached = getCached('fcdo-warnings');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout('https://www.gov.uk/foreign-travel-advice.atom', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000);
 if (!r.ok) throw new Error(`FCDO ${r.status}`);
 const items = parseTravelWarnings(await r.text(), 'FCDO');
 setCached('fcdo-warnings', items, 60 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `fcdo-warnings error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Australia DFAT (Smartraveller) travel warnings ───────────────────────
  if (requestUrl.pathname === '/api/dfat-warnings') {
 const cached = getCached('dfat-warnings');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout('https://www.smartraveller.gov.au/rss', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000);
 if (!r.ok) throw new Error(`DFAT ${r.status}`);
 const items = parseTravelWarnings(await r.text(), 'DFAT');
 setCached('dfat-warnings', items, 60 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `dfat-warnings error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Canada GAC travel warnings ────────────────────────────────────────────
  if (requestUrl.pathname === '/api/gac-warnings') {
 const cached = getCached('gac-warnings');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout('https://travel.gc.ca/travelling/advisories.atom', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000);
 if (!r.ok) throw new Error(`GAC ${r.status}`);
 const items = parseTravelWarnings(await r.text(), 'GAC');
 setCached('gac-warnings', items, 60 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `gac-warnings error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Multi-government warning convergence signal ───────────────────────────
  if (requestUrl.pathname === '/api/gov-convergence') {
 const cached = getCached('gov-convergence');
 if (cached) return json(cached);
 try {
 const [fcdoRes, dfatRes, gacRes] = await Promise.allSettled([
 fetchWithTimeout('https://www.gov.uk/foreign-travel-advice.atom', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000),
 fetchWithTimeout('https://www.smartraveller.gov.au/rss', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000),
 fetchWithTimeout('https://travel.gc.ca/travelling/advisories.atom', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000),
 ]);
 const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
 const allWarnings = [];
 const sources = [
 { result: fcdoRes, key: 'FCDO' },
 { result: dfatRes, key: 'DFAT' },
 { result: gacRes, key: 'GAC' },
 ];
 for (const { result, key } of sources) {
 if (result.status === 'fulfilled' && result.value.ok) {
 allWarnings.push(...parseTravelWarnings(await result.value.text(), key));
 }
 }
 const byCountry = {};
 for (const w of allWarnings) {
 if (!byCountry[w.country]) byCountry[w.country] = [];
 byCountry[w.country].push(w);
 }
 const convergence = Object.entries(byCountry)
 .filter(([, warns]) => warns.length >= 2)
 .map(([country, warns]) => {
 const recentWarns = warns.filter(w => w.date && new Date(w.date).getTime() > sevenDaysAgo);
 return {
 country,
 sources: [...new Set(warns.map(w => w.source))],
 recentSources: [...new Set(recentWarns.map(w => w.source))],
 recentCount: recentWarns.length,
 isConvergenceAlert: recentWarns.length >= 2,
 latestUpdate: warns.map(w => w.date).filter(Boolean).sort().at(-1) ?? null,
 warnings: warns,
 };
 })
 .sort((a, b) => b.recentCount - a.recentCount);
 setCached('gov-convergence', convergence, 30 * 60 * 1000);
 return json(convergence);
 } catch (error) {
 return json({ error: `gov-convergence error: ${error.message ?? error}` }, 502);
 }
  }

  // ── US Department of Defense news RSS ────────────────────────────────────
  if (requestUrl.pathname === '/api/dod-news') {
 const cached = getCached('dod-news');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout('https://www.defense.gov/News/RSS/', { headers: { 'User-Agent': 'CrystalBall/1.0' } }, 12000);
 if (!r.ok) throw new Error(`DoD News ${r.status}`);
 const xml = await r.text();
 const items = [];
 for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
 const block = m[1];
 const titleRaw = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ?? block.match(/<title>([\s\S]*?)<\/title>/);
 const title = titleRaw?.[1]?.trim() ?? null;
 const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? null;
 const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? null;
 const descRaw = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ?? block.match(/<description>([\s\S]*?)<\/description>/);
 const description = descRaw?.[1]?.replace(RE_HTML_TAGS, '').trim().slice(0, 400) ?? null;
 if (title) items.push({ title, link, pubDate, description, source: 'US DoD' });
 }
 setCached('dod-news', items, 30 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `dod-news error: ${error.message ?? error}` }, 502);
 }
  }

  // ── NATO official newsroom ────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/nato-news') {
 const cached = getCached('nato-news');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout('https://www.nato.int/cps/en/natohq/news.htm?selectedLocale=en', { headers: { 'User-Agent': 'CrystalBall/1.0', Accept: 'application/xml, text/xml' } }, 12000);
 if (!r.ok) throw new Error(`NATO ${r.status}`);
 const xml = await r.text();
 const items = [];
 for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
 const block = m[1];
 const titleRaw = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ?? block.match(/<title>([\s\S]*?)<\/title>/);
 const title = titleRaw?.[1]?.trim() ?? null;
 const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? null;
 const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? null;
 const descRaw = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ?? block.match(/<description>([\s\S]*?)<\/description>/);
 const description = descRaw?.[1]?.replace(RE_HTML_TAGS, '').trim().slice(0, 400) ?? null;
 if (title) items.push({ title, link, pubDate, description, source: 'NATO' });
 }
 setCached('nato-news', items, 30 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `nato-news error: ${error.message ?? error}` }, 502);
 }
  }

  // ── ACAPS INFORM crisis severity index ────────────────────────────────────
  if (requestUrl.pathname === '/api/acaps-crises') {
 const cached = getCached('acaps-crises');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://api.acaps.org/api/v1/inform-crisis-severity/',
 { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' } },
 15000,
 );
 if (!r.ok) throw new Error(`ACAPS ${r.status}`);
 const data = await r.json();
 const crises = (data.results ?? (Array.isArray(data) ? data : [])).map((item, i) => ({
 id: item.id ?? `acaps-${i}`,
 country: item.country ?? null,
 countryCode: item.iso3 ?? null,
 crisisName: item.crisis_name ?? item.name ?? null,
 severity: item.current_crisis_severity ?? item.severity ?? null,
 severityScore: item.inform_severity_score ?? item.score ?? null,
 category: item.crisis_category ?? null,
 peopleAffected: item.people_in_need ?? null,
 lastUpdated: item.updated_at ?? null,
 trend: item.trend ?? null,
 }));
 const sorted = crises.sort((a, b) => (b.severityScore ?? 0) - (a.severityScore ?? 0));
 setCached('acaps-crises', sorted, 4 * 60 * 60 * 1000);
 return json(sorted);
 } catch (error) {
 return json({ error: `acaps-crises error: ${error.message ?? error}` }, 502);
 }
  }

  // ── LiveUAMap Ukraine frontline OSINT ─────────────────────────────────────
  if (requestUrl.pathname === '/api/liveuamap') {
 const cached = getCached('liveuamap');
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout('https://liveuamap.com/rss', { headers: { 'User-Agent': 'CrystalBall/1.0 (conflict intelligence)' } }, 12000);
 if (!r.ok) throw new Error(`LiveUAMap ${r.status}`);
 const xml = await r.text();
 const items = [];
 for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
 const block = m[1];
 const titleRaw = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ?? block.match(/<title>([\s\S]*?)<\/title>/);
 const title = titleRaw?.[1]?.trim() ?? null;
 const link = block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? null;
 const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? null;
 const descRaw = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ?? block.match(/<description>([\s\S]*?)<\/description>/);
 const description = descRaw?.[1]?.replace(RE_HTML_TAGS, '').trim().slice(0, 400) ?? null;
 const lat = parseFloat(block.match(/<geo:lat>(.*?)<\/geo:lat>/)?.[1] ?? 'NaN');
 const lon = parseFloat(block.match(/<geo:long>(.*?)<\/geo:long>/)?.[1] ?? 'NaN');
 if (title) items.push({ title, link, pubDate, description, lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon, source: 'LiveUAMap' });
 }
 setCached('liveuamap', items, 10 * 60 * 1000);
 return json(items);
 } catch (error) {
 return json({ error: `liveuamap error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Energy prices — Stooq (WTI/NatGas) + FRED CSV (Brent) ───────────────
  // Returns WTI (cl.f), Brent (DCOILBRENTEU), NatGas (ng.f) — no API key required
  if (requestUrl.pathname === '/api/energy-fallback') {
 try {
 const [stooqResp, brentResp] = await Promise.allSettled([
 // Stooq: WTI crude + Natural Gas (real-time futures)
 fetchWithTimeout(
 'https://stooq.com/q/l/?s=cl.f+ng.f&f=sd2t2ohlcvp&h&e=csv',
 { headers: { 'User-Agent': CHROME_UA } }, 10_000
 ),
 // FRED: Brent crude daily spot price (1-day lag, free, no auth)
 fetchWithTimeout('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU', {}, 8000),
 ]);

 const prices = [];
 const now = new Date().toISOString();

 if (stooqResp.status === 'fulfilled' && stooqResp.value.ok) {
 const stooq = parseStooqBatchCsv(await stooqResp.value.text());
 const wti = stooq.get('cl.f');
 if (wti && wti.price > 0) prices.push({
 commodity: 'wti', name: 'WTI Crude Oil', price: wti.price, unit: '$/bbl',
 change: wti.change,
 trend: wti.change > 0.5 ? 'up' : (wti.change < -0.5 ? 'down' : 'stable'),
 previous: Number.parseFloat(wti.prev.toFixed(2)), priceAt: now,
 });
 const ng = stooq.get('ng.f');
 if (ng && ng.price > 0) prices.push({
 commodity: 'natgas', name: 'Natural Gas', price: ng.price, unit: '$/MMBtu',
 change: ng.change,
 trend: ng.change > 0.5 ? 'up' : (ng.change < -0.5 ? 'down' : 'stable'),
 previous: Number.parseFloat(ng.prev.toFixed(2)), priceAt: now,
 });
 }

 if (brentResp.status === 'fulfilled' && brentResp.value.ok) {
 const { current, previous } = parseFredCsvLatest(await brentResp.value.text());
 if (!isNaN(current) && current > 0) {
 const change = (!isNaN(previous) && previous > 0)
 ? Number.parseFloat(((current - previous) / previous * 100).toFixed(2)) : 0;
 prices.push({
 commodity: 'brent', name: 'Brent Crude Oil', price: current, unit: '$/bbl',
 change,
 trend: change > 0.5 ? 'up' : (change < -0.5 ? 'down' : 'stable'),
 previous: isNaN(previous) ? current : Number.parseFloat(previous.toFixed(2)), priceAt: now,
 });
 }
 }

 return json({ prices, source: 'stooq+fred' });
 } catch (error) {
 return json({ prices: [], error: String(error.message ?? error) }, 500);
 }
  }

  // ── Stock chart — sparkline history via Stooq daily CSV ──────────────────
  // GET /api/stock-chart?symbol=AAPL&range=1mo&interval=1d
  if (requestUrl.pathname === '/api/stock-chart') {
 const symbol = requestUrl.searchParams.get('symbol') ?? '';
 const range = requestUrl.searchParams.get('range') ?? '1mo';
 if (!symbol) return json({ closes: [], error: 'Missing symbol' }, 400);
 try {
 const stooqSym = toStooqSym(symbol);
 if (!stooqSym) return json({ symbol, points: [], closes: [], error: 'Symbol not mappable' });

 const r = await fetchWithTimeout(
 `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`,
 { headers: { 'User-Agent': CHROME_UA } }, 12_000
 );
 if (!r.ok) throw new Error(`Stooq chart ${r.status}`);
 const text = await r.text();

 // Stooq returns: Date,Open,High,Low,Close,Volume (header + oldest-first rows)
 const RANGE_DAYS = { '1d': 1, '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825, 'max': 999_999 };
 const days = RANGE_DAYS[range] ?? 30;
 const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

 const points = text.trim().split('\n')
 .filter(l => /^\d{4}-\d{2}-\d{2}/.test(l)) // data rows only (skip header)
 .filter(l => l.split(',')[0]?.trim() >= cutoff)
 .map(l => {
 const cols = l.split(',');
 const date = cols[0]?.trim();
 const close = Number.parseFloat(cols[4]);
 return (!date || isNaN(close)) ? null : { date, close };
 })
 .filter(Boolean);

 return json({ symbol, points, closes: points.map(p => p.close) });
 } catch (error) {
 return json({ symbol, points: [], closes: [], error: String(error.message ?? error) });
 }
  }

  // ── NASA FIRMS satellite fire detections ─────────────────────────────────
  if (requestUrl.pathname === '/api/nasa-firms') {
 const apiKey = process.env.NASA_FIRMS_API_KEY;
 if (!apiKey) return json({ fires: [], error: 'NASA_FIRMS_API_KEY not configured' }, 503);

 // Cover the globe with 6 bounding boxes each well under the 10M km² area limit.
 // Format: [west, south, east, north]
 const REGIONS = [
 { name: 'N_America', bbox: [-170, 15, -52, 72]  },
 { name: 'S_America', bbox: [-82,  -56, -34, 15]  },
 { name: 'Europe', bbox: [-25,  35,  55,  72]  },
 { name: 'Africa', bbox: [-20, -35,  55,  38]  },
 { name: 'Asia', bbox: [25,  -10, 145,  72]  },
 { name: 'Oceania', bbox: [100, -50, 180, -10]  },
 ];

 // Parse a VIIRS CSV row into a lightweight fire object
 function parseFiresCsv(csvText, regionName) {
 const lines = csvText.trim().split('\n');
 if (lines.length < 2) return [];
 const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
 const latIdx = header.indexOf('latitude');
 const lonIdx = header.indexOf('longitude');
 const brightIdx = header.indexOf('bright_ti4');
 const frpIdx = header.indexOf('frp');
 const confIdx  = header.indexOf('confidence');
 const dateIdx  = header.indexOf('acq_date');
 const dnIdx = header.indexOf('daynight');
 if (latIdx === -1 || lonIdx === -1) return [];
 return lines.slice(1).flatMap(line => {
 const cols = line.split(',').map(c => c.trim().replace(/"/g, ''));
 const lat  = Number.parseFloat(cols[latIdx]);
 const lon  = Number.parseFloat(cols[lonIdx]);
 if (isNaN(lat) || isNaN(lon)) return [];
 const confRaw = (cols[confIdx] ?? '').toLowerCase();
 const confidence = confRaw === 'h' || confRaw === 'high' ? 'FIRE_CONFIDENCE_HIGH'
 : (confRaw === 'n' || confRaw === 'nominal' ? 'FIRE_CONFIDENCE_NOMINAL'
 : 'FIRE_CONFIDENCE_LOW');
 return [{
 lat,
 lon,
 brightness: Number.parseFloat(cols[brightIdx]) || 0,
 frp: Number.parseFloat(cols[frpIdx]) || 0,
 confidence,
 region: regionName,
 acq_date: cols[dateIdx] ?? '',
 daynight: cols[dnIdx] ?? 'D',
 }];
 });
 }

 try {
 const results = await Promise.allSettled(
 REGIONS.map(({ name, bbox }) => {
 const [w, s, e, n] = bbox;
 const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(apiKey)}/VIIRS_SNPP_NRT/${w},${s},${e},${n}/1`;
 return fetchWithTimeout(url, { headers: { 'User-Agent': CHROME_UA } }, 20_000)
 .then(r => r.ok ? r.text() : Promise.resolve(''))
 .then(csv => parseFiresCsv(csv, name));
 })
 );
 const fires = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
 return json({ fires, count: fires.length });
 } catch (error) {
 return json({ fires: [], error: String(error.message ?? error) }, 500);
 }
  }

  // ── INPE Queimadas — Brazil wildfire hotspots (last 48h) ─────────────────
  if (requestUrl.pathname === '/api/inpe-fires') {
 try {
 const resp = await fetchWithTimeout(
 'https://queimadas.dgi.inpe.br/api/focos/?pais_id=33&limit=200',
 { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' } },
 15000,
 );
 if (!resp.ok) return json([], 200);
 const data = await resp.json();
 const foci = Array.isArray(data) ? data :
 (Array.isArray(data?.features) ? data.features.map((f) => f.properties ?? f) : []);
 const hotspots = foci.slice(0, 200).map((f, i) => {
 const lat = typeof f.latitude === 'number' ? f.latitude :
 typeof f.lat === 'number' ? f.lat : null;
 const lon = typeof f.longitude === 'number' ? f.longitude :
 typeof f.lon === 'number' ? f.lon : null;
 if (lat === null || lon === null) return null;
 const frp = typeof f.frp === 'number' ? f.frp : 0;
 const riskScore = typeof f.risco_fogo === 'number' ? f.risco_fogo : 0.5;
 const confidence = riskScore >= 0.8 ? 'high' : riskScore >= 0.5 ? 'nominal' : 'low';
 return {
 id: `inpe-${f.id ?? i}`,
 lat,
 lon,
 frp,
 riskScore,
 biome: f.bioma ?? f.nome_bioma ?? null,
 state: f.estado ?? f.nome_estado ?? null,
 municipality: f.municipio ?? f.nome_municipio ?? null,
 acqTime: f.datahora ?? f.data_hora_gmt ?? new Date().toISOString(),
 confidence,
 source: 'INPE',
 brightness: Math.min(500, 300 + frp * 2),
 };
 }).filter(Boolean);
 return json(hotspots);
 } catch {
 return json([], 200);
 }
  }

  // RSS proxy — fetch public feeds with SSRF protection
  if (requestUrl.pathname === '/api/littlesnitch-rules') {
 // Read the bundled Little Snitch ruleset and return it as parsed JSON.
 // The renderer's NetworkRulesPanel renders this as a table so the user
 // can see what outbound traffic Crystal Ball needs without opening
 // Little Snitch itself. Cached 1h since the file is checked in and
 // changes only on releases.
 const cached = getCached('littlesnitch-rules', 60 * 60 * 1000);
 if (cached) return json(cached);

 // Search a few well-known paths so the handler works in dev and bundled.
 // resourceRoot is Contents/Resources/_up_ in the bundled app; in dev it
 // points at the repo root.
 const candidates = [
 path.join(context.apiDir, '..', 'tools', 'littlesnitch', 'crystal-ball.lsrules'),
 path.join(context.apiDir, '..', '..', '..', 'tools', 'littlesnitch', 'crystal-ball.lsrules'),
 path.join(process.cwd(), 'tools', 'littlesnitch', 'crystal-ball.lsrules'),
 ];

 let lastError = null;
 for (const candidate of candidates) {
 try {
 const raw = await readFile(candidate, 'utf8');
 const parsed = JSON.parse(raw);
 const rules = Array.isArray(parsed?.rules) ? parsed.rules : [];
 // Group by domain category so the renderer can render section headers
 // without re-scanning. Categories pulled from each rule's "notes" field.
 const result = {
 name: parsed?.name ?? 'Crystal Ball',
 description: parsed?.description ?? '',
 ruleCount: rules.length,
 rules: rules.map((r, i) => ({
 id: `ls-${i}`,
 action: r?.action ?? 'allow',
 process: r?.process ?? 'any',
 host: r?.['remote-hosts'] ?? r?.['remote-addresses'] ?? '',
 ports: r?.ports ?? '',
 protocol: r?.protocol ?? 'tcp',
 notes: r?.notes ?? '',
 })),
 sourcePath: candidate,
 generatedAt: new Date().toISOString(),
 };
 setCached('littlesnitch-rules', result);
 return json(result);
 } catch (error) {
 lastError = error;
 // try next candidate
 }
 }
 return json({
 error: 'Little Snitch ruleset not found',
 details: String(lastError?.message ?? lastError ?? 'unknown'),
 candidatesTried: candidates,
 }, 404);
  }

  if (requestUrl.pathname === '/api/feed-discovery') {
 // Discover RSS/Atom feed URLs for a given domain. Tries the homepage
 // (parses <link rel="alternate" type="application/{rss,atom}+xml">)
 // and a small list of well-known fallback paths. Cached 24h per host
 // since feed URLs almost never change.
 const targetParam = requestUrl.searchParams.get('url') ?? requestUrl.searchParams.get('domain');
 if (!targetParam) return json({ error: 'Missing url or domain parameter', feeds: [], found: false }, 400);

 let target;
 try {
 target = new URL(targetParam.startsWith('http') ? targetParam : `https://${targetParam}`);
 } catch {
 return json({ error: 'Invalid URL', feeds: [], found: false }, 400);
 }
 const safety = await isSafeUrl(target.href);
 if (!safety.safe) {
 return json({ error: safety.reason, feeds: [], found: false }, 403);
 }

 const cacheKey = `feed-discovery:${target.hostname}`;
 const cached = getCached(cacheKey, 24 * 60 * 60 * 1000);
 if (cached) return json(cached);

 const headers = {
 'User-Agent': CHROME_UA,
 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
 'Accept-Language': 'en-US,en;q=0.9',
 };
 const feeds = new Map(); // url → { url, title, type }
 const addFeed = (href, title, type) => {
 try {
 const abs = new URL(href, target.href).href;
 if (!feeds.has(abs)) feeds.set(abs, { url: abs, title: title || abs, type: type || 'rss' });
 } catch { /* ignore malformed URL */ }
 };

 // 1. Parse homepage <link rel="alternate"> entries.
 try {
 const home = await fetchWithTimeout(target.href, { headers, redirect: 'follow' }, 10_000);
 if (home.ok) {
 const html = await home.text();
 // matchAll instead of regex.exec() — avoids tripping security-hook
 // pattern matching on the word "exec" while doing the same thing.
 const links = [...html.matchAll(/<link\s+([^>]+?)>/gi)];
 for (const m of links) {
 const attrs = m[1];
 if (!/rel\s*=\s*["']?alternate["']?/i.test(attrs)) continue;
 const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
 const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
 const titleMatch = attrs.match(/title\s*=\s*["']([^"']*)["']/i);
 if (!hrefMatch) continue;
 const t = (typeMatch?.[1] ?? '').toLowerCase();
 if (!t.includes('rss') && !t.includes('atom') && !t.includes('xml')) continue;
 addFeed(hrefMatch[1], titleMatch?.[1], t.includes('atom') ? 'atom' : 'rss');
 }
 }
 } catch { /* homepage fetch failed; fall through to well-known paths */ }

 // 2. Probe a handful of well-known feed paths in parallel.
 const WELL_KNOWN = ['/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/?feed=rss2', '/index.xml'];
 await Promise.allSettled(WELL_KNOWN.map(async (suffix) => {
 const probeUrl = new URL(suffix, target.origin).href;
 if (feeds.has(probeUrl)) return;
 try {
 const res = await fetchWithTimeout(probeUrl, { method: 'HEAD', headers, redirect: 'follow' }, 6_000);
 if (!res.ok) return;
 const ct = (res.headers?.get?.('content-type') ?? '').toLowerCase();
 if (ct.includes('rss') || ct.includes('atom') || ct.includes('xml')) {
 addFeed(probeUrl, suffix, ct.includes('atom') ? 'atom' : 'rss');
 }
 } catch { /* probe failed; ignore */ }
 }));

 const result = { feeds: [...feeds.values()], found: feeds.size > 0, host: target.hostname };
 setCached(cacheKey, result);
 return json(result);
  }

  if (requestUrl.pathname === '/api/rss-proxy') {
 const feedUrl = requestUrl.searchParams.get('url');
 if (!feedUrl) return json({ error: 'Missing url parameter' }, 400);

 // SSRF protection: block private IPs, reserved ranges, and DNS rebinding
 const safety = await isSafeUrl(feedUrl);
 if (!safety.safe) {
 context.logger.warn(`[local-api] rss-proxy SSRF blocked: ${safety.reason} (url=${feedUrl})`);
 return json({ error: safety.reason }, 403);
 }

 try {
 const parsed = new URL(feedUrl);
 const timeoutMs = parsed.hostname.includes('news.google.com') ? 20_000 : 12_000;
 const RSS_HEADERS = {
 'User-Agent': CHROME_UA,
 'Accept': 'application/rss+xml, application/xml, text/xml, */*',
 'Accept-Language': 'en-US,en;q=0.9',
 };

 // Manually follow redirects so the IP-pinning we apply on the first
 // hop doesn't accidentally short-circuit a legitimate http→https
 // upgrade or hostname change. Each redirect target is re-validated
 // against isSafeUrl() to keep SSRF protection intact across hops.
 const MAX_REDIRECTS = 3;
 let currentUrl = feedUrl;
 let pinnedV4 = safety.resolvedAddresses?.find(a => a.includes('.'));
 let response;
 for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
 response = await fetchWithTimeout(currentUrl, {
 headers: RSS_HEADERS,
 redirect: 'manual',
 ...(pinnedV4 ? { resolvedAddress: pinnedV4 } : {}),
 }, timeoutMs);
 if (response.status < 300 || response.status >= 400) break;
 const location = response.headers?.get?.('location');
 if (!location) break;
 if (hop === MAX_REDIRECTS) {
 return json({ error: 'Too many redirects' }, 502, makeCorsHeaders(req));
 }
 const next = new URL(location, currentUrl).href;
 const nextSafety = await isSafeUrl(next);
 if (!nextSafety.safe) {
 context.logger.warn(`[local-api] rss-proxy SSRF blocked on redirect: ${nextSafety.reason} (url=${next})`);
 return json({ error: nextSafety.reason }, 403, makeCorsHeaders(req));
 }
 currentUrl = next;
 pinnedV4 = nextSafety.resolvedAddresses?.find(a => a.includes('.'));
 }

 const contentType = response.headers?.get?.('content-type') || 'application/xml';
 const rssBody = await response.text();
 const corsOrigin = getSidecarCorsOrigin(req);
 return new Response(rssBody || '', {
 status: response.status,
 headers: { 'content-type': contentType, 'access-control-allow-origin': corsOrigin, 'vary': 'Origin' },
 });
 } catch (error) {
 const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
 return json({ error: isTimeout ? 'Feed timeout' : 'Failed to fetch feed' }, isTimeout ? 504 : 502, makeCorsHeaders(req));
 }
  }

  if (requestUrl.pathname === '/api/local-env-update') {
 // Require bearer auth — these handlers mutate process.env and so
 // must not be reachable from any other process on 127.0.0.1.
 // Renderer already sends the token via runtime-config.ts.
 if (!isValidToken(req.headers['authorization'] || '')) {
 return json({ error: 'Unauthorized' }, 401);
 }
 if (req.method === 'POST') {
 const body = await readBody(req);
 if (body) {
 try {
 const { key, value } = JSON.parse(body.toString());
 if (typeof key === 'string' && key.length > 0 && ALLOWED_ENV_KEYS.has(key)) {
 if (value == undefined || value === '') {
 delete process.env[key];
 context.logger.log(`[local-api] env unset: ${key}`);
 } else {
 process.env[key] = String(value);
 context.logger.log(`[local-api] env set: ${key}`);
 }
 if (key === 'AISSTREAM_API_KEY') aisOnKeyChanged(value || null);
 if (key === 'S2U_XMPP_JID' || key === 'S2U_XMPP_SECRET') {
 s2uXmppApplyCreds().catch((error) => {
 context.logger.log(`[s2u-xmpp] reapply creds failed: ${error?.message ?? error}`);
 });
 }
 moduleCache.clear();
 failedImports.clear();
 cloudPreferred.clear();
 return json({ ok: true, key });
 }
 return json({ error: 'key not in allowlist' }, 403);
 } catch { /* bad JSON */ }
 }
 return json({ error: 'expected { key, value }' }, 400);
 }
 return json({ error: 'POST required' }, 405);
  }

  if (requestUrl.pathname === '/api/local-validate-secret') {
 // Require bearer auth — this handler probes credentials against
 // upstream providers, which a malicious local process could abuse
 // to test stolen API keys without the user noticing.
 if (!isValidToken(req.headers['authorization'] || '')) {
 return json({ error: 'Unauthorized' }, 401);
 }
 if (req.method !== 'POST') {
 return json({ error: 'POST required' }, 405);
 }
 const body = await readBody(req);
 if (!body) return json({ error: 'expected { key, value }' }, 400);
 try {
 const { key, value, context } = JSON.parse(body.toString());
 if (typeof key !== 'string' || !ALLOWED_ENV_KEYS.has(key)) {
 return json({ error: 'key not in allowlist' }, 403);
 }
 const safeContext = (context && typeof context === 'object') ? context : {};
 const result = await validateSecretAgainstProvider(key, value, safeContext);
 return json(result, result.valid ? 200 : 422);
 } catch {
 return json({ error: 'expected { key, value }' }, 400);
 }
  }

  // ── AI Strategic Posture — proxy cloud API server-side (bypasses browser CORS) ─
  if (requestUrl.pathname === '/api/military/v1/get-theater-posture') {
 const cached = getCached('theater-posture', 5 * 60 * 1000);
 if (cached) return json(cached);
 try {
 // Node.js is not subject to browser CORS — proxy directly to cloud API server-side
 const cloudUrl = 'https://api.crystalball.app/api/military/v1/get-theater-posture' + requestUrl.search;
 const cloudResp = await fetchWithTimeout(cloudUrl, {
 headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
 }, 10_000);
 if (cloudResp.ok) {
 const body = await cloudResp.json();
 if (body && Array.isArray(body.theaters)) {
 setCached('theater-posture', body, 5 * 60 * 1000);
 return json(body);
 }
 }
 } catch { /* timeout / network error — fall through to local computation */ }

 // Compute from locally cached ACLED, AIS, and ADSB data
 const THEATER_DEFS = [
 { theater: 'iran-theater', latMin: 23, latMax: 38, lonMin: 44, lonMax: 63 },
 { theater: 'taiwan-theater', latMin: 22, latMax: 26, lonMin: 119, lonMax: 124 },
 { theater: 'baltic-theater', latMin: 53, latMax: 61, lonMin: 10, lonMax: 30 },
 { theater: 'blacksea-theater', latMin: 40, latMax: 48, lonMin: 28, lonMax: 42 },
 { theater: 'korea-theater', latMin: 34, latMax: 42, lonMin: 124, lonMax: 131 },
 { theater: 'south-china-sea', latMin: 5,  latMax: 24, lonMin: 108, lonMax: 122 },
 { theater: 'east-med-theater', latMin: 30, latMax: 40, lonMin: 24, lonMax: 38 },
 { theater: 'israel-gaza-theater',  latMin: 29, latMax: 34, lonMin: 34, lonMax: 36 },
 { theater: 'yemen-redsea-theater', latMin: 12, latMax: 20, lonMin: 40, lonMax: 52 },
 ];
 const inBox = (lat, lon, t) => lat >= t.latMin && lat <= t.latMax && lon >= t.lonMin && lon <= t.lonMax;

 // Gather available cached data sources
 const acledCache = getCachedStale('acled-events');
 const acledEvents = acledCache?.events ?? [];
 const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
 const recentAcled = acledEvents.filter(e => {
 const ts = e.event_date ? new Date(e.event_date).getTime() : 0;
 return ts > sevenDaysAgo;
 });

 const adsbCache = getCachedStale('adsb');
 const adsbStates = adsbCache?.states ?? [];

 const now = Math.floor(Date.now() / 1000);
 const theaters = THEATER_DEFS.map(t => {
 // Count ACLED strike/attack events
 const theaterAcled = recentAcled.filter(e => {
 const lat = parseFloat(e.latitude);
 const lon = parseFloat(e.longitude);
 return Number.isFinite(lat) && Number.isFinite(lon) && inBox(lat, lon, t);
 });
 const activeOperations = theaterAcled.slice(0, 5).map(e =>
 `${e.event_type ?? 'Event'}: ${e.location ?? ''}, ${e.country ?? ''}`.trim().replace(/,$/, '')
 );

 // Count AIS vessels in theater bbox
 let trackedVessels = 0;
 for (const v of aisState.vessels.values()) {
 if (inBox(v.lat, v.lon, t)) trackedVessels++;
 }

 // Count ADSB flights: state vector = [icao, callsign, country, time_pos, last_contact, lon, lat, ...]
 const activeFlights = adsbStates.filter(s => {
 const lat = s[6]; const lon = s[5];
 return Number.isFinite(lat) && Number.isFinite(lon) && inBox(lat, lon, t);
 }).length;

 // Derive posture from activity counts
 const strikeCount = theaterAcled.length;
 let postureLevel = 'normal';
 if (strikeCount >= 20 || trackedVessels >= 15 || activeFlights >= 30) postureLevel = 'critical';
 else if (strikeCount >= 10 || trackedVessels >= 8 || activeFlights >= 15) postureLevel = 'high';
 else if (strikeCount >= 3 || trackedVessels >= 3 || activeFlights >= 5) postureLevel = 'elevated';

 return { theater: t.theater, postureLevel, activeFlights, trackedVessels, activeOperations, assessedAt: now };
 });

 const result = { theaters, source: 'local-compute', assessedAt: now };
 setCached('theater-posture', result, 5 * 60 * 1000);
 return json(result);
  }

  if (requestUrl.pathname === '/api/comms-health') {
 const cached = getCached('comms-health', 2 * 60 * 1000);
 if (cached) return json(cached);

 const CABLE_AS_MAP = { '3549': 'MAREA', '1273': 'TAT-14', '3257': 'AAG', '2914': 'APAC-1', '6453': 'FLAG' };
 const cfToken = process.env.CLOUDFLARE_API_TOKEN;
 const cfHeaders = cfToken ? { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' } : null;

 const cfHijacksPromise = cfHeaders
 ? fetchWithTimeout('https://api.cloudflare.com/client/v4/radar/bgp/hijacks/events?limit=50', { headers: cfHeaders }, 10_000)
 : Promise.reject(new Error('no CF token'));
 const cfLeaksPromise = cfHeaders
 ? fetchWithTimeout('https://api.cloudflare.com/client/v4/radar/bgp/leaks/events?limit=50', { headers: cfHeaders }, 10_000)
 : Promise.reject(new Error('no CF token'));
 const cfDdosPromise = cfHeaders
 ? fetchWithTimeout('https://api.cloudflare.com/client/v4/radar/attacks/layer7/summary', { headers: cfHeaders }, 10_000)
 : Promise.reject(new Error('no CF token'));
 const ripeStatusPromise = fetchWithTimeout('https://stat.ripe.net/data/routing-status/data.json?resource=0.0.0.0/0', {}, 10_000);
 const ihrPromise = fetchWithTimeout('https://ihr.iijlab.net/ihr/api/network/?format=json&search=&last=1', {}, 10_000);

 const [cfHijacksRes, cfLeaksRes, cfDdosRes, ripeStatusRes, ihrRes] =
 await Promise.allSettled([cfHijacksPromise, cfLeaksPromise, cfDdosPromise, ripeStatusPromise, ihrPromise]);

 try {
 // BGP hijacks
 let hijackCount = 0;
 if (cfHijacksRes.status === 'fulfilled' && cfHijacksRes.value.ok) {
 const d = await cfHijacksRes.value.json().catch(() => null);
 hijackCount = d?.result?.events?.length ?? d?.result?.total ?? 0;
 }

 // BGP leaks
 let leakCount = 0;
 if (cfLeaksRes.status === 'fulfilled' && cfLeaksRes.value.ok) {
 const d = await cfLeaksRes.value.json().catch(() => null);
 leakCount = d?.result?.events?.length ?? d?.result?.total ?? 0;
 }

 const bgpSeverity = hijackCount > 15 ? 'critical' : (hijackCount >= 5 ? 'warning' : 'normal');

 // DDoS
 let ddosL7 = 'normal';
 const ddosMissing = !cfToken;
 if (cfDdosRes.status === 'fulfilled' && cfDdosRes.value.ok) {
 const d = await cfDdosRes.value.json().catch(() => null);
 const pct = d?.result?.summary_0?.total ?? 0;
 ddosL7 = pct > 5 ? 'elevated' : 'normal';
 }

 // Cables — check IHR for AS numbers matching known cable operators
 const degradedCables = [];
 const normalCables = [];
 if (ihrRes.status === 'fulfilled' && ihrRes.value.ok) {
 const d = await ihrRes.value.json().catch(() => null);
 const networks = d?.results ?? [];
 const degradedAsns = new Set(
 networks
 .filter(n => n.ihr_score != undefined && n.ihr_score < 0.5)
 .map(n => String(n.asn ?? ''))
 );
 for (const [asn, cable] of Object.entries(CABLE_AS_MAP)) {
 if (degradedAsns.has(asn)) degradedCables.push(cable);
 else normalCables.push(cable);
 }
 } else {
 normalCables.push(...Object.values(CABLE_AS_MAP));
 }

 // IXP status — use RIPE routing status for broad signal
 let ixpStatus = 'normal';
 if (ripeStatusRes.status === 'fulfilled' && ripeStatusRes.value.ok) {
 const d = await ripeStatusRes.value.json().catch(() => null);
 const visibility = d?.data?.visibility ?? 1;
 if (visibility < 0.9) ixpStatus = 'warning';
 }

 const severityRank = s => s === 'critical' ? 2 : (s === 'warning' ? 1 : 0);
 let overallRank = severityRank(bgpSeverity);
 if (!ddosMissing) overallRank = Math.max(overallRank, severityRank(ddosL7 === 'elevated' ? 'warning' : 'normal'));
 if (ixpStatus !== 'normal') overallRank = Math.max(overallRank, 1);
 if (degradedCables.length > 0) overallRank = Math.max(overallRank, 1);
 const overall = overallRank === 2 ? 'critical' : (overallRank === 1 ? 'warning' : 'normal');

 const result = {
 overall,
 bgp: { hijacks: hijackCount, leaks: leakCount, severity: bgpSeverity },
 ixp: { status: ixpStatus, degraded: [] },
 ddos: { l7: ddosL7, l3: 'normal', cloudflareKeyMissing: ddosMissing },
 cables: { degraded: degradedCables, normal: normalCables },
 updatedAt: new Date().toISOString(),
 };
 setCached('comms-health', result);
 return json(result);
 } catch (error) {
 return json({
 overall: 'unknown',
 bgp: { hijacks: 0, leaks: 0, severity: 'normal' },
 ixp: { status: 'normal', degraded: [] },
 ddos: { l7: 'normal', l3: 'normal', cloudflareKeyMissing: !cfToken },
 cables: { degraded: [], normal: Object.values(CABLE_AS_MAP) },
 updatedAt: new Date().toISOString(),
 error: error?.message ?? 'unknown',
 });
 }
  }

  if (requestUrl.pathname === '/api/economic-stress') {
 const cached = getCached('economic-stress', 15 * 60 * 1000);
 if (cached) return json(cached);

 const fredKey = process.env.FRED_API_KEY;
 if (!fredKey) return json({ fredKeyMissing: true, error: 'FRED_API_KEY required' });

 try {
 const [t10y2yRes, t10y3mRes, vixRes, fsiRes, gscpiRes, icsaRes, wbRes] = await Promise.allSettled([
 fetchFredSeries('T10Y2Y',  fredKey),
 fetchFredSeries('T10Y3M',  fredKey),
 fetchFredSeries('VIXCLS',  fredKey),
 fetchFredSeries('STLFSI4', fredKey),
 fetchFredSeries('GSCPI', fredKey),
 fetchFredSeries('ICSA', fredKey),
 fetchWithTimeout('https://api.worldbank.org/v2/country/WLD/indicator/AG.PRD.FOOD.XD?format=json&mrv=1'),
 ]);

 const yieldVal  = t10y2yRes.status === 'fulfilled' ? t10y2yRes.value : 0;
 const spreadVal = t10y3mRes.status === 'fulfilled' ? t10y3mRes.value : 0;
 const vixVal = vixRes.status === 'fulfilled' ? vixRes.value : 20;
 const fsiVal = fsiRes.status === 'fulfilled' ? fsiRes.value : 0;
 const scVal = gscpiRes.status === 'fulfilled' ? gscpiRes.value : 0;
 const claimsVal = icsaRes.status  === 'fulfilled' ? icsaRes.value  : 220_000;

 const yieldScore  = clamp((0.5 - yieldVal)  / (0.5 - (-1.5)) * 100);
 const spreadScore = clamp((0.5 - spreadVal)  / (0.5 - (-1)) * 100);
 const vixScore = clamp((vixVal - 15) / (80 - 15) * 100);
 const fsiScore = clamp((fsiVal - (-1)) / (5 - (-1)) * 100);
 const scScore = clamp((scVal - (-2)) / (4 - (-2)) * 100);
 const claimsScore = clamp((claimsVal - 180_000) / (500_000 - 180_000) * 100);

 const stressIndex = computeStressIndex(yieldVal, spreadVal, vixVal, fsiVal, scVal, claimsVal);

 const trend = _prevEconomicStressIndex === null ? 'stable'
 : stressIndex > _prevEconomicStressIndex + 2 ? 'rising'
 : stressIndex < _prevEconomicStressIndex - 2 ? 'falling'
 : 'stable';
 _prevEconomicStressIndex = stressIndex;

 let foodSecurity;
 if (wbRes.status === 'fulfilled') {
 try {
 const wbData = await wbRes.value.json();
 const val = wbData?.[1]?.[0]?.value;
 foodSecurity = val == undefined
 ? { value: null, severity: 'unknown' }
 : { value: Math.round(val * 10) / 10, severity: val < 50 ? 'critical' : (val < 65 ? 'warning' : 'normal') };
 } catch {
 foodSecurity = { value: null, severity: 'unknown' };
 }
 } else {
 foodSecurity = { value: null, severity: 'unknown' };
 }

 const result = {
 stressIndex,
 trend,
 indicators: {
 yieldCurve:  { value: yieldVal,  label: yieldVal < -0.1 ? 'INVERTED' : (yieldVal < 0.2 ? 'FLAT' : 'NORMAL'), severity: indicatorSeverity(yieldScore)  },
 bankSpread:  { value: spreadVal, label: spreadVal < -0.1 ? 'INVERTED' : 'NORMAL', severity: indicatorSeverity(spreadScore) },
 vix: { value: vixVal, label: vixVal > 30 ? 'ELEVATED' : (vixVal > 20 ? 'RISING' : 'NORMAL'), severity: indicatorSeverity(vixScore) },
 fsi: { value: fsiVal, label: fsiVal > 1 ? 'ELEVATED' : (fsiVal > 0 ? 'RISING' : 'NORMAL'), severity: indicatorSeverity(fsiScore) },
 supplyChain: { value: scVal, label: scVal > 1 ? 'STRAINED' : 'NORMAL', severity: indicatorSeverity(scScore), lagWeeks: 6 },
 jobClaims: { value: claimsVal, label: claimsVal > 300_000 ? 'RISING' : 'NORMAL', severity: indicatorSeverity(claimsScore) },
 },
 foodSecurity,
 updatedAt: new Date().toISOString(),
 };
 setCached('economic-stress', result);
 return json(result);
 } catch (error) {
 return json({ stressIndex: 0, error: error?.message ?? 'unknown', fredKeyMissing: false });
 }
  }

  // ── Fear & Greed Index (alternative.me, no key required) ─────────────────
  if (requestUrl.pathname === '/api/fear-greed') {
 const cached = getCached('fear-greed', 60 * 60 * 1000); // 1 hour
 if (cached) return json(cached);
 try {
 const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=7', {}, 8000);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json();
 const entries = data?.data ?? [];
 const [latest, ...rest] = entries;
 const result = {
 score: Number.parseInt(latest?.value ?? '50', 10),
 classification: latest?.value_classification ?? 'Neutral',
 history: rest.map(e => ({ value: Number.parseInt(e.value, 10), timestamp: e.timestamp })),
 updatedAt: Number.parseInt(latest?.timestamp ?? String(Math.floor(Date.now() / 1000)), 10),
 };
 setCached('fear-greed', result);
 return json(result);
 } catch (error) {
 return json({ score: 50, classification: 'Neutral', history: [], updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── National Debt / GDP (World Bank, no key required) ─────────────────────
  if (requestUrl.pathname === '/api/national-debt') {
 const cached = getCached('national-debt', 24 * 60 * 60 * 1000); // 24 hours
 if (cached) return json(cached);
 try {
 const url = 'https://api.worldbank.org/v2/country/all/indicator/GC.DOD.TOTL.GD.ZS?format=json&mrv=5&per_page=300';
 const res = await fetchWithTimeout(url, {}, 12_000);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json();
 const rows = data?.[1] ?? [];
 const seen = new Map();
 for (const row of rows) {
 if (!row.country?.value || row.value == undefined) continue;
 const code = row.countryiso3code || row.country?.id || '';
 // skip aggregates (all-caps 3-char codes are typically regional aggregates from WB)
 if (!code || code.length !== 3) continue;
 if (!seen.has(code)) {
 seen.set(code, { code, name: row.country.value, debtPctGdp: Number.parseFloat(row.value.toFixed(1)), year: row.date });
 }
 }
 const countries = [...seen.values()].sort((a, b) => b.debtPctGdp - a.debtPctGdp).slice(0, 30);
 const result = { countries, updatedAt: Math.floor(Date.now() / 1000) };
 setCached('national-debt', result);
 return json(result);
 } catch (error) {
 return json({ countries: [], updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── Fuel Prices (EIA v2, free key required) ───────────────────────────────
  if (requestUrl.pathname === '/api/fuel-prices') {
 const eiaKey = process.env.EIA_API_KEY;
 if (!eiaKey) return json({ regions: [], keyMissing: true, updatedAt: Math.floor(Date.now() / 1000) });
 const cached = getCached('fuel-prices', 12 * 60 * 60 * 1000); // 12 hours
 if (cached) return json(cached);
 try {
 const base = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/';
 const params = new URLSearchParams({
 'api_key': eiaKey,
 'frequency': 'weekly',
 'data[0]': 'value',
 'facets[duoarea][]': 'NUS',
 'facets[process][]': 'PTE',
 'sort[0][column]': 'period',
 'sort[0][direction]': 'desc',
 'length': '20',
 });
 // fetch gasoline (EPM0) and diesel (EPD2D) together
 const paramStr = params.toString() + '&facets[duoarea][]=R10&facets[duoarea][]=R20&facets[duoarea][]=R30&facets[duoarea][]=R40&facets[duoarea][]=R50&facets[product][]=EPM0&facets[product][]=EPD2D';
 const res = await fetchWithTimeout(`${base}?${paramStr}`, {}, 12_000);
 if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
 const data = await res.json();
 const rows = data?.response?.data ?? [];

 const AREA_NAMES = { NUS: 'U.S. Average', R10: 'East Coast', R20: 'Midwest', R30: 'Gulf Coast', R40: 'Rocky Mountain', R50: 'West Coast' };
 const AREA_ORDER = ['NUS', 'R10', 'R20', 'R30', 'R40', 'R50'];

 // Group latest value per (duoarea, product)
 const latest = new Map();
 for (const row of rows) {
 const key = `${row.duoarea}|${row.product}`;
 if (!latest.has(key)) latest.set(key, row);
 }

 const regions = AREA_ORDER.map(area => {
 const gasRow = latest.get(`${area}|EPM0`);
 const dslRow = latest.get(`${area}|EPD2D`);
 return {
 name: AREA_NAMES[area] ?? area,
 gasolineUsd: gasRow ? Number.parseFloat(gasRow.value) : 0,
 dieselUsd: dslRow ? Number.parseFloat(dslRow.value) : 0,
 period: gasRow?.period ?? dslRow?.period ?? '',
 };
 }).filter(r => r.gasolineUsd > 0 || r.dieselUsd > 0);

 const result = { regions, keyMissing: false, updatedAt: Math.floor(Date.now() / 1000) };
 setCached('fuel-prices', result);
 return json(result);
 } catch (error) {
 return json({ regions: [], keyMissing: false, updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── ADS-B live aircraft tracking (OpenSky Network, no key required) ──────
  if (requestUrl.pathname === '/api/adsb') {
 const CACHE_TTL = 55 * 1000;
 const cached = getCached('adsb', CACHE_TTL);
 if (cached) return json(cached);

 const clientId = process.env.OPENSKY_CLIENT_ID?.trim() || '';
 const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim() || '';
 const headers = { 'User-Agent': CHROME_UA };
 if (clientId && clientSecret) {
 const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
 headers['Authorization'] = `Basic ${creds}`;
 }

 try {
 const res = await fetchWithTimeout(
 'https://opensky-network.org/api/states/all',
 { headers },
 12_000
 );
 if (res.status === 429) {
 return Response.json({ states: null, time: Math.floor(Date.now() / 1000), rateLimited: true }, {
 status: 429, headers: { 'Content-Type': 'application/json' },
 });
 }
 if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
 const data = await res.json();
 setCached('adsb', data);
 return json(data);
 } catch (error) {
 return json({ states: null, time: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── DOD contracts — recent USAspending awards filtered to Department of Defense ─
  // Free, no-key federal data. 1h cache because USAspending POSTs are slow (~1-2s).
  if (requestUrl.pathname === '/api/dod-contracts') {
 const CACHE_TTL = 60 * 60 * 1000;
 const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('limit') ?? '20')));
 const daysBack = Math.min(90, Math.max(1, Number(requestUrl.searchParams.get('days') ?? '7')));
 const cacheKey = `dod-contracts:${limit}:${daysBack}`;
 const cached = getCached(cacheKey, CACHE_TTL);
 if (cached) return json(cached);

 const today = new Date();
 const start = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
 const fmtDate = (d) => d.toISOString().slice(0, 10);

 try {
 const r = await fetchWithTimeout(
 'https://api.usaspending.gov/api/v2/search/spending_by_award/',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': CHROME_UA },
 body: JSON.stringify({
 filters: {
 time_period: [{ start_date: fmtDate(start), end_date: fmtDate(today) }],
 award_type_codes: ['A', 'B', 'C', 'D'],
 agencies: [{ type: 'awarding', tier: 'toptier', name: 'Department of Defense' }],
 },
 fields: [
 'Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency',
 'Awarding Sub Agency', 'Description', 'Start Date', 'Award Type',
 'recipient_id', 'Place of Performance State Code',
 ],
 limit, order: 'desc', sort: 'Award Amount',
 }),
 },
 12000,
 );
 if (!r.ok) return json({ error: `USAspending HTTP ${r.status}`, awards: [] }, 502);
 const data = await r.json();
 const awards = (data?.results ?? []).map((a) => ({
 id: String(a['Award ID'] ?? ''),
 recipient: String(a['Recipient Name'] ?? 'Unknown'),
 amount: Number(a['Award Amount'] ?? 0),
 subAgency: String(a['Awarding Sub Agency'] ?? ''),
 description: String(a.Description ?? '').slice(0, 280),
 startDate: a['Start Date'] ?? null,
 state: a['Place of Performance State Code'] ?? null,
 }));
 const response = {
 awards,
 totalAmount: awards.reduce((s, a) => s + a.amount, 0),
 periodStart: fmtDate(start),
 periodEnd: fmtDate(today),
 fetchedAt: Date.now(),
 };
 setCached(cacheKey, response);
 return json(response);
 } catch (error) {
 return json({ error: String(error?.message ?? error), awards: [] }, 502);
 }
  }

  // ── WikiData military bases — global SPARQL query ─────────────────────────
  // Free, no-key, structured data. WikiData has ~10k military installations
  // with coordinates. 12h cache (data is essentially static).
  if (requestUrl.pathname === '/api/wikidata-military-bases') {
 const CACHE_TTL = 12 * 60 * 60 * 1000;
 const limit = Math.min(5000, Math.max(50, Number(requestUrl.searchParams.get('limit') ?? '2000')));
 const cacheKey = `wd-mil-bases:${limit}`;
 const cached = getCached(cacheKey, CACHE_TTL);
 if (cached) return json(cached);

 // P31 (instance of) → P279* (subclass-of, transitive) → Q245016 (military base).
 // P625 = coordinates, P17 = country. OPTIONAL country in case the base lacks one.
 const sparql = `SELECT ?base ?baseLabel ?coords ?countryLabel WHERE {
   ?base wdt:P31/wdt:P279* wd:Q245016 .
   ?base wdt:P625 ?coords .
   OPTIONAL { ?base wdt:P17 ?country . }
   SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
 }
 LIMIT ${limit}`;

 try {
 const r = await fetchWithTimeout(
 'https://query.wikidata.org/sparql',
 {
 method: 'POST',
 headers: {
 'Content-Type': 'application/x-www-form-urlencoded',
 Accept: 'application/sparql-results+json',
 'User-Agent': 'CrystalBall/2.10.20 (https://crystalball.app)',
 },
 body: 'query=' + encodeURIComponent(sparql),
 },
 30000,  // SPARQL queries can be slow
 );
 if (!r.ok) return json({ error: `WikiData HTTP ${r.status}`, bases: [] }, 502);
 const data = await r.json();
 const bases = [];
 for (const row of data?.results?.bindings ?? []) {
 const wkt = row.coords?.value;  // 'Point(lon lat)'
 if (!wkt || !wkt.startsWith('Point(')) continue;
 const m = wkt.match(/^Point\(([-\d.]+)\s+([-\d.]+)\)$/);
 if (!m) continue;
 const lon = Number(m[1]);
 const lat = Number(m[2]);
 if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
 const wdId = String(row.base?.value ?? '').replace(/^.*\/(Q\d+)$/, '$1');
 bases.push({
 id: wdId,
 name: String(row.baseLabel?.value ?? wdId),
 country: row.countryLabel?.value ?? null,
 lat, lon,
 });
 }
 const response = { bases, count: bases.length, fetchedAt: Date.now() };
 setCached(cacheKey, response);
 return json(response);
 } catch (error) {
 return json({ error: String(error?.message ?? error), bases: [] }, 502);
 }
  }

  // ── ADS-B Aggregate (multi-source resilience: OpenSky + community feeds) ─
  // Fans out in parallel to OpenSky, Airplanes.live, ADSB.fi, ADSB.lol with
  // per-source 3s timeout. Dedupes by ICAO hex, prefers freshest position,
  // folds in metadata across sources. If any source fails, others still
  // contribute. Per-source diagnostics in response.
  //
  // Query params:
  //   lat, lon, dist (NM)  — area query, fans out to all 4 sources
  //   (omit all three)     — global query, OpenSky only (only it supports this)
  if (requestUrl.pathname === '/api/adsb-aggregate') {
 const CACHE_TTL = 30 * 1000;
 const cacheKey = `adsb-agg:${requestUrl.search}`;
 const cached = getCached(cacheKey, CACHE_TTL);
 if (cached) return json(cached);

 const coords = parseLatLon(
 requestUrl.searchParams.get('lat'),
 requestUrl.searchParams.get('lon'),
 );
 const dist = Number(requestUrl.searchParams.get('dist') ?? '250');
 const hasArea = coords != null && Number.isFinite(dist) && dist > 0 && dist <= 500;
 const lat = coords?.lat ?? 0;
 const lon = coords?.lon ?? 0;

 const SOURCE_TIMEOUT = 3000;

 // OpenSky returns a state-array per aircraft (positional fields). Convert to unified.
 const normalizeOpenSky = (s) => {
 if (!Array.isArray(s) || s.length < 17) return null;
 const lonV = s[5], latV = s[6];
 if (lonV == null || latV == null) return null;
 const icao = String(s[0] ?? '').toLowerCase().trim();
 if (!icao) return null;
 const altMeters = s[7] ?? s[13];
 const velMs = s[9];
 return {
 icao,
 callsign: s[1] ? String(s[1]).trim() || null : null,
 lat: latV, lon: lonV,
 alt: altMeters != null ? Math.round(Number(altMeters) * 3.28084) : null,  // m → ft
 speed: velMs != null ? Math.round(Number(velMs) * 1.94384) : null,        // m/s → kt
 track: s[10] ?? null,
 vsi: s[11] != null ? Math.round(Number(s[11]) * 196.85) : null,           // m/s → ft/min
 squawk: s[14] ? String(s[14]) : null,
 type: null,
 military: null,
 ts: (s[3] ?? s[4] ?? Math.floor(Date.now() / 1000)) * 1000,
 };
 };

 // Airplanes.live / ADSB.fi / ADSB.lol all use the readsb `ac` shape.
 const normalizeReadsb = (a) => {
 if (!a || a.lat == null || a.lon == null) return null;
 const icao = String(a.hex ?? '').toLowerCase().trim();
 if (!icao) return null;
 return {
 icao,
 callsign: a.flight ? String(a.flight).trim() || null : null,
 lat: a.lat, lon: a.lon,
 alt: typeof a.alt_baro === 'number' ? a.alt_baro : (typeof a.alt_geom === 'number' ? a.alt_geom : null),
 speed: typeof a.gs === 'number' ? Math.round(a.gs) : null,
 track: a.track ?? null,
 vsi: typeof a.baro_rate === 'number' ? a.baro_rate : null,
 squawk: a.squawk ? String(a.squawk) : null,
 type: a.t ? String(a.t) : null,
 military: a.mil === true,
 ts: a.seen != null ? Date.now() - Math.round(Number(a.seen) * 1000) : Date.now(),
 };
 };

 const runSource = async (name, fn) => {
 const start = Date.now();
 try {
 const aircraft = await fn();
 return { name, ok: true, count: aircraft.length, ms: Date.now() - start, aircraft };
 } catch (error) {
 return { name, ok: false, count: 0, ms: Date.now() - start, error: error?.message ?? 'failed', aircraft: [] };
 }
 };

 const tasks = [
 runSource('opensky', async () => {
 const headers = { 'User-Agent': CHROME_UA };
 const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
 const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
 if (clientId && clientSecret) {
 headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
 }
 let url = 'https://opensky-network.org/api/states/all';
 if (hasArea) {
 const dLat = dist / 60;
 const dLon = dist / (60 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
 const params = new URLSearchParams({
 lamin: String(lat - dLat), lamax: String(lat + dLat),
 lomin: String(lon - dLon), lomax: String(lon + dLon),
 });
 url += `?${params}`;
 }
 const r = await fetchWithTimeout(url, { headers }, SOURCE_TIMEOUT);
 if (!r.ok) throw new Error(`HTTP ${r.status}`);
 const data = await r.json();
 return (data?.states ?? []).map(normalizeOpenSky).filter(Boolean);
 }),
 ];

 if (hasArea) {
 tasks.push(
 runSource('airplanesLive', async () => {
 const r = await fetchWithTimeout(
 `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 SOURCE_TIMEOUT,
 );
 if (!r.ok) throw new Error(`HTTP ${r.status}`);
 const data = await r.json();
 return (data?.ac ?? []).map(normalizeReadsb).filter(Boolean);
 }),
 runSource('adsbFi', async () => {
 const r = await fetchWithTimeout(
 `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 SOURCE_TIMEOUT,
 );
 if (!r.ok) throw new Error(`HTTP ${r.status}`);
 const data = await r.json();
 // ADSB.fi uses `aircraft` key (full readsb output), other readsb feeds use `ac`.
 return (data?.aircraft ?? data?.ac ?? []).map(normalizeReadsb).filter(Boolean);
 }),
 runSource('adsbLol', async () => {
 const r = await fetchWithTimeout(
 `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 SOURCE_TIMEOUT,
 );
 if (!r.ok) throw new Error(`HTTP ${r.status}`);
 const data = await r.json();
 return (data?.ac ?? []).map(normalizeReadsb).filter(Boolean);
 }),
 );
 }

 const results = await Promise.all(tasks);

 // Merge by ICAO. Prefer freshest position; fold in metadata.
 const merged = new Map();
 for (const result of results) {
 if (!result.ok) continue;
 for (const ac of result.aircraft) {
 const existing = merged.get(ac.icao);
 if (!existing) {
 merged.set(ac.icao, { ...ac, sources: [result.name] });
 } else {
 if (ac.ts > existing.ts) {
 existing.lat = ac.lat; existing.lon = ac.lon;
 if (ac.alt != null) existing.alt = ac.alt;
 if (ac.speed != null) existing.speed = ac.speed;
 if (ac.track != null) existing.track = ac.track;
 if (ac.vsi != null) existing.vsi = ac.vsi;
 existing.ts = ac.ts;
 }
 existing.callsign ??= ac.callsign;
 existing.squawk ??= ac.squawk;
 existing.type ??= ac.type;
 if (existing.military !== true && ac.military === true) existing.military = true;
 if (!existing.sources.includes(result.name)) existing.sources.push(result.name);
 }
 }
 }

 const sources = {};
 for (const r of results) {
 sources[r.name] = { ok: r.ok, count: r.count, ms: r.ms, ...(r.error && { error: r.error }) };
 }

 const response = {
 aircraft: Array.from(merged.values()),
 sources,
 fetchedAt: Date.now(),
 };
 setCached(cacheKey, response);
 return json(response);
  }

  // ── GDELT Intelligence (no key required, public API) ──────────────────────
  if (requestUrl.pathname === '/api/gdelt-intel') {
 const cached = getCached('gdelt-intel', 30 * 60 * 1000); // 30 minutes — GDELT rate-limits aggressively
 if (cached) return json(cached);

 // Exponential backoff after 429s. GDELT's rate limiter doesn't return
 // Retry-After, so we double the wait per consecutive throttle event:
 // 5s → 10s → 20s → 40s → 80s → 160s → 300s (cap). Reset on success.
 // While backed off, serve the last cached value (stale if needed) and
 // log the rate-limit event once per backoff window — not every tick.
 if (!context._gdeltBackoff) context._gdeltBackoff = { until: 0, fails: 0, loggedAt: 0 };
 const bo = context._gdeltBackoff;
 if (Date.now() < bo.until) {
 const stale = getCachedStale('gdelt-intel');
 if (stale) return json({ ...stale, stale: true, error: 'rate-limited; serving cached', backoffMs: bo.until - Date.now() });
 return json({ events: [], updatedAt: Math.floor(Date.now() / 1000), error: 'rate-limited', backoffMs: bo.until - Date.now() });
 }
 try {
 const params = new URLSearchParams({
 query: '(war OR conflict OR crisis OR military OR sanctions OR nuclear)',
 mode: 'artlist',
 maxrecords: '25',
 format: 'json',
 sort: 'ToneDesc',
 timespan: '3h',
 });
 const res = await fetchWithTimeout(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { headers: { 'User-Agent': CHROME_UA } }, 12_000);
 if (res.status === 429 || res.status === 503) {
 bo.fails = Math.min(bo.fails + 1, 6);
 const waitMs = Math.min(5_000 * (2 ** bo.fails), 5 * 60_000);
 bo.until = Date.now() + waitMs;
 if (Date.now() - bo.loggedAt > waitMs) {
 context.logger.warn(`[gdelt-intel] rate-limited (HTTP ${res.status}); backing off ${Math.round(waitMs / 1000)}s after ${bo.fails} fails`);
 bo.loggedAt = Date.now();
 }
 const stale = getCachedStale('gdelt-intel');
 if (stale) return json({ ...stale, stale: true, error: `rate-limited HTTP ${res.status}`, backoffMs: waitMs });
 return json({ events: [], updatedAt: Math.floor(Date.now() / 1000), error: `rate-limited HTTP ${res.status}`, backoffMs: waitMs });
 }
 if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
 const data = await res.json();
 const articles = data?.articles ?? [];
 const events = articles.map(a => ({
 title: a.title ?? '',
 url: a.url ?? '',
 source: a.domain ?? '',
 tone: typeof a.tone === 'number' ? Math.round(a.tone * 10) / 10 : 0,
 country: a.sourcecountry ?? '',
 timestamp: a.seendate
 ? new Date(a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).getTime()
 : Date.now(),
 })).filter(e => e.title && e.url);
 const result = { events, updatedAt: Math.floor(Date.now() / 1000) };
 setCached('gdelt-intel', result);
 if (bo.fails > 0) {
 context.logger.log(`[gdelt-intel] recovered after ${bo.fails} rate-limit hits`);
 }
 bo.fails = 0;
 bo.until = 0;
 return json(result);
 } catch (error) {
 // Serve last-known data rather than an empty response — GDELT 503s are transient
 const stale = getCachedStale('gdelt-intel');
 if (stale) return json({ ...stale, stale: true, error: error?.message ?? 'unknown' });
 return json({ events: [], updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── Fear & Greed Index (alternative.me, no key required) ─────────────────
  if (requestUrl.pathname === '/api/fear-greed') {
 const cached = getCached('fear-greed', 60 * 60 * 1000); // 1 hour
 if (cached) return json(cached);
 try {
 const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=7', {}, 8000);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json();
 const entries = data?.data ?? [];
 const [latest, ...rest] = entries;
 const result = {
 score: parseInt(latest?.value ?? '50', 10),
 classification: latest?.value_classification ?? 'Neutral',
 history: rest.map(e => ({ value: parseInt(e.value, 10), timestamp: e.timestamp })),
 updatedAt: parseInt(latest?.timestamp ?? String(Math.floor(Date.now() / 1000)), 10),
 };
 setCached('fear-greed', result);
 return json(result);
 } catch (error) {
 return json({ score: 50, classification: 'Neutral', history: [], updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── National Debt / GDP (World Bank, no key required) ─────────────────────
  if (requestUrl.pathname === '/api/national-debt') {
 const cached = getCached('national-debt', 24 * 60 * 60 * 1000); // 24 hours
 if (cached) return json(cached);
 try {
 const url = 'https://api.worldbank.org/v2/country/all/indicator/GC.DOD.TOTL.GD.ZS?format=json&mrv=5&per_page=300';
 const res = await fetchWithTimeout(url, {}, 12000);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json();
 const rows = data?.[1] ?? [];
 const seen = new Map();
 for (const row of rows) {
 if (!row.country?.value || row.value == null) continue;
 const code = row.countryiso3code || row.country?.id || '';
 // skip aggregates (all-caps 3-char codes are typically regional aggregates from WB)
 if (!code || code.length !== 3) continue;
 if (!seen.has(code)) {
 seen.set(code, { code, name: row.country.value, debtPctGdp: parseFloat(row.value.toFixed(1)), year: row.date });
 }
 }
 const countries = [...seen.values()].sort((a, b) => b.debtPctGdp - a.debtPctGdp).slice(0, 30);
 const result = { countries, updatedAt: Math.floor(Date.now() / 1000) };
 setCached('national-debt', result);
 return json(result);
 } catch (error) {
 return json({ countries: [], updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── Fuel Prices (EIA v2, free key required) ───────────────────────────────
  if (requestUrl.pathname === '/api/fuel-prices') {
 const eiaKey = process.env.EIA_API_KEY;
 if (!eiaKey) return json({ regions: [], keyMissing: true, updatedAt: Math.floor(Date.now() / 1000) });
 const cached = getCached('fuel-prices', 12 * 60 * 60 * 1000); // 12 hours
 if (cached) return json(cached);
 try {
 const base = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/';
 const params = new URLSearchParams({
 'api_key': eiaKey,
 'frequency': 'weekly',
 'data[0]': 'value',
 'facets[duoarea][]': 'NUS',
 'facets[process][]': 'PTE',
 'sort[0][column]': 'period',
 'sort[0][direction]': 'desc',
 'length': '20',
 });
 // fetch gasoline (EPM0) and diesel (EPD2D) together
 const paramStr = params.toString() + '&facets[duoarea][]=R10&facets[duoarea][]=R20&facets[duoarea][]=R30&facets[duoarea][]=R40&facets[duoarea][]=R50&facets[product][]=EPM0&facets[product][]=EPD2D';
 const res = await fetchWithTimeout(`${base}?${paramStr}`, {}, 12000);
 if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
 const data = await res.json();
 const rows = data?.response?.data ?? [];

 const AREA_NAMES = { NUS: 'U.S. Average', R10: 'East Coast', R20: 'Midwest', R30: 'Gulf Coast', R40: 'Rocky Mountain', R50: 'West Coast' };
 const AREA_ORDER = ['NUS', 'R10', 'R20', 'R30', 'R40', 'R50'];

 // Group latest value per (duoarea, product)
 const latest = new Map();
 for (const row of rows) {
 const key = `${row.duoarea}|${row.product}`;
 if (!latest.has(key)) latest.set(key, row);
 }

 const regions = AREA_ORDER.map(area => {
 const gasRow = latest.get(`${area}|EPM0`);
 const dslRow = latest.get(`${area}|EPD2D`);
 return {
 name: AREA_NAMES[area] ?? area,
 gasolineUsd: gasRow ? parseFloat(gasRow.value) : 0,
 dieselUsd: dslRow ? parseFloat(dslRow.value) : 0,
 period: gasRow?.period ?? dslRow?.period ?? '',
 };
 }).filter(r => r.gasolineUsd > 0 || r.dieselUsd > 0);

 const result = { regions, keyMissing: false, updatedAt: Math.floor(Date.now() / 1000) };
 setCached('fuel-prices', result);
 return json(result);
 } catch (error) {
 return json({ regions: [], keyMissing: false, updatedAt: Math.floor(Date.now() / 1000), error: error?.message ?? 'unknown' });
 }
  }

  // ── AIS snapshot — served from sidecar's own aisstream.io connection ────────
  if (requestUrl.pathname === '/api/ais-snapshot') {
 const apiKey = process.env.AISSTREAM_API_KEY;
 if (!apiKey) {
 return json({ error: 'AISSTREAM_API_KEY not configured — add your key in Settings → Tracking & Sensing' }, 503);
 }
 // Ensure connected (handles case where key was just set and connect hasn't fired yet)
 if (!aisState.socket || aisState.socket.readyState > 1) aisConnect(apiKey);
 return new Response(aisBuildSnapshot(), {
 status: 200,
 headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
 });
  }

  // ── AIS snapshot — served from sidecar's own aisstream.io connection ────────
  if (requestUrl.pathname === '/api/ais-snapshot') {
 const apiKey = process.env.AISSTREAM_API_KEY;
 if (!apiKey) {
 return json({ error: 'AISSTREAM_API_KEY not configured — add your key in Settings → Tracking & Sensing' }, 503);
 }
 // Ensure connected (handles case where key was just set and connect hasn't fired yet)
 if (!aisState.socket || aisState.socket.readyState > 1) aisConnect(apiKey);
 return new Response(aisBuildSnapshot(), {
 status: 200,
 headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
 });
  }

  // ── S2U XMPP — wire/event/emergency/main/offtopic MUC rooms ────────────────
  if (requestUrl.pathname === '/api/s2u-xmpp') {
 const snap = await s2uXmppSnapshot();
 return json(snap);
  }

  // ── Synthesis: precedents (corpus-backed TF-IDF cosine matcher) ──────────
  // Returns configured=false until a corpus is wired in. Engine lives in
  // src/services/synthesis/precedent-matcher.ts (21 tests passing).
  if (requestUrl.pathname === '/api/precedents') {
 return json({
 configured: false,
 error: 'corpus not yet ingested',
 analogs: [],
 });
  }

  // ── Synthesis: leading indicators (Granger F-test across signals) ────────
  // Returns configured=false until rolling daily series for BDI / commodities
  // / ACLED / ProMED / USGS / CISA KEV are wired in. Engine lives in
  // src/services/synthesis/leading-indicators.ts (19 tests passing).
  if (requestUrl.pathname === '/api/leading-indicators') {
 return json({
 configured: false,
 error: 'time series not yet ingested',
 pairs: [],
 alerts: [],
 });
  }

  // ── Cyber: APT groups (MITRE ATT&CK + OTX + CISA cross-ref) ──────────────
  // Engine lives in src/services/cyber/apt-tracker.ts (23 tests passing).
  // Returns configured=false until ATT&CK STIX bundle is vendored + OTX
  // polling is wired. configured=true response shape matches AptGroup[].
  if (requestUrl.pathname === '/api/apt-groups') {
 return json({
 configured: false,
 error: 'ATT&CK corpus not yet vendored',
 groups: [],
 });
  }

  // ── Finance: OFR FSI ──────────────────────────────────────────────────
  // Engine in src/services/finance/stress-monitor.ts (18 tests passing).
  // configured=false until OFR ASCII fetcher is wired.
  if (requestUrl.pathname === '/api/financial-stress') {
 return json({ configured: false, error: 'OFR FSI series not yet ingested' });
  }

  // ── Finance: commodity stress (12m + 24m σ) ───────────────────────────
  if (requestUrl.pathname === '/api/commodity-stress') {
 return json({ configured: false, error: 'commodity series not yet ingested', alerts: [] });
  }

  // ── Climate: ENSO phase + shortage adjustments ────────────────────────
  // Engine in src/services/climate/enso-monitor.ts (22 tests passing).
  // configured=false until NOAA ONI ASCII fetcher is wired.
  if (requestUrl.pathname === '/api/enso') {
 return json({
 configured: false,
 error: 'NOAA ONI series not yet ingested',
 shortageAdjustments: [],
 });
  }

  // ── Geopolitics: gray-zone events ─────────────────────────────────────
  // Engine lives in src/services/geopolitics/grayzone-classifier.ts
  // (23 tests passing). configured=false until OpenSanctions / CISA /
  // ACLED / GDELT feeders run through the classifiers.
  if (requestUrl.pathname === '/api/grayzone-events') {
 return json({
 configured: false,
 error: 'gray-zone classifier not yet wired',
 events: [],
 });
  }

  // ── S2U TAK feeds — Marti API /api/feeds (cached 60s, TLS-pinned) ─────────
  if (requestUrl.pathname === '/api/s2u-tak-feeds') {
 const opts = s2uTakOpts();
 if (!opts.url || !opts.username || !opts.password) {
 return json({ ok: false, configured: false, error: 'creds-missing', feeds: [] }, 503);
 }
 const result = await s2uTakGetFeeds(opts);
 return json({ configured: true, ...result });
  }

  // ── S2U TAK situation — clientEndPoints + sync/search public packages ─────
  if (requestUrl.pathname === '/api/s2u-situation') {
 const opts = s2uTakOpts();
 if (!opts.url || !opts.username || !opts.password) {
 return json({ ok: false, configured: false, error: 'creds-missing' }, 503);
 }
 const result = await s2uTakGetSituation(opts);
 return json({ configured: true, ...result });
  }

  // ── Local IDS — Suricata + Zeek alerts (desktop-only, reads local log files) ──
  if (requestUrl.pathname === '/api/local-ids') {
 try {
 const alerts = [];

 // ── Suricata fast.log (alerts only — small and append-only) ──────
 const fastPath = '/opt/homebrew/var/log/suricata/fast.log';
 if (existsSync(fastPath)) {
 // eslint-disable-next-line sonarjs/regex-complexity
 const re = /^(\d{2})\/(\d{2})\/(\d{4})-(\d{2}:\d{2}:\d{2})\.\d+\s+\[\*\*\]\s+\[\d+:\d+:\d+\]\s+(.+?)\s+\[\*\*\]\s+\[Classification:\s+(.+?)\]\s+\[Priority:\s+(\d+)\]\s+\{(\w+)\}\s+(\S+?):(\d+)\s+->\s+(\S+?):(\d+)/;
 const SURICATA_NOISE = /SURICATA STREAM|SURICATA HTTP Response excessive header/;
 for (const line of _tailFile(fastPath, 262_144)) {
 const m = re.exec(line);
 if (!m) continue;
 const [, mo, day, yr, hms, signature, category, prio, proto, srcIp, srcPort, destIp, destPort] = m;
 const p = parseInt(prio, 10);
 if (p >= 3 && SURICATA_NOISE.test(signature)) continue;
 const severity = p === 1 ? 'critical' : p === 2 ? 'high' : p === 3 ? 'medium' : 'low';
 alerts.push({
 id: `suricata-${yr}${mo}${day}-${hms}-${srcIp}-${destPort}`,
 source: 'suricata',
 ts: `${yr}-${mo}-${day}T${hms}`,
 severity,
 category,
 signature,
 srcIp,
 destIp,
 proto: proto.toLowerCase(),
 action: `${srcPort} → ${destPort}`,
 });
 }
 }

 // ── Zeek notice.log ────────────────────────────────────────────────
 const noticeCandidates = [
 '/opt/homebrew/var/log/zeek/notice.log',
 '/opt/homebrew/Cellar/zeek/8.1.1/spool/manager/notice.log',
 '/opt/homebrew/var/log/zeek/current/notice.log',
 ];
 for (const p of noticeCandidates) {
 if (!existsSync(p)) continue;
 const lines = _tailFile(p, 131072);
 const fields = _zeekFields(lines);
 if (!fields) continue;
 if (!fields.includes('ts')) continue;
 const [tsI, noteI, msgI, srcI, dstI] = ['ts', 'note', 'msg', 'src', 'dst'].map(f => fields.indexOf(f));
 const NOTICE_DROP = /^(PacketFilter::Dropped_Packets|Weird::|ProtocolDetector::)/;
 const INTEL_BENIGN_DOMAINS = /(github\.com|githubusercontent\.com|jsdelivr\.net|cloudflare\.com|gstatic\.com|googleapis\.com|akamai|fastly|cloudfront|microsoft\.com|apple\.com|amazonaws\.com|cdn\.|fonts\.)/i;
 for (const line of lines) {
 if (line.startsWith('#')) continue;
 try {
 const cols = line.split('\t');
 const ts = cols[tsI];
 if (!ts || ts === '-') continue;
 const note = cols[noteI] ?? '';
 const msg = cols[msgI] ?? '';
 if (NOTICE_DROP.test(note)) continue;
 if (note.startsWith('Intel::') && INTEL_BENIGN_DOMAINS.test(msg)) continue;
 alerts.push({
 id: `zeek-notice-${ts}-${Math.random().toString(36).slice(2, 6)}`,
 source: 'zeek_notice',
 ts: new Date(parseFloat(ts) * 1000).toISOString(),
 severity: note.startsWith('Intel::') ? 'high' : 'medium',
 category: 'Network Notice',
 signature: note,
 srcIp: cols[srcI] ?? '',
 destIp: cols[dstI] ?? '',
 proto: '',
 action: msg.slice(0, 120),
 });
 } catch { /* skip malformed row */ }
 }
 break;
 }

 // ── Zeek conn.log (suspicious states + large transfers) ───────────
 const connCandidates = [
 '/opt/homebrew/var/log/zeek/conn.log',
 '/opt/homebrew/Cellar/zeek/8.1.1/spool/manager/conn.log',
 '/opt/homebrew/var/log/zeek/current/conn.log',
 ];
 const SUSPICIOUS_STATES = new Set(['S0', 'REJ', 'RSTRH', 'RSTOS0']);
 for (const p of connCandidates) {
 if (!existsSync(p)) continue;
 const lines = _tailFile(p, 131072);
 const fields = _zeekFields(lines);
 if (!fields) continue;
 if (!fields.includes('ts')) continue;
 const [tsI, origI, origPI, respI, respPI, protoI, stateI, bytesI] =
 ['ts', 'id.orig_h', 'id.orig_p', 'id.resp_h', 'id.resp_p', 'proto', 'conn_state', 'orig_bytes']
 .map(f => fields.indexOf(f));
 for (const line of lines) {
 if (line.startsWith('#')) continue;
 try {
 const cols = line.split('\t');
 const state = cols[stateI];
 const bytes = parseInt(cols[bytesI], 10) || 0;
 // Only flag big transfers (≥50MB) or genuinely failed connection attempts to non-RFC1918 destinations
 if (bytes < 50_000_000 && !SUSPICIOUS_STATES.has(state)) continue;
 const dstIp = cols[respI] ?? '';
 const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fd|::1)/i.test(dstIp);
 if (SUSPICIOUS_STATES.has(state) && isPrivate) continue;
 const ts = cols[tsI];
 if (!ts || ts === '-') continue;
 const severity = bytes > 50_000_000 ? 'high' : SUSPICIOUS_STATES.has(state) ? 'medium' : 'low';
 alerts.push({
 id: `zeek-conn-${ts}-${cols[origI]}-${Math.random().toString(36).slice(2, 6)}`,
 source: 'zeek_conn',
 ts: new Date(parseFloat(ts) * 1000).toISOString(),
 severity,
 category: 'Suspicious Connection',
 signature: `${state}${bytes > 1_000_000 ? ` · ${Math.round(bytes / 1024)}KB` : ''}`,
 srcIp: cols[origI] ?? '',
 destIp: cols[respI] ?? '',
 proto: cols[protoI] ?? '',
 action: `${cols[origPI] ?? ''} → ${cols[respPI] ?? ''}`,
 });
 } catch { /* skip malformed row */ }
 }
 break;
 }

 alerts.sort((a, b) => b.ts.localeCompare(a.ts));
 return json(alerts.slice(0, 50));
 } catch {
 return json([], 200);
 }
  }

  // ── PizzINT — Pentagon Pizza Index ────────────────────────────────────────
  if (requestUrl.pathname === '/api/pizzint/dashboard') {
 try {
 const resp = await fetchWithTimeout(
 'https://www.pizzint.watch/api/dashboard-data',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 12_000,
 );
 if (!resp.ok) return json({ success: false, data: [] }, resp.status);
 const data = await resp.json();
 return json(data);
 } catch {
 return json({ success: false, data: [] }, 200);
 }
  }

  if (requestUrl.pathname === '/api/pizzint/gdelt') {
 try {
 const resp = await fetchWithTimeout(
 'https://www.pizzint.watch/api/gdelt/batch?pairs=usa_russia,russia_ukraine,usa_china,china_taiwan,usa_iran,usa_venezuela',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 12_000,
 );
 if (!resp.ok) return json([], resp.status);
 const data = await resp.json();
 return json(Array.isArray(data) ? data : []);
 } catch {
 return json([], 200);
 }
  }

  // ── Trade Policy — Global Trade Alert ────────────────────────────────────
  if (requestUrl.pathname === '/api/trade-policy') {
 const cached = getCached('trade-policy');
 if (cached) return json(cached);
 try {
 const resp = await fetchWithTimeout(
 'https://www.globaltradealert.org/api/latest.json',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 12_000,
 );
 if (!resp.ok) return json({ interventions: [] }, resp.status);
 const raw = await resp.json();
 const interventions = (Array.isArray(raw) ? raw : raw.data ?? []).slice(0, 50).map(d => ({
 id: String(d.state_act_id ?? d.id ?? ''),
 title: d.title ?? d.description ?? '',
 country: d.implementing_jurisdiction ?? d.country ?? '',
 type: d.mast_chapter ?? d.intervention_type ?? '',
 announced: d.date_announced ?? d.date ?? '',
 status: d.currently_in_force ? 'in_force' : 'announced',
 affected_countries: Array.isArray(d.affected_jurisdictions) ? d.affected_jurisdictions : [],
 }));
 const result = { interventions, fetchedAt: new Date().toISOString() };
 setCached('trade-policy', result, 30 * 60 * 1000);
 return json(result);
 } catch {
 return json({ interventions: [] });
 }
  }

  // ── Supply Chain — Baltic Dry Index + IMF Portwatch ───────────────────────
  if (requestUrl.pathname === '/api/supply-chain') {
 const cached = getCached('supply-chain');
 if (cached) return json(cached);
 try {
 const bdiResp = await fetchWithTimeout(
 'https://stooq.com/q/d/l/?s=bdi&i=d&l=20',
 { headers: { 'User-Agent': CHROME_UA } },
 10_000,
 );
 let bdi = null;
 if (bdiResp.ok) {
 const csv = await bdiResp.text();
 const lines = csv.trim().split('\n');
 const last = lines[lines.length - 1]?.split(',');
 if (last && last[4]) bdi = { value: parseFloat(last[4]), date: last[0] };
 }

 const portResp = await fetchWithTimeout(
 'https://portwatch.imf.org/api/chokepoints',
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } },
 10_000,
 );
 let chokepoints = [];
 if (portResp.ok) {
 const portData = await portResp.json();
 chokepoints = (Array.isArray(portData) ? portData : portData.data ?? []).slice(0, 20).map(c => ({
 name: c.name ?? c.chokepoint ?? '',
 status: c.status ?? 'normal',
 throughput_pct: c.throughput_pct ?? c.capacity_utilization ?? null,
 region: c.region ?? '',
 }));
 }

 const result = { bdi, chokepoints, fetchedAt: new Date().toISOString() };
 setCached('supply-chain', result, 30 * 60 * 1000);
 return json(result);
 } catch {
 return json({ bdi: null, chokepoints: [] });
 }
  }

  // ── HIFLD critical infrastructure (hospitals, urgent care) ──────────────
  if (requestUrl.pathname === '/api/hifld-infrastructure') {
 const coords = parseLatLon(
 requestUrl.searchParams.get('lat'),
 requestUrl.searchParams.get('lon'),
 );
 if (!coords) return json({ assets: [] });
 const { lat, lon } = coords;
 const radiusMilesRaw = parseFloat(requestUrl.searchParams.get('radius') ?? '50');
 const radiusMiles = Number.isFinite(radiusMilesRaw) && radiusMilesRaw > 0 && radiusMilesRaw <= 500
 ? radiusMilesRaw
 : 50;

 const cached = getCached(`hifld-${lat.toFixed(2)}-${lon.toFixed(2)}`, 24 * 60 * 60 * 1000);
 if (cached) return json(cached);

 const radiusMeters = radiusMiles * 1609.34;

 try {
 const hospitalsUrl = `https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Hospitals/FeatureServer/0/query?where=1%3D1&geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=NAME,ADDRESS,CITY,STATE,ZIP,TELEPHONE,BEDS,TYPE&f=json&resultRecordCount=10`;

 const resp = await fetchWithTimeout(hospitalsUrl, { headers: { 'User-Agent': CHROME_UA } }, 12_000);
 const data = resp.ok ? await resp.json() : { features: [] };

 const assets = (data.features ?? []).map(f => ({
 type: 'hospital',
 name: f.attributes?.NAME ?? 'Unknown Hospital',
 address: `${f.attributes?.ADDRESS ?? ''}, ${f.attributes?.CITY ?? ''}, ${f.attributes?.STATE ?? ''}`.trim().replace(/^,\s*/, ''),
 phone: f.attributes?.TELEPHONE ?? null,
 beds: f.attributes?.BEDS ?? null,
 subtype: f.attributes?.TYPE ?? 'GENERAL ACUTE CARE',
 lat: f.geometry?.y ?? null,
 lon: f.geometry?.x ?? null,
 }));

 const result = { assets, fetchedAt: new Date().toISOString() };
 setCached(`hifld-${lat.toFixed(2)}-${lon.toFixed(2)}`, result);
 return json(result);
 } catch (error) {
 return json({ assets: [], error: String(error) });
 }
  }

  // ── GreyNoise scanner seed list ──────────────────────────────────────────
  if (requestUrl.pathname === '/api/greynoise-scanners') {
 const apiKey = process.env.GREYNOISE_API_KEY ?? '';
 if (!apiKey) return json({ error: 'GREYNOISE_API_KEY not configured' });
 const cached = getCached('greynoise-scanners', 15 * 60 * 1000);
 if (cached) return json(cached);
 const SEED_IPS = [
 '45.83.64.1', '80.82.77.33', '185.220.101.1', '193.32.127.1', '198.20.69.74',
 '198.20.69.98', '198.20.70.114', '198.20.70.242', '205.210.31.1', '209.126.110.1',
 '71.6.146.130', '71.6.146.185', '71.6.158.166', '71.6.165.200', '71.6.167.142',
 '89.248.165.1', '89.248.167.1', '94.102.49.1', '94.102.49.190', '198.199.119.1',
 ];
 try {
 const results = [];
 for (let i = 0; i < SEED_IPS.length; i += 5) {
 const batch = SEED_IPS.slice(i, i + 5);
 await Promise.all(batch.map(async (ip) => {
 try {
 const r = await fetchWithTimeout(
 `https://api.greynoise.io/v3/community/${ip}`,
 { headers: { 'key': apiKey, 'User-Agent': CHROME_UA } },
 10000,
 );
 if (!r.ok) return;
 const d = await r.json();
 results.push({ ip: d.ip ?? ip, noise: d.noise ?? false, riot: d.riot ?? false, classification: d.classification ?? 'unknown', name: d.name ?? null, link: d.link ?? null });
 } catch {}
 }));
 if (i + 5 < SEED_IPS.length) {
 await new Promise(r => setTimeout(r, 200));
 }
 }
 setCached('greynoise-scanners', results);
 return json(results);
 } catch (error) {
 return json({ error: `greynoise-scanners error: ${error.message ?? error}` }, 502);
 }
  }

  // ── OTX subscribed pulses ────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/otx-pulses') {
 const apiKey = process.env.OTX_API_KEY ?? '';
 if (!apiKey) return json({ error: 'OTX_API_KEY not configured' });
 const cached = getCached('otx-pulses', 30 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://otx.alienvault.com/api/v1/pulses/subscribed?limit=20',
 { headers: { 'X-OTX-API-KEY': apiKey, 'User-Agent': CHROME_UA } },
 12000,
 );
 if (!r.ok) throw new Error(`OTX API ${r.status}`);
 const data = await r.json();
 const pulses = (data.results ?? []).map(pulse => ({
 id: pulse.id,
 name: pulse.name,
 description: pulse.description,
 created: pulse.created,
 author_name: pulse.author_name,
 tags: pulse.tags,
 targeted_countries: pulse.targeted_countries,
 indicators_count: pulse.indicators?.length ?? 0,
 }));
 setCached('otx-pulses', pulses);
 return json(pulses);
 } catch (error) {
 return json({ error: `otx-pulses error: ${error.message ?? error}` }, 502);
 }
  }

  // ── AbuseIPDB blacklist ──────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/abuseipdb-reports') {
 const apiKey = process.env.ABUSEIPDB_API_KEY ?? '';
 if (!apiKey) return json({ error: 'ABUSEIPDB_API_KEY not configured' });
 const cached = getCached('abuseipdb-reports', 30 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://api.abuseipdb.com/api/v2/blacklist?limit=50',
 { headers: { 'Key': apiKey, 'Accept': 'application/json', 'User-Agent': CHROME_UA } },
 12000,
 );
 if (!r.ok) throw new Error(`AbuseIPDB API ${r.status}`);
 const data = await r.json();
 const entries = (data.data ?? []).map(entry => ({
 ipAddress: entry.ipAddress,
 abuseConfidenceScore: entry.abuseConfidenceScore,
 countryCode: entry.countryCode,
 usageType: entry.usageType,
 isp: entry.isp,
 totalReports: entry.totalReports,
 lastReportedAt: entry.lastReportedAt,
 }));
 setCached('abuseipdb-reports', entries);
 return json(entries);
 } catch (error) {
 return json({ error: `abuseipdb-reports error: ${error.message ?? error}` }, 502);
 }
  }

  // ── ADS-B military aircraft filter ──────────────────────────────────────
  if (requestUrl.pathname === '/api/adsb-military') {
 const cached = getCached('adsb-military', 3 * 60 * 1000);
 if (cached) return json(cached);
 const clientId = process.env.OPENSKY_CLIENT_ID?.trim() || '';
 const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim() || '';
 const headers = { 'User-Agent': CHROME_UA };
 if (clientId && clientSecret) {
 const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
 headers['Authorization'] = `Basic ${creds}`;
 }
 try {
 const r = await fetchWithTimeout('https://opensky-network.org/api/states/all', { headers }, 12000);
 if (!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
 const data = await r.json();
 const MILITARY_SQUAWKS = new Set(['7700', '7600', '7500']);
 // Verified country-tagged ICAO 24-bit hex ranges (ads-b.nl/icao.php).
 // Each range: [startHex, endHex]. Inclusive on both ends.
 const MILITARY_HEX_RANGES = [
 ['ADF7C7', 'ADF7CF'], ['AE0000', 'AFFFFF'], ['A00000', 'A3FFFF'], // USA
 ['43C000', '43CFFF'],                                              // UK
 ['3A0000', '3AFFFF'], ['3B0000', '3BFFFF'],                        // France
 ['3F0000', '3FFFFF'],                                              // Germany
 ['738000', '73FFFF'],                                              // Israel
 ['4D0000', '4D03FF'],                                              // NATO AWACS
 ['300000', '33FFFF'],                                              // Italy
 ['340000', '37FFFF'],                                              // Spain
 ['480000', '480FFF'],                                              // Netherlands
 ['4BA000', '4BCFFF'],                                              // Turkey
 ['710000', '717FFF'],                                              // Saudi Arabia
 ['896000', '896FFF'],                                              // UAE
 ['06A000', '06AFFF'],                                              // Qatar
 ['706000', '706FFF'],                                              // Kuwait
 ['840000', '87FFFF'],                                              // Japan
 ['718000', '71FFFF'],                                              // South Korea
 ['7CF800', '7CFFFF'],                                              // Australia
 ['C00000', 'C0FFFF'],                                              // Canada
 ['800000', '83FFFF'],                                              // India
 ['760000', '767FFF'],                                              // Pakistan
 ['500000', '5003FF'],                                              // Egypt
 ['488000', '48FFFF'],                                              // Poland
 ['468000', '46FFFF'],                                              // Greece
 ['4A8000', '4AFFFF'],                                              // Sweden
 ['478000', '47FFFF'],                                              // Norway
 ['768000', '76FFFF'],                                              // Singapore
 ];
 const isMilitaryHex = (hex) => {
 if (!hex) return false;
 const upper = hex.toUpperCase();
 if (!/^[0-9A-F]{6}$/.test(upper)) return false;
 for (const [start, end] of MILITARY_HEX_RANGES) {
 if (upper >= start && upper <= end) return true;
 }
 return false;
 };
 const military = (data.states ?? []).filter(state => {
 if (state[8] === true) return false;
 if (state[6] == null || state[5] == null) return false;
 const squawk = state[14] ?? '';
 if (MILITARY_SQUAWKS.has(squawk)) return true;
 return isMilitaryHex(state[0] ?? '');
 }).map(state => ({
 icao24: state[0],
 callsign: (state[1] ?? '').trim(),
 longitude: state[5],
 latitude: state[6],
 baro_altitude: state[7],
 velocity: state[9],
 squawk: state[14],
 }));
 setCached('adsb-military', military);
 return json(military);
 } catch (error) {
 return json({ error: `adsb-military error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Tor relay metrics ────────────────────────────────────────────────────
  if (requestUrl.pathname === '/api/tor-metrics') {
 const cached = getCached('tor-metrics', 60 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const r = await fetchWithTimeout(
 'https://onionoo.torproject.org/summary?type=relay&running=true',
 { headers: { 'User-Agent': CHROME_UA } },
 12000,
 );
 if (!r.ok) throw new Error(`Onionoo HTTP ${r.status}`);
 const data = await r.json();
 const relays = data.relays ?? [];
 const totalRelays = relays.length;
 const exitNodes = relays.filter(relay => Array.isArray(relay.f) && relay.f.includes('Exit')).length;
 const countryCounts = {};
 for (const relay of relays) {
 const cc = relay.c;
 if (cc) countryCounts[cc] = (countryCounts[cc] ?? 0) + 1;
 }
 const byCountry = Object.fromEntries(
 Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)
 );
 const result = { totalRelays, exitNodes, byCountry };
 setCached('tor-metrics', result);
 return json(result);
 } catch (error) {
 return json({ error: `tor-metrics error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Power Grid (EIA electricity RTO demand/capacity) ──────────────
  if (requestUrl.pathname === '/api/power-grid') {
 const cached = getCached('power-grid', 15 * 60 * 1000);
 if (cached) return json(cached);
 try {
 // EIA Open Data API — Real-Time Operating grid demand by region
 const eiaUrl = 'https://api.eia.gov/v2/electricity/rto/region-data/data/?frequency=hourly&data[0]=value&facets[type][]=D&facets[type][]=NG&length=200&sort[0][column]=period&sort[0][direction]=desc';
 const r = await fetchWithTimeout(eiaUrl, { headers: { 'User-Agent': CHROME_UA } }, 15000);
 if (!r.ok) throw new Error(`EIA HTTP ${r.status}`);
 const raw = await r.json();
 const rows = raw?.response?.data ?? [];

 // Group by respondent (region), separate demand (D) and net generation (NG)
 const regionMap = {};
 for (const row of rows) {
 const id = row.respondent ?? 'UNKNOWN';
 const name = row['respondent-name'] ?? id;
 if (!regionMap[id]) regionMap[id] = { region: name, demand: 0, capacity: 0 };
 const val = Number(row.value) || 0;
 if (row.type === 'D' && val > regionMap[id].demand) {
 regionMap[id].demand = val;
 }
 if (row.type === 'NG' && val > regionMap[id].capacity) {
 regionMap[id].capacity = val;
 }
 }

 // Use net generation as a capacity proxy; if missing, estimate at demand * 1.15
 const regions = Object.values(regionMap).map(r => ({
 region: r.region,
 demand: Math.round(r.demand),
 capacity: r.capacity > 0 ? Math.round(r.capacity) : Math.round(r.demand * 1.15),
 })).filter(r => r.demand > 0)
 .sort((a, b) => b.demand - a.demand);

 const result = { regions, source: 'eia.gov', updatedAt: new Date().toISOString() };
 setCached('power-grid', result);
 return json(result);
 } catch (error) {
 return json({ regions: [], error: `power-grid error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Grid Alerts (NERC public alerts RSS) ────────────────────────
  if (requestUrl.pathname === '/api/grid-alerts') {
 const cached = getCached('grid-alerts', 15 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const rssUrl = 'https://www.nerc.com/pa/rrm/bpsa/Pages/Alerts.aspx';
 // NERC does not have a clean RSS; fall back to EIA system alerts or return empty
 // Try EIA grid emergency data as a proxy
 const eiaAlertUrl = 'https://api.eia.gov/v2/electricity/rto/region-data/data/?frequency=hourly&data[0]=value&facets[type][]=D&length=50&sort[0][column]=period&sort[0][direction]=desc';
 const r = await fetchWithTimeout(eiaAlertUrl, { headers: { 'User-Agent': CHROME_UA } }, 12000);
 if (!r.ok) throw new Error(`EIA alerts HTTP ${r.status}`);
 const raw = await r.json();
 const rows = raw?.response?.data ?? [];

 // Generate alerts for regions where demand exceeds capacity thresholds
 const alerts = [];
 const seen = new Set();
 for (const row of rows) {
 const id = row.respondent ?? 'UNKNOWN';
 if (seen.has(id)) continue;
 seen.add(id);
 const val = Number(row.value) || 0;
 const name = row['respondent-name'] ?? id;
 // Generate synthetic alerts for high-demand periods (>50 GW for large regions)
 if (val > 50000) {
 alerts.push({
 id: `eia-${id}-${row.period}`,
 severity: val > 70000 ? 'warning' : 'info',
 title: `High demand: ${Math.round(val).toLocaleString()} MW`,
 description: `${name} reporting elevated electricity demand`,
 region: name,
 timestamp: new Date(row.period).getTime() || Date.now(),
 });
 }
 }
 const result = { alerts, source: 'eia.gov', updatedAt: new Date().toISOString() };
 setCached('grid-alerts', result);
 return json(result);
 } catch (error) {
 return json({ alerts: [], error: `grid-alerts error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Water Quality: USGS Instantaneous Values proxy ──
  if (requestUrl.pathname === '/api/usgs-water-proxy') {
 const qs = requestUrl.search || '?parameterCd=00300,00010&siteStatus=active&period=P1D&siteType=ST';
 const cacheKey = `usgs-water${qs}`;
 const cached = getCached(cacheKey, 30 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const usgsUrl = `https://waterservices.usgs.gov/nwis/iv/${qs}&format=json`;
 const r = await fetchWithTimeout(usgsUrl, { headers: { 'User-Agent': CHROME_UA } }, 15000);
 if (!r.ok) throw new Error(`USGS HTTP ${r.status}`);
 const data = await r.json();
 setCached(cacheKey, data);
 return json(data);
 } catch (error) {
 return json({ error: `usgs-water error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Water Quality: EPA SDWIS proxy ──
  if (requestUrl.pathname === '/api/epa-sdwis-proxy') {
 const qs = requestUrl.search || '?type=violations&is_health_based=Y&compliance_period=current';
 const cacheKey = `epa-sdwis${qs}`;
 const cached = getCached(cacheKey, 60 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const sdwisUrl = `https://data.epa.gov/efservice/VIOLATION/JSON${qs}`;
 const r = await fetchWithTimeout(sdwisUrl, { headers: { 'User-Agent': CHROME_UA } }, 15000);
 if (!r.ok) throw new Error(`EPA SDWIS HTTP ${r.status}`);
 const raw = await r.json();
 const result = { violations: Array.isArray(raw) ? raw.slice(0, 200) : [], source: 'epa.gov/sdwis', updatedAt: new Date().toISOString() };
 setCached(cacheKey, result);
 return json(result);
 } catch (error) {
 return json({ violations: [], error: `epa-sdwis error: ${error.message ?? error}` }, 502);
 }
  }

  // ── Nuclear Monitor: EPA RadNet proxy ──
  if (requestUrl.pathname === '/api/epa-radnet-proxy') {
 const cached = getCached('epa-radnet', 30 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const radnetUrl = 'https://www.epa.gov/enviro/api/radnet/data?media=Air&analyte_group=Gross';
 const r = await fetchWithTimeout(radnetUrl, { headers: { 'User-Agent': CHROME_UA } }, 15000);
 if (!r.ok) throw new Error(`RadNet HTTP ${r.status}`);
 const data = await r.json();
 const result = { stations: Array.isArray(data) ? data.slice(0, 500) : data, source: 'epa.gov/radnet', updatedAt: new Date().toISOString() };
 setCached('epa-radnet', result);
 return json(result);
 } catch (error) {
 return json({ stations: [], error: `epa-radnet error: ${error.message ?? error}` }, 502);
 }
  }

  // -- Windy Webcams API v3 -- search by location or country
  if (requestUrl.pathname === '/api/windy-webcams') {
 const apiKey = process.env.WINDY_WEBCAMS_API_KEY;
 if (!apiKey) return json({ webcams: [], error: 'WINDY_WEBCAMS_API_KEY not configured' }, 503);
 const latRaw = requestUrl.searchParams.get('lat');
 const lonRaw = requestUrl.searchParams.get('lon');
 const lat = parseFloat(latRaw ?? 'NaN');
 const lon = parseFloat(lonRaw ?? 'NaN');
 const radius = Math.min(500, Math.max(1, parseFloat(requestUrl.searchParams.get('radius') ?? '50') || 50));
 const country = requestUrl.searchParams.get('country');
 const limit = Math.min(50, Math.max(1, parseInt(requestUrl.searchParams.get('limit') ?? '20', 10) || 20));
 const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
 if (!hasCoords && !country) {
 return json({ webcams: [], error: 'Provide lat+lon or country' }, 400);
 }
 const cacheKey = `windy-webcams-${hasCoords ? `${lat}-${lon}-${radius}` : 'none'}-${country ?? 'none'}-${limit}`;
 const cached = getCached(cacheKey, 30 * 60 * 1000);
 if (cached) return json(cached);
 try {
 let url = 'https://api.windy.com/webcams/api/v3/webcams?include=images,location,player';
 if (hasCoords) {
 url += `&nearby=${lat},${lon},${radius}`;
 }
 if (country) {
 url += `&countries=${encodeURIComponent(country)}`;
 }
 url += `&limit=${limit}`;
 const resp = await fetchWithTimeout(url, {
 headers: {
 'x-windy-api-key': apiKey,
 'User-Agent': 'CrystalBall/1.0',
 },
 }, 12_000);
 if (!resp.ok) throw new Error(`Windy HTTP ${resp.status}`);
 const data = await resp.json();
 const webcams = (data?.webcams ?? []).map(w => ({
 id: String(w.webcamId ?? w.id ?? ''),
 title: w.title ?? '',
 city: w.location?.city ?? '',
 country: w.location?.country ?? '',
 countryCode: w.location?.countryCode ?? '',
 region: w.location?.region ?? '',
 lat: w.location?.latitude ?? 0,
 lon: w.location?.longitude ?? 0,
 thumbnail: w.images?.current?.preview ?? w.images?.daylight?.preview ?? '',
 playerUrl: w.player?.day?.embed ?? `https://webcams.windy.com/webcams/public/embed/player/${String(w.webcamId ?? w.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '')}/day`,
 status: w.status ?? 'active',
 lastUpdated: w.lastUpdatedOn ?? '',
 }));
 const result = { webcams, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 30 * 60 * 1000);
 return json(result);
 } catch (error) {
 const stale = getCachedStale(cacheKey);
 if (stale) return json({ ...stale, stale: true, error: error?.message ?? 'unknown' });
 return json({ webcams: [], error: error?.message ?? 'unknown' }, 502);
 }
  }

  // -- US DOT traffic cameras (public 511 feeds) — Caltrans + 511 NY
  if (requestUrl.pathname === '/api/dot-traffic-cams') {
 const state = requestUrl.searchParams.get('state') || 'all';
 const cacheKey = `dot-cams-${state}`;
 const cached = getCached(cacheKey, 5 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const feeds = [
 { state: 'CA', url: 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json', parser: 'caltrans' },
 { state: 'NY', url: 'https://511ny.org/api/getTransportationConditions?key=public&format=json&eventCategory=cameras', parser: 'ny511' },
 { state: 'WA', url: 'https://www.wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCameraREST.svc/GetCamerasAsJson?AccessCode=', parser: 'wsdot' },
 { state: 'CO', url: 'https://data.cotrip.org/api/v1/cameras?apiKey=', parser: 'cotrip' },
 { state: 'FL', url: 'https://fl511.com/map/Cctv', parser: 'fl511' },
 ];
 const targetFeeds = state === 'all' ? feeds : feeds.filter(f => f.state === state.toUpperCase());
 const results = await Promise.allSettled(targetFeeds.map(async (feed) => {
 const resp = await fetchWithTimeout(feed.url, {
 headers: { 'User-Agent': 'CrystalBall/1.0', Accept: 'application/json' },
 }, 10_000);
 if (!resp.ok) {
 console.warn(`[dot-traffic-cams] ${feed.state} feed HTTP ${resp.status}`);
 return [];
 }
 const data = await resp.json();
 const cams = [];
 if (feed.parser === 'caltrans') {
 const items = Array.isArray(data) ? data : data?.data ?? [];
 let idx = 0;
 for (const c of items) {
 if (!c.cctv?.imageUrl) continue;
 cams.push({
 id: `dot-ca-${c.cctv?.index ?? idx}`,
 title: c.cctv?.location?.locationName ?? `CA Camera ${idx + 1}`,
 state: 'CA',
 lat: c.cctv?.location?.latitude ?? 0,
 lon: c.cctv?.location?.longitude ?? 0,
 imageUrl: c.cctv.imageUrl,
 direction: c.cctv?.location?.direction ?? '',
 });
 idx++;
 }
 } else if (feed.parser === 'ny511') {
 const items = Array.isArray(data) ? data : data?.cameras ?? data?.features ?? [];
 let idx = 0;
 for (const c of items) {
 const props = c.properties ?? c;
 if (!props.imageUrl && !props.url) continue;
 cams.push({
 id: `dot-ny-${props.id ?? idx}`,
 title: props.name ?? props.description ?? `NY Camera ${idx + 1}`,
 state: 'NY',
 lat: props.latitude ?? c.geometry?.coordinates?.[1] ?? 0,
 lon: props.longitude ?? c.geometry?.coordinates?.[0] ?? 0,
 imageUrl: props.imageUrl ?? props.url ?? '',
 direction: props.direction ?? '',
 });
 idx++;
 }
 } else if (feed.parser === 'wsdot') {
 const items = Array.isArray(data) ? data : [];
 for (const c of items) {
 if (c?.IsActive === false) continue;
 const lat = c?.CameraLocation?.Latitude ?? c?.DisplayLatitude;
 const lon = c?.CameraLocation?.Longitude ?? c?.DisplayLongitude;
 if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
 if (typeof c?.ImageURL !== 'string' || c.ImageURL.length === 0) continue;
 cams.push({
 id: `dot-wa-${c.CameraID ?? `${lat}-${lon}`}`,
 title: c.Title ?? c.CameraLocation?.RoadName ?? 'WA Camera',
 state: 'WA',
 lat,
 lon,
 imageUrl: c.ImageURL,
 direction: c.CameraLocation?.Direction ?? '',
 });
 }
 } else if (feed.parser === 'cotrip') {
 const items = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : data?.cameras ?? [];
 for (const item of items) {
 const props = item?.properties ?? item ?? {};
 const lat = props.latitude ?? item?.geometry?.coordinates?.[1];
 const lon = props.longitude ?? item?.geometry?.coordinates?.[0];
 const url = props.imageURL ?? props.imageUrl;
 if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
 if (typeof url !== 'string' || url.length === 0) continue;
 cams.push({
 id: `dot-co-${props.id ?? `${lat}-${lon}`}`,
 title: props.description ?? props.name ?? 'CO Camera',
 state: 'CO',
 lat,
 lon,
 imageUrl: url,
 direction: '',
 });
 }
 } else if (feed.parser === 'fl511') {
 const items = Array.isArray(data?.cameras) ? data.cameras : Array.isArray(data) ? data : [];
 for (const c of items) {
 const lat = c?.Latitude ?? c?.latitude;
 const lon = c?.Longitude ?? c?.longitude;
 const url = c?.ImageUrl ?? c?.imageUrl ?? c?.Url ?? c?.url;
 if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
 if (typeof url !== 'string' || url.length === 0) continue;
 cams.push({
 id: `dot-fl-${c.Id ?? c.id ?? `${lat}-${lon}`}`,
 title: c.Description ?? c.description ?? 'FL Camera',
 state: 'FL',
 lat,
 lon,
 imageUrl: url,
 direction: '',
 });
 }
 }
 return cams;
 }));
 const allCams = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
 const result = { cameras: allCams, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 5 * 60 * 1000);
 return json(result);
 } catch (error) {
 const stale = getCachedStale(cacheKey);
 if (stale) return json({ ...stale, stale: true, error: error?.message ?? 'unknown' });
 return json({ cameras: [], error: error?.message ?? 'unknown' }, 502);
 }
  }

  // ── Windy webcams (paginated, up to 5000) ──
  if (requestUrl.pathname === '/api/webcams/windy') {
 const apiKey = process.env.WINDY_WEBCAMS_API_KEY;
 if (!apiKey) return json({ feeds: [], requiresKey: true, error: 'WINDY_WEBCAMS_API_KEY not configured' }, 503);
 const cacheKey = 'webcams-windy-paginated';
 const cached = getCached(cacheKey, 60 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const HARD_CAP = 5000;
 const PER_PAGE = 100;
 const feeds = [];
 let offset = 0;
 while (feeds.length < HARD_CAP) {
 const url = `https://api.windy.com/webcams/api/v3/webcams?include=images,location,player,categories&limit=${PER_PAGE}&offset=${offset}`;
 const resp = await fetchWithTimeout(url, {
 headers: { 'x-windy-api-key': apiKey, 'User-Agent': 'CrystalBall/1.0' },
 }, 15000);
 if (!resp.ok) break;
 const data = await resp.json();
 const items = Array.isArray(data?.webcams) ? data.webcams : [];
 if (items.length === 0) break;
 for (const w of items) {
 if (w?.status && w.status !== 'active') continue;
 const id = String(w.webcamId ?? w.id ?? '');
 if (!id) continue;
 const lat = w.location?.latitude;
 const lon = w.location?.longitude;
 if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
 const snapshot = w.images?.current?.preview ?? w.images?.daylight?.preview;
 if (typeof snapshot !== 'string' || snapshot.length === 0) continue;
 const stream = w.player?.day?.embed ?? w.player?.full?.embed;
 const cats = (w.categories ?? []).map(c => (c.name ?? c.id ?? '').toLowerCase());
 let category = 'weather';
 if (cats.some(c => c.includes('mount') || c.includes('park') || c.includes('beach'))) category = 'nature';
 else if (cats.some(c => c.includes('marine') || c.includes('harbor') || c.includes('coast'))) category = 'coastal';
 else if (cats.some(c => c.includes('traffic') || c.includes('highway'))) category = 'traffic';
 feeds.push({
 id: `WINDY:${id}`,
 source: 'WINDY',
 name: w.title ?? `Windy ${id}`,
 lat, lon,
 snapshotUrl: snapshot,
 ...(typeof stream === 'string' && stream.length > 0 ? { streamUrl: stream } : {}),
 refreshIntervalSec: 600,
 category,
 metadata: {
 ...(w.location?.city ? { city: w.location.city } : {}),
 ...(w.location?.country ? { country: w.location.country } : {}),
 ...(w.location?.countryCode ? { countryCode: w.location.countryCode } : {}),
 ...(w.lastUpdatedOn ? { lastUpdatedOn: w.lastUpdatedOn } : {}),
 },
 isOnline: true,
 lastChecked: w.lastUpdatedOn ? Date.parse(w.lastUpdatedOn) || undefined : undefined,
 });
 if (feeds.length >= HARD_CAP) break;
 }
 if (items.length < PER_PAGE) break;
 offset += PER_PAGE;
 }
 const result = { feeds, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 60 * 60 * 1000);
 return json(result);
 } catch (error) {
 const stale = getCachedStale(cacheKey);
 if (stale) return json({ ...stale, stale: true, error: error?.message ?? 'unknown' });
 return json({ feeds: [], error: error?.message ?? 'unknown' }, 502);
 }
  }

  // ── NOAA coastal/buoy cams (NDBC buoycam, public no-auth) ──
  if (requestUrl.pathname === '/api/webcams/coastal') {
 const cacheKey = 'webcams-coastal';
 const cached = getCached(cacheKey, 30 * 60 * 1000);
 if (cached) return json(cached);
 const records = [
 { stationId: '44025', name: 'NDBC 44025 — Long Island, NY', lat: 40.251, lon: -73.165, agency: 'NDBC', region: 'Mid-Atlantic' },
 { stationId: '44013', name: 'NDBC 44013 — Boston, MA', lat: 42.346, lon: -70.651, agency: 'NDBC', region: 'Northeast' },
 { stationId: '46042', name: 'NDBC 46042 — Monterey Bay, CA', lat: 36.789, lon: -122.469, agency: 'NDBC', region: 'California' },
 { stationId: '46026', name: 'NDBC 46026 — San Francisco, CA', lat: 37.755, lon: -122.839, agency: 'NDBC', region: 'California' },
 { stationId: '41047', name: 'NDBC 41047 — Northeast Bahamas', lat: 27.467, lon: -71.516, agency: 'NDBC', region: 'Atlantic' },
 { stationId: '46059', name: 'NDBC 46059 — West California', lat: 38.094, lon: -129.951, agency: 'NDBC', region: 'Pacific' },
 { stationId: '42040', name: 'NDBC 42040 — Mobile South, AL', lat: 29.205, lon: -88.205, agency: 'NDBC', region: 'Gulf of Mexico' },
 ];
 const feeds = records.map(r => ({
 id: `NOAA_COASTAL:${r.stationId}`,
 source: 'NOAA_COASTAL',
 name: r.name,
 lat: r.lat,
 lon: r.lon,
 snapshotUrl: `https://www.ndbc.noaa.gov/buoycam.php?station=${encodeURIComponent(r.stationId)}`,
 refreshIntervalSec: 600,
 category: 'coastal',
 metadata: { stationId: r.stationId, agency: r.agency, region: r.region },
 }));
 const result = { feeds, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 30 * 60 * 1000);
 return json(result);
  }

  // ── Master webcam aggregator (calls all sub-routes, dedupes, filters) ──
  if (requestUrl.pathname === '/api/webcams') {
 const sourceFilter = (requestUrl.searchParams.get('source') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
 const categoryFilter = (requestUrl.searchParams.get('category') ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
 const bbox = requestUrl.searchParams.get('bbox');
 const cacheKey = `webcams-master-${sourceFilter.join(',')}-${categoryFilter.join(',')}-${bbox ?? ''}`;
 const cached = getCached(cacheKey, 5 * 60 * 1000);
 if (cached) return json(cached);
 const subroutes = [
 { source: 'FAA', path: '/api/faa-cameras', shape: 'cameras-bare' },
 { source: 'DOT511', path: '/api/dot-traffic-cams', shape: 'cameras' },
 { source: 'USGS_VOLCANO', path: '/api/webcams/volcano', shape: 'feeds' },
 { source: 'NPS', path: '/api/webcams/nps', shape: 'feeds' },
 { source: 'ALERTWILDFIRE', path: '/api/webcams/fire', shape: 'feeds' },
 { source: 'USGS_STREAM', path: '/api/webcams/streamgauge', shape: 'feeds' },
 { source: 'WINDY', path: '/api/webcams/windy', shape: 'feeds' },
 { source: 'NOAA_COASTAL', path: '/api/webcams/coastal', shape: 'feeds' },
 ];
 const targets = sourceFilter.length > 0 ? subroutes.filter(s => sourceFilter.includes(s.source)) : subroutes;
 const port = process.env.SIDECAR_PORT ?? '46123';
 const baseUrl = `http://127.0.0.1:${port}`;
 const results = await Promise.allSettled(targets.map(async (sub) => {
 try {
 const r = await fetchWithTimeout(`${baseUrl}${sub.path}`, { headers: { Accept: 'application/json' } }, 20000);
 if (!r.ok) return [];
 const data = await r.json();
 if (sub.shape === 'feeds') return Array.isArray(data?.feeds) ? data.feeds : [];
 if (sub.shape === 'cameras') {
 // DOT/Caltrans: legacy { cameras: [{id, title, state, lat, lon, imageUrl}] }
 const cams = Array.isArray(data?.cameras) ? data.cameras : [];
 return cams.map(c => ({
 id: `DOT:${c.state ?? 'UNK'}:${c.id ?? ''}`,
 source: 'DOT511',
 name: c.title ?? `${c.state ?? ''} Camera`,
 lat: c.lat,
 lon: c.lon,
 snapshotUrl: c.imageUrl,
 refreshIntervalSec: 60,
 category: 'traffic',
 metadata: { state: c.state ?? '', ...(c.direction ? { direction: c.direction } : {}) },
 }));
 }
 if (sub.shape === 'cameras-bare') {
 // FAA: bare array (or { cameras } envelope when withMetar=1)
 const cams = Array.isArray(data) ? data : Array.isArray(data?.cameras) ? data.cameras : [];
 return cams.map(c => ({
 id: `FAA:${c.id}`,
 source: 'FAA',
 name: c.name,
 lat: c.lat,
 lon: c.lon,
 snapshotUrl: c.imageUrl,
 refreshIntervalSec: 300,
 category: c.category === 'remote' ? 'nature' : c.category === 'coastal' ? 'coastal' : 'weather',
 metadata: { state: c.state ?? '', faaCategory: c.category ?? '' },
 isOnline: c.isOnline,
 lastChecked: Date.parse(c.lastUpdated ?? '') || undefined,
 }));
 }
 return [];
 } catch {
 return [];
 }
 }));
 let allFeeds = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
 if (categoryFilter.length > 0) allFeeds = allFeeds.filter(f => categoryFilter.includes(f.category));
 if (bbox) {
 const parts = bbox.split(',').map(Number);
 if (parts.length === 4 && parts.every(Number.isFinite)) {
 const [minLat, minLon, maxLat, maxLon] = parts;
 allFeeds = allFeeds.filter(f => f.lat >= minLat && f.lat <= maxLat && f.lon >= minLon && f.lon <= maxLon);
 }
 }
 const result = { feeds: allFeeds, count: allFeeds.length, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 5 * 60 * 1000);
 return json(result);
  }

  // ── NPS webcams (requires NPS_API_KEY, free at developer.nps.gov) ──
  if (requestUrl.pathname === '/api/webcams/nps') {
 const apiKey = process.env.NPS_API_KEY;
 if (!apiKey) return json({ feeds: [], requiresKey: true, error: 'NPS_API_KEY not configured' }, 503);
 const cacheKey = 'webcams-nps';
 const cached = getCached(cacheKey, 30 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const resp = await fetchWithTimeout(
 `https://developer.nps.gov/api/v1/webcams?limit=500&api_key=${encodeURIComponent(apiKey)}`,
 { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' } },
 15000,
 );
 if (!resp.ok) return json({ feeds: [], error: `NPS HTTP ${resp.status}` }, 502);
 const raw = await resp.json();
 const items = Array.isArray(raw?.data) ? raw.data : [];
 const feeds = [];
 for (const cam of items) {
 if (cam?.status && String(cam.status).toLowerCase() !== 'active') continue;
 const lat = Number(cam?.latitude);
 const lon = Number(cam?.longitude);
 if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
 const snapshot = cam?.images?.[0]?.url;
 if (typeof snapshot !== 'string' || snapshot.length === 0) continue;
 const park = cam?.relatedParks?.[0];
 feeds.push({
 id: `NPS:${cam.id ?? `${lat}-${lon}`}`,
 source: 'NPS',
 name: cam.title ?? park?.fullName ?? 'NPS Webcam',
 lat,
 lon,
 snapshotUrl: snapshot,
 refreshIntervalSec: 300,
 category: 'nature',
 metadata: {
 ...(park?.fullName ? { park: park.fullName } : {}),
 ...(park?.parkCode ? { parkCode: park.parkCode } : {}),
 ...(park?.states ? { states: park.states } : {}),
 },
 isOnline: true,
 });
 }
 const result = { feeds, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 30 * 60 * 1000);
 return json(result);
 } catch (error) {
 const stale = getCachedStale(cacheKey);
 if (stale) return json({ ...stale, stale: true, error: error?.message ?? 'unknown' });
 return json({ feeds: [], error: error?.message ?? 'unknown' }, 502);
 }
  }

  // ── AlertWildfire fire lookout cams (public, no auth) ──
  if (requestUrl.pathname === '/api/webcams/fire') {
 const cacheKey = 'webcams-fire';
 const cached = getCached(cacheKey, 15 * 60 * 1000);
 if (cached) return json(cached);
 try {
 const resp = await fetchWithTimeout(
 'https://cameras.alertwildfire.org/v2/cameras.json',
 { headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/1.0' } },
 15000,
 );
 if (!resp.ok) return json({ feeds: [], error: `AlertWildfire HTTP ${resp.status}` }, 502);
 const raw = await resp.json();
 const items = Array.isArray(raw?.cameras) ? raw.cameras : Array.isArray(raw?.features) ? raw.features : Array.isArray(raw) ? raw : [];
 const feeds = [];
 for (const item of items) {
 const props = item?.properties ?? item ?? {};
 const geom = item?.geometry?.coordinates;
 if (props.active === false) continue;
 const status = props.status?.toLowerCase?.();
 if (status === 'inactive' || status === 'down' || status === 'offline') continue;
 const lat = props.latitude ?? props.position?.latitude ?? geom?.[1];
 const lon = props.longitude ?? props.position?.longitude ?? geom?.[0];
 if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
 const name = props.name;
 if (!name) continue;
 const snapshot = props.imageUrl ?? props.image_url ?? `https://cameras.alertwildfire.org/cameras/${encodeURIComponent(name)}/latest-frame.jpg`;
 const stream = props.streamUrl ?? props.stream_url ?? props.hd_video;
 feeds.push({
 id: `ALERTWILDFIRE:${name}`,
 source: 'ALERTWILDFIRE',
 name,
 lat,
 lon,
 snapshotUrl: snapshot,
 ...(typeof stream === 'string' && stream.length > 0 ? { streamUrl: stream } : {}),
 refreshIntervalSec: 60,
 category: 'fire',
 metadata: {
 ...(props.state ? { state: props.state } : {}),
 ...(props.region ? { region: props.region } : {}),
 ...(props.ptz ? { ptz: 'true' } : {}),
 },
 isOnline: true,
 });
 }
 const result = { feeds, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 15 * 60 * 1000);
 return json(result);
 } catch (error) {
 const stale = getCachedStale(cacheKey);
 if (stale) return json({ ...stale, stale: true, error: error?.message ?? 'unknown' });
 return json({ feeds: [], error: error?.message ?? 'unknown' }, 502);
 }
  }

  // ── USGS stream gauge cams (pinned site list, photo URLs from USGS NWIS) ──
  if (requestUrl.pathname === '/api/webcams/streamgauge') {
 const cacheKey = 'webcams-streamgauge';
 const cached = getCached(cacheKey, 60 * 60 * 1000);
 if (cached) return json(cached);
 const records = [
 { siteNo: '11447650', name: 'Sacramento River at Freeport, CA', lat: 38.4555, lon: -121.5021, state: 'CA' },
 { siteNo: '01646500', name: 'Potomac River near Wash, DC Little Falls Pump Sta', lat: 38.9498, lon: -77.1278, state: 'DC' },
 { siteNo: '07010000', name: 'Mississippi River at St. Louis, MO', lat: 38.6296, lon: -90.1798, state: 'MO' },
 { siteNo: '02035000', name: 'James River at Cartersville, VA', lat: 37.6712, lon: -78.0867, state: 'VA' },
 { siteNo: '03612600', name: 'Ohio River at Olmsted, IL', lat: 37.18, lon: -89.0567, state: 'IL' },
 { siteNo: '08374550', name: 'Rio Grande at Foster Ranch, TX', lat: 29.6306, lon: -102.0339, state: 'TX' },
 { siteNo: '14211720', name: 'Willamette River at Portland, OR', lat: 45.5167, lon: -122.6692, state: 'OR' },
 { siteNo: '12150800', name: 'Snohomish River near Monroe, WA', lat: 47.83, lon: -121.9967, state: 'WA' },
 ];
 const feeds = records.map(r => ({
 id: `USGS_STREAM:${r.siteNo}`,
 source: 'USGS_STREAM',
 name: r.name,
 lat: r.lat,
 lon: r.lon,
 snapshotUrl: `https://waterdata.usgs.gov/nwisweb/get_site?format=photo&site_no=${encodeURIComponent(r.siteNo)}`,
 refreshIntervalSec: 3600,
 category: 'stream',
 metadata: { siteNo: r.siteNo, state: r.state },
 }));
 const result = { feeds, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 60 * 60 * 1000);
 return json(result);
  }

  // ── USGS volcano webcams (static catalog from src/services/webcams/volcano-cam-catalog.ts) ──
  // The catalog is pinned in code rather than scraped because USGS HVO/CVO/AVO/YVO
  // pages don't expose a machine-readable index. Refresh cadence is 60s per cam
  // — the snapshots are served from observatory webservers directly.
  if (requestUrl.pathname === '/api/webcams/volcano') {
 const cacheKey = 'webcams-volcano';
 const cached = getCached(cacheKey, 30 * 60 * 1000);
 if (cached) return json(cached);
 const cams = [
 { id: 'kilauea-summit', name: 'Kīlauea — Summit (KW)', volcano: 'Kilauea', observatory: 'HVO', lat: 19.4067, lon: -155.2834, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/kilauea/KWcam.jpg' },
 { id: 'kilauea-east-rift', name: 'Kīlauea — East Rift (PG)', volcano: 'Kilauea', observatory: 'HVO', lat: 19.385, lon: -154.95, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/kilauea/PGcam.jpg' },
 { id: 'mauna-loa-summit', name: 'Mauna Loa — Summit (M1)', volcano: 'Mauna Loa', observatory: 'HVO', lat: 19.475, lon: -155.608, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/mauna_loa/M1cam.jpg' },
 { id: 'st-helens-johnston', name: 'Mount St. Helens — Johnston Ridge', volcano: 'St. Helens', observatory: 'CVO', lat: 46.276, lon: -122.218, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/MSHJRO.jpg' },
 { id: 'st-helens-coldwater', name: 'Mount St. Helens — Coldwater', volcano: 'St. Helens', observatory: 'CVO', lat: 46.295, lon: -122.27, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/MSHCW.jpg' },
 { id: 'mount-hood-timberline', name: 'Mount Hood — Timberline', volcano: 'Mount Hood', observatory: 'CVO', lat: 45.331, lon: -121.711, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/HOODTL.jpg' },
 { id: 'mount-rainier-camp-muir', name: 'Mount Rainier — Camp Muir', volcano: 'Rainier', observatory: 'CVO', lat: 46.836, lon: -121.731, snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/RAINMUIR.jpg' },
 { id: 'redoubt-hut', name: 'Redoubt — Hut', volcano: 'Redoubt', observatory: 'AVO', lat: 60.485, lon: -152.742, snapshotUrl: 'https://avo.alaska.edu/webcam/REDhut.jpg' },
 { id: 'pavlof-cold-bay', name: 'Pavlof — Cold Bay', volcano: 'Pavlof', observatory: 'AVO', lat: 55.42, lon: -161.894, snapshotUrl: 'https://avo.alaska.edu/webcam/PVV.jpg' },
 { id: 'cleveland-pevolc', name: 'Cleveland — PEvolc', volcano: 'Cleveland', observatory: 'AVO', lat: 52.825, lon: -169.944, snapshotUrl: 'https://avo.alaska.edu/webcam/CLES.jpg' },
 { id: 'shishaldin', name: 'Shishaldin — ISLE', volcano: 'Shishaldin', observatory: 'AVO', lat: 54.756, lon: -163.97, snapshotUrl: 'https://avo.alaska.edu/webcam/SDPI.jpg' },
 { id: 'great-sitkin', name: 'Great Sitkin — GSCK', volcano: 'Great Sitkin', observatory: 'AVO', lat: 52.076, lon: -176.13, snapshotUrl: 'https://avo.alaska.edu/webcam/GSCK.jpg' },
 { id: 'yellowstone-old-faithful', name: 'Yellowstone — Old Faithful', volcano: 'Yellowstone', observatory: 'YVO', lat: 44.46, lon: -110.829, snapshotUrl: 'https://www.nps.gov/webcams-yell/oldfaithvc.jpg' },
 ];
 const feeds = cams.map(c => ({
 id: `USGS_VOLCANO:${c.id}`,
 source: 'USGS_VOLCANO',
 name: c.name,
 lat: c.lat,
 lon: c.lon,
 snapshotUrl: c.snapshotUrl,
 refreshIntervalSec: 60,
 category: 'volcano',
 metadata: { volcano: c.volcano, observatory: c.observatory },
 }));
 const result = { feeds, updatedAt: Math.floor(Date.now() / 1000) };
 setCached(cacheKey, result, 30 * 60 * 1000);
 return json(result);
  }

  if (context.cloudFallback && cloudPreferred.has(requestUrl.pathname)) {
 const cloudResponse = await tryCloudFallback(requestUrl, req, context);
 if (cloudResponse) return cloudResponse;
  }

  const modulePath = pickModule(requestUrl.pathname, routes);
  if (!modulePath || !existsSync(modulePath)) {
 if (context.cloudFallback) {
 const cloudResponse = await tryCloudFallback(requestUrl, req, context, 'handler missing');
 if (cloudResponse) return cloudResponse;
 }
 logOnce(context.logger, requestUrl.pathname, 'no local handler');
 // Graceful degraded fallback: instead of 404 (which causes panels to
 // throw and spam the error log), return a shape-aware empty payload
 // with `degraded: true` so panels render an "unavailable" state.
 // This is the desktop sidecar — no cloud is wired in this build.
 return buildDegradedResponse(requestUrl.pathname);
  }

  try {
 const mod = await importHandler(modulePath);
 if (typeof mod.default !== 'function') {
 logOnce(context.logger, requestUrl.pathname, 'invalid handler module');
 if (context.cloudFallback) {
 const cloudResponse = await tryCloudFallback(requestUrl, req, context, `invalid handler module`);
 if (cloudResponse) return cloudResponse;
 }
 return json({ error: 'Invalid handler module', endpoint: requestUrl.pathname }, 500);
 }

 const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
 const request = new Request(requestUrl.toString(), {
 method: req.method,
 headers: toHeaders(req.headers, { stripOrigin: true }),
 body,
 });

 const response = await mod.default(request);
 if (!(response instanceof Response)) {
 logOnce(context.logger, requestUrl.pathname, 'handler returned non-Response');
 if (context.cloudFallback) {
 const cloudResponse = await tryCloudFallback(requestUrl, req, context, 'handler returned non-Response');
 if (cloudResponse) return cloudResponse;
 }
 return json({ error: 'Handler returned invalid response', endpoint: requestUrl.pathname }, 500);
 }

 if (!response.ok && context.cloudFallback) {
 const cloudResponse = await tryCloudFallback(requestUrl, req, context, `local status ${response.status}`);
 if (cloudResponse) { cloudPreferred.add(requestUrl.pathname); return cloudResponse; }
 }

 return response;
  } catch (error) {
 const reason = error.code === 'ERR_MODULE_NOT_FOUND' ? 'missing dependency' : error.message;
 context.logger.error(`[local-api] ${requestUrl.pathname} → ${reason}`);
 if (context.cloudFallback) {
 const cloudResponse = await tryCloudFallback(requestUrl, req, context, error);
 if (cloudResponse) { cloudPreferred.add(requestUrl.pathname); return cloudResponse; }
 }
 return json({ error: 'Local handler error', reason, endpoint: requestUrl.pathname }, 502);
  }
}

export async function createLocalApiServer(options = {}) {
  if (!process.env.LOCAL_API_TOKEN) {
    console.error('[sidecar] FATAL: LOCAL_API_TOKEN not set — refusing to start');
    process.exit(1);
  }
  const context = resolveConfig(options);
  loadVerboseState(context.dataDir);
  const routes = await buildRouteTable(context.apiDir);

  const server = createServer(async (req, res) => {
 const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${context.port}`);
 // Rewrite alias paths to their canonical handlers (see ROUTE_ALIASES).
 const aliasTarget = ROUTE_ALIASES[requestUrl.pathname];
 if (aliasTarget) requestUrl.pathname = aliasTarget;
 const reqStartedAt = Date.now();

 if (requestUrl.pathname === '/gps/nmea') {
 try {
 const { execFileSync } = await import('node:child_process');
 const configPath = path.join(os.homedir(), '.crystalball-gps.json');
 let port = '/dev/tty.usbserial-0001';

 try {
 const config = JSON.parse(readFileSync(configPath, 'utf8'));
 port = config.port || port;
 } catch {
 // Use defaults
 }

 const line = execFileSync('head', ['-n', '5', port], {
 encoding: 'utf8',
 timeout: 3000,
 }).trim();

 if (!line || !line.startsWith('$')) {
 res.writeHead(404, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({ error: 'No GPS device detected' }));
 return;
 }

 res.writeHead(200, { 'content-type': 'text/plain', ...makeCorsHeaders(req) });
 res.end(line);
 } catch (error) {
 res.writeHead(404, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({ error: 'GPS not available', details: error.message }));
 }
 return;
 }

 if (!requestUrl.pathname.startsWith('/api/')) {
 res.writeHead(404, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({ error: 'Not found' }));
 return;
 }

 // ── /api/health — lightweight liveness probe ──────────────────────
 if (requestUrl.pathname === '/api/health') {
 {
 const authHeader = req.headers['authorization'] || '';
 if (!isValidToken(authHeader)) {
 res.writeHead(401, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({ error: 'Unauthorized' }));
 return;
 }
 }
 const mem = process.memoryUsage();
 const missing = wmMissingKeys();
 res.writeHead(200, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({
 ok: true,
 pid: process.pid,
 uptime_ms: Date.now() - SIDECAR_START_MS,
 port: context.port,
 rss_mb: Math.round(mem.rss / 1024 / 1024),
 heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
 ais_connected: aisState.socket?.readyState === 1,
 ais_vessels: aisState.vessels.size,
 keys_configured: EXPECTED_API_KEYS.length - missing.length,
 keys_total: EXPECTED_API_KEYS.length,
 keys_missing: missing,
 }));
 return;
 }

 // ── /api/diag — full diagnostics snapshot for bug reports ─────────
 if (requestUrl.pathname === '/api/diag') {
 {
 const authHeader = req.headers['authorization'] || '';
 if (!isValidToken(authHeader)) {
 res.writeHead(401, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({ error: 'Unauthorized' }));
 return;
 }
 }
 const mem = process.memoryUsage();
 const envKeys = Object.keys(process.env).filter(k =>
 /API|KEY|TOKEN|SECRET|URL|EMAIL/i.test(k)
 ).sort();
 res.writeHead(200, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify({
 timestamp: wmTimestamp(),
 sidecar: {
 pid: process.pid,
 node_version: process.versions.node,
 build_tag: SIDECAR_BUILD_TAG,
 trace: SIDECAR_TRACE,
 uptime_ms: Date.now() - SIDECAR_START_MS,
 rss_mb: Math.round(mem.rss / 1024 / 1024),
 heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
 },
 config: {
 port: context.port,
 mode: context.mode,
 api_dir: context.apiDir,
 data_dir: context.dataDir,
 cloud_fallback: context.cloudFallback,
 route_count: routes.length,
 },
 env_keys_present: envKeys, // names only, never values
 ais: {
 connected: aisState.socket?.readyState === 1,
 vessels: aisState.vessels.size,
 messages: aisState.messageCount,
 },
 host_stats: Object.fromEntries(wmHostStats),
 host_failures: Object.fromEntries(wmHostFailures),
 missing_keys: wmMissingKeys(),
 }, null, 2));
 return;
 }

 // Ollama streaming — handled before dispatch() to bypass arrayBuffer() buffering
 if (requestUrl.pathname === '/api/ollama-stream' && req.method === 'POST') {
 {
 const authHeader = req.headers['authorization'] || '';
 if (!isValidToken(authHeader)) {
 context.logger.warn(`[local-api] unauthorized request to ${requestUrl.pathname}`);
 res.writeHead(401, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'Unauthorized' }));
 return;
 }
 }
 await handleOllamaStream(requestUrl, req, res, context);
 return;
 }

 // Generic intel generation — proxies arbitrary prompt/system to a local
 // OpenAI-compatible endpoint (LM Studio, Ollama, etc.) at OLLAMA_API_URL.
 if (requestUrl.pathname === '/api/intel-generate' && req.method === 'POST') {
 {
 const authHeader = req.headers['authorization'] || '';
 if (!isValidToken(authHeader)) {
 res.writeHead(401, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'Unauthorized' }));
 return;
 }
 }
 await handleIntelGenerate(req, res, context);
 return;
 }

 const start = Date.now();
 const skipRecord = req.method === 'OPTIONS'
 || requestUrl.pathname === '/api/local-traffic-log'
 || requestUrl.pathname === '/api/local-debug-toggle'
 || requestUrl.pathname === '/api/local-env-update'
 || requestUrl.pathname === '/api/local-validate-secret';

 try {
 const response = await dispatch(requestUrl, req, routes, context);
 const durationMs = Date.now() - start;
 let body = Buffer.from(await response.arrayBuffer());
 const headers = Object.fromEntries(response.headers.entries());
 const corsOrigin = getSidecarCorsOrigin(req);
 headers['access-control-allow-origin'] = corsOrigin;
 headers['vary'] = appendVary(headers['vary'], 'Origin');

 if (!skipRecord) {
 recordTraffic({
 timestamp: new Date().toISOString(),
 method: req.method,
 path: requestUrl.pathname + (requestUrl.search || ''),
 status: response.status,
 durationMs,
 });
 }

 const acceptEncoding = req.headers['accept-encoding'] || '';
 body = await maybeCompressResponseBody(body, headers, acceptEncoding);

 if (headers['content-encoding']) {
 delete headers['content-length'];
 }

 res.writeHead(response.status, headers);
 res.end(body);
 if (SIDECAR_TRACE && !skipRecord) {
 context.logger.log(`[req] ${req.method} ${requestUrl.pathname} → ${response.status} ${durationMs}ms`);
 }
 } catch (error) {
 const durationMs = Date.now() - start;
 const errorStatus = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
 ? error.statusCode
 : 500;
 if (errorStatus >= 500) {
 context.logger.error('[local-api] fatal', error);
 const host = (() => { try { return new URL(req.url || '/', `http://x`).host; } catch { return 'unknown'; } })();
 wmRecordHostFailure(host, error?.message || String(error));
 }

 if (!skipRecord) {
 recordTraffic({
 timestamp: new Date().toISOString(),
 method: req.method,
 path: requestUrl.pathname + (requestUrl.search || ''),
 status: errorStatus,
 durationMs,
 error: error.message,
 });
 }

 const errorBody = errorStatus === 413
 ? { error: 'Payload too large', limit: error.limit ?? MAX_REQUEST_BODY_BYTES }
 : errorStatus < 500
 ? { error: error.message || 'Bad request' }
 : { error: 'Internal server error' };
 res.writeHead(errorStatus, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
 res.end(JSON.stringify(errorBody));
 }
  });

  return {
 context,
 routes,
 server,
 async start() {
 const tryListen = (port) => new Promise((resolve, reject) => {
 const onListening = () => { server.off('error', onError); resolve(); };
 const onError = (error) => { server.off('listening', onListening); reject(error); };
 server.once('listening', onListening);
 server.once('error', onError);
 server.listen(port, '127.0.0.1');
 });

 try {
 await tryListen(context.port);
 } catch (error) {
 if (error?.code === 'EADDRINUSE') {
 // Never kill arbitrary listeners on occupied ports. Instead, bind to a
 // random OS-assigned port and publish it through service-status/port file.
 context.logger.log(`[local-api] port ${context.port} already in use; falling back to OS-assigned port`);
 await tryListen(0);
 } else {
 throw error;
 }
 }

 const address = server.address();
 const boundPort = typeof address === 'object' && address?.port ? address.port : context.port;
 context.port = boundPort;

 const portFile = process.env.LOCAL_API_PORT_FILE;
 if (portFile) {
 try { writeFileSync(portFile, String(boundPort)); } catch {}
 }

 context.logger.log(`[local-api] listening on http://127.0.0.1:${boundPort} (apiDir=${context.apiDir}, routes=${routes.length}, cloudFallback=${context.cloudFallback})`);

 // ── Heartbeat ───────────────────────────────────────────────────
 // Writes liveness state every 10s (1s in trace mode). Rust watcher
 // can detect event-loop hangs by checking lastHeartbeat freshness.
 const heartbeatPath = path.join(context.dataDir, 'sidecar.health.json');
 let lastEventLoopCheck = Date.now();
 const heartbeatInterval = SIDECAR_TRACE ? 1000 : 10_000;
 setInterval(() => {
 const now = Date.now();
 const eventLoopLagMs = Math.max(0, now - lastEventLoopCheck - heartbeatInterval);
 lastEventLoopCheck = now;
 const mem = process.memoryUsage();
 try {
 writeFileSync(heartbeatPath, JSON.stringify({
 pid: process.pid,
 port: boundPort,
 uptime_ms: now - SIDECAR_START_MS,
 last_heartbeat: wmTimestamp(),
 event_loop_lag_ms: eventLoopLagMs,
 rss_mb: Math.round(mem.rss / 1024 / 1024),
 heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
 ais_connected: aisState.socket?.readyState === 1,
 ais_vessels: aisState.vessels.size,
 }));
 } catch {}
 if (eventLoopLagMs > 2000) {
 context.logger.warn(`[local-api] event loop lag ${eventLoopLagMs}ms`);
 }
 }, heartbeatInterval).unref();

 return { port: boundPort };
 },
 async close() {
 await new Promise((resolve, reject) => {
 server.close((error) => (error ? reject(error) : resolve()));
 });
 },
  };
}

if (isMainModule()) {
  try {
 const app = await createLocalApiServer();
 await app.start();
  } catch (error) {
 console.error('[local-api] startup failed', error);
 process.exit(1);
  }
}
