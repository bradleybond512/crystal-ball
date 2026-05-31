import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalRepressionIndex,
  getByMethod,
  getByActor,
  getHighSeverity,
  getMostActiveActors,
  getSeverityCategory,
  methodClass,
  severityClass,
  tierClass,
  trendClass,
  buildRenderData,
  type RepressionIncident,
  type ActorProfile,
  type RepressionMethod,
  type ActorTier,
} from '../transnational-repression-helpers.ts';

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_INCIDENTS: RepressionIncident[] = [
  {
    id: 'T1',
    date: '2022-06-01',
    actor: 'Ruritania',
    target: 'Dissident A',
    location: 'London',
    method: 'Physical Assassination',
    description: 'Shot in broad daylight.',
    outcome: 'Victim killed.',
    severity: 10,
    verified: true,
    sources: ['MI5 report'],
  },
  {
    id: 'T2',
    date: '2021-03-15',
    actor: 'Freedonia',
    target: 'Journalist B',
    location: 'Berlin',
    method: 'Poisoning',
    description: 'Novichok in tea.',
    outcome: 'Victim survived.',
    severity: 9,
    verified: true,
    sources: ['BfV report'],
  },
  {
    id: 'T3',
    date: '2020-11-20',
    actor: 'Ruritania',
    target: 'Activist C',
    location: 'New York',
    method: 'Harassment Campaign',
    description: 'Online and in-person intimidation.',
    outcome: 'Target fled country.',
    severity: 6,
    verified: true,
    sources: ['FBI report'],
  },
  {
    id: 'T4',
    date: '2019-05-10',
    actor: 'Sylvania',
    target: 'Academic D',
    location: 'Paris',
    method: 'Digital Surveillance',
    description: 'Pegasus deployed on target phone.',
    outcome: 'Surveillance confirmed.',
    severity: 5,
    verified: false,
    sources: ['Citizen Lab'],
  },
  {
    id: 'T5',
    date: '2023-02-28',
    actor: 'Freedonia',
    target: 'Businessperson E',
    location: 'Dubai',
    method: 'Rendition',
    description: 'Lured onto private jet.',
    outcome: 'Imprisoned.',
    severity: 8,
    verified: true,
    sources: ['Amnesty International'],
  },
  {
    id: 'T6',
    date: '2018-09-01',
    actor: 'Sylvania',
    target: 'Cleric F',
    location: 'Washington DC',
    method: 'Family Coercion',
    description: 'Family threatened in home country.',
    outcome: 'Target self-censored.',
    severity: 4,
    verified: false,
    sources: ['NGO report'],
  },
];

const MOCK_ACTORS: ActorProfile[] = [
  {
    id: 'X1',
    country: 'Ruritania',
    tier: 'Tier 1',
    reintensityScore: 92,
    knownMethods: ['Physical Assassination', 'Poisoning'],
    freedomHouseRating: 'Most Severe',
    operationalReach: ['Europe', 'North America'],
    keyInstruments: ['State intelligence'],
    incidentCount: 30,
    trend: 'escalating',
  },
  {
    id: 'X2',
    country: 'Freedonia',
    tier: 'Tier 1',
    reintensityScore: 78,
    knownMethods: ['Rendition', 'Harassment Campaign'],
    freedomHouseRating: 'Severe',
    operationalReach: ['Middle East', 'Europe'],
    keyInstruments: ['Ministry of Intelligence'],
    incidentCount: 20,
    trend: 'stable',
  },
  {
    id: 'X3',
    country: 'Sylvania',
    tier: 'Tier 2',
    reintensityScore: 55,
    knownMethods: ['Digital Surveillance', 'Family Coercion'],
    freedomHouseRating: 'Transnational Repressor',
    operationalReach: ['Central Asia'],
    keyInstruments: ['SNB'],
    incidentCount: 8,
    trend: 'declining',
  },
];

// ── computeGlobalRepressionIndex ──────────────────────────────────────────────

