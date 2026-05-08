/**
 * OFAC SDN cache for the Node.js sidecar.
 *
 * - Reads the parsed cache from `${dataDir}/data/ofac-cache.json` on
 *   first call.
 * - Refreshes from https://www.treasury.gov/ofac/downloads/sdn.xml when
 *   the cache is missing or older than 7 days.
 * - Parses the XML in-process (no DOM dependency, just a tag-extraction
 *   walk that mirrors the renderer-side TS in src/services/sanctions/
 *   ofac-parser.ts — kept lean here so the sidecar boot doesn't have to
 *   pull in the renderer toolchain).
 * - Exposes:
 *     getCacheMeta()
 *     getAllEntries()
 *     getSanctionedVessels()
 *     getSanctionedAircraft()
 *     searchSanctions(query, opts?)
 *     matchVessel({ name, imo, callSign })
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SDN_XML_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;

export class OfacCache {
  constructor({ dataDir, fetchImpl = fetch, logger = console }) {
    this.cacheFile = path.join(dataDir, 'data', 'ofac-cache.json');
    this.fetch = fetchImpl;
    this.logger = logger;
    /** @type {{ version:number, fetchedAt:number, upstreamBytes:number, entryCount:number, entries:any[] } | null} */
    this.payload = null;
    this.indexes = null;
    /** @type {Promise<void>|null} */
    this._refreshing = null;
  }

  /** Lazily load + (if stale) refresh. Resolves when the cache holds a
   *  parsed entry list. Concurrent calls share the same in-flight
   *  refresh. */
  async ensureLoaded() {
    if (this.payload && Date.now() - this.payload.fetchedAt < SEVEN_DAYS_MS) return;
    if (this._refreshing) { await this._refreshing; return; }
    this._refreshing = this._loadOrRefresh().finally(() => { this._refreshing = null; });
    await this._refreshing;
  }

  async _loadOrRefresh() {
    await this._loadCacheFromDisk();
    if (!this._isStale()) return;
    try {
      await this._refreshFromUpstream();
    } catch (error) {
      this.logger.warn('[ofac-cache] refresh failed:', error?.message ?? error);
    }
  }

  async _loadCacheFromDisk() {
    try {
      const text = await readFile(this.cacheFile, 'utf8');
      const parsed = JSON.parse(text);
      if (parsed?.version === CACHE_VERSION && Array.isArray(parsed.entries)) {
        this.payload = parsed;
        this._buildIndexes();
      }
    } catch {
      // Missing or unreadable — fall through to refresh.
    }
  }

  _isStale() {
    return !this.payload || (Date.now() - this.payload.fetchedAt) > SEVEN_DAYS_MS;
  }

  async _refreshFromUpstream() {
    const xml = await this._downloadSdnXml();
    if (!xml) return;
    const entries = parseSdnXml(xml);
    const next = {
      version: CACHE_VERSION,
      fetchedAt: Date.now(),
      upstreamBytes: xml.length,
      entryCount: entries.length,
      entries,
    };
    await mkdir(path.dirname(this.cacheFile), { recursive: true });
    await writeFile(this.cacheFile, JSON.stringify(next));
    this.payload = next;
    this._buildIndexes();
  }

  async _downloadSdnXml() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const r = await this.fetch(SDN_XML_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/xml,text/xml', 'User-Agent': 'CrystalBall/1.0 (+sidecar)' },
      });
      if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
      return await r.text();
    } finally {
      clearTimeout(timer);
    }
  }

  _buildIndexes() {
    if (!this.payload) { this.indexes = null; return; }
    const vesselsByName = new Map();
    const vesselsByImo = new Map();
    const vesselsByCallSign = new Map();
    const haystack = [];
    for (const e of this.payload.entries) {
      haystack.push(buildHaystackRow(e));
      if (e.type === 'vessel') indexVessel(e, vesselsByName, vesselsByImo, vesselsByCallSign);
    }
    this.indexes = { haystack, vesselsByName, vesselsByImo, vesselsByCallSign };
  }

  // ─── Read API ───────────────────────────────────────────────────────

  getCacheMeta() {
    if (!this.payload) return { ready: false, fetchedAt: null, entryCount: 0, ageMs: null };
    return {
      ready: true,
      fetchedAt: this.payload.fetchedAt,
      entryCount: this.payload.entryCount,
      ageMs: Date.now() - this.payload.fetchedAt,
      upstreamBytes: this.payload.upstreamBytes,
    };
  }

  getAllEntries() { return this.payload?.entries ?? []; }
  getSanctionedVessels() { return (this.payload?.entries ?? []).filter((e) => e.type === 'vessel'); }
  getSanctionedAircraft() { return (this.payload?.entries ?? []).filter((e) => e.type === 'aircraft'); }

  searchSanctions(rawQuery, opts = {}) {
    const query = String(rawQuery ?? '').trim().toLowerCase();
    if (!query || !this.payload || !this.indexes) return [];
    const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
    const out = [];
    for (let i = 0; i < this.payload.entries.length; i++) {
      const entry = this.payload.entries[i];
      if (opts.type && entry.type !== opts.type) continue;
      const score = scoreMatch(entry, query, this.indexes.haystack[i] ?? '');
      if (score === 0) continue;
      out.push({ entry, score });
    }
    out.sort((a, b) => b.score === a.score ? a.entry.name.localeCompare(b.entry.name) : b.score - a.score);
    return out.slice(0, limit);
  }

  matchVessel({ name, imo, callSign }) {
    if (!this.indexes) return { matched: false };
    const imoKey = imo ? normalizeImo(imo) : '';
    if (imoKey && this.indexes.vesselsByImo.has(imoKey)) {
      return toMatch(this.indexes.vesselsByImo.get(imoKey), 'imo');
    }
    const csKey = callSign ? String(callSign).trim().toLowerCase() : '';
    if (csKey && this.indexes.vesselsByCallSign.has(csKey)) {
      return toMatch(this.indexes.vesselsByCallSign.get(csKey), 'callsign');
    }
    const nameKey = name ? normalizeVesselName(name) : '';
    if (nameKey && this.indexes.vesselsByName.has(nameKey)) {
      return toMatch(this.indexes.vesselsByName.get(nameKey), 'name');
    }
    return { matched: false };
  }
}

