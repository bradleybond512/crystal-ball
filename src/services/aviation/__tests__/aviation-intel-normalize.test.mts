import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDelays,
  normalizeMilitaryAircraft,
  normalizeNotams,
  normalizePireps,
  normalizeSigmets,
  normalizeVolcanicAsh,
} from '../aviation-intel-normalize';

describe('normalizeNotams', () => {
  it('returns [] for malformed payload without throwing', () => {
    assert.deepEqual(normalizeNotams(null), []);
    assert.deepEqual(normalizeNotams({ items: 'not an array' }), []);
    assert.deepEqual(normalizeNotams(undefined), []);
  });

  it('parses FAA NOTAM API style envelope', () => {
    const payload = {
      items: [
        {
          properties: {
            coreNOTAMData: {
              notam: {
                number: '1/2345',
                classification: 'FDC',
                affectedFIR: 'KZAU',
                featureName: 'Air Show',
                icaoLocation: 'KORD',
                text: 'TFR PRESIDENTIAL VIP MOVEMENT 4030N 08740W RADIUS 30 NM SFC FL180',
                effectiveStart: '2026-01-15T00:00:00Z',
                effectiveEnd: '2026-01-15T06:00:00Z',
              },
            },
          },
        },
      ],
    };
    const out = normalizeNotams(payload);
    assert.equal(out.length, 1);
    const n = out[0]!;
    assert.equal(n.notamNumber, '1/2345');
    assert.equal(n.classification, 'TFR');
    assert.equal(n.presidential, true);
    assert.ok(n.center);
    assert.equal(n.center!.radiusNm, 30);
    assert.ok(Math.abs(n.center!.lat - 40.5) < 0.1);
    assert.ok(Math.abs(n.center!.lon + 87.667) < 0.1);
    assert.deepEqual(n.altitudeFt, { min: 0, max: 18_000 });
  });

  it('skips items with no text', () => {
    const out = normalizeNotams({ items: [{ properties: { coreNOTAMData: { notam: {} } } }] });
    assert.deepEqual(out, []);
  });

  it('classifies TFR keyword even when classification field is missing', () => {
    const payload = {
      items: [
        {
          properties: {
            coreNOTAMData: {
              notam: { text: 'TFR for stadium event 4015N 11630W RADIUS 5 NM SFC FL050' },
            },
          },
        },
      ],
    };
    assert.equal(normalizeNotams(payload)[0]!.classification, 'TFR');
  });
});

describe('normalizeSigmets', () => {
  it('classifies volcanic ash hazard from text', () => {
    const payload = {
      data: [
        {
          properties: {
            rawSigmet: 'VOLCANIC ASH SFC/FL250 OBS AT 1200Z',
            validTimeFrom: 1_700_000_000,
            validTimeTo: 1_700_010_000,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-145, 60],
                [-140, 60],
                [-140, 62],
                [-145, 62],
                [-145, 60],
              ],
            ],
          },
        },
      ],
    };
    const out = normalizeSigmets(payload);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.hazard, 'volcanic_ash');
    assert.equal(out[0]!.polygon.length, 5);
    assert.equal(out[0]!.polygon[0]!.lat, 60);
    assert.equal(out[0]!.polygon[0]!.lon, -145);
  });

  it('classifies turbulence hazard with severe severity', () => {
    const payload = {
      data: [
        { properties: { rawSigmet: 'SEVERE TURB FL300/FL400 FCST', hazard: 'TURB', severity: 'SEV' } },
      ],
    };
    const out = normalizeSigmets(payload);
    assert.equal(out[0]!.hazard, 'turbulence');
    assert.equal(out[0]!.severity, 'severe');
    assert.deepEqual(out[0]!.altitudeFt, { min: 30_000, max: 40_000 });
  });

  it('marks records as AIRMET when isAirmet=true', () => {
    const out = normalizeSigmets(
      { data: [{ properties: { rawAirmet: 'AIRMET TANGO MOD TURB' } }] },
      true,
    );
    assert.equal(out[0]!.isAirmet, true);
  });

  it('returns [] for empty payload', () => {
    assert.deepEqual(normalizeSigmets({}), []);
  });
});

