import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEVERITY_BADGE,
  formatStarted,
  linkedCountLabel,
  sortSituations,
} from '../situation-panel-helpers.ts';
import type { Situation, SituationSeverity } from '@/types/intelligence';

const NOW = Date.parse('2026-05-11T12:00:00Z');

function situation(over: Partial<Situation> = {}): Situation {
  return {
    id: over.id ?? 'sit-1',
    name: over.name ?? 'Test',
    status: over.status ?? 'active',
    severity: over.severity ?? 'high',
    domain: over.domain ?? 'natural',
    startedAt: over.startedAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
    observationIds: over.observationIds ?? [],
    correlationIds: over.correlationIds ?? [],
    summary: over.summary ?? '',
    location: over.location,
    tags: over.tags ?? [],
    confidence: over.confidence ?? 0.7,
  };
}

test('SEVERITY_BADGE covers every SituationSeverity value', () => {
  for (const s of ['critical', 'high', 'moderate', 'low', 'info'] as SituationSeverity[]) {
    assert.match(SEVERITY_BADGE[s].color, /^#[0-9a-f]{6}$/i);
    assert.ok(SEVERITY_BADGE[s].label.length > 0);
  }
});

test('sortSituations: severity desc, then updatedAt desc as tiebreaker', () => {
  const list: Situation[] = [
    situation({ id: 'low-recent',   severity: 'low',      updatedAt: NOW }),
    situation({ id: 'crit-old',     severity: 'critical', updatedAt: NOW - 1000 }),
    situation({ id: 'high-recent',  severity: 'high',     updatedAt: NOW }),
    situation({ id: 'high-old',     severity: 'high',     updatedAt: NOW - 5000 }),
  ];
  const sorted = sortSituations(list).map((s) => s.id);
  assert.deepEqual(sorted, ['crit-old', 'high-recent', 'high-old', 'low-recent']);
});

test('sortSituations: returns a new array, leaves the input untouched', () => {
  const list = [situation({ id: 'a', severity: 'low' }),
    situation({ id: 'b', severity: 'critical' })];
  const sorted = sortSituations(list);
  assert.equal(list[0]?.id, 'a');           // input order preserved
  assert.equal(sorted[0]?.id, 'b');
});

test('formatStarted: ladders s / m / h / d, future → "just now"', () => {
  assert.equal(formatStarted(NOW + 1000, NOW), 'just now');
  assert.equal(formatStarted(NOW - 5_000, NOW), '5s ago');
  assert.equal(formatStarted(NOW - 5 * 60_000, NOW), '5m ago');
  assert.equal(formatStarted(NOW - 3 * 60 * 60_000, NOW), '3h ago');
  assert.equal(formatStarted(NOW - 2 * 24 * 60 * 60_000, NOW), '2d ago');
});

test('linkedCountLabel: pluralises and concats observation + correlation lines', () => {
  assert.equal(linkedCountLabel(situation()), 'no linked events');
  assert.equal(linkedCountLabel(situation({ observationIds: ['o-1'] })), '1 observation');
  assert.equal(
    linkedCountLabel(situation({ observationIds: ['o-1', 'o-2'], correlationIds: ['c-1'] })),
    '2 observations · 1 correlation',
  );
});
