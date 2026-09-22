import type { SavedPlace } from './saved-places';
import type { UnifiedAlert } from './unified-alerts';

export interface DigestStorySeed {
  id: string;
  alertIds: string[];
  headline: string;
  narrative: string;
}

export type DigestImpactStatus =
  | 'likely'
  | 'possible'
  | 'no_reported_overlap'
  | 'unknown'
  | 'not_evaluated';

export interface DigestStoryCard extends DigestStorySeed {
  locationText: string;
  impactText: string;
  impactStatus: DigestImpactStatus;
  evaluatedAt: number;
  recheckAt: number | null;
}

export interface ProjectDigestStoriesInput {
  seeds: readonly DigestStorySeed[];
  alerts: readonly UnifiedAlert[];
  savedPlaces: readonly SavedPlace[];
  now: number;
}

type Position = readonly [number, number];
type Ring = Position[];
type Polygon = Ring[];

interface GeometryParseState {
  vertices: number;
  rings: number;
  polygons: number;
}

interface GeometryWorkBudget {
  remaining: number;
}

interface GeometryEvaluationContext {
  work: GeometryWorkBudget;
  cache: WeakMap<object, ParsedNwsGeometry>;
}

interface ParsedNwsGeometry {
  polygons: Polygon[];
  vertices: number;
}

interface GeometryPreflight {
  vertices: number;
}

interface ExpandedAlerts {
  alerts: UnifiedAlert[];
  incomplete: boolean;
}

interface ImpactEvidence {
  status: 'likely' | 'possible' | 'no_reported_overlap' | 'unknown';
  kind?: 'area-inside' | 'area-near' | 'point-near' | 'global';
  place?: SavedPlace;
  places?: SavedPlace[];
  areaHasNear?: boolean;
}

const MAX_STORIES = 5;
const MAX_ALERTS = 500;
const MAX_SAVED_PLACES = 50;
const MAX_ALERT_REFS = 50;
const MAX_MEMBER_DEPTH = 4;
const MAX_GEOMETRY_VERTICES = 50_000;
const MAX_GEOMETRY_RINGS = 1024;
const MAX_GEOMETRY_POLYGONS = 256;
const MAX_GEOMETRY_WORK = 250_000;
const NWS_RETRIEVAL_MAX_AGE_MS = 30 * 60_000;
const KM_PER_DEGREE = 111.195;

function consumeGeometryWork(work: GeometryWorkBudget, amount = 1): boolean {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > work.remaining) {
    work.remaining = 0;
    return false;
  }
  work.remaining -= amount;
  return true;
}

function isCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function boundedText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function alertIndex(alerts: readonly UnifiedAlert[]): { index: Map<string, UnifiedAlert>; truncated: boolean } {
  const index = new Map<string, UnifiedAlert>();
  const limit = Math.min(alerts.length, MAX_ALERTS);
  for (let i = 0; i < limit; i += 1) {
    const alert = alerts[i];
    if (alert && !index.has(alert.id)) index.set(alert.id, alert);
  }
  return { index, truncated: alerts.length > MAX_ALERTS };
}

function isMemberContainer(alert: UnifiedAlert): boolean {
  return alert.spatialScope?.kind === 'members'
    || (alert.source === 'correlation' && alert.correlationMembers !== undefined);
}

function appendCorrelationMembers(
  alert: UnifiedAlert,
  depth: number,
  queue: { id: string; depth: number }[],
): boolean {
  if (!isMemberContainer(alert)) return false;
  const members = alert.correlationMembers;
  if (!members || members.length === 0 || depth >= MAX_MEMBER_DEPTH) return true;
  for (const memberId of members) {
    if (queue.length >= MAX_ALERT_REFS) return true;
    queue.push({ id: memberId, depth: depth + 1 });
  }
  return false;
}

function expandAlerts(seed: DigestStorySeed, index: Map<string, UnifiedAlert>): ExpandedAlerts {
  const queue = seed.alertIds.slice(0, MAX_ALERT_REFS).map((id) => ({ id, depth: 0 }));
  const seen = new Set<string>();
  const alerts: UnifiedAlert[] = [];
  let incomplete = seed.alertIds.length > MAX_ALERT_REFS;

  for (let cursor = 0; cursor < queue.length && alerts.length < MAX_ALERT_REFS; cursor += 1) {
    const item = queue[cursor];
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    const alert = index.get(item.id);
    if (!alert) {
      incomplete = true;
      continue;
    }
    alerts.push(alert);
    if (appendCorrelationMembers(alert, item.depth, queue)) incomplete = true;
  }
  return { alerts, incomplete };
}

