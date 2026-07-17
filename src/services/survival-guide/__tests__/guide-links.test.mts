import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES_BY_PLAYBOOK_CATEGORY, GUIDE_BY_WEATHER_HAZARD, guidesForPlaybookCategory, guideForWeatherHazard } from '../guide-links.ts';
import { getGuide } from '../guide-library.ts';

test('every playbook-category guide id resolves', () => {
  for (const [cat, ids] of Object.entries(GUIDES_BY_PLAYBOOK_CATEGORY)) {
    assert.ok(ids.length > 0, `${cat} has no guides`);
    for (const id of ids) assert.ok(getGuide(id), `${cat} -> unknown ${id}`);
  }
});

test('every weather-hazard guide id resolves', () => {
  for (const [hazard, id] of Object.entries(GUIDE_BY_WEATHER_HAZARD)) {
    assert.ok(getGuide(id), `${hazard} -> unknown ${id}`);
  }
});

test('lookups return expected shapes', () => {
  assert.ok(Array.isArray(guidesForPlaybookCategory('earthquake')));
  assert.equal(guideForWeatherHazard('tornado'), 'tornado');
});
