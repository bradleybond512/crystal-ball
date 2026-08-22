import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelSource = await readFile(new URL('../src/components/WaterQualityPanel.ts', import.meta.url), 'utf8');

test('WaterQualityPanel loads the active saved place and refreshes on place changes', () => {
  assert.match(panelSource, /fetchWaterQuality, selectWaterQualityLocation/);
  assert.match(panelSource, /subscribeSavedPlaces\(\(places\) =>/);
  assert.match(panelSource, /refreshForPlaces\(getSavedPlaces\(\)\)/);
  assert.match(panelSource, /await fetchWaterQuality\(location\)/);
});

test('WaterQualityPanel prevents stale refreshes and unsubscribes on destroy', () => {
  assert.match(panelSource, /sequence === this\.refreshSequence/);
  assert.match(panelSource, /this\.unsubscribePlaces\?\.\(\)/);
  assert.match(panelSource, /this\.refreshSequence \+= 1/);
});

test('a place switch removes prior-location water evidence before the deferred fetch', () => {
  assert.match(
    panelSource,
    /private async refreshForPlaces[\s\S]{0,500}this\.data = null;[\s\S]{0,120}this\.setCount\(0\);[\s\S]{0,260}this\.showLoading\([\s\S]{0,300}await fetchWaterQuality\(location\)/,
  );
});
