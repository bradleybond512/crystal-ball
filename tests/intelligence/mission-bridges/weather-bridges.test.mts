import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  NWSAlertsBridge,
  NHCHurricaneBridge,
  NIFCWildfireBridge,
} from '../../../src/services/intelligence/mission-bridges/weather-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── NWSAlertsBridge ──────────────────────────────────────────────────

describe('NWSAlertsBridge', () => {
  const bridge = new NWSAlertsBridge();

  it('has domain weather', () => {
    assert.equal(bridge.domain, 'weather');
  });

  it('has feedId nws-alerts', () => {
    assert.equal(bridge.feedId, 'nws-alerts');
  });

  it('Tornado Warning → severity 4', () => {
    assert.equal(bridge.normalize({ id: 'e1', type: 'Tornado Warning' })?.severity, 4);
  });

  it('TORNADO WARNING (uppercase) → severity 4', () => {
    assert.equal(bridge.normalize({ id: 'e2', type: 'TORNADO WARNING' })?.severity, 4);
  });

  it('Severe Thunderstorm Warning → severity 3', () => {
    assert.equal(bridge.normalize({ id: 'e3', type: 'Severe Thunderstorm Warning' })?.severity, 3);
  });

  it('Winter Storm Warning → severity 2', () => {
    assert.equal(bridge.normalize({ id: 'e4', type: 'Winter Storm Warning' })?.severity, 2);
  });

  it('Frost Advisory → severity 1', () => {
    assert.equal(bridge.normalize({ id: 'e5', type: 'Frost Advisory' })?.severity, 1);
  });

  it('Special Weather Statement Advisory → severity 1', () => {
    assert.equal(bridge.normalize({ id: 'e6', type: 'Special Weather Statement Advisory' })?.severity, 1);
  });

  it('Special Weather Statement (no keyword) → severity 0', () => {
    assert.equal(bridge.normalize({ id: 'e7', type: 'Special Weather Statement' })?.severity, 0);
  });

  it('empty type string → severity 0', () => {
    assert.equal(bridge.normalize({ id: 'e8', type: '' })?.severity, 0);
  });

  it('raw preserved on output', () => {
    const raw = { id: 'e9', type: 'Tornado Warning', extra: 42 };
    assert.deepEqual(bridge.normalize(raw)?.raw, raw);
  });

  it('id on output matches input id', () => {
    assert.equal(bridge.normalize({ id: 'my-alert-123', type: 'Tornado Warning' })?.id, 'my-alert-123');
  });

  it('timestamp is a recent number', () => {
    const before = Date.now();
    const result = bridge.normalize({ id: 'e10', type: 'Tornado Warning' });
    assert.ok(result?.timestamp !== undefined && result.timestamp >= before);
  });

  it('tornado warning priority beats advisory substring', () => {
    assert.equal(bridge.normalize({ id: 'e11', type: 'Tornado Warning Advisory Bulletin' })?.severity, 4);
  });
});

// ── NHCHurricaneBridge ───────────────────────────────────────────────

describe('NHCHurricaneBridge', () => {
  const bridge = new NHCHurricaneBridge();

  it('has domain weather', () => {
    assert.equal(bridge.domain, 'weather');
  });

  it('has feedId nhc-hurricane', () => {
    assert.equal(bridge.feedId, 'nhc-hurricane');
  });

  it('category 5 → severity 4', () => {
    assert.equal(bridge.normalize({ id: 'h1', category: 5 })?.severity, 4);
  });

  it('category 4 → severity 3', () => {
    assert.equal(bridge.normalize({ id: 'h2', category: 4 })?.severity, 3);
  });

  it('category 3 → severity 2', () => {
    assert.equal(bridge.normalize({ id: 'h3', category: 3 })?.severity, 2);
  });

  it('category 2 → severity 1', () => {
    assert.equal(bridge.normalize({ id: 'h4', category: 2 })?.severity, 1);
  });

  it('category 1 → severity 1', () => {
    assert.equal(bridge.normalize({ id: 'h5', category: 1 })?.severity, 1);
  });

  it('category 0 → severity 0', () => {
    assert.equal(bridge.normalize({ id: 'h6', category: 0 })?.severity, 0);
  });

  it('string "5" → severity 4 (numeric coercion)', () => {
    assert.equal(bridge.normalize({ id: 'h7', category: '5' })?.severity, 4);
  });

  it('string "3" → severity 2 (numeric coercion)', () => {
    assert.equal(bridge.normalize({ id: 'h8', category: '3' })?.severity, 2);
  });

  it('undefined category → severity 0', () => {
    assert.equal(bridge.normalize({ id: 'h9' })?.severity, 0);
  });

  it('NaN string "TS" → severity 0', () => {
    assert.equal(bridge.normalize({ id: 'h10', category: 'TS' })?.severity, 0);
  });

  it('raw preserved on output', () => {
    const raw = { id: 'h11', category: 5 };
    assert.deepEqual(bridge.normalize(raw)?.raw, raw);
  });

  it('id on output matches input', () => {
    assert.equal(bridge.normalize({ id: 'hurricane-99', category: 4 })?.id, 'hurricane-99');
  });

  it('category >= 6 → severity 4', () => {
    assert.equal(bridge.normalize({ id: 'h12', category: 6 })?.severity, 4);
  });
});

