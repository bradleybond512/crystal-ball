import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAndNormalizeWeatherAlerts, MAX_ACTIVE_ALERTS } from '../../weather.ts';

// The national NWS active-alerts feed is filtered, prioritized, and capped
// before it reaches personalization. The ORIGINAL bug: a plain `.slice(0, 50)`
// in feed order could drop the user's own Severe/Extreme warning behind a wall
// of low-severity products (in a busy outbreak there are hundreds of Minor/
// Moderate advisories). The feed must keep the MOST SEVERE alerts, not the
// first N in arbitrary API order.

interface FeatureInput {
  id: string;
  properties: {
    event: string;
    severity: string;
    headline: string;
    description: string;
    areaDesc: string;
    onset: string;
    expires: string;
    geocode?: { UGC?: string[] };
  };
  geometry?: { type: string; coordinates: number[][][] };
}

function feature(severity: string, i: number): FeatureInput {
  return {
    id: `nws-${severity}-${i}`,
    properties: {
      event: `${severity} Event ${i}`,
      severity,
      headline: `${severity} headline ${i}`,
      description: 'x'.repeat(20),
      areaDesc: 'Somewhere, US',
      onset: '2026-07-27T12:00:00Z',
      expires: '2026-07-27T13:00:00Z',
      geocode: { UGC: [`INC${String(i).padStart(3, '0')}`] },
    },
  };
}

test('a lone Severe alert survives a feed flooded with low-severity alerts', () => {
  // 300 Minor alerts FIRST (so plain slice(0,50) in feed order would keep only
  // Minors), then the user's single Severe alert dead last in API order.
  const flood: FeatureInput[] = [];
  for (let i = 0; i < 300; i += 1) flood.push(feature('Minor', i));
  flood.push(feature('Severe', 999));

  const out = selectAndNormalizeWeatherAlerts(flood);

  assert.ok(
    out.some((a) => a.severity === 'Severe' && a.id === 'nws-Severe-999'),
    'the Severe alert must not be dropped behind low-severity noise',
  );
});

test('Extreme and Severe alerts sort ahead of lesser severities', () => {
  const mixed = [
    feature('Minor', 1),
    feature('Extreme', 2),
    feature('Moderate', 3),
    feature('Severe', 4),
  ];
  const out = selectAndNormalizeWeatherAlerts(mixed);
  assert.equal(out[0]?.severity, 'Extreme');
  assert.equal(out[1]?.severity, 'Severe');
});

test('Unknown-severity alerts are filtered out', () => {
  const out = selectAndNormalizeWeatherAlerts([feature('Unknown', 1), feature('Severe', 2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.severity, 'Severe');
});

test('the feed is capped at MAX_ACTIVE_ALERTS', () => {
  const many: FeatureInput[] = [];
  for (let i = 0; i < MAX_ACTIVE_ALERTS + 50; i += 1) many.push(feature('Moderate', i));
  const out = selectAndNormalizeWeatherAlerts(many);
  assert.equal(out.length, MAX_ACTIVE_ALERTS);
});

test('the cap is generous enough to keep a national severe-weather outbreak', () => {
  // The old cap (50) was smaller than a realistic simultaneous-warning count.
  assert.ok(MAX_ACTIVE_ALERTS >= 200, `cap should be >= 200, got ${MAX_ACTIVE_ALERTS}`);
});

test('no Severe/Extreme alert is ever dropped, even beyond the cap', () => {
  // A national outbreak can exceed MAX_ACTIVE_ALERTS in Severe products alone
  // (hundreds of concurrent severe-thunderstorm / tornado / flash-flood
  // warnings). Ranking by severity is not enough: if the user's Severe alert
  // sorts behind MAX_ACTIVE_ALERTS other Severe alerts, a hard slice still
  // drops it. The cap must shed only LESSER severities.
  const flood: FeatureInput[] = [];
  for (let i = 0; i < MAX_ACTIVE_ALERTS + 20; i += 1) flood.push(feature('Severe', i));
  flood.push(feature('Severe', 999)); // the user's own warning, dead last
  const out = selectAndNormalizeWeatherAlerts(flood);
  assert.ok(
    out.some((a) => a.id === 'nws-Severe-999'),
    'a Severe alert must survive the cap no matter how many precede it',
  );
});

test('the cap sheds only lesser severities, keeping every Severe/Extreme', () => {
  const flood: FeatureInput[] = [];
  for (let i = 0; i < MAX_ACTIVE_ALERTS + 10; i += 1) flood.push(feature('Severe', i));
  for (let i = 0; i < 30; i += 1) flood.push(feature('Moderate', i));
  const out = selectAndNormalizeWeatherAlerts(flood);
  assert.equal(
    out.filter((a) => a.severity === 'Severe').length,
    MAX_ACTIVE_ALERTS + 10,
    'all Severe alerts retained',
  );
  assert.equal(
    out.filter((a) => a.severity === 'Moderate').length,
    0,
    'lesser alerts shed once the protected set fills the budget',
  );
});
