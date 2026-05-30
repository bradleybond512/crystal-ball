import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getByRegion,
  getHighImpact,
  getEscalating,
  getByEventType,
  computeGlobalViolenceIndex,
  conflictTypeClass,
  civilianImpactClass,
  eventTypeClass,
  buildRenderData,
  HOTSPOTS,
  EVENTS,
  type ViolenceHotspot,
  type ViolenceEvent,
  type CivilianImpact,
  type EventType,
} from '../political-violence-helpers.ts';

// ?? Mock data ?????????????????????????????????????????????????????????????????

const MOCK_HOTSPOTS: ViolenceHotspot[] = [
  { id: 'H1', country: 'Alpha', region: 'Africa', primaryActor: 'Rebels', conflictType: 'Civil War', monthlyEvents: 1000, trend: 'escalating', fatalitiesYTD: '5,000', civilianImpact: 'Extreme', description: 'Major conflict' },
  { id: 'H2', country: 'Beta', region: 'Africa', primaryActor: 'Militia', conflictType: 'Insurgency', monthlyEvents: 500, trend: 'stable', fatalitiesYTD: '1,000', civilianImpact: 'High', description: 'Insurgency ongoing' },
  { id: 'H3', country: 'Gamma', region: 'Europe', primaryActor: 'State forces', conflictType: 'State Repression', monthlyEvents: 200, trend: 'declining', fatalitiesYTD: '200', civilianImpact: 'Medium', description: 'Crackdown easing' },
  { id: 'H4', country: 'Delta', region: 'Asia-Pacific', primaryActor: 'Gangs', conflictType: 'Terrorism', monthlyEvents: 300, trend: 'escalating', fatalitiesYTD: '800', civilianImpact: 'High', description: 'Terror campaign' },
  { id: 'H5', country: 'Epsilon', region: 'Middle East', primaryActor: 'Militias', conflictType: 'Civil War', monthlyEvents: 100, trend: 'declining', fatalitiesYTD: '100', civilianImpact: 'Low', description: 'Winding down' },
  { id: 'H6', country: 'Zeta', region: 'Africa', primaryActor: 'Jihadists', conflictType: 'Terrorism', monthlyEvents: 400, trend: 'escalating', fatalitiesYTD: '2,000', civilianImpact: 'Extreme', description: 'Expanding territory' },
];

const MOCK_EVENTS: ViolenceEvent[] = [
  { id: 'E1', date: '2024-01-01', country: 'Alpha', eventType: 'Battles', actor: 'Rebels', fatalities: 200, description: 'Major battle', significance: 9 },
  { id: 'E2', date: '2024-02-01', country: 'Beta', eventType: 'Explosions', actor: 'Militia', fatalities: 15, description: 'IED attack', significance: 7 },
  { id: 'E3', date: '2024-03-01', country: 'Gamma', eventType: 'Riots', actor: 'Protesters', fatalities: 5, description: 'Protest violence', significance: 5 },
  { id: 'E4', date: '2024-04-01', country: 'Delta', eventType: 'Violence Against Civilians', actor: 'Gangs', fatalities: 80, description: 'Massacre', significance: 8 },
  { id: 'E5', date: '2024-05-01', country: 'Epsilon', eventType: 'Strategic Developments', actor: 'State', fatalities: 0, description: 'Peace deal', significance: 6 },
  { id: 'E6', date: '2024-06-01', country: 'Alpha', eventType: 'Battles', actor: 'State forces', fatalities: 120, description: 'Counteroffensive', significance: 8 },
];

// ?? getByRegion ???????????????????????????????????????????????????????????????
describe('getByRegion', () => {
  it('returns hotspots in Africa', () => {
    const result = getByRegion(MOCK_HOTSPOTS, 'Africa');
    assert.equal(result.length, 3);
    assert.ok(result.every(h => h.region === 'Africa'));
  });

  it('returns single match for Europe', () => {
    const result = getByRegion(MOCK_HOTSPOTS, 'Europe');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'H3');
  });

  it('returns empty for unknown region', () => {
    assert.equal(getByRegion(MOCK_HOTSPOTS, 'Antarctica').length, 0);
  });

  it('does not mutate source array', () => {
    const before = MOCK_HOTSPOTS.length;
    getByRegion(MOCK_HOTSPOTS, 'Africa');
    assert.equal(MOCK_HOTSPOTS.length, before);
  });

  it('is case-sensitive', () => {
    assert.equal(getByRegion(MOCK_HOTSPOTS, 'africa').length, 0);
  });

  it('handles empty input array', () => {
    assert.equal(getByRegion([], 'Africa').length, 0);
  });
});

