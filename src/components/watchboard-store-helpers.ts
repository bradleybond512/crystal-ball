import type {
  GeoPolygon,
  GeoCircle,
  GeoShape,
  Tripwire,
  WatchboardSignal,
  WatchboardTemplate,
} from '../types/watchboard';

export type { WatchboardTemplate } from '../types/watchboard';

/** True when (px,py) lies on the segment (ax,ay)→(bx,by), within float tolerance. */
function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > 1e-9) return false; // not collinear
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < 0) return false; // before the segment start
  const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot <= lenSq; // within the segment end
}

export function pointInPolygon(lon: number, lat: number, polygon: GeoPolygon): boolean {
  const coords = polygon.coordinates;
  if (coords.length < 3) return false;
  // Boundary-inclusive: standing exactly on the fence line counts as inside
  // the geofence. Ray casting alone treats edges asymmetrically, so check
  // edge membership explicitly first.
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i]!, b = coords[(i + 1) % coords.length]!;
    if (pointOnSegment(lon, lat, a[0], a[1], b[0], b[1])) return true;
  }
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const ci = coords[i]!, cj = coords[j]!;
    const xi = ci[0], yi = ci[1];
    const xj = cj[0], yj = cj[1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInCircle(lon: number, lat: number, circle: GeoCircle): boolean {
  const R = 6371;
  const lat1 = lat * Math.PI / 180;
  const lat2 = circle.center[1] * Math.PI / 180;
  const dLat = (circle.center[1] - lat) * Math.PI / 180;
  const dLon = (circle.center[0] - lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(a));
  return d <= circle.radiusKm;
}

export function pointInShape(lon: number, lat: number, shape: GeoShape): boolean {
  if (shape.type === 'polygon') return pointInPolygon(lon, lat, shape);
  return pointInCircle(lon, lat, shape);
}

export function evaluateTripwire(tripwire: Tripwire, signal: WatchboardSignal): boolean {
  if (!pointInShape(signal.lon, signal.lat, tripwire.shape)) return false;
  for (const condition of tripwire.conditions) {
    switch (condition.type) {
      case 'domain':
        if (signal.domain !== condition.value) return false;
        break;
      case 'severity':
        if (signal.severity === undefined || signal.severity < (condition.value as number)) return false;
        break;
      case 'entity':
        if (!(signal.entityIds?.includes(condition.value as string) ?? false)) return false;
        break;
      case 'keyword': {
        const needle = String(condition.value).toLowerCase();
        const hay = (typeof signal.payload === 'string' ? signal.payload : safeStringify(signal.payload)).toLowerCase();
        if (!hay.includes(needle)) return false;
        break;
      }
      case 'event-type':
        if (signal.eventType !== condition.value) return false;
        break;
    }
  }
  return true;
}

/** JSON-serialise a payload for keyword search, tolerating circular refs. */
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

export function getTemplates(): WatchboardTemplate[] {
  return [
    {
      name: 'Strait of Hormuz',
      description: 'Maritime chokepoint between the Persian Gulf and Gulf of Oman',
      shapes: [{ type: 'circle', center: [56.3, 26.5], radiusKm: 150 }],
      conditions: [{ id: 'c1', type: 'domain', value: 'maritime', description: 'Maritime domain events' }],
    },
    {
      name: 'Taiwan Strait',
      description: 'Strait between mainland China and Taiwan',
      shapes: [
        {
          type: 'polygon',
          coordinates: [
            [118, 23],
            [122, 23],
            [122, 26],
            [118, 26],
            [118, 23],
          ],
        },
      ],
      conditions: [{ id: 'c1', type: 'domain', value: 'military', description: 'Military domain events' }],
    },
    {
      name: 'Black Sea',
      description: 'Black Sea maritime zone',
      shapes: [
        {
          type: 'polygon',
          coordinates: [
            [28, 41],
            [41, 41],
            [41, 46.5],
            [28, 46.5],
            [28, 41],
          ],
        },
      ],
      conditions: [{ id: 'c1', type: 'domain', value: 'maritime', description: 'Maritime domain events' }],
    },
    {
      name: 'Global Emergency Squawks',
      description: 'Worldwide aircraft squawking 7500/7600/7700',
      // Earth-spanning circle: max surface distance is ~20015 km (antipodal),
      // so 25000 km from the origin covers every point on the globe — both
      // poles and the antimeridian included.
      shapes: [{ type: 'circle', center: [0, 0], radiusKm: 25000 }],
      conditions: [
        { id: 'c1', type: 'event-type', value: 'emergency_squawk', description: 'Aircraft emergency squawk (7500/7600/7700)' },
        { id: 'c2', type: 'domain', value: 'aviation', description: 'Aviation domain events' },
      ],
    },
    {
      name: 'Earthquake Watch',
      description: 'Worldwide significant seismic activity',
      shapes: [{ type: 'circle', center: [0, 0], radiusKm: 25000 }],
      conditions: [
        { id: 'c1', type: 'severity', value: 0.6, description: 'Severity at or above 0.6' },
        { id: 'c2', type: 'domain', value: 'seismic', description: 'Seismic domain events' },
      ],
    },
  ];
}
