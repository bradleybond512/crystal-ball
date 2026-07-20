import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aircraftStyle,
  aircraftWithPosition,
  ashAdvisoriesWithPolygon,
  circleToPolygon,
  notamDescriptionHtml,
  notamStyle,
  sigmetDescriptionHtml,
  sigmetStyle,
  tfrsWithGeometry,
} from '../aviation-globe-helpers';
import type {
  AviationNotam,
  AviationSigmet,
  MilitaryAircraft,
  VolcanicAshAdvisory,
} from '../aviation-intel-types';

const baseNotam: AviationNotam = {
  id: 'n1',
  notamNumber: '1/2345',
  classification: 'TFR',
  affectedFir: 'KZAU',
  featureName: 'Test',
  icaoId: 'KORD',
  text: 'TFR for stadium event',
  effectiveStart: 0,
  effectiveEnd: 0,
  presidential: false,
  center: { lat: 41.5, lon: -87.5, radiusNm: 30 },
  altitudeFt: { min: 0, max: 18_000 },
};

describe('notamStyle', () => {
  it('non-presidential TFR is red outline only', () => {
    const s = notamStyle(baseNotam);
    assert.equal(s.outlineHex, '#ef4444');
    assert.equal(s.fillAlpha, 0);
  });

  it('presidential TFR has dark-red 20% fill', () => {
    const s = notamStyle({ ...baseNotam, presidential: true });
    assert.equal(s.outlineHex, '#ff453a');
    assert.equal(s.fillAlpha, 0.20);
  });
});

describe('circleToPolygon', () => {
  it('produces a closed ring with the requested segment count + 1 closure', () => {
    const ring = circleToPolygon({ centerLat: 40, centerLon: -100, radiusNm: 30 }, 8);
    assert.equal(ring.length, 9);
    assert.deepEqual(ring[0], ring[8]);
  });

  it('first point is approximately due-north of center for small radius', () => {
    const ring = circleToPolygon({ centerLat: 40, centerLon: -100, radiusNm: 60 }, 4);
    // i=0 angle=0 -> dLat=0 (sin), dLon=full (cos)
    assert.equal(ring[0]!.lat, 40);
    assert.ok(Math.abs(ring[0]!.lon - (-100 + 60 / (60 * Math.cos((40 * Math.PI) / 180)))) < 1e-9);
  });

  it('handles equator without divide-by-zero', () => {
    const ring = circleToPolygon({ centerLat: 0, centerLon: 0, radiusNm: 1 }, 4);
    assert.equal(ring.length, 5);
    assert.ok(ring.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
  });
});

describe('sigmetStyle', () => {
  it('uses orange for volcanic ash with stronger fill alpha', () => {
    const s: AviationSigmet = {
      id: 's1',
      hazard: 'volcanic_ash',
      severity: 'severe',
      polygon: [],
      text: '',
      validFrom: 0,
      validTo: 0,
      isAirmet: false,
    };
    const style = sigmetStyle(s);
    assert.equal(style.hex, '#ff9800');
    assert.equal(style.fillAlpha, 0.28);
  });

  it('uses yellow for turbulence', () => {
    const s: AviationSigmet = {
      id: 's2',
      hazard: 'turbulence',
      severity: 'moderate',
      polygon: [],
      text: '',
      validFrom: 0,
      validTo: 0,
      isAirmet: false,
    };
    assert.equal(sigmetStyle(s).hex, '#ffeb3b');
  });
});

describe('aircraftStyle', () => {
  it('emergency squawk overrides type color', () => {
    const ac: MilitaryAircraft = {
      icao24: 'a1',
      callsign: 'X',
      type: 'transport',
      country: null,
      lat: 0,
      lon: 0,
      altitudeFt: null,
      velocityKts: null,
      heading: null,
      squawk: '7700',
      lastSeen: 0,
      emergency: true,
    };
    const s = aircraftStyle(ac);
    assert.equal(s.hex, '#ff453a');
    assert.equal(s.emergency, true);
  });

  it('per-type color when not emergency', () => {
    const ac: MilitaryAircraft = {
      icao24: 'a2',
      callsign: 'Y',
      type: 'fighter',
      country: null,
      lat: 0,
      lon: 0,
      altitudeFt: null,
      velocityKts: null,
      heading: null,
      squawk: null,
      lastSeen: 0,
      emergency: false,
    };
    assert.equal(aircraftStyle(ac).hex, '#ffeb3b');
  });
});

describe('filters', () => {
  it('tfrsWithGeometry keeps only TFRs with center', () => {
    const a: AviationNotam = { ...baseNotam };
    const b: AviationNotam = { ...baseNotam, id: 'b', center: undefined };
    const c: AviationNotam = { ...baseNotam, id: 'c', classification: 'DOM', text: 'runway closure NOTAM' };
    assert.equal(tfrsWithGeometry([a, b, c]).length, 1);
  });

  it('aircraftWithPosition drops null lat/lon', () => {
    const list: MilitaryAircraft[] = [
      { icao24: '1', callsign: null, type: 'unknown', country: null, lat: 0, lon: 0, altitudeFt: null, velocityKts: null, heading: null, squawk: null, lastSeen: 0, emergency: false },
      { icao24: '2', callsign: null, type: 'unknown', country: null, lat: null, lon: null, altitudeFt: null, velocityKts: null, heading: null, squawk: null, lastSeen: 0, emergency: false },
    ];
    assert.equal(aircraftWithPosition(list).length, 1);
  });

  it('ashAdvisoriesWithPolygon needs >=3 points', () => {
    const a: VolcanicAshAdvisory = {
      id: '1',
      volcano: 'X',
      polygon: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }],
      altitudeFt: { min: 0, max: 0 },
      validFrom: 0,
      validTo: 0,
      source: 'NOAA',
      text: '',
    };
    const b: VolcanicAshAdvisory = {
      ...a,
      id: '2',
      polygon: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 0, lon: 1 }],
    };
    assert.equal(ashAdvisoriesWithPolygon([a, b]).length, 1);
  });
});

describe('description builders', () => {
  it('notam description includes presidential marker', () => {
    const html = notamDescriptionHtml({ ...baseNotam, presidential: true });
    assert.match(html, /PRESIDENTIAL TFR/);
    assert.match(html, /1\/2345/);
  });

  it('sigmet description includes hazard + severity', () => {
    const s: AviationSigmet = {
      id: 's3',
      hazard: 'turbulence',
      severity: 'severe',
      polygon: [],
      text: 'SEVERE TURB FL300/FL400',
      validFrom: 0,
      validTo: 0,
      isAirmet: false,
    };
    const html = sigmetDescriptionHtml(s);
    assert.match(html, /turbulence/);
    assert.match(html, /severe/);
  });
});
