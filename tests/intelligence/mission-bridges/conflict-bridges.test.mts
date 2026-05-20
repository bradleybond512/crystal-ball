/**
 * Tests for conflict domain mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - ACLEDFatalityBridge.normalize() — fatality tiers + event-type floor
 *   - ArmedGroupMovementBridge.normalize() — all movement type severity levels
 *   - CeasefireViolationBridge.normalize() — all weaponry severity levels
 *   - Null guard: missing or empty id returns null
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/conflict-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACLEDFatalityBridge,
  ArmedGroupMovementBridge,
  CeasefireViolationBridge,
} from '../../../src/services/intelligence/mission-bridges/conflict-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration ─────────────────────────────────────────────────

test('importing conflict-bridges registers ACLEDFatalityBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('conflict', 'acled-fatalities'));
});

test('importing conflict-bridges registers ArmedGroupMovementBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('conflict', 'armed-group-movements'));
});

test('importing conflict-bridges registers CeasefireViolationBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('conflict', 'ceasefire-violations'));
});

test('all conflict bridges retrievable by domain', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('conflict');
  assert.equal(bridges.length, 3);
});

// ── ACLEDFatalityBridge — properties ─────────────────────────────────

const fatalityBridge = new ACLEDFatalityBridge();

test('ACLEDFatalityBridge.domain is conflict', () => {
  assert.equal(fatalityBridge.domain, 'conflict');
});

test('ACLEDFatalityBridge.feedId is acled-fatalities', () => {
  assert.equal(fatalityBridge.feedId, 'acled-fatalities');
});

// ── ACLEDFatalityBridge — fatality thresholds ────────────────────────

test('ACLEDFatalityBridge: 100 fatalities → severity 4 (mass casualty)', () => {
  const r = fatalityBridge.normalize({ id: 'acl1', fatalities: 100, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ACLEDFatalityBridge: 250 fatalities → severity 4', () => {
  const r = fatalityBridge.normalize({ id: 'acl2', fatalities: 250, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ACLEDFatalityBridge: 25 fatalities → severity 3 (major)', () => {
  const r = fatalityBridge.normalize({ id: 'acl3', fatalities: 25, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('ACLEDFatalityBridge: 99 fatalities → severity 3 (below 100)', () => {
  const r = fatalityBridge.normalize({ id: 'acl4', fatalities: 99, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('ACLEDFatalityBridge: 5 fatalities → severity 2 (significant)', () => {
  const r = fatalityBridge.normalize({ id: 'acl5', fatalities: 5, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: 24 fatalities → severity 2 (below 25)', () => {
  const r = fatalityBridge.normalize({ id: 'acl6', fatalities: 24, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: 1 fatality → severity 1 (minor)', () => {
  const r = fatalityBridge.normalize({ id: 'acl7', fatalities: 1, eventType: 'riots', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ACLEDFatalityBridge: 4 fatalities → severity 1 (below 5)', () => {
  const r = fatalityBridge.normalize({ id: 'acl8', fatalities: 4, eventType: 'riots', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ACLEDFatalityBridge: 0 fatalities with protests type → severity 0', () => {
  const r = fatalityBridge.normalize({ id: 'acl9', fatalities: 0, eventType: 'protests', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

// ── ACLEDFatalityBridge — event-type floor ───────────────────────────

test('ACLEDFatalityBridge: 0 fatalities + battles → floor raises to 2', () => {
  const r = fatalityBridge.normalize({ id: 'acl10', fatalities: 0, eventType: 'battles', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: 0 fatalities + explosions/remote violence → floor 2', () => {
  const r = fatalityBridge.normalize({ id: 'acl11', fatalities: 0, eventType: 'explosions/remote violence', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: 0 fatalities + violence against civilians → floor 2', () => {
  const r = fatalityBridge.normalize({ id: 'acl12', fatalities: 0, eventType: 'violence against civilians', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: 0 fatalities + riots → floor raises to 1', () => {
  const r = fatalityBridge.normalize({ id: 'acl13', fatalities: 0, eventType: 'riots', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ACLEDFatalityBridge: 0 fatalities + strategic developments → floor 1', () => {
  const r = fatalityBridge.normalize({ id: 'acl14', fatalities: 0, eventType: 'strategic developments', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ACLEDFatalityBridge: fatalities dominate when above floor', () => {
  // 10 fatalities → severity 2, battles floor = 2 → max still 2
  const r = fatalityBridge.normalize({ id: 'acl15', fatalities: 10, eventType: 'protests', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: BATTLES (uppercase) → event type lowercased', () => {
  const r = fatalityBridge.normalize({ id: 'acl16', fatalities: 0, eventType: 'BATTLES', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ACLEDFatalityBridge: location used in description fallback', () => {
  const r = fatalityBridge.normalize({ id: 'acl17', fatalities: 12, eventType: 'battles', location: 'Kharkiv Oblast', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Kharkiv Oblast'));
});

test('ACLEDFatalityBridge: country fallback when location absent', () => {
  const r = fatalityBridge.normalize({ id: 'acl18', fatalities: 12, eventType: 'battles', country: 'Ukraine', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Ukraine'));
});

test('ACLEDFatalityBridge: explicit description takes precedence', () => {
  const r = fatalityBridge.normalize({ id: 'acl19', fatalities: 50, description: 'Offensive near Bakhmut', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Offensive near Bakhmut');
});

test('ACLEDFatalityBridge: missing id → null', () => {
  assert.equal(fatalityBridge.normalize({ fatalities: 100 }), null);
});

test('ACLEDFatalityBridge: empty string id → null', () => {
  assert.equal(fatalityBridge.normalize({ id: '', fatalities: 100 }), null);
});

test('ACLEDFatalityBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = fatalityBridge.normalize({ id: 'acl20', fatalities: 5 });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('ACLEDFatalityBridge: raw payload preserved', () => {
  const raw = { id: 'acl21', fatalities: 30, eventType: 'battles', location: 'Gaza', timestamp: 7000 };
  const r = fatalityBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── ArmedGroupMovementBridge — properties ────────────────────────────

const movementBridge = new ArmedGroupMovementBridge();

test('ArmedGroupMovementBridge.domain is conflict', () => {
  assert.equal(movementBridge.domain, 'conflict');
});

test('ArmedGroupMovementBridge.feedId is armed-group-movements', () => {
  assert.equal(movementBridge.feedId, 'armed-group-movements');
});

// ── ArmedGroupMovementBridge — movement type severity ─────────────────

test('ArmedGroupMovementBridge: offensive_advance → severity 4', () => {
  const r = movementBridge.normalize({ id: 'mov1', movementType: 'offensive_advance', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ArmedGroupMovementBridge: breakthrough → severity 4', () => {
  const r = movementBridge.normalize({ id: 'mov2', movementType: 'breakthrough', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ArmedGroupMovementBridge: flanking_maneuver → severity 3', () => {
  const r = movementBridge.normalize({ id: 'mov3', movementType: 'flanking_maneuver', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('ArmedGroupMovementBridge: encirclement → severity 3', () => {
  const r = movementBridge.normalize({ id: 'mov4', movementType: 'encirclement', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('ArmedGroupMovementBridge: defensive_regroup → severity 2', () => {
  const r = movementBridge.normalize({ id: 'mov5', movementType: 'defensive_regroup', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ArmedGroupMovementBridge: withdrawal → severity 2', () => {
  const r = movementBridge.normalize({ id: 'mov6', movementType: 'withdrawal', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ArmedGroupMovementBridge: patrol → severity 1', () => {
  const r = movementBridge.normalize({ id: 'mov7', movementType: 'patrol', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ArmedGroupMovementBridge: presence → severity 1', () => {
  const r = movementBridge.normalize({ id: 'mov8', movementType: 'presence', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ArmedGroupMovementBridge: unknown movement type → severity 1 (default)', () => {
  const r = movementBridge.normalize({ id: 'mov9', movementType: 'logistics', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ArmedGroupMovementBridge: OFFENSIVE_ADVANCE (uppercase) → severity 4 (case-insensitive)', () => {
  const r = movementBridge.normalize({ id: 'mov10', movementType: 'OFFENSIVE_ADVANCE', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ArmedGroupMovementBridge: movement type with spaces normalised', () => {
  const r = movementBridge.normalize({ id: 'mov11', movementType: 'offensive advance', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ArmedGroupMovementBridge: groupName used in description', () => {
  const r = movementBridge.normalize({ id: 'mov12', movementType: 'offensive_advance', groupName: 'Wagner Group', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Wagner Group'));
});

test('ArmedGroupMovementBridge: actor fallback when groupName absent', () => {
  const r = movementBridge.normalize({ id: 'mov13', movementType: 'patrol', actor: 'Hezbollah', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Hezbollah'));
});

test('ArmedGroupMovementBridge: area used in description', () => {
  const r = movementBridge.normalize({ id: 'mov14', movementType: 'flanking_maneuver', area: 'Zaporizhzhia', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Zaporizhzhia'));
});

test('ArmedGroupMovementBridge: explicit description takes precedence', () => {
  const r = movementBridge.normalize({ id: 'mov15', movementType: 'breakthrough', description: 'Line broken near Avdiivka', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Line broken near Avdiivka');
});

test('ArmedGroupMovementBridge: missing id → null', () => {
  assert.equal(movementBridge.normalize({ movementType: 'patrol' }), null);
});

// ── CeasefireViolationBridge — properties ────────────────────────────

const violationBridge = new CeasefireViolationBridge();

test('CeasefireViolationBridge.domain is conflict', () => {
  assert.equal(violationBridge.domain, 'conflict');
});

test('CeasefireViolationBridge.feedId is ceasefire-violations', () => {
  assert.equal(violationBridge.feedId, 'ceasefire-violations');
});

// ── CeasefireViolationBridge — weaponry severity ──────────────────────

test('CeasefireViolationBridge: heavy_artillery → severity 4', () => {
  const r = violationBridge.normalize({ id: 'vio1', violationType: 'heavy_artillery', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CeasefireViolationBridge: airstrike → severity 4', () => {
  const r = violationBridge.normalize({ id: 'vio2', violationType: 'airstrike', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CeasefireViolationBridge: rocket_attack → severity 3', () => {
  const r = violationBridge.normalize({ id: 'vio3', violationType: 'rocket_attack', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CeasefireViolationBridge: mortar_shelling → severity 3', () => {
  const r = violationBridge.normalize({ id: 'vio4', violationType: 'mortar_shelling', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CeasefireViolationBridge: sniper_fire → severity 2', () => {
  const r = violationBridge.normalize({ id: 'vio5', violationType: 'sniper_fire', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('CeasefireViolationBridge: small_arms → severity 2', () => {
  const r = violationBridge.normalize({ id: 'vio6', violationType: 'small_arms', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('CeasefireViolationBridge: incursion → severity 1', () => {
  const r = violationBridge.normalize({ id: 'vio7', violationType: 'incursion', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('CeasefireViolationBridge: observation → severity 1', () => {
  const r = violationBridge.normalize({ id: 'vio8', violationType: 'observation', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('CeasefireViolationBridge: unknown violation type → severity 1 (default)', () => {
  const r = violationBridge.normalize({ id: 'vio9', violationType: 'drone_overfly', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('CeasefireViolationBridge: AIRSTRIKE (uppercase) → severity 4 (case-insensitive)', () => {
  const r = violationBridge.normalize({ id: 'vio10', violationType: 'AIRSTRIKE', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CeasefireViolationBridge: violation type with spaces normalised', () => {
  const r = violationBridge.normalize({ id: 'vio11', violationType: 'heavy artillery', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CeasefireViolationBridge: zone used in description', () => {
  const r = violationBridge.normalize({ id: 'vio12', violationType: 'mortar_shelling', zone: 'Green Line Sector 3', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Green Line Sector 3'));
});

test('CeasefireViolationBridge: location fallback when zone absent', () => {
  const r = violationBridge.normalize({ id: 'vio13', violationType: 'sniper_fire', location: 'DMZ North', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('DMZ North'));
});

test('CeasefireViolationBridge: explicit description takes precedence', () => {
  const r = violationBridge.normalize({ id: 'vio14', violationType: 'airstrike', description: 'Strike on civilian convoy', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Strike on civilian convoy');
});

test('CeasefireViolationBridge: missing id → null', () => {
  assert.equal(violationBridge.normalize({ violationType: 'airstrike' }), null);
});

test('CeasefireViolationBridge: empty string id → null', () => {
  assert.equal(violationBridge.normalize({ id: '', violationType: 'airstrike' }), null);
});

test('CeasefireViolationBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = violationBridge.normalize({ id: 'vio15', violationType: 'incursion' });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('CeasefireViolationBridge: raw payload preserved', () => {
  const raw = { id: 'vio16', violationType: 'heavy_artillery', zone: 'Sector 7', timestamp: 6000 };
  const r = violationBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── Registry isolation ─────────────────────────────────────────────────

test('resetting registry removes all conflict bridges', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  assert.equal(reg.has('conflict', 'acled-fatalities'), false);
  assert.equal(reg.has('conflict', 'armed-group-movements'), false);
  assert.equal(reg.has('conflict', 'ceasefire-violations'), false);
});
