/**
 * Tests for space-domain mission bridges (solar flares, CME impacts, debris conjunctions).
 *
 * Pure module — no DOM, no fetch. Run with:
 *   npx tsx --test tests/intelligence/mission-bridges/space-bridges.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';
import {
  SolarFlareBridge,
  CMEImpactBridge,
  SpaceDebrisBridge,
  registerSpaceBridges,
} from '../../../src/services/intelligence/mission-bridges/space-bridges.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

const NOW = 1_748_100_000_000;

function flareRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'flare-001', flare_class: 'X1.5', peak_flux: 1.5e-4, timestamp: NOW, ...overrides };
}

function cmeRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'cme-001', kp_index: 7.0, storm_category: 'G2', timestamp: NOW, ...overrides };
}

function debrisRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'debris-001', miss_distance_km: 0.5, object_name: 'NORAD-12345', timestamp: NOW, ...overrides };
}

// ── Auto-registration ─────────────────────────────────────────────────────

test('importing space-bridges registers SolarFlareBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('space', 'solar-flare'));
});

test('importing space-bridges registers CMEImpactBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('space', 'cme-impact'));
});

test('importing space-bridges registers SpaceDebrisBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('space', 'space-debris'));
});

test('registerSpaceBridges registers all 3 under domain space', () => {
  __resetMissionBridgeRegistry();
  registerSpaceBridges();
  const space = getMissionBridgeRegistry().getByDomain('space');
  assert.equal(space.length, 3);
  assert.ok(space.every(b => b.domain === 'space'));
});

// ── SolarFlareBridge — identity ───────────────────────────────────────────

test('SolarFlareBridge: domain is space', () => {
  assert.equal(new SolarFlareBridge().domain, 'space');
});

test('SolarFlareBridge: feedId is solar-flare', () => {
  assert.equal(new SolarFlareBridge().feedId, 'solar-flare');
});

// ── SolarFlareBridge — severity mapping ───────────────────────────────────

test('SolarFlareBridge: X-class flare → severity 4 (CRITICAL)', () => {
  const r = new SolarFlareBridge().normalize(flareRaw({ flare_class: 'X2.1' }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 4);
});

test('SolarFlareBridge: M-class flare → severity 3 (HIGH)', () => {
  const r = new SolarFlareBridge().normalize(flareRaw({ flare_class: 'M5.0' }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 3);
});

test('SolarFlareBridge: C-class flare → severity 2 (MEDIUM)', () => {
  const r = new SolarFlareBridge().normalize(flareRaw({ flare_class: 'C3.2' }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 2);
});

test('SolarFlareBridge: B-class flare → severity 1 (LOW)', () => {
  const r = new SolarFlareBridge().normalize(flareRaw({ flare_class: 'B6.0' }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 1);
});

test('SolarFlareBridge: unknown class → severity 0 (INFO)', () => {
  const r = new SolarFlareBridge().normalize(flareRaw({ flare_class: 'A1.0' }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 0);
});

test('SolarFlareBridge: normalize result preserves raw field', () => {
  const raw = flareRaw({ flare_class: 'X1.5' });
  const r = new SolarFlareBridge().normalize(raw);
  assert.ok(r !== null);
  assert.deepEqual(r!.raw, raw);
});

test('SolarFlareBridge: normalize result carries id from raw', () => {
  const r = new SolarFlareBridge().normalize(flareRaw({ id: 'flare-XYZ' }));
  assert.ok(r !== null);
  assert.equal(r!.id, 'flare-XYZ');
});

test('SolarFlareBridge: normalize returns null when id is missing', () => {
  const raw = flareRaw();
  delete raw.id;
  const r = new SolarFlareBridge().normalize(raw);
  assert.equal(r, null);
});

// ── SolarFlareBridge — processCycle ───────────────────────────────────────

test('SolarFlareBridge: processCycle maps X-class to CRITICAL ObservationEvent', () => {
  __resetMissionBridgeRegistry();
  registerSpaceBridges();
  const bridge = new SolarFlareBridge();
  const events = bridge.processCycle([flareRaw({ flare_class: 'X1.5' })]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.severity, 'CRITICAL');
});

test('SolarFlareBridge: processCycle sets sourceId to solar-flare', () => {
  const bridge = new SolarFlareBridge();
  const events = bridge.processCycle([flareRaw()]);
  assert.equal(events[0]!.sourceId, 'solar-flare');
});

test('SolarFlareBridge: processCycle sets domain to space', () => {
  const bridge = new SolarFlareBridge();
  const events = bridge.processCycle([flareRaw()]);
  assert.equal(events[0]!.domain, 'space');
});

test('SolarFlareBridge: processCycle filters events with missing id', () => {
  const rawNoId = flareRaw();
  delete rawNoId.id;
  const bridge = new SolarFlareBridge();
  const events = bridge.processCycle([rawNoId, flareRaw({ id: 'flare-ok' })]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.id, 'flare-ok');
});

// ── CMEImpactBridge — identity ────────────────────────────────────────────

test('CMEImpactBridge: domain is space', () => {
  assert.equal(new CMEImpactBridge().domain, 'space');
});

test('CMEImpactBridge: feedId is cme-impact', () => {
  assert.equal(new CMEImpactBridge().feedId, 'cme-impact');
});

// ── CMEImpactBridge — severity mapping ───────────────────────────────────

test('CMEImpactBridge: Kp >= 8 → severity 4 (CRITICAL)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 9.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 4);
});

test('CMEImpactBridge: Kp exactly 8 → severity 4 (CRITICAL)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 8.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 4);
});

test('CMEImpactBridge: Kp >= 6 and < 8 → severity 3 (HIGH)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 7.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 3);
});

test('CMEImpactBridge: Kp exactly 6 → severity 3 (HIGH)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 6.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 3);
});

test('CMEImpactBridge: Kp >= 5 and < 6 → severity 2 (MEDIUM)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 5.5 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 2);
});

test('CMEImpactBridge: Kp exactly 5 → severity 2 (MEDIUM)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 5.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 2);
});

test('CMEImpactBridge: Kp < 5 → severity 1 (LOW)', () => {
  const r = new CMEImpactBridge().normalize(cmeRaw({ kp_index: 3.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 1);
});

test('CMEImpactBridge: processCycle maps Kp 8 to CRITICAL ObservationEvent', () => {
  const bridge = new CMEImpactBridge();
  const events = bridge.processCycle([cmeRaw({ kp_index: 8.0 })]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.severity, 'CRITICAL');
});

test('CMEImpactBridge: processCycle sets sourceId to cme-impact', () => {
  const bridge = new CMEImpactBridge();
  const events = bridge.processCycle([cmeRaw()]);
  assert.equal(events[0]!.sourceId, 'cme-impact');
});

// ── SpaceDebrisBridge — identity ──────────────────────────────────────────

test('SpaceDebrisBridge: domain is space', () => {
  assert.equal(new SpaceDebrisBridge().domain, 'space');
});

test('SpaceDebrisBridge: feedId is space-debris', () => {
  assert.equal(new SpaceDebrisBridge().feedId, 'space-debris');
});

// ── SpaceDebrisBridge — severity mapping ──────────────────────────────────

test('SpaceDebrisBridge: miss_distance_km < 0.1 → severity 4 (CRITICAL)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 0.05 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 4);
});

test('SpaceDebrisBridge: miss_distance_km exactly 0.1 → severity 3 (HIGH, not CRITICAL)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 0.1 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 3);
});

test('SpaceDebrisBridge: miss_distance_km < 1 and >= 0.1 → severity 3 (HIGH)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 0.5 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 3);
});

test('SpaceDebrisBridge: miss_distance_km exactly 1 → severity 2 (MEDIUM, not HIGH)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 1.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 2);
});

test('SpaceDebrisBridge: miss_distance_km < 10 and >= 1 → severity 2 (MEDIUM)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 5.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 2);
});

test('SpaceDebrisBridge: miss_distance_km exactly 10 → severity 1 (LOW, not MEDIUM)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 10.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 1);
});

test('SpaceDebrisBridge: miss_distance_km >= 10 → severity 1 (LOW)', () => {
  const r = new SpaceDebrisBridge().normalize(debrisRaw({ miss_distance_km: 50.0 }));
  assert.ok(r !== null);
  assert.equal(r!.severity, 1);
});

test('SpaceDebrisBridge: processCycle maps sub-0.1km miss to CRITICAL ObservationEvent', () => {
  const bridge = new SpaceDebrisBridge();
  const events = bridge.processCycle([debrisRaw({ miss_distance_km: 0.05 })]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.severity, 'CRITICAL');
});

test('SpaceDebrisBridge: processCycle sets sourceId to space-debris', () => {
  const bridge = new SpaceDebrisBridge();
  const events = bridge.processCycle([debrisRaw()]);
  assert.equal(events[0]!.sourceId, 'space-debris');
});

test('SpaceDebrisBridge: processCycle sets domain to space', () => {
  const bridge = new SpaceDebrisBridge();
  const events = bridge.processCycle([debrisRaw()]);
  assert.equal(events[0]!.domain, 'space');
});

test('SpaceDebrisBridge: processCycle result has non-empty tags', () => {
  const bridge = new SpaceDebrisBridge();
  const events = bridge.processCycle([debrisRaw()]);
  assert.ok(Array.isArray(events[0]!.tags) && events[0]!.tags.length > 0);
});

test('SpaceDebrisBridge: processCycle result has entityIds array', () => {
  const bridge = new SpaceDebrisBridge();
  const events = bridge.processCycle([debrisRaw()]);
  assert.ok(Array.isArray(events[0]!.entityIds));
});
