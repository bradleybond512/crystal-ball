import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis as unknown as Record<string, unknown>, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  Element: happyWindow.Element,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  KeyboardEvent: happyWindow.KeyboardEvent,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; },
});

const { SavedPlaceModal } = await import('../src/components/SavedPlaceModal.ts');
const { getSavedPlaces, removeSavedPlace } = await import('../src/services/saved-places.ts');

type ConfirmedPlace = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  primary: boolean;
  offlinePinned: boolean;
};

function requireOpenPrefilled(modal: InstanceType<typeof SavedPlaceModal>): (
  prefill: { latitude: number; longitude: number; radiusKm: number },
  onConfirmed: (place: ConfirmedPlace) => void,
) => void {
  const candidate = (modal as unknown as Record<string, unknown>).openCreatePrefilled;
  assert.equal(typeof candidate, 'function', 'SavedPlaceModal.openCreatePrefilled must exist');
  return (candidate as Function).bind(modal) as ReturnType<typeof requireOpenPrefilled>;
}

function active<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(`.modal-overlay.active ${selector}`);
  assert.ok(element, `${selector} should be rendered in the active modal`);
  return element;
}

function input(field: string, value: string): void {
  const element = active<HTMLInputElement>(`[data-field="${field}"]`);
  element.value = value;
  element.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
}

function radiusOptions(): string[] {
  return [...active<HTMLSelectElement>('[data-field="radius"]').options].map((option) => option.value);
}

beforeEach(() => {
  for (const place of getSavedPlaces()) removeSavedPlace(place.id);
  happyWindow.localStorage.clear();
  happyWindow.document.body.replaceChildren();
});

test('current-location prefill is memory-only, disclosed, and cancel clears it without a write', () => {
  const modal = new SavedPlaceModal({ onPickLocationMode: () => {} });
  const openPrefilled = requireOpenPrefilled(modal);
  openPrefilled({ latitude: 0, longitude: -78.8986, radiusKm: 10 }, () => {
    assert.fail('cancel must not confirm a saved place');
  });

  assert.equal(getSavedPlaces().length, 0);
  const text = active<HTMLElement>('.spm-modal').textContent ?? '';
  assert.match(text, /saving permits normal durable and cross-feature use/i);
  assert.match(text, /first saved place becomes primary/i);
  assert.match(text, /does not prepare an Emergency Pack/i);
  assert.equal(active<HTMLInputElement>('[data-field="lat"]').value, '0');
  assert.equal(active<HTMLInputElement>('[data-field="lon"]').value, '-78.8986');
  assert.equal(active<HTMLSelectElement>('[data-field="radius"]').value, '10');
  assert.deepEqual(radiusOptions(), ['5', '10', '25', '50', '250', '1000', '3000']);
  assert.equal(document.querySelector('[data-action="toggle-offline"]'), null);

  active<HTMLButtonElement>('[data-action="close"]').click();
  assert.equal(getSavedPlaces().length, 0);
  modal.openCreate();
  assert.equal(active<HTMLInputElement>('[data-field="lat"]').value, '');
  assert.equal(active<HTMLInputElement>('[data-field="lon"]').value, '');
  assert.ok(document.querySelector('[data-action="toggle-offline"]'), 'ordinary create mode stays unchanged');
});

test('ordinary create and edit keep the legacy alert-radius presets', () => {
  const modal = new SavedPlaceModal({ onPickLocationMode: () => {} });
  modal.openCreate();
  assert.deepEqual(radiusOptions(), ['50', '250', '1000', '3000']);

  modal.close();
  modal.openEdit({
    id: 'legacy-radius-place',
    name: 'Legacy radius',
    lat: 41,
    lon: -86,
    tags: [],
    radiusKm: 250,
    notes: '',
    primary: false,
    offlinePinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.deepEqual(radiusOptions(), ['50', '250', '1000', '3000']);
  assert.equal(active<HTMLSelectElement>('[data-field="radius"]').value, '250');
});

test('Add Place confirms exact readback before callback and first-place promotion is explicit', () => {
  const confirmations: ConfirmedPlace[] = [];
  const modal = new SavedPlaceModal({ onPickLocationMode: () => {} });
  const openPrefilled = requireOpenPrefilled(modal);
  openPrefilled(
    { latitude: 0, longitude: -78.8986, radiusKm: 10 },
    (place) => {
      const readback = getSavedPlaces().find((candidate: ConfirmedPlace) => candidate.id === place.id);
      assert.deepEqual(readback, place, 'callback must observe the exact durable readback');
      confirmations.push(place);
    },
  );
  input('name', 'Current area');
  assert.equal(confirmations.length, 0, 'prefill and form edits must not write');
  active<HTMLButtonElement>('[data-action="save"]').click();

  assert.equal(confirmations.length, 1);
  assert.deepEqual(
    {
      name: confirmations[0]?.name,
      lat: confirmations[0]?.lat,
      lon: confirmations[0]?.lon,
      radiusKm: confirmations[0]?.radiusKm,
      primary: confirmations[0]?.primary,
      offlinePinned: confirmations[0]?.offlinePinned,
    },
    { name: 'Current area', lat: 0, lon: -78.8986, radiusKm: 10, primary: true, offlinePinned: false },
  );
});

test('a later current-location save stays non-primary unless the user explicitly promotes it', () => {
  const firstModal = new SavedPlaceModal({ onPickLocationMode: () => {} });
  firstModal.openCreate();
  input('name', 'Existing primary');
  input('lat', '41');
  input('lon', '-86');
  active<HTMLButtonElement>('[data-action="save"]').click();

  let confirmed: ConfirmedPlace | null = null;
  const modal = new SavedPlaceModal({ onPickLocationMode: () => {} });
  requireOpenPrefilled(modal)(
    { latitude: 35.994, longitude: -78.8986, radiusKm: 25 },
    (place) => { confirmed = place; },
  );
  input('name', 'Second place');
  active<HTMLButtonElement>('[data-action="save"]').click();

  assert.equal(confirmed?.primary, false);
  assert.equal(getSavedPlaces().find((place: ConfirmedPlace) => place.name === 'Existing primary')?.primary, true);
});

test('persistence readback failure never confirms conversion', () => {
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota denied'); },
    removeItem: () => {},
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: failingStorage });
  let confirmations = 0;
  try {
    const modal = new SavedPlaceModal({ onPickLocationMode: () => {} });
    requireOpenPrefilled(modal)(
      { latitude: 35.994, longitude: -78.8986, radiusKm: 10 },
      () => { confirmations += 1; },
    );
    input('name', 'Unpersisted area');
    active<HTMLButtonElement>('[data-action="save"]').click();
    assert.equal(confirmations, 0);
    assert.equal(failingStorage.getItem(), null);
  } finally {
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
  }
});
