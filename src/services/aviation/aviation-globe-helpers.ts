/**
 * Aviation globe-layer helpers — pure-deterministic shape + style
 * computations consumed by `GlobeDataManager.loadAviationIntel()`.
 *
 * No Cesium imports here on purpose: this module is unit-testable in
 * Node and the renderer wraps the outputs into Cesium entities.
 */

import type {
  AviationNotam,
  AviationSigmet,
  MilitaryAircraft,
  VolcanicAshAdvisory,
} from './aviation-intel-types';

// Public shape outputs

export interface CirclePolygonInput {
  centerLat: number;
  centerLon: number;
  radiusNm: number;
}

export interface NotamCircleStyle {
  /** Hex color for the outline. */
  outlineHex: string;
  /** Fill color (when fillAlpha > 0). */
  fillHex: string;
  /** 0..1; 0 means outline-only. */
  fillAlpha: number;
}

export interface SigmetStyle {
  /** Hex color for the polygon outline + fill. */
  hex: string;
  /** 0..1; default 0.20 for visible-but-not-overpowering. */
  fillAlpha: number;
}

// TFR styling

export function notamStyle(notam: AviationNotam): NotamCircleStyle {
  if (notam.presidential) {
    return { outlineHex: '#ff453a', fillHex: '#ff453a', fillAlpha: 0.2 };
  }
  return { outlineHex: '#ef4444', fillHex: '#ef4444', fillAlpha: 0 };
}

// SIGMET styling

const SIGMET_HEX: Record<AviationSigmet['hazard'], string> = {
  volcanic_ash: '#ff9800',
  turbulence: '#ffeb3b',
  icing: '#4a9eff',
  thunderstorm: '#ef4444',
  mountain_obscuration: '#9e9e9e',
  ifr: '#9c27b0',
  other: '#607d8b',
};

export function sigmetStyle(sigmet: AviationSigmet): SigmetStyle {
  const hex = SIGMET_HEX[sigmet.hazard];
  // Ash gets a slightly darker fill so it's distinct from turbulence yellow.
  const fillAlpha = sigmet.hazard === 'volcanic_ash' ? 0.28 : 0.18;
  return { hex, fillAlpha };
}

// Volcanic ash advisory styling — distinct from SIGMET hazard color so
// stacked ash + turbulence reads correctly.
export const VOLCANIC_ASH_HEX = '#ff7043';
export const VOLCANIC_ASH_FILL_ALPHA = 0.3;

// Approximate a circle as a polygon ring of N points. Uses the local
// flat-earth approximation: 1° lat ≈ 60 NM, 1° lon ≈ 60 NM × cos(lat).
// Good enough for radii up to ~200 NM at any latitude away from the poles.

export function circleToPolygon(
  input: CirclePolygonInput,
  segments = 64,
): { lat: number; lon: number }[] {
  const { centerLat, centerLon, radiusNm } = input;
  const out: { lat: number; lon: number }[] = [];
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dLat = radiusNm / 60;
  const dLon = radiusNm / (60 * Math.max(cosLat, 0.001));
  for (let i = 0; i < segments; i += 1) {
    const angle = (i * 2 * Math.PI) / segments;
    out.push({
      lat: centerLat + dLat * Math.sin(angle),
      lon: centerLon + dLon * Math.cos(angle),
    });
  }
  // Close the ring.
  if (out.length > 0) out.push({ ...out[0]! });
  return out;
}

// Aircraft styling

const AIRCRAFT_TYPE_HEX: Record<MilitaryAircraft['type'], string> = {
  transport: '#4a9eff',
  tanker: '#26c6da',
  recon: '#9c27b0',
  fighter: '#ffeb3b',
  bomber: '#ff9800',
  helo: '#8bc34a',
  unknown: '#9e9e9e',
};

export function aircraftStyle(ac: MilitaryAircraft): { hex: string; emergency: boolean } {
  if (ac.emergency) return { hex: '#ff453a', emergency: true };
  return { hex: AIRCRAFT_TYPE_HEX[ac.type], emergency: false };
}

// Filtering helpers

export function tfrsWithGeometry(notams: readonly AviationNotam[]): AviationNotam[] {
  return notams.filter(
    (n) =>
      (n.classification === 'TFR' || /TFR/i.test(n.text)) &&
      n.center !== undefined,
  );
}

export function aircraftWithPosition(
  list: readonly MilitaryAircraft[],
): MilitaryAircraft[] {
  return list.filter((ac) => ac.lat !== null && ac.lon !== null);
}

export function ashAdvisoriesWithPolygon(
  advisories: readonly VolcanicAshAdvisory[],
): VolcanicAshAdvisory[] {
  return advisories.filter((a) => a.polygon.length >= 3);
}

// Description text builders for Cesium info boxes.

export function notamDescriptionHtml(n: AviationNotam): string {
  const escape = htmlEscape;
  const parts: (string | false)[] = [
    `<h3>${escape(n.notamNumber || n.id)}</h3>`,
    n.presidential && `<strong style="color:#ff453a;">PRESIDENTIAL TFR</strong>`,
    n.icaoId !== null && `<div>ICAO: ${escape(n.icaoId ?? '')}</div>`,
    n.center !== undefined &&
      `<div>Center: ${n.center.lat.toFixed(3)}°, ${n.center.lon.toFixed(3)}° • radius ${n.center.radiusNm} NM</div>`,
    n.altitudeFt !== undefined &&
      `<div>Altitude: ${n.altitudeFt.min ?? 'SFC'} – ${n.altitudeFt.max ?? 'unlimited'} ft</div>`,
    `<pre style="white-space:pre-wrap;">${escape(n.text)}</pre>`,
  ];
  return parts.filter(Boolean).join('\n');
}

export function sigmetDescriptionHtml(s: AviationSigmet): string {
  const escape = htmlEscape;
  const parts: (string | false)[] = [
    `<h3>${escape(s.id)} — ${escape(s.hazard.replace(/_/g, ' '))}</h3>`,
    `<div>Severity: <strong>${escape(s.severity)}</strong></div>`,
    s.altitudeFt !== undefined &&
      `<div>Altitude: FL${(s.altitudeFt.min / 100).toFixed(0)} – FL${(s.altitudeFt.max / 100).toFixed(0)}</div>`,
    `<pre style="white-space:pre-wrap;">${escape(s.text)}</pre>`,
  ];
  return parts.filter(Boolean).join('\n');
}

export function aircraftDescriptionHtml(ac: MilitaryAircraft): string {
  const escape = htmlEscape;
  const parts: (string | false)[] = [
    `<h3>${escape(ac.callsign ?? ac.icao24)}</h3>`,
    `<div>Type: ${escape(ac.type)}</div>`,
    ac.country !== null && `<div>Origin: ${escape(ac.country ?? '')}</div>`,
    ac.altitudeFt !== null && `<div>Altitude: ${ac.altitudeFt} ft</div>`,
    ac.velocityKts !== null && `<div>Speed: ${Math.round(ac.velocityKts)} kt</div>`,
    ac.heading !== null && `<div>Heading: ${Math.round(ac.heading)}°</div>`,
    ac.emergency &&
      `<strong style="color:#ff453a;">EMERGENCY squawk ${escape(ac.squawk ?? '')}</strong>`,
  ];
  return parts.filter(Boolean).join('\n');
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
