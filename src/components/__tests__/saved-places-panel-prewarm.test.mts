import assert from 'node:assert/strict';
import test from 'node:test';

import '../../../tests/panels/setup-dom.mts';
import '../../../tests/panels/register-hook.mjs';

import {
  addSavedPlace,
  getSavedPlaces,
  removeSavedPlace,
  type SavedPlace,
} from '../../services/saved-places.ts';

const { SavedPlacesPanel } = await import('../SavedPlacesPanel.ts');

test('prewarm announcements keep one stable live-region node across refreshes', () => {
  const panel = new SavedPlacesPanel({ focusPlace: () => {} });
  document.body.append(panel.getElement());
  const first = panel.getContentElement().querySelector('[aria-live="polite"]');
  assert.ok(first);

  panel.refresh();
  const second = panel.getContentElement().querySelector('[aria-live="polite"]');

  assert.ok(second === first, 'refresh should move the same live-region node');
  assert.equal(panel.getContentElement().querySelectorAll('[aria-live="polite"]').length, 1);
  panel.destroy();
});

test('pack chips use the exact resolved 10 km and active 50 km prewarm radii', () => {
  for (const saved of getSavedPlaces()) removeSavedPlace(saved.id);
  const initial = addSavedPlace({
    name: 'Initial Radius', lat: 41.6, lon: -86.7, radiusKm: 8, offlinePinned: true,
  });
  const explicit = addSavedPlace({
    name: 'Explicit Radius', lat: 42, lon: -87, radiusKm: 8, offlinePinned: true,
  });
  const requested: Array<{ placeId: string; radiusKm: number }> = [];
  const coordinator = {
    enqueue: () => {},
    retry: () => {},
    getState: (placeId: string) => placeId === explicit.id ? {
      placeId,
      radiusKm: 50,
      queryFingerprint: 'exact-50',
      phase: 'ready' as const,
      triggers: ['manual' as const],
      retryAt: null,
      error: null,
    } : null,
    subscribe: () => () => {},
    resolveRadius: (_place: SavedPlace) => 10,
    destroy: () => {},
  };
  const panel = new SavedPlacesPanel({
    focusPlace: () => {},
    prewarmCoordinator: coordinator,
    getExactPackReadiness: (place: SavedPlace, radiusKm: number) => {
      requested.push({ placeId: place.id, radiusKm });
      return { status: 'ready' };
    },
  } as never);
  document.body.append(panel.getElement());

  const content = panel.getContentElement();
  const initialCard = content.querySelector(`[data-saved-place-id="${initial.id}"]`)?.parentElement;
  const explicitCard = content.querySelector(`[data-saved-place-id="${explicit.id}"]`)?.parentElement;
  assert.match(initialCard?.textContent ?? '', /Lifelines Ready/);
  assert.match(explicitCard?.textContent ?? '', /Lifelines Ready/);
  assert.match(explicitCard?.textContent ?? '', /Lifelines ready for 50 km/);
  assert.doesNotMatch(content.textContent ?? '', /Lifelines Not Saved/);
  assert.deepEqual(requested, [
    { placeId: initial.id, radiusKm: 10 },
    { placeId: explicit.id, radiusKm: 50 },
  ]);

  panel.destroy();
  for (const saved of getSavedPlaces()) removeSavedPlace(saved.id);
});
