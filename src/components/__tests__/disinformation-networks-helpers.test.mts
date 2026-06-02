import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getByActor,
  getLargeNetworks,
  getActiveNetworks,
  getByTargetNarrative,
  networkScaleClass,
  networkScaleLabel,
  actorClass,
  statusColor,
  trendColor,
  trendLabel,
  threatLevelColor,
  formatAccountCount,
  buildRenderData,
  CIB_TAKEDOWNS,
  ACTIVE_NETWORK_PROFILES,
  QUARTERLY_CIB_DATA,
  NARRATIVE_HOTSPOTS,
  type CibTakedown,
  type ActiveNetworkProfile,
  type QuarterlyCibData,
  type NarrativeHotspot,
  type ActorOrigin,
  type NetworkScale,
  type NetworkStatus,
  type NarrativeTrend,
  type ActiveThreatLevel,
} from '../disinformation-networks-helpers';

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeTakedown(overrides: Partial<CibTakedown> = {}): CibTakedown {
  return {
    id: 'test-td',
    name: 'Test Takedown',
    platform: 'Meta',
    actor: 'Test Actor',
    actorOrigin: 'Russia',
    accountCount: 500,
    platformsAffected: 1,
    targetRegion: 'EU',
    objective: 'Test objective',
    date: '2024-01-01',
    status: 'disrupted',
    notableDetail: 'Test detail',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ActiveNetworkProfile> = {}): ActiveNetworkProfile {
  return {
    id: 'test-profile',
    name: 'Test Network',
    actorOrigin: 'Russia',
    estimatedAccounts: 1_000,
    platforms: ['X', 'Facebook'],
    primaryObjective: 'Test objective',
    active: true,
    lastObserved: '2024-06-01',
    threat: 'high',
    ...overrides,
  };
}

function makeHotspot(overrides: Partial<NarrativeHotspot> = {}): NarrativeHotspot {
  return {
    id: 'test-hotspot',
    topic: 'Test Topic',
    regions: ['EU'],
    intensity: 50,
    primaryActors: ['Russia'],
    trend: 'steady',
    ...overrides,
  };
}

function makeQuarterly(overrides: Partial<QuarterlyCibData> = {}): QuarterlyCibData {
  return {
    quarter: 'Q1 2024',
    year: 2024,
    accountsRemoved: 10_000,
    takedownCount: 5,
    ...overrides,
  };
}

// ── networkScaleClass ──────────────────────────────────────────────────────

describe('networkScaleClass', () => {
  it('returns small for 0 accounts', () => {
    assert.equal(networkScaleClass(0), 'small');
  });
  it('returns small for 499 accounts', () => {
    assert.equal(networkScaleClass(499), 'small');
  });
  it('returns medium at 500 accounts boundary', () => {
    assert.equal(networkScaleClass(500), 'medium');
  });
  it('returns medium for 4 999 accounts', () => {
    assert.equal(networkScaleClass(4_999), 'medium');
  });
  it('returns large at 5 000 accounts boundary', () => {
    assert.equal(networkScaleClass(5_000), 'large');
  });
  it('returns large for 49 999 accounts', () => {
    assert.equal(networkScaleClass(49_999), 'large');
  });
  it('returns massive at 50 000 accounts boundary', () => {
    assert.equal(networkScaleClass(50_000), 'massive');
  });
  it('returns massive for very large counts', () => {
    assert.equal(networkScaleClass(1_000_000), 'massive');
  });
});

// ── networkScaleLabel ──────────────────────────────────────────────────────

describe('networkScaleLabel', () => {
  const cases: [NetworkScale, string][] = [
    ['small', 'Small'],
    ['medium', 'Medium'],
    ['large', 'Large'],
    ['massive', 'Massive'],
  ];
  for (const [scale, expected] of cases) {
    it(`labels ${scale}`, () => {
      assert.equal(networkScaleLabel(scale), expected);
    });
  }
});

// ── actorClass ─────────────────────────────────────────────────────────────

describe('actorClass', () => {
  const origins: ActorOrigin[] = [
    'Russia', 'China', 'Iran', 'Bangladesh', 'Myanmar', 'EU-enforcement', 'unattributed',
  ];
  for (const origin of origins) {
    it(`returns a non-empty CSS var string for ${origin}`, () => {
      const result = actorClass(origin);
      assert.ok(result.startsWith('var(--'), `expected CSS var, got: ${result}`);
      assert.ok(result.length > 0);
    });
  }
  it('Russia colour differs from China colour', () => {
    assert.notEqual(actorClass('Russia'), actorClass('China'));
  });
  it('EU-enforcement colour differs from Russia colour', () => {
    assert.notEqual(actorClass('EU-enforcement'), actorClass('Russia'));
  });
});

// ── statusColor ────────────────────────────────────────────────────────────

describe('statusColor', () => {
  const statuses: NetworkStatus[] = ['disrupted', 'active', 'restricted', 'monitoring'];
  for (const s of statuses) {
    it(`returns a non-empty string for ${s}`, () => {
      assert.ok(statusColor(s).length > 0);
    });
  }
  it('active (threat) returns a different colour than disrupted (resolved)', () => {
    assert.notEqual(statusColor('active'), statusColor('disrupted'));
  });
});

// ── trendColor / trendLabel ────────────────────────────────────────────────

describe('trendColor', () => {
  const trends: NarrativeTrend[] = ['escalating', 'steady', 'declining'];
  for (const t of trends) {
    it(`returns a non-empty string for ${t}`, () => {
      assert.ok(trendColor(t).length > 0);
    });
  }
  it('escalating is more alarming (red) than declining (green)', () => {
    assert.ok(trendColor('escalating').includes('#ef4444'));
    assert.ok(trendColor('declining').includes('#4caf50'));
  });
});

describe('trendLabel', () => {
  it('covers escalating', () => {
    assert.ok(trendLabel('escalating').length > 0);
  });
  it('covers steady', () => {
    assert.ok(trendLabel('steady').length > 0);
  });
  it('covers declining', () => {
    assert.ok(trendLabel('declining').length > 0);
  });
  it('returns different labels for each trend', () => {
    const labels = new Set(['escalating', 'steady', 'declining'].map((t) => trendLabel(t as NarrativeTrend)));
    assert.equal(labels.size, 3);
  });
});

// ── threatLevelColor ───────────────────────────────────────────────────────

describe('threatLevelColor', () => {
  const levels: ActiveThreatLevel[] = ['critical', 'high', 'moderate', 'low'];
  for (const l of levels) {
    it(`returns a non-empty CSS var for ${l}`, () => {
      const c = threatLevelColor(l);
      assert.ok(c.startsWith('var(--'));
      assert.ok(c.length > 0);
    });
  }
  it('critical differs from low', () => {
    assert.notEqual(threatLevelColor('critical'), threatLevelColor('low'));
  });
});

// ── formatAccountCount ─────────────────────────────────────────────────────

describe('formatAccountCount', () => {
  it('returns N/A for zero', () => {
    assert.equal(formatAccountCount(0), 'N/A');
  });
  it('returns raw string for small counts', () => {
    assert.equal(formatAccountCount(42), '42');
    assert.equal(formatAccountCount(999), '999');
  });
  it('uses k for thousands', () => {
    assert.equal(formatAccountCount(1_000), '1 k');
    assert.equal(formatAccountCount(60_000), '60 k');
    assert.equal(formatAccountCount(999_999), '1000 k');
  });
  it('uses M for millions', () => {
    const result = formatAccountCount(1_500_000);
    assert.ok(result.includes('M'), `expected M suffix, got: ${result}`);
    assert.ok(result.includes('1.5'));
  });
});

// ── getByActor ─────────────────────────────────────────────────────────────

describe('getByActor', () => {
  const takedowns: CibTakedown[] = [
    makeTakedown({ id: 'a', actorOrigin: 'Russia' }),
    makeTakedown({ id: 'b', actorOrigin: 'China' }),
    makeTakedown({ id: 'c', actorOrigin: 'Russia' }),
    makeTakedown({ id: 'd', actorOrigin: 'Iran' }),
  ];

  it('returns only Russia entries', () => {
    const result = getByActor(takedowns, 'Russia');
    assert.equal(result.length, 2);
    assert.ok(result.every((t) => t.actorOrigin === 'Russia'));
  });
  it('returns only China entries', () => {
    const result = getByActor(takedowns, 'China');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'b');
  });
  it('returns empty array for an actor not present', () => {
    const result = getByActor(takedowns, 'Bangladesh');
    assert.equal(result.length, 0);
  });
  it('does not mutate the source array', () => {
    const copy = [...takedowns];
    getByActor(takedowns, 'Russia');
    assert.deepEqual(takedowns, copy);
  });
});

