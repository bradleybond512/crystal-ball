import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalDroneIndex,
  getByType,
  getCombatExperienced,
  getHighSignificanceIncidents,
  getOngoingIncidents,
  proliferationClass,
  maturityClass,
  incidentTypeClass,
  buildRenderData,
  type DroneProgram,
  type DroneIncident,
  type DroneType,
  type MaturityLevel,
  type IncidentType,
} from '../drone-warfare-helpers.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PROGRAMS: DroneProgram[] = [
  {
    country: 'Alpha',
    type: 'Military',
    maturityLevel: 'Advanced',
    keyPlatforms: ['X-1'],
    combatExperience: true,
    exportingTo: ['Beta', 'Gamma'],
    description: 'Advanced military program',
  },
  {
    country: 'Beta',
    type: 'Commercial',
    maturityLevel: 'Developing',
    keyPlatforms: ['Y-2'],
    combatExperience: false,
    exportingTo: [],
    description: 'Commercial-only program',
  },
  {
    country: 'Gamma',
    type: 'Both',
    maturityLevel: 'Nascent',
    keyPlatforms: ['Z-3'],
    combatExperience: true,
    exportingTo: ['Alpha'],
    description: 'Dual-use nascent program',
  },
  {
    country: 'Delta',
    type: 'Military',
    maturityLevel: 'Developing',
    keyPlatforms: ['W-4', 'W-5'],
    combatExperience: false,
    exportingTo: [],
    description: 'Developing military program, no combat',
  },
];

const MOCK_INCIDENTS: DroneIncident[] = [
  {
    id: 'I1', date: '2024-01-01', actor: 'Alpha', target: 'City A',
    platform: 'X-1', type: 'Strike', region: 'Europe',
    casualties: 10, significance: 9, description: 'Major strike', ongoing: true,
  },
  {
    id: 'I2', date: '2023-06-15', actor: 'Beta', target: 'Fleet B',
    platform: 'Y-2', type: 'Surveillance', region: 'Asia',
    casualties: 0, significance: 6, description: 'Surveillance op', ongoing: false,
  },
  {
    id: 'I3', date: '2023-11-01', actor: 'Gamma', target: 'Convoy C',
    platform: 'Z-3', type: 'Swarm Attack', region: 'Middle East',
    casualties: 50, significance: 8, description: 'Swarm attack on convoy', ongoing: true,
  },
  {
    id: 'I4', date: '2022-05-01', actor: 'Delta', target: 'Base D',
    platform: 'W-4', type: 'Kamikaze', region: 'Europe',
    casualties: 5, significance: 10, description: 'Kamikaze strike', ongoing: false,
  },
  {
    id: 'I5', date: '2024-03-01', actor: 'Epsilon', target: 'Port E',
    platform: 'E-1', type: 'Supply', region: 'Africa',
    casualties: 0, significance: 3, description: 'Supply run', ongoing: false,
  },
];

// ── computeGlobalDroneIndex ───────────────────────────────────────────────────

describe('computeGlobalDroneIndex', () => {
  it('returns 0 for empty programs array', () => {
    assert.equal(computeGlobalDroneIndex([], MOCK_INCIDENTS), 0);
  });

  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalDroneIndex(MOCK_PROGRAMS, MOCK_INCIDENTS);
    assert.ok(idx >= 0 && idx <= 100, `Index ${idx} out of range`);
  });

  it('returns an integer', () => {
    const idx = computeGlobalDroneIndex(MOCK_PROGRAMS, MOCK_INCIDENTS);
    assert.equal(idx, Math.round(idx));
  });

  it('all-combat all-advanced programs yield higher index than none', () => {
    const highPrograms = MOCK_PROGRAMS.map(p => ({ ...p, combatExperience: true, maturityLevel: 'Advanced' as MaturityLevel }));
    const lowPrograms = MOCK_PROGRAMS.map(p => ({ ...p, combatExperience: false, maturityLevel: 'Nascent' as MaturityLevel }));
    assert.ok(
      computeGlobalDroneIndex(highPrograms, MOCK_INCIDENTS) >=
      computeGlobalDroneIndex(lowPrograms, MOCK_INCIDENTS),
    );
  });

  it('handles empty incidents list', () => {
    const idx = computeGlobalDroneIndex(MOCK_PROGRAMS, []);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('high-significance incidents increase index vs low-significance', () => {
    const highSig = MOCK_INCIDENTS.map(i => ({ ...i, significance: 10 }));
    const lowSig = MOCK_INCIDENTS.map(i => ({ ...i, significance: 1 }));
    assert.ok(
      computeGlobalDroneIndex(MOCK_PROGRAMS, highSig) >=
      computeGlobalDroneIndex(MOCK_PROGRAMS, lowSig),
    );
  });

  it('caps at 100 for max inputs', () => {
    const maxPrograms = MOCK_PROGRAMS.map(p => ({ ...p, combatExperience: true, maturityLevel: 'Advanced' as MaturityLevel }));
    const maxIncidents = MOCK_INCIDENTS.map(i => ({ ...i, significance: 10 }));
    assert.ok(computeGlobalDroneIndex(maxPrograms, maxIncidents) <= 100);
  });
});

