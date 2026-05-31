/**
 * Tests for nuclear/radiological mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - NuclearIncidentBridge: INES scale tiers, type severity, Math.max, null guards
 *   - RadiationReleaseBridge: dose rate tiers, area tiers, Math.max, null guard
 *   - NuclearThreatBridge: threat type severity, description prefix, null guards
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/nuclear-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NuclearIncidentBridge,
  RadiationReleaseBridge,
  NuclearThreatBridge,
} from '../../../src/services/intelligence/mission-bridges/nuclear-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration ─────────────────────────────────────────────────────

test('importing nuclear-bridges registers NuclearIncidentBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('nuclear', 'nuclear-incidents'));
});

test('importing nuclear-bridges registers RadiationReleaseBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('nuclear', 'radiation-releases'));
});

test('importing nuclear-bridges registers NuclearThreatBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('nuclear', 'nuclear-threats'));
});

test('all nuclear bridges retrievable by domain', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('nuclear');
  assert.equal(bridges.length, 3);
});

// ── NuclearIncidentBridge — properties ────────────────────────────────────

const incidentBridge = new NuclearIncidentBridge();

test('NuclearIncidentBridge.domain is nuclear', () => {
  assert.equal(incidentBridge.domain, 'nuclear');
});

test('NuclearIncidentBridge.feedId is nuclear-incidents', () => {
  assert.equal(incidentBridge.feedId, 'nuclear-incidents');
});

// ── NuclearIncidentBridge — INES scale ────────────────────────────────────

test('NuclearIncidentBridge: INES 7 → severity 4', () => {
  const r = incidentBridge.normalize({ id: 'n1', type: 'meltdown', inesLevel: 7, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearIncidentBridge: INES 6 → severity 3 (when type is lower)', () => {
  const r = incidentBridge.normalize({ id: 'n2', type: 'anomaly', inesLevel: 6, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('NuclearIncidentBridge: INES 5 → severity 3', () => {
  const r = incidentBridge.normalize({ id: 'n3', type: 'anomaly', inesLevel: 5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('NuclearIncidentBridge: INES 4 → severity 2 (when type is lower)', () => {
  const r = incidentBridge.normalize({ id: 'n4', type: 'anomaly', inesLevel: 4, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('NuclearIncidentBridge: INES 3 → severity 2', () => {
  const r = incidentBridge.normalize({ id: 'n5', type: 'anomaly', inesLevel: 3, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('NuclearIncidentBridge: INES 2 → severity 1 (when type matches)', () => {
  const r = incidentBridge.normalize({ id: 'n6', type: 'anomaly', inesLevel: 2, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('NuclearIncidentBridge: INES 1 → severity 1', () => {
  const r = incidentBridge.normalize({ id: 'n7', type: 'shutdown', inesLevel: 1, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── NuclearIncidentBridge — type severity ────────────────────────────────

test('NuclearIncidentBridge: type meltdown → severity 4', () => {
  const r = incidentBridge.normalize({ id: 'n8', type: 'meltdown', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearIncidentBridge: type criticality → severity 4', () => {
  const r = incidentBridge.normalize({ id: 'n9', type: 'criticality', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearIncidentBridge: type coolant_loss → severity 3', () => {
  const r = incidentBridge.normalize({ id: 'n10', type: 'coolant_loss', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('NuclearIncidentBridge: type fire → severity 3', () => {
  const r = incidentBridge.normalize({ id: 'n11', type: 'fire', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('NuclearIncidentBridge: type fuel_damage → severity 2', () => {
  const r = incidentBridge.normalize({ id: 'n12', type: 'fuel_damage', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('NuclearIncidentBridge: type release → severity 2', () => {
  const r = incidentBridge.normalize({ id: 'n13', type: 'release', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('NuclearIncidentBridge: type anomaly → severity 1', () => {
  const r = incidentBridge.normalize({ id: 'n14', type: 'anomaly', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('NuclearIncidentBridge: type shutdown → severity 1', () => {
  const r = incidentBridge.normalize({ id: 'n15', type: 'shutdown', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── NuclearIncidentBridge — Math.max(ines, type) ──────────────────────────

test('NuclearIncidentBridge: INES 5 + type meltdown → severity 4 (type wins)', () => {
  const r = incidentBridge.normalize({ id: 'n16', type: 'meltdown', inesLevel: 5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearIncidentBridge: INES 7 + type anomaly → severity 4 (INES wins)', () => {
  const r = incidentBridge.normalize({ id: 'n17', type: 'anomaly', inesLevel: 7, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearIncidentBridge: no INES level, type coolant_loss → severity 3', () => {
  const r = incidentBridge.normalize({ id: 'n18', type: 'coolant_loss', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

// ── NuclearIncidentBridge — description and shape ─────────────────────────

test('NuclearIncidentBridge: returns raw description when provided', () => {
  const r = incidentBridge.normalize({ id: 'n19', type: 'anomaly', description: 'Manual override', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Manual override');
});

test('NuclearIncidentBridge: auto-description includes facility name', () => {
  const r = incidentBridge.normalize({ id: 'n20', type: 'anomaly', facility: 'Reactor A', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Reactor A'));
});

test('NuclearIncidentBridge: result carries correct id and timestamp', () => {
  const r = incidentBridge.normalize({ id: 'chernobyl-1986', type: 'meltdown', inesLevel: 7, timestamp: 9999 });
  assert.ok(r);
  assert.equal(r.id, 'chernobyl-1986');
  assert.equal(r.timestamp, 9999);
});

// ── NuclearIncidentBridge — null guards ───────────────────────────────────

test('NuclearIncidentBridge: null if id is missing', () => {
  assert.equal(incidentBridge.normalize({ type: 'meltdown', timestamp: 1000 }), null);
});

test('NuclearIncidentBridge: null if id is empty string', () => {
  assert.equal(incidentBridge.normalize({ id: '', type: 'meltdown', timestamp: 1000 }), null);
});

test('NuclearIncidentBridge: null if type is missing', () => {
  assert.equal(incidentBridge.normalize({ id: 'x', timestamp: 1000 }), null);
});

test('NuclearIncidentBridge: null if type is empty string', () => {
  assert.equal(incidentBridge.normalize({ id: 'x', type: '', timestamp: 1000 }), null);
});

// ── RadiationReleaseBridge — properties ──────────────────────────────────

const releaseBridge = new RadiationReleaseBridge();

test('RadiationReleaseBridge.domain is nuclear', () => {
  assert.equal(releaseBridge.domain, 'nuclear');
});

test('RadiationReleaseBridge.feedId is radiation-releases', () => {
  assert.equal(releaseBridge.feedId, 'radiation-releases');
});

// ── RadiationReleaseBridge — dose rate tiers ─────────────────────────────

test('RadiationReleaseBridge: dose 100 µSv/h → severity 4', () => {
  const r = releaseBridge.normalize({ id: 'r1', doseRateMicroSvH: 100, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RadiationReleaseBridge: dose 1000 µSv/h → severity 4', () => {
  const r = releaseBridge.normalize({ id: 'r2', doseRateMicroSvH: 1000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RadiationReleaseBridge: dose 10 µSv/h → severity 3', () => {
  const r = releaseBridge.normalize({ id: 'r3', doseRateMicroSvH: 10, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('RadiationReleaseBridge: dose 99 µSv/h → severity 3 (below 100)', () => {
  const r = releaseBridge.normalize({ id: 'r4', doseRateMicroSvH: 99, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('RadiationReleaseBridge: dose 1 µSv/h → severity 2', () => {
  const r = releaseBridge.normalize({ id: 'r5', doseRateMicroSvH: 1, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('RadiationReleaseBridge: dose 0.5 µSv/h → severity 1 (>0 but <1)', () => {
  const r = releaseBridge.normalize({ id: 'r6', doseRateMicroSvH: 0.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── RadiationReleaseBridge — affected area tiers ──────────────────────────

test('RadiationReleaseBridge: area 1000 km² → severity 4', () => {
  const r = releaseBridge.normalize({ id: 'r7', affected_area_km2: 1000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RadiationReleaseBridge: area 100 km² → severity 3', () => {
  const r = releaseBridge.normalize({ id: 'r8', affected_area_km2: 100, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('RadiationReleaseBridge: area 10 km² → severity 2', () => {
  const r = releaseBridge.normalize({ id: 'r9', affected_area_km2: 10, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('RadiationReleaseBridge: area 1 km² → severity 1', () => {
  const r = releaseBridge.normalize({ id: 'r10', affected_area_km2: 1, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── RadiationReleaseBridge — Math.max(dose, area) ────────────────────────

test('RadiationReleaseBridge: dose 3 + area 1000 km² → severity 4 (area wins)', () => {
  const r = releaseBridge.normalize({ id: 'r11', doseRateMicroSvH: 3, affected_area_km2: 1000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RadiationReleaseBridge: dose 100 + area 5 km² → severity 4 (dose wins)', () => {
  const r = releaseBridge.normalize({ id: 'r12', doseRateMicroSvH: 100, affected_area_km2: 5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RadiationReleaseBridge: dose 0 + area 0 → severity 0', () => {
  const r = releaseBridge.normalize({ id: 'r13', doseRateMicroSvH: 0, affected_area_km2: 0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

// ── RadiationReleaseBridge — description and null guard ──────────────────

test('RadiationReleaseBridge: returns raw description when provided', () => {
  const r = releaseBridge.normalize({ id: 'r14', doseRateMicroSvH: 5, description: 'Leak at unit 2', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Leak at unit 2');
});

test('RadiationReleaseBridge: auto-description includes location', () => {
  const r = releaseBridge.normalize({ id: 'r15', doseRateMicroSvH: 5, location: 'Plant Alpha', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Plant Alpha'));
});

test('RadiationReleaseBridge: null if id is missing', () => {
  assert.equal(releaseBridge.normalize({ doseRateMicroSvH: 100, timestamp: 1000 }), null);
});

test('RadiationReleaseBridge: null if id is empty string', () => {
  assert.equal(releaseBridge.normalize({ id: '', doseRateMicroSvH: 100, timestamp: 1000 }), null);
});

// ── NuclearThreatBridge — properties ─────────────────────────────────────

const threatBridge = new NuclearThreatBridge();

test('NuclearThreatBridge.domain is nuclear', () => {
  assert.equal(threatBridge.domain, 'nuclear');
});

test('NuclearThreatBridge.feedId is nuclear-threats', () => {
  assert.equal(threatBridge.feedId, 'nuclear-threats');
});

// ── NuclearThreatBridge — type severity ──────────────────────────────────

test('NuclearThreatBridge: type detonation → severity 4', () => {
  const r = threatBridge.normalize({ id: 't1', type: 'detonation', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearThreatBridge: type test → severity 4', () => {
  const r = threatBridge.normalize({ id: 't2', type: 'test', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('NuclearThreatBridge: type deployment → severity 3', () => {
  const r = threatBridge.normalize({ id: 't3', type: 'deployment', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('NuclearThreatBridge: type transport → severity 3', () => {
  const r = threatBridge.normalize({ id: 't4', type: 'transport', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('NuclearThreatBridge: type threat → severity 2', () => {
  const r = threatBridge.normalize({ id: 't5', type: 'threat', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('NuclearThreatBridge: type acquisition → severity 2', () => {
  const r = threatBridge.normalize({ id: 't6', type: 'acquisition', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('NuclearThreatBridge: type rhetoric → severity 1', () => {
  const r = threatBridge.normalize({ id: 't7', type: 'rhetoric', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('NuclearThreatBridge: type concern → severity 1', () => {
  const r = threatBridge.normalize({ id: 't8', type: 'concern', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('NuclearThreatBridge: unknown type defaults to severity 1', () => {
  const r = threatBridge.normalize({ id: 't9', type: 'surveillance', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── NuclearThreatBridge — description prefix ──────────────────────────────

test('NuclearThreatBridge: type dirty_bomb → [RADIOLOGICAL] prefix', () => {
  const r = threatBridge.normalize({ id: 't10', type: 'dirty_bomb', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.startsWith('[RADIOLOGICAL]'));
});

test('NuclearThreatBridge: type radiological → [RADIOLOGICAL] prefix', () => {
  const r = threatBridge.normalize({ id: 't11', type: 'radiological', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.startsWith('[RADIOLOGICAL]'));
});

test('NuclearThreatBridge: type detonation → [NUCLEAR] prefix', () => {
  const r = threatBridge.normalize({ id: 't12', type: 'detonation', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.startsWith('[NUCLEAR]'));
});

test('NuclearThreatBridge: type transport → [NUCLEAR] prefix', () => {
  const r = threatBridge.normalize({ id: 't13', type: 'transport', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.startsWith('[NUCLEAR]'));
});

test('NuclearThreatBridge: raw description overrides auto-generated prefix', () => {
  const r = threatBridge.normalize({ id: 't14', type: 'detonation', description: 'Custom report', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Custom report');
});

test('NuclearThreatBridge: actor field appears in auto-description', () => {
  const r = threatBridge.normalize({ id: 't15', type: 'rhetoric', actor: 'State X', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('State X'));
});

test('NuclearThreatBridge: country field used when actor absent', () => {
  const r = threatBridge.normalize({ id: 't16', type: 'rhetoric', country: 'Country Y', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Country Y'));
});

// ── NuclearThreatBridge — null guards ────────────────────────────────────

test('NuclearThreatBridge: null if id is missing', () => {
  assert.equal(threatBridge.normalize({ type: 'detonation', timestamp: 1000 }), null);
});

test('NuclearThreatBridge: null if id is empty string', () => {
  assert.equal(threatBridge.normalize({ id: '', type: 'detonation', timestamp: 1000 }), null);
});

test('NuclearThreatBridge: null if type is missing', () => {
  assert.equal(threatBridge.normalize({ id: 'x', timestamp: 1000 }), null);
});

test('NuclearThreatBridge: null if type is empty string', () => {
  assert.equal(threatBridge.normalize({ id: 'x', type: '', timestamp: 1000 }), null);
});
