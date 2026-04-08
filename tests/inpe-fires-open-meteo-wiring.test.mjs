import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
const weatherSrc = readFileSync(resolve(root, 'src/services/weather.ts'), 'utf8');
const dataLoaderSrc = readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8');
const appSrc = readFileSync(resolve(root, 'src/App.ts'), 'utf8');

describe('inpe fires + open-meteo wiring', () => {
  it('sidecar has inpe-fires route', () => {
 assert.match(sidecarSrc, /\/api\/inpe-fires/);
 assert.match(sidecarSrc, /queimadas\.dgi\.inpe\.br/);
  });

  it('weather service exports fetchOpenMeteoConditions', () => {
 assert.match(weatherSrc, /export.*fetchOpenMeteoConditions/);
 assert.match(weatherSrc, /open-meteo\.com/);
  });

  it('data-loader has loadInpeFires method', () => {
 assert.match(dataLoaderSrc, /async loadInpeFires\(\): Promise<void>/);
  });

  it('App.ts scheduler includes inpeFires', () => {
 assert.match(appSrc, /inpeFires/);
 assert.match(appSrc, /loadInpeFires/);
  });
});
