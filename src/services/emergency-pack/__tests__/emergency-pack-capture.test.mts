import assert from 'node:assert/strict';
import test from 'node:test';

import { NOW, PLACE_ID, PROFILE, requireFunction } from './test-support.mts';

interface ValidationResult {
  ok: boolean;
  itemCount: number;
  semanticState: string;
  reason?: string;
}

interface CaptureApi {
  validateEmergencyPackArtifact?: (input: {
    kind: string;
    placeId: string;
    profileFingerprint: string;
    byteLength: number;
    capturedAt: number;
    payload: unknown;
  }) => ValidationResult;
}

const api = await import('../emergency-pack-capture.ts').catch(() => ({} as CaptureApi)) as CaptureApi;

function validate(kind: string, payload: unknown, byteLength = JSON.stringify(payload).length): ValidationResult {
  const fn = requireFunction(api, 'validateEmergencyPackArtifact');
  return fn({ kind, placeId: PLACE_ID, profileFingerprint: PROFILE, byteLength, capturedAt: NOW, payload });
}

test('alerts are scoped and bounded, and an exact zero-alert capture does not imply coverage', () => {
  const empty = validate('alerts', {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    alerts: [],
    sourceFetchedAt: NOW - 60_000,
  });
  assert.deepEqual(empty, {
    ok: true,
    itemCount: 0,
    semanticState: 'verified-empty',
    reason: 'coverage-not-inferred',
  });
  assert.equal(validate('alerts', {
    placeId: 'other', profileFingerprint: PROFILE, alerts: [], sourceFetchedAt: NOW,
  }).ok, false);
  assert.equal(validate('alerts', {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    alerts: Array.from({ length: 101 }, (_, id) => ({ id })),
    sourceFetchedAt: NOW,
  }).ok, false);
  assert.equal(validate('alerts', { alerts: [] }, 256 * 1024 + 1).ok, false);
});

test('route capture enforces exact endpoints, 5,000 coordinates, 1,000 steps, and 512 KiB', () => {
  const route = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    from: { lat: 41.6111, lon: -86.7225 },
    to: { lat: 41.7, lon: -86.8 },
    geometry: { type: 'LineString', coordinates: [[-86.7225, 41.6111], [-86.8, 41.7]] },
    steps: [{ instruction: 'Depart', distanceKm: 1, durationMinutes: 2 }],
    cachedAt: NOW - 60_000,
  };
  assert.equal(validate('route-primary', route).ok, true);
  assert.equal(validate('route-primary', {
    ...route,
    geometry: { type: 'LineString', coordinates: Array.from({ length: 5_001 }, () => [-86.7, 41.6]) },
  }).ok, false);
  assert.equal(validate('route-primary', {
    ...route,
    steps: Array.from({ length: 1_001 }, () => route.steps[0]),
  }).ok, false);
  assert.equal(validate('route-primary', route, 512 * 1024 + 1).ok, false);
});

test('offline map receipts require every successful tile readback within per-tile and pack limits', () => {
  const tiles = [{ url: 'https://a.basemaps.cartocdn.com/dark_all/8/66/95@2x.png', byteLength: 32_000, verified: true }];
  assert.equal(validate('offline-map', {
    placeId: PLACE_ID, profileFingerprint: PROFILE, tiles, totalBytes: 32_000,
  }).ok, true);
  assert.equal(validate('offline-map', {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    tiles: Array.from({ length: 513 }, (_, index) => ({ url: `https://tiles/${index}`, byteLength: 1, verified: true })),
    totalBytes: 513,
  }).ok, false);
  assert.equal(validate('offline-map', {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    tiles: [{ ...tiles[0], byteLength: 1024 * 1024 + 1 }],
    totalBytes: 1024 * 1024 + 1,
  }).ok, false);
  assert.equal(validate('offline-map', {
    placeId: PLACE_ID, profileFingerprint: PROFILE, tiles: [{ ...tiles[0], verified: false }], totalBytes: 32_000,
  }).ok, false);
  assert.equal(validate('offline-map', {
    placeId: PLACE_ID, profileFingerprint: PROFILE, tiles, totalBytes: 50 * 1024 * 1024 + 1,
  }).ok, false);
});

test('comms and contacts require explicit consent, a selected contact, and bounded private content', () => {
  const payload = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    consent: true,
    selectedContactIds: ['contact-1'],
    contacts: [{ id: 'contact-1', label: 'Family', value: '+15555550100', role: 'check-in' }],
    fallbackSteps: [{ id: 'sms', label: 'SMS', kind: 'sms', instruction: 'Send status', priority: 1 }],
    checkInWindows: [{ id: 'hourly', label: 'Hourly', cadenceMinutes: 60, note: '' }],
    notes: '',
  };
  assert.equal(validate('contacts', payload).ok, true);
  assert.equal(validate('comms-plan', payload).ok, true);
  assert.equal(validate('contacts', { ...payload, consent: false }).ok, false);
  assert.equal(validate('contacts', { ...payload, selectedContactIds: [] }).ok, false);
  assert.equal(validate('contacts', {
    ...payload,
    contacts: Array.from({ length: 26 }, (_, id) => ({ id: String(id), label: 'Contact', value: '555', role: '' })),
  }).ok, false);
  assert.equal(validate('comms-plan', {
    ...payload, fallbackSteps: Array.from({ length: 33 }, () => payload.fallbackSteps[0]),
  }).ok, false);
  assert.equal(validate('comms-plan', {
    ...payload, checkInWindows: Array.from({ length: 17 }, () => payload.checkInWindows[0]),
  }).ok, false);
  assert.equal(validate('comms-plan', payload, 128 * 1024 + 1).ok, false);
});

test('Lifelines evidence is exact-profile and capped at 1 MiB', () => {
  const payload = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    snapshot: { schemaVersion: 2, sites: [], observations: [], providers: [] },
  };
  assert.equal(validate('lifelines', payload).ok, true);
  assert.equal(validate('lifelines', { ...payload, profileFingerprint: `${PROFILE}:old` }).ok, false);
  assert.equal(validate('lifelines', payload, 1024 * 1024 + 1).ok, false);
});
