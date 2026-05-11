/**
 * Focal mechanism classification — Layer 4 (descoped from waveform plan).
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Takes a USGS moment-tensor product JSON payload and produces a
 * `FocalMechanism` with the two nodal planes, fault type classification,
 * and a simple SVG beach ball ready to embed in the UI.
 *
 * Plan invariants:
 *   - Classification rule (Aki-Richards rake convention, degrees):
 *       strike-slip: |rake| < 30 OR |rake| > 150
 *       normal:      rake in [-150, -30]   (i.e. rake < -30 and >= -150)
 *       reverse:     rake in [ 30,  150]   (i.e. rake >  30 and <=  150)
 *       oblique:     anything that doesn't match a clear pure case
 *     We use the steeper-dipping plane's rake as the discriminant — it is
 *     more diagnostic for fault type than the auxiliary plane.
 *   - The SVG beach ball is intentionally schematic. We draw a canonical
 *     pattern per fault type and rotate it by the steeper plane's strike.
 *     That communicates fault type at a glance without claiming Aki-
 *     Richards stereographic accuracy. A future PR can swap in real
 *     focal-sphere projection.
 *   - SVG output contains only fixed shape primitives (`circle`, `path`,
 *     `g`) with numeric attributes derived from typed inputs. No string
 *     interpolation of caller-provided text into element bodies.
 *   - Pure parser. The sidecar `/api/focal-mechanism` endpoint forwards
 *     the upstream USGS payload; this module's `parseUsgsMomentTensor`
 *     does the work, deterministically, on plain JSON.
 */

// ── Public types ────────────────────────────────────────────────────────

export type FaultType = 'strike_slip' | 'normal' | 'reverse' | 'oblique';

export interface NodalPlane {
  /** Compass azimuth of the fault strike, 0..360 degrees from north. */
  strike: number;
  /** Dip angle from horizontal, 0..90 degrees. */
  dip: number;
  /** Slip rake on the plane, -180..180 degrees (Aki-Richards). */
  rake: number;
}

export interface FocalMechanism {
  eventId: string;
  nodalPlane1: NodalPlane;
  nodalPlane2: NodalPlane;
  faultType: FaultType;
  /** Moment magnitude (Mw) from the moment tensor product. */
  momentMagnitude: number | null;
  depthKm: number | null;
  /** Self-contained SVG string with only numeric attributes. */
  beachballSvg: string;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Classify a fault type from a single nodal plane's rake angle.
 * Plan rule: |rake| < 30 strike-slip; rake in (30,150] reverse;
 * rake in [-150,-30) normal; everything else oblique.
 */
export function classifyFaultType(rake: number): FaultType {
  const r = normalizeRake(rake);
  const abs = Math.abs(r);
  if (abs < 30 || abs > 150) return 'strike_slip';
  if (r >= 30 && r <= 150) return 'reverse';
  if (r >= -150 && r <= -30) return 'normal';
  return 'oblique';
}

/**
 * Pick the more-diagnostic plane for fault-type classification: the one
 * with the steeper dip. When dips are equal, plane 1 wins by convention.
 */
export function pickDiagnosticPlane(p1: NodalPlane, p2: NodalPlane): NodalPlane {
  return p2.dip > p1.dip ? p2 : p1;
}

/**
 * Build a self-contained schematic beach ball SVG. The pattern is
 * canonical per fault type; the steeper plane's strike determines
 * rotation. Compressional quadrants are filled (`#1a1a1a`),
 * dilatational quadrants are white. A thin black circle bounds the
 * focal sphere.
 */
export function buildBeachballSvg(
  planes: { p1: NodalPlane; p2: NodalPlane },
  faultType: FaultType,
  size = 64,
): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const rotation = pickDiagnosticPlane(planes.p1, planes.p2).strike;
  const fill = '#1a1a1a';