// ?? getHighImpact ?????????????????????????????????????????????????????????????
describe('getHighImpact', () => {
  it('returns High and Extreme by default threshold High', () => {
    const result = getHighImpact(MOCK_HOTSPOTS);
    assert.equal(result.length, 4);
    assert.ok(result.every(h => h.civilianImpact === 'High' || h.civilianImpact === 'Extreme'));
  });

  it('returns only Extreme with Extreme threshold', () => {
    const result = getHighImpact(MOCK_HOTSPOTS, 'Extreme');
    assert.equal(result.length, 2);
    assert.ok(result.every(h => h.civilianImpact === 'Extreme'));
  });

  it('returns all hotspots with Low threshold', () => {
    const result = getHighImpact(MOCK_HOTSPOTS, 'Low');
    assert.equal(result.length, MOCK_HOTSPOTS.length);
  });

  it('returns correct count with Medium threshold', () => {
    const result = getHighImpact(MOCK_HOTSPOTS, 'Medium');
    assert.equal(result.length, 5);
  });

  it('returns empty for empty input', () => {
    assert.equal(getHighImpact([]).length, 0);
  });

  it('does not mutate the source array', () => {
    const len = MOCK_HOTSPOTS.length;
    getHighImpact(MOCK_HOTSPOTS, 'High');
    assert.equal(MOCK_HOTSPOTS.length, len);
  });

  it('fixture data has 8 High-or-Extreme hotspots', () => {
    const result = getHighImpact(HOTSPOTS, 'High');
    assert.ok(result.length >= 8);
  });
});

// ?? getEscalating ?????????????????????????????????????????????????????????????
describe('getEscalating', () => {
  it('returns only escalating hotspots', () => {
    const result = getEscalating(MOCK_HOTSPOTS);
    assert.equal(result.length, 3);
    assert.ok(result.every(h => h.trend === 'escalating'));
  });

  it('returns empty for empty input', () => {
    assert.equal(getEscalating([]).length, 0);
  });

  it('does not include stable hotspots', () => {
    const result = getEscalating(MOCK_HOTSPOTS);
    assert.ok(result.every(h => h.trend !== 'stable'));
  });

  it('fixture HOTSPOTS has multiple escalating entries', () => {
    const result = getEscalating(HOTSPOTS);
    assert.ok(result.length >= 5);
  });
});

// ?? getByEventType ????????????????????????????????????????????????????????????
describe('getByEventType', () => {
  it('returns only Battles events', () => {
    const result = getByEventType(MOCK_EVENTS, 'Battles');
    assert.equal(result.length, 2);
    assert.ok(result.every(e => e.eventType === 'Battles'));
  });

  it('returns only Riots events', () => {
    const result = getByEventType(MOCK_EVENTS, 'Riots');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'E3');
  });

  it('returns empty for type with no matching events', () => {
    const result = getByEventType([], 'Explosions');
    assert.equal(result.length, 0);
  });

  it('returns Strategic Developments events', () => {
    const result = getByEventType(MOCK_EVENTS, 'Strategic Developments');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'E5');
  });

  it('fixture EVENTS has Battles type events', () => {
    const battles = getByEventType(EVENTS, 'Battles');
    assert.ok(battles.length >= 1);
    assert.ok(battles.every(e => e.eventType === 'Battles'));
  });
});