// ── getLargeNetworks ───────────────────────────────────────────────────────

describe('getLargeNetworks', () => {
  const takedowns: CibTakedown[] = [
    makeTakedown({ id: 'small', accountCount: 200 }),
    makeTakedown({ id: 'boundary', accountCount: 1_000 }),
    makeTakedown({ id: 'large', accountCount: 5_000 }),
  ];

  it('default threshold (1 000) excludes below-threshold entries', () => {
    const result = getLargeNetworks(takedowns);
    assert.ok(result.every((t) => t.accountCount >= 1_000));
    assert.equal(result.length, 2);
  });
  it('includes boundary value at default threshold', () => {
    const result = getLargeNetworks(takedowns);
    assert.ok(result.some((t) => t.id === 'boundary'));
  });
  it('custom threshold 5 000 returns only the large entry', () => {
    const result = getLargeNetworks(takedowns, 5_000);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'large');
  });
  it('returns all when threshold is 0', () => {
    const result = getLargeNetworks(takedowns, 0);
    assert.equal(result.length, takedowns.length);
  });
});

// ── getActiveNetworks ──────────────────────────────────────────────────────

describe('getActiveNetworks', () => {
  const profiles: ActiveNetworkProfile[] = [
    makeProfile({ id: 'a', active: true }),
    makeProfile({ id: 'b', active: false }),
    makeProfile({ id: 'c', active: true }),
  ];

  it('returns only active profiles', () => {
    const result = getActiveNetworks(profiles);
    assert.equal(result.length, 2);
    assert.ok(result.every((p) => p.active));
  });
  it('returns empty array when all inactive', () => {
    const all = profiles.map((p) => ({ ...p, active: false }));
    assert.equal(getActiveNetworks(all).length, 0);
  });
  it('returns all when all active', () => {
    const all = profiles.map((p) => ({ ...p, active: true }));
    assert.equal(getActiveNetworks(all).length, all.length);
  });
});

