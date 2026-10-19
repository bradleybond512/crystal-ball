import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const CONSENT = 'wm-analytics-consent';
const VERSION = 'wm-analytics-consent-version';
const QUEUE = 'wm-analytics-offline-queue';
const IDENTITY = 'wm-installation-id';

async function harness(t, seed = {}, deferred = false, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'crystalball-analytics-'));
  const store = new Map(Object.entries(seed));
  const saved = new Map(['localStorage', 'window', 'document', 'fetch', '__analyticsHarness'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let release;
  const state = { hold: false, pending: [], init: [], captures: [], sends: [], listeners: [], optOut: 0, optIn: 0, sdkImports: 0, disabled: false, ghost: false, unavailable: false, desktop: options.desktop ?? true, vercel: [] };
  state.sdkReady = new Promise(resolve => { release = resolve; });
  state.sdk = {
    init: (key, config) => state.init.push({ key, config }),
    register: () => {},
    capture: (name, props, options) => {
      if (state.disabled) return;
      const beforeSend = state.init.at(-1)?.config.before_send;
      if (beforeSend && beforeSend({event: name, properties: props ?? {}}) === null) return;
      state.captures.push({ name, props, options });
      void fetch('https://analytics.invalid/capture', { method: 'POST', body: JSON.stringify({ name, props }) });
    },
    opt_out_capturing: () => { state.optOut++; state.disabled = true; },
    opt_in_capturing: () => { state.optIn++; state.disabled = false; },
  };
  globalThis.__analyticsHarness = state;
  globalThis.localStorage = {
    getItem: key => { if (state.unavailable) throw new Error('storage unavailable'); return store.get(key) ?? null; },
    setItem: (key, value) => { if (state.unavailable || state.failWriteKey === key) throw new Error('storage unavailable'); store.set(key, value); },
    removeItem: key => { if (state.unavailable) throw new Error('storage unavailable'); store.delete(key); },
    key: index => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  globalThis.window = { addEventListener: (name, handler) => state.listeners.push({ name, handler }) };
  globalThis.document = { addEventListener: (name, handler) => state.listeners.push({ name, handler }) };
  state.inject = config => { state.vercel.push(config); }; 
  globalThis.fetch = async (...args) => { state.sends.push(args); if (state.hold) return new Promise(resolve => state.pending.push(resolve)); return new Response('', { status: 200 }); };
  t.after(async () => {
    release();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    await rm(directory, { recursive: true, force: true });
  });
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../analytics.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
    define: { 'import.meta.env': JSON.stringify({ VITE_POSTHOG_KEY: options.key === false ? '' : 'phc_test_configured_key', VITE_POSTHOG_HOST: 'https://analytics.invalid' }), __APP_VERSION__: '"test"' },
    plugins: [{ name: 'analytics-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(\.\/runtime|\.\/mode-manager|\.\/runtime-config|@\/config\/variant|posthog-js|@vercel\/analytics)$/ }, args => ({ path: args.path, namespace: 'analytics-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'analytics-stub' }, args => ({ contents: {
        './runtime': 'export const isDesktopRuntime = () => globalThis.__analyticsHarness.desktop;',
        './mode-manager': 'export const isGhostMode = () => globalThis.__analyticsHarness.ghost;',
        './runtime-config': 'export const isSecretSet = () => false;',
        '@/config/variant': 'export const SITE_VARIANT = "full";',
        '@vercel/analytics': 'const state = globalThis.__analyticsHarness; await state.sdkReady; export const inject = config => state.inject(config);',
        'posthog-js': 'const state = globalThis.__analyticsHarness; state.sdkImports++; await state.sdkReady; export default state.sdk;',
      }[args.path], loader: 'js' }));
    } }],
  });
  const entry = join(directory, 'analytics.mjs');
  await writeFile(entry, bundled.outputFiles[0].text);
  if (!deferred) release();
  const api = await import(pathToFileURL(entry).href);
  return { api, state, store, release };
}

