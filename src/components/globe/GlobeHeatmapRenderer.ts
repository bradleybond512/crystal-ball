/**
 * GlobeHeatmapRenderer
 * --------------------
 * Cesium-native renderer for the per-domain heatmap toggle.
 *
 * Listens for the `wm:globe-heatmap-changed` CustomEvent dispatched by
 * GlobeHeatmapToggle, fetches the relevant sidecar data for the active
 * domain, bins it into a 1°×1° grid via `heatmap-grid.ts`, and draws
 * each non-empty cell as a translucent rectangle entity in a dedicated
 * CustomDataSource.
 *
 * Why CustomDataSource of rectangle entities (not GroundPrimitive)?
 *   GroundPrimitive draws on the terrain depth buffer but is harder
 *   to update incrementally and harder to test. Entity rectangles use
 *   the same render path as the rest of GlobeDataManager's overlays
 *   (see loadInfrastructureOverlay) and clear cleanly via
 *   `entities.removeAll()`. This matches the spec's "GroundPrimitive
 *   colored rectangles" intent (terrain-clamped, color-mapped) at the
 *   layer the rest of the codebase already uses.
 *
 * Pure-logic layer (binning + colors + domain mapping) lives in
 * `heatmap-grid.ts` and is unit-tested in isolation; this file is the
 * Cesium glue + fetch orchestration.
 *
 * Plan invariants:
 *   - Self-managed via the event bus — instantiate once, no manual
 *     `setDomain()` calls needed.
 *   - Clearing: every domain change clears the previous data source
 *     before fetching new data, so toggling A → B → null leaves no
 *     stale cells on screen.
 *   - Race-safe: an in-flight fetch for an old domain can't overwrite
 *     a newer one — the renderer pins the requested domain on each
 *     fetch and bails when it changes mid-flight.
 *   - Fetch failure paints nothing for the active domain (no half-state).
 */

import {
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  CustomDataSource,
  Rectangle,
  type Viewer,
} from 'cesium';
import { getApiBaseUrl } from '@/services/runtime';
import {
  buildColoredCells,
  type ColoredHeatmapCell,
  type HeatmapDomain,
  type HeatmapPoint,
  type RgbaColor,
} from './heatmap-grid';

const DATA_SOURCE_NAME = 'globe-heatmap';
const CHANGED_EVENT = 'wm:globe-heatmap-changed';

/**
 * The toggle UI uses a wider/older domain set (`fire`, `cyber`,
 * `conflict`) inherited from the deck.gl config builder; this renderer
 * uses the spec-defined set (`seismic` / `wildfire` / `weather` /
 * `infrastructure`). Map between them so existing toggle dispatches
 * land cleanly without coordinating a second UI change.
 *
 * Anything not in this map → `null` (no render, clear). When the
 * toggle is later extended to dispatch `weather` + `infrastructure`
 * directly, those pass through unchanged.
 */
export function mapToggleDomain(raw: string | null | undefined): HeatmapDomain | null {
  if (!raw) return null;
  switch (raw) {
    case 'seismic':         { return 'seismic'; }
    case 'fire':
    case 'wildfire':        { return 'wildfire'; }
    case 'weather':         { return 'weather'; }
    case 'infrastructure':  { return 'infrastructure'; }
    default:                { return null; }
  }
}

/** Adapter shape the renderer accepts from each sidecar endpoint.
 *  Each domain has its own raw shape; the per-domain extractor
 *  normalises to `HeatmapPoint[]`. */
type SidecarFetcher = (baseUrl: string, signal: AbortSignal) => Promise<HeatmapPoint[]>;

/** Per-domain endpoint + extractor. Keeping these as plain functions
 *  (instead of a constant config object) lets tests pass mock
 *  fetchers via the constructor's `fetchers` override. */
const DEFAULT_FETCHERS: Record<HeatmapDomain, SidecarFetcher> = {
  seismic: async (baseUrl, signal) => {
    const res = await fetch(`${baseUrl}/api/earthquakes`, { signal });
    if (!res.ok) return [];
    const body = await res.json() as { earthquakes?: { magnitude?: unknown; location?: { latitude?: unknown; longitude?: unknown } }[] };
    if (!body || typeof body !== 'object') return [];
    const out: HeatmapPoint[] = [];
    for (const q of body.earthquakes ?? []) {
      const lat = Number(q?.location?.latitude);
      const lon = Number(q?.location?.longitude);
      const mag = Number(q?.magnitude);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(mag)) {
        out.push({ lat, lon, intensity: mag });
      }
    }
    return out;
  },
  wildfire: async (baseUrl, signal) => {
    const res = await fetch(`${baseUrl}/api/nasa-firms`, { signal });
    if (!res.ok) return [];
    const body = await res.json() as { fires?: { latitude?: unknown; longitude?: unknown; frp?: unknown }[]; hotspots?: { latitude?: unknown; longitude?: unknown; frp?: unknown }[] };
    if (!body || typeof body !== 'object') return [];
    const rows = body.fires ?? body.hotspots ?? [];
    const out: HeatmapPoint[] = [];
    for (const r of rows) {
      const lat = Number(r?.latitude);
      const lon = Number(r?.longitude);
      const frp = Number(r?.frp);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        out.push({ lat, lon, intensity: Number.isFinite(frp) ? frp : 1 });
      }
    }
    return out;
  },
  weather: async (baseUrl, signal) => {
    const res = await fetch(`${baseUrl}/api/nws-alerts`, { signal });
    if (!res.ok) return [];
    const body = await res.json() as { alerts?: { lat?: unknown; lon?: unknown; latitude?: unknown; longitude?: unknown }[] };
    if (!body || typeof body !== 'object') return [];
    const out: HeatmapPoint[] = [];
    for (const a of body.alerts ?? []) {
      const lat = Number(a?.lat ?? a?.latitude);
      const lon = Number(a?.lon ?? a?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        out.push({ lat, lon, intensity: 1 });
      }
    }
    return out;
  },
  // ODIN is exact-county report context and does not publish point geometry.
  // Plotting a saved-place coordinate or state centroid would imply facility
  // or statewide coverage, so this layer stays empty until county geometry is
  // carried through a dedicated, coverage-labelled overlay contract. An empty
  // layer means outage geometry is unknown; it never means power is on.
  infrastructure: async () => [],
};

