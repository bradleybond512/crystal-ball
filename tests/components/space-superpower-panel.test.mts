/**
 * SpaceSuperpowerPanel — unit tests for pure helper functions and
 * section renderers. No DOM required; all functions under test are
 * exported pure functions that take data and return strings/values.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  stormLevelFromKp,
  flareClassFromFlux,
  auroraLatitude,
  gpsRiskFromKp,
  gridRiskForLatitude,
  gicRiskFromKp,
  affectedInfrastructure,
  cmeArrivalEta,
  kpImpactLabel,
  formatFlux,
  renderSolarDashboard,
  renderCmeTracker,
  renderGeomagWatch,
  renderSatelliteRisk,
  renderInfrastructureImpact,
  type SpaceSuperState,
  type SunspotRegion,
  type FlareProb,
  type RegionGridRisk,
} from '../../src/components/SpaceSuperpowerPanel.ts';
import type {
  XrayFluxState,
  GeomagState,
  EarthwardCme,
} from '../../src/services/spaceweather/swpc-monitor.ts';

// ── Fixtures ──────────────────────────────────────────────────────────

const NOW_ISO = '2026-05-19T12:00:00Z';
const NOW_MS = new Date(NOW_ISO).getTime();

function makeState(overrides: Partial<SpaceSuperState> = {}): SpaceSuperState {
  return {
    xray: null,
    geomag: null,
    cmes: [],
    sunspotRegions: [],
    flareProb: null,
    gpsRisk: 'none',
    hfBlackout: false,
    radioBlackoutZones: [],
    gridRisks: [],
    gicRisk: 'low',
    generatedAt: NOW_MS,
    ...overrides,
  };
}

function makeXray(overrides: Partial<XrayFluxState> = {}): XrayFluxState {
  return {
    peakFlux: 1.2e-5,
    currentFlux: 8e-6,
    peakClass: 'M',
    peakLabel: 'M1.2',
    peakAt: NOW_ISO,
    xClassActive: false,
    sampleCount: 72,
    ...overrides,
  };
}

function makeGeomag(overrides: Partial<GeomagState> = {}): GeomagState {
  return {
    kp: 5,
    level: 'G1',
    auroraVisibilityLatN: 60,
    observedAt: NOW_ISO,
    kpMax24h: 6,
    ...overrides,
  };
}

function makeCme(overrides: Partial<EarthwardCme> = {}): EarthwardCme {
  return {
    id: 'CME-001',
    startTime: NOW_ISO,
    speedKmS: 750,
    estimatedArrival: new Date(NOW_MS + 48 * 3_600_000).toISOString(),
    longitudeDeg: -10,
    latitudeDeg: 5,
    halfAngleDeg: 30,
    isMostAccurate: true,
    link: null,
    ...overrides,
  };
}

function makeRegion(overrides: Partial<RegionGridRisk> = {}): RegionGridRisk {
  return {
    region: 'Scandinavia',
    latitudeBand: '60–70°N',
    riskLevel: 'extreme',
    notes: 'GIC hot zone',
    ...overrides,
  };
}

// ── stormLevelFromKp ─────────────────────────────────────────────────

describe('stormLevelFromKp', () => {
  it('returns G0 below Kp 5', () => { assert.equal(stormLevelFromKp(4.9), 'G0'); });
  it('returns G1 at Kp 5', () => { assert.equal(stormLevelFromKp(5), 'G1'); });
  it('returns G2 at Kp 6', () => { assert.equal(stormLevelFromKp(6), 'G2'); });
  it('returns G3 at Kp 7', () => { assert.equal(stormLevelFromKp(7), 'G3'); });
  it('returns G4 at Kp 8', () => { assert.equal(stormLevelFromKp(8), 'G4'); });
  it('returns G5 at Kp 9', () => { assert.equal(stormLevelFromKp(9), 'G5'); });
  it('returns G5 above Kp 9', () => { assert.equal(stormLevelFromKp(10), 'G5'); });
});

// ── flareClassFromFlux ────────────────────────────────────────────────

describe('flareClassFromFlux', () => {
  it('returns A for flux = 0', () => { assert.equal(flareClassFromFlux(0), 'A'); });
  it('returns B for flux 1e-7', () => { assert.equal(flareClassFromFlux(1e-7), 'B'); });
  it('returns C for flux 1e-6', () => { assert.equal(flareClassFromFlux(1e-6), 'C'); });
  it('returns M for flux 1e-5', () => { assert.equal(flareClassFromFlux(1e-5), 'M'); });
  it('returns X for flux 1e-4', () => { assert.equal(flareClassFromFlux(1e-4), 'X'); });
  it('returns X for flux above X threshold', () => { assert.equal(flareClassFromFlux(5e-4), 'X'); });
});

// ── auroraLatitude ────────────────────────────────────────────────────

describe('auroraLatitude', () => {
  it('returns 90 (invisible) for Kp < 5', () => { assert.equal(auroraLatitude(4), 90); });
  it('returns 60 at Kp 5', () => { assert.equal(auroraLatitude(5), 60); });
  it('returns 45 at Kp 9', () => { assert.equal(auroraLatitude(9), 45); });
  it('clamps to 45 for Kp > 9', () => { assert.equal(auroraLatitude(12), 45); });
  it('returns 90 for Kp 0', () => { assert.equal(auroraLatitude(0), 90); });
});

// ── gpsRiskFromKp ─────────────────────────────────────────────────────

describe('gpsRiskFromKp', () => {
  it('returns none below Kp 3', () => { assert.equal(gpsRiskFromKp(2), 'none'); });
  it('returns low at Kp 3', () => { assert.equal(gpsRiskFromKp(3), 'low'); });
  it('returns moderate at Kp 5', () => { assert.equal(gpsRiskFromKp(5), 'moderate'); });
  it('returns high at Kp 7', () => { assert.equal(gpsRiskFromKp(7), 'high'); });
  it('returns high at Kp 9', () => { assert.equal(gpsRiskFromKp(9), 'high'); });
});

// ── gridRiskForLatitude ───────────────────────────────────────────────

describe('gridRiskForLatitude', () => {
  it('returns low below 45°', () => { assert.equal(gridRiskForLatitude(30), 'low'); });
  it('returns moderate at 45°', () => { assert.equal(gridRiskForLatitude(45), 'moderate'); });
  it('returns high at 55°', () => { assert.equal(gridRiskForLatitude(55), 'high'); });
  it('returns extreme at 65°', () => { assert.equal(gridRiskForLatitude(65), 'extreme'); });
  it('works for southern hemisphere (absolute value)', () => { assert.equal(gridRiskForLatitude(-66), 'extreme'); });
});

// ── gicRiskFromKp ─────────────────────────────────────────────────────

describe('gicRiskFromKp', () => {
  it('returns low at Kp 1', () => { assert.equal(gicRiskFromKp(1), 'low'); });
  it('returns moderate at Kp 4', () => { assert.equal(gicRiskFromKp(4), 'moderate'); });
  it('returns high at Kp 6', () => { assert.equal(gicRiskFromKp(6), 'high'); });
  it('returns extreme at Kp 8', () => { assert.equal(gicRiskFromKp(8), 'extreme'); });
});

// ── affectedInfrastructure ────────────────────────────────────────────

describe('affectedInfrastructure', () => {
  it('returns empty for G0', () => { assert.deepEqual(affectedInfrastructure('G0'), []); });
  it('returns items for G1', () => { assert.ok(affectedInfrastructure('G1').length > 0); });
  it('returns more items for G5 than G1', () => {
    assert.ok(affectedInfrastructure('G5').length >= affectedInfrastructure('G1').length);
  });
  it('G5 mentions power grids', () => {
    const items = affectedInfrastructure('G5');
    assert.ok(items.some((s) => s.toLowerCase().includes('power')));
  });
  it('G5 mentions GPS', () => {
    const items = affectedInfrastructure('G5');
    assert.ok(items.some((s) => s.toLowerCase().includes('gps')));
  });
});

// ── cmeArrivalEta ─────────────────────────────────────────────────────

describe('cmeArrivalEta', () => {
  it('returns Unknown for null arrival', () => {
    assert.equal(cmeArrivalEta(null, NOW_MS), 'Unknown');
  });
  it('returns Arrived when arrival is in the past', () => {
    const past = new Date(NOW_MS - 1000).toISOString();
    assert.equal(cmeArrivalEta(past, NOW_MS), 'Arrived');
  });
  it('returns hours+minutes for arrival within 48h', () => {
    const future = new Date(NOW_MS + 2 * 3_600_000 + 30 * 60_000).toISOString();
    const label = cmeArrivalEta(future, NOW_MS);
    assert.ok(label.includes('h'), `expected hours in "${label}"`);
  });
  it('returns day estimate for arrival beyond 48h', () => {
    const future = new Date(NOW_MS + 72 * 3_600_000).toISOString();
    const label = cmeArrivalEta(future, NOW_MS);
    assert.ok(label.includes('d'), `expected days in "${label}"`);
  });
  it('returns Unknown for invalid date string', () => {
    assert.equal(cmeArrivalEta('not-a-date', NOW_MS), 'Unknown');
  });
});

// ── kpImpactLabel ────────────────────────────────────────────────────

describe('kpImpactLabel', () => {
  it('returns no-storm label for low Kp', () => {
    assert.ok(kpImpactLabel(2).toLowerCase().includes('no storm'));
  });
  it('includes G-level for Kp 6', () => {
    assert.ok(kpImpactLabel(6).includes('G2'));
  });
});

// ── formatFlux ────────────────────────────────────────────────────────

describe('formatFlux', () => {
  it('returns 0.0 for zero flux', () => { assert.equal(formatFlux(0), '0.0'); });
  it('returns scientific notation for non-zero', () => {
    const result = formatFlux(1.2e-5);
    assert.ok(result.includes('×10^'), `expected scientific notation, got "${result}"`);
  });
});

// ── Section renderers ─────────────────────────────────────────────────

describe('renderSolarDashboard', () => {
  it('includes section title', () => {
    const html = renderSolarDashboard(makeState());
    assert.ok(html.includes('Solar Activity Dashboard'));
  });

  it('shows X-ray flux label when xray data present', () => {
    const html = renderSolarDashboard(makeState({ xray: makeXray({ peakLabel: 'M1.2' }) }));
    assert.ok(html.includes('M1.2'));
  });

  it('shows X-CLASS ACTIVE badge when xClassActive', () => {
    const html = renderSolarDashboard(makeState({ xray: makeXray({ xClassActive: true }) }));
    assert.ok(html.includes('X-CLASS ACTIVE'));
  });

  it('does not show X-CLASS badge when not active', () => {
    const html = renderSolarDashboard(makeState({ xray: makeXray({ xClassActive: false }) }));
    assert.ok(!html.includes('X-CLASS ACTIVE'));
  });

  it('shows flare probability when present', () => {
    const flareProb: FlareProb = { mClassPct: 45, xClassPct: 10, protonEventPct: 5, validUntil: '12:00 UTC' };
    const html = renderSolarDashboard(makeState({ flareProb }));
    assert.ok(html.includes('45%'));
    assert.ok(html.includes('10%'));
  });

  it('shows sunspot region ids', () => {
    const sr: SunspotRegion = { id: 'AR3600', latitude: 15, longitude: -30, area: 200, mClass24h: 2, xClass24h: 0 };
    const html = renderSolarDashboard(makeState({ sunspotRegions: [sr] }));
    assert.ok(html.includes('AR3600'));
  });

  it('shows no-regions message when empty', () => {
    const html = renderSolarDashboard(makeState({ sunspotRegions: [] }));
    assert.ok(html.toLowerCase().includes('no active sunspot'));
  });
});

describe('renderCmeTracker', () => {
  it('shows no-CME message when list is empty', () => {
    const html = renderCmeTracker(makeState({ cmes: [] }));
    assert.ok(html.toLowerCase().includes('no earthward'));
  });

  it('shows CME id and ETA when CMEs present', () => {
    const cme = makeCme({ id: 'CME-TEST' });
    const html = renderCmeTracker(makeState({ cmes: [cme] }));
    assert.ok(html.includes('CME-TEST'));
    assert.ok(html.includes('ETA'));
  });

  it('shows CME speed', () => {
    const cme = makeCme({ speedKmS: 850 });
    const html = renderCmeTracker(makeState({ cmes: [cme] }));
    assert.ok(html.includes('850'));
  });

  it('caps rendered CMEs at 6', () => {
    const cmes = Array.from({ length: 10 }, (_, i) => makeCme({ id: `CME-${i}` }));
    const html = renderCmeTracker(makeState({ cmes }));
    // Only 6 should appear
    assert.ok(html.includes('CME-5'));
    assert.ok(!html.includes('CME-6'));
  });
});

describe('renderGeomagWatch', () => {
  it('shows unavailable message when geomag is null', () => {
    const html = renderGeomagWatch(makeState({ geomag: null }));
    assert.ok(html.toLowerCase().includes('unavailable'));
  });

  it('shows Kp value and storm level', () => {
    const html = renderGeomagWatch(makeState({ geomag: makeGeomag({ kp: 7, level: 'G3' }) }));
    assert.ok(html.includes('7.0'));
    assert.ok(html.includes('G3'));
  });

  it('shows aurora visibility latitude', () => {
    const html = renderGeomagWatch(makeState({ geomag: makeGeomag({ kp: 5 }) }));
    assert.ok(html.includes('60'));
  });

  it('shows affected infrastructure for storm', () => {
    const html = renderGeomagWatch(makeState({ geomag: makeGeomag({ kp: 8, level: 'G4' }) }));
    assert.ok(html.toLowerCase().includes('power'));
  });

  it('shows no-effects message for G0', () => {
    const html = renderGeomagWatch(makeState({ geomag: makeGeomag({ kp: 2, level: 'G0' }) }));
    assert.ok(html.toLowerCase().includes('no significant'));
  });
});

describe('renderSatelliteRisk', () => {
  it('shows GPS risk level', () => {
    const html = renderSatelliteRisk(makeState({ gpsRisk: 'high' }));
    assert.ok(html.toLowerCase().includes('gps risk'));
    assert.ok(html.includes('high'));
  });

  it('shows BLACKOUT when hfBlackout is true', () => {
    const html = renderSatelliteRisk(makeState({ hfBlackout: true }));
    assert.ok(html.includes('BLACKOUT'));
  });

  it('shows Clear when no blackout', () => {
    const html = renderSatelliteRisk(makeState({ hfBlackout: false }));
    assert.ok(html.includes('Clear'));
  });

  it('shows radio blackout zones when present', () => {
    const html = renderSatelliteRisk(makeState({ radioBlackoutZones: ['North Atlantic', 'Arctic'] }));
    assert.ok(html.includes('North Atlantic'));
  });
});

describe('renderInfrastructureImpact', () => {
  it('shows GIC risk level', () => {
    const html = renderInfrastructureImpact(makeState({ gicRisk: 'extreme' }));
    assert.ok(html.includes('extreme'));
  });

  it('shows region names from gridRisks', () => {
    const r = makeRegion({ region: 'Alaska Grid' });
    const html = renderInfrastructureImpact(makeState({ gridRisks: [r] }));
    assert.ok(html.includes('Alaska Grid'));
  });

  it('shows region risk level', () => {
    const r = makeRegion({ riskLevel: 'high' });
    const html = renderInfrastructureImpact(makeState({ gridRisks: [r] }));
    assert.ok(html.includes('high'));
  });

  it('shows no-region message when empty', () => {
    const html = renderInfrastructureImpact(makeState({ gridRisks: [] }));
    assert.ok(html.toLowerCase().includes('no region'));
  });
});
