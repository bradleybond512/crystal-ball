/**
 * DYFI ("Did You Feel It?") Collector — Layer 7 of the Seismic
 * Intelligence System.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Two responsibilities:
 *
 *   1. `parseDyfiCdiZip(xml)` — tolerant parser for the USGS DYFI
 *      cdi_zip.xml product. Both the older `<cdi_zip>/<zipcode>`
 *      layout and the newer `<cdi>/<results>/<result>` layout are
 *      accepted.
 *
 *   2. `aggregateDyfiByState(entries)` — summarize the per-ZIP felt
 *      reports up to one row per US state / Canadian province with the
 *      total response count, the max CDI, and a Modified Mercalli
 *      Intensity (MMI) Roman-numeral label derived from the rounded
 *      max CDI.
 *
 * Plan invariants:
 *   - CDI 1.0 == "Not felt" (label "I"). The label table follows the
 *     USGS Mercalli rounding rule: floor(cdi + 0.5).
 *   - States with no felt responses (`responses === 0`) are dropped —
 *     ZIPs that contributed zero to the aggregate carry no signal.
 *   - Aggregate is sorted by descending maxCDI, then descending
 *     responses, so the renderer can render the strongest-felt regions
 *     first without resorting downstream.
 */

// ─── MMI labels ───────────────────────────────────────────────────────

export type MMILabel =
  | 'I'
  | 'II'
  | 'III'
  | 'IV'
  | 'V'
  | 'VI'
  | 'VII'
  | 'VIII'
  | 'IX'
  | 'X'
  | 'XI'
  | 'XII';

export const MMI_DESCRIPTIONS: Record<MMILabel, string> = {
  I: 'Not felt',
  II: 'Weak',
  III: 'Weak',
  IV: 'Light',
  V: 'Moderate',
  VI: 'Strong',
  VII: 'Very strong',
  VIII: 'Severe',
  IX: 'Violent',
  X: 'Extreme',
  XI: 'Extreme',
  XII: 'Extreme',
};

