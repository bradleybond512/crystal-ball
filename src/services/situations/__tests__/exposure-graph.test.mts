import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  exposureToLevel,
  getExposureGraph,
  resetExposureGraphForTests,
  scoreCountryExposure,
  scoreCyberExposure,
  scoreGeoExposure,
  setExposureGraph,
  type ExposureGraph,
} from '../exposure-graph';

const HOME = { id: 'home', name: 'La Porte', lat: 41.6, lon: -86.7, tags: ['home'], primary: true };
const WORK = { id: 'work', name: 'Chicago', lat: 41.88, lon: -87.63, tags: ['work'], primary: false };

beforeEach(() => {
  resetExposureGraphForTests();
});

describe('setExposureGraph + getExposureGraph', () => {
  it('round-trips a full graph', () => {
    const graph: ExposureGraph = {
      savedPlaces: [HOME],
      watchlist: { countries: ['USA'], sectors: ['finance'], tickers: ['AAPL'], vendors: ['Apple'], cves: [] },
      device: { osLabels: ['macOS'], versions: ['macOS 14'] },
    };
    setExposureGraph(graph);
    assert.deepEqual(getExposureGraph(), graph);
  });

  it('default is an empty graph', () => {
    const graph = getExposureGraph();
    assert.equal(graph.savedPlaces.length, 0);
    assert.equal(graph.watchlist.countries.length, 0);
  });
});

describe('scoreGeoExposure', () => {
  it('returns baseline 0.1 when centroid is missing', () => {
    const r = scoreGeoExposure(undefined, { savedPlaces: [HOME], watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] }, device: { osLabels: [], versions: [] } });
    assert.equal(r.score, 0.1);
  });

  it('within 25 km of primary place → severe (>= 0.95)', () => {
    const r = scoreGeoExposure(
      { lat: 41.61, lon: -86.72 }, // ~1 km from home
      { savedPlaces: [HOME], watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] }, device: { osLabels: [], versions: [] } },
    );
    assert.ok(r.score >= 0.95, `expected ≥0.95, got ${r.score}`);
    assert.ok(r.reasons.length > 0);
  });

  it('within 80 km → high (~0.6)', () => {
    const r = scoreGeoExposure(
      { lat: 42.0, lon: -86.6 }, // ~50 km from home
      { savedPlaces: [HOME], watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] }, device: { osLabels: [], versions: [] } },
    );
    assert.ok(r.score >= 0.6 && r.score < 0.9);
  });

  it('beyond 200 km → baseline 0.1', () => {
    const r = scoreGeoExposure(
      { lat: 35.0, lon: -90.0 }, // ~700 km from home
      { savedPlaces: [HOME], watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] }, device: { osLabels: [], versions: [] } },
    );
    assert.equal(r.score, 0.1);
  });

  it('current location wins over saved place by +0.05 bump', () => {
    const r = scoreGeoExposure(
      { lat: 41.6, lon: -86.7 },
      {
        savedPlaces: [HOME],
        watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] },
        device: { osLabels: [], versions: [] },
        currentLocation: { lat: 41.61, lon: -86.71 },
      },
    );
    assert.ok(r.reasons[0]?.toLowerCase().includes('current location'));
  });

  it('records a contributions map keyed by source', () => {
    const r = scoreGeoExposure(
      { lat: 41.61, lon: -86.72 },
      { savedPlaces: [HOME], watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] }, device: { osLabels: [], versions: [] } },
    );
    assert.ok('place:home' in r.contributions);
  });
});

describe('scoreCyberExposure', () => {
  const baseGraph: ExposureGraph = {
    savedPlaces: [],
    watchlist: { countries: [], sectors: ['finance'], tickers: [], vendors: ['Apple'], cves: ['CVE-2026-WATCHED'] },
    device: { osLabels: ['macOS'], versions: ['macOS 14'] },
  };

  it('vendor match → score 0.85', () => {
    const r = scoreCyberExposure({ affectedVendors: ['Apple macOS'], affectedSectors: [] }, baseGraph);
    assert.ok(r.score >= 0.85);
    assert.ok(r.reasons.some((rs) => /vendor/i.test(rs)));
  });

  it('sector match alone → score 0.6', () => {
    const r = scoreCyberExposure({ affectedVendors: [], affectedSectors: ['finance'] }, baseGraph);
    assert.equal(r.score, 0.6);
  });

  it('CVE on watchlist → score 1.0', () => {
    const r = scoreCyberExposure(
      { affectedVendors: [], affectedSectors: [], cveId: 'CVE-2026-WATCHED' },
      baseGraph,
    );
    assert.equal(r.score, 1);
    assert.ok(r.reasons.some((rs) => /CVE-2026-WATCHED/.test(rs)));
  });

  it('no matches → baseline 0.1', () => {
    const r = scoreCyberExposure({ affectedVendors: ['Microsoft'], affectedSectors: [] }, baseGraph);
    assert.equal(r.score, 0.1);
  });

  it('case-insensitive vendor match', () => {
    const r = scoreCyberExposure(
      { affectedVendors: ['APPLE iOS'], affectedSectors: [] },
      { ...baseGraph, watchlist: { ...baseGraph.watchlist, vendors: ['apple'] } },
    );
    assert.ok(r.score >= 0.85);
  });
});

describe('scoreCountryExposure', () => {
  const graph: ExposureGraph = {
    savedPlaces: [],
    watchlist: { countries: ['USA', 'TWN'], sectors: [], tickers: [], vendors: [], cves: [] },
    device: { osLabels: [], versions: [] },
  };

  it('matched country → score 0.6 (single match)', () => {
    const r = scoreCountryExposure(['TWN'], graph);
    assert.equal(r.score, 0.6);
    assert.ok(r.reasons.some((rs) => /TWN/.test(rs)));
  });

  it('multiple matches → higher score (capped 0.85)', () => {
    const r = scoreCountryExposure(['USA', 'TWN'], graph);
    assert.equal(r.score, 0.7);
  });

  it('no overlap → baseline 0.1', () => {
    const r = scoreCountryExposure(['CHN'], graph);
    assert.equal(r.score, 0.1);
  });

  it('empty input → baseline 0.1', () => {
    const r = scoreCountryExposure([], graph);
    assert.equal(r.score, 0.1);
  });

  it('case-insensitive country match', () => {
    const r = scoreCountryExposure(['twn'], graph);
    assert.equal(r.score, 0.6);
  });
});

describe('exposureToLevel', () => {
  it('maps the score ladder correctly', () => {
    assert.equal(exposureToLevel(0.95), 'severe');
    assert.equal(exposureToLevel(0.75), 'high');
    assert.equal(exposureToLevel(0.45), 'medium');
    assert.equal(exposureToLevel(0.25), 'low');
    assert.equal(exposureToLevel(0.1), 'none');
  });
});