// ─── Index helpers ────────────────────────────────────────────────────

function buildHaystackRow(e) {
  const idTokens = (e.ids ?? []).map((id) => `${String(id.idType).toLowerCase()}:${String(id.idNumber).toLowerCase()}`);
  return [
    e.name?.toLowerCase() ?? '',
    ...(e.aliases ?? []),
    ...(e.countries ?? []),
    ...idTokens,
  ].join(' | ');
}

function indexVessel(e, byName, byImo, byCallSign) {
  const nameKey = normalizeVesselName(e.name);
  if (nameKey && !byName.has(nameKey)) byName.set(nameKey, e);
  for (const alias of (e.aliases ?? [])) {
    const aliasKey = normalizeVesselName(alias);
    if (aliasKey && !byName.has(aliasKey)) byName.set(aliasKey, e);
  }
  const imoKey = e.vessel?.imo ? normalizeImo(e.vessel.imo) : '';
  if (imoKey) byImo.set(imoKey, e);
  const csKey = e.vessel?.callSign ? String(e.vessel.callSign).trim().toLowerCase() : '';
  if (csKey) byCallSign.set(csKey, e);
}

// ─── Score / match helpers ─────────────────────────────────────────────

function scoreMatch(entry, query, haystack) {
  const name = String(entry.name ?? '').toLowerCase();
  if (name === query) return 100;
  if (name.startsWith(query)) return 90;
  for (const alias of (entry.aliases ?? [])) {
    if (alias === query) return 80;
  }
  for (const alias of (entry.aliases ?? [])) {
    if (alias.startsWith(query)) return 70;
  }
  if (name.includes(query)) return 60;
  if (haystack.includes(query)) return 50;
  return 0;
}

function toMatch(entry, reason) {
  const programs = entry.programs ?? [];
  const programLabel = programs.length > 0 ? programs.join(', ').toUpperCase() : 'SDN';
  return {
    matched: true,
    reason,
    uid: entry.uid,
    programs: [...programs],
    badge: `OFAC SDN — ${programLabel}`,
  };
}

// ─── Normalizers (must match the renderer-side TS exactly) ─────────────

