import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type SanctionedEntity,
  type SanctionsDataset,
  aggregateStats,
  countBySchema,
  formatDatasetName,
  getFreshnessLabel,
  getFreshnessStatus,
  getTopicBadge,
  mostStaleDataset,
} from '../open-sanctions-helpers.ts';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString();

function dataset(partial: Partial<SanctionsDataset> = {}): SanctionsDataset {
  return {
    name: 'us_ofac_sdn',
    title: 'OFAC SDN List',
    entityCount: 100,
    lastUpdated: daysAgo(1),
    countries: ['us'],
    ...partial,
  };
}

function entity(partial: Partial<SanctionedEntity> = {}): SanctionedEntity {
  return {
    id: 'NK-abc',
    caption: 'John Smith',
    schema: 'Person',
    datasets: ['us_ofac_sdn'],
    topics: ['sanction'],
    countries: ['ru'],
    aliases: [],
    ...partial,
  };
}

// ── getFreshnessStatus ──────────────────────────────────────────────────────

test('getFreshnessStatus: today is fresh', () => {
  assert.equal(getFreshnessStatus(daysAgo(0), NOW), 'fresh');
});

test('getFreshnessStatus: 3 days ago is fresh', () => {
  assert.equal(getFreshnessStatus(daysAgo(3), NOW), 'fresh');
});

test('getFreshnessStatus: 6 days ago is still fresh', () => {
  assert.equal(getFreshnessStatus(daysAgo(6), NOW), 'fresh');
});

test('getFreshnessStatus: 7 days ago crosses into aging', () => {
  assert.equal(getFreshnessStatus(daysAgo(7), NOW), 'aging');
});

test('getFreshnessStatus: 13 days ago is aging', () => {
  assert.equal(getFreshnessStatus(daysAgo(13), NOW), 'aging');
});

test('getFreshnessStatus: 14 days ago is stale', () => {
  assert.equal(getFreshnessStatus(daysAgo(14), NOW), 'stale');
});

test('getFreshnessStatus: 30 days ago is stale', () => {
  assert.equal(getFreshnessStatus(daysAgo(30), NOW), 'stale');
});

test('getFreshnessStatus: future timestamp (clock skew) is treated as fresh', () => {
  assert.equal(getFreshnessStatus(daysAgo(-2), NOW), 'fresh');
});

test('getFreshnessStatus: unparseable date fails safe to stale', () => {
  assert.equal(getFreshnessStatus('not-a-date', NOW), 'stale');
  assert.equal(getFreshnessStatus('', NOW), 'stale');
});

// ── getFreshnessLabel ───────────────────────────────────────────────────────

test('getFreshnessLabel: under a day reads "today"', () => {
  assert.equal(getFreshnessLabel(daysAgo(0), NOW), 'today');
});

test('getFreshnessLabel: a few hours ago reads "today"', () => {
  assert.equal(getFreshnessLabel(new Date(NOW - 5 * 3_600_000).toISOString(), NOW), 'today');
});

test('getFreshnessLabel: exactly one day uses singular', () => {
  assert.equal(getFreshnessLabel(daysAgo(1), NOW), '1 day ago');
});

test('getFreshnessLabel: multiple days uses plural', () => {
  assert.equal(getFreshnessLabel(daysAgo(2), NOW), '2 days ago');
  assert.equal(getFreshnessLabel(daysAgo(12), NOW), '12 days ago');
});

test('getFreshnessLabel: future timestamp reads "just now"', () => {
  assert.equal(getFreshnessLabel(daysAgo(-1), NOW), 'just now');
});

test('getFreshnessLabel: unparseable date reads "unknown"', () => {
  assert.equal(getFreshnessLabel('garbage', NOW), 'unknown');
});

// ── formatDatasetName ───────────────────────────────────────────────────────

test('formatDatasetName: known OpenSanctions IDs map to human names', () => {
  assert.equal(formatDatasetName('us_ofac_sdn'), 'OFAC SDN');
  assert.equal(formatDatasetName('eu_fsf'), 'EU Sanctions');
  assert.equal(formatDatasetName('gb_hmt_sanctions'), 'UK OFSI');
  assert.equal(formatDatasetName('un_sc_sanctions'), 'UN Security Council');
  assert.equal(formatDatasetName('us_bis_denied'), 'BIS Entity List');
  assert.equal(formatDatasetName('interpol_red'), 'INTERPOL Red Notices');
});

test('formatDatasetName: known mapping is case-insensitive on input', () => {
  assert.equal(formatDatasetName('US_OFAC_SDN'), 'OFAC SDN');
});

test('formatDatasetName: unknown IDs are de-slugged and title-cased', () => {
  assert.equal(formatDatasetName('ru_egrul'), 'RU Egrul');
  assert.equal(formatDatasetName('my_custom_list'), 'MY Custom List');
});

test('formatDatasetName: short tokens are upper-cased as acronyms', () => {
  assert.equal(formatDatasetName('za_fic'), 'ZA FIC');
});

test('formatDatasetName: hyphen and whitespace separators are handled', () => {
  assert.equal(formatDatasetName('some-list name'), 'Some List Name');
});

test('formatDatasetName: empty string returns empty string', () => {
  assert.equal(formatDatasetName(''), '');
});

// ── getTopicBadge ───────────────────────────────────────────────────────────

test('getTopicBadge: known topics get short labels', () => {
  assert.equal(getTopicBadge('sanction'), 'Sanctioned');
  assert.equal(getTopicBadge('pep'), 'PEP');
  assert.equal(getTopicBadge('crime'), 'Crime');
  assert.equal(getTopicBadge('wanted'), 'Wanted');
  assert.equal(getTopicBadge('debarment'), 'Debarred');
});

