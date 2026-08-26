import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

const happyWindow = new Window({ url: 'https://crystalball.app/' });
const globals = globalThis as unknown as Record<string, unknown>;
Object.assign(globals, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IntersectionObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
  ResizeObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
globals.matchMedia = happyWindow.matchMedia.bind(happyWindow);

const { UcdpEventsPanel } = await import('../UcdpEventsPanel.ts');

test('web construction resolves to a static desktop-required state', () => {
  const panel = new UcdpEventsPanel();
  try {
    const content = panel.getContentElement();
    assert.match(content.textContent, /desktop app/i);
    assert.equal(content.querySelector('.panel-loading-radar'), null);
    assert.equal(content.querySelector('.config-error-settings-btn'), null);
  } finally {
    panel.destroy();
  }
});

test('desktop construction without a UCDP token resolves to actionable configuration', () => {
  Object.defineProperty(happyWindow, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  const panel = new UcdpEventsPanel();
  try {
    const content = panel.getContentElement();
    assert.match(content.textContent, /UCDP API token/i);
    assert.equal(content.querySelector('.panel-loading-radar'), null);
    assert.match(content.querySelector('.config-error-settings-btn')?.textContent ?? '', /settings/i);
  } finally {
    panel.destroy();
    delete (happyWindow as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
});
