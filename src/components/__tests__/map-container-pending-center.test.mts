import assert from 'node:assert/strict';
import test from 'node:test';

import '../../../tests/panels/register-hook.mjs';
import { happyWindow } from '../../../tests/panels/setup-dom.mts';
import type { MapContainerState } from '../MapContainer.ts';

const { MapContainer } = await import('../MapContainer.ts');

interface PendingCenterHarness {
  useDeckGL: boolean;
  deckGLMap: MapDelegate | null;
  svgMap: MapDelegate | null;
  initialState: MapContainerState;
  pendingCenter: { lat: number; lon: number; zoom?: number } | null;
  setCenter(lat: number, lon: number, zoom?: number): void;
  getCenter(): { lat: number; lon: number } | null;
  getState(): MapContainerState;
  replayPendingCenter(): void;
}

interface MapDelegate {
  setCenter(lat: number, lon: number, zoom?: number): void;
  setZoom(zoom: number): void;
  getCenter(): { lat: number; lon: number } | null;
  getState(): MapContainerState;
}

const INITIAL_STATE: MapContainerState = {
  zoom: 1.5,
  pan: { x: 0, y: 0 },
  view: 'global',
  layers: {} as MapContainerState['layers'],
  timeRange: '7d',
};

function createHarness(useDeckGL: boolean): PendingCenterHarness {
  const map = Object.create(MapContainer.prototype) as PendingCenterHarness;
  map.useDeckGL = useDeckGL;
  map.deckGLMap = null;
  map.svgMap = null;
  map.initialState = INITIAL_STATE;
  map.pendingCenter = null;
  return map;
}

function createDelegate(events: string[], center: { lat: number; lon: number }): MapDelegate {
  return {
    setCenter(lat, lon, zoom) {
      events.push(`center:${lat}:${lon}:${zoom ?? 'none'}`);
      center.lat = lat;
      center.lon = lon;
    },
    setZoom(zoom) {
      events.push(`zoom:${zoom}`);
    },
    getCenter: () => ({ ...center }),
    getState: () => ({ ...INITIAL_STATE, zoom: 9 }),
  };
}

test('DeckGL startup retains a zero-coordinate camera until the delegate is ready', () => {
  const map = createHarness(true);
  const events: string[] = [];

  map.setCenter(0, 0, 4);

  assert.deepEqual(map.getCenter(), { lat: 0, lon: 0 });
  assert.equal(map.getState().zoom, 4);

  map.deckGLMap = createDelegate(events, { lat: 12, lon: 34 });
  map.replayPendingCenter();
  map.replayPendingCenter();

  assert.deepEqual(events, ['center:0:0:4']);
  assert.deepEqual(map.getCenter(), { lat: 0, lon: 0 });
  assert.equal(map.pendingCenter, null);
});

test('SVG fallback replays an early camera with the established center-then-zoom order', () => {
  const map = createHarness(false);
  const events: string[] = [];

  map.setCenter(-33.9, 151.2, 6);
  map.svgMap = createDelegate(events, { lat: 1, lon: 2 });
  map.replayPendingCenter();

  assert.deepEqual(events, ['center:-33.9:151.2:none', 'zoom:6']);
  assert.equal(map.pendingCenter, null);
});

test('invalid early coordinates cannot replace the last valid pending camera', () => {
  const map = createHarness(true);

  map.setCenter(10, 20, 3);
  map.setCenter(91, 20, 8);
  map.setCenter(10, -181, 8);
  map.setCenter(Number.NaN, 20, 8);
  map.setCenter(10, Number.POSITIVE_INFINITY, 8);

  assert.deepEqual(map.getCenter(), { lat: 10, lon: 20 });
  assert.equal(map.getState().zoom, 3);
});

test('pending camera state does not mutate the initial state object', () => {
  const map = createHarness(true);

  map.setCenter(45, -75, 5);

  assert.equal(INITIAL_STATE.zoom, 1.5);
  assert.notEqual(map.getState(), INITIAL_STATE);
});

test.after(() => {
  happyWindow.close();
});
