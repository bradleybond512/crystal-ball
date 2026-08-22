import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelLayout = await readFile(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
const dataLoader = await readFile(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');
const lifelineRuntime = await readFile(new URL('../src/services/lifelines/lifeline-runtime.ts', import.meta.url), 'utf8');

function bodyBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('the shipped panel-layout boot installs Lifeline derivation before panels can publish', () => {
  const init = bodyBetween(panelLayout, '  init(): void {', '  destroy(): void {');
  const startAt = init.indexOf('this.stopLifelineRuntime = startLifelineRuntime()');
  const renderAt = init.indexOf('this.renderLayout()');
  assert.ok(startAt >= 0, 'PanelLayoutManager.init must start the Lifeline runtime');
  assert.ok(renderAt > startAt, 'the runtime must start before renderLayout constructs Disaster Lifelines');
  assert.match(init, /getSavedPlaces\(\)\.filter\(\(place\) => place\.offlinePinned\)\.slice\(0, 3\)/);

  const destroy = bodyBetween(panelLayout, '  destroy(): void {', '  renderLayout(): void {');
  assert.match(destroy, /this\.cancelPinnedLifelinePrewarm\?\.\(\)/);
  assert.match(destroy, /this\.stopLifelineRuntime\?\.\(\)/);
  assert.doesNotMatch(dataLoader, /startLifelineRuntime/,
    'the dormant DataLoaderManager.init path must not own shipped Lifeline startup');
});

test('the Lifeline runtime strictly validates document event details before derivation', () => {
  assert.match(lifelineRuntime, /validateLocalLogisticsSnapshotEvent\(/);
  assert.match(lifelineRuntime, /CustomEvent<unknown>/);
  assert.doesNotMatch(lifelineRuntime, /CustomEvent<LocalLogisticsSnapshot>/);
  assert.doesNotMatch(lifelineRuntime, /snapshot\.schemaVersion\s*!==\s*2/);
});

test('Storm Mode opens the exact matched place in Disaster Lifelines only on user action', () => {
  const shelf = bodyBetween(panelLayout, '  private mountAlertShelf(): void {', '  private createPanels(): void {');
  assert.match(shelf, /onOpenLifelines: \(target\) => this\._openDisasterLifelines\?\.\(target\)/);

  const fullPanels = bodyBetween(
    panelLayout,
    " if (SITE_VARIANT === 'full') {\n let localLogisticsPanel",
    " const watchlistPanel = new WatchlistPanel",
  );
  assert.match(fullPanels, /this\._openDisasterLifelines = \(target: WeatherSavedPlaceActionTarget\) => \{/);
  assert.match(fullPanels, /const place = getSavedPlace\(target\.placeId\)/);
  assert.match(fullPanels, /matchesWeatherSavedPlaceActionTarget\(\{/);
  assert.match(fullPanels, /\}, target\)\) return;/);
  assert.match(fullPanels, /focusSavedPlace\(place\.id\)/);
  assert.match(fullPanels, /this\.navigateToPanel\('local-logistics'\)/);
});
