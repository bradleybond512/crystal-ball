/**
 * Unit tests for foreign-fighters-helpers.ts
 * Run: npx tsx --test src/components/__tests__/foreign-fighters-helpers.test.mts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusLabel,
  statusClass,
  ideologyLabel,
  ideologyClass,
  travelBanLabel,
  travelBanColor,
  significanceLabel,
  significanceColor,
  recruitmentMethodLabel,
  trendLabel,
  trendColor,
  formatFighters,
  getActiveFlows,
  getByIdeology,
  getHighVolume,
  totalForeignFighters,
  rankByVolume,
  topConflict,
  countByStatus,
  countBySignificance,
  countHighSignificance,
  ideologyBreakdown,
  buildRenderData,
  CONFLICT_ZONES,
  RECRUITMENT_INCIDENTS,
  GLOBAL_INDEX,
  type ConflictZone,
  type RecruitmentIncident,
  type FlowStatus,
  type Ideology,
  type RecruitmentSignificance,
} from '../foreign-fighters-helpers.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_ZONE: ConflictZone = {
  id: 'test-zone',
  name: 'Test Conflict',
  region: 'Test Region',
  status: 'active',
  estimatedFighters: 1_000,
  majorOriginCountries: ['Country A', 'Country B'],
  ideology: 'jihadist-sunni',
  faction: 'Test Faction',
  travelBanEffectiveness: 'low',
  peakYear: 2023,
  notes: 'Test notes.',
};

const BASE_INCIDENT: RecruitmentIncident = {
  id: 'ri-test',
  date: '2024-01',
  title: 'Test Recruitment Campaign',
  actor: 'Test Actor',
  method: 'social-media',
  targetRegion: 'Test Region',
  estimatedRecruits: 500,
  ideology: 'jihadist-sunni',
  significance: 'high',
};

// ── statusLabel ───────────────────────────────────────────────────────────────

describe('statusLabel', () => {
  it('returns Active for active', () => {
    assert.equal(statusLabel('active'), 'Active');
  });
  it('returns Declining for declining', () => {
    assert.equal(statusLabel('declining'), 'Declining');
  });
  it('returns Concluded for concluded', () => {
    assert.equal(statusLabel('concluded'), 'Concluded');
  });
  it('covers all FlowStatus values', () => {
    const statuses: FlowStatus[] = ['active', 'declining', 'concluded'];
    for (const s of statuses) {
      assert.ok(statusLabel(s).length > 0, `Missing label for ${s}`);
    }
  });
});

// ── statusClass ───────────────────────────────────────────────────────────────

describe('statusClass', () => {
  it('returns a CSS var string for active', () => {
    assert.ok(statusClass('active').includes('ef4444'));
  });
  it('returns a CSS var string for declining', () => {
    assert.ok(statusClass('declining').includes('facc15'));
  });
  it('returns a CSS var string for concluded', () => {
    assert.ok(statusClass('concluded').includes('9e9e9e'));
  });
  it('all statuses return non-empty strings', () => {
    for (const s of ['active', 'declining', 'concluded'] as FlowStatus[]) {
      assert.ok(statusClass(s).length > 0);
    }
  });
});

// ── ideologyLabel ─────────────────────────────────────────────────────────────

describe('ideologyLabel', () => {
  it('returns human-readable label for jihadist-sunni', () => {
    assert.ok(ideologyLabel('jihadist-sunni').includes('Jihadist'));
  });
  it('returns human-readable label for jihadist-shia', () => {
    assert.ok(ideologyLabel('jihadist-shia').includes('Shia'));
  });
  it('returns human-readable label for nationalist', () => {
    assert.equal(ideologyLabel('nationalist'), 'Nationalist');
  });
  it('returns human-readable label for pro-western', () => {
    assert.equal(ideologyLabel('pro-western'), 'Pro-Western');
  });
  it('returns human-readable label for mercenary', () => {
    assert.equal(ideologyLabel('mercenary'), 'Mercenary');
  });
  it('returns human-readable label for ethnic-nationalist', () => {
    assert.equal(ideologyLabel('ethnic-nationalist'), 'Ethnic Nationalist');
  });
});

// ── ideologyClass ─────────────────────────────────────────────────────────────

describe('ideologyClass', () => {
  it('returns color string for each ideology', () => {
    const ideologies: Ideology[] = [
      'jihadist-sunni', 'jihadist-shia', 'nationalist',
      'pro-western', 'mercenary', 'ethnic-nationalist',
    ];
    for (const i of ideologies) {
      assert.ok(ideologyClass(i).length > 0, `Missing color for ${i}`);
    }
  });
  it('jihadist-sunni maps to critical color', () => {
    assert.ok(ideologyClass('jihadist-sunni').includes('ef4444'));
  });
  it('pro-western maps to low/green color', () => {
    assert.ok(ideologyClass('pro-western').includes('4caf50'));
  });
});

// ── travelBanLabel / travelBanColor ───────────────────────────────────────────

describe('travelBanLabel', () => {
  it('returns Low for low', () => assert.equal(travelBanLabel('low'), 'Low'));
  it('returns Moderate for moderate', () => assert.equal(travelBanLabel('moderate'), 'Moderate'));
  it('returns High for high', () => assert.equal(travelBanLabel('high'), 'High'));
});

describe('travelBanColor', () => {
  it('low ban returns critical/red color', () => {
    assert.ok(travelBanColor('low').includes('ef4444'));
  });
  it('high ban returns green color', () => {
    assert.ok(travelBanColor('high').includes('4caf50'));
  });
  it('moderate ban returns yellow color', () => {
    assert.ok(travelBanColor('moderate').includes('facc15'));
  });
});

// ── significanceLabel / significanceColor ─────────────────────────────────────

describe('significanceLabel', () => {
  it('covers all four levels', () => {
    const levels: RecruitmentSignificance[] = ['low', 'moderate', 'high', 'critical'];
    for (const l of levels) {
      assert.ok(significanceLabel(l).length > 0);
    }
  });
  it('critical returns Critical', () => {
    assert.equal(significanceLabel('critical'), 'Critical');
  });
});

describe('significanceColor', () => {
  it('critical maps to red', () => {
    assert.ok(significanceColor('critical').includes('ef4444'));
  });
  it('low maps to green', () => {
    assert.ok(significanceColor('low').includes('4caf50'));
  });
});

// ── recruitmentMethodLabel ────────────────────────────────────────────────────

describe('recruitmentMethodLabel', () => {
  it('social-media returns Social Media', () => {
    assert.equal(recruitmentMethodLabel('social-media'), 'Social Media');
  });
  it('official-channel returns Official Channel', () => {
    assert.equal(recruitmentMethodLabel('official-channel'), 'Official Channel');
  });
  it('all methods have labels', () => {
    const methods = ['social-media', 'diaspora-networks', 'official-channel', 'proxy-state', 'in-person'] as const;
    for (const m of methods) {
      assert.ok(recruitmentMethodLabel(m).length > 0);
    }
  });
});

// ── trendLabel / trendColor ───────────────────────────────────────────────────

describe('trendLabel', () => {
  it('increasing returns non-empty string', () => {
    assert.ok(trendLabel('increasing').length > 0);
  });
  it('stable returns non-empty string', () => {
    assert.ok(trendLabel('stable').length > 0);
  });
  it('decreasing returns non-empty string', () => {
    assert.ok(trendLabel('decreasing').length > 0);
  });
});

describe('trendColor', () => {
  it('increasing maps to red/critical', () => {
    assert.ok(trendColor('increasing').includes('ef4444'));
  });
  it('decreasing maps to green', () => {
    assert.ok(trendColor('decreasing').includes('4caf50'));
  });
});

// ── formatFighters ────────────────────────────────────────────────────────────

describe('formatFighters', () => {
  it('formats 500 as plain number', () => {
    assert.equal(formatFighters(500), '500');
  });
  it('formats 1500 with one decimal k', () => {
    assert.equal(formatFighters(1_500), '1.5k');
  });
  it('formats 10000 as rounded k', () => {
    assert.equal(formatFighters(10_000), '10k');
  });
  it('formats 17500 as rounded k', () => {
    assert.equal(formatFighters(17_500), '18k');
  });
  it('formats 0 as 0', () => {
    assert.equal(formatFighters(0), '0');
  });
  it('formats 999 without k suffix', () => {
    assert.ok(!formatFighters(999).includes('k'));
  });
});

// ── getActiveFlows ────────────────────────────────────────────────────────────

describe('getActiveFlows', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(getActiveFlows([]), []);
  });
  it('filters only active zones', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', status: 'active' },
      { ...BASE_ZONE, id: 'b', status: 'declining' },
      { ...BASE_ZONE, id: 'c', status: 'concluded' },
    ];
    const result = getActiveFlows(zones);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'a');
  });
  it('returns all zones when all active', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', status: 'active' },
      { ...BASE_ZONE, id: 'b', status: 'active' },
    ];
    assert.equal(getActiveFlows(zones).length, 2);
  });
  it('returns empty when none active', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', status: 'declining' },
      { ...BASE_ZONE, id: 'b', status: 'concluded' },
    ];
    assert.equal(getActiveFlows(zones).length, 0);
  });
});

// ── getByIdeology ─────────────────────────────────────────────────────────────

describe('getByIdeology', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(getByIdeology([], 'jihadist-sunni'), []);
  });
  it('filters by ideology correctly', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', ideology: 'jihadist-sunni' },
      { ...BASE_ZONE, id: 'b', ideology: 'nationalist' },
      { ...BASE_ZONE, id: 'c', ideology: 'jihadist-sunni' },
    ];
    const result = getByIdeology(zones, 'jihadist-sunni');
    assert.equal(result.length, 2);
    assert.ok(result.every((z) => z.ideology === 'jihadist-sunni'));
  });
  it('returns empty when no match', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', ideology: 'nationalist' },
    ];
    assert.equal(getByIdeology(zones, 'mercenary').length, 0);
  });
});

// ── getHighVolume ─────────────────────────────────────────────────────────────

describe('getHighVolume', () => {
  it('uses 500 as default threshold', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 501 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 500 },
      { ...BASE_ZONE, id: 'c', estimatedFighters: 499 },
    ];
    const result = getHighVolume(zones);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'a');
  });
  it('respects custom threshold', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 2_000 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 1_000 },
    ];
    assert.equal(getHighVolume(zones, 1_500).length, 1);
  });
  it('returns empty for empty input', () => {
    assert.deepEqual(getHighVolume([]), []);
  });
  it('threshold is strictly greater-than (not >=)', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 500 },
    ];
    assert.equal(getHighVolume(zones, 500).length, 0);
  });
});

// ── totalForeignFighters ──────────────────────────────────────────────────────

describe('totalForeignFighters', () => {
  it('returns 0 for empty array', () => {
    assert.equal(totalForeignFighters([]), 0);
  });
  it('sums all estimatedFighters', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 1_000 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 2_500 },
      { ...BASE_ZONE, id: 'c', estimatedFighters:   500 },
    ];
    assert.equal(totalForeignFighters(zones), 4_000);
  });
  it('works with a single zone', () => {
    assert.equal(totalForeignFighters([BASE_ZONE]), BASE_ZONE.estimatedFighters);
  });
});

// ── rankByVolume ──────────────────────────────────────────────────────────────

describe('rankByVolume', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(rankByVolume([]), []);
  });
  it('sorts descending by estimatedFighters', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 500 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 5_000 },
      { ...BASE_ZONE, id: 'c', estimatedFighters: 1_000 },
    ];
    const result = rankByVolume(zones);
    assert.equal(result[0]!.estimatedFighters, 5_000);
    assert.equal(result[1]!.estimatedFighters, 1_000);
    assert.equal(result[2]!.estimatedFighters, 500);
  });
  it('does not mutate the original array', () => {
    const zones = [BASE_ZONE];
    const before = zones[0]!.estimatedFighters;
    rankByVolume(zones);
    assert.equal(zones[0]!.estimatedFighters, before);
  });
});

// ── topConflict ───────────────────────────────────────────────────────────────

describe('topConflict', () => {
  it('returns null for empty array', () => {
    assert.equal(topConflict([]), null);
  });
  it('returns the zone with most fighters', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'low', estimatedFighters: 100 },
      { ...BASE_ZONE, id: 'high', estimatedFighters: 50_000 },
    ];
    assert.equal(topConflict(zones)!.id, 'high');
  });
});

// ── countByStatus ─────────────────────────────────────────────────────────────

describe('countByStatus', () => {
  it('returns 0 for empty array', () => {
    assert.equal(countByStatus([], 'active'), 0);
  });
  it('counts active zones correctly', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, status: 'active' },
      { ...BASE_ZONE, status: 'active' },
      { ...BASE_ZONE, status: 'declining' },
    ];
    assert.equal(countByStatus(zones, 'active'), 2);
  });
  it('returns 0 when none match', () => {
    const zones = [{ ...BASE_ZONE, status: 'declining' as FlowStatus }];
    assert.equal(countByStatus(zones, 'concluded'), 0);
  });
});

// ── countBySignificance ───────────────────────────────────────────────────────

describe('countBySignificance', () => {
  it('returns 0 for empty array', () => {
    assert.equal(countBySignificance([], 'critical'), 0);
  });
  it('counts correctly', () => {
    const incidents: RecruitmentIncident[] = [
      { ...BASE_INCIDENT, id: 'a', significance: 'critical' },
      { ...BASE_INCIDENT, id: 'b', significance: 'critical' },
      { ...BASE_INCIDENT, id: 'c', significance: 'high' },
    ];
    assert.equal(countBySignificance(incidents, 'critical'), 2);
    assert.equal(countBySignificance(incidents, 'high'), 1);
    assert.equal(countBySignificance(incidents, 'low'), 0);
  });
});

// ── countHighSignificance ─────────────────────────────────────────────────────

describe('countHighSignificance', () => {
  it('returns 0 for empty array', () => {
    assert.equal(countHighSignificance([]), 0);
  });
  it('counts both high and critical', () => {
    const incidents: RecruitmentIncident[] = [
      { ...BASE_INCIDENT, id: 'a', significance: 'critical' },
      { ...BASE_INCIDENT, id: 'b', significance: 'high' },
      { ...BASE_INCIDENT, id: 'c', significance: 'moderate' },
      { ...BASE_INCIDENT, id: 'd', significance: 'low' },
    ];
    assert.equal(countHighSignificance(incidents), 2);
  });
  it('excludes moderate and low', () => {
    const incidents: RecruitmentIncident[] = [
      { ...BASE_INCIDENT, id: 'a', significance: 'moderate' },
      { ...BASE_INCIDENT, id: 'b', significance: 'low' },
    ];
    assert.equal(countHighSignificance(incidents), 0);
  });
});

// ── ideologyBreakdown ─────────────────────────────────────────────────────────

describe('ideologyBreakdown', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(ideologyBreakdown([]), []);
  });
  it('groups zones by ideology', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', ideology: 'jihadist-sunni', estimatedFighters: 1_000 },
      { ...BASE_ZONE, id: 'b', ideology: 'jihadist-sunni', estimatedFighters: 2_000 },
      { ...BASE_ZONE, id: 'c', ideology: 'nationalist',    estimatedFighters: 5_000 },
    ];
    const result = ideologyBreakdown(zones);
    assert.equal(result.length, 2);
    // nationalist has most fighters, should be first
    assert.equal(result[0]!.ideology, 'nationalist');
    assert.equal(result[0]!.fighters, 5_000);
  });
  it('counts zones per ideology correctly', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', ideology: 'mercenary', estimatedFighters: 500 },
      { ...BASE_ZONE, id: 'b', ideology: 'mercenary', estimatedFighters: 500 },
    ];
    const result = ideologyBreakdown(zones);
    assert.equal(result[0]!.count, 2);
    assert.equal(result[0]!.fighters, 1_000);
  });
  it('sorts by fighter count descending', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', ideology: 'pro-western',    estimatedFighters: 100 },
      { ...BASE_ZONE, id: 'b', ideology: 'ethnic-nationalist', estimatedFighters: 900 },
    ];
    const result = ideologyBreakdown(zones);
    assert.equal(result[0]!.ideology, 'ethnic-nationalist');
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns valid structure for empty inputs', () => {
    const result = buildRenderData([], [], GLOBAL_INDEX);
    assert.equal(result.ranked.length, 0);
    assert.equal(result.activeZones.length, 0);
    assert.equal(result.highVolume.length, 0);
    assert.equal(result.incidents.length, 0);
    assert.equal(result.totalFighters, 0);
    assert.deepEqual(result.index, GLOBAL_INDEX);
  });
  it('ranked is sorted by estimatedFighters descending', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 100 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 5_000 },
    ];
    const result = buildRenderData(zones, [], GLOBAL_INDEX);
    assert.equal(result.ranked[0]!.estimatedFighters, 5_000);
  });
  it('activeZones only contains active status zones', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', status: 'active' },
      { ...BASE_ZONE, id: 'b', status: 'declining' },
    ];
    const result = buildRenderData(zones, [], GLOBAL_INDEX);
    assert.equal(result.activeZones.length, 1);
  });
  it('highVolume uses >500 default threshold', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 600 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 400 },
    ];
    const result = buildRenderData(zones, [], GLOBAL_INDEX);
    assert.equal(result.highVolume.length, 1);
  });
  it('totalFighters is sum of all estimatedFighters', () => {
    const zones: ConflictZone[] = [
      { ...BASE_ZONE, id: 'a', estimatedFighters: 1_000 },
      { ...BASE_ZONE, id: 'b', estimatedFighters: 2_000 },
    ];
    const result = buildRenderData(zones, [], GLOBAL_INDEX);
    assert.equal(result.totalFighters, 3_000);
  });
  it('passes incidents through unmodified', () => {
    const result = buildRenderData([], [BASE_INCIDENT], GLOBAL_INDEX);
    assert.equal(result.incidents.length, 1);
    assert.equal(result.incidents[0]!.id, BASE_INCIDENT.id);
  });
});

// ── CONFLICT_ZONES static data integrity ─────────────────────────────────────

describe('CONFLICT_ZONES data integrity', () => {
  it('has at least 8 conflict zones', () => {
    assert.ok(CONFLICT_ZONES.length >= 8, `Expected >=8 zones, got ${CONFLICT_ZONES.length}`);
  });
  it('all zones have unique ids', () => {
    const ids = new Set(CONFLICT_ZONES.map((z) => z.id));
    assert.equal(ids.size, CONFLICT_ZONES.length);
  });
  it('all estimatedFighters are positive', () => {
    for (const z of CONFLICT_ZONES) {
      assert.ok(z.estimatedFighters > 0, `Zone ${z.id} has non-positive fighter count`);
    }
  });
  it('all majorOriginCountries arrays are non-empty', () => {
    for (const z of CONFLICT_ZONES) {
      assert.ok(z.majorOriginCountries.length > 0, `Zone ${z.id} has empty origin countries`);
    }
  });
  it('all peakYear values are plausible (2000-2025)', () => {
    for (const z of CONFLICT_ZONES) {
      assert.ok(z.peakYear >= 2000 && z.peakYear <= 2025, `Zone ${z.id} has implausible peakYear ${z.peakYear}`);
    }
  });
  it('all status values are valid FlowStatus', () => {
    const valid: FlowStatus[] = ['active', 'declining', 'concluded'];
    for (const z of CONFLICT_ZONES) {
      assert.ok(valid.includes(z.status), `Zone ${z.id} has invalid status ${z.status}`);
    }
  });
  it('has at least one active zone', () => {
    assert.ok(getActiveFlows(CONFLICT_ZONES).length > 0);
  });
  it('active zones represent the majority', () => {
    const active = getActiveFlows(CONFLICT_ZONES).length;
    assert.ok(active > CONFLICT_ZONES.length / 2);
  });
  it('all ideology values are valid', () => {
    const valid: Ideology[] = [
      'jihadist-sunni', 'jihadist-shia', 'nationalist',
      'pro-western', 'mercenary', 'ethnic-nationalist',
    ];
    for (const z of CONFLICT_ZONES) {
      assert.ok(valid.includes(z.ideology), `Zone ${z.id} has invalid ideology ${z.ideology}`);
    }
  });
});

// ── RECRUITMENT_INCIDENTS static data integrity ───────────────────────────────

describe('RECRUITMENT_INCIDENTS data integrity', () => {
  it('has at least 6 incidents', () => {
    assert.ok(RECRUITMENT_INCIDENTS.length >= 6);
  });
  it('all incidents have unique ids', () => {
    const ids = new Set(RECRUITMENT_INCIDENTS.map((i) => i.id));
    assert.equal(ids.size, RECRUITMENT_INCIDENTS.length);
  });
  it('all estimatedRecruits are positive', () => {
    for (const inc of RECRUITMENT_INCIDENTS) {
      assert.ok(inc.estimatedRecruits > 0, `Incident ${inc.id} has non-positive recruit count`);
    }
  });
  it('all date strings match YYYY-MM format', () => {
    for (const inc of RECRUITMENT_INCIDENTS) {
      assert.match(inc.date, /^\d{4}-\d{2}$/, `Incident ${inc.id} has bad date ${inc.date}`);
    }
  });
  it('all significance values are valid', () => {
    const valid: RecruitmentSignificance[] = ['low', 'moderate', 'high', 'critical'];
    for (const inc of RECRUITMENT_INCIDENTS) {
      assert.ok(valid.includes(inc.significance), `Incident ${inc.id} has invalid significance`);
    }
  });
  it('has at least one critical incident', () => {
    const criticals = RECRUITMENT_INCIDENTS.filter((i) => i.significance === 'critical');
    assert.ok(criticals.length > 0);
  });
});

// ── GLOBAL_INDEX data integrity ───────────────────────────────────────────────

describe('GLOBAL_INDEX data integrity', () => {
  it('totalEstimated is positive', () => {
    assert.ok(GLOBAL_INDEX.totalEstimated > 0);
  });
  it('activeConflicts is positive', () => {
    assert.ok(GLOBAL_INDEX.activeConflicts > 0);
  });
  it('majorSourceRegions is non-empty', () => {
    assert.ok(GLOBAL_INDEX.majorSourceRegions.length > 0);
  });
  it('trendDirection is valid', () => {
    const valid = ['increasing', 'stable', 'decreasing'];
    assert.ok(valid.includes(GLOBAL_INDEX.trendDirection));
  });
  it('asOf is non-empty string', () => {
    assert.ok(GLOBAL_INDEX.asOf.length > 0);
  });
  it('totalEstimated is consistent with conflict zone data (within 2x)', () => {
    const computed = totalForeignFighters(CONFLICT_ZONES);
    // Global index may include zones not in static seed — allow up to 2x variance
    assert.ok(
      GLOBAL_INDEX.totalEstimated >= computed * 0.5 &&
      GLOBAL_INDEX.totalEstimated <= computed * 2,
      `Index total ${GLOBAL_INDEX.totalEstimated} is far from zone sum ${computed}`,
    );
  });
});

// ── Integration: full static dataset through buildRenderData ──────────────────

describe('integration: full static dataset', () => {
  const data = buildRenderData(CONFLICT_ZONES, RECRUITMENT_INCIDENTS, GLOBAL_INDEX);

  it('ranked length equals CONFLICT_ZONES length', () => {
    assert.equal(data.ranked.length, CONFLICT_ZONES.length);
  });
  it('ranked is sorted descending by estimatedFighters', () => {
    for (let i = 1; i < data.ranked.length; i++) {
      assert.ok(
        data.ranked[i - 1]!.estimatedFighters >= data.ranked[i]!.estimatedFighters,
        `Rank out of order at index ${i}`,
      );
    }
  });
  it('activeZones is subset of ranked', () => {
    const activeIds = new Set(data.activeZones.map((z) => z.id));
    for (const id of activeIds) {
      assert.ok(data.ranked.some((z) => z.id === id));
    }
  });
  it('totalFighters matches zone sum', () => {
    const sum = CONFLICT_ZONES.reduce((acc, z) => acc + z.estimatedFighters, 0);
    assert.equal(data.totalFighters, sum);
  });
  it('highVolume zones all have >500 fighters', () => {
    for (const z of data.highVolume) {
      assert.ok(z.estimatedFighters > 500);
    }
  });
  it('incidents carries through all RECRUITMENT_INCIDENTS', () => {
    assert.equal(data.incidents.length, RECRUITMENT_INCIDENTS.length);
  });
  it('index object is the same reference as GLOBAL_INDEX', () => {
    assert.equal(data.index, GLOBAL_INDEX);
  });
});
