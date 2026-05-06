import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneDefaults,
  filterAlertsByTierToggles,
  mergeWithDefaults,
} from '../eew-settings.ts';
import type { EewAlert } from '../eew-alert-engine.ts';

function alert(tier: EewAlert['tier']): EewAlert {
  return { eventId: tier, tier, reason: '', triggeredAt: 0 };
}

test('cloneDefaults: every tier enabled, iMessage TIER_5 enabled', () => {
  const d = cloneDefaults();
  assert.equal(d.tierEnabled.TIER_1_INFO, true);
  assert.equal(d.tierEnabled.TIER_2_WATCH, true);
  assert.equal(d.tierEnabled.TIER_3_WARNING, true);
  assert.equal(d.tierEnabled.TIER_4_SEVERE, true);
  assert.equal(d.tierEnabled.TIER_5_EXTREME, true);
  assert.equal(d.imessageTier5Enabled, true);
});

test('cloneDefaults returns independent objects', () => {
  const a = cloneDefaults();
  const b = cloneDefaults();
  a.tierEnabled.TIER_3_WARNING = false;
  assert.equal(b.tierEnabled.TIER_3_WARNING, true);
});

test('mergeWithDefaults: empty input → defaults', () => {
  const merged = mergeWithDefaults({});
  assert.deepEqual(merged, cloneDefaults());
});

test('mergeWithDefaults: partial tier override', () => {
  const merged = mergeWithDefaults({
    tierEnabled: { TIER_1_INFO: false, TIER_5_EXTREME: false } as never,
  });
  assert.equal(merged.tierEnabled.TIER_1_INFO, false);
  assert.equal(merged.tierEnabled.TIER_5_EXTREME, false);
  // Untouched tiers remain at default true.
  assert.equal(merged.tierEnabled.TIER_3_WARNING, true);
});

test('mergeWithDefaults: imessageTier5Enabled override', () => {
  const merged = mergeWithDefaults({ imessageTier5Enabled: false });
  assert.equal(merged.imessageTier5Enabled, false);
});

test('mergeWithDefaults: ignores non-boolean values', () => {
  const merged = mergeWithDefaults({
    tierEnabled: { TIER_1_INFO: 'yes' } as never,
    imessageTier5Enabled: 1 as never,
  });
  // Bad values fall back to defaults.
  assert.equal(merged.tierEnabled.TIER_1_INFO, true);
  assert.equal(merged.imessageTier5Enabled, true);
});

test('filterAlertsByTierToggles: passes everything when all enabled', () => {
  const settings = cloneDefaults();
  const alerts = [alert('TIER_1_INFO'), alert('TIER_3_WARNING'), alert('TIER_5_EXTREME')];
  const out = filterAlertsByTierToggles(alerts, settings);
  assert.equal(out.length, 3);
});

test('filterAlertsByTierToggles: drops disabled tiers', () => {
  const settings = cloneDefaults();
  settings.tierEnabled.TIER_1_INFO = false;
  settings.tierEnabled.TIER_3_WARNING = false;
  const alerts = [alert('TIER_1_INFO'), alert('TIER_3_WARNING'), alert('TIER_5_EXTREME')];
  const out = filterAlertsByTierToggles(alerts, settings);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.tier, 'TIER_5_EXTREME');
});

test('filterAlertsByTierToggles: empty input returns empty', () => {
  assert.deepEqual(filterAlertsByTierToggles([], cloneDefaults()), []);
});
