/**
 * Tests for health domain mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - CDCWastewaterBridge.normalize() — all signal levels + edge cases
 *   - WHOOutbreakBridge.normalize() — all risk assessment levels + edge cases
 *   - BiodisasterSignalBridge.normalize() — R-value thresholds + edge cases
 *   - NormalizedFeedEvent structure (id, timestamp, description, raw passthrough)
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/health-bridges.test.mts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CDCWastewaterBridge,
  WHOOutbreakBridge,
  BiodisasterSignalBridge,
} from '../../../src/services/intelligence/mission-bridges/health-bridges.ts';
import {
  getMissionBridgeRegistry,
  MissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function raw(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'test-1', timestamp: NOW, ...overrides };
}

// ── Auto-registration ─────────────────────────────────────────────────────

describe('auto-registration', () => {
  it('CDCWastewaterBridge is registered under health:cdc-nwss', () => {
    assert.ok(getMissionBridgeRegistry().has('health', 'cdc-nwss'));
  });

  it('WHOOutbreakBridge is registered under health:who-outbreaks', () => {
    assert.ok(getMissionBridgeRegistry().has('health', 'who-outbreaks'));
  });

  it('BiodisasterSignalBridge is registered under health:biosurv-signals', () => {
    assert.ok(getMissionBridgeRegistry().has('health', 'biosurv-signals'));
  });

  it('all three health bridges appear in registry.all()', () => {
    const reg = getMissionBridgeRegistry();
    const feedIds = reg.all().map((b) => b.feedId);
    assert.ok(feedIds.includes('cdc-nwss'));
    assert.ok(feedIds.includes('who-outbreaks'));
    assert.ok(feedIds.includes('biosurv-signals'));
  });

  it('retrieved bridges are correct instances', () => {
    const reg = getMissionBridgeRegistry();
    assert.ok(reg.get('health', 'cdc-nwss') instanceof CDCWastewaterBridge);
    assert.ok(reg.get('health', 'who-outbreaks') instanceof WHOOutbreakBridge);
    assert.ok(reg.get('health', 'biosurv-signals') instanceof BiodisasterSignalBridge);
  });
});

// ── MissionBridgeRegistry unit ────────────────────────────────────────────

describe('MissionBridgeRegistry (fresh instance)', () => {
  it('get returns undefined for unregistered domain+feedId', () => {
    const reg = new MissionBridgeRegistry();
    assert.equal(reg.get('health', 'cdc-nwss'), undefined);
  });

  it('has returns false for unregistered domain+feedId', () => {
    const reg = new MissionBridgeRegistry();
    assert.equal(reg.has('health', 'cdc-nwss'), false);
  });

  it('register then get returns the bridge', () => {
    const reg = new MissionBridgeRegistry();
    const bridge = new CDCWastewaterBridge();
    reg.register(bridge);
    assert.ok(reg.get('health', 'cdc-nwss') instanceof CDCWastewaterBridge);
  });

  it('all() is empty before any registration', () => {
    const reg = new MissionBridgeRegistry();
    assert.deepEqual(reg.all(), []);
  });
});

// ── CDCWastewaterBridge ───────────────────────────────────────────────────

describe('CDCWastewaterBridge', () => {
  const bridge = new CDCWastewaterBridge();

  it('domain is health', () => {
    assert.equal(bridge.domain, 'health');
  });

  it('feedId is cdc-nwss', () => {
    assert.equal(bridge.feedId, 'cdc-nwss');
  });

  it('very_high → severity 4', () => {
    const result = bridge.normalize(raw({ signalLevel: 'very_high' }));
    assert.equal(result?.severity, 4);
  });

  it('high → severity 3', () => {
    const result = bridge.normalize(raw({ signalLevel: 'high' }));
    assert.equal(result?.severity, 3);
  });

  it('moderate → severity 2', () => {
    const result = bridge.normalize(raw({ signalLevel: 'moderate' }));
    assert.equal(result?.severity, 2);
  });

  it('low → severity 1', () => {
    const result = bridge.normalize(raw({ signalLevel: 'low' }));
    assert.equal(result?.severity, 1);
  });

  it('minimal → severity 0', () => {
    const result = bridge.normalize(raw({ signalLevel: 'minimal' }));
    assert.equal(result?.severity, 0);
  });

  it('unrecognised level → severity 0', () => {
    const result = bridge.normalize(raw({ signalLevel: 'extreme' }));
    assert.equal(result?.severity, 0);
  });

  it('missing signalLevel → severity 0', () => {
    const result = bridge.normalize(raw({}));
    assert.equal(result?.severity, 0);
  });

  it('returns null when id is empty string', () => {
    assert.equal(bridge.normalize(raw({ id: '' })), null);
  });

  it('returns null when id is missing', () => {
    const r: Record<string, unknown> = { signalLevel: 'high', timestamp: NOW };
    assert.equal(bridge.normalize(r), null);
  });

  it('uses custom description when provided', () => {
    const result = bridge.normalize(raw({ signalLevel: 'high', description: 'Custom desc' }));
    assert.equal(result?.description, 'Custom desc');
  });

  it('generates fallback description including signalLevel', () => {
    const result = bridge.normalize(raw({ signalLevel: 'high' }));
    assert.ok(result?.description.includes('high'));
  });

  it('passes raw through to result', () => {
    const r = raw({ signalLevel: 'moderate' });
    const result = bridge.normalize(r);
    assert.equal(result?.raw, r);
  });

  it('uses provided timestamp', () => {
    const result = bridge.normalize(raw({ signalLevel: 'high', timestamp: 999 }));
    assert.equal(result?.timestamp, 999);
  });
});

// ── WHOOutbreakBridge ─────────────────────────────────────────────────────

describe('WHOOutbreakBridge', () => {
  const bridge = new WHOOutbreakBridge();

  it('domain is health', () => {
    assert.equal(bridge.domain, 'health');
  });

  it('feedId is who-outbreaks', () => {
    assert.equal(bridge.feedId, 'who-outbreaks');
  });

  it('very_high → severity 4', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'very_high' }));
    assert.equal(result?.severity, 4);
  });

  it('high → severity 3', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'high' }));
    assert.equal(result?.severity, 3);
  });

  it('moderate → severity 2', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'moderate' }));
    assert.equal(result?.severity, 2);
  });

  it('low → severity 1', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'low' }));
    assert.equal(result?.severity, 1);
  });

  it('unrecognised risk → severity 0', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'negligible' }));
    assert.equal(result?.severity, 0);
  });

  it('missing riskAssessment → severity 0', () => {
    const result = bridge.normalize(raw({}));
    assert.equal(result?.severity, 0);
  });

  it('returns null when id is empty string', () => {
    assert.equal(bridge.normalize(raw({ id: '' })), null);
  });

  it('generates fallback description including riskAssessment', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'high' }));
    assert.ok(result?.description.includes('high'));
  });

  it('uses provided timestamp', () => {
    const result = bridge.normalize(raw({ riskAssessment: 'low', timestamp: 42 }));
    assert.equal(result?.timestamp, 42);
  });
});

// ── BiodisasterSignalBridge ───────────────────────────────────────────────

describe('BiodisasterSignalBridge', () => {
  const bridge = new BiodisasterSignalBridge();

  it('domain is health', () => {
    assert.equal(bridge.domain, 'health');
  });

  it('feedId is biosurv-signals', () => {
    assert.equal(bridge.feedId, 'biosurv-signals');
  });

  it('rValue 3.1 → severity 4 (> 3)', () => {
    const result = bridge.normalize(raw({ rValue: 3.1 }));
    assert.equal(result?.severity, 4);
  });

  it('rValue exactly 3 → severity 3 (not > 3)', () => {
    const result = bridge.normalize(raw({ rValue: 3 }));
    assert.equal(result?.severity, 3);
  });

  it('rValue 2.5 → severity 3 (> 2, not > 3)', () => {
    const result = bridge.normalize(raw({ rValue: 2.5 }));
    assert.equal(result?.severity, 3);
  });

  it('rValue exactly 2 → severity 2 (not > 2)', () => {
    const result = bridge.normalize(raw({ rValue: 2 }));
    assert.equal(result?.severity, 2);
  });

  it('rValue 1.7 → severity 2 (> 1.5, not > 2)', () => {
    const result = bridge.normalize(raw({ rValue: 1.7 }));
    assert.equal(result?.severity, 2);
  });

  it('rValue exactly 1.5 → severity 1 (not > 1.5)', () => {
    const result = bridge.normalize(raw({ rValue: 1.5 }));
    assert.equal(result?.severity, 1);
  });

  it('rValue 1.2 → severity 1 (> 1)', () => {
    const result = bridge.normalize(raw({ rValue: 1.2 }));
    assert.equal(result?.severity, 1);
  });

  it('rValue exactly 1 → severity 0 (not > 1)', () => {
    const result = bridge.normalize(raw({ rValue: 1 }));
    assert.equal(result?.severity, 0);
  });

  it('rValue 0.8 → severity 0', () => {
    const result = bridge.normalize(raw({ rValue: 0.8 }));
    assert.equal(result?.severity, 0);
  });

  it('rValue 0 → severity 0', () => {
    const result = bridge.normalize(raw({ rValue: 0 }));
    assert.equal(result?.severity, 0);
  });

  it('missing rValue → severity 0', () => {
    const result = bridge.normalize(raw({}));
    assert.equal(result?.severity, 0);
  });

  it('rValue as string is ignored → severity 0', () => {
    const result = bridge.normalize(raw({ rValue: '3.5' }));
    assert.equal(result?.severity, 0);
  });

  it('returns null when id is empty string', () => {
    assert.equal(bridge.normalize(raw({ id: '', rValue: 5 })), null);
  });

  it('returns null when id is missing', () => {
    const r: Record<string, unknown> = { rValue: 2.5, timestamp: NOW };
    assert.equal(bridge.normalize(r), null);
  });

  it('description includes R-value when present', () => {
    const result = bridge.normalize(raw({ rValue: 2.5 }));
    assert.ok(result?.description.includes('2.5'));
  });

  it('description omits R= notation when rValue missing', () => {
    const result = bridge.normalize(raw({}));
    assert.ok(!result?.description.includes('R='));
  });

  it('uses custom description when provided', () => {
    const result = bridge.normalize(raw({ rValue: 3.0, description: 'Outbreak cluster' }));
    assert.equal(result?.description, 'Outbreak cluster');
  });

  it('passes raw through to result', () => {
    const r = raw({ rValue: 1.8 });
    const result = bridge.normalize(r);
    assert.equal(result?.raw, r);
  });
});
