import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCountyPowerDisclosure,
  buildDeviceConnectivityDisclosure,
} from '../src/components/comms-lifeline-context.ts';
import type { LocalLogisticsSnapshot } from '../src/services/local-logistics-types.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');

function snapshot(customersOut: number, expiresAt = NOW + 30 * 60_000): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: 'exact',
    placeId: 'home',
    placeName: 'Home',
    effectiveRadiusKm: 25,
    countyFips: '18091',
    categories: [],
    sites: [],
    observations: [],
    nodes: [],
    areaConditions: [{
      id: 'odin:18091:utility',
      type: 'power_outage',
      coverage: 'reported',
      countyFips: '18091',
      county: 'LaPorte',
      state: 'Indiana',
      customersOut,
      observedAt: new Date(NOW),
      retrievedAt: new Date(NOW),
      expiresAt: new Date(expiresAt),
      source: 'ornl-odin',
    }],
    providers: [{
      id: 'ornl-odin',
      state: 'ok',
      acceptedRows: 1,
      droppedRows: 0,
      observedAt: new Date(NOW),
      retrievedAt: new Date(NOW),
    }],
    fetchedAt: new Date(NOW),
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
  };
}

test('device connectivity is narrowly disclosed and never presented as carrier coverage', () => {
  const online = buildDeviceConnectivityDisclosure(true);
  assert.equal(online.knowledge, 'device-only');
  assert.match(online.detail, /cellular.*remain unverified/i);
  const offline = buildDeviceConnectivityDisclosure(false);
  assert.match(offline.detail, /other devices or carriers/i);
});

test('county power context preserves reported zero and never infers communications status', () => {
  const zero = buildCountyPowerDisclosure(snapshot(0), NOW + 60_000);
  assert.equal(zero.knowledge, 'reported');
  assert.match(zero.detail, /^0 customers reported out/);
  assert.match(zero.detail, /communications remain unverified/i);
});

test('missing or expired county evidence remains unknown rather than an all-clear', () => {
  assert.equal(buildCountyPowerDisclosure(null, NOW).knowledge, 'unknown');
  const expired = buildCountyPowerDisclosure(snapshot(25, NOW), NOW);
  assert.equal(expired.knowledge, 'unknown');
  assert.match(expired.detail, /does not mean power or communications are on/i);
});
