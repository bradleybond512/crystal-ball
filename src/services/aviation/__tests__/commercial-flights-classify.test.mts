import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyFlight,
  classifyFlights,
  crossReferenceHazards,
  emergencyLabel,
  filterByAnyPlace,
  filterByBoundingBox,
  filterByRadius,
  flightsInsideHazardZones,
  flightStyle,
  flightCategoryColor,
  haversineKm,
  isEmergencySquawk,
  isFlightInSigmet,
  isFlightInTfr,
  isMilitaryHex,
  operatorIcaoFromCallsign,
  summariseFlights,
  type LiveFlight,
  type OpenSkyStateTuple,
} from '../commercial-flights-classify';
import type { AviationNotam, AviationSigmet } from '../aviation-intel-types';

function makeState(overrides: Partial<{
  icao24: string;
  callsign: string | null;
  country: string;
  lon: number;
  lat: number;
  altMeters: number | null;
  onGround: boolean;
  velocityMps: number | null;
  trackDeg: number | null;
  squawk: string | null;
}> = {}): OpenSkyStateTuple {
  const v = {
    // Default to a civilian-allocated US hex (A40000–ADF7C6) — A1B2C3 etc. fall
    // inside the USAF military range A00000–A3FFFF and would be misclassified.
    icao24: 'a4dead',
    callsign: 'AAL123  ',
    country: 'United States',
    lon: -97.5,
    lat: 35.0,
    altMeters: 10_000,
    onGround: false,
    velocityMps: 230,
    trackDeg: 90,
    squawk: '1234',
    ...overrides,
  };
  return [
    v.icao24,
    v.callsign,
    v.country,
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
    v.lon,
    v.lat,
    v.altMeters,
    v.onGround,
    v.velocityMps,
    v.trackDeg,
    null,
    null,
    null,
    v.squawk,
    null,
    0,
  ] as unknown as OpenSkyStateTuple;
}

describe('isEmergencySquawk', () => {
  it('detects 7500 (hijack)', () => {
    assert.equal(isEmergencySquawk('7500'), true);
  });
  it('detects 7600 (comms failure)', () => {
    assert.equal(isEmergencySquawk('7600'), true);
  });
  it('detects 7700 (general emergency)', () => {
    assert.equal(isEmergencySquawk('7700'), true);
  });
  it('rejects normal squawks', () => {
    assert.equal(isEmergencySquawk('1200'), false);
    assert.equal(isEmergencySquawk('7000'), false);
    assert.equal(isEmergencySquawk(null), false);
    assert.equal(isEmergencySquawk(undefined), false);
    assert.equal(isEmergencySquawk(''), false);
  });
  it('emergencyLabel produces human-readable strings', () => {
    assert.equal(emergencyLabel('7500'), 'Hijack');
    assert.equal(emergencyLabel('7600'), 'Comms failure');
    assert.equal(emergencyLabel('7700'), 'General emergency');
  });
});

describe('isMilitaryHex', () => {
  it('matches USA range', () => {
    assert.equal(isMilitaryHex('AE0001'), true);
    assert.equal(isMilitaryHex('AFFFFE'), true);
  });
  it('matches lower-case hex', () => {
    assert.equal(isMilitaryHex('ae0001'), true);
  });
  it('rejects non-military hex', () => {
    // A45678 is in the civilian US allocation (above A3FFFF, below ADF7C7).
    assert.equal(isMilitaryHex('A45678'), false);
    assert.equal(isMilitaryHex('1234'), false);
    assert.equal(isMilitaryHex(''), false);
    assert.equal(isMilitaryHex('not-hex'), false);
  });
});

describe('operatorIcaoFromCallsign', () => {
  it('extracts the leading 3-letter prefix', () => {
    assert.equal(operatorIcaoFromCallsign('UAL3456'), 'UAL');
    assert.equal(operatorIcaoFromCallsign('aal12  '), 'AAL');
  });
  it('returns null for tail numbers and short callsigns', () => {
    assert.equal(operatorIcaoFromCallsign('N12345'), null);
    assert.equal(operatorIcaoFromCallsign('AB'), null);
    assert.equal(operatorIcaoFromCallsign(null), null);
    assert.equal(operatorIcaoFromCallsign(''), null);
  });
});

