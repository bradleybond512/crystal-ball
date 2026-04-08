import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
const cyberExtraSrc = readFileSync(resolve(root, 'src/services/cyber-extra.ts'), 'utf8');
const dataLoaderSrc = readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8');
const runtimeConfigSrc = readFileSync(resolve(root, 'src/services/runtime-config.ts'), 'utf8');
const mainRsSrc = readFileSync(resolve(root, 'src-tauri/src/main.rs'), 'utf8');

describe('phishstats + greynoise wiring', () => {
  it('sidecar has phishstats route', () => {
 assert.match(sidecarSrc, /\/api\/phishstats-feed/);
 assert.match(sidecarSrc, /phishstats\.info/);
  });

  it('sidecar has greynoise lookup route', () => {
 assert.match(sidecarSrc, /\/api\/greynoise-lookup/);
 assert.match(sidecarSrc, /greynoise\.io/);
 assert.match(sidecarSrc, /GREYNOISE_API_KEY/);
  });

  it('cyber-extra exports fetchPhishStatsFeed and enrichWithGreyNoise', () => {
 assert.match(cyberExtraSrc, /export async function fetchPhishStatsFeed/);
 assert.match(cyberExtraSrc, /export async function enrichWithGreyNoise/);
  });

  it('data-loader calls fetchPhishStatsFeed', () => {
 assert.match(dataLoaderSrc, /fetchPhishStatsFeed/);
  });

  it('runtime-config has greynoiseIntel feature and GREYNOISE_API_KEY secret', () => {
 assert.match(runtimeConfigSrc, /greynoiseIntel/);
 assert.match(runtimeConfigSrc, /GREYNOISE_API_KEY/);
  });

  it('main.rs includes GREYNOISE_API_KEY in supported keys', () => {
 assert.match(mainRsSrc, /GREYNOISE_API_KEY/);
  });
});
