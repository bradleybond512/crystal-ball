import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const loader = source('src/app/data-loader.ts');
const panel = source('src/components/EvacuationPanel.ts');
const exposure = source('src/services/weather/evacuation-hazard-exposure.ts');
const styles = source('src/styles/main.css');
const packageJson = JSON.parse(source('package.json'));

test('the atomic weather pair is published immediately and outer failure revokes it', () => {
  assert.match(loader, /evacuationHazardExposureStore/);
  assert.match(
    loader,
    /const \{ alerts, feedState: weatherFeedState \} = snapshot\.data;\s*evacuationHazardExposureStore\.publishWeatherSnapshot\(\{ alerts, feedState: weatherFeedState \}\);\s*const weatherFeedFresh/,
  );
  assert.match(
    loader,
    /catch \(error\) \{\s*evacuationHazardExposureStore\.publishWeatherSnapshot\(\{\s*alerts: \[\],\s*feedState: \{ mode: 'unavailable', timestamp: null \},\s*\}\);/,
  );
});

test('one session store uses only the complete NWS point-jurisdiction resolver and panel teardown cannot destroy it', () => {
  assert.match(exposure, /fetchNwsPointJurisdiction/);
  assert.match(exposure, /export const evacuationHazardExposureStore = createEvacuationHazardExposureStore\(/);
  assert.match(exposure, /resolveZones: fetchNwsPointJurisdiction/);
  assert.match(panel, /evacuationHazardExposureStore/);
  assert.match(panel, /\.subscribe\(/);
  assert.match(panel, /this\.unsubHazardExposure\?\.\(\)/);
  assert.match(panel, /this\.hazardExposureStore\.setRoutes\(\[\]\)/);
  assert.doesNotMatch(panel, /hazardExposureStore\.destroy\(/);
});

test('panel wiring keeps truth language accessible, bounded, and responsive', () => {
  assert.match(panel, /data-evac-hazard-status/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /aria-labelledby=/);
  assert.match(panel, /Reported NWS alert-area intersection/);
  assert.match(panel, /Route hazard exposure unknown/);
  assert.match(panel, /No reported NWS Severe\/Extreme alert intersection at endpoint/);
  assert.match(panel, /Road closure evidence unknown/);
  assert.match(panel, /Hazard evidence does not verify road closure, passability, reachability, or route safety/);
  assert.match(panel, /escapeHtml\(.*event/);
  assert.match(panel, /this\.routeFingerprints = new Map\(/);
  assert.match(panel, /candidate\.routeFingerprint === this\.routeFingerprints\.get\(r\)/);
  assert.match(styles, /\.evac-hazard-evidence/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/);
});

test('the UX-011 script selects provider, evaluator, panel, and wiring contracts', () => {
  const command = packageJson.scripts['test:ux011'];
  assert.doesNotMatch(command ?? '', /--test-force-exit/, 'targeted tests must prove clean natural shutdown');
  for (const file of [
    'src/services/weather/__tests__/weather-alerts-parse.test.mts',
    'src/services/weather/__tests__/evacuation-hazard-exposure.test.mts',
    'src/components/__tests__/evacuation-hazard-exposure-panel.test.mts',
    'tests/evacuation-hazard-exposure-wiring.test.mjs',
  ]) {
    assert.match(command ?? '', new RegExp(file.replaceAll('.', '\\.')));
  }
});
