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
let state = { enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false, threshold: 'critical' };
const calls: unknown[][] = [];
let legacy: { enabled: boolean; recipient: string } | null = null;
let refresh = async () => ({ ok: true });
let configure = async (_recipient: string, _enabled: boolean): Promise<any> => ({ ok: true });
let disable = async (): Promise<any> => { state.enabled = false; return { ok: true }; };
const bridge = {
  getImessageSettings: () => ({ ...state }), getLegacyImessageSuggestion: () => legacy,
  refreshImessageSettings: () => refresh(),
  configureImessage: (recipient: string, enabled: boolean) => { calls.push(['configure', recipient, enabled]); return configure(recipient, enabled); },
  disableImessage: () => { calls.push(['disable']); return disable(); },
  saveImessageThreshold: () => {},
  sendImessage: async (...args: unknown[]) => { calls.push(['send', ...args]); return { ok: true }; },
};
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
  '@/services/youtube-account': { isYouTubeConnected: () => false, initYouTubeAccountListeners: () => {} },
  '@/services/imessage-bridge': bridge,
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

after(() => browser.happyDOM.abort());
let settings: InstanceType<typeof UnifiedSettings>;
function el<T extends HTMLElement = HTMLInputElement>(id: string): T { return document.getElementById(id)! as T; }
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); }
function change(id: string, value: string | boolean) {
  const input = el<HTMLInputElement>(id);
  if (typeof value === 'boolean') input.checked = value; else input.value = value;
  input.dispatchEvent(new browser.Event(typeof value === 'boolean' ? 'change' : 'input', { bubbles: true }));
}
function mount() {
  settings = new UnifiedSettings({ getPanelSettings: () => ({}), togglePanel: () => {}, setPanelsEnabled: () => {}, getDisabledSources: () => new Set(), toggleSource: () => {}, setSourcesEnabled: () => {}, getAllSourceNames: () => [], getLocalizedPanelName: (_key, fallback) => fallback, isDesktopApp: true });
  settings.open();
}
afterEach(() => {
  settings?.destroy(); document.body.replaceChildren(); calls.length = 0; legacy = null;
  state = { enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false, threshold: 'critical' };
  refresh = async () => ({ ok: true }); configure = async () => ({ ok: true });
  disable = async () => { state.enabled = false; return { ok: true }; };
});
test('loading blocks Save/Test and supplies names and polite feedback', async () => {
  mount(); await flush();
  refresh = () => new Promise(() => {}); settings.open();
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
  assert.equal(el<HTMLButtonElement>('us-imessage-save').disabled, true);
  assert.equal(el('us-imessage-status').getAttribute('aria-live'), 'polite');
  assert.ok(el('us-imessage-recipient').getAttribute('aria-label'));
  assert.equal(calls.length, 0);
});
test('recipient input/blur and enable are drafts; Save submits exact proposal; draft blocks Test', async () => {
  mount(); await flush();
  change('us-imessage-recipient', '+15550000000');
  el('us-imessage-recipient').dispatchEvent(new browser.Event('change', { bubbles: true }));
  assert.equal(calls.length, 0);
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
  el('us-imessage-save').click(); await flush();
  assert.deepEqual(calls, [['configure', '+15550000000', true]]);
});
test('Test uses saved confirmation and body only', async () => {
  mount(); await flush();
  assert.match(el('us-imessage-saved').textContent!, /15551234567/);
  el('us-imessage-test').click(); await flush();
  assert.deepEqual(calls, [['send', 'Crystal Ball test message — alert routing is wired up.']]);
});
test('disable stays available during confirmation and late completion cannot repaint enabled', async () => {
  let complete!: (result: unknown) => void;
  configure = () => new Promise(resolve => { complete = resolve; });
  mount(); await flush(); change('us-imessage-recipient', '+15550000000');
  el('us-imessage-save').click();
  assert.equal(el<HTMLInputElement>('us-imessage-enabled').disabled, false);
  change('us-imessage-enabled', false); await flush();
  assert.deepEqual(calls.at(-1), ['disable']);
  state.enabled = true; complete({ ok: true }); await flush();
  assert.equal(el<HTMLInputElement>('us-imessage-enabled').checked, false);
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
});
test('cancel restores actual saved configuration and safe status', async () => {
  configure = async () => ({ ok: false, code: 'canceled', reason: 'Confirmation canceled.' });
  mount(); await flush(); change('us-imessage-recipient', '+15550000000'); el('us-imessage-save').click(); await flush();
  assert.equal(el<HTMLInputElement>('us-imessage-recipient').value, '+15551234567');
  assert.match(el('us-imessage-status').textContent!, /canceled/);
});
test('closing and reopening ignores old pending completion', async () => {
  let complete!: (result: unknown) => void;
  configure = () => new Promise(resolve => { complete = resolve; });
  mount(); await flush(); change('us-imessage-recipient', '+15550000000'); el('us-imessage-save').click();
  settings.close(); state.enabled = false; settings.open(); await flush();
  complete({ ok: false, reason: 'OLD RESPONSE' }); await flush();
  assert.doesNotMatch(el('us-imessage-status').textContent!, /OLD RESPONSE/);
  assert.equal(el<HTMLInputElement>('us-imessage-enabled').checked, false);
});
test('failed hydration stays disabled but explicit reconfiguration remains possible', async () => {
  state.enabled = false; state.ready = false;
  refresh = async () => ({ ok: false, reason: 'Settings unavailable.' } as any);
  mount(); await flush();
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
  assert.match(el('us-imessage-status').textContent!, /unavailable/);
  change('us-imessage-recipient', '+15550000000'); change('us-imessage-enabled', true);
  assert.equal(el<HTMLButtonElement>('us-imessage-save').disabled, false);
});
test('enable requires Save and input updates retain keyboard focus', async () => {
  state.enabled = false; mount(); await flush();
  change('us-imessage-enabled', true);
  assert.equal(calls.length, 0);
  const input = el<HTMLInputElement>('us-imessage-recipient'); input.focus();
  change('us-imessage-recipient', '+15550000000');
  assert.equal(document.activeElement, input);
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
  el('us-imessage-save').click(); await flush();
  assert.deepEqual(calls, [['configure', '+15550000000', true]]);
});
test('failed disable shows nondurable error and keeps Test disabled', async () => {
  disable = async () => { state.enabled = false; state.ready = false; return { ok: false, reason: 'Settings could not be saved. Previous settings may return after restart.' }; };
  mount(); await flush(); change('us-imessage-enabled', false); await flush();
  assert.equal(el<HTMLInputElement>('us-imessage-enabled').checked, false);
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
  assert.match(el('us-imessage-status').textContent!, /after restart/);
});
test('a changed recipient can be explicitly confirmed while sending stays disabled', async () => {
  state.enabled = false; mount(); await flush();
  change('us-imessage-recipient', '+15550000000');
  assert.equal(el<HTMLButtonElement>('us-imessage-save').disabled, false);
  el('us-imessage-save').click(); await flush();
  assert.deepEqual(calls, [['configure', '+15550000000', false]]);
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
});

test('one-time legacy suggestion is visibly a draft and never silently prompts or sends', async () => {
  state.enabled = false; state.recipient = ''; state.migrationAvailable = true;
  legacy = { enabled: true, recipient: '+15550000000' };
  mount(); await flush();
  assert.equal(el<HTMLInputElement>('us-imessage-recipient').value, '+15550000000');
  assert.match(el('us-imessage-status').textContent!, /Review previous/);
  assert.equal(el<HTMLButtonElement>('us-imessage-test').disabled, true);
  assert.equal(calls.length, 0);
  el('us-imessage-save').click(); await flush();
  assert.deepEqual(calls, [['configure', '+15550000000', true]]);
});