test('getTopicBadge: dotted OpenSanctions topic prefixes resolve to base label', () => {
  assert.equal(getTopicBadge('role.pep'), 'PEP');
  assert.equal(getTopicBadge('sanction.linked'), 'Sanctioned');
});

test('getTopicBadge: badge lookup is case-insensitive', () => {
  assert.equal(getTopicBadge('PEP'), 'PEP');
});

test('getTopicBadge: unknown topic is title-cased as fallback', () => {
  assert.equal(getTopicBadge('export.control'), 'Export Control');
  assert.equal(getTopicBadge('poi'), 'Poi');
});

test('getTopicBadge: empty topic returns empty string', () => {
  assert.equal(getTopicBadge(''), '');
});

// ── countBySchema ───────────────────────────────────────────────────────────

test('countBySchema: empty list yields empty map', () => {
  assert.deepEqual(countBySchema([]), {});
});

test('countBySchema: tallies entities by schema', () => {
  const result = countBySchema([
    entity({ schema: 'Person' }),
    entity({ schema: 'Person' }),
    entity({ schema: 'Organization' }),
    entity({ schema: 'Vessel' }),
  ]);
  assert.equal(result.Person, 2);
  assert.equal(result.Organization, 1);
  assert.equal(result.Vessel, 1);
});

test('countBySchema: missing/blank schema buckets under "Unknown"', () => {
  const result = countBySchema([entity({ schema: '' }), entity({ schema: undefined as unknown as string })]);
  assert.equal(result.Unknown, 2);
});

test('countBySchema: counts aircraft distinctly', () => {
  const result = countBySchema([entity({ schema: 'Aircraft' }), entity({ schema: 'Aircraft' })]);
  assert.equal(result.Aircraft, 2);
  assert.equal(result.Person, undefined);
});

// ── aggregateStats ──────────────────────────────────────────────────────────

test('aggregateStats: sums entity counts and counts datasets', () => {
  const stats = aggregateStats(
    [dataset({ entityCount: 100 }), dataset({ name: 'eu_fsf', entityCount: 250 })],
    [],
    NOW,
  );
  assert.equal(stats.totalDatasets, 2);
  assert.equal(stats.totalEntities, 350);
});

test('aggregateStats: derives schema breakdown from entities', () => {
  const stats = aggregateStats(
    [dataset()],
    [
      entity({ schema: 'Person' }),
      entity({ schema: 'Organization' }),
      entity({ schema: 'Vessel' }),
      entity({ schema: 'Vessel' }),
      entity({ schema: 'Aircraft' }),
    ],
    NOW,
  );
  assert.equal(stats.persons, 1);
  assert.equal(stats.organizations, 1);
  assert.equal(stats.vessels, 2);
  assert.equal(stats.aircraft, 1);
});

test('aggregateStats: missing entityCount is treated as zero', () => {
  const stats = aggregateStats(
    [dataset({ entityCount: undefined as unknown as number }), dataset({ entityCount: 40 })],
    [],
    NOW,
  );
  assert.equal(stats.totalEntities, 40);
});

test('aggregateStats: stamps fetchedAt from the provided clock', () => {
  const stats = aggregateStats([dataset()], [], NOW);
  assert.equal(stats.fetchedAt, new Date(NOW).toISOString());
});

test('aggregateStats: empty dataset list yields all-zero stats', () => {
  const stats = aggregateStats([], [], NOW);
  assert.equal(stats.totalDatasets, 0);
  assert.equal(stats.totalEntities, 0);
  assert.equal(stats.persons, 0);
  assert.equal(stats.organizations, 0);
  assert.equal(stats.vessels, 0);
  assert.equal(stats.aircraft, 0);
  assert.deepEqual(stats.datasets, []);
});

test('aggregateStats: omitting entities yields zero schema counts but keeps dataset totals', () => {
  const stats = aggregateStats([dataset({ entityCount: 10 })], undefined, NOW);
  assert.equal(stats.totalEntities, 10);
  assert.equal(stats.persons, 0);
  assert.equal(stats.vessels, 0);
});

test('aggregateStats: passes the datasets through verbatim', () => {
  const ds = dataset({ name: 'un_sc_sanctions' });
  const stats = aggregateStats([ds], [], NOW);
  assert.equal(stats.datasets.length, 1);
  assert.equal(stats.datasets[0]!.name, 'un_sc_sanctions');
});

// ── mostStaleDataset ────────────────────────────────────────────────────────

test('mostStaleDataset: returns the oldest dataset by lastUpdated', () => {
  const fresh = dataset({ name: 'us_ofac_sdn', lastUpdated: daysAgo(2) });
  const stale = dataset({ name: 'interpol_red', lastUpdated: daysAgo(12) });
  const mid = dataset({ name: 'eu_fsf', lastUpdated: daysAgo(5) });
  assert.equal(mostStaleDataset([fresh, stale, mid])!.name, 'interpol_red');
});

test('mostStaleDataset: empty list returns null', () => {
  assert.equal(mostStaleDataset([]), null);
});

test('mostStaleDataset: datasets with unparseable dates sort as most stale', () => {
  const ok = dataset({ name: 'us_ofac_sdn', lastUpdated: daysAgo(2) });
  const broken = dataset({ name: 'broken', lastUpdated: 'n/a' });
  assert.equal(mostStaleDataset([ok, broken])!.name, 'broken');
});
