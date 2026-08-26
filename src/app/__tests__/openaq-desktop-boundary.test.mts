import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelLayout = readFileSync(new URL('../panel-layout.ts', import.meta.url), 'utf8');
const dataLoader = readFileSync(new URL('../data-loader.ts', import.meta.url), 'utf8');

test('panel layout constructs OpenAQ only when the active variant defaults contain it', () => {
  assert.match(
    panelLayout,
    /if \('openaq-monitor' in DEFAULT_PANELS\) \{\s*const openaqMonitorPanel = new OpenaqMonitorPanel\(\);\s*this\.ctx\.panels\['openaq-monitor'\] = openaqMonitorPanel;\s*\}/,
  );
});

test('data loader does not record an OpenAQ provider vote when the source is inapplicable', () => {
  assert.match(
    dataLoader,
    /if \(openaqReadings\.status === 'fulfilled' && openaqReadings\.value\.applicable\) \{[\s\S]*?recordDomainObservations\('openaq-v3',[\s\S]*?\} else if \(openaqReadings\.status === 'rejected'\) \{\s*recordDomainObservations\('openaq-v3', \[\], false\);\s*\}/,
  );
});
