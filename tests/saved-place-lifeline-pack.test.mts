import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;
Object.assign(globals, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  Element: happyWindow.Element,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  },
});

const { SavedPlaceModal } = await import('../src/components/SavedPlaceModal.ts');
const { getSavedPlaces } = await import('../src/services/saved-places.ts');

function input(field: string, value: string): void {
  const element = happyWindow.document.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
  assert.ok(element, `missing ${field} input`);
  element.value = value;
  element.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
}

test('saved-place Emergency Pack control persists offlinePinned only after explicit selection', () => {
  const modal = new SavedPlaceModal({ onPickLocationMode: () => {} });
  modal.openCreate();

  const offlineButton = happyWindow.document.querySelector<HTMLButtonElement>('[data-action="toggle-offline"]');
  assert.ok(offlineButton);
  assert.equal(offlineButton.getAttribute('aria-pressed'), 'false');

  input('name', 'Home');
  input('lat', '41.6111junk');
  input('lon', '-86.7225');
  offlineButton.click();
  assert.equal(offlineButton.getAttribute('aria-pressed'), 'true');

  const saveButton = happyWindow.document.querySelector<HTMLButtonElement>('[data-action="save"]');
  assert.ok(saveButton);
  saveButton.click();
  assert.equal(getSavedPlaces().length, 0, 'partial numeric coordinates must be rejected');

  input('lat', '41.6111');
  saveButton.click();

  const saved = getSavedPlaces();
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.name, 'Home');
  assert.equal(saved[0]?.offlinePinned, true);
});
