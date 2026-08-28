import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { SiteVariant } from '../../../config/variant.ts';

interface MapStyleApi {
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
    sources?: Record<string, { type?: string; tiles?: string[]; attribution?: string }>;
    layers?: Array<{ id?: string; type?: string; source?: string }>;
  };
  assert.equal(style.name, 'Emergency (offline)');
  assert.equal(style.glyphs, undefined);
  assert.equal(style.sprite, undefined);
  assert.deepEqual(Object.keys(style.sources ?? {}), ['carto-emergency-base']);
  assert.deepEqual(style.sources?.['carto-emergency-base']?.tiles, [
    'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
    'https://b.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
    'https://c.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png',
  ]);
  assert.match(style.sources?.['carto-emergency-base']?.attribution ?? '', /CARTO/);
  assert.match(style.sources?.['carto-emergency-base']?.attribution ?? '', /OpenStreetMap/);
  assert.deepEqual(style.layers, [
    { id: 'background', type: 'background', paint: { 'background-color': '#0b0e12' } },
    { id: 'carto-emergency-base-tiles', type: 'raster', source: 'carto-emergency-base' },
  ]);
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
