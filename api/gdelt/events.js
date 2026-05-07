/**
 * GDELT 2.0 EVENT real-time poller for the precedent-matcher corpus.
 *
 * Pipeline:
 *   1. GET http://data.gdeltproject.org/gdeltv2/lastupdate.txt
 *      → 3 lines: {size}\t{md5}\t{url} for export, mentions, gkg
 *   2. Pick the export.CSV.zip URL (latest 15-min EVENT slice)
 *   3. Fetch ZIP, extract single-entry deflate-compressed CSV
 *   4. Filter to QuadClass ∈ {3,4} (verbal/material conflict)
 *   5. Apply confidence proxy: NumMentions >= MIN_MENTIONS && AvgTone <= MAX_TONE
 *      (GDELT 2.0's literal "Confidence" field lives in the Mentions table,
 *      not Events. NumMentions corroborates that multiple sources observed
 *      the event, which is the same intent the spec was reaching for.)
 *   6. Map each surviving row to a HistoricalEvent shape compatible with
 *      src/services/synthesis/precedent-matcher.ts
 *
 * Cache: 15 min (matches GDELT's 15-min cadence — never serve stale-by-more
 * than-one-cycle to the corpus). HEAD-only OPTIONS for CORS preflight.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const LASTUPDATE_URL = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

// Tunables — exposed at top so reviewers can adjust without hunting:
const MIN_MENTIONS = 3;     // require at least 3 corroborating articles
const MAX_TONE = -2;        // GDELT AvgTone <= -2 → reporting is negative-leaning
const MAX_EVENTS = 500;     // hard cap on returned rows per cycle

let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const empty = (reason) => ({
  events: [], updatedAt: Date.now(), source: 'gdelt-event-2.0',
  count: 0, degraded: true, reason,
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  try {
    const exportUrl = await pickExportUrl();
    if (!exportUrl) return j(empty('lastupdate.txt missing export entry'), 200, cors);
    const csvText = await fetchAndUnzip(exportUrl);
    const events = parseExportCsv(csvText);
    const result = {
      events, updatedAt: Date.now(),
      source: 'gdelt-event-2.0', count: events.length,
      slice: exportUrl,
    };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(empty(`GDELT fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}

async function pickExportUrl() {
  const r = await fetch(LASTUPDATE_URL, {
    headers: { 'User-Agent': 'CrystalBall (gdelt)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`lastupdate.txt HTTP ${r.status}`);
  const text = await r.text();
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const url = parts[parts.length - 1];
    if (url && url.endsWith('.export.CSV.zip')) return url;
  }
  return null;
}

async function fetchAndUnzip(zipUrl) {
  const r = await fetch(zipUrl, {
    headers: { 'User-Agent': 'CrystalBall (gdelt)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`export.zip HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return await unzipFirstEntry(buf);
}

/** Single-entry ZIP reader — GDELT zips contain exactly one CSV.
 *  Reads the local file header (sig 0x04034b50), pulls out the deflated
 *  blob, and pipes it through DecompressionStream('deflate-raw').
 *  No deps. Intentionally does NOT support ZIP64 / multi-entry / encrypted
 *  archives — GDELT never produces those. */
