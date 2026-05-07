import assert from 'node:assert/strict';
import test from 'node:test';
import { diffAlerts, type IpawsAlert } from '../ipaws-monitor.ts';

const alert = (id: string, overrides: Partial<IpawsAlert> = {}): IpawsAlert => ({
  id,
  source: 'NWS',
  event: 'Test',
  headline: 'h',
  description: '',
  severity: 'Severe',
  urgency: 'Expected',
  certainty: 'Observed',
  areaDesc: 'X',
  effective: '',
  expires: '',
  status: 'Actual',
  centroid: null,
  ...overrides,
});

test('diffAlerts: returns alerts in next that are not in prev', () => {
  const prev = [alert('a'), alert('b')];
  const next = [alert('b'), alert('c'), alert('d')];
  const result = diffAlerts(prev, next);
  assert.deepEqual(result.map(a => a.id), ['c', 'd']);
});

test('diffAlerts: empty prev means all of next is new', () => {
  const next = [alert('a'), alert('b')];
  const result = diffAlerts([], next);
  assert.equal(result.length, 2);
});

test('diffAlerts: empty next means no diff', () => {
  const prev = [alert('a')];
  const result = diffAlerts(prev, []);
  assert.deepEqual(result, []);
});

test('diffAlerts: same set of ids returns empty', () => {
  const prev = [alert('a'), alert('b')];
  const next = [alert('a'), alert('b')];
  const result = diffAlerts(prev, next);
  assert.deepEqual(result, []);
});
