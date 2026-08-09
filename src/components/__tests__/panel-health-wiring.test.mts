import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
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

const { Panel } = await import('../Panel.ts');
const { getPanelHealthRegistry, resetDiagnosticsState } = await import(
  '../../services/diagnostics/diagnostics-state.ts'
);

function settleRender(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

test('same-content refresh advances render freshness without claiming new data', async () => {
  resetDiagnosticsState();
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  const panel = new Panel({ id: 'health-wiring', title: 'Health wiring' });
  document.body.replaceChildren(panel.getElement());
  const registry = getPanelHealthRegistry();
  registry.setVisible('health-wiring', true);

  try {
    panel.setContent('<p>stable data</p>');
    await settleRender();
    assert.equal(registry.get('health-wiring')?.lastRenderAt, 1_000);
    assert.equal(registry.get('health-wiring')?.lastDataUpdateAt, 1_000);

    now = 2_000;
    panel.setContent('<p>stable data</p>');
    assert.equal(registry.get('health-wiring')?.lastRenderAt, 2_000);
    assert.equal(registry.get('health-wiring')?.lastDataUpdateAt, 1_000);
  } finally {
    panel.destroy();
    Date.now = originalNow;
  }
});

test('off-screen panel errors preserve visibility suppression', () => {
  resetDiagnosticsState();
  const panel = new Panel({ id: 'hidden-health-wiring', title: 'Hidden health wiring' });
  document.body.replaceChildren(panel.getElement());
  const registry = getPanelHealthRegistry();
  registry.setVisible('hidden-health-wiring', false);

  try {
    panel.showError('source failed');
    const health = registry.get('hidden-health-wiring');
    assert.equal(health?.visible, false);
    assert.equal(health?.status, 'unknown');
    assert.equal(health?.lastError, 'source failed');
  } finally {
    panel.destroy();
  }
});

test('same-content callback after destroy cannot remount the panel', async () => {
  resetDiagnosticsState();
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  const panel = new Panel({ id: 'destroyed-health-wiring', title: 'Destroyed health wiring' });
  document.body.replaceChildren(panel.getElement());
  const registry = getPanelHealthRegistry();
  registry.setVisible('destroyed-health-wiring', true);

  try {
    panel.setContent('<p>stable data</p>');
    await settleRender();
    panel.destroy();

    now = 2_000;
    panel.setContent('<p>stable data</p>');
    await settleRender();
    const health = registry.get('destroyed-health-wiring');
    assert.equal(health?.mounted, false);
    assert.equal(health?.lastRenderAt, 1_000);
  } finally {
    panel.destroy();
    Date.now = originalNow;
  }
});