describe('computeGlobalRepressionIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalRepressionIndex([]), 0);
  });

  it('returns a number in range 0-100', () => {
    const idx = computeGlobalRepressionIndex(MOCK_ACTORS);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('returns an integer', () => {
    const idx = computeGlobalRepressionIndex(MOCK_ACTORS);
    assert.equal(idx, Math.round(idx));
  });

  it('higher scores yield higher index', () => {
    const high = MOCK_ACTORS.map(a => ({ ...a, reintensityScore: 100 }));
    const low = MOCK_ACTORS.map(a => ({ ...a, reintensityScore: 10 }));
    assert.ok(computeGlobalRepressionIndex(high) > computeGlobalRepressionIndex(low));
  });

  it('single actor with score 100 returns 100', () => {
    const actors = [{ ...MOCK_ACTORS[0], reintensityScore: 100 }];
    assert.equal(computeGlobalRepressionIndex(actors), 100);
  });

  it('single actor with score 50 returns 50', () => {
    const actors = [{ ...MOCK_ACTORS[0], reintensityScore: 50 }];
    assert.equal(computeGlobalRepressionIndex(actors), 50);
  });

  it('caps at 100 even if score exceeds it', () => {
    const actors = [{ ...MOCK_ACTORS[0], reintensityScore: 120 }];
    assert.equal(computeGlobalRepressionIndex(actors), 100);
  });
});

// ── getByMethod ───────────────────────────────────────────────────────────────

describe('getByMethod', () => {
  it('returns only incidents with matching method', () => {
    const result = getByMethod(MOCK_INCIDENTS, 'Physical Assassination');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'T1');
  });

  it('returns empty when no incidents match method', () => {
    const result = getByMethod(MOCK_INCIDENTS, 'Interpol Abuse');
    assert.equal(result.length, 0);
  });

  it('returns multiple when several match', () => {
    const extended = [
      ...MOCK_INCIDENTS,
      { ...MOCK_INCIDENTS[0], id: 'T7', method: 'Physical Assassination' as RepressionMethod },
    ];
    const result = getByMethod(extended, 'Physical Assassination');
    assert.equal(result.length, 2);
  });

  it('does not mutate input array', () => {
    const before = MOCK_INCIDENTS.length;
    getByMethod(MOCK_INCIDENTS, 'Poisoning');
    assert.equal(MOCK_INCIDENTS.length, before);
  });

  it('all returned incidents have the requested method', () => {
    const result = getByMethod(MOCK_INCIDENTS, 'Harassment Campaign');
    assert.ok(result.every(i => i.method === 'Harassment Campaign'));
  });
});

// ── getByActor ────────────────────────────────────────────────────────────────

describe('getByActor', () => {
  it('returns only incidents from matching actor', () => {
    const result = getByActor(MOCK_INCIDENTS, 'Ruritania');
    assert.equal(result.length, 2);
    assert.ok(result.every(i => i.actor === 'Ruritania'));
  });

  it('returns empty when actor not found', () => {
    const result = getByActor(MOCK_INCIDENTS, 'Nonexistentia');
    assert.equal(result.length, 0);
  });

  it('is case-sensitive', () => {
    const result = getByActor(MOCK_INCIDENTS, 'ruritania');
    assert.equal(result.length, 0);
  });

  it('returns all incidents for prolific actor', () => {
    const result = getByActor(MOCK_INCIDENTS, 'Freedonia');
    assert.equal(result.length, 2);
  });

  it('does not mutate input array', () => {
    const before = MOCK_INCIDENTS.length;
    getByActor(MOCK_INCIDENTS, 'Sylvania');
    assert.equal(MOCK_INCIDENTS.length, before);
  });
});

// ── getHighSeverity ───────────────────────────────────────────────────────────

describe('getHighSeverity', () => {
  it('returns incidents at or above threshold', () => {
    const result = getHighSeverity(MOCK_INCIDENTS, 8);
    assert.ok(result.every(i => i.severity >= 8));
  });

  it('uses default threshold of 8', () => {
    const result = getHighSeverity(MOCK_INCIDENTS);
    assert.ok(result.every(i => i.severity >= 8));
  });

  it('includes incidents equal to threshold', () => {
    const result = getHighSeverity(MOCK_INCIDENTS, 10);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'T1');
  });

  it('returns empty when no incidents meet threshold', () => {
    const result = getHighSeverity(MOCK_INCIDENTS, 11);
    assert.equal(result.length, 0);
  });

  it('returns all when threshold is 1', () => {
    const result = getHighSeverity(MOCK_INCIDENTS, 1);
    assert.equal(result.length, MOCK_INCIDENTS.length);
  });

  it('excludes incidents one below threshold', () => {
    const result = getHighSeverity(MOCK_INCIDENTS, 9);
    assert.ok(result.every(i => i.severity >= 9));
    assert.equal(result.length, 2); // T1=10, T2=9
  });
});

