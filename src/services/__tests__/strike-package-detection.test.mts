import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAirFormations, computeImportance } from '../strike-packages.ts';
import type { MilitaryFlight, StrikePackage } from '@/types';

function makeFlight(overrides: Partial<MilitaryFlight>): MilitaryFlight {
  return {
    id: 'test-1',
    callsign: 'TEST01',
    hexCode: 'AAAAAA',
    aircraftType: 'fighter',
    operator: 'usaf',
    operatorCountry: 'United States',
    lat: 50.0,
    lon: 10.0,
    altitude: 30000,
    heading: 90,
    speed: 450,
    onGround: false,
    lastSeen: new Date(),
    confidence: 'high',
    ...overrides,
  };
}

test('detectAirFormations groups nearby military aircraft', () => {
  const flights: MilitaryFlight[] = [
    makeFlight({ id: 'b1', callsign: 'DOOM01', aircraftType: 'bomber', lat: 50.0, lon: 10.0, heading: 90 }),
    makeFlight({ id: 'k1', callsign: 'SHELL1', aircraftType: 'tanker', lat: 50.01, lon: 10.02, heading: 91 }),
    makeFlight({ id: 'f1', callsign: 'VIPER1', aircraftType: 'fighter', lat: 50.005, lon: 10.01, heading: 89 }),
    // Far away — should NOT be grouped
    makeFlight({ id: 'f2', callsign: 'VIPER2', aircraftType: 'fighter', lat: 20.0, lon: -80.0, heading: 270 }),
  ];

  const packages = detectAirFormations(flights);
  assert.equal(packages.length, 1, 'should detect 1 formation');
  assert.equal(packages[0]!.composition.length, 3, 'formation should have 3 units');
  assert.equal(packages[0]!.domain, 'air');
  assert.equal(packages[0]!.status, 'active');
});

test('detectAirFormations requires at least 2 aircraft', () => {
  const flights: MilitaryFlight[] = [
    makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 50.0, lon: 10.0 }),
  ];
  const packages = detectAirFormations(flights);
  assert.equal(packages.length, 0, 'single aircraft should not form a package');
});

test('detectAirFormations ignores ground aircraft', () => {
  const flights: MilitaryFlight[] = [
    makeFlight({ id: 'b1', aircraftType: 'bomber', lat: 50.0, lon: 10.0, onGround: true }),
    makeFlight({ id: 'k1', aircraftType: 'tanker', lat: 50.01, lon: 10.02, onGround: true }),
  ];
  const packages = detectAirFormations(flights);
  assert.equal(packages.length, 0, 'ground aircraft should not form a package');
});

test('computeImportance ranks active bomber package highest', () => {
  const active: StrikePackage = {
    id: 'sp-1', domain: 'air', name: 'B-52H Formation',
    status: 'active', importance: 0, lat: 50, lon: 10, heading: 90, speed: 450,
    composition: [{ type: 'B-52H', count: 2, role: 'bomber' }],
    prediction: { extrapolatedPath: [], destinations: [], method: 'extrapolation', updatedAt: new Date() },
    detectedAt: new Date(), lastUpdated: new Date(), trail: [],
  };
  const inPort: StrikePackage = {
    id: 'sp-2', domain: 'naval', name: 'CSG-3',
    status: 'in_port', importance: 0, lat: 32, lon: -117, heading: 0, speed: 0,
    composition: [{ type: 'CVN-68', count: 1, role: 'carrier' }],
    prediction: { extrapolatedPath: [], destinations: [], method: 'extrapolation', updatedAt: new Date() },
    detectedAt: new Date(), lastUpdated: new Date(), trail: [],
  };

  const activeScore = computeImportance(active);
  const inPortScore = computeImportance(inPort);
  assert.ok(activeScore > inPortScore, `active (${activeScore}) should score higher than in_port (${inPortScore})`);
});
