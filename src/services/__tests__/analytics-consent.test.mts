import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

// Stubs must be set BEFORE the module is imported.

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

// Stub window so runtime-config.ts and mode-manager can import without crashing.
(globalThis as unknown as { window: Record<string, unknown> }).window = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
};

// Stub document so mode-manager's dispatchEvent call doesn't throw.
(globalThis as unknown as { document: Record<string, unknown> }).document = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
};

const {
  hasAnalyticsConsent,
  isAnalyticsAllowed,
  setAnalyticsConsent,
  trackApiKeysSnapshot,
  _setPosthogForTest,
} = await import('../analytics.ts');

// mode-manager is a peer module — import it so we can flip ghost mode.
const { setMode } = await import('../mode-manager.ts');

const CONSENT_KEY = 'wm-analytics-consent';
const OFFLINE_KEY = 'wm-analytics-offline-queue';

describe('analytics consent — default-off', () => {
  beforeEach(() => {
    store.clear();
    setMode(null);
    _setPosthogForTest(null);
  });

  it('absent consent ⇒ hasAnalyticsConsent false', () => {
    assert.equal(hasAnalyticsConsent(), false);
  });

  it('stored "true" ⇒ hasAnalyticsConsent true', () => {
    store.set(CONSENT_KEY, 'true');
    assert.equal(hasAnalyticsConsent(), true);
  });

  it('stored "false" ⇒ hasAnalyticsConsent false', () => {
    store.set(CONSENT_KEY, 'false');
    assert.equal(hasAnalyticsConsent(), false);
  });
});

describe('isAnalyticsAllowed', () => {
  beforeEach(() => {
    store.clear();
    setMode(null);
    _setPosthogForTest(null);
  });

  it('absent consent ⇒ false', () => {
    assert.equal(isAnalyticsAllowed(), false);
  });

  it('consent granted, no ghost mode ⇒ true', () => {
    store.set(CONSENT_KEY, 'true');
    assert.equal(isAnalyticsAllowed(), true);
  });

  it('consent granted + ghost mode ⇒ false', () => {
    store.set(CONSENT_KEY, 'true');
    setMode('ghost');
    assert.equal(isAnalyticsAllowed(), false);
  });
});

describe('setAnalyticsConsent revocation', () => {
  beforeEach(() => {
    store.clear();
    setMode(null);
    _setPosthogForTest(null);
  });

  it('revoking consent clears the offline queue', () => {
    store.set(CONSENT_KEY, 'true');
    store.set(OFFLINE_KEY, JSON.stringify([{ name: 'wm_app_loaded', props: {}, ts: 1 }]));
    setAnalyticsConsent(false);
    assert.equal(store.has(OFFLINE_KEY), false);
  });

  it('revoking consent removes installation ID', () => {
    store.set(CONSENT_KEY, 'true');
    store.set('wm-installation-id', 'test-uuid');
    setAnalyticsConsent(false);
    assert.equal(store.has('wm-installation-id'), false);
  });

  it('revoking consent ⇒ isAnalyticsAllowed false', () => {
    store.set(CONSENT_KEY, 'true');
    setAnalyticsConsent(false);
    assert.equal(isAnalyticsAllowed(), false);
  });
});

describe('wm_api_keys_configured payload minimization', () => {
  beforeEach(() => {
    store.clear();
    setMode(null);
  });

  it('sends only configured_key_count — no key names, no OLLAMA_MODEL', () => {
    store.set(CONSENT_KEY, 'true');

    const captured: Array<{ event: string; props: Record<string, unknown> }> = [];
    _setPosthogForTest({
      init: () => undefined,
      register: () => undefined,
      capture: (event, props) => captured.push({ event, props: props ?? {} }),
      opt_out_capturing: () => undefined,
    });

    trackApiKeysSnapshot();

    const call = captured.find(c => c.event === 'wm_api_keys_configured');
    assert.ok(call, 'wm_api_keys_configured was captured');
    const keys = Object.keys(call!.props);
    assert.ok(keys.includes('configured_key_count'), 'must include configured_key_count');
    // No per-key booleans or OLLAMA_MODEL value
    const forbidden = keys.filter(k => k.startsWith('has_') || k === 'ollama_model' || k === 'OLLAMA_MODEL');
    assert.deepEqual(forbidden, [], 'no per-key names or OLLAMA_MODEL in payload');
    assert.equal(keys.length, 1, 'exactly one property in payload');
  });
});
