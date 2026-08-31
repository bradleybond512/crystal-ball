import '../../../src/styles/base-layer.css';
import '../../../src/styles/window-chrome.css';
import '../../../src/styles/home-shell.css';
import '../../../src/styles/library.css';

import { buildDesktopLayout } from '../../../src/app/layout/html';
import type { AppContext } from '../../../src/app/app-context';
import { CommandPalettePanel } from '../../../src/components/CommandPalettePanel';
import { EEWStatusBar } from '../../../src/components/EEWStatusBar';
import { HomeShellOverlay } from '../../../src/components/HomeShellOverlay';
import { LibraryOverlay } from '../../../src/components/LibraryOverlay';
import { UnifiedSettings } from '../../../src/components/UnifiedSettings';
import { createCommandRegistry } from '../../../src/services/command-palette/command-registry';
import { DEFAULT_MAP_LAYERS, DEFAULT_PANELS } from '../../../src/config/panels';

const FIXED_NOW = Date.UTC(2026, 7, 31, 12, 0, 0);
const root = document.querySelector<HTMLElement>('#fixture-root')!;

const context = {
  container: root,
  isMobile: false,
  isDesktopApp: true,
  panelSettings: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  updateState: null,
} as unknown as AppContext;

const classic = document.createElement('section');
classic.id = 'fixture-classic';
classic.innerHTML = buildDesktopLayout(context);
root.append(classic);

const mapBackdrop = document.createElement('div');
mapBackdrop.className = 'fixture-map-backdrop fixture-map-dark';
classic.querySelector('.map-container')?.append(mapBackdrop);

const mapRendererSource = await import('../../../src/components/Map');
type MapPrivateRenderers = {
  createControls(): HTMLElement;
  createTimeSlider(): HTMLElement;
  createLayerToggles(): HTMLElement;
};
const mapPrototype = mapRendererSource.MapComponent.prototype as unknown as MapPrivateRenderers;
const mapAdapter = {
  state: { timeRange: '24h', layers: DEFAULT_MAP_LAYERS },
  zoomIn() {}, zoomOut() {}, reset() {}, setTimeRange() {}, render() {},
};
const mapContainer = classic.querySelector<HTMLElement>('.map-container')!;
mapContainer.append(
  mapPrototype.createControls.call(mapAdapter),
  mapPrototype.createTimeSlider.call(mapAdapter),
  mapPrototype.createLayerToggles.call(mapAdapter),
);

const homeHost = document.createElement('section');
homeHost.id = 'fixture-home';
root.append(homeHost);
const home = new HomeShellOverlay({
  getPanel: () => undefined,
  ensurePanel: () => undefined,
  now: () => FIXED_NOW,
  contextualProjection: {
    kind: 'ready',
    build: () => ({
      state: 'ready',
      headline: 'Northern corridor posture',
      summary: 'Frozen scenario · UTC · three corroborated signals',
      cards: [],
      semanticKey: 'ux025-fixture',
    }),
  },
  contextualSnapshotSource: { get: () => null, subscribe: () => () => {}, hydrate: async () => {} },
});
home.mount(homeHost);
const homeRoot = homeHost.querySelector<HTMLElement>('.home-shell')!;
homeRoot.hidden = false;
homeRoot.querySelector<HTMLElement>('.home-shell-map')!.classList.add('fixture-map-backdrop', 'fixture-map-dark');

const library = new LibraryOverlay();
library.mount(document.body);

const registry = createCommandRegistry();
registry.register({ id: 'open-intel', title: 'Open Intelligence Briefing', keywords: ['brief'], category: 'navigation', action() {} });
const palette = new CommandPalettePanel({ registry });
palette.mount(document.body);

const settings = new UnifiedSettings({
  getPanelSettings: () => DEFAULT_PANELS,
  togglePanel() {},
  setPanelsEnabled() {},
  getDisabledSources: () => new Set(),
  toggleSource() {},
  setSourcesEnabled() {},
  getAllSourceNames: () => [],
  getLocalizedPanelName: (_key, fallback) => fallback,
  isDesktopApp: false,
});

const eew = new EEWStatusBar();
const eewWithoutPolling = eew as unknown as { startPolling(): void };
eewWithoutPolling.startPolling = () => {};
eew.mount(classic);

const style = document.createElement('style');
style.textContent = `
  html, body, #fixture-root { width: 100%; min-height: 100%; margin: 0; }
  body { overflow: hidden; }
  #fixture-home, #fixture-classic { position: fixed; inset: 0; }
  .fixture-map-backdrop { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .fixture-map-dark { background-image: url('./dark-map.svg'); }
  .fixture-map-satellite { background-image: url('./satellite-map.svg'); }
  .e2e-ux025 *, .e2e-ux025 *::before, .e2e-ux025 *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
`;
document.head.append(style);
document.body.classList.add('e2e-ux025');

type FixtureState = 'home' | 'classic' | 'library' | 'command' | 'settings';
function setState(state: FixtureState, backdrop: 'dark' | 'satellite' = 'dark'): void {
  classic.hidden = state === 'home';
  homeHost.hidden = state !== 'home';
  document.body.classList.toggle('home-shell-active', state === 'home');
  library.hide();
  palette.hide();
  settings.close();
  if (state === 'library') { classic.hidden = false; library.show(); }
  if (state === 'command') { classic.hidden = false; palette.show(); }
  if (state === 'settings') { classic.hidden = false; settings.open(); }
  document.querySelectorAll('.fixture-map-backdrop').forEach((element) => {
    element.classList.toggle('fixture-map-dark', backdrop === 'dark');
    element.classList.toggle('fixture-map-satellite', backdrop === 'satellite');
  });
}

window.__UX025_FIXTURE__ = { setState, fixedNow: FIXED_NOW };
setState('home');
document.documentElement.dataset.fixtureReady = 'true';

declare global {
  interface Window {
    __UX025_FIXTURE__: { setState(state: FixtureState, backdrop?: 'dark' | 'satellite'): void; fixedNow: number };
  }
}
