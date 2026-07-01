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

// ── Intel Expansion Cluster 1 ─────────────────────────────────────────────────

test('Intel Cluster 1: all 4 new provider ids are registered', () => {
  const ids = ['feodo-abuse-ch', 'threatfox-abuse-ch', 'urlhaus-abuse-ch', 'frankfurter-fx'];
  for (const id of ids) {
    assert.ok(getProviderDefinition(id), `${id} must be registered`);
  }
});

test('Intel Cluster 1: abuse.ch trio share a single independence group', () => {
  // All three are operated by abuse.ch — one upstream, not three independent votes.
  const groups = independentGroupsFor(['feodo-abuse-ch', 'threatfox-abuse-ch', 'urlhaus-abuse-ch']);
  assert.equal(groups.size, 1, 'abuse.ch trio must collapse to 1 independence group');
  assert.ok(groups.has('abuse-ch'));
});

test('Intel Cluster 1: abuse.ch trio are all cyber_threat domain', () => {
  const trio = ['feodo-abuse-ch', 'threatfox-abuse-ch', 'urlhaus-abuse-ch'];
  for (const id of trio) {
    const def = getProviderDefinition(id)!;
    assert.equal(def.domain, 'cyber_threat', `${id} must be domain cyber_threat`);
    assert.equal(def.authType, 'none', `${id} must be keyless`);
    assert.equal(def.freshnessTtlMs, 10 * 60 * 1000, `${id} TTL must be 10 min`);
    assert.ok(def.reliabilityWeight >= 0.7 && def.reliabilityWeight <= 1.0);
  }
});

test('Intel Cluster 1: frankfurter-fx is fx domain with ecb-fx independence group', () => {
  const fx = getProviderDefinition('frankfurter-fx')!;
  assert.ok(fx, 'frankfurter-fx must be registered');
  assert.equal(fx.domain, 'fx');
  assert.equal(fx.independenceGroup, 'ecb-fx');
  assert.equal(fx.authType, 'none');
  // ~12h TTL
  assert.equal(fx.freshnessTtlMs, 12 * 60 * 60 * 1000);
  assert.ok(fx.reliabilityWeight >= 0.8);
});

test('Intel Cluster 1: abuse.ch trio independence group is separate from frankfurter', () => {
  const allFour = independentGroupsFor([
    'feodo-abuse-ch', 'threatfox-abuse-ch', 'urlhaus-abuse-ch', 'frankfurter-fx',
  ]);
  // abuse-ch (1 group) + ecb-fx (1 group) = 2 total
  assert.equal(allFour.size, 2);
});

test('Intel Cluster 1: cyber_threat domain providers sort by fallbackPriority', () => {
  const cyberThreat = providersForDomain('cyber_threat');
  assert.ok(cyberThreat.length >= 3, 'cyber_threat must have at least 3 providers');
  for (let i = 1; i < cyberThreat.length; i++) {
    assert.ok(cyberThreat[i].fallbackPriority >= cyberThreat[i - 1].fallbackPriority);
  }
});

// ── Intel Expansion Cluster 2: IMF PortWatch ─────────────────────────────────

test('Intel Cluster 2: imf-portwatch is registered', () => {
  const def = getProviderDefinition('imf-portwatch');
  assert.ok(def, 'imf-portwatch must be registered');
});

test('Intel Cluster 2: imf-portwatch has correct domain and auth', () => {
  const def = getProviderDefinition('imf-portwatch')!;
  assert.equal(def.domain, 'supply_chain');
  assert.equal(def.authType, 'none');
  assert.equal(def.independenceGroup, 'imf-portwatch');
  assert.equal(def.baseUrl, 'https://services9.arcgis.com');
});

test('Intel Cluster 2: imf-portwatch TTL is 6 hours', () => {
  const def = getProviderDefinition('imf-portwatch')!;
  assert.equal(def.freshnessTtlMs, 6 * 60 * 60 * 1000);
});

test('Intel Cluster 2: imf-portwatch reliability is >= 0.85', () => {
  const def = getProviderDefinition('imf-portwatch')!;
  assert.ok(def.reliabilityWeight >= 0.85, `reliabilityWeight ${def.reliabilityWeight} must be >= 0.85`);
});

test('Intel Cluster 2: supply_chain domain has exactly one primary', () => {
  const primaries = providersForDomain('supply_chain').filter(d => d.fallbackPriority === 1);
  assert.equal(primaries.length, 1, 'supply_chain must have exactly one primary provider');
  assert.equal(primaries[0].id, 'imf-portwatch');
});

test('Intel Cluster 2: imf-portwatch independence group is isolated from cyber and fx', () => {
  const groups = independentGroupsFor(['feodo-abuse-ch', 'frankfurter-fx', 'imf-portwatch']);
  // abuse-ch + ecb-fx + imf-portwatch = 3 distinct groups
  assert.equal(groups.size, 3);
});

// ── Intel Expansion Cluster 3 ─────────────────────────────────────────────────

