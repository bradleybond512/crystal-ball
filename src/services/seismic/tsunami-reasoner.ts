/**
 * Tsunami & Cascade Reasoner — Layer 5 of the Seismic Intelligence
 * System.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Three responsibilities:
 *
 *   1. `TsunamiReasoner.assessThreat(event)` — given a seismic event's
 *      magnitude, depth, and epicenter coordinates, classify the
 *      tsunami threat at HIGH / MODERATE / LOW / NONE using cascade
 *      thresholds and a Ring-of-Fire + Sunda-Trench subduction-zone
 *      bounding-box check.
 *
 *   2. `DARTAnomalyDetector.analyze(buoyId, readings)` — given a stream
 *      of DART buoy sea-level readings, flag a deviation > 2 cm vs the
 *      rolling-window baseline. Returns a structured anomaly result so
 *      downstream UI can show "buoy moved before the bulletin
 *      arrived".
 *
 *   3. `parsePTWCAtom(xml)` — strict-but-tolerant Atom parser for the
 *      Pacific Tsunami Warning Center feed (PAAQAtom.xml). The sidecar
 *      proxy fetches the raw bytes; this function turns them into
 *      structured `PTWCBulletin` records the renderer can fuse.
 *
 * Plan invariants:
 *   - Threat levels are reported with explicit reasons so the renderer
 *     can show "why" alongside "what".
 *   - DART deviation is first-class: a quake without a PTWC bulletin
 *     but with confirmed DART deviation is still actionable.
 *   - Magnitude unknown ⇒ threat level falls through to NONE with a
 *     reason — never silently inferred.
 */

import type { CanonicalSeismicEvent } from './seismic-types';

// ─── Subduction-zone bounding boxes ───────────────────────────────────

/** Ring-of-Fire + Sunda Trench coverage. Boxes are intentionally coarse;
 *  they exist to answer "could this be a submarine subduction-zone
 *  quake?" not to draw exact trench geometry. Boxes that cross the
 *  antimeridian use `minLon > maxLon`. */
export const SUBDUCTION_ZONES: readonly {
  readonly name: string;
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
}[] = [
  { name: 'aleutian-alaska', minLat: 50, maxLat: 65, minLon: 170, maxLon: -130 },
  { name: 'cascadia', minLat: 40, maxLat: 50, minLon: -130, maxLon: -120 },
  { name: 'central-america', minLat: 5, maxLat: 25, minLon: -110, maxLon: -80 },
  { name: 'peru-chile', minLat: -50, maxLat: 5, minLon: -85, maxLon: -65 },
  { name: 'kuril-japan', minLat: 25, maxLat: 50, minLon: 130, maxLon: 165 },
  { name: 'marianas', minLat: 10, maxLat: 25, minLon: 140, maxLon: 150 },
  { name: 'philippines', minLat: 5, maxLat: 22, minLon: 120, maxLon: 130 },
  { name: 'sunda-trench', minLat: -12, maxLat: 7, minLon: 90, maxLon: 130 },
  { name: 'tonga-kermadec', minLat: -45, maxLat: -10, minLon: 170, maxLon: -170 },
  { name: 'vanuatu-solomon', minLat: -25, maxLat: -5, minLon: 150, maxLon: 175 },
  { name: 'hellenic-arc', minLat: 33, maxLat: 38, minLon: 20, maxLon: 30 },
];

export interface SubductionHit {
  hit: boolean;
  zone: string | null;
}

export function locateSubductionZone(lat: number, lon: number): SubductionHit {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { hit: false, zone: null };
  for (const z of SUBDUCTION_ZONES) {
    const latIn = lat >= z.minLat && lat <= z.maxLat;
    // Antimeridian-spanning boxes use minLon > maxLon: hit if either side is in range.
    const lonIn = z.minLon <= z.maxLon
      ? lon >= z.minLon && lon <= z.maxLon
      : lon >= z.minLon || lon <= z.maxLon;
    if (latIn && lonIn) return { hit: true, zone: z.name };
  }
  return { hit: false, zone: null };
}

// ─── Tsunami threat assessment ────────────────────────────────────────

export type TsunamiThreatLevel = 'high' | 'moderate' | 'low' | 'none';

export interface TsunamiThreatAssessment {
  level: TsunamiThreatLevel;
  reasons: string[];
  isSubmarine: boolean;
  subductionZone: string | null;
  cascadeRuleFired: boolean;
  magnitude: number | null;
  depthKm: number | null;
}

export interface TsunamiAssessmentInput {
  magnitude: number | null;
  depthKm: number | null;
  lat: number;
  lon: number;
}

