import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const panelsSrc = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const panelLayoutSrc = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
const dataLoaderSrc = readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8');

describe('panel wiring regressions', () => {
  it('registers hub activity panels in variant defaults', () => {
 assert.match(
 panelsSrc,
 /'geo-hubs':\s*\{[^}]*enabled:\s*true[^}]*\}/,
 'full variant should expose the geopolitical hubs panel',
 );
 assert.match(
 panelsSrc,
 /'tech-hubs':\s*\{[^}]*enabled:\s*true[^}]*\}/,
 'tech variant should expose the hot tech hubs panel',
 );
  });

  it('instantiates specialized hub and regulation panels instead of leaving them orphaned', () => {
 assert.match(
 panelLayoutSrc,
 /new GeoHubsPanel\(/,
 'panel layout should create the geopolitical hubs panel',
 );
 assert.match(
 panelLayoutSrc,
 /new TechHubsPanel\(/,
 'panel layout should create the tech hubs panel',
 );
 assert.match(
 panelLayoutSrc,
 /new RegulationPanel\('regulation'\)/,
 'tech variant should render the regulation dashboard panel',
 );
  });

  it('hydrates hub panels from clustered news activity', () => {
 assert.match(
 dataLoaderSrc,
 /getTopActiveHubs\(/,
 'data loader should compute tech hub activity after clustering',
 );
 assert.match(
 dataLoaderSrc,
 /getTopActiveGeoHubs\(/,
 'data loader should compute geopolitical hub activity after clustering',
 );
 assert.match(
 dataLoaderSrc,
 /setTechActivity\(/,
 'tech hub activity should be pushed onto the map',
 );
 assert.match(
 dataLoaderSrc,
 /setGeoActivity\(/,
 'geopolitical hub activity should be pushed onto the map',
 );
  });

  it('only creates fallback -news panels when the active variant actually declares them', () => {
 assert.match(
 panelLayoutSrc,
 /altPanelKey in DEFAULT_PANELS/,
 'specialized panels should not be shadowed by generic NewsPanel fallbacks',
 );
  });
});
