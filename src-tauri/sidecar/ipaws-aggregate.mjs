// src-tauri/sidecar/ipaws-aggregate.mjs
//
// Pure transformers for FEMA IPAWS / NWS CAP feeds. Inputs come from the
// sidecar /api/alerts/active route handler; outputs are typed IpawsAlert
// records consumed by the renderer.

function safeStr(value) {
  return typeof value === 'string' ? value : '';
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function polygonCentroid(coordinates) {
  // GeoJSON Polygon: coordinates is [outer, ...holes]; outer is array of [lon, lat]
  const ring = Array.isArray(coordinates) ? coordinates[0] : null;
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sumLon = 0;
  let sumLat = 0;
  let count = 0;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = safeNum(point[0]);
    const lat = safeNum(point[1]);
    if (lon == null || lat == null) continue;
    sumLon += lon;
    sumLat += lat;
    count += 1;
  }
  return count > 0 ? [sumLon / count, sumLat / count] : null;
}

function extractCentroid(feature) {
  const geom = feature?.geometry;
  if (!geom) return null;
  if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    const [lon, lat] = geom.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number') return [lon, lat];
  }
  if (geom.type === 'Polygon') return polygonCentroid(geom.coordinates);
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates) && geom.coordinates[0]) {
    return polygonCentroid(geom.coordinates[0]);
  }
  return null;
}

export function parseNwsCapFeatures(features) {
  if (!Array.isArray(features)) return [];
  const out = [];
  for (const f of features) {
    const props = f?.properties ?? {};
    const id = safeStr(props.id) || safeStr(f?.id);
    if (!id) continue;
    out.push({
      id,
      source: 'NWS',
      event: safeStr(props.event),
      headline: safeStr(props.headline),
      description: safeStr(props.description).slice(0, 500),
      severity: safeStr(props.severity) || 'Unknown',
      urgency: safeStr(props.urgency) || 'Unknown',
      certainty: safeStr(props.certainty) || 'Unknown',
      areaDesc: safeStr(props.areaDesc),
      effective: safeStr(props.effective),
      expires: safeStr(props.expires),
      status: safeStr(props.status),
      centroid: extractCentroid(f),
    });
  }
  return out;
}

export function parseFemaDisasters(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const num = safeNum(row?.disasterNumber);
    if (num == null) continue;
    out.push({
      id: `fema-disaster-${num}`,
      source: 'FEMA',
      event: safeStr(row.incidentType) || 'Disaster Declaration',
      headline: safeStr(row.declarationTitle),
      description: '',
      severity: 'Severe',
      urgency: 'Expected',
      certainty: 'Observed',
      areaDesc: safeStr(row.state),
      effective: safeStr(row.declarationDate),
      expires: '',
      status: 'Actual',
      centroid: null,
    });
  }
  return out;
}

export function dedupeAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  const seen = new Set();
  const out = [];
  for (const alert of alerts) {
    const id = alert?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(alert);
  }
  return out;
}

export function expireAlerts(alerts, nowMs) {
  if (!Array.isArray(alerts)) return [];
  const cutoff = typeof nowMs === 'number' ? nowMs : Date.now();
  const out = [];
  for (const alert of alerts) {
    const expires = alert?.expires;
    if (!expires) {
      out.push(alert);
      continue;
    }
    const t = Date.parse(expires);
    if (!Number.isFinite(t)) {
      out.push(alert);
      continue;
    }
    if (t >= cutoff) out.push(alert);
  }
  return out;
}
