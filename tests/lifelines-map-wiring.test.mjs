import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const layout = source('src/app/panel-layout.ts');
const container = source('src/components/MapContainer.ts');
const svgMap = source('src/components/Map.ts');
const deckMap = source('src/components/DeckGLMap.ts');
const logisticsPanel = source('src/components/LocalLogisticsPanel.ts');
const evacuationPanel = source('src/components/EvacuationPanel.ts');
const evacuationRouter = source('src/services/evacuation-router.ts');
const mapPopup = source('src/components/MapPopup.ts');
const styles = source('src/styles/main.css');

test('panel layout consumes and tears down both validated disaster map events', () => {
  assert.match(layout, /parseLifelinesOverlayEventDetail\(.*\.detail\)/);
  assert.match(layout, /parseEvacRouteEventDetail\(.*\.detail\)/);
  assert.match(layout, /addEventListener\('wm:show-lifelines-overlay'/);
  assert.match(layout, /removeEventListener\('wm:show-lifelines-overlay'/);
  assert.match(layout, /parseClearLifelinesOverlayEventDetail\(.*\.detail\)/);
  assert.match(layout, /addEventListener\('wm:clear-lifelines-overlay'/);
  assert.match(layout, /removeEventListener\('wm:clear-lifelines-overlay'/);
  assert.match(layout, /addEventListener\('wm:show-evac-route'/);
  assert.match(layout, /removeEventListener\('wm:show-evac-route'/);
  assert.match(layout, /showLifelinesOverlay\(snapshot\)/);
  assert.match(layout, /showEvacRoute\(route\)/);
});

test('disaster ordering puts Lifelines and evacuation immediately after saved places', () => {
  assert.match(layout, /'saved-places',\s*'local-logistics',\s*'evacuation'/);
});

test('MapContainer preserves transient overlays across renderer initialization and fallback', () => {
  assert.match(container, /activeLifelinesOverlay/);
  assert.match(container, /activeEvacRoute/);
  assert.match(container, /asyncInitGuard\.isCurrent\(generation\)/);
  assert.match(container, /asyncInitGuard\.dispose\(\)/);
  assert.match(container, /this\.svgMap\.setLifelinesOverlay/);
  assert.match(container, /this\.deckGLMap\.setLifelinesOverlay/);
  assert.match(container, /this\.svgMap\.setEvacRoute/);
  assert.match(container, /this\.deckGLMap\.setEvacRoute/);
  assert.match(container, /getEvacRouteDisclosure\(\)/);
  assert.match(container, /activeEvacRoute\.cachedAt/);
  assert.match(container, /amber directory-only/);
  assert.match(container, /Availability is not inferred/);
  assert.match(container, /subscribeSavedPlaces\(\(\) => this\.revalidateActiveEvacRoute\(\)\)/);
  assert.match(container, /parseEvacRouteEventDetail\(\{ route: active \}\)/);
  assert.match(container, /this\.clearEvacRoute\(\)/);
  assert.match(container, /this\.unsubscribeSavedPlaces\?\.\(\)/);
  assert.match(evacuationRouter, /Current road conditions unverified/);
});

test('both map engines expose Lifelines markers and a graph-route renderer', () => {
  for (const implementation of [svgMap, deckMap]) {
    assert.match(implementation, /setLifelinesOverlay/);
    assert.match(implementation, /setEvacRoute/);
    assert.match(implementation, /lifelines-overlay|lifeline-map-marker/);
    assert.match(implementation, /evac-route-overlay|evac-route-map-line/);
    assert.match(implementation, /getTemporaryMapBounds/);
    assert.match(implementation, /route\.geometry\.coordinates/);
  }
  assert.match(styles, /lifeline-map-marker[\s\S]{0,500}var\(--marker-scale/);
});

test('map overlays require explicit panel actions and preserve truthful route wording', () => {
  assert.match(logisticsPanel, /data-logistics-map/);
  assert.match(logisticsPanel, /snapshot\.placeId\s*!==\s*this\.activePlaceId/);
  assert.match(logisticsPanel, /subscribeSavedPlaces/);
  assert.match(logisticsPanel, /snapshotPlaceSignature\s*!==\s*buildLifelinesPlaceMatchSignature/);
  assert.match(logisticsPanel, /wm:clear-lifelines-overlay/);
  assert.match(logisticsPanel, /new CustomEvent\('wm:show-lifelines-overlay'/);
  assert.match(evacuationPanel, /data-evac-action="show-map"/);
  assert.match(evacuationPanel, /new CustomEvent\('wm:show-evac-route'/);
  assert.match(evacuationPanel, /graph estimate/);
  assert.match(evacuationPanel, /No current road-condition conclusion can be drawn/);
  assert.match(evacuationPanel, /planningError/);
  assert.match(evacuationPanel, /role="alert"/);
  assert.match(mapPopup, /Retrieved \$\{escapeHtml\(retrieved\)\}/);
  assert.match(mapPopup, /Source reported \$\{escapeHtml\(sourceReported\)\}/);
  assert.doesNotMatch(mapPopup, />Observed \$\{escapeHtml\(/);
  assert.doesNotMatch(evacuationPanel, /safe route|roads? (?:are )?open|reachable route/i);
});