// ── getMostActiveActors ───────────────────────────────────────────────────────

describe('getMostActiveActors', () => {
  it('returns actors sorted by reintensityScore descending', () => {
    const result = getMostActiveActors(MOCK_ACTORS, 3);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].reintensityScore >= result[i].reintensityScore);
    }
  });

  it('defaults to 5 entries', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...MOCK_ACTORS[0],
      id: `Z${i}`,
      reintensityScore: i * 10,
    }));
    assert.equal(getMostActiveActors(many).length, 5);
  });

  it('does not mutate original array order', () => {
    const origIds = MOCK_ACTORS.map(a => a.id);
    getMostActiveActors(MOCK_ACTORS, 2);
    assert.deepEqual(MOCK_ACTORS.map(a => a.id), origIds);
  });

  it('returns all if N > length', () => {
    assert.equal(getMostActiveActors(MOCK_ACTORS, 100).length, MOCK_ACTORS.length);
  });

  it('first result has highest score', () => {
    const top = getMostActiveActors(MOCK_ACTORS, 1);
    assert.equal(top[0].id, 'X1');
  });

  it('returns empty for empty input', () => {
    assert.equal(getMostActiveActors([]).length, 0);
  });
});

// ── getSeverityCategory ───────────────────────────────────────────────────────

describe('getSeverityCategory', () => {
  it('returns Critical for severity 9', () => {
    assert.equal(getSeverityCategory(9), 'Critical');
  });

  it('returns Critical for severity 10', () => {
    assert.equal(getSeverityCategory(10), 'Critical');
  });

  it('returns High for severity 7', () => {
    assert.equal(getSeverityCategory(7), 'High');
  });

  it('returns High for severity 8', () => {
    assert.equal(getSeverityCategory(8), 'High');
  });

  it('returns Medium for severity 5', () => {
    assert.equal(getSeverityCategory(5), 'Medium');
  });

  it('returns Medium for severity 6', () => {
    assert.equal(getSeverityCategory(6), 'Medium');
  });

  it('returns Low for severity 4', () => {
    assert.equal(getSeverityCategory(4), 'Low');
  });

  it('returns Low for severity 1', () => {
    assert.equal(getSeverityCategory(1), 'Low');
  });
});

// ── methodClass ───────────────────────────────────────────────────────────────

describe('methodClass', () => {
  it('Physical Assassination returns method-lethal', () => {
    assert.equal(methodClass('Physical Assassination'), 'method-lethal');
  });

  it('Poisoning returns method-lethal', () => {
    assert.equal(methodClass('Poisoning'), 'method-lethal');
  });

  it('Forced Disappearance returns method-lethal', () => {
    assert.equal(methodClass('Forced Disappearance'), 'method-lethal');
  });

  it('Rendition returns method-coercive', () => {
    assert.equal(methodClass('Rendition'), 'method-coercive');
  });

  it('Forced Plane Landing returns method-coercive', () => {
    assert.equal(methodClass('Forced Plane Landing'), 'method-coercive');
  });

  it('Interpol Abuse returns method-legal', () => {
    assert.equal(methodClass('Interpol Abuse'), 'method-legal');
  });

  it('Digital Surveillance returns method-digital', () => {
    assert.equal(methodClass('Digital Surveillance'), 'method-digital');
  });

  it('Pegasus Spyware returns method-digital', () => {
    assert.equal(methodClass('Pegasus Spyware'), 'method-digital');
  });

  it('Harassment Campaign returns method-pressure', () => {
    assert.equal(methodClass('Harassment Campaign'), 'method-pressure');
  });

  it('Family Coercion returns method-pressure', () => {
    assert.equal(methodClass('Family Coercion'), 'method-pressure');
  });
});

