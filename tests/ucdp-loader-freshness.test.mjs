import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');

test('UCDP loaders report dataset currency instead of transport time as current freshness', () => {
  assert.match(source, /recordUcdpDatasetState\('ucdp', dataset, classifications\.size\)/);
  assert.match(source, /recordUcdpDatasetState\('ucdp_events', result\.dataset, events\.length\)/);
  assert.doesNotMatch(source, /dataFreshness\.recordUpdate\('ucdp', classifications\.size\)/);
  assert.doesNotMatch(source, /dataFreshness\.recordUpdate\('ucdp_events', events\.length\)/);
});

test('web runtime schedules no UCDP fetch or freshness-error path', () => {
  assert.match(
    source,
    /const ucdpAvailable = isDesktopRuntime\(\) && isFeatureAvailable\('ucdpEvents'\);/,
  );
  assert.match(
    source,
    /if \(ucdpAvailable\) \{\s*tasks\.push\(\(async \(\) => \{[\s\S]*?fetchUcdpClassifications\(\)[\s\S]*?dataFreshness\.recordError\('ucdp',[\s\S]*?\}\)\(\)\);\s*\}/,
  );
  assert.match(
    source,
    /if \(ucdpAvailable\) \{\s*tasks\.push\(\(async \(\) => \{[\s\S]*?fetchUcdpEvents\(\)[\s\S]*?dataFreshness\.recordError\('ucdp_events',[\s\S]*?\}\)\(\)\);\s*\}/,
  );
});

test('historical UCDP events render without entering live intelligence ingestion', () => {
  assert.match(
    source,
    /const ucdpIsCurrent = assessUcdpDatasetCurrency\(result\.dataset\)\.current;\s*if \(ucdpIsCurrent\) \{\s*const ucdpObservations = [\s\S]*?if \(ucdpObservations\.length > 0\) ingestObservations\(ucdpObservations\);\s*\}\s*\(this\.ctx\.panels\['ucdp-events'\] as UcdpEventsPanel\)\?\.setEvents\(events\);/,
  );
  assert.match(source, /if \(this\.ctx\.mapLayers\.ucdpEvents\) \{\s*this\.ctx\.map\?\.setUcdpEvents\(events\);\s*\}/);
});
