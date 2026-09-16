import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const browser = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis, {
  __BUILD_VARIANT__: 'full', __APP_VERSION__: 'test', __BUILD_COMMIT_SHA__: 'test', __BUILD_TAG__: 'test', __BUILD_TIMESTAMP__: 'test',
  window: browser, document: browser.document, localStorage: browser.localStorage,
  location: browser.location,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node,
  CustomEvent: browser.CustomEvent, MutationObserver: browser.MutationObserver,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; },
});
// Happy DOM has no layout; browser tests cover the actual CSS visibility filter.
browser.HTMLElement.prototype.getClientRects = function () {
  return (this.hidden || this.style.display === 'none' ? [] : [{}]) as never;
};
Object.defineProperty(globalThis, 'navigator', { value: browser.navigator, configurable: true });
// The full Settings class runs unchanged; provider/native panels are isolated because
// their import graph includes Vite worker modules unavailable to Node.
const i18n = await import('../../services/i18n.ts');
const sanitize = await import('../../utils/sanitize.ts');
const savedPlaces = await import('../../services/saved-places.ts');
const thresholds = await import('../../services/config/alert-thresholds.ts');
const dependencies: Record<string, unknown> = {
  '@/services/i18n': i18n, '@/utils/sanitize': sanitize, '@/services/saved-places': savedPlaces,
  '@/services/config/alert-thresholds': thresholds,
  '@/config/feeds': { FEEDS: {}, INTEL_SOURCES: [], SOURCE_REGION_MAP: {} },
  '@/config/panels': { PANEL_CATEGORY_MAP: {} }, '@/config/variant': { SITE_VARIANT: 'full' },
  '@/services/ai-flow-settings': { getAiFlowSettings: () => ({}), getStreamQuality: () => 'auto', STREAM_QUALITY_OPTIONS: [] },
  '@/services/cognition/cognition-settings': { isCognitionEnabled: () => true },
  '@/components/SummaryStrip': { isSummaryStripEnabled: () => true },
  '@/services/always-on': { isAlwaysOn: () => false },
  '@/services/analytics': { hasAnalyticsConsent: () => false },
  './RuntimeConfigPanel': { RuntimeConfigPanel: class { getContentElement() { return document.createElement('div'); } destroy() {} } },
  './StatusPanel': { feedDisplayName: (name: string) => name },
  '@/services/youtube-account': { isYouTubeConnected: () => false },
  '@/services/imessage-bridge': { getImessageSettings: () => ({}) },
  '@/services/runtime': { getApiBaseUrl: () => '' }, '@/services/tauri-bridge': {},
  '@/services/intelligence/saved-places-filter': { getSavedPlacesFilterService: () => ({ getDefaultRadius: () => 50 }) },
  '@/services/proximity-filter': { loadProximityConfig: () => ({ location: null }) },
  '@/services/geonames': {},
};
const compiled = ts.transpileModule(readFileSync(new URL('../UnifiedSettings.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports: Record<string, unknown> = {};
new Function('require', 'exports', compiled)((id: string) => {
  assert.ok(id in dependencies, `Unconfigured Settings dependency: ${id}`);
  return dependencies[id];
}, exports);
const UnifiedSettings = exports.UnifiedSettings as typeof import('../UnifiedSettings.ts').UnifiedSettings;
const { SavedPlaceModal } = await import('../SavedPlaceModal.ts');
const { default: i18next } = await import('i18next');
await i18next.init({ lng: 'en', resources: { en: { translation: JSON.parse(readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8')) } } });
after(() => browser.happyDOM.abort());
const mounted: InstanceType<typeof UnifiedSettings>[] = [];
function mount(overrides = {}) {
  const settings = new UnifiedSettings({
    getPanelSettings: () => ({}), togglePanel: () => {}, setPanelsEnabled: () => {},
    getDisabledSources: () => new Set<string>(), toggleSource: () => {}, setSourcesEnabled: () => {},
    getAllSourceNames: () => [], getLocalizedPanelName: (_key, fallback) => fallback,
    isDesktopApp: false, ...overrides,
  });
  mounted.push(settings);
  const trigger = settings.getButton();
  document.body.append(trigger);
  trigger.focus();
  return { settings, trigger, overlay: document.getElementById('unifiedSettingsModal')! };
}
function key(name: string, shiftKey = false) {
  const event = new browser.KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}
afterEach(() => {
  mounted.splice(0).forEach(settings => settings.destroy());
  document.body.replaceChildren();
});

test('opening identifies a modal and focuses a named close button', () => {
  const { settings, overlay } = mount();
  settings.open();
  assert.equal(overlay.getAttribute('aria-modal'), 'true');
  const close = overlay.querySelector('.unified-settings-close')!;
  assert.equal(close.getAttribute('aria-label'), 'Close');
  assert.equal(document.activeElement === close, true);
});

test('Escape beats earlier document capture handlers and restores the original invoker across repeated opens', () => {
  let escaped = 0;
  const listener = (event: Event) => { if ((event as KeyboardEvent).key === 'Escape') escaped++; };
  document.addEventListener('keydown', listener, true);
  try {
    const { settings, trigger, overlay } = mount();
    settings.open();
    settings.open('places');
    assert.equal(key('Escape').defaultPrevented, true);
    assert.equal(escaped, 0);
    assert.equal(overlay.classList.contains('active'), false);
    assert.equal(document.activeElement === trigger, true);
    key('Escape');
    assert.equal(escaped, 1, 'closed Settings releases the listener');
  } finally { document.removeEventListener('keydown', listener, true); }
});

test('Tab wraps current usable controls, including outside focus and an empty dialog', () => {
  const { settings, overlay, trigger } = mount();
  settings.open();
  overlay.innerHTML = '<button hidden>Hidden</button><button id="first">First</button><button disabled>Disabled</button><div inert><button>Inert</button></div><button id="last">Last</button><button tabindex="-1">Skipped</button>';
  const first = overlay.querySelector<HTMLElement>('#first')!;
  const last = overlay.querySelector<HTMLElement>('#last')!;
  last.focus();
  assert.equal(key('Tab').defaultPrevented, true);
  assert.equal(document.activeElement === first, true);
  key('Tab', true);
  assert.equal(document.activeElement === last, true);
  trigger.focus();
  key('Tab');
  assert.equal(document.activeElement === first, true);
  trigger.focus();
  key('Tab', true);
  assert.equal(document.activeElement === last, true);
  overlay.innerHTML = '';
  key('Tab');
  assert.equal(document.activeElement === overlay, true);
});

test('a removed focused control recovers inside Settings without stealing focus on unrelated updates', async () => {
  const { settings, overlay, trigger } = mount();
  settings.open();
  overlay.querySelector<HTMLElement>('.unified-settings-close')!.remove();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(overlay.contains(document.activeElement), true);
  trigger.focus();
  overlay.append(document.createElement('span'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(document.activeElement === trigger, true);
});

test('native/body launch and removed invokers fall back to the visible Settings button', () => {
  const { settings, trigger } = mount();
  const invoker = document.createElement('button');
  document.body.append(invoker);
  invoker.focus();
  settings.open();
  invoker.remove();
  settings.close();
  assert.equal(document.activeElement === trigger, true);
  trigger.blur();
  settings.open();
  settings.close();
  assert.equal(document.activeElement === trigger, true);
});

test('place callbacks run after Settings closes and preserve the Places tab', () => {
  const seen: boolean[] = [];
  const { settings, overlay } = mount({ openCreatePlace: () => seen.push(overlay.classList.contains('active')), openEditPlace: (id: string) => { assert.equal(id, 'place-1'); seen.push(overlay.classList.contains('active')); } });
  settings.open('places');
  overlay.querySelector<HTMLElement>('[data-places-action="add"]')!.click();
  assert.deepEqual(seen, [false]);
  settings.open();
  assert.equal(overlay.querySelector('.unified-settings-tab.active')?.getAttribute('data-tab'), 'places');
  const edit = document.createElement('button');
  edit.dataset.placesAction = 'edit'; edit.dataset.placeId = 'place-1';
  overlay.append(edit); edit.click();
  assert.deepEqual(seen, [false, false]);
});

test('missing place callbacks leave Settings open', () => {
  const { settings, overlay } = mount();
  settings.open('places');
  overlay.querySelector<HTMLElement>('[data-places-action="add"]')!.click();
  assert.equal(overlay.classList.contains('active'), true);
});

test('destroy restores focus and releases keyboard ownership', () => {
  const { settings, trigger } = mount();
  settings.open(); settings.destroy();
  assert.equal(document.activeElement === trigger, true);
  assert.equal(key('Tab').defaultPrevented, false);
  assert.equal(key('Escape').defaultPrevented, false);
});

test('Saved Place Escape precedes document capture and exits picking before closing', () => {
  let escaped = 0;
  const listener = () => escaped++;
  document.addEventListener('keydown', listener, true);
  const modes: boolean[] = [];
  const modal = new SavedPlaceModal({ onPickLocationMode: active => modes.push(active) });
  try {
    modal.openCreate();
    const overlay = document.getElementById('savedPlaceModal')!;
    overlay.querySelector<HTMLElement>('[data-action="pick-map"]')!.click();
    assert.equal(key('Escape').defaultPrevented, true);
    assert.equal(escaped, 0);
    assert.equal(overlay.classList.contains('active'), true);
    assert.deepEqual(modes, [true, false]);
    key('Escape');
    assert.equal(escaped, 0);
    assert.equal(overlay.classList.contains('active'), false);
    key('Escape');
    assert.equal(escaped, 1);
  } finally { modal.close(); document.removeEventListener('keydown', listener, true); }
});
