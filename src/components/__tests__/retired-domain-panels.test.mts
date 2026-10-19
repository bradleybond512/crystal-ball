import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

test('service status labels the destination actually probed on the page despite a different configured remote', async () => {
  const browser = new Window({ url: 'http://localhost:3000/' });
  const env: Record<string, string> = { VITE_TAURI_REMOTE_API_BASE_URL: 'http://localhost:4000' };
  const requested: string[] = [];
  const values = {
    window: browser, document: browser.document, navigator: browser.navigator,
    localStorage: browser.localStorage, Node: browser.Node, __viteImportMetaEnv: env,
    fetch: async (input: string | URL | Request) => {
      const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const destination = new URL(value, browser.location.href).href;
      requested.push(destination);
      return { ok: true, url: destination } as Response;
    },
  };
  const saved = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  // The shared hook handles ordinary Vite reads; runtime.ts intentionally
  // guards import.meta.env with a cast, so give its real module Vite's input.
  const configurationHook = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!url.endsWith('/src/services/runtime.ts') || loaded.source === undefined) return loaded;
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString('utf8');
      return { ...loaded, source: `Object.defineProperty(import.meta, 'env', { value: globalThis.__viteImportMetaEnv });\n${source}` };
    },
  });
  try {
    const { ServiceStatusPanel } = await import('../ServiceStatusPanel');
    const { getRemoteApiBaseUrl } = await import('../../services/runtime');
    assert.equal(getRemoteApiBaseUrl(), 'http://localhost:4000', 'the configured remote differs from this page');
    const methods = ServiceStatusPanel.prototype as unknown as {
      probeCloudHealth(this: object): Promise<void>;
      buildBackendStatus(this: object): HTMLElement;
    };
    const state = { cloudReachable: null as boolean | null, localBackend: null, render() {} };
    await methods.probeCloudHealth.call(state);
    assert.deepEqual(requested, ['http://localhost:3000/api/health']);
    assert.equal(state.cloudReachable, true);
    const status = methods.buildBackendStatus.call(state);
    assert.equal(status.querySelector('strong')?.textContent, new URL(requested[0]!).host);
    assert.ok(!status.textContent?.includes('localhost:4000'));
    browser.happyDOM.setURL('http://localhost:5000/');
    assert.equal(methods.buildBackendStatus.call(state).querySelector('strong')?.textContent, 'localhost:3000',
      'the completed probe retains its actual destination');
  } finally {
    configurationHook.deregister();
    delete env.VITE_TAURI_REMOTE_API_BASE_URL;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await browser.happyDOM.abort();
  }
});

test('panel origins fail closed on a retired page and retain the actual local page origin', async () => {
  const browser = new Window({ url: 'https://CRYSTALBALL.APP./' });
  const keys = ['window', 'document', 'navigator', 'localStorage'] as const;
  const descriptors = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries({
    window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage,
  })) Object.defineProperty(globalThis, key, { value, configurable: true });
  try {
    const { LiveNewsPanel } = await import('../LiveNewsPanel');
    const { serviceBackendLabel } = await import('../ServiceStatusPanel');
    const originGetter = Object.getOwnPropertyDescriptor(LiveNewsPanel.prototype, 'embedOrigin')?.get;
    assert.ok(originGetter);
    assert.equal(originGetter.call({}), null);
    assert.equal(serviceBackendLabel(browser.location.origin), 'not configured');
    browser.happyDOM.setURL('http://localhost:3000/');
    assert.equal(originGetter.call({}), 'http://localhost:3000');
    assert.equal(serviceBackendLabel(browser.location.origin), 'localhost:3000');

    const targets: string[] = [];
    const post = (LiveNewsPanel.prototype as unknown as { postToEmbed(message: object): void }).postToEmbed;
    const frame = { contentWindow: { postMessage(_message: object, origin: string) { targets.push(origin); } } };
    post.call({ desktopEmbedIframe: frame, embedOrigin: null }, { type: 'pause' });
    assert.deepEqual(targets, []);
    post.call({ desktopEmbedIframe: frame, embedOrigin: 'http://localhost:3000' }, { type: 'pause' });
    assert.deepEqual(targets, ['http://localhost:3000']);
    assert.ok(!targets.includes('*'));
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await browser.happyDOM.abort();
  }
});