// ── getByType ─────────────────────────────────────────────────────────────────

describe('getByType', () => {
  it('returns only Military programs', () => {
    const mil = getByType(MOCK_PROGRAMS, 'Military');
    assert.ok(mil.length > 0);
    assert.ok(mil.every(p => p.type === 'Military'));
  });

  it('returns only Commercial programs', () => {
    const com = getByType(MOCK_PROGRAMS, 'Commercial');
    assert.equal(com.length, 1);
    assert.equal(com[0].country, 'Beta');
  });

  it('returns only Both programs', () => {
    const both = getByType(MOCK_PROGRAMS, 'Both');
    assert.equal(both.length, 1);
    assert.equal(both[0].country, 'Gamma');
  });

  it('returns empty when no match', () => {
    const noMil = MOCK_PROGRAMS.map(p => ({ ...p, type: 'Commercial' as DroneType }));
    assert.equal(getByType(noMil, 'Military').length, 0);
  });

  it('does not mutate the input array', () => {
    const before = MOCK_PROGRAMS.length;
    getByType(MOCK_PROGRAMS, 'Military');
    assert.equal(MOCK_PROGRAMS.length, before);
  });

  it('returns all when all match', () => {
    const allMil = MOCK_PROGRAMS.map(p => ({ ...p, type: 'Military' as DroneType }));
    assert.equal(getByType(allMil, 'Military').length, allMil.length);
  });
});

// ── getCombatExperienced ──────────────────────────────────────────────────────

describe('getCombatExperienced', () => {
  it('returns only programs with combatExperience=true', () => {
    const combat = getCombatExperienced(MOCK_PROGRAMS);
    assert.ok(combat.every(p => p.combatExperience === true));
  });

  it('correct count of combat-experienced programs', () => {
    const combat = getCombatExperienced(MOCK_PROGRAMS);
    assert.equal(combat.length, MOCK_PROGRAMS.filter(p => p.combatExperience).length);
  });

  it('returns empty when none have combat experience', () => {
    const none = MOCK_PROGRAMS.map(p => ({ ...p, combatExperience: false }));
    assert.equal(getCombatExperienced(none).length, 0);
  });

  it('returns all when all have combat experience', () => {
    const all = MOCK_PROGRAMS.map(p => ({ ...p, combatExperience: true }));
    assert.equal(getCombatExperienced(all).length, MOCK_PROGRAMS.length);
  });

  it('does not mutate the input array', () => {
    const before = MOCK_PROGRAMS.length;
    getCombatExperienced(MOCK_PROGRAMS);
    assert.equal(MOCK_PROGRAMS.length, before);
  });
});

// ── getHighSignificanceIncidents ──────────────────────────────────────────────

describe('getHighSignificanceIncidents', () => {
  it('default threshold of 8 filters correctly', () => {
    const high = getHighSignificanceIncidents(MOCK_INCIDENTS);
    assert.ok(high.every(i => i.significance >= 8));
  });

  it('includes incidents equal to threshold', () => {
    const high = getHighSignificanceIncidents(MOCK_INCIDENTS, 8);
    assert.ok(high.some(i => i.significance === 8));
  });

  it('excludes incidents below threshold', () => {
    const high = getHighSignificanceIncidents(MOCK_INCIDENTS, 8);
    assert.ok(high.every(i => i.significance >= 8));
  });

  it('returns empty when none meet threshold', () => {
    const low = MOCK_INCIDENTS.map(i => ({ ...i, significance: 1 }));
    assert.equal(getHighSignificanceIncidents(low, 8).length, 0);
  });

  it('returns all when all meet threshold', () => {
    const all = MOCK_INCIDENTS.map(i => ({ ...i, significance: 10 }));
    assert.equal(getHighSignificanceIncidents(all, 8).length, MOCK_INCIDENTS.length);
  });

  it('custom threshold works', () => {
    const high = getHighSignificanceIncidents(MOCK_INCIDENTS, 10);
    assert.equal(high.length, MOCK_INCIDENTS.filter(i => i.significance >= 10).length);
  });

  it('significance 7 is excluded at threshold 8', () => {
    const borderline = [{ ...MOCK_INCIDENTS[0], significance: 7 }];
    assert.equal(getHighSignificanceIncidents(borderline, 8).length, 0);
  });
});

// ── getOngoingIncidents ───────────────────────────────────────────────────────

