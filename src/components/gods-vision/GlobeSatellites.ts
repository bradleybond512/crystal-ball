import {
  Cartesian3, Color, CustomDataSource, Entity,
  PointGraphics, ConstantProperty, ConstantPositionProperty, LabelGraphics,
  Cartesian2, type Viewer,
} from 'cesium';
import * as satellite from 'satellite.js';
import { getApiBaseUrl } from '@/services/runtime';
import { isAppActive, onActivityChange } from '@/services/app-activity';

/**
 * TLE entry with satrec pre-parsed once at load time.
 * Never call twoline2satrec() inside the propagation loop.
 */
interface TleEntry {
  name: string;
  line1: string;
  line2: string;
  satrec: ReturnType<typeof satellite.twoline2satrec>;
}

function parseTles(text: string): TleEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result: TleEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i] ?? '';
    const line1 = lines[i + 1] ?? '';
    const line2 = lines[i + 2] ?? '';
    try {
      // Parse satrec once — never again per animation frame.
      const satrec = satellite.twoline2satrec(line1, line2);
      result.push({ name, line1, line2, satrec });
    } catch { /* skip malformed TLE */ }
  }
  return result;
}

/**
 * How often to recompute satellite positions.  Satellites orbit at
 * ~7.8 km/s but at globe zoom level a 2 s position delta (~15 km) is
 * imperceptible.  Throttling from 60 fps to 0.5 Hz drops Cesium object
 * allocations from ~1 800/s to ~15/s and eliminates the GC pauses caused
 * by the unconditional rAF loop.
 */
const PROPAGATE_INTERVAL_MS = 2000;

export class GlobeSatellites {
  private source: CustomDataSource;
  private tles: TleEntry[] = [];
  private rafId: number | null = null;
  private enabled = false;
  private destroyed = false;
  private unsubActivity: (() => void) | null = null;
  /** DOMHighResTimeStamp of the last propagation run. */
  private lastPropagateTime = 0;
  /** Per-satellite scratch Cartesian3 to avoid heap allocation per update. */
  private readonly scratchMap = new Map<string, Cartesian3>();

  constructor(private viewer: Viewer) {
    this.source = new CustomDataSource('satellites');
  }

  async mount(): Promise<void> {
    await this.viewer.dataSources.add(this.source);
    await this.fetchTles();
    this.unsubActivity = onActivityChange((active) => {
      if (active && this.enabled && !this.destroyed) this.propagateLoop();
    });
  }

  destroy(): void {
    this.unsubActivity?.();
    this.unsubActivity = null;
    this.destroyed = true;
    if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.viewer.dataSources.remove(this.source, true);
    this.scratchMap.clear();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.source.show = on;
    if (on) {
      this.propagateLoop();
    } else {
      if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    }
  }

  private async fetchTles(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/tle`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return;
      const text = await res.text();
      this.tles = parseTles(text);
      this.rebuildEntities();
    } catch { /* silent */ }
  }

  private rebuildEntities(): void {
    this.source.entities.removeAll();
    this.scratchMap.clear();
    for (const tle of this.tles) {
      this.scratchMap.set(tle.name, new Cartesian3());
      this.source.entities.add(new Entity({
        id: tle.name,
        point: new PointGraphics({
          pixelSize: new ConstantProperty(4),
          color: new ConstantProperty(Color.fromCssColorString('#a78bfa')),
          outlineColor: new ConstantProperty(Color.BLACK),
          outlineWidth: new ConstantProperty(1),
        }),
        label: new LabelGraphics({
          text: new ConstantProperty(tle.name.trim()),
          font: new ConstantProperty('10px monospace'),
          fillColor: new ConstantProperty(Color.fromCssColorString('#a78bfa')),
          pixelOffset: new ConstantProperty(new Cartesian2(8, 0)),
          show: new ConstantProperty(true),
        }),
      }));
    }
  }

  private propagateLoop(now = 0): void {
    if (!this.enabled || this.destroyed || !isAppActive()) return;
    this.rafId = requestAnimationFrame((ts) => {
      if (this.destroyed) return;
      if (ts - this.lastPropagateTime >= PROPAGATE_INTERVAL_MS) {
        this.propagate();
        this.lastPropagateTime = ts;
      }
      this.propagateLoop(ts);
    });
  }

  private propagate(): void {
    const now = new Date();
    // gstime computed once per propagation run — shared across all satellites.
    const gmst = satellite.gstime(now);
    for (const tle of this.tles) {
      try {
        // satrec is pre-parsed in parseTles() — no per-run twoline2satrec() call.
        const posVel = satellite.propagate(tle.satrec, now);
        if (!posVel?.position) continue;
        const geo = satellite.eciToGeodetic(posVel.position as satellite.EciVec3<number>, gmst);
        const lat = satellite.degreesLat(geo.latitude);
        const lon = satellite.degreesLong(geo.longitude);
        const alt = geo.height * 1000;
        const entity = this.source.entities.getById(tle.name);
        if (entity) {
          // Reuse the per-satellite scratch Cartesian3; ConstantPositionProperty
          // clones internally so it is safe to mutate scratch after the call.
          const scratch = this.scratchMap.get(tle.name);
          entity.position = new ConstantPositionProperty(
            Cartesian3.fromDegrees(lon, lat, alt, scratch),
          );
        }
      } catch { /* skip bad TLE on this run */ }
    }
  }
}
