/** Map-only presentation. No scoring, severity inference or provider access. */
import Supercluster from 'supercluster';
import type { ForecastContribution, ForecastRegion } from '@/services/forecast-overlay';
import type { ScoredFAACamera } from '@/services/faa-cameras';

export interface MapFeature {
  id: string;
  family: 'forecast' | 'camera' | 'datacenter';
  title: string;
  center: [number, number];
  metrics: readonly { label: string; value: string }[];
  memberIds: readonly string[];
  visible: boolean;
}

export interface FeatureRef {
  id: string;
  family: MapFeature['family'];
}

export interface ForecastPresentation {
  id: string;
  center: [number, number];
  geometry: 'point' | 'radius';
  radius: number;
  memberIds: string[];
  features: MapFeature[];
  label: string;
}

function position(center: unknown): [number, number] | null {
  if (!Array.isArray(center)) return null;
  const [lon, lat] = center as readonly unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)
    || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  // The antimeridian and negative zero have one presentation identity.
  let normalizedLon = lon === 0 ? 0 : lon;
  if (lon === 180) normalizedLon = -180;
  return [normalizedLon, lat === 0 ? 0 : lat];
}

function title(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function compareIds(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

interface ForecastSource {
  feature: MapFeature;
  radius: number;
}

function forecastSources(regions: readonly ForecastRegion[]): ForecastSource[] {
  const sources = new Map<string, ForecastSource>();
  for (const region of regions) {
    for (const contribution of region.contributions) {
      const center = position(contribution.center);
      if (!center) continue;
      const id = `forecast:${contribution.kind}:${contribution.id}`;
      if (sources.has(id)) continue;
      sources.set(id, {
        feature: contributionFeature(contribution, id, center),
        radius: Number.isFinite(contribution.radius) && contribution.radius > 0 ? contribution.radius : 0,
      });
    }
  }
  return [...sources.values()].sort((a, b) => compareIds(a.feature, b.feature));
}

function contributionFeature(contribution: ForecastContribution, id: string, center: [number, number]): MapFeature {
  return {
    id,
    family: 'forecast',
    title: contribution.kind === 'ema'
      ? title(contribution.label, 'Forecast region')
      : title(contribution.title, 'Reported situation'),
    center,
    metrics: contribution.kind === 'ema'
      ? [{ label: 'EMA forecast score', value: String(contribution.riskScore) }]
      : [{ label: 'Situation confidence', value: `${Math.round(contribution.confidence * 100)}%` }],
    memberIds: [id],
    visible: true,
  };
}

/** The accessible list always represents original contributions, not viewport groups. */
export function forecastFeatures(regions: readonly ForecastRegion[]): MapFeature[] {
  return forecastSources(regions).map(source => source.feature);
}

/** Group only identical geometry; a reported point never inherits its EMA parent's footprint. */
export function groupForecastPresentation(regions: readonly ForecastRegion[]): ForecastPresentation[] {
  const groups = new Map<string, ForecastPresentation>();
  for (const { feature, radius } of forecastSources(regions)) {
    const geometry = radius > 0 ? 'radius' : 'point';
    const key = JSON.stringify([feature.center, geometry, radius]);
    const existing = groups.get(key);
    if (existing) {
      existing.features.push(feature);
      existing.memberIds.push(feature.id);
    } else {
      groups.set(key, {
        id: '', center: [...feature.center], geometry, radius,
        memberIds: [feature.id], features: [feature], label: feature.title,
      });
    }
  }
  for (const group of groups.values()) {
    group.id = `forecast-group:${JSON.stringify([group.center, group.geometry, group.radius, group.memberIds])}`;
    group.label = group.features.length === 1 ? group.features[0]!.title : `${group.features.length} forecast items`;
  }
  return [...groups.values()].sort(compareIds);
}

export interface CameraPresentation {
  id: string;
  center: [number, number];
  count: number;
  memberIds: string[];
  /** Geographic proximity only; this does not represent camera/event severity. */
  nearAlert: boolean;
  camera?: ScoredFAACamera;
  clusterId?: number;
}

interface CameraPointProperties {
  id: string;
  nearAlert: boolean;
}

interface CameraClusterProperties {
  nearAlert: boolean;
}

function cameraIndex(): Supercluster<CameraPointProperties, CameraClusterProperties> {
  return new Supercluster<CameraPointProperties, CameraClusterProperties>({
    radius: 48, maxZoom: 16,
    map: props => ({ nearAlert: props.nearAlert }),
    reduce: (acc, props) => { acc.nearAlert ||= props.nearAlert; },
  });
}

function nearAlert(camera: ScoredFAACamera): boolean {
  return camera.alertProximityMi !== null && Number.isFinite(camera.alertProximityMi) && camera.alertProximityMi >= 0;
}

function cameraFeature(camera: ScoredFAACamera, id: string, center: [number, number]): MapFeature {
  const metrics = [{ label: 'Camera status', value: camera.isOnline ? 'Online' : 'Offline' }];
  if (nearAlert(camera)) metrics.push({ label: 'Alert proximity', value: `${camera.alertProximityMi} mi` });
  return {
    id, family: 'camera', title: title(camera.name, `FAA camera ${camera.id}`),
    center, metrics, memberIds: [id], visible: true,
  };
}

/** Rebuild at the data setter, never in the render loop. Viewport results retain complete leaves. */
export class CameraPresentationIndex {
  private index = cameraIndex();
  private cameras = new Map<string, ScoredFAACamera>();
  private features: MapFeature[] = [];
  private clusterMembers = new Map<number, string[]>();

  constructor(cameras: readonly ScoredFAACamera[] = []) {
    this.rebuild(cameras);
  }

  rebuild(cameras: readonly ScoredFAACamera[]): void {
    this.cameras.clear();
    this.clusterMembers.clear();
    this.features = [];
    const points: Supercluster.PointFeature<CameraPointProperties>[] = [];
    // A deterministic snapshot makes Supercluster identifiers independent of incoming row order.
    for (const camera of [...cameras].sort(compareIds)) {
      const center = position([camera.lon, camera.lat]);
      const id = `camera:${camera.id}`;
      if (!center || this.cameras.has(id)) continue;
      this.cameras.set(id, { ...camera });
      this.features.push(cameraFeature(camera, id, center));
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: { id, nearAlert: nearAlert(camera) } });
    }
    this.index = cameraIndex().load(points);
  }

  getFeatures(): MapFeature[] {
    return this.features.map(feature => ({ ...feature, center: [...feature.center], memberIds: [...feature.memberIds], metrics: feature.metrics.map(metric => ({ ...metric })) }));
  }

  getCamera(id: string): ScoredFAACamera | undefined {
    return this.cameras.get(id);
  }

  expansionZoom(clusterId: number): number {
    return this.index.getClusterExpansionZoom(clusterId);
  }

  getClusters(bounds: [number, number, number, number], zoom: number): CameraPresentation[] {
    if (!bounds.every(value => Number.isFinite(value)) || bounds[1] > bounds[3] || !Number.isFinite(zoom)) return [];
    const groups: CameraPresentation[] = [];
    for (const feature of this.index.getClusters(bounds, Math.max(0, Math.floor(zoom)))) {
      const properties = feature.properties;
      const center = position(feature.geometry.coordinates);
      if (!center) continue;
      if ('cluster_id' in properties) {
        const clusterId = properties.cluster_id;
        let memberIds = this.clusterMembers.get(clusterId);
        if (!memberIds) {
          memberIds = this.index.getLeaves(clusterId, Infinity).map(leaf => leaf.properties.id).sort((a, b) => a.localeCompare(b));
          this.clusterMembers.set(clusterId, memberIds);
        }
        groups.push({
          id: `camera-group:${JSON.stringify(memberIds)}`, center, count: memberIds.length,
          memberIds: [...memberIds], nearAlert: properties.nearAlert, clusterId,
        });
      } else {
        const id = properties.id;
        const camera = this.cameras.get(id);
        if (camera) groups.push({ id, center, count: 1, memberIds: [id], nearAlert: nearAlert(camera), camera });
      }
    }
    return groups.sort(compareIds);
  }
}

