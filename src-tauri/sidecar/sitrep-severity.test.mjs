import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scoreConflicts,
  scoreMarkets,
  scoreCyber,
  scoreMilitary,
  scoreWeather,
  scoreSeismic,
  scoreHealth,
  scoreEconomic,
  scoreSanctions,
  scoreAllDomains,
} from './sitrep-severity.mjs';

test('scoreConflicts: empty events = 1', () => {
  assert.equal(scoreConflicts([]), 1);
});

test('scoreConflicts: 10 events = 2', () => {
  const events = Array.from({ length: 10 }, () => ({ event_type: 'Protests', country: 'X' }));
  assert.equal(scoreConflicts(events), 2);
});

test('scoreConflicts: 20 events with fatalities = 3', () => {
  const events = Array.from({ length: 20 }, () => ({ event_type: 'Battles', fatalities: 1 }));
  assert.equal(scoreConflicts(events), 3);
});

test('scoreConflicts: 35 events = 4', () => {
  const events = Array.from({ length: 35 }, () => ({ event_type: 'Battles' }));
  assert.equal(scoreConflicts(events), 4);
});

test('scoreMarkets: no quotes = 1', () => {
  assert.equal(scoreMarkets([]), 1);
});

test('scoreMarkets: SPY down 3% = 2 (one threshold)', () => {
  assert.equal(scoreMarkets([{ symbol: 'SPY', changePercent: -3 }]), 2);
});

test('scoreMarkets: SPY -3% + BTC -6% = 3 (two thresholds)', () => {
  assert.equal(scoreMarkets([
    { symbol: 'SPY', changePercent: -3 },
    { symbol: 'BTC-USD', changePercent: -6 },
  ]), 3);
});

test('scoreWeather: no alerts = 1', () => {
  assert.equal(scoreWeather([]), 1);
});

test('scoreWeather: severe alerts = 3', () => {
  const alerts = [{ severity: 'Severe', event: 'Flood Warning' }];
  assert.equal(scoreWeather(alerts), 3);
});

test('scoreWeather: extreme alerts = 5', () => {
  const alerts = [{ severity: 'Extreme', event: 'Hurricane Warning' }];
  assert.equal(scoreWeather(alerts), 5);
});

test('scoreCyber: no KEVs no IOCs = 1', () => {
  assert.equal(scoreCyber([], []), 1);
});

test('scoreCyber: 30 IOCs + new KEV = 3', () => {
  const iocs = Array.from({ length: 30 }, () => ({ indicator: 'test-ioc' }));
  const kevs = [{ indicator: 'CVE-2026-1234', firstSeen: new Date().toISOString().slice(0, 10) }];
  assert.equal(scoreCyber(iocs, kevs), 3);
});

test('scoreSeismic: no quakes = 1', () => {
  assert.equal(scoreSeismic([]), 1);
});

test('scoreSeismic: M6.5 = 4', () => {
  assert.equal(scoreSeismic([{ magnitude: 6.5 }]), 4);
});

test('scoreSeismic: M7.5 = 5', () => {
  assert.equal(scoreSeismic([{ magnitude: 7.5 }]), 5);
});

test('scoreMilitary: baseline = 1', () => {
  assert.equal(scoreMilitary({ aircraft: [], vessels: [], posture: {} }), 1);
});

test('scoreHealth: no outbreaks = 1', () => {
  assert.equal(scoreHealth([]), 1);
});

test('scoreEconomic: empty = 1', () => {
  assert.equal(scoreEconomic({}), 1);
});

test('scoreSanctions: empty = 1', () => {
  assert.equal(scoreSanctions([]), 1);
});

test('scoreAllDomains: returns all domain scores', () => {
  const scores = scoreAllDomains({
    conflicts: [],
    markets: [],
    cyber: { iocs: [], kevs: [] },
    military: { aircraft: [], vessels: [], posture: {} },
    weather: [],
    infrastructure: { gridAlerts: [] },
    seismic: [],
    health: [],
    economic: {},
    sanctions: [],
  });
  assert.equal(typeof scores.conflicts, 'number');
  assert.equal(typeof scores.markets, 'number');
  assert.equal(typeof scores.cyber, 'number');
  assert.equal(typeof scores.military, 'number');
  assert.equal(typeof scores.weather, 'number');
  assert.equal(typeof scores.seismic, 'number');
  assert.equal(typeof scores.health, 'number');
  assert.equal(typeof scores.economic, 'number');
  assert.equal(typeof scores.sanctions, 'number');
});
