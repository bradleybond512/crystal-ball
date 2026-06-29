import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRedundancyView, verdictLabel, verdictTone } from '../provider-redundancy-view.ts';
import { assessProviderRedundancy, type ProviderSnapshot } from '../provider-redundancy.ts';

function snap(o: Partial<ProviderSnapshot> & Pick<ProviderSnapshot, 'providerId' | 'domain'>): ProviderSnapshot {
  return { label: o.providerId, primary: false, level: 'healthy', ...o };
}

test('verdict label + tone mapping', () => {
  assert.equal(verdictLabel('redundant_agreement'), 'Verified');
  assert.equal(verdictTone('redundant_agreement'), 'good');
  assert.equal(verdictTone('all_down'), 'bad');
  assert.equal(verdictTone('single_source'), 'warn');
  assert.equal(verdictTone('redundant_unverified'), 'neutral');
});

test('builds rows with corroborating-source counts and sorts worst-first', () => {
  const report = assessProviderRedundancy({
    generatedAt: 1,
    snapshots: [
      // disasters: verified (2 corroborating)
      snap({ providerId: 'usgs-earthquakes', domain: 'disasters', level: 'healthy', recentFactFingerprint: 'c:1' }),
      snap({ providerId: 'emsc-seismic', domain: 'disasters', level: 'healthy', recentFactFingerprint: 'c:1' }),
      // adsb: all down (bad)
      snap({ providerId: 'opensky', domain: 'adsb', primary: true, level: 'failing' }),
      snap({ providerId: 'wingbits', domain: 'adsb', level: 'silent' }),
    ],
  });
  const vm = buildRedundancyView(report);

  // worst-first: adsb (bad) before disasters (good)
  assert.equal(vm.rows[0]!.domain, 'adsb');
  assert.equal(vm.rows[0]!.tone, 'bad');

  const disasters = vm.rows.find((r) => r.domain === 'disasters')!;
  assert.equal(disasters.tone, 'good');
  assert.equal(disasters.verdict, 'redundant_agreement');
  assert.equal(disasters.corroboratingSources, 2);
  assert.equal(disasters.providersUp, 2);
  assert.equal(disasters.confidencePct, 100);

  assert.equal(vm.healthyCount, 1);
  assert.equal(vm.stressedCount, 1);
});

test('headline reflects the verified/attention split', () => {
  const allGood = buildRedundancyView(assessProviderRedundancy({
    generatedAt: 1,
    snapshots: [
      snap({ providerId: 'usgs-earthquakes', domain: 'disasters', level: 'healthy', recentFactFingerprint: 'c:1' }),
      snap({ providerId: 'emsc-seismic', domain: 'disasters', level: 'healthy', recentFactFingerprint: 'c:1' }),
    ],
  }));
  assert.match(allGood.headline, /verified across redundant sources/);

  const empty = buildRedundancyView(assessProviderRedundancy({ generatedAt: 1, snapshots: [] }));
  assert.equal(empty.rows.length, 0);
  assert.match(empty.headline, /No provider domains/);
});