describe('classifyFlight', () => {
  it('classifies American Airlines as commercial with operator name', () => {
    const f = classifyFlight(makeState({ callsign: 'AAL123', icao24: 'abcdef' }));
    assert.ok(f);
    assert.equal(f.category, 'commercial');
    assert.equal(f.operatorIcao, 'AAL');
    assert.equal(f.operatorName, 'American Airlines');
    assert.equal(f.emergency, false);
  });

  it('classifies FedEx as cargo', () => {
    const f = classifyFlight(makeState({ callsign: 'FDX1' }));
    assert.ok(f);
    assert.equal(f.category, 'cargo');
    assert.equal(f.operatorName, 'FedEx Express');
  });

  it('classifies USAF C-17 (REACH callsign + military hex) as military', () => {
    const f = classifyFlight(makeState({ callsign: 'RCH473', icao24: 'AE1234' }));
    assert.ok(f);
    assert.equal(f.category, 'military');
  });

  it('classifies medical helo (LIFEFLIGHT prefix) as helicopter', () => {
    const f = classifyFlight(makeState({ callsign: 'LIFEFLIGHT2', icao24: 'a40001' }));
    assert.ok(f);
    assert.equal(f.category, 'helicopter');
  });

  it('classifies unknown N-tail as general_aviation', () => {
    const f = classifyFlight(makeState({ callsign: 'N12345', icao24: 'a40002' }));
    assert.ok(f);
    assert.equal(f.category, 'general_aviation');
    assert.equal(f.operatorIcao, null);
  });

  it('flags emergency=true with emergencySquawk for squawk 7700', () => {
    const f = classifyFlight(makeState({ callsign: 'DAL999', squawk: '7700' }));
    assert.ok(f);
    assert.equal(f.emergency, true);
    assert.equal(f.emergencySquawk, '7700');
    // category is still commercial — emergency is orthogonal
    assert.equal(f.category, 'commercial');
  });

  it('converts altitude meters → feet (nearest int)', () => {
    const f = classifyFlight(makeState({ altMeters: 10_000 }));
    assert.ok(f);
    assert.equal(f.altitudeFt, 32_808);
  });

  it('converts velocity m/s → knots', () => {
    const f = classifyFlight(makeState({ velocityMps: 230 }));
    assert.ok(f);
    assert.equal(f.velocityKts, 447);
  });

  it('returns null for missing position', () => {
    const f = classifyFlight(
      makeState({ lat: null as unknown as number, lon: null as unknown as number }),
    );
    assert.equal(f, null);
  });

  it('returns null for empty icao24', () => {
    const f = classifyFlight(makeState({ icao24: '' }));
    assert.equal(f, null);
  });
});

describe('classifyFlights (full payload)', () => {
  it('skips invalid rows and classifies valid ones', () => {
    const payload = {
      states: [
        ['abcdef', 'UAL55  ', 'United States', 0, 0, -97, 35, 9000, false, 200, 270, null, null, null, '1200', null, 0],
        ['AE9999', 'RCH123 ', 'United States', 0, 0, -100, 40, 11_000, false, 250, 90, null, null, null, '7700', null, 0],
        // Invalid row
        ['short'],
      ],
    };
    const flights = classifyFlights(payload);
    assert.equal(flights.length, 2);
    assert.equal(flights[0]!.category, 'commercial');
    assert.equal(flights[1]!.category, 'military');
    assert.equal(flights[1]!.emergency, true);
  });
  it('returns [] for malformed payload', () => {
    assert.deepEqual(classifyFlights(null), []);
    assert.deepEqual(classifyFlights({ wrong: 'shape' }), []);
    assert.deepEqual(classifyFlights({ states: 'not-an-array' }), []);
  });
});

describe('summariseFlights', () => {
  it('counts each category and emergency squawks', () => {
    const flights: LiveFlight[] = [
      { ...makeFlight('commercial'), emergency: false, emergencySquawk: null },
      { ...makeFlight('cargo'), emergency: false, emergencySquawk: null },
      { ...makeFlight('military'), emergency: true, emergencySquawk: '7700' },
      { ...makeFlight('general_aviation'), emergency: true, emergencySquawk: '7500' },
      { ...makeFlight('helicopter'), emergency: true, emergencySquawk: '7600' },
    ];
    const counts = summariseFlights(flights);
    assert.equal(counts.total, 5);
    assert.equal(counts.commercial, 1);
    assert.equal(counts.cargo, 1);
    assert.equal(counts.military, 1);
    assert.equal(counts.helicopter, 1);
    assert.equal(counts.general_aviation, 1);
    assert.equal(counts.emergency, 3);
    assert.equal(counts.squawk7500, 1);
    assert.equal(counts.squawk7600, 1);
    assert.equal(counts.squawk7700, 1);
  });
});

describe('haversineKm', () => {
  it('returns ~111 km for 1 degree of latitude', () => {
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    assert.ok(Math.abs(d - 111) < 1, `expected ~111km, got ${d}`);
  });
  it('returns 0 for identical points', () => {
    assert.equal(haversineKm({ lat: 35, lon: -97 }, { lat: 35, lon: -97 }), 0);
  });
});

describe('filterByBoundingBox', () => {
  const flights = [
    { lat: 35, lon: -97 },
    { lat: 35, lon: -130 },
    { lat: -10, lon: 50 },
  ];
  it('filters to inside-the-box flights', () => {
    const out = filterByBoundingBox(flights, { west: -110, south: 30, east: -90, north: 40 });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.lon, -97);
  });
  it('handles antimeridian-crossing boxes (west > east)', () => {
    // Flights at lon 170, -170 should both be inside a box that wraps the dateline.
    const wrap = filterByBoundingBox(
      [{ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, { lat: 0, lon: 0 }],
      { west: 160, south: -10, east: -160, north: 10 },
    );
    assert.equal(wrap.length, 2);
  });
});