for (const [name, seed] of [
  ['fresh install', {}],
  ['raw legacy true', {[CONSENT]: 'true'}],
  ['corrupt consent', {[CONSENT]: 'yes', [VERSION]: '2'}],
  ['unknown provenance', {[CONSENT]: 'true', [VERSION]: '2', 'wm-analytics-consent-source': 'unknown'}],
  ['opted out', {[CONSENT]: 'false', [VERSION]: '2'}],
]) {
  test(`${name}: configured analytics does not load SDK, queue, or send`, async t => {
    const {api, state, store} = await harness(t, seed);
    await api.initAnalytics();
    api.trackEvent('wm_panel_viewed', {panel_id: 'map'});
    api.trackEventBeforeUnload('wm_theme_changed', {theme: 'dark'});
    assert.equal(state.sdkImports, 0);
    assert.equal(state.sends.length, 0);
    assert.equal(store.has(QUEUE), false);
    assert.equal(store.has(IDENTITY), false);
  });
}

for (const seed of [
  {[CONSENT]: 'true', 'wm-analytics-consent-prompt-seen': 'true', [IDENTITY]: 'legacy-id', [QUEUE]: '[{"name":"wm_panel_viewed","props":{"panel_id":"map"}}]'},
  {[IDENTITY]: 'legacy-id'},
  {[QUEUE]: '[]'},
]) {
  test('ambiguous upgrade discards identity and queue without sending', async t => {
    const {api, state, store} = await harness(t, seed);
    api.migrateAnalyticsConsent();
    await api.initAnalytics();
    assert.equal(api.isAnalyticsAllowed(), false);
    assert.equal(store.get('wm-analytics-consent-source'), 'default');
    assert.equal(store.get('wm-analytics-consent-reason'), 'legacy-reset');
    assert.equal(store.has(IDENTITY), false);
    assert.equal(store.has(QUEUE), false);
    assert.equal(state.sends.length, 0);
  });
}

test('proven consent survives upgrade and sends the public anonymous capture contract', async t => {
  const {api, state} = await harness(t, {[CONSENT]: 'true', [VERSION]: '2'});
  api.migrateAnalyticsConsent();
  await api.initAnalytics();
  api.trackEvent('wm_panel_viewed', {panel_id: 'map', secret: 'do-not-send'});
  assert.equal(state.sdkImports, 0, 'no SDK retry or automatic event machinery');
  assert.equal(state.sends.length, 2);
  const [url, request] = state.sends[1];
  assert.equal(url, 'https://analytics.invalid/i/v0/e/');
  const body = JSON.parse(request.body);
  assert.equal(body.api_key, 'phc_test_configured_key');
  assert.equal(body.event, 'wm_panel_viewed');
  assert.match(body.distinct_id, /^[a-f0-9-]{36}$/);
  assert.equal(body.properties.panel_id, 'map');
  assert.equal(body.properties.secret, undefined);
  assert.equal(body.properties.$process_person_profile, false);
  assert.equal(request.credentials, 'omit');
  assert.equal(request.keepalive, false);
  assert.ok(request.signal instanceof AbortSignal);
});

test('late failed response after revocation cannot retry; regrant sends fresh events only', async t => {
  const {api, state, store} = await harness(t);
  state.hold = true;
  api.setAnalyticsConsent(true);
  await api.initAnalytics();
  api.trackEvent('wm_panel_viewed', {panel_id: 'map'});
  assert.equal(state.sends.length, 2);
  const oldId = store.get(IDENTITY);
  api.setAnalyticsConsent(false);
  for (const [, request] of state.sends) assert.equal(request.signal?.aborted, true);
  for (const resolve of state.pending) resolve(new Response('', {status: 500}));
  await new Promise(resolve => setTimeout(resolve, 30));
  api.trackEvent('wm_panel_viewed', {panel_id: 'denied'});
  api.trackEventBeforeUnload('wm_theme_changed', {theme: 'dark'});
  assert.equal(state.sends.length, 2);
  assert.equal(store.has(QUEUE), false);
  state.hold = false;
  api.setAnalyticsConsent(true);
  await api.initAnalytics();
  api.trackEvent('wm_panel_viewed', {panel_id: 'fresh'});
  assert.equal(state.sends.length, 4);
  assert.notEqual(store.get(IDENTITY), oldId);
  assert.equal(JSON.parse(state.sends[3][1].body).properties.panel_id, 'fresh');
});