// ── severityClass ─────────────────────────────────────────────────────────────

describe('severityClass', () => {
  it('returns sev-critical for severity 10', () => {
    assert.equal(severityClass(10), 'sev-critical');
  });

  it('returns sev-critical for severity 9', () => {
    assert.equal(severityClass(9), 'sev-critical');
  });

  it('returns sev-high for severity 8', () => {
    assert.equal(severityClass(8), 'sev-high');
  });

  it('returns sev-high for severity 7', () => {
    assert.equal(severityClass(7), 'sev-high');
  });

  it('returns sev-medium for severity 6', () => {
    assert.equal(severityClass(6), 'sev-medium');
  });

  it('returns sev-medium for severity 5', () => {
    assert.equal(severityClass(5), 'sev-medium');
  });

  it('returns sev-low for severity 4', () => {
    assert.equal(severityClass(4), 'sev-low');
  });

  it('returns sev-low for severity 1', () => {
    assert.equal(severityClass(1), 'sev-low');
  });
});

// ── tierClass ─────────────────────────────────────────────────────────────────

describe('tierClass', () => {
  it('Tier 1 returns tier-1', () => {
    assert.equal(tierClass('Tier 1'), 'tier-1');
  });

  it('Tier 2 returns tier-2', () => {
    assert.equal(tierClass('Tier 2'), 'tier-2');
  });

  it('Tier 3 returns tier-3', () => {
    assert.equal(tierClass('Tier 3'), 'tier-3');
  });
});

// ── trendClass ────────────────────────────────────────────────────────────────

