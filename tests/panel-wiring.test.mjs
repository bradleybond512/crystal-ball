import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('full-variant awareness panels are registered, instantiated, and refreshed', () => {
  const panelsConfig = readRepoFile('src/config/panels.ts');
  const panelLayout = readRepoFile('src/app/panel-layout.ts');
  // data-loader.ts delegates the utility loaders to loaders/utility.ts.
  const dataLoader = readRepoFile('src/app/data-loader.ts') + '\n' + readRepoFile('src/app/loaders/utility.ts');
  const appSource = readRepoFile('src/App.ts');

  for (const panelId of ['comms-health', 'economic-stress']) {
 assert.match(
 panelsConfig,
 new RegExp(`['"]${panelId}['"]\\s*:\\s*\\{`),
 `panels config should register ${panelId} regardless of quote/spacing style`,
 );
  }

  assert.match(panelLayout, /new CommsHealthPanel\(\)/);
  assert.match(panelLayout, /this\.ctx\.panels\[['"]comms-health['"]\]\s*=/);
  assert.match(panelLayout, /new EconomicStressPanel\(\)/);
  assert.match(panelLayout, /this\.ctx\.panels\[['"]economic-stress['"]\]\s*=/);
  assert.match(dataLoader, /fetchCommsHealth/);
  assert.match(dataLoader, /fetchEconomicStress/);
  assert.match(dataLoader, /loadCommsHealth\(\)/);
  assert.match(dataLoader, /loadEconomicStress\(\)/);
  assert.match(dataLoader, /ctx\.panels\[['"]comms-health['"]\]/);
  assert.match(dataLoader, /ctx\.panels\[['"]economic-stress['"]\]/);

  assert.match(appSource, /this\.dataLoader\.loadCommsHealth\(\)/);
  assert.match(appSource, /this\.dataLoader\.loadEconomicStress\(\)/);
});

test('air-traffic panel is registered, instantiated, and scheduled', () => {
  const panelsConfig = readRepoFile('src/config/panels.ts');
  const panelLayout = readRepoFile('src/app/panel-layout.ts');
  const dataLoader = readRepoFile('src/app/data-loader.ts');
  const appSource = readRepoFile('src/App.ts');

  assert.match(
 panelsConfig,
 /['"]air-traffic['"]\s*:\s*\{/,
 'panels config should register air-traffic',
  );
  assert.match(panelLayout, /new AirTrafficPanel\(\)/);
  assert.match(panelLayout, /this\.ctx\.panels\[['"]air-traffic['"]\]\s*=/);
  assert.match(dataLoader, /fetchAdsbSnapshot/);
  assert.match(dataLoader, /loadAdsb\(\)/);
  assert.match(appSource, /scheduleRefresh/);
});
