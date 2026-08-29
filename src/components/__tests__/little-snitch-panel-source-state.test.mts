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
  MutationObserver: happyWindow.MutationObserver,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
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

const [{ LittleSnitchPanel }, { sanitizeLittleSnitchSnapshot }] = await Promise.all([
  import('../LittleSnitchPanel.ts'),
  import('../../services/little-snitch.ts'),
]);

const NOW_ISO = new Date().toISOString();

async function render(input: Record<string, unknown>): Promise<{ text: string; html: string }> {
  const panel = new LittleSnitchPanel();
  document.body.replaceChildren(panel.getElement());
  panel.update(sanitizeLittleSnitchSnapshot(input));
  await new Promise(resolve => setTimeout(resolve, 175));
  const text = panel.getElement().textContent ?? '';
  const html = panel.getContentElement().innerHTML;
  panel.destroy();
  return { text: text.replace(/\s+/g, ' ').trim(), html };
}

test('missing source gives setup guidance', async () => {
  const { text, html } = await render({ state: 'missing', error: '<img src=x onerror=alert(1)>' });

  assert.match(text, /export is not configured/i);
  assert.match(text, /setup/i);
  assert.doesNotMatch(html, /<img\b/i);
});

test('stale source identifies exporter health and suppresses old destinations', async () => {
  const { text } = await render({
    state: 'stale',
    generatedAt: '2020-01-01T00:00:00.000Z',
    entries: [{ app: 'Safari', remoteHost: 'old.example' }],
  });

  assert.match(text, /export is stale/i);
  assert.match(text, /exporter/i);
  assert.doesNotMatch(text, /old\.example/);
});

test('invalid and permission-denied states provide distinct repair guidance', async () => {
  const { text: invalid } = await render({ state: 'invalid' });
  const { text: denied } = await render({ state: 'permission-denied' });

  assert.match(invalid, /export is invalid/i);
  assert.match(invalid, /repair/i);
  assert.match(denied, /cannot be read/i);
  assert.match(denied, /permissions/i);
  assert.notEqual(invalid, denied);
});

test('healthy empty source is not reported as unavailable', async () => {
  const { text } = await render({ state: 'empty', generatedAt: NOW_ISO, entries: [] });

  assert.match(text, /exporter is healthy/i);
  assert.match(text, /No connections were recorded/i);
  assert.doesNotMatch(text, /not available/i);
});

test('ready source still renders bounded traffic rows', async () => {
  const { text } = await render({
    state: 'ready',
    generatedAt: NOW_ISO,
    entries: [{ app: 'Safari', remoteHost: 'example.com', count: 2 }],
  });

  assert.match(text, /Safari/);
  assert.match(text, /example\.com/);
});
