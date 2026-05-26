/**
 * Tests for aviation mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - FaaTfrBridge.normalize() — severity ladder + identity + edges
 *   - AircraftEmergencyBridge.normalize() — squawk mapping + edges
 *   - AirspaceClosureBridge.normalize() — radius-bucketed severity
 *   - severityForRadius() helper boundaries
 *
 * Run with:
 *   npx tsx --test tests/intelligence/mission-bridges/aviation-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FaaTfrBridge,
  AircraftEmergencyBridge,
  AirspaceClosureBridge,
  severityForRadius,
} from '../../../src/services/intelligence/mission-bridges/aviation-bridges.ts';
import {
  getMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

const T0 = 1_750_000_000_000;

// ── Auto-registration ────────────────────────────────────────────────

test('importing aviation-bridges registers FaaTfrBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('aviation', 'faa-tfr'));
});

test('importing aviation-bridges registers AircraftEmergencyBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('aviation', 'aircraft-emergency'));
});

test('importing aviation-bridges registers AirspaceClosureBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('aviation', 'airspace-closure'));
});

test('auto-registered aviation bridges are retrievable by domain + feedId', () => {
  const reg = getMissionBridgeRegistry();
  assert.ok(reg.get('aviation', 'faa-tfr') instanceof FaaTfrBridge);
  assert.ok(reg.get('aviation', 'aircraft-emergency') instanceof AircraftEmergencyBridge);
  assert.ok(reg.get('aviation', 'airspace-closure') instanceof AirspaceClosureBridge);
});

test('getByDomain("aviation") returns at least three bridges', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('aviation');
  assert.ok(bridges.length >= 3);
});

// ── FaaTfrBridge — identity ──────────────────────────────────────────

const tfr = new FaaTfrBridge();

test('FaaTfrBridge.domain is aviation', () => {
  assert.equal(tfr.domain, 'aviation');
});

test('FaaTfrBridge.feedId is faa-tfr', () => {
  assert.equal(tfr.feedId, 'faa-tfr');
});

// ── FaaTfrBridge — severity ladder ───────────────────────────────────

test('FaaTfrBridge: presidential TFR → severity 4', () => {
  const r = tfr.normalize({ id: 'tfr-1', type: 'presidential', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('FaaTfrBridge: security TFR → severity 4', () => {
  const r = tfr.normalize({ id: 'tfr-1', type: 'security', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('FaaTfrBridge: disaster TFR → severity 3', () => {
  const r = tfr.normalize({ id: 'tfr-d', type: 'disaster', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('FaaTfrBridge: VIP TFR → severity 3', () => {
  const r = tfr.normalize({ id: 'tfr-vip', type: 'vip', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('FaaTfrBridge: stadium TFR → severity 2', () => {
  const r = tfr.normalize({ id: 'tfr-s', type: 'stadium', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('FaaTfrBridge: unknown type → severity 1', () => {
  const r = tfr.normalize({ id: 'tfr-x', type: 'airshow', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('FaaTfrBridge: missing type → severity 1', () => {
  const r = tfr.normalize({ id: 'tfr-x', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('FaaTfrBridge: type matching is case-insensitive', () => {
  const r = tfr.normalize({ id: 'tfr-1', type: 'PRESIDENTIAL', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('FaaTfrBridge: mixed-case "Stadium" → severity 2', () => {
  const r = tfr.normalize({ id: 'tfr-1', type: 'Stadium', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

// ── FaaTfrBridge — id validation ─────────────────────────────────────

test('FaaTfrBridge: missing id → null', () => {
  assert.equal(tfr.normalize({ type: 'security', timestamp: T0 }), null);
});

test('FaaTfrBridge: non-string id → null', () => {
  assert.equal(tfr.normalize({ id: 42, type: 'security', timestamp: T0 }), null);
});

test('FaaTfrBridge: empty-string id → null', () => {
  assert.equal(tfr.normalize({ id: '', type: 'security', timestamp: T0 }), null);
});

// ── FaaTfrBridge — description / timestamp / raw ─────────────────────

test('FaaTfrBridge: keeps explicit description', () => {
  const r = tfr.normalize({ id: 'tfr-1', type: 'presidential', description: 'POTUS travel — Bedford NH', timestamp: T0 });
  assert.equal(r?.description, 'POTUS travel — Bedford NH');
});

test('FaaTfrBridge: synthesizes a description when absent', () => {
  const r = tfr.normalize({ id: 'tfr-9', type: 'disaster', timestamp: T0 });
  assert.ok(r?.description?.includes('tfr-9'));
  assert.ok(r?.description?.toLowerCase().includes('disaster'));
});

test('FaaTfrBridge: passes raw through unchanged', () => {
  const raw = { id: 'tfr-1', type: 'security', timestamp: T0, extra: 'whatever' };
  const r = tfr.normalize(raw);
  assert.equal(r?.raw, raw);
});

test('FaaTfrBridge: missing timestamp → finite Date.now() fallback', () => {
  const r = tfr.normalize({ id: 'tfr-1', type: 'security' });
  assert.ok(r);
  assert.ok(Number.isFinite(r.timestamp));
});

// ── AircraftEmergencyBridge — identity ───────────────────────────────

const sqwk = new AircraftEmergencyBridge();

test('AircraftEmergencyBridge.domain is aviation', () => {
  assert.equal(sqwk.domain, 'aviation');
});

test('AircraftEmergencyBridge.feedId is aircraft-emergency', () => {
  assert.equal(sqwk.feedId, 'aircraft-emergency');
});

// ── AircraftEmergencyBridge — squawk ladder ──────────────────────────

test('AircraftEmergencyBridge: squawk 7500 (hijack) → severity 4', () => {
  const r = sqwk.normalize({ id: 'ABC123', squawk: '7500', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('AircraftEmergencyBridge: squawk 7700 (general emergency) → severity 3', () => {
  const r = sqwk.normalize({ id: 'ABC123', squawk: '7700', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('AircraftEmergencyBridge: squawk 7600 (comms loss) → severity 2', () => {
  const r = sqwk.normalize({ id: 'ABC123', squawk: '7600', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('AircraftEmergencyBridge: numeric squawk 7500 → severity 4', () => {
  const r = sqwk.normalize({ id: 'ABC123', squawk: 7500, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('AircraftEmergencyBridge: routine squawk (1200) → severity 0', () => {
  const r = sqwk.normalize({ id: 'ABC123', squawk: '1200', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

test('AircraftEmergencyBridge: missing squawk → null (no event)', () => {
  assert.equal(sqwk.normalize({ id: 'ABC123', timestamp: T0 }), null);
});

test('AircraftEmergencyBridge: boolean squawk → null', () => {
  assert.equal(sqwk.normalize({ id: 'ABC123', squawk: true, timestamp: T0 }), null);
});

test('AircraftEmergencyBridge: missing id → null', () => {
  assert.equal(sqwk.normalize({ squawk: '7500', timestamp: T0 }), null);
});

test('AircraftEmergencyBridge: synthesizes description with id + squawk', () => {
  const r = sqwk.normalize({ id: 'N12345', squawk: '7700', timestamp: T0 });
  assert.ok(r?.description?.includes('N12345'));
  assert.ok(r?.description?.includes('7700'));
});

test('AircraftEmergencyBridge: keeps explicit description', () => {
  const r = sqwk.normalize({ id: 'N12345', squawk: '7500', description: 'Hijack report — coords withheld', timestamp: T0 });
  assert.equal(r?.description, 'Hijack report — coords withheld');
});

// ── AirspaceClosureBridge — identity ─────────────────────────────────

const clos = new AirspaceClosureBridge();

test('AirspaceClosureBridge.domain is aviation', () => {
  assert.equal(clos.domain, 'aviation');
});

test('AirspaceClosureBridge.feedId is airspace-closure', () => {
  assert.equal(clos.feedId, 'airspace-closure');
});

// ── AirspaceClosureBridge — radius → severity buckets ────────────────

test('AirspaceClosureBridge: 150nm radius → severity 4', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 150, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('AirspaceClosureBridge: 100nm boundary stays at severity 3 (>100 to escalate)', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 100, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('AirspaceClosureBridge: 75nm radius → severity 3', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 75, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('AirspaceClosureBridge: 50nm boundary stays at severity 2 (>50 to escalate)', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 50, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('AirspaceClosureBridge: 30nm radius → severity 2', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 30, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('AirspaceClosureBridge: 20nm boundary stays at severity 1 (>20 to escalate)', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 20, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('AirspaceClosureBridge: 5nm radius → severity 1', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 5, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('AirspaceClosureBridge: missing radius → severity 1', () => {
  const r = clos.normalize({ id: 'notam-1', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('AirspaceClosureBridge: zero radius → severity 1', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 0, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('AirspaceClosureBridge: negative radius → severity 1', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: -10, timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('AirspaceClosureBridge: non-numeric radius → severity 1', () => {
  const r = clos.normalize({ id: 'notam-1', radiusNm: 'huge', timestamp: T0 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('AirspaceClosureBridge: missing id → null', () => {
  assert.equal(clos.normalize({ radiusNm: 100, timestamp: T0 }), null);
});

test('AirspaceClosureBridge: synthesized description mentions radius', () => {
  const r = clos.normalize({ id: 'notam-9', radiusNm: 60, timestamp: T0 });
  assert.ok(r?.description?.toLowerCase().includes('radius'));
});

test('AirspaceClosureBridge: keeps explicit description', () => {
  const r = clos.normalize({ id: 'notam-9', radiusNm: 60, description: 'SUA closed for live-fire', timestamp: T0 });
  assert.equal(r?.description, 'SUA closed for live-fire');
});

// ── severityForRadius (exported helper) ──────────────────────────────

test('severityForRadius: 0 → 1', () => {
  assert.equal(severityForRadius(0), 1);
});

test('severityForRadius: NaN → 1', () => {
  assert.equal(severityForRadius(Number.NaN), 1);
});

test('severityForRadius: 100 (boundary) → 3', () => {
  assert.equal(severityForRadius(100), 3);
});

test('severityForRadius: 100.01 → 4', () => {
  assert.equal(severityForRadius(100.01), 4);
});

test('severityForRadius: 50 (boundary) → 2', () => {
  assert.equal(severityForRadius(50), 2);
});

test('severityForRadius: 50.01 → 3', () => {
  assert.equal(severityForRadius(50.01), 3);
});

test('severityForRadius: 20 (boundary) → 1', () => {
  assert.equal(severityForRadius(20), 1);
});

test('severityForRadius: 20.01 → 2', () => {
  assert.equal(severityForRadius(20.01), 2);
});
