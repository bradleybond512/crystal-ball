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

describe('federal register + wsb sentiment wiring', () => {
  it('federal-register panel is registered in full-variant defaults', () => {
 assert.match(panelsSrc, /'federal-register':\s*\{[^}]*enabled:\s*true/);
  });

  it('FederalRegisterPanel is instantiated in panel-layout', () => {
 assert.match(panelLayoutSrc, /new FederalRegisterPanel\(/);
 assert.match(panelLayoutSrc, /this\.ctx\.panels\[['"]federal-register['"]\]/);
  });

  it('data-loader has loadFederalRegister method', () => {
 assert.match(dataLoaderSrc, /async loadFederalRegister\(\): Promise<void>/);
 assert.match(dataLoaderSrc, /federal-register/);
  });

  it('App.ts scheduler includes federalRegister', () => {
 assert.match(appSrc, /federalRegister/);
 assert.match(appSrc, /loadFederalRegister/);
  });

  it('sidecar has federal-register route', () => {
 assert.match(sidecarSrc, /\/api\/federal-register/);
 assert.match(sidecarSrc, /federalregister\.gov/);
  });

  it('data-loader calls fetchWsbSentiment', () => {
 assert.match(dataLoaderSrc, /fetchWsbSentiment/);
  });
});