export const TsunamiReasoner = {
  /**
   * Cascade thresholds:
   *   HIGH      — M ≥ 7.5 AND depth ≤ 70 km
   *   MODERATE  — M ≥ 6.5 AND depth ≤ 50 km
   *   LOW       — submarine subduction-zone hit AND M ≥ 6.0
   *   NONE      — otherwise (or magnitude unknown)
   *
   * `cascadeRuleFired` is true when a HIGH-tier event additionally lies
   * in a known submarine subduction zone — this is the "auto-advisory
   * before PTWC bulletin lands" gate downstream consumers care about.
   */
  assessThreat(event: TsunamiAssessmentInput | CanonicalSeismicEvent): TsunamiThreatAssessment {
    const reasons: string[] = [];
    const sub = locateSubductionZone(event.lat, event.lon);
    const isSubmarine = sub.hit;
    if (isSubmarine) reasons.push(`submarine subduction zone: ${sub.zone}`);

    const m = event.magnitude;
    const d = event.depthKm;

    if (m === null || !Number.isFinite(m)) {
      reasons.push('magnitude unknown — threat level falls through to none');
      return {
        level: 'none',
        reasons,
        isSubmarine,
        subductionZone: sub.zone,
        cascadeRuleFired: false,
        magnitude: m,
        depthKm: d,
      };
    }

    const depthOk70 = d === null || !Number.isFinite(d) ? true : d <= 70;
    const depthOk50 = d === null || !Number.isFinite(d) ? true : d <= 50;

    let level: TsunamiThreatLevel = 'none';
    let cascadeRuleFired = false;

    if (m >= 7.5 && depthOk70) {
      level = 'high';
      reasons.push(`M${m} ≥ 7.5 with depth ≤ 70 km — high tsunami potential`);
      cascadeRuleFired = isSubmarine;
      if (!cascadeRuleFired) reasons.push('outside known subduction zones — cascade auto-advisory not fired');
    } else if (m >= 6.5 && depthOk50) {
      level = 'moderate';
      reasons.push(`M${m} ≥ 6.5 with depth ≤ 50 km — moderate tsunami potential`);
    } else if (isSubmarine && m >= 6) {
      level = 'low';
      reasons.push(`M${m} submarine event — low tsunami potential`);
    } else {
      reasons.push('thresholds not met — no tsunami threat from earthquake parameters alone');
    }

    return {
      level,
      reasons,
      isSubmarine,
      subductionZone: sub.zone,
      cascadeRuleFired,
      magnitude: m,
      depthKm: d,
    };
  },
};

// ─── DART buoy anomaly detection ──────────────────────────────────────

/** The 10 NDBC DART buoys covering the Pacific basin + Caribbean. */
export const DART_BUOY_IDS = [
  '46411', // NE Pacific (off Eureka)
  '46412', // NE Pacific (off N. California)
  '46413', // NE Pacific (off W. Oregon)
  '46407', // NE Pacific (off N. Oregon)
  '51407', // Hawaii
  '55023', // SW Pacific
  '55012', // SW Pacific
  '55015', // SW Pacific
  '32401', // Eastern Pacific (off N. Chile)
  '32412', // Eastern Pacific (off Lima, Peru)
] as const;
export type DARTBuoyId = typeof DART_BUOY_IDS[number];

export interface DARTReading {
  buoyId: string;
  /** ms epoch */
  timestamp: number;
  /** Sea level height in meters (instantaneous height). */
  seaLevelMeters: number;
}

export interface DARTAnomalyResult {
  buoyId: string;
  anomalyDetected: boolean;
  /** Latest reading minus baseline mean, expressed in centimeters. */
  deviationCm: number;
  baselineMeters: number;
  latestMeters: number;
  sampleCount: number;
  reason: string;
}

export class DARTAnomalyDetector {
  /** Threshold above which a deviation is considered anomalous (cm). */
  static readonly THRESHOLD_CM = 2;
  /** Window size for the rolling baseline. */
  static readonly WINDOW = 10;

