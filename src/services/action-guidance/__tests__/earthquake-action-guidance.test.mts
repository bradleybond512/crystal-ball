import assert from 'node:assert/strict';
import test from 'node:test';

import { actionsForEarthquake } from '../earthquake-action-guidance.ts';

const hasMatch = (xs: readonly string[], re: RegExp): boolean => xs.some((x) => re.test(x));

test('M7.0 + tsunami warning → P1 shelter brief includes high ground', () => {
  const brief = actionsForEarthquake(7.0, 10, 18, { tsunamiWarning: true });

  assert.equal(brief.tier, 'shelter');
  assert.ok(hasMatch(brief.recommendedActions, /high ground/i), 'expected a "high ground" action');
  assert.ok(hasMatch(brief.recommendedActions, /drop, cover/i), 'expected drop-cover-hold action');
  // High ground is life-safety, so it leads.
  assert.match(brief.recommendedActions[0]!, /high ground/i);
  assert.match(brief.headline, /tsunami/i);
});

test('M5.0 shallow near a city → P3 + structural follow-up present, no P1', () => {
  const brief = actionsForEarthquake(5.0, 8, 12, { populationDensity: 'high' });

  assert.equal(brief.tier, 'prepare');
  // No life-safety P1 actions for a sub-6.5 quake without a tsunami.
  assert.ok(!hasMatch(brief.recommendedActions, /high ground/i));
  assert.ok(!hasMatch(brief.recommendedActions, /drop, cover/i));
  // P3 short-term resilience.
  assert.ok(hasMatch(brief.recommendedActions, /aftershock/i), 'expected aftershock prep');
  assert.ok(hasMatch(brief.recommendedActions, /water/i), 'expected water storage');
  // P5 structural inspection (magnitude ≥ 5.0).
  assert.ok(hasMatch(brief.recommendedActions, /structural inspection/i), 'expected structural inspection');
});

test('M3.0 deep → minimal actions, no P1', () => {
  const brief = actionsForEarthquake(3.0, 120, 40, {});

  assert.equal(brief.tier, 'monitor');
  assert.ok(!hasMatch(brief.recommendedActions, /high ground/i));
  assert.ok(!hasMatch(brief.recommendedActions, /drop, cover/i));
  assert.ok(brief.recommendedActions.length <= 2, 'expected a minimal action list');
  assert.ok(hasMatch(brief.recommendedActions, /monitor/i), 'expected a monitor-only fallback');
});

test('brief shape matches ActionBrief contract', () => {
  const brief = actionsForEarthquake(6.6, 15, 30, {});
  assert.equal(typeof brief.situationId, 'string');
  assert.ok(Array.isArray(brief.confirmingSources) && brief.confirmingSources.length > 0);
  assert.ok(Array.isArray(brief.invalidatingSources) && brief.invalidatingSources.length > 0);
  assert.ok(Array.isArray(brief.recommendedPanels) && brief.recommendedPanels.length > 0);
  assert.equal(typeof brief.reason, 'string');
});
