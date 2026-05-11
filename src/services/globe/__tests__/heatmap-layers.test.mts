import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAllHeatmapLayers,
  buildHeatmapLayerConfig,
  listPalettes,
  paletteFor,
  type HeatmapPoint,
} from '../heatmap-layers.ts';

const POINTS: HeatmapPoint[] = [
  { lat: 40, lon: -75, weight: 2 },
  { lat: 41, lon: -74, weight: 1 },
];

// ── Palettes ──────────────────────────────────────────────────────────

test('paletteFor: returns the requested domain palette', () => {
  const pal = paletteFor('seismic');
  assert.equal(pal.domain, 'seismic');
  assert.match(pal.label, /Seismic/);
  assert.equal(pal.colorRange.length, 6, 'palettes must have 6 stops for smooth gradient');
});

test('listPalettes: 4 domains in fixed order', () => {
  const list = listPalettes();
  assert.deepEqual(list.map((p) => p.domain), ['seismic', 'fire', 'cyber', 'conflict']);
});

test('palettes: each has unique radius (domain-tuned)', () => {
  const radii = new Set(listPalettes().map((p) => p.radius));
  assert.equal(radii.size, listPalettes().length);
});

test('palettes: every color stop is a valid 0-255 RGB triple', () => {
  for (const pal of listPalettes()) {
    for (const [r, g, b] of pal.colorRange) {
      for (const c of [r, g, b]) {
        assert.ok(c >= 0 && c <= 255 && Number.isInteger(c), `bad channel ${c} in ${pal.domain}`);
      }
    }
  }
});

// ── buildHeatmapLayerConfig ──────────────────────────────────────────

test('build: id defaults to heatmap-{domain}', () => {
  const cfg = buildHeatmapLayerConfig('fire', POINTS);
  assert.equal(cfg.id, 'heatmap-fire');
});

test('build: id override applied', () => {
  const cfg = buildHeatmapLayerConfig('fire', POINTS, { id: 'fire-2' });
  assert.equal(cfg.id, 'fire-2');
});

test('build: default opacity 0.6 per spec', () => {
  const cfg = buildHeatmapLayerConfig('cyber', POINTS);
  assert.equal(cfg.opacity, 0.6);
});

test('build: opacity clamped to [0, 1]', () => {
  const high = buildHeatmapLayerConfig('cyber', POINTS, { opacity: 5 });
  const low = buildHeatmapLayerConfig('cyber', POINTS, { opacity: -1 });
  const nan = buildHeatmapLayerConfig('cyber', POINTS, { opacity: Number.NaN });
  assert.equal(high.opacity, 1);
  assert.equal(low.opacity, 0);
  assert.equal(nan.opacity, 0);
});

test('build: getPosition returns [lon, lat]', () => {
  const cfg = buildHeatmapLayerConfig('seismic', POINTS);
  const pos = cfg.getPosition(POINTS[0]!);
  assert.deepEqual(pos, [-75, 40]);
});

test('build: getWeight reads from point.weight, defaults to 1', () => {
  const cfg = buildHeatmapLayerConfig('seismic', POINTS);
  assert.equal(cfg.getWeight({ lat: 0, lon: 0, weight: 7 }), 7);
  assert.equal(cfg.getWeight({ lat: 0, lon: 0 }), 1);
});

test('build: visible defaults to true', () => {
  const cfg = buildHeatmapLayerConfig('seismic', POINTS);
  assert.equal(cfg.visible, true);
});

test('build: visible override applied', () => {
  const cfg = buildHeatmapLayerConfig('seismic', POINTS, { visible: false });
  assert.equal(cfg.visible, false);
});

// ── buildAllHeatmapLayers ────────────────────────────────────────────

test('buildAll: exactly one layer is visible when a domain is selected', () => {
  const layers = buildAllHeatmapLayers({
    selected: 'fire',
    points: { fire: POINTS, seismic: POINTS },
  });
  const visible = layers.filter((l) => l.visible);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, 'heatmap-fire');
});

test('buildAll: all layers hidden when selected=null', () => {
  const layers = buildAllHeatmapLayers({ selected: null, points: { fire: POINTS } });
  for (const l of layers) assert.equal(l.visible, false);
});

test('buildAll: missing domain data → empty data array (not crash)', () => {
  const layers = buildAllHeatmapLayers({ selected: 'cyber', points: { cyber: POINTS } });
  const seismic = layers.find((l) => l.id === 'heatmap-seismic');
  assert.deepEqual(seismic?.data, []);
});

test('buildAll: opacity propagates to every layer', () => {
  const layers = buildAllHeatmapLayers({
    selected: 'seismic',
    points: { seismic: POINTS },
    opacity: 0.3,
  });
  for (const l of layers) assert.equal(l.opacity, 0.3);
});

// ── JSON serializability of the static parts ─────────────────────────

test('config data + colorRange + radius are JSON-serializable (accessors aside)', () => {
  const cfg = buildHeatmapLayerConfig('seismic', POINTS);
  const stripped = {
    id: cfg.id,
    data: cfg.data,
    radius: cfg.radius,
    colorRange: cfg.colorRange,
    aggregation: cfg.aggregation,
    opacity: cfg.opacity,
    visible: cfg.visible,
  };
  const round = JSON.parse(JSON.stringify(stripped));
  assert.equal(round.id, 'heatmap-seismic');
  assert.equal(round.colorRange.length, 6);
});
