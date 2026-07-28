import assert from 'node:assert/strict';
import test from 'node:test';

import { savedPlacesMatchSignature } from '../saved-place-adapter.ts';
import type { SavedPlace } from '../../saved-places.ts';

// ── savedPlacesMatchSignature: the TOCTOU guard for the personal-weather clear ─
// The severe-alert loop snapshots getSavedPlaces() BEFORE an async zone lookup
// and publishes the clear decision AFTER it. If the user adds/moves a place under
// a live warning during that window, the subscription revokes the confirmed clear
// — but this in-flight evaluation, still holding the stale place set, would
// re-confirm clear against a set that never saw the new place. Comparing this
// signature captured at snapshot against a fresh read at publish detects the
// change so the loop withholds the clear (routes to revoke_confirmation) instead.
//
// The signature must key on exactly the fields that affect MATCHING (id, lat,
// lon, radiusKm — everything toMatcherPlace carries), be order-independent (a
// reorder does not change the match SET), and ignore display-only fields (a name
// or notes edit must not trigger a spurious clear-withhold).

function place(partial: Partial<SavedPlace>): SavedPlace {
  return {
    id: 'p1',
    name: 'Home',
    lat: 41.6,
    lon: -86.7,
    radiusKm: 15,
    tags: [],
    priority: 0,
    notes: '',
    offlinePinned: false,
    primary: false,
    source: 'manual',
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as SavedPlace;
}

test('identical place sets produce equal signatures', () => {
  const a = [place({ id: 'p1' }), place({ id: 'p2', lat: 40, lon: -85 })];
  const b = [place({ id: 'p1' }), place({ id: 'p2', lat: 40, lon: -85 })];
  assert.equal(savedPlacesMatchSignature(a), savedPlacesMatchSignature(b));
});

test('adding a place changes the signature', () => {
  const before = [place({ id: 'p1' })];
  const after = [place({ id: 'p1' }), place({ id: 'p2', lat: 40, lon: -85 })];
  assert.notEqual(savedPlacesMatchSignature(before), savedPlacesMatchSignature(after));
});

test('removing a place changes the signature', () => {
  const before = [place({ id: 'p1' }), place({ id: 'p2', lat: 40, lon: -85 })];
  const after = [place({ id: 'p1' })];
  assert.notEqual(savedPlacesMatchSignature(before), savedPlacesMatchSignature(after));
});

test('moving a place (lat/lon) changes the signature', () => {
  const before = [place({ id: 'p1', lat: 41.6, lon: -86.7 })];
  const after = [place({ id: 'p1', lat: 44.0, lon: -80.0 })];
  assert.notEqual(savedPlacesMatchSignature(before), savedPlacesMatchSignature(after));
});

test('changing radiusKm changes the signature', () => {
  const before = [place({ id: 'p1', radiusKm: 15 })];
  const after = [place({ id: 'p1', radiusKm: 50 })];
  assert.notEqual(savedPlacesMatchSignature(before), savedPlacesMatchSignature(after));
});

test('reordering the same places does NOT change the signature', () => {
  const a = [place({ id: 'p1' }), place({ id: 'p2', lat: 40, lon: -85 })];
  const b = [place({ id: 'p2', lat: 40, lon: -85 }), place({ id: 'p1' })];
  assert.equal(savedPlacesMatchSignature(a), savedPlacesMatchSignature(b));
});

test('a display-only edit (name/notes/priority) does NOT change the signature', () => {
  const before = [place({ id: 'p1', name: 'Home', notes: '', priority: 0 })];
  const after = [place({ id: 'p1', name: 'Cabin', notes: 'lake house', priority: 9 })];
  assert.equal(savedPlacesMatchSignature(before), savedPlacesMatchSignature(after));
});

test('an empty place set is a stable, non-throwing signature', () => {
  assert.equal(savedPlacesMatchSignature([]), savedPlacesMatchSignature([]));
});