describe('getOngoingIncidents', () => {
  it('returns only ongoing incidents', () => {
    const ongoing = getOngoingIncidents(MOCK_INCIDENTS);
    assert.ok(ongoing.every(i => i.ongoing === true));
  });

  it('correct count of ongoing incidents', () => {
    const ongoing = getOngoingIncidents(MOCK_INCIDENTS);
    assert.equal(ongoing.length, MOCK_INCIDENTS.filter(i => i.ongoing).length);
  });

  it('returns empty when none ongoing', () => {
    const none = MOCK_INCIDENTS.map(i => ({ ...i, ongoing: false }));
    assert.equal(getOngoingIncidents(none).length, 0);
  });

  it('returns all when all ongoing', () => {
    const all = MOCK_INCIDENTS.map(i => ({ ...i, ongoing: true }));
    assert.equal(getOngoingIncidents(all).length, MOCK_INCIDENTS.length);
  });

  it('does not mutate input', () => {
    const before = MOCK_INCIDENTS.length;
    getOngoingIncidents(MOCK_INCIDENTS);
    assert.equal(MOCK_INCIDENTS.length, before);
  });
});

// ── proliferationClass ────────────────────────────────────────────────────────

describe('proliferationClass', () => {
  it('Advanced -> drone-advanced', () => {
    assert.equal(proliferationClass('Advanced'), 'drone-advanced');
  });

  it('Developing -> drone-developing', () => {
    assert.equal(proliferationClass('Developing'), 'drone-developing');
  });

  it('Nascent -> drone-nascent', () => {
    assert.equal(proliferationClass('Nascent'), 'drone-nascent');
  });

  it('returns a non-empty string for all valid maturity levels', () => {
    const levels: MaturityLevel[] = ['Advanced', 'Developing', 'Nascent'];
    for (const level of levels) {
      assert.ok(proliferationClass(level).length > 0);
    }
  });
});

// ── maturityClass ─────────────────────────────────────────────────────────────

describe('maturityClass', () => {
  it('produces same output as proliferationClass for all inputs', () => {
    const levels: MaturityLevel[] = ['Advanced', 'Developing', 'Nascent'];
    for (const level of levels) {
      assert.equal(maturityClass(level), proliferationClass(level));
    }
  });

  it('Advanced -> drone-advanced', () => {
    assert.equal(maturityClass('Advanced'), 'drone-advanced');
  });

  it('Nascent -> drone-nascent', () => {
    assert.equal(maturityClass('Nascent'), 'drone-nascent');
  });
});

// ── incidentTypeClass ─────────────────────────────────────────────────────────

