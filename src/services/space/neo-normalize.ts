/**
 * Near-Earth Object normalizers — pure-deterministic.
 *
 * Sources (both free, no key):
 *   - JPL CNEOS CAD  (close-approach data)  → upcoming flybys
 *   - JPL CNEOS Sentry (impact-risk table)  → objects with nonzero
 *                                             cumulative impact probability
 *
 * No I/O. The sidecar fetches; these functions parse + classify.
 *
 * Units:
 *   - Distances arrive in astronomical units (AU); we expose lunar
 *     distances (LD) as the intuitive scale (1 LD ≈ 0.0025696 AU).
 *   - Absolute magnitude H → estimated diameter when no measured
 *     diameter is published.
 */

export const AU_PER_LUNAR_DISTANCE = 0.002_569_6;
export const KM_PER_AU = 149_597_870.7;

export type NeoHazard = 'none' | 'notable' | 'close' | 'very_close';

export interface CloseApproach {
  designation: string;
  /** Close-approach time, epoch ms (UTC). */
  approachAt: number;
  /** Nominal miss distance in AU. */
  distanceAu: number;
  /** Nominal miss distance in lunar distances. */
  distanceLd: number;
  /** Relative velocity, km/s. */
  velocityKms: number | null;
  /** Absolute magnitude H. */
  absoluteMagnitude: number | null;
  /** Estimated diameter in metres (from H when not measured). */
  estDiameterM: number | null;
  hazard: NeoHazard;
}

export interface ImpactRiskObject {
  designation: string;
  fullname: string | null;
  /** Cumulative impact probability over all virtual impactors. */
  impactProbability: number;
  /** Number of potential impacts. */
  impactCount: number;
  /** Cumulative Palermo Technical Scale (higher = more concerning). */
  palermoScaleCum: number | null;
  /** Estimated diameter in metres. */
  diameterM: number | null;
  /** Window of potential impact years, e.g. "2056-2113". */
  yearRange: string | null;
  absoluteMagnitude: number | null;
}

// Diameter estimate from absolute magnitude H, assuming a typical
// albedo of 0.14: D(km) = 1329 / sqrt(albedo) * 10^(-0.2 H).
const ASSUMED_ALBEDO = 0.14;

export function estimateDiameterMetres(h: number | null): number | null {
  if (h === null || !Number.isFinite(h)) return null;
  const km = (1329 / Math.sqrt(ASSUMED_ALBEDO)) * 10 ** (-0.2 * h);
  return Math.round(km * 1000);
}

export function auToLunarDistances(au: number): number {
  return au / AU_PER_LUNAR_DISTANCE;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const CAD_DATE_RE = /^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})$/;

/** Parse JPL CAD calendar dates like "2026-May-31 00:54" (UTC) to epoch ms. */
export function parseCadDate(cd: string): number | null {
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec -- RegExp.exec is blocked by the repo security hook
  const m = cd.trim().match(CAD_DATE_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = MONTHS[m[2]!];
  if (month === undefined) return null;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return Date.UTC(year, month, day, hour, minute, 0, 0);
}

export function classifyApproach(distanceLd: number, estDiameterM: number | null): NeoHazard {
  // Lunar distance is the intuitive yardstick. Size raises the floor:
  // a big rock at 5 LD is more notable than a pebble at 5 LD.
  const big = (estDiameterM ?? 0) >= 140; // NASA "potentially hazardous" size floor
  if (distanceLd <= 1) return 'very_close';
  if (distanceLd <= 5) return big ? 'very_close' : 'close';
  if (distanceLd <= 20) return big ? 'close' : 'notable';
  return big ? 'notable' : 'none';
}

interface CadPayload {
  fields?: unknown;
  data?: unknown;
}

/** Normalize a JPL CAD response (fields[] + data[][]) to CloseApproach[]. */
export function normalizeCloseApproaches(payload: unknown): CloseApproach[] {
  const p = (payload ?? {}) as CadPayload;
  if (!Array.isArray(p.fields) || !Array.isArray(p.data)) return [];
  const fields = p.fields as string[];
  const iDes = fields.indexOf('des');
  const iCd = fields.indexOf('cd');
  const iDist = fields.indexOf('dist');
  const iVrel = fields.indexOf('v_rel');
  const iH = fields.indexOf('h');
  if (iDes === -1 || iCd === -1 || iDist === -1) return [];

  const out: CloseApproach[] = [];
  for (const row of p.data as unknown[]) {
    if (!Array.isArray(row)) continue;
    const designation = asString(row[iDes]).trim();
    const approachAt = parseCadDate(asString(row[iCd]));
    const distanceAu = Number(row[iDist]);
    if (!designation || approachAt === null || !Number.isFinite(distanceAu)) continue;
    const velocityKms = iVrel === -1 ? null : finite(row[iVrel]);
    const absoluteMagnitude = iH === -1 ? null : finite(row[iH]);
    const estDiameterM = estimateDiameterMetres(absoluteMagnitude);
    const distanceLd = auToLunarDistances(distanceAu);
    out.push({
      designation,
      approachAt,
      distanceAu,
      distanceLd,
      velocityKms,
      absoluteMagnitude,
      estDiameterM,
      hazard: classifyApproach(distanceLd, estDiameterM),
    });
  }
  out.sort((a, b) => a.approachAt - b.approachAt);
  return out;
}

interface SentryPayload {
  data?: unknown;
}

/** Normalize a JPL Sentry response (data[] of objects) to ImpactRiskObject[]. */
export function normalizeImpactRisks(payload: unknown): ImpactRiskObject[] {
  const p = (payload ?? {}) as SentryPayload;
  if (!Array.isArray(p.data)) return [];
  const out: ImpactRiskObject[] = [];
  for (const item of p.data as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const designation = asString(r.des).trim();
    const impactProbability = finite(r.ip);
    if (!designation || impactProbability === null) continue;
    const diameterKm = finite(r.diameter);
    const absoluteMagnitude = finite(r.h);
    out.push({
      designation,
      fullname: typeof r.fullname === 'string' ? r.fullname.trim() : null,
      impactProbability,
      impactCount: Math.trunc(finite(r.n_imp) ?? 0),
      palermoScaleCum: finite(r.ps_cum),
      diameterM: diameterKm === null ? estimateDiameterMetres(absoluteMagnitude) : Math.round(diameterKm * 1000),
      yearRange: typeof r.range === 'string' ? r.range.trim() : null,
      absoluteMagnitude,
    });
  }
  // Highest Palermo scale first (most concerning); nulls last.
  out.sort((a, b) => (b.palermoScaleCum ?? -Infinity) - (a.palermoScaleCum ?? -Infinity));
  return out;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function finite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
