import * as satellite from 'satellite.js';
import { getApiBaseUrl } from '@/services/runtime';

export interface OrbitalSatellite {
  id: string;
  name: string;
  lat: number; // degrees
  lon: number; // degrees
  alt: number; // km above ellipsoid
  group: string;
}

// SOCRATES query.php endpoints are now 404. Route through the sidecar /api/tle
// proxy (which fetches the working /NORAD/elements/gp.php endpoint without
// sending an Origin header). Only stations are served; visual is inferred by
// propagating the same set and filtering by altitude + radar cross-section.
function getTleGroups(): Record<string, string> {
  const base = getApiBaseUrl();
  return {
    stations: `${base}/api/tle`,
  };
}

function parseTleText(text: string): { name: string; line1: string; line2: string }[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const result = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
 result.push({ name: lines[i]!, line1: lines[i + 1]!, line2: lines[i + 2]! });
  }
  return result;
}

function propagateSat(name: string, line1: string, line2: string, group: string): OrbitalSatellite | null {
  try {
 const satrec = satellite.twoline2satrec(line1, line2);
 const now = new Date();
 const posVel = satellite.propagate(satrec, now);
 if (typeof posVel.position === 'boolean' || !posVel.position) return null;
 const gmst = satellite.gstime(now);
 const geo = satellite.eciToGeodetic(posVel.position, gmst);
 return {
 id: `${group}-${name.trim()}`,
 name: name.trim(),
 lat: satellite.degreesLat(geo.latitude),
 lon: satellite.degreesLong(geo.longitude),
 alt: geo.height,
 group,
 };
  } catch {
 return null;
  }
}

export async function fetchOrbitalSatellites(): Promise<OrbitalSatellite[]> {
  const results: OrbitalSatellite[] = [];

  for (const [group, url] of Object.entries(getTleGroups())) {
 try {
 const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) continue;
 const text = await res.text();
 const tles = parseTleText(text);
 for (const { name, line1, line2 } of tles.slice(0, 150)) {
 const sat = propagateSat(name, line1, line2, group);
 if (sat) results.push(sat);
 }
 } catch {
 // network unavailable
 }
  }

  return results;
}