  const ariaLabel = faultTypeAria(faultType);
  const header = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${ariaLabel}">`;
  const outline = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="black" stroke-width="1"/>`;
  const groupOpen = `<g transform="rotate(${fmt(rotation)} ${cx} ${cy})">`;
  const groupClose = `</g>`;

  let body = '';
  switch (faultType) {
    case 'strike_slip': {
      // Two perpendicular nodal planes; compressional quadrants are NE
      // and SW (or NW and SE depending on slip sense). Schematic: fill
      // the two opposite quadrants spanning [0,90] and [180,270] (degrees
      // measured clockwise from north on the SVG).
      body =
        wedge(cx, cy, r, 0, 90, fill)
        + wedge(cx, cy, r, 180, 270, fill);
      break;
    }
    case 'normal': {
      // Tension axis horizontal, P-axis vertical → schematic shows
      // dilatational center band, compressional caps. We fill two
      // diameter-aligned wedges centered on north and south.
      body =
        wedge(cx, cy, r, -45, 45, fill)
        + wedge(cx, cy, r, 135, 225, fill);
      break;
    }
    case 'reverse': {
      // P-axis horizontal → compressional regions on left and right;
      // dilatational top and bottom. Schematic: fill east and west
      // wedges centered on those compass directions.
      body =
        wedge(cx, cy, r, 45, 135, fill)
        + wedge(cx, cy, r, 225, 315, fill);
      break;
    }
    case 'oblique': {
      // Half-filled disk along the strike — a neutral tilt that conveys
      // "not a clean pure mechanism" without misclaiming a sense.
      body = wedge(cx, cy, r, 0, 180, fill);
      break;
    }
  }

  return `${header}${outline}${groupOpen}${body}${groupClose}</svg>`;
}

/**
 * Parse a USGS FDSN GeoJSON event response and pull out the first
 * moment-tensor product's nodal planes. Returns null when the payload
 * lacks a moment-tensor product or the planes are unparseable — callers
 * should treat that as "no focal mechanism available".
 */
export function parseUsgsMomentTensor(
  payload: unknown,
  options: { eventId?: string } = {},
): FocalMechanism | null {
  const feature = pickFeature(payload);
  if (!feature) return null;

  const eventId = options.eventId
    ?? readString(feature, 'id')
    ?? readString(readObject(feature, 'properties'), 'code')
    ?? '';
  if (!eventId) return null;

  const products = readObject(readObject(feature, 'properties'), 'products');
  const momentTensors = readArray(products, 'moment-tensor');
  if (momentTensors.length === 0) return null;

  // Prefer the first non-deleted, preferred-weight tensor. Without that
  // metadata fall back to the first entry.
  const tensor = momentTensors[0];
  if (!tensor || typeof tensor !== 'object') return null;
  const props = readObject(tensor, 'properties');

  const p1 = readNodalPlane(props, 1);
  const p2 = readNodalPlane(props, 2);
  if (!p1 || !p2) return null;

  const faultType = classifyFaultType(pickDiagnosticPlane(p1, p2).rake);
  const momentMagnitude = readFiniteNumber(props, 'derived-magnitude');
  const depthKm = readFiniteNumber(props, 'derived-depth');
  const beachballSvg = buildBeachballSvg({ p1, p2 }, faultType);

  return {
    eventId,
    nodalPlane1: p1,
    nodalPlane2: p2,
    faultType,
    momentMagnitude,
    depthKm,
    beachballSvg,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────

function normalizeRake(rake: number): number {
  if (!Number.isFinite(rake)) return 0;
  let r = rake % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number(n.toFixed(2)).toString();
}

function faultTypeAria(faultType: FaultType): string {
  switch (faultType) {
    case 'strike_slip': { return 'strike slip focal mechanism';
    }
    case 'normal': {      return 'normal focal mechanism';
    }
    case 'reverse': {     return 'reverse focal mechanism';
    }
    case 'oblique': {     return 'oblique focal mechanism';
    }
  }
}

/**
 * Filled circular wedge from `startDeg` to `endDeg`, where 0° points up
 * (north) and angles increase clockwise. Mirrors the convention used in
 * compass-style beach balls.
 */
function wedge(cx: number, cy: number, r: number, startDeg: number, endDeg: number, fill: string): string {
  const a0 = ((startDeg - 90) * Math.PI) / 180;
  const a1 = ((endDeg - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `<path d="M ${fmt(cx)} ${fmt(cy)} L ${fmt(x0)} ${fmt(y0)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 1 ${fmt(x1)} ${fmt(y1)} Z" fill="${fill}"/>`;
}

function pickFeature(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (obj.type === 'Feature') return obj;
  if (obj.type === 'FeatureCollection') {
    const features = obj.features;
    if (Array.isArray(features) && features.length > 0 && features[0] && typeof features[0] === 'object') {
      return features[0] as Record<string, unknown>;
    }
  }
  return null;
}

function readObject(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readArray(obj: unknown, key: string): readonly unknown[] {
  if (!obj || typeof obj !== 'object') return [];
  const value = (obj as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

function readString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function readFiniteNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNodalPlane(props: Record<string, unknown> | null, index: 1 | 2): NodalPlane | null {
  if (!props) return null;
  const strike = readFiniteNumber(props, `nodal-plane-${index}-strike`);
  const dip = readFiniteNumber(props, `nodal-plane-${index}-dip`);
  const rake = readFiniteNumber(props, `nodal-plane-${index}-rake`);
  if (strike === null || dip === null || rake === null) return null;
  return {
    strike: ((strike % 360) + 360) % 360,
    dip: clampNonNegative(dip),
    rake: normalizeRake(rake),
  };
}

function clampNonNegative(n: number): number {
  return Math.max(n, 0);
}