export async function unzipFirstEntry(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 30) throw new Error('ZIP too small');
  const sig = view.getUint32(0, true);
  if (sig !== 0x04_03_4B_50) throw new Error(`Bad ZIP signature 0x${sig.toString(16)}`);
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const fileNameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = 30 + fileNameLen + extraLen;
  const compressed = arrayBuffer.slice(dataStart, dataStart + compressedSize);
  if (method === 0) return new TextDecoder().decode(compressed);
  if (method !== 8) throw new Error(`Unsupported ZIP compression method ${method}`);
  const stream = new Blob([new Uint8Array(compressed)]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

/** GDELT 2.0 EVENT export columns we read (others are ignored): */
const COL = Object.freeze({
  GLOBALEVENTID: 0,
  Actor1Name: 6,
  Actor1CountryCode: 7,
  Actor2Name: 16,
  Actor2CountryCode: 17,
  EventCode: 26,
  QuadClass: 29,
  GoldsteinScale: 30,
  NumMentions: 31,
  AvgTone: 34,
  ActionGeo_FullName: 52,
  ActionGeo_CountryCode: 53,
  DATEADDED: 59,
  SOURCEURL: 60,
});

/** Per-row predicate: does this CSV row pass the QuadClass / mentions /
 *  tone gates? Returns the parsed signal triple if yes, null if no. */
function rowPasses(cols) {
  if (cols.length < 60) return null;
  const quad = Number.parseInt(cols[COL.QuadClass], 10);
  if (quad !== 3 && quad !== 4) return null;
  const numMentions = Number.parseInt(cols[COL.NumMentions], 10) || 0;
  if (numMentions < MIN_MENTIONS) return null;
  const tone = Number.parseFloat(cols[COL.AvgTone]);
  if (!Number.isFinite(tone) || tone > MAX_TONE) return null;
  const goldstein = Number.parseFloat(cols[COL.GoldsteinScale]);
  return { quad, goldstein, tone, numMentions };
}

/** Parse GDELT 2.0 EVENT CSV (tab-separated, no header).
 *  Returns HistoricalEvent[] (precedent-matcher.ts shape). */
export function parseExportCsv(csvText) {
  const out = [];
  if (!csvText) return out;
  for (const raw of csvText.split('\n')) {
    if (!raw) continue;
    const cols = raw.split('\t');
    const passed = rowPasses(cols);
    if (!passed) continue;
    const event = toHistoricalEvent(cols, passed.quad, passed.goldstein, passed.tone, passed.numMentions);
    if (event) out.push(event);
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

function toHistoricalEvent(cols, quad, goldstein, tone, numMentions) {
  const id = `gdelt-${cols[COL.GLOBALEVENTID]}`;
  const date = parseGdeltDateAdded(cols[COL.DATEADDED]);
  if (!date) return null;
  const place = cols[COL.ActionGeo_FullName] || cols[COL.ActionGeo_CountryCode] || 'unknown';
  const country = cols[COL.ActionGeo_CountryCode] || '';
  const actors = [cols[COL.Actor1Name], cols[COL.Actor2Name]]
    .map((s) => (s || '').trim()).filter((s) => s.length > 0);
  return {
    id, date, location: place, country,
    eventType: cameoLabelFor(cols[COL.EventCode], quad),
    actors,
    intensity: intensityFromGoldstein(goldstein),
    summary: buildSummary(actors, place, cols[COL.EventCode], tone, numMentions),
    source: 'gdelt',
  };
}

/** GDELT DATEADDED is YYYYMMDDHHMMSS → ISO 8601. */
function parseGdeltDateAdded(s) {
  if (!s || s.length !== 14) return '';
  const y = s.slice(0, 4), mo = s.slice(4, 6), d = s.slice(6, 8);
  const h = s.slice(8, 10), mi = s.slice(10, 12), se = s.slice(12, 14);
  const ts = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString();
}

/** Goldstein scale (-10..+10) → IntensityLabel.
 *  Filtered set is QuadClass 3/4 so positive Goldsteins are unusual but
 *  possible (e.g. peacekeeping deployments scored as material conflict). */
export function intensityFromGoldstein(g) {
  if (!Number.isFinite(g)) return 'medium';
  if (g <= -8) return 'critical';   // mass killings, ethnic cleansing
  if (g <= -5) return 'high';       // military assault, terrorism
  if (g <= -2) return 'medium';     // small-scale violence, sanctions
  return 'low';
}

/** CAMEO root-code label, falling back to a quad-class verb. */
function cameoLabelFor(eventCode, quad) {
  const root = (eventCode || '').slice(0, 2);
  switch (root) {
    case '14': { return 'protest';
    }
    case '15': { return 'force_posture';
    }
    case '17': { return 'coercion';
    }
    case '18': { return 'assault';
    }
    case '19': { return 'fight';
    }
    case '20': { return 'mass_violence';
    }
    default: { return quad === 4 ? 'material_conflict' : 'verbal_conflict';
    }
  }
}

function buildSummary(actors, place, eventCode, tone, numMentions) {
  const who = actors.length ? actors.join(' vs ') : 'unspecified actors';
  return `${who} — CAMEO ${eventCode || '???'} at ${place} (tone ${tone.toFixed(1)}, ${numMentions} mentions)`;
}

export function __resetCacheForTests() { _cache = null; }
