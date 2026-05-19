/**
 * Tests for maritime mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - AISVesselBridge.normalize() — all severity tiers + edge cases
 *   - MaritimeIncidentBridge.normalize() — all severity tiers + edge cases
 *   - PortDisruptionBridge.normalize() — all severity tiers + edge cases
 *   - MissionBridgeRegistry register / get / has / all
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/maritime-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AISVesselBridge,
  MaritimeIncidentBridge,
  PortDisruptionBridge,
} from '../../../src/services/intelligence/mission-bridges/maritime-bridges.ts';
import {
  getMissionBridgeRegistry,
  MissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration (must run before any registry reset) ────────────

test('importing maritime-bridges registers AISVesselBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('maritime', 'ais-vessels'));
});

test('importing maritime-bridges registers MaritimeIncidentBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('maritime', 'maritime-incidents'));
});

test('importing maritime-bridges registers PortDisruptionBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('maritime', 'port-disruptions'));
});

test('auto-registered bridges are retrievable by domain + feedId', () => {
  const reg = getMissionBridgeRegistry();
  const ais = reg.get('maritime', 'ais-vessels');
  assert.ok(ais instanceof AISVesselBridge);
  const inc = reg.get('maritime', 'maritime-incidents');
  assert.ok(inc instanceof MaritimeIncidentBridge);
  const port = reg.get('maritime', 'port-disruptions');
  assert.ok(port instanceof PortDisruptionBridge);
});

// ── AISVesselBridge — properties ──────────────────────────────────────

const aisBridge = new AISVesselBridge();

test('AISVesselBridge.domain is maritime', () => {
  assert.equal(aisBridge.domain, 'maritime');
});

test('AISVesselBridge.feedId is ais-vessels', () => {
  assert.equal(aisBridge.feedId, 'ais-vessels');
});

// ── AISVesselBridge — severity mapping ───────────────────────────────

test('AISVesselBridge: dark status → severity 3', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'dark', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 3);
});

test('AISVesselBridge: sanctioned_waters status → severity 4', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'sanctioned_waters', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 4);
});

test('AISVesselBridge: spoofing status → severity 3', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'spoofing', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 3);
});

test('AISVesselBridge: normal status → severity 0', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'normal', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

test('AISVesselBridge: unknown status → severity 0 (default)', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'anchored', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

test('AISVesselBridge: missing status → severity 0 (default)', () => {
  const result = aisBridge.normalize({ id: 'v1', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

// ── AISVesselBridge — output shape ───────────────────────────────────

test('AISVesselBridge: returns correct id', () => {
  const result = aisBridge.normalize({ id: 'vessel-007', status: 'dark', timestamp: 5000 });
  assert.ok(result);
  assert.equal(result.id, 'vessel-007');
});

test('AISVesselBridge: returns timestamp from raw', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'normal', timestamp: 99_999 });
  assert.ok(result);
  assert.equal(result.timestamp, 99_999);
});

test('AISVesselBridge: uses raw description when provided', () => {
  const result = aisBridge.normalize({ id: 'v1', status: 'dark', description: 'Custom desc', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.description, 'Custom desc');
});

test('AISVesselBridge: raw field preserved on output', () => {
  const raw = { id: 'v1', status: 'spoofing', timestamp: 1000, extra: 'data' };
  const result = aisBridge.normalize(raw);
  assert.ok(result);
  assert.equal(result.raw, raw);
});

// ── AISVesselBridge — invalid input ──────────────────────────────────

test('AISVesselBridge: missing id returns null', () => {
  assert.equal(aisBridge.normalize({ status: 'dark', timestamp: 1000 }), null);
});

test('AISVesselBridge: empty id returns null', () => {
  assert.equal(aisBridge.normalize({ id: '', status: 'dark', timestamp: 1000 }), null);
});

test('AISVesselBridge: numeric id returns null', () => {
  assert.equal(aisBridge.normalize({ id: 42, status: 'dark', timestamp: 1000 }), null);
});

// ── MaritimeIncidentBridge — properties ──────────────────────────────

const incidentBridge = new MaritimeIncidentBridge();

test('MaritimeIncidentBridge.domain is maritime', () => {
  assert.equal(incidentBridge.domain, 'maritime');
});

test('MaritimeIncidentBridge.feedId is maritime-incidents', () => {
  assert.equal(incidentBridge.feedId, 'maritime-incidents');
});

// ── MaritimeIncidentBridge — severity mapping ─────────────────────────

test('MaritimeIncidentBridge: piracy_attack → severity 4', () => {
  const result = incidentBridge.normalize({ id: 'i1', type: 'piracy_attack', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 4);
});

test('MaritimeIncidentBridge: suspicious_approach → severity 2', () => {
  const result = incidentBridge.normalize({ id: 'i1', type: 'suspicious_approach', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 2);
});

test('MaritimeIncidentBridge: mechanical_distress → severity 1', () => {
  const result = incidentBridge.normalize({ id: 'i1', type: 'mechanical_distress', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 1);
});

test('MaritimeIncidentBridge: unknown type → severity 0', () => {
  const result = incidentBridge.normalize({ id: 'i1', type: 'weather_delay', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

test('MaritimeIncidentBridge: missing type → severity 0', () => {
  const result = incidentBridge.normalize({ id: 'i1', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

// ── MaritimeIncidentBridge — output shape ─────────────────────────────

test('MaritimeIncidentBridge: returns correct id', () => {
  const result = incidentBridge.normalize({ id: 'incident-99', type: 'piracy_attack', timestamp: 2000 });
  assert.ok(result);
  assert.equal(result.id, 'incident-99');
});

test('MaritimeIncidentBridge: uses raw description when provided', () => {
  const result = incidentBridge.normalize({ id: 'i1', type: 'piracy_attack', description: 'Ship boarded', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.description, 'Ship boarded');
});

test('MaritimeIncidentBridge: missing id returns null', () => {
  assert.equal(incidentBridge.normalize({ type: 'piracy_attack', timestamp: 1000 }), null);
});

test('MaritimeIncidentBridge: empty id returns null', () => {
  assert.equal(incidentBridge.normalize({ id: '', type: 'piracy_attack', timestamp: 1000 }), null);
});

// ── PortDisruptionBridge — properties ────────────────────────────────

const portBridge = new PortDisruptionBridge();

test('PortDisruptionBridge.domain is maritime', () => {
  assert.equal(portBridge.domain, 'maritime');
});

test('PortDisruptionBridge.feedId is port-disruptions', () => {
  assert.equal(portBridge.feedId, 'port-disruptions');
});

// ── PortDisruptionBridge — severity mapping ───────────────────────────

test('PortDisruptionBridge: closed → severity 4', () => {
  const result = portBridge.normalize({ id: 'port-1', closureStatus: 'closed', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 4);
});

test('PortDisruptionBridge: congested → severity 2', () => {
  const result = portBridge.normalize({ id: 'port-1', closureStatus: 'congested', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 2);
});

test('PortDisruptionBridge: delayed → severity 1', () => {
  const result = portBridge.normalize({ id: 'port-1', closureStatus: 'delayed', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 1);
});

test('PortDisruptionBridge: normal → severity 0', () => {
  const result = portBridge.normalize({ id: 'port-1', closureStatus: 'normal', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

test('PortDisruptionBridge: unknown closureStatus → severity 0', () => {
  const result = portBridge.normalize({ id: 'port-1', closureStatus: 'maintenance', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

test('PortDisruptionBridge: missing closureStatus → severity 0', () => {
  const result = portBridge.normalize({ id: 'port-1', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.severity, 0);
});

// ── PortDisruptionBridge — output shape ───────────────────────────────

test('PortDisruptionBridge: returns correct id', () => {
  const result = portBridge.normalize({ id: 'PORT-LA', closureStatus: 'closed', timestamp: 3000 });
  assert.ok(result);
  assert.equal(result.id, 'PORT-LA');
});

test('PortDisruptionBridge: uses raw description when provided', () => {
  const result = portBridge.normalize({ id: 'p1', closureStatus: 'congested', description: 'Strike action', timestamp: 1000 });
  assert.ok(result);
  assert.equal(result.description, 'Strike action');
});

test('PortDisruptionBridge: missing id returns null', () => {
  assert.equal(portBridge.normalize({ closureStatus: 'closed', timestamp: 1000 }), null);
});

test('PortDisruptionBridge: empty id returns null', () => {
  assert.equal(portBridge.normalize({ id: '', closureStatus: 'closed', timestamp: 1000 }), null);
});

// ── MissionBridgeRegistry — isolated unit tests ───────────────────────

test('registry.get returns undefined for unregistered key', () => {
  __resetMissionBridgeRegistry();
  assert.equal(getMissionBridgeRegistry().get('maritime', 'ais-vessels'), undefined);
  __resetMissionBridgeRegistry();
});

test('registry.register + get round-trips correctly', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  const bridge = new AISVesselBridge();
  reg.register(bridge);
  assert.equal(reg.get('maritime', 'ais-vessels'), bridge);
  __resetMissionBridgeRegistry();
});

test('registry.has returns false before registration', () => {
  __resetMissionBridgeRegistry();
  assert.equal(getMissionBridgeRegistry().has('maritime', 'port-disruptions'), false);
  __resetMissionBridgeRegistry();
});

test('registry.has returns true after registration', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  reg.register(new PortDisruptionBridge());
  assert.ok(reg.has('maritime', 'port-disruptions'));
  __resetMissionBridgeRegistry();
});

test('registry.all returns all registered bridges', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  reg.register(new AISVesselBridge());
  reg.register(new MaritimeIncidentBridge());
  reg.register(new PortDisruptionBridge());
  assert.equal(reg.all().length, 3);
  __resetMissionBridgeRegistry();
});

test('registry.all returns empty when nothing registered', () => {
  __resetMissionBridgeRegistry();
  assert.equal(getMissionBridgeRegistry().all().length, 0);
  __resetMissionBridgeRegistry();
});

test('MissionBridgeRegistry instances are independent', () => {
  const reg1 = new MissionBridgeRegistry();
  const reg2 = new MissionBridgeRegistry();
  reg1.register(new AISVesselBridge());
  assert.ok(reg1.has('maritime', 'ais-vessels'));
  assert.equal(reg2.has('maritime', 'ais-vessels'), false);
});

// ── Integration: all three bridges share domain ───────────────────────

test('all three bridges share domain maritime', () => {
  assert.equal(aisBridge.domain, 'maritime');
  assert.equal(incidentBridge.domain, 'maritime');
  assert.equal(portBridge.domain, 'maritime');
});

test('all three bridges have distinct feedIds', () => {
  const feedIds = new Set([aisBridge.feedId, incidentBridge.feedId, portBridge.feedId]);
  assert.equal(feedIds.size, 3);
});

test('severity 4 is the maximum across all bridge types', () => {
  const aisMax = aisBridge.normalize({ id: 'v', status: 'sanctioned_waters', timestamp: 1 });
  const incMax = incidentBridge.normalize({ id: 'i', type: 'piracy_attack', timestamp: 1 });
  const portMax = portBridge.normalize({ id: 'p', closureStatus: 'closed', timestamp: 1 });
  assert.equal(aisMax?.severity, 4);
  assert.equal(incMax?.severity, 4);
  assert.equal(portMax?.severity, 4);
});