describe('normalizePireps', () => {
  it('parses pilot turbulence report', () => {
    const payload = {
      data: [
        {
          properties: {
            rawOb: 'KORD UA /OV ORD180020/TM 1430/FL280/TP B738/TB MOD CHOP',
            turbType: 'CHOP',
            turbInt: 'MOD',
            fltlvl: 28_000,
            lat: 41.5,
            lon: -87.5,
            obsTime: '2026-01-15T14:30:00Z',
            acType: 'B738',
          },
        },
      ],
    };
    const out = normalizePireps(payload);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.hazard, 'turbulence');
    assert.equal(out[0]!.intensity, 'moderate');
    assert.equal(out[0]!.altitudeFt, 28_000);
    assert.equal(out[0]!.aircraftType, 'B738');
  });

  it('detects icing PIREP', () => {
    const out = normalizePireps({
      data: [{ properties: { rawOb: 'UA /OV /TM /FL120 /TP /IC LGT', icingType: 'RIME' } }],
    });
    assert.equal(out[0]!.hazard, 'icing');
  });

  it('skips PIREPs without a recognizable hazard', () => {
    const out = normalizePireps({
      data: [{ properties: { rawOb: 'UA /OV /TM /FL060 /TP /SK SCT' } }],
    });
    assert.equal(out.length, 0);
  });
});

describe('normalizeMilitaryAircraft', () => {
  it('parses adsb.lol /v2/mil response', () => {
    const payload = {
      ac: [
        {
          hex: 'AE2BB7',
          flight: 'RCH4001',
          r: 'United States',
          t: 'C17',
          lat: 40.0,
          lon: -100.0,
          alt_baro: 35_000,
          gs: 410,
          track: 90,
          squawk: '7700',
          seen: 0.5,
        },
      ],
    };
    const out = normalizeMilitaryAircraft(payload);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.icao24, 'ae2bb7');
    assert.equal(out[0]!.callsign, 'RCH4001');
    assert.equal(out[0]!.type, 'transport');
    assert.equal(out[0]!.emergency, true);
  });

  it('parses OpenSky states/all array-of-arrays shape', () => {
    const payload = {
      states: [
        ['ae0001', 'EAGLE01 ', 'United States', 0, 1_700_000_000, -120, 35, 12_000, false, 250, 100, 0, null, 12_000, '1200'],
      ],
    };
    const out = normalizeMilitaryAircraft(payload);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.icao24, 'ae0001');
    assert.equal(out[0]!.type, 'fighter');
  });

  it('classifies KC-135 as tanker by aircraft type', () => {
    const out = normalizeMilitaryAircraft({
      ac: [{ hex: 'ae9999', flight: 'GOLD55', t: 'KC-135R', lat: 30, lon: -100 }],
    });
    assert.equal(out[0]!.type, 'tanker');
  });

  it('returns [] when payload has no recognizable shape', () => {
    assert.deepEqual(normalizeMilitaryAircraft('not aviation'), []);
  });
});

describe('normalizeDelays', () => {
  it('parses FAA NAS Status airport conditions', () => {
    const payload = {
      delays: [
        {
          airport: 'EWR',
          reason: 'Wind/Volume',
          eventType: 'GROUND DELAY',
          avgDelay: 38,
          maxDelay: 75,
          startTime: '2026-01-15T18:00:00Z',
          endTime: '2026-01-15T22:00:00Z',
        },
      ],
    };
    const out = normalizeDelays(payload);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.airport, 'EWR');
    assert.equal(out[0]!.programType, 'ground_delay');
    assert.equal(out[0]!.avgDelayMinutes, 38);
  });

  it('classifies ground stop', () => {
    const out = normalizeDelays({
      delays: [{ airport: 'JFK', eventType: 'GROUND STOP', reason: 'Equipment' }],
    });
    assert.equal(out[0]!.programType, 'ground_stop');
  });

  it('skips entries without an airport identifier', () => {
    assert.deepEqual(normalizeDelays({ delays: [{ reason: 'orphan' }] }), []);
  });
});

describe('normalizeVolcanicAsh', () => {
  it('parses ash advisory polygon', () => {
    const payload = {
      data: [
        {
          properties: {
            volcano: 'Bezymianny',
            text: 'VA SFC/FL250',
            altitudeLow: 0,
            altitudeHi: 25_000,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [160, 55],
                [165, 55],
                [165, 58],
                [160, 58],
                [160, 55],
              ],
            ],
          },
        },
      ],
    };
    const out = normalizeVolcanicAsh(payload);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.volcano, 'Bezymianny');
    assert.equal(out[0]!.altitudeFt.max, 25_000);
    assert.equal(out[0]!.polygon.length, 5);
  });

  it('skips advisories without a polygon', () => {
    assert.deepEqual(normalizeVolcanicAsh({ data: [{ properties: { volcano: 'X' } }] }), []);
  });
});
