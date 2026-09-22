import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import { happyWindow } from '../../../tests/panels/setup-dom.mts';

const { DeckGLMap } = await import('../DeckGLMap.ts');

test('default dark and light style shells have only a local ocean background', async () => {
  for (const mode of ['dark', 'light']) {
    const style = JSON.parse(await readFile(new URL(`../../../public/map-styles/${mode}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(style.sources, {}, mode);
    assert.equal(style.glyphs, undefined, mode);
    assert.equal(style.sprite, undefined, mode);
    assert.equal(style.layers.length, 1, mode);
    assert.equal(style.layers[0].type, 'background', mode);
  }
});

function harness() {
  const container = happyWindow.document.createElement('div') as unknown as HTMLElement;
  happyWindow.document.body.append(container);
  const layers = new Map<string, Record<string, unknown>>();
  const sources = new Map<string, unknown>();
  const callbacks: (() => void)[] = [];
  const renders: string[] = [];
  const map = Object.assign(Object.create(DeckGLMap.prototype), {
    container, activeBaseMap: 'dark', countryGeoJsonLoaded: false, countryHoverSetup: true,
    mapStyleGeneration: 0, styleReadyGeneration: -1, mapEventHandlers: [], highlightedCountryCode: null,
    render: () => { renders.push('render'); },
    maplibreMap: {
      isStyleLoaded: () => true,
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, source: unknown) => { assert.equal(sources.has(id), false); sources.set(id, source); },
      getLayer: (id: string) => layers.get(id),
      addLayer: (layer: { id: string }, before?: string) => {
        assert.equal(layers.has(layer.id), false);
        const entries = [...layers.entries()];
        const index = entries.findIndex(([id]) => id === before);
        if (index < 0) entries.push([layer.id, layer]);
        else entries.splice(index, 0, [layer.id, layer]);
        layers.clear();
        entries.forEach(([id, value]) => layers.set(id, value));
      },
      setPaintProperty: () => {},
      getStyle: () => ({ sources: {}, metadata: { basicLandColor: 'gray', basicBorderColor: 'white' }, layers: [...layers.values()] }),
      once: (_event: string, callback: () => void) => { callbacks.push(callback); },
      setStyle: () => { layers.clear(); sources.clear(); },
    },
  });
  map.setupDOM();
  return { map, container, layers, sources, callbacks, renders };
}

test('basic geography status is polite, bounded, factual and preserves focus', () => {
  const { map, container } = harness();
  const button = happyWindow.document.createElement('button');
  container.append(button);
  button.focus();
  map.updateBaselineStatus('loading');
  const status = container.querySelector<HTMLElement>('.map-baseline-status');
  assert.ok(status);
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.dataset.state, 'loading');
  assert.match(status.textContent ?? '', /loading local geography/i);
  map.updateBaselineStatus('basic');
  assert.match(status.textContent ?? '', /country outlines.*no streets or terrain/i);
  map.updateBaselineStatus('unavailable');
  assert.match(status.textContent ?? '', /local geography unavailable.*reload/i);
  assert.ok(happyWindow.document.activeElement === button, 'local geography status must preserve the focused control');
  map.activeBaseMap = 'satellite';
  map.updateBaselineStatus('loading');
  assert.equal(status.hidden, true);
});

test('attribution follows initial and switched selection without claiming CARTO for basic geography', () => {
  const { map, container } = harness();
  for (const mode of ['dark', 'light']) {
    map.updateAttribution(mode);
    const text = container.querySelector('.map-attribution')?.textContent ?? '';
    assert.match(text, /Natural Earth/);
    assert.match(text, /datasets\/geo-countries/);
    assert.doesNotMatch(text, /CARTO|OpenStreetMap/);
  }
  map.updateAttribution('satellite');
  assert.doesNotMatch(container.querySelector('.map-attribution')?.textContent ?? '', /Natural Earth|geo-countries/);
  map.updateAttribution('emergency');
  assert.match(container.querySelector('.map-attribution')?.textContent ?? '', /CARTO/);
});

test('only the current style generation installs visible geography and existing picking layers once', async () => {
  const previousFetch = globalThis.fetch;
  let finish!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => { finish = resolve; });
  globalThis.fetch = async () => response;
  const { map, container, layers, callbacks, renders } = harness();
  try {
    map.loadCountryBoundaries();
    map.switchBasemap('light');
    map.switchBasemap('dark');
    finish(new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { name: 'Test', 'ISO3166-1-Alpha-2': 'US' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }] })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(layers.size, 0, 'an earlier geometry completion must not write into a replacement style before its load event');
    callbacks.forEach((callback) => callback());
    assert.equal(renders.length, 1, 'only the current style callback may request an overlay render');
    await new Promise((resolve) => setTimeout(resolve, 0));
    map.loadCountryBoundaries();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual([...layers.keys()], [
      'country-baseline-land', 'country-baseline-border', 'country-interactive',
      'country-hover-fill', 'country-highlight-fill', 'country-highlight-border',
    ]);
    const fill = layers.get('country-baseline-land') as { paint: Record<string, unknown> };
    assert.equal(fill.paint['fill-opacity'], 1);
    assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'basic');
    assert.match(container.querySelector('.map-attribution')?.textContent ?? '', /Natural Earth/);
    assert.equal(map.activeBaseMap, 'dark');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a pending Basic load settles after 30 seconds and a late valid load recovers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { map, container } = harness();
  map.beginBaselineLoad();
  t.mock.timers.tick(29_999);
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'loading');
  t.mock.timers.tick(1);
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'unavailable');
  map.loadCountryBoundaries();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'basic');
});

test('new selections cancel old loading deadlines and completed states keep their status', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { map, container } = harness();
  map.beginBaselineLoad();
  t.mock.timers.tick(20_000);
  map.switchBasemap('light');
  t.mock.timers.tick(10_000);
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'loading');
  map.updateBaselineStatus('basic');
  t.mock.timers.tick(30_000);
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'basic');
  map.switchBasemap('satellite');
  t.mock.timers.tick(30_000);
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.hidden, true);
});


test('opaque local land stays below existing intelligence overlays', async () => {
  const { map, layers } = harness();
  layers.set('intelligence-overlay', { id: 'intelligence-overlay', type: 'custom' });
  map.loadCountryBoundaries();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const ids = [...layers.keys()];
  assert.ok(ids.indexOf('country-baseline-land') < ids.indexOf('intelligence-overlay'));
  assert.ok(ids.indexOf('country-baseline-border') < ids.indexOf('intelligence-overlay'));
});


test('missing usable local polygons leaves context unavailable instead of reporting a basic map', async () => {
  const { getCountriesGeoJson } = await import('../../services/country-geometry.ts');
  const data = await getCountriesGeoJson();
  assert.ok(data);
  const original = data.features;
  try {
    for (const geometry of [null, { type: 'Polygon' as const, coordinates: [] }, { type: 'Polygon' as const, coordinates: [[]] }]) {
      data.features = [{ type: 'Feature', properties: {}, geometry: geometry! }];
      const { map, container, layers } = harness();
      map.loadCountryBoundaries();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(map.countryGeoJsonLoaded, false);
      assert.equal(layers.size, 0);
      assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'unavailable');
    }
  } finally {
    data.features = original;
  }
});

test('local style and country failures are visible without stealing focus or blaming unrelated overlays', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { map, container } = harness();
  let report!: (event: unknown) => void;
  map.maplibreMap.on = (_event: string, handler: (event: unknown) => void) => { report = handler; };
  map.setupMapErrorHandling();
  const button = happyWindow.document.createElement('button');
  container.append(button);
  button.focus();
  map.updateBaselineStatus('loading');
  report({ error: new Error('unrelated overlay problem') });
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'loading');
  report({ error: new Error('HTTP404 /map-styles/dark.json') });
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'unavailable');
  map.updateBaselineStatus('basic');
  map.styleReadyGeneration = map.mapStyleGeneration;
  report({ error: new Error('late /map-styles/dark.json') });
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'basic');
  report({ error: new Error('<untrusted detail>'), sourceId: 'country-boundaries' });
  assert.equal(container.querySelector<HTMLElement>('.map-baseline-status')?.dataset.state, 'unavailable');
  assert.doesNotMatch(container.querySelector('.map-baseline-status')?.textContent ?? '', /untrusted/);
  assert.ok(happyWindow.document.activeElement === button, 'local geography status must preserve the focused control');
});


test('pending geometry cannot install layers or report ready after the map is detached', async () => {
  const { map, layers, sources } = harness();
  map.loadCountryBoundaries();
  map.maplibreMap = null;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(layers.size, 0);
  assert.equal(sources.size, 0);
  assert.equal(map.countryGeoJsonLoaded, false);
});


test('destroyed maps cannot be repopulated by pending geometry completion', async () => {
  const { map, container, layers, sources } = harness();
  const removals: string[] = [];
  map.layerCache = new Map();
  map.maplibreMap.remove = () => { removals.push('map'); };
  map.maplibreMap.off = () => {};
  map.beginBaselineLoad();
  map.loadCountryBoundaries();
  map.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(removals, ['map']);
  assert.equal(container.children.length, 0);
  assert.equal(layers.size, 0);
  assert.equal(sources.size, 0);
  assert.equal(map.countryGeoJsonLoaded, false);
});
