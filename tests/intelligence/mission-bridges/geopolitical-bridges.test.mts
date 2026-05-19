/**
 * Tests for geopolitical mission bridges (ACLED / OFAC / GDELT).
 *
 * Pure module — no DOM, no fetch. Run with:
 *   tsx --test tests/intelligence/mission-bridges/geopolitical-bridges.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

import {
  ACLEDConflictBridge,
  OFACSanctionsBridge,
  GDELTEventBridge,
  registerGeopoliticalBridges,
} from '../../../src/services/intelligence/mission-bridges/geopolitical-bridges.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

const NOW = 1_748_000_000_000;

function acledRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'acl-001', event_type: 'battle', fatalities: 5, notes: 'skirmish', timestamp: NOW, ...overrides };
}

function ofacRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'ofac-001', entity_type: 'country', name: 'Test Country', timestamp: NOW, ...overrides };
}

function gdeltRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'gdelt-001', goldstein_scale: -5.0, actor1: 'Country A', actor2: 'Country B', timestamp: NOW, ...overrides };
}

// ── MissionBridgeRegistry basics ──────────────────────────────────────────

test('registry: register and get a bridge by domain+feedId', () => {
  __resetMissionBridgeRegistry();
  const bridge = new ACLEDConflictBridge();
  getMissionBridgeRegistry().register(bridge);
  const found = getMissionBridgeRegistry().get('geopolitical', 'acled-conflict');
  assert.ok(found !== undefined);
  assert.equal(found.feedId, 'acled-conflict');
});

test('registry: has() returns true for registered bridge', () => {
  __resetMissionBridgeRegistry();
  const bridge = new OFACSanctionsBridge();
  getMissionBridgeRegistry().register(bridge);
  assert.equal(getMissionBridgeRegistry().has('geopolitical', 'ofac-sdn'), true);
});

test('registry: has() returns false for unregistered bridge', () => {
  __resetMissionBridgeRegistry();
  assert.equal(getMissionBridgeRegistry().has('geopolitical', 'nonexistent-feed'), false);
});

test('registry: all() returns all registered bridges', () => {
  __resetMissionBridgeRegistry();
  getMissionBridgeRegistry().register(new ACLEDConflictBridge());
  getMissionBridgeRegistry().register(new OFACSanctionsBridge());
  getMissionBridgeRegistry().register(new GDELTEventBridge());
  assert.equal(getMissionBridgeRegistry().all().length, 3);
});

test('registry: getByDomain() returns only bridges for that domain', () => {
  __resetMissionBridgeRegistry();
  getMissionBridgeRegistry().register(new ACLEDConflictBridge());
  getMissionBridgeRegistry().register(new OFACSanctionsBridge());
  getMissionBridgeRegistry().register(new GDELTEventBridge());
  const geo = getMissionBridgeRegistry().getByDomain('geopolitical');
  assert.equal(geo.length, 3);
  assert.ok(geo.every(b => b.domain === 'geopolitical'));
});

test('registry: getByDomain() returns empty array for unknown domain', () => {
  __resetMissionBridgeRegistry();
  assert.deepEqual(getMissionBridgeRegistry().getByDomain('unknown-domain'), []);
});

test('registry: __resetMissionBridgeRegistry clears all entries', () => {
  getMissionBridgeRegistry().register(new ACLEDConflictBridge());
  __resetMissionBridgeRegistry();
  assert.equal(getMissionBridgeRegistry().all().length, 0);
});

// ── Auto-registration at module load ─────────────────────────────────────

test('auto-registration: registerGeopoliticalBridges registers all three', () => {
  __resetMissionBridgeRegistry();
  registerGeopoliticalBridges();
  const geo = getMissionBridgeRegistry().getByDomain('geopolitical');
  assert.equal(geo.length, 3);
});

test('auto-registration: acled-conflict is registered after registerGeopoliticalBridges', () => {
  __resetMissionBridgeRegistry();
  registerGeopoliticalBridges();
  assert.equal(getMissionBridgeRegistry().has('geopolitical', 'acled-conflict'), true);
});

test('auto-registration: ofac-sdn is registered after registerGeopoliticalBridges', () => {
  __resetMissionBridgeRegistry();
  registerGeopoliticalBridges();
  assert.equal(getMissionBridgeRegistry().has('geopolitical', 'ofac-sdn'), true);
});

test('auto-registration: gdelt-events is registered after registerGeopoliticalBridges', () => {
  __resetMissionBridgeRegistry();
  registerGeopoliticalBridges();
  assert.equal(getMissionBridgeRegistry().has('geopolitical', 'gdelt-events'), true);
});

// ── ACLEDConflictBridge ───────────────────────────────────────────────────

test('ACLED: domain is geopolitical', () => {
  assert.equal(new ACLEDConflictBridge().domain, 'geopolitical');
});

test('ACLED: feedId is acled-conflict', () => {
  assert.equal(new ACLEDConflictBridge().feedId, 'acled-conflict');
});

test('ACLED: battle event_type → base severity 3', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'battle', fatalities: 0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 3);
});

test('ACLED: explosion event_type → base severity 2', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'explosion', fatalities: 0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 2);
});

test('ACLED: protest event_type → base severity 1', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'protest', fatalities: 0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 1);
});

test('ACLED: unknown event_type → base severity 1', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'riot', fatalities: 0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 1);
});

test('ACLED: fatalities > 100 adds +1 to severity', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'explosion', fatalities: 101 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 3);
});

test('ACLED: fatalities exactly 100 does not add +1', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'explosion', fatalities: 100 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 2);
});

test('ACLED: fatalities < 100 does not add +1', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'battle', fatalities: 50 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 3);
});

test('ACLED: severity capped at 4 (battle + >100 fatalities)', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ event_type: 'battle', fatalities: 200 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 4);
});

test('ACLED: result has raw field with original data', () => {
  const raw = acledRaw({ event_type: 'battle', fatalities: 5 });
  const result = new ACLEDConflictBridge().normalize(raw);
  assert.ok(result !== null);
  assert.deepEqual(result!.raw, raw);
});

test('ACLED: result has id from raw', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw({ id: 'my-id-42' }));
  assert.ok(result !== null);
  assert.equal(result!.id, 'my-id-42');
});

test('ACLED: result has non-empty description', () => {
  const result = new ACLEDConflictBridge().normalize(acledRaw());
  assert.ok(result !== null);
  assert.ok(typeof result!.description === 'string' && result!.description.length > 0);
});

// ── OFACSanctionsBridge ───────────────────────────────────────────────────

test('OFAC: domain is geopolitical', () => {
  assert.equal(new OFACSanctionsBridge().domain, 'geopolitical');
});

test('OFAC: feedId is ofac-sdn', () => {
  assert.equal(new OFACSanctionsBridge().feedId, 'ofac-sdn');
});

test('OFAC: country entity_type → severity 3', () => {
  const result = new OFACSanctionsBridge().normalize(ofacRaw({ entity_type: 'country' }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 3);
});

test('OFAC: organization entity_type → severity 2', () => {
  const result = new OFACSanctionsBridge().normalize(ofacRaw({ entity_type: 'organization' }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 2);
});

test('OFAC: individual entity_type → severity 1', () => {
  const result = new OFACSanctionsBridge().normalize(ofacRaw({ entity_type: 'individual' }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 1);
});

test('OFAC: unknown entity_type → severity 1', () => {
  const result = new OFACSanctionsBridge().normalize(ofacRaw({ entity_type: 'vessel' }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 1);
});

test('OFAC: result has raw field with original data', () => {
  const raw = ofacRaw({ entity_type: 'country' });
  const result = new OFACSanctionsBridge().normalize(raw);
  assert.ok(result !== null);
  assert.deepEqual(result!.raw, raw);
});

test('OFAC: result has id from raw', () => {
  const result = new OFACSanctionsBridge().normalize(ofacRaw({ id: 'ofac-99' }));
  assert.ok(result !== null);
  assert.equal(result!.id, 'ofac-99');
});

// ── GDELTEventBridge ──────────────────────────────────────────────────────

test('GDELT: domain is geopolitical', () => {
  assert.equal(new GDELTEventBridge().domain, 'geopolitical');
});

test('GDELT: feedId is gdelt-events', () => {
  assert.equal(new GDELTEventBridge().feedId, 'gdelt-events');
});

test('GDELT: goldstein_scale < -7 → severity 4', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: -8.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 4);
});

test('GDELT: goldstein_scale exactly -7 → severity 3 (not < -7)', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: -7.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 3);
});

test('GDELT: goldstein_scale < -4 (and >= -7) → severity 3', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: -5.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 3);
});

test('GDELT: goldstein_scale exactly -4 → severity 2 (not < -4)', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: -4.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 2);
});

test('GDELT: goldstein_scale < 0 (and >= -4) → severity 2', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: -1.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 2);
});

test('GDELT: goldstein_scale exactly 0 → severity 1 (not < 0)', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: 0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 1);
});

test('GDELT: goldstein_scale < 3 (and >= 0) → severity 1', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: 2.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 1);
});

test('GDELT: goldstein_scale exactly 3 → severity 0 (not < 3)', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: 3.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 0);
});

test('GDELT: goldstein_scale >= 3 → severity 0', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ goldstein_scale: 7.0 }));
  assert.ok(result !== null);
  assert.equal(result!.severity, 0);
});

test('GDELT: result has raw field with original data', () => {
  const raw = gdeltRaw({ goldstein_scale: -5.0 });
  const result = new GDELTEventBridge().normalize(raw);
  assert.ok(result !== null);
  assert.deepEqual(result!.raw, raw);
});

test('GDELT: result has id from raw', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw({ id: 'gdelt-777' }));
  assert.ok(result !== null);
  assert.equal(result!.id, 'gdelt-777');
});

test('GDELT: result has non-empty description', () => {
  const result = new GDELTEventBridge().normalize(gdeltRaw());
  assert.ok(result !== null);
  assert.ok(typeof result!.description === 'string' && result!.description.length > 0);
});