test('revocation while web initialization waits prevents all initialization', async t => {
  const {api, state, release} = await harness(t, {}, true, {desktop: false});
  api.setAnalyticsConsent(true);
  const pending = api.initAnalytics();
  await new Promise(resolve => setImmediate(resolve));
  api.setAnalyticsConsent(false);
  release();
  await pending;
  assert.equal(state.vercel.length, 0);
  assert.equal(state.sends.length, 0);
});

test('revoke and regrant during web initialization only starts the current generation', async t => {
  const {api, state, release} = await harness(t, {}, true, {desktop: false});
  api.setAnalyticsConsent(true);
  const old = api.initAnalytics();
  await new Promise(resolve => setImmediate(resolve));
  api.setAnalyticsConsent(false);
  api.setAnalyticsConsent(true);
  const current = api.initAnalytics();
  release();
  await Promise.all([old, current]);
  assert.equal(state.vercel.length, 1);
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0][0], '/ingest/i/v0/e/');
});

test('storage failures block initial capture and cannot prevent revocation', async t => {
  const {api, state} = await harness(t);
  state.unavailable = true;
  await api.initAnalytics();
  api.trackEvent('wm_panel_viewed', {panel_id: 'map'});
  assert.equal(state.sends.length, 0);
  state.unavailable = false;
  state.failWriteKey = VERSION;
  api.setAnalyticsConsent(true);
  await api.initAnalytics();
  assert.equal(state.sends.length, 0);
  state.failWriteKey = undefined;
  api.setAnalyticsConsent(true);
  await api.initAnalytics();
  assert.equal(state.sends.length, 1);
  state.unavailable = true;
  assert.doesNotThrow(() => api.setAnalyticsConsent(false));
  api.trackEvent('wm_panel_viewed', {panel_id: 'denied'});
  assert.equal(state.sends.length, 1);
});

test('web analytics needs consent independently of the PostHog key', async t => {
  const {api, state} = await harness(t, {}, false, {desktop: false, key: false});
  await api.initAnalytics();
  assert.equal(state.vercel.length, 0);
  api.setAnalyticsConsent(true);
  await api.initAnalytics();
  assert.equal(state.vercel.length, 1);
  assert.equal(state.sends.length, 0);
  const event = {type: 'pageview', url: 'https://example.test/'};
  assert.deepEqual(state.vercel[0].beforeSend(event), event);
  api.setAnalyticsConsent(false);
  assert.equal(state.vercel[0].beforeSend(event), null);
});

for (const boundary of ['ghost', 'storage']) {
  test(`${boundary} change aborts active requests and blocks further capture`, async t => {
    const {api, state, store} = await harness(t);
    state.hold = true;
    api.setAnalyticsConsent(true);
    await api.initAnalytics();
    if (boundary === 'ghost') state.ghost = true;
    else store.set(CONSENT, 'false');
    const name = boundary === 'ghost' ? 'wm:mode-changed' : 'storage';
    const listeners = state.listeners.filter(item => item.name === name);
    assert.equal(listeners.length, 1);
    listeners[0].handler({key: CONSENT});
    assert.equal(state.sends[0][1].signal?.aborted, true);
    api.trackEvent('wm_panel_viewed', {panel_id: 'denied'});
    assert.equal(state.sends.length, 1);
    for (const resolve of state.pending) resolve(new Response('', {status: 500}));
  });
}

test('stalled capture is aborted at the bounded timeout without retry', async t => {
  const {api, state} = await harness(t);
  t.mock.timers.enable({apis: ['setTimeout']});
  state.hold = true;
  api.setAnalyticsConsent(true);
  await api.initAnalytics();
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0][1].signal.aborted, false);
  t.mock.timers.tick(10_000);
  assert.equal(state.sends[0][1].signal.aborted, true);
  for (const resolve of state.pending) resolve(new Response('', {status: 500}));
  await Promise.resolve();
  t.mock.timers.tick(60_000);
  assert.equal(state.sends.length, 1);
});
