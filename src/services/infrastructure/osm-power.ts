/**
 * OSM power-infrastructure adapter — integrates the open data behind
 * OpenGridWorks (power plants, transmission lines, substations, data centers)
 * directly from OpenStreetMap via the Overpass API, rather than scraping the
 * OpenGridWorks front-end (which has no public API).
 *
 * Global coverage, no API key. OSM is ODbL — **renderers must attribute
 * "© OpenStreetMap contributors"**.
 *
 * The pure core (query builder, Overpass parser, classification, site summary,
 * overlay rows) is fixture-tested with no network. `fetchPowerInfrastructure`
 * is the only impure function and takes an injectable `fetchImpl`/`endpoint`
 * so desktop can route through the sidecar proxy (CSP allows only 127.0.0.1)
 * and tests stay hermetic.
 *
 * Wiring point: `summarizePowerContext` is shaped to feed
 * `datacenter/site-resolver` (nearest substation, nearby generation capacity)
 * and `powerAssetsToOverlayRows` to feed a globe overlay.
 */

import { haversineKm } from '@/services/proximity-filter';

// ── Public types ───────────────────────────────────────────────────────────

export type PowerAssetKind = 'plant' | 'substation' | 'line' | 'data_center' | 'other';

export interface PowerAsset {
  /** OSM element ref, e.g. "way/12345". */
  id: string;
  kind: PowerAssetKind;
  lat: number;
  lon: number;
  name?: string;
  operator?: string;
  /** Highest voltage on the element, in volts (parsed from the `voltage` tag). */
  voltageV?: number;
  /** Generation capacity in MW (from plant/generator output tags). */
  capacityMw?: number;
  /** Generation source, e.g. "solar", "coal", "wind". */
  source?: string;
}

export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const ALL_KINDS: readonly PowerAssetKind[] = ['plant', 'substation', 'line', 'data_center'];

// ── Overpass query builder (pure) ────────────────────────────────────────────

/** Build an Overpass QL query for the requested power-infrastructure kinds
 *  within `radiusMeters` of (lat, lon). `out center tags` gives ways/relations
 *  a representative point. */
export function buildOverpassQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  kinds: readonly PowerAssetKind[] = ALL_KINDS,
  timeoutS = 25,
): string {
  const around = `(around:${Math.round(radiusMeters)},${lat},${lon})`;
  const selectors: string[] = [];
  for (const kind of kinds) {
    for (const tag of selectorsForKind(kind)) {
      selectors.push(`  nwr[${tag}]${around};`);
    }
  }
  return `[out:json][timeout:${Math.round(timeoutS)}];\n(\n${selectors.join('\n')}\n);\nout center tags;`;
}

function selectorsForKind(kind: PowerAssetKind): string[] {
  switch (kind) {
    case 'plant': {
      return ['"power"="plant"', '"power"="generator"'];
    }
    case 'substation': {
      return ['"power"="substation"'];
    }
    case 'line': {
      return ['"power"="line"', '"power"="minor_line"'];
    }
    case 'data_center': {
      return ['"telecom"="data_center"', '"building"="data_center"'];
    }
    default: {
      return [];
    }
  }
}

// ── Overpass response parser (pure) ──────────────────────────────────────────

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Parse a raw Overpass JSON response into typed power assets. Unknown-kind or
 *  unlocatable elements are dropped. Accepts `unknown` and narrows defensively. */
export function parseOverpassPower(json: unknown): PowerAsset[] {
  const elements = extractElements(json);
  const out: PowerAsset[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = classifyPower(tags);
    if (kind === 'other') continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: `${el.type ?? 'node'}/${el.id ?? 0}`,
      kind,
      lat: lat as number,
      lon: lon as number,
      name: tags.name,
      operator: tags.operator,
      voltageV: parseVoltage(tags.voltage),
      capacityMw: parsePowerMw(tags['plant:output:electricity'] ?? tags['generator:output:electricity']),
      source: tags['plant:source'] ?? tags['generator:source'],
    });
  }
  return out;
}

function extractElements(json: unknown): OverpassElement[] {
  if (!json || typeof json !== 'object') return [];
  const elements = (json as { elements?: unknown }).elements;
  return Array.isArray(elements) ? (elements as OverpassElement[]) : [];
}

function classifyPower(tags: Record<string, string>): PowerAssetKind {
  const power = tags.power;
  if (power === 'plant' || power === 'generator') return 'plant';
  if (power === 'substation') return 'substation';
  if (power === 'line' || power === 'minor_line') return 'line';
  if (tags.telecom === 'data_center' || tags.building === 'data_center') return 'data_center';
  return 'other';
}

/** Max voltage in volts from an OSM `voltage` tag (which may be ";"-separated). */
export function parseVoltage(value?: string): number | undefined {
  if (!value) return undefined;
  let max: number | undefined;
  for (const part of value.split(/[;,]/)) {
    const n = Number.parseFloat(part.trim());
    if (Number.isFinite(n) && (max === undefined || n > max)) max = n;
  }
  return max;
}

const MW_FACTORS: Record<string, number> = { gw: 1000, mw: 1, kw: 0.001, w: 0.000_001 };

/** Parse an OSM output tag ("1500 MW", "2.5 GW", "750 kW") into MW. */
export function parsePowerMw(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /([\d.]+)\s*(gw|mw|kw|w)?/i.exec(value.trim());
  if (!match) return undefined;
  const n = Number.parseFloat(match[1]!);
  if (!Number.isFinite(n)) return undefined;
  const unit = (match[2] ?? 'mw').toLowerCase();
  return round3(n * (MW_FACTORS[unit] ?? 1));
}

// ── Site summary (pure) — feeds datacenter/site-resolver ─────────────────────