// ?? computeGlobalViolenceIndex ????????????????????????????????????????????????
describe('computeGlobalViolenceIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalViolenceIndex([]), 0);
  });

  it('returns value between 0 and 100', () => {
    const idx = computeGlobalViolenceIndex(MOCK_HOTSPOTS);
    assert.ok(idx >= 0 && idx <= 100, `Expected 0-100, got ${idx}`);
  });

  it('escalating hotspot scores higher than declining same events', () => {
    const escalating: ViolenceHotspot[] = [
      { id: 'X1', country: 'A', region: 'R', primaryActor: 'A', conflictType: 'Civil War', monthlyEvents: 500, trend: 'escalating', fatalitiesYTD: '0', civilianImpact: 'High', description: '' },
    ];
    const declining: ViolenceHotspot[] = [
      { id: 'X2', country: 'B', region: 'R', primaryActor: 'A', conflictType: 'Civil War', monthlyEvents: 500, trend: 'declining', fatalitiesYTD: '0', civilianImpact: 'High', description: '' },
    ];
    assert.ok(computeGlobalViolenceIndex(escalating) > computeGlobalViolenceIndex(declining));
  });

  it('Extreme impact scores higher than Low impact same events', () => {
    const extreme: ViolenceHotspot[] = [
      { id: 'Y1', country: 'A', region: 'R', primaryActor: 'A', conflictType: 'Civil War', monthlyEvents: 500, trend: 'stable', fatalitiesYTD: '0', civilianImpact: 'Extreme', description: '' },
    ];
    const low: ViolenceHotspot[] = [
      { id: 'Y2', country: 'B', region: 'R', primaryActor: 'A', conflictType: 'Civil War', monthlyEvents: 500, trend: 'stable', fatalitiesYTD: '0', civilianImpact: 'Low', description: '' },
    ];
    assert.ok(computeGlobalViolenceIndex(extreme) > computeGlobalViolenceIndex(low));
  });

  it('caps at 100 for very high event counts', () => {
    const massive: ViolenceHotspot[] = Array.from({ length: 10 }, (_, i) => ({
      id: `Z${i}`, country: `C${i}`, region: 'R', primaryActor: 'A', conflictType: 'Civil War' as const,
      monthlyEvents: 100_000, trend: 'escalating' as const, fatalitiesYTD: '999,999', civilianImpact: 'Extreme' as const, description: '',
    }));
    assert.equal(computeGlobalViolenceIndex(massive), 100);
  });

  it('is deterministic Ñ same input gives same output', () => {
    const a = computeGlobalViolenceIndex(HOTSPOTS);
    const b = computeGlobalViolenceIndex(HOTSPOTS);
    assert.equal(a, b);
  });

  it('fixture HOTSPOTS produces non-zero index', () => {
    assert.ok(computeGlobalViolenceIndex(HOTSPOTS) > 0);
  });

  it('single low-event declining Low hotspot produces low index', () => {
    const quiet: ViolenceHotspot[] = [
      { id: 'Q1', country: 'Q', region: 'R', primaryActor: 'A', conflictType: 'Civil War', monthlyEvents: 10, trend: 'declining', fatalitiesYTD: '0', civilianImpact: 'Low', description: '' },
    ];
    assert.ok(computeGlobalViolenceIndex(quiet) < 10);
  });
});

// ?? conflictTypeClass ?????????????????????????????????????????????????????????
describe('conflictTypeClass', () => {
  it('Civil War returns pv-type-civil-war', () => {
    assert.equal(conflictTypeClass('Civil War'), 'pv-type-civil-war');
  });

  it('Insurgency returns pv-type-insurgency', () => {
    assert.equal(conflictTypeClass('Insurgency'), 'pv-type-insurgency');
  });

  it('State Repression returns pv-type-repression', () => {
    assert.equal(conflictTypeClass('State Repression'), 'pv-type-repression');
  });

  it('Communal returns pv-type-communal', () => {
    assert.equal(conflictTypeClass('Communal'), 'pv-type-communal');
  });

  it('Electoral returns pv-type-electoral', () => {
    assert.equal(conflictTypeClass('Electoral'), 'pv-type-electoral');
  });

  it('Terrorism returns pv-type-terrorism', () => {
    assert.equal(conflictTypeClass('Terrorism'), 'pv-type-terrorism');
  });

  it('every fixture hotspot has a non-empty conflictTypeClass', () => {
    for (const h of HOTSPOTS) {
      const cls = conflictTypeClass(h.conflictType);
      assert.ok(cls.length > 0, `Expected non-empty class for ${h.conflictType}`);
    }
  });
});

// ?? civilianImpactClass ???????????????????????????????????????????????????????
describe('civilianImpactClass', () => {
  it('Low returns pv-impact-low', () => {
    assert.equal(civilianImpactClass('Low'), 'pv-impact-low');
  });

  it('Medium returns pv-impact-medium', () => {
    assert.equal(civilianImpactClass('Medium'), 'pv-impact-medium');
  });

  it('High returns pv-impact-high', () => {
    assert.equal(civilianImpactClass('High'), 'pv-impact-high');
  });

  it('Extreme returns pv-impact-extreme', () => {
    assert.equal(civilianImpactClass('Extreme'), 'pv-impact-extreme');
  });

  it('all four levels produce distinct class strings', () => {
    const levels: CivilianImpact[] = ['Low', 'Medium', 'High', 'Extreme'];
    const classes = levels.map(l => civilianImpactClass(l));
    const unique = new Set(classes);
    assert.equal(unique.size, 4);
  });
});

// ?? eventTypeClass ????????????????????????????????????????????????????????????
describe('eventTypeClass', () => {
  it('Battles returns pv-event-battles', () => {
    assert.equal(eventTypeClass('Battles'), 'pv-event-battles');
  });

  it('Explosions returns pv-event-explosions', () => {
    assert.equal(eventTypeClass('Explosions'), 'pv-event-explosions');
  });

  it('Violence Against Civilians returns pv-event-vac', () => {
    assert.equal(eventTypeClass('Violence Against Civilians'), 'pv-event-vac');
  });

  it('Riots returns pv-event-riots', () => {
    assert.equal(eventTypeClass('Riots'), 'pv-event-riots');
  });

  it('Strategic Developments returns pv-event-strategic', () => {
    assert.equal(eventTypeClass('Strategic Developments'), 'pv-event-strategic');
  });

  it('all five types produce distinct class strings', () => {
    const types: EventType[] = ['Battles', 'Explosions', 'Violence Against Civilians', 'Riots', 'Strategic Developments'];
    const classes = types.map(t => eventTypeClass(t));
    const unique = new Set(classes);
    assert.equal(unique.size, 5);
  });
});