const MMI_LADDER: readonly MMILabel[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/**
 * USGS rounding rule: round CDI to the nearest integer (half-up), then
 * map 1..12 to I..XII. CDI < 1 reported as "I" (not felt). CDI ≥ 12
 * caps at XII.
 */
export function cdiToMmiLabel(cdi: number): MMILabel {
  if (!Number.isFinite(cdi) || cdi < 1) return 'I';
  const rounded = Math.floor(cdi + 0.5);
  const idx = Math.max(1, Math.min(12, rounded));
  return MMI_LADDER[idx - 1] ?? 'I';
}

// ─── Public types ─────────────────────────────────────────────────────

export interface DyfiEntry {
  zip: string;
  cdi: number;
  responses: number;
  state: string;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

export interface DyfiStateSummary {
  state: string;
  responses: number;
  zipCount: number;
  maxCdi: number;
  maxCdiZip: string | null;
  maxCdiCity: string | null;
  mmiLabel: MMILabel;
  mmiDescription: string;
}

export interface DyfiAggregate {
  totalResponses: number;
  totalZips: number;
  maxCdi: number;
  maxCdiState: string | null;
  mmiLabel: MMILabel;
  mmiDescription: string;
  byState: DyfiStateSummary[];
}

// ─── Parser ───────────────────────────────────────────────────────────

const RESULT_BLOCK_RX = /<result\b[\s\S]*?<\/result>/g;
const ZIPCODE_BLOCK_RX = /<zipcode\b([^>]*)>([\s\S]*?)<\/zipcode>/g;

/**
 * Parse a USGS DYFI cdi_zip.xml body. Tolerates both the legacy
 * `<cdi_zip><zipcode value="...">...` layout and the newer
 * `<cdi><results><result>...` layout. Unknown / missing fields are
 * dropped; entries without a numeric CDI or a recognizable ZIP are
 * skipped silently.
 */
export function parseDyfiCdiZip(xml: string): DyfiEntry[] {
  const out: DyfiEntry[] = [];

  for (const m of xml.matchAll(RESULT_BLOCK_RX)) {
    const e = readResult(m[0]);
    if (e) out.push(e);
  }

  for (const m of xml.matchAll(ZIPCODE_BLOCK_RX)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const zipFromAttr = (/\bvalue="([^"]+)"/.exec(attrs))?.[1] ?? null;
    const e = readLegacyZip(body, zipFromAttr);
    if (e) out.push(e);
  }

  return out;
}

function readResult(block: string): DyfiEntry | null {
  const zip = textOf(block, 'zip');
  const cdiRaw = textOf(block, 'cdi');
  const cdi = Number.parseFloat(cdiRaw);
  if (!zip || !Number.isFinite(cdi)) return null;
  const responses = Number.parseInt(textOf(block, 'responses'), 10);
  const state = textOf(block, 'state');
  const city = textOf(block, 'city') || null;
  const lat = parseNumOrNull(textOf(block, 'lat'));
  const lon = parseNumOrNull(textOf(block, 'lon'));
  return {
    zip,
    cdi,
    responses: Number.isFinite(responses) ? responses : 0,
    state: state || 'Unknown',
    city,
    lat,
    lon,
  };
}

function readLegacyZip(block: string, zipFromAttr: string | null): DyfiEntry | null {
  const zip = zipFromAttr ?? textOf(block, 'zip');
  const cdiRaw = textOf(block, 'cdi');
  const cdi = Number.parseFloat(cdiRaw);
  if (!zip || !Number.isFinite(cdi)) return null;
  const responses = Number.parseInt(textOf(block, 'responses'), 10);
  const state = textOf(block, 'state');
  const city = textOf(block, 'city') || null;
  const locAttrs = (/<location\b([^>]*)\/?>/.exec(block))?.[1] ?? '';
  const lat = parseNumOrNull((/\blat="([^"]+)"/.exec(locAttrs))?.[1] ?? '');
  const lon = parseNumOrNull((/\blon="([^"]+)"/.exec(locAttrs))?.[1] ?? '');
  return {
    zip,
    cdi,
    responses: Number.isFinite(responses) ? responses : 0,
    state: state || 'Unknown',
    city,
    lat,
    lon,
  };
}

function textOf(block: string, tag: string): string {
  const m = new RegExp(String.raw`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`).exec(block);
  if (m?.[1] === undefined) return '';
  const noCdata = m[1].split('<![CDATA[').join('').split(']]>').join('');
  // eslint-disable-next-line sonarjs/slow-regex -- bounded char class, single-character match — linear time.
  return noCdata.replace(/<[^>]+>/g, '').trim();
}

function parseNumOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ─── Aggregation ──────────────────────────────────────────────────────

interface StateSlot {
  state: string;
  responses: number;
  zipCount: number;
  maxCdi: number;
  maxCdiZip: string | null;
  maxCdiCity: string | null;
}

export function aggregateDyfiByState(entries: readonly DyfiEntry[]): DyfiAggregate {
  const map = new Map<string, StateSlot>();

  let totalResponses = 0;
  let totalZips = 0;
  let globalMax = 0;
  let globalMaxState: string | null = null;

  for (const e of entries) {
    if (!Number.isFinite(e.cdi)) continue;
    const responses = Number.isFinite(e.responses) ? e.responses : 0;
    if (responses <= 0) continue;
    const slot: StateSlot = map.get(e.state) ?? {
      state: e.state,
      responses: 0,
      zipCount: 0,
      maxCdi: 0,
      maxCdiZip: null,
      maxCdiCity: null,
    };
    slot.responses += responses;
    slot.zipCount += 1;
    if (e.cdi > slot.maxCdi) {
      slot.maxCdi = e.cdi;
      slot.maxCdiZip = e.zip;
      slot.maxCdiCity = e.city;
    }
    map.set(e.state, slot);
    totalResponses += responses;
    totalZips += 1;
    if (e.cdi > globalMax) {
      globalMax = e.cdi;
      globalMaxState = e.state;
    }
  }

  const byState: DyfiStateSummary[] = [...map.values()]
    .map((s) => ({
      state: s.state,
      responses: s.responses,
      zipCount: s.zipCount,
      maxCdi: s.maxCdi,
      maxCdiZip: s.maxCdiZip,
      maxCdiCity: s.maxCdiCity,
      mmiLabel: cdiToMmiLabel(s.maxCdi),
      mmiDescription: MMI_DESCRIPTIONS[cdiToMmiLabel(s.maxCdi)],
    }))
    .sort((a, b) => {
      if (b.maxCdi !== a.maxCdi) return b.maxCdi - a.maxCdi;
      return b.responses - a.responses;
    });

  const globalLabel = cdiToMmiLabel(globalMax);
  return {
    totalResponses,
    totalZips,
    maxCdi: globalMax,
    maxCdiState: globalMaxState,
    mmiLabel: globalLabel,
    mmiDescription: MMI_DESCRIPTIONS[globalLabel],
    byState,
  };
}

/** Convenience helper: parse + aggregate in one step. */
export function summarizeDyfiCdiZip(xml: string): DyfiAggregate {
  return aggregateDyfiByState(parseDyfiCdiZip(xml));
}
