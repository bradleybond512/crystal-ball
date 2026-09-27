import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseAll } from '../api-diagnostic.ts';
import { dataFreshness } from '../data-freshness.ts';

test('diagnostics never report all sources healthy while failures and unknowns exist', () => {
  const [healthySource, failingSource] = dataFreshness.getAllSources();
  dataFreshness.recordUpdate(healthySource.id, 1);
  dataFreshness.recordError(failingSource.id, 'upstream unavailable');

  const report = diagnoseAll();

  assert.ok(report.failing > 0);
  assert.ok(report.unknown > 0);
  assert.equal(
    report.recommendations.includes('All sources within expected freshness windows.'),
    false,
  );
  assert.ok(report.recommendations.some((recommendation) => /failing/i.test(recommendation)));
  assert.ok(report.recommendations.some((recommendation) => /unknown/i.test(recommendation)));
});

test('GDACS fresh data remains degraded with explicit five-hazard coverage', () => {
  dataFreshness.recordUpdate('gdacs', 6);
  const source = diagnoseAll().sources.find(row => row.id === 'gdacs')!;
  assert.equal(source.status, 'degraded');
  assert.ok(source.notes.includes('Volcano coverage unavailable; verified coverage: EQ, FL, TC, WF, DR.'));
  assert.equal(source.notes.some(note => note.startsWith('Stale')), false);
});

test('GDACS coverage gap preserves stronger failing and silent states', () => {
  dataFreshness.recordUpdate('gdacs', 6, Date.now() - 7 * 3600_000);
  let source = diagnoseAll().sources.find(row => row.id === 'gdacs')!;
  assert.equal(source.status, 'silent');
  assert.ok(source.notes.some(note => note.includes('Volcano coverage unavailable')));
  dataFreshness.recordError('gdacs', 'upstream unavailable');
  source = diagnoseAll().sources.find(row => row.id === 'gdacs')!;
  assert.equal(source.status, 'failing');
  assert.ok(source.notes.some(note => note.includes('Volcano coverage unavailable')));
});

test('GDACS probe uses one valid hazard and never certifies aggregate health', async (t) => {
  const { pingSource } = await import('../api-diagnostic.ts');
  const before = diagnoseAll().sources.find(row => row.id === 'gdacs')!;
  let request = '';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    request = String(url);
    return new Response('{}', { status: 200 });
  });
  const result = await pingSource('gdacs');
  assert.equal(request, 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=EQ');
  assert.equal(result.ok, true);
  assert.equal((result as { scope?: string }).scope, 'EQ endpoint reachability only; not aggregate GDACS coverage.');
  assert.deepEqual(diagnoseAll().sources.find(row => row.id === 'gdacs'), before);
});
