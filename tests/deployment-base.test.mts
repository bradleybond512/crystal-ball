import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { deploymentAssetUrl, normalizeDeploymentBase } from '../src/utils/deployment-base.ts';
import { createPwaManifestPaths } from '../src/config/pwa-manifest.ts';

const root = new URL('../', import.meta.url);
const source = (file) => readFileSync(new URL(file, root), 'utf8');

// Execute only the named path consumers, with synthetic globals and no app/runtime.
function sourceModule(file, base, globals = {}, imports = {}) {
  const module = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(imports, specifier)) return imports[specifier];
    assert.match(specifier, /deployment-base(?:\.ts)?$/);
    return sourceModule('src/utils/deployment-base.ts', base);
  };
  const code = source(file).replace(/\bimport\.meta\.env\b/g, JSON.stringify({ BASE_URL: base }));
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require, URL, ...globals });
  return module.exports;
}

test('deployment bases default to root and normalize a missing trailing slash', () => {
  assert.equal(normalizeDeploymentBase(), '/');
  assert.equal(normalizeDeploymentBase(''), '/');
  assert.equal(normalizeDeploymentBase('/'), '/');
  assert.equal(normalizeDeploymentBase('/crystal-ball'), '/crystal-ball/');
  assert.equal(normalizeDeploymentBase('/crystal-ball/'), '/crystal-ball/');
  assert.equal(normalizeDeploymentBase('/crystal-ball///'), '/crystal-ball/');
  for (const base of ['https://example.invalid/', '//example.invalid/', 'relative/', '/a/../b', '/a/./b', '/a?x=1', '/a#b', '/a\\b']) {
    assert.throws(() => normalizeDeploymentBase(base), /Deployment base/);
  }
});

test('deployment bases reject paths a browser resolves outside their textual prefix', () => {
  for (const base of [
    '/prefix/%2e/', '/prefix/%2E/', '/prefix/%2e%2e/',
    '/prefix/.%2e/', '/prefix/%2E./', '/prefix/%2e%2E/',
    '/prefix/\t../', '/prefix/.\n./', '/prefix/\r../',
  ]) {
    assert.notEqual(new URL(base, 'https://deployment.invalid').pathname, base, base);
    assert.throws(() => normalizeDeploymentBase(base), /Deployment base/, base);
    assert.throws(() => createPwaManifestPaths(base), /Deployment base/, base);
  }
  for (const base of ['/prefix/v1.2/', '/prefix/%2e-name/', '/prefix/a%20b/']) {
    assert.equal(normalizeDeploymentBase(base), base);
  }
});

test('bundled asset joining uses root and normalized subpath deployments', () => {
  for (const [input, base] of [['/', '/'], ['/crystal-ball', '/crystal-ball/'], ['/crystal-ball/', '/crystal-ball/']]) {
    for (const path of ['data/countries.geojson', 'map-styles/dark.json', 'cesium/', 'favico/android-chrome-192x192.png']) {
      assert.equal(deploymentAssetUrl(path, input), `${base}${path}`);
      assert.equal(deploymentAssetUrl(`/${path}`, input), `${base}${path}`);
    }
  }
  assert.equal(deploymentAssetUrl('cesium/'), '/cesium/', 'unbundled Node fixtures default to root');
});