// ── getByTargetNarrative ───────────────────────────────────────────────────

describe('getByTargetNarrative', () => {
  const hotspots: NarrativeHotspot[] = [
    makeHotspot({ id: 'a', topic: 'Election Integrity' }),
    makeHotspot({ id: 'b', topic: 'Ukraine War Narrative' }),
    makeHotspot({ id: 'c', topic: 'Taiwan Strait' }),
  ];

  it('finds by exact substring (case-insensitive)', () => {
    const result = getByTargetNarrative(hotspots, 'election');
    assert.ok(result !== undefined);
    assert.equal(result!.id, 'a');
  });
  it('is case-insensitive', () => {
    assert.ok(getByTargetNarrative(hotspots, 'UKRAINE') !== undefined);
    assert.ok(getByTargetNarrative(hotspots, 'taiwan') !== undefined);
  });
  it('returns undefined for no match', () => {
    assert.equal(getByTargetNarrative(hotspots, 'space'), undefined);
  });
  it('returns the first match when multiple qualify', () => {
    const two: NarrativeHotspot[] = [
      makeHotspot({ id: 'x', topic: 'War narrative alpha' }),
      makeHotspot({ id: 'y', topic: 'War narrative beta' }),
    ];
    const r = getByTargetNarrative(two, 'war');
    assert.equal(r!.id, 'x');
  });
});

// ── buildRenderData ────────────────────────────────────────────────────────

