import {
  UrlTemplateImageryProvider,
  type Viewer,
  type ImageryLayer,
} from 'cesium';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type StreetTileTier = 1 | 2 | 3;

const TIER_NAMES: Record<StreetTileTier, string> = {
  1: 'Mapbox Streets',
  2: 'MapTiler Streets',
  3: 'OpenStreetMap',
};

export class StreetTileManager {
  private viewer: Viewer;
  private layer: ImageryLayer | null = null;
  private _currentTier: StreetTileTier = 3;
  private _visible = false;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  get currentTier(): StreetTileTier {
    return this._currentTier;
  }

  get providerName(): string {
    return TIER_NAMES[this._currentTier];
  }

  get visible(): boolean {
    return this._visible;
  }

  async initialize(): Promise<boolean> {
    // Tier 1: Mapbox Streets
    const mapboxKey = getRuntimeConfigSnapshot().secrets.MAPBOX_API_KEY?.value;
    if (mapboxKey) {
      try {
        const provider = new UrlTemplateImageryProvider({
          url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${mapboxKey}`,
          maximumLevel: 20,
        });
        this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.layer.alpha = 0.7;
        this.layer.show = false;
        this._currentTier = 1;
        return true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[StreetTiles] Mapbox failed, trying MapTiler:', error);
      }
    }

    // Tier 2: MapTiler Streets
    const maptilerKey = getRuntimeConfigSnapshot().secrets.MAPTILER_API_KEY?.value;
    if (maptilerKey) {
      try {
        const provider = new UrlTemplateImageryProvider({
          url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${maptilerKey}`,
          maximumLevel: 20,
        });
        this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.layer.alpha = 0.7;
        this.layer.show = false;
        this._currentTier = 2;
        return true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[StreetTiles] MapTiler failed, trying OSM:', error);
      }
    }

    // Tier 3: OpenStreetMap (free, no key)
    try {
      const provider = new UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 19,
      });
      this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
      this.layer.alpha = 0.7;
      this.layer.show = false;
      this._currentTier = 3;
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[StreetTiles] OSM failed:', error);
    }

    return false;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    if (this.layer) {
      this.layer.show = visible;
    }
  }

  setAlpha(alpha: number): void {
    const clamped = Math.min(1, Math.max(0, alpha));
    if (this.layer) {
      this.layer.alpha = clamped;
    }
  }

  destroy(): void {
    if (this.layer) {
      this.viewer.imageryLayers.remove(this.layer);
      this.layer = null;
    }
    this._visible = false;
  }
}
