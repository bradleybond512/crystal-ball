import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeWeatherAlertsToInsights,
  bridgeSourcesToProviderRedundancy,
  bridgeSavedPlacesToProfile,
  type WeatherAlertLike,
  type SourceDiagnosticLike,
} from '../data-bridge.ts';
import {
  getRecentEvents,
  getActiveSituation,
  getPersonalImpactReport,
  getProviderRedundancyReport,
  getPersonalProfile,
  resetInsightsState,
} from '../insights-state.ts';
import type { SavedPlace } from '../../personal/personal-impact.ts';

const NOW = 1_745_000_000_000;

const HOME: SavedPlace = {
  placeId: 'home',
  label: 'Home',
  latitude: 41.6082,
  longitude: -86.7228,
  role: 'home',
};

function alert(overrides: Partial<WeatherAlertLike> = {}): WeatherAlertLike {
  return {
    id: 'wx-1',
    event: 'Tornado Warning',
    severity: 'Extreme',
    headline: 'Tornado Warning at home',
    areaDesc: 'St. Joseph County',
    onset: new Date(NOW),
    centroid: [-86.72, 41.61],
    ...overrides,
  };
}

test('bridgeWeatherAlertsToInsights: maps alerts → IncomingEvent[] and pushes to state', () => {
  resetInsightsState();
  bridgeSavedPlacesToProfile([HOME]);
  const result = bridgeWeatherAlertsToInsights([alert()]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.domain, 'weather');
  assert.equal(getRecentEvents().length, 1);
});

test('extreme alert near saved place becomes the active situation', () => {
  resetInsightsState();
  bridgeSavedPlacesToProfile([HOME]);
  bridgeWeatherAlertsToInsights([alert()]);
  const situation = getActiveSituation();
  assert.ok(situation);
  assert.equal(situation?.severityScore, 95);
  assert.equal(situation?.confidence, 'high');
});

test('alert far from any saved place does NOT become active situation', () => {
  resetInsightsState();
  bridgeSavedPlacesToProfile([HOME]);
  bridgeWeatherAlertsToInsights([alert({ centroid: [-100, 35] })]);
  assert.equal(getActiveSituation(), undefined);
});

test('Personal Impact picks up the alert through the bridge', () => {
  resetInsightsState();
  bridgeSavedPlacesToProfile([HOME]);
  bridgeWeatherAlertsToInsights([alert()]);
  const report = getPersonalImpactReport();
  // Severity 95 + nearby home → critical impact
  assert.equal(report.impacts.length, 1);
  assert.equal(report.impacts[0]?.severity, 'critical');
  assert.equal(report.impacts[0]?.exposures[0]?.exposureId, 'home');
});

test('multiple alerts: highest severity wins as active situation', () => {
  resetInsightsState();
  bridgeSavedPlacesToProfile([HOME]);
  const alerts: WeatherAlertLike[] = [
    alert({ id: 'minor', severity: 'Minor', headline: 'Wind Advisory' }),
    alert({ id: 'extreme', severity: 'Extreme', headline: 'Tornado Warning' }),
    alert({ id: 'moderate', severity: 'Moderate', headline: 'Heat Advisory' }),
  ];
  const result = bridgeWeatherAlertsToInsights(alerts);
  assert.equal(result.situation?.id, 'extreme');
});

test('bridgeSourcesToProviderRedundancy: maps statuses + auto-detects domains/primaries', () => {
  resetInsightsState();
  const sources: SourceDiagnosticLike[] = [
    { id: 'nws-alerts', name: 'NWS', status: 'healthy', lastUpdateMs: NOW },
    { id: 'noaa-radar', name: 'Radar', status: 'degraded', lastUpdateMs: NOW - 60_000 },
    { id: 'unknown-feed', name: 'X', status: 'silent', lastUpdateMs: null },
  ];
  const snapshots = bridgeSourcesToProviderRedundancy(sources);
  assert.equal(snapshots.length, 3);
  // nws-alerts auto-detected as weather + primary
  const nws = snapshots.find((s) => s.providerId === 'nws-alerts');
  assert.equal(nws?.domain, 'weather');
  assert.equal(nws?.primary, true);
  // unknown-feed falls back to its own id as domain, not primary
  const unk = snapshots.find((s) => s.providerId === 'unknown-feed');
  assert.equal(unk?.domain, 'unknown-feed');
  assert.equal(unk?.primary, false);
});

test('Provider redundancy report reads from the bridged snapshots', () => {
  resetInsightsState();
  bridgeSourcesToProviderRedundancy([
    { id: 'nws-alerts', name: 'NWS', status: 'healthy', lastUpdateMs: NOW },
    { id: 'noaa-radar', name: 'Radar', status: 'silent', lastUpdateMs: null },
  ]);
  const r = getProviderRedundancyReport();
  const wx = r.domains.find((d) => d.domain === 'weather');
  // Healthy primary + silent backup ≠ redundant_agreement
  assert.notEqual(wx?.verdict, 'redundant_agreement');
});

test('unconfigured key-gated provider cannot cast an "up" vote', () => {
  resetInsightsState();
  // No secrets are loaded in the test runtime, so CLOUDFLARE_API_TOKEN is
  // unconfigured. Even though the diagnostic reports 'degraded' (the state a
  // single boot failure produces), the provider is structurally unreachable
  // and must not corroborate IODA.
  const snapshots = bridgeSourcesToProviderRedundancy([
    { id: 'ioda', name: 'IODA', status: 'healthy', lastUpdateMs: NOW },
    { id: 'cloudflare-radar', name: 'Cloudflare Radar', status: 'degraded', lastUpdateMs: NOW },
  ]);
  const cf = snapshots.find((s) => s.providerId === 'cloudflare-radar');
  assert.equal(cf?.level, 'failing');

  const net = getProviderRedundancyReport().domains.find((d) => d.domain === 'internet_health');
  assert.equal(net?.verdict, 'single_source');
  assert.doesNotMatch(String(net?.reason), /2 of 2 providers up/);
});

test('keyless providers are unaffected by the secret gate', () => {
  resetInsightsState();
  const snapshots = bridgeSourcesToProviderRedundancy([
    { id: 'ioda', name: 'IODA', status: 'healthy', lastUpdateMs: NOW },
  ]);
  assert.equal(snapshots.find((s) => s.providerId === 'ioda')?.level, 'healthy');
});

test('bridgeSavedPlacesToProfile updates only savedPlaces', () => {
  resetInsightsState();
  bridgeSavedPlacesToProfile([HOME]);
  const profile = getPersonalProfile();
  assert.equal(profile.savedPlaces.length, 1);
  assert.equal(profile.savedPlaces[0]?.placeId, 'home');
});