describe('buildRenderData — structure', () => {
  const data = buildRenderData(
    CIB_TAKEDOWNS,
    ACTIVE_NETWORK_PROFILES,
    QUARTERLY_CIB_DATA,
    NARRATIVE_HOTSPOTS,
  );

  it('produces one takedownRow per takedown', () => {
    assert.equal(data.takedownRows.length, CIB_TAKEDOWNS.length);
  });
  it('produces one profileRow per profile', () => {
    assert.equal(data.profileRows.length, ACTIVE_NETWORK_PROFILES.length);
  });
  it('propagates quarterly data unchanged', () => {
    assert.equal(data.quarterlyData.length, QUARTERLY_CIB_DATA.length);
  });
  it('sorts hotspot rows highest-intensity first', () => {
    const intensities = data.hotspotRows.map((r) => r.intensity);
    for (let i = 1; i < intensities.length; i++) {
      assert.ok(intensities[i - 1]! >= intensities[i]!);
    }
  });
  it('totalAccountsRemoved equals sum of quarterly data', () => {
    const expected = QUARTERLY_CIB_DATA.reduce((s, q) => s + q.accountsRemoved, 0);
    assert.equal(data.totalAccountsRemoved, expected);
  });
  it('totalTakedowns equals sum of quarterly takedownCounts', () => {
    const expected = QUARTERLY_CIB_DATA.reduce((s, q) => s + q.takedownCount, 0);
    assert.equal(data.totalTakedowns, expected);
  });
  it('activeNetworkCount matches getActiveNetworks result', () => {
    assert.equal(data.activeNetworkCount, ACTIVE_NETWORK_PROFILES.filter((p) => p.active).length);
  });
  it('criticalHotspotCount matches hotspots with intensity >= 80', () => {
    const expected = NARRATIVE_HOTSPOTS.filter((h) => h.intensity >= 80).length;
    assert.equal(data.criticalHotspotCount, expected);
  });
});

describe('buildRenderData — takedownRow fields', () => {
  const td = makeTakedown({
    id: 'chk',
    actor: 'Test Actor (org-name)',
    actorOrigin: 'China',
    accountCount: 7_000,
    status: 'disrupted',
    date: '2024-03-15',
    notableDetail: 'Notable detail here',
  });
  const data = buildRenderData([td], [], [], []);
  const row = data.takedownRows[0]!;

  it('copies id through', () => { assert.equal(row.id, 'chk'); });
  it('actorColor is a CSS var string', () => { assert.ok(row.actorColor.startsWith('var(')); });
  it('scaleClass is large for 7 000 accounts', () => { assert.equal(row.scaleClass, 'large'); });
  it('scaleLabel matches scaleClass', () => { assert.equal(row.scaleLabel, networkScaleLabel(row.scaleClass)); });
  it('accountLabel is formatted', () => { assert.ok(row.accountLabel.includes('k')); });
  it('statusLabel is uppercased', () => { assert.equal(row.statusLabel, 'DISRUPTED'); });
  it('statusColor is a non-empty string', () => { assert.ok(row.statusColor.length > 0); });
  it('date passes through verbatim', () => { assert.equal(row.date, '2024-03-15'); });
  it('notableDetail passes through', () => { assert.equal(row.notableDetail, 'Notable detail here'); });
});

describe('buildRenderData — profileRow fields', () => {
  const prof = makeProfile({
    id: 'p1',
    actorOrigin: 'Iran',
    estimatedAccounts: 800,
    platforms: ['Instagram', 'Facebook'],
    threat: 'high',
    active: true,
  });
  const data = buildRenderData([], [prof], [], []);
  const row = data.profileRows[0]!;

  it('copies id through', () => { assert.equal(row.id, 'p1'); });
  it('platformList joins array with comma-space', () => {
    assert.equal(row.platformList, 'Instagram, Facebook');
  });
  it('threatLabel is uppercased', () => { assert.equal(row.threatLabel, 'HIGH'); });
  it('threatColor is non-empty', () => { assert.ok(row.threatColor.length > 0); });
  it('active is true', () => { assert.equal(row.active, true); });
});

describe('buildRenderData — hotspotRow fields', () => {
  const hs = makeHotspot({
    id: 'hs1',
    regions: ['EU', 'US'],
    primaryActors: ['Russia', 'China'],
    trend: 'escalating',
    intensity: 85,
  });
  const data = buildRenderData([], [], [], [hs]);
  const row = data.hotspotRows[0]!;

  it('copies id through', () => { assert.equal(row.id, 'hs1'); });
  it('regionList joins array', () => { assert.equal(row.regionList, 'EU, US'); });
  it('actorList joins array', () => { assert.equal(row.actorList, 'Russia, China'); });
  it('trendLabel is non-empty', () => { assert.ok(row.trendLabel.length > 0); });
  it('trendColor is non-empty', () => { assert.ok(row.trendColor.length > 0); });
  it('intensity passes through', () => { assert.equal(row.intensity, 85); });
});