// ── NIFCWildfireBridge ────────────────────────────────────────────────

describe('NIFCWildfireBridge', () => {
  const bridge = new NIFCWildfireBridge();

  it('has domain weather', () => {
    assert.equal(bridge.domain, 'weather');
  });

  it('has feedId nifc-wildfire', () => {
    assert.equal(bridge.feedId, 'nifc-wildfire');
  });

  it('containmentPct 0 → severity 4', () => {
    assert.equal(bridge.normalize({ id: 'w1', containmentPct: 0 })?.severity, 4);
  });

  it('containmentPct 10 → severity 3', () => {
    assert.equal(bridge.normalize({ id: 'w2', containmentPct: 10 })?.severity, 3);
  });

  it('containmentPct 24 → severity 3 (boundary < 25)', () => {
    assert.equal(bridge.normalize({ id: 'w3', containmentPct: 24 })?.severity, 3);
  });

  it('containmentPct 25 → severity 2', () => {
    assert.equal(bridge.normalize({ id: 'w4', containmentPct: 25 })?.severity, 2);
  });

  it('containmentPct 50 → severity 2', () => {
    assert.equal(bridge.normalize({ id: 'w5', containmentPct: 50 })?.severity, 2);
  });

  it('containmentPct 74 → severity 2 (boundary < 75)', () => {
    assert.equal(bridge.normalize({ id: 'w6', containmentPct: 74 })?.severity, 2);
  });

  it('containmentPct 75 → severity 1', () => {
    assert.equal(bridge.normalize({ id: 'w7', containmentPct: 75 })?.severity, 1);
  });

  it('containmentPct 99 → severity 1 (boundary < 100)', () => {
    assert.equal(bridge.normalize({ id: 'w8', containmentPct: 99 })?.severity, 1);
  });

  it('containmentPct 100 → severity 0', () => {
    assert.equal(bridge.normalize({ id: 'w9', containmentPct: 100 })?.severity, 0);
  });

  it('missing containmentPct → severity 0 (fallback to 100)', () => {
    assert.equal(bridge.normalize({ id: 'w10' })?.severity, 0);
  });

  it('raw preserved on output', () => {
    const raw = { id: 'w11', containmentPct: 50 };
    assert.deepEqual(bridge.normalize(raw)?.raw, raw);
  });

  it('id on output matches input', () => {
    assert.equal(bridge.normalize({ id: 'fire-001', containmentPct: 0 })?.id, 'fire-001');
  });
});

// ── MissionBridgeRegistry ─────────────────────────────────────────────

describe('MissionBridgeRegistry (weather bridges)', () => {
  before(() => {
    // Own the registry state — reset then re-register so these tests
    // are order-independent and don't rely on import-time side effects.
    __resetMissionBridgeRegistry();
    const reg = getMissionBridgeRegistry();
    reg.register(new NWSAlertsBridge());
    reg.register(new NHCHurricaneBridge());
    reg.register(new NIFCWildfireBridge());
  });

  it('has weather:nws-alerts after registration', () => {
    assert.ok(getMissionBridgeRegistry().has('weather', 'nws-alerts'));
  });

  it('has weather:nhc-hurricane after registration', () => {
    assert.ok(getMissionBridgeRegistry().has('weather', 'nhc-hurricane'));
  });

  it('has weather:nifc-wildfire after registration', () => {
    assert.ok(getMissionBridgeRegistry().has('weather', 'nifc-wildfire'));
  });

  it('all() returns at least 3 bridges', () => {
    assert.ok(getMissionBridgeRegistry().all().length >= 3);
  });

  it('get returns NWSAlertsBridge instance', () => {
    const bridge = getMissionBridgeRegistry().get('weather', 'nws-alerts');
    assert.ok(bridge instanceof NWSAlertsBridge);
  });

  it('getByDomain returns all weather bridges', () => {
    assert.ok(getMissionBridgeRegistry().getByDomain('weather').length >= 3);
  });

  it('reset clears registry', () => {
    __resetMissionBridgeRegistry();
    assert.equal(getMissionBridgeRegistry().all().length, 0);
  });
});