export interface MapLabelCandidate {
  id: string;
  /** Screen-space center, matching a middle-aligned DeckGL text anchor. */
  x: number;
  y: number;
  width: number;
  height: number;
  selected?: boolean;
  /** Only an existing authoritative source severity may be supplied. */
  sourceSeverity?: string;
  category?: string;
}

export interface PlacedMapLabel extends MapLabelCandidate {
  rect: { left: number; top: number; right: number; bottom: number };
}

export interface MapLabelLayoutOptions {
  padding?: number;
  cellSize?: number;
  maxLabels?: number;
  viewport?: { width: number; height: number };
}

function urgent(candidate: MapLabelCandidate): boolean {
  return ['critical', 'extreme', 'severe', 'high', 'urgent'].includes(candidate.sourceSeverity?.toLowerCase() ?? '');
}

function overlaps(a: PlacedMapLabel['rect'], b: PlacedMapLabel['rect']): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function labelRect(candidate: MapLabelCandidate, padding: number, viewport?: MapLabelLayoutOptions['viewport']): PlacedMapLabel['rect'] | null {
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(value => Number.isFinite(value))
    || candidate.width <= 0 || candidate.height <= 0 || candidate.width > 4096 || candidate.height > 1024) return null;
  const rect = {
    left: candidate.x - candidate.width / 2 - padding,
    right: candidate.x + candidate.width / 2 + padding,
    top: candidate.y - candidate.height / 2 - padding,
    bottom: candidate.y + candidate.height / 2 + padding,
  };
  if (viewport && (rect.right < 0 || rect.bottom < 0 || rect.left > viewport.width || rect.top > viewport.height)) return null;
  return rect;
}

