import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelLabel, levelColor, levelDotClass, stripSummary, actionsNowCount } from '../datacenter-view.ts';
import type { DataCenterPosture } from '../datacenter-types.ts';

const BASE: DataCenterPosture = {
  site: { id: 's', name: 'DC1', lat: 0, lon: 0, radiusKm: 25, eiaRegion: 'MISO' },
  overall: 'warning',
  headline: 'Severe storm ~30 min out · grid normal',
  power: { level: 'normal', gridUtilizationPct: 60, gridAlerts: [], nearbyOutageCount: 0, drivers: [] },
  weather: { level: 'warning', activeHazards: ['severe_thunderstorm'], stormMode: null, arrivalWindowMins: 30, drivers: [] },
  actions: [
    { id: 'a', audience: 'onsite_safety', urgency: 'now', title: 'Shelter', detail: '', trigger: '', expiresAt: null },
    { id: 'b', audience: 'facility_ops', urgency: 'soon', title: 'Fuel', detail: '', trigger: '', expiresAt: null },
  ],
  updatedAt: 0,
  staleInputs: [],
};

test('levelLabel renders human text', () => {
  assert.equal(levelLabel('normal'), 'All clear');
  assert.equal(levelLabel('critical'), 'Critical');
});

test('levelColor + levelDotClass return distinct values per level', () => {
  assert.notEqual(levelColor('normal'), levelColor('critical'));
  assert.match(levelDotClass('warning'), /warning/);
});

test('actionsNowCount counts only now-urgency actions', () => {
  assert.equal(actionsNowCount(BASE), 1);
});

test('stripSummary is a single line with name, level, headline, and now-count', () => {
  const s = stripSummary(BASE);
  assert.match(s, /DC1/);
  assert.match(s, /Severe storm/);
  assert.match(s, /1 action/);
});
