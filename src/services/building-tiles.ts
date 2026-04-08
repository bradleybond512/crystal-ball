/**
 * 3D Building Tiles — 5-tier redundant fallback chain
 *
 * Tier 1: Google Photorealistic 3D Tiles (requires GOOGLE_MAPS_API_KEY)
 * Tier 2: Cesium OSM Buildings, Ion asset 96188 (requires CESIUM_ION_TOKEN)
 * Tier 3: Esri I3S global building scene layer (free, no key)
 * Tier 4: No 3D buildings on globe
 * Tier 5: Flat rendering (current state)
 */

import {
  Cesium3DTileset,
  Cesium3DTileStyle,
  type Viewer,
} from 'cesium';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type BuildingTier = 1 | 2 | 3 | 4 | 5;

export interface BuildingTileState {
  currentTier: BuildingTier;
  providerName: string;
  tileset: Cesium3DTileset | null;
}

/**
 * Height-based gradient for Cesium OSM Buildings.
 * Taller buildings get a brighter steel-blue to evoke a lit night skyline.
 * Opacity is intentionally <1 so satellite base imagery shows through slightly.
 */
function osmBuildingStyle(): Cesium3DTileStyle {
  return new Cesium3DTileStyle({
 color: {
 conditions: [
 ['defined(${height}) && ${height} >= 150', "color('rgba(120,160,220,0.92)')"],
 ['defined(${height}) && ${height} >= 80',  "color('rgba(90,130,195,0.88)')"],
 ['defined(${height}) && ${height} >= 40',  "color('rgba(65,100,165,0.84)')"],
 ['defined(${height}) && ${height} >= 15',  "color('rgba(50,78,138,0.80)')"],
 ['true', "color('rgba(38,58,108,0.76)')"],
 ],
 },
  });
}

const TIER_NAMES: Record<BuildingTier, string> = {
  1: 'Google Photorealistic 3D Tiles',
  2: 'Cesium OSM Buildings',
  3: 'Esri I3S Buildings',
  4: 'No 3D Buildings',
  5: 'Flat Rendering',
};

export class BuildingTileManager {
  private viewer: Viewer;
  private tileset: Cesium3DTileset | null = null;
  private _currentTier: BuildingTier = 5;

  constructor(viewer: Viewer) {
 this.viewer = viewer;
  }

  get currentTier(): BuildingTier {
 return this._currentTier;
  }

  get providerName(): string {
 return TIER_NAMES[this._currentTier];
  }

  /** Returns true if any building tier loaded, false if no API keys are configured. */
  async initialize(): Promise<boolean> {
 // Tier 1: Google Photorealistic 3D Tiles
 const googleKey = getRuntimeConfigSnapshot().secrets.GOOGLE_MAPS_API_KEY?.value;
 if (googleKey) {
 try {
 this.tileset = await Cesium3DTileset.fromUrl(
 `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleKey}`
 );
 this.viewer.scene.primitives.add(this.tileset);
 this._currentTier = 1;
 return true;
 } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[BuildingTiles] Google 3D Tiles failed, trying Cesium OSM:', error);
 }
 }

 // Tier 2: Cesium OSM Buildings (Ion asset 96188)
 const ionToken = getRuntimeConfigSnapshot().secrets.CESIUM_ION_TOKEN?.value;
 if (ionToken) {
 try {
 this.tileset = await Cesium3DTileset.fromIonAssetId(96_188);
 this.tileset.style = osmBuildingStyle();
 this.viewer.scene.primitives.add(this.tileset);
 this._currentTier = 2;
 return true;
 } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[BuildingTiles] Cesium OSM Buildings failed:', error);
 }
 }

 // No keys configured — caller should revert toggle state
 this._currentTier = 4;
 return false;
  }

  /** Force a specific tier, loading it fresh if not already active.
 *  Returns true if the tier loaded successfully. */
  async forceTier(tier: 1 | 2 | 3): Promise<boolean> {
 if (this._currentTier === tier && this.tileset) return true;

 // Remove existing tileset
 if (this.tileset) {
 this.viewer.scene.primitives.remove(this.tileset);
 this.tileset = null;
 }

 if (tier === 1) {
 const googleKey = getRuntimeConfigSnapshot().secrets.GOOGLE_MAPS_API_KEY?.value;
 if (!googleKey) return false;
 try {
 this.tileset = await Cesium3DTileset.fromUrl(
 `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleKey}`
 );
 this.viewer.scene.primitives.add(this.tileset);
 this._currentTier = 1;
 return true;
 } catch {
 return false;
 }
 }

 if (tier === 2) {
 try {
 this.tileset = await Cesium3DTileset.fromIonAssetId(96_188);
 this.tileset.style = osmBuildingStyle();
 this.viewer.scene.primitives.add(this.tileset);
 this._currentTier = 2;
 return true;
 } catch {
 return false;
 }
 }

 return false;
  }

  destroy(): void {
 if (this.tileset) {
 this.viewer.scene.primitives.remove(this.tileset);
 this.tileset = null;
 }
 this._currentTier = 5;
  }
}
