import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const panelsSrc = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const panelLayoutSrc = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
// data-loader.ts delegates the disease/humanitarian loaders to loaders/disease.ts.
const dataLoaderSrc = [
  readFileSync(resolve(root, 'src/app/data-loader.ts'), 'utf8'),
  readFileSync(resolve(root, 'src/app/loaders/disease.ts'), 'utf8'),
].join('\n');
const appSrc = readFileSync(resolve(root, 'src/App.ts'), 'utf8');
const sidecarSrc = readFileSync(resolve(root, 'src-tauri/sidecar/local-api-server.mjs'), 'utf8');
const diseaseOutbreakSrc = readFileSync(resolve(root, 'src/services/disease-outbreak.ts'), 'utf8');

describe('humanitarian crisis + disease.sh wiring', () => {
  it('humanitarian-crisis panel is registered in full-variant defaults', () => {
 assert.match(panelsSrc, /'humanitarian-crisis':\s*\{[^}]*enabled:\s*true/);
  });

  it('HumanitarianCrisisPanel is instantiated in panel-layout', () => {
 assert.match(panelLayoutSrc, /new HumanitarianCrisisPanel\(/);
 assert.match(panelLayoutSrc, /this\.ctx\.panels\[['"]humanitarian-crisis['"]\]/);
  });

  it('data-loader has loadHumanitarianCrises method', () => {
 assert.match(dataLoaderSrc, /async loadHumanitarianCrises\(\): Promise<void>/);
 assert.match(dataLoaderSrc, /humanitarian-crisis/);
  });

  it('App.ts scheduler includes humanitarianCrises', () => {
 assert.match(appSrc, /humanitarianCrises/);
 assert.match(appSrc, /loadHumanitarianCrises/);
  });

  it('sidecar has hdx-crises route', () => {
 assert.match(sidecarSrc, /\/api\/hdx-crises/);
 assert.match(sidecarSrc, /humdata\.org/);
  });

  it('disease-outbreak service exports fetchGlobalDiseaseSnapshots', () => {
 assert.match(diseaseOutbreakSrc, /export.*fetchGlobalDiseaseSnapshots/);
  });
});
