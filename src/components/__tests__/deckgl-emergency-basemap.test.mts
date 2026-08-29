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

function assertActiveBasemap(map: DeckGLMapHarness, expected: string): void {
  const buttons = [...map.container.querySelectorAll<HTMLButtonElement>('.basemap-btn')];
  assert.equal(buttons.length, 5, 'the selector should expose every basemap choice');
  for (const button of buttons) {
    const isExpected = button.dataset.basemap === expected;
    assert.equal(
      button.classList.contains('basemap-active'),
      isExpected,
      `${button.dataset.basemap} active class should match the selected basemap`,
    );
    assert.equal(
      button.getAttribute('aria-pressed'),
      String(isExpected),
      `${button.dataset.basemap} aria-pressed should match the selected basemap`,
    );
  }
}

beforeEach(() => {
  happyWindow.document.body.replaceChildren();
  happyWindow.localStorage.clear();
});

test('map error offers a focused keyboard button that activates Emergency without replacing the saved normal map', () => {
  const { map, canvas, styles } = createHarness();
  map.state = { layers: {} };
  happyWindow.localStorage.setItem('wm-basemap', 'satellite');
  map.createLayerToggles();
  assertActiveBasemap(map, 'satellite');

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
  assertActiveBasemap(map, 'emergency');
  assert.equal(map.container.querySelector('.map-error-overlay'), null);
  assert.equal(happyWindow.document.activeElement, canvas, 'focus should return to the map after activation');
});

test('explicit selection and programmatic theme transitions share selector synchronization', () => {
  const { map, styles } = createHarness();
  map.state = { layers: {} };
  happyWindow.localStorage.setItem('wm-basemap', 'satellite');

  map.createLayerToggles();

  const action = map.container.querySelector<HTMLButtonElement>('[data-basemap="emergency"]');
  assert.ok(action, 'all variants share an explicit Emergency selector button');
  assert.equal(action.textContent, 'Emergency (offline)');
  assert.equal(action.tabIndex, 0, 'native keyboard reachability should be preserved');
  action.click();
  assert.deepEqual(styles, ['/map-styles/emergency.json']);
  assert.equal(happyWindow.localStorage.getItem('wm-basemap'), 'satellite');
  assertActiveBasemap(map, 'emergency');

  map.switchBasemap('light');
  assert.deepEqual(styles, ['/map-styles/emergency.json', '/map-styles/light.json']);
  assert.equal(happyWindow.localStorage.getItem('wm-basemap'), 'light');
  assertActiveBasemap(map, 'light');
});
