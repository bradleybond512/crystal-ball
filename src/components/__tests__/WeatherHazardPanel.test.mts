import assert from 'node:assert/strict';
import test from 'node:test';

import { groupAlertsByCategory, formatRelativeExpires } from '../weather-hazard-helpers.ts';
import type { NwsHazardAlert } from '@/services/weather/nws-hazards';

const NOW = 1_745_000_000_000;

function alert(partial: Partial<NwsHazardAlert>): NwsHazardAlert {
  return {
    id: '',
    event: '',
    severity: 'Severe',
    certainty: 'Likely',
    urgency: 'Expected',
    headline: '',
    areaDesc: '',
    sent: '',
    expires: '',
    category: 'other',
    ...partial,
  };
}

test('groupAlertsByCategory: buckets by category', () => {
  const alerts = [
    alert({ category: 'tornado' }),
    alert({ category: 'tornado' }),
    alert({ category: 'flood' }),
  ];
  const groups = groupAlertsByCategory(alerts);
  assert.equal(groups.tornado!.length, 2);
  assert.equal(groups.flood!.length, 1);
});

test('formatRelativeExpires: minutes', () => {
  const iso = new Date(NOW + 30 * 60_000).toISOString();
  assert.equal(formatRelativeExpires(iso, NOW), 'in 30m');
});

test('formatRelativeExpires: hours', () => {
  const iso = new Date(NOW + 5 * 60 * 60_000).toISOString();
  assert.equal(formatRelativeExpires(iso, NOW), 'in 5h');
});

test('formatRelativeExpires: days', () => {
  const iso = new Date(NOW + 2 * 24 * 60 * 60_000).toISOString();
  assert.equal(formatRelativeExpires(iso, NOW), 'in 2d');
});

test('formatRelativeExpires: expired', () => {
  const iso = new Date(NOW - 1000).toISOString();
  assert.equal(formatRelativeExpires(iso, NOW), 'expired');
});

test('formatRelativeExpires: empty / invalid string → empty', () => {
  assert.equal(formatRelativeExpires('', NOW), '');
  assert.equal(formatRelativeExpires('not-a-date', NOW), '');
});
