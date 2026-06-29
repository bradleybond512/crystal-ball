import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_DEFINITIONS,
  getProviderDefinition,
  providersForDomain,
  independentGroupsFor,
} from '../provider-registry.ts';

test('all definitions are valid', () => {
  const ids = new Set<string>();
  for (const def of PROVIDER_DEFINITIONS) {
    assert.ok(!ids.has(def.id), `duplicate id ${def.id}`);
    ids.add(def.id);
    assert.ok(def.freshnessTtlMs > 0, `${def.id} ttl must be > 0`);
    assert.ok(def.reliabilityWeight > 0 && def.reliabilityWeight <= 1, `${def.id} weight out of range`);
    assert.ok(def.fallbackPriority >= 1, `${def.id} fallbackPriority must be >= 1`);
    assert.ok(def.independenceGroup.length > 0, `${def.id} needs an independenceGroup`);
    if (def.authType !== 'none') {
      assert.ok(def.requiredSecret, `${def.id} is keyed but has no requiredSecret`);
    }
  }
});

test('getProviderDefinition returns the definition or undefined', () => {
  assert.equal(getProviderDefinition('nws-alerts')?.domain, 'weather');
  assert.equal(getProviderDefinition('nope'), undefined);
});

test('providersForDomain sorts by fallbackPriority', () => {
  const adsb = providersForDomain('adsb');
  assert.ok(adsb.length >= 2, 'adsb should have redundancy');
  for (let i = 1; i < adsb.length; i++) {
    assert.ok(adsb[i].fallbackPriority >= adsb[i - 1].fallbackPriority);
  }
});

test('independentGroupsFor collapses shared-upstream providers', () => {
  // adsb-lol + adsb-fi + airplanes-live share community ADS-B receivers
  const groups = independentGroupsFor(['adsb-lol', 'adsb-fi', 'airplanes-live', 'opensky']);
  assert.equal(groups.size, 2);
});

test('exactly one primary per domain', () => {
  const domains = new Set(PROVIDER_DEFINITIONS.map((d) => d.domain));
  for (const domain of domains) {
    const primaries = providersForDomain(domain).filter((d) => d.fallbackPriority === 1);
    assert.equal(primaries.length, 1, `${domain} must have exactly one primary`);
  }
});

test('emsc-seismic is registered as an independent earthquake source', () => {
  const emsc = getProviderDefinition('emsc-seismic');
  assert.ok(emsc, 'emsc-seismic must be registered');
  assert.equal(emsc!.domain, 'disasters');
  assert.equal(emsc!.independenceGroup, 'emsc');
  assert.notEqual(emsc!.independenceGroup, getProviderDefinition('usgs-earthquakes')!.independenceGroup);
  // USGS + EMSC must read as 2 independent groups (drives corroboration 0.8).
  assert.equal(independentGroupsFor(['usgs-earthquakes', 'emsc-seismic']).size, 2);
});
