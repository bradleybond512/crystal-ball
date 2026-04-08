import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('gods-vision-layers', () => {
  it('exports default layer state with aesthetic layers disabled', async () => {
 const { DEFAULT_GODS_VISION_LAYERS } = await import(
 '../src/config/gods-vision-layers.ts'
 );
 // Aesthetic layers must default to disabled; data/intelligence layers may be enabled
 const aestheticLayers = Object.values(DEFAULT_GODS_VISION_LAYERS).filter(
 (layer) => layer.category === 'aesthetic',
 );
 const allAestheticDisabled = aestheticLayers.every((layer) => !layer.enabled);
 assert.equal(allAestheticDisabled, true, 'Aesthetic layers should default to disabled');
 assert.ok(aestheticLayers.length >= 3, 'Should have at least 3 aesthetic layers');
  });

  it('every layer has required metadata fields', async () => {
 const { DEFAULT_GODS_VISION_LAYERS } = await import(
 '../src/config/gods-vision-layers.ts'
 );
 for (const [key, layer] of Object.entries(DEFAULT_GODS_VISION_LAYERS)) {
 assert.ok(layer.name, `${key} missing name`);
 assert.ok(layer.category, `${key} missing category`);
 assert.equal(typeof layer.enabled, 'boolean', `${key} enabled not boolean`);
 }
  });

  it('has layers for all planned features', async () => {
 const { DEFAULT_GODS_VISION_LAYERS } = await import(
 '../src/config/gods-vision-layers.ts'
 );
 const keys = Object.keys(DEFAULT_GODS_VISION_LAYERS);
 const required = [
 'satellites', 'terrain', 'buildings',
 'entityGraph', 'rfCoverage', 'timeline',
 'earthquakes', 'gdacs', 'conflicts', 'autoFollow',
 'atmosphere', 'scanlines', 'bloom',
 ];
 for (const r of required) {
 assert.ok(keys.includes(r), `Missing required layer: ${r}`);
 }
  });
});