describe('trendClass', () => {
  it('escalating returns trend-up', () => {
    assert.equal(trendClass('escalating'), 'trend-up');
  });

  it('stable returns trend-flat', () => {
    assert.equal(trendClass('stable'), 'trend-flat');
  });

  it('declining returns trend-down', () => {
    assert.equal(trendClass('declining'), 'trend-down');
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.incidents));
    assert.ok(Array.isArray(d.actors));
    assert.equal(typeof d.globalRepressionIndex, 'number');
    assert.equal(typeof d.criticalCount, 'number');
    assert.equal(typeof d.highCount, 'number');
    assert.equal(typeof d.activeActorCount, 'number');
    assert.ok(Array.isArray(d.mostActiveActors));
    assert.ok(Array.isArray(d.recentIncidents));
  });

  it('incidents array is non-empty', () => {
    assert.ok(buildRenderData().incidents.length > 0);
  });

  it('actors array is non-empty', () => {
    assert.ok(buildRenderData().actors.length > 0);
  });

  it('globalRepressionIndex is in range 0-100', () => {
    const idx = buildRenderData().globalRepressionIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('criticalCount matches actual Critical incidents', () => {
    const d = buildRenderData();
    const expected = d.incidents.filter(i => getSeverityCategory(i.severity) === 'Critical').length;
    assert.equal(d.criticalCount, expected);
  });

  it('highCount matches actual High incidents', () => {
    const d = buildRenderData();
    const expected = d.incidents.filter(i => getSeverityCategory(i.severity) === 'High').length;
    assert.equal(d.highCount, expected);
  });

  it('activeActorCount matches escalating + stable actors', () => {
    const d = buildRenderData();
    const expected = d.actors.filter(a => a.trend === 'escalating' || a.trend === 'stable').length;
    assert.equal(d.activeActorCount, expected);
  });

  it('mostActiveActors is sorted by reintensityScore desc', () => {
    const ma = buildRenderData().mostActiveActors;
    for (let i = 1; i < ma.length; i++) {
      assert.ok(ma[i - 1].reintensityScore >= ma[i].reintensityScore);
    }
  });

  it('mostActiveActors has at most 5 entries', () => {
    assert.ok(buildRenderData().mostActiveActors.length <= 5);
  });

  it('recentIncidents has at most 5 entries', () => {
    assert.ok(buildRenderData().recentIncidents.length <= 5);
  });

  it('recentIncidents sorted by date descending', () => {
    const ri = buildRenderData().recentIncidents;
    for (let i = 1; i < ri.length; i++) {
      assert.ok(ri[i - 1].date >= ri[i].date);
    }
  });

  it('all incident IDs are unique', () => {
    const ids = buildRenderData().incidents.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all actor IDs are unique', () => {
    const ids = buildRenderData().actors.map(a => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all severity scores are in range 1-10', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.severity >= 1 && i.severity <= 10, `${i.id} severity ${i.severity} out of range`);
    }
  });

  it('all reintensityScores are in range 0-100', () => {
    for (const a of buildRenderData().actors) {
      assert.ok(a.reintensityScore >= 0 && a.reintensityScore <= 100,
        `${a.country} score ${a.reintensityScore} out of range`);
    }
  });

  it('all actor tiers are valid', () => {
    const valid = new Set<ActorTier>(['Tier 1', 'Tier 2', 'Tier 3']);
    for (const a of buildRenderData().actors) {
      assert.ok(valid.has(a.tier), `Invalid tier: ${a.tier}`);
    }
  });

  it('all actor trends are valid', () => {
    const valid = new Set(['escalating', 'stable', 'declining']);
    for (const a of buildRenderData().actors) {
      assert.ok(valid.has(a.trend), `Invalid trend: ${a.trend}`);
    }
  });

  it('all incidents have non-empty actor strings', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.actor.trim().length > 0);
    }
  });

  it('all incidents have non-empty target strings', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.target.trim().length > 0);
    }
  });

  it('all incidents have at least one source', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.sources.length > 0, `${i.id} has no sources`);
    }
  });

  it('all actors have at least one known method', () => {
    for (const a of buildRenderData().actors) {
      assert.ok(a.knownMethods.length > 0, `${a.country} has no methods`);
    }
  });

  it('all actors have at least one operational reach entry', () => {
    for (const a of buildRenderData().actors) {
      assert.ok(a.operationalReach.length > 0, `${a.country} has no operational reach`);
    }
  });

  it('all actor incidentCounts are positive', () => {
    for (const a of buildRenderData().actors) {
      assert.ok(a.incidentCount > 0, `${a.country} incidentCount is not positive`);
    }
  });

  it('includes Saudi Arabia Khashoggi incident', () => {
    const d = buildRenderData();
    const kha = d.incidents.find(i => i.id === 'TR001');
    assert.ok(kha, 'TR001 (Khashoggi) not found');
    assert.equal(kha!.actor, 'Saudi Arabia');
    assert.equal(kha!.severity, 10);
  });

  it('includes Russia Skripal incident', () => {
    const d = buildRenderData();
    const ski = d.incidents.find(i => i.id === 'TR002');
    assert.ok(ski, 'TR002 (Skripal) not found');
    assert.equal(ski!.method, 'Poisoning');
  });

  it('includes Belarus Protasevich forced landing', () => {
    const d = buildRenderData();
    const pro = d.incidents.find(i => i.id === 'TR008');
    assert.ok(pro, 'TR008 (Protasevich) not found');
    assert.equal(pro!.method, 'Forced Plane Landing');
    assert.equal(pro!.actor, 'Belarus');
  });

  it('Russia actor exists with Tier 1 and escalating trend', () => {
    const d = buildRenderData();
    const russia = d.actors.find(a => a.country === 'Russia');
    assert.ok(russia, 'Russia actor not found');
    assert.equal(russia!.tier, 'Tier 1');
    assert.equal(russia!.trend, 'escalating');
  });

  it('China actor has highest or equal incidentCount among all actors', () => {
    const d = buildRenderData();
    const china = d.actors.find(a => a.country === 'China');
    assert.ok(china, 'China actor not found');
    assert.ok(china!.incidentCount >= 100);
  });

  it('at least 3 Tier 1 actors present', () => {
    const d = buildRenderData();
    const tier1 = d.actors.filter(a => a.tier === 'Tier 1');
    assert.ok(tier1.length >= 3);
  });

  it('has at least 10 incidents', () => {
    assert.ok(buildRenderData().incidents.length >= 10);
  });

  it('has at least 8 actors', () => {
    assert.ok(buildRenderData().actors.length >= 8);
  });
});
