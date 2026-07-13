import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLibraryView } from '../library-view.ts';
import type { LibraryInputs } from '../library-view.ts';
import type { PanelMeta } from '../../../config/panel-metadata.ts';

function meta(overrides: Partial<PanelMeta> = {}): PanelMeta {
  return { domain: 'hazards-weather', tags: ['weather'], tier: 'library', ...overrides };
}

function inputs(): LibraryInputs {
  return {
    metadata: {
      'severe-weather': meta({ featured: true, icon: '⛈️' }),
      earthquakes: meta({ tags: ['seismic', 'usgs'] }),
      markets: meta({ domain: 'markets-economy', featured: true }),
      'self-test': meta({ domain: 'system-health', tier: 'system' }),
    },
    names: {
      'severe-weather': { name: 'Severe Weather' },
      earthquakes: { name: 'Earthquakes' },
      markets: { name: 'Markets' },
      'self-test': { name: 'Self-Test' },
    },
    domainLabels: {
      'personal-safety': 'Personal Safety',
      'global-intel': 'Global Intel',
      'markets-economy': 'Markets & Economy',
      'hazards-weather': 'Hazards & Weather',
      'cyber-infrastructure': 'Cyber & Infrastructure',
      'space-aviation': 'Space & Aviation',
      'health-environment': 'Health & Environment',
      'system-health': 'System Health',
    },
  };
}

test('groups panels into 8 domains with featured first and counts', () => {
  const view = buildLibraryView(inputs(), '');
  assert.equal(view.domains.length, 8);
  const hazards = view.domains.find((d) => d.domain === 'hazards-weather')!;
  assert.equal(hazards.label, 'Hazards & Weather');
  assert.equal(hazards.totalCount, 2);
  assert.deepEqual(hazards.featured.map((p) => p.panelId), ['severe-weather']);
  assert.deepEqual(hazards.rest.map((p) => p.panelId), ['earthquakes']);
  assert.equal(hazards.featured[0]!.icon, '⛈️');
});

test('system-health domain is ordered last', () => {
  const view = buildLibraryView(inputs(), '');
  assert.equal(view.domains[view.domains.length - 1]!.domain, 'system-health');
});

test('query filters by name and tags across all domains, case-insensitive', () => {
  const byTag = buildLibraryView(inputs(), 'USGS');
  const hazards = byTag.domains.find((d) => d.domain === 'hazards-weather')!;
  assert.deepEqual(hazards.rest.map((p) => p.panelId), ['earthquakes']);
  assert.equal(hazards.featured.length, 0);
  assert.equal(byTag.matchCount, 1);
  const byName = buildLibraryView(inputs(), 'market');
  assert.equal(byName.matchCount, 1);
  assert.deepEqual(byName.domains.find((d) => d.domain === 'markets-economy')!.featured.map((p) => p.panelId), ['markets']);
});

test('empty domains are kept (with zero counts) so the nav rail is stable', () => {
  const view = buildLibraryView(inputs(), 'zzz-no-match');
  assert.equal(view.domains.length, 8);
  assert.equal(view.matchCount, 0);
  assert.ok(view.domains.every((d) => d.featured.length === 0 && d.rest.length === 0));
});

test('panels sort alphabetically by title within featured and rest', () => {
  const two = inputs();
  two.metadata['zeta-weather'] = meta();
  two.names['zeta-weather'] = { name: 'Zeta Weather' };
  two.metadata['alpha-weather'] = meta();
  two.names['alpha-weather'] = { name: 'Alpha Weather' };
  const hazards = buildLibraryView(two, '').domains.find((d) => d.domain === 'hazards-weather')!;
  assert.deepEqual(hazards.rest.map((p) => p.title), ['Alpha Weather', 'Earthquakes', 'Zeta Weather']);
});
