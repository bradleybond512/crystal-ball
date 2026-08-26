import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'https://crystalball.app/' });
const globals = globalThis as unknown as Record<string, unknown>;
Object.assign(globals, {
  window: happyWindow,
  document: happyWindow.document,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });

const { RUNTIME_FEATURES, isFeatureAvailable } = await import('../runtime-config.ts');

test('UCDP is unavailable in the web runtime even before the vault is unlocked', () => {
  assert.equal(isFeatureAvailable('ucdpEvents'), false);
});

test('UCDP desktop readiness requires a configured API token', () => {
  Object.defineProperty(happyWindow, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  try {
    assert.equal(isFeatureAvailable('ucdpEvents'), false);
    const feature = RUNTIME_FEATURES.find(({ id }) => id === 'ucdpEvents');
    assert.equal(feature?.desktopOnly, true);
    assert.deepEqual(feature?.requiredSecrets, []);
    assert.deepEqual(feature?.desktopRequiredSecrets, ['UCDP_API_TOKEN']);
  } finally {
    delete (happyWindow as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
});
