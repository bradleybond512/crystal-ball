import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

function componentMethod(file, className, methodName, globals) {
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((entry) => ts.isClassDeclaration(entry) && entry.name.text === className);
  const method = declaration.members.find((entry) => entry.name?.getText(parsed) === methodName);
  assert.ok(method, `${className}.${methodName} exists`);
  const text = `class Subject { ${method.getText(parsed)} }; Subject.prototype.${methodName};`;
  return vm.runInNewContext(ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, globals);
}

function mapFixture() {
  const events = [];
  const listeners = new Map();
  let workerReady = false;
  class MapStub {
    constructor(options) {
      assert.ok(workerReady, 'worker URL must be configured before a map starts');
      this.options = options;
      events.push('map');
    }
    getCanvas() { return { addEventListener: (name, handler) => listeners.set(name, handler) }; }
    addControl() {}
    setCenter(center) { this.center = center; }
    triggerRepaint() { events.push('repaint'); }
  }
  return {
    events, listeners,
    globals: {
      maplibregl: { Map: MapStub, NavigationControl: class {}, ScaleControl: class {}, addProtocol() {} },
      configureMapLibreWorker() { workerReady = true; events.push('worker'); },
      console: { warn() {}, info() {} },
    },
  };
}

test('worker initialization uses the emitted module worker URL through the supported API', () => {
  const path = new URL('src/components/maplibre-worker.ts', root);
  assert.ok(existsSync(path), 'shared worker initializer is required');
  const calls = [];
  const module = { exports: {} };
  const workerUrl = '/assets/maplibre-gl-worker-test.mjs';
  const require = (id) => {
    if (id === 'maplibre-gl') return { setWorkerUrl: (url) => calls.push(url) };
    assert.equal(id, 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url');
    return { __esModule: true, default: workerUrl };
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require });
  module.exports.configureMapLibreWorker();
  assert.deepEqual(calls, [workerUrl]);
  assert.ok(existsSync(fileURLToPath(new URL('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', root))));
});

test('main map initializes its worker before construction and preserves context recovery', () => {
  const fixture = mapFixture();
  const transformRequest = () => {};
  const method = componentMethod('src/components/DeckGLMap.ts', 'DeckGLMap', 'initMapLibre', {
    ...fixture.globals,
    VIEW_PRESETS: { world: { longitude: 0, latitude: 20, zoom: 2 } },
    getCurrentTheme: () => 'dark', localStorage: { getItem: () => null },
    BASEMAP_STORAGE_KEY: 'basemap', resolveEmergencyPackInitialBaseMap: () => 'dark',
    registerEmergencyPackMapProtocolOnce() {}, emergencyPackMapProtocolHandler() {},
    getStyleUrl: () => 'style.json', transformEmergencyPackMapRequest: transformRequest,
    MAP_INTERACTION_MODE: 'flat',
  });
  const instance = { state: { view: 'world' } };
  method.call(instance);
  assert.deepEqual(fixture.events, ['worker', 'map']);
  assert.equal(instance.maplibreMap.options.transformRequest, transformRequest);
  assert.equal(instance.maplibreMap.options.maxPitch, 0);
  assert.equal(instance.maplibreMap.options.interactive, true);
  let prevented = false;
  fixture.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(instance.webglLost, true);
  fixture.listeners.get('webglcontextrestored')();
  assert.equal(instance.webglLost, false);
  assert.equal(fixture.events.at(-1), 'repaint');
});

test('navigation initializes the same worker and reuses its existing map when reopened', () => {
  const fixture = mapFixture();
  const show = componentMethod('src/components/NavigationPanel.ts', 'NavigationPanel', 'show', {
    ...fixture.globals, getMapStyleOptions: () => ({ style: 'style.json' }),
  });
  const instance = { root: { style: {} }, mapContainer: {}, map: null };
  show.call(instance, { lon: 0, lat: 0 });
  assert.deepEqual(fixture.events, ['worker', 'map']);
  assert.equal(JSON.stringify(instance.map.options.center), '[0,0]');
  assert.equal(instance.map.options.zoom, 13);
  const firstMap = instance.map;
  show.call(instance, { lon: 5, lat: 6 });
  assert.equal(instance.map, firstMap);
  assert.equal(JSON.stringify(instance.map.center), '[5,6]');
  assert.deepEqual(fixture.events, ['worker', 'map']);
});

