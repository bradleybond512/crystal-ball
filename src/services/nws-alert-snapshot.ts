import { normalizeNwsAlert } from '../../src-tauri/sidecar/nws-alert-row.mjs';
export interface NWSAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
  areaDesc: string;
  sent: string;
  onset?: string;
  expires: string;
  status: 'Actual';
  messageType: 'Alert' | 'Update';
  retrievedAt?: number;
  centroid: [number, number] | null;
  geometry?: NWSGeometry | null;
}

type Position = [number, number, ...number[]];
type LinearRing = Position[];
type PolygonCoordinates = LinearRing[];

export type NWSGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };

export const MAX_NWS_SNAPSHOT_ALERTS = 2000;
interface GeometryBudget {polygons:number; rings:number; vertices:number}

export interface NWSAlertSnapshot {
  schemaVersion: 1;
  scope: 'national-active';
  completeness: 'complete';
  observedAt: number;
  alerts: NWSAlert[];
}

export function validateNWSAlertSnapshot(value: unknown, now = Date.now()): NWSAlertSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1 || snapshot.scope !== 'national-active'
    || snapshot.completeness !== 'complete' || typeof snapshot.observedAt !== 'number'
    || !Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt <= 0
    || snapshot.observedAt > 8_640_000_000_000_000 || snapshot.observedAt > now || !Array.isArray(snapshot.alerts)
    || snapshot.alerts.length > MAX_NWS_SNAPSHOT_ALERTS) return null;
  const responseBudget: GeometryBudget = { polygons: 0, rings: 0, vertices: 0 };
  const alerts: NWSAlert[] = [];
  const ids = new Set<string>();
  for (const row of snapshot.alerts) {
    const alert = normalizeNwsAlert(row, responseBudget);
    if (!alert || ids.has(alert.id)) return null;
    const sent = Date.parse(alert.sent);
    if (sent < 0 || sent > snapshot.observedAt || Date.parse(alert.expires) <= sent) return null;
    ids.add(alert.id);
    alerts.push({ ...alert, retrievedAt: snapshot.observedAt });
  }
  const metadata = {
    version: 1, observedAt: snapshot.observedAt,
    members: alerts.map(alert => ({ id: `nws-${alert.id}`, issuedAt: Date.parse(alert.sent), expiresAt: Date.parse(alert.expires) })),
  };
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 2 * 1024 * 1024) return null;
  return {
    schemaVersion: 1, scope: 'national-active', completeness: 'complete',
    observedAt: snapshot.observedAt, alerts,
  };
}
