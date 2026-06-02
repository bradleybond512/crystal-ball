/**
 * Tests for DisinformationNetworksPanel — pure helpers + reference data.
 *
 * Run with:
 *   npx tsx --test tests/components/disinformation-networks-panel.test.mts
 *
 * No DOM required — all helpers are exported from
 * `disinformation-networks-helpers.ts` for testability.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  significanceRank,
  significanceColor,
  statusColor,
  formatAccountCount,
  networkScaleClass,
  actorClass,
  getByActor,
  getLargeNetworks,
  getActiveNetworks,
  getByTargetNarrative,
  mostActiveActor,
  totalAccountsRemoved,
  computeGlobalCIBIndex,
  buildRenderData,
  CIB_TAKEDOWNS,
  ACTIVE_NETWORKS,
  type CIBSignificance,
  type NetworkStatus,
} from '../../src/components/disinformation-networks-helpers.ts';

// ── significanceRank ─────────────────────────────────────────────────────────

test('significanceRank: Critical > High > Medium > Low', () => {
  assert.ok(significanceRank('Critical') > significanceRank('High'));
  assert.ok(significanceRank('High') > significanceRank('Medium'));
  assert.ok(significanceRank('Medium') > significanceRank('Low'));
});

test('significanceRank: Critical returns 4', () => {
  assert.equal(significanceRank('Critical'), 4);
});

test('significanceRank: Low returns 1', () => {
  assert.equal(significanceRank('Low'), 1);
});

test('significanceRank: all four levels return distinct values', () => {
  const levels: CIBSignificance[] = ['Low', 'Medium', 'High', 'Critical'];
  const ranks = new Set(levels.map((l) => significanceRank(l)));
  assert.equal(ranks.size, 4);
});

// ── significanceColor ────────────────────────────────────────────────────────

test('significanceColor: Critical returns red', () => {
  assert.ok(significanceColor('Critical').includes('#ef4444'));
});

test('significanceColor: Low returns green', () => {
  assert.ok(significanceColor('Low').includes('#4caf50'));
});

test('significanceColor: Medium returns yellow', () => {
  assert.ok(significanceColor('Medium').includes('#eab308'));
});

test('significanceColor: High returns orange', () => {
  assert.ok(significanceColor('High').includes('#f97316'));
});

test('significanceColor: all four levels return non-empty strings', () => {
  const levels: CIBSignificance[] = ['Low', 'Medium', 'High', 'Critical'];
  for (const l of levels) assert.ok(significanceColor(l).length > 0);
});

// ── statusColor ──────────────────────────────────────────────────────────────

test('statusColor: Active returns red', () => {
  assert.ok(statusColor('Active').includes('#ef4444'));
});

test('statusColor: Dismantled returns green', () => {
  assert.ok(statusColor('Dismantled').includes('#4caf50'));
});

test('statusColor: Disrupted returns orange', () => {
  assert.ok(statusColor('Disrupted').includes('#f97316'));
});

test('statusColor: all three statuses return distinct colours', () => {
  const statuses: NetworkStatus[] = ['Active', 'Disrupted', 'Dismantled'];
  const colours = new Set(statuses.map((s) => statusColor(s)));
  assert.equal(colours.size, 3);
});

// ── formatAccountCount ───────────────────────────────────────────────────────

test('formatAccountCount: 0 returns N/A', () => {
  assert.equal(formatAccountCount(0), 'N/A');
});

test('formatAccountCount: negative returns N/A', () => {
  assert.equal(formatAccountCount(-5), 'N/A');
});

test('formatAccountCount: 7700 returns comma-separated string', () => {
  const result = formatAccountCount(7700);
  assert.ok(result.includes('7') && result.includes('700'));
});

test('formatAccountCount: 1000000 formats with commas', () => {
  const result = formatAccountCount(1_000_000);
  assert.ok(result.includes('1') && result.includes('000'));
});

// ── networkScaleClass ────────────────────────────────────────────────────────

test('networkScaleClass: 500 → small', () => {
  assert.equal(networkScaleClass(500), 'small');
});

test('networkScaleClass: 1000 → medium (boundary, >= 1000)', () => {
  assert.equal(networkScaleClass(1000), 'medium');
});

test('networkScaleClass: 1001 → medium', () => {
  assert.equal(networkScaleClass(1_001), 'medium');
});

test('networkScaleClass: 10000 → large (boundary, >= 10000)', () => {
  assert.equal(networkScaleClass(10_000), 'large');
});

test('networkScaleClass: 10001 → large', () => {
  assert.equal(networkScaleClass(10_001), 'large');
});

test('networkScaleClass: 100000 → massive', () => {
  assert.equal(networkScaleClass(100_000), 'massive');
});

test('networkScaleClass: 2000000 → massive (50-cent army)', () => {
  assert.equal(networkScaleClass(2_000_000), 'massive');
});

// ── actorClass ───────────────────────────────────────────────────────────────

test('actorClass: Russia → state', () => {
  assert.equal(actorClass('Russia'), 'state');
});

test('actorClass: China (state-linked) → state', () => {
  assert.equal(actorClass('China (state-linked)'), 'state');
});

test('actorClass: Iran (MOIS-linked) → state', () => {
  assert.equal(actorClass('Iran (MOIS-linked)'), 'state');
});

test('actorClass: DPRK (state-linked) → state', () => {
  assert.equal(actorClass('DPRK (state-linked)'), 'state');
});

test('actorClass: unknown actor → unknown', () => {
  assert.equal(actorClass('Anonymous hacktivist collective'), 'unknown');
});

test('actorClass: case-insensitive matching', () => {
  assert.equal(actorClass('RUSSIA'), 'state');
});

// ── getByActor ───────────────────────────────────────────────────────────────

test('getByActor: filters Russia takedowns from reference data', () => {
  const russians = getByActor(CIB_TAKEDOWNS, 'Russia');
  assert.ok(russians.length > 0);
  for (const t of russians) {
    assert.ok(t.actor.toLowerCase().includes('russia'));
  }
});

test('getByActor: case-insensitive — russia matches Russia', () => {
  const lower = getByActor(CIB_TAKEDOWNS, 'russia');
  const upper = getByActor(CIB_TAKEDOWNS, 'Russia');
  assert.equal(lower.length, upper.length);
});

test('getByActor: unknown actor returns empty array', () => {
  assert.deepEqual(getByActor(CIB_TAKEDOWNS, 'Freedonia'), []);
});

test('getByActor: works on empty input', () => {
  assert.deepEqual(getByActor([], 'Russia'), []);
});

// ── getLargeNetworks ─────────────────────────────────────────────────────────

test('getLargeNetworks: default threshold 1000 excludes nothing from reference data (all > 1000)', () => {
  const large = getLargeNetworks(ACTIVE_NETWORKS);
  assert.ok(large.length > 0);
  for (const n of large) assert.ok(n.estimatedAccounts > 1000);
});

test('getLargeNetworks: very high threshold returns empty or few', () => {
  const huge = getLargeNetworks(ACTIVE_NETWORKS, 5_000_000);
  assert.equal(huge.length, 0);
});

test('getLargeNetworks: threshold 1000000 captures only 50-cent army', () => {
  const massive = getLargeNetworks(ACTIVE_NETWORKS, 1_000_000);
  assert.equal(massive.length, 1);
  assert.ok(massive[0].name.toLowerCase().includes('50-cent'));
});

test('getLargeNetworks: works on empty input', () => {
  assert.deepEqual(getLargeNetworks([]), []);
});

// ── getActiveNetworks ────────────────────────────────────────────────────────

test('getActiveNetworks: returns only Active status networks', () => {
  const active = getActiveNetworks(ACTIVE_NETWORKS);
  assert.ok(active.length > 0);
  for (const n of active) assert.equal(n.status, 'Active');
});

test('getActiveNetworks: excludes Disrupted networks', () => {
  const active = getActiveNetworks(ACTIVE_NETWORKS);
  const disrupted = ACTIVE_NETWORKS.filter((n) => n.status === 'Disrupted');
  for (const d of disrupted) {
    assert.ok(!active.some((a) => a.id === d.id));
  }
});

test('getActiveNetworks: works on empty input', () => {
  assert.deepEqual(getActiveNetworks([]), []);
});

// ── getByTargetNarrative ─────────────────────────────────────────────────────

test('getByTargetNarrative: election finds election-related takedowns', () => {
  const results = getByTargetNarrative(CIB_TAKEDOWNS, 'election');
  assert.ok(results.length > 0);
});

test('getByTargetNarrative: Ukraine finds Ukraine-related takedowns', () => {
  const results = getByTargetNarrative(CIB_TAKEDOWNS, 'Ukraine');
  assert.ok(results.length > 0);
});

test('getByTargetNarrative: gibberish returns empty', () => {
  assert.deepEqual(getByTargetNarrative(CIB_TAKEDOWNS, 'zzznomatch'), []);
});

test('getByTargetNarrative: case-insensitive search', () => {
  const lower = getByTargetNarrative(CIB_TAKEDOWNS, 'ukraine');
  const upper = getByTargetNarrative(CIB_TAKEDOWNS, 'Ukraine');
  assert.equal(lower.length, upper.length);
});

// ── mostActiveActor ──────────────────────────────────────────────────────────

test('mostActiveActor: returns non-empty string for reference data', () => {
  const actor = mostActiveActor(CIB_TAKEDOWNS);
  assert.ok(actor.length > 0);
  assert.notEqual(actor, 'Unknown');
});

test('mostActiveActor: Russia or Meta-takedown actor has multiple entries', () => {
  const actor = mostActiveActor(CIB_TAKEDOWNS);
  const count = CIB_TAKEDOWNS.filter((t) => t.actor === actor).length;
  assert.ok(count > 1);
});

test('mostActiveActor: empty array returns Unknown', () => {
  assert.equal(mostActiveActor([]), 'Unknown');
});

test('mostActiveActor: single entry returns that actor', () => {
  const td = CIB_TAKEDOWNS.slice(0, 1);
  assert.equal(mostActiveActor(td), td[0].actor);
});

// ── totalAccountsRemoved ─────────────────────────────────────────────────────

test('totalAccountsRemoved: sums all accounts in reference data', () => {
  const total = totalAccountsRemoved(CIB_TAKEDOWNS);
  assert.ok(total > 0);
  // Reference data has at least 7700 + 60000 from first two entries
  assert.ok(total >= 67_700);
});

test('totalAccountsRemoved: empty array returns 0', () => {
  assert.equal(totalAccountsRemoved([]), 0);
});

test('totalAccountsRemoved: single entry returns its accountsRemoved', () => {
  const td = CIB_TAKEDOWNS.filter((t) => t.accountsRemoved > 0).slice(0, 1);
  assert.equal(totalAccountsRemoved(td), td[0].accountsRemoved);
});

// ── computeGlobalCIBIndex ────────────────────────────────────────────────────

test('computeGlobalCIBIndex: returns number in [0, 100]', () => {
  const idx = computeGlobalCIBIndex(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  assert.ok(idx >= 0 && idx <= 100);
});

test('computeGlobalCIBIndex: reference data produces index > 0', () => {
  const idx = computeGlobalCIBIndex(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  assert.ok(idx > 0);
});

test('computeGlobalCIBIndex: empty takedowns returns 0', () => {
  assert.equal(computeGlobalCIBIndex([], ACTIVE_NETWORKS), 0);
});

test('computeGlobalCIBIndex: all Critical takedowns raises score vs all Low', () => {
  const critical = CIB_TAKEDOWNS.map((t) => ({ ...t, significance: 'Critical' as const }));
  const low      = CIB_TAKEDOWNS.map((t) => ({ ...t, significance: 'Low'      as const }));
  assert.ok(
    computeGlobalCIBIndex(critical, ACTIVE_NETWORKS) >
    computeGlobalCIBIndex(low,      ACTIVE_NETWORKS),
  );
});

// ── buildRenderData ──────────────────────────────────────────────────────────

test('buildRenderData: returns all takedowns sorted Critical-first', () => {
  const data = buildRenderData(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  assert.equal(data.takedowns.length, CIB_TAKEDOWNS.length);
  // First entry should be Critical or at least as significant as second
  if (data.takedowns.length >= 2) {
    assert.ok(
      significanceRank(data.takedowns[0].significance) >=
      significanceRank(data.takedowns[1].significance),
    );
  }
});

test('buildRenderData: globalCIBIndex matches computeGlobalCIBIndex', () => {
  const data  = buildRenderData(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  const index = computeGlobalCIBIndex(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  assert.equal(data.globalCIBIndex, index);
});

test('buildRenderData: totalAccountsRemoved matches totalAccountsRemoved helper', () => {
  const data  = buildRenderData(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  const total = totalAccountsRemoved(CIB_TAKEDOWNS);
  assert.equal(data.totalAccountsRemoved, total);
});

test('buildRenderData: mostActiveActor matches mostActiveActor helper', () => {
  const data  = buildRenderData(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  const actor = mostActiveActor(CIB_TAKEDOWNS);
  assert.equal(data.mostActiveActor, actor);
});

test('buildRenderData: activeNetworks count equals ACTIVE_NETWORKS', () => {
  const data = buildRenderData(CIB_TAKEDOWNS, ACTIVE_NETWORKS);
  assert.equal(data.activeNetworks.length, ACTIVE_NETWORKS.length);
});

// ── Reference data integrity ─────────────────────────────────────────────────

test('CIB_TAKEDOWNS: contains exactly 10 entries', () => {
  assert.equal(CIB_TAKEDOWNS.length, 10);
});

test('CIB_TAKEDOWNS: all entries have non-empty ids', () => {
  for (const t of CIB_TAKEDOWNS) assert.ok(t.id.length > 0);
});

test('CIB_TAKEDOWNS: all ids are unique', () => {
  const ids = new Set(CIB_TAKEDOWNS.map((t) => t.id));
  assert.equal(ids.size, CIB_TAKEDOWNS.length);
});

test('CIB_TAKEDOWNS: all dates match YYYY-MM-DD format', () => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  for (const t of CIB_TAKEDOWNS) assert.ok(re.test(t.date), `bad date: ${t.date}`);
});

test('CIB_TAKEDOWNS: significance values are valid', () => {
  const valid: CIBSignificance[] = ['Low', 'Medium', 'High', 'Critical'];
  for (const t of CIB_TAKEDOWNS) assert.ok(valid.includes(t.significance));
});

test('CIB_TAKEDOWNS: at least two Critical entries', () => {
  const crits = CIB_TAKEDOWNS.filter((t) => t.significance === 'Critical');
  assert.ok(crits.length >= 2);
});

test('CIB_TAKEDOWNS: at least one ongoing entry', () => {
  assert.ok(CIB_TAKEDOWNS.some((t) => t.ongoing));
});

test('CIB_TAKEDOWNS: Dragonbridge entry present with 7000+ accounts', () => {
  const dragon = CIB_TAKEDOWNS.find((t) => t.description.toLowerCase().includes('dragonbridge'));
  assert.ok(dragon !== undefined);
  assert.ok(dragon.accountsRemoved >= 7000);
});

test('CIB_TAKEDOWNS: Russian IRA successor entry has 60000+ accounts', () => {
  const ira = CIB_TAKEDOWNS.find((t) => t.accountsRemoved >= 60000);
  assert.ok(ira !== undefined);
});

test('ACTIVE_NETWORKS: contains exactly 5 entries', () => {
  assert.equal(ACTIVE_NETWORKS.length, 5);
});

test('ACTIVE_NETWORKS: all ids are unique', () => {
  const ids = new Set(ACTIVE_NETWORKS.map((n) => n.id));
  assert.equal(ids.size, ACTIVE_NETWORKS.length);
});

test('ACTIVE_NETWORKS: all statuses are valid', () => {
  const valid: NetworkStatus[] = ['Active', 'Disrupted', 'Dismantled'];
  for (const n of ACTIVE_NETWORKS) assert.ok(valid.includes(n.status));
});

test('ACTIVE_NETWORKS: all have at least one platform', () => {
  for (const n of ACTIVE_NETWORKS) assert.ok(n.platforms.length > 0);
});

test('ACTIVE_NETWORKS: all have at least one primaryNarrative', () => {
  for (const n of ACTIVE_NETWORKS) assert.ok(n.primaryNarratives.length > 0);
});

test('ACTIVE_NETWORKS: 50-cent army estimatedAccounts >= 1,000,000', () => {
  const wumao = ACTIVE_NETWORKS.find((n) => n.name.toLowerCase().includes('50-cent'));
  assert.ok(wumao !== undefined);
  assert.ok(wumao.estimatedAccounts >= 1_000_000);
});

test('ACTIVE_NETWORKS: at least 3 Active networks', () => {
  const active = getActiveNetworks(ACTIVE_NETWORKS);
  assert.ok(active.length >= 3);
});