class LabelCollisionGrid {
  private grid = new Map<string, PlacedMapLabel[]>();

  constructor(private cellSize: number) {}

  cells(rect: PlacedMapLabel['rect']): string[] | null {
    const x0 = Math.floor(rect.left / this.cellSize), x1 = Math.floor(rect.right / this.cellSize);
    const y0 = Math.floor(rect.top / this.cellSize), y1 = Math.floor(rect.bottom / this.cellSize);
    // Malformed/extreme boxes must not cause an unbounded grid walk.
    if (![x0, x1, y0, y1].every(value => Number.isSafeInteger(value))) return null;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 512) return null;
    const cells: string[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) cells.push(`${x}:${y}`);
    }
    return cells;
  }

  collides(rect: PlacedMapLabel['rect'], cells: readonly string[]): boolean {
    return cells.some(key => this.grid.get(key)?.some(other => overlaps(rect, other.rect)));
  }

  add(label: PlacedMapLabel, cells: readonly string[]): void {
    for (const key of cells) {
      const labels = this.grid.get(key);
      if (labels) labels.push(label);
      else this.grid.set(key, [label]);
    }
  }
}

/** Deterministic greedy layout with a bounded spatial grid; it only chooses text, never markers. */
export function layoutMapLabels(candidates: readonly MapLabelCandidate[], options: MapLabelLayoutOptions = {}): PlacedMapLabel[] {
  const padding = Number.isFinite(options.padding) ? Math.max(0, Math.min(32, options.padding!)) : 4;
  const cellSize = Number.isFinite(options.cellSize) ? Math.max(32, Math.min(256, options.cellSize!)) : 64;
  const maxLabels = Number.isFinite(options.maxLabels) ? Math.max(0, Math.min(1000, Math.floor(options.maxLabels!))) : 200;
  const grid = new LabelCollisionGrid(cellSize);
  const placed: PlacedMapLabel[] = [];
  const acceptedIds = new Set<string>();
  const sorted = [...candidates].sort((a, b) =>
    Number(Boolean(b.selected)) - Number(Boolean(a.selected)) || Number(urgent(b)) - Number(urgent(a))
    || compareIds(a, b) || a.x - b.x || a.y - b.y || a.width - b.width || a.height - b.height);
  for (const candidate of sorted) {
    if (placed.length >= maxLabels) break;
    if (acceptedIds.has(candidate.id)) continue;
    const rect = labelRect(candidate, padding, options.viewport);
    if (!rect) continue;
    const cells = grid.cells(rect);
    if (!cells || grid.collides(rect, cells)) continue;
    const label = { ...candidate, rect };
    placed.push(label);
    acceptedIds.add(candidate.id);
    grid.add(label, cells);
  }
  return placed;
}
