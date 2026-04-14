import type { PredictedDestination, RoutePrediction, ConfidenceCone } from '@/types';

// ---- Known Waypoints ----

interface Waypoint {
  name: string;
  lat: number;
  lon: number;
  type: 'base' | 'chokepoint' | 'exercise' | 'conflict';
}

export const KNOWN_WAYPOINTS: Waypoint[] = [
  // Major naval bases
  { name: 'Norfolk', lat: 36.95, lon: -76.33, type: 'base' },
  { name: 'San Diego', lat: 32.68, lon: -117.18, type: 'base' },
  { name: 'Pearl Harbor', lat: 21.35, lon: -157.95, type: 'base' },
  { name: 'Yokosuka', lat: 35.28, lon: 139.67, type: 'base' },
  { name: 'Bahrain (NAVCENT)', lat: 26.24, lon: 50.52, type: 'base' },
  { name: 'Rota', lat: 36.63, lon: -6.35, type: 'base' },
  { name: 'Sigonella', lat: 37.40, lon: 14.92, type: 'base' },
  { name: 'Diego Garcia', lat: -7.32, lon: 72.42, type: 'base' },
  { name: 'Guam', lat: 13.58, lon: 144.93, type: 'base' },
  { name: 'Sasebo', lat: 33.16, lon: 129.72, type: 'base' },
  // Air bases
  { name: 'Ramstein', lat: 49.44, lon: 7.60, type: 'base' },
  { name: 'Incirlik', lat: 37.00, lon: 35.43, type: 'base' },
  { name: 'Al Udeid', lat: 25.12, lon: 51.31, type: 'base' },
  { name: 'Kadena', lat: 26.35, lon: 127.77, type: 'base' },
  { name: 'Osan', lat: 37.09, lon: 127.03, type: 'base' },
  { name: 'Lakenheath', lat: 52.41, lon: 0.56, type: 'base' },
  { name: 'Fairford', lat: 51.68, lon: -1.79, type: 'base' },
  { name: 'Andersen (Guam)', lat: 13.58, lon: 144.92, type: 'base' },
  // Strategic chokepoints
  { name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, type: 'chokepoint' },
  { name: 'Suez Canal', lat: 30.46, lon: 32.35, type: 'chokepoint' },
  { name: 'Strait of Malacca', lat: 2.50, lon: 101.50, type: 'chokepoint' },
  { name: 'Bab el-Mandeb', lat: 12.58, lon: 43.33, type: 'chokepoint' },
  { name: 'GIUK Gap', lat: 63.00, lon: -15.00, type: 'chokepoint' },
  { name: 'Taiwan Strait', lat: 24.50, lon: 119.50, type: 'chokepoint' },
  { name: 'Strait of Gibraltar', lat: 35.96, lon: -5.50, type: 'chokepoint' },
  { name: 'Panama Canal', lat: 9.08, lon: -79.68, type: 'chokepoint' },
  { name: 'Danish Straits', lat: 55.70, lon: 12.60, type: 'chokepoint' },
  { name: 'Bosphorus', lat: 41.12, lon: 29.05, type: 'chokepoint' },
  // Exercise areas
  { name: 'RIMPAC (Hawaii)', lat: 20.00, lon: -157.00, type: 'exercise' },
  { name: 'BALTOPS (Baltic)', lat: 56.00, lon: 18.00, type: 'exercise' },
  { name: 'Formidable Shield (Atlantic)', lat: 58.00, lon: -12.00, type: 'exercise' },
];

// ---- Haversine helpers ----

const R_KM = 6371;
const DEG = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG);
  const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

function destinationPoint(lat: number, lon: number, bearingDeg: number, distKm: number): [number, number] {
  const d = distKm / R_KM;
  const brng = bearingDeg * DEG;
  const lat1 = lat * DEG;
  const lon1 = lon * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 / DEG, ((lon2 / DEG) + 540) % 360 - 180];
}

// ---- Layer 1: Extrapolation ----

export function extrapolatePath(
  lat: number, lon: number, heading: number, speedKnots: number, hours: number,
): [number, number][] {
  const speedKmH = speedKnots * 1.852;
  const totalKm = speedKmH * hours;
  const points: [number, number][] = [];
  for (let i = 1; i <= 12; i++) {
    const km = (totalKm / 12) * i;
    points.push(destinationPoint(lat, lon, heading, km));
  }
  return points;
}

// ---- Layer 2: Historical Pattern Matching ----

export function scoreDestinations(
  lat: number, lon: number, heading: number, speedKnots: number,
): PredictedDestination[] {
  const speedKmH = speedKnots * 1.852;
  const maxRangeKm = speedKmH * 72;

  const scored: { wp: Waypoint; score: number }[] = [];

  for (const wp of KNOWN_WAYPOINTS) {
    const dist = haversineKm(lat, lon, wp.lat, wp.lon);
    if (dist < 50) continue;
    if (dist > maxRangeKm && maxRangeKm > 0) continue;

    const bearing = bearingTo(lat, lon, wp.lat, wp.lon);
    const angleDiff = Math.abs(heading - bearing);
    const alignment = Math.cos(Math.min(angleDiff, 360 - angleDiff) * DEG);
    if (alignment < 0) continue;

    const distScore = Math.max(0, 1 - dist / (maxRangeKm || 10000));
    const typeWeight = wp.type === 'chokepoint' ? 1.3 : wp.type === 'conflict' ? 1.5 : 1.0;
    const score = alignment * (0.4 + distScore * 0.6) * typeWeight;
    if (score > 0.05) {
      scored.push({ wp, score });
    }
  }

  if (scored.length === 0) {
    return [{ name: 'Unknown', lat: 0, lon: 0, probability: 100, reasoning: 'No matching waypoints along current heading' }];
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  const totalScore = top.reduce((s, d) => s + d.score, 0);

  return top.map(d => ({
    name: d.wp.name,
    lat: d.wp.lat,
    lon: d.wp.lon,
    probability: Math.round((d.score / totalScore) * 100),
    reasoning: `Bearing-aligned ${d.wp.type}, ${Math.round(haversineKm(lat, lon, d.wp.lat, d.wp.lon))} km`,
  }));
}

// ---- Confidence Cone ----

export function computeConfidenceCone(
  heading: number, speedKnots: number, hoursTracked: number,
): ConfidenceCone {
  const baseSpread = 30;
  const historyFactor = Math.max(0.3, 1 - hoursTracked / 24);
  const spread = baseSpread * historyFactor;
  const rangeKm = speedKnots * 1.852 * 24;

  return {
    bearingMin: (heading - spread + 360) % 360,
    bearingMax: (heading + spread + 360) % 360,
    rangeKm,
  };
}

// ---- Combined Prediction ----

export function computePrediction(
  lat: number, lon: number, heading: number, speedKnots: number,
  hoursTracked: number, aiAssessment?: string,
): RoutePrediction {
  const extrapolatedPath = extrapolatePath(lat, lon, heading, speedKnots, 24);
  const destinations = scoreDestinations(lat, lon, heading, speedKnots);
  const confidenceCone = computeConfidenceCone(heading, speedKnots, hoursTracked);

  return {
    extrapolatedPath,
    destinations,
    confidenceCone,
    method: aiAssessment ? 'combined' : 'pattern',
    updatedAt: new Date(),
  };
}