export interface GlobeHeatmapRendererOptions {
  /** Override fetchers for tests. */
  fetchers?: Partial<Record<HeatmapDomain, SidecarFetcher>>;
  /** Override the base URL resolver (defaults to `getApiBaseUrl()`). */
  baseUrl?: () => string;
}

export class GlobeHeatmapRenderer {
  private viewer: Viewer;
  private dataSource: CustomDataSource;
  private fetchers: Record<HeatmapDomain, SidecarFetcher>;
  private baseUrlFn: () => string;
  private activeDomain: HeatmapDomain | null = null;
  private activeAbort: AbortController | null = null;
  private boundHandler: ((event: Event) => void) | null = null;

  constructor(viewer: Viewer, options: GlobeHeatmapRendererOptions = {}) {
    this.viewer = viewer;
    this.fetchers = { ...DEFAULT_FETCHERS, ...options.fetchers };
    this.baseUrlFn = options.baseUrl ?? getApiBaseUrl;
    this.dataSource = new CustomDataSource(DATA_SOURCE_NAME);
  }

  /** Subscribe to the event bus and attach the data source. Call once
   *  after construction. */
  mount(): void {
    if (this.boundHandler) return;
    void this.viewer.dataSources.add(this.dataSource);
    this.boundHandler = (event) => this.handleChanged(event);
    document.addEventListener(CHANGED_EVENT, this.boundHandler);
  }

  destroy(): void {
    if (this.boundHandler) {
      document.removeEventListener(CHANGED_EVENT, this.boundHandler);
      this.boundHandler = null;
    }
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.dataSource.entities.removeAll();
    this.viewer.dataSources.remove(this.dataSource, true);
  }

  /** Programmatic entry point — same path as the event handler. Used
   *  by tests + as a fallback when the event bus isn't available. */
  async setDomain(domain: HeatmapDomain | null): Promise<void> {
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.activeDomain = domain;
    this.clear();
    if (domain === null) return;
    await this.fetchAndRender(domain);
  }

  /** Public for tests. Clears the data source. */
  clear(): void {
    this.dataSource.entities.removeAll();
  }

  /** Public for tests. Returns the count of currently-rendered cells. */
  cellCount(): number {
    return this.dataSource.entities.values.length;
  }

  /** Public for tests. Returns the active domain, or null. */
  getActiveDomain(): HeatmapDomain | null {
    return this.activeDomain;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private handleChanged(event: Event): void {
    const detail = (event as CustomEvent<{ state?: { selected?: string | null } }>).detail;
    const raw = detail?.state?.selected ?? null;
    const mapped = mapToggleDomain(raw);
    void this.setDomain(mapped);
  }

  private async fetchAndRender(domain: HeatmapDomain): Promise<void> {
    const controller = new AbortController();
    this.activeAbort = controller;
    const fetcher = this.fetchers[domain];
    let points: readonly HeatmapPoint[] = [];
    try {
      points = await fetcher(this.baseUrlFn(), controller.signal);
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return;
      // eslint-disable-next-line no-console -- diagnostic only; renderer falls through to no-op
      console.warn(`[GlobeHeatmapRenderer] fetch failed for ${domain}:`, error);
      return;
    }
    // Race guard — if a newer domain change came in while we were
    // awaiting, drop this result on the floor.
    if (this.activeDomain !== domain) return;
    this.renderCells(buildColoredCells(domain, points));
  }

  private renderCells(cells: readonly ColoredHeatmapCell[]): void {
    this.dataSource.entities.removeAll();
    for (const cell of cells) {
      this.dataSource.entities.add({
        rectangle: {
          coordinates: Rectangle.fromDegrees(cell.west, cell.south, cell.east, cell.north),
          material: new ColorMaterialProperty(rgbaToCesium(cell.color)),
          height: new ConstantProperty(0),
          outline: false,
        },
      });
    }
  }
}

function rgbaToCesium(rgba: RgbaColor): Color {
  return Color.fromBytes(rgba.r, rgba.g, rgba.b, Math.round(rgba.a * 255));
}

export const GLOBE_HEATMAP_CHANGED_EVENT = CHANGED_EVENT;