test('Intel Cluster 3: ioda is registered in internet_health domain', () => {
  const def = getProviderDefinition('ioda');
  assert.ok(def, 'ioda must be registered');
  assert.equal(def.domain, 'internet_health');
  assert.equal(def.authType, 'none');
  assert.equal(def.independenceGroup, 'ioda');
  assert.equal(def.freshnessTtlMs, 15 * 60 * 1000);
  assert.ok(def.reliabilityWeight >= 0.8);
});

test('Intel Cluster 3: openfda is registered in health domain', () => {
  const def = getProviderDefinition('openfda');
  assert.ok(def, 'openfda must be registered');
  assert.equal(def.domain, 'health');
  assert.equal(def.authType, 'none');
  assert.equal(def.independenceGroup, 'openfda');
  assert.equal(def.freshnessTtlMs, 6 * 60 * 60 * 1000);
  assert.ok(def.reliabilityWeight >= 0.85);
});

test('Intel Cluster 3: ornl-odin is registered in grid domain', () => {
  const def = getProviderDefinition('ornl-odin');
  assert.ok(def, 'ornl-odin must be registered');
  assert.equal(def.domain, 'grid');
  assert.equal(def.authType, 'none');
  assert.equal(def.independenceGroup, 'ornl-odin');
  assert.equal(def.freshnessTtlMs, 15 * 60 * 1000);
  assert.ok(def.reliabilityWeight >= 0.8);
});

test('Intel Cluster 3: copernicus-ems is registered in disasters domain', () => {
  const def = getProviderDefinition('copernicus-ems');
  assert.ok(def, 'copernicus-ems must be registered');
  assert.equal(def.domain, 'disasters');
  assert.equal(def.authType, 'none');
  assert.equal(def.independenceGroup, 'copernicus-ems');
  assert.equal(def.freshnessTtlMs, 30 * 60 * 1000);
  assert.ok(def.reliabilityWeight >= 0.85);
});

test('Intel Cluster 3: gleif is registered in entities domain', () => {
  const def = getProviderDefinition('gleif');
  assert.ok(def, 'gleif must be registered');
  assert.equal(def.domain, 'entities');
  assert.equal(def.authType, 'none');
  assert.equal(def.independenceGroup, 'gleif');
  assert.equal(def.freshnessTtlMs, 24 * 60 * 60 * 1000);
  assert.ok(def.reliabilityWeight >= 0.85);
});

test('Intel Cluster 3: all 5 new providers have isolated independence groups', () => {
  const newIds = ['ioda', 'openfda', 'ornl-odin', 'copernicus-ems', 'gleif'];
  const groups = independentGroupsFor(newIds);
  // Each has a unique independence group → 5 distinct groups
  assert.equal(groups.size, 5, 'all 5 Cluster 3 providers must have distinct independence groups');
});

test('Intel Cluster 3: internet_health domain has ioda as primary', () => {
  const primaries = providersForDomain('internet_health').filter(d => d.fallbackPriority === 1);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, 'ioda');
});

test('Intel Cluster 3: grid domain has ornl-odin as primary', () => {
  const primaries = providersForDomain('grid').filter(d => d.fallbackPriority === 1);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, 'ornl-odin');
});

test('Intel Cluster 3: entities domain has gleif as primary', () => {
  const primaries = providersForDomain('entities').filter(d => d.fallbackPriority === 1);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, 'gleif');
});

test('Intel Cluster 3: disasters domain has copernicus-ems as one of its providers', () => {
  const disasters = providersForDomain('disasters');
  const ems = disasters.find(d => d.id === 'copernicus-ems');
  assert.ok(ems, 'copernicus-ems must appear in disasters domain');
  assert.ok(ems.fallbackPriority > 1, 'copernicus-ems is supplementary (fallbackPriority > 1)');
});

test('Intel Cluster 3: Cluster 3 independence groups are isolated from Clusters 1 and 2', () => {
  const allIds = ['feodo-abuse-ch', 'frankfurter-fx', 'imf-portwatch', 'ioda', 'openfda', 'ornl-odin', 'copernicus-ems', 'gleif'];
  const groups = independentGroupsFor(allIds);
  // abuse-ch(1) + ecb-fx(1) + imf-portwatch(1) + 5 new = 8 distinct groups
  assert.equal(groups.size, 8);
});

// ── Intel Expansion Cluster 4 ─────────────────────────────────────────────────

test('Intel Cluster 4: gdelt-gkg is registered in osint domain', () => {
  const def = getProviderDefinition('gdelt-gkg');
  assert.ok(def, 'gdelt-gkg must be registered');
  assert.equal(def!.domain, 'osint');
  assert.equal(def!.authType, 'none');
  assert.equal(def!.independenceGroup, 'gdelt');
  assert.equal(def!.freshnessTtlMs, 15 * 60 * 1000);
  assert.ok(def!.reliabilityWeight > 0 && def!.reliabilityWeight <= 1);
});