export interface NearestAsset {
  id: string;
  name?: string;
  km: number;
  capacityMw?: number;
  source?: string;
}

export interface PowerContext {
  origin: { lat: number; lon: number };
  radiusKm: number;
  counts: Record<PowerAssetKind, number>;
  /** Distance to the closest substation, km (undefined when none in range). */
  nearestSubstationKm?: number;
  nearestPlant?: NearestAsset;
  /** Sum of known plant capacities in range, MW. */
  nearbyCapacityMw: number;
  transmissionLineCount: number;
}

/** Summarize power assets relative to a site — the shape the datacenter
 *  readiness layer consumes (nearest substation, nearby generation). */
export function summarizePowerContext(
  origin: { lat: number; lon: number },
  radiusKm: number,
  assets: readonly PowerAsset[],
): PowerContext {
  const counts: Record<PowerAssetKind, number> = {
    plant: 0,
    substation: 0,
    line: 0,
    data_center: 0,
    other: 0,
  };
  let nearestSubstationKm: number | undefined;
  let nearestPlant: NearestAsset | undefined;
  let nearbyCapacityMw = 0;

  for (const a of assets) {
    counts[a.kind] += 1;
    const km = round3(haversineKm(origin.lat, origin.lon, a.lat, a.lon));
    if (a.kind === 'substation' && (nearestSubstationKm === undefined || km < nearestSubstationKm)) {
      nearestSubstationKm = km;
    }
    if (a.kind === 'plant') {
      if (a.capacityMw !== undefined) nearbyCapacityMw += a.capacityMw;
      if (nearestPlant === undefined || km < nearestPlant.km) {
        nearestPlant = { id: a.id, name: a.name, km, capacityMw: a.capacityMw, source: a.source };
      }
    }
  }

  return {
    origin,
    radiusKm,
    counts,
    nearestSubstationKm,
    nearestPlant,
    nearbyCapacityMw: round3(nearbyCapacityMw),
    transmissionLineCount: counts.line,
  };
}

// ── Grid-readiness annotation (pure) — for the datacenter panel ──────────────

export interface GridReadiness {
  /** One-line operator summary. */
  summary: string;
  /** No substation mapped within range — a weak / uncertain grid tie. */
  weakGridTie: boolean;
}

/** Turn a `PowerContext` into a one-line grid-readiness annotation for the
 *  datacenter surface. */
export function describeGridReadiness(ctx: PowerContext): GridReadiness {
  const parts: string[] = [];
  const weakGridTie = ctx.nearestSubstationKm === undefined;
  if (weakGridTie) {
    parts.push('no substation mapped in range');
  } else {
    parts.push(`nearest substation ${ctx.nearestSubstationKm} km`);
  }
  if (ctx.nearbyCapacityMw > 0) {
    parts.push(`${Math.round(ctx.nearbyCapacityMw)} MW generation within ${ctx.radiusKm} km`);
  }
  if (ctx.transmissionLineCount > 0) {
    parts.push(`${ctx.transmissionLineCount} transmission line${ctx.transmissionLineCount === 1 ? '' : 's'}`);
  }
  return { summary: `Grid: ${parts.join('; ')}.`, weakGridTie };
}

// ── Globe overlay rows (pure) ────────────────────────────────────────────────

export interface PowerOverlayRow {
  id: string;
  kind: PowerAssetKind;
  lat: number;
  lon: number;
  label: string;
  /** 0..1 visual weight (higher = larger/brighter). */
  weight: number;
}

const KIND_BASE_WEIGHT: Record<PowerAssetKind, number> = {
  plant: 0.6,
  substation: 0.45,
  data_center: 0.55,
  line: 0.3,
  other: 0.2,
};

/** Map assets to globe-overlay rows. Plant weight scales with capacity. */
export function powerAssetsToOverlayRows(assets: readonly PowerAsset[]): PowerOverlayRow[] {
  return assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    lat: a.lat,
    lon: a.lon,
    label: a.name ?? defaultLabel(a.kind),
    weight: overlayWeight(a),
  }));
}

function overlayWeight(a: PowerAsset): number {
  const base = KIND_BASE_WEIGHT[a.kind];
  if (a.kind === 'plant' && a.capacityMw !== undefined) {
    // Scale up to +0.4 as capacity approaches ~2 GW.
    return clamp01(base + Math.min(0.4, a.capacityMw / 2000));
  }
  return base;
}

function defaultLabel(kind: PowerAssetKind): string {
  switch (kind) {
    case 'plant': {
      return 'Power plant';
    }
    case 'substation': {
      return 'Substation';
    }
    case 'line': {
      return 'Transmission line';
    }
    case 'data_center': {
      return 'Data center';
    }
    default: {
      return 'Power asset';
    }
  }
}

// ── Fetch (impure, injectable) ───────────────────────────────────────────────

export interface FetchPowerOptions {
  kinds?: readonly PowerAssetKind[];
  /** Overpass endpoint. Default public; override with a sidecar proxy on
   *  desktop (CSP restricts connect-src to 127.0.0.1). */
  endpoint?: string;
  timeoutMs?: number;
  /** Injectable fetch for tests / proxying. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Fetch power infrastructure within `radiusKm` of (lat, lon) from Overpass.
 *  Returns [] on any failure (network, timeout, bad payload). */
export async function fetchPowerInfrastructure(
  lat: number,
  lon: number,
  radiusKm: number,
  options: FetchPowerOptions = {},
): Promise<PowerAsset[]> {
  const endpoint = options.endpoint ?? DEFAULT_OVERPASS_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 25_000;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const query = buildOverpassQuery(lat, lon, radiusKm * 1000, options.kinds ?? ALL_KINDS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    return parseOverpassPower(await resp.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
