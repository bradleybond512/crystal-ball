import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { SiteVariant } from '../../../config/variant.ts';

interface MapStyleApi {
  EMERGENCY_PACK_CAPTURE_ZOOM_LEVELS?: readonly number[];
  getEmergencyPackBaseMapStyleUrl?: (basemap: string, variant: SiteVariant) => string;
  persistedEmergencyPackBaseMap?: (basemap: string) => string | null;
  resolveEmergencyPackInitialBaseMap?: (saved: string | null, theme: 'dark' | 'light') => string;
  resolveEmergencyPackThemeBaseMap?: (active: string, theme: 'dark' | 'light') => string;
}

const api = await import('../emergency-pack-map-style.ts').catch(() => ({} as MapStyleApi)) as MapStyleApi;

function requireFunction<K extends keyof MapStyleApi>(name: K): NonNullable<MapStyleApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<MapStyleApi[K]>;
}

test('Emergency uses one bundled dark_nolabels raster style in every variant', async () => {
  const getStyleUrl = requireFunction('getEmergencyPackBaseMapStyleUrl');
  for (const variant of ['full', 'tech', 'finance', 'happy'] as const) {
    assert.equal(getStyleUrl('emergency', variant), '/map-styles/emergency.json', variant);
  }

  const style = JSON.parse(await readFile(new URL('../../../../public/map-styles/emergency.json', import.meta.url), 'utf8')) as {
    name?: string;
    glyphs?: unknown;
    sprite?: unknown;
    sources?: Record<string, {
      type?: string;
      tiles?: string[];
      attribution?: string;
      minzoom?: number;
      maxzoom?: number;
    }>;
    layers?: Array<{ id?: string; type?: string; source?: string; minzoom?: number; maxzoom?: number }>;
  };
  assert.equal(style.name, 'Emergency (offline)');
  assert.equal(style.glyphs, undefined);
  assert.equal(style.sprite, undefined);
  const captureZooms = api.EMERGENCY_PACK_CAPTURE_ZOOM_LEVELS;
  assert.deepEqual(captureZooms, [0, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(
    Object.keys(style.sources ?? {}),
    captureZooms?.map((zoom) => `carto-emergency-z${zoom}`),
  );
  for (const zoom of captureZooms ?? []) {
    const source = style.sources?.[`carto-emergency-z${zoom}`];
    assert.deepEqual(source?.tiles, [
      'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
    ]);
    assert.equal(source?.minzoom, zoom);
    assert.equal(source?.maxzoom, zoom);
    assert.match(source?.attribution ?? '', /CARTO/);
    assert.match(source?.attribution ?? '', /OpenStreetMap/);
  }

  const rasterLayers = style.layers?.filter(({ type }) => type === 'raster') ?? [];
  assert.equal(rasterLayers.length, 7);
  for (const displayZoom of Array.from({ length: 47 }, (_, index) => index / 2)) {
    const active = rasterLayers.filter((layer) => (
      displayZoom >= (layer.minzoom ?? 0)
      && (layer.maxzoom === undefined || displayZoom < layer.maxzoom)
    ));
    assert.equal(active.length, 1, `display zoom ${displayZoom} selects one captured parent`);
    const expectedParent = [...(captureZooms ?? [])].reverse().find((zoom) => zoom <= displayZoom);
    assert.equal(active[0]?.source, `carto-emergency-z${expectedParent}`);
  }
});

test('Emergency is transient while every normal basemap remains persistable', () => {
  const persistedBaseMap = requireFunction('persistedEmergencyPackBaseMap');
  assert.equal(persistedBaseMap('emergency'), null);
  for (const basemap of ['dark', 'light', 'satellite', 'terrain']) {
    assert.equal(persistedBaseMap(basemap), basemap);
  }
  assert.equal(persistedBaseMap('attacker-controlled'), null);
});

test('restart ignores a stored Emergency value and preserves every valid normal selection', () => {
  const resolveInitial = requireFunction('resolveEmergencyPackInitialBaseMap');
  assert.equal(resolveInitial('emergency', 'dark'), 'dark');
  assert.equal(resolveInitial('emergency', 'light'), 'light');
  assert.equal(resolveInitial('attacker-controlled', 'light'), 'light');
  for (const basemap of ['dark', 'light', 'satellite', 'terrain']) {
    assert.equal(resolveInitial(basemap, 'light'), basemap);
  }
});

test('theme changes leave Emergency and custom maps active but still follow dark and light themes', () => {
  const resolveTheme = requireFunction('resolveEmergencyPackThemeBaseMap');
  assert.equal(resolveTheme('emergency', 'light'), 'emergency');
  assert.equal(resolveTheme('emergency', 'dark'), 'emergency');
  assert.equal(resolveTheme('satellite', 'light'), 'satellite');
  assert.equal(resolveTheme('terrain', 'dark'), 'terrain');
  assert.equal(resolveTheme('dark', 'light'), 'light');
  assert.equal(resolveTheme('light', 'dark'), 'dark');
});

test('normal variant styles retain their established happy and non-happy paths', () => {
  const getStyleUrl = requireFunction('getEmergencyPackBaseMapStyleUrl');
  assert.equal(getStyleUrl('dark', 'full'), '/map-styles/dark.json');
  assert.equal(getStyleUrl('light', 'tech'), '/map-styles/light.json');
  assert.equal(getStyleUrl('satellite', 'finance'), '/map-styles/satellite.json');
  assert.equal(getStyleUrl('terrain', 'full'), '/map-styles/terrain.json');
  assert.equal(getStyleUrl('dark', 'happy'), '/map-styles/happy-dark.json');
  assert.equal(getStyleUrl('light', 'happy'), '/map-styles/happy-light.json');
});
