/**
 * Phase 2 acceptance — Personal Exposure Graph end-to-end.
 *
 * Vision doc Phase 2 success criteria:
 *   - Every situation has a user exposure score
 *   - User-exposed events rank above distant global noise
 *   - Alerts explain the exposure reason
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  cyberThreatsToSituations,
  militaryPosturesToSituations,
  weatherAlertsToSituations,
  type ExposureGraph,
} from '../index';
import { createSituationStore } from '../situation-store';

const NOW = 1_745_000_000_000;

const FULL_GRAPH: ExposureGraph = {
  savedPlaces: [
    { id: 'home', name: 'La Porte', lat: 41.6, lon: -86.7, tags: ['home'], primary: true },
  ],
  watchlist: {
    countries: ['USA', 'TWN'],
    sectors: ['finance'],
    tickers: ['AAPL'],
    vendors: ['Apple'],
    cves: [],
  },
  device: { osLabels: ['macOS'], versions: ['macOS 14'] },
};

describe('Phase 2 acceptance: every situation gets exposure from the graph', () => {
  it('weather alert near saved place → high userExposure', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [{
        id: 'wx-1',
        event: 'Tornado Warning',
        severity: 'Extreme',
        headline: 'h',
        description: 'd',
        areaDesc: 'La Porte',
        onset: new Date(NOW + 5 * 60_000),
        expires: new Date(NOW + 30 * 60_000),
        coordinates: [],
        centroid: [-86.7, 41.6],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 0) >= 0.95);
    assert.ok(s?.personalImpact.reasons[0]?.includes('La Porte'));
  });

  it('cyber threat matching user OS → high userExposure', () => {
    const [s] = cyberThreatsToSituations({
      threats: [{
        threatId: 'CVE-2026-1',
        title: 'macOS WebKit RCE',
        stagesReached: ['cve_published', 'exploit_observed'],
        affectedSectors: [],
        affectedVendors: ['Apple macOS'],
        evidence: [],
        agreeingSources: ['CISA'],
        disagreeingSources: [],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 0) >= 0.85);
    assert.ok(s?.personalImpact.reasons.some((r) => /vendor/i.test(r)));
  });

  it('military theater in watched country → meaningful userExposure', () => {
    const [s] = militaryPosturesToSituations({
      postures: [{
        theaterId: 'taiwan-strait',
        theaterName: 'Taiwan Strait',
        posture: 'strike_ready',
        postureScore: 0.8,
        countries: ['TWN'],
        evidence: [],
        agreeingSources: ['OpenSky', 'NOTAMs'],
        disagreeingSources: [],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 0) >= 0.6);
    assert.ok(s?.personalImpact.reasons.some((r) => /TWN/.test(r)));
  });
});

describe('Phase 2 acceptance: user-exposed events outrank distant ones in ranking', () => {
  it('weather affecting saved place > distant cyber + distant military', () => {
    const store = createSituationStore({ now: () => NOW });

    // Distant cyber: no user OS match
    const distantCyber = cyberThreatsToSituations({
      threats: [{
        threatId: 'CVE-2026-DIST',
        title: 'Linux kernel bug',
        stagesReached: ['cve_published', 'exploit_observed', 'kev_listed'],
        affectedSectors: [],
        affectedVendors: ['Linux kernel'],
        evidence: [],
        agreeingSources: ['CISA'],
        disagreeingSources: [],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });

    // Distant military: not in watchlist countries
    const distantMil = militaryPosturesToSituations({
      postures: [{
        theaterId: 'arctic',
        theaterName: 'Arctic',
        posture: 'elevated',
        postureScore: 0.4,
        countries: ['NOR'],
        evidence: [],
        agreeingSources: ['NATO'],
        disagreeingSources: [],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });

    // Local weather: tornado warning over saved place
    const localWx = weatherAlertsToSituations({
      alerts: [{
        id: 'wx-local',
        event: 'Tornado Warning',
        severity: 'Severe',
        headline: 'h',
        description: 'd',
        areaDesc: 'La Porte',
        onset: new Date(NOW + 10 * 60_000),
        expires: new Date(NOW + 60 * 60_000),
        coordinates: [],
        centroid: [-86.7, 41.6],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });

    [...distantCyber, ...distantMil, ...localWx].forEach((s) => store.upsert(s));
    const top = store.ranked(1);
    assert.equal(top[0]?.domain, 'weather', 'local weather should outrank distant cyber/military');
  });
});

describe('Phase 2 acceptance: alerts explain the exposure reason', () => {
  it('weather: reason names the saved place + distance', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [{
        id: 'wx-x',
        event: 'Severe Thunderstorm Warning',
        severity: 'Severe',
        headline: 'h',
        description: 'd',
        areaDesc: 'La Porte',
        onset: new Date(NOW + 30 * 60_000),
        expires: new Date(NOW + 90 * 60_000),
        coordinates: [],
        centroid: [-86.7, 41.6],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });
    assert.ok(s?.personalImpact.reasons[0]?.includes('La Porte'));
    assert.match(s?.personalImpact.reasons[0] ?? '', /\d+(\.\d+)?\s*km/);
  });

  it('cyber: reason names the matched vendor', () => {
    const [s] = cyberThreatsToSituations({
      threats: [{
        threatId: 'CVE-2026-X',
        title: 'macOS bug',
        stagesReached: ['cve_published', 'exploit_observed'],
        affectedSectors: [],
        affectedVendors: ['Apple macOS'],
        evidence: [],
        agreeingSources: ['CISA'],
        disagreeingSources: [],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });
    assert.ok(s?.personalImpact.reasons.some((r) => /Apple|vendor/i.test(r)));
  });

  it('military: reason names the matched country', () => {
    const [s] = militaryPosturesToSituations({
      postures: [{
        theaterId: 'taiwan-strait',
        theaterName: 'Taiwan Strait',
        posture: 'strike_ready',
        postureScore: 0.8,
        countries: ['TWN'],
        evidence: [],
        agreeingSources: ['OpenSky'],
        disagreeingSources: [],
      }],
      exposureGraph: FULL_GRAPH,
      now: () => NOW,
    });
    assert.ok(s?.personalImpact.reasons.some((r) => /TWN/.test(r)));
  });
});
