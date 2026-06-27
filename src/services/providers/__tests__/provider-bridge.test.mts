import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotsFromRegistry } from '../provider-bridge.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../provider-health.ts';
import { assessProviderRedundancy } from '../../diagnostics/provider-redundancy.ts';
import {
  getProviderHealthState,
  recordProviderFetchOutcome,
  resetProvidersStateForTest,
} from '../providers-state.ts';

const T0 = 1_750_000_000_000;
const ok = (at: number) => ({ ok: true, latencyMs: 100, httpStatus: 200, at });
const fail = (at: number) => ({ ok: false, latencyMs: 0, httpStatus: 500, at, errorMessage: 'http 500' });

test('snapshots satisfy the provider-redundancy contract', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'opensky', ok(T0));
  s = recordFetchOutcome(s, 'wingbits', ok(T0));
  const snapshots = snapshotsFromRegistry(s, T0 + 1000, 'adsb');
  const report = assessProviderRedundancy({ generatedAt: T0 + 1000, snapshots });
  const adsb = report.domains.find((d) => d.domain === 'adsb');
  assert.ok(adsb);
  // Two providers up but snapshotsFromRegistry emits no fact fingerprints, so
  // agreement can't be verified — 'redundant_unverified', not a false
  // full-confidence 'redundant_agreement'.
  assert.equal(adsb.verdict, 'redundant_unverified');
});

test('primary down with healthy backup maps to the right verdict', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < 3; i++) s = recordFetchOutcome(s, 'opensky', fail(T0 + i)); // primary down
  s = recordFetchOutcome(s, 'wingbits', ok(T0));
  // only the two providers with data, so backups without outcomes don't dilute the verdict
  const snapshots = snapshotsFromRegistry(s, T0 + 1000, 'adsb').filter(
    (snap) => snap.providerId === 'opensky' || snap.providerId === 'wingbits',
  );
  const report = assessProviderRedundancy({ generatedAt: T0 + 1000, snapshots });
  assert.equal(report.domains[0].verdict, 'primary_down_with_backup');
});

test('status maps to ProviderHealthLevel: down→failing, stale→silent', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < 3; i++) s = recordFetchOutcome(s, 'nws-alerts', fail(T0 + i));
  s = recordFetchOutcome(s, 'gdacs', ok(T0)); // gdacs TTL 30 min
  const all = snapshotsFromRegistry(s, T0 + 60 * 60_000);
  assert.equal(all.find((p) => p.providerId === 'nws-alerts')?.level, 'failing');
  assert.equal(all.find((p) => p.providerId === 'gdacs')?.level, 'silent');
});

test('primary flag comes from fallbackPriority === 1', () => {
  const all = snapshotsFromRegistry(emptyProviderHealthState(), T0, 'adsb');
  assert.equal(all.find((p) => p.providerId === 'opensky')?.primary, true);
  assert.equal(all.find((p) => p.providerId === 'wingbits')?.primary, false);
});

test('singleton state records and resets', () => {
  resetProvidersStateForTest();
  recordProviderFetchOutcome('nws-alerts', ok(T0));
  assert.equal(getProviderHealthState().outcomes['nws-alerts']?.length, 1);
  resetProvidersStateForTest();
  assert.deepEqual(getProviderHealthState().outcomes, {});
});
