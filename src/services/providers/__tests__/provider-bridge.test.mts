import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoteUnconfiguredProviders, snapshotsFromRegistry } from '../provider-bridge.ts';
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

test('two up but only one carries a fingerprint → redundant_unverified, not agreement', () => {
  const report = assessProviderRedundancy({ generatedAt: T0, snapshots: [
    { providerId: 'usgs-earthquakes', domain: 'disasters', label: 'USGS', primary: false, level: 'healthy', recentFactFingerprint: 'c:v:12' },
    { providerId: 'gdacs', domain: 'disasters', label: 'GDACS', primary: true, level: 'healthy' },
  ] });
  const d = report.domains.find((x) => x.domain === 'disasters')!;
  assert.equal(d.verdict, 'redundant_unverified');
  assert.notEqual(d.confidenceMultiplier, 1);
});

test('lone healthy non-primary source reads single_source, not primary_down_with_backup', () => {
  const report = assessProviderRedundancy({ generatedAt: T0, snapshots: [
    { providerId: 'usgs-earthquakes', domain: 'disasters', label: 'USGS', primary: false, level: 'healthy', recentFactFingerprint: 'c:v:12' },
    { providerId: 'emsc-seismic', domain: 'disasters', label: 'EMSC', primary: false, level: 'silent' },
  ] });
  const d = report.domains.find((x) => x.domain === 'disasters')!;
  assert.equal(d.verdict, 'single_source');
});

// ── Unconfigured key-gated providers must not vote "up" ──────────────────
// A provider whose requiredSecret is missing is structurally unreachable. Its
// fetch fails once at boot, which is NOT enough to trip
// DOWN_CONSECUTIVE_FAILURES (3), so deriveProviderHealth pins it at 'degraded'
// — and provider-redundancy counts 'degraded' as UP. Result: a domain claims
// corroboration from a provider that can never answer.

const NO_SECRETS = () => false;
const ALL_SECRETS = () => true;

test('unconfigured key-gated provider is demoted to failing, not left degraded', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'cloudflare-radar', fail(T0)); // single boot failure
  const raw = snapshotsFromRegistry(s, T0 + 1000, 'internet_health');
  assert.equal(raw.find((p) => p.providerId === 'cloudflare-radar')?.level, 'degraded');

  const gated = demoteUnconfiguredProviders(raw, NO_SECRETS);
  const cf = gated.find((p) => p.providerId === 'cloudflare-radar');
  assert.equal(cf?.level, 'failing');
  assert.match(String(cf?.lastError), /CLOUDFLARE_API_TOKEN/);
  // Typed, so remediation can name the key without parsing the free-text error.
  assert.equal(cf?.unconfiguredSecret, 'CLOUDFLARE_API_TOKEN');
});

test('commodities with an unconfigured EIA key reads not_configured, not all_down', () => {
  // EIA is the only provider in this domain, so an unset key leaves it blind.
  // The honest fix is "enter the key", not "check the sidecar".
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'eia', fail(T0));
  const snapshots = demoteUnconfiguredProviders(
    snapshotsFromRegistry(s, T0 + 1000, 'commodities'),
    NO_SECRETS,
  );
  const d = assessProviderRedundancy({ generatedAt: T0 + 1000, snapshots }).domains[0]!;
  assert.equal(d.verdict, 'not_configured');
  assert.equal(d.confidenceMultiplier, 0);
  assert.match(d.remediation, /EIA_API_KEY/);
});

test('internet_health with unconfigured Cloudflare reads single_source, not "2 of 2 up"', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'ioda', ok(T0));
  s = recordFetchOutcome(s, 'cloudflare-radar', fail(T0));
  const snapshots = demoteUnconfiguredProviders(
    snapshotsFromRegistry(s, T0 + 1000, 'internet_health'),
    NO_SECRETS,
  );
  const report = assessProviderRedundancy({ generatedAt: T0 + 1000, snapshots });
  const d = report.domains.find((x) => x.domain === 'internet_health')!;
  assert.equal(d.verdict, 'single_source');
  assert.equal(d.confidenceMultiplier, 0.7);
  assert.doesNotMatch(d.reason, /2 of 2 providers up/);
});

test('configured key-gated provider is left exactly as-is', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'cloudflare-radar', fail(T0));
  const raw = snapshotsFromRegistry(s, T0 + 1000, 'internet_health');
  assert.deepEqual(demoteUnconfiguredProviders(raw, ALL_SECRETS), raw);
});

test('keyless providers are never demoted, whatever the predicate says', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'ioda', ok(T0));
  const gated = demoteUnconfiguredProviders(
    snapshotsFromRegistry(s, T0 + 1000, 'internet_health'),
    NO_SECRETS,
  );
  assert.equal(gated.find((p) => p.providerId === 'ioda')?.level, 'healthy');
});

test('aggregate diagnostics are not demoted just because a keyed upstream is unconfigured', () => {
  // 'economic' and 'oil' are NOT the registry's 'fred' and 'eia'. They are
  // aggregate SourceDiagnostics over several upstreams: fetchFredData() falls
  // back to free sidecar sources and fetchOilAnalytics() to Yahoo, both of which
  // record success with no key present (src/services/economic/index.ts).
  // Aliasing them onto the keyed definitions would zero a domain that is in fact
  // delivering data — a false demotion, worse than the overstatement this gate
  // exists to prevent. The gate keys on registry ids only.
  const raw = [
    { providerId: 'economic', domain: 'economic', label: 'Economic Data (FRED)', primary: true, level: 'healthy' as const },
    { providerId: 'oil', domain: 'oil', label: 'Oil Analytics (EIA)', primary: true, level: 'healthy' as const },
  ];
  assert.deepEqual(demoteUnconfiguredProviders(raw, NO_SECRETS), raw);
});

test('snapshotsFromRegistry attaches fingerprints when provided', () => {
  let s = emptyProviderHealthState();
  for (const id of ['usgs-earthquakes', 'emsc-seismic']) {
    s = recordFetchOutcome(s, id, ok(T0));
  }
  const snaps = snapshotsFromRegistry(s, T0 + 1000, 'disasters', {
    'usgs-earthquakes': 'v:12',
    'emsc-seismic': 'v:12',
  });
  const usgs = snaps.find((x) => x.providerId === 'usgs-earthquakes');
  const emsc = snaps.find((x) => x.providerId === 'emsc-seismic');
  assert.equal(usgs?.recentFactFingerprint, 'v:12');
  assert.equal(emsc?.recentFactFingerprint, 'v:12');
  // providers without a supplied fingerprint stay undefined
  const gdacs = snaps.find((x) => x.providerId === 'gdacs');
  assert.equal(gdacs?.recentFactFingerprint, undefined);
});