test('Intel Cluster 4: swpc-ovation is registered in space_weather domain as primary', () => {
  const def = getProviderDefinition('swpc-ovation');
  assert.ok(def, 'swpc-ovation must be registered');
  assert.equal(def!.domain, 'space_weather');
  assert.equal(def!.authType, 'none');
  assert.equal(def!.independenceGroup, 'noaa-swpc');
  assert.equal(def!.fallbackPriority, 1);
  assert.equal(def!.freshnessTtlMs, 15 * 60 * 1000);
});

test('Intel Cluster 4: swpc-solar-regions shares noaa-swpc independence group with swpc-ovation', () => {
  const def = getProviderDefinition('swpc-solar-regions');
  assert.ok(def, 'swpc-solar-regions must be registered');
  assert.equal(def!.domain, 'space_weather');
  assert.equal(def!.independenceGroup, 'noaa-swpc');
  // same upstream → collapses to 1 independence group
  const groups = independentGroupsFor(['swpc-ovation', 'swpc-solar-regions']);
  assert.equal(groups.size, 1, 'swpc-ovation and swpc-solar-regions must collapse to 1 group');
});

test('Intel Cluster 4: space_weather domain has swpc-ovation as primary', () => {
  const primaries = providersForDomain('space_weather').filter(d => d.fallbackPriority === 1);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, 'swpc-ovation');
});

test('Intel Cluster 4: aviationweather-hazards is in aviation domain sharing noaa group', () => {
  const def = getProviderDefinition('aviationweather-hazards');
  assert.ok(def, 'aviationweather-hazards must be registered');
  assert.equal(def!.domain, 'aviation');
  assert.equal(def!.authType, 'none');
  assert.equal(def!.independenceGroup, 'noaa');
  assert.equal(def!.freshnessTtlMs, 10 * 60 * 1000);
  // Same upstream as aviationweather-gov — must NOT count as an independent vote
  const groups = independentGroupsFor(['aviationweather-gov', 'aviationweather-hazards']);
  assert.equal(groups.size, 1, 'aviationweather-gov and aviationweather-hazards share noaa group');
});

test('Intel Cluster 4: faa-nas is in aviation domain with faa independence group', () => {
  const def = getProviderDefinition('faa-nas');
  assert.ok(def, 'faa-nas must be registered');
  assert.equal(def!.domain, 'aviation');
  assert.equal(def!.authType, 'none');
  assert.equal(def!.independenceGroup, 'faa');
  assert.equal(def!.freshnessTtlMs, 5 * 60 * 1000);
  assert.ok(def!.reliabilityWeight >= 0.9);
});

test('Intel Cluster 4: faa-nas independence group is separate from noaa', () => {
  const groups = independentGroupsFor(['aviationweather-gov', 'faa-nas']);
  // noaa (1) + faa (1) = 2 independent groups
  assert.equal(groups.size, 2);
});

test('Intel Cluster 4: bfs-odl is registered in nuclear domain', () => {
  const def = getProviderDefinition('bfs-odl');
  assert.ok(def, 'bfs-odl must be registered');
  assert.equal(def!.domain, 'nuclear');
  assert.equal(def!.authType, 'none');
  assert.equal(def!.independenceGroup, 'bfs-odl');
  assert.equal(def!.freshnessTtlMs, 60 * 60 * 1000);
  assert.ok(def!.reliabilityWeight >= 0.9);
  assert.equal(def!.fallbackPriority, 1);
});

test('Intel Cluster 4: nuclear domain has bfs-odl as primary', () => {
  const primaries = providersForDomain('nuclear').filter(d => d.fallbackPriority === 1);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, 'bfs-odl');
});

test('Intel Cluster 4: all new domains are isolated from each other', () => {
  // gdelt (osint), noaa-swpc (space_weather x2), noaa (aviation), faa (aviation), bfs-odl (nuclear)
  const newIds = ['gdelt-gkg', 'swpc-ovation', 'swpc-solar-regions', 'aviationweather-hazards', 'faa-nas', 'bfs-odl'];
  const groups = independentGroupsFor(newIds);
  // gdelt(1) + noaa-swpc(1, both swpc collapse) + noaa(1, aviationweather-hazards) + faa(1) + bfs-odl(1) = 5 distinct groups
  assert.equal(groups.size, 5);
});

test('Intel Cluster 4: all 6 new providers are registered and valid', () => {
  const ids = ['gdelt-gkg', 'swpc-ovation', 'swpc-solar-regions', 'aviationweather-hazards', 'faa-nas', 'bfs-odl'];
  for (const id of ids) {
    const def = getProviderDefinition(id);
    assert.ok(def, `${id} must be registered`);
    assert.ok(def!.freshnessTtlMs > 0, `${id} freshnessTtlMs must be > 0`);
    assert.ok(def!.reliabilityWeight > 0 && def!.reliabilityWeight <= 1, `${id} reliabilityWeight out of range`);
    assert.equal(def!.authType, 'none', `${id} must be keyless`);
  }
});