describe('filterByRadius / filterByAnyPlace', () => {
  const place = { id: 'home', name: 'La Porte IN', lat: 41.6, lon: -86.7, radiusKm: 100 };
  const flights = [
    { lat: 41.7, lon: -86.6 }, // ~12 km away
    { lat: 35.0, lon: -97.0 }, // ~1100 km away
  ];
  it('keeps flights inside radius', () => {
    const out = filterByRadius(flights, place);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.lon, -86.6);
  });
  it('returns input unchanged when no places given', () => {
    const out = filterByAnyPlace(flights, []);
    assert.equal(out.length, 2);
  });
  it('union across multiple places', () => {
    const place2 = { id: 'okc', name: 'OKC', lat: 35.5, lon: -97.5, radiusKm: 100 };
    const out = filterByAnyPlace(flights, [place, place2]);
    assert.equal(out.length, 2);
  });
});

describe('TFR / SIGMET cross-reference', () => {
  const tfr: AviationNotam = {
    id: 'tfr-1',
    notamNumber: '1/1234',
    classification: 'TFR',
    affectedFir: null,
    featureName: null,
    icaoId: null,
    text: 'TFR',
    effectiveStart: 0,
    effectiveEnd: 0,
    center: { lat: 41.6, lon: -86.7, radiusNm: 30 },
    presidential: false,
  };
  const sigmet: AviationSigmet = {
    id: 'sig-1',
    hazard: 'turbulence',
    severity: 'moderate',
    polygon: [
      { lat: 40, lon: -90 },
      { lat: 45, lon: -90 },
      { lat: 45, lon: -85 },
      { lat: 40, lon: -85 },
    ],
    text: 'TURB',
    validFrom: 0,
    validTo: 0,
    isAirmet: false,
  };

  it('flags a flight inside the TFR circle', () => {
    assert.equal(isFlightInTfr({ lat: 41.6, lon: -86.7 }, tfr), true);
  });
  it('does NOT flag a flight far outside the TFR', () => {
    assert.equal(isFlightInTfr({ lat: 35, lon: -97 }, tfr), false);
  });
  it('TFR with no center returns false', () => {
    const noCenter: AviationNotam = { ...tfr, center: undefined };
    assert.equal(isFlightInTfr({ lat: 41.6, lon: -86.7 }, noCenter), false);
  });

  it('flags a flight inside a SIGMET polygon', () => {
    assert.equal(isFlightInSigmet({ lat: 42, lon: -87 }, sigmet), true);
  });
  it('does NOT flag a flight outside the SIGMET polygon', () => {
    assert.equal(isFlightInSigmet({ lat: 35, lon: -97 }, sigmet), false);
  });
  it('SIGMET with <3 points returns false', () => {
    const small: AviationSigmet = {
      ...sigmet,
      polygon: [{ lat: 40, lon: -90 }, { lat: 45, lon: -90 }],
    };
    assert.equal(isFlightInSigmet({ lat: 42, lon: -87 }, small), false);
  });

  it('crossReferenceHazards collects TFR + SIGMET ids', () => {
    const r = crossReferenceHazards({ lat: 41.6, lon: -86.7 }, [tfr], [sigmet]);
    assert.deepEqual(r.tfrIds, ['tfr-1']);
    assert.deepEqual(r.sigmetIds, ['sig-1']);
  });

  it('flightsInsideHazardZones returns only intersecting flights', () => {
    const flights: LiveFlight[] = [
      { ...makeFlight('commercial'), lat: 41.6, lon: -86.7 }, // in TFR + SIGMET
      { ...makeFlight('cargo'), lat: 35, lon: -97 },           // in neither
    ];
    const inside = flightsInsideHazardZones(flights, [tfr], [sigmet]);
    assert.equal(inside.length, 1);
    assert.deepEqual(inside[0]!.hazards.tfrIds, ['tfr-1']);
  });
});

describe('flightStyle / flightCategoryColor', () => {
  it('emergency flights render red regardless of category', () => {
    const f: LiveFlight = { ...makeFlight('commercial'), emergency: true, emergencySquawk: '7500' };
    const style = flightStyle(f);
    assert.equal(style.hex, '#ff453a');
    assert.equal(style.emergency, true);
    assert.ok(style.pixelSize >= 10);
  });
  it('non-emergency flights use category color', () => {
    const f = { ...makeFlight('cargo'), emergency: false, emergencySquawk: null };
    const style = flightStyle(f);
    assert.equal(style.hex, flightCategoryColor('cargo'));
    assert.equal(style.emergency, false);
  });
  it('every category has a stable color', () => {
    for (const cat of ['military', 'commercial', 'cargo', 'helicopter', 'general_aviation'] as const) {
      assert.ok(flightCategoryColor(cat).startsWith('#'));
    }
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function makeFlight(category: LiveFlight['category']): LiveFlight {
  return {
    icao24: 'abcdef',
    callsign: 'TEST123',
    originCountry: 'United States',
    category,
    operatorIcao: 'AAL',
    operatorName: 'American Airlines',
    lat: 35,
    lon: -97,
    altitudeFt: 30_000,
    velocityKts: 450,
    headingDeg: 90,
    squawk: '1200',
    emergency: false,
    emergencySquawk: null,
    onGround: false,
    lastSeen: Date.now(),
  };
}
