import assert from 'node:assert/strict';
import test from 'node:test';

import { assessProviderRedundancy, type ProviderSnapshot } from '../provider-redundancy.ts';
import {
  buildSourceConfidenceView,
  isFusionActive,
} from '../source-confidence-view.ts';
import { buildProviderTimeline } from '../../providers/provider-health-timeline-view.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../../providers/provider-health.ts';

const NOW = 1_745_000_000_000;

function snap(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    providerId: 'usgs-earthquakes',
    domain: 'disasters',
    label: 'USGS Earthquakes',
    primary: true,
    level: 'healthy',
    lastSuccessAt: NOW,
    successRate: 0.99,
    ...overrides,
  };
}

test('isFusionActive: only agreement/disagreement count as fusion-active', () => {
  assert.equal(isFusionActive('redundant_agreement'), true);
  assert.equal(isFusionActive('redundant_disagreement'), true);
  assert.equal(isFusionActive('redundant_unverified'), false);
  assert.equal(isFusionActive('single_source'), false);
  assert.equal(isFusionActive('primary_down_with_backup'), false);
  assert.equal(isFusionActive('all_down'), false);
  assert.equal(isFusionActive('unknown'), false);
});

test('agreement domain: fusionActive true, no provider flagged disagreeing, summary tallies it', () => {
  const report = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'usgs-earthquakes', recentFactFingerprint: 'v:12' }),
      snap({ providerId: 'emsc-seismic', primary: false, recentFactFingerprint: 'v:12', label: 'EMSC Seismic' }),
    ],
  });
  const view = buildSourceConfidenceView(report);
  const quakes = view.domains.find((d) => d.domain === 'disasters')!;
  assert.equal(quakes.verdict, 'redundant_agreement');
  assert.equal(quakes.fusionActive, true);
  assert.equal(quakes.confidencePct, 100);
  assert.ok(quakes.providers.every((p) => !p.disagreeing));
  assert.equal(view.summary.fusionVerifiedCount, 1);
  assert.equal(view.summary.disagreementCount, 0);
  assert.equal(view.summary.totalDomains, 1);
});

test('disagreement domain: the minority-fingerprint provider is flagged disagreeing', () => {
  const report = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [
      snap({ providerId: 'usgs-earthquakes', recentFactFingerprint: 'v:12' }),
      snap({ providerId: 'other-source', primary: false, recentFactFingerprint: 'v:12', label: 'Other' }),
      snap({ providerId: 'emsc-seismic', primary: false, recentFactFingerprint: 'v:15', label: 'EMSC Seismic' }),
    ],
  });
  const view = buildSourceConfidenceView(report);
  const quakes = view.domains.find((d) => d.domain === 'disasters')!;
  assert.equal(quakes.verdict, 'redundant_disagreement');
  assert.equal(quakes.fusionActive, true);
  const emsc = quakes.providers.find((p) => p.providerId === 'emsc-seismic')!;
  const usgs = quakes.providers.find((p) => p.providerId === 'usgs-earthquakes')!;
  assert.equal(emsc.disagreeing, true, 'the odd-fingerprint-out provider is flagged');
  assert.equal(usgs.disagreeing, false, 'majority-fingerprint providers are not flagged');
  assert.equal(view.summary.disagreementCount, 1);
});

test('single-source domain: fusionActive false, one provider, singleSourceCount tallied', () => {
  const report = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [snap({ domain: 'food_security', providerId: 'fews-net', label: 'FEWS NET' })],
  });
  const view = buildSourceConfidenceView(report);
  const food = view.domains.find((d) => d.domain === 'food_security')!;
  assert.equal(food.verdict, 'single_source');
  assert.equal(food.fusionActive, false);
  assert.equal(food.providers.length, 1);
  assert.equal(view.summary.singleSourceCount, 1);
});

test('all-down domain is tallied under downCount', () => {
  const report = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [snap({ domain: 'markets', providerId: 'fred', level: 'failing', successRate: 0 })],
  });
  const view = buildSourceConfidenceView(report);
  assert.equal(view.summary.downCount, 1);
});

test('empty report yields a zeroed summary with an honest headline', () => {
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: [] });
  const view = buildSourceConfidenceView(report);
  assert.equal(view.summary.totalDomains, 0);
  assert.equal(view.summary.headline, 'No provider domains reporting.');
});

test('provider timelines are threaded through onto the matching provider row', () => {
  let health = emptyProviderHealthState();
  health = recordFetchOutcome(health, 'usgs-earthquakes', { ok: true, latencyMs: 100, at: NOW });
  const timeline = buildProviderTimeline(health, 'usgs-earthquakes', NOW + 1_000);

  const report = assessProviderRedundancy({
    generatedAt: NOW,
    snapshots: [snap({ recentFactFingerprint: undefined })],
  });
  const view = buildSourceConfidenceView(report, { 'usgs-earthquakes': timeline });
  const quakes = view.domains.find((d) => d.domain === 'disasters')!;
  const row = quakes.providers.find((p) => p.providerId === 'usgs-earthquakes')!;
  assert.equal(row.timeline, timeline);
  assert.equal(row.timeline?.windowSuccessRate, 1);
});