test('both consumers import the supported MapLibre namespace and the shared initializer', () => {
  for (const file of ['src/components/DeckGLMap.ts', 'src/components/NavigationPanel.ts']) {
    const text = source(file);
    assert.match(text, /import \* as maplibregl from 'maplibre-gl'/);
    assert.match(text, /import \{ configureMapLibreWorker \} from ['"].*maplibre-worker['"]/);
  }
});

test('deck integration uses the MapLibre overlay with interleaving and picking retained', () => {
  const text = source('src/components/DeckGLMap.ts');
  assert.match(text, /import \{ MapLibreOverlay \} from '@deck.gl\/maplibre'/);
  assert.match(text, /new MapLibreOverlay\(\{\s*interleaved: true,/);
  assert.match(text, /onClick: .*this\.handleClick\(info\)/);
  assert.doesNotMatch(text, /@deck.gl\/mapbox|map\.transform/);
});

test('installed MapLibre removes active attribution content without losing safe credit links', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window();
  const previous = new Map();
  for (const name of ['window', 'document', 'DOMParser']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: window[name] ?? window });
  }
  try {
    const { AttributionControl } = await import('maplibre-gl');
    const control = new AttributionControl({ customAttribution:
      '<a href="https://example.com/credit">Credit</a>'
      + '<a href="javascript:alert(1)" onclick="alert(2)">Bad link</a>'
      + '<details open onload="alert(3)" ontoggle="alert(4)">Details</details>'
      + '<iframe srcdoc="<script>alert(5)</script>"></iframe>'
      + '<object srcdoc="<script>alert(6)</script>">Object</object>',
    });
    const map = {
      style: { stylesheet: {}, tileManagers: {} },
      _getUIString: () => 'Attribution', getCanvasContainer: () => ({ offsetWidth: 1000 }),
      on() {}, off() {},
    };
    const element = control.onAdd(map);
    const content = element.querySelector('.maplibregl-ctrl-attrib-inner');
    assert.equal(content.querySelector('a').getAttribute('href'), 'https://example.com/credit');
    assert.match(content.textContent, /Credit/);
    assert.equal(content.querySelectorAll('script, iframe').length, 0);
    for (const descendant of content.querySelectorAll('*')) {
      for (const attribute of descendant.attributes) {
        assert.ok(!attribute.name.startsWith('on'), `unsafe event attribute ${attribute.name}`);
        assert.notEqual(attribute.name, 'srcdoc');
        assert.doesNotMatch(attribute.value, /javascript:/i);
      }
    }
    control.onRemove();
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await window.happyDOM.close();
  }
});

test('navigation preserves style-provider precedence and the keyless raster fallback', () => {
  const parsed = ts.createSourceFile('NavigationPanel.ts', source('src/components/NavigationPanel.ts'), ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name.text === 'getMapStyleOptions');
  assert.ok(declaration, 'navigation returns supported map style options');
  const compile = (secrets) => vm.runInNewContext(ts.transpileModule(`${declaration.getText(parsed)}; getMapStyleOptions();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { getRuntimeConfigSnapshot: () => ({ secrets }) });
  assert.equal(compile({ MAPBOX_API_KEY: { value: 'mapbox' }, MAPTILER_API_KEY: { value: 'maptiler' } }).style,
    'https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=mapbox');
  assert.equal(compile({ MAPTILER_API_KEY: { value: 'maptiler' } }).style,
    'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=maptiler');
  const fallback = compile({}).style;
  assert.equal(fallback.version, 8);
  assert.equal(fallback.sources.osm.tiles[0], 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(fallback.layers[0].source, 'osm');
});

test('development prebundles the installed MapLibre adapter rather than resolving the removed adapter', () => {
  const config = source('vite.config.ts');
  const optimize = config.slice(config.indexOf('  optimizeDeps:'));
  assert.match(optimize, /'@deck.gl\/maplibre'/);
  assert.doesNotMatch(optimize, /'@deck.gl\/mapbox'/);
});