// ?? buildRenderData ???????????????????????????????????????????????????????????
describe('buildRenderData', () => {
  it('returns all hotspots and events unchanged', () => {
    const data = buildRenderData(MOCK_HOTSPOTS, MOCK_EVENTS);
    assert.equal(data.hotspots.length, MOCK_HOTSPOTS.length);
    assert.equal(data.events.length, MOCK_EVENTS.length);
  });

  it('computes non-zero globalViolenceIndex for non-empty hotspots', () => {
    const data = buildRenderData(MOCK_HOTSPOTS, MOCK_EVENTS);
    assert.ok(data.globalViolenceIndex > 0);
  });

  it('activeConflictCount excludes declining hotspots', () => {
    const data = buildRenderData(MOCK_HOTSPOTS, MOCK_EVENTS);
    const expected = MOCK_HOTSPOTS.filter(h => h.trend !== 'declining').length;
    assert.equal(data.activeConflictCount, expected);
  });

  it('highCivilianImpactCount matches High+Extreme count', () => {
    const data = buildRenderData(MOCK_HOTSPOTS, MOCK_EVENTS);
    const expected = MOCK_HOTSPOTS.filter(
      h => h.civilianImpact === 'High' || h.civilianImpact === 'Extreme'
    ).length;
    assert.equal(data.highCivilianImpactCount, expected);
  });

  it('mostViolentRegion is the region with highest total monthly events', () => {
    const data = buildRenderData(MOCK_HOTSPOTS, MOCK_EVENTS);
    // Africa: H1(1000) + H2(500) + H6(400) = 1900 Ñ should win
    assert.equal(data.mostViolentRegion, 'Africa');
  });

  it('returns 0 index and empty region for empty hotspots', () => {
    const data = buildRenderData([], []);
    assert.equal(data.globalViolenceIndex, 0);
    assert.equal(data.mostViolentRegion, '');
  });

  it('works with fixture data without throwing', () => {
    assert.doesNotThrow(() => buildRenderData(HOTSPOTS, EVENTS));
  });
});

// ?? Data integrity ????????????????????????????????????????????????????????????
describe('HOTSPOTS data integrity', () => {
  it('has exactly 10 hotspots', () => {
    assert.equal(HOTSPOTS.length, 10);
  });

  it('all hotspot IDs are unique', () => {
    const ids = HOTSPOTS.map(h => h.id);
    assert.equal(new Set(ids).size, HOTSPOTS.length);
  });

  it('all monthlyEvents are positive integers', () => {
    for (const h of HOTSPOTS) {
      assert.ok(h.monthlyEvents > 0 && Number.isInteger(h.monthlyEvents), `${h.country} monthlyEvents invalid`);
    }
  });

  it('all trend values are valid enum members', () => {
    const valid = new Set(['escalating', 'stable', 'declining']);
    for (const h of HOTSPOTS) {
      assert.ok(valid.has(h.trend), `${h.country} has invalid trend: ${h.trend}`);
    }
  });

  it('all civilianImpact values are valid enum members', () => {
    const valid = new Set(['Low', 'Medium', 'High', 'Extreme']);
    for (const h of HOTSPOTS) {
      assert.ok(valid.has(h.civilianImpact), `${h.country} has invalid impact: ${h.civilianImpact}`);
    }
  });
});

describe('EVENTS data integrity', () => {
  it('has exactly 10 events', () => {
    assert.equal(EVENTS.length, 10);
  });

  it('all event IDs are unique', () => {
    const ids = EVENTS.map(e => e.id);
    assert.equal(new Set(ids).size, EVENTS.length);
  });

  it('all significance values are between 1 and 10', () => {
    for (const e of EVENTS) {
      assert.ok(e.significance >= 1 && e.significance <= 10, `${e.id} significance out of range: ${e.significance}`);
    }
  });

  it('all fatalities are non-negative', () => {
    for (const e of EVENTS) {
      assert.ok(e.fatalities >= 0, `${e.id} has negative fatalities`);
    }
  });

  it('all eventType values are valid enum members', () => {
    const valid = new Set(['Battles', 'Explosions', 'Violence Against Civilians', 'Riots', 'Strategic Developments']);
    for (const e of EVENTS) {
      assert.ok(valid.has(e.eventType), `${e.id} has invalid eventType: ${e.eventType}`);
    }
  });
});