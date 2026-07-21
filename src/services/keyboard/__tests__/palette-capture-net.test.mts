import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.KeyboardEvent = happyWindow.KeyboardEvent;
G.CustomEvent = happyWindow.CustomEvent;
G.Event = happyWindow.Event;
G.Element = happyWindow.Element;

const { paletteCaptureNet } = await import('../shortcut-bootstrap.ts');

function countToggles(run: () => void): number {
  let n = 0;
  const spy = (): void => { n += 1; };
  document.addEventListener('cb:toggle-cmdk', spy);
  run();
  document.removeEventListener('cb:toggle-cmdk', spy);
  return n;
}

function keyEvent(over: Record<string, unknown>): KeyboardEvent {
  return new (happyWindow.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { bubbles: true, cancelable: true, ...over });
}

test('paletteCaptureNet: ⌘K dispatches the palette toggle exactly once', () => {
  assert.equal(countToggles(() => paletteCaptureNet(keyEvent({ key: 'k', metaKey: true }))), 1);
});

test('paletteCaptureNet: uppercase K (caps/shift) still opens it', () => {
  assert.equal(countToggles(() => paletteCaptureNet(keyEvent({ key: 'K', metaKey: true }))), 1);
});

test('paletteCaptureNet: preventDefault + stopImmediatePropagation so the bubble listener cannot double-toggle', () => {
  const e = keyEvent({ key: 'k', metaKey: true });
  paletteCaptureNet(e);
  assert.equal(e.defaultPrevented, true);
});

test('paletteCaptureNet: plain K (no meta) is ignored', () => {
  assert.equal(countToggles(() => paletteCaptureNet(keyEvent({ key: 'k' }))), 0);
});

test('paletteCaptureNet: Ctrl+K / Alt+K are not the mac palette shortcut', () => {
  assert.equal(countToggles(() => paletteCaptureNet(keyEvent({ key: 'k', ctrlKey: true }))), 0);
  assert.equal(countToggles(() => paletteCaptureNet(keyEvent({ key: 'k', metaKey: true, altKey: true }))), 0);
});

test('paletteCaptureNet: suppressed while typing in an input', () => {
  const input = document.createElement('input');
  const e = keyEvent({ key: 'k', metaKey: true });
  Object.defineProperty(e, 'target', { value: input });
  assert.equal(countToggles(() => paletteCaptureNet(e)), 0);
});