export function normalizeVesselName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\b(m\/v|m\/t|s\/v|m\.v\.|m\.t\.|f\.v\.|mv|mt)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeImo(raw) {
  const digits = String(raw ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  return digits.length > 7 ? digits.slice(-7) : digits;
}

// ─── XML parser (mirrors src/services/sanctions/ofac-parser.ts) ────────

const ENTRY_RX = /<sdnEntry\b[\s\S]*?<\/sdnEntry>/g;

export function parseSdnXml(xml) {
  const out = [];
  for (const match of xml.matchAll(ENTRY_RX)) {
    const entry = parseEntryBlock(match[0]);
    if (entry) out.push(entry);
  }
  return out;
}

function parseEntryBlock(block) {
  const uid = textOf(block, 'uid');
  if (!uid) return null;
  const type = parseType(textOf(block, 'sdnType'));
  const name = composeName(block, type);
  if (!name) return null;
  const programs = uniqueLower(extractList(block, 'programList', 'program', (b) => stripHtml(b).trim()));
  const aliases = uniqueLower(extractAkaList(block));
  const ids = extractIdList(block);
  const addresses = extractAddressList(block);
  const countries = uniqueLower(addresses.map((a) => a.country).filter((x) => x !== null));
  const vessel = type === 'vessel' ? extractVesselInfo(block, ids) : null;
  const aircraft = type === 'aircraft' ? extractAircraftInfo(block) : null;
  return {
    uid, name, type, programs, aliases, countries, ids, vessel, aircraft,
    remarks: textOf(block, 'remarks') || null,
  };
}

function parseType(raw) {
  const t = (raw || '').toLowerCase();
  if (t.includes('individual')) return 'individual';
  if (t.includes('vessel')) return 'vessel';
  if (t.includes('aircraft')) return 'aircraft';
  if (t.includes('entity') || t.includes('organization')) return 'entity';
  return 'unknown';
}

function composeName(block, type) {
  const lastName = textOf(block, 'lastName');
  const firstName = textOf(block, 'firstName');
  if (type === 'individual' && firstName && lastName) return `${lastName}, ${firstName}`;
  return lastName || firstName || '';
}

function extractList(block, listTag, itemTag, mapper) {
  const slice = sliceTag(block, listTag);
  if (!slice) return [];
  const itemRx = new RegExp(String.raw`<${itemTag}\b[^>]*>([\s\S]*?)<\/${itemTag}>`, 'g');
  const out = [];
  for (const m of slice.matchAll(itemRx)) {
    const value = mapper(m[1] ?? '');
    if (value) out.push(value);
  }
  return out;
}

function extractAkaList(block) {
  const slice = sliceTag(block, 'akaList');
  if (!slice) return [];
  const out = [];
  for (const m of slice.matchAll(/<aka\b[\s\S]*?<\/aka>/g)) {
    const akaBlock = m[0];
    const last = textOf(akaBlock, 'lastName');
    const first = textOf(akaBlock, 'firstName');
    if (last && first) out.push(`${last}, ${first}`);
    else if (last) out.push(last);
    else if (first) out.push(first);
  }
  return out;
}

function extractIdList(block) {
  const slice = sliceTag(block, 'idList');
  if (!slice) return [];
  const out = [];
  for (const m of slice.matchAll(/<id\b[\s\S]*?<\/id>/g)) {
    const idBlock = m[0];
    const idType = textOf(idBlock, 'idType');
    const idNumber = textOf(idBlock, 'idNumber');
    if (!idType || !idNumber) continue;
    out.push({ idType, idNumber, idCountry: textOf(idBlock, 'idCountry') || null });
  }
  return out;
}

function extractAddressList(block) {
  const slice = sliceTag(block, 'addressList');
  if (!slice) return [];
  const out = [];
  for (const m of slice.matchAll(/<address\b[\s\S]*?<\/address>/g)) {
    const addrBlock = m[0];
    const country = textOf(addrBlock, 'country') || null;
    const city = textOf(addrBlock, 'city') || null;
    const region = textOf(addrBlock, 'stateOrProvince') || null;
    if (country || city || region) out.push({ country, city, region });
  }
  return out;
}

function extractVesselInfo(block, ids) {
  const slice = sliceTag(block, 'vesselInfo') ?? '';
  const imo = (ids.find((id) => /imo/i.test(id.idType)) || {}).idNumber || null;
  return {
    callSign: textOf(slice, 'callSign') || null,
    vesselType: textOf(slice, 'vesselType') || null,
    vesselFlag: textOf(slice, 'vesselFlag') || null,
    vesselOwner: textOf(slice, 'vesselOwner') || null,
    tonnage: textOf(slice, 'tonnage') || textOf(slice, 'grossRegisteredTonnage') || null,
    imo,
  };
}

function extractAircraftInfo(block) {
  const slice = sliceTag(block, 'aircraftInfo') ?? '';
  return {
    tailNumber: textOf(slice, 'aircraftTailNumber') || null,
    model: textOf(slice, 'aircraftModel') || null,
    operator: textOf(slice, 'aircraftOperator') || null,
    manufactureDate: textOf(slice, 'aircraftManufactureDate') || null,
    constructionNumber: textOf(slice, 'aircraftConstructionNumber') || null,
  };
}

function textOf(block, tag) {
  const m = String(block).match(new RegExp(String.raw`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`));
  if (!m || m[1] === undefined) return '';
  return stripHtml(m[1]).trim();
}

function sliceTag(block, tag) {
  const m = String(block).match(new RegExp(String.raw`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`));
  return m ? m[1] : null;
}

function stripHtml(s) {
  const noCdata = String(s).split('<![CDATA[').join('').split(']]>').join('');
  // eslint-disable-next-line sonarjs/slow-regex -- bounded char class, single-character match — linear time.
  return noCdata.replace(/<[^>]+>/g, '');
}

function uniqueLower(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const key = String(v).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
