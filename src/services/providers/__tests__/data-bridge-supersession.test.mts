import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeSourcesToProviderRedundancy } from '../../insights/data-bridge.ts';
import { resetProvidersStateForTest, getProviderHealthState } from '../providers-state.ts';

beforeEach(() => resetProvidersStateForTest());

test('registry-known source gets registry metadata, not the legacy map', () => {
  const snapshots = bridgeSourcesToProviderRedundancy([
    { id: 'nws-alerts', name: 'whatever the caller said', status: 'healthy', lastUpdateMs: 1_750_000_000_000 },
  ]);
  const nws = snapshots.find((s) => s.providerId === 'nws-alerts');
  assert.ok(nws);
  assert.equal(nws.label, 'NWS Alerts');       // displayName from registry
  assert.equal(nws.domain, 'weather');
  assert.equal(nws.primary, true);              // fallbackPriority === 1
});

test('registry-known source records a fetch outcome into providers-state', () => {
  bridgeSourcesToProviderRedundancy([
    { id: 'nws-alerts', name: 'NWS', status: 'healthy', lastUpdateMs: 1_750_000_000_000 },
  ]);
  assert.equal(getProviderHealthState().outcomes['nws-alerts']?.length, 1);
});

test('unregistered source falls back to the legacy translation', () => {
  const snapshots = bridgeSourcesToProviderRedundancy([
    { id: 'some-legacy-feed', name: 'Legacy Feed', status: 'degraded' },
  ]);
  const legacy = snapshots.find((s) => s.providerId === 'some-legacy-feed');
  assert.ok(legacy);
  assert.equal(legacy.label, 'Legacy Feed');
  assert.equal(legacy.level, 'degraded');
});