for (const base of ['/', '/crystal-ball/']) {
  test(`manifest starts, scopes and resolves every icon inside ${base}`, () => {
    const manifest = createPwaManifestPaths(base.replace(/\/$/, '') || '/');
    assert.equal(manifest.start_url, base);
    assert.equal(manifest.scope, base);
    assert.deepEqual(manifest.icons, [
      { src: `${base}favico/android-chrome-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}favico/android-chrome-512x512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${base}favico/android-chrome-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  test(`country geometry requests its bundled GeoJSON inside ${base}`, async () => {
    const requests = [];
    const geometry = sourceModule('src/services/country-geometry.ts', base, {
      fetch: async (url) => {
        requests.push(url);
        return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) };
      },
      console: { warn: (message) => assert.fail(message) },
    }, {
      './diagnostics/diagnostic-events': {
        getDefaultDiagnosticBus: () => ({ emit: (event) => assert.fail(JSON.stringify(event)) }),
      },
    });
    await geometry.preloadCountryGeometry();
    assert.deepEqual(requests, [`${base}data/countries.geojson`]);
  });

  test(`all normal and emergency map styles resolve inside ${base}`, () => {
    const styles = sourceModule('src/services/emergency-pack/emergency-pack-map-style.ts', base);
    for (const variant of ['full', 'tech', 'finance', 'happy']) {
      for (const map of ['dark', 'light', 'satellite', 'terrain', 'emergency']) {
        const filename = variant === 'happy' && ['dark', 'light'].includes(map) ? `happy-${map}` : map;
        assert.equal(styles.getEmergencyPackBaseMapStyleUrl(map, variant), `${base}map-styles/${filename}.json`);
      }
    }
  });

  test(`Cesium initializes both asset bases inside ${base}`, () => {
    const window = {};
    const urls = [];
    const ion = {};
    const cesium = sourceModule('src/config/cesium-init.ts', base, { window }, {
      cesium: { Ion: ion, buildModuleUrl: { setBaseUrl: (url) => urls.push(url) } },
    });
    cesium.initCesium();
    assert.equal(window.CESIUM_BASE_URL, `${base}cesium/`);
    assert.deepEqual(urls, [`${base}cesium/`]);
    assert.deepEqual(ion, {}, 'no credentials are introduced');
  });

  test(`App sets the Cesium path before the globe dynamic import at ${base}`, async () => {
    const file = 'src/App.ts';
    const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
    const app = parsed.statements.find((entry) => ts.isClassDeclaration(entry) && entry.name?.text === 'App');
    const method = app.members.find((entry) => entry.name?.getText(parsed) === 'toggleGodsVision');
    assert.ok(method);
    const window = {};
    let entered = false;
    const require = (specifier) => {
      assert.equal(specifier, '@/components/GodsVisionView');
      assert.equal(window.CESIUM_BASE_URL, `${base}cesium/`, 'path must be set before importing Cesium');
      return { GodsVisionView: class { enter() { entered = true; } } };
    };
    const toggle = vm.runInNewContext(ts.transpileModule(`class Subject { ${method.getText(parsed)} }; Subject.prototype.toggleGodsVision;`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      window, require,
      deploymentAssetUrl: (path) => deploymentAssetUrl(path, base),
      getRuntimeConfigSnapshot: () => ({ secrets: {} }),
      console: { error: (message) => assert.fail(message) },
    });
    await toggle.call({ godsVisionView: null });
    assert.equal(entered, true);
  });
}

test('Vite uses the normalized base for build, manifest and development Cesium mount', () => {
  const vite = source('vite.config.ts');
  assert.match(vite, /const deploymentBase = normalizeDeploymentBase\(process\.env\.BASE_PATH\)/);
  assert.match(vite, /base:\s*deploymentBase/);
  assert.match(vite, /\.\.\.createPwaManifestPaths\(deploymentBase\)/);
  assert.match(vite, /server\.middlewares\.use\(deploymentAssetUrl\('cesium', deploymentBase\)/);
  assert.doesNotMatch(vite, /(?:start_url|scope):\s*'\/'|src:\s*'\/favico\//);
});

test('noscript explains the missing dashboard and hides the loading skeleton', () => {
  const html = source('index.html');
  const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(noscript);
  assert.match(noscript, /<h1>Crystal Ball needs JavaScript<\/h1>/);
  assert.match(noscript, /Enable JavaScript and reload this page/);
  assert.match(noscript, /No live information is shown/);
  assert.match(noscript, /#app\s*\{\s*display:\s*none/);
  assert.ok(html.indexOf(noscript) < html.indexOf('<div id="app">'));
});
