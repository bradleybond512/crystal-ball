import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eiaRegionForLatLon, resolveSiteConfig } from '../site-resolver.ts';
import type { SavedPlace } from '../../saved-places.ts';

function place(over: Partial<SavedPlace>): SavedPlace {
  return {
    id: 'p1', name: 'Site', lat: 41.6, lon: -86.7, radiusKm: 25, tags: ['data_center'],
    priority: 0, notes: '', offlinePinned: false, primary: false, source: 'manual',
    sortIndex: 0, createdAt: 0, updatedAt: 0, ...over,
  } as SavedPlace;
}

test('eiaRegionForLatLon maps Texas to ERCO and California to CISO', () => {
  assert.equal(eiaRegionForLatLon(31.0, -99.0), 'ERCO');   // central Texas
  assert.equal(eiaRegionForLatLon(37.0, -120.0), 'CISO');  // central California
});

test('eiaRegionForLatLon falls back to MISO for the central US', () => {
  assert.equal(eiaRegionForLatLon(41.6, -86.7), 'MISO');   // northern Indiana
});

test('resolveSiteConfig picks the data_center-tagged place', () => {
  const places = [place({ id: 'home', tags: ['home'] }), place({ id: 'dc', name: 'DC1', tags: ['data_center'] })];
  const site = resolveSiteConfig(places);
  assert.equal(site?.id, 'dc');
  assert.equal(site?.name, 'DC1');
  assert.equal(site?.eiaRegion, 'MISO');
});

test('resolveSiteConfig returns null when no place is tagged', () => {
  assert.equal(resolveSiteConfig([place({ tags: ['home'] })]), null);
});

test('resolveSiteConfig breaks ties by highest priority', () => {
  const places = [place({ id: 'a', priority: 1 }), place({ id: 'b', priority: 5 })];
  assert.equal(resolveSiteConfig(places)?.id, 'b');
});
