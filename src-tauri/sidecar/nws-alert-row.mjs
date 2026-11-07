const MAX_FEATURE_POLYGONS = 256;
const MAX_FEATURE_RINGS = 1024;
const MAX_FEATURE_VERTICES = 50_000;
const MAX_RESPONSE_POLYGONS = 512;
const MAX_RESPONSE_RINGS = 2048;
const MAX_RESPONSE_VERTICES = 250_000;
const SEVERITIES = new Set(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const URGENCIES = new Set(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']);
const STATUSES = new Set(['Actual']);
const MESSAGE_TYPES = new Set(['Alert', 'Update']);
function isTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCentroid(value) {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length !== 2) return false;
  const lon = value[0];
  const lat = value[1];
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isPosition(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lon = value[0];
  const lat = value[1];
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isClosedNonzeroRing(value) {
  if (!Array.isArray(value) || value.length < 4) return false;
  if (!value.every((position) => isPosition(position))) return false;
  const first = value[0];
  const last = value[value.length - 1];
  if (!first || first[0] !== last?.[0] || first[1] !== last[1]) return false;

  let doubledArea = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    const current = value[index];
    const next = value[index + 1];
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Number.isFinite(doubledArea) && Math.abs(doubledArea) > Number.EPSILON;
}

function isPolygonCoordinates(value, budget, responseBudget) {
  if (!Array.isArray(value) || value.length === 0) return false;
  budget.rings += value.length;
  if (budget.rings > MAX_FEATURE_RINGS || responseBudget.rings + budget.rings > MAX_RESPONSE_RINGS) return false;
  for (const ring of value) {
    if (!Array.isArray(ring)) return false;
    budget.vertices += ring.length;
    if (budget.vertices > MAX_FEATURE_VERTICES || responseBudget.vertices + budget.vertices > MAX_RESPONSE_VERTICES) return false;
    if (!isClosedNonzeroRing(ring)) return false;
  }
  return true;
}

function isGeometry(value, responseBudget) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const geometry = value;
  const featureBudget = { polygons: 0, rings: 0, vertices: 0 };

  let polygons;
  if (geometry.type === 'Polygon') {
    polygons = [geometry.coordinates];
  } else if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
    polygons = geometry.coordinates;
  } else {
    return false;
  }
  featureBudget.polygons = polygons.length;
  if (featureBudget.polygons > MAX_FEATURE_POLYGONS
    || responseBudget.polygons + featureBudget.polygons > MAX_RESPONSE_POLYGONS) return false;
  for (const polygon of polygons) {
    if (!isPolygonCoordinates(polygon, featureBudget, responseBudget)) return false;
  }

  responseBudget.polygons += featureBudget.polygons;
  responseBudget.rings += featureBudget.rings;
  responseBudget.vertices += featureBudget.vertices;
  return true;
}

export function normalizeNwsAlert(value, responseBudget) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const alert = value;
  const onset = typeof alert.onset === 'string' ? alert.onset.trim() : '';
  const valid = typeof alert.id === 'string' && alert.id.length > 0 && alert.id.length <= 1024
    && typeof alert.event === 'string'
    && typeof alert.headline === 'string'
    && typeof alert.description === 'string'
    && SEVERITIES.has(alert.severity)
    && URGENCIES.has(alert.urgency)
    && typeof alert.areaDesc === 'string'
    && isTimestamp(alert.sent)
    && (alert.onset === undefined || alert.onset === null
      || (typeof alert.onset === 'string' && (onset.length === 0 || isTimestamp(onset))))
    && isTimestamp(alert.expires)
    && STATUSES.has(alert.status)
    && MESSAGE_TYPES.has(alert.messageType)
    && isCentroid(alert.centroid)
    && isGeometry(alert.geometry, responseBudget);
  if (!valid) return null;

  const normalized = { ...alert };
  if (onset.length > 0) normalized.onset = onset;
  else delete normalized.onset;
  return normalized;
}
