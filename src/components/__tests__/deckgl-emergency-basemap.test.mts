import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import '../../../tests/panels/register-hook.mjs';
import { happyWindow } from '../../../tests/panels/setup-dom.mts';

const moduleValue = await import('../DeckGLMap.ts').catch(() => ({})) as {
  DeckGLMap?: { prototype: object };
};

interface DeckGLMapHarness {
  activeBaseMap: string;
  container: HTMLElement;
  countryGeoJsonLoaded: boolean;
  createLayerToggles(): void;
  maplibreMap: {
    getCanvas(): HTMLCanvasElement;
    once(event: string, callback: () => void): void;
    setStyle(style: string): void;
  };
  showMapErrorOverlay(message: string, sourceId?: string): void;
  state: { layers: Record<string, boolean> };
  switchBasemap(basemap: string): void;
}

function createHarness(): { map: DeckGLMapHarness; canvas: HTMLCanvasElement; styles: string[] } {
  assert.ok(moduleValue.DeckGLMap, 'DeckGLMap should be exported');
  const container = happyWindow.document.createElement('div') as unknown as HTMLElement;
  const wrapper = happyWindow.document.createElement('div');
  wrapper.id = 'deckglMapWrapper';
  const canvas = happyWindow.document.createElement('canvas') as unknown as HTMLCanvasElement;
  canvas.tabIndex = 0;
  wrapper.append(canvas as unknown as Node);
  container.append(wrapper as unknown as Node);
  happyWindow.document.body.append(container as unknown as Node);
  const styles: string[] = [];
  const map = Object.create(moduleValue.DeckGLMap.prototype) as DeckGLMapHarness & Record<string, unknown>;
  map.activeBaseMap = 'satellite';
  map.container = container;
  map.countryGeoJsonLoaded = true;
  map.maplibreMap = {
    getCanvas: () => canvas,
    once: () => undefined,
    setStyle: (style) => { styles.push(style); },
  };
  return { map, canvas, styles };
}

beforeEach(() => {
  happyWindow.document.body.replaceChildren();
  happyWindow.localStorage.clear();
});

test('map error offers a focused keyboard button that activates Emergency without replacing the saved normal map', () => {
  const { map, canvas, styles } = createHarness();
  happyWindow.localStorage.setItem('wm-basemap', 'satellite');

  map.showMapErrorOverlay('<offline>', 'carto-emergency-base');

  const overlay = map.container.querySelector('.map-error-overlay');
  const action = overlay?.querySelector<HTMLButtonElement>('.map-error-emergency');
  assert.ok(action, 'the existing map error path should expose Use Emergency map');
  assert.equal(action.textContent, 'Use Emergency map');
  assert.equal(happyWindow.document.activeElement, action, 'the recovery action should receive focus');
  assert.doesNotMatch(overlay?.innerHTML ?? '', /<offline>/, 'error details should remain escaped');

  action.click();

  assert.deepEqual(styles, ['/map-styles/emergency.json']);
  assert.equal(map.activeBaseMap, 'emergency');
  assert.equal(happyWindow.localStorage.getItem('wm-basemap'), 'satellite');
  assert.equal(map.container.querySelector('.map-error-overlay'), null);
  assert.equal(happyWindow.document.activeElement, canvas, 'focus should return to the map after activation');
});

test('the shared basemap selector explicitly activates Emergency through its native keyboard button', () => {
  const { map } = createHarness();
  const selections: string[] = [];
  map.state = { layers: {} };
  map.switchBasemap = (basemap) => {
    selections.push(basemap);
    map.activeBaseMap = basemap;
  };

  map.createLayerToggles();

  const action = map.container.querySelector<HTMLButtonElement>('[data-basemap="emergency"]');
  assert.ok(action, 'all variants share an explicit Emergency selector button');
  assert.equal(action.textContent, 'Emergency (offline)');
  assert.equal(action.tabIndex, 0, 'native keyboard reachability should be preserved');
  action.click();
  assert.deepEqual(selections, ['emergency']);
  assert.equal(action.classList.contains('basemap-active'), true);
});
