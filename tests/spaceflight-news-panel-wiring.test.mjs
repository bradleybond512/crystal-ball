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
const appSrc = readFileSync(resolve(root, 'src/App.ts'), 'utf8');
const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
const spaceWeatherSrc = readFileSync(resolve(root, 'src/services/space-weather.ts'), 'utf8');
const mainRsSrc = readFileSync(resolve(root, 'src-tauri/src/main.rs'), 'utf8');

describe('spaceflight news + donki wiring', () => {
  it('spaceflight-news panel is registered in full-variant defaults', () => {
 assert.match(panelsSrc, /'spaceflight-news':\s*\{[^}]*enabled:\s*true/);
  });

  it('SpaceflightNewsPanel is instantiated and wired in panel-layout', () => {
 assert.match(panelLayoutSrc, /new SpaceflightNewsPanel\(/);
 assert.match(panelLayoutSrc, /this\.ctx\.panels\[['"]spaceflight-news['"]\]/);
  });

  it('data-loader has loadSpaceflightNews method', () => {
 assert.match(dataLoaderSrc, /async loadSpaceflightNews\(\): Promise<void>/);
 assert.match(dataLoaderSrc, /spaceflight-news/);
  });

  it('App.ts scheduler includes spaceflight-news', () => {
 assert.match(appSrc, /spaceflightNews/);
 assert.match(appSrc, /loadSpaceflightNews/);
  });

  it('sidecar has donki-events route', () => {
 assert.match(sidecarSrc, /\/api\/donki-events/);
 assert.match(sidecarSrc, /api\.nasa\.gov\/DONKI/);
  });

  it('space-weather service exports fetchDonkiEvents', () => {
 assert.match(spaceWeatherSrc, /export.*fetchDonkiEvents/);
  });

  it('main.rs includes NASA_API_KEY', () => {
 assert.match(mainRsSrc, /NASA_API_KEY/);
  });
});
