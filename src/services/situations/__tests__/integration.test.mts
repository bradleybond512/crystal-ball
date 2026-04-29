/**
 * Integration test — Phase 1 acceptance criteria from
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md:
 *
 *   - Military, cyber, and weather can all produce normalized situations.
 *   - The command center can rank situations by impact.
 *
 * This test feeds one input from each domain into the store and
 * asserts the ranked output respects severity × confidence ordering.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSituationStore,
  weatherAlertsToSituations,
  militaryPosturesToSituations,
  cyberThreatsToSituations,
  type SituationStore,
} from '../index';

const NOW = 1_745_000_000_000;

let store: SituationStore;

beforeEach(() => {
  store = createSituationStore({ now: () => NOW });
});

describe('Phase 1 acceptance: cross-domain ingest + ranking', () => {
  it('all three adapters emit Situations the store accepts', () => {
    const wx = weatherAlertsToSituations({
      alerts: [{
        id: 'wx-1',
        event: 'Tornado Warning',
        severity: 'Extreme',
        headline: 'Tornado near La Porte',
        description: 'Confirmed tornado.',
        areaDesc: 'La Porte',
        onset: new Date(NOW + 5 * 60_000),
        expires: new Date(NOW + 30 * 60_000),
        coordinates: [],
        centroid: [-86.7, 41.6],
      }],
      savedPlaces: [{ id: 'home', name: 'La Porte', lat: 41.6, lon: -86.7 }],
      now: () => NOW,
    });

    const mil = militaryPosturesToSituations({
      postures: [{
        theaterId: 'taiwan-strait',
        theaterName: 'Taiwan Strait',
        posture: 'strike_ready',
        postureScore: 0.78,
        priorScore: 0.5,
        evidence: [{ id: 'e1', source: 'OpenSky', claim: 'Surge', observedAt: NOW, weight: 0.6 }],
        agreeingSources: ['OpenSky', 'NOTAMs', 'Reuters'],
        disagreeingSources: [],
        observedAt: NOW,
      }],
      now: () => NOW,
    });

    const cy = cyberThreatsToSituations({
      threats: [{
        threatId: 'CVE-2026-12345',
        title: 'Critical macOS WebKit RCE',
        stagesReached: ['cve_published', 'exploit_observed', 'kev_listed'],
        affectedSectors: ['consumer_software'],
        affectedVendors: ['Apple macOS'],
        evidence: [{ id: 'cisa', source: 'CISA KEV', claim: 'KEV', observedAt: NOW, weight: 0.9 }],
        agreeingSources: ['CISA', 'Apple'],
        disagreeingSources: [],
      }],
      user: { userVendors: ['macos'] },
      now: () => NOW,
    });

    [...wx, ...mil, ...cy].forEach((s) => store.upsert(s));

    const ranked = store.ranked();
    assert.equal(ranked.length, 3);
    // The Extreme/Tornado Warning with high user-exposure should
    // outrank the others; this matches the vision doc's principle
    // that user-exposed events rank above distant global noise.
    assert.equal(ranked[0]?.domain, 'weather');
    // All three domains must be represented
    const domains = new Set(ranked.map((s) => s.domain));
    assert.equal(domains.size, 3);
  });

  it('every emitted Situation has a non-empty diagnosticsTrace', () => {
    const wx = weatherAlertsToSituations({
      alerts: [{
        id: 'wx-2', event: 'Severe Thunderstorm Warning', severity: 'Severe',
        headline: 'h', description: 'd', areaDesc: 'a',
        onset: new Date(NOW), expires: new Date(NOW + 60_000),
        coordinates: [], centroid: [-86.7, 41.6],
      }],
      now: () => NOW,
    });
    for (const s of wx) {
      assert.ok(s.diagnosticsTrace.createdReason.length > 0);
      assert.ok(s.diagnosticsTrace.severityRationale.length > 0);
      assert.ok(s.diagnosticsTrace.confidenceRationale.length > 0);
      assert.ok(s.diagnosticsTrace.exposureRationale.length > 0);
      assert.ok(s.diagnosticsTrace.thresholdsCrossed.length > 0);
    }
  });

  it('store.toJson round-trips through JSON', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [{
        id: 'wx-3', event: 'Flash Flood Warning', severity: 'Severe',
        headline: 'h', description: 'd', areaDesc: 'a',
        onset: new Date(NOW), expires: new Date(NOW + 60_000),
        coordinates: [], centroid: [-86.7, 41.6],
      }],
      now: () => NOW,
    });
    if (s) store.upsert(s);
    const json = JSON.stringify(store.toJson());
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].domain, 'weather');
  });

  it('user-exposed cyber threat ranks above distant military elevated', () => {
    const distantMil = militaryPosturesToSituations({
      postures: [{
        theaterId: 'arctic',
        theaterName: 'Arctic',
        posture: 'elevated',
        postureScore: 0.4,
        evidence: [],
        agreeingSources: ['NATO'],
        disagreeingSources: [],
      }],
      now: () => NOW,
    });
    const userCyber = cyberThreatsToSituations({
      threats: [{
        threatId: 'CVE-2026-USER',
        title: 'Apple zero-day',
        stagesReached: ['cve_published', 'exploit_observed', 'kev_listed', 'user_exposed'],
        affectedSectors: ['consumer_software'],
        affectedVendors: ['Apple macOS'],
        evidence: [],
        agreeingSources: ['CISA'],
        disagreeingSources: [],
      }],
      user: { userVendors: ['macos'] },
      now: () => NOW,
    });
    [...distantMil, ...userCyber].forEach((s) => store.upsert(s));
    const top = store.ranked(1);
    assert.equal(top[0]?.domain, 'cyber');
    assert.equal(top[0]?.id, 'cyber:CVE-2026-USER');
  });
});