describe('incidentTypeClass', () => {
  it('Strike -> itype-strike', () => {
    assert.equal(incidentTypeClass('Strike'), 'itype-strike');
  });

  it('Swarm Attack -> itype-swarm', () => {
    assert.equal(incidentTypeClass('Swarm Attack'), 'itype-swarm');
  });

  it('Surveillance -> itype-surveillance', () => {
    assert.equal(incidentTypeClass('Surveillance'), 'itype-surveillance');
  });

  it('Supply -> itype-supply', () => {
    assert.equal(incidentTypeClass('Supply'), 'itype-supply');
  });

  it('Kamikaze -> itype-kamikaze', () => {
    assert.equal(incidentTypeClass('Kamikaze'), 'itype-kamikaze');
  });

  it('returns non-empty string for all incident types', () => {
    const types: IncidentType[] = ['Strike', 'Swarm Attack', 'Surveillance', 'Supply', 'Kamikaze'];
    for (const t of types) {
      assert.ok(incidentTypeClass(t).length > 0);
    }
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.programs));
    assert.ok(Array.isArray(d.incidents));
    assert.equal(typeof d.globalDroneIndex, 'number');
    assert.equal(typeof d.proliferationScore, 'number');
    assert.equal(typeof d.combatUsageScore, 'number');
    assert.ok(Array.isArray(d.topActors));
  });

  it('programs array has 8 entries', () => {
    assert.equal(buildRenderData().programs.length, 8);
  });

  it('incidents array has 12 entries', () => {
    assert.equal(buildRenderData().incidents.length, 12);
  });

  it('globalDroneIndex is in range 0-100', () => {
    const idx = buildRenderData().globalDroneIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('proliferationScore is in range 0-100', () => {
    const s = buildRenderData().proliferationScore;
    assert.ok(s >= 0 && s <= 100);
  });

  it('combatUsageScore is in range 0-100', () => {
    const s = buildRenderData().combatUsageScore;
    assert.ok(s >= 0 && s <= 100);
  });

  it('topActors contains only combat-experienced program countries', () => {
    const d = buildRenderData();
    const combatCountries = new Set(d.programs.filter(p => p.combatExperience).map(p => p.country));
    for (const actor of d.topActors) {
      assert.ok(combatCountries.has(actor), `${actor} not in combat-experienced countries`);
    }
  });

  it('topActors length matches combat-experienced programs count', () => {
    const d = buildRenderData();
    assert.equal(d.topActors.length, d.programs.filter(p => p.combatExperience).length);
  });

  it('all program countries are non-empty strings', () => {
    for (const p of buildRenderData().programs) {
      assert.ok(p.country.trim().length > 0);
    }
  });

  it('all incident IDs are unique', () => {
    const ids = buildRenderData().incidents.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all incident significance values are in range 1-10', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.significance >= 1 && i.significance <= 10, `Significance ${i.significance} out of range`);
    }
  });

  it('all incident types are valid', () => {
    const valid = new Set(['Strike', 'Swarm Attack', 'Surveillance', 'Supply', 'Kamikaze']);
    for (const i of buildRenderData().incidents) {
      assert.ok(valid.has(i.type), `Invalid type: ${i.type}`);
    }
  });

  it('all program maturity levels are valid', () => {
    const valid = new Set(['Advanced', 'Developing', 'Nascent']);
    for (const p of buildRenderData().programs) {
      assert.ok(valid.has(p.maturityLevel), `Invalid maturity: ${p.maturityLevel}`);
    }
  });

  it('all program types are valid', () => {
    const valid = new Set(['Military', 'Commercial', 'Both']);
    for (const p of buildRenderData().programs) {
      assert.ok(valid.has(p.type), `Invalid type: ${p.type}`);
    }
  });

  it('all programs have non-empty keyPlatforms', () => {
    for (const p of buildRenderData().programs) {
      assert.ok(p.keyPlatforms.length > 0, `${p.country} has no key platforms`);
    }
  });

  it('USA is present in programs', () => {
    const d = buildRenderData();
    assert.ok(d.programs.some(p => p.country === 'USA'));
  });

  it('USA has combat experience', () => {
    const usa = buildRenderData().programs.find(p => p.country === 'USA');
    assert.ok(usa?.combatExperience === true);
  });

  it('Houthi non-state actor is present', () => {
    const d = buildRenderData();
    assert.ok(d.programs.some(p => p.country.includes('Houthi')));
  });

  it('Houthi has Nascent maturity', () => {
    const houthi = buildRenderData().programs.find(p => p.country.includes('Houthi'));
    assert.equal(houthi?.maturityLevel, 'Nascent');
  });

  it('Russia Shahed incidents are included', () => {
    const d = buildRenderData();
    assert.ok(d.incidents.some(i => i.actor === 'Russia' && i.type === 'Kamikaze'));
  });

  it('at least one ongoing incident exists', () => {
    assert.ok(buildRenderData().incidents.some(i => i.ongoing));
  });

  it('at least one high-significance incident (>=8) exists', () => {
    assert.ok(buildRenderData().incidents.some(i => i.significance >= 8));
  });

  it('combatUsageScore equals 100 when all programs have combat experience', () => {
    const d = buildRenderData();
    if (d.programs.every(p => p.combatExperience)) {
      assert.equal(d.combatUsageScore, 100);
    } else {
      assert.ok(d.combatUsageScore < 100);
    }
  });

  it('all incident dates are non-empty strings', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.date.trim().length > 0);
    }
  });

  it('all incident descriptions are non-empty strings', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.description.trim().length > 0);
    }
  });

  it('all program descriptions are non-empty strings', () => {
    for (const p of buildRenderData().programs) {
      assert.ok(p.description.trim().length > 0);
    }
  });

  it('exportingTo is an array for every program', () => {
    for (const p of buildRenderData().programs) {
      assert.ok(Array.isArray(p.exportingTo));
    }
  });

  it('DI002 (Russia Shahed) has significance 10', () => {
    const inc = buildRenderData().incidents.find(i => i.id === 'DI002');
    assert.equal(inc?.significance, 10);
  });

  it('DI001 (Houthi Red Sea) is ongoing', () => {
    const inc = buildRenderData().incidents.find(i => i.id === 'DI001');
    assert.ok(inc?.ongoing === true);
  });

  it('China exports to more than 5 countries', () => {
    const china = buildRenderData().programs.find(p => p.country === 'China');
    assert.ok((china?.exportingTo.length ?? 0) > 5);
  });

  it('Turkey has combat experience', () => {
    const turkey = buildRenderData().programs.find(p => p.country === 'Turkey');
    assert.ok(turkey?.combatExperience === true);
  });

  it('Iran type is Military', () => {
    const iran = buildRenderData().programs.find(p => p.country === 'Iran');
    assert.equal(iran?.type, 'Military');
  });

  it('Ukraine type is Both', () => {
    const ukraine = buildRenderData().programs.find(p => p.country === 'Ukraine');
    assert.equal(ukraine?.type, 'Both');
  });
});