  /**
   * Sort the readings ascending by timestamp, take the last WINDOW,
   * compare the latest sample to the mean of the WINDOW-1 prior
   * samples. Anomaly when |deviation| > THRESHOLD_CM.
   */
  static analyze(buoyId: string, readings: readonly DARTReading[]): DARTAnomalyResult {
    const recent = [...readings]
      .filter((r) => Number.isFinite(r.seaLevelMeters) && Number.isFinite(r.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-DARTAnomalyDetector.WINDOW);

    if (recent.length < 2) {
      return {
        buoyId,
        anomalyDetected: false,
        deviationCm: 0,
        baselineMeters: Number.NaN,
        latestMeters: Number.NaN,
        sampleCount: recent.length,
        reason: 'insufficient samples (need ≥2)',
      };
    }

    const last = recent[recent.length - 1];
    if (!last) {
      // Unreachable: recent.length >= 2 from the guard above; satisfies noUncheckedIndexedAccess.
      return {
        buoyId,
        anomalyDetected: false,
        deviationCm: 0,
        baselineMeters: Number.NaN,
        latestMeters: Number.NaN,
        sampleCount: recent.length,
        reason: 'insufficient samples (need ≥2)',
      };
    }
    const latest = last.seaLevelMeters;
    const priorSum = recent.slice(0, -1).reduce((acc, r) => acc + r.seaLevelMeters, 0);
    const baseline = priorSum / (recent.length - 1);
    const deviationCm = (latest - baseline) * 100;
    const absDevCm = Math.abs(deviationCm);
    const anomaly = absDevCm > DARTAnomalyDetector.THRESHOLD_CM;

    return {
      buoyId,
      anomalyDetected: anomaly,
      deviationCm,
      baselineMeters: baseline,
      latestMeters: latest,
      sampleCount: recent.length,
      reason: anomaly
        ? `deviation ${deviationCm.toFixed(2)} cm exceeds ${DARTAnomalyDetector.THRESHOLD_CM} cm threshold`
        : `deviation ${deviationCm.toFixed(2)} cm within ${DARTAnomalyDetector.THRESHOLD_CM} cm threshold`,
    };
  }
}

/**
 * Parse one DART buoy NDBC realtime2 .txt body. Format is:
 *
 *   #YY  MM DD hh mm ss T   HEIGHT
 *   #yr  mo dy hr mn  s -   m
 *   2026 05 05 17 00  0 1   2942.123
 *   ...
 *
 * Lines starting with `#` are ignored. The 8th column is the sea-level
 * height in meters (the column is `HEIGHT`). Returns oldest-first.
 */
export function parseDartTxt(buoyId: string, body: string): DARTReading[] {
  const out: DARTReading[] = [];
  const lines = body.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 8) continue;
    const yy = Number.parseInt(cols[0] ?? '', 10);
    const mn = Number.parseInt(cols[1] ?? '', 10);
    const dy = Number.parseInt(cols[2] ?? '', 10);
    const hr = Number.parseInt(cols[3] ?? '', 10);
    const min = Number.parseInt(cols[4] ?? '', 10);
    const sec = Number.parseInt(cols[5] ?? '', 10);
    const m = Number.parseFloat(cols[7] ?? '');
    if (![yy, mn, dy, hr, min, sec].every((v) => Number.isFinite(v)) || !Number.isFinite(m)) continue;
    const ts = Date.UTC(yy, mn - 1, dy, hr, min, sec);
    out.push({ buoyId, timestamp: ts, seaLevelMeters: m });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── PTWC Atom parser ─────────────────────────────────────────────────

export interface PTWCBulletin {
  id: string;
  title: string;
  summary: string;
  publishedAt: number | null;
  updatedAt: number | null;
  link: string | null;
}

/**
 * Parse the PTWC PAAQAtom.xml feed. Tolerates CDATA blocks, missing
 * `<published>` (falls back to `<updated>`), and entries without a
 * `<link>` (sets `link: null`). Returns entries in upstream order.
 */
export function parsePTWCAtom(xml: string): PTWCBulletin[] {
  const out: PTWCBulletin[] = [];
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? [];
  for (const block of entries) {
    const id = textOf(block, 'id');
    if (!id) continue;
    const title = textOf(block, 'title');
    const summary = textOf(block, 'summary');
    const updated = textOf(block, 'updated');
    const published = textOf(block, 'published');
    const link = (/<link\b[^>]*\bhref="([^"]+)"/.exec(block))?.[1] ?? null;
    out.push({
      id,
      title,
      summary,
      publishedAt: published ? safeParseDate(published) : null,
      updatedAt: updated ? safeParseDate(updated) : null,
      link,
    });
  }
  return out;
}

function textOf(block: string, tag: string): string {
  const m = new RegExp(String.raw`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`).exec(block);
  if (m?.[1] === undefined) return '';
  return stripHtml(m[1]).trim();
}

function stripHtml(s: string): string {
  const noCdata = s.split('<![CDATA[').join('').split(']]>').join('');
  // eslint-disable-next-line sonarjs/slow-regex -- bounded char class, single-character match — linear time.
  return noCdata.replace(/<[^>]+>/g, '');
}

function safeParseDate(s: string): number | null {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ─── Combined snapshot ────────────────────────────────────────────────

export interface TsunamiStatusSnapshot {
  fetchedAt: number;
  ptwcBulletins: PTWCBulletin[];
  dartAnomalies: DARTAnomalyResult[];
  /** True if any DART buoy is reporting an anomaly. */
  anyDartAnomaly: boolean;
  /** True if any PTWC bulletin is present in the feed. */
  hasActiveBulletin: boolean;
}

/**
 * Pure helper that fuses the two sidecar-fetched payloads (PTWC + DART)
 * into a single snapshot the renderer can render directly. Renderer
 * never has to walk both lists itself.
 */
export function buildTsunamiStatusSnapshot(input: {
  fetchedAt: number;
  ptwcBulletins: PTWCBulletin[];
  dartAnomalies: DARTAnomalyResult[];
}): TsunamiStatusSnapshot {
  return {
    fetchedAt: input.fetchedAt,
    ptwcBulletins: [...input.ptwcBulletins],
    dartAnomalies: [...input.dartAnomalies],
    anyDartAnomaly: input.dartAnomalies.some((d) => d.anomalyDetected),
    hasActiveBulletin: input.ptwcBulletins.length > 0,
  };
}