function leafAlerts(alerts: readonly UnifiedAlert[]): UnifiedAlert[] {
  return alerts.filter((alert) => !isMemberContainer(alert));
}

function rawAreaLabel(alert: UnifiedAlert): string | undefined {
  if (!alert.raw || typeof alert.raw !== 'object' || Array.isArray(alert.raw)) return undefined;
  const value = (alert.raw as Record<string, unknown>).areaDesc;
  return typeof value === 'string' && value.trim() ? boundedText(value, 160) : undefined;
}

function coordinateText(lat: number, lon: number): string {
  const latitude = `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
  return `${latitude}, ${longitude}`;
}

function locationLabel(alert: UnifiedAlert): string | undefined {
  if (alert.spatialScope?.kind === 'global') return 'Worldwide';
  const label = rawAreaLabel(alert) ?? (alert.location?.label ? boundedText(alert.location.label, 160) : undefined);
  if (label) return label;
  if (alert.location && isCoordinate(alert.location.lat, alert.location.lon)) {
    return `Near ${coordinateText(alert.location.lat, alert.location.lon)}`;
  }
  return undefined;
}

function singleLocationText(alert: UnifiedAlert): string {
  if (alert.spatialScope?.kind === 'global') return 'Location: Worldwide.';
  const label = locationLabel(alert);
  if (!label) return 'Location: Not reported.';
  if (alert.spatialScope?.kind === 'area') return `Location: ${label} (NWS alert area).`;
  if (alert.spatialScope?.kind === 'point'
    && (alert.spatialScope.basis === 'centroid' || alert.spatialScope.basis === 'regional-centroid')) {
    return `Location: ${label} (reported area centroid).`;
  }
  return `Location: ${label}.`;
}

function locationText(alerts: readonly UnifiedAlert[]): string {
  const located = alerts.filter((alert) => locationLabel(alert) !== undefined);
  if (located.length === 0) return 'Location: Not reported.';
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const alert of located) {
    const label = locationLabel(alert);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  if (labels.length === 1) {
    const alert = located.find((candidate) => locationLabel(candidate) === labels[0]);
    return alert ? singleLocationText(alert) : 'Location: Not reported.';
  }
  const shown = labels.slice(0, 3);
  const remainder = labels.length - shown.length;
  if (remainder > 0) return `Locations: ${shown.join('; ')}; and ${remainder} more.`;
  return `Locations: ${shown.slice(0, -1).join('; ')}; and ${shown[shown.length - 1]}.`;
}

function parsePosition(value: unknown, state: GeometryParseState): Position | null {
  if (!Array.isArray(value) || value.length < 2 || !value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    return null;
  }
  const lon = value[0] as number;
  const lat = value[1] as number;
  state.vertices += 1;
  if (state.vertices > MAX_GEOMETRY_VERTICES || !isCoordinate(lat, lon)) return null;
  return [lon, lat];
}

function unwrapLongitude(previous: number, next: number): number {
  let result = next;
  while (result - previous > 180) result -= 360;
  while (result - previous < -180) result += 360;
  return result;
}

function hasUsableArea(ring: Ring): boolean {
  let area = 0;
  let previousLon = ring[0]?.[0] ?? 0;
  for (let i = 1; i < ring.length; i += 1) {
    const previous = ring[i - 1];
    const current = ring[i];
    if (!previous || !current) return false;
    const currentLon = unwrapLongitude(previousLon, current[0]);
    area += previousLon * current[1] - currentLon * previous[1];
    previousLon = currentLon;
  }
  return Math.abs(area) > 1e-12;
}

function parseRing(value: unknown, state: GeometryParseState): Ring | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  state.rings += 1;
  if (state.rings > MAX_GEOMETRY_RINGS) return null;
  const ring: Ring = [];
  for (const rawPosition of value) {
    const position = parsePosition(rawPosition, state);
    if (!position) return null;
    ring.push(position);
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1] || !hasUsableArea(ring)) return null;
  return ring;
}

function parsePolygon(value: unknown, state: GeometryParseState): Polygon | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  state.polygons += 1;
  if (state.polygons > MAX_GEOMETRY_POLYGONS) return null;
  const polygon: Polygon = [];
  for (const rawRing of value) {
    const ring = parseRing(rawRing, state);
    if (!ring) return null;
    polygon.push(ring);
  }
  return polygon;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasCurrentNwsLifecycle(raw: Record<string, unknown>, now: number): boolean {
  const sent = parseTimestamp(raw.sent);
  const onset = parseTimestamp(raw.onset);
  const expires = parseTimestamp(raw.expires);
  const retrievedAt = raw.retrievedAt;
  return raw.status === 'Actual'
    && (raw.messageType === 'Alert' || raw.messageType === 'Update')
    && sent !== null && sent <= now
    && onset !== null && onset <= now
    && expires !== null && expires > now
    && sent < expires && onset < expires
    && typeof retrievedAt === 'number' && Number.isFinite(retrievedAt)
    && retrievedAt >= sent && retrievedAt <= now
    && now - retrievedAt <= NWS_RETRIEVAL_MAX_AGE_MS;
}

function preflightPolygon(value: unknown, state: GeometryParseState): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  state.polygons += 1;
  if (state.polygons > MAX_GEOMETRY_POLYGONS) return false;
  for (const rawRing of value) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) return false;
    state.rings += 1;
    state.vertices += rawRing.length;
    if (state.rings > MAX_GEOMETRY_RINGS || state.vertices > MAX_GEOMETRY_VERTICES) return false;
  }
  return true;
}

function preflightGeometry(value: Record<string, unknown>): GeometryPreflight | null {
  const state: GeometryParseState = { vertices: 0, rings: 0, polygons: 0 };
  if (value.type === 'Polygon') {
    if (!preflightPolygon(value.coordinates, state)) return null;
  } else if (value.type === 'MultiPolygon' && Array.isArray(value.coordinates)
    && value.coordinates.length > 0) {
    for (const rawPolygon of value.coordinates) {
      if (!preflightPolygon(rawPolygon, state)) return null;
    }
  } else {
    return null;
  }
  return { vertices: state.vertices };
}

function parseGeometryValue(value: Record<string, unknown>, state: GeometryParseState): Polygon[] | null {
  if (value.type === 'Polygon') {
    const polygon = parsePolygon(value.coordinates, state);
    return polygon ? [polygon] : null;
  }
  if (value.type !== 'MultiPolygon' || !Array.isArray(value.coordinates) || value.coordinates.length === 0) {
    return null;
  }
  const polygons: Polygon[] = [];
  for (const rawPolygon of value.coordinates) {
    const polygon = parsePolygon(rawPolygon, state);
    if (!polygon) return null;
    polygons.push(polygon);
  }
  return polygons;
}

function parseNwsGeometry(
  alert: UnifiedAlert,
  now: number,
  context: GeometryEvaluationContext,
  placeCount: number,
): ParsedNwsGeometry | null {
  if (alert.source !== 'nws' || alert.spatialScope?.kind !== 'area'
    || !alert.raw || typeof alert.raw !== 'object' || Array.isArray(alert.raw)) return null;
  const raw = alert.raw as Record<string, unknown>;
  if (!hasCurrentNwsLifecycle(raw, now)) return null;
  const geometry = raw.geometry;
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) return null;
  const value = geometry as Record<string, unknown>;
  const preflight = preflightGeometry(value);
  if (!preflight) return null;
  const cached = context.cache.get(geometry);
  const parseWork = cached ? 0 : preflight.vertices;
  const evaluationWork = preflight.vertices * placeCount * 4;
  if (!consumeGeometryWork(context.work, parseWork + evaluationWork)) return null;
  if (cached) return cached;
  const state: GeometryParseState = { vertices: 0, rings: 0, polygons: 0 };
  const polygons = parseGeometryValue(value, state);
  if (!polygons || state.vertices !== preflight.vertices) return null;
  const parsed = { polygons, vertices: state.vertices };
  context.cache.set(geometry, parsed);
  return parsed;
}

function unwrapRing(ring: Ring): Ring {
  const unwrapped: Ring = [];
  let previous = ring[0]?.[0] ?? 0;
  for (const position of ring) {
    const lon = unwrapped.length === 0 ? position[0] : unwrapLongitude(previous, position[0]);
    unwrapped.push([lon, position[1]]);
    previous = lon;
  }
  return unwrapped;
}

function pointOnSegment(pointLon: number, pointLat: number, a: Position, b: Position): boolean {
  const lengthSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  if (lengthSq === 0) return Math.abs(pointLon - a[0]) <= 1e-10 && Math.abs(pointLat - a[1]) <= 1e-10;
  const cross = (pointLat - a[1]) * (b[0] - a[0]) - (pointLon - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (pointLon - a[0]) * (b[0] - a[0]) + (pointLat - a[1]) * (b[1] - a[1]);
  return dot >= -1e-10 && dot <= lengthSq + 1e-10;
}

function pointInRing(lat: number, lon: number, sourceRing: Ring): boolean {
  const ring = unwrapRing(sourceRing);
  const averageLon = ring.reduce((total, position) => total + position[0], 0) / ring.length;
  const pointLon = lon + Math.round((averageLon - lon) / 360) * 360;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (!a || !b) continue;
    if (pointOnSegment(pointLon, lat, a, b)) return true;
    if ((a[1] > lat) !== (b[1] > lat)
      && pointLon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lat: number, lon: number, polygon: Polygon): boolean {
  const outer = polygon[0];
  if (!outer || !pointInRing(lat, lon, outer)) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    const hole = polygon[i];
    if (hole && pointInRing(lat, lon, hole)) return false;
  }
  return true;
}

function normalizeLongitudeDelta(delta: number): number {
  let result = delta;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function distanceToSegmentKm(place: SavedPlace, a: Position, b: Position): number {
  const aLon = a[0];
  const bLon = aLon + normalizeLongitudeDelta(b[0] - aLon);
  const midpoint = (aLon + bLon) / 2;
  const placeLon = place.lon + Math.round((midpoint - place.lon) / 360) * 360;
  const cosLat = Math.cos((place.lat * Math.PI) / 180);
  const ax = (aLon - placeLon) * cosLat;
  const ay = a[1] - place.lat;
  const bx = (bLon - placeLon) * cosLat;
  const by = b[1] - place.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
  return Math.hypot(ax + t * dx, ay + t * dy) * KM_PER_DEGREE;
}

function distanceToPolygonsKm(place: SavedPlace, polygons: readonly Polygon[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i += 1) {
        const a = ring[i - 1];
        const b = ring[i];
        if (a && b) nearest = Math.min(nearest, distanceToSegmentKm(place, a, b));
      }
    }
  }
  return nearest;
}

function evaluateArea(
  alert: UnifiedAlert,
  places: readonly SavedPlace[],
  now: number,
  context: GeometryEvaluationContext,
): ImpactEvidence {
  const geometry = parseNwsGeometry(alert, now, context, places.length);
  if (!geometry) return { status: 'unknown' };
  const { polygons } = geometry;
  const impacted: { place: SavedPlace; inside: boolean }[] = [];
  for (const place of places) {
    if (!isCoordinate(place.lat, place.lon)
      || !Number.isFinite(place.radiusKm) || place.radiusKm < 0) return { status: 'unknown' };
    const inside = polygons.some((polygon) => pointInPolygon(place.lat, place.lon, polygon));
    if (inside || distanceToPolygonsKm(place, polygons) <= place.radiusKm) impacted.push({ place, inside });
  }
  const affectedPlaces = impacted.map((item) => item.place);
  if (impacted.some((item) => item.inside)) {
    return {
      status: 'likely',
      kind: 'area-inside',
      places: affectedPlaces,
      areaHasNear: impacted.some((item) => !item.inside),
    };
  }
  if (affectedPlaces.length > 0) return { status: 'possible', kind: 'area-near', places: affectedPlaces };
  return { status: 'no_reported_overlap' };
}

function pointDistanceKm(place: SavedPlace, lat: number, lon: number): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(lat - place.lat);
  const dLon = toRadians(lon - place.lon);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(place.lat)) * Math.cos(toRadians(lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function evaluateAlert(
  alert: UnifiedAlert,
  places: readonly SavedPlace[],
  now: number,
  context: GeometryEvaluationContext,
): ImpactEvidence {
  const scope = alert.spatialScope;
  if (!scope) return { status: 'unknown' };
  if (scope.kind === 'global') return { status: 'possible', kind: 'global' };
  if (scope.kind === 'area') return evaluateArea(alert, places, now, context);
  if (scope.kind !== 'point' || scope.basis !== 'reported-event' || !alert.location
    || !isCoordinate(alert.location.lat, alert.location.lon)) return { status: 'unknown' };
  for (const place of places) {
    if (!isCoordinate(place.lat, place.lon) || !Number.isFinite(place.radiusKm) || place.radiusKm < 0) {
      return { status: 'unknown' };
    }
    if (pointDistanceKm(place, alert.location.lat, alert.location.lon) <= place.radiusKm) {
      return { status: 'possible', kind: 'point-near', place };
    }
  }
  return { status: 'unknown' };
}

function placeName(place: SavedPlace | undefined): string {
  return boundedText(place?.name ?? 'A saved place', 80);
}

function placeNames(evidence: ImpactEvidence): { text: string; plural: boolean } {
  const places = evidence.places ?? (evidence.place ? [evidence.place] : []);
  const names = places.slice(0, 3).map((place) => placeName(place));
  const remainder = places.length - names.length;
  if (remainder > 0) return { text: `${names.join(', ')}, and ${remainder} more`, plural: true };
  if (names.length > 1) return {
    text: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
    plural: true,
  };
  return { text: names[0] ?? 'A saved place', plural: false };
}

function positiveImpactText(evidence: ImpactEvidence): string {
  const names = placeNames(evidence);
  switch (evidence.kind) {
    case 'area-inside': {
      if (evidence.areaHasNear) {
        return `Saved-place impact: Likely — ${names.text} ${names.plural ? 'are' : 'is'} inside or within ${names.plural ? 'their' : 'its'} saved watch radius of the reported NWS alert area.`;
      }
      return `Saved-place impact: Likely — ${names.text} ${names.plural ? 'are' : 'is'} inside the reported NWS alert area.`;
    }
    case 'area-near': {
      return `Saved-place impact: Possible — ${names.text} ${names.plural ? 'are' : 'is'} within ${names.plural ? 'their' : 'its'} saved watch radius of the reported alert area.`;
    }
    case 'point-near': {
      return `Saved-place impact: Possible — ${placeName(evidence.place)} is within its saved watch radius of the reported event location; local effects are not confirmed.`;
    }
    case 'global': {
      return 'Saved-place impact: Possible at all saved places — this alert has global scope; local effects are not confirmed.';
    }
    default: {
      return 'Saved-place impact: Unknown — this alert has no complete usable impact area.';
    }
  }
}

function impactProjection(
  alerts: readonly UnifiedAlert[],
  savedPlaces: readonly SavedPlace[],
  now: number,
  incomplete: boolean,
  context: GeometryEvaluationContext,
): Pick<DigestStoryCard, 'impactStatus' | 'impactText'> {
  if (savedPlaces.length === 0) {
    return {
      impactStatus: 'not_evaluated',
      impactText: 'Saved-place impact: Not evaluated — no saved places are configured.',
    };
  }
  const places = savedPlaces.slice(0, MAX_SAVED_PLACES);
  const evidence = alerts.map((alert) => evaluateAlert(alert, places, now, context));
  const likely = evidence.find((item) => item.status === 'likely');
  const possible = evidence.find((item) => item.status === 'possible');
  const positive = likely ?? possible;
  const hasUnknown = incomplete || savedPlaces.length > MAX_SAVED_PLACES
    || evidence.some((item) => item.status === 'unknown');
  if (positive) {
    const suffix = hasUnknown ? ' Unknown — some related alert evidence could not be evaluated.' : '';
    return { impactStatus: positive.status, impactText: positiveImpactText(positive) + suffix };
  }
  if (hasUnknown || evidence.length === 0) {
    return {
      impactStatus: 'unknown',
      impactText: 'Saved-place impact: Unknown — this alert has no complete usable impact area.',
    };
  }
  return {
    impactStatus: 'no_reported_overlap',
    impactText: 'Saved-place impact: No reported overlap — no saved-place watch radius intersects the complete current NWS alert area. This is not an all-clear.',
  };
}

function nextEvidenceBoundary(alerts: readonly UnifiedAlert[], now: number): number | null {
  let boundary: number | null = null;
  for (const alert of alerts) {
    if (alert.source !== 'nws' || alert.spatialScope?.kind !== 'area'
      || !alert.raw || typeof alert.raw !== 'object' || Array.isArray(alert.raw)) continue;
    const raw = alert.raw as Record<string, unknown>;
    if (!hasCurrentNwsLifecycle(raw, now)) continue;
    const next = Math.min(parseTimestamp(raw.expires)!, (raw.retrievedAt as number) + NWS_RETRIEVAL_MAX_AGE_MS + 1);
    if (next > now && (boundary === null || next < boundary)) boundary = next;
  }
  return boundary;
}

export function projectDigestStories(input: ProjectDigestStoriesInput): DigestStoryCard[] {
  const { index, truncated } = alertIndex(input.alerts);
  const geometryContext: GeometryEvaluationContext = {
    work: { remaining: MAX_GEOMETRY_WORK },
    cache: new WeakMap(),
  };
  return input.seeds.slice(0, MAX_STORIES).map((seed) => {
    const expanded = expandAlerts(seed, index);
    const alerts = leafAlerts(expanded.alerts);
    const impact = impactProjection(
      alerts,
      input.savedPlaces,
      input.now,
      expanded.incomplete || truncated,
      geometryContext,
    );
    return {
      id: seed.id,
      alertIds: seed.alertIds.slice(0, MAX_ALERT_REFS),
      headline: boundedText(seed.headline, 200),
      narrative: boundedText(seed.narrative, 600),
      locationText: locationText(alerts),
      ...impact,
      evaluatedAt: input.now,
      recheckAt: input.savedPlaces.length > 0 ? nextEvidenceBoundary(alerts, input.now) : null,
    };
  });
}
