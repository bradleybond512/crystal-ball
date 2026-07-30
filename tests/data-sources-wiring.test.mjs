import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const panelsSrc = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const panelLayoutSrc = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
const dataLoaderSrc = readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8');
const appSrc = readFileSync(resolve(root, 'src/App.ts'), 'utf8');

describe('RIPE Atlas wiring', () => {
  it('sidecar has /api/ripe-atlas route', () => {
    assert.match(sidecarSrc, /\/api\/ripe-atlas/);
    assert.match(sidecarSrc, /atlas\.ripe\.net/);
  });

  it('ripe-atlas panel is registered', () => {
    assert.match(panelsSrc, /'ripe-atlas':\s*\{/);
  });

  it('RipeAtlasPanel is instantiated in panel-layout', () => {
    assert.match(panelLayoutSrc, /new RipeAtlasPanel\(/);
  });

  it('data-loader has loadRipeAtlas method', () => {
    assert.match(dataLoaderSrc, /async loadRipeAtlas\(\): Promise<void>/);
  });

  it('App.ts scheduler includes ripeAtlas', () => {
    assert.match(appSrc, /ripeAtlas/);
    assert.match(appSrc, /loadRipeAtlas/);
  });
});

// The surface_temp fusion block in loadWeatherAlerts. Scoped deliberately: the
// hourly-forecast block ~30 lines ABOVE it is a separate, pre-existing
// fire-and-forget IIFE with its own `!place.lat || !place.lon` test, and an
// unscoped regex over the whole file would match that one instead.
const surfaceTempBlock = (() => {
  const start = dataLoaderSrc.indexOf('// surface_temp fusion: Open-Meteo + MET Norway per saved place.');
  assert.notEqual(start, -1, 'surface_temp fusion block must exist in data-loader');
  const end = dataLoaderSrc.indexOf("recordDomainObservations('met-norway'", start);
  assert.notEqual(end, -1, 'surface_temp block must record met-norway');
  return dataLoaderSrc.slice(start, end + 200);
})();

describe('surface_temp fusion data-loader wiring', () => {
  it('the block is awaited, not fire-and-forget', () => {
    // recordDomainObservations REPLACES per provider. Unawaited, the tick's
    // in-flight guard releases while these requests are still running, so a
    // retry can start a second tick whose newer observations are then
    // overwritten by the older, slower one landing last.
    assert.match(surfaceTempBlock, /await Promise\.allSettled\(places\.map\(/);
    assert.doesNotMatch(surfaceTempBlock, /void \(async \(\)/, 'surface_temp fetches must not be fire-and-forget');
  });

  it('coordinates are range-checked, never truthiness-tested', () => {
    // `!place.lat || !place.lon` skips longitude 0 (London, Accra) and
    // latitude 0 — after which both providers are recorded empty for that place.
    assert.match(surfaceTempBlock, /isUsableLatLon\(place\.lat, place\.lon\)/);
    assert.doesNotMatch(surfaceTempBlock, /!place\.lat \|\| !place\.lon/);
  });

  it('the health verdict comes from the adapter output, not the raw readings', () => {
    // Recording ok from `readings.length > 0` greens a provider whose rows the
    // adapter drops — a phantom vote toward "verified by N independent sources".
    assert.match(surfaceTempBlock, /tempVote\('open-meteo-forecast', openMeteoReadings\)/);
    assert.match(surfaceTempBlock, /tempVote\('met-norway', metNorwayReadings\)/);
    assert.match(surfaceTempBlock, /recordDomainObservations\('open-meteo-forecast', omVote\.observations, omVote\.ok\)/);
    assert.match(surfaceTempBlock, /recordDomainObservations\('met-norway', mnVote\.observations, mnVote\.ok\)/);
    assert.doesNotMatch(surfaceTempBlock, /readings\.length > 0/, 'ok must never be derived from the raw readings array');
  });
});

describe('World Bank data-loader wiring', () => {
  it('data-loader imports fetchWorldBankProfile', () => {
    assert.match(dataLoaderSrc, /fetchWorldBankProfile/);
  });

  it('data-loader has loadWorldBankBaselines method', () => {
    assert.match(dataLoaderSrc, /async loadWorldBankBaselines\(\): Promise<void>/);
  });

  it('App.ts scheduler includes worldBankBaselines', () => {
    assert.match(appSrc, /worldBankBaselines/);
    assert.match(appSrc, /loadWorldBankBaselines/);
  });
});
