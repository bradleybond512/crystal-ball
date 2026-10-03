// R3-SEC-004: the CSP has no 'unsafe-eval', so the build fails if a
// main-thread chunk contains an eval-family construct. Reviewed exceptions are
// narrow: exact library snippets that never run in a browser, and three
// workers with guarded fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { allowlistedWorker, checkDist, findEvalConstructs } from '../scripts/check-dist-eval.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('each eval-family construct is detected', () => {
  for (const [label, source] of [
    ['new Function', 'x=new Function("a","return a")'],
    ['Function string', 'x=Function(`return 1`)()'],
    ['Function variable', 'x=Function(code)()'],
    ['Function spaced', 'x=Function (src)'],
    ['Function.apply', 'x=Function.apply(null,["return 1"])'],
    ['indirect eval', 'var t=this||(0,eval)(`this`)'],
    ['direct eval', 'var r=eval(src)'],
    ['global eval', 'globalThis.eval(code)'],
    ['string timer', 'setTimeout("tick()",10)'],
  ]) {
    assert.ok(findEvalConstructs(source).length > 0, label);
  }
});

test('ordinary code is not flagged', () => {
  for (const source of ['obj.eval(x)', 'const evaluate=(a)=>a', 'setTimeout(fn,10)', 'myFunction("x")', 'isFunction(x)', 'a.Function(x)', 'typeof x==`function`', 'retrieval(1)', 'new FunctionCall()']) {
    assert.deepEqual(findEvalConstructs(source), [], source);
  }
});

test('only the reviewed never-reached library snippets are tolerated, and only in their exact form', () => {
  const polyfill = 'n(typeof globalThis==`object`&&globalThis)||n(typeof window==`object`&&window)||(function(){return this})()||Function(`return this`)()';
  const knockoutJson = 'return typeof e==`string`&&(e=m.a.Db(e))?a&&a.parse?a.parse(e):Function(`return `+e)():null';
  const knockoutBind = 's=Function(`$context`,`$element`,c),o=i[a]=s';
  for (const guarded of [polyfill, knockoutJson, knockoutBind]) assert.deepEqual(findEvalConstructs(guarded), [], guarded);
  assert.ok(findEvalConstructs(`${knockoutBind};var x=eval(y)`).length > 0, 'another eval next to a guarded snippet still fails');
  assert.ok(findEvalConstructs('Function(`return this`)()').length > 0, 'the bare polyfill call without its guard fails');
  // The JSON fallback is tolerated only when the same object is checked and parsed.
  assert.ok(findEvalConstructs('a&&b.parse?b.parse(e):Function(`return `+e)()').length > 0, 'different object');
  assert.ok(findEvalConstructs('a&&a.parse?a.parse(e):Function(`return `+f)()').length > 0, 'different argument');
});

test('workers are allowed only by reviewed path', () => {
  assert.ok(allowlistedWorker('cesium/Workers/transcodeKTX2.js'));
  assert.ok(allowlistedWorker('assets/ml.worker-CBk_cfBW.js'));
  assert.ok(allowlistedWorker('assets/maplibre-gl-worker-C9R8Li1F.js'));
  assert.equal(allowlistedWorker('assets/GodsVisionView-A8WgfBcG.js'), null);
  assert.equal(allowlistedWorker('assets/evil.worker.js'), null);
});

test('checkDist fails a main-thread chunk and passes a reviewed worker', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'dist-eval-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'export const a=1;');
  writeFileSync(path.join(dist, 'assets', 'ml.worker-abc.js'), 'try{x=new Function("return this")()}catch{}');
  assert.deepEqual(checkDist(dist).violations, []);
  writeFileSync(path.join(dist, 'assets', 'GodsVisionView-abc.js'), 'var t=this||(0,eval)("this")');
  const result = checkDist(dist);
  assert.deepEqual(result.violations.map((v) => v.file), [path.join('assets', 'GodsVisionView-abc.js')]);
  assert.deepEqual(result.allowed.map((v) => v.file), [path.join('assets', 'ml.worker-abc.js')]);
});

test('every build runs the Knockout rewrite and the gate', () => {
  const vite = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const plugins = vite.slice(vite.indexOf('  plugins: ['), vite.indexOf('  plugins: [') + 200);
  assert.match(plugins, /cspSafeGlobalThisPlugin\(\),\s*distEvalGatePlugin\(\),/);
  assert.match(vite, /closeBundle\(\) \{\s*const result = checkDist\(outDir\);\s*if \(result\.violations\.length > 0\) \{\s*throw new Error/);
});

test('the SPZ splat decoder (embind Function invokers) is replaced by a rejecting stand-in', () => {
  const vite = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.match(vite, /'@spz-loader\/core': resolve\(__dirname, 'src\/shims\/spz-loader-unsupported\.ts'\)/);
  const stub = readFileSync(path.join(root, 'src/shims/spz-loader-unsupported.ts'), 'utf8');
  assert.deepEqual(findEvalConstructs(stub), []);
  // Same public names as the real package, so Cesium's import still resolves.
  const real = readFileSync(path.join(root, 'node_modules/@spz-loader/core/dist/index.js'), 'utf8');
  const exported = [...real.slice(real.lastIndexOf('export {')).matchAll(/\bas\s+([\w$]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ['loadSpz', 'loadSpzFromUrl']);
  for (const name of exported) assert.match(stub, new RegExp(`export function ${name}\\(`));
});

test("the Knockout data-bind exception holds only while every Cesium Knockout widget is off", () => {
  const globe = readFileSync(path.join(root, 'src/components/CesiumGlobe.ts'), 'utf8');
  const options = globe.slice(globe.indexOf('new Viewer(cesiumContainer, {'), globe.indexOf('});', globe.indexOf('new Viewer(cesiumContainer, {')));
  for (const widget of ['animation', 'baseLayerPicker', 'fullscreenButton', 'geocoder', 'homeButton', 'infoBox',
    'navigationHelpButton', 'sceneModePicker', 'selectionIndicator', 'timeline']) {
    assert.match(options, new RegExp(`\\b${widget}: false,`), `${widget} must stay disabled`);
  }
  assert.doesNotMatch(options, /\b(?:vrButton|projectionPicker): true/);
  const src = path.join(root, 'src');
  const viewers = [];
  const walk = (dir) => {
    for (const name of readdirSyncSafe(dir)) {
      const full = path.join(dir, name);
      if (name === '__tests__') continue;
      if (statSyncSafe(full)?.isDirectory()) walk(full);
      else if (/\.ts$/.test(name) && /new Viewer\(|applyBindings|Cesium3DTilesInspector|CesiumInspector/.test(readFileSync(full, 'utf8'))) viewers.push(path.relative(root, full));
    }
  };
  walk(src);
  assert.deepEqual(viewers, ['src/components/CesiumGlobe.ts']);
});

function readdirSyncSafe(dir) { try { return readdirSync(dir); } catch { return []; } }
function statSyncSafe(p) { try { return statSync(p); } catch { return null; } }