// ── Static data sanity ─────────────────────────────────────────────────────

describe('CIB_TAKEDOWNS static data', () => {
  it('has exactly 10 entries', () => {
    assert.equal(CIB_TAKEDOWNS.length, 10);
  });
  it('all ids are unique', () => {
    const ids = CIB_TAKEDOWNS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all accountCount values are non-negative', () => {
    assert.ok(CIB_TAKEDOWNS.every((t) => t.accountCount >= 0));
  });
  it('dates are in YYYY-MM-DD format', () => {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    assert.ok(CIB_TAKEDOWNS.every((t) => re.test(t.date)));
  });
  it('includes at least one Russian-origin takedown', () => {
    assert.ok(CIB_TAKEDOWNS.some((t) => t.actorOrigin === 'Russia'));
  });
  it('includes at least one China-origin takedown', () => {
    assert.ok(CIB_TAKEDOWNS.some((t) => t.actorOrigin === 'China'));
  });
  it('includes at least one Iran-origin takedown', () => {
    assert.ok(CIB_TAKEDOWNS.some((t) => t.actorOrigin === 'Iran'));
  });
  it('Dragonbridge entry has 15 platforms affected', () => {
    const db = CIB_TAKEDOWNS.find((t) => t.id === 'meta-dragonbridge-2024');
    assert.ok(db !== undefined);
    assert.equal(db!.platformsAffected, 15);
  });
  it('IRA successor entry has 60 000 accounts', () => {
    const ira = CIB_TAKEDOWNS.find((t) => t.id === 'meta-ira-2024');
    assert.ok(ira !== undefined);
    assert.equal(ira!.accountCount, 60_000);
  });
});

describe('ACTIVE_NETWORK_PROFILES static data', () => {
  it('has exactly 4 profiles', () => {
    assert.equal(ACTIVE_NETWORK_PROFILES.length, 4);
  });
  it('all are marked active', () => {
    assert.ok(ACTIVE_NETWORK_PROFILES.every((p) => p.active));
  });
  it('all ids are unique', () => {
    const ids = ACTIVE_NETWORK_PROFILES.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('includes IRA successor network', () => {
    assert.ok(ACTIVE_NETWORK_PROFILES.some((p) => p.id === 'ira-successors'));
  });
  it('includes Dragonbridge', () => {
    assert.ok(ACTIVE_NETWORK_PROFILES.some((p) => p.id === 'dragonbridge'));
  });
  it('includes Iranian MOIS network', () => {
    assert.ok(ACTIVE_NETWORK_PROFILES.some((p) => p.id === 'mois-network'));
  });
  it('includes 50-cent army', () => {
    assert.ok(ACTIVE_NETWORK_PROFILES.some((p) => p.id === '50-cent-army'));
  });
});

describe('QUARTERLY_CIB_DATA static data', () => {
  it('has 10 quarters', () => {
    assert.equal(QUARTERLY_CIB_DATA.length, 10);
  });
  it('all accountsRemoved are positive', () => {
    assert.ok(QUARTERLY_CIB_DATA.every((q) => q.accountsRemoved > 0));
  });
  it('all takedownCounts are positive', () => {
    assert.ok(QUARTERLY_CIB_DATA.every((q) => q.takedownCount > 0));
  });
});

describe('NARRATIVE_HOTSPOTS static data', () => {
  it('has exactly 5 hotspots', () => {
    assert.equal(NARRATIVE_HOTSPOTS.length, 5);
  });
  it('all intensities are in [0, 100]', () => {
    assert.ok(NARRATIVE_HOTSPOTS.every((h) => h.intensity >= 0 && h.intensity <= 100));
  });
  it('includes an election hotspot', () => {
    assert.ok(NARRATIVE_HOTSPOTS.some((h) => h.topic.toLowerCase().includes('election')));
  });
  it('includes a Ukraine hotspot', () => {
    assert.ok(NARRATIVE_HOTSPOTS.some((h) => h.topic.toLowerCase().includes('ukraine')));
  });
  it('includes a Taiwan hotspot', () => {
    assert.ok(NARRATIVE_HOTSPOTS.some((h) => h.topic.toLowerCase().includes('taiwan')));
  });
});
